/**
 * What the frame probe measures and how a run is named. Shared by the pure modules (stats, verdict, report) and by the
 * browser driver, which is the only code that needs a browser.
 */

/** The phases of one browser session: the default zoom, the 2 s after the wheel, and the whole map once it settled. */
export const VIEWS = ["default", "zoom", "wholeMap"] as const;
export type View = (typeof VIEWS)[number];

export type Switch = "on" | "off";

/** One A/B cell: the scene effects (`konclui.fx.off`) and the avatar detail budget (`avatarDetailBudget`). */
export interface Condition {
    readonly fx: Switch;
    readonly detailBudget: Switch;
}

/**
 * Every number a phase reports. The names are dotted so a budget can point at one on the command line
 * (`--budget=work.p95=16.7@default`). A metric that was not measured is null, never zero.
 */
export const METRIC_NAMES = [
    "work.avg",
    "work.p50",
    "work.p95",
    "work.p99",
    "work.max",
    "step.p50",
    "step.p95",
    "render.p50",
    "render.p95",
    "interval.p50",
    "interval.p95",
    "gpu.avg",
    "gpu.p50",
    "gpu.p95",
    "gpu.p99",
    "gpu.max",
    "frames",
    "skippedRenders",
    "longTasks.count",
    "longTasks.maxMs",
    "longTasks.totalMs",
    "nameTags.present",
    "nameTags.shown",
    "ws.rxKiBps.p50",
    "ws.rxKiBps.p95",
    "ws.txKiBps.p50",
    "ws.txKiBps.p95",
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];
export type MetricSet = Record<MetricName, number | null>;

export function emptyMetrics(): MetricSet {
    return Object.fromEntries(METRIC_NAMES.map((name) => [name, null])) as MetricSet;
}

export function isMetricName(value: string): value is MetricName {
    return (METRIC_NAMES as readonly string[]).includes(value);
}

export function isView(value: string): value is View {
    return (VIEWS as readonly string[]).includes(value);
}

export interface PhaseMeasurement {
    readonly metrics: MetricSet;
    /** The page's recorder outgrew its buffer: the percentiles cover only the first frames. */
    readonly truncated: boolean;
    /** Why the gpu.* metrics are null in this phase (the page's reason, or a short sentence); null when they were read. */
    readonly gpuNote: string | null;
}

/** What one browser session returns, whatever drove it. */
export interface SessionMeasurement {
    readonly phases: Partial<Record<View, PhaseMeasurement>>;
    /** WebGL renderer string of the page (UNMASKED_RENDERER_WEBGL), to tell a GPU from a software rasteriser. */
    readonly renderer: string;
    /** CSS pixels per game pixel before and after the wheel; null when the whole-map step did not run. */
    readonly zoom: { readonly defaultScale: number; readonly wholeMapScale: number } | null;
    /** Uncaught errors of the page. A frame that throws adds no sample, so they are shown beside the numbers. */
    readonly pageErrors: readonly string[];
}

export type RunRecord =
    | {
          readonly index: number;
          readonly repeat: number;
          readonly condition: Condition;
          readonly status: "ok";
          readonly measurement: SessionMeasurement;
      }
    | {
          readonly index: number;
          readonly repeat: number;
          readonly condition: Condition;
          readonly status: "failed";
          readonly error: string;
      };

export function conditionLabel(condition: Condition): string {
    return `fx ${condition.fx}, detail budget ${condition.detailBudget}`;
}

/** One condition in one phase, over the runs that completed: the figure a budget is judged on is the median. */
export interface ConditionSummary {
    readonly condition: Condition;
    readonly view: View;
    /** Runs that measured this phase. */
    readonly runs: number;
    readonly median: MetricSet;
    readonly min: MetricSet;
    readonly max: MetricSet;
}
