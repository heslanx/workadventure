import { median } from "../src/merge";
import {
    emptyMetrics,
    METRIC_NAMES,
    VIEWS,
    type Condition,
    type ConditionSummary,
    type MetricSet,
    type RunRecord,
    type SessionMeasurement,
    type Switch,
} from "./types";

/** Every combination of the two switches, effects first. */
export function buildConditions(fx: readonly Switch[], detailBudget: readonly Switch[]): Condition[] {
    return fx.flatMap((effects) => detailBudget.map((budget) => ({ fx: effects, detailBudget: budget })));
}

export interface ScheduledRun {
    /** 1-based, in execution order. */
    readonly index: number;
    /** 1-based round: every condition runs once per round. */
    readonly repeat: number;
    readonly condition: Condition;
}

/**
 * The conditions in rounds, each round starting one condition later than the last (A B C D, B C D A, C D A B), so a
 * slow drift of the machine or of the bots' positions never lands on one condition only.
 */
export function buildSchedule(conditions: readonly Condition[], repeats: number): ScheduledRun[] {
    const schedule: ScheduledRun[] = [];
    for (let round = 0; round < repeats; round++) {
        for (let position = 0; position < conditions.length; position++) {
            schedule.push({
                index: schedule.length + 1,
                repeat: round + 1,
                condition: conditions[(position + round) % conditions.length],
            });
        }
    }
    return schedule;
}

export interface SessionTiming {
    readonly settleSeconds: number;
    readonly recordSeconds: number;
    readonly zoomWindowSeconds: number;
    readonly zoomSettleSeconds: number;
    readonly wsSampleSeconds: number;
    readonly wholeMap: boolean;
}

/** What entering the room costs before the settle: the guest steps, the scene load and the media prompt. */
export const ENTRY_ALLOWANCE_SECONDS = 30;
/** What waiting for the scale to stop changing costs after the wheel, at most a few polls. */
export const ZOOM_SCALE_ALLOWANCE_SECONDS = 3;

/** How long one session takes, to size the load the caller starts: it has to outlast every session. */
export function sessionSeconds(timing: SessionTiming): number {
    const view = timing.recordSeconds + timing.wsSampleSeconds;
    const zoom = timing.wholeMap
        ? timing.zoomWindowSeconds + ZOOM_SCALE_ALLOWANCE_SECONDS + timing.zoomSettleSeconds + view
        : 0;
    return ENTRY_ALLOWANCE_SECONDS + timing.settleSeconds + view + zoom;
}

export function estimateSeconds(timing: SessionTiming, sessions: number): number {
    return sessions * sessionSeconds(timing);
}

/** The README starts the probe about 45 s after the bots: their 30 s ramp, then the time to switch terminals. */
export const PROBE_START_DELAY_SECONDS = 45;
/** What the estimate leaves out: an entry slower than its allowance, a wait that ran to its limit, a late start. */
export const BOTS_MARGIN_SECONDS = 60;

/**
 * The staircase `--duration-seconds` that keeps the bots up until the last session ends. The duration counts from the
 * start of the bots, ramp included, and the probe starts PROBE_START_DELAY_SECONDS later, so the sessions' own length is
 * not enough: a crowd that leaves during the last recording lowers every number it is judged on.
 */
export function botsDurationSeconds(timing: SessionTiming, sessions: number): number {
    return Math.ceil(estimateSeconds(timing, sessions) + PROBE_START_DELAY_SECONDS + BOTS_MARGIN_SECONDS);
}

/** Runs the schedule one session at a time, and stops at the first failure: one failed run already makes it invalid. */
export async function runSchedule(
    schedule: readonly ScheduledRun[],
    measure: (run: ScheduledRun) => Promise<SessionMeasurement>,
    onRun: (record: RunRecord) => void = () => undefined,
): Promise<RunRecord[]> {
    const records: RunRecord[] = [];
    for (const run of schedule) {
        let record: RunRecord;
        try {
            record = { ...run, status: "ok", measurement: await measure(run) };
        } catch (error: unknown) {
            record = { ...run, status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
        records.push(record);
        onRun(record);
        if (record.status === "failed") {
            break;
        }
    }
    return records;
}

function present(values: readonly (number | null)[]): number[] {
    return values.filter((value): value is number => value !== null);
}

function reduceMetrics(sets: readonly MetricSet[], pick: (values: number[]) => number | null): MetricSet {
    const result = emptyMetrics();
    for (const name of METRIC_NAMES) {
        result[name] = pick(present(sets.map((set) => set[name])));
    }
    return result;
}

/** Per phase and condition: the median of each metric over the runs that completed, and its lowest and highest. */
export function summarizeRuns(runs: readonly RunRecord[]): ConditionSummary[] {
    const summaries: ConditionSummary[] = [];
    for (const view of VIEWS) {
        const groups = new Map<string, { condition: Condition; sets: MetricSet[] }>();
        for (const run of runs) {
            const phase = run.status === "ok" ? run.measurement.phases[view] : undefined;
            if (phase === undefined) {
                continue;
            }
            const key = `${run.condition.fx}/${run.condition.detailBudget}`;
            const group = groups.get(key) ?? { condition: run.condition, sets: [] };
            group.sets.push(phase.metrics);
            groups.set(key, group);
        }
        for (const { condition, sets } of groups.values()) {
            summaries.push({
                condition,
                view,
                runs: sets.length,
                median: reduceMetrics(sets, median),
                min: reduceMetrics(sets, (values) => (values.length === 0 ? null : Math.min(...values))),
                max: reduceMetrics(sets, (values) => (values.length === 0 ? null : Math.max(...values))),
            });
        }
    }
    return summaries;
}
