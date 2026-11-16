import type { Attributes } from "@opentelemetry/api";

// Explicit allowlist: auto-instrumentation must not export URLs, headers, Redis
// commands, database statements, peer addresses, or exception payloads.
const allowedAttributes = new Set([
    "db.system",
    "http.request.method",
    "http.method",
    "http.response.status_code",
    "http.status_code",
    "http.route",
    "rpc.system",
    "rpc.service",
    "rpc.method",
    "rpc.grpc.status_code",
    "network.protocol.version",
    "server.port",
    "wa.request_id",
    "wa.entry_point",
]);

export function safeSpanAttributes(attributes: Attributes): Attributes {
    return Object.fromEntries(Object.entries(attributes).filter(([key]) => allowedAttributes.has(key)));
}

export function redactTelemetryText(value: string): string {
    return value
        .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
            try {
                const parsed = new URL(url);
                return `${parsed.origin}${parsed.pathname}`;
            } catch {
                return "[url]";
            }
        })
        .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
        .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[email]")
        .replace(/((?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
}
