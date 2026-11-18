import { afterEach, describe, expect, it, vi } from "vitest";
import { MetricsScraper, parsePrometheusText, summarizeMetrics } from "../src/metrics";
import { TimerRegistry } from "../src/stats";

const EXPOSITION = `# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.
# TYPE process_cpu_seconds_total counter
process_cpu_seconds_total 12.5
process_resident_memory_bytes 734003200
nodejs_eventloop_lag_p99_seconds 0.0123
nodejs_eventloop_lag_max_seconds NaN
nodejs_version_info{version="v24.18.0",major="24"} 1
workadventure_pusher_sub_messages_total{type="userMovedMessage",room="a b"} 4200 1700000000000
workadventure_pusher_connected_sockets 998
http_request_duration_seconds_bucket{le="+Inf"} 9
`;

describe("Prometheus text", () => {
    it("keeps the CPU, memory, event-loop and application series, with labels and values as numbers", () => {
        const values = parsePrometheusText(EXPOSITION);

        expect(Object.fromEntries(values)).toEqual({
            process_cpu_seconds_total: 12.5,
            process_resident_memory_bytes: 734003200,
            nodejs_eventloop_lag_p99_seconds: 0.0123,
            'workadventure_pusher_sub_messages_total{type="userMovedMessage",room="a b"}': 4200,
            workadventure_pusher_connected_sockets: 998,
        });
    });

    it("drops series that are not a finite number, since JSON cannot carry them", () => {
        const values = parsePrometheusText("process_cpu_seconds_total +Inf\nprocess_resident_memory_bytes NaN\n");

        expect(values.size).toBe(0);
    });
});

describe("metrics summary", () => {
    const sample = (atMs: number, values: Record<string, number>) => ({
        atMs,
        values: new Map(Object.entries(values)),
    });

    it("turns the CPU counter into a share of one core over the time between the scrapes", () => {
        const report = summarizeMetrics(
            "http://pusher/metrics",
            [
                sample(1000, { process_cpu_seconds_total: 10, process_resident_memory_bytes: 100 }),
                sample(6000, { process_cpu_seconds_total: 12.5, process_resident_memory_bytes: 300 }),
                sample(11000, { process_cpu_seconds_total: 15, process_resident_memory_bytes: 200 }),
            ],
            {},
            1000,
        );

        // 5 s of CPU over 10 s of wall time: half a core.
        expect(report).toMatchObject({
            samples: 3,
            firstSampleAtSeconds: 0,
            lastSampleAtSeconds: 10,
            wallSeconds: 10,
            cpuSeconds: 5,
            cpuPercentOfOneCore: 50,
            rssPeakBytes: 300,
        });
    });

    it("reports a counter's growth and a gauge's peak by series", () => {
        const report = summarizeMetrics(
            "http://pusher/metrics",
            [
                sample(0, { workadventure_pusher_sub_messages_total: 100, workadventure_pusher_connected_sockets: 10 }),
                sample(5000, {
                    workadventure_pusher_sub_messages_total: 700,
                    workadventure_pusher_connected_sockets: 900,
                }),
                sample(10000, {
                    workadventure_pusher_sub_messages_total: 1500,
                    workadventure_pusher_connected_sockets: 800,
                }),
            ],
            {},
            0,
        );

        expect(report.series.workadventure_pusher_sub_messages_total).toEqual({
            first: 100,
            last: 1500,
            delta: 1400,
            max: 1500,
        });
        expect(report.series.workadventure_pusher_connected_sockets).toMatchObject({ last: 800, max: 900 });
    });

    it("has no CPU figure from a single scrape, since a counter needs two points", () => {
        const report = summarizeMetrics("u", [sample(0, { process_cpu_seconds_total: 10 })], {}, 0);

        expect(report.cpuSeconds).toBeNull();
        expect(report.cpuPercentOfOneCore).toBeNull();
    });

    it("keeps the worst event-loop p99 seen across the scrapes", () => {
        const report = summarizeMetrics(
            "u",
            [
                sample(0, { nodejs_eventloop_lag_p99_seconds: 0.004 }),
                sample(5000, { nodejs_eventloop_lag_p99_seconds: 0.09 }),
                sample(10000, { nodejs_eventloop_lag_p99_seconds: 0.01 }),
            ],
            {},
            0,
        );

        expect(report.eventLoopLagP99MaxSeconds).toBe(0.09);
    });
});

describe("metrics scraper", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("scrapes at the start, every interval and once more on finish, then leaves no timer behind", async () => {
        vi.useFakeTimers();
        const timers = new TimerRegistry();
        let cpu = 0;
        const fetchText = vi.fn(async () => `process_cpu_seconds_total ${(cpu += 2)}\n`);
        const scraper = new MetricsScraper(["http://pusher/metrics"], timers, { intervalMs: 5000, fetchText });

        scraper.begin();
        await vi.advanceTimersByTimeAsync(10_000);
        await scraper.finish();

        // At 0 s, 5 s and 10 s, then the closing scrape.
        expect(fetchText).toHaveBeenCalledTimes(4);
        const [report] = scraper.report(0);
        expect(report).toMatchObject({ samples: 4, cpuSeconds: 6 });
        expect(timers.activeCount).toBe(0);
    });

    it("counts a failed scrape and carries on", async () => {
        vi.useFakeTimers();
        const timers = new TimerRegistry();
        const answers = [new Error("http_503"), "process_cpu_seconds_total 1\n", "process_cpu_seconds_total 3\n"];
        const fetchText = vi.fn(async () => {
            const answer = answers.shift();
            if (answer instanceof Error || answer === undefined) {
                throw answer ?? new Error("none");
            }
            return answer;
        });
        const scraper = new MetricsScraper(["http://pusher/metrics"], timers, { intervalMs: 5000, fetchText });

        scraper.begin();
        await vi.advanceTimersByTimeAsync(5000);
        await scraper.finish();

        const [report] = scraper.report(0);
        expect(report.errors).toEqual({ http_503: 1 });
        expect(report.samples).toBe(2);
        expect(report.cpuSeconds).toBe(2);
    });

    it("scrapes nothing when finish comes before begin, as when a run is aborted before its window", async () => {
        const timers = new TimerRegistry();
        const fetchText = vi.fn(async () => "process_cpu_seconds_total 1\n");
        const scraper = new MetricsScraper(["http://pusher/metrics"], timers, { fetchText });

        await scraper.finish();

        expect(fetchText).not.toHaveBeenCalled();
        expect(scraper.report(0)[0].samples).toBe(0);
    });
});
