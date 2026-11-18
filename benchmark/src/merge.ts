import type { MetricsReport } from "./metrics";
import type { Counter, TypeTraffic } from "./stats";

/**
 * Several generator processes drive one server, each with its own JSON summary. Counters add up. Percentiles cannot be
 * combined without the samples, so a merged latency is the worst of the processes: an upper bound, never an average.
 * This is what `load-staircase.sh` runs after every level; the rules come from benchmark/README.md.
 */

/** The part of a run summary (LoadSummary in runner.ts) that merging reads. */
export interface MergeableSummary {
    schemaVersion: number;
    /** "completed" when the run lasted its whole duration; anything else cut it short. */
    stopReason: string;
    config: { durationSeconds: number };
    sessions: {
        requested: number;
        accepted: number;
        rejected: number;
        unexpectedCloses: number;
    };
    joinLatencyMs: { p95: number | null };
    received: { frames: number; bytes: number };
    moveProbe: {
        delivery: { expected: number; received: number };
        moveLatencyMs: { p50: number | null; p95: number | null; p99: number | null };
        outsideExpectation: number;
        unmatched: number;
    };
    closeCodes: Counter;
    errors: Counter;
    generator: { cpuPercentOfOneCore: number | null; eventLoopLagMs: { p99: number | null } };
    reconciled: boolean;
    window: { enabled: boolean; seconds: number; measuredSeconds: number | null };
    scenario: { firstPathIndex: number; lastPathIndex: number; walkers: number };
    traffic: {
        measuredSeconds: number | null;
        bytes: number;
        overheadBytes: number;
        byType: Record<string, TypeTraffic & { bytesPerSecond: number | null; peakBytesPerSecond: number }>;
    };
    worldSpace: {
        membersJoined: number;
        watchersSubscribed: number;
        frames: number;
        records: number;
        bytes: number;
        joinLatencyMs: { p95: number | null };
        byType: Record<string, TypeTraffic & { bytesPerSecond: number | null; peakBytesPerSecond: number }>;
    };
    knownPeers: { sessions: number; p50: number | null; p95: number | null; max: number | null };
    metrics: MetricsReport[];
}

const REQUIRED_KEYS = [
    "stopReason",
    "config",
    "sessions",
    "joinLatencyMs",
    "received",
    "moveProbe",
    "closeCodes",
    "errors",
    "generator",
    "window",
    "scenario",
    "traffic",
    "worldSpace",
    "knownPeers",
    "metrics",
] as const;

/** Refuses a summary from an older generator, which lacks the traffic and scenario blocks merging reads. */
export function assertMergeableSummary(value: unknown, source: string): asserts value is MergeableSummary {
    if (typeof value !== "object" || value === null) {
        throw new Error(`${source}: not a JSON object`);
    }
    const version = "schemaVersion" in value ? value.schemaVersion : undefined;
    if (typeof version !== "number" || version < 4) {
        throw new Error(
            `${source}: schemaVersion ${String(version)} predates the steady-window report (needs 4 or more)`,
        );
    }
    const missing = REQUIRED_KEYS.filter((key) => !(key in value));
    if (missing.length > 0) {
        throw new Error(`${source}: missing ${missing.join(", ")}`);
    }
}

/** Refuses a file that is not the output of mergeSummaries, such as a single process's summary. */
export function assertMergedSummary(value: unknown, source: string): asserts value is MergedSummary {
    if (typeof value !== "object" || value === null) {
        throw new Error(`${source}: not a JSON object`);
    }
    const missing = ["processes", "valid", "delivery", "moveLatencyMs", "traffic", "serverCpuPercentOfOneCore"].filter(
        (key) => !(key in value),
    );
    if (missing.length > 0) {
        throw new Error(`${source}: not a merged summary, missing ${missing.join(", ")}`);
    }
}

export interface MergeLimits {
    /** A generator process above this share of one core is the bottleneck, not the server. */
    maxGeneratorCpuPercent: number;
    /** A generator whose event loop lags more than this at p99 is too. */
    maxGeneratorLagP99Ms: number;
    /** A process that measured more than this many seconds less than its window (or its duration) was cut short. */
    maxWindowShortfallSeconds: number;
}

export const DEFAULT_LIMITS: MergeLimits = {
    maxGeneratorCpuPercent: 70,
    maxGeneratorLagP99Ms: 10,
    maxWindowShortfallSeconds: 2,
};

/**
 * What the launcher knows and the summaries cannot tell: how many processes it started and how many bots the level has.
 * A process that never wrote its summary leaves no trace in the files, so without this a missing process is merged as
 * a smaller, valid run. Left out, the check is skipped.
 */
export interface RunExpectation {
    processes?: number;
    sessions?: number;
}

export interface MergedTypeTraffic extends TypeTraffic {
    /** Sum of each process's rate over its own measured span. */
    bytesPerSecond: number;
    /** The busiest second of the busiest process: a lower bound of the true peak across processes. */
    peakBytesPerSecondOfOneProcess: number;
}

export interface MergedSummary {
    processes: number;
    valid: boolean;
    invalidReasons: string[];
    sessions: { requested: number; accepted: number; rejected: number; unexpectedCloses: number };
    delivery: { expected: number; received: number; pooledRatio: number | null };
    /** Worst process per percentile. */
    moveLatencyMs: { worstP50: number | null; worstP95: number | null; worstP99: number | null };
    joinLatencyP95WorstMs: number | null;
    moveProbe: { outsideExpectation: number; unmatched: number };
    walkers: number;
    traffic: {
        bytes: number;
        overheadBytes: number;
        bytesPerSecond: number;
        kbitPerSecondPerSession: number | null;
        byType: Record<string, MergedTypeTraffic>;
    };
    worldSpace: {
        membersJoined: number;
        watchersSubscribed: number;
        frames: number;
        records: number;
        bytes: number;
        bytesPerSecond: number;
        kbitPerSecondPerSession: number | null;
        joinLatencyP95WorstMs: number | null;
        byType: Record<string, MergedTypeTraffic>;
    };
    knownPeers: {
        sessions: number;
        meanOfMedians: number | null;
        shareOfPopulation: number | null;
        p95Worst: number | null;
        max: number | null;
    };
    closeCodes: Counter;
    errors: Counter;
    generators: { cpuPercentOfOneCore: (number | null)[]; eventLoopLagP99Ms: (number | null)[] };
    /** One report per scraped URL, taken from the process that scraped it. */
    metrics: MetricsReport[];
    /** Highest CPU share of one core among the scraped endpoints; 100 is a saturated single-threaded server. */
    serverCpuPercentOfOneCore: number | null;
    perProcess: {
        pathRange: [number, number];
        accepted: number;
        deliveryRatio: number | null;
        moveLatencyP95Ms: number | null;
        generatorCpuPercent: number | null;
    }[];
}

function sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function worst(values: readonly (number | null)[]): number | null {
    const present = values.filter((value): value is number => value !== null);
    return present.length === 0 ? null : Math.max(...present);
}

function addCounters(counters: readonly Counter[]): Counter {
    const total: Counter = {};
    for (const counter of counters) {
        for (const [key, value] of Object.entries(counter)) {
            total[key] = (total[key] ?? 0) + value;
        }
    }
    return total;
}

function rate(value: number, seconds: number | null): number {
    return seconds !== null && seconds > 0 ? value / seconds : 0;
}

function round(value: number, digits: number): number {
    return Number(value.toFixed(digits));
}

function mergeTypeTraffic(
    parts: readonly Record<string, TypeTraffic & { bytesPerSecond: number | null; peakBytesPerSecond: number }>[],
): Record<string, MergedTypeTraffic> {
    const merged: Record<string, MergedTypeTraffic> = {};
    for (const part of parts) {
        for (const [type, entry] of Object.entries(part)) {
            const known = merged[type] ?? {
                frames: 0,
                messages: 0,
                records: 0,
                bytes: 0,
                bytesPerSecond: 0,
                peakBytesPerSecondOfOneProcess: 0,
            };
            known.frames += entry.frames;
            known.messages += entry.messages;
            known.records += entry.records;
            known.bytes += entry.bytes;
            known.bytesPerSecond += entry.bytesPerSecond ?? 0;
            known.peakBytesPerSecondOfOneProcess = Math.max(
                known.peakBytesPerSecondOfOneProcess,
                entry.peakBytesPerSecond,
            );
            merged[type] = known;
        }
    }
    for (const entry of Object.values(merged)) {
        entry.bytesPerSecond = round(entry.bytesPerSecond, 2);
    }
    return merged;
}

/** The reasons a process's numbers cannot be trusted as a measurement of the server. */
function invalidReasonsOf(summary: MergeableSummary, index: number, limits: MergeLimits): string[] {
    const reasons: string[] = [];
    const tag = `process ${index} (bots ${summary.scenario.firstPathIndex}..${summary.scenario.lastPathIndex})`;
    const { sessions, generator } = summary;
    if (sessions.accepted !== sessions.requested) {
        reasons.push(`${tag}: ${sessions.accepted} of ${sessions.requested} sessions accepted`);
    }
    if (sessions.rejected > 0) {
        reasons.push(`${tag}: ${sessions.rejected} sessions rejected`);
    }
    if (sessions.unexpectedCloses > 0) {
        reasons.push(`${tag}: ${sessions.unexpectedCloses} sockets closed by the server during the run`);
    }
    const abnormalCloses = Object.keys(summary.closeCodes).filter((code) => code !== "1000");
    if (abnormalCloses.length > 0) {
        reasons.push(`${tag}: close codes ${abnormalCloses.join(", ")}`);
    }
    if (!summary.reconciled) {
        reasons.push(`${tag}: the generator's counters do not reconcile`);
    }
    if (summary.stopReason !== "completed") {
        reasons.push(`${tag}: stopped early (${summary.stopReason}) before its duration ended`);
    }
    // The window is the part of the run the statistics cover; without one, the whole run is.
    const wantedSeconds = summary.window.enabled ? summary.window.seconds : summary.config.durationSeconds;
    const measuredSeconds = summary.window.measuredSeconds ?? 0;
    if (wantedSeconds - measuredSeconds > limits.maxWindowShortfallSeconds) {
        reasons.push(`${tag}: measured ${measuredSeconds} s of the ${wantedSeconds} s it was meant to cover`);
    }
    if (generator.cpuPercentOfOneCore !== null && generator.cpuPercentOfOneCore >= limits.maxGeneratorCpuPercent) {
        reasons.push(`${tag}: generator-bound, ${generator.cpuPercentOfOneCore}% of one core`);
    }
    if (generator.eventLoopLagMs.p99 !== null && generator.eventLoopLagMs.p99 > limits.maxGeneratorLagP99Ms) {
        reasons.push(`${tag}: generator-bound, event-loop lag p99 ${generator.eventLoopLagMs.p99} ms`);
    }
    return reasons;
}

/** The reasons the set of processes is not the run that was meant to happen, whatever each process measured. */
function expectationReasonsOf(summaries: readonly MergeableSummary[], expectation: RunExpectation): string[] {
    const reasons: string[] = [];
    if (expectation.processes !== undefined && summaries.length !== expectation.processes) {
        reasons.push(
            `${summaries.length} generator summaries found, ${expectation.processes} expected: a process is missing or left a stale file`,
        );
    }
    const requested = sum(summaries.map((summary) => summary.sessions.requested));
    if (expectation.sessions !== undefined && requested !== expectation.sessions) {
        reasons.push(`the processes asked for ${requested} bots in all, the level has ${expectation.sessions}`);
    }
    return reasons;
}

export function mergeSummaries(
    summaries: readonly MergeableSummary[],
    limits: MergeLimits = DEFAULT_LIMITS,
    expectation: RunExpectation = {},
): MergedSummary {
    const invalidReasons = [
        ...expectationReasonsOf(summaries, expectation),
        ...summaries.flatMap((summary, index) => invalidReasonsOf(summary, index, limits)),
    ];
    const accepted = sum(summaries.map((summary) => summary.sessions.accepted));
    const expected = sum(summaries.map((summary) => summary.moveProbe.delivery.expected));
    const received = sum(summaries.map((summary) => summary.moveProbe.delivery.received));
    const trafficBytesPerSecond = sum(
        summaries.map((summary) => rate(summary.traffic.bytes, summary.traffic.measuredSeconds)),
    );
    const worldBytes = sum(summaries.map((summary) => summary.worldSpace.bytes));
    const worldBytesPerSecond = sum(
        summaries.map((summary) => rate(summary.worldSpace.bytes, summary.traffic.measuredSeconds)),
    );
    const kbitPerSession = (bytesPerSecond: number) =>
        accepted > 0 ? round((bytesPerSecond * 8) / 1000 / accepted, 2) : null;
    const peerSessions = sum(summaries.map((summary) => summary.knownPeers.sessions));
    const meanOfMedians =
        peerSessions === 0
            ? null
            : sum(summaries.map((summary) => (summary.knownPeers.p50 ?? 0) * summary.knownPeers.sessions)) /
              peerSessions;
    const metricsByUrl = new Map<string, MetricsReport>();
    for (const summary of summaries) {
        for (const report of summary.metrics) {
            const known = metricsByUrl.get(report.url);
            if (known === undefined || known.samples < report.samples) {
                metricsByUrl.set(report.url, report);
            }
        }
    }
    const metrics = [...metricsByUrl.values()];

    return {
        processes: summaries.length,
        valid: invalidReasons.length === 0 && summaries.length > 0,
        invalidReasons: summaries.length === 0 ? ["no generator summary to merge"] : invalidReasons,
        sessions: {
            requested: sum(summaries.map((summary) => summary.sessions.requested)),
            accepted,
            rejected: sum(summaries.map((summary) => summary.sessions.rejected)),
            unexpectedCloses: sum(summaries.map((summary) => summary.sessions.unexpectedCloses)),
        },
        delivery: { expected, received, pooledRatio: expected === 0 ? null : round(received / expected, 4) },
        moveLatencyMs: {
            worstP50: worst(summaries.map((summary) => summary.moveProbe.moveLatencyMs.p50)),
            worstP95: worst(summaries.map((summary) => summary.moveProbe.moveLatencyMs.p95)),
            worstP99: worst(summaries.map((summary) => summary.moveProbe.moveLatencyMs.p99)),
        },
        joinLatencyP95WorstMs: worst(summaries.map((summary) => summary.joinLatencyMs.p95)),
        moveProbe: {
            outsideExpectation: sum(summaries.map((summary) => summary.moveProbe.outsideExpectation)),
            unmatched: sum(summaries.map((summary) => summary.moveProbe.unmatched)),
        },
        walkers: sum(summaries.map((summary) => summary.scenario.walkers)),
        traffic: {
            bytes: sum(summaries.map((summary) => summary.traffic.bytes)),
            overheadBytes: sum(summaries.map((summary) => summary.traffic.overheadBytes)),
            bytesPerSecond: round(trafficBytesPerSecond, 2),
            kbitPerSecondPerSession: kbitPerSession(trafficBytesPerSecond),
            byType: mergeTypeTraffic(summaries.map((summary) => summary.traffic.byType)),
        },
        worldSpace: {
            membersJoined: sum(summaries.map((summary) => summary.worldSpace.membersJoined)),
            watchersSubscribed: sum(summaries.map((summary) => summary.worldSpace.watchersSubscribed)),
            frames: sum(summaries.map((summary) => summary.worldSpace.frames)),
            records: sum(summaries.map((summary) => summary.worldSpace.records)),
            bytes: worldBytes,
            bytesPerSecond: round(worldBytesPerSecond, 2),
            kbitPerSecondPerSession: kbitPerSession(worldBytesPerSecond),
            joinLatencyP95WorstMs: worst(summaries.map((summary) => summary.worldSpace.joinLatencyMs.p95)),
            byType: mergeTypeTraffic(summaries.map((summary) => summary.worldSpace.byType)),
        },
        knownPeers: {
            sessions: peerSessions,
            meanOfMedians: meanOfMedians === null ? null : round(meanOfMedians, 2),
            shareOfPopulation: meanOfMedians === null || accepted < 2 ? null : round(meanOfMedians / (accepted - 1), 4),
            p95Worst: worst(summaries.map((summary) => summary.knownPeers.p95)),
            max: worst(summaries.map((summary) => summary.knownPeers.max)),
        },
        closeCodes: addCounters(summaries.map((summary) => summary.closeCodes)),
        errors: addCounters(summaries.map((summary) => summary.errors)),
        generators: {
            cpuPercentOfOneCore: summaries.map((summary) => summary.generator.cpuPercentOfOneCore),
            eventLoopLagP99Ms: summaries.map((summary) => summary.generator.eventLoopLagMs.p99),
        },
        metrics,
        serverCpuPercentOfOneCore: worst(metrics.map((report) => report.cpuPercentOfOneCore)),
        perProcess: summaries.map((summary) => ({
            pathRange: [summary.scenario.firstPathIndex, summary.scenario.lastPathIndex],
            accepted: summary.sessions.accepted,
            deliveryRatio:
                summary.moveProbe.delivery.expected === 0
                    ? null
                    : round(summary.moveProbe.delivery.received / summary.moveProbe.delivery.expected, 4),
            moveLatencyP95Ms: summary.moveProbe.moveLatencyMs.p95,
            generatorCpuPercent: summary.generator.cpuPercentOfOneCore,
        })),
    };
}

export interface StaircaseThresholds {
    /** Delivery below this ends the staircase's good levels. */
    minDelivery: number;
    /** A server process at or above this share of one core is saturated. */
    maxServerCpuPercent: number;
    /** A move latency p95 above this (worst process) is a failure. Null leaves latency out of the knee. */
    maxMoveP95Ms: number | null;
}

export const DEFAULT_THRESHOLDS: StaircaseThresholds = {
    minDelivery: 0.99,
    maxServerCpuPercent: 100,
    maxMoveP95Ms: null,
};

export interface StaircaseRun {
    repeat: number;
    level: number;
    merged: MergedSummary;
}

export interface StaircaseRow {
    repeat: number;
    level: number;
    valid: boolean;
    accepted: number;
    deliveryPooled: number | null;
    moveP95WorstMs: number | null;
    joinP95WorstMs: number | null;
    serverCpuPercent: number | null;
    kbitPerSecondPerSession: number | null;
    /** Why this level is past the knee; empty when it holds. */
    failures: string[];
}

export interface Staircase {
    thresholds: StaircaseThresholds;
    rows: StaircaseRow[];
    /** Per repeat, the first level that fails: the knee. Null when every level held. */
    kneeByRepeat: { repeat: number; level: number | null; failures: string[] }[];
    /** Median across the repeats that produced a valid run, per level. */
    medianByLevel: {
        level: number;
        validRuns: number;
        deliveryPooled: number | null;
        moveP95WorstMs: number | null;
        serverCpuPercent: number | null;
    }[];
}

export function median(values: readonly (number | null)[]): number | null {
    const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
    if (present.length === 0) {
        return null;
    }
    const middle = Math.floor(present.length / 2);
    return present.length % 2 === 1 ? present[middle] : round((present[middle - 1] + present[middle]) / 2, 4);
}

function failuresOf(merged: MergedSummary, level: number, thresholds: StaircaseThresholds): string[] {
    const failures: string[] = [];
    if (!merged.valid) {
        failures.push("run not valid");
    }
    // A merged.json written without the launcher's expectation cannot vouch for the level it sits under.
    if (merged.sessions.requested !== level) {
        failures.push(`${merged.sessions.requested} bots requested, the level has ${level}`);
    }
    const ratio = merged.delivery.pooledRatio;
    if (ratio !== null && ratio < thresholds.minDelivery) {
        failures.push(`delivery ${ratio} below ${thresholds.minDelivery}`);
    }
    const cpu = merged.serverCpuPercentOfOneCore;
    if (cpu !== null && cpu >= thresholds.maxServerCpuPercent) {
        failures.push(`server at ${cpu}% of one core`);
    }
    const p95 = merged.moveLatencyMs.worstP95;
    if (thresholds.maxMoveP95Ms !== null && p95 !== null && p95 > thresholds.maxMoveP95Ms) {
        failures.push(`move latency p95 ${p95} ms above ${thresholds.maxMoveP95Ms} ms`);
    }
    return failures;
}

/** Reads the levels of one or more repeats and finds where the server stops holding. */
export function summarizeStaircase(
    runs: readonly StaircaseRun[],
    thresholds: StaircaseThresholds = DEFAULT_THRESHOLDS,
): Staircase {
    const rows: StaircaseRow[] = runs
        .map((run) => ({
            repeat: run.repeat,
            level: run.level,
            valid: run.merged.valid,
            accepted: run.merged.sessions.accepted,
            deliveryPooled: run.merged.delivery.pooledRatio,
            moveP95WorstMs: run.merged.moveLatencyMs.worstP95,
            joinP95WorstMs: run.merged.joinLatencyP95WorstMs,
            serverCpuPercent: run.merged.serverCpuPercentOfOneCore,
            kbitPerSecondPerSession: run.merged.traffic.kbitPerSecondPerSession,
            failures: failuresOf(run.merged, run.level, thresholds),
        }))
        .sort((a, b) => a.repeat - b.repeat || a.level - b.level);

    const repeats = [...new Set(rows.map((row) => row.repeat))];
    const kneeByRepeat = repeats.map((repeat) => {
        const knee = rows.find((row) => row.repeat === repeat && row.failures.length > 0);
        return { repeat, level: knee?.level ?? null, failures: knee?.failures ?? [] };
    });

    const levels = [...new Set(rows.map((row) => row.level))].sort((a, b) => a - b);
    const medianByLevel = levels.map((level) => {
        const valid = rows.filter((row) => row.level === level && row.valid);
        return {
            level,
            validRuns: valid.length,
            deliveryPooled: median(valid.map((row) => row.deliveryPooled)),
            moveP95WorstMs: median(valid.map((row) => row.moveP95WorstMs)),
            serverCpuPercent: median(valid.map((row) => row.serverCpuPercent)),
        };
    });
    return { thresholds, rows, kneeByRepeat, medianByLevel };
}

function show(value: number | null, unit = ""): string {
    return value === null ? "n/a" : `${value}${unit}`;
}

/** One line for the console after a level: enough to see whether the level held. */
export function headline(merged: MergedSummary): string {
    const parts = [
        merged.valid ? "valid" : "INVALID",
        `accepted=${merged.sessions.accepted}/${merged.sessions.requested}`,
        `delivery=${show(merged.delivery.pooledRatio)}`,
        `moveP95Worst=${show(merged.moveLatencyMs.worstP95, "ms")}`,
        `joinP95Worst=${show(merged.joinLatencyP95WorstMs, "ms")}`,
        `serverCpu=${show(merged.serverCpuPercentOfOneCore, "%")}`,
        `kbit/s/session=${show(merged.traffic.kbitPerSecondPerSession)}`,
    ];
    return [parts.join(" "), ...merged.invalidReasons.map((reason) => `  - ${reason}`)].join("\n");
}

/** The knee of each repeat and the median per level, as console lines. */
export function staircaseLines(staircase: Staircase): string[] {
    const lines = staircase.kneeByRepeat.map((knee) =>
        knee.level === null
            ? `repeat ${knee.repeat}: every level held`
            : `repeat ${knee.repeat}: knee at ${knee.level} bots (${knee.failures.join("; ")})`,
    );
    for (const level of staircase.medianByLevel) {
        lines.push(
            `n=${level.level}: ${level.validRuns} valid run(s), median delivery=${show(level.deliveryPooled)} ` +
                `moveP95Worst=${show(level.moveP95WorstMs, "ms")} serverCpu=${show(level.serverCpuPercent, "%")}`,
        );
    }
    return lines;
}
