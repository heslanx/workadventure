// @vitest-environment node
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PostHog, PostHogOptions } from "posthog-node";
import type * as PostHogSDK from "posthog-node";
import { exceptionWithSourceContext } from "../fixtures/postHogError";

const state = vi.hoisted(() => ({
    clients: [] as PostHog[],
    batches: [] as { batch: { event: string; properties: Record<string, unknown> }[] }[],
    errorHandler: undefined as ((error: Error) => void) | undefined,
}));

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
    POSTHOG_API_KEY: "phc_synthetic_test",
    POSTHOG_URL: "https://example.invalid",
}));
vi.mock("../../../src/room-api/RoomApiServer", () => ({ default: {} }));
vi.mock("../../../src/pusher/services/AnalyticsTimedEventTracker", () => ({ analyticsTimedEventTracker: {} }));
vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({ OTLPLogExporter: class {} }));
vi.mock("@opentelemetry/resources", () => ({ resourceFromAttributes: vi.fn() }));
vi.mock("@opentelemetry/sdk-logs", () => ({
    BatchLogRecordProcessor: class {},
    LoggerProvider: class {
        getLogger() {
            return { emit: vi.fn() };
        }
    },
}));

describe("pusher PostHog exception transport", () => {
    beforeAll(async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "info").mockImplementation(() => {});
        await import("../../../src/server");
    });

    afterAll(async () => {
        await Promise.all(state.clients.map((client) => client.shutdown(3000)));
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
});
