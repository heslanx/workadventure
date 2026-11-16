export type ObservabilityConfiguration = {
    endpoint: string;
    token?: string;
    sampleRate: number;
    environment: string;
    release: string;
};

/** A bad telemetry configuration must never prevent the application from booting. */
export function readObservabilityConfiguration(
    env: Record<string, string | undefined>,
): ObservabilityConfiguration | undefined {
    if (env.OBSERVABILITY_ENABLED !== "true") return undefined;
    const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT || (env.POSTHOG_URL && `${env.POSTHOG_URL.replace(/\/$/, "")}/i`);
    if (!endpoint || (!env.OTEL_EXPORTER_OTLP_ENDPOINT && !env.POSTHOG_API_KEY)) return undefined;
    try {
        const url = new URL(endpoint);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            return undefined;
        }
    } catch {
        return undefined;
    }
    const sampleRate = Number(env.OBSERVABILITY_SAMPLE_RATE || "0.1");
    if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) return undefined;
    return {
        endpoint: endpoint.replace(/\/$/, ""),
        // Never send a PostHog credential to an independently configured collector.
        token: env.OTEL_EXPORTER_OTLP_ENDPOINT ? undefined : env.POSTHOG_API_KEY,
        sampleRate,
        environment: env.OBSERVABILITY_ENVIRONMENT || env.NODE_ENV || "development",
        release: env.OBSERVABILITY_RELEASE || "unknown",
    };
}

export function readPostHogConfiguration(
    apiKey: string | undefined,
    host: string | undefined,
): { apiKey: string; host: string } | undefined {
    if (!apiKey || !host || apiKey.startsWith("phx_")) return undefined;
    try {
        const url = new URL(host);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            return undefined;
        }
    } catch {
        return undefined;
    }
    return { apiKey, host };
}
