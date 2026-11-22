import {
    emptyMetrics,
    type Condition,
    type ConditionSummary,
    type MetricSet,
    type RunRecord,
    type SessionMeasurement,
    type View,
} from "../../frame-probe/types";

export const GPU = "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)";
export const SWIFTSHADER =
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";

/** The reason the page gives when the browser has no GPU timer query (GpuTimerUnavailableReason). */
export const NO_GPU_TIMER = "extension-missing";

export const FX_ON_BUDGET_OFF: Condition = { fx: "on", detailBudget: "off" };
export const FX_ON_BUDGET_ON: Condition = { fx: "on", detailBudget: "on" };
export const FX_OFF_BUDGET_OFF: Condition = { fx: "off", detailBudget: "off" };
export const FX_OFF_BUDGET_ON: Condition = { fx: "off", detailBudget: "on" };

export function metrics(overrides: Partial<MetricSet> = {}): MetricSet {
    return { ...emptyMetrics(), frames: 1500, ...overrides };
}

/** A session that measured the given phases; `zoom` is a real zoom-out unless `extra` says otherwise. */
export function session(
    phases: Partial<Record<View, Partial<MetricSet>>>,
    extra: Partial<SessionMeasurement> = {},
): SessionMeasurement {
    return {
        phases: Object.fromEntries(
            Object.entries(phases).map(([view, overrides]) => [
                view,
                {
                    metrics: metrics(overrides),
                    truncated: false,
                    // A phase that sets a gpu.* metric was timed; the others had no timer, as on most CI machines
                    gpuNote: Object.keys(overrides).some((name) => name.startsWith("gpu.")) ? null : NO_GPU_TIMER,
                },
            ]),
        ),
        renderer: GPU,
        zoom: { defaultScale: 1, wholeMapScale: 0.5 },
        pageErrors: [],
        ...extra,
    };
}

export function okRun(index: number, condition: Condition, measurement: SessionMeasurement, repeat = 1): RunRecord {
    return { index, repeat, condition, status: "ok", measurement };
}

export function failedRun(index: number, condition: Condition, error: string, repeat = 1): RunRecord {
    return { index, repeat, condition, status: "failed", error };
}

export function summary(
    condition: Condition,
    view: View,
    median: Partial<MetricSet>,
    range: { min?: Partial<MetricSet>; max?: Partial<MetricSet> } = {},
): ConditionSummary {
    return {
        condition,
        view,
        runs: 3,
        median: metrics(median),
        min: metrics({ ...median, ...range.min }),
        max: metrics({ ...median, ...range.max }),
    };
}

/**
 * `e2eHooks.captureFrameBench()` as the page returns it after the JSON round trip of page.evaluate: every field of
 * E2EFrameBench (play/src/front/Utils/FrameBench.ts), the nested statistics included. The defaults are a window that
 * meets Gate 1 with room to spare. The play suite builds the same shape with the real bench (FrameProbeContract.test.ts).
 */
export function pageBench(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const gpu = { avg: 6.2, p50: 6, p95: 8, p99: 9, max: 11 };
    const frame = { avg: 16.7, p50: 16.7, p95: 16.8, p99: 17, max: 18 };
    return {
        frames: 300,
        frameMs: frame,
        workMs: { avg: 4, p50: 4, p95: 6, p99: 7, max: 9 },
        gpuMs: gpu,
        drawCalls: { avg: 40, p50: 40, p95: 44, p99: 46, max: 50 },
        gpuTimer: "webgl2",
        avgGpuMs: gpu.avg,
        p95GpuMs: gpu.p95,
        p99GpuMs: gpu.p99,
        maxGpuMs: gpu.max,
        avgFrameMs: frame.avg,
        p99FrameMs: frame.p99,
        maxFrameMs: frame.max,
        mirrorUploadBytesPerSec: 0,
        fullMapUploads: 0,
        largeUploads: 0,
        largestUploadBytes: 0,
        allocations: 0,
        renderedFrames: 300,
        postFilterFrames: 300,
        postFilterShare: 1,
        gpuSamples: 300,
        gpuDroppedFrames: 0,
        activeFullAvatars: 72,
        activeDotAvatars: 700,
        culledAvatars: 227,
        bakedAvatarTextures: 48,
        ...overrides,
    };
}

/**
 * `e2eHooks.spawnSyntheticCrowd(999)` as the page returns it (SyntheticCrowdReport in play/src/front/Utils/
 * SyntheticCrowd.ts): every group anchored, no fallback, avatars of 4 to 6 layers.
 */
export function pageCrowd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        requested: 999,
        inScene: 999,
        groups: { glass: 250, lights: 250, borders: 250, spread: 249 },
        fallbackGroups: [],
        recipes: 48,
        layersPerRecipe: { min: 4, max: 6 },
        moveIntervalMs: 200,
        ...overrides,
    };
}

/** `e2eHooks.setBenchNight(level)` as the page returns it (BenchNightResult in play/src/front/Utils/BenchNight.ts). */
export function pageNight(level: number | null, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const hours: Record<string, number> = { "0": 12, "0.85": 17.85, "1": 19.3 };
    return {
        level,
        hour: level === null ? null : (hours[String(level)] ?? 18),
        nightOn: level !== null && level >= 0.9,
        ...overrides,
    };
}

/** `e2eHooks.getRendererInfo()` as the page returns it: a real GPU, WebGL 2, 1080p, the post pass on. */
export function pageRenderer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        renderer: GPU,
        version: "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
        width: 1920,
        height: 1080,
        activeFilters: ["KfxPost"],
        normalMapLoaded: true,
        ...overrides,
    };
}
