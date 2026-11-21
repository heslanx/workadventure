import { summarizeRuns } from "./matrix";
import { isSoftwareRenderer } from "./signals";
import {
    conditionLabel,
    type ConditionSummary,
    type MetricName,
    type RunRecord,
    type Switch,
    type View,
    VIEWS,
} from "./types";
import { exitCodeOf, judge, type Budget, type Expectation, type Reduction, type Verdict } from "./verdict";

export const REPORT_SCHEMA_VERSION = 1;

export interface ReportConfig {
    readonly url: string;
    readonly runs: number;
    readonly fx: readonly Switch[];
    readonly detailBudget: readonly Switch[];
    readonly views: readonly string[];
    readonly settleSeconds: number;
    readonly recordSeconds: number;
    readonly wheel: { readonly delta: number; readonly events: number };
    readonly zoomWindowSeconds: number;
    readonly zoomSettleSeconds: number;
    readonly wsSampleSeconds: number;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly rendererRequested: "gpu" | "swiftshader";
    readonly allowSoftwareRenderer: boolean;
    readonly budgets: readonly string[];
    readonly reductions: readonly string[];
    readonly expectations: readonly string[];
}

export interface ReportEnvironment {
    readonly browserVersion: string;
    readonly platform: string;
    readonly nodeVersion: string;
}

export interface FrameProbeReport {
    readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
    readonly tool: "frame-probe";
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly environment: ReportEnvironment & {
        /** WebGL renderer strings the runs reported. */
        readonly renderers: readonly string[];
        /** True only when at least one run completed and none of them ran on a software rasteriser. */
        readonly gpu: boolean;
    };
    readonly config: ReportConfig;
    readonly plannedRuns: number;
    readonly runs: readonly RunRecord[];
    readonly summaries: readonly ConditionSummary[];
    readonly verdict: Verdict & { readonly exitCode: 0 | 1 | 2 };
}

export interface ReportInput {
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly environment: ReportEnvironment;
    readonly config: ReportConfig;
    readonly plannedRuns: number;
    readonly runs: readonly RunRecord[];
    readonly budgets: readonly Budget[];
    readonly reductions: readonly Reduction[];
    readonly expectations: readonly Expectation[];
}

export function buildReport(input: ReportInput): FrameProbeReport {
    const summaries = summarizeRuns(input.runs);
    const renderers = [
        ...new Set(input.runs.flatMap((run) => (run.status === "ok" ? [run.measurement.renderer] : []))),
    ];
    const verdict = judge({
        runs: input.runs,
        summaries,
        budgets: input.budgets,
        reductions: input.reductions,
        expectations: input.expectations,
        renderer: input.config.rendererRequested,
        allowSoftwareRenderer: input.config.allowSoftwareRenderer,
        wholeMapRequested: input.config.views.includes("wholeMap"),
        plannedRuns: input.plannedRuns,
    });
    return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        tool: "frame-probe",
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        environment: {
            ...input.environment,
            renderers,
            gpu: renderers.length > 0 && !renderers.some(isSoftwareRenderer),
        },
        config: input.config,
        plannedRuns: input.plannedRuns,
        runs: input.runs,
        summaries,
        verdict: { ...verdict, exitCode: exitCodeOf(verdict) },
    };
}

function formatNumber(value: number | null): string {
    if (value === null) {
        return "n/a";
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function median(summary: ConditionSummary, metric: MetricName): string {
    return formatNumber(summary.median[metric]);
}

function withRange(summary: ConditionSummary, metric: MetricName): string {
    const low = summary.min[metric];
    const high = summary.max[metric];
    return low === null || high === null || low === high
        ? median(summary, metric)
        : `${median(summary, metric)} (${formatNumber(low)} to ${formatNumber(high)})`;
}

const COLUMNS: readonly { readonly title: string; readonly cell: (summary: ConditionSummary) => string }[] = [
    { title: "Effects", cell: (summary) => summary.condition.fx },
    { title: "Detail budget", cell: (summary) => summary.condition.detailBudget },
    { title: "Runs", cell: (summary) => String(summary.runs) },
    { title: "Work p50 ms", cell: (summary) => median(summary, "work.p50") },
    { title: "Work p95 ms (runs)", cell: (summary) => withRange(summary, "work.p95") },
    { title: "Step p95 ms", cell: (summary) => median(summary, "step.p95") },
    { title: "Render p95 ms", cell: (summary) => median(summary, "render.p95") },
    { title: "Interval p95 ms", cell: (summary) => median(summary, "interval.p95") },
    { title: "GPU p95 ms", cell: (summary) => median(summary, "gpu.p95") },
    { title: "Frames", cell: (summary) => median(summary, "frames") },
    { title: "Long tasks", cell: (summary) => median(summary, "longTasks.count") },
    { title: "Longest ms", cell: (summary) => median(summary, "longTasks.maxMs") },
    {
        title: "Name tags shown / in DOM",
        cell: (summary) => `${median(summary, "nameTags.shown")} / ${median(summary, "nameTags.present")}`,
    },
    {
        title: "Received KiB/s p50 / p95",
        cell: (summary) => `${median(summary, "ws.rxKiBps.p50")} / ${median(summary, "ws.rxKiBps.p95")}`,
    },
];

/** Phases measured and phases with no GPU figure, with the reason of each, over the runs that completed. */
export function gpuAvailability(runs: readonly RunRecord[]): {
    readonly phases: number;
    readonly unavailable: ReadonlyMap<string, number>;
} {
    let phases = 0;
    const unavailable = new Map<string, number>();
    for (const run of runs) {
        if (run.status !== "ok") {
            continue;
        }
        for (const phase of Object.values(run.measurement.phases)) {
            phases++;
            if (phase.gpuNote !== null) {
                unavailable.set(phase.gpuNote, (unavailable.get(phase.gpuNote) ?? 0) + 1);
            }
        }
    }
    return { phases, unavailable };
}

const VIEW_TITLES: Record<View, string> = {
    default: "Default zoom",
    zoom: "Zoom step: from the first wheel event to the end of the zoom window",
    wholeMap: "Whole map, after the zoom settled",
};

function table(summaries: readonly ConditionSummary[]): string[] {
    return [
        `| ${COLUMNS.map((column) => column.title).join(" | ")} |`,
        `| ${COLUMNS.map(() => "---").join(" | ")} |`,
        ...summaries.map((summary) => `| ${COLUMNS.map((column) => column.cell(summary)).join(" | ")} |`),
    ];
}

/** The summary a person reads: the verdict first, then one table per phase, then every run. */
export function renderMarkdown(report: FrameProbeReport): string {
    const { verdict, config, environment } = report;
    const lines = [
        "# Frame probe",
        "",
        `Started ${report.startedAt}. Room ${config.url}. Viewport ${config.viewport.width}x${config.viewport.height}, ` +
            `${config.runs} rounds, the figure of each condition is the median of its runs.`,
        `Browser ${environment.browserVersion} on ${environment.platform}. ` +
            `Renderer ${environment.renderers.join(", ") || "unknown"} (${environment.gpu ? "GPU" : "not a GPU"}).`,
        "",
        `## Verdict: ${verdict.status.toUpperCase()} (exit code ${verdict.exitCode})`,
        "",
    ];
    if (verdict.invalidReasons.length > 0) {
        lines.push("Not trustworthy:", ...verdict.invalidReasons.map((reason) => `- ${reason}`), "");
    }
    if (verdict.checks.length === 0) {
        lines.push("No budget was given: this run only reports.", "");
    } else {
        lines.push(...verdict.checks.map((check) => `- ${check.status.toUpperCase()}: ${check.label}`), "");
    }
    const gpu = gpuAvailability(report.runs);
    if (gpu.unavailable.size > 0) {
        const without = [...gpu.unavailable.values()].reduce((sum, count) => sum + count, 0);
        lines.push(
            `GPU time: n/a in ${without} of ${gpu.phases} phases (${[...gpu.unavailable]
                .map(([reason, count]) => `${reason}: ${count}`)
                .join("; ")}). A budget on a gpu.* metric is invalid then.`,
            "",
        );
    }
    for (const view of VIEWS) {
        const rows = report.summaries.filter((summary) => summary.view === view);
        if (rows.length > 0) {
            lines.push(`## ${VIEW_TITLES[view]}`, "", ...table(rows), "");
        }
    }
    lines.push(
        "## Runs",
        "",
        ...report.runs.map(
            (run) =>
                `- Run ${run.index} (round ${run.repeat}, ${conditionLabel(run.condition)}): ` +
                (run.status === "ok"
                    ? run.measurement.pageErrors.length === 0
                        ? "ok"
                        : `ok, with ${run.measurement.pageErrors.length} page errors, the first: ${run.measurement.pageErrors[0]}`
                    : `failed, ${run.error}`),
        ),
        "",
    );
    return lines.join("\n");
}
