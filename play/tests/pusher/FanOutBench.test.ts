import { existsSync, readFileSync, writeFileSync } from "node:fs";
import nodeProcess from "node:process";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

/* eslint-disable no-await-in-loop -- a bench measures one scenario at a time: runs must not overlap. */

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import * as BatchFrame from "../../src/pusher/services/BatchFrame";
import {
    formatResult,
    formatRetention,
    judgeRun,
    runFanOut,
    runInterleaved,
    runRepeated,
    summarizeProfile,
    type FanOutResult,
    type FanOutScenario,
} from "./fanout/FanOutBench";

/*
 * H5: the in-process fan-out bench. The tests at the top pin that the instrument counts what it claims on a small
 * crowd (they run in every `npm test`). The block at the bottom is the instrument itself; it runs only when asked:
 *
 *   cd play
 *   PUSHER_FANOUT=1 npx vitest run tests/pusher/FanOutBench.test.ts
 *
 * Knobs (environment): PUSHER_FANOUT_LEVELS=300,700,1000  PUSHER_FANOUT_HZ=5  PUSHER_FANOUT_WALK=1 (the share of users that walk: 1 is the mandate's 1000 moving users; see below for 0.2)
 * PUSHER_FANOUT_STOPS=2 (stops per walker per second, among its moves: the walk-stop pattern of the CI pool; 0 for walkers that never stop)  PUSHER_FANOUT_REPEATS=3
 * PUSHER_FANOUT_WINDOW=4 (simulated seconds)  PUSHER_FANOUT_PROFILE=1 (adds a CPU profile at the largest level)
 * PUSHER_FANOUT_OUT=path.json (writes every result as JSON)  PUSHER_FANOUT_BASELINE=path.json (a file written by an
 * earlier PUSHER_FANOUT_OUT run, on the same host, to print this run against).
 * The resume store block (what each socket keeps to replay after a reconnection, counts and bytes, no time): PUSHER_FANOUT_RESUME_SOCKETS=1000
 * PUSHER_FANOUT_SLOW_READERS=5 PUSHER_FANOUT_RESUME_RETENTION_MS=30000 PUSHER_FANOUT_RESUME_ARM=0..3 (one arm only) PUSHER_FANOUT_OUT=path.json.
 *
 * Reading the output. Budget off and budget on run in INTERLEAVED repeats, so a pair saw the same host load: the figure
 * to quote is "on / off" from the `[fan-out ratio]` line, the median of the ratios of the pairs. The CPU of a row is
 * flagged INVALID when the load average per core is above 1 or the slowest repeat is over 1.3x the fastest; the counts
 * (frames, deliveries, joins and leaves, virtual latencies) are exact on any host. The ratio line also prints the
 * latency of both arms: the budget sends the last position of a user outside the nearest 150 once a second, so its
 * move latency at the pusher is up to a second for those users and its p95 hop is higher than with the budget off.
 * Quote the CPU ratio together with that latency, never alone.
 * The Gate 2 tests below assert the counts at N=1000; the CPU is for this report only.
 */

const BUDGET = { fullRatePeers: 150, maxPeers: 400, admitByDistance: true };
/**
 * The users counted as "nearest" in the latency tests and the report: the 150 of the full-rate set less the 30 ranks of its
 * deadband (150 x 1.2 - 150). A user nearer than that is always at full rate; a user between the 120th and the 150th rank
 * waits for a free slot instead of trading with one that is beyond the 150th, so it may be heard once a second for a while.
 * MEASURED on the dense walking crowd, share of the moves of those users that reach an observer: 0.98 for the nearest 100,
 * 0.97 for 120, 0.93 for 150 (0.99 with the budget off, whose window edge loses one move in a hundred).
 */
const NEAREST_RANKS = 120;
/** The selection without the deadband, the cooldown and the seat margin: what the budget does when it is not held back. */
const BARE_BUDGET = { ...BUDGET, exitRatio: 1, cooldownMs: 0, seatMarginPx: 0 };

describe("fan-out bench harness", () => {
    it("delivers every move of every walker to every other socket, once, in the window", async () => {
        const result = await runFanOut({
            sockets: 40,
            movingFraction: 0.25,
            movesPerSecond: 5,
            warmUpSeconds: 1,
            windowSeconds: 2,
        });
        // 10 walkers x 5 moves/s, each sent to the 39 sockets that are not its own.
        expect(result.deliveriesPerSecond.moves).toBe(10 * 5 * 39);
        expect(result.deliveriesPerSecond.joins).toBe(0);
        expect(result.deliveriesPerSecond.leaves).toBe(0);
        expect(result.syntheticJoinLeavePerSecond).toBe(0);
    });

    it("measures the wait the batch timer adds: a frame leaves at most one batch interval after the move arrived", async () => {
        const result = await runFanOut({
            sockets: 40,
            movingFraction: 0.25,
            movesPerSecond: 5,
            warmUpSeconds: 1,
            windowSeconds: 3,
        });
        expect(result.pusherHopMs.count).toBeGreaterThan(100);
        expect(result.pusherHopMs.max).toBeLessThanOrEqual(100);
        // A socket's batch opens at its first move and closes 100 ms later, so a move waits 0 to 100 ms.
        expect(result.pusherHopMs.p50).toBeGreaterThanOrEqual(50);
        // The back's window comes on top: a move is sent, held up to 50 ms by the back, then up to 100 ms here.
        expect(result.sendToWriteMs.max).toBeLessThanOrEqual(150);
        expect(result.sendToWriteMs.p95).toBeGreaterThan(result.pusherHopMs.p95);
    });

    it("counts the per-viewer budget: far fewer moves at full rate, and a join or a leave only when the scene changes", async () => {
        const off = await runFanOut({ sockets: 300, movingFraction: 0.5, movesPerSecond: 5, windowSeconds: 3 });
        const on = await runFanOut({
            sockets: 300,
            movingFraction: 0.5,
            movesPerSecond: 5,
            windowSeconds: 3,
            budget: { fullRatePeers: 50, maxPeers: 120 },
        });
        expect(on.deliveriesPerSecond.moves).toBeLessThan(off.deliveriesPerSecond.moves / 2);
        expect(on.bytesPerSecond).toBeLessThan(off.bytesPerSecond / 2);
    }, 60_000);

    it("counts what each socket is told while the room fills: nothing is told and taken back with admitByDistance", async () => {
        const base = { sockets: 300, movingFraction: 0, movesPerSecond: 5, warmUpSeconds: 4, windowSeconds: 1 };
        const off = await runFanOut(base);
        const arrival = await runFanOut({ ...base, budget: { fullRatePeers: 50, maxPeers: 120 } });
        const distance = await runFanOut({
            ...base,
            budget: { fullRatePeers: 50, maxPeers: 120, admitByDistance: true },
        });

        // Without a budget every socket is told of the 299 others.
        expect(off.admissionPerSocket).toEqual({ joins: 299, leaves: 0 });
        // With one, the first 120 by arrival, then the first selection swaps most of them for nearer users.
        expect(arrival.admissionPerSocket.joins).toBeGreaterThan(120 * 1.3);
        expect(arrival.admissionPerSocket.leaves).toBeGreaterThan(120 * 0.3);
        // Admitted by distance: 120 joins, no leave.
        expect(distance.admissionPerSocket).toEqual({ joins: 120, leaves: 0 });
    }, 60_000);

    it("sends stops among the moves when asked, and none by default", async () => {
        const base = { sockets: 40, movingFraction: 0.25, movesPerSecond: 5, warmUpSeconds: 1, windowSeconds: 2 };
        const walking = await runFanOut(base);
        const stopping = await runFanOut({ ...base, stopsPerWalkerPerSecond: 2 });

        // A stop is a move that is not walking, so the deliveries are the same; the observers, 6 sockets that do not
        // walk, were sent 10 walkers x 2 stops a second x 2 s = 40 stops each, give or take the walkers' phases.
        expect(stopping.deliveriesPerSecond.moves).toBe(walking.deliveriesPerSecond.moves);
        expect(walking.observedStops).toBe(0);
        expect(stopping.observedStops).toBeGreaterThanOrEqual(6 * 30);
        expect(stopping.observedStops).toBeLessThanOrEqual(6 * 50);
    });

    it("keeps a socket that is sent a stop every few milliseconds to at most 20 frames a second with the early flush on", async () => {
        // The back sends its moves every 10 ms (ZONE_MESSAGES_BATCH_INTERVAL_MS=10), 60 walkers stop twice a second each:
        // a stop in 120 of the 100 bursts a second, so almost every burst asks for an early flush.
        const room = {
            sockets: 300,
            movingFraction: 0.2,
            movesPerSecond: 5,
            stopsPerWalkerPerSecond: 2,
            backBatchMs: 10,
            batchIntervalMs: 100,
            warmUpSeconds: 2,
            windowSeconds: 4,
        };
        const plain = await runFanOut(room);
        const early = await runFanOut({ ...room, earlyFlushMs: 5 });

        const perSocket = (result: { framesPerSecond: number }) => result.framesPerSecond / room.sockets;
        // 1000 / 101 without it. With it, half an interval between two frames: 20 at the most (MEASURED 14, and 46 with the floor removed), above 10 because
        // the stops do pull the frames forward (the bench sees them; it did not before it had stops).
        expect(perSocket(plain)).toBeLessThanOrEqual(10);
        expect(perSocket(early)).toBeGreaterThan(11);
        expect(perSocket(early)).toBeLessThanOrEqual(20);
        // MEASURED here: the stop is heard sooner by the observers that the early flush serves.
        expect(early.pusherHopMs.p50).toBeLessThan(plain.pusherHopMs.p50);
    }, 60_000);

    it("measures the flush herd: the CPU of the timers due at the same instant, and the latency with the wait inside it", async () => {
        const base = { sockets: 80, movingFraction: 0.25, movesPerSecond: 5, warmUpSeconds: 1, windowSeconds: 3 };
        const free = await runFanOut({ ...base, nativeSendMicrosPerFrame: 0 });
        const costly = await runFanOut({ ...base, nativeSendMicrosPerFrame: 1000 });

        // Every socket gets the same burst from the back, so its timers fall together: 80 frames in a herd, 10 herds a second.
        // Counts only, so that no host speed decides: the JS time of a herd is printed by the bench, not asserted.
        expect(free.herds.perSecond).toBeGreaterThanOrEqual(8);
        expect(free.flushNativeCores).toBe(0);
        // At 1 ms a frame, a herd of 80 frames is at least 80 ms of service (the JS only adds to it), and the last of
        // them is written at least 80 ms late. The native send of the frames alone is about 0.8 of a core (a count).
        expect(costly.herds.derivedTotalMs.p50).toBeGreaterThan(60);
        expect(costly.sendToWriteWithServiceMs.max).toBeGreaterThan(costly.sendToWriteMs.max + 50);
        expect(costly.flushNativeCores).toBeGreaterThan(0.5);
        // With a free native send the wait inside a herd is the windows' own latency plus the JS: the floor derived from
        // the counts adds nothing.
        expect(free.sendToWriteWithNativeMs.p95).toBe(free.sendToWriteMs.p95);
    });

    it("runs the arms in turn and reports the ratio of each pair, with 1 for the first arm", async () => {
        const base = { sockets: 60, movingFraction: 0.25, movesPerSecond: 5, warmUpSeconds: 1, windowSeconds: 2 };
        const arms = await runInterleaved([base, { ...base, budget: { fullRatePeers: 10, maxPeers: 30 } }], 3);

        expect(arms).toHaveLength(2);
        expect(arms[0].ratioToFirst).toEqual([1, 1, 1]);
        expect(arms[0].medianRatioToFirst).toBe(1);
        expect(arms[1].cpuMsPerSimSecond).toHaveLength(3);
        const pairs = arms[1].cpuMsPerSimSecond.map((cpu, round) => cpu / arms[0].cpuMsPerSimSecond[round]);
        expect(arms[1].ratioToFirst).toEqual(pairs);
        expect(pairs).toContain(arms[1].medianRatioToFirst);
    });

    it("alternates which arm runs first in each round, so that a first-in-round effect lands on both arms alike", async () => {
        const base = { sockets: 10, movingFraction: 0.5, movesPerSecond: 5, warmUpSeconds: 1, windowSeconds: 1 };
        const arms = await runInterleaved([base, { ...base, budget: { fullRatePeers: 3, maxPeers: 6 } }], 4);

        // Seen failing: with the arms always in the same order the turns are [0, 0, 0, 0] and [1, 1, 1, 1].
        expect(arms[0].turns).toEqual([0, 1, 0, 1]);
        expect(arms[1].turns).toEqual([1, 0, 1, 0]);
        // The pairs are still of the same round: arm 1's third repeat is compared with arm 0's third.
        expect(arms[1].ratioToFirst[2]).toBe(arms[1].cpuMsPerSimSecond[2] / arms[0].cpuMsPerSimSecond[2]);
    });

    it("calls a run INVALID when the host is loaded or the repeats disagree, and VALID otherwise", () => {
        expect(judgeRun([90, 95, 100], 3, 10)).toEqual({ valid: true, reasons: [] });
        // Load 150 on 10 cores: the figure the review measured at (100 to 265).
        expect(judgeRun([90, 95, 100], 150, 10).valid).toBe(false);
        expect(judgeRun([90, 95, 100], 150, 10).reasons[0]).toContain("load 150 on 10 cores");
        // The three repeats of one scenario that the review saw: 128, 238, 311.
        const spread = judgeRun([128, 238, 311], 3, 10);
        expect(spread.valid).toBe(false);
        expect(spread.reasons).toEqual(["spread 2.43x"]);
        // At the limit.
        expect(judgeRun([100, 130], 10, 10).valid).toBe(true);
        expect(judgeRun([100, 131], 10, 10).valid).toBe(false);
    });

    it("restores the timers and the clock when a run ends", async () => {
        const realSetTimeout = globalThis.setTimeout;
        const realNow = Date.now;
        await runFanOut({ sockets: 5, movingFraction: 0.5, movesPerSecond: 5, warmUpSeconds: 1, windowSeconds: 1 });
        expect(globalThis.setTimeout).toBe(realSetTimeout);
        expect(Date.now).toBe(realNow);
    });

    describe("the resume store (what each socket keeps to replay after a reconnection)", () => {
        const room = {
            sockets: 40,
            movingFraction: 0.25,
            movesPerSecond: 5,
            warmUpSeconds: 1,
            windowSeconds: 4,
            measureRetention: true,
        };

        it("counts what the sockets keep: every frame they were sent in the retention time, and none before it", async () => {
            const long = await runFanOut(room);
            const short = await runFanOut({ ...room, resumeRetentionMs: 1_000 });

            const kept = long.retention;
            const recent = short.retention;
            expect(kept).toBeDefined();
            expect(recent).toBeDefined();
            if (kept === undefined || recent === undefined) return;
            // 30 s keeps all of the 5 s of the run: 10 frames a second a socket (100 ms batches), counted by the stores.
            expect(kept.healthyMeanMessages).toBeGreaterThan(40);
            expect(kept.healthyMeanBytes).toBeGreaterThan(0);
            expect(kept.totalBytes).toBeGreaterThanOrEqual(long.bytesPerSecond * 4);
            expect(kept.sockets).toBe(room.sockets);
            // 1 s keeps the frames of the last second: 10 a second, one more at the edge.
            expect(recent.maxMessagesOfOneSocket).toBeLessThanOrEqual(11);
            expect(recent.totalMessages).toBeLessThan(kept.totalMessages / 3);
            expect(recent.totalBytes).toBeLessThan(kept.totalBytes);
            // Nothing is counted unless asked: the sampling visits every socket.
            expect((await runFanOut({ ...room, measureRetention: false })).retention).toBeUndefined();
        });

        it("keeps for a slow reader what it keeps for one that reads, and sends it nothing after the first frame", async () => {
            const result = await runFanOut({ ...room, slowReaders: 4 });

            const peak = result.retention;
            expect(peak).toBeDefined();
            if (peak === undefined) return;
            // The store keeps a frame whether or not the client read it: the same frames, the same bytes (a frame or two of
            // difference where the batch timers of two sockets fall on either side of a sample).
            expect(peak.slowMeanMessages).toBeGreaterThan(40);
            expect(Math.abs(peak.slowMeanMessages - peak.healthyMeanMessages)).toBeLessThanOrEqual(2);
            expect(Math.abs(peak.slowMeanBytes / peak.healthyMeanBytes - 1)).toBeLessThan(0.1);
            // And with no limit, nothing ends it.
            expect(peak.sessionsEnded).toBe(0);
        });

        it("ends the sessions of the slow readers over a limit, and only theirs: a socket that reads loses its replay and stays", async () => {
            const limit = { resumeMaxMessages: 20 };
            const slow = await runFanOut({ ...room, ...limit, slowReaders: 4 });
            const reading = await runFanOut({ ...room, ...limit });

            expect(slow.retention?.sessionsEnded).toBeGreaterThanOrEqual(4);
            expect(reading.retention?.sessionsEnded).toBe(0);
            // Nobody keeps more than the limit, slow or not.
            expect(slow.retention?.maxMessagesOfOneSocket).toBeLessThanOrEqual(20);
            expect(reading.retention?.maxMessagesOfOneSocket).toBeLessThanOrEqual(20);
            expect(formatRetention(slow.retention as NonNullable<typeof slow.retention>)).toContain("sessions ended");
        }, 60_000);
    });

    it("summarizes a CPU profile by self time", () => {
        const lines = summarizeProfile({
            nodes: [
                { id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: 0 } },
                { id: 2, callFrame: { functionName: "hot", url: "file:///a/b/c.ts", lineNumber: 9 } },
                { id: 3, callFrame: { functionName: "cold", url: "file:///a/b/d.ts", lineNumber: 1 } },
                { id: 4, callFrame: { functionName: "(idle)", url: "", lineNumber: 0 } },
            ],
            samples: [2, 2, 2, 3, 4, 4],
            timeDeltas: [1, 1, 1, 1, 10, 10],
        });
        expect(lines).toEqual(["75.0% hot b/c.ts:10", "25.0% cold b/d.ts:2"]);
    });
});

/*
 * GATE 2 (owner's mandate, 2026-11-21): at 1000 moving users the budget on must do less than the budget off, deliver a
 * move with a p95 under 50 ms, and tell the clients next to nothing that was not so (no join and no leave without a
 * real crossing). Everything below is a count on the virtual clock, so it is the same on any host; the CPU is not
 * asserted, it is printed by the PUSHER_FANOUT=1 report (see its header) as MEASURED information.
 *
 * WHERE THE GATE STANDS (read this before quoting it):
 *  - MET, asserted: fewer operations, fewer bytes a second, zero synthetic join and leave, both workloads.
 *  - NOT MET at the defaults (50 ms at the back, 100 ms at the pusher): the p95 is 144 ms with the budget off and 145 to 147 with it on for
 *    the nearest users (146 to 234 for all deliveries) (the test "misses 50 ms at the production windows" pins it). The budget is not
 *    what decides the p95, the two windows are.
 *  - MET only at 10 ms at the back and 40 ms at the pusher (ZONE_MESSAGES_BATCH_INTERVAL_MS=10, PUSHER_BATCH_INTERVAL_MS=40, 2.5
 *    times the frames written), and only for the 120 users nearest to an observer, chosen BY RANK at the instant of the move and
 *    not by what the observer happened to be sent: p95 47 ms with the budget off and 48 with it on, walk and walk-stop.
 *    Nothing in the repo turns those two settings on: the defaults stay, and they are the operator's to set.
 *  - NOT MET for all deliveries with the budget on, even at 10 and 40: the users beyond the nearest 150 are sent once a second
 *    by design, their moves are up to 250 ms old when delivered, and the p95 over everything is 49 (walk-stop, in some stagger
 *    phases up to 137) or 189 to 196 (walk, no stops) ms. OPEN QUESTION FOR THE OWNER: does "p95 < 50" cover the users heard once
 *    a second? This file assumes it does not (they are asserted to arrive within 250 ms of the move they carry) and asserts
 *    the p95 on the nearest 120 only; if it does, the budget cannot meet it at any window, because conflation is a wait of its own.
 *
 * The two workloads are the ones of the CI pool: 1000 walkers at 5 positions a second, with no stops, and with 2 stops a
 * walker a second (walk-stop, the pattern of the browser's own bots). Operations are the calls into the per-socket code
 * of the pusher counted in the window: sub-messages put into a batch, zone events handed to a socket, the peers a
 * selection ranks, and the frames written. Each arm warms up for 3 simulated seconds, so the first selection and its
 * cooldown are behind it, and is measured for 2. The counts are totals over that 2 s window; the printed lines divide them
 * by it. MEASURED (virtual, so exact), operations a second, budget off against on: walk 10.00M against 3.07M, 89.8
 * against 18.1 MB/s; walk-stop 10.00M against 3.43M, 85.8 against 23.2 MB/s (a ranked peer counts as one operation, the same as
 * an emit, which is generous to the budget: it is cheaper).
 *
 * THE HOPS THE VIRTUAL CLOCK DOES NOT COVER. The move delivery of the mandate runs from the client's send to the
 * observer's screen; this bench measures hops 5 and 6 and nothing else:
 *   covered (virtual, exact): the back's batch window (hop 5), the pusher's batch window and its early flush (hop 6), the
 *     budget's conflation and its selection cadence.
 *   NOT covered: the client's own wait (hop 1), the network both ways (2 and 8), the pusher's intake and rate limiter
 *     (3), the back's work and its gRPC decode (4 and 4b), the native uWS write and the wait of the sockets that are
 *     written after the others in the same herd (7 and 6b: derived in MoveLatencyBudget.test.ts, 21 us a frame, not
 *     measured), and any queueing in the event loop. A p95 under 50 here says the windows leave room for those hops;
 *     it does not say the whole path is under 50. The browser and load-harness runs measure that.
 *
 * What "nearest" is. The budget sends a user in the nearest 150 every move, and a user beyond it once a second (the last
 * position it moved to, CONFLATED_INTERVAL_MS). The observer's moves are split by the RANK of the walker among the users
 * nearest to the observer, by where everybody stood when the move was sent (NEAREST_RANKS, 120: the 150 less the 30 ranks of the
 * deadband; a user between the 120th and the 150th rank waits for a free slot and may be heard once a second for a while). A
 * split by what was received, as the first version of this test did, leaves out the user the budget got wrong: it would be
 * called conflated and drop out of the p95. `nearestDeliveredShare` is the other half: of the moves those users sent, the share
 * that reached the observer (0.97 with the budget on, 0.99 off).
 *
 * How each was seen failing (mutations of the source or of the test, run once and put back):
 *  - the zone handing a stop to every listener again (the walking-only bulk path of before 2026-11-21): walk-stop fails on
 *    `expected 14844412 to be less than 10000000` (calls) and `expected 7992000 to be +0` (zone calls into a budget); the
 *    walk workload still passes, which is why both are run;
 *  - no deadband, no cooldown, no seat margin (RETAIN_EXIT_RATIO 1, RETAIN_COOLDOWN_MS 0, SEAT_MARGIN_PX 0): both count
 *    tests fail on churn (`expected 35003 to be +0`) and the crossing test on `expected 108360 to be less than or equal to 10`;
 *  - a selection every 100 ms (RERANK_INTERVAL_MS 100): both count tests fail (`expected 22619175 to be less than 20000000`:
 *    the ranks cost more than the budget saves, and the rank count leaves its bound);
 *  - the p95 of the nearest users: the pusher window at 100 ms instead of 40 in the tuned arms fails on `expected 104 to be less
 *    than 50`; the budget at 10 full-rate peers instead of 150 (the 120 nearest are then heard once a second) fails on
 *    `expected 182 to be less than 50`.
 */
describe("Gate 2: 1000 moving users, the budget on against the budget off (counts, virtual clock)", () => {
    const ROOM = { sockets: 1000, movingFraction: 1, movesPerSecond: 5, warmUpSeconds: 3, windowSeconds: 2 };
    const runs = new Map<string, Promise<FanOutResult>>();
    /** One run per scenario, shared by the tests that read it. */
    function arm(name: string, scenario: Partial<FanOutScenario>): Promise<FanOutResult> {
        let run = runs.get(name);
        if (run === undefined) {
            run = runFanOut({ countOperations: true, ...ROOM, ...scenario });
            runs.set(name, run);
        }
        return run;
    }
    const line = (name: string, result: FanOutResult) => {
        const ops = result.operations;
        const per = ops?.perSecond;
        const million = (value: number | undefined) => (value === undefined ? "n/a" : (value / 1e6).toFixed(2));
        const ms = (value: number) => (Number.isFinite(value) ? value.toFixed(0) : "n/a");
        // Operations are per simulated second (the counts of the window divided by its length: ${ROOM.windowSeconds} s here).
        console.info(
            `[gate 2] ${name}: operations ${million(per?.total)}M/s (emits ${million(per?.emits)}M, zone calls ${million(per?.listenerCalls)}M, ranked peers ${million(per?.rankedPeers)}M, frames ${per?.frames.toFixed(0)}), ` +
                `${(result.bytesPerSecond / 1000).toFixed(0)} kB/s, join+leave ${result.syntheticJoinLeavePerSecond}/s, ` +
                `send-to-write p95 all ${ms(result.sendToWriteMs.p95)} / nearest ${ms(result.nearestSendToWriteMs.p95)} (delivered ${result.nearestDeliveredShare.toFixed(2)}) / far ${ms(result.farSendToWriteMs.p95)} ms`,
        );
    };

    for (const [workload, stops] of [
        ["walk", 0],
        ["walk-stop", 2],
    ] as const) {
        it(`${workload}: the budget on makes fewer calls and writes fewer bytes a second than the budget off, and the clients are told no join and no leave`, async () => {
            const scenario = { stopsPerWalkerPerSecond: stops };
            const off = await arm(`${workload} off`, scenario);
            const on = await arm(`${workload} on`, { ...scenario, budget: BUDGET });
            line(`${workload} off`, off);
            line(`${workload} on `, on);

            const offOps = off.operations;
            const onOps = on.operations;
            expect(offOps).toBeDefined();
            expect(onOps).toBeDefined();
            if (offOps === undefined || onOps === undefined) return;
            // The counts are totals over the 2 s window; the line printed above gives them per second. Asserted with room: the
            // on arm makes less than half of the off arm's calls, and writes less than 40% of its bytes.
            expect(onOps.total).toBeLessThan(offOps.total);
            expect(onOps.total).toBeLessThan(offOps.total * 0.5);
            expect(on.bytesPerSecond).toBeLessThan(off.bytesPerSecond);
            expect(on.bytesPerSecond).toBeLessThan(off.bytesPerSecond * 0.4);
            // Each kind of call that the off arm makes, the on arm makes fewer of; the selection is the one thing it adds.
            expect(onOps.emits).toBeLessThan(offOps.emits);
            expect(onOps.listenerCalls).toBeLessThan(offOps.listenerCalls);
            expect(onOps.frames).toBeLessThanOrEqual(offOps.frames);
            expect(onOps.ranks).toBeGreaterThan(0);
            expect(offOps.ranks).toBe(0);
            // The ranks follow the clock: 1000 sockets, one selection each 500 ms, over the window. The first tick of
            // each socket is staggered and the window ends in a tail, so the count is the nominal one give or take a few
            // percent (4098 at the time of writing, against 4000 nominal); 250 ms would be 8000 and 100 ms 20000.
            // The literal, not the constant: a constant changed to 100 would move the bound with it. Two ranks a second (500 ms).
            const nominalRanks = ROOM.sockets * ROOM.windowSeconds * 2;
            expect(onOps.ranks).toBeGreaterThanOrEqual(nominalRanks * 0.95);
            expect(onOps.ranks).toBeLessThanOrEqual(nominalRanks * 1.1);
            // Nobody is told a join or a leave once the room has settled: the crowd steps in place.
            expect(on.syntheticJoinLeavePerSecond).toBe(0);
        }, 300_000);
    }

    it("walk-stop: no move is handed to the budget of a socket one by one: a stop goes straight to the sockets that have the user in their scene", async () => {
        const off = await arm("walk-stop off", { stopsPerWalkerPerSecond: 2 });
        const on = await arm("walk-stop on", { stopsPerWalkerPerSecond: 2, budget: BUDGET });

        // The moves a walker sent in the window were 5 a second, 2 of them stops. Off: every move reaches the 999 other
        // sockets, one zone call each. On: not one zone call reaches a budget but through the attentive ones (none, once the
        // scenes are full): the stops go to the 400 sockets that have the user in their scene, straight from the user.
        expect(off.operations?.listenerCalls).toBe(off.deliveriesPerSecond.total * ROOM.windowSeconds);
        expect(on.operations?.listenerCalls).toBe(0);
        // 1000 walkers x 2 stops x 2 s x 400 sockets in the scene: the stops delivered are those of the sockets that know the user.
        // With 150 at full rate a socket is told of 5 moves a second, with 250 once a second plus the 2 stops.
        expect(on.deliveriesPerSecond.moves).toBeLessThan(off.deliveriesPerSecond.moves * 0.35);
    }, 300_000);

    for (const [workload, stops] of [
        ["walk-stop", 2],
        ["walk", 0],
    ] as const) {
        it(`${workload}: delivers the moves of the 120 nearest users with a p95 under 50 ms at the windows that fit it (10 ms at the back, 40 ms at the pusher), and the others within 250 ms (virtual clock, hops 5 and 6 only)`, async () => {
            const tuned = {
                stopsPerWalkerPerSecond: stops,
                backBatchMs: 10,
                batchIntervalMs: 40,
                nearestRanks: NEAREST_RANKS,
            };
            const off = await arm(`${workload} tuned off`, tuned);
            const on = await arm(`${workload} tuned on`, { ...tuned, budget: BUDGET });
            line(`${workload} tuned off`, off);
            line(`${workload} tuned on `, on);

            // The control: the windows alone, with the budget off, are under 50 at p95 (MEASURED 47).
            expect(off.sendToWriteMs.p95).toBeLessThan(50);
            expect(off.sendToWriteMs.count).toBeGreaterThan(10_000);
            // With the budget on, the 150 users nearest to the observer BY RANK (not by what the observer happened to be sent)
            // arrive as fast, and every move of theirs arrives: a nearest user left at 1 Hz would show in the share.
            expect(on.nearestSendToWriteMs.count).toBeGreaterThan(1000);
            expect(on.nearestSendToWriteMs.p95).toBeLessThan(50);
            expect(on.nearestDeliveredShare).toBeGreaterThanOrEqual(0.95);
            // The others are a position up to a second old by design; the one delivered was moved at most 250 ms before.
            expect(on.farSendToWriteMs.count).toBeGreaterThan(1000);
            expect(on.farSendToWriteMs.p95).toBeLessThanOrEqual(250);
        }, 300_000);
    }

    it("misses 50 ms at the production windows (50 ms at the back, 100 ms at the pusher) whatever the budget does: the 150 nearest users are at p95 above it", async () => {
        const stopping = { stopsPerWalkerPerSecond: 2 };
        const off = await arm("walk-stop off", stopping);
        const on = await arm("walk-stop on", { ...stopping, budget: BUDGET });

        // Gate 2 asks for a p95 under 50 ms. At the windows that are configured by default it is NOT met, with the budget off
        // (MEASURED 144) or on, for the nearest users or for all deliveries. Passing it takes PUSHER_BATCH_INTERVAL_MS=40 and
        // ZONE_MESSAGES_BATCH_INTERVAL_MS=10 (the tests above), 2.5 times the writes. This test is the instrument seen to see
        // the miss, and it fails the day the defaults change to fit.
        expect(off.sendToWriteMs.p95).toBeGreaterThan(50);
        expect(on.nearestSendToWriteMs.p95).toBeGreaterThan(50);
        expect(on.sendToWriteMs.p95).toBeGreaterThan(50);
    }, 300_000);

    it("tells the clients next to nothing when the crowd really walks across the edge of their scenes: under 0.02 joins and leaves a socket a second, where the bare selection sends 100", async () => {
        // Every walker goes round a circle of 40 px in 8 s: in a room of 1000 users on 280 x 280 px each viewer's 400
        // nearest users are replaced all the time, and no two users contend for a seat for long.
        const wander = { wanderPx: 40, wanderPeriodSeconds: 8, warmUpSeconds: 3, windowSeconds: 6 };
        const held = await arm("wander held", { ...wander, budget: BUDGET });
        const bare = await arm("wander bare", { ...wander, budget: BARE_BUDGET });
        line("wander held", held);
        line("wander bare", bare);

        // MEASURED 2026-11-22: 8.3 a second for the 1000 sockets with the retention (0.008 a socket; 6 before a waiting user could claim a
        // seat, and the tail varies a little with the phase at which the rank timers were staggered), 108328 without it. Counts of the
        // virtual run, so the same on any host. The bound is 0.02 a socket: one event per socket in 50 s.
        expect(held.syntheticJoinLeavePerSecond).toBeLessThanOrEqual(0.02 * ROOM.sockets);
        expect(bare.syntheticJoinLeavePerSecond).toBeGreaterThan(100 * ROOM.sockets);
        expect(held.syntheticJoinLeavePerSecond).toBeLessThan(bare.syntheticJoinLeavePerSecond / 1000);
    }, 300_000);
});

/*
 * What blocks one encoded frame per zone, counted. The frame of a socket is a nonce, then a body: the entries of its batch.
 * Entries are already encoded once and shared (encodeOnce); the body is what two sockets could share too. They do when
 * their batches are the same list of entries, which fails for two reasons: a socket is not told its own moves (so at
 * 100% walking no body can be shared by all), and the cut between two frames of a socket is where its own timer fell.
 * The nonce is not the blocker: it is the first field of the envelope, so the bodies are compared without it.
 */
describe("how many frame bodies a dense room needs (N=300, 5 positions a second, virtual clock)", () => {
    async function bodies(movingFraction: number): Promise<{ frames: number; distinct: number; largest: number }> {
        const original = BatchFrame.encodeBatchFrame;
        const counts = new Map<string, number>();
        let frames = 0;
        const spy = vi.spyOn(BatchFrame, "encodeBatchFrame").mockImplementation((nonce, subMessages, entryBytes) => {
            const frame = original(nonce, subMessages, entryBytes);
            // Skip the nonce: its tag, then a varint.
            let at = 1;
            while ((frame[at] & 0x80) !== 0) at += 1;
            const key = createHash("sha1")
                .update(frame.subarray(at + 1))
                .digest("hex");
            counts.set(key, (counts.get(key) ?? 0) + 1);
            frames += 1;
            return frame;
        });
        try {
            await runFanOut({ sockets: 300, movingFraction, movesPerSecond: 5, warmUpSeconds: 1, windowSeconds: 2 });
        } finally {
            spy.mockRestore();
        }
        return { frames, distinct: counts.size, largest: Math.max(...counts.values()) };
    }

    it("shares a body between the sockets that are not walking, and between almost none when everyone walks", async () => {
        const some = await bodies(0.2);
        const all = await bodies(1);
        console.info(
            `[frame bodies] N=300: 20% walking ${some.frames} frames, ${some.distinct} distinct bodies, the largest shared by ${some.largest} sockets; ` +
                `100% walking ${all.frames} frames, ${all.distinct} distinct, the largest shared by ${all.largest}`,
        );

        // MEASURED when written, counts of the virtual run: 8700 frames, 1168 distinct bodies (the largest shared by 270 of 300
        // sockets) with 20% walking; 8700 frames, 4528 distinct (the largest by 150) with everyone walking.
        expect(some.distinct).toBeLessThan(some.frames * 0.2);
        expect(some.largest).toBeGreaterThan(200);
        expect(all.distinct).toBeGreaterThan(all.frames * 0.4);
        expect(all.largest).toBeLessThan(some.largest);
    }, 120_000);
});

const enabled = nodeProcess.env.PUSHER_FANOUT === "1";

interface BaselineRow {
    result: FanOutResult;
    cpu: number[];
    validity?: ReturnType<typeof judgeRun>;
}

interface MeasuredRow extends BaselineRow {
    repeats: FanOutResult[];
    validity: ReturnType<typeof judgeRun>;
}

/** JSON omits the disabled budget. Compare all effective inputs, including batching and admission. */
function baselineFor(baseline: BaselineRow[], result: FanOutResult): BaselineRow | undefined {
    const { budget, ...settings } = result.scenario;
    return baseline.find(({ result: before }) => {
        const { budget: beforeBudget, ...beforeSettings } = before.scenario;
        return isDeepStrictEqual(beforeBudget, budget) && isDeepStrictEqual(beforeSettings, settings);
    });
}

/**
 * The Gate 2 criterion for the opt-in report (PUSHER_FANOUT_GATE=1), the same as the always-on tests above: the walkers among
 * the 150 users nearest to an observer, by rank, are delivered with a p95 under 50 ms and every move of theirs arrives; no
 * join or leave without a real crossing; fewer bytes than the budget off. All deliveries are NOT the criterion: the users
 * beyond the nearest 150 are heard once a second by design (see the Gate 2 header).
 */
function deliveryFailures(enabled: FanOutResult[], disabled: FanOutResult[]): string[] {
    if (!enabled.length || enabled.length !== disabled.length) return ["Missing paired delivery measurements"];
    const failures: string[] = [];
    for (const [index, run] of enabled.entries()) {
        const latency = run.nearestSendToWriteMs;
        const offBytes = disabled[index].bytesPerSecond;
        if (!(
            latency.count > 0 &&
            latency.p95 !== null &&
            latency.p95 < 50 &&
            run.nearestDeliveredShare >= 0.95 &&
            run.syntheticJoinLeavePerSecond === 0 &&
            run.bytesPerSecond < offBytes
        )) {
            failures.push(
                `repeat ${index + 1}: nearest p95=${latency.p95} ms, observations=${latency.count}, delivered=${run.nearestDeliveredShare}, churn=${run.syntheticJoinLeavePerSecond}/s, bytes/s=${run.bytesPerSecond} (off=${offBytes})`,
            );
        }
    }
    return failures;
}

describe("fan-out report", () => {
    it("matches saved settings across JSON and rejects different windows or peer limits", async () => {
        const result = await runFanOut({ sockets: 8, movingFraction: 1, movesPerSecond: 5, windowSeconds: 1 });
        const saved = (sample: FanOutResult) =>
            JSON.parse(JSON.stringify([{ result: sample, cpu: [1] }])) as BaselineRow[];
        expect(baselineFor(saved(result), result)).toBeDefined();
        expect(
            baselineFor(saved(result), { ...result, scenario: { ...result.scenario, backBatchMs: 1 } }),
        ).toBeUndefined();
        const on = { ...result, scenario: { ...result.scenario, budget: BUDGET } };
        expect(
            baselineFor(saved(on), { ...on, scenario: { ...on.scenario, budget: { ...BUDGET, maxPeers: 399 } } }),
        ).toBeUndefined();
    });

    it("rejects an unobserved or late repeat even when its neighbors pass", async () => {
        const off = await runFanOut({ sockets: 8, movingFraction: 1, movesPerSecond: 5, windowSeconds: 1 });
        const good = {
            ...off,
            bytesPerSecond: off.bytesPerSecond / 2,
            nearestSendToWriteMs: { ...off.sendToWriteMs, p95: 40 },
            nearestDeliveredShare: 1,
        };
        expect(deliveryFailures([good], [off])).toEqual([]);
        // A nearest user left at 1 Hz: the p95 of what arrived is fine, but a fifth of the moves arrived.
        expect(deliveryFailures([{ ...good, nearestDeliveredShare: 0.2 }], [off])).toHaveLength(1);
        expect(deliveryFailures([good], [])).toHaveLength(1);
        for (const nearestSendToWriteMs of [
            { ...good.nearestSendToWriteMs, p95: 50 },
            { ...good.nearestSendToWriteMs, count: 0 },
        ]) {
            const repeats = [good, { ...good, nearestSendToWriteMs }, good];
            expect(deliveryFailures(repeats, [off, off, off])).toEqual([expect.stringContaining("repeat 2:")]);
        }
    });
});

describe.skipIf(!enabled)("pusher fan-out bench (PUSHER_FANOUT=1)", () => {
    it("reports CPU, deliveries, bytes and added latency per level, budget off and on, in interleaved repeats", async () => {
        const levels = (nodeProcess.env.PUSHER_FANOUT_LEVELS ?? "300,700,1000").split(",").map(Number);
        const hz = Number(nodeProcess.env.PUSHER_FANOUT_HZ ?? 5);
        const walk = Number(nodeProcess.env.PUSHER_FANOUT_WALK ?? 1);
        const stops = Number(nodeProcess.env.PUSHER_FANOUT_STOPS ?? 2);
        const repeats = Number(nodeProcess.env.PUSHER_FANOUT_REPEATS ?? 3);
        const windowSeconds = Number(nodeProcess.env.PUSHER_FANOUT_WINDOW ?? 4);
        // The gate asks for 50 ms, which only the tuned windows fit: it runs at 10 and 40 unless told otherwise.
        const gate = nodeProcess.env.PUSHER_FANOUT_GATE === "1";
        const backBatchMs = Number(nodeProcess.env.PUSHER_FANOUT_BACK_MS ?? (gate ? 10 : 50));
        const batchIntervalMs = Number(nodeProcess.env.PUSHER_FANOUT_BATCH_MS ?? (gate ? 40 : 100));
        const baselinePath = nodeProcess.env.PUSHER_FANOUT_BASELINE;
        const baseline: BaselineRow[] =
            baselinePath !== undefined && existsSync(baselinePath)
                ? (JSON.parse(readFileSync(baselinePath, "utf8")) as BaselineRow[])
                : [];

        // Compile the code on a small crowd first, so the first level is not charged for the JIT.
        await runFanOut({ sockets: 200, movingFraction: walk, movesPerSecond: hz, windowSeconds: 2 });

        const rows: MeasuredRow[] = [];
        for (const sockets of levels) {
            const scenarios: FanOutScenario[] = [undefined, BUDGET].map((budget) => ({
                nearestRanks: NEAREST_RANKS,
                sockets,
                movingFraction: walk,
                movesPerSecond: hz,
                stopsPerWalkerPerSecond: stops,
                windowSeconds,
                backBatchMs,
                batchIntervalMs,
                budget,
            }));
            const [off, on] = await runInterleaved(scenarios, repeats);
            const judgements = [off, on].map((arm) => judgeRun(arm.cpuMsPerSimSecond));
            for (const [index, arm] of [off, on].entries()) {
                const sorted = [...arm.cpuMsPerSimSecond].sort((a, b) => a - b);
                rows.push({ result: arm.median, cpu: sorted, repeats: arm.repeats, validity: judgements[index] });
                console.info(`[fan-out] ${formatResult(arm.median, sorted)}`);
                const before = baselineFor(baseline, arm.median);
                if (before?.validity?.valid && judgements[index].valid) {
                    const ratio = arm.median.cpuMsPerSimSecond / before.result.cpuMsPerSimSecond;
                    console.info(
                        `[fan-out baseline] N=${sockets} budget=${arm.median.scenario.budget === undefined ? "off" : "on"} cpu now/baseline=${ratio.toFixed(2)} (baseline ${before.result.cpuMsPerSimSecond.toFixed(1)} ms/s, ` +
                            `join+leave ${before.result.syntheticJoinLeavePerSecond.toFixed(1)} to ${arm.median.syntheticJoinLeavePerSecond.toFixed(1)}/s)`,
                    );
                }
            }
            const ms = (value: number) => (Number.isFinite(value) ? value.toFixed(0) : "n/a");
            const hop = (result: FanOutResult) =>
                `${ms(result.pusherHopMs.p50)}/${ms(result.pusherHopMs.p95)}/${ms(result.pusherHopMs.max)}`;
            const validity = {
                valid: judgements.every((judgement) => judgement.valid),
                reasons: [...new Set(judgements.flatMap((judgement) => judgement.reasons))],
            };
            if (nodeProcess.env.PUSHER_FANOUT_GATE === "1" && sockets === 1000 && walk === 1) {
                expect.soft(validity.valid, validity.reasons.join(", ")).toBe(true);
            }
            console.info(
                `[fan-out ratio] N=${sockets} walk=${Math.round(walk * 100)}% stops=${stops}/s budget on / off: cpu ${on.medianRatioToFirst.toFixed(2)} (median of ${repeats} pairs: ${on.ratioToFirst.map((r) => r.toFixed(2)).join(" ")}) ` +
                    `${validity.valid ? "VALID" : `INVALID(${validity.reasons.join(", ")})`}  ` +
                    `pusher hop p50/p95/max off=${hop(off.median)} ms, on=${hop(on.median)} ms  ` +
                    `frames/s off=${off.median.framesPerSecond.toFixed(0)} on=${on.median.framesPerSecond.toFixed(0)}  ` +
                    `join+leave/s off=${off.median.syntheticJoinLeavePerSecond.toFixed(1)} on=${on.median.syntheticJoinLeavePerSecond.toFixed(1)}`,
            );
        }
        if (nodeProcess.env.PUSHER_FANOUT_PROFILE === "1") {
            const largest = Math.max(...levels);
            for (const budget of [undefined, BUDGET]) {
                const profiled = await runFanOut({
                    sockets: largest,
                    movingFraction: walk,
                    movesPerSecond: hz,
                    stopsPerWalkerPerSecond: stops,
                    windowSeconds,
                    backBatchMs,
                    batchIntervalMs,
                    budget,
                    profile: true,
                });
                console.info(
                    `[fan-out profile] N=${largest} budget=${budget === undefined ? "off" : "on"}\n  ` +
                        (profiled.profileTop ?? []).join("\n  "),
                );
            }
        }
        if (nodeProcess.env.PUSHER_FANOUT_OUT) {
            writeFileSync(nodeProcess.env.PUSHER_FANOUT_OUT, JSON.stringify(rows, null, 2));
        }
        if (nodeProcess.env.PUSHER_FANOUT_GATE === "1") {
            const dense = rows.filter(
                ({ result }) => result.scenario.sockets === 1000 && result.scenario.movingFraction === 1,
            );
            const enabled = dense.find(({ result }) => result.scenario.budget !== undefined);
            const disabled = dense.find(({ result }) => result.scenario.budget === undefined);
            if (!enabled || !disabled) throw new Error("The gate needs both 1000-walker arms");
            expect
                .soft(enabled.result.cpuMsPerSimSecond)
                .toBeLessThan(Math.min(150, disabled.result.cpuMsPerSimSecond));
            expect.soft(deliveryFailures(enabled.repeats, disabled.repeats)).toEqual([]);
        }
        expect(rows.length).toBe(levels.length * 2);
    }, 3_600_000);
});

describe.skipIf(!enabled)("the cost of the windows (PUSHER_FANOUT=1)", () => {
    it("prints frames a second and the latency pusher and back add, for each pair of windows", async () => {
        const sockets = Number(nodeProcess.env.PUSHER_FANOUT_TRADE_SOCKETS ?? 1000);
        const walk = Number(nodeProcess.env.PUSHER_FANOUT_WALK ?? 0.2);
        const hz = Number(nodeProcess.env.PUSHER_FANOUT_HZ ?? 5);
        const stops = Number(nodeProcess.env.PUSHER_FANOUT_STOPS ?? 2);
        await runFanOut({ sockets: 200, movingFraction: walk, movesPerSecond: hz, windowSeconds: 2 });
        const pairs = [
            { backBatchMs: 50, batchIntervalMs: 100 },
            { backBatchMs: 50, batchIntervalMs: 50 },
            { backBatchMs: 25, batchIntervalMs: 50 },
            { backBatchMs: 25, batchIntervalMs: 25 },
            { backBatchMs: 10, batchIntervalMs: 25 },
            { backBatchMs: 10, batchIntervalMs: 40 },
            { backBatchMs: 10, batchIntervalMs: 10 },
        ];
        for (const pair of pairs) {
            const { median, cpuMsPerSimSecond } = await runRepeated(
                {
                    sockets,
                    movingFraction: walk,
                    movesPerSecond: hz,
                    stopsPerWalkerPerSecond: stops,
                    windowSeconds: 4,
                    ...pair,
                },
                3,
            );
            const total = median.sendToWriteMs;
            console.info(
                `[windows] ${formatResult(median, cpuMsPerSimSecond)}  send-to-write p50/p95/max=${total.p50}/${total.p95}/${total.max} ms`,
            );
        }
    }, 3_600_000);
});

describe.skipIf(!enabled)("what a per-socket batch timer costs (PUSHER_FANOUT=1)", () => {
    it("prints the CPU of arming and firing 1000 real Node timers, once per frame, against one shared tick that loops over the sockets", async () => {
        const sockets = 1000;
        const rounds = 20;
        const intervalMs = 100;
        const frames = { fired: 0 };
        const sinks = Array.from({ length: sockets }, () => ({ pending: 0 }));

        // A: one timer a socket and a frame, as PusherWebSocket does. Real timers, so a round takes 100 ms of wall time.
        const timerCpu = nodeProcess.cpuUsage();
        for (let round = 0; round < rounds; round++) {
            await new Promise<void>((resolve) => {
                let left = sockets;
                for (const sink of sinks) {
                    sink.pending = 1;
                    setTimeout(() => {
                        frames.fired += 1;
                        sink.pending = 0;
                        left -= 1;
                        if (left === 0) {
                            resolve();
                        }
                    }, intervalMs);
                }
            });
        }
        const timerUsage = nodeProcess.cpuUsage(timerCpu);
        const timersMicrosPerFrame = (timerUsage.user + timerUsage.system) / (rounds * sockets);

        // B: one tick that visits every socket with something pending. The loop is the same work as the callbacks above.
        let ticked = 0;
        const tickCpu = nodeProcess.cpuUsage();
        for (let round = 0; round < rounds; round++) {
            for (const sink of sinks) {
                sink.pending = 1;
            }
            for (const sink of sinks) {
                if (sink.pending > 0) {
                    ticked += 1;
                    sink.pending = 0;
                }
            }
        }
        const tickUsage = nodeProcess.cpuUsage(tickCpu);
        const tickMicrosPerFrame = (tickUsage.user + tickUsage.system) / (rounds * sockets);

        console.info(
            `[timers] real Node timers, ${sockets} sockets, ${rounds} rounds of ${intervalMs} ms: ${timersMicrosPerFrame.toFixed(2)} us CPU per frame to arm and fire a timer ` +
                `(${((timersMicrosPerFrame * 10_000) / 1000).toFixed(1)} ms/s at 10000 frames/s, ${((timersMicrosPerFrame * 25_000) / 1000).toFixed(1)} ms/s at 25000); ` +
                `one shared tick over the same sockets: ${tickMicrosPerFrame.toFixed(3)} us per frame`,
        );
        expect(frames.fired).toBe(rounds * sockets);
        expect(ticked).toBe(rounds * sockets);
    }, 120_000);
});

describe.skipIf(!enabled)("the resume store at the size of a room (PUSHER_FANOUT=1)", () => {
    it("prints what the sockets keep for a resume at their peak, with a slow reader case, with no limit and with the limits proposed", async () => {
        const sockets = Number(nodeProcess.env.PUSHER_FANOUT_RESUME_SOCKETS ?? 1000);
        const walk = Number(nodeProcess.env.PUSHER_FANOUT_WALK ?? 0.2);
        const hz = Number(nodeProcess.env.PUSHER_FANOUT_HZ ?? 5);
        const stops = Number(nodeProcess.env.PUSHER_FANOUT_STOPS ?? 2);
        const slowReaders = Number(nodeProcess.env.PUSHER_FANOUT_SLOW_READERS ?? 5);
        // Whole retention time (30 s in production) and a little over it, so that the stores are at their plateau.
        const retentionMs = Number(nodeProcess.env.PUSHER_FANOUT_RESUME_RETENTION_MS ?? 30_000);
        const windowSeconds = Math.ceil(retentionMs / 1000) + 3;
        const base = {
            sockets,
            movingFraction: walk,
            movesPerSecond: hz,
            stopsPerWalkerPerSecond: stops,
            warmUpSeconds: 3,
            windowSeconds,
            resumeRetentionMs: retentionMs,
            measureRetention: true,
            observers: 2,
        };
        const arms: [string, Partial<FanOutScenario>][] = [
            ["no limit, all read", {}],
            ["no limit, slow readers", { slowReaders }],
            [
                "8 MiB / 2000 frames, slow readers",
                { slowReaders, resumeMaxBytes: 8 * 1024 * 1024, resumeMaxMessages: 2000 },
            ],
            ["budget on, no limit, slow readers", { slowReaders, budget: BUDGET }],
        ];
        // PUSHER_FANOUT_RESUME_ARM=2 runs the third arm only, so that the arms can run in separate processes.
        const only = nodeProcess.env.PUSHER_FANOUT_RESUME_ARM;
        const rows: { name: string; line: string; retention: FanOutResult["retention"] }[] = [];
        for (const [index, [name, extra]] of arms.entries()) {
            if (only !== undefined && Number(only) !== index) {
                continue;
            }
            const result = await runFanOut({ ...base, ...extra });
            const line = result.retention === undefined ? "n/a" : formatRetention(result.retention);
            console.info(`[resume] ${name}: ${line}`);
            rows.push({ name, line, retention: result.retention });
            expect(result.retention).toBeDefined();
        }
        if (nodeProcess.env.PUSHER_FANOUT_OUT) {
            writeFileSync(nodeProcess.env.PUSHER_FANOUT_OUT, JSON.stringify(rows, null, 2));
        }
    }, 3_600_000);
});
