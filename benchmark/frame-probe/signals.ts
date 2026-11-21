/**
 * The small pure computations behind what the probe reads from a page: percentiles, WebSocket bytes through CDP,
 * long tasks inside a window, the zoom scale and the wait for it to settle. No browser is needed to test them.
 */

/**
 * Nearest-rank percentile for a whole-number `percent`, the definition of the page recorder
 * (`percentileOfSorted` in play/src/front/Utils/E2EHooks.ts): the smallest value that at least `percent` percent of the
 * samples do not exceed. Null with no sample, so an empty window cannot read as 0 ms.
 */
export function percentile(samples: readonly number[], percent: number): number | null {
    if (samples.length === 0) {
        return null;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const rank = Math.ceil((percent * sorted.length) / 100);
    return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Bytes of one WebSocket frame as the DevTools protocol reports it: a text frame (opcode 1) carries the text itself,
 * every other one carries base64.
 */
export function payloadBytes(opcode: number, payloadData: string): number {
    if (opcode === 1) {
        return Buffer.byteLength(payloadData, "utf8");
    }
    const padding = payloadData.endsWith("==") ? 2 : payloadData.endsWith("=") ? 1 : 0;
    return Math.floor((payloadData.length * 3) / 4) - padding;
}

export interface TimedBytes {
    readonly atMs: number;
    readonly bytes: number;
}

/** KiB in each whole second of [startMs, endMs). The part-second at the end is dropped, so every bucket is a full one. */
export function kibPerSecond(events: readonly TimedBytes[], startMs: number, endMs: number): number[] {
    const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const buckets = new Array<number>(seconds).fill(0);
    for (const event of events) {
        const index = Math.floor((event.atMs - startMs) / 1000);
        if (index >= 0 && index < seconds) {
            buckets[index] += event.bytes / 1024;
        }
    }
    return buckets;
}

export interface RateSummary {
    readonly p50: number | null;
    readonly p95: number | null;
}

export function summarizeRates(kibPerSecondBuckets: readonly number[]): RateSummary {
    return { p50: percentile(kibPerSecondBuckets, 50), p95: percentile(kibPerSecondBuckets, 95) };
}

/** A `longtask` entry of the page: startTime is on the page clock (performance.now()). */
export interface LongTaskEntry {
    readonly startTime: number;
    readonly duration: number;
}

export interface LongTaskSummary {
    readonly count: number;
    readonly maxMs: number;
    readonly totalMs: number;
}

/** The long tasks that started in [startMs, endMs) on the page clock. A task counts once, in the window it began in. */
export function summarizeLongTasks(entries: readonly LongTaskEntry[], startMs: number, endMs: number): LongTaskSummary {
    let count = 0;
    let maxMs = 0;
    let totalMs = 0;
    for (const entry of entries) {
        if (entry.startTime >= startMs && entry.startTime < endMs) {
            count++;
            maxMs = Math.max(maxMs, entry.duration);
            totalMs += entry.duration;
        }
    }
    return { count, maxMs, totalMs };
}

/**
 * A WebGL renderer that is a CPU rasteriser. Frame times from one say nothing about a user's GPU: the probe refuses to
 * call such a run valid unless it was asked for one.
 */
export function isSoftwareRenderer(renderer: string): boolean {
    return /swiftshader|llvmpipe|softpipe|software/i.test(renderer);
}

export interface Point {
    readonly x: number;
    readonly y: number;
}

/** CSS pixels per game pixel, from where two game points `units` apart on the x axis land in the browser. */
export function pixelsPerGameUnit(origin: Point, along: Point, units: number): number {
    return Math.hypot(along.x - origin.x, along.y - origin.y) / units;
}

/** The whole-map step reached a smaller scale than the default view, by at least `minShrink` (0.1 is 10%). */
export function zoomedOut(defaultScale: number, wholeMapScale: number, minShrink = 0.1): boolean {
    return wholeMapScale <= defaultScale * (1 - minShrink);
}

export interface SettleOptions {
    readonly intervalMs: number;
    /** How many consecutive readings must agree. */
    readonly stableSamples: number;
    /** Relative: 0.005 is half a percent. */
    readonly tolerance: number;
    readonly timeoutMs: number;
    readonly sleep: (ms: number) => Promise<void>;
    readonly now: () => number;
}

/**
 * Reads a value until `stableSamples` consecutive readings agree within `tolerance`. A null reading means "not readable
 * yet" (the camera is still moving) and restarts the count. Throws, with the last readings, when it never settles.
 */
export async function waitForStableValue(read: () => Promise<number | null>, options: SettleOptions): Promise<number> {
    const startedAt = options.now();
    const recent: number[] = [];
    const seen: (number | null)[] = [];
    for (;;) {
        const value = await read();
        seen.push(value);
        if (value === null) {
            recent.length = 0;
        } else {
            recent.push(value);
            if (recent.length > options.stableSamples) {
                recent.shift();
            }
            const reference = recent[recent.length - 1];
            if (
                recent.length === options.stableSamples &&
                recent.every((sample) => Math.abs(sample - reference) <= Math.abs(reference) * options.tolerance)
            ) {
                return reference;
            }
        }
        if (options.now() - startedAt >= options.timeoutMs) {
            throw new Error(
                `the value did not settle within ${options.timeoutMs} ms; last readings: ${JSON.stringify(seen.slice(-6))}`,
            );
        }
        await options.sleep(options.intervalMs);
    }
}
