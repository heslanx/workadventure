import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { ClientRequest } from "node:http";
import { context, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader, createAllowListAttributesProcessor } from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { GrpcInstrumentation } from "@opentelemetry/instrumentation-grpc";
import { ExpressInstrumentation, ExpressLayerType } from "@opentelemetry/instrumentation-express";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { registerDrainableService } from "../ShutdownDrains";
import { readObservabilityConfiguration } from "./Configuration";
import { safeSpanAttributes } from "./Privacy";

let active = false;
export function isObservabilityActive(): boolean {
    return active;
}

/** Keep only protocol metadata; instrumentation library upgrades cannot widen exported data. */
export class PrivateSpanExporter implements SpanExporter {
    constructor(private readonly exporter: SpanExporter) {}

    export(spans: ReadableSpan[], callback: Parameters<SpanExporter["export"]>[1]): void {
        this.exporter.export(
            spans.map((span) => {
                const attributes = safeSpanAttributes(span.attributes);
                const method = attributes["http.request.method"] ?? attributes["http.method"];
                const name =
                    typeof method === "string"
                        ? `${method} ${String(attributes["http.route"] ?? "request")}`
                        : typeof attributes["rpc.method"] === "string"
                          ? `${String(attributes["rpc.service"] ?? "rpc")}/${attributes["rpc.method"]}`
                          : attributes["db.system"] === "redis"
                            ? "redis"
                            : "internal";
                return {
                    ...span,
                    name,
                    attributes,
                    events: [],
                    links: [],
                    status: { code: span.status.code },
                    spanContext: () => span.spanContext(),
                };
            }),
            callback,
        );
    }

    shutdown(): Promise<void> {
        return this.exporter.shutdown();
    }
}

function writeLog(service: string, event: string, attributes: Record<string, string | number>): void {
    const spanContext = trace.getSpan(context.active())?.spanContext();
    const fields = { service, event, traceId: spanContext?.traceId, spanId: spanContext?.spanId, ...attributes };
    const isError = typeof attributes.status === "number" && attributes.status >= 500;
    console.info(JSON.stringify({ timestamp: new Date().toISOString(), level: isError ? "error" : "info", ...fields }));
    logs.getLogger("workadventure").emit({
        body: event,
        severityText: isError ? "ERROR" : "INFO",
        severityNumber: isError ? 17 : 9,
        attributes: fields,
    });
}

/** Run before importing the service: HTTP, Express and gRPC must be patched before first use. */
export function startNodeTelemetry(service: "pusher" | "back" | "map-storage"): void {
    if (active) return;
    const config = readObservabilityConfiguration(process.env);
    if (!config) {
        if (process.env.OBSERVABILITY_ENABLED === "true") {
            console.warn(JSON.stringify({ event: "observability_configuration_invalid", service, level: "warn" }));
        }
        return;
    }
    try {
        register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
        const headers: Record<string, string> = config.token ? { Authorization: `Bearer ${config.token}` } : {};
        const exporterOptions = { headers, timeoutMillis: 3000 };
        const requestStarts = new WeakMap<object, number>();
        const sdk = new NodeSDK({
            autoDetectResources: false,
            resource: resourceFromAttributes({
                "service.name": `workadventure-${service}`,
                "service.version": config.release,
                "deployment.environment.name": config.environment,
            }),
            sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRate) }),
            spanProcessors: [
                new BatchSpanProcessor(
                    new PrivateSpanExporter(
                        new OTLPTraceExporter({
                            ...exporterOptions,
                            url: `${config.endpoint}/v1/traces`,
                        }),
                    ),
                    { maxQueueSize: 2048, exportTimeoutMillis: 3000 },
                ),
            ],
            logRecordProcessors: [
                new BatchLogRecordProcessor(
                    new OTLPLogExporter({
                        ...exporterOptions,
                        url: `${config.endpoint}/v1/logs`,
                    }),
                    { maxQueueSize: 2048, exportTimeoutMillis: 3000 },
                ),
            ],
            metricReaders: [
                new PeriodicExportingMetricReader({
                    exporter: new OTLPMetricExporter({ ...exporterOptions, url: `${config.endpoint}/v1/metrics` }),
                    exportIntervalMillis: 30_000,
                    exportTimeoutMillis: 5000,
                }),
            ],
            views: [
                {
                    instrumentName: "*",
                    attributesProcessors: [
                        createAllowListAttributesProcessor([
                            "http.method",
                            "http.request.method",
                            "http.status_code",
                            "http.response.status_code",
                            "http.route",
                            "rpc.system",
                            "rpc.service",
                            "rpc.method",
                            "rpc.grpc.status_code",
                            "state",
                            "type",
                            "nodejs.gc.type",
                        ]),
                    ],
                    aggregationCardinalityLimit: 1000,
                },
            ],
            instrumentations: [
                new HttpInstrumentation({
                    // Export traffic and health probes must not observe themselves.
                    ignoreIncomingRequestHook: (request) =>
                        /^\/(?:metrics|health(?:\/|$)|ping(?:$|\?))/.test(request.url ?? ""),
                    ignoreOutgoingRequestHook: (request) => {
                        const endpoint = new URL(config.endpoint);
                        return (
                            request.hostname === endpoint.hostname &&
                            String(request.port || (request.protocol === "https:" ? 443 : 80)) ===
                                (endpoint.port || (endpoint.protocol === "https:" ? "443" : "80"))
                        );
                    },
                    requestHook: (span, request) => {
                        if (request instanceof ClientRequest) return;
                        requestStarts.set(request, performance.now());
                        // W3C trace context propagates this correlation ID across HTTP and gRPC.
                        const requestId = span.spanContext().traceId;
                        span.setAttributes({ "wa.request_id": requestId, "wa.entry_point": `${service}.http` });
                    },
                    responseHook: (span, response) => {
                        if ("setHeader" in response && !response.headersSent) {
                            response.setHeader("x-trace-id", span.spanContext().traceId);
                            response.setHeader("x-request-id", span.spanContext().traceId);
                        }
                    },
                    applyCustomAttributesOnSpan: (span, request, response) => {
                        // Completion logs contain only protocol fields, never request bodies or URLs.
                        if (request instanceof ClientRequest) return;
                        if (!(span.spanContext().traceFlags & 1) && (response.statusCode ?? 0) < 500) return;
                        const spanId = span.spanContext().spanId;
                        writeLog(service, "http_request_completed", {
                            entryPoint: `${service}.http`,
                            requestId: span.spanContext().traceId,
                            method: request.method ?? "UNKNOWN",
                            status: response.statusCode ?? 0,
                            durationMs: Math.round(
                                performance.now() - (requestStarts.get(request) ?? performance.now()),
                            ),
                            traceId: span.spanContext().traceId,
                            spanId,
                        });
                    },
                }),
                new ExpressInstrumentation({
                    ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.REQUEST_HANDLER],
                }),
                new GrpcInstrumentation(),
                new RedisInstrumentation({ dbStatementSerializer: () => "", requireParentSpan: true }),
                new UndiciInstrumentation({
                    ignoreRequestHook: (request) => new URL(request.origin).origin === new URL(config.endpoint).origin,
                }),
                new RuntimeNodeInstrumentation(),
            ],
        });
        sdk.start();
        active = true;
        registerDrainableService({
            name: "observability",
            drain: async (timeoutMs) => {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([
                        sdk.shutdown(),
                        new Promise<void>((resolve) => {
                            timer = setTimeout(resolve, Math.min(timeoutMs, 5000));
                        }),
                    ]);
                } finally {
                    if (timer) clearTimeout(timer);
                }
            },
            stop: () => {
                active = false;
            },
        });
        writeLog(service, "observability_started", { entryPoint: `${service}.startup`, requestId: randomUUID() });
    } catch {
        console.warn(JSON.stringify({ event: "observability_start_failed", service, level: "warn" }));
    }
}
