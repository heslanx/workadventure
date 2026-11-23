import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
    CANARY,
    canaryBaseline,
    canaryComparable,
    canaryExpression,
    canaryInPage,
    canaryRatio,
    medianOf,
    parseCanaryRun,
    type CanaryRun,
    type CanaryWindow,
} from "../frame-probe/canary";

const run = (medianMs: number | null, samples = 120, dropped = 0): CanaryRun => ({ medianMs, samples, dropped });
const window = (before: number | null, after: number | null): CanaryWindow => ({
    before: before === null ? null : run(before),
    after: after === null ? null : run(after),
});

describe("reading a canary run from the page", () => {
    it("keeps the median of a run with enough samples", () => {
        expect(parseCanaryRun({ medianMs: 1.05, samples: 118, dropped: 2 })).toEqual({
            medianMs: 1.05,
            samples: 118,
            dropped: 2,
        });
    });

    it("drops the figure of a run with too few samples, and says why: a dropped query is where the GPU fell behind", () => {
        const few = Math.floor(CANARY.frames * CANARY.minSampleShare) - 1;

        const read = parseCanaryRun({ medianMs: 0.3, samples: few, dropped: CANARY.frames - few });

        expect(read.medianMs).toBeNull();
        expect(read.reason).toContain(`only ${few} of ${CANARY.frames} canary frames`);
    });

    it("keeps the page's own reason for a run with no timer", () => {
        expect(
            parseCanaryRun({
                medianMs: null,
                samples: 0,
                dropped: 120,
                reason: "no EXT_disjoint_timer_query for the canary",
            }),
        ).toMatchObject({ medianMs: null, reason: "no EXT_disjoint_timer_query for the canary" });
    });

    it("names the field that changed shape", () => {
        expect(() => parseCanaryRun(null, "day before.canary")).toThrow("day before.canary is missing");
        expect(() => parseCanaryRun({ medianMs: "1", samples: 1, dropped: 0 })).toThrow("medianMs is neither null");
        expect(() => parseCanaryRun({ medianMs: 0, samples: 1, dropped: 0 })).toThrow("medianMs is neither null");
        expect(() => parseCanaryRun({ medianMs: 1, samples: -1, dropped: 0 })).toThrow("samples is not a finite count");
    });
});

describe("the baseline and the ratio of a window", () => {
    it("takes the median of every usable run of every window, so one disturbed window does not move it", () => {
        const windows = [window(1, 1.02), window(0.98, 1.01), window(0.31, 0.3)];

        expect(canaryBaseline(windows)).toBeCloseTo(0.99, 9);
    });

    it("has no baseline without a usable run, and ignores windows that have no canary", () => {
        expect(canaryBaseline([undefined, window(null, null)])).toBeNull();
        expect(canaryBaseline([window(null, 2), undefined])).toBe(2);
    });

    it("reads the ratio furthest from 1, in either direction", () => {
        expect(canaryRatio(window(1, 3), 1)).toBe(3);
        expect(canaryRatio(window(1, 0.25), 1)).toBe(0.25);
        expect(canaryRatio(window(null, null), 1)).toBeNull();
    });

    it("medianOf is the middle value, the mean of the two middle ones, and null for none", () => {
        expect(medianOf([3, 1, 2])).toBe(2);
        expect(medianOf([4, 1, 2, 3])).toBe(2.5);
        expect(medianOf([])).toBeNull();
    });
});

describe("whether a window can be compared", () => {
    it.each([
        ["at the baseline", 1, 1, true],
        [`at the low edge, ${CANARY.minRatio}x`, CANARY.minRatio, CANARY.minRatio, true],
        ["just under it", CANARY.minRatio - 0.01, 1, false],
        [`at the high edge, ${CANARY.maxRatio}x`, 1, CANARY.maxRatio, true],
        ["just over it", 1, CANARY.maxRatio + 0.01, false],
        ["when only the run after was far", 1, 3.9, false],
        ["when only the run before was far: the GPU ran 3 times faster, the signature of foreign load", 0.3, 1, false],
    ])("%s", (_name, before, after, expected) => {
        expect(canaryComparable(window(before, after), 1)).toBe(expected);
    });

    // Measured under the game on 2026-11-23 (see CANARY): the machine's own spread must not be an invalid run, and the
    // foreign pass and the fast-GPU episode must
    it.each([
        ["an unstressed window 1.49x its baseline (dusk of q1)", 1.145 / 0.768, 0.768 / 0.768, true],
        ["an unstressed window 0.75x its baseline (day of the control run)", 0.621 / 0.823, 1.091 / 0.823, true],
        [
            "an unstressed window whose run read 0.42x: the GPU ran 2.4 times faster (night of q2)",
            0.38 / 0.912,
            0.97 / 0.912,
            false,
        ],
        ["a window beside a foreign pass, 3.87x (day of the stressed run)", 1.194 / 1.194, 4.617 / 1.194, false],
        ["a window beside a foreign pass, 2.23x (night of the stressed run)", 0.951 / 1.194, 2.665 / 1.194, false],
    ])("%s", (_name, before, after, expected) => {
        expect(canaryComparable(window(before, after), 1)).toBe(expected);
    });

    it("does not flag a window it knows nothing about, or any window when there is no baseline", () => {
        expect(canaryComparable(undefined, 1)).toBe(true);
        expect(canaryComparable(window(null, null), 1)).toBe(true);
        expect(canaryComparable(window(9, 9), null)).toBe(true);
    });
});

/** A context that answers like the page's WebGL 2 with the timer extension, resolving each query to the next time given. */
function fakePage(options: { webgl2?: boolean; extension?: boolean; elapsedMs?: number[]; disjointAt?: number } = {}) {
    const elapsed = options.elapsedMs ?? [1];
    let queries = 0;
    let frame = 0;
    const timer = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2, QUERY_RESULT_AVAILABLE_EXT: 3, QUERY_RESULT_EXT: 4 };
    const times = new Map<object, number>();
    const log: string[] = [];
    const gl = {
        VERTEX_SHADER: 1,
        FRAGMENT_SHADER: 2,
        COMPILE_STATUS: 3,
        LINK_STATUS: 4,
        ARRAY_BUFFER: 5,
        STATIC_DRAW: 6,
        FLOAT: 7,
        TRIANGLES: 8,
        QUERY_RESULT_AVAILABLE: 0x8867,
        QUERY_RESULT: 0x8866,
        createShader: () => ({}),
        shaderSource: () => undefined,
        compileShader: () => undefined,
        getShaderParameter: () => true,
        createProgram: () => ({}),
        attachShader: () => undefined,
        linkProgram: () => undefined,
        getProgramParameter: () => true,
        useProgram: () => undefined,
        createBuffer: () => ({}),
        bindBuffer: () => undefined,
        bufferData: () => undefined,
        getAttribLocation: () => 0,
        enableVertexAttribArray: () => undefined,
        vertexAttribPointer: () => undefined,
        viewport: () => undefined,
        createQuery: () => {
            const query = { n: queries++ };
            times.set(query, elapsed[query.n % elapsed.length] * 1e6);
            return query;
        },
        beginQuery: (target: number) => log.push(`begin:${target}`),
        endQuery: (target: number) => log.push(`end:${target}`),
        drawArrays: () => {
            frame += 1;
            log.push("draw");
        },
        getQueryParameter: (query: object, name: number) => (name === 0x8867 ? true : times.get(query)),
        deleteQuery: () => undefined,
        getParameter: (name: number) =>
            name === timer.GPU_DISJOINT_EXT && options.disjointAt !== undefined && frame >= options.disjointAt,
        getExtension: (name: string) =>
            name === "EXT_disjoint_timer_query_webgl2" && options.extension !== false
                ? timer
                : name === "WEBGL_lose_context"
                  ? { loseContext: () => log.push("lose") }
                  : null,
    };
    const canvas = {
        width: 0,
        height: 0,
        getContext: (kind: string) => (kind === "webgl2" && options.webgl2 !== false ? gl : null),
    };
    const globals = {
        document: { createElement: () => canvas },
        requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
        setTimeout,
        clearTimeout,
        performance,
        Float32Array,
        Boolean,
        Number,
        String,
        Error,
        Promise,
        __name: (target: unknown) => target,
    };
    return { globals, log, canvas, drawn: () => frame };
}

describe("the canary in the page", () => {
    it("draws one fixed pass per frame under a timer query, and reports the median of the samples", async () => {
        const page = fakePage({ elapsedMs: [1, 1.2, 0.8] });

        const report = (await runInNewContext(canaryExpression(30, 64), page.globals)) as Record<string, unknown>;

        expect(page.drawn()).toBe(30);
        expect(report).toEqual({ medianMs: 1, samples: 30, dropped: 0 });
        expect(page.canvas).toMatchObject({ width: 64, height: 64 });
        // each draw is inside its own query, and the context is released at the end
        expect(page.log.filter((line) => line === "begin:1")).toHaveLength(30);
        expect(page.log.filter((line) => line === "end:1")).toHaveLength(30);
        expect(page.log.at(-1)).toBe("lose");
    });

    it("says there is no figure, and why, when the browser has no timer extension", async () => {
        const report: unknown = await runInNewContext(canaryExpression(10, 64), fakePage({ extension: false }).globals);

        expect(report).toMatchObject({ medianMs: null, reason: "no EXT_disjoint_timer_query for the canary" });
    });

    it("says there is no figure when no WebGL context can be made", async () => {
        const report: unknown = await runInNewContext(canaryExpression(10, 64), fakePage({ webgl2: false }).globals);

        expect(report).toMatchObject({ medianMs: null, reason: "no WebGL context for the canary" });
    });

    it("drops the queries a disjoint event invalidates instead of reading them", async () => {
        const page = fakePage({ elapsedMs: [1], disjointAt: 20 });

        const report = (await runInNewContext(canaryExpression(30, 64), page.globals)) as {
            samples: number;
            dropped: number;
        };

        expect(report.samples).toBeLessThan(30);
        expect(report.samples + report.dropped).toBe(30);
    });

    it("is self-contained: its source text needs nothing of this module", () => {
        // Sent to the page as text, it runs where only the page's own globals exist
        expect(canaryExpression()).toContain(canaryInPage.name);
        expect(canaryExpression(5, 8)).toMatch(/\)\(5, 8\)$/);
    });
});
