import { afterEach, describe, expect, it, vi } from "vitest";
import { startFrameBench, FRAME_BENCH_WINDOW } from "../../../src/front/Utils/FrameBench";
import type { FrameBenchAvatarCounts, FrameBenchEvents } from "../../../src/front/Utils/FrameBench";
import { createFakeTimerGl } from "./fakeTimerGl";

const PRE_STEP = "prestep";
const POST_STEP = "poststep";
const POST_RENDER = "postrender";
const MS = 1_000_000;
const TEXTURE_2D = 0x0de1;
const RGBA = 0x1908;
const UNSIGNED_BYTE = 0x1401;
const MAP = { width: 2752, height: 1792 };
const COUNTS: FrameBenchAvatarCounts = {
    activeFullAvatars: 80,
    activeDotAvatars: 700,
    culledAvatars: 219,
    bakedAvatarTextures: 48,
};

class Emitter implements FrameBenchEvents {
    private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    on(event: string, listener: (...args: unknown[]) => void): this {
        this.listeners.set(event, (this.listeners.get(event) ?? new Set()).add(listener));
        return this;
    }
    off(event: string, listener: (...args: unknown[]) => void): this {
        this.listeners.get(event)?.delete(listener);
        return this;
    }
    emit(event: string, ...args: unknown[]): void {
        for (const listener of [...(this.listeners.get(event) ?? [])]) {
            listener(...args);
        }
    }
    count(): number {
        return [...this.listeners.values()].reduce((total, set) => total + set.size, 0);
    }
}

/** A fake GL that can time (webgl1 or webgl2 flavor, or none) and that counts the uploads it receives. */
function setup(
    options: {
        flavor?: "webgl2" | "webgl1" | "none";
        gpuMs?: (number | null)[];
        autoReady?: boolean;
        postFilterActive?: () => boolean;
    } = {},
) {
    const timer = createFakeTimerGl({
        flavor: options.flavor ?? "webgl2",
        elapsedNs: (options.gpuMs ?? []).map((ms) => (ms === null ? null : ms * MS)),
        autoReady: options.autoReady ?? true,
    });
    const uploads: unknown[][] = [];
    const gl = Object.assign(timer.gl, {
        texImage2D: (...args: unknown[]) => {
            uploads.push(args);
        },
        texSubImage2D: (...args: unknown[]) => {
            uploads.push(args);
        },
    });
    const originalTexImage2D = gl.texImage2D;
    const emitter = new Emitter();
    let now = 0;
    const bench = startFrameBench({
        events: emitter,
        eventNames: { preStep: PRE_STEP, preRender: "prerender", postStep: POST_STEP, postRender: POST_RENDER },
        gl,
        now: () => now,
        mapSize: MAP,
        counts: () => COUNTS,
        postFilterActive: options.postFilterActive,
    });
    /** One frame whose requestAnimationFrame timestamp is `at`, with an upload of `rgbaPixels` during it. */
    const frame = (at: number, upload?: { width: number; height: number; data?: null }) => {
        now = at;
        emitter.emit(PRE_STEP, at);
        if (upload) {
            // CPU data unless the caller asks for an allocation (null data), which is how Phaser makes a render target
            const data = upload.data === null ? null : new Uint8Array(0);
            gl.texImage2D(TEXTURE_2D, 0, RGBA, upload.width, upload.height, 0, RGBA, UNSIGNED_BYTE, data);
        }
        emitter.emit(POST_STEP);
        emitter.emit("prerender");
        emitter.emit(POST_RENDER);
    };
    return { bench, emitter, frame, timer, gl, uploads, originalTexImage2D };
}

describe("rolling frame bench", () => {
    it("reports the last 300 frames: a slow start has scrolled out after 300 fast ones", () => {
        const { bench, frame } = setup();
        // 51 timestamps 100 ms apart make 50 slow intervals; 300 timestamps 16 ms after them make 300 fast ones
        const slowEnd = 50 * 100;
        for (let i = 0; i <= 50; i++) frame(i * 100);
        for (let i = 1; i <= 300; i++) frame(slowEnd + i * 16);
        const reading = bench.snapshot();

        expect(FRAME_BENCH_WINDOW).toBe(300);
        expect(reading.frames).toBe(300);
        expect(reading.avgFrameMs).toBeCloseTo(16, 9);
        expect(reading.maxFrameMs).toBeCloseTo(16, 9);
    });

    it("reports average, p99 and max of the frame interval over the window", () => {
        const { bench, frame } = setup();
        // 100 intervals: 98 of 10 ms, then 20 ms and 50 ms. Average (980 + 70) / 100 = 10.5; nearest-rank p99 is
        // the 99th of 100 sorted values = 20; max 50
        let at = 0;
        frame(at);
        for (let i = 0; i < 98; i++) frame((at += 10));
        frame((at += 20));
        frame((at += 50));
        const reading = bench.snapshot();

        expect(reading.frames).toBe(100);
        expect(reading.avgFrameMs).toBeCloseTo(10.5, 9);
        expect(reading.p99FrameMs).toBe(20);
        expect(reading.maxFrameMs).toBe(50);
    });

    it("reports GPU average, p95, p99 and max from a WebGL2 timer, and the avatar counts of the moment", () => {
        const gpuMs = Array.from({ length: 100 }, (_, i) => i + 1);
        const { bench, frame } = setup({ flavor: "webgl2", gpuMs });
        for (let i = 0; i <= 100; i++) frame(i * 16);
        const reading = bench.snapshot();

        // 7 frames are still in flight at the stop of the recording: samples are those resolved so far
        expect(reading.gpuTimer).toBe("webgl2");
        expect(reading.gpuSamples).toBeGreaterThan(90);
        expect(reading.avgGpuMs).toBeCloseTo((reading.gpuSamples + 1) / 2, 9);
        expect(reading.maxGpuMs).toBe(reading.gpuSamples);
        expect(reading.p95GpuMs).toBe(Math.ceil(0.95 * reading.gpuSamples));
        expect(reading.p99GpuMs).toBe(Math.ceil(0.99 * reading.gpuSamples));
        expect(reading).toMatchObject(COUNTS);
    });

    it("names the WebGL1 extension, which is the context Phaser creates", () => {
        const { bench, frame } = setup({ flavor: "webgl1", gpuMs: [5, 5, 5] });
        for (let i = 0; i < 5; i++) frame(i * 16);

        expect(bench.snapshot().gpuTimer).toBe("webgl1-ext");
    });

    it("reports null GPU figures, never 0, and gpuTimer none when the context has no timer", () => {
        const { bench, frame } = setup({ flavor: "none" });
        for (let i = 0; i < 5; i++) frame(i * 16);
        const reading = bench.snapshot();

        expect(reading.gpuTimer).toBe("none");
        expect([reading.avgGpuMs, reading.p95GpuMs, reading.p99GpuMs, reading.maxGpuMs]).toEqual([
            null,
            null,
            null,
            null,
        ]);
        expect(reading.frames).toBe(4);
        expect(reading.gpuSamples).toBe(0);
    });

    it("reports nothing before the second frame: no statistic is 0", () => {
        const { bench, frame } = setup({ gpuMs: [5] });
        frame(0);
        const reading = bench.snapshot();

        expect(reading.frames).toBe(0);
        expect(reading.avgFrameMs).toBeNull();
        expect(reading.p99FrameMs).toBeNull();
        expect(reading.maxFrameMs).toBeNull();
        expect(reading.mirrorUploadBytesPerSec).toBeNull();
    });

    it("drops a disjoint frame, counts it, and keeps it out of the GPU statistics", () => {
        const { bench, frame, timer } = setup({ gpuMs: [4, 4, 4, 4, 4, 4, 4, 4], autoReady: false });
        // Three frames end and their queries wait for the GPU
        frame(0);
        frame(16);
        frame(32);
        timer.raiseDisjoint();
        timer.finishAll();
        frame(48);
        frame(64);
        timer.finishAll();
        frame(80);
        const reading = bench.snapshot();

        // The three queries in flight at the disjoint event were discarded; none of them is a 0 ms or 4 ms sample
        expect(reading.gpuDroppedFrames).toBe(3);
        expect(reading.gpuSamples).toBe(2);
    });

    describe("uploads", () => {
        it("divides the bytes of the window by its duration", () => {
            const { bench, frame } = setup();
            // 11 timestamps 20 ms apart: 10 intervals of 20 ms = 200 ms. One 10 x 100 RGBA upload = 4000 bytes
            for (let i = 0; i <= 10; i++) frame(i * 20, i === 5 ? { width: 10, height: 100 } : undefined);

            expect(bench.snapshot().mirrorUploadBytesPerSec).toBe(20_000);
        });

        it("counts the uploads of the whole map, and only those, since the bench started, whatever scrolled out", () => {
            const { bench, frame } = setup();
            frame(0);
            frame(16, { width: MAP.width, height: MAP.height });
            frame(32, { width: 64, height: MAP.height });
            frame(48, { width: MAP.width, height: 64 });
            for (let i = 4; i < 4 + 310; i++) frame(i * 16);
            const reading = bench.snapshot();

            expect(reading.fullMapUploads).toBe(1);
            // The big upload is 310 frames old: out of the window, so the rate is zero, not null
            expect(reading.mirrorUploadBytesPerSec).toBe(0);
        });
    });

    describe("large uploads and allocations", () => {
        it("counts the real mirror atlas (2752 x 384 RGBA, 4.2 MB) as a large upload although it is not a whole map", () => {
            const { bench, frame } = setup();
            frame(0);
            // The shape SceneEffects.buildMirror makes for the 3 glass rows of the konclui-office: mapW x rows * 128
            frame(16, { width: MAP.width, height: 384 });
            frame(32, { width: 64, height: 64 });
            const reading = bench.snapshot();

            // Seen failing before this counter existed: fullMapUploads stayed 0 for this upload, so the gate passed
            expect(reading.fullMapUploads).toBe(0);
            expect(reading.largeUploads).toBe(1);
            expect(reading.largestUploadBytes).toBe(2752 * 384 * 4);
        });

        it("draws the line at 1 MiB in one call: a 512 x 511 RGBA upload is under it, 512 x 512 (exactly 1 MiB) counts", () => {
            const { bench, frame } = setup();
            frame(0);
            frame(16, { width: 512, height: 511 });
            expect(bench.snapshot().largeUploads).toBe(0);
            frame(32, { width: 512, height: 512 });

            expect(bench.snapshot().largeUploads).toBe(1);
        });

        it("keeps an allocation without data out of the upload bytes and the upload counts, and counts it apart", () => {
            const { bench, frame } = setup();
            frame(0);
            // A render target the size of the whole map: allocated, nothing handed over by the CPU
            frame(16, { width: MAP.width, height: MAP.height, data: null });
            frame(32);
            const reading = bench.snapshot();

            expect(reading.allocations).toBe(1);
            expect(reading.fullMapUploads).toBe(0);
            expect(reading.largeUploads).toBe(0);
            expect(reading.largestUploadBytes).toBe(0);
            expect(reading.mirrorUploadBytesPerSec).toBe(0);
        });
    });

    describe("the post pass", () => {
        it("reports the share of the rendered frames in which the post pass was active, and the counts behind it", () => {
            let active = false;
            const { bench, frame } = setup({ postFilterActive: () => active });
            // 10 rendered frames, the pass on in 4 of them
            for (let i = 0; i < 10; i++) {
                active = i % 5 < 2;
                frame(i * 16);
            }
            const reading = bench.snapshot();

            expect(reading.renderedFrames).toBe(10);
            expect(reading.postFilterFrames).toBe(4);
            expect(reading.postFilterShare).toBe(0.4);
        });

        it("keeps the share of the last 300 rendered frames only", () => {
            let active = false;
            const { bench, frame } = setup({ postFilterActive: () => active });
            for (let i = 0; i < 50; i++) frame(i * 16);
            active = true;
            for (let i = 50; i < 350; i++) frame(i * 16);

            expect(bench.snapshot().postFilterShare).toBe(1);
        });

        it("says null, never 1 or 0, when nothing samples the pass or nothing has rendered", () => {
            const without = setup();
            for (let i = 0; i < 3; i++) without.frame(i * 16);
            const none = setup({ postFilterActive: () => true });

            expect(without.bench.snapshot()).toMatchObject({ postFilterShare: null, postFilterFrames: null });
            expect(none.bench.snapshot()).toMatchObject({ postFilterShare: null, renderedFrames: 0 });
        });
    });

    describe("a start that fails", () => {
        const options = (gl: object) => ({
            events: new Emitter(),
            eventNames: { preStep: PRE_STEP, preRender: "prerender", postStep: POST_STEP, postRender: POST_RENDER },
            gl: gl as never,
            now: () => 0,
            mapSize: MAP,
            counts: () => COUNTS,
        });

        it("leaves a context that is already watched untouched: no draw wrapper and no GPU query", () => {
            const timer = createFakeTimerGl({ flavor: "webgl2", elapsedNs: [] });
            const drawArrays = () => undefined;
            const gl = Object.assign(timer.gl, {
                drawArrays,
                texImage2D: () => undefined,
                texSubImage2D: () => undefined,
            });
            const first = startFrameBench(options(gl));
            const wrapped = gl.drawArrays;

            // Seen failing when the draw wrappers and the query pool were made before the watch: both stayed behind
            expect(() => startFrameBench(options(gl))).toThrow("already being counted");

            expect(gl.drawArrays).toBe(wrapped);
            expect(timer.liveQueries()).toBe(8);
            first.stop();
            expect(gl.drawArrays).toBe(drawArrays);
            expect(timer.liveQueries()).toBe(0);
        });

        it("puts the context back when the GPU timer cannot be set up", () => {
            const drawArrays = () => undefined;
            const texImage2D = () => undefined;
            const gl = {
                drawArrays,
                texImage2D,
                texSubImage2D: () => undefined,
                getExtension: () => {
                    throw new Error("context lost");
                },
            };

            expect(() => startFrameBench(options(gl))).toThrow("context lost");

            expect(gl.drawArrays).toBe(drawArrays);
            expect(gl.texImage2D).toBe(texImage2D);
        });
    });

    describe("stopAfterGpu", () => {
        afterEach(() => {
            vi.useRealTimers();
            vi.unstubAllGlobals();
        });

        it("ends, and releases the queries it could not read, in a tab whose requestAnimationFrame never fires", async () => {
            vi.useFakeTimers();
            // A hidden or throttled tab: the callback is never called
            vi.stubGlobal("requestAnimationFrame", () => 0);
            const { bench, frame, timer } = setup({ gpuMs: [4, 4, 4], autoReady: false });
            frame(0);
            frame(16);
            frame(32);

            // Seen failing without the setTimeout beside the frame request: this promise never resolved
            const stopping = bench.stopAfterGpu();
            await vi.advanceTimersByTimeAsync(1200);
            const reading = await stopping;

            expect(reading.frames).toBe(2);
            expect(reading.gpuSamples).toBe(0);
            expect(timer.liveQueries()).toBe(0);
        });
    });

    describe("stop", () => {
        it("detaches every listener, puts the upload method back and releases every GPU query", () => {
            const { bench, emitter, frame, timer, gl, originalTexImage2D } = setup({ gpuMs: [5, 5, 5, 5] });
            for (let i = 0; i < 4; i++) frame(i * 16);
            expect(gl.texImage2D).not.toBe(originalTexImage2D);

            const last = bench.stop();

            expect(emitter.count()).toBe(0);
            expect(gl.texImage2D).toBe(originalTexImage2D);
            expect(timer.liveQueries()).toBe(0);
            expect(last.frames).toBe(3);
            // Four frames rendered, so four queries were measured; three intervals separate their timestamps
            expect(last.gpuSamples).toBe(4);
        });

        it("does not read the frames that come after it", () => {
            const { bench, frame } = setup();
            frame(0);
            frame(16);
            bench.stop();
            frame(32);

            expect(bench.snapshot().frames).toBe(1);
        });
    });
});

describe("draw call counter", () => {
    const TRIANGLES = 4;

    /**
     * A WebGL1-shaped context as Phaser 4 leaves it: drawArrays and drawElements live on the prototype (as they do on
     * a real context), the instanced draws are own properties bound to ANGLE_instanced_arrays (WebGLRenderer.js binds
     * them onto the context), and the timer is EXT_disjoint_timer_query.
     */
    function webgl1Context(gpuMs: number[] = []) {
        const timer = createFakeTimerGl({ flavor: "webgl1", elapsedNs: gpuMs.map((ms) => ms * MS) });
        const angle = {
            drawArraysInstancedANGLE: () => undefined,
            drawElementsInstancedANGLE: () => undefined,
        };
        const prototype = { drawArrays: () => undefined, drawElements: () => undefined };
        const gl = Object.assign(Object.create(prototype) as object, timer.gl, {
            drawArraysInstanced: angle.drawArraysInstancedANGLE.bind(angle),
            drawElementsInstanced: angle.drawElementsInstancedANGLE.bind(angle),
            texImage2D: () => undefined,
            texSubImage2D: () => undefined,
        }) as unknown as GL;
        return { gl, prototype, timer, bound: gl.drawArraysInstanced };
    }
    type GL = ReturnType<typeof createFakeTimerGl>["gl"] & {
        drawArrays: (mode: number, first: number, count: number) => void;
        drawElements: (mode: number, count: number, type: number, offset: number) => unknown;
        drawArraysInstanced: (mode: number, first: number, count: number, instances: number) => void;
        drawElementsInstanced: (mode: number, count: number, type: number, offset: number, instances: number) => void;
        texImage2D: () => void;
        texSubImage2D: () => void;
    };

    function benchOn(gl: object) {
        const emitter = new Emitter();
        const bench = startFrameBench({
            events: emitter,
            eventNames: { preStep: PRE_STEP, preRender: "prerender", postStep: POST_STEP, postRender: POST_RENDER },
            gl: gl as never,
            now: () => 0,
            mapSize: MAP,
            counts: () => COUNTS,
        });
        /** One frame at timestamp `at` that issues `draws` calls of each of the four draw methods, in the render step. */
        const frame = (at: number, draws: number) => {
            emitter.emit(PRE_STEP, at);
            emitter.emit(POST_STEP);
            emitter.emit("prerender");
            const context = gl as GL;
            for (let i = 0; i < draws; i++) {
                context.drawArrays(TRIANGLES, 0, 3);
                context.drawElements(TRIANGLES, 6, 0, 0);
                context.drawArraysInstanced(TRIANGLES, 0, 3, 2);
                context.drawElementsInstanced(TRIANGLES, 6, 0, 0, 2);
            }
            emitter.emit(POST_RENDER);
        };
        return { bench, frame, emitter };
    }

    it("counts drawArrays, drawElements and both instanced forms of a WebGL1 context, per frame", () => {
        const { gl } = webgl1Context();
        const { bench, frame } = benchOn(gl);

        // Frames of 1, 2 and 3 groups of four calls: 4, 8 and 12 calls. The last frame is still open at the reading
        frame(0, 1);
        frame(16, 2);
        frame(32, 3);
        frame(48, 0);
        const reading = bench.snapshot();

        expect(reading.frames).toBe(3);
        expect(reading.drawCalls).toMatchObject({ avg: 8, max: 12 });
    });

    it("reports a window's average and maximum from the frames in it, not from every frame since the start", () => {
        const { gl } = webgl1Context();
        const { bench, frame } = benchOn(gl);

        // One heavy frame of 400 calls, then 300 plain ones of 4: the heavy one has left the window of 300
        frame(0, 100);
        for (let i = 1; i <= 301; i++) frame(i * 16, 1);
        const reading = bench.snapshot();

        expect(reading.frames).toBe(FRAME_BENCH_WINDOW);
        expect(reading.drawCalls).toMatchObject({ avg: 4, max: 4 });
    });

    it("counts nothing before the first frame and nothing after it stops", () => {
        const { gl } = webgl1Context();
        gl.drawArrays(TRIANGLES, 0, 3);
        const { bench, frame } = benchOn(gl);
        // Calls before the first step belong to no frame of the window
        gl.drawArrays(TRIANGLES, 0, 3);
        frame(0, 1);
        frame(16, 1);
        const stopped = bench.stop();
        // Seen failing when the wrapper was left on the context: these calls would have counted
        gl.drawArrays(TRIANGLES, 0, 3);
        gl.drawElements(TRIANGLES, 6, 0, 0);
        frame(32, 5);

        expect(stopped.drawCalls).toMatchObject({ avg: 4, max: 4 });
        expect(bench.snapshot().drawCalls).toEqual(stopped.drawCalls);
    });

    it("puts the context back: the prototype's methods are used again, the bound instanced ones are the same functions", () => {
        const { gl, prototype, bound } = webgl1Context();
        const boundElements = gl.drawElementsInstanced;
        const { bench } = benchOn(gl);

        expect(Object.hasOwn(gl, "drawArrays")).toBe(true);
        expect(gl.drawArraysInstanced).not.toBe(bound);
        bench.stop();

        // A wrapper left as an own property would shadow the prototype for the rest of the page's life
        expect(Object.hasOwn(gl, "drawArrays")).toBe(false);
        expect(Object.hasOwn(gl, "drawElements")).toBe(false);
        expect(gl.drawArrays).toBe(prototype.drawArrays);
        expect(gl.drawElements).toBe(prototype.drawElements);
        expect(gl.drawArraysInstanced).toBe(bound);
        expect(gl.drawElementsInstanced).toBe(boundElements);
    });

    it("passes every argument and the return value through, and keeps `this`", () => {
        const calls: { self: unknown; args: unknown[] }[] = [];
        const gl = Object.assign(createFakeTimerGl({ flavor: "webgl1" }).gl, {
            texImage2D: () => undefined,
            texSubImage2D: () => undefined,
            drawElements(this: unknown, ...args: unknown[]) {
                calls.push({ self: this, args });
                return "result";
            },
        });
        benchOn(gl);

        const result = (gl as unknown as GL).drawElements(TRIANGLES, 6, 5123, 12);

        expect(result).toBe("result");
        expect(calls).toEqual([{ self: gl, args: [TRIANGLES, 6, 5123, 12] }]);
    });

    it("has no draw figures, rather than zeros, on a context without draw methods", () => {
        const { bench, frame } = setup();
        for (let i = 0; i < 4; i++) frame(i * 16);

        expect(bench.snapshot().drawCalls).toBeNull();
    });

    it("keeps the WebGL1 timer on the same context: the extension that is named, the samples that are read", () => {
        const { gl, timer } = webgl1Context([5, 5, 5, 5, 5]);
        const { bench, frame } = benchOn(gl);
        for (let i = 0; i < 5; i++) frame(i * 16, 2);
        const reading = bench.snapshot();

        // The WebGL2 extension is looked up first and absent on this context: the fallback is the one that measures
        expect(timer.gl.getExtension("EXT_disjoint_timer_query_webgl2")).toBeNull();
        expect(reading.gpuTimer).toBe("webgl1-ext");
        expect(reading.gpuSamples).toBeGreaterThan(0);
        expect(reading.avgGpuMs).toBe(5);
        expect(reading.drawCalls).toMatchObject({ avg: 8, max: 8 });
        bench.stop();
        expect(timer.liveQueries()).toBe(0);
    });

    it("reports gpuTimer none on a WebGL1 context without EXT_disjoint_timer_query, and still counts the draws", () => {
        const timer = createFakeTimerGl({ flavor: "none" });
        const gl = Object.assign(Object.create({ drawArrays: () => undefined }) as object, timer.gl, {
            texImage2D: () => undefined,
            texSubImage2D: () => undefined,
            drawElements: () => undefined,
            drawArraysInstanced: () => undefined,
            drawElementsInstanced: () => undefined,
        });
        const { bench, frame } = benchOn(gl);
        for (let i = 0; i < 3; i++) frame(i * 16, 1);
        const reading = bench.snapshot();

        expect(reading.gpuTimer).toBe("none");
        expect(reading.avgGpuMs).toBeNull();
        expect(reading.drawCalls).toMatchObject({ avg: 4, max: 4 });
    });
});
