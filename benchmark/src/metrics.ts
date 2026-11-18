import { type Counter, type TimerRegistry, increment } from "./stats";

/**
 * Prometheus text of a server's /metrics endpoint, reduced to the series a load run reads: the process CPU, memory and
 * event-loop figures and everything the application names `workadventure_*`. Keys are `name` or `name{labels}`.
 */
const TRACKED_SERIES =
    /^(process_cpu_seconds_total|process_resident_memory_bytes|nodejs_eventloop_lag_\w+|nodejs_heap_size_used_bytes|workadventure_\w+)(\{|$)/;
const MAX_SERIES_PER_URL = 300;

export function parsePrometheusText(text: string): Map<string, number> {
    const values = new Map<string, number>();
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#")) {
            continue;
        }
        const labelsEnd = line.lastIndexOf("}");
        const nameEnd = labelsEnd >= 0 ? labelsEnd + 1 : line.search(/\s/);
        if (nameEnd <= 0) {
            continue;
        }
        const key = line.slice(0, nameEnd);
        const value = Number(line.slice(nameEnd).trim().split(/\s+/)[0]);
        if (TRACKED_SERIES.test(key) && Number.isFinite(value)) {
            values.set(key, value);
        }
    }
    return values;
}

export interface MetricsSample {
    atMs: number;
    values: Map<string, number>;
}

export interface SeriesSummary {
    first: number;
    last: number;
    /** last - first: the work done between the first and the last scrape, for a counter. */
    delta: number;
    max: number;
}

export interface MetricsReport {
    url: string;
    samples: number;
    errors: Counter;
    /** Seconds after the run started. */
    firstSampleAtSeconds: number | null;
    lastSampleAtSeconds: number | null;
    wallSeconds: number | null;
    cpuSeconds: number | null;
    /** process_cpu_seconds_total over the wall time between the first and the last scrape; 100 is one full core. */
    cpuPercentOfOneCore: number | null;
    rssPeakBytes: number | null;
    eventLoopLagP99MaxSeconds: number | null;
    series: Record<string, SeriesSummary>;
    truncatedSeries: number;
}

function round(value: number, digits: number): number {
    return Number(value.toFixed(digits));
}

/** Pure: what the scrapes of one endpoint say about the span they cover. */
export function summarizeMetrics(
    url: string,
    samples: readonly MetricsSample[],
    errors: Counter,
    originMs: number,
): MetricsReport {
    const series: Record<string, SeriesSummary> = {};
    let truncatedSeries = 0;
    for (const sample of samples) {
        for (const [key, value] of sample.values) {
            const known = series[key];
            if (known !== undefined) {
                known.last = value;
                known.delta = value - known.first;
                known.max = Math.max(known.max, value);
            } else if (Object.keys(series).length < MAX_SERIES_PER_URL) {
                series[key] = { first: value, last: value, delta: 0, max: value };
            } else {
                truncatedSeries += 1;
            }
        }
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const wallSeconds = first === undefined || last === undefined ? null : (last.atMs - first.atMs) / 1000;
    const cpu = series.process_cpu_seconds_total;
    const cpuSeconds = cpu === undefined || samples.length < 2 ? null : cpu.delta;
    return {
        url,
        samples: samples.length,
        errors,
        firstSampleAtSeconds: first === undefined ? null : round((first.atMs - originMs) / 1000, 3),
        lastSampleAtSeconds: last === undefined ? null : round((last.atMs - originMs) / 1000, 3),
        wallSeconds: wallSeconds === null ? null : round(wallSeconds, 3),
        cpuSeconds: cpuSeconds === null ? null : round(cpuSeconds, 3),
        cpuPercentOfOneCore:
            cpuSeconds === null || wallSeconds === null || wallSeconds <= 0
                ? null
                : round((cpuSeconds / wallSeconds) * 100, 1),
        rssPeakBytes: series.process_resident_memory_bytes?.max ?? null,
        eventLoopLagP99MaxSeconds: series.nodejs_eventloop_lag_p99_seconds?.max ?? null,
        series,
        truncatedSeries,
    };
}

export type FetchText = (url: string, signal: AbortSignal) => Promise<string>;

const fetchMetricsText: FetchText = async (url, signal) => {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`http_${response.status}`);
    }
    return response.text();
};

export interface MetricsScraperOptions {
    intervalMs?: number;
    timeoutMs?: number;
    fetchText?: FetchText;
}

/**
 * Scrapes server /metrics endpoints on a timer. A failed scrape is counted, never fatal: the server under load is the
 * thing being measured, and an endpoint that stops answering is a finding.
 */
export class MetricsScraper {
    private readonly samples = new Map<string, MetricsSample[]>();
    private readonly errors = new Map<string, Counter>();
    private readonly pending = new Set<Promise<void>>();
    private readonly intervalMs: number;
    private readonly timeoutMs: number;
    private readonly fetchText: FetchText;
    private interval: NodeJS.Timeout | undefined;
    private begun = false;

    public constructor(
        private readonly urls: readonly string[],
        private readonly timers: TimerRegistry,
        options: MetricsScraperOptions = {},
    ) {
        this.intervalMs = options.intervalMs ?? 5000;
        this.timeoutMs = options.timeoutMs ?? 3000;
        this.fetchText = options.fetchText ?? fetchMetricsText;
        for (const url of urls) {
            this.samples.set(url, []);
            this.errors.set(url, {});
        }
    }

    /** First scrape now, then one every interval. */
    public begin(): void {
        if (this.begun || this.urls.length === 0) {
            return;
        }
        this.begun = true;
        this.track(this.scrapeAll());
        this.interval = this.timers.setInterval(() => this.track(this.scrapeAll()), this.intervalMs);
    }

    /** Stops the timer, waits for scrapes in flight and takes the closing sample. Does nothing before begin(). */
    public async finish(): Promise<void> {
        this.timers.clear(this.interval);
        this.interval = undefined;
        await Promise.all([...this.pending]);
        if (this.begun) {
            await this.scrapeAll();
        }
    }

    public report(originMs: number): MetricsReport[] {
        return this.urls.map((url) =>
            summarizeMetrics(url, this.samples.get(url) ?? [], this.errors.get(url) ?? {}, originMs),
        );
    }

    private track(scrape: Promise<void>): void {
        this.pending.add(scrape);
        void scrape.finally(() => this.pending.delete(scrape));
    }

    private async scrapeAll(): Promise<void> {
        await Promise.all(this.urls.map((url) => this.scrape(url)));
    }

    private async scrape(url: string): Promise<void> {
        const requestedAt = performance.now();
        try {
            const text = await this.fetchText(url, AbortSignal.timeout(this.timeoutMs));
            // The server read its counters somewhere between the request and the response.
            const atMs = (requestedAt + performance.now()) / 2;
            this.samples.get(url)?.push({ atMs, values: parsePrometheusText(text) });
        } catch (error) {
            const reason = error instanceof Error ? error.message : "scrape_failed";
            increment(this.errors.get(url) ?? {}, reason);
        }
    }
}
