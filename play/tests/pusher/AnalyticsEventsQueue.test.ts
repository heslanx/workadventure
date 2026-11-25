import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    VideoQualityLevel,
    VideoQualityLimitationReason,
    VideoQualityRelayProtocol,
    VideoQualityStreamCategory,
    VideoQualityStreamDirection,
    VideoQualityTransportType,
    MAX_EVENT_ID_LENGTH,
    type AnalyticsEventName,
    type VideoQualitySampleMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import type { SocketData } from "../../src/pusher/models/Websocket/SocketData";
import {
    AnalyticsEventsQueue,
    type AnalyticsEventInput,
    type AnalyticsEventsBatch,
    type AnalyticsEventsQueueConfig,
} from "../../src/pusher/services/AnalyticsEventsQueue";

const baseConfig: AnalyticsEventsQueueConfig = {
    adminApiUrl: "http://admin.test",
    adminApiToken: "analytics-key",
    flushIntervalMs: 0,
    timeoutMs: 500,
    maxQueueSize: 10,
    maxBatchSize: 10,
    pusherInstanceId: "pusher-test",
};

describe("AnalyticsEventsQueue", () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it("enriches and sends generic events as admin batches", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post, () => new Date("2026-04-24T12:00:06.000Z"));
        queue.setEnabled(true);

        queue.enqueueEvent(
            {
                eventName: "user.connected",
                source: "pusher",
                clientEventTimeMs: Date.parse("2026-04-24T12:00:05.000Z"),
                eventId: "event-id",
                properties: {
                    connectionId: "connection-id",
                    connectedAt: "2026-04-24T12:00:05.000Z",
                },
            },
            socketData(),
        );
        await queue.flush();

        expect(post).toHaveBeenCalledWith(
            "http://admin.test/api/analytics/events-batch",
            expect.objectContaining({
                schemaVersion: 1,
                sentAt: "2026-04-24T12:00:06.000Z",
                pusherInstanceId: "pusher-test",
                events: [
                    expect.objectContaining({
                        eventName: "user.connected",
                        source: "pusher",
                        clientEventTime: "2026-04-24T12:00:05.000Z",
                        pusherReceivedAt: "2026-04-24T12:00:06.000Z",
                        eventId: "event-id",
                        userUuid: "reporter-uuid",
                        userId: 123,
                        spaceUserId: "reporter-space-user",
                        clientIp: "203.0.113.10",
                        world: "world",
                        roomId: "https://play.test/@/team/world/room",
                        tabId: "tab-id",
                        tags: ["admin", "member"],
                        properties: {
                            connectionId: "connection-id",
                            connectedAt: "2026-04-24T12:00:05.000Z",
                        },
                    }),
                ],
            }),
            {
                headers: {
                    Authorization: "Bearer analytics-key",
                    "Content-Type": "application/json",
                },
                timeout: 500,
            },
        );
        expect(queue.getStats()).toMatchObject({
            queueSize: 0,
            batchesSent: 1,
            eventsSent: 1,
        });
    });

    it("does not queue events for worlds with admin analytics disabled", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);

        queue.enqueueEvent(
            {
                eventName: "user.connected",
                source: "pusher",
                clientEventTimeMs: Date.parse("2026-04-24T12:00:05.000Z"),
                eventId: "event-id",
                properties: {
                    connectionId: "connection-id",
                    connectedAt: "2026-04-24T12:00:05.000Z",
                },
            },
            socketData({ analyticsEventsEnabled: false }),
        );
        await queue.flush();

        expect(post).not.toHaveBeenCalled();
        expect(queue.getStats()).toMatchObject({
            droppedByWorldSettings: 1,
            eventsSent: 0,
            queueSize: 0,
        });
    });

    it("drops the oldest events when the queue is full", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue({ ...baseConfig, maxQueueSize: 2 }, post);
        queue.setEnabled(true);

        queue.enqueueEvent(event("event-1"), socketData());
        queue.enqueueEvent(event("event-2"), socketData());
        queue.enqueueEvent(event("event-3"), socketData());
        await queue.flush();

        const batch = post.mock.calls[0][1] as AnalyticsEventsBatch;
        expect(batch.events.map((queuedEvent) => queuedEvent.eventId)).toEqual(["event-2", "event-3"]);
        expect(queue.getStats()).toMatchObject({
            droppedOnOverflow: 1,
            eventsSent: 2,
        });
    });

    it("caps oversized properties on UTF-8 bytes rather than UTF-16 code units", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);

        // 5000 CJK characters: 5000 UTF-16 code units (under the 8 KiB cap when
        // measured with .length) but 15000 UTF-8 bytes (well over it).
        const multiByte = "世".repeat(5000);
        expect(multiByte.length).toBeLessThan(8 * 1024);
        expect(Buffer.byteLength(multiByte, "utf8")).toBeGreaterThan(8 * 1024);

        queue.enqueueEvent(event("oversized-multibyte", "user.connected", { blob: multiByte }), socketData());
        await queue.flush();

        expect(post).not.toHaveBeenCalled();
    });

    it("splits batches rejected by admin validation and drops only invalid events", async () => {
        const validationError = {
            isAxiosError: true,
            message: "Request failed with status code 422",
            response: {
                status: 422,
                data: {
                    errors: {
                        "events.1.properties": ["The events.1.properties field is required."],
                    },
                },
            },
        };
        const post = vi
            .fn()
            .mockRejectedValueOnce(validationError)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(validationError);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);

        queue.enqueueEvent(event("valid-event", "chat.message_sent"), socketData());
        queue.enqueueEvent(event("invalid-event", "room.changed"), socketData());
        await queue.flush();

        expect(post).toHaveBeenCalledTimes(3);
        expect((post.mock.calls[1][1] as AnalyticsEventsBatch).events).toHaveLength(1);
        expect((post.mock.calls[1][1] as AnalyticsEventsBatch).events[0].eventName).toBe("chat.message_sent");
        expect((post.mock.calls[2][1] as AnalyticsEventsBatch).events).toHaveLength(1);
        expect((post.mock.calls[2][1] as AnalyticsEventsBatch).events[0].eventName).toBe("room.changed");
        expect(queue.getStats()).toMatchObject({
            droppedInvalid: 1,
            eventsSent: 1,
            flushErrors: 0,
        });
    });

    it("accounts partial success when a non-validation error aborts the individual retry mid-loop", async () => {
        // After a 422 the queue retries events one-by-one. If event #1 succeeds and
        // event #2 keeps failing with 5xx, only event #2 must be counted against
        // droppedAfterSendFailure — the success of event #1 must NOT be discarded.
        // The singleton gets the same transient-retry policy as a batch, so the
        // 5xx has to be repeated until the attempts run out.
        const validationError = {
            isAxiosError: true,
            message: "Request failed with status code 422",
            response: { status: 422 },
        };
        const serverError = {
            isAxiosError: true,
            message: "Request failed with status code 500",
            response: { status: 500 },
        };
        const post = vi
            .fn()
            .mockRejectedValueOnce(validationError)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValue(serverError);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);

        queue.enqueueEvent(event("valid-event", "chat.message_sent"), socketData());
        queue.enqueueEvent(event("server-error-event", "room.changed"), socketData());
        vi.useFakeTimers();
        try {
            const flushing = queue.flush();
            await vi.runAllTimersAsync();
            await flushing;
        } finally {
            vi.useRealTimers();
        }

        // 1 batch + 1 singleton + 4 attempts on the failing singleton
        expect(post).toHaveBeenCalledTimes(6);
        expect(queue.getStats()).toMatchObject({
            droppedAfterSendFailure: 1,
            eventsSent: 1,
            batchesSent: 1,
            flushErrors: 1,
            droppedInvalid: 0,
        });
    });

    it("drain() flushes pending events when called while a flush is in flight", async () => {
        // drain() is the SIGTERM hook. If setInterval-driven flush() is still
        // resolving when shutdown starts, drain() must wait until that flush
        // finishes and then drive any remaining batches to the admin before
        // the process exits, instead of returning immediately and dropping them.
        let resolveInFlight: () => void = () => undefined;
        const inFlight = new Promise<void>((resolve) => {
            resolveInFlight = resolve;
        });
        const post = vi
            .fn()
            .mockImplementationOnce(async () => {
                await inFlight;
            })
            .mockResolvedValue(undefined);

        const queue = new AnalyticsEventsQueue({ ...baseConfig, maxBatchSize: 1 }, post);
        queue.setEnabled(true);

        queue.enqueueEvent(event("event-1", "user.connected"), socketData());
        queue.enqueueEvent(event("event-2", "user.disconnected"), socketData());

        // Kick off the first flush — it will hang on `inFlight` because the mock
        // is awaiting the gate. drain() is called while that flush is still in-flight.
        const ongoingFlush = queue.flush();
        const draining = queue.drain(5_000);

        // Let drain() spin a few times noticing isFlushing === true and the
        // queue length unchanged, then release the in-flight flush.
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 80);
        });
        resolveInFlight();
        await ongoingFlush;
        await draining;

        expect(post).toHaveBeenCalledTimes(2);
        expect(queue.getStats()).toMatchObject({
            batchesSent: 2,
            eventsSent: 2,
            droppedAfterSendFailure: 0,
        });
    });

    it("drain() waits for the only batch when it is already in flight", async () => {
        // flush() has spliced the batch out before awaiting the POST, so the queue
        // is empty while the request is pending. drain() must still wait for it.
        let resolveInFlight: () => void = () => undefined;
        const post = vi.fn().mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveInFlight = resolve;
                }),
        );
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);
        queue.enqueueEvent(event("event-1"), socketData());

        const ongoingFlush = queue.flush();
        let drained = false;
        const draining = queue.drain(5_000).then(() => {
            drained = true;
        });
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 80);
        });
        expect(drained).toBe(false);

        resolveInFlight();
        await ongoingFlush;
        await draining;
        expect(queue.getStats()).toMatchObject({ batchesSent: 1, eventsSent: 1 });
    });

    it("drops video quality samples whose metrics are not finite", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);

        queue.enqueueVideoQualityReport({ samples: [videoQualitySample({ fps: Number.NaN })] }, socketData());
        queue.enqueueVideoQualityReport(
            { samples: [videoQualitySample({ bandwidthBytesPerSecond: Number.POSITIVE_INFINITY })] },
            socketData(),
        );
        await queue.flush();

        expect(post).not.toHaveBeenCalled();
        expect(queue.getStats()).toMatchObject({ droppedInvalid: 2 });
    });

    it("converts video quality reports to generic media events", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post, () => new Date("2026-04-24T12:00:06.000Z"));
        queue.setEnabled(true);

        queue.enqueueVideoQualityReport({ samples: [videoQualitySample()] }, socketData());
        await queue.flush();

        const batch = post.mock.calls[0][1] as AnalyticsEventsBatch;
        expect(batch.events[0]).toMatchObject({
            eventName: "media.video_quality.sample",
            // "pusher": the sample is synthesized here, never reported by a socket.
            // The admin drops this name unless the source says so.
            source: "pusher",
            clientEventTime: "2026-04-24T12:00:05.000Z",
            properties: expect.objectContaining({
                streamId: "stream-id",
                remoteUserUuid: "remote-uuid",
                remoteSpaceUserId: "remote-space-user",
                spaceName: "space",
                streamCategory: "video",
                transportType: "P2P",
                fps: 24.5,
                jitter: 0.07,
            }),
        });
    });

    it("builds the id of a video quality sample from the user, the stream, the sequence and the client time", async () => {
        const ids = await videoQualityEventIds([videoQualitySample()]);

        // 1777032005000 is 2026-04-24T12:00:05.000Z, the client time of the fixture.
        expect(ids).toEqual(["reporter-uuid:stream-id:1:1777032005000"]);
    });

    it("gives the samples of two publications of one stream different ids", async () => {
        // A republish keeps the stream id and restarts the count at 0: the new
        // publication reaches the same sequence number as the old one did.
        const camera = {
            streamId: "PA_local:video:outbound",
            direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_OUTBOUND,
            transportType: VideoQualityTransportType.VIDEO_QUALITY_TRANSPORT_TYPE_LIVEKIT,
            sampleSeq: 0,
        };

        const [firstPublication, secondPublication] = await videoQualityEventIds([
            videoQualitySample({ ...camera, clientEventTimeMs: Date.parse("2026-04-24T12:00:05.000Z") }),
            videoQualitySample({ ...camera, clientEventTimeMs: Date.parse("2026-04-24T12:09:05.000Z") }),
        ]);

        expect(secondPublication).not.toBe(firstPublication);
    });

    it("gives the samples of one user's two tabs different ids when they are taken at different times", async () => {
        // An inbound LiveKit stream is named by the remote sid and its type only, so both
        // tabs report the same user, stream and sequence from their first sample. The id
        // has no tab part: the client time is what tells the two tabs apart.
        const inbound = { streamId: "PA_remote:video", sampleSeq: 0 };

        const [firstTab, secondTab] = await videoQualityEventIds([
            videoQualitySample({ ...inbound, clientEventTimeMs: Date.parse("2026-04-24T12:00:05.000Z") }),
            videoQualitySample({ ...inbound, clientEventTimeMs: Date.parse("2026-04-24T12:00:05.700Z") }),
        ]);

        expect(secondTab).not.toBe(firstTab);
    });

    it("keeps the id of a sample that is sent again", async () => {
        const [first] = await videoQualityEventIds([videoQualitySample()]);
        const [replay] = await videoQualityEventIds([videoQualitySample()]);

        expect(replay).toBe(first);
    });

    describe("when the readable id does not fit the admin's limit", () => {
        // A P2P stream id is "<connection id>:<peer's space user id>:<type>:outbound", and
        // a space user id is "<room URL>_<user id>": the room URL is in the id.
        const roomUrl = "https://play.test/@/team/world/".padEnd(150, "x");
        const userUuid = "3f2b8c1e-6d4a-4f0e-9b7a-1c5d8e2a9f40";
        const screenShare = () =>
            videoQualitySample({
                streamId: `0c6f2d9e-5b1a-4e7c-8a3d-91b4f7e2c5a8:${roomUrl}_42:screenSharing:outbound`,
                streamCategory: VideoQualityStreamCategory.VIDEO_QUALITY_STREAM_CATEGORY_SCREEN_SHARING,
                direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_OUTBOUND,
                sampleSeq: 17,
            });

        it("sends the SHA-256 of the readable id for a P2P screen share under a 150-character room URL", async () => {
            // The readable id of this sample is 267 characters, over the 255 of the limit.
            // The digest is that text through `shasum -a 256`, not through the code under test.
            const [id] = await videoQualityEventIds([screenShare()], socketData({ userUuid }));

            expect(id).toBe("2da1f8d63b2d01753b261bb69d0dee61f5b5caef5fe1c6a6a016c3f3f0f3fa96");
        });

        it("keeps that id when the sample is sent again", async () => {
            const [id] = await videoQualityEventIds([screenShare()], socketData({ userUuid }));
            const [replay] = await videoQualityEventIds([screenShare()], socketData({ userUuid }));

            expect(replay).toBe(id);
        });

        it("gives a screen share that starts again a different id", async () => {
            // Same user and stream id, the count back at 0, a later client time.
            const [first, second] = await videoQualityEventIds(
                [
                    screenShare(),
                    {
                        ...screenShare(),
                        sampleSeq: 0,
                        clientEventTimeMs: Date.parse("2026-04-24T12:09:05.000Z"),
                    },
                ],
                socketData({ userUuid }),
            );

            expect(second).toMatch(/^[0-9a-f]{64}$/);
            expect(second).not.toBe(first);
        });

        it("leaves an id of exactly 255 characters readable", async () => {
            // "reporter-uuid" (13), "1" and a 13-digit time, with 3 separators, leave 225 for the stream id.
            const [id] = await videoQualityEventIds([videoQualitySample({ streamId: "s".repeat(225) })]);

            expect(id).toHaveLength(MAX_EVENT_ID_LENGTH);
            expect(id).toMatch(/^reporter-uuid:s{225}:1:1777032005000$/);
        });

        it("hashes an id of 256 characters", async () => {
            const [id] = await videoQualityEventIds([videoQualitySample({ streamId: "s".repeat(226) })]);

            expect(id).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    it("names the LiveKit transport by topology, as the catalog does", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);

        queue.enqueueVideoQualityReport(
            {
                samples: [
                    videoQualitySample({
                        transportType: VideoQualityTransportType.VIDEO_QUALITY_TRANSPORT_TYPE_LIVEKIT,
                    }),
                ],
            },
            socketData(),
        );
        await queue.flush();

        const batch = post.mock.calls[0][1] as AnalyticsEventsBatch;
        expect(batch.events[0].properties).toMatchObject({ transportType: "SFU" });
    });

    it("keeps the encoder health on outbound samples and only there", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);

        queue.enqueueVideoQualityReport(
            {
                samples: [
                    videoQualitySample({
                        direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_OUTBOUND,
                        transportType: VideoQualityTransportType.VIDEO_QUALITY_TRANSPORT_TYPE_LIVEKIT,
                        // Published to the room, not to one participant.
                        remoteSpaceUserId: "",
                        qualityLimitationReason: VideoQualityLimitationReason.VIDEO_QUALITY_LIMITATION_REASON_CPU,
                        encoderImplementation: "libaom",
                        livekitRegion: "ojohannesburg1a",
                    }),
                    videoQualitySample({
                        qualityLimitationReason: VideoQualityLimitationReason.VIDEO_QUALITY_LIMITATION_REASON_CPU,
                        encoderImplementation: "libaom",
                        // A self-hosted LiveKit server names no region
                        livekitRegion: "",
                    }),
                ],
            },
            socketData(),
        );
        await queue.flush();

        const batch = post.mock.calls[0][1] as AnalyticsEventsBatch;
        expect(batch.events[0].properties).toMatchObject({
            direction: "outbound",
            remoteSpaceUserId: null,
            qualityLimitationReason: "cpu",
            encoderImplementation: "libaom",
            livekitRegion: "ojohannesburg1a",
        });
        // An inbound sample measures a stream someone else encodes, so the browser
        // reports nothing about our encoder: a client claiming otherwise is ignored.
        expect(batch.events[1].properties).toMatchObject({
            direction: "inbound",
            qualityLimitationReason: null,
            encoderImplementation: null,
            livekitRegion: null,
        });
    });

    it("keeps the playback counters of inbound samples, all of them or none", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);
        const playback = {
            windowSeconds: 5.2,
            framesDecoded: 150,
            framesDropped: 1,
            freezeCount: 2,
            freezeSeconds: 0.9,
            pauseCount: 0,
            pauseSeconds: 0,
            interFrameDelaySumSeconds: 5.1,
            interFrameDelaySquaredSumSeconds: 0.2,
            decodeSeconds: 0.3,
        };

        queue.enqueueVideoQualityReport(
            {
                samples: [
                    videoQualitySample(playback),
                    // A counter the browser does not expose stays null, without hiding the others
                    videoQualitySample({ ...playback, freezeCount: undefined, freezeSeconds: Number.NaN }),
                    // A counter is worthless without a plausible window
                    videoQualitySample({ ...playback, windowSeconds: 3_600 }),
                    // Our own encoder has no playback
                    videoQualitySample({
                        ...playback,
                        direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_OUTBOUND,
                    }),
                ],
            },
            socketData(),
        );
        await queue.flush();

        const events = (post.mock.calls[0][1] as AnalyticsEventsBatch).events;
        expect(events[0].properties).toMatchObject(playback);
        expect(events[1].properties).toMatchObject({ framesDecoded: 150, freezeCount: null, freezeSeconds: null });
        expect(events[2].properties).toMatchObject({ windowSeconds: null, framesDecoded: null, decodeSeconds: null });
        expect(events[3].properties).toMatchObject({ windowSeconds: null, framesDecoded: null, decodeSeconds: null });
    });

    it("keeps the capture and encoder load of outbound samples only, dropping implausible values", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);
        const encoderLoad = {
            captureFps: 24,
            captureTargetFps: 30,
            captureWidth: 1280,
            captureHeight: 720,
            encodeMsPerFrame: 12.5,
            cpuLimitedRatio: 0.4,
            bandwidthLimitedRatio: 0,
        };
        const outbound = {
            direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_OUTBOUND,
            remoteSpaceUserId: "",
        };
        const low = VideoQualityLevel.VIDEO_QUALITY_LEVEL_LOW;

        queue.enqueueVideoQualityReport(
            {
                samples: [
                    videoQualitySample({ ...outbound, ...encoderLoad, qualitySetting: low }),
                    videoQualitySample({
                        ...outbound,
                        ...encoderLoad,
                        cpuLimitedRatio: 1.5,
                        captureFps: Number.NaN,
                        captureWidth: 100_000,
                        qualitySetting: VideoQualityLevel.UNRECOGNIZED,
                    }),
                    // A stream we receive tells nothing about our encoder
                    videoQualitySample({ ...encoderLoad, qualitySetting: low }),
                ],
            },
            socketData(),
        );
        await queue.flush();

        const events = (post.mock.calls[0][1] as AnalyticsEventsBatch).events;
        expect(events[0].properties).toMatchObject({ ...encoderLoad, qualitySetting: "low" });
        expect(events[1].properties).toMatchObject({
            captureFps: null,
            cpuLimitedRatio: null,
            encodeMsPerFrame: 12.5,
            captureWidth: null,
            captureHeight: 720,
            qualitySetting: null,
        });
        expect(events[2].properties).toMatchObject({
            captureFps: null,
            encodeMsPerFrame: null,
            cpuLimitedRatio: null,
            captureWidth: null,
            captureHeight: null,
            qualitySetting: null,
        });
    });

    it("keeps the network of each direction where it belongs", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post);
        queue.setEnabled(true);
        const network = {
            windowSeconds: 5,
            packetsReceived: 400,
            packetsLost: 4,
            roundTripTimeMs: 120,
            uploadRoundTripTimeMs: 180,
            uploadLossRatio: 0.04,
            availableOutgoingBitrate: 1_200_000,
        };

        queue.enqueueVideoQualityReport(
            {
                samples: [
                    videoQualitySample(network),
                    videoQualitySample({
                        ...network,
                        direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_OUTBOUND,
                        remoteSpaceUserId: "",
                    }),
                    // Packets are counted over the window: without one, they mean nothing
                    videoQualitySample({ ...network, windowSeconds: undefined, roundTripTimeMs: 90_000 }),
                ],
            },
            socketData(),
        );
        await queue.flush();

        const events = (post.mock.calls[0][1] as AnalyticsEventsBatch).events;
        expect(events[0].properties).toMatchObject({
            packetsReceived: 400,
            packetsLost: 4,
            roundTripTimeMs: 120,
            uploadRoundTripTimeMs: null,
            uploadLossRatio: null,
            availableOutgoingBitrate: null,
        });
        expect(events[1].properties).toMatchObject({
            packetsReceived: null,
            roundTripTimeMs: null,
            uploadRoundTripTimeMs: 180,
            uploadLossRatio: 0.04,
            availableOutgoingBitrate: 1_200_000,
        });
        expect(events[2].properties).toMatchObject({ packetsReceived: null, packetsLost: null, roundTripTimeMs: null });
    });

    it("drops video quality samples for a space the socket has not joined", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post, () => new Date("2026-04-24T12:00:06.000Z"));
        queue.setEnabled(true);

        // socketData() has joined only "world.space"; attribute a sample to another space.
        queue.enqueueVideoQualityReport({ samples: [videoQualitySample({ spaceName: "other-space" })] }, socketData());
        await queue.flush();

        expect(post).not.toHaveBeenCalled();
        expect(queue.getStats().droppedInvalid).toBe(1);
    });

    it("drops video quality samples from a socket that has joined no space at all", async () => {
        const post = vi.fn().mockResolvedValue(undefined);
        const queue = new AnalyticsEventsQueue(baseConfig, post, () => new Date("2026-04-24T12:00:06.000Z"));
        queue.setEnabled(true);

        // The membership check used to be skipped when the socket had joined nothing,
        // which made it opt-out: connect, never join a space, and spaceName /
        // remoteUserUuid / remoteSpaceUserId were yours to pick.
        queue.enqueueVideoQualityReport(
            { samples: [videoQualitySample({ spaceName: "any-space-i-like" })] },
            socketData({ spaces: new Set<string>() }),
        );
        await queue.flush();

        expect(post).not.toHaveBeenCalled();
        expect(queue.getStats().droppedInvalid).toBe(1);
    });
});

/**
 * A fixture, not a catalog-shaped event: the queue does not validate what it is
 * handed (the handler does, upstream), so these tests use whatever name and an
 * empty payload — hence the assertion.
 */
function event(
    eventId: string,
    eventName: AnalyticsEventName = "user.connected",
    properties: Record<string, unknown> = {},
): AnalyticsEventInput {
    return {
        eventName,
        source: "pusher",
        clientEventTimeMs: Date.parse("2026-04-24T12:00:05.000Z"),
        eventId,
        properties,
    } as AnalyticsEventInput;
}

function socketData(overrides: Partial<SocketData> & { analyticsEventsEnabled?: boolean } = {}): SocketData {
    return {
        userUuid: "reporter-uuid",
        userId: 123,
        spaceUserId: "reporter-space-user",
        ipAddress: "203.0.113.10",
        roomId: "https://play.test/@/team/world/room",
        world: "world",
        spaces: new Set(["world.space"]),
        tabId: "tab-id",
        tags: ["admin", "member"],
        analyticsEventsEnabled: true,
        ...overrides,
    } as SocketData;
}

/**
 * The ids a pusher sends for these samples, in order. Each call is a queue of its own,
 * so two calls are two pushers (or one pusher after a restart) sending a sample again.
 */
async function videoQualityEventIds(
    samples: VideoQualitySampleMessage[],
    socket: SocketData = socketData(),
): Promise<string[]> {
    const post = vi.fn().mockResolvedValue(undefined);
    const queue = new AnalyticsEventsQueue(baseConfig, post);
    queue.setEnabled(true);
    queue.enqueueVideoQualityReport({ samples }, socket);
    await queue.flush();

    const batch = post.mock.calls[0][1] as AnalyticsEventsBatch;
    return batch.events.map((queuedEvent) => queuedEvent.eventId);
}

function videoQualitySample(overrides: Partial<VideoQualitySampleMessage> = {}): VideoQualitySampleMessage {
    return {
        clientEventTimeMs: Date.parse("2026-04-24T12:00:05.000Z"),
        sampleSeq: 1,
        streamId: "stream-id",
        connectionId: "connection-id",
        sessionId: "session-id",
        remoteUserUuid: "remote-uuid",
        remoteSpaceUserId: "remote-space-user",
        spaceName: "space",
        streamCategory: VideoQualityStreamCategory.VIDEO_QUALITY_STREAM_CATEGORY_VIDEO,
        transportType: VideoQualityTransportType.VIDEO_QUALITY_TRANSPORT_TYPE_P2P,
        direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_INBOUND,
        relay: true,
        relayProtocol: VideoQualityRelayProtocol.VIDEO_QUALITY_RELAY_PROTOCOL_UDP,
        livekitServerUrl: undefined,
        fps: 24.5,
        fpsStdDev: 3.5,
        jitter: 0.07,
        bandwidthBytesPerSecond: 180000,
        frameWidth: 1280,
        frameHeight: 720,
        mimeType: "video/VP8",
        ...overrides,
    };
}
