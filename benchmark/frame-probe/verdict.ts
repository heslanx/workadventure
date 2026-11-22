import { isSoftwareRenderer, zoomedOut } from "./signals";
import {
    conditionLabel,
    isMetricName,
    isView,
    VIEWS,
    type Condition,
    type ConditionSummary,
    type MetricName,
    type RunRecord,
    type Switch,
    type View,
} from "./types";

/** Which conditions a budget binds. "any" leaves that switch free: every condition measured is judged. */
export interface ConditionScope {
    readonly fx: Switch | "any";
    readonly detailBudget: Switch | "any";
}

const ANY_CONDITION: ConditionScope = { fx: "any", detailBudget: "any" };

/** A limit a metric's median must stay at or under. `view` is where it applies; "any" is every phase measured. */
export interface Budget {
    readonly metric: MetricName;
    readonly limit: number;
    readonly view: View | "any";
    readonly scope: ConditionScope;
    readonly raw: string;
}

/** A gain the avatar detail budget must show: its median at least `percent` below the same condition with it off. */
export interface Reduction {
    readonly metric: MetricName;
    readonly percent: number;
    readonly view: View | "any";
    readonly raw: string;
}

/**
 * What the run assumes about the load it was started under: a metric that must be at least `min` in the lowest run of
 * every condition. Missing it means the numbers describe another load, so it makes the run invalid, not failed.
 */
export interface Expectation {
    readonly metric: MetricName;
    readonly min: number;
    readonly view: View | "any";
    readonly raw: string;
}

export class BudgetSyntaxError extends Error {}

const GRAMMAR = "<metric>=<number>[@<view>][:fx=on|off][:detail=on|off], e.g. work.p95=16.7@default:detail=on";

function parseScope(raw: string, terms: readonly string[]): ConditionScope {
    let fx: ConditionScope["fx"] = "any";
    let detailBudget: ConditionScope["detailBudget"] = "any";
    const named = new Set<string>();
    for (const term of terms) {
        const [name, value, ...rest] = term.split("=");
        if ((name !== "fx" && name !== "detail") || (value !== "on" && value !== "off") || rest.length > 0) {
            throw new BudgetSyntaxError(
                `"${raw}": "${term}" is not a condition (fx=on|off or detail=on|off). Expected ${GRAMMAR}`,
            );
        }
        if (named.has(name)) {
            throw new BudgetSyntaxError(`"${raw}": "${name}" is given twice. Expected ${GRAMMAR}`);
        }
        named.add(name);
        if (name === "fx") {
            fx = value;
        } else {
            detailBudget = value;
        }
    }
    return { fx, detailBudget };
}

function parseTerm(
    raw: string,
    allowScope: boolean,
): { metric: MetricName; value: number; view: View | "any"; scope: ConditionScope } {
    const [head, ...scopeTerms] = raw.split(":");
    if (scopeTerms.length > 0 && !allowScope) {
        throw new BudgetSyntaxError(
            `"${raw}": this option takes no condition after ":". Expected <metric>=<number>[@<view>]`,
        );
    }
    const at = head.lastIndexOf("@");
    const body = at === -1 ? head : head.slice(0, at);
    const view = at === -1 ? "any" : head.slice(at + 1);
    const equals = body.indexOf("=");
    if (equals === -1) {
        throw new BudgetSyntaxError(`"${raw}": no limit given. Expected ${GRAMMAR}`);
    }
    const metric = body.slice(0, equals);
    const value = Number(body.slice(equals + 1));
    if (!isMetricName(metric)) {
        throw new BudgetSyntaxError(`"${raw}": "${metric}" is not a metric. Expected ${GRAMMAR}`);
    }
    if (!Number.isFinite(value) || value < 0) {
        throw new BudgetSyntaxError(`"${raw}": the limit must be a number of 0 or more. Expected ${GRAMMAR}`);
    }
    if (view !== "any" && !isView(view)) {
        throw new BudgetSyntaxError(`"${raw}": "${view}" is not a view (${VIEWS.join(", ")}). Expected ${GRAMMAR}`);
    }
    return { metric, value, view, scope: parseScope(raw, scopeTerms) };
}

export function parseBudget(raw: string): Budget {
    const { metric, value, view, scope } = parseTerm(raw, true);
    return { metric, limit: value, view, scope, raw };
}

export function parseReduction(raw: string): Reduction {
    const { metric, value, view } = parseTerm(raw, false);
    if (value > 100) {
        throw new BudgetSyntaxError(`"${raw}": a reduction is a percentage, 100 at most`);
    }
    return { metric, percent: value, view, raw };
}

export function parseExpectation(raw: string): Expectation {
    const { metric, value, view } = parseTerm(raw, false);
    return { metric, min: value, view, raw };
}

/**
 * pass: within the limit. fail: over it. unread: nothing measured that the limit could be read against: that is never
 * a pass.
 */
export interface Check {
    readonly kind: "budget" | "reduction" | "expectation";
    readonly metric: MetricName;
    readonly label: string;
    readonly status: "pass" | "fail" | "unread";
    /** The median read (a budget), the lowest run (an expectation) or the reduction achieved, in percent (a reduction). */
    readonly actual: number | null;
    readonly limit: number;
}

function inView(view: View | "any", summary: ConditionSummary): boolean {
    return view === "any" || view === summary.view;
}

function inScope(scope: ConditionScope, summary: ConditionSummary): boolean {
    return (
        (scope.fx === "any" || scope.fx === summary.condition.fx) &&
        (scope.detailBudget === "any" || scope.detailBudget === summary.condition.detailBudget)
    );
}

function describeScope(scope: ConditionScope): string {
    return [
        scope.fx === "any" ? "" : `, fx ${scope.fx}`,
        scope.detailBudget === "any" ? "" : `, detail budget ${scope.detailBudget}`,
    ].join("");
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

/** A limit read in each condition of a view on its own: what differs between a budget and an expectation. */
interface PerConditionRule {
    readonly kind: "budget" | "expectation";
    readonly metric: MetricName;
    readonly limit: number;
    readonly view: View | "any";
    readonly scope: ConditionScope;
    readonly raw: string;
    readonly read: (summary: ConditionSummary) => number | null;
    readonly describe: (actual: number) => string;
    readonly holds: (actual: number) => boolean;
}

function evaluateRule(summaries: readonly ConditionSummary[], rule: PerConditionRule): Check[] {
    const unread = (label: string): Check => ({
        kind: rule.kind,
        metric: rule.metric,
        label,
        status: "unread",
        actual: null,
        limit: rule.limit,
    });
    const matching = summaries.filter((summary) => inView(rule.view, summary) && inScope(rule.scope, summary));
    if (matching.length === 0) {
        const where = `${rule.view === "any" ? "any view" : rule.view}${describeScope(rule.scope)}`;
        return [unread(`${rule.raw}: nothing was measured in ${where}`)];
    }
    return matching.map((summary): Check => {
        const actual = rule.read(summary);
        const where = `${rule.metric} in ${summary.view}, ${conditionLabel(summary.condition)}`;
        if (actual === null) {
            return unread(`${where}: not measured`);
        }
        return {
            kind: rule.kind,
            metric: rule.metric,
            label: `${where}: ${rule.describe(actual)}`,
            status: rule.holds(actual) ? "pass" : "fail",
            actual,
            limit: rule.limit,
        };
    });
}

export function evaluateBudgets(summaries: readonly ConditionSummary[], budgets: readonly Budget[]): Check[] {
    return budgets.flatMap((budget) =>
        evaluateRule(summaries, {
            kind: "budget",
            metric: budget.metric,
            limit: budget.limit,
            view: budget.view,
            scope: budget.scope,
            raw: budget.raw,
            read: (summary) =>
                budget.metric.endsWith(".max") ? summary.max[budget.metric] : summary.median[budget.metric],
            describe: (actual) =>
                `${budget.metric.endsWith(".max") ? "worst" : "median"} ${round(actual)} against at most ${budget.limit}`,
            holds: (actual) => actual <= budget.limit,
        }),
    );
}

/** The lowest run of every condition must reach the minimum: one run that lost the crowd is enough to doubt the rest. */
export function evaluateExpectations(
    summaries: readonly ConditionSummary[],
    expectations: readonly Expectation[],
): Check[] {
    return expectations.flatMap((expectation) =>
        evaluateRule(summaries, {
            kind: "expectation",
            metric: expectation.metric,
            limit: expectation.min,
            view: expectation.view,
            scope: ANY_CONDITION,
            raw: expectation.raw,
            read: (summary) => summary.min[expectation.metric],
            describe: (actual) => `lowest run ${round(actual)} against at least ${expectation.min}`,
            holds: (actual) => actual >= expectation.min,
        }),
    );
}

function find(
    summaries: readonly ConditionSummary[],
    view: View,
    fx: Switch,
    detailBudget: Switch,
): ConditionSummary | undefined {
    return summaries.find(
        (summary) =>
            summary.view === view && summary.condition.fx === fx && summary.condition.detailBudget === detailBudget,
    );
}

export function evaluateReductions(summaries: readonly ConditionSummary[], reductions: readonly Reduction[]): Check[] {
    return reductions.flatMap((reduction) => {
        const views = VIEWS.filter((view) => reduction.view === "any" || reduction.view === view);
        return views.flatMap((view): Check[] => {
            const fxValues = [
                ...new Set(summaries.filter((summary) => summary.view === view).map((summary) => summary.condition.fx)),
            ];
            if (fxValues.length === 0) {
                return reduction.view === "any"
                    ? []
                    : [
                          {
                              kind: "reduction",
                              metric: reduction.metric,
                              label: `${reduction.raw}: nothing was measured in ${view}`,
                              status: "unread",
                              actual: null,
                              limit: reduction.percent,
                          },
                      ];
            }
            return fxValues.map((fx): Check => {
                const off = find(summaries, view, fx, "off")?.median[reduction.metric] ?? null;
                const on = find(summaries, view, fx, "on")?.median[reduction.metric] ?? null;
                const where = `${reduction.metric} in ${view}, fx ${fx}`;
                if (off === null || on === null || off <= 0) {
                    return {
                        kind: "reduction",
                        metric: reduction.metric,
                        label: `${where}: needs the detail budget measured both off and on, with a non-zero baseline`,
                        status: "unread",
                        actual: null,
                        limit: reduction.percent,
                    };
                }
                const achieved = ((off - on) / off) * 100;
                return {
                    kind: "reduction",
                    metric: reduction.metric,
                    label: `${where}: detail budget on is ${round(achieved)}% below off (${round(off)} to ${round(on)}), at least ${reduction.percent}% wanted`,
                    status: achieved >= reduction.percent ? "pass" : "fail",
                    actual: achieved,
                    limit: reduction.percent,
                };
            });
        });
    });
}

export interface JudgeInput {
    readonly runs: readonly RunRecord[];
    readonly summaries: readonly ConditionSummary[];
    readonly budgets: readonly Budget[];
    readonly reductions: readonly Reduction[];
    readonly expectations: readonly Expectation[];
    /** What the caller asked for: "swiftshader" is a software rasteriser on purpose. */
    readonly renderer: "gpu" | "swiftshader";
    readonly allowSoftwareRenderer: boolean;
    readonly wholeMapRequested: boolean;
    /** Runs the schedule held. The probe stops at the first failed run, so fewer than this may have run. */
    readonly plannedRuns: number;
}

export interface Verdict {
    readonly status: "pass" | "fail" | "invalid";
    readonly checks: readonly Check[];
    /** Why the measurement cannot be trusted. Any entry makes the verdict invalid, whatever the budgets say. */
    readonly invalidReasons: readonly string[];
}

function runLabel(index: number, condition: Condition): string {
    return `run ${index} (${conditionLabel(condition)})`;
}

function invalidRunReasons(input: JudgeInput): string[] {
    const reasons: string[] = [];
    if (!input.runs.some((run) => run.status === "ok")) {
        reasons.push("no run completed");
    }
    if (input.runs.length < input.plannedRuns) {
        reasons.push(`${input.plannedRuns - input.runs.length} of ${input.plannedRuns} planned runs did not run`);
    }
    for (const run of input.runs) {
        if (run.status === "failed") {
            reasons.push(`${runLabel(run.index, run.condition)} failed: ${run.error}`);
            continue;
        }
        const label = runLabel(run.index, run.condition);
        for (const [view, phase] of Object.entries(run.measurement.phases)) {
            if (phase.truncated) {
                reasons.push(
                    `${label}: the ${view} recording outgrew its buffer, so its percentiles cover only the start`,
                );
            }
            if (!phase.metrics.frames) {
                reasons.push(`${label}: no frame was recorded in ${view}`);
            }
        }
        if (input.wholeMapRequested) {
            const zoom = run.measurement.zoom;
            if (zoom === null) {
                reasons.push(`${label}: the whole-map step did not run`);
            } else if (!zoomedOut(zoom.defaultScale, zoom.wholeMapScale)) {
                reasons.push(
                    `${label}: the wheel did not zoom out (scale ${zoom.defaultScale} before, ${zoom.wholeMapScale} after)`,
                );
            }
        }
        if (input.renderer === "gpu" && ["unknown", ""].includes(run.measurement.renderer)) {
            reasons.push(`${label}: the GPU renderer could not be identified`);
        }
        if (input.renderer === "gpu" && !input.allowSoftwareRenderer && isSoftwareRenderer(run.measurement.renderer)) {
            reasons.push(
                `${label}: the renderer "${run.measurement.renderer}" is a software rasteriser, not a GPU; ` +
                    "pass --allow-software-renderer to measure one on purpose",
            );
        }
    }
    return reasons;
}

/** Why the page had no GPU figure, once per distinct reason, to explain a gpu.* check that could not be read. */
function gpuNotes(runs: readonly RunRecord[]): string[] {
    const notes = new Set<string>();
    for (const run of runs) {
        if (run.status === "ok") {
            for (const phase of Object.values(run.measurement.phases)) {
                if (phase.gpuNote !== null) {
                    notes.add(phase.gpuNote);
                }
            }
        }
    }
    return [...notes];
}

export function judge(input: JudgeInput): Verdict {
    const expectationChecks = evaluateExpectations(input.summaries, input.expectations ?? []);
    const checks = [
        ...expectationChecks,
        ...evaluateBudgets(input.summaries, input.budgets),
        ...evaluateReductions(input.summaries, input.reductions),
    ];
    const notes = gpuNotes(input.runs);
    const invalidReasons = [
        ...invalidRunReasons(input),
        ...expectationChecks
            .filter((check) => check.status === "fail")
            .map((check) => `the load the run expected is not there: ${check.label}`),
        ...checks
            .filter((check) => check.status === "unread")
            .map(
                (check) =>
                    `cannot read: ${check.label}` +
                    (check.metric.startsWith("gpu.") && notes.length > 0 ? ` (no GPU time: ${notes.join("; ")})` : ""),
            ),
    ];
    const status =
        invalidReasons.length > 0 ? "invalid" : checks.some((check) => check.status === "fail") ? "fail" : "pass";
    return { status, checks, invalidReasons };
}

/** 0 every budget held, 1 a budget was exceeded, 2 the measurement cannot be trusted (see Verdict.invalidReasons). */
export function exitCodeOf(verdict: Verdict): 0 | 1 | 2 {
    return verdict.status === "pass" ? 0 : verdict.status === "fail" ? 1 : 2;
}
