import { createServer } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { readObservabilityConfiguration } from "../src/Observability/Configuration";
import { PrivateSpanExporter } from "../src/Observability/NodeTelemetry";
import { redactTelemetryText } from "../src/Observability/Privacy";

describe("observability configuration", () => {
    it.each([
        {},
        { OBSERVABILITY_ENABLED: "true" },
        {
            OBSERVABILITY_ENABLED: "true",
            POSTHOG_URL: "https://eu.i.posthog.com",
        },
        {
            OBSERVABILITY_ENABLED: "true",
            OTEL_EXPORTER_OTLP_ENDPOINT: "https://user:password@collector.test",
        },
        {
            OBSERVABILITY_ENABLED: "true",
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.test",
            OBSERVABILITY_SAMPLE_RATE: "2",
        },
    ])("keeps missing and invalid telemetry configuration non-fatal", (env) => {
        expect(readObservabilityConfiguration(env)).toBeUndefined();
    });

    it("uses the explicit region and keeps project credentials away from custom collectors", () => {
        const env = {
            OBSERVABILITY_ENABLED: "true",
            POSTHOG_API_KEY: "project-token",
            POSTHOG_URL: "https://eu.i.posthog.com/",
        };
        expect(readObservabilityConfiguration(env)).toMatchObject({
            endpoint: "https://eu.i.posthog.com/i",
            token: "project-token",
            sampleRate: 0.1,
        });
        expect(
            readObservabilityConfiguration({ ...env, OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" }),
        ).toMatchObject({ endpoint: "http://collector:4318", token: undefined });
    });
});

describe("telemetry privacy", () => {
    it("removes secrets from error messages and stacks", () => {
        expect(
            redactTelemetryText(
                "GET https://example.org/api?token=secret#private user@example.org Bearer secret token: secret",
            ),
        ).toBe("GET https://example.org/api [email] Bearer [redacted] token: [redacted]");
    });

    it("exports correlation and route templates without raw paths, payloads or exception details", async () => {
        const sink = new InMemorySpanExporter();
        const provider = new BasicTracerProvider({
            spanProcessors: [new SimpleSpanProcessor(new PrivateSpanExporter(sink))],
        });
        try {
            const span = provider.getTracer("test").startSpan("GET /private-user?token=secret", {
                attributes: {
                    "http.method": "GET",
                    "http.route": "/users/:id",
                    "http.url": "https://app.test/private-user?token=secret",
                    "db.statement": "secret",
                    "wa.request_id": "correlation",
                },
            });
            span.recordException(new Error("private message"));
            span.end();
            await provider.forceFlush();
            expect(sink.getFinishedSpans()).toHaveLength(1);
            const exported = sink.getFinishedSpans()[0];
            expect(exported.name).toBe("GET /users/:id");
            expect(exported.attributes).toEqual({
                "http.method": "GET",
                "http.route": "/users/:id",
                "wa.request_id": "correlation",
            });
            expect(exported.events).toEqual([]);
            expect(exported.spanContext().traceId).toBe(span.spanContext().traceId);
        } finally {
            await provider.shutdown();
        }
    });
});

it.each(["0", "1"])(
    "exports real HTTP telemetry with trace sampling %s and no request secrets",
    async (sampleRate) => {
        const payloads = new Map<string, Buffer[]>();
        const collector = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", () => {
                const path = req.url ?? "";
                payloads.set(path, [...(payloads.get(path) ?? []), Buffer.concat(chunks)]);
                res.end();
            });
        });
        collector.listen(0, "127.0.0.1");
        await once(collector, "listening");
        try {
            const address = collector.address();
            if (!address || typeof address === "string") throw new Error("Collector failed to bind");
            const { stdout } = await promisify(execFile)(
                process.execPath,
                ["--import", "tsx", "tests/fixtures/observability-smoke.ts"],
                {
                    env: {
                        ...process.env,
                        OBSERVABILITY_ENABLED: "true",
                        OBSERVABILITY_SAMPLE_RATE: sampleRate,
                        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
                    },
                    timeout: 15_000,
                },
            );
            expect(stdout).toContain('"event":"observability_smoke_passed"');
            expect([...payloads.keys()].sort()).toEqual(
                sampleRate === "1" ? ["/v1/logs", "/v1/metrics", "/v1/traces"] : ["/v1/logs", "/v1/metrics"],
            );
            expect(stdout).toContain('"status":503');
            if (sampleRate === "0") expect(stdout).not.toContain('"status":200');
            const output = Buffer.concat([...payloads.values()].flat()).toString("utf8");
            expect(output).toContain("http.server.duration");
            expect(output).toContain("http_request_completed");
            expect(output).toContain("/downstream/:id");
            expect(output).not.toContain("private-token");
            expect(output).not.toContain("private-person");
        } finally {
            await new Promise<void>((resolve, reject) => {
                collector.close((error) => (error ? reject(error) : resolve()));
            });
        }
    },
    20_000,
);
