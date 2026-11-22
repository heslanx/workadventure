import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { DEFAULT_BATCH_TIMING } from "../../src/pusher/services/PusherWebSocket";
import { runFanOut } from "./fanout/FanOutBench";

/*
 * THE MOVE DELIVERY BUDGET: p95 under 50 ms (owner's mandate, 2026-11-21), from the walker's client sending a move to
 * the frame that carries it being written to an observer's socket, at the pusher.
 *
 * One move, hop by hop. A hop that is a window is an upper bound, and the move can arrive anywhere inside it, so a
 * window adds half its length to the median and about 95% of it to the 95th percentile.
 *
 *   hop                                 where                                              worst case   typical (p50)
 *   1 client sends                      play/src/front/Enum/EnvironmentVariable.ts:43      0 (the move is sent when made;
 *                                        POSITION_DELAY 200 ms is the gap between moves, not a wait of one move)
 *   2 network, client to pusher         not in this repo                                   not measured
 *   3 pusher intake and rate limit      play/src/pusher/services/SocketManager.ts:767      1 token a move, no wait
 *                                        and :153-154 (10 a second, burst 5)               (MoveRateLimiter.ts)
 *   4 back handling                     back/src/Model/GameRoom.ts:426 updatePosition       microseconds (2-9 us per move,
 *                                                                                           DERIVED, a spatial-hash
 *                                                                                           estimate in
 *                                                                                           .local/konclui/engine-1000-plan.md:24,
 *                                                                                           not an end-to-end measure)
 *   4b pusher to back stream write,     not read for this budget                           not measured
 *      and the back's gRPC decode        (between hops 3 and 4)
 *   5 back batch per pusher stream      back/src/Services/SocketManager.ts:108             50 ms     25 ms
 *                                        (ZONE_MESSAGES_BATCH_INTERVAL_MS, env, default 50)
 *   6 pusher batch per socket           play/src/pusher/services/PusherWebSocket.ts:33     100 ms    50-100 ms
 *                                        (PUSHER_BATCH_INTERVAL_MS, env, default 100)       (the timers are 50 ms apart
 *                                                                                           on the back's, see below)
 *   7 socket write                      PusherWebSocket.ts:428 sendStoredPayload           native send: microseconds a
 *                                                                                           frame, but one per frame
 *   6b the flush herd (service time)    PusherWebSocket.ts flushBatch, 1000 timers due       JS 4-21 ms p50, 58-99 ms max at
 *                                        at the same instant (every socket gets the same    50/100, budget off, N=1000
 *                                        back burst, so all their windows close together)   (MEASURED 2026-11-22, host at load 5
 *                                                                                           to 6 on 10 cores, 20% to 100% of the
 *                                                                                           users walking; 4 to 5 times higher at
 *                                                                                           load 27 to 48); native send DERIVED,
 *                                                                                           21 us a frame: about 21 ms for 1000 frames
 *   8 network, pusher to observer       not in this repo                                   not measured
 *
 * The two windows alone (hops 5 and 6) fit in 50 ms only at 10 ms and 40 ms, and only in virtual time, where a flush
 * takes no time. The sockets of a dense room are flushed one after the other, and the last of 1000 is written after the
 * 999 before it: with 21 us of native `send` a frame that is about 21 ms of herd, so the frame at position i of F is
 * late by i / F of the herd's service time, and the p95 of the whole is above 50 ms. What the last test below asserts is
 * independent of the speed of the host: the native part of that wait alone, (place in the herd + 1) frames of 21 us
 * (the bench's `sendToWriteWithNativeMs`, DERIVED from the counts of the virtual run), puts the p95 about 12.5 ms above the
 * windows' 47 (MEASURED twice: 59.5 and 59.5, the same both times, a count and not a time) and so above 50. The JS of the
 * herd comes on top of it and is reported (`sendToWriteWithServiceMs`), not asserted: it depends on the host. The valid proof of the 50 ms is the move latency
 * probe of the load host plus the event-loop lag of the pusher (p99), not a number from this file.
 *
 * Hops 5 and 6 are 150 ms of the budget in the worst case and 144 at p95 (the first test below): the budget cannot
 * be met with the defaults, whatever the rest costs. 50 ms leaves room for the two windows only if their sum is about
 * 45 ms, and then not for the herd: the back's window is cheap to shorten (per pusher stream, not per user), the pusher's costs a frame a socket
 * per window. The tests below pin what each choice measures in the in-process bench (virtual time, so the numbers are
 * exact and do not depend on the host): the latency added by hops 5 and 6, and the frames each socket is written.
 * Hops 2 and 8 come on top and are for the load host.
 *
 * What a frame costs is the cost of the trade. The profile of the pusher at 1000 bots (docs/PERFORMANCE.md, "Pusher CPU
 * at 1000") puts the native `send` at 25.1% of the busy main thread, at 85% of a core. DERIVED, assuming every socket
 * was written once per 100 ms window (10000 frames a second): about 21 us a frame. At that price 25000 frames a second
 * cost 0.5 of a core in `send` alone, 33500 cost 0.7. Whether that holds is the first thing to measure on the load
 * host (frames a second is `workadventure_pusher_...` per socket, and `perf` or the profile for `send`).
 */

const WINDOW_SECONDS = 4;
// 300 sockets, 20% walking at the browser rate: enough for a frame every window on every socket. The latency of a
// window does not depend on the size of the room, and the frames of a socket are the same at 1000.
const ROOM = { sockets: 300, movingFraction: 0.2, movesPerSecond: 5, windowSeconds: WINDOW_SECONDS };

function framesPerSocketPerSecond(result: { framesPerSecond: number }): number {
    return result.framesPerSecond / ROOM.sockets;
}

describe("the 50 ms move delivery budget, against the windows of the back and of the pusher", () => {
    it("is missed 3 times over with the defaults: 50 ms at the back and 100 ms at the pusher give a p95 of 144 ms", async () => {
        expect(DEFAULT_BATCH_TIMING.intervalMs).toBe(100);

        const result = await runFanOut({ ...ROOM, backBatchMs: 50, batchIntervalMs: 100 });

        expect(result.sendToWriteMs.p95).toBeGreaterThan(100);
        expect(result.sendToWriteMs.p95).toBeLessThanOrEqual(150);
        // The worst case is the sum of the two windows.
        expect(result.sendToWriteMs.max).toBeLessThanOrEqual(150);
        // And it costs 10 frames a second to each socket.
        expect(framesPerSocketPerSecond(result)).toBeCloseTo(10, 0);
    });

    it("has the two windows alone fit in 50 ms at 10 ms at the back and 40 ms at the pusher (p95 47 ms, virtual time, no service time) for 25 frames a second a socket, 2.5 times the defaults", async () => {
        const defaults = await runFanOut({ ...ROOM, backBatchMs: 50, batchIntervalMs: 100 });
        const tuned = await runFanOut({ ...ROOM, backBatchMs: 10, batchIntervalMs: 40 });

        expect(tuned.sendToWriteMs.p95).toBeLessThan(50);
        expect(tuned.sendToWriteMs.max).toBeLessThanOrEqual(50);
        expect(framesPerSocketPerSecond(tuned)).toBeCloseTo(25, 0);
        // The trade: a third of the latency for two and a half times the writes.
        expect(framesPerSocketPerSecond(tuned) / framesPerSocketPerSecond(defaults)).toBeGreaterThan(2.4);
        expect(framesPerSocketPerSecond(tuned) / framesPerSocketPerSecond(defaults)).toBeLessThan(2.6);
        expect(tuned.sendToWriteMs.p95).toBeLessThan(defaults.sendToWriteMs.p95 / 2.5);
    });

    it("costs one frame a socket per window, so the pusher window alone sets the writes: halving it doubles them", async () => {
        const at100 = await runFanOut({ ...ROOM, backBatchMs: 50, batchIntervalMs: 100 });
        const at50 = await runFanOut({ ...ROOM, backBatchMs: 50, batchIntervalMs: 50 });
        const at25 = await runFanOut({ ...ROOM, backBatchMs: 50, batchIntervalMs: 25 });

        expect(framesPerSocketPerSecond(at50) / framesPerSocketPerSecond(at100)).toBeCloseTo(2, 1);
        // A frame per socket per back burst is the most a socket can be sent when the pusher window is shorter than
        // the back's: bursts arrive every 50 ms.
        expect(framesPerSocketPerSecond(at25)).toBeCloseTo(20, 0);
        // The pusher alone cannot meet the budget: the back's 50 ms window is in the p95 whatever it does.
        expect(at25.sendToWriteMs.p95).toBeGreaterThan(50 * 0.9);
    });

    it("shortening only the back's window leaves the writes of the sockets where they were", async () => {
        const defaults = await runFanOut({ ...ROOM, backBatchMs: 50, batchIntervalMs: 100 });
        const back10 = await runFanOut({ ...ROOM, backBatchMs: 10, batchIntervalMs: 100 });

        // 10 ms bursts into 100 ms socket windows: the sockets are written as often as before, 10 frames a second.
        expect(framesPerSocketPerSecond(back10)).toBeCloseTo(framesPerSocketPerSecond(defaults), 0);
        // Half the sum of the windows, and the back pays 100 writes a second to the pusher instead of 20.
        expect(back10.sendToWriteMs.p95).toBeLessThan(defaults.sendToWriteMs.p95);
    });

    it("sends a stop, a leave or a small batch after 5 ms with the early flush, and nothing else sooner", async () => {
        const quiet = { sockets: 300, movingFraction: 1 / 300, movesPerSecond: 2, windowSeconds: 8 };
        const plain = await runFanOut({ ...quiet, backBatchMs: 10, batchIntervalMs: 100 });
        const early = await runFanOut({ ...quiet, backBatchMs: 10, batchIntervalMs: 100, earlyFlushMs: 5 });

        // One walker, a move every 500 ms: each socket is quiet for the whole interval before every move.
        expect(plain.sendToWriteMs.p50).toBeGreaterThan(40);
        expect(early.sendToWriteMs.p95).toBeLessThanOrEqual(15);
        // A frame per move at most, and the walker's moves are the only thing sent.
        expect(early.deliveriesPerSecond.total).toBe(plain.deliveriesPerSecond.total);
    });

    it("does not fit in 50 ms once the flush herd is counted: 1000 frames at 21 us of native send put the p95 about 12 ms above the windows' (DERIVED, counts only)", async () => {
        const herd = { sockets: 1000, movingFraction: 0.2, movesPerSecond: 5, windowSeconds: 3, warmUpSeconds: 2 };
        const tuned = await runFanOut({ ...herd, backBatchMs: 10, batchIntervalMs: 40, nativeSendMicrosPerFrame: 21 });

        // The windows alone: 47 ms at p95 at 300 sockets above, the same here (it does not depend on the room's size).
        expect(tuned.sendToWriteMs.p95).toBeLessThan(50);
        // The herd: every socket of the room closes its window at the same instant, and the frame at place i of the
        // herd is written after the i frames before it. Only the native send is charged (21 us a frame, DERIVED), and
        // it is a function of the counts of the virtual run, so the figures below are the same on any host: 59.5 for the
        // p95, 12.5 above the windows'. The JS of the herd adds to it on a real host and is not part of the assertion.
        expect(tuned.herds.perSecond).toBeGreaterThanOrEqual(20);
        expect(tuned.sendToWriteWithNativeMs.p95).toBeGreaterThan(tuned.sendToWriteMs.p95 + 10);
        expect(tuned.sendToWriteWithNativeMs.p95).toBeGreaterThan(50);
        // And the native send of the frames alone takes more than half a core (25000 frames a second at 21 us: 0.525).
        expect(tuned.flushNativeCores).toBeGreaterThan(0.5);
    }, 120_000);

    it("with a free native send the herd adds only its JS, so the same floor is the windows' own p95", async () => {
        const herd = { sockets: 300, movingFraction: 0.2, movesPerSecond: 5, windowSeconds: 3, warmUpSeconds: 2 };
        const free = await runFanOut({ ...herd, backBatchMs: 10, batchIntervalMs: 40, nativeSendMicrosPerFrame: 0 });

        // The instrument sees nothing where there is nothing to wait for: how this derived figure was shown to move.
        expect(free.sendToWriteWithNativeMs.p95).toBe(free.sendToWriteMs.p95);
        expect(free.flushNativeCores).toBe(0);
    }, 120_000);
});
