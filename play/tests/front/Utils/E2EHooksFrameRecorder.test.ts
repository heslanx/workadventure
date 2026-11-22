// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterAll, describe, expect, it, vi } from "vitest";

// E2EHooks reaches the game through the game manager and the media stores, which pull in the whole front end.
// The fake PerformanceObserver is stubbed before E2EHooks loads, since e2eHooks reads the global at module load.
const { events, renderer, FakeObserverClass } = vi.hoisted(() => {
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
    // The scene's event emitter, set by each test before the hooks read it.
    const events: { current: unknown } = { current: undefined };
    // The renderer's GL context, when a test gives the game one.
    const renderer: { gl: unknown } = { gl: undefined };
    return { events, renderer, FakeObserverClass };
});
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => ({
            game: { events: events.current, renderer: renderer.gl === undefined ? undefined : { gl: renderer.gl } },
        }),
    },
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
import { createFakeTimerGl } from "./fakeTimerGl";

const { PRE_STEP, POST_STEP, PRE_RENDER, POST_RENDER } = Phaser.Core.Events;
const FRAME_EVENTS = [PRE_STEP, POST_STEP, PRE_RENDER, POST_RENDER];

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
        emitter.emit(PRE_RENDER);
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
        expect(summarizeFrameTimes(samples)).toEqual({ avg: 17.84, p50: 16, p95: 16, p99: 16, max: 200 });
    });

    it("does not reorder the samples it is given", () => {
        const samples = [30, 10, 20];

        summarizeFrameTimes(samples);

        // Reverting Float64Array.from(...) to sorting the argument in place reorders it
        expect(samples).toEqual([30, 10, 20]);
    });

    it("gives zeros for no samples and the sample itself for one", () => {
        expect(summarizeFrameTimes([])).toEqual({ avg: 0, p50: 0, p95: 0, p99: 0, max: 0 });
        expect(summarizeFrameTimes([7])).toEqual({ avg: 7, p50: 7, p95: 7, p99: 7, max: 7 });
    });
});

describe("frame recorder", () => {
    it("attaches nothing before start, one listener per frame event while recording and nothing after stop", () => {
        const { emitter, recorder } = setup();
        expect(emitter.listenerCounts()).toEqual([0, 0, 0, 0]);

        recorder.start(emitter);
        expect(emitter.listenerCounts()).toEqual([1, 1, 1, 1]);

        recorder.stop();
        // Reverting the events.off loop in stop() leaves the three listeners on the game
        expect(emitter.listenerCounts()).toEqual([0, 0, 0, 0]);
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
        expect(recording.intervalMs).toEqual({ avg: 26, p50: 17, p95: 35, p99: 35, max: 35 });
        expect(recording.stepMs).toEqual({ avg: 17 / 3, p50: 5, p95: 8, p99: 8, max: 8 });
        expect(recording.renderMs).toEqual({ avg: 6, p50: 6, p95: 10, p99: 10, max: 10 });
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
        expect(recording.workMs).toEqual({ avg: 20 / 3, p50: 7, p95: 10, p99: 10, max: 10 });
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
        expect(recording.intervalMs).toEqual({ avg: 16.5, p50: 16, p95: 17, p99: 17, max: 17 });
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
        expect(recording.renderMs).toEqual({ avg: 9, p50: 9, p95: 9, p99: 9, max: 9 });
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
        emitter.emit(PRE_RENDER);
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
        expect(emitter.listenerCounts()).toEqual([1, 1, 1, 1]);

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

    describe("GPU timer and frame budget (<= 11 ms average, no frame above 16.7 ms)", () => {
        const MS = 1_000_000;
        type FakeTimerGl = ReturnType<typeof createFakeTimerGl>;

        function recordFrames(gpuMs: (number | null)[], gl: FakeTimerGl | undefined, renderMsOf = (_i: number) => 3) {
            const { emitter, clock, recorder } = setup();
            recorder.start(emitter, gl?.gl);
            gpuMs.forEach((_, i) => playFrame(emitter, clock, { stepMs: 2, renderMs: renderMsOf(i) }));
            return recorder.stop();
        }
        const glWith = (flavor: "webgl2" | "webgl1", ms: (number | null)[], autoReady = true) =>
            createFakeTimerGl({ flavor, elapsedNs: ms.map((v) => (v === null ? null : v * MS)), autoReady });

        it.each([
            ["webgl2", "EXT_disjoint_timer_query_webgl2"],
            ["webgl1", "EXT_disjoint_timer_query"],
        ] as const)(
            "reports GPU statistics, coverage and the method on a %s context, and passes within budget",
            (flavor, method) => {
                const ms = [4, 8, 12];
                const gl = glWith(flavor, ms);

                const recording = recordFrames(ms, gl);

                // On a WebGL1 context (the one Phaser creates in this app) a recorder that only knows the WebGL2
                // extension reports gpuMs null here
                expect(recording.gpuMs).toMatchObject({
                    supported: true,
                    timedFrames: ms.length,
                    disjointFrames: 0,
                    avg: 8,
                    p50: 8,
                    p95: 12,
                    p99: 12,
                    max: 12,
                    samples: 3,
                    dropped: 0,
                    droppedRatio: 0,
                    coverage: 1,
                    method,
                    scope: expect.stringContaining("PRE_RENDER to POST_RENDER"),
                });
                expect(recording.gpuMethod).toBe(method);
                expect(recording.gpuUnavailableReason).toBeNull();
                expect(recording.budget).toMatchObject({
                    source: "gpu",
                    pass: true,
                    avgLimitMs: 11,
                    maxLimitMs: 16.7,
                    workOver16_7Ms: 0,
                    workOver11Ms: 0,
                    gpuOver16_7Ms: 0,
                    gpuOver11Ms: 1,
                    workPassed: true,
                    gpuPassed: true,
                });
                expect(gl.liveQueries()).toBe(0);
            },
        );

        it("fails the budget on the average alone when no frame is above 16.7 ms", () => {
            const ms = [12, 12, 12];

            const { gpuMs, budget } = recordFrames(ms, glWith("webgl2", ms));

            expect(gpuMs?.avg).toBe(12);
            expect(budget).toMatchObject({ gpuOver16_7Ms: 0, gpuOver11Ms: 3, gpuPassed: false });
        });

        it("fails the budget on one frame above 16.7 ms alone when the average is within 11 ms", () => {
            const ms = [1, 1, 1, 1, 1, 1, 1, 1, 1, 17];

            const { gpuMs, budget } = recordFrames(ms, glWith("webgl2", ms));

            expect(gpuMs?.avg).toBeLessThanOrEqual(11);
            expect(gpuMs?.max).toBe(17);
            expect(budget).toMatchObject({ gpuOver16_7Ms: 1, gpuOver11Ms: 1, gpuPassed: false });
        });

        it("counts work frames over 11 ms and over 16.7 ms separately, and fails work on the max alone", () => {
            const renderMs = [1, 1, 1, 1, 1, 1, 1, 1, 1, 20];

            const { workMs, budget } = recordFrames(renderMs, undefined, (i) => renderMs[i]);

            expect(workMs.avg).toBeLessThanOrEqual(11);
            expect(budget).toMatchObject({ workOver16_7Ms: 1, workOver11Ms: 1, workPassed: false });
        });

        it("fails the work budget on the average alone: every frame between 12 and 16 ms, none above 16.7 ms", () => {
            // Step 2 ms plus render 10 to 13 ms: work 12 to 15 ms. Dropping the average term from workPassed passes it.
            const renderMs = [10, 11, 12, 13, 12, 11, 12, 13];

            const { workMs, budget } = recordFrames(renderMs, undefined, (i) => renderMs[i]);

            expect(workMs.avg).toBeGreaterThan(11);
            expect(workMs.max).toBeLessThanOrEqual(16.7);
            expect(budget).toMatchObject({ workOver16_7Ms: 0, workOver11Ms: renderMs.length, workPassed: false });
        });

        it("reports gpuMs null and no GPU pass when the context has no timer extension, keeping the other stats", () => {
            const gl = createFakeTimerGl({ flavor: "none" });

            const recording = recordFrames([0, 0], gl);

            // The previous report said gpuPassed true here, with zeros for every GPU statistic
            expect(recording.gpuMs).toBeNull();
            expect(recording.gpuMethod).toBeNull();
            expect(recording.gpuUnavailableReason).toBe("extension-missing");
            expect(recording.budget).toMatchObject({ gpuPassed: null, gpuOver16_7Ms: null, gpuOver11Ms: null });
            expect(recording.workMs.avg).toBe(5);
            expect(recording.budget.workPassed).toBe(true);
            expect(recording.frames).toBe(2);
        });

        it("reports gpuMs null with its reason when there is no GL context at all", () => {
            const recording = recordFrames([0], undefined);

            expect(recording.gpuMs).toBeNull();
            expect(recording.gpuUnavailableReason).toBe("no-webgl-context");
            expect(recording.budget.gpuPassed).toBeNull();
        });

        it("reports gpuMs null, not zeros, when a timer exists but every sample was dropped", () => {
            const ms = [5, 5, 5];
            const gl = glWith("webgl2", ms, false);
            const { emitter, clock, recorder } = setup();
            recorder.start(emitter, gl.gl);
            playFrame(emitter, clock, { stepMs: 2, renderMs: 3 });
            playFrame(emitter, clock, { stepMs: 2, renderMs: 3 });
            playFrame(emitter, clock, { stepMs: 2, renderMs: 3 });
            gl.finishAll();
            gl.raiseDisjoint();
            const recording = recorder.stop();

            expect(recording.gpuMs).toBeNull();
            expect(recording.gpuMethod).toBe("EXT_disjoint_timer_query_webgl2");
            expect(recording.gpuUnavailableReason).toBe("no-samples");
            expect(recording.gpuDropped).toBe(3);
            expect(recording.budget.gpuPassed).toBeNull();
        });

        it("does not judge the GPU budget when fewer than 90% of the rendered frames were measured", () => {
            const ms = [5, 5, 5, 5];
            const gl = glWith("webgl2", ms, false);
            const { emitter, clock, recorder } = setup();
            recorder.start(emitter, gl.gl);
            for (let i = 0; i < 4; i++) {
                playFrame(emitter, clock, { stepMs: 2, renderMs: 3 });
                if (i === 0) gl.finishOldest(1);
            }
            const recording = recorder.stop();

            // Without the coverage rule one early good sample out of four frames passes the budget
            expect(recording.gpuMs).toMatchObject({ samples: 1, dropped: 3, coverage: 0.25, droppedRatio: 0.75 });
            expect(recording.budget.gpuPassed).toBeNull();
        });

        it("reports no work verdict for a recording without frames", () => {
            const { emitter, recorder } = setup();
            recorder.start(emitter);

            const recording = recorder.stop();

            // An empty series has an average of 0 and no frame over the limit, which used to read as a pass
            expect(recording.budget.workPassed).toBeNull();
        });

        it("reports no verdict when the recording outgrew its buffer", () => {
            const { emitter, clock, recorder } = setup({ capacity: 2 });
            recorder.start(emitter);
            for (let i = 0; i < 3; i++) playFrame(emitter, clock, { stepMs: 1, renderMs: 1 });

            const recording = recorder.stop();

            expect(recording.truncated).toBe(true);
            expect(recording.budget.workPassed).toBeNull();
        });

        it("measures a frame that rendered right after one that stepped without rendering", () => {
            const gl = glWith("webgl2", [6]);
            const { emitter, clock, recorder } = setup();
            recorder.start(emitter, gl.gl);
            playFrame(emitter, clock, { stepMs: 2 });
            playFrame(emitter, clock, { stepMs: 2, renderMs: 3 });

            const recording = recorder.stop();

            // The skipped render never began a GPU query.
            expect(recording.gpuMs).toMatchObject({ samples: 1, avg: 6, dropped: 0, coverage: 1 });
        });
    });
});

describe("e2eHooks frame recording", () => {
    it("takes the GPU timer from the game's renderer context", () => {
        const emitter = new FakeEmitter();
        events.current = emitter;
        fakeObserverClass();
        renderer.gl = createFakeTimerGl({ flavor: "webgl1", elapsedNs: [6_000_000] }).gl;
        try {
            e2eHooks.startFrameRecording();
            emitter.emit(PRE_STEP);
            emitter.emit(POST_STEP);
            emitter.emit(PRE_RENDER);
            emitter.emit(POST_RENDER);
            const recording = e2eHooks.stopFrameRecording();

            // Passing no context from currentWebGLContext leaves gpuMs null
            expect(recording.gpuMs).toMatchObject({ samples: 1, avg: 6, method: "EXT_disjoint_timer_query" });
        } finally {
            renderer.gl = undefined;
        }
    });

    it("listens on the current scene's game only between startFrameRecording and stopFrameRecording", () => {
        const emitter = new FakeEmitter();
        events.current = emitter;
        fakeObserverClass();
        expect(emitter.listenerCounts()).toEqual([0, 0, 0, 0]);

        e2eHooks.startFrameRecording();
        expect(emitter.listenerCounts()).toEqual([1, 1, 1, 1]);
        for (let frame = 0; frame < 2; frame++) {
            emitter.emit(PRE_STEP);
            emitter.emit(POST_STEP);
            emitter.emit(PRE_RENDER);
            emitter.emit(POST_RENDER);
        }
        const recording = e2eHooks.stopFrameRecording();

        expect(emitter.listenerCounts()).toEqual([0, 0, 0, 0]);
        expect(recording.frames).toBe(2);
        // Replacing the global PerformanceObserver passed to createFrameRecorder in E2EHooks with undefined fails these
        expect(recording.longTasks.supported).toBe(true);
        expect(FakeObserverClass.instances).toHaveLength(1);
        expect(FakeObserverClass.instances[0].disconnected).toBe(true);
    });
});
