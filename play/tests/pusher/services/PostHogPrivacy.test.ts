// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import type { EventEmitter } from "node:events";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostHog, PostHogOptions } from "posthog-node";
import type * as PostHogSDK from "posthog-node";
import { exceptionWithSourceContext } from "../fixtures/postHogError";

const state = vi.hoisted(() => {
    const configuration: { apiKey?: string; host?: string } = {
        apiKey: "phc_synthetic_test",
        host: "https://example.invalid",
    };
    return {
        clients: [] as PostHog[],
        batches: [] as { batch: { event: string; properties: Record<string, unknown> }[] }[],
        errorHandler: undefined as ((error: Error) => void) | undefined,
        sharedActive: false,
        sharedCapture: vi.fn(),
        ...configuration,
        loggerProviders: 0,
    };
});

vi.mock("posthog-node", async (importOriginal) => {
    const actual = await importOriginal<typeof PostHogSDK>();
    return {
        PostHog: class extends actual.PostHog {
            constructor(key: string, options: PostHogOptions) {
                super(key, {
                    ...options,
                    fetch: (_url, request) => {
                        const body = request.body;
                        const text =
                            typeof body === "string" ? body : gunzipSync(Buffer.from(body as Uint8Array)).toString();
                        state.batches.push(JSON.parse(text));
                        return Promise.resolve({
                            status: 200,
                            text: () => Promise.resolve(""),
                            json: () => Promise.resolve({}),
                        });
                    },
                });
                state.clients.push(this);
            }
        },
    };
});

vi.mock("@workadventure/shared-utils/src/Observability/PostHogErrors", () => ({
    isPostHogErrorsActive: () => state.sharedActive,
    captureBackendException: state.sharedCapture,
}));
vi.mock("@workadventure/shared-utils/src/Observability/NodeTelemetry", () => ({
    isObservabilityActive: () => false,
}));

vi.mock("process", () => ({ default: { env: { NODE_ENV: "test" }, once: vi.fn() } }));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("@grpc/grpc-js", () => ({ Server: vi.fn(), ServerCredentials: {} }));
vi.mock("@workadventure/messages/src/ts-proto-generated/room-api", () => ({ RoomApiService: {} }));
vi.mock("@workadventure/shared-utils", () => ({
    setErrorHandler: (handler: (error: Error) => void) => {
        state.errorHandler = handler;
    },
    runDrains: vi.fn(),
}));
vi.mock("../../../src/pusher/app", () => ({
    default: {
        init: async () => {},
        listenWebServer: async () => {},
        listenWebSocket: async () => {},
        listenPrometheusPort: async () => {},
    },
}));
vi.mock("../../../src/pusher/enums/EnvironmentVariable", () => ({
    PUSHER_HTTP_PORT: 0,
    PUSHER_WS_PORT: 0,
    ADMIN_API_URL: undefined,
    ROOM_API_BIND_HOST: undefined,
    ROOM_API_PORT: undefined,
    ROOM_API_SECRET_KEY: undefined,
    SENTRY_DSN: undefined,
    SENTRY_RELEASE: undefined,
    SENTRY_TRACES_SAMPLE_RATE: undefined,
    SENTRY_ENVIRONMENT: undefined,
    DRAIN_TIMEOUT_MS: 3000,
    get POSTHOG_API_KEY() {
        return state.apiKey;
    },
    get POSTHOG_URL() {
        return state.host;
    },
}));
vi.mock("../../../src/room-api/RoomApiServer", () => ({ default: {} }));
vi.mock("../../../src/pusher/services/AnalyticsTimedEventTracker", () => ({ analyticsTimedEventTracker: {} }));
vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({ OTLPLogExporter: class {} }));
vi.mock("@opentelemetry/resources", () => ({ resourceFromAttributes: vi.fn() }));
vi.mock("@opentelemetry/sdk-logs", () => ({
    BatchLogRecordProcessor: class {},
    LoggerProvider: class {
        constructor() {
            state.loggerProviders++;
        }
        getLogger() {
            return { emit: vi.fn() };
        }
    },
}));

describe("pusher PostHog exception transport", () => {
    const nativeProcess = createRequire(import.meta.url)("node:process") as EventEmitter;
    const processEvents = [
        "newListener",
        "removeListener",
        "unhandledRejection",
        "uncaughtException",
        "uncaughtExceptionMonitor",
    ] as const;
    const originalListeners = new Map<string, ReturnType<EventEmitter["listeners"]>>();

    const testListeners = new Map<string, ReturnType<EventEmitter["listeners"]>>();

    beforeEach(() => {
        for (const event of processEvents) testListeners.set(event, nativeProcess.listeners(event));
    });

    afterEach(() => {
        for (const event of processEvents) {
            const original = testListeners.get(event) ?? [];
            for (const listener of nativeProcess.listeners(event)) {
                if (!original.includes(listener))
                    nativeProcess.removeListener(event, listener as Parameters<EventEmitter["removeListener"]>[1]);
            }
            expect(nativeProcess.listeners(event)).toEqual(original);
        }
    });

    beforeAll(async () => {
        for (const event of processEvents) originalListeners.set(event, nativeProcess.listeners(event));
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});
        await import("../../../src/server");
    });

    afterAll(async () => {
        await Promise.all(state.clients.map((client) => client.shutdown(3000)));
        for (const event of processEvents) {
            const original = originalListeners.get(event) ?? [];
            for (const listener of nativeProcess.listeners(event)) {
                if (!original.includes(listener))
                    nativeProcess.removeListener(event, listener as Parameters<EventEmitter["removeListener"]>[1]);
            }
            expect(nativeProcess.listeners(event)).toEqual(original);
        }
        vi.restoreAllMocks();
    });

    it("removes credentials from errors and causes before sending the real SDK batch", async () => {
        const cause = new Error('Authorization: Bearer synthetic-bearer; {"password":"synthetic-password"}');
        const error = new TypeError(
            "Request failed https://synthetic-user:synthetic-pass@example.test/path?token=synthetic-query#synthetic-fragment " +
                "synthetic-person@example.test eyJsynthetic.eyJpayload.synthetic-signature",
            { cause },
        );

        state.errorHandler?.(error);
        await state.clients[0].flush();

        const event = state.batches.flatMap((batch) => batch.batch).find((event) => event.event === "$exception");
        expect(event).toBeDefined();
        const payload = JSON.stringify(event);
        expect(payload).not.toMatch(/synthetic-(?:user|pass|query|fragment|bearer|password|person|signature)/);
        expect(payload).not.toContain("eyJsynthetic");
        expect(event?.properties.$exception_list).toEqual([
            expect.objectContaining({ type: "TypeError", value: expect.stringContaining("https://example.test/path") }),
            expect.objectContaining({
                type: "Error",
                mechanism: expect.objectContaining({ source: "cause", parent_id: 0 }),
            }),
        ]);
        expect(error.message).toContain("synthetic-query");
    });

    it("removes enriched source context and unknown properties while retaining stack locations", async () => {
        state.batches.length = 0;
        const error = exceptionWithSourceContext();

        state.clients[0].captureException(error, "server", {
            request: { headers: { authorization: "synthetic-request-secret" } },
        });
        await state.clients[0].flush();

        const event = state.batches.flatMap((batch) => batch.batch).find((event) => event.event === "$exception");
        const payload = JSON.stringify(event);
        expect(payload).not.toContain("synthetic-source-secret");
        expect(payload).not.toContain("synthetic-request-secret");
        expect(payload).not.toMatch(/pre_context|post_context|context_line/);
        expect(event?.properties.$exception_list).toEqual([
            expect.objectContaining({
                type: "Error",
                stacktrace: expect.objectContaining({
                    frames: expect.arrayContaining([
                        expect.objectContaining({
                            filename: expect.stringContaining("postHogError"),
                            lineno: expect.any(Number),
                        }),
                    ]),
                }),
            }),
        ]);
    });

    it.each([
        {
            name: "Basic authorization",
            header: "Authorization: Basic c3ludGhldGljOnNlY3JldA==",
            secrets: ["c3ludGhldGljOnNlY3JldA=="],
        },
        {
            name: "an arbitrary authorization scheme",
            header: "Authorization: Custom synthetic-first synthetic-second",
            secrets: ["synthetic-first", "synthetic-second"],
        },
        {
            name: "Digest authorization",
            header: 'Authorization: Digest username="synthetic-user", response="synthetic-digest"',
            secrets: ["synthetic-user", "synthetic-digest"],
        },
        {
            name: "proxy authorization",
            header: "Proxy-Authorization: Basic synthetic-proxy",
            secrets: ["synthetic-proxy"],
        },
        {
            name: "multiple cookies",
            header: "Cookie: session=synthetic-session; other=synthetic-other",
            secrets: ["synthetic-session", "synthetic-other"],
        },
        {
            name: "set-cookie values",
            header: "Set-Cookie: session=synthetic-session; other=synthetic-other; Path=/",
            secrets: ["synthetic-session", "synthetic-other"],
        },
        {
            name: "quoted JSON header values",
            header: '{"Authorization":"Basic synthetic-json-auth","Cookie":"session=synthetic-json-session; other=synthetic-json-other"}',
            secrets: ["synthetic-json-auth", "synthetic-json-session", "synthetic-json-other"],
        },
        {
            name: "folded header values",
            header: "Authorization: Custom synthetic-first\r\n\tsynthetic-continuation",
            secrets: ["synthetic-first", "synthetic-continuation"],
        },
    ])("removes the complete value of $name before SDK delivery", async ({ header, secrets }) => {
        state.batches.length = 0;
        const error = new Error(`Request failed\n${header}\nRetryable diagnostic`);

        state.errorHandler?.(error);
        await state.clients[0].flush();

        const event = state.batches.flatMap((batch) => batch.batch).find((event) => event.event === "$exception");
        expect(event).toBeDefined();
        const payload = JSON.stringify(event);
        expect(secrets.filter((secret) => payload.includes(secret))).toEqual([]);
        expect(event?.properties.$exception_list).toEqual([
            expect.objectContaining({
                type: "Error",
                value: expect.stringContaining("Request failed"),
            }),
        ]);
        expect(payload).toContain("Retryable diagnostic");
    });

    it("also sanitizes exceptions from the SDK rejection listener", async () => {
        state.batches.length = 0;
        const original = originalListeners.get("unhandledRejection") ?? [];
        const listener = nativeProcess
            .listeners("unhandledRejection")
            .find((candidate) => !original.includes(candidate));
        expect(listener).toBeDefined();

        if (listener)
            Reflect.apply(listener, nativeProcess, [
                new Error("Unhandled token=synthetic-autocapture-secret"),
                Promise.resolve(),
            ]);
        await state.clients[0].flush();

        const event = state.batches.flatMap((batch) => batch.batch).find((event) => event.event === "$exception");
        expect(event).toBeDefined();
        expect(JSON.stringify(event)).not.toContain("synthetic-autocapture-secret");
        expect(event?.properties.$exception_list).toEqual([
            expect.objectContaining({
                type: "Error",
                mechanism: expect.objectContaining({ type: "onunhandledrejection", handled: false }),
            }),
        ]);
    });
    it("reuses the bootstrapped error client instead of creating a second client", async () => {
        const clientCount = state.clients.length;
        state.sharedActive = true;
        state.sharedCapture.mockClear();
        vi.resetModules();

        await import("../../../src/server");
        const error = new Error("Bootstrapped service failure");
        state.errorHandler?.(error);

        expect(state.clients).toHaveLength(clientCount);
        expect(state.sharedCapture).toHaveBeenCalledExactlyOnceWith(error);
        state.sharedActive = false;
    });
    it.each([
        { apiKey: "phx_synthetic_personal", host: "https://example.invalid" },
        { apiKey: "phc_synthetic_test", host: "https://user:password@example.invalid" },
        { apiKey: "phc_synthetic_test", host: "https://example.invalid?token=synthetic" },
        { apiKey: "phc_synthetic_test", host: "https://example.invalid#fragment" },
        { apiKey: "phc_synthetic_test", host: "invalid-url" },
        { apiKey: "phc_synthetic_test", host: "ftp://example.invalid" },
        { apiKey: undefined, host: "https://example.invalid" },
    ])("does not bypass rejected PostHog configuration: $host", async ({ apiKey, host }) => {
        const clientCount = state.clients.length;
        const loggerCount = state.loggerProviders;
        state.apiKey = apiKey;
        state.host = host;
        vi.resetModules();
        try {
            await import("../../../src/server");
            expect(state.clients).toHaveLength(clientCount);
            expect(state.loggerProviders).toBe(loggerCount);
        } finally {
            state.apiKey = "phc_synthetic_test";
            state.host = "https://example.invalid";
        }
    });
});
