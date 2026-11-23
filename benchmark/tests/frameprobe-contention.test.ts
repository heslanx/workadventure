import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "../frame-probe/args";
import { CANARY, type CanaryWindow } from "../frame-probe/canary";
import {
    GATE1,
    GATE1_DEFAULT_SETUP,
    GATE1_MODES,
    controlFailureNote,
    failingVotes,
    judgeGate1,
    measureGate1,
    parseCrowdReport,
    parseFrameBench,
    parseNightResult,
    parseRendererInfo,
    renderGate1Markdown,
    type Gate1Capture,
    type Gate1Measurement,
    type Gate1Mode,
    type Gate1Session,
} from "../frame-probe/gate1";
import { pageBench, pageCrowd, pageNight, pageRenderer } from "./support/frameProbeFixtures";

const NIGHT_UPLOAD = 19_726_336;
const shadingOf = (overrides: Record<string, unknown> = {}) => ({
    bakes: 0,
    slices: 0,
    uploads: 0,
    uploadedBytes: 0,
    levelChanges: 0,
    level: 2,
    marked: 20,
    ...overrides,
});

const canaryOf = (before: number | null, after: number | null): CanaryWindow => {
    const run = (medianMs: number | null) => (medianMs === null ? null : { medianMs, samples: 120, dropped: 0 });
    return { before: run(before), after: run(after) };
};

function capture(
    mode: Gate1Mode,
    bench: Record<string, unknown> = {},
    extra: { repeat?: number; canary?: CanaryWindow } = {},
): Gate1Capture {
    return {
        mode,
        nightLevel: GATE1.nightLevels[mode],
        night: parseNightResult(pageNight(GATE1.nightLevels[mode])),
        renderer: parseRendererInfo(pageRenderer()),
        bench: parseFrameBench(pageBench(bench)),
        ...extra,
    };
}

function measurementOf(captures: Gate1Capture[], extra: Partial<Gate1Measurement> = {}): Gate1Measurement {
    return {
        setup: GATE1_DEFAULT_SETUP,
        renderer: parseRendererInfo(pageRenderer()),
        crowd: parseCrowdReport(pageCrowd(), 999),
        captures,
        ...extra,
    };
}

/** Three windows of each mode, the night ones overridden: `night` lists what each of the three reads. */
function threeWindows(night: Record<string, unknown>[], canary?: (mode: Gate1Mode, repeat: number) => CanaryWindow) {
    return GATE1_MODES.flatMap((mode) =>
        [1, 2, 3].map((repeat) =>
            capture(mode, mode === "night" ? night[repeat - 1] : {}, {
                repeat,
                ...(canary ? { canary: canary(mode, repeat) } : {}),
            }),
        ),
    );
}

describe("the shading's counters in a window", () => {
    it("are read from the page: the five counts, the level and the marks, for the window and since the night", () => {
        const bench = parseFrameBench(
            JSON.parse(
                JSON.stringify(
                    pageBench({
                        shading: shadingOf({ bakes: 1, slices: 17, uploads: 1, uploadedBytes: NIGHT_UPLOAD }),
                        shadingSinceNight: shadingOf({ bakes: 1, uploads: 1, uploadedBytes: NIGHT_UPLOAD }),
                    }),
                ),
            ),
        );

        expect(bench.shading).toEqual(shadingOf({ bakes: 1, slices: 17, uploads: 1, uploadedBytes: NIGHT_UPLOAD }));
        expect(bench.shadingSinceNight).toMatchObject({ uploads: 1, uploadedBytes: NIGHT_UPLOAD });
    });

    it("are null for a client that does not report them, and for a room without the shading", () => {
        expect(parseFrameBench(pageBench())).toMatchObject({ shading: null, shadingSinceNight: null });
        expect(parseFrameBench(pageBench({ shading: null, shadingSinceNight: null }))).toMatchObject({
            shading: null,
            shadingSinceNight: null,
        });
    });

    it("name the field that changed shape", () => {
        expect(() => parseFrameBench(pageBench({ shading: shadingOf({ uploads: "1" }) }), "night.bench")).toThrow(
            "night.bench.shading.uploads is not a finite number",
        );
        expect(() => parseFrameBench(pageBench({ shadingSinceNight: 3 }))).toThrow(
            "bench.shadingSinceNight is missing",
        );
    });

    it("flag a window that holds an upload of the cast texture, and do not change its verdict", () => {
        const windows = GATE1_MODES.map((mode) =>
            capture(
                mode,
                mode === "night"
                    ? { shading: shadingOf({ bakes: 1, slices: 17, uploads: 1, uploadedBytes: NIGHT_UPLOAD }) }
                    : { shading: shadingOf() },
            ),
        );

        const verdict = judgeGate1(measurementOf(windows));

        expect(verdict.status).toBe("pass");
        expect(verdict.flags).toEqual([
            expect.stringContaining("night: the shading put its cast texture on the GPU 1 time(s) inside the window"),
        ]);
        expect(verdict.flags?.[0]).toContain(`${NIGHT_UPLOAD} B`);
    });

    it("flag a level change inside a window, and say nothing for a window where the shading did nothing", () => {
        const quiet = judgeGate1(measurementOf(GATE1_MODES.map((mode) => capture(mode, { shading: shadingOf() }))));
        const changed = judgeGate1(
            measurementOf(
                GATE1_MODES.map((mode) =>
                    capture(mode, mode === "dusk" ? { shading: shadingOf({ levelChanges: 1, level: 1 }) } : {}),
                ),
            ),
        );

        expect(quiet.flags).toEqual([]);
        expect(changed.flags).toEqual([expect.stringContaining("dusk: the shading level changed 1 time(s)")]);
    });

    it("are in the report, with the stretch since the night was set", () => {
        const windows = GATE1_MODES.map((mode) =>
            capture(mode, {
                shading: shadingOf({ uploads: 0 }),
                shadingSinceNight: shadingOf({ uploads: 1, uploadedBytes: NIGHT_UPLOAD }),
            }),
        );
        const measurement = measurementOf(windows);

        const markdown = renderGate1Markdown(measurement, judgeGate1(measurement));

        expect(markdown).toContain("| Window | Bakes in window | Slices | Uploads in window |");
        expect(markdown).toContain(`| night | 0 | 0 | 0 | 0 | 0 | 2 | 20 | 1 (${NIGHT_UPLOAD} B) |`);
    });
});

describe("the judge with several windows of each mode", () => {
    const over = { maxGpuMs: 18.03 };

    it("fails a GPU limit on half the windows rounded up, and not on fewer", () => {
        expect([1, 2, 3, 5].map(failingVotes)).toEqual([1, 1, 2, 3]);
    });

    it("passes one window of three over the limit: that is a spike, not a verdict", () => {
        const verdict = judgeGate1(measurementOf(threeWindows([over, {}, {}])));

        expect(verdict).toMatchObject({ status: "pass", exitCode: 0 });
        expect(verdict.criteria.find((c) => c.mode === "night" && c.name === "maxGpuMs")).toMatchObject({
            pass: true,
            windows: 3,
            over: 1,
        });
    });

    it("fails two windows of three over the limit, whichever two", () => {
        for (const night of [
            [over, over, {}],
            [over, {}, over],
            [{}, over, over],
        ]) {
            const verdict = judgeGate1(measurementOf(threeWindows(night)));

            expect(verdict).toMatchObject({ status: "fail", exitCode: 1 });
            expect(verdict.criteria.filter((c) => !c.pass)).toEqual([
                expect.objectContaining({ mode: "night", name: "maxGpuMs", windows: 3, over: 2, actual: 18.03 }),
            ]);
        }
    });

    it("reports the median of the three windows as the figure of a criterion", () => {
        const verdict = judgeGate1(measurementOf(threeWindows([{ avgGpuMs: 5 }, { avgGpuMs: 9 }, { avgGpuMs: 7 }])));

        expect(verdict.criteria.find((c) => c.mode === "night" && c.name === "avgGpuMs")?.actual).toBe(7);
    });

    it("still fails an upload seen in any one window: contention does not make the CPU upload", () => {
        const verdict = judgeGate1(measurementOf(threeWindows([{ largeUploads: 1 }, {}, {}])));

        expect(verdict.exitCode).toBe(1);
        expect(verdict.criteria.filter((c) => !c.pass)).toEqual([
            expect.objectContaining({ mode: "night", name: "largeUploads", actual: 1, over: 1 }),
        ]);
    });

    it("does not pass a mode with a window that has no figure", () => {
        const verdict = judgeGate1(measurementOf(threeWindows([{ maxGpuMs: null }, {}, {}])));

        expect(verdict.criteria.find((c) => c.mode === "night" && c.name === "maxGpuMs")).toMatchObject({
            pass: false,
            actual: null,
        });
    });

    it("says the votes in the report", () => {
        const measurement = measurementOf(threeWindows([over, {}, {}]));

        expect(renderGate1Markdown(measurement, judgeGate1(measurement))).toContain("pass (1 of 3 windows over)");
    });
});

describe("the contention canary in the judge", () => {
    const quiet = canaryOf(1, 1.02);
    const loaded = canaryOf(0.3, 0.31);

    it("leaves out a window whose canary ran far from the session's baseline, and says so", () => {
        // The night window that spiked was measured while the GPU ran 3 times faster, which is what foreign load does
        const windows = threeWindows([{ maxGpuMs: 19.85 }, {}, {}], (mode, repeat) =>
            mode === "night" && repeat === 1 ? loaded : quiet,
        );

        const verdict = judgeGate1(measurementOf(windows));

        expect(verdict.status).toBe("pass");
        expect(verdict.criteria.find((c) => c.mode === "night" && c.name === "maxGpuMs")).toMatchObject({
            windows: 2,
            over: 0,
            actual: 11,
        });
        expect(verdict.flags).toEqual([expect.stringMatching(/^night #1: left out, the canary read 0\.30x/)]);
    });

    it("keeps a real failure that the canary does not explain: both comparable windows exceed the limit", () => {
        const over = { maxGpuMs: 18 };
        const windows = threeWindows([over, over, {}], () => quiet);

        expect(judgeGate1(measurementOf(windows)).status).toBe("fail");
    });

    it("makes a single window the canary flags invalid, never a pass or a fail", () => {
        const windows = GATE1_MODES.map((mode) => capture(mode, {}, { canary: mode === "night" ? loaded : quiet }));

        const verdict = judgeGate1(measurementOf(windows));

        expect(verdict.status).toBe("invalid");
        expect(verdict.exitCode).toBe(2);
        expect(verdict.invalid).toEqual([
            expect.stringContaining("night: only 0 of 1 windows were measured with the GPU free of other load"),
        ]);
    });

    it("makes a mode invalid when fewer windows than a limit needs votes are in range", () => {
        const windows = threeWindows([{}, {}, {}], (mode, repeat) =>
            mode === "night" && repeat !== 3 ? loaded : quiet,
        );

        const verdict = judgeGate1(measurementOf(windows));

        expect(verdict.status).toBe("invalid");
        expect(verdict.invalid.join()).toContain("night: only 1 of 3 windows were measured with the GPU free");
        expect(verdict.invalid.join()).toContain("2 are needed");
    });

    it("still judges by two of three when the canary leaves one window out: one over the limit passes, both fail", () => {
        // 3 captured, 2 comparable: the threshold stays ceil(3/2) = 2, so a single window over is a spike, not a verdict
        const outOne = (mode: Gate1Mode, repeat: number) => (mode === "night" && repeat === 3 ? loaded : quiet);
        const one = judgeGate1(measurementOf(threeWindows([{ maxGpuMs: 18 }, {}, {}], outOne)));
        const both = judgeGate1(measurementOf(threeWindows([{ maxGpuMs: 18 }, { maxGpuMs: 18 }, {}], outOne)));

        expect(one.status).toBe("pass");
        expect(one.criteria.find((c) => c.mode === "night" && c.name === "maxGpuMs")).toMatchObject({
            windows: 2,
            over: 1,
            captured: 3,
            pass: true,
        });
        expect(both.status).toBe("fail");
        expect(both.criteria.find((c) => c.mode === "night" && c.name === "maxGpuMs")).toMatchObject({
            windows: 2,
            over: 2,
            captured: 3,
            pass: false,
        });
    });

    it("says in the report how many windows the canary left out and how many over fail", () => {
        const windows = threeWindows([{ maxGpuMs: 18 }, {}, {}], (mode, repeat) =>
            mode === "night" && repeat === 3 ? loaded : quiet,
        );
        const measurement = measurementOf(windows);

        expect(renderGate1Markdown(measurement, judgeGate1(measurement))).toContain(
            "pass (1 of 2 windows over, 1 of 3 left out by the canary; 2 over fail)",
        );
    });

    it("does not flag a window when the session has no canary, as before it existed", () => {
        expect(judgeGate1(measurementOf(GATE1_MODES.map((mode) => capture(mode)))).flags).toEqual([]);
    });

    it("says when no canary run produced a figure, and judges the windows as they are", () => {
        const none = canaryOf(null, null);
        const verdict = judgeGate1(measurementOf(GATE1_MODES.map((mode) => capture(mode, {}, { canary: none }))));

        expect(verdict.status).toBe("pass");
        expect(verdict.flags).toEqual([expect.stringContaining("the contention canary produced no usable run")]);
    });

    it("prints the canary of each window and whether it was compared", () => {
        const windows = threeWindows([{}, {}, {}], (mode, repeat) =>
            mode === "night" && repeat === 1 ? loaded : quiet,
        );
        const measurement = measurementOf(windows);

        const markdown = renderGate1Markdown(measurement, judgeGate1(measurement));

        expect(markdown).toContain(`Contention canary: a fixed ${CANARY.size}x${CANARY.size} pass`);
        expect(markdown).toMatch(/\| night #1 \| 0\.300 ms \| 0\.310 ms \| 0\.30x \| NO \|/);
        expect(markdown).toMatch(/\| night #2 \| 1\.000 ms \| 1\.020 ms \| 1\.0\dx \| yes \|/);
    });
});

describe("the shading-off control", () => {
    const over = { maxGpuMs: 18.03 };
    const failing = () => threeWindows([over, over, {}]);
    const control = (night: Record<string, unknown>[]) => ({ captures: threeWindows(night) });

    it("calls a failure that also happens with the shading off contention, not a shading regression", () => {
        const verdict = judgeGate1(measurementOf(failing(), { control: control([over, over, {}]) }));

        expect(verdict.status).toBe("fail");
        expect(verdict.criteria.find((c) => !c.pass)).toMatchObject({ name: "maxGpuMs", cause: "contention" });
    });

    it("names the shading when the control stays under the limit", () => {
        const verdict = judgeGate1(measurementOf(failing(), { control: control([{}, {}, {}]) }));

        expect(verdict.criteria.find((c) => !c.pass)).toMatchObject({ name: "maxGpuMs", cause: "shading" });
    });

    it("gives no cause without a control, and none to a limit that held", () => {
        expect(judgeGate1(measurementOf(failing())).criteria.find((c) => !c.pass)).not.toHaveProperty("cause");
        const passing = judgeGate1(measurementOf(threeWindows([{}, {}, {}]), { control: control([over, over, over]) }));
        expect(passing.criteria.every((c) => c.cause === undefined)).toBe(true);
    });

    it("takes a control whose counters say the shading was off as a control: level 0 and no bake", () => {
        const off = { shading: shadingOf({ level: 0 }) };
        const verdict = judgeGate1(measurementOf(failing(), { control: control([off, off, off]) }));

        expect(verdict.criteria.find((c) => !c.pass)).toMatchObject({ name: "maxGpuMs", cause: "shading" });
        expect(verdict.flags).toEqual([]);
    });

    it("gives no cause from a control whose GPU figures are missing, and says its control is unusable", () => {
        const noFigures = { avgGpuMs: null, p99GpuMs: null, maxGpuMs: null };
        const verdict = judgeGate1(measurementOf(failing(), { control: control([noFigures, noFigures, noFigures]) }));

        expect(verdict.status).toBe("fail");
        expect(verdict.criteria.find((c) => !c.pass)).not.toHaveProperty("cause");
        expect(verdict.flags).toEqual(["control for night unusable: 3 of 3 judged windows have no GPU figure"]);
    });

    it("gives no cause from a control with too few windows in range of its canary, whatever its figures say", () => {
        const loaded = canaryOf(0.3, 0.31);
        const quiet = canaryOf(1, 1.02);
        // Night windows read by the canary as loaded: none in range, then one of three in range (two are needed)
        for (const [inRange, kept] of [
            [[], 0],
            [[3], 1],
        ] as const) {
            const captures = threeWindows([over, over, over], (mode, repeat) =>
                mode === "night" && !(inRange as readonly number[]).includes(repeat) ? loaded : quiet,
            );

            const verdict = judgeGate1(measurementOf(failing(), { control: { captures } }));

            expect(verdict.criteria.find((c) => !c.pass)).not.toHaveProperty("cause");
            expect(verdict.flags).toEqual([
                `control for night unusable: only ${kept} of 3 windows were measured with the GPU free of other load, 2 are needed`,
            ]);
        }
    });

    it("gives no cause from a control that still had the shading on, and says it", () => {
        // Level above 0, then a bake with the level at 0: either way the shading ran in the window
        for (const [shading, seen] of [
            [shadingOf({ level: 2 }), "level 2, 0 bakes"],
            [shadingOf({ level: 0, bakes: 3 }), "level 0, 3 bakes"],
        ] as const) {
            const on = { ...over, shading };
            const verdict = judgeGate1(measurementOf(failing(), { control: control([on, on, {}]) }));

            expect(verdict.criteria.find((c) => !c.pass)).not.toHaveProperty("cause");
            expect(verdict.flags).toEqual([
                `control for night unusable: the shading was still on in 2 of 3 windows (night #1: ${seen} in the window)`,
            ]);
        }
    });

    it("leaves the modes whose control is valid with their cause, and flags only the one that is not", () => {
        const captures = [
            ...threeWindows([{}, {}, {}]).filter((c) => c.mode !== "night"),
            ...threeWindows([{ shading: shadingOf() }, {}, {}]).filter((c) => c.mode === "night"),
        ];
        const dayOver = failing().map((c) => (c.mode === "day" ? capture("day", over, { repeat: c.repeat }) : c));

        const verdict = judgeGate1(measurementOf(dayOver, { control: { captures } }));

        expect(verdict.criteria.filter((c) => !c.pass && c.cause !== undefined)).toEqual([
            expect.objectContaining({ mode: "day", name: "maxGpuMs", cause: "shading" }),
        ]);
        expect(verdict.criteria.find((c) => c.mode === "night" && !c.pass)).not.toHaveProperty("cause");
        expect(verdict.flags).toEqual([expect.stringMatching(/^control for night unusable: /)]);
    });

    it("says in the verdict and the report that a control which could not be measured was asked for", () => {
        const note = controlFailureNote(
            new Error("locator.waitFor: Timeout 60000ms exceeded.\nCall log:\n  - waiting"),
        );
        const measurement = measurementOf(failing(), { controlFailure: note });

        const verdict = judgeGate1(measurement);

        expect(verdict.status).toBe("fail");
        expect(verdict.criteria.find((c) => !c.pass)).not.toHaveProperty("cause");
        expect(verdict.flags).toEqual([
            expect.stringContaining("the shading-off control was asked for and could not be measured"),
        ]);
        expect(verdict.flags?.[0]).toContain("locator.waitFor: Timeout 60000ms exceeded.");
        expect(verdict.flags?.[0]).not.toContain("Call log");
        expect(renderGate1Markdown(measurement, verdict)).toContain("could not be measured");
    });

    it("bounds the reason of a control failure and accepts a thrown value that is not an Error", () => {
        expect(controlFailureNote("x".repeat(500)).length).toBeLessThan(400);
        expect(controlFailureNote(undefined)).toContain("undefined");
    });

    it("says it in the report", () => {
        const measurement = measurementOf(failing(), { control: control([over, over, {}]) });

        expect(renderGate1Markdown(measurement, judgeGate1(measurement))).toContain(
            "FAIL (2 of 3 windows over), CONTENTION: also over with the shading off",
        );
    });
});

describe("the sequence with repeats and the canary", () => {
    function session(canary: boolean) {
        const calls: string[] = [];
        let mode: Gate1Mode = "day";
        const s: Gate1Session = {
            rendererInfo: () => {
                calls.push("renderer");
                return Promise.resolve(pageRenderer());
            },
            spawnCrowd: (count) => Promise.resolve(pageCrowd({ requested: count, inScene: count })),
            setNight: (level) => {
                calls.push(`night:${level}`);
                if (level !== null) mode = GATE1_MODES.find((m) => GATE1.nightLevels[m] === level) ?? "day";
                return Promise.resolve(pageNight(level));
            },
            wait: () => Promise.resolve(),
            captureWindow: () => {
                calls.push(`capture:${mode}`);
                return Promise.resolve(pageBench());
            },
            pan: () => Promise.resolve(false),
            releasePan: () => Promise.resolve(),
            screenshot: (name) => {
                calls.push(`shot:${name}`);
                return Promise.resolve(`/out/${name}.png`);
            },
            clearCrowd: () => Promise.resolve(),
            ...(canary
                ? {
                      canary: () => {
                          calls.push("canary");
                          return Promise.resolve({ medianMs: 1, samples: 120, dropped: 0 });
                      },
                  }
                : {}),
        };
        return { s, calls };
    }
    const options = { settleMs: 0, log: () => undefined };

    it("captures each mode three times, with a canary run before the first and after each, and one screenshot per mode", async () => {
        const { s, calls } = session(true);

        const result = await measureGate1(s, { ...options, repeats: 3 });

        expect(result.captures.map((c) => `${c.mode}#${c.repeat}`)).toEqual(
            GATE1_MODES.flatMap((mode) => [1, 2, 3].map((repeat) => `${mode}#${repeat}`)),
        );
        const night = calls.slice(calls.indexOf("night:1"), calls.indexOf("night:null"));
        expect(night.filter((call) => call === "canary")).toHaveLength(4);
        // canary, then window, canary, window, ...: the canary is never inside a window
        expect(night.filter((call) => call === "canary" || call.startsWith("capture"))).toEqual([
            "canary",
            "capture:night",
            "canary",
            "capture:night",
            "canary",
            "capture:night",
            "canary",
        ]);
        expect(calls.filter((call) => call.startsWith("shot:"))).toEqual(["shot:day", "shot:dusk", "shot:night"]);
        // the run after one window is the run before the next: the same object
        const [first, second] = result.captures.filter((c) => c.mode === "night");
        expect(second.canary?.before).toBe(first.canary?.after);
        expect(judgeGate1(result).status).toBe("pass");
    });

    it("captures once and has no canary when the session has none, as before they existed", async () => {
        const { s, calls } = session(false);

        const result = await measureGate1(s, options);

        expect(result.captures).toHaveLength(3);
        expect(result.captures.every((c) => c.canary === undefined && c.repeat === undefined)).toBe(true);
        expect(calls).not.toContain("canary");
    });

    it("refuses a repeat count that is not a whole number of 1 or more, before it touches the page's crowd", async () => {
        await expect(measureGate1(session(false).s, { ...options, repeats: 0 })).rejects.toThrow("repeats is 0");
    });
});

describe("the options of the gate1 command", () => {
    const MAC = { platform: "darwin" };
    const ROOM = "http://konclui-qa.localhost:8094/~/konclui-office-next/office.wam";

    it("repeats 3 windows and has no control unless asked", () => {
        expect(parseArgs(["gate1", ROOM], MAC)).toMatchObject({ repeats: 3, shadingControl: false });
        expect(parseArgs(["gate1", ROOM, "--repeats=1", "--shading-control"], MAC)).toMatchObject({
            repeats: 1,
            shadingControl: true,
        });
    });

    it("refuses an even or a malformed count: half of the windows would be a tie", () => {
        for (const bad of ["--repeats=2", "--repeats=0", "--repeats=1.5", "--repeats=x"]) {
            expect(() => parseArgs(["gate1", ROOM, bad], MAC)).toThrow(UsageError);
        }
    });

    it("keeps both options to gate1", () => {
        expect(() => parseArgs(["frames", ROOM, "--repeats=3"], MAC)).toThrow(UsageError);
        expect(() => parseArgs(["compare", ROOM, "--shading-control"], MAC)).toThrow(UsageError);
    });
});
