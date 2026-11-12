import type { BeforeSendFn } from "posthog-node";

function redactDiagnosticText(text: string): string {
    return text
        .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, (value) => {
            try {
                const url = new URL(value);
                return `${url.origin}${url.pathname}`;
            } catch {
                return "[url]";
            }
        })
        .replace(
            /(["']?(?:(?:proxy-)?authorization|(?:set-)?cookie)["']?[ \t]*[:=][ \t]*)[^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*/gi,
            "$1[redacted]",
        )
        .replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
        .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
        .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[email]")
        .replace(
            /(["']?(?:[\w.-]*(?:token|password|secret)|api[_-]?key)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi,
            "$1[redacted]",
        );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function pickDiagnostics(value: unknown, fields: readonly string[]): Record<string, unknown> {
    const source = asRecord(value);
    const result: Record<string, unknown> = {};
    if (!source) return result;

    for (const field of fields) {
        const item = source[field];
        if (typeof item === "string") result[field] = redactDiagnosticText(item);
        else if (typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) result[field] = item;
    }
    return result;
}

function projectException(value: unknown): Record<string, unknown> {
    const exception = asRecord(value);
    const result = pickDiagnostics(exception, ["type", "value"]);
    if (!exception) return result;

    result.mechanism = pickDiagnostics(exception.mechanism, [
        "type",
        "handled",
        "synthetic",
        "exception_id",
        "parent_id",
        "source",
        "is_exception_group",
    ]);
    const stacktrace = asRecord(exception.stacktrace);
    if (Array.isArray(stacktrace?.frames)) {
        result.stacktrace = {
            ...pickDiagnostics(stacktrace, ["type"]),
            frames: stacktrace.frames.map((frame: unknown) =>
                pickDiagnostics(frame, [
                    "filename",
                    "function",
                    "module",
                    "lineno",
                    "colno",
                    "in_app",
                    "platform",
                    "chunk_id",
                ]),
            ),
        };
    }
    return result;
}

export const sanitizePostHogException: BeforeSendFn = (event) => {
    if (event.event !== "$exception") return event;

    const exceptions: unknown = event.properties?.$exception_list;
    return {
        ...event,
        properties: {
            ...pickDiagnostics(event.properties, [
                "$exception_level",
                "$process_person_profile",
                "service",
                "environment",
                "release",
                "trace_id",
                "entryPoint",
            ]),
            $exception_list: Array.isArray(exceptions) ? exceptions.map(projectException) : [],
        },
    };
};
