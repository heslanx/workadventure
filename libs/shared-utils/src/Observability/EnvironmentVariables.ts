import { z } from "zod";

export const ObservabilityEnvironmentVariables = {
    OBSERVABILITY_ENABLED: z
        .string()
        .optional()
        .describe("Set to true to export OpenTelemetry traces, logs and metrics. Defaults to false."),
    OBSERVABILITY_SAMPLE_RATE: z
        .string()
        .optional()
        .describe("Root trace sampling probability from 0 to 1. Defaults to 0.1; metrics are not sampled."),
    OBSERVABILITY_ENVIRONMENT: z
        .string()
        .optional()
        .describe("Telemetry deployment environment. Defaults to NODE_ENV or development."),
    OBSERVABILITY_RELEASE: z
        .string()
        .optional()
        .describe("Immutable release identifier, usually the deployed Git SHA."),
    OTEL_EXPORTER_OTLP_ENDPOINT: z
        .string()
        .optional()
        .describe(
            "Optional OTLP HTTP collector base URL. When absent, uses POSTHOG_URL/i. A custom collector receives no PostHog token.",
        ),
};

export const PostHogEnvironmentVariables = {
    POSTHOG_API_KEY: z
        .string()
        .optional()
        .describe("PostHog public project token for event ingestion; never a personal API key."),
    POSTHOG_URL: z
        .string()
        .optional()
        .describe(
            "PostHog ingestion URL for the project's region, e.g. https://eu.i.posthog.com. No region is assumed.",
        ),
};
