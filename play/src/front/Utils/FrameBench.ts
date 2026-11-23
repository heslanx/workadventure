import { summarizeFrameTimes, type E2EFrameStats } from "./FrameStats";
import {
    createGpuFrameTimer,
    GPU_TIMER_EXTENSION_WEBGL2,
    type GpuFrameTimer,
    type GpuTimerContext,
} from "./GpuFrameTimer";
import { watchTextureUploads, type TextureUpload } from "./GlTextureUploads";

/**
 * The rolling frame bench of window.e2eHooks.getFrameBench(): the last 300 frames of the running game, read at any
 * moment without stopping. It exists for the 1,000-user gate (benchmark/frame-probe gate1), where one number per
 * condition is judged: GPU time from a disjoint timer query, frame interval from the requestAnimationFrame timestamps,
 * and the bytes the CPU uploads to the GPU.
 *
 * What the numbers cover, so that none is quoted beyond it:
 * - A frame is one run of the game loop (PRE_STEP). Its interval is the time since the previous one: bounded below by
 *   the display refresh period, whatever the frame costs (16.7 ms at 60 Hz).
 * - GPU time is the GL work between PRE_RENDER and POST_RENDER of frames that rendered (see GpuFrameTimer). A query
 *   resolves a few frames after it ends, so the GPU window is the last 300 resolved samples and trails the frame
 *   window by at most the query pool (8 frames). Texture uploads done during the scene step, and the compositor work
 *   of the page, are outside it.
 * - Upload bytes are attributed to the frame during which they happened. They are bytes the CPU hands to the GPU; a
 *   texImage2D with no data (a render target being allocated) moves none, so it counts in `allocations` instead.
 *   fullMapUploads, largeUploads, largestUploadBytes, allocations and the dropped count are totals since the bench
 *   started, not window figures: an upload that scrolled out of the window still counts.
 * - postFilterShare is the share of the window's rendered frames in which the Koncluí post pass was active when the
 *   frame began to render. The pass is switched per refresh (a plain day with nobody mirrored runs without it), so a
 *   window can be lighter than the lit scene it is meant to measure; the share says by how much.
 * - `shading` is what the Koncluí shading did while the bench ran (bakes, bake slices, cast-texture uploads and their
 *   bytes, level changes), read from the counters the effects publish (see ShadingCounters); `shadingSinceNight` is the
 *   same since the last setBenchNight() call, so that an upload that fell between the hour switch and the window is seen
 *   too. Both are null in a room without the shading. They are totals since their start, like the upload counts, not
 *   window figures.
 * - The bench is not free on the main thread: while it runs, every draw call and texture upload of the game's context
 *   goes through a wrapper (a counter and a call). The frame interval and the CPU work of a frame include that cost,
 *   which grows with the draw count, so the 11 ms gate is quoted on the GPU time, which the wrapper does not touch.
 */

export const FRAME_BENCH_WINDOW = 300;

/**
 * An upload of this size or more in one call is a "large upload". The mirror atlas of the Koncluí office is
 * 2752 x 384 RGBA (4.2 MB) and the occlusion canvas half the map (4.9 MB); the avatar bakes and the textures of the
 * crowd are far under 1 MiB. A call this big during a measured window is a stall, whatever it uploads.
 */
export const LARGE_UPLOAD_BYTES = 1 << 20;

/**
 * What the Koncluí shading counts, published by the effects (Konclui/Ambience/phaser/shading.ts `counters()`) through
 * setShadingBenchSource(). `bakes`, `slices`, `uploads`, `uploadedBytes` and `levelChanges` are totals since the shading
 * was built; `level` and `marked` are its state now.
 */
export interface ShadingCounters {
    /** Whole bakes of the cast texture that went to the GPU. */
    bakes: number;
    /** Slices of bake run (one per frame while a bake is under way). */
    slices: number;
    /** Uploads of the cast texture, and their bytes (the CPU data handed to the GPU). */
    uploads: number;
    uploadedBytes: number;
    /** Times the shading level really changed (the governor's falls, the zoom's and the GPU's picks). */
    levelChanges: number;
    level: number;
    /** Avatars carrying a mark now. */
    marked: number;
}

/** The shading's counters over a stretch of time: the five totals as differences, the two states as at its end. */
export type ShadingActivity = ShadingCounters;

/** The difference of two readings of the same shading: counts since `from`, state as at `to`. */
export function shadingActivity(from: ShadingCounters, to: ShadingCounters): ShadingActivity {
    return {
        bakes: to.bakes - from.bakes,
        slices: to.slices - from.slices,
        uploads: to.uploads - from.uploads,
        uploadedBytes: to.uploadedBytes - from.uploadedBytes,
        levelChanges: to.levelChanges - from.levelChanges,
        level: to.level,
        marked: to.marked,
    };
}

export type ShadingCountersSource = () => ShadingCounters | null;

let shadingSource: ShadingCountersSource | undefined;
let nightMark: ShadingCounters | null = null;

/**
 * The effects of the scene publish their shading's counters here, so that the bench (an upstream file, which does not
 * import Koncluí) reads them without knowing what they are. One source at a time: a later scene replaces the earlier.
 */
export function setShadingBenchSource(source: ShadingCountersSource): void {
    shadingSource = source;
    nightMark = null;
}

/** Withdraws a source when its effects are destroyed; a source that was already replaced is left alone. */
export function clearShadingBenchSource(source: ShadingCountersSource): void {
    if (shadingSource !== source) return;
    shadingSource = undefined;
    nightMark = null;
}

/** The shading's counters now, or null in a room without the shading. */
export function readShadingCounters(): ShadingCounters | null {
    return shadingSource?.() ?? null;
}

/** Remembers the counters now: setBenchNight() calls this, so that the uploads it causes are counted from this moment. */
export function markShadingNight(): void {
    nightMark = readShadingCounters();
}

/** The counters at the last markShadingNight(), or null when there was none (or the shading was replaced since). */
export function readShadingNightMark(): ShadingCounters | null {
    return nightMark;
}

/** Which extension measures GPU time: WebGL2's, the WebGL1 one Phaser's default context needs, or none. */
export type FrameBenchGpuTimer = "webgl2" | "webgl1-ext" | "none";

/** Point-in-time counts of the avatars, read when the bench is read (not window figures). */
export interface FrameBenchAvatarCounts {
    activeFullAvatars: number;
    activeDotAvatars: number;
    culledAvatars: number;
    bakedAvatarTextures: number;
}

export interface E2EFrameBench extends FrameBenchAvatarCounts {
    /** Frames in the window, at most 300. Every other statistic is null while it is 0. */
    frames: number;
    frameMs: E2EFrameStats | null;
    workMs: E2EFrameStats | null;
    gpuMs: E2EFrameStats | null;
    drawCalls: E2EFrameStats | null;
    gpuTimer: FrameBenchGpuTimer;
    /** Null, never 0, when there is no timer or no resolved sample yet. */
    avgGpuMs: number | null;
    p95GpuMs: number | null;
    p99GpuMs: number | null;
    maxGpuMs: number | null;
    avgFrameMs: number | null;
    p99FrameMs: number | null;
    maxFrameMs: number | null;
    /** Bytes of texImage2D and texSubImage2D calls in the window, divided by the window's duration. */
    mirrorUploadBytesPerSec: number | null;
    /** Uploads since the bench started whose width and height are both at least the map's pixel size. */
    fullMapUploads: number;
    /** Uploads of CPU data since the bench started of at least LARGE_UPLOAD_BYTES in one call, whatever their shape. */
    largeUploads: number;
    /** The biggest single upload of CPU data since the bench started, in bytes (0 when there was none). */
    largestUploadBytes: number;
    /** Allocations without CPU data since the bench started (texImage2D with null data: render targets). */
    allocations: number;
    /** Rendered frames of the window, and how many of them had the post pass active. Null count: no sampler given. */
    renderedFrames: number;
    postFilterFrames: number | null;
    /** postFilterFrames / renderedFrames; null with no sampler or with no rendered frame. */
    postFilterShare: number | null;
    /** The shading's activity since the bench started (a fixed capture: the window); null without the shading. */
    shading: ShadingActivity | null;
    /** The shading's activity since the last setBenchNight() until now; null when there was none or no shading. */
    shadingSinceNight: ShadingActivity | null;
    /** GPU samples in the window: below `frames` when frames were dropped or are not resolved yet. */
    gpuSamples: number;
    /** Rendered frames since the bench started that produced no GPU sample (disjoint, no free query, failed read). */
    gpuDroppedFrames: number;
}

export interface FrameBenchEvents {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface FrameBenchEventNames {
    preStep: string;
    postStep: string;
    preRender: string;
    postRender: string;
}

export interface FrameBenchOptions {
    events: FrameBenchEvents;
    eventNames: FrameBenchEventNames;
    /** The renderer's WebGL context; without it there is no GPU time and no upload count. */
    gl: (GpuTimerContext & object) | null | undefined;
    now(): number;
    /** The map's size in px, to tell an upload of the whole map from a small one. */
    mapSize: { width: number; height: number };
    /** The avatar counts, read once per getFrameBench(). */
    counts(): FrameBenchAvatarCounts;
    /** Whether the post pass is active now. Called at every rendered frame: it must not allocate. */
    postFilterActive?(): boolean;
    /** The shading's counters now (null: none), read when the bench starts, when it is read and when it stops. */
    shading?(): ShadingCounters | null;
    /** The shading's counters when the night was last set (null: never), see markShadingNight(). */
    shadingNightMark?(): ShadingCounters | null;
    window?: number;
}

export interface FrameBench {
    snapshot(): E2EFrameBench;
    /** The last reading, with everything detached from the game and the context. */
    stop(): E2EFrameBench;
    stopAfterGpu(): Promise<E2EFrameBench>;
}

/** A fixed-size ring of numbers. Writing never allocates. */
class Ring {
    readonly values: Float64Array;
    private written = 0;

    constructor(capacity: number) {
        this.values = new Float64Array(capacity);
    }

    push(value: number): void {
        this.values[this.written % this.values.length] = value;
        this.written++;
    }

    get length(): number {
        return Math.min(this.written, this.values.length);
    }

    /** The values still in the ring, oldest first. */
    toArray(): Float64Array {
        const length = this.length;
        const out = new Float64Array(length);
        const first = this.written - length;
        for (let i = 0; i < length; i++) {
            out[i] = this.values[(first + i) % this.values.length];
        }
        return out;
    }
}

function timerLabel(timer: GpuFrameTimer | undefined): FrameBenchGpuTimer {
    if (timer === undefined) {
        return "none";
    }
    return timer.method === GPU_TIMER_EXTENSION_WEBGL2 ? "webgl2" : "webgl1-ext";
}

export function startFrameBench(options: FrameBenchOptions): FrameBench {
    // The upload watch goes first: it is the one step that can throw (a context already watched), and nothing else is
    // patched or allocated yet, so there is nothing to undo
    let onUpload: (upload: TextureUpload) => void = () => undefined;
    const stopWatching = options.gl ? watchTextureUploads(options.gl, (upload) => onUpload(upload)) : undefined;
    const windowSize = options.window ?? FRAME_BENCH_WINDOW;
    const intervals = new Ring(windowSize);
    const uploadBytes = new Ring(windowSize);
    const gpu = new Ring(windowSize);
    const work = new Ring(windowSize);
    const draws = new Ring(windowSize);
    const postFlags = new Ring(windowSize);
    let drawCount = 0;
    const restoreDrawCounters: (() => void)[] = [];
    const context = options.gl as Record<string, unknown> | undefined;
    for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
        const original = context?.[name];
        if (!context || typeof original !== "function") continue;
        const own = Object.getOwnPropertyDescriptor(context, name);
        const countDraw = function (this: object) {
            drawCount++;
            // eslint-disable-next-line prefer-rest-params -- avoid allocating a rest array for each measured GL draw.
            return Reflect.apply(original, this, arguments);
        };
        Object.defineProperty(context, name, { configurable: true, writable: true, value: countDraw });
        restoreDrawCounters.push(() => {
            if (context[name] !== countDraw) return;
            if (own) Object.defineProperty(context, name, own);
            else delete context[name];
        });
    }
    let started: number | undefined;
    let ended: number | undefined;
    const closeWork = () => {
        if (started !== undefined && ended !== undefined) work.push(ended - started);
        ended = undefined;
    };
    let gpuDroppedFrames = 0;
    let fullMapUploads = 0;
    let largeUploads = 0;
    let largestUploadBytes = 0;
    let allocations = 0;
    let bytesSinceLastFrame = 0;
    let previousTimestamp: number | undefined;
    const shadingAtStart = options.shading?.() ?? null;
    // Read when the bench is detached: the drain that follows a fixed capture must not count into the window
    let shadingAtEnd: ShadingCounters | null | undefined;

    let timer: GpuFrameTimer | undefined;
    try {
        timer = createGpuFrameTimer(options.gl, 0, {
            sample: (gpuMs) => gpu.push(gpuMs),
            dropped: (count) => {
                gpuDroppedFrames += count;
            },
        }).timer;
    } catch (error: unknown) {
        // Put back what this call patched before it throws
        stopWatching?.();
        for (const restore of restoreDrawCounters) restore();
        throw error;
    }

    onUpload = (upload) => {
        if (!upload.cpuData) {
            allocations++;
            return;
        }
        bytesSinceLastFrame += upload.bytes;
        largestUploadBytes = Math.max(largestUploadBytes, upload.bytes);
        if (upload.bytes >= LARGE_UPLOAD_BYTES) {
            largeUploads++;
        }
        if (upload.width >= options.mapSize.width && upload.height >= options.mapSize.height) {
            fullMapUploads++;
        }
    };

    const onPreStep = (time?: unknown) => {
        closeWork();
        timer?.poll();
        started = options.now();
        const timestamp = typeof time === "number" ? time : options.now();
        if (previousTimestamp !== undefined) {
            draws.push(drawCount);
            intervals.push(timestamp - previousTimestamp);
            uploadBytes.push(bytesSinceLastFrame);
        }
        // Uploads before the first frame belong to no frame of the window
        drawCount = 0;
        bytesSinceLastFrame = 0;
        previousTimestamp = timestamp;
    };
    const onPostStep = () => {
        ended = options.now();
    };
    const onPreRender = () => {
        if (started === undefined) return;
        timer?.begin();
        if (options.postFilterActive) postFlags.push(options.postFilterActive() ? 1 : 0);
    };
    const onPostRender = () => {
        timer?.end();
        ended = options.now();
    };
    const listeners: [string, (...args: unknown[]) => void][] = [
        [options.eventNames.preStep, onPreStep],
        [options.eventNames.postStep, onPostStep],
        [options.eventNames.preRender, onPreRender],
        [options.eventNames.postRender, onPostRender],
    ];
    for (const [event, listener] of listeners) {
        options.events.on(event, listener);
    }

    /** The shading's activity since `from`; null with no start reading, no shading now, or a shading replaced since. */
    const shadingSince = (from: ShadingCounters | null): ShadingActivity | null => {
        if (!from) return null;
        const to = shadingAtEnd === undefined ? (options.shading?.() ?? null) : shadingAtEnd;
        return to ? shadingActivity(from, to) : null;
    };

    const snapshot = (): E2EFrameBench => {
        const frameMs = intervals.toArray();
        const gpuMs = gpu.toArray();
        const frames = summarizeFrameTimes(frameMs);
        const gpuStats = summarizeFrameTimes(gpuMs);
        let durationMs = 0;
        let bytes = 0;
        const windowBytes = uploadBytes.toArray();
        for (let i = 0; i < frameMs.length; i++) {
            durationMs += frameMs[i];
            bytes += windowBytes[i];
        }
        const renderedFrames = postFlags.length;
        let postFilterFrames = 0;
        for (const flag of postFlags.toArray()) postFilterFrames += flag;
        return {
            ...options.counts(),
            frames: frameMs.length,
            drawCalls: draws.length && restoreDrawCounters.length ? summarizeFrameTimes(draws.toArray()) : null,
            frameMs: frameMs.length ? frames : null,
            workMs: work.length ? summarizeFrameTimes(work.toArray()) : null,
            gpuMs: gpuMs.length ? gpuStats : null,
            gpuTimer: timerLabel(timer),
            avgGpuMs: gpuMs.length === 0 ? null : gpuStats.avg,
            p95GpuMs: gpuMs.length === 0 ? null : gpuStats.p95,
            p99GpuMs: gpuMs.length === 0 ? null : gpuStats.p99,
            maxGpuMs: gpuMs.length === 0 ? null : gpuStats.max,
            avgFrameMs: frameMs.length === 0 ? null : frames.avg,
            p99FrameMs: frameMs.length === 0 ? null : frames.p99,
            maxFrameMs: frameMs.length === 0 ? null : frames.max,
            mirrorUploadBytesPerSec: durationMs > 0 ? bytes / (durationMs / 1000) : null,
            fullMapUploads,
            largeUploads,
            largestUploadBytes,
            allocations,
            renderedFrames,
            postFilterFrames: options.postFilterActive ? postFilterFrames : null,
            postFilterShare: options.postFilterActive && renderedFrames > 0 ? postFilterFrames / renderedFrames : null,
            shading: shadingSince(shadingAtStart),
            shadingSinceNight: shadingSince(options.shadingNightMark?.() ?? null),
            gpuSamples: gpuMs.length,
            gpuDroppedFrames,
        };
    };

    const detach = () => {
        shadingAtEnd ??= options.shading?.() ?? null;
        for (const [event, listener] of listeners) options.events.off(event, listener);
        closeWork();
        stopWatching?.();
        for (const restore of restoreDrawCounters) restore();
    };
    return {
        snapshot,
        stop() {
            detach();
            timer?.finish();
            return snapshot();
        },
        async stopAfterGpu() {
            detach();
            // Only outstanding queries are polled. No later frame enters this capture.
            const until = performance.now() + 1000;
            while (timer?.pendingCount && performance.now() < until) {
                // eslint-disable-next-line no-await-in-loop -- query availability must be checked on successive frames.
                await new Promise<void>((resolve) => {
                    // A hidden or throttled tab never fires requestAnimationFrame: the timeout keeps the drain moving
                    // so that it ends at `until` instead of hanging
                    const fallback = setTimeout(resolve, 100);
                    requestAnimationFrame(() => {
                        clearTimeout(fallback);
                        resolve();
                    });
                });
                timer.poll();
            }
            timer?.finish();
            return snapshot();
        },
    };
}
