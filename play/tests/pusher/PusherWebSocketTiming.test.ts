import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction, PusherToFrontWebSocketMessage, type SubMessage } from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { PusherWebSocket, type BatchTiming, type RawSocket } from "../../src/pusher/services/PusherWebSocket";

/*
 * When a socket's batch is written (PUSHER_BATCH_INTERVAL_MS, PUSHER_BATCH_EARLY_FLUSH_MS). The interval is the longest
 * a move waits in the pusher and, as 1000 / interval, the most frames a second a socket is written; the early flush
 * sends a stop, a leave or a small batch sooner. It must not multiply the frames of a socket that is written to all
 * the time: two frames of a socket are never closer than half an interval, so at most 2x the frames without it, whatever
 * the number of stops and leaves (the tests of "a socket that walks and stops all the time" below).
 *
 * How the stops test was seen failing: with the floor removed (the pulled-forward batch due at now + earlyFlushMs, as
 * before), the socket below was written 30 frames a second with 30 evenly spaced stops a second and 100 with 100, against
 * 10 without the early flush (the review that found it measured 15, 30 and 68 with 10, 30 and 100 stops at random
 * instants); the test fails at 30 and at 100 stops a second, and "holds a stop" fails with a frame at 1_000_025.
 */

function move(userId: number, moving = true): SubMessage {
    return {
        message: {
            $case: "userMovedMessage",
            userMovedMessage: {
                userId,
                position: { x: userId, y: 0, direction: PositionMessage_Direction.RIGHT, moving },
            },
        },
    };
}

function leave(userId: number): SubMessage {
    return { message: { $case: "userLeftMessage", userLeftMessage: { userId } } };
}

function socketWith(timing: BatchTiming | undefined) {
    const writes: number[] = [];
    const frames: Uint8Array[] = [];
    const raw = {
        send: vi.fn((payload: Uint8Array) => {
            writes.push(Date.now());
            frames.push(payload);
            return 1;
        }),
        ping: vi.fn().mockReturnValue(1),
        end: vi.fn(),
        getBufferedAmount: vi.fn().mockReturnValue(0),
        getUserData: vi.fn().mockReturnValue({}),
    } as unknown as RawSocket;
    return {
        socket: timing === undefined ? new PusherWebSocket(raw) : new PusherWebSocket(raw, timing),
        writes,
        /** The users of the moves the socket was sent, in the order of the frames. */
        sentUsers: () =>
            frames.flatMap((frame) => {
                const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
                return message?.$case === "batchMessage"
                    ? message.batchMessage.payload.map((sub) =>
                          sub.message?.$case === "userMovedMessage" ? sub.message.userMovedMessage.userId : -1,
                      )
                    : [];
            }),
    };
}

describe("PusherWebSocket batch timing", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("writes 100 ms after the first message when it is given no timing", () => {
        const { socket, writes } = socketWith(undefined);

        socket.emitInBatch(move(1));
        vi.advanceTimersByTime(99);
        expect(writes).toHaveLength(0);
        vi.advanceTimersByTime(1);

        expect(writes).toEqual([1_000_100]);
    });

    it("writes when its interval has passed, and a socket written to all the time gets 1000 / interval frames a second", () => {
        const { socket, writes } = socketWith({ intervalMs: 25, earlyFlushMs: 0 });

        for (let ms = 0; ms < 1000; ms++) {
            socket.emitInBatch(move(1 + (ms % 7)));
            vi.advanceTimersByTime(1);
        }
        vi.advanceTimersByTime(25);

        // A window opens at a message and closes 25 ms later; the next message opens the next one: 1000 / 26.
        expect(writes.length).toBeGreaterThanOrEqual(38);
        expect(writes.length).toBeLessThanOrEqual(40);
        expect(writes.every((at, index) => index === 0 || at - writes[index - 1] >= 25)).toBe(true);
    });

    it("never writes a quiet socket's first batch later than its interval, whatever the early flush it was given", () => {
        // An early flush of 300 ms against an interval of 25 ms: clamped to 25, so the 'early' write is not a late one.
        const { socket, writes } = socketWith({ intervalMs: 25, earlyFlushMs: 300 });

        socket.emitInBatch(move(1));
        vi.advanceTimersByTime(25);

        expect(writes).toEqual([1_000_025]);
    });

    describe("with an early flush of 5 ms and an interval of 100 ms", () => {
        const timing = { intervalMs: 100, earlyFlushMs: 5 };

        it("writes a small batch of a socket that was quiet for a whole interval after 5 ms", () => {
            const { socket, writes } = socketWith(timing);

            socket.emitInBatch(move(1));
            vi.advanceTimersByTime(5);
            expect(writes).toEqual([1_000_005]);

            // Quiet for 100 ms again, then another small batch.
            vi.advanceTimersByTime(100);
            socket.emitInBatch(move(2));
            vi.advanceTimersByTime(5);
            expect(writes).toHaveLength(2);
        });

        it("keeps a socket that was written to within the last interval to its interval", () => {
            const { socket, writes } = socketWith(timing);
            socket.emitInBatch(move(1));
            vi.advanceTimersByTime(5);
            writes.length = 0;

            vi.advanceTimersByTime(20);
            socket.emitInBatch(move(2));
            vi.advanceTimersByTime(99);
            expect(writes).toHaveLength(0);
            vi.advanceTimersByTime(1);

            // Opened at 1_000_025, due 100 ms later.
            expect(writes).toEqual([1_000_125]);
        });

        it("pulls a waiting batch forward to 5 ms from a stop, and from a leave, but not from a walking move", () => {
            const { socket, writes } = socketWith(timing);
            socket.emitInBatch(move(1));
            vi.advanceTimersByTime(5);
            writes.length = 0;

            vi.advanceTimersByTime(10);
            socket.emitInBatch(move(2)); // opens a batch due at +100
            vi.advanceTimersByTime(30);
            socket.emitInBatch(move(3)); // walking: the batch stays due
            vi.advanceTimersByTime(30);
            socket.emitInBatch(move(4, false)); // a stop: due 5 ms from now
            vi.advanceTimersByTime(4);
            expect(writes).toHaveLength(0);
            vi.advanceTimersByTime(1);
            expect(writes).toEqual([1_000_080]);

            // The same for a leave, when the last frame is more than half an interval behind.
            vi.advanceTimersByTime(10);
            socket.emitInBatch(move(5));
            vi.advanceTimersByTime(60);
            socket.emitInBatch(leave(6));
            vi.advanceTimersByTime(5);
            expect(writes).toEqual([1_000_080, 1_000_155]);
        });

        it("holds a stop that comes soon after a frame until half an interval has passed since that frame", () => {
            const { socket, writes } = socketWith(timing);
            socket.emitInBatch(move(1));
            vi.advanceTimersByTime(5);
            writes.length = 0; // the last frame is at 1_000_005

            vi.advanceTimersByTime(10);
            socket.emitInBatch(move(2)); // opens a batch at 1_000_015, due at 1_000_115
            vi.advanceTimersByTime(5);
            socket.emitInBatch(leave(3)); // at 1_000_020: 5 ms later would be 15 ms after the last frame
            vi.advanceTimersByTime(34);
            expect(writes).toHaveLength(0);
            vi.advanceTimersByTime(1);

            // 1_000_005 + 50: the floor between two frames, and well before the 100 ms of the interval.
            expect(writes).toEqual([1_000_055]);
        });

        it("does not write more often than a socket without it while walking moves keep coming", () => {
            const early = socketWith(timing);
            const plain = socketWith({ intervalMs: 100, earlyFlushMs: 0 });

            for (let ms = 0; ms < 2000; ms++) {
                early.socket.emitInBatch(move(1 + (ms % 7)));
                plain.socket.emitInBatch(move(1 + (ms % 7)));
                vi.advanceTimersByTime(1);
            }
            vi.advanceTimersByTime(100);

            // The first batch of the early socket is small and goes at 5 ms; after it, one frame per interval.
            expect(early.writes.length).toBeLessThanOrEqual(plain.writes.length + 1);
        });

        describe("a socket that is sent 1000 moves a second, a number of them stops", () => {
            /** Frames a second written to a socket for 10 seconds, with `stopsPerSecond` of the 1000 moves a stop. */
            function framesPerSecond(
                timingOfSocket: BatchTiming,
                stopsPerSecond: number,
            ): { rate: number; longestStopWaitMs: number } {
                const { socket, writes } = socketWith(timingOfSocket);
                const stopAt: number[] = [];
                const start = Date.now();
                for (let ms = 0; ms < 10_000; ms++) {
                    // Stops evenly spread: the one at ms is a stop when it crosses a multiple of 1000 / stopsPerSecond.
                    const isStop =
                        stopsPerSecond > 0 &&
                        Math.floor((ms * stopsPerSecond) / 1000) !== Math.floor(((ms - 1) * stopsPerSecond) / 1000);
                    if (isStop) {
                        stopAt.push(Date.now());
                    }
                    socket.emitInBatch(move(1 + (ms % 7), !isStop));
                    vi.advanceTimersByTime(1);
                }
                vi.advanceTimersByTime(200);
                const longestStopWaitMs = Math.max(
                    0,
                    ...stopAt.map((at) => (writes.find((written) => written >= at) ?? at) - at),
                );
                return { rate: writes.filter((at) => at < start + 10_000).length / 10, longestStopWaitMs };
            }

            it.each([0, 10, 30, 100])("is written at most 20 frames a second with %i stops a second", (stops) => {
                const { rate, longestStopWaitMs } = framesPerSecond(timing, stops);
                const baseline = framesPerSecond({ intervalMs: 100, earlyFlushMs: 0 }, stops).rate;

                // 10 frames a second without the early flush, whatever the stops: a window opens at a message and closes
                // 100 ms (plus the 1 ms to the next message) later.
                expect(baseline).toBeGreaterThanOrEqual(9);
                expect(baseline).toBeLessThanOrEqual(10);
                // Half an interval between two frames: 20 a second at the most, 2x the 10 a second of the interval.
                expect(rate).toBeLessThanOrEqual(20);
                // And a stop is not held for the whole interval: never more than half an interval.
                if (stops > 0) {
                    expect(longestStopWaitMs).toBeLessThanOrEqual(50);
                }
            });

            it("is written about twice as often with a stop a few milliseconds apart than with none, and no more", () => {
                const dense = framesPerSecond(timing, 100).rate;
                const none = framesPerSecond(timing, 0).rate;

                // MEASURED: 20.0 and 10.0 on a virtual clock.
                expect(none).toBeLessThanOrEqual(10.1);
                expect(dense).toBeGreaterThanOrEqual(19);
                expect(dense).toBeLessThanOrEqual(20);
            });
        });

        it("still writes every message, in the order it was emitted", () => {
            const { socket, writes, sentUsers } = socketWith(timing);

            for (let userId = 1; userId <= 30; userId++) {
                socket.emitInBatch(move(userId, userId % 10 !== 0));
                vi.advanceTimersByTime(7);
            }
            vi.advanceTimersByTime(100);

            expect(writes.length).toBeGreaterThan(1);
            expect(sentUsers()).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
        });
    });
});
