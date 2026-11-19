// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import type { HasPlayerMovedInterface } from "../../../../src/front/Api/Events/HasPlayerMovedInterface";
import { PlayerMovement } from "../../../../src/front/Phaser/Game/PlayerMovement";
import { PlayersPositionInterpolator } from "../../../../src/front/Phaser/Game/PlayersPositionInterpolator";
import {
    drawDurationFor,
    MAX_DRAW_DURATION_MS,
    nextInterval,
    RemoteSampleIntervals,
} from "../../../../src/front/Phaser/Game/RemoteSampleInterval";

vi.mock("../../../../src/front/Enum/EnvironmentVariable.ts", () => import("../../mocks/frontEnvironmentVariableMock"));

const POSITION_DELAY = 200;
const WALK_SPEED_PX_PER_S = 180; // WOKA_SPEED (9) * 20
const FRAME_MS = 1000 / 60;
const RUN_MS = 12_000;
const MEASURE_FROM_MS = 5_000;
const USER_ID = 7;

function truthX(tick: number): number {
    return 100 + (WALK_SPEED_PX_PER_S * tick) / 1000;
}

function walkingSample(x: number): HasPlayerMovedInterface {
    return { x, y: 200, oldX: x, oldY: 200, direction: PositionMessage_Direction.RIGHT, moving: true };
}

interface Arrival {
    /** When the sample reaches the receiver. */
    tick: number;
    sample: HasPlayerMovedInterface;
}

type Receiver = "fixed interval" | "observed interval";

interface Measurement {
    /** Mean and worst distance in pixels between the drawn avatar and where the sender really is. */
    meanErrorPx: number;
    maxErrorPx: number;
    /** Share of frames, while the sender walks, in which the drawn avatar did not move. */
    stillFramePercent: number;
    /** Longest run of such frames in ms: the visible step. */
    longestStillMs: number;
}

/** A walker sampled every `intervalMs`; `jitterMs` delays every other sample on the network. */
function walkerArrivals(intervalMs: number, jitterMs = 0): Arrival[] {
    const arrivals: Arrival[] = [];
    for (let k = 0; k * intervalMs <= RUN_MS; k++) {
        const sentAt = k * intervalMs;
        arrivals.push({ tick: sentAt + (k % 2 === 1 ? jitterMs : 0), sample: walkingSample(truthX(sentAt)) });
    }
    return arrivals;
}

/** A walker sampled every `fromIntervalMs` until `switchMs` and every `toIntervalMs` after it, as a viewer budget would. */
function walkerChangingRate(fromIntervalMs: number, toIntervalMs: number, switchMs: number): Arrival[] {
    const arrivals: Arrival[] = [];
    for (let sentAt = 0; sentAt <= RUN_MS; sentAt += sentAt < switchMs ? fromIntervalMs : toIntervalMs) {
        arrivals.push({ tick: sentAt, sample: walkingSample(truthX(sentAt)) });
    }
    return arrivals;
}

interface Window {
    stillFramePercent: number;
    longestStillMs: number;
    /** Fastest frame to frame speed in the window, in px/s. */
    peakSpeedPxPerS: number;
}

/** Still frames and peak speed of a drawn path between two times of the run. */
function describeWindow(path: number[], fromMs: number, toMs: number): Window {
    let frames = 0;
    let still = 0;
    let stillRun = 0;
    let longestStillRun = 0;
    let peak = 0;
    for (let i = Math.ceil(fromMs / FRAME_MS); i * FRAME_MS <= toMs; i++) {
        const step = Math.abs(path[i] - path[i - 1]);
        frames++;
        peak = Math.max(peak, (step * 1000) / FRAME_MS);
        if (step < 0.01) {
            still++;
            stillRun++;
            longestStillRun = Math.max(longestStillRun, stillRun);
        } else {
            stillRun = 0;
        }
    }
    return {
        stillFramePercent: Math.round((still / frames) * 1000) / 10,
        longestStillMs: Math.round(longestStillRun * FRAME_MS),
        peakSpeedPxPerS: Math.round(peak),
    };
}

/**
 * Plays the receiving scene for 12 s at 60 fps. Like GameScene, each frame first takes the samples that arrived, using
 * the frame time as the receipt tick and the drawn avatar as the start of the move, then draws the interpolated
 * position. The "fixed interval" receiver is the call GameScene made before the interval was observed.
 */
function measure(arrivals: Arrival[], receiver: Receiver): Measurement {
    const interpolator = new PlayersPositionInterpolator();
    let drawnX = arrivals[0].sample.x;
    let next = 0;
    let errorSum = 0;
    let maxError = 0;
    let frames = 0;
    let stillFrames = 0;
    let stillRun = 0;
    let longestStillRun = 0;

    for (let tick = 0; tick <= RUN_MS; tick += FRAME_MS) {
        while (next < arrivals.length && arrivals[next].tick <= tick) {
            const { sample } = arrivals[next++];
            const current = { x: drawnX, y: 200 };
            if (receiver === "fixed interval") {
                interpolator.updatePlayerPosition(
                    USER_ID,
                    new PlayerMovement(current, tick, sample, tick + POSITION_DELAY),
                );
            } else {
                interpolator.receiveSample(USER_ID, current, tick, sample);
            }
        }
        const previousX = drawnX;
        drawnX = interpolator.getUpdatedPositions(tick).get(USER_ID)?.x ?? drawnX;

        if (tick < MEASURE_FROM_MS) {
            continue;
        }
        const error = Math.abs(drawnX - truthX(tick));
        errorSum += error;
        maxError = Math.max(maxError, error);
        frames++;
        if (Math.abs(drawnX - previousX) < 0.01) {
            stillFrames++;
            stillRun++;
            longestStillRun = Math.max(longestStillRun, stillRun);
        } else {
            stillRun = 0;
        }
    }
    return {
        meanErrorPx: Math.round((errorSum / frames) * 10) / 10,
        maxErrorPx: Math.round(maxError * 10) / 10,
        stillFramePercent: Math.round((stillFrames / frames) * 1000) / 10,
        longestStillMs: Math.round(longestStillRun * FRAME_MS),
    };
}

/** Every position drawn in a run, to compare two receivers frame by frame. */
function drawnPath(arrivals: Arrival[], receiver: Receiver): number[] {
    const interpolator = new PlayersPositionInterpolator();
    const path: number[] = [];
    let drawnX = arrivals[0].sample.x;
    let next = 0;
    for (let tick = 0; tick <= RUN_MS; tick += FRAME_MS) {
        while (next < arrivals.length && arrivals[next].tick <= tick) {
            const { sample } = arrivals[next++];
            if (receiver === "fixed interval") {
                interpolator.updatePlayerPosition(
                    USER_ID,
                    new PlayerMovement({ x: drawnX, y: 200 }, tick, sample, tick + POSITION_DELAY),
                );
            } else {
                interpolator.receiveSample(USER_ID, { x: drawnX, y: 200 }, tick, sample);
            }
        }
        drawnX = interpolator.getUpdatedPositions(tick).get(USER_ID)?.x ?? drawnX;
        path.push(drawnX);
    }
    return path;
}

describe("Remote sample interval", () => {
    describe("measurement, a remote player walking at 180 px/s, 5 to 12 s of a 12 s run", () => {
        it.each([
            { hz: 10, intervalMs: 100 },
            { hz: 5, intervalMs: 200 },
        ])("draws a $hz Hz stream exactly as the fixed interval receiver does", ({ intervalMs }) => {
            const arrivals = walkerArrivals(intervalMs);

            expect(drawnPath(arrivals, "observed interval")).toEqual(drawnPath(arrivals, "fixed interval"));
        });

        // The table is the measurement of the interval-aware receiver (decision C5 slice c). It is exact because the
        // run is deterministic. The 1 Hz rows show the trade: the fixed receiver stands still 70% of the walk, the
        // observed one never stops and trails the sender by about one interval (180 px at 180 px/s).
        it("measures a 10 Hz, 5 Hz and 1 Hz stream with both receivers", () => {
            const results: Record<string, Measurement> = {};
            for (const { hz, intervalMs } of [
                { hz: 10, intervalMs: 100 },
                { hz: 5, intervalMs: 200 },
                { hz: 1, intervalMs: 1000 },
            ]) {
                for (const receiver of ["fixed interval", "observed interval"] as const) {
                    results[`${hz} Hz, ${receiver}`] = measure(walkerArrivals(intervalMs), receiver);
                }
            }

            expect(results).toEqual({
                "10 Hz, fixed interval": {
                    meanErrorPx: 42.6,
                    maxErrorPx: 46.2,
                    stillFramePercent: 16.6,
                    longestStillMs: 17,
                },
                "10 Hz, observed interval": {
                    meanErrorPx: 42.6,
                    maxErrorPx: 46.2,
                    stillFramePercent: 16.6,
                    longestStillMs: 17,
                },
                "5 Hz, fixed interval": {
                    meanErrorPx: 38.6,
                    maxErrorPx: 42.5,
                    stillFramePercent: 8.3,
                    longestStillMs: 17,
                },
                "5 Hz, observed interval": {
                    meanErrorPx: 38.6,
                    maxErrorPx: 42.5,
                    stillFramePercent: 8.3,
                    longestStillMs: 17,
                },
                "1 Hz, fixed interval": {
                    meanErrorPx: 58.2,
                    maxErrorPx: 123.8,
                    stillFramePercent: 70.1,
                    longestStillMs: 717,
                },
                "1 Hz, observed interval": {
                    meanErrorPx: 183.4,
                    maxErrorPx: 188.9,
                    stillFramePercent: 1.7,
                    longestStillMs: 17,
                },
            });
        });

        it("keeps a 1 Hz walker moving where the fixed interval receiver leaves it still", () => {
            const arrivals = walkerArrivals(1000);

            const fixed = measure(arrivals, "fixed interval");
            const observed = measure(arrivals, "observed interval");

            expect(fixed.stillFramePercent).toBeGreaterThan(60);
            expect(fixed.longestStillMs).toBeGreaterThan(600);
            expect(observed.stillFramePercent).toBeLessThan(5);
            expect(observed.longestStillMs).toBeLessThan(100);
        });

        it("keeps a 1 Hz walker moving when samples arrive 80 ms early or late", () => {
            const arrivals = walkerArrivals(1000, 80);

            const observed = measure(arrivals, "observed interval");

            expect(observed.stillFramePercent).toBeLessThan(15);
            expect(observed.longestStillMs).toBeLessThan(250);
        });
    });

    describe("when the rate changes", () => {
        const SWITCH_MS = 6000;

        // Right after the sender slows down no receiver can know it: the last fast sample is drawn in 200 ms and the
        // avatar waits for a sample that comes a second later. From that first slow sample on, the receiver draws over
        // the whole interval at once.
        it("leaves one stall when a walker drops from 5 Hz to 1 Hz, then keeps it moving at its own pace", () => {
            const path = drawnPath(walkerChangingRate(200, 1000, SWITCH_MS), "observed interval");
            const firstSlowSampleMs = SWITCH_MS + 1000;

            const stall = describeWindow(path, SWITCH_MS + 300, firstSlowSampleMs);
            const slow = describeWindow(path, firstSlowSampleMs, RUN_MS);

            expect(stall.longestStillMs).toBeLessThan(750);
            expect(slow.stillFramePercent).toBeLessThan(5);
            expect(slow.longestStillMs).toBeLessThan(100);
            expect(slow.peakSpeedPxPerS).toBeLessThan(WALK_SPEED_PX_PER_S * 1.5);
        });

        // The estimate falls slowly on purpose: a draw longer than the interval only slows the avatar, a shorter one
        // stops it. The price is a catch-up burst when the estimate returns to POSITION_DELAY.
        it("keeps a walker moving when it speeds up from 1 Hz to 5 Hz, with a bounded catch-up", () => {
            const path = drawnPath(walkerChangingRate(1000, 200, SWITCH_MS), "observed interval");

            const fast = describeWindow(path, SWITCH_MS, RUN_MS);

            expect(fast.longestStillMs).toBeLessThan(100);
            expect(fast.peakSpeedPxPerS).toBeLessThan(WALK_SPEED_PX_PER_S * 2.5);
        });
    });

    describe("draw duration", () => {
        it("keeps POSITION_DELAY until two samples of a walk have been seen and at 3.3 Hz or faster", () => {
            expect(drawDurationFor(undefined)).toBe(POSITION_DELAY);
            expect(drawDurationFor(100)).toBe(POSITION_DELAY);
            expect(drawDurationFor(200)).toBe(POSITION_DELAY);
            expect(drawDurationFor(300)).toBe(POSITION_DELAY);
        });

        it("follows a slower interval and stops at the clamp", () => {
            expect(drawDurationFor(500)).toBe(500);
            expect(drawDurationFor(1000)).toBe(1000);
            expect(drawDurationFor(5000)).toBe(MAX_DRAW_DURATION_MS);
        });

        it("follows a longer gap at once, so a stream that slows down is not drawn too short", () => {
            expect(nextInterval(undefined, 1000)).toBe(1000);
            expect(nextInterval(200, 1000)).toBe(1000);
            expect(nextInterval(1000, 1300)).toBe(1300);
        });

        it("smooths a shorter gap instead of following one early sample", () => {
            expect(nextInterval(1000, 800)).toBeCloseTo(940);
        });
    });

    describe("after a stop or a pause", () => {
        it("does not read the time standing still as the interval of the next walk", () => {
            const intervals = new RemoteSampleIntervals();
            intervals.observe(USER_ID, 0, { x: 0, y: 0, moving: true });
            intervals.observe(USER_ID, 1000, { x: 180, y: 0, moving: true });
            intervals.observe(USER_ID, 2000, { x: 360, y: 0, moving: false });

            const restart = intervals.observe(USER_ID, 22_000, { x: 360, y: 0, moving: true });
            const secondSampleOfTheWalk = intervals.observe(USER_ID, 22_200, { x: 396, y: 0, moving: true });

            expect(restart.duration).toBe(POSITION_DELAY);
            expect(secondSampleOfTheWalk.duration).toBe(POSITION_DELAY);
        });

        it("starts again from POSITION_DELAY when the player was removed", () => {
            const interpolator = new PlayersPositionInterpolator();
            interpolator.receiveSample(USER_ID, { x: 0, y: 200 }, 0, walkingSample(0));
            interpolator.receiveSample(USER_ID, { x: 0, y: 200 }, 1000, walkingSample(180));
            interpolator.removePlayer(USER_ID);

            interpolator.receiveSample(USER_ID, { x: 0, y: 200 }, 1100, walkingSample(180));
            interpolator.receiveSample(USER_ID, { x: 0, y: 200 }, 1200, walkingSample(198));

            // Drawn over POSITION_DELAY, the avatar is at the sample when the 200 ms are over.
            expect(interpolator.getUpdatedPositions(1400).get(USER_ID)?.x).toBeCloseTo(198);
        });
    });

    describe("teleport", () => {
        function teleportAfterTwoSamples(intervalMs: number): number {
            const interpolator = new PlayersPositionInterpolator();
            interpolator.receiveSample(USER_ID, { x: 0, y: 200 }, 0, walkingSample(0));
            const walked = (WALK_SPEED_PX_PER_S * intervalMs) / 1000;
            interpolator.receiveSample(USER_ID, { x: 0, y: 200 }, intervalMs, walkingSample(walked));
            // The second move is drawn to its end, then a sample far beyond any walk arrives.
            const drawnAt = interpolator.getUpdatedPositions(intervalMs * 2).get(USER_ID)?.x ?? 0;
            interpolator.receiveSample(USER_ID, { x: drawnAt, y: 200 }, intervalMs * 2, walkingSample(walked + 5000));
            return interpolator.getUpdatedPositions(intervalMs * 2 + 16).get(USER_ID)?.x ?? 0;
        }

        it("places a slow stream's avatar at the new position at once instead of gliding across the map", () => {
            const xOneFrameAfter = teleportAfterTwoSamples(1000);

            expect(xOneFrameAfter).toBeGreaterThan(5000);
        });

        it("keeps today's glide at a rate the receiver already handled", () => {
            const xOneFrameAfter = teleportAfterTwoSamples(200);

            expect(xOneFrameAfter).toBeLessThan(1000);
        });

        it("does not mistake a speed-up walk for a teleport", () => {
            const intervals = new RemoteSampleIntervals();
            const speedUpPxPerS = WALK_SPEED_PX_PER_S * 2.5;
            intervals.observe(USER_ID, 0, { x: 0, y: 0, moving: true });
            intervals.observe(USER_ID, 1000, { x: speedUpPxPerS, y: 0, moving: true });

            const third = intervals.observe(USER_ID, 2000, { x: speedUpPxPerS * 2, y: 0, moving: true });

            expect(third.snap).toBe(false);
        });

        it("does not mistake a speed-up walk on a diagonal, whose sample arrives 80 ms early, for a teleport", () => {
            const intervals = new RemoteSampleIntervals();
            // Both axes move at the speed-up speed: the keyboard does not shorten a diagonal.
            const perAxisPxPerS = WALK_SPEED_PX_PER_S * 2.5;
            intervals.observe(USER_ID, 0, { x: 0, y: 0, moving: true });
            intervals.observe(USER_ID, 1000, { x: perAxisPxPerS, y: perAxisPxPerS, moving: true });

            const third = intervals.observe(USER_ID, 1920, {
                x: perAxisPxPerS * 2,
                y: perAxisPxPerS * 2,
                moving: true,
            });

            expect(third.snap).toBe(false);
        });
    });
});
