// @vitest-environment jsdom
import * as Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";

// E2EHooks reaches the game through the game manager and the media stores, which pull in the whole front end.
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: { getCurrentGameScene: () => ({}) } }));
vi.mock("../../../src/front/Stores/MediaStore", () => ({
    rawLocalVideoTrackStore: {},
    backgroundProcessedLocalVideoTrackStore: {},
}));

import { createFrameRecorder } from "../../../src/front/Utils/E2EHooks";
import type { E2EFrameEvents } from "../../../src/front/Utils/E2EHooks";
import {
    GPU_MIN_COVERAGE as PROBE_MIN_COVERAGE,
    gpuFigure,
    parseRecording,
    phaseMeasurement,
} from "../../../../benchmark/frame-probe/recording";
import { GPU_MIN_COVERAGE as PAGE_MIN_COVERAGE } from "../../../src/front/Utils/E2EHooks";
import { startFrameBench, type ShadingCounters } from "../../../src/front/Utils/FrameBench";
import {
    GATE1,
    GATE1_DEFAULT_SETUP,
    GATE1_MODES,
    judgeGate1,
    parseCrowdReport,
    parseFrameBench,
    parseNightResult,
    parseRendererInfo,
    type Gate1Mode,
    type Gate1Setup,
} from "../../../../benchmark/frame-probe/gate1";
import { createBenchNight } from "../../../src/front/Utils/BenchNight";
import {
    createSyntheticCrowd,
    crowdMapFromManifest,
    buildRecipes,
    type CrowdScene,
} from "../../../src/front/Utils/SyntheticCrowd";
import { createFakeTimerGl } from "./fakeTimerGl";
import { KONCLUI_OFFICE_FX } from "./konclui-office-fx.fixture";

/**
 * The contract between the page's recorder and the frame probe's parser. The probe reads what page.evaluate returns,
 * which is the recorder's report after a JSON round trip, so these tests build the report with the real recorder and
 * the stateful fake GL, serialise it, and hand it to the probe's own parseRecording and phaseMeasurement. A hand-made
 * report in the probe's tests cannot catch the two sides drifting apart; this one does.
 */

const { PRE_STEP, POST_STEP, PRE_RENDER, POST_RENDER } = Phaser.Core.Events;
const MS = 1_000_000;

type Listener = (...args: unknown[]) => void;

function recordRealReport(options: {
    flavor: "webgl2" | "webgl1" | "none" | "no-context";
    gpuMs?: number[];
    autoReady?: boolean;
    disjoint?: boolean;
    finishFirstOnly?: boolean;
}): unknown {
    const listeners = new Map<string, Set<Listener>>();
    const events: E2EFrameEvents = {
        on(event, listener) {
            listeners.set(event, (listeners.get(event) ?? new Set<Listener>()).add(listener));
            return events;
        },
        off(event, listener) {
            listeners.get(event)?.delete(listener);
            return events;
        },
    };
    const emit = (event: string, ...args: unknown[]) => {
        for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
    };
    let clock = 1000;
    const recorder = createFrameRecorder({ now: () => clock, observerClass: undefined });
    const frames = options.gpuMs ?? [4, 5, 6, 7];
    const fake =
        options.flavor === "no-context"
            ? undefined
            : createFakeTimerGl({
                  flavor: options.flavor,
                  elapsedNs: frames.map((value) => value * MS),
                  autoReady: options.autoReady,
              });
    recorder.start(events, fake?.gl);
    frames.forEach((_, i) => {
        emit(PRE_STEP, 1000 + 16 * i, 16);
        clock += 2;
        emit(POST_STEP);
        clock += 3;
        emit(PRE_RENDER);
        emit(POST_RENDER);
        clock += 11;
        if (options.finishFirstOnly && i === 0) fake?.finishOldest(1);
    });
    if (options.disjoint) {
        fake?.finishAll();
        fake?.raiseDisjoint();
    }
    // What page.evaluate does with the return value
    return JSON.parse(JSON.stringify(recorder.stop()));
}

function probeReads(report: unknown) {
    const recording = parseRecording(report);
    return {
        recording,
        figure: gpuFigure(recording),
        measurement: phaseMeasurement({
            recording,
            longTasks: null,
            nameTags: { present: 0, shown: 0 },
            ws: null,
        }),
    };
}

describe("the frame probe reads the recorder's real report", () => {
    it("agrees with the page on the share of rendered frames a GPU figure needs", () => {
        expect(PROBE_MIN_COVERAGE).toBe(PAGE_MIN_COVERAGE);
    });

    it("reads a report with no GL context: gpuMs null is a reason, not an error, and the work figures stay", () => {
        const report = recordRealReport({ flavor: "no-context" });
        expect((report as { gpuMs: unknown }).gpuMs).toBeNull();

        // With the old parser asRecord(null) throws 'frame recording: gpuMs is missing' here
        const { figure, measurement } = probeReads(report);

        expect(figure).toEqual({ stats: null, note: "no-webgl-context" });
        expect(measurement.gpuNote).toBe("no-webgl-context");
        expect(measurement.metrics["gpu.avg"]).toBeNull();
        expect(measurement.metrics["gpu.max"]).toBeNull();
        expect(measurement.metrics["work.avg"]).toBe(5);
        expect(measurement.metrics["work.max"]).toBe(5);
    });

    it("reads a report from a context that hides the timer extension, with its reason", () => {
        const { figure, measurement } = probeReads(recordRealReport({ flavor: "none" }));

        expect(figure).toEqual({ stats: null, note: "extension-missing" });
        expect(measurement.metrics["gpu.p99"]).toBeNull();
    });

    it.each(["webgl1", "webgl2"] as const)("reads the GPU figures of a measured %s report", (flavor) => {
        const report = recordRealReport({ flavor, gpuMs: [4, 5, 6, 7] });

        const { figure, measurement } = probeReads(report);

        // A parser that drops the gpuMs block of a measured report leaves every gpu.* metric null
        expect(figure.note).toBeNull();
        expect(measurement.gpuNote).toBeNull();
        expect(measurement.metrics).toMatchObject({
            "gpu.avg": 5.5,
            "gpu.p50": 5,
            "gpu.p95": 7,
            "gpu.p99": 7,
            "gpu.max": 7,
            "work.avg": 5,
        });
    });

    it("reads the report of a recording in which every GPU sample was dropped as no GPU figure, with the page's reason", () => {
        const report = recordRealReport({ flavor: "webgl2", gpuMs: [5, 5, 5], autoReady: false, disjoint: true });
        expect((report as { gpuMs: unknown }).gpuMs).toBeNull();

        const { figure, measurement } = probeReads(report);

        expect(figure).toEqual({ stats: null, note: "no-samples" });
        expect(measurement.metrics["gpu.max"]).toBeNull();
    });

    it("gives no GPU figure from a report where fewer than 90% of the rendered frames were timed", () => {
        const report = recordRealReport({
            flavor: "webgl2",
            gpuMs: [5, 5, 5, 5],
            autoReady: false,
            finishFirstOnly: true,
        });
        expect(report).toMatchObject({ gpuMs: { samples: 1, coverage: 0.25 } });

        const { figure, measurement } = probeReads(report);

        // The one timed frame is the best one: reading it alone would flatter the GPU
        expect(figure.stats).toBeNull();
        expect(figure.note).toContain("25%");
        expect(measurement.metrics["gpu.avg"]).toBeNull();
    });
});

describe("Gate 1 reads the real rolling bench", () => {
    /** 301 frames of the real bench on a fake GL, as captureFrameBench() returns them after page.evaluate. */
    function realBench(
        flavor: "webgl2" | "webgl1" | "none",
        gpuMs: number,
        options: {
            postActive?: (frame: number) => boolean;
            upload?: { width: number; height: number };
            /** Draw calls the game issues in each rendered frame: one drawArrays and the rest drawElements. */
            draws?: number;
            /** The shading's counters, read by the bench at its start and end. */
            shading?: () => ShadingCounters | null;
            shadingNightMark?: () => ShadingCounters | null;
        } = {},
    ) {
        const listeners = new Map<string, Set<Listener>>();
        const events = {
            on(event: string, listener: Listener) {
                listeners.set(event, (listeners.get(event) ?? new Set<Listener>()).add(listener));
                return events;
            },
            off(event: string, listener: Listener) {
                listeners.get(event)?.delete(listener);
                return events;
            },
        };
        const emit = (event: string, ...args: unknown[]) => {
            for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
        };
        const frames = 301;
        const fake = createFakeTimerGl({ flavor, elapsedNs: Array.from({ length: frames }, () => gpuMs * MS) });
        const gl = Object.assign(fake.gl, {
            texImage2D: (..._args: unknown[]) => undefined,
            texSubImage2D: () => undefined,
            drawArrays: () => undefined,
            drawElements: () => undefined,
        });
        let clock = 0;
        let frame = 0;
        const bench = startFrameBench({
            events,
            eventNames: { preStep: PRE_STEP, postStep: POST_STEP, preRender: PRE_RENDER, postRender: POST_RENDER },
            gl,
            now: () => clock,
            mapSize: { width: 2752, height: 1792 },
            counts: () => ({
                activeFullAvatars: 70,
                activeDotAvatars: 700,
                culledAvatars: 229,
                bakedAvatarTextures: 48,
            }),
            postFilterActive: () => (options.postActive ? options.postActive(frame) : true),
            shading: options.shading,
            shadingNightMark: options.shadingNightMark,
        });
        for (let i = 0; i < frames; i++) {
            clock = 16.7 * i;
            frame = i;
            emit(PRE_STEP, clock);
            if (options.upload && i === 100) {
                const { width, height } = options.upload;
                // CPU data: the 6-argument form Phaser's canvas upload takes
                gl.texImage2D(0x0de1, 0, 0x1908, 0x1908, 0x1401, { width, height });
            }
            emit(POST_STEP);
            emit(PRE_RENDER);
            for (let draw = 0; draw < (options.draws ?? 2); draw++) {
                if (draw === 0) gl.drawArrays();
                else gl.drawElements();
            }
            emit(POST_RENDER);
        }
        return JSON.parse(JSON.stringify(bench.stop())) as unknown;
    }

    const lit = parseRendererInfo({
        renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)",
        version: "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
        width: 1920,
        height: 1080,
        activeFilters: [GATE1.postFilter],
        normalMapLoaded: true,
    });

    /** The real spawn report of a crowd of 999 on the real konclui-office geometry, after the JSON round trip. */
    async function realCrowdReport(manifest: unknown) {
        const added: number[] = [];
        const scene: CrowdScene = {
            repository: {
                addPlayer: (message) => {
                    added.push(message.userId);
                },
                movePlayer: () => undefined,
                removePlayer: () => undefined,
            },
            events: { on: () => undefined, off: () => undefined },
            updateEvent: "update",
            hasPlayer: (userId) => added.includes(userId),
            nextFrame: () => Promise.resolve(),
        };
        const wokaList = Object.fromEntries(
            ["body", "eyes", "hair", "clothes", "hat", "accessory"].map((layer) => [
                layer,
                { collections: [{ textures: [{ id: `${layer}-1`, url: `u/${layer}` }] }] },
            ]),
        );
        const crowd = createSyntheticCrowd(scene, 200);
        const map = crowdMapFromManifest(manifest, { width: 2752, height: 1792 });
        return JSON.parse(JSON.stringify(await crowd.spawn(999, map, buildRecipes(wokaList, 48)))) as unknown;
    }

    const night = (mode: Gate1Mode) => parseNightResult(JSON.parse(JSON.stringify(nightFor(GATE1.nightLevels[mode]))));
    function nightFor(level: number) {
        return createBenchNight({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined })(level);
    }

    const gate = (
        windows: Record<Gate1Mode, unknown>,
        crowd: unknown = parseCrowdReport(
            {
                inScene: 999,
                groups: { glass: 250, lights: 250, borders: 250, spread: 249 },
                fallbackGroups: [],
                layersPerRecipe: { min: 4, max: 6 },
            },
            999,
        ),
        setup: Gate1Setup = GATE1_DEFAULT_SETUP,
        renderer: ReturnType<typeof parseRendererInfo> = lit,
    ) =>
        judgeGate1({
            setup,
            renderer,
            crowd: crowd as ReturnType<typeof parseCrowdReport>,
            captures: GATE1_MODES.map((mode) => ({
                mode,
                nightLevel: GATE1.nightLevels[mode],
                night: night(mode),
                renderer,
                bench: parseFrameBench(windows[mode]),
            })),
        });
    const judgeGate1AsIs = (bench: unknown) => gate(all(bench));
    const all = (bench: unknown): Record<Gate1Mode, unknown> => ({ day: bench, dusk: bench, night: bench });

    it("reads the shading's counters of the real bench, and flags the window whose shading uploaded the cast texture", () => {
        // The shading's side: a bake finishes and its 19.7 MB buffer goes up at frame 100, as the real counters would say
        let uploads = 3;
        const counters = (): ShadingCounters => ({
            bakes: uploads,
            slices: uploads * 17,
            uploads,
            uploadedBytes: uploads * 19_726_336,
            levelChanges: 0,
            level: 2,
            marked: 20,
        });
        const quiet = realBench("webgl2", 6, { shading: counters });
        const raised = realBench("webgl2", 12, {
            shading: () => counters(),
            upload: { width: 2752, height: 1792 },
        });
        // the same bench with a source whose counters move while the window runs (the upload is at frame 100)
        let calls = 0;
        const moving = realBench("webgl2", 6, {
            shading: () => {
                calls += 1;
                if (calls === 2) uploads += 1;
                return counters();
            },
        });

        expect(parseFrameBench(quiet).shading).toEqual({
            ...counters(),
            bakes: 0,
            slices: 0,
            uploads: 0,
            uploadedBytes: 0,
        });
        expect(parseFrameBench(moving).shading).toMatchObject({ bakes: 1, uploads: 1, uploadedBytes: 19_726_336 });
        // the probe's own upload counters see the same call, so the gate fails the window as it always did
        expect(parseFrameBench(raised)).toMatchObject({
            fullMapUploads: 1,
            largeUploads: 1,
            largestUploadBytes: 19_726_336,
        });
        const verdict = gate({ day: quiet, dusk: quiet, night: moving });
        expect(verdict.status).toBe("pass");
        expect(verdict.flags).toEqual([
            expect.stringContaining("night: the shading put its cast texture on the GPU 1 time(s) inside the window"),
        ]);
    });

    it("judges the windows of a WebGL 2 bench against the limits, with the figures the bench measured", () => {
        const verdict = gate({
            day: realBench("webgl2", 6),
            dusk: realBench("webgl2", 6),
            night: realBench("webgl2", 12),
        });

        // Night at 12 ms exceeds the 11 ms average, and the p99 and max are 12 ms: only the average fails
        expect(verdict.status).toBe("fail");
        expect(verdict.criteria.filter((c) => !c.pass)).toEqual([
            { mode: "night", name: "avgGpuMs", limit: 11, actual: 12, pass: false },
        ]);
        expect(verdict.criteria.find((c) => c.mode === "day" && c.name === "maxGpuMs")?.actual).toBe(6);
    });

    it("reads the draw calls of the real bench: the average and the maximum of a window, per frame", () => {
        const bench = parseFrameBench(realBench("webgl2", 6, { draws: 5 }));

        expect(bench.drawCalls).toEqual({ avg: 5, max: 5 });
        expect(judgeGate1AsIs(realBench("webgl2", 6, { draws: 5 })).status).toBe("pass");
    });

    it("judges a real WebGL1 bench on the default context: the WebGL1 timer extension, the same limits, labelled default", () => {
        const webgl1 = parseRendererInfo({
            ...JSON.parse(JSON.stringify(lit)),
            version: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
        });
        const bench = realBench("webgl1", 6);
        expect(bench).toMatchObject({ gpuTimer: "webgl1-ext", avgGpuMs: 6 });
        const defaultSetup: Gate1Setup = { context: "default", flags: {} };

        const verdict = gate(all(bench), undefined, defaultSetup, webgl1);

        expect(verdict).toMatchObject({ context: "default", status: "pass", exitCode: 0 });
        // The same bench on a run that forced WebGL 2 is not a valid run: the page has WebGL 1
        expect(gate(all(bench), undefined, GATE1_DEFAULT_SETUP, webgl1).status).toBe("invalid");
        // Over the limit on the default context fails exactly as on WebGL 2
        expect(gate(all(realBench("webgl1", 12)), undefined, defaultSetup, webgl1)).toMatchObject({
            context: "default",
            status: "fail",
        });
    });

    it("is invalid on the default context when the real WebGL1 bench had no timer extension", () => {
        const webgl1 = parseRendererInfo({
            ...JSON.parse(JSON.stringify(lit)),
            version: "WebGL 1.0 (OpenGL ES 2.0 Chromium)",
        });
        const none = realBench("none", 0);

        const verdict = gate(all(none), undefined, { context: "default", flags: {} }, webgl1);

        expect(verdict).toMatchObject({ context: "default", status: "invalid", exitCode: 2 });
        expect(verdict.invalid.join(" ")).toContain("EXT_disjoint_timer_query is missing");
    });

    it("sees a bench with no timer as an invalid run: its null figures survive the round trip as null", () => {
        const none = realBench("none", 0);
        expect(none).toMatchObject({ gpuTimer: "none", avgGpuMs: null, maxGpuMs: null });

        const verdict = gate(all(none));

        expect(verdict.status).toBe("invalid");
        expect(verdict.invalid.join(" ")).toContain("no GPU timer");
    });

    it("fails a bench that saw the real mirror upload (2752 x 384 RGBA): the whole-map counter alone would pass it", () => {
        const mirror = realBench("webgl2", 6, { upload: { width: 2752, height: 384 } });
        expect(mirror).toMatchObject({ fullMapUploads: 0, largeUploads: 1, largestUploadBytes: 2752 * 384 * 4 });

        const verdict = gate({ day: realBench("webgl2", 6), dusk: mirror, night: realBench("webgl2", 6) });

        expect(verdict.status).toBe("fail");
        expect(verdict.criteria.filter((c) => !c.pass)).toEqual([
            { mode: "dusk", name: "largeUploads", limit: 0, actual: 1, pass: false },
        ]);
    });

    it("sees a window in which the post pass ran in too few frames as an invalid run", () => {
        // Frames 21 to 300 of the window's last 300 renders have the pass: 280 of 300, 93.3%, under the 95% the gate needs
        const mostly = realBench("webgl2", 6, { postActive: (frame) => frame >= 21 });
        expect((mostly as { postFilterShare: number }).postFilterShare).toBeCloseTo(280 / 300, 6);

        const verdict = gate({ day: mostly, dusk: realBench("webgl2", 6), night: realBench("webgl2", 6) });

        expect(verdict.status).toBe("invalid");
        expect(verdict.invalid.join(" ")).toContain("day: the post pass KfxPost was active in only 93.3%");
    });

    it("passes a full gate on the real shapes: bench, spawn report on the real office geometry, night results", async () => {
        const crowd = parseCrowdReport(await realCrowdReport(KONCLUI_OFFICE_FX), 999);

        expect(crowd).toMatchObject({ inScene: 999, fallbackGroups: [], layersPerRecipe: { min: 4 } });
        expect(crowd.groups).toEqual({ glass: 250, lights: 250, borders: 250, spread: 249 });
        expect(night("night")).toMatchObject({ nightOn: true });
        expect(night("dusk")).toMatchObject({ nightOn: false });
        expect(gate(all(realBench("webgl2", 6)), crowd)).toMatchObject({ status: "pass", exitCode: 0 });
    });

    it("sees the crowd of a map without a manifest as an invalid run: every anchored group fell back to spread", async () => {
        const crowd = parseCrowdReport(await realCrowdReport(undefined), 999);

        expect(crowd.fallbackGroups).toEqual(["glass", "lights", "borders"]);
        const verdict = gate(all(realBench("webgl2", 6)), crowd);
        expect(verdict.status).toBe("invalid");
        expect(verdict.invalid.join(" ")).toContain("glass, lights, borders had no anchor in the map");
    });
});
