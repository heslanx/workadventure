/**
 * Nearest-rank percentile of values sorted ascending: the smallest value that at least `percent` percent of them do
 * not exceed. Zero for an empty series.
 */
export function percentileOfSorted(sorted: ArrayLike<number>, percent: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    // `percent` is a whole number, so the product is exact where 0.95 * 20 is not
    const rank = Math.ceil((percent * sorted.length) / 100);
    return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/** How a series of durations in milliseconds is distributed. */
export interface E2EFrameStats {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
}

/** The distribution of a series of durations, in the order they are given and left untouched. */
export function summarizeFrameTimes(samples: ArrayLike<number>): E2EFrameStats {
    if (samples.length === 0) {
        return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    }
    const sorted = Float64Array.from(samples).sort();
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) {
        sum += sorted[i];
    }
    return {
        avg: sum / sorted.length,
        p50: percentileOfSorted(sorted, 50),
        p95: percentileOfSorted(sorted, 95),
        p99: percentileOfSorted(sorted, 99),
        max: percentileOfSorted(sorted, 100),
    };
}
