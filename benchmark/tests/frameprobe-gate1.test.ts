import { describe, expect, it } from "vitest";
import { main, type CliDependencies } from "../frame-probe/cli";
import { parseArgs, UsageError } from "../frame-probe/args";
import {
    GATE1,
    GATE1_MODES,
    Gate1InvalidRun,
    judgeGate1,
    measureGate1,
    NIGHT_SETTLE_MS,
    PAN_LEG,
    parseCrowdReport,
    parseFrameBench,
    parseNightResult,
    parseRendererInfo,
    phaserModeProblem,
    renderGate1Markdown,
    runGate1Report,
    type Gate1Capture,
    type Gate1Measurement,
    type Gate1Mode,
    type Gate1Session,
} from "../frame-probe/gate1";
import { avatarFlagProblems, GATE1_STORAGE, gate1Storage, missingBuffer } from "../frame-probe/gate1Browser";
import { pageBench, pageCrowd, pageNight, pageRenderer, SWIFTSHADER } from "./support/frameProbeFixtures";

function capture(
    mode: Gate1Mode,
    bench: Record<string, unknown> = {},
    renderer = {},
    night: Record<string, unknown> = {},
): Gate1Capture {
    return {
        mode,
        nightLevel: GATE1.nightLevels[mode],
        night: parseNightResult(pageNight(GATE1.nightLevels[mode], night)),
        renderer: parseRendererInfo(pageRenderer(renderer)),
        bench: parseFrameBench(pageBench(bench)),
    };
}

/** A measurement of the three windows: `windows` overrides the page's bench of any of them. */
function measurementOf(
    windows: Partial<Record<Gate1Mode, Record<string, unknown>>> = {},
    extra: Partial<Gate1Measurement> = {},
): Gate1Measurement {
    return {
        renderer: parseRendererInfo(pageRenderer()),
        crowd: parseCrowdReport(pageCrowd(), 999),
        captures: GATE1_MODES.map((mode) => capture(mode, windows[mode])),
        ...extra,
    };
}

/** The day and the night windows overridden, the dusk one as the page returns it. */
function measurement(
    day: Record<string, unknown> = {},
    night: Record<string, unknown> = {},
    extra: Partial<Gate1Measurement> = {},
): Gate1Measurement {
    return measurementOf({ day, night }, extra);
}

describe("parsing what the page returns", () => {
    it("reads a window of the real shape, ignoring the nested statistics it does not need", () => {
        const bench = parseFrameBench(JSON.parse(JSON.stringify(pageBench())));

        expect(bench).toMatchObject({
            frames: 300,
            gpuTimer: "webgl2",
            avgGpuMs: 6.2,
            maxGpuMs: 11,
            fullMapUploads: 0,
        });
        expect(bench).not.toHaveProperty("frameMs");
    });

    it("keeps null GPU figures null: a window without a timer is not a window of 0 ms", () => {
        const bench = parseFrameBench(
            pageBench({
                gpuTimer: "none",
                gpuMs: null,
                avgGpuMs: null,
                p95GpuMs: null,
                p99GpuMs: null,
                maxGpuMs: null,
                gpuSamples: 0,
            }),
        );

        expect(bench.avgGpuMs).toBeNull();
        expect(bench.maxGpuMs).toBeNull();
    });

    it("names the field that changed shape, instead of reading NaN", () => {
        const without = pageBench();
        delete without.fullMapUploads;
        expect(() => parseFrameBench(without, "night.bench")).toThrow(
            "night.bench.fullMapUploads is not a finite number",
        );
        expect(() => parseFrameBench(pageBench({ avgGpuMs: "6" }))).toThrow("bench.avgGpuMs is not a finite number");
        expect(() => parseFrameBench(pageBench({ gpuTimer: "webgl3" }))).toThrow(
            "gpuTimer is not webgl2, webgl1-ext or none",
        );
        expect(() => parseFrameBench(null)).toThrow("bench is missing");
    });

    it("reads the renderer, and a context that has gone as a drawing buffer of 0", () => {
        expect(parseRendererInfo(pageRenderer())).toMatchObject({
            width: 1920,
            version: "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
        });
        expect(parseRendererInfo(pageRenderer({ width: undefined, height: undefined }))).toMatchObject({
            width: 0,
            height: 0,
        });
        expect(() => parseRendererInfo(pageRenderer({ activeFilters: "KfxPost" }))).toThrow("activeFilters");
    });
});

describe("the crowd, the night and the page errors", () => {
    it("reads the spawn report of the real shape: the groups, the fallback and the layers of the recipes", () => {
        const crowd = parseCrowdReport(JSON.parse(JSON.stringify(pageCrowd())), 999);

        expect(crowd).toEqual({
            requested: 999,
            inScene: 999,
            groups: { glass: 250, lights: 250, borders: 250, spread: 249 },
            fallbackGroups: [],
            layersPerRecipe: { min: 4, max: 6 },
        });
    });

    it("names the part of the spawn report that changed shape", () => {
        const without = pageCrowd();
        delete without.layersPerRecipe;

        expect(() => parseCrowdReport(without, 999)).toThrow("crowd.layersPerRecipe is missing");
        expect(() => parseCrowdReport(pageCrowd({ fallbackGroups: "glass" }), 999)).toThrow("fallbackGroups");
        expect(() => parseCrowdReport(pageCrowd({ groups: { glass: 1 } }), 999)).toThrow("crowd.groups.lights");
        expect(() => parseCrowdReport(pageCrowd({ inScene: "999" }), 999)).toThrow("crowd.inScene");
    });

    it("reads what setBenchNight returned, and refuses one without nightOn", () => {
        expect(parseNightResult(pageNight(1))).toEqual({ level: 1, hour: 19.3, nightOn: true });
        expect(parseNightResult(pageNight(0.85))).toMatchObject({ nightOn: false });
        expect(() => parseNightResult({ level: 1, hour: 19.3 })).toThrow("night.nightOn is not a boolean");
    });

    it("recognises a client that does not know ?phaserMode=webgl2 from its page error", () => {
        const error = 'phaserMode parameter must be one of "auto", "canvas", "webgl", "webgl2" or "headless"';

        expect(phaserModeProblem(["other", error])).toContain("does not accept ?phaserMode=webgl2");
        expect(phaserModeProblem(["TypeError: x is undefined"])).toBeUndefined();
        expect(phaserModeProblem([])).toBeUndefined();
    });
});

describe("the judge", () => {
    it("passes a run that meets every limit in day, dusk and night, and lists the 15 criteria", () => {
        const verdict = judgeGate1(measurement());

        expect(verdict).toMatchObject({ status: "pass", exitCode: 0, invalid: [] });
        expect(verdict.criteria.map((c) => `${c.mode}.${c.name}`)).toEqual(
            GATE1_MODES.flatMap((mode) =>
                ["avgGpuMs", "p99GpuMs", "maxGpuMs", "fullMapUploads", "largeUploads"].map((name) => `${mode}.${name}`),
            ),
        );
        expect(verdict.criteria).toHaveLength(15);
    });

    it("passes at exactly the limits: 11.0 average, 15.5 p99, 16.7 max, 0 full-map and 0 large uploads", () => {
        const atLimit = { avgGpuMs: 11, p99GpuMs: 15.5, maxGpuMs: 16.7, fullMapUploads: 0, largeUploads: 0 };

        expect(judgeGate1(measurementOf({ day: atLimit, dusk: atLimit, night: atLimit })).exitCode).toBe(0);
    });

    it("measures the mandate's night 0.85 as the dusk window and the night-only lights as a window of their own", () => {
        expect(GATE1.nightLevels).toEqual({ day: 0, dusk: 0.85, night: 1 });
        expect(GATE1.nightLightsOn).toEqual({ day: false, dusk: false, night: true });
    });

    it.each([
        ["avgGpuMs", 11.01],
        ["p99GpuMs", 15.51],
        ["maxGpuMs", 16.71],
        ["fullMapUploads", 1],
        // The mirror atlas of the real map is 2752 x 384: not a whole map, so fullMapUploads cannot see it
        ["largeUploads", 1],
    ])("exits 1 when %s is just over its limit, in any one of the three windows", (name, over) => {
        for (const mode of GATE1_MODES) {
            const failing = { [name]: over };
            const verdict = judgeGate1(measurementOf({ [mode]: failing }));

            // Judging a limit with < instead of <= would also fail the at-limit test above; ignoring this one passes it
            expect(verdict.exitCode).toBe(1);
            expect(verdict.status).toBe("fail");
            expect(verdict.criteria.filter((c) => !c.pass)).toEqual([
                expect.objectContaining({ mode, name, actual: over }),
            ]);
        }
    });

    it("does not judge the frame interval: it cannot fall below the display period", () => {
        expect(judgeGate1(measurement({ avgFrameMs: 33, p99FrameMs: 40, maxFrameMs: 90 })).exitCode).toBe(0);
    });

    describe("an invalid run is exit 2, never a pass or a fail", () => {
        const reasonOf = (m: Gate1Measurement) => judgeGate1(m).invalid.join(" | ");

        it("on a software renderer", () => {
            const software = parseRendererInfo(pageRenderer({ renderer: SWIFTSHADER }));
            const verdict = judgeGate1(measurement({}, {}, { renderer: software }));

            expect(verdict.exitCode).toBe(2);
            expect(reasonOf(measurement({}, {}, { renderer: software }))).toContain("software rasteriser");
        });

        it("on a page that cannot name its GPU, on WebGL 1 and on a drawing buffer below 1080p", () => {
            const info = (overrides: Record<string, unknown>) =>
                measurement({}, {}, { renderer: parseRendererInfo(pageRenderer(overrides)) });

            expect(reasonOf(info({ renderer: "unknown" }))).toContain("cannot name its GPU");
            expect(reasonOf(info({ version: "WebGL 1.0 (OpenGL ES 2.0 Chromium)" }))).toContain(
                "WebGL 2 context is required",
            );
            expect(reasonOf(info({ version: null }))).toContain("has none");
            expect(reasonOf(info({ width: 1451, height: 855 }))).toContain("1451x855");
        });

        it("on a drawing buffer that is short in only one dimension: 1080p needs both the width and the height", () => {
            const info = (overrides: Record<string, unknown>) =>
                measurement({}, {}, { renderer: parseRendererInfo(pageRenderer(overrides)) });

            // Each of these passes the other dimension: dropping either check of the guard leaves one of them accepted
            expect(reasonOf(info({ width: 1919, height: 1080 }))).toContain("the drawing buffer is 1919x1080");
            expect(reasonOf(info({ width: 1920, height: 1079 }))).toContain("the drawing buffer is 1920x1079");
            expect(reasonOf(info({ width: 1920, height: 1080 }))).toBe("");
        });

        it("when the browser has no GPU timer: null figures must not read as a pass or a fail", () => {
            const none = {
                gpuTimer: "none",
                avgGpuMs: null,
                p95GpuMs: null,
                p99GpuMs: null,
                maxGpuMs: null,
                gpuSamples: 0,
            };
            const verdict = judgeGate1(measurement(none, none));

            expect(verdict.exitCode).toBe(2);
            expect(verdict.invalid[0]).toContain("no GPU timer");
            expect(
                verdict.criteria
                    .filter((c) => c.name.endsWith("GpuMs") && c.mode !== "dusk")
                    .every((c) => !c.pass && c.actual === null),
            ).toBe(true);
        });

        it("when a timer exists and produced no sample", () => {
            const empty = { avgGpuMs: null, p99GpuMs: null, maxGpuMs: null, gpuSamples: 0, gpuDroppedFrames: 300 };

            expect(reasonOf(measurement(empty))).toContain("produced no sample");
        });

        it("when fewer than 90% of the frames have a GPU sample, however good those few are", () => {
            const sparse = { gpuSamples: 269, gpuDroppedFrames: 31 };
            const enough = { gpuSamples: 270, gpuDroppedFrames: 30 };

            expect(reasonOf(measurement({}, sparse))).toContain("night: only 269 of 300 frames have a GPU sample");
            expect(judgeGate1(measurement({}, enough)).exitCode).toBe(0);
        });

        it("when a window has fewer or more than 300 frames", () => {
            expect(reasonOf(measurement({ frames: 299 }))).toContain("day: the window has 299 frames");
            expect(reasonOf(measurement({}, { frames: 301 }))).toContain("night: the window has 301 frames");
        });

        it("when the crowd did not all enter, or is not all in the scene at the end of a window", () => {
            const crowd = (requested: number, inScene: number) => ({
                crowd: parseCrowdReport(pageCrowd({ inScene }), requested),
            });

            expect(reasonOf(measurement({}, {}, crowd(999, 998)))).toContain("only 998 of the 999");
            expect(reasonOf(measurement({}, {}, crowd(500, 500)))).toContain("500 requested");
            expect(reasonOf(measurement({ culledAvatars: 226 }))).toContain("day: the scene holds 998 remote avatars");
        });

        it("when the crowd fell back to spread placement: a gate that never put bots at the glass is not the gate", () => {
            const fellBack = (fallbackGroups: string[]) =>
                measurementOf({}, { crowd: parseCrowdReport(pageCrowd({ fallbackGroups }), 999) });

            // Seen failing before the fallback was read: 999 spread bots (no manifest, 404) returned a pass
            expect(judgeGate1(fellBack([])).exitCode).toBe(0);
            expect(reasonOf(fellBack(["glass"]))).toContain("crowd group(s) glass had no anchor in the map");
            expect(reasonOf(fellBack(["glass", "lights", "borders"]))).toContain("glass, lights, borders");
            expect(judgeGate1(fellBack(["borders"])).exitCode).toBe(2);
        });

        it("when an avatar has a single layer, which cannot exercise the avatar bake", () => {
            const crowd = parseCrowdReport(pageCrowd({ layersPerRecipe: { min: 1, max: 6 } }), 999);

            expect(reasonOf(measurementOf({}, { crowd }))).toContain("a synthetic avatar has 1 layer(s)");
            expect(
                judgeGate1(
                    measurementOf(
                        {},
                        { crowd: parseCrowdReport(pageCrowd({ layersPerRecipe: { min: 2, max: 6 } }), 999) },
                    ),
                ).exitCode,
            ).toBe(0);
        });

        describe("when the post pass did not run in enough of the rendered frames", () => {
            it("below 95% in any window, whatever the point-in-time filter list says", () => {
                // 0.949 of 300 frames: just under. The renderer reading at capture still lists KfxPost as active
                const just = { postFilterShare: 0.949, renderedFrames: 300 };

                for (const mode of GATE1_MODES) {
                    const verdict = judgeGate1(measurementOf({ [mode]: just }));

                    expect(verdict.exitCode).toBe(2);
                    expect(verdict.invalid.join(" | ")).toContain(
                        `${mode}: the post pass KfxPost was active in only 94.9% of the 300 rendered frames`,
                    );
                }
            });

            it("is satisfied at 95% and at 100%, and is not decided by the renderer's filter list", () => {
                expect(judgeGate1(measurementOf({ day: { postFilterShare: 0.95 } })).exitCode).toBe(0);
                // A filter list that says the pass is off at the moment of the reading does not fail a window that ran it
                const capturedWithoutFilter = measurementOf(
                    {},
                    {
                        captures: GATE1_MODES.map((mode) => capture(mode, {}, { activeFilters: [] })),
                    },
                );
                expect(judgeGate1(capturedWithoutFilter).exitCode).toBe(0);
            });

            it("when the window cannot say (null share), not read as active", () => {
                const verdict = judgeGate1(measurementOf({ night: { postFilterShare: null, renderedFrames: 0 } }));

                expect(verdict.exitCode).toBe(2);
                expect(verdict.invalid.join(" | ")).toContain("night: the window does not say whether the post pass");
            });
        });

        it("when the night-only lights are not in the state the window is for: the night window at 0.85 is a dusk", () => {
            const lit = (mode: Gate1Mode, nightOn: boolean) =>
                measurementOf(
                    {},
                    {
                        captures: GATE1_MODES.map((m) => capture(m, {}, {}, m === mode ? { nightOn } : {})),
                    },
                );

            expect(reasonOf(lit("night", false))).toContain(
                "night: the night-only lights are off at level 1, on was expected",
            );
            expect(reasonOf(lit("dusk", true))).toContain(
                "dusk: the night-only lights are on at level 0.85, off was expected",
            );
            expect(reasonOf(lit("day", true))).toContain("day: the night-only lights are on");
            expect(judgeGate1(lit("night", true)).exitCode).toBe(0);
        });

        it("when a mode was not captured", () => {
            const dayOnly = { ...measurement(), captures: [capture("day")] };

            expect(reasonOf(dayOnly)).toBe("dusk: no window was captured | night: no window was captured");
        });

        it("even when a limit is also exceeded: an untrusted run is not a failed one", () => {
            const verdict = judgeGate1(measurement({ maxGpuMs: 30, gpuTimer: "none", gpuSamples: 0 }));

            expect(verdict.exitCode).toBe(2);
            expect(verdict.status).toBe("invalid");
        });
    });
});

type Call = string;

/** One turn of the macrotask clock: the real page pans from its frames, never from microtasks alone. */
const tick = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });

/** A session that records what it was asked, with a page that pans on the macrotask clock like the real one. */
function fakeSession(
    options: {
        renderer?: Record<string, unknown>;
        inScene?: number;
        crowd?: Record<string, unknown>;
        bench?: (mode: Gate1Mode) => Record<string, unknown>;
        failCapture?: boolean;
        failClear?: boolean;
        /** Rejects the nth pan (1 is the first), after a macrotask: the way a page that throws behaves. */
        failPanAt?: number;
    } = {},
) {
    const calls: Call[] = [];
    let mode: Gate1Mode = "day";
    let panCount = 0;
    let panFailed = false;
    let panning = false;
    let pansAfterRelease = 0;
    let released = true;
    let pansThisWindow = 0;
    const session: Gate1Session = {
        rendererInfo: () => {
            calls.push("renderer");
            return Promise.resolve(pageRenderer(options.renderer));
        },
        spawnCrowd: (count) => {
            calls.push(`spawn:${count}`);
            return Promise.resolve(
                pageCrowd({ requested: count, inScene: options.inScene ?? count, ...options.crowd }),
            );
        },
        setNight: (level) => {
            calls.push(`night:${level}`);
            if (level !== null) mode = GATE1_MODES.find((m) => GATE1.nightLevels[m] === level) ?? "day";
            return Promise.resolve(pageNight(level));
        },
        wait: (ms) => {
            calls.push(`wait:${ms}`);
            return Promise.resolve();
        },
        captureWindow: async () => {
            calls.push("capture:start");
            pansThisWindow = 0;
            while (pansThisWindow < 3 && !panFailed) {
                await tick();
            }
            // The capture goes on for a few turns after the pan failed, as one of up to 5 s does
            for (let turn = 0; panFailed && turn < 3; turn++) {
                await tick();
            }
            if (options.failCapture) throw new Error("the game was destroyed");
            calls.push("capture:end");
            return pageBench(options.bench?.(mode));
        },
        pan: async (dx, dy, ms) => {
            calls.push(`pan:${dx},${dy},${ms}`);
            panCount++;
            if (panCount === options.failPanAt) {
                await tick();
                panFailed = true;
                throw new Error("the page threw while panning");
            }
            if (released && !panning) pansAfterRelease++;
            panning = true;
            released = false;
            pansThisWindow++;
            await tick();
            return !released;
        },
        releasePan: () => {
            calls.push("release");
            released = true;
            panning = false;
            return Promise.resolve();
        },
        screenshot: (name) => {
            calls.push(`shot:${name}`);
            return Promise.resolve(`/out/${name}.png`);
        },
        clearCrowd: () => {
            calls.push("clear");
            return options.failClear ? Promise.reject(new Error("no scene")) : Promise.resolve();
        },
    };
    return { session, calls, pansAfterRelease: () => pansAfterRelease };
}

const options = (log: string[] = []) => ({
    settleMs: 10_000,
    log: (line: string) => {
        log.push(line);
    },
});

describe("measuring the gate on a session", () => {
    it("spawns 999, then captures day, dusk and night in order, panning during each window and releasing after", async () => {
        const { session, calls } = fakeSession();

        const result = await measureGate1(session, options());

        expect(calls[0]).toBe("renderer");
        expect(calls.slice(1, 4)).toEqual(["spawn:999", "wait:10000", "night:0"]);
        const dusk = calls.indexOf("night:0.85");
        const night = calls.indexOf("night:1");
        expect(dusk).toBeGreaterThan(0);
        expect(night).toBeGreaterThan(dusk);
        // Each window: settle for the effects, read the renderer, pan and capture, release, screenshot
        for (const [from, to, shot] of [
            [calls.indexOf("night:0"), dusk, "shot:day"],
            [dusk, night, "shot:dusk"],
            [night, calls.indexOf("night:null"), "shot:night"],
        ] as const) {
            const window = calls.slice(from, to);
            expect(window[1]).toBe(`wait:${NIGHT_SETTLE_MS}`);
            expect(window[2]).toBe("renderer");
            // The pan is under way before the window closes: it starts together with the capture
            expect(window.indexOf(`pan:${PAN_LEG.dx},${PAN_LEG.dy},${PAN_LEG.ms}`)).toBeGreaterThan(2);
            expect(window.indexOf(`pan:${PAN_LEG.dx},${PAN_LEG.dy},${PAN_LEG.ms}`)).toBeLessThan(
                window.indexOf("capture:end"),
            );
            expect(window.indexOf("capture:end")).toBeLessThan(window.indexOf("release"));
            expect(window.indexOf("release")).toBeLessThan(window.indexOf(shot));
        }
        expect(calls.slice(-2)).toEqual(["night:null", "clear"]);
        expect(result.captures.map((c) => [c.mode, c.nightLevel, c.night.nightOn, c.screenshot])).toEqual([
            ["day", 0, false, "/out/day.png"],
            ["dusk", 0.85, false, "/out/dusk.png"],
            ["night", 1, true, "/out/night.png"],
        ]);
        expect(result.crowd).toMatchObject({ requested: 999, inScene: 999, fallbackGroups: [] });
        expect(result.crowd.groups).toEqual({ glass: 250, lights: 250, borders: 250, spread: 249 });
        expect(judgeGate1(result).exitCode).toBe(0);
    });

    it("pans out and back, alternating, and never pans once the window is released", async () => {
        const { session, calls, pansAfterRelease } = fakeSession();

        await measureGate1(session, options());

        const pans = calls.filter((call) => call.startsWith("pan:"));
        expect(pans.slice(0, 3)).toEqual([
            `pan:${PAN_LEG.dx},${PAN_LEG.dy},${PAN_LEG.ms}`,
            `pan:${-PAN_LEG.dx},${-PAN_LEG.dy},${PAN_LEG.ms}`,
            `pan:${PAN_LEG.dx},${PAN_LEG.dy},${PAN_LEG.ms}`,
        ]);
        // The one pan after each release is the first of the next window: none starts while the camera is released
        expect(pansAfterRelease()).toBe(3);
    });

    it("stops before spawning anything on a renderer that cannot be judged", async () => {
        const { session, calls } = fakeSession({ renderer: { renderer: SWIFTSHADER } });

        await expect(measureGate1(session, options())).rejects.toBeInstanceOf(Gate1InvalidRun);

        expect(calls).toEqual(["renderer"]);
    });

    it("stops with the crowd's own count when the scene took fewer than 999, and still clears what it spawned", async () => {
        const { session, calls } = fakeSession({ inScene: 640 });

        await expect(measureGate1(session, options())).rejects.toThrow("only 640 of 999");

        expect(calls).toEqual(["renderer", "spawn:999", "night:null", "clear"]);
    });

    it("clears the crowd and the night when a capture fails, and surfaces that failure", async () => {
        const { session, calls } = fakeSession({ failCapture: true });

        await expect(measureGate1(session, options())).rejects.toThrow("the game was destroyed");

        expect(calls.slice(-2)).toEqual(["night:null", "clear"]);
        expect(calls).toContain("release");
    });

    it("clears the crowd and the night, and surfaces the error, when a pan rejects while the capture is still running", async () => {
        const rejections: unknown[] = [];
        const onRejection = (reason: unknown) => rejections.push(reason);
        process.on("unhandledRejection", onRejection);
        try {
            const { session, calls } = fakeSession({ failPanAt: 2 });

            // Seen failing before the pan loop had its own catch: the rejection went unhandled while the capture ran
            // (the process dies in node), and neither the night nor the crowd was given back
            await expect(measureGate1(session, options())).rejects.toThrow("the page threw while panning");
            // Let any unhandled rejection surface
            await tick();
            await tick();

            expect(rejections).toEqual([]);
            expect(calls.slice(-2)).toEqual(["night:null", "clear"]);
            expect(calls).toContain("release");
            expect(calls.filter((call) => call.startsWith("night:") && call !== "night:null")).toHaveLength(1);
        } finally {
            process.off("unhandledRejection", onRejection);
        }
    });

    it("turns a pan that throws into an invalid report and exit 2, with the cleanup done", async () => {
        const { session, calls } = fakeSession({ failPanAt: 1 });
        const files = new Map<string, string>();

        const exitCode = await runGate1Report(
            () => measureGate1(session, options()),
            (name, content) => {
                files.set(name, content);
            },
            () => undefined,
        );

        expect(exitCode).toBe(2);
        expect(files.get("gate1.md")).toContain(
            "the run failed before it could be judged: the page threw while panning",
        );
        expect(calls.slice(-2)).toEqual(["night:null", "clear"]);
    });

    it("keeps the first error when clearing fails too, and says it could not clear", async () => {
        const log: string[] = [];
        const { session } = fakeSession({ failCapture: true, failClear: true });

        await expect(measureGate1(session, options(log))).rejects.toThrow("the game was destroyed");

        expect(log.some((line) => line.includes("could not clear the crowd"))).toBe(true);
    });
});

describe("the report", () => {
    function run(measure: () => Promise<Gate1Measurement>, context?: () => Record<string, unknown>) {
        const files = new Map<string, string>();
        const logs: string[] = [];
        const done = runGate1Report(
            measure,
            (name, content) => {
                files.set(name, content);
            },
            (line) => {
                logs.push(line);
            },
            context,
        );
        return { done, files, logs };
    }

    it.each([
        ["passes", measurement(), 0],
        ["fails a limit", measurement({}, { maxGpuMs: 20 }), 1],
        ["cannot be judged", measurement({ gpuTimer: "none", avgGpuMs: null, gpuSamples: 0 }), 2],
    ])("exits with the verdict when a run %s", async (_name, value, exitCode) => {
        const { done, files } = run(() => Promise.resolve(value));

        expect(await done).toBe(exitCode);
        const json = JSON.parse(files.get("gate1.json") ?? "{}") as { verdict: { exitCode: number }; gate: unknown };
        expect(json.verdict.exitCode).toBe(exitCode);
        expect(files.get("gate1.md")).toContain(`(exit ${exitCode})`);
    });

    it("writes an invalid report with the reason when the measurement stops as invalid, and measures nothing", async () => {
        const { done, files } = run(() => Promise.reject(new Gate1InvalidRun("the renderer is a software rasteriser")));

        expect(await done).toBe(2);
        expect(files.get("gate1.md")).toContain("- the renderer is a software rasteriser");
        expect(JSON.parse(files.get("gate1.json") ?? "{}")).not.toHaveProperty("measurement");
    });

    it("writes an invalid report with the error, and exits 2, when the page throws or the capture times out", async () => {
        const { done, files } = run(() =>
            Promise.reject(
                new Error("The game ran 4 of the 300 steps of a frame capture in 60 s: is the tab visible?"),
            ),
        );

        expect(await done).toBe(2);
        expect(files.get("gate1.md")).toContain("the run failed before it could be judged: The game ran 4 of the 300");
        expect(JSON.parse(files.get("gate1.json") ?? "{}")).toMatchObject({
            verdict: { status: "invalid", exitCode: 2 },
        });
    });

    it("records the flags the page ran with and the URL it ended on, so a number is tied to its configuration", async () => {
        const { done, files } = run(
            () => Promise.resolve(measurement()),
            () => ({
                engine: {
                    storage: { avatarBake: "1" },
                    finalUrl: "http://127.0.0.1:3010/~/konclui-office/office.wam?phaserMode=webgl2",
                },
            }),
        );
        await done;

        expect(JSON.parse(files.get("gate1.json") ?? "{}")).toMatchObject({
            engine: { storage: { avatarBake: "1" }, finalUrl: expect.stringContaining("phaserMode=webgl2") as string },
            measurement: { crowd: { groups: { glass: 250 }, fallbackGroups: [], layersPerRecipe: { min: 4 } } },
        });
    });

    it("prints the limit, the measured figure and the result of every criterion, and the timer of each window", () => {
        const markdown = renderGate1Markdown(
            measurement({}, { p99GpuMs: 16 }),
            judgeGate1(measurement({}, { p99GpuMs: 16 })),
        );

        expect(markdown).toContain("**FAIL** (exit 1)");
        expect(markdown).toContain("| night | p99GpuMs | <= 15.5 | 16.00 | FAIL |");
        expect(markdown).toContain("| day | avgGpuMs | <= 11 | 6.20 | pass |");
        expect(markdown).toContain("| night | largeUploads | <= 0 | 0.00 | pass |");
        expect(markdown).toContain("| night | 1 | 19.3 | on | 100% (300 frames) | webgl2 | 300 | 300 | 0 |");
        // The dusk window is the mandate's 0.85 and says its night-only lights are off
        expect(markdown).toContain("| dusk | 0.85 | 17.85 | off | 100% (300 frames) |");
        expect(markdown).toContain("Crowd: 999 of 999 in the scene (glass 250, lights 250, borders 250, spread 249;");
    });

    it("says which crowd groups fell back, and that the night-only lights are off at dusk", () => {
        const value = measurementOf({}, { crowd: parseCrowdReport(pageCrowd({ fallbackGroups: ["glass"] }), 999) });
        const markdown = renderGate1Markdown(value, judgeGate1(value));

        expect(markdown).toContain("FELL BACK to spread: glass");
        expect(markdown).toContain("crowd group(s) glass had no anchor in the map");
        expect(markdown).toContain("night-only lights are off");
    });
});

describe("the gate1 command", () => {
    const MAC = { platform: "darwin" };
    const ROOM = "http://127.0.0.1:3010/~/konclui-office/office.wam";

    it("takes the room, the settle time and the name, and the browser options every command has", () => {
        expect(parseArgs(["gate1", ROOM], MAC)).toMatchObject({
            command: "gate1",
            url: ROOM,
            settleSeconds: 10,
            name: "Probe",
            browser: { renderer: "gpu", angle: "metal", locale: "pt-BR" },
        });
        expect(parseArgs(["gate1", ROOM, "--settle-seconds=3", "--name=Bench", "--out-dir=/o"], MAC)).toMatchObject({
            settleSeconds: 3,
            name: "Bench",
            outDir: "/o",
        });
    });

    it("refuses the options of the other commands, so that a typo or a viewport is never silently ignored", () => {
        for (const flag of ["--runs=1", "--width=800", "--budget=gpu.avg=11", "--fx=on"]) {
            expect(() => parseArgs(["gate1", ROOM, flag], MAC)).toThrow(UsageError);
        }
        expect(() => parseArgs(["gate1"], MAC)).toThrow("needs the room URL");
    });

    it("runs through main with the output folder and returns the exit code of the run", async () => {
        const seen: { url?: string; outDir?: string } = {};
        const deps = {
            environment: { platform: "darwin", nodeVersion: "v24.18.0" },
            now: () => new Date("2026-11-21T18:30:00.000Z"),
            temporaryDirectory: () => "/tmp",
            makeDirectory: () => undefined,
            writeFile: () => undefined,
            log: () => undefined,
            error: () => undefined,
            createMeasurer: () => Promise.reject(new Error("not used")),
            runCompare: () => Promise.resolve(0),
            runPanel: () => Promise.resolve(0),
            runGate1: (config, outDir) => {
                seen.url = config.url;
                seen.outDir = outDir;
                return Promise.resolve(1);
            },
        } satisfies CliDependencies;

        expect(await main(["gate1", ROOM, "--out-dir=/out"], deps)).toBe(1);
        expect(seen).toEqual({ url: ROOM, outDir: "/out" });
        expect(await main(["gate1", ROOM], deps)).toBe(1);
        expect(seen.outDir).toBe("/tmp/frame-probe-gate1-2026-11-21T18-30-00-000Z");
    });

    it("exits 2 when the run throws", async () => {
        const errors: string[] = [];
        const deps: CliDependencies = {
            environment: { platform: "darwin", nodeVersion: "v24.18.0" },
            now: () => new Date(0),
            temporaryDirectory: () => "/tmp",
            makeDirectory: () => undefined,
            writeFile: () => undefined,
            log: () => undefined,
            error: (line) => {
                errors.push(line);
            },
            createMeasurer: () => Promise.reject(new Error("not used")),
            runCompare: () => Promise.resolve(0),
            runPanel: () => Promise.resolve(0),
            runGate1: () => Promise.reject(new Error("could not load @playwright/test")),
        };

        expect(await main(["gate1", ROOM], deps)).toBe(2);
        expect(errors).toEqual(["could not load @playwright/test"]);
    });
});

describe("the window of a client that draws the game in a frame", () => {
    it("grows by what the frame takes, and not at all when the buffer is already the gate's size", () => {
        // The office shell at 1920x1080: a side panel and a gutter leave the game 1558x1068
        expect(missingBuffer({ width: 1558, height: 1068 })).toEqual({ width: 362, height: 12 });
        expect(missingBuffer({ width: 1920, height: 1080 })).toEqual({ width: 0, height: 0 });
        expect(missingBuffer({ width: 2400, height: 1000 })).toEqual({ width: 0, height: 80 });
    });
});

describe("the storage a gate run starts with", () => {
    it("sets no avatar flag in a normal run, which measures the shipping defaults (the three flags are on)", () => {
        expect(gate1Storage(undefined)).toEqual({ "konclui.e2e.bench": "1", "konclui.fx.rim": "1" });
        expect(gate1Storage("0")).toEqual(GATE1_STORAGE);
        expect(gate1Storage("")).toEqual(GATE1_STORAGE);
        expect(Object.keys(GATE1_STORAGE)).not.toEqual(
            expect.arrayContaining(["avatarDetailBudget", "avatarZeroWork", "avatarBake"]),
        );
    });

    it('forces the three avatar flags to "0" in a baseline, and keeps the keys of a normal run', () => {
        expect(gate1Storage("1")).toEqual({
            "konclui.e2e.bench": "1",
            "konclui.fx.rim": "1",
            avatarDetailBudget: "0",
            avatarZeroWork: "0",
            avatarBake: "0",
        });
    });

    it.each(["true", "yes", "2", " 1"])(
        "refuses FRAME_PROBE_GATE1_BASELINE=%j rather than run a normal run that looks like a baseline",
        (value) => {
            expect(() => gate1Storage(value)).toThrow(/FRAME_PROBE_GATE1_BASELINE/);
        },
    );

    it("does not change the shared table of a normal run when it builds a baseline", () => {
        gate1Storage("1");

        expect(GATE1_STORAGE).toEqual({ "konclui.e2e.bench": "1", "konclui.fx.rim": "1" });
    });
});

describe("the avatar flags the page reports", () => {
    const on = { avatarDetailBudget: true, avatarZeroWork: true, avatarBake: true };
    const off = { avatarDetailBudget: false, avatarZeroWork: false, avatarBake: false };

    it("are all on in a normal run and all off in a baseline, with no problem", () => {
        expect(avatarFlagProblems(on, false)).toEqual([]);
        expect(avatarFlagProblems(off, true)).toEqual([]);
    });

    it("name each flag that is not what the run needs, so a client built before the defaults changed is not measured as a normal run", () => {
        expect(avatarFlagProblems({ ...on, avatarBake: false }, false)).toEqual([
            "avatarBake is false in the page, and a normal run needs it on",
        ]);
        expect(avatarFlagProblems(off, false)).toHaveLength(3);
        expect(avatarFlagProblems({ ...off, avatarZeroWork: true }, true)).toEqual([
            "avatarZeroWork is true in the page, and a baseline run needs it off",
        ]);
    });

    it("are a problem when the client reports nothing", () => {
        expect(avatarFlagProblems(undefined, false)).toEqual([expect.stringContaining("getAvatarFlags")]);
        expect(avatarFlagProblems(null, true)).toHaveLength(1);
    });

    it("are a problem when a flag is missing from the report", () => {
        expect(avatarFlagProblems({ avatarDetailBudget: true, avatarZeroWork: true }, false)).toEqual([
            "avatarBake is undefined in the page, and a normal run needs it on",
        ]);
    });
});
