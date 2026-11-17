// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterAll, describe, expect, it, vi } from "vitest";

// E2EHooks reaches the game through the game manager and the media stores, which pull in the whole front end.
// The fake PerformanceObserver is stubbed before E2EHooks loads, since e2eHooks reads the global at module load.
const { events, FakeObserverClass } = vi.hoisted(() => {
    class FakeObserverClass {
        static supportedEntryTypes: string[] | undefined = ["longtask"];
        static instances: FakeObserverClass[] = [];

        observed: { type: string }[] = [];
        disconnected = false;
        pending: { duration: number }[] = [];

        constructor(private readonly callback: (list: { getEntries(): { duration: number }[] }) => void) {
            FakeObserverClass.instances.push(this);
        }

        observe(options: { type: string }): void {
            this.observed.push(options);
        }

        takeRecords(): { duration: number }[] {
            const records = this.pending;
            this.pending = [];
            return records;
        }

        disconnect(): void {
            this.disconnected = true;
        }

        deliver(entries: { duration: number }[]): void {
            this.callback({ getEntries: () => entries });
        }
    }
    vi.stubGlobal("PerformanceObserver", FakeObserverClass);
    return { events: { current: undefined }, FakeObserverClass };
});
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => ({ game: { events: events.current } }) },
}));
vi.mock("../../../src/front/Stores/MediaStore", () => ({
    rawLocalVideoTrackStore: {},
    backgroundProcessedLocalVideoTrackStore: {},
}));

import {
    createFrameRecorder,
    e2eHooks,
    percentileOfSorted,
    summarizeFrameTimes,
} from "../../../src/front/Utils/E2EHooks";
import type { E2EFrameEvents, E2ELongTaskObserverClass } from "../../../src/front/Utils/E2EHooks";

const { PRE_STEP, POST_STEP, POST_RENDER } = Phaser.Core.Events;
const FRAME_EVENTS = [PRE_STEP, POST_STEP, POST_RENDER];

afterAll(() => {
    vi.unstubAllGlobals();
});

type Listener = (...args: unknown[]) => void;

class FakeEmitter implements E2EFrameEvents {
    private readonly listeners = new Map<string, Set<Listener>>();

    on(event: string, listener: Listener): this {
        this.listeners.set(event, (this.listeners.get(event) ?? new Set<Listener>()).add(listener));
        return this;
    }

    off(event: string, listener: Listener): this {
        this.listeners.get(event)?.delete(listener);
        return this;
    }

    emit(event: string, ...args: unknown[]): void {
        for (const listener of [...(this.listeners.get(event) ?? [])]) {
            listener(...args);
        }
    }

    listenerCounts(): number[] {
        return FRAME_EVENTS.map((event) => this.listeners.get(event)?.size ?? 0);
    }
}

class FakeClock {
    time = 1000;

    now = (): number => this.time;

    advance(ms: number): void {
        this.time += ms;
    }
}

/** One frame as Game.runFrame emits it, with the time each stage takes on the fake clock. */
function playFrame(
    emitter: FakeEmitter,
    clock: FakeClock,
    frame: { stepMs: number; renderMs?: number; idleAfterMs?: number; time?: number },
): void {
    // Game.runFrame passes the requestAnimationFrame timestamp and the delta to PRE_STEP
    emitter.emit(PRE_STEP, ...(frame.time === undefined ? [] : [frame.time, 16]));
    clock.advance(frame.stepMs);
    emitter.emit(POST_STEP);
    if (frame.renderMs !== undefined) {
        clock.advance(frame.renderMs);
        emitter.emit(POST_RENDER);
    }
    clock.advance(frame.idleAfterMs ?? 0);
}

function setup(options: { observerClass?: E2ELongTaskObserverClass | undefined; capacity?: number } = {}) {
    const emitter = new FakeEmitter();
    const clock = new FakeClock();
    const recorder = createFrameRecorder({
        now: clock.now,
        observerClass: options.observerClass,
        capacity: options.capacity,
    });
    return { emitter, clock, recorder };
}

function fakeObserverClass(): E2ELongTaskObserverClass {
    FakeObserverClass.instances = [];
    FakeObserverClass.supportedEntryTypes = ["longtask"];
    return FakeObserverClass;
}

describe("percentileOfSorted and summarizeFrameTimes", () => {
    it("takes the nearest-rank percentile of ten samples", () => {
        const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        // Reverting Math.ceil to Math.floor in percentileOfSorted makes p95 the 9th sample and fails here
        expect(percentileOfSorted(sorted, 50)).toBe(5);
        expect(percentileOfSorted(sorted, 95)).toBe(10);
        expect(percentileOfSorted(sorted, 99)).toBe(10);
    });

    it("keeps p99 below the maximum when one frame in a hundred is slow", () => {
        const samples = [...Array.from({ length: 99 }, () => 16), 200];

        // Reverting the rank to an index that rounds up (rank + 1) or to interpolation makes p99 reach 200
        expect(summarizeFrameTimes(samples)).toEqual({ p50: 16, p95: 16, p99: 16, max: 200 });
    });

    it("does not reorder the samples it is given", () => {
        const samples = [30, 10, 20];

        summarizeFrameTimes(samples);

        // Reverting Float64Array.from(...) to sorting the argument in place reorders it
        expect(samples).toEqual([30, 10, 20]);
    });

    it("gives zeros for no samples and the sample itself for one", () => {
        expect(summarizeFrameTimes([])).toEqual({ p50: 0, p95: 0, p99: 0, max: 0 });
        expect(summarizeFrameTimes([7])).toEqual({ p50: 7, p95: 7, p99: 7, max: 7 });
    });
});

describe("frame recorder", () => {
    it("attaches nothing before start, one listener per frame event while recording and nothing after stop", () => {
        const { emitter, recorder } = setup();
        expect(emitter.listenerCounts()).toEqual([0, 0, 0]);

        recorder.start(emitter);
        expect(emitter.listenerCounts()).toEqual([1, 1, 1]);

        recorder.stop();
        // Reverting the events.off loop in stop() leaves the three listeners on the game
        expect(emitter.listenerCounts()).toEqual([0, 0, 0]);
    });

    it("measures the time between the starts of consecutive frames, the update and the render", () => {
        const { emitter, clock, recorder } = setup();
        recorder.start(emitter);

        playFrame(emitter, clock, { stepMs: 4, renderMs: 6, idleAfterMs: 7 });
        playFrame(emitter, clock, { stepMs: 5, renderMs: 10, idleAfterMs: 20 });
        playFrame(emitter, clock, { stepMs: 8, renderMs: 2, idleAfterMs: 3 });
        clock.advance(10);
        const recording = recorder.stop();

        expect(recording.frames).toBe(3);
        expect(recording.durationMs).toBe(4 + 6 + 7 + 5 + 10 + 20 + 8 + 2 + 3 + 10);
        // Frame starts are 17 and 35 ms apart (4 + 6 + 7, then 5 + 10 + 20)
        expect(recording.intervalMs).toEqual({ p50: 17, p95: 35, p99: 35, max: 35 });
        expect(recording.stepMs).toEqual({ p50: 5, p95: 8, p99: 8, max: 8 });
        expect(recording.renderMs).toEqual({ p50: 6, p95: 10, p99: 10, max: 10 });
        expect(recording.skippedRenders).toBe(0);
        expect(recording.truncated).toBe(false);
    });

    it("measures each frame's work from PRE_STEP to its last event, rendered or not, and none for a thrown frame", () => {
        const { emitter, clock, recorder } = setup();
        recorder.start(emitter);

        playFrame(emitter, clock, { stepMs: 4, renderMs: 6, idleAfterMs: 20 });
        playFrame(emitter, clock, { stepMs: 3, idleAfterMs: 30 });
        // Thrown in the update: PRE_STEP only
        emitter.emit(PRE_STEP);
        clock.advance(50);
        playFrame(emitter, clock, { stepMs: 2, renderMs: 5, idleAfterMs: 40 });
        const recording = recorder.stop();

        // Work samples are 10 (step + render), 3 (step only) and 7 (closed by stop): the idle time is not work.
        // Removing closeFrame() from stop() drops the 7 (p50 3); dropping `frameEnd = end` in onPostRender gives
        // 4 and 2 instead of 10 and 7; not clearing frameEnd in closeFrame adds a negative sample for the thrown frame.
        expect(recording.workMs).toEqual({ p50: 7, p95: 10, p99: 10, max: 10 });
    });

    it("times the interval with the requestAnimationFrame timestamp Phaser passes to PRE_STEP", () => {
        const { emitter, clock, recorder } = setup();
        recorder.start(emitter);

        // The handler clock sees the frames start 25 then 9 ms apart, the vsync timestamps 16 then 17
        playFrame(emitter, clock, { time: 5000, stepMs: 5, renderMs: 5, idleAfterMs: 15 });
        playFrame(emitter, clock, { time: 5016, stepMs: 2, renderMs: 2, idleAfterMs: 5 });
        playFrame(emitter, clock, { time: 5033, stepMs: 2, renderMs: 2 });
        const recording = recorder.stop();

        // Reverting to environment.now() for the interval gives { p50: 9, ..., max: 25 }
        expect(recording.intervalMs).toEqual({ p50: 16, p95: 17, p99: 17, max: 17 });
        expect(recording.stepMs.max).toBe(5);
    });

    it("counts a frame that updated without rendering as a skipped render", () => {
        const { emitter, clock, recorder } = setup();
        recorder.start(emitter);

        playFrame(emitter, clock, { stepMs: 3 });
        playFrame(emitter, clock, { stepMs: 3, renderMs: 9 });
        playFrame(emitter, clock, { stepMs: 3 });
        const recording = recorder.stop();

        expect(recording.skippedRenders).toBe(2);
        expect(recording.renderMs).toEqual({ p50: 9, p95: 9, p99: 9, max: 9 });
    });

    it("adds no step sample for a frame that never reached POST_STEP", () => {
        const { emitter, clock, recorder } = setup();
        recorder.start(emitter);

        // Game.step swallows an error from the update after PRE_STEP: no POST_STEP, no POST_RENDER
        emitter.emit(PRE_STEP);
        clock.advance(100);
        playFrame(emitter, clock, { stepMs: 4, renderMs: 6 });
        const recording = recorder.stop();

        // Moving `frames++` and the intervalMs push from onPreStep to onPostStep drops the thrown frame: frames 1, max 0
        expect(recording.frames).toBe(2);
        expect(recording.intervalMs.max).toBe(100);
        expect(recording.workMs.max).toBe(10);
        expect(recording.stepMs.max).toBe(4);
        expect(recording.renderMs.max).toBe(6);
        expect(recording.skippedRenders).toBe(0);
    });

    it("ignores the end of a frame whose start it did not see", () => {
        const { emitter, clock, recorder } = setup();
        recorder.start(emitter);

        // Recording started in the middle of a frame
        emitter.emit(POST_STEP);
        emitter.emit(POST_RENDER);
        playFrame(emitter, clock, { stepMs: 4, renderMs: 6 });
        const recording = recorder.stop();

        // Reverting the `frameStart === undefined` or `stepEnd === undefined` guard makes these NaN
        expect(recording.stepMs.max).toBe(4);
        expect(recording.renderMs.max).toBe(6);
        expect(recording.skippedRenders).toBe(0);
    });

    it("starts every recording from zero", () => {
        const { emitter, clock, recorder } = setup();
        recorder.start(emitter);
        playFrame(emitter, clock, { stepMs: 50, renderMs: 50, idleAfterMs: 50 });
        playFrame(emitter, clock, { stepMs: 50, renderMs: 50 });
        recorder.stop();

        recorder.start(emitter);
        playFrame(emitter, clock, { stepMs: 2, renderMs: 3 });
        const recording = recorder.stop();

        // Hoisting the counter and the buffers out of beginFrameRecording makes frames 3 and stepMs.max 50
        expect(recording.frames).toBe(1);
        expect(recording.stepMs.max).toBe(2);
        expect(recording.intervalMs.max).toBe(0);
        expect(recording.workMs.max).toBe(5);
    });

    it("refuses a second start and a stop without a start", () => {
        const { emitter, recorder } = setup();
        expect(() => recorder.stop()).toThrow("No frame recording is running");

        recorder.start(emitter);
        expect(() => recorder.start(emitter)).toThrow("already running");
        // The refused start attached nothing more
        expect(emitter.listenerCounts()).toEqual([1, 1, 1]);

        recorder.stop();
        expect(() => recorder.stop()).toThrow("No frame recording is running");
    });

    it("keeps counting past its buffer and says the percentiles are truncated", () => {
        const { emitter, clock, recorder } = setup({ capacity: 2 });
        recorder.start(emitter);

        playFrame(emitter, clock, { stepMs: 1 });
        playFrame(emitter, clock, { stepMs: 1 });
        playFrame(emitter, clock, { stepMs: 1, renderMs: 1 });
        playFrame(emitter, clock, { stepMs: 1, renderMs: 1 });
        playFrame(emitter, clock, { stepMs: 1, renderMs: 1 });
        const recording = recorder.stop();

        expect(recording.frames).toBe(5);
        expect(recording.truncated).toBe(true);
        // Five updates and three renders: reading it from the stored samples (two of each) would give 0
        expect(recording.skippedRenders).toBe(2);
    });

    describe("long tasks", () => {
        it("observes only while recording, counts delivered and queued entries, then disconnects", () => {
            const observerClass = fakeObserverClass();
            const { emitter, recorder } = setup({ observerClass });
            expect(FakeObserverClass.instances).toHaveLength(0);

            recorder.start(emitter);
            const [observer] = FakeObserverClass.instances;
            expect(observer.observed).toEqual([{ type: "longtask" }]);
            observer.deliver([{ duration: 80 }]);
            observer.pending = [{ duration: 60 }];
            const { longTasks } = recorder.stop();

            // Reverting the takeRecords() call in stop() loses the queued entry: count 1, totalMs 80
            expect(longTasks).toEqual({ supported: true, count: 2, totalMs: 140 });
            // Reverting observer.disconnect() in stop() leaves it observing
            expect(observer.disconnected).toBe(true);
        });

        it("reports zero and unsupported when the browser has no PerformanceObserver", () => {
            const { emitter, recorder } = setup({ observerClass: undefined });

            recorder.start(emitter);
            const { longTasks } = recorder.stop();

            expect(longTasks).toEqual({ supported: false, count: 0, totalMs: 0 });
        });

        it("reports zero and unsupported, and creates no observer, when longtask is not an entry type", () => {
            const observerClass = fakeObserverClass();
            FakeObserverClass.supportedEntryTypes = ["mark", "measure"];
            const { emitter, recorder } = setup({ observerClass });

            recorder.start(emitter);
            const { longTasks } = recorder.stop();

            // Reverting the supportedEntryTypes check makes the fake observer be created
            expect(FakeObserverClass.instances).toHaveLength(0);
            expect(longTasks).toEqual({ supported: false, count: 0, totalMs: 0 });
        });

        it("reports unsupported when the browser does not list its entry types", () => {
            const observerClass = fakeObserverClass();
            FakeObserverClass.supportedEntryTypes = undefined;
            const { emitter, recorder } = setup({ observerClass });

            recorder.start(emitter);

            expect(recorder.stop().longTasks.supported).toBe(false);
            expect(FakeObserverClass.instances).toHaveLength(0);
        });
    });
});

describe("e2eHooks frame recording", () => {
    it("listens on the current scene's game only between startFrameRecording and stopFrameRecording", () => {
        const emitter = new FakeEmitter();
        events.current = emitter;
        fakeObserverClass();
        expect(emitter.listenerCounts()).toEqual([0, 0, 0]);

        e2eHooks.startFrameRecording();
        expect(emitter.listenerCounts()).toEqual([1, 1, 1]);
        for (let frame = 0; frame < 2; frame++) {
            emitter.emit(PRE_STEP);
            emitter.emit(POST_STEP);
            emitter.emit(POST_RENDER);
        }
        const recording = e2eHooks.stopFrameRecording();

        expect(emitter.listenerCounts()).toEqual([0, 0, 0]);
        expect(recording.frames).toBe(2);
        // Replacing the global PerformanceObserver passed to createFrameRecorder in E2EHooks with undefined fails these
        expect(recording.longTasks.supported).toBe(true);
        expect(FakeObserverClass.instances).toHaveLength(1);
        expect(FakeObserverClass.instances[0].disconnected).toBe(true);
    });
});
