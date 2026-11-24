import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError, AxiosHeaders } from "axios";
import * as Sentry from "@sentry/node";
import type { RecordingEventPayload } from "../src/Services/AdminApi";

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("../src/Enum/EnvironmentVariable", () => ({
    ADMIN_API_URL: "http://admin.test/",
    ADMIN_API_TOKEN: "admin-token",
}));

const { adminApi } = await import("../src/Services/AdminApi");
const { setCapabilities } = await import("../src/Services/Capabilities");

const payload: RecordingEventPayload = {
    phase: "ended",
    status: "EGRESS_COMPLETE",
    egressId: "egress-1",
    recordingSessionId: "session-1",
    playUri: "http://play.test/@/team/world/room",
    recorder: { uuid: "recorder-uuid", spaceUserId: "1" },
    startedAt: "2023-11-14T22:13:20.000Z",
    endedAt: "2023-11-14T22:23:30.000Z",
    error: null,
    files: [{ filename: "recorder-uuid/recording-1.mp4", sizeBytes: 123, durationSeconds: 610 }],
};

function httpError(status: number): AxiosError {
    return new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, {
        status,
        statusText: "",
        data: {},
        headers: {},
        config: { headers: new AxiosHeaders() },
    });
}

describe("AdminApi.notifyRecordingEvent", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setCapabilities({ "api/recordings/events": "v1" });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("posts the payload to the admin recordings endpoint with the admin token", async () => {
        const post = vi.spyOn(axios, "post");
        post.mockResolvedValue({ status: 202 });

        await adminApi.notifyRecordingEvent(payload);

        expect(post).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledWith(
            "http://admin.test/api/recordings/events",
            payload,
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: "admin-token" }) as unknown,
            }),
        );
    });

    it("does not post when the admin does not advertise the recordings endpoint", async () => {
        setCapabilities({});
        const post = vi.spyOn(axios, "post");

        await adminApi.notifyRecordingEvent(payload);

        expect(post).not.toHaveBeenCalled();
    });

    it("retries transport and server errors, then gives up", async () => {
        const post = vi.spyOn(axios, "post");
        post.mockRejectedValue(httpError(503));

        const promise = adminApi.notifyRecordingEvent(payload);
        // Keep the rejection handled while the fake timers advance through the backoff.
        promise.catch(() => undefined);
        await vi.runAllTimersAsync();
        await expect(promise).rejects.toBeInstanceOf(AxiosError);

        expect(post).toHaveBeenCalledTimes(4);
    });

    it("does not retry when the admin rejects the payload", async () => {
        const post = vi.spyOn(axios, "post");
        post.mockRejectedValue(httpError(422));

        await expect(adminApi.notifyRecordingEvent(payload)).rejects.toBeInstanceOf(AxiosError);

        expect(post).toHaveBeenCalledTimes(1);
    });
});

describe("the admin's LiveKit settings", () => {
    const playUri = "http://play.test/@/team/world/room";
    const answer = (extra: Record<string, unknown> = {}) => ({
        status: 200,
        data: {
            livekitHost: "https://livekit.test",
            livekitApiKey: "key",
            livekitApiSecret: "secret",
            ...extra,
        },
    });
    /** The test's own world, so that an answer kept by one test is never served to another. */
    let worldCount = 0;
    const newWorld = () => `http://play.test/@/team/world-${++worldCount}/`;
    const timeout = () => new AxiosError("timeout of 5000ms exceeded", "ECONNABORTED");

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(async () => {
        // Lets every kept answer expire
        await vi.runAllTimersAsync();
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    describe("fetchLivekitCredentials", () => {
        it("asks with the room's URL and the admin token", async () => {
            const get = vi.spyOn(axios, "get").mockResolvedValue(answer());

            await adminApi.fetchLivekitCredentials("world.bubble", playUri);

            expect(get).toHaveBeenCalledWith(
                "http://admin.test/api/livekit/credentials",
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: "admin-token" }) as unknown,
                    params: { playUri },
                }),
            );
        });

        it("gives up on an admin that never answers, after the same 5 seconds as the recording events", async () => {
            // A stand-in for axios: it honours the timeout it is given, and without one it never answers.
            vi.spyOn(axios, "get").mockImplementation(
                (_url, config) =>
                    new Promise((_resolve, reject) => {
                        if (config?.timeout) {
                            setTimeout(() => reject(timeout()), config.timeout);
                        }
                    }),
            );

            let outcome = "pending";
            adminApi.fetchLivekitCredentials("world.bubble", playUri).then(
                () => (outcome = "answered"),
                () => (outcome = "failed"),
            );
            await vi.advanceTimersByTimeAsync(4_999);
            expect(outcome).toBe("pending");
            await vi.advanceTimersByTimeAsync(1);

            expect(outcome).toBe("failed");
        });

        it.each([0, -3, 2.5, "8", {}])(
            "keeps the host and the keys when the threshold is %j, and ignores the threshold",
            async (bad) => {
                vi.spyOn(console, "warn").mockImplementation(() => undefined);
                vi.spyOn(axios, "get").mockResolvedValue(answer({ maxUsersForWebrtc: bad }));

                const credentials = await adminApi.fetchLivekitCredentials("world.bubble", playUri);

                expect(credentials).toEqual({
                    livekitHost: "https://livekit.test",
                    livekitApiKey: "key",
                    livekitApiSecret: "secret",
                    maxUsersForWebrtc: undefined,
                });
            },
        );

        it("keeps a threshold that is a positive integer, and a null one", async () => {
            const get = vi.spyOn(axios, "get");

            get.mockResolvedValue(answer({ maxUsersForWebrtc: 8 }));
            expect((await adminApi.fetchLivekitCredentials("world.bubble", playUri)).maxUsersForWebrtc).toBe(8);

            get.mockResolvedValue(answer({ maxUsersForWebrtc: null }));
            expect((await adminApi.fetchLivekitCredentials("world.bubble", playUri)).maxUsersForWebrtc).toBeNull();
        });

        it("still rejects an answer without the LiveKit host or keys", async () => {
            vi.spyOn(axios, "get").mockResolvedValue({ status: 200, data: { livekitHost: "https://livekit.test" } });

            await expect(adminApi.fetchLivekitCredentials("world.bubble", playUri)).rejects.toThrow();
        });
    });

    describe("fetchWorldLivekitSettings", () => {
        it("sends one request for two spaces of a world that join within its lifetime, whichever their rooms", async () => {
            const get = vi.spyOn(axios, "get").mockResolvedValue(answer({ autoRecording: true }));
            const world = newWorld();

            const first = await adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-1`, `${world}room-a`);
            await vi.advanceTimersByTimeAsync(29_000);
            const second = await adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-2`, `${world}room-b`);

            expect(get).toHaveBeenCalledOnce();
            expect(second).toBe(first);
            expect(second.autoRecording).toBe(true);
        });

        it("asks again for a space that joins after the lifetime, and for another world", async () => {
            const get = vi.spyOn(axios, "get").mockResolvedValue(answer());
            const world = newWorld();

            await adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-1`, playUri);
            await adminApi.fetchWorldLivekitSettings(newWorld(), "other.bubble", playUri);
            expect(get).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(30_000);
            await adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-2`, playUri);

            expect(get).toHaveBeenCalledTimes(3);
        });

        it("makes the spaces that ask together share one request, and one answer", async () => {
            let reply!: (response: ReturnType<typeof answer>) => void;
            const get = vi.spyOn(axios, "get").mockReturnValue(
                new Promise((resolve) => {
                    reply = resolve;
                }),
            );
            const world = newWorld();

            const asks = [1, 2, 3].map((n) =>
                adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-${n}`, playUri),
            );
            reply(answer({ maxUsersForWebrtc: 2 }));
            const answers = await Promise.all(asks);

            expect(get).toHaveBeenCalledOnce();
            expect(answers.map((settings) => settings.maxUsersForWebrtc)).toEqual([2, 2, 2]);
        });

        it("drops the answer, which holds the LiveKit secret, when its lifetime ends, even if nobody asks again", async () => {
            vi.spyOn(axios, "get").mockResolvedValue(answer());
            const world = newWorld();

            await adminApi.fetchWorldLivekitSettings(world, `${world}.bubble`, playUri);
            // The timer that drops it
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(30_000);

            expect(vi.getTimerCount()).toBe(0);
        });

        it("does not leave a hung admin to hold every space: the ask fails at the timeout, for all of them at once", async () => {
            const get = vi.spyOn(axios, "get").mockImplementation(
                (_url, config) =>
                    new Promise((_resolve, reject) => {
                        if (config?.timeout) {
                            setTimeout(() => reject(timeout()), config.timeout);
                        }
                    }),
            );
            vi.spyOn(console, "error").mockImplementation(() => undefined);
            const world = newWorld();

            const asks = [1, 2, 3].map((n) =>
                adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-${n}`, playUri).then(
                    () => "answered",
                    () => "failed",
                ),
            );
            await vi.advanceTimersByTimeAsync(5_000);

            expect(await Promise.all(asks)).toEqual(["failed", "failed", "failed"]);
            expect(get).toHaveBeenCalledOnce();
        });

        it("reports a failure to Sentry once for the world, however many spaces wait on it", async () => {
            vi.spyOn(axios, "get").mockRejectedValue(timeout());
            vi.spyOn(console, "error").mockImplementation(() => undefined);
            const world = newWorld();

            const asks = [1, 2, 3].map((n) =>
                adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-${n}`, playUri).catch(() => undefined),
            );
            await Promise.all(asks);
            // Also a space that comes while the failure is remembered
            await adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-4`, playUri).catch(() => undefined);

            expect(Sentry.captureException).toHaveBeenCalledOnce();
        });

        it("remembers a failure for 5 seconds only, then asks again and serves the answer it gets", async () => {
            const get = vi.spyOn(axios, "get").mockRejectedValue(timeout());
            vi.spyOn(console, "error").mockImplementation(() => undefined);
            const world = newWorld();

            await expect(
                adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-1`, playUri),
            ).rejects.toBeInstanceOf(AxiosError);
            // Within the window: the failure again, without asking the admin
            await vi.advanceTimersByTimeAsync(4_999);
            await expect(
                adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-2`, playUri),
            ).rejects.toBeInstanceOf(AxiosError);
            expect(get).toHaveBeenCalledOnce();

            // The admin is back
            get.mockResolvedValue(answer({ maxUsersForWebrtc: 3 }));
            await vi.advanceTimersByTimeAsync(1);
            const settings = await adminApi.fetchWorldLivekitSettings(world, `${world}.bubble-3`, playUri);

            expect(get).toHaveBeenCalledTimes(2);
            expect(settings.maxUsersForWebrtc).toBe(3);
        });

        it("does not log the error itself, which carries the admin token in its request config", async () => {
            const failure = timeout();
            failure.config = { headers: new AxiosHeaders({ Authorization: "admin-token" }) };
            vi.spyOn(axios, "get").mockRejectedValue(failure);
            const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
            const world = newWorld();

            await adminApi.fetchWorldLivekitSettings(world, `${world}.bubble`, playUri).catch(() => undefined);

            expect(logged).toHaveBeenCalledOnce();
            expect(JSON.stringify(logged.mock.calls)).not.toContain("admin-token");
        });
    });
});
