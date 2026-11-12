import fs from "fs";
import process from "process";
import {
    captureBackendException,
    isPostHogErrorsActive,
} from "@workadventure/shared-utils/src/Observability/PostHogErrors";
import { readPostHogConfiguration } from "@workadventure/shared-utils/src/Observability/Configuration";
import { isObservabilityActive } from "@workadventure/shared-utils/src/Observability/NodeTelemetry";
import * as Sentry from "@sentry/node";
import { Server, ServerCredentials } from "@grpc/grpc-js";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { PostHog } from "posthog-node";
import { RoomApiService } from "@workadventure/messages/src/ts-proto-generated/room-api";
import { setErrorHandler } from "@workadventure/shared-utils";
import { runDrains } from "@workadventure/shared-utils";
import { sanitizePostHogException } from "@workadventure/shared-utils/src/Observability/PostHogPrivacy";
import app from "./pusher/app";
import {
    PUSHER_HTTP_PORT,
    ADMIN_API_URL,
    ROOM_API_BIND_HOST,
    ROOM_API_PORT,
    ROOM_API_SECRET_KEY,
    SENTRY_DSN,
    SENTRY_RELEASE,
    SENTRY_TRACES_SAMPLE_RATE,
    SENTRY_ENVIRONMENT,
    PUSHER_WS_PORT,
    DRAIN_TIMEOUT_MS,
    POSTHOG_API_KEY,
    POSTHOG_URL,
} from "./pusher/enums/EnvironmentVariable";
import RoomApiServer from "./room-api/RoomApiServer";
import { analyticsTimedEventTracker } from "./pusher/services/AnalyticsTimedEventTracker";

// In production, the current working directory is "dist".
if (fs.existsSync("dist") && !fs.existsSync("src")) {
    process.chdir("dist");
}

const missingPostHogVariables = [!POSTHOG_API_KEY && "POSTHOG_API_KEY", !POSTHOG_URL && "POSTHOG_URL"].filter(
    (variable): variable is string => Boolean(variable),
);

const posthogConfiguration = readPostHogConfiguration(POSTHOG_API_KEY, POSTHOG_URL);
const posthog =
    !isPostHogErrorsActive() && posthogConfiguration
        ? new PostHog(posthogConfiguration.apiKey, {
              host: posthogConfiguration.host,
              enableExceptionAutocapture: true,
              before_send: sanitizePostHogException,
          })
        : undefined;

const posthogLogProvider = posthogConfiguration
    ? new LoggerProvider({
          resource: resourceFromAttributes({
              "service.name": "workadventure-pusher",
          }),
          processors: [
              new BatchLogRecordProcessor({
                  exporter: new OTLPLogExporter({
                      url: new URL("/i/v1/logs", posthogConfiguration.host).toString(),
                      headers: {
                          Authorization: `Bearer ${posthogConfiguration.apiKey}`,
                      },
                  }),
              }),
          ],
      })
    : undefined;
const posthogLog = posthogLogProvider?.getLogger("workadventure.posthog.lifecycle");

const shutdownPostHogLogs = async (): Promise<void> => {
    if (!posthogLogProvider) {
        return;
    }

    await Promise.race([
        posthogLogProvider.shutdown(),
        new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 3000);
            timeout.unref();
        }),
    ]).catch((error: unknown) => console.error("Error shutting down PostHog logs", error));
};

if (missingPostHogVariables.length > 0 && process.env.NODE_ENV !== "production") {
    for (const variable of missingPostHogVariables) {
        console.warn(
            `${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`,
        );
    }
}

setErrorHandler((error: Error) => {
    console.error(error);
    Sentry.captureException(error);
    captureBackendException(error);
    posthog?.captureException(error, "server");
});

// Sentry integration
if (SENTRY_DSN != undefined) {
    try {
        const sentryOptions: Sentry.NodeOptions = {
            dsn: SENTRY_DSN,
            // The shared SDK owns OpenTelemetry when explicitly enabled.
            skipOpenTelemetrySetup: isObservabilityActive(),
            release: SENTRY_RELEASE,
            environment: SENTRY_ENVIRONMENT,
            tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
            attachStacktrace: true,
            beforeSend: (event, hint) => {
                if (hint.originalException) captureBackendException(hint.originalException);
                return event;
            },
        };

        Sentry.init(sentryOptions);

        console.info("Sentry initialized");
    } catch (e) {
        console.error("Error while initializing Sentry", e);
    }
}

(async () => {
    await app.init();
    posthogLog?.emit({ severityText: "INFO", body: "pusher_application_initialized" });

    await Promise.race([
        app.listenWebServer(PUSHER_HTTP_PORT).then(() => {
            console.info(`WorkAdventure Pusher web-server started on port ${PUSHER_HTTP_PORT}!`);
            posthogLog?.emit({ severityText: "INFO", body: "pusher_http_server_listening" });
        }),
        app.listenWebSocket(PUSHER_WS_PORT).then(() => {
            console.info(`WorkAdventure Pusher web-socket server started on port ${PUSHER_WS_PORT}!`);
            posthogLog?.emit({ severityText: "INFO", body: "pusher_websocket_server_listening" });
        }),
        app.listenPrometheusPort(),
    ]);
})().catch((e) => {
    console.error(e);
    Sentry.captureException(e);
    captureBackendException(e);
    posthog?.captureException(e, "server");
    posthogLog?.emit({ severityText: "ERROR", body: "pusher_application_start_failed" });
});

// Graceful shutdown: close what is still open, then drain the analytics queues, so
// events buffered at exit time still reach the admin instead of being silently
// dropped.
//
// This matters more than it looks for timed events (conversations, and later areas
// and screenshares): an interval is reported by exactly ONE row, emitted when it
// closes. There is no periodic sample to fall back on, so an interval that is never
// closed is not merely imprecise — it never happened as far as analytics knows. Every
// exit path we can observe must therefore close first. The one we cannot is
// SIGKILL/OOM, where the process dies with the map; persisting it would not help,
// because on recovery we would know an interval was open but not when it ended, and
// inventing that timestamp is worse than losing it.
let shuttingDown = false;
const shutdown = (reason: string, endReason: "pusher_shutdown" | "pusher_crashed", exitCode: number): void => {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    // Close BEFORE draining, not after: closeAll() only enqueues, so draining first
    // would leave its events behind.
    //
    // Sessions are intervals too and close in the same pass — last, so that an
    // interval never ends after the session containing it. That ordering used to be
    // this file's job, spelled out as two calls in a fixed order; it now belongs to
    // the tracker, which is the only thing that knows which handle is a session.
    const closedTimedEvents = analyticsTimedEventTracker.closeAll(endReason);
    console.info(
        `${reason}: closed ${closedTimedEvents} timed event(s), sessions included, draining analytics queues before exit…`,
    );
    posthogLog?.emit({
        severityText: "INFO",
        body: "pusher_shutdown_started",
        attributes: { shutdown_reason: endReason },
    });

    // Both arms exit, on purpose. runDrains already inspects every result and logs
    // the failures by name, so the rejection arm should be unreachable — but this is
    // the path that ends the process, and the one outcome worse than a lost buffer
    // is a replica that never exits and gets SIGKILLed with its sockets still open.
    // The version this replaces had a .catch() on a Promise.allSettled, which cannot
    // reject: it read as this guarantee without being one.
    Promise.all([
        runDrains(DRAIN_TIMEOUT_MS),
        posthog?.shutdown(3000).catch((error: unknown) => console.error("Error shutting down PostHog", error)),
        shutdownPostHogLogs(),
    ]).then(
        () => process.exit(exitCode),
        (error: unknown) => {
            console.error("Unexpected error while draining during shutdown", error);
            process.exit(exitCode);
        },
    );
};

process.once("SIGTERM", (signal) => shutdown(`Received ${signal}`, "pusher_shutdown", 0));
process.once("SIGINT", (signal) => shutdown(`Received ${signal}`, "pusher_shutdown", 0));

// A crash used to take every open interval down with it: only SIGTERM/SIGINT were
// handled, so an uncaught throw exited without closing anything. The process is going
// to die either way — but it can still spend its last moments flushing what it
// already knows, which is the difference between a conversation being reported and
// never having existed.
process.once("uncaughtException", (error) => {
    console.error("Uncaught exception — closing open analytics intervals before exit", error);
    Sentry.captureException(error);
    shutdown("Uncaught exception", "pusher_crashed", 1);
});
// Deliberately NOT hooking unhandledRejection. IoSocketController already listens for
// it, logs it and lets the pusher keep serving — and that listener is what suppresses
// Node's default "throw on unhandled rejection". Shutting down here would turn a
// survivable, logged rejection into the death of the replica, reporting every live
// conversation on it as pusher_crashed. An analytics handler that manufactures the
// outage it exists to record is worse than no handler: the process is still healthy,
// so the intervals it holds are still going to close normally.

// Room API
if (!ADMIN_API_URL && !ROOM_API_SECRET_KEY) {
    console.info("RoomAPI is disabled! ROOM_API_SECRET_KEY is not defined on environment variables.");
} else {
    const RoomAPI = new Server();

    RoomAPI.addService(RoomApiService, RoomApiServer);

    RoomAPI.bindAsync(`${ROOM_API_BIND_HOST}:${ROOM_API_PORT}`, ServerCredentials.createInsecure(), (err, port) => {
        if (err) {
            throw err;
        }
        console.info(`RoomAPI starting on port ${ROOM_API_PORT}!`);
        RoomAPI.start();
    });
}
