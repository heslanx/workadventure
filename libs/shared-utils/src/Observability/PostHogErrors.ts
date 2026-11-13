import { randomUUID } from "node:crypto";
import { context, trace } from "@opentelemetry/api";
import { PostHog } from "posthog-node";
import { asError } from "catch-unknown";
import { registerDrainableService } from "../ShutdownDrains";
import { sanitizePostHogException } from "./PostHogPrivacy";
import { readPostHogConfiguration } from "./Configuration";

let client: PostHog | undefined;
let serviceName = "unknown";
const captured = new WeakSet<object>();

export function isPostHogErrorsActive(): boolean {
    return client !== undefined;
}

export function captureBackendException(error: unknown): void {
    if (!client) return;
    if (typeof error === "object" && error !== null) {
        if (captured.has(error)) return;
        captured.add(error);
    }
    try {
        const original = asError(error);
        const span = trace.getSpan(context.active())?.spanContext();
        client.captureException(original, randomUUID(), {
            $process_person_profile: false,
            service: serviceName,
            environment: process.env.OBSERVABILITY_ENVIRONMENT || process.env.NODE_ENV || "development",
            release: process.env.OBSERVABILITY_RELEASE || "unknown",
            trace_id: span?.traceId,
            entryPoint: `${serviceName}.error`,
        });
    } catch {
        // Telemetry must not replace the application's error handling.
    }
}

export function startPostHogErrors(service: string): void {
    if (client) return;
    const config = readPostHogConfiguration(process.env.POSTHOG_API_KEY, process.env.POSTHOG_URL);
    if (!config) {
        if (process.env.POSTHOG_API_KEY || process.env.POSTHOG_URL) {
            console.warn(JSON.stringify({ event: "posthog_configuration_invalid", service, level: "warn" }));
        }
        return;
    }
    serviceName = service;
    client = new PostHog(config.apiKey, {
        host: config.host,
        flushAt: 20,
        flushInterval: 10_000,
        requestTimeout: 3000,
        // Observe fatal errors without changing Node's exit/rejection semantics.
        enableExceptionAutocapture: false,
        disableGeoip: true,
        before_send: sanitizePostHogException,
    });
    client.on("error", () => console.warn(JSON.stringify({ event: "posthog_export_failed", service, level: "warn" })));
    process.on("uncaughtExceptionMonitor", captureBackendException);
    registerDrainableService({
        name: "posthog-errors",
        drain: async (timeoutMs) => {
            await client?.shutdown(Math.min(timeoutMs, 3000));
        },
        stop: () => {
            process.off("uncaughtExceptionMonitor", captureBackendException);
            client = undefined;
        },
    });
}
