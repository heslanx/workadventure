import type { LongTaskSummary, RateSummary } from "./signals";
import { emptyMetrics, type PhaseMeasurement } from "./types";

/** The part of `e2eHooks.stopFrameRecording()` (play/src/front/Utils/E2EHooks.ts) the probe reads. */
export interface RecordedStats {
    /** Present once the recorder reports averages; the probe does not need it to run. */
    readonly avg?: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
}

/** Share of the rendered frames that must carry a GPU sample (GPU_MIN_COVERAGE in play/src/front/Utils/E2EHooks.ts). */
export const GPU_MIN_COVERAGE = 0.9;

/** The part of the recorder's `E2EGpuStats` the probe reads. */
export interface RecordedGpu extends RecordedStats {
    /** Rendered frames that have a GPU sample. */
    readonly samples: number;
    /** samples / rendered frames. */
    readonly coverage: number;
}

export interface Recording {
    readonly frames: number;
    readonly durationMs: number;
    readonly workMs: RecordedStats;
    readonly intervalMs: RecordedStats;
    readonly stepMs: RecordedStats;
    readonly renderMs: RecordedStats;
    readonly skippedRenders: number;
    readonly truncated: boolean;
    /**
     * GPU time per rendered frame (a disjoint timer query). Undefined: the client's recorder predates it. Null: the page
     * could not measure it, `gpuUnavailableReason` says why. Both are normal states, never an error.
     */
    readonly gpuMs?: RecordedGpu | null;
    readonly gpuUnavailableReason?: string | null;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        throw new Error(`frame recording: ${path} is missing`);
    }
    return value as Record<string, unknown>;
}

function finite(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`frame recording: ${path} is not a finite number`);
    }
    return value;
}

function parseStats(value: unknown, path: string): RecordedStats {
    const stats = asRecord(value, path);
    return {
        ...(stats.avg === undefined ? {} : { avg: finite(stats.avg, `${path}.avg`) }),
        p50: finite(stats.p50, `${path}.p50`),
        p95: finite(stats.p95, `${path}.p95`),
        p99: finite(stats.p99, `${path}.p99`),
        max: finite(stats.max, `${path}.max`),
    };
}

function parseGpu(value: unknown): RecordedGpu | null | undefined {
    if (value === undefined || value === null) {
        return value;
    }
    const gpu = asRecord(value, "gpuMs");
    return {
        ...parseStats(gpu, "gpuMs"),
        samples: finite(gpu.samples, "gpuMs.samples"),
        coverage: finite(gpu.coverage, "gpuMs.coverage"),
    };
}

/**
 * Checks the object the page returned. A recorder that changed shape fails here, by name, instead of putting NaN in a
 * report that a budget then reads as a pass. An absent GPU figure is not a changed shape: see Recording.gpuMs.
 */
export function parseRecording(value: unknown): Recording {
    const recording = asRecord(value, "result");
    const gpuMs = parseGpu(recording.gpuMs);
    const reason = recording.gpuUnavailableReason;
    return {
        frames: finite(recording.frames, "frames"),
        durationMs: finite(recording.durationMs, "durationMs"),
        workMs: parseStats(recording.workMs, "workMs"),
        intervalMs: parseStats(recording.intervalMs, "intervalMs"),
        stepMs: parseStats(recording.stepMs, "stepMs"),
        renderMs: parseStats(recording.renderMs, "renderMs"),
        skippedRenders: finite(recording.skippedRenders, "skippedRenders"),
        truncated: recording.truncated === true,
        ...(gpuMs === undefined ? {} : { gpuMs }),
        ...(typeof reason === "string" || reason === null ? { gpuUnavailableReason: reason } : {}),
    };
}

export interface PhaseInputs {
    readonly recording: Recording;
    /** Long tasks of the page observer in the phase window; null when the browser reports none (unsupported). */
    readonly longTasks: LongTaskSummary | null;
    readonly nameTags: { readonly present: number; readonly shown: number };
    /** The WebSocket sample taken after the recording; null when it was not asked for. */
    readonly ws: { readonly rx: RateSummary; readonly tx: RateSummary } | null;
}

/**
 * The GPU figure a budget may be judged on, or why there is none. Too few sampled frames count as none: the missing
 * ones are where the GPU fell behind or was disturbed, so the rest would flatter it.
 */
export function gpuFigure(recording: Recording): { readonly stats: RecordedGpu | null; readonly note: string | null } {
    const gpu = recording.gpuMs;
    if (gpu === undefined) {
        return { stats: null, note: "the client's recorder reports no GPU time" };
    }
    if (gpu === null) {
        return { stats: null, note: recording.gpuUnavailableReason ?? "no reason given" };
    }
    if (gpu.samples <= 0) {
        return { stats: null, note: "no-samples" };
    }
    if (gpu.coverage < GPU_MIN_COVERAGE) {
        return {
            stats: null,
            note: `only ${Math.round(gpu.coverage * 100)}% of the rendered frames have a GPU sample, ${Math.round(GPU_MIN_COVERAGE * 100)}% are needed`,
        };
    }
    return { stats: gpu, note: null };
}

/** Flattens what one phase read into the metric names a budget can point at. */
export function phaseMeasurement({ recording, longTasks, nameTags, ws }: PhaseInputs): PhaseMeasurement {
    const { stats: gpu, note: gpuNote } = gpuFigure(recording);
    return {
        truncated: recording.truncated,
        gpuNote,
        metrics: {
            ...emptyMetrics(),
            "work.avg": recording.workMs.avg ?? null,
            "work.p50": recording.workMs.p50,
            "work.p95": recording.workMs.p95,
            "work.p99": recording.workMs.p99,
            "work.max": recording.workMs.max,
            "step.p50": recording.stepMs.p50,
            "step.p95": recording.stepMs.p95,
            "render.p50": recording.renderMs.p50,
            "render.p95": recording.renderMs.p95,
            "interval.p50": recording.intervalMs.p50,
            "interval.p95": recording.intervalMs.p95,
            "gpu.avg": gpu?.avg ?? null,
            "gpu.p50": gpu?.p50 ?? null,
            "gpu.p95": gpu?.p95 ?? null,
            "gpu.p99": gpu?.p99 ?? null,
            "gpu.max": gpu?.max ?? null,
            frames: recording.frames,
            skippedRenders: recording.skippedRenders,
            "longTasks.count": longTasks?.count ?? null,
            "longTasks.maxMs": longTasks?.maxMs ?? null,
            "longTasks.totalMs": longTasks?.totalMs ?? null,
            "nameTags.present": nameTags.present,
            "nameTags.shown": nameTags.shown,
            "ws.rxKiBps.p50": ws?.rx.p50 ?? null,
            "ws.rxKiBps.p95": ws?.rx.p95 ?? null,
            "ws.txKiBps.p50": ws?.tx.p50 ?? null,
            "ws.txKiBps.p95": ws?.tx.p95 ?? null,
        },
    };
}
