import { describe, expect, it } from "vitest";
import { GPU_MIN_COVERAGE, parseRecording, phaseMeasurement, type Recording } from "../frame-probe/recording";
import {
    isSoftwareRenderer,
    kibPerSecond,
    payloadBytes,
    percentile,
    pixelsPerGameUnit,
    summarizeLongTasks,
    summarizeRates,
    waitForStableValue,
    zoomedOut,
} from "../frame-probe/signals";
import { GPU, SWIFTSHADER } from "./support/frameProbeFixtures";

describe("percentile", () => {
    const twenty = Array.from({ length: 20 }, (_, index) => index + 1);

    it("is the nearest rank: the smallest sample that at least that share of them do not exceed", () => {
        expect(percentile(twenty, 50)).toBe(10);
        expect(percentile(twenty, 95)).toBe(19);
        expect(percentile(twenty, 100)).toBe(20);
    });

    it("does not depend on the order of the samples", () => {
        expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    });

    it("reads a single sample as that sample, and no sample as null rather than 0", () => {
        expect(percentile([7], 95)).toBe(7);
        expect(percentile([], 95)).toBeNull();
    });
});

describe("WebSocket bytes through CDP", () => {
    it("counts a binary frame from its base64 payload, padding included", () => {
        expect(payloadBytes(2, "AAAA")).toBe(3);
        expect(payloadBytes(2, "AAA=")).toBe(2);
        expect(payloadBytes(2, "AA==")).toBe(1);
        expect(payloadBytes(2, "")).toBe(0);
        // 01 02 03 04 05
        expect(payloadBytes(2, "AQIDBAU=")).toBe(5);
    });

    it("counts a text frame in UTF-8 bytes, not characters", () => {
        expect(payloadBytes(1, "héllo")).toBe(6);
    });

    it("buckets KiB by whole second and drops the part-second at the end and the frames outside the window", () => {
        const events = [
            { atMs: 10_100, bytes: 1024 },
            { atMs: 10_900, bytes: 1024 },
            { atMs: 11_500, bytes: 2048 },
            { atMs: 13_200, bytes: 4096 },
            { atMs: 9_999, bytes: 512 },
        ];

        expect(kibPerSecond(events, 10_000, 13_500)).toEqual([2, 2, 0]);
    });

    it("summarizes the seconds as p50 and p95, and an empty window as null", () => {
        expect(summarizeRates([1, 2, 3, 4, 5])).toEqual({ p50: 3, p95: 5 });
        expect(summarizeRates([])).toEqual({ p50: null, p95: null });
    });
});

describe("long tasks in a window", () => {
    const entries = [
        { startTime: 100, duration: 60 },
        { startTime: 500, duration: 800 },
        { startTime: 2100, duration: 51 },
    ];

    it("counts the tasks that started inside the window, with the longest and the total", () => {
        expect(summarizeLongTasks(entries, 400, 2100)).toEqual({ count: 1, maxMs: 800, totalMs: 800 });
        expect(summarizeLongTasks(entries, 0, 5000)).toEqual({ count: 3, maxMs: 800, totalMs: 911 });
    });

    it("counts a task once, in the window it began in, even when it runs on into the next", () => {
        const straddling = [{ startTime: 390, duration: 100 }];

        expect(summarizeLongTasks(straddling, 0, 400).count).toBe(1);
        expect(summarizeLongTasks(straddling, 400, 800).count).toBe(0);
    });

    it("reads a window without a long task as zero", () => {
        expect(summarizeLongTasks([], 0, 1000)).toEqual({ count: 0, maxMs: 0, totalMs: 0 });
    });
});

describe("the renderer and the zoom", () => {
    it("tells a CPU rasteriser from a GPU", () => {
        expect(isSoftwareRenderer(SWIFTSHADER)).toBe(true);
        expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
        expect(isSoftwareRenderer(GPU)).toBe(false);
        expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(
            false,
        );
    });

    it("reads the scale as pixels per game pixel between two game points", () => {
        expect(pixelsPerGameUnit({ x: 10, y: 20 }, { x: 310, y: 20 }, 1000)).toBeCloseTo(0.3);
        // 600 across and 800 down is 1000 px of screen for 1000 game px
        expect(pixelsPerGameUnit({ x: 0, y: 0 }, { x: 600, y: 800 }, 1000)).toBe(1);
    });

    it("counts a zoom-out only when the scale shrank by a clear margin", () => {
        expect(zoomedOut(1, 0.5)).toBe(true);
        expect(zoomedOut(1, 0.97)).toBe(false);
        expect(zoomedOut(1, 1.2)).toBe(false);
    });
});

describe("waiting for a value to settle", () => {
    function harness(readings: (number | null)[]) {
        let clock = 0;
        let reads = 0;
        return {
            read: () => Promise.resolve(readings[Math.min(reads++, readings.length - 1)]),
            options: {
                intervalMs: 250,
                stableSamples: 3,
                tolerance: 0.005,
                timeoutMs: 1000,
                sleep: (ms: number) => {
                    clock += ms;
                    return Promise.resolve();
                },
                now: () => clock,
            },
            reads: () => reads,
        };
    }

    it("returns once three consecutive readings agree", async () => {
        const { read, options, reads } = harness([1, 0.8, 0.5, 0.5, 0.5]);

        await expect(waitForStableValue(read, { ...options, timeoutMs: 10_000 })).resolves.toBe(0.5);
        expect(reads()).toBe(5);
    });

    it("treats a reading of null (the camera still moving) as not settled and starts the count again", async () => {
        const { read, options, reads } = harness([0.5, 0.5, null, 0.5, 0.5, 0.5]);

        await expect(waitForStableValue(read, { ...options, timeoutMs: 10_000 })).resolves.toBe(0.5);
        expect(reads()).toBe(6);
    });

    it("accepts readings that differ by less than the tolerance, and returns the last", async () => {
        const { read, options } = harness([1.0, 1.004, 1.002]);

        await expect(waitForStableValue(read, options)).resolves.toBe(1.002);
    });

    it("throws, with the last readings, when the value never settles", async () => {
        const { read, options } = harness([1, 2, 3, 4, 5, 6, 7, 8, 9]);

        await expect(waitForStableValue(read, options)).rejects.toThrow(/did not settle within 1000 ms.*\[1,2,3,4,5\]/);
    });
});

describe("the frame recording the page returns", () => {
    const stats = (p50: number, p95: number) => ({
        avg: Math.round((p50 + 0.2) * 10) / 10,
        p50,
        p95,
        p99: p95 + 1,
        max: p95 + 3,
    });
    const without = (object: Record<string, unknown>, ...keys: string[]) =>
        Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
    // The shape of play/src/front/Utils/E2EHooks.ts E2EFrameRecording as the working tree builds it: the GPU figure is
    // null whenever the browser cannot time the GPU, which is a normal state
    const page = {
        frames: 900,
        durationMs: 15_000,
        workMs: stats(7.4, 8.5),
        intervalMs: stats(16.7, 16.8),
        stepMs: stats(5, 6),
        renderMs: stats(2, 2.5),
        gpuMs: null,
        gpuMethod: null,
        gpuUnavailableReason: "extension-missing",
        gpuDropped: 0,
        budget: { avgLimitMs: 11, maxLimitMs: 16.7, workOver16_7Ms: 0, workOver11Ms: 0, workPassed: true },
        skippedRenders: 4,
        longTasks: { supported: true, count: 0, totalMs: 0 },
        truncated: false,
    };
    const gpuStats = {
        ...stats(2.9, 4.2),
        samples: 800,
        dropped: 20,
        droppedRatio: 20 / 820,
        coverage: 0.97,
        method: "EXT_disjoint_timer_query_webgl2",
        scope: "GL commands from POST_STEP to POST_RENDER of rendered frames",
    };

    it("is read when the page has no GPU timer: a null gpuMs is a state, not an error", () => {
        const recording = parseRecording(page);

        expect(recording.workMs).toEqual({ avg: 7.6, p50: 7.4, p95: 8.5, p99: 9.5, max: 11.5 });
        expect(recording.gpuMs).toBeNull();
        expect(recording.gpuUnavailableReason).toBe("extension-missing");
    });

    it("is read from a client whose recorder predates averages and GPU time", () => {
        const older = without(page, "gpuMs", "gpuMethod", "gpuUnavailableReason", "gpuDropped");

        const recording = parseRecording({ ...older, workMs: without(page.workMs, "avg") });

        expect(recording.workMs).toEqual({ p50: 7.4, p95: 8.5, p99: 9.5, max: 11.5 });
        expect(recording.gpuMs).toBeUndefined();
        expect(phaseMeasurement({ recording, ...inputs }).metrics["work.avg"]).toBeNull();
    });

    it("fails by name when the recorder changed shape, instead of reporting NaN", () => {
        expect(() => parseRecording({ ...page, workMs: undefined })).toThrow("workMs is missing");
        expect(() => parseRecording({ ...page, workMs: { ...page.workMs, p95: Number.NaN } })).toThrow(
            "workMs.p95 is not a finite number",
        );
    });

    const recording = (extra: Record<string, unknown> = {}): Recording => parseRecording({ ...page, ...extra });
    const inputs = {
        longTasks: { count: 2, maxMs: 120, totalMs: 200 },
        nameTags: { present: 114, shown: 110 },
        ws: { rx: { p50: 20, p95: 30 }, tx: { p50: 1, p95: 2 } },
    };

    it("flattens one phase into the metric names a budget points at", () => {
        const { metrics, truncated } = phaseMeasurement({ recording: recording(), ...inputs });

        expect(truncated).toBe(false);
        expect(metrics).toMatchObject({
            "work.p50": 7.4,
            "work.p95": 8.5,
            "step.p95": 6,
            "render.p95": 2.5,
            "interval.p95": 16.8,
            frames: 900,
            skippedRenders: 4,
            "longTasks.count": 2,
            "longTasks.maxMs": 120,
            "nameTags.present": 114,
            "nameTags.shown": 110,
            "ws.rxKiBps.p95": 30,
            "ws.txKiBps.p50": 1,
        });
    });

    it("leaves what was not measured null, never 0: no long-task support, no WebSocket sample, no GPU timer", () => {
        const { metrics } = phaseMeasurement({ recording: recording(), ...inputs, longTasks: null, ws: null });

        expect(metrics["longTasks.count"]).toBeNull();
        expect(metrics["ws.rxKiBps.p50"]).toBeNull();
        expect(metrics["gpu.p95"]).toBeNull();
    });

    it("carries the averages and the GPU time when the page could time its frames", () => {
        const withGpu = recording({ gpuMs: gpuStats, gpuMethod: gpuStats.method, gpuUnavailableReason: null });
        const { metrics, gpuNote } = phaseMeasurement({ recording: withGpu, ...inputs });

        expect(metrics).toMatchObject({
            "work.avg": 7.6,
            "gpu.avg": 3.1,
            "gpu.p50": 2.9,
            "gpu.p95": 4.2,
            "gpu.p99": 5.2,
            "gpu.max": 7.2,
        });
        expect(gpuNote).toBeNull();
    });

    it("leaves gpu.* null and says why when the page could not time the GPU", () => {
        const { metrics, gpuNote } = phaseMeasurement({ recording: recording(), ...inputs });

        expect(metrics["gpu.p95"]).toBeNull();
        expect(metrics["gpu.avg"]).toBeNull();
        expect(gpuNote).toBe("extension-missing");
    });

    it("says the recorder is old when it reports no GPU field at all", () => {
        const older = parseRecording(without(page, "gpuMs", "gpuUnavailableReason"));

        const { metrics, gpuNote } = phaseMeasurement({ recording: older, ...inputs });

        expect(metrics["gpu.p95"]).toBeNull();
        expect(gpuNote).toBe("the client's recorder reports no GPU time");
    });

    it("does not quote a GPU figure that covers too few of the rendered frames", () => {
        const sparse = recording({ gpuMs: { ...gpuStats, samples: 400, coverage: 0.45 }, gpuUnavailableReason: null });

        const { metrics, gpuNote } = phaseMeasurement({ recording: sparse, ...inputs });

        expect(metrics["gpu.p95"]).toBeNull();
        expect(gpuNote).toBe("only 45% of the rendered frames have a GPU sample, 90% are needed");
    });

    it("accepts the coverage the recorder itself accepts, and refuses an object with no sample", () => {
        const atLimit = recording({ gpuMs: { ...gpuStats, coverage: GPU_MIN_COVERAGE }, gpuUnavailableReason: null });
        const empty = recording({ gpuMs: { ...gpuStats, samples: 0, coverage: 1 }, gpuUnavailableReason: null });

        expect(phaseMeasurement({ recording: atLimit, ...inputs }).metrics["gpu.p95"]).toBe(4.2);
        expect(phaseMeasurement({ recording: empty, ...inputs })).toMatchObject({
            metrics: { "gpu.p95": null },
            gpuNote: "no-samples",
        });
    });

    it("fails by name when a GPU object lost a field the probe reads", () => {
        expect(() => parseRecording({ ...page, gpuMs: without(gpuStats, "coverage") })).toThrow(
            "gpuMs.coverage is not a finite number",
        );
        expect(() => parseRecording({ ...page, gpuMs: { ...gpuStats, samples: "many" } })).toThrow(
            "gpuMs.samples is not a finite number",
        );
    });

    it("passes on that the recording outgrew its buffer", () => {
        expect(phaseMeasurement({ recording: recording({ truncated: true }), ...inputs }).truncated).toBe(true);
    });
});
