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
