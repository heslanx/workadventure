import { randomUUID } from "node:crypto";
import { context, trace } from "@opentelemetry/api";
import { PostHog } from "posthog-node";
import { asError } from "catch-unknown";
import { registerDrainableService } from "../ShutdownDrains";
import { redactTelemetryText } from "./Privacy";

let client: PostHog | undefined;
let serviceName = "unknown";
const captured = new WeakSet<object>();

// The SDK enriches stacks with source code after captureException; scrub at the final boundary too.
function sanitizeExceptionProperty(value: unknown): unknown {
    if (typeof value === "string") return redactTelemetryText(value);
    if (Array.isArray(value)) return value.map(sanitizeExceptionProperty);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !["pre_context", "post_context", "context_line"].includes(key))
                .map(([key, child]) => [key, sanitizeExceptionProperty(child)]),
        );
    }
    return value;
}

export function captureBackendException(error: unknown): void {
    if (!client) return;
    if (typeof error === "object" && error !== null) {
        if (captured.has(error)) return;
        captured.add(error);
    }
    try {
        const original = asError(error);
        const safe = new Error(redactTelemetryText(original.message));
        safe.name = original.name;
        safe.stack = original.stack ? redactTelemetryText(original.stack) : undefined;
        const span = trace.getSpan(context.active())?.spanContext();
        client.captureException(safe, randomUUID(), {
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
    if (client || !process.env.POSTHOG_API_KEY || !process.env.POSTHOG_URL) return;
    try {
        const host = new URL(process.env.POSTHOG_URL);
        if (
            !["https:", "http:"].includes(host.protocol) ||
            host.username ||
            host.password ||
            host.search ||
            host.hash ||
            process.env.POSTHOG_API_KEY.startsWith("phx_")
        )
            return;
    } catch {
        console.warn(JSON.stringify({ event: "posthog_configuration_invalid", service, level: "warn" }));
        return;
    }
    serviceName = service;
    client = new PostHog(process.env.POSTHOG_API_KEY, {
        host: process.env.POSTHOG_URL,
        flushAt: 20,
        flushInterval: 10_000,
        requestTimeout: 3000,
        // Observe fatal errors without changing Node's exit/rejection semantics.
        enableExceptionAutocapture: false,
        disableGeoip: true,
        before_send: (event) => ({
            ...event,
            properties: Object.fromEntries(
                Object.entries(event.properties ?? {}).map(([key, value]) => [key, sanitizeExceptionProperty(value)]),
            ),
        }),
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
