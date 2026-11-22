/**
 * Gate 1 of the owner's mandate (.local/konclui/MANDATE-2026-11-21.md): the client's frame pacing with 999 moving
 * remote players in the HQ office, in day and in night, while the camera pans. Three parts, none of which needs a browser
 * except the session behind `Gate1Session`:
 *
 * - parsing what the page returned (`window.e2eHooks.captureFrameBench()` and `getRendererInfo()`) into typed readings,
 *   failing by name when the shape changed;
 * - the measurement, which only orders the calls of a session (spawn, night, pan, capture, clear);
 * - the judge, which decides pass (0), fail (1) or invalid (2) from the readings alone.
 *
 * A failed limit and an invalid run are different things: a failed limit is a measurement that says the budget is not
 * met, an invalid run is one that measured nothing worth judging (software renderer, no GPU timer, a crowd that did not
 * enter), and it is never read as either answer.
 */
import { GPU_MIN_COVERAGE } from "./recording";
import { isSoftwareRenderer } from "./signals";

/**
 * The gate, from the mandate. The GPU limits apply to the median-free single 300-frame window of each mode.
 *
 * Three windows, not two. The mandate's "night 0.85" is the lamps factor of the dusk look, which is below the 0.9 at
 * which the effects switch their night-only lights on (BenchNight.ts), so a window at 0.85 measures a lighter scene
 * than a real night. `dusk` is that literal 0.85 window; `night` is the full night (1) with the night-only lights on.
 * Both are judged: a pass needs all three.
 *
 * Uploads: `fullMapUploads` is the mandate's figure (width and height at least the map's). It cannot see the mirror of
 * this tree, which is the map wide and 128 px per glass row high (2752 x 384 for the konclui-office), so `largeUploads`
 * (one call of 1 MiB or more, whatever its shape) is judged beside it.
 */
export const GATE1 = {
    crowd: 999,
    frames: 300,
    nightLevels: { day: 0, dusk: 0.85, night: 1 },
    /** Whether the effects have their night-only lights on in each window (hour table of BenchNight.ts). */
    nightLightsOn: { day: false, dusk: false, night: true },
    limits: { avgGpuMs: 11.0, p99GpuMs: 15.5, maxGpuMs: 16.7, fullMapUploads: 0, largeUploads: 0 },
    /**
     * The least share of the window's rendered frames in which the post pass must be active. The pass switches itself
     * off in a plain day with nobody mirrored and no room locked, and a frame without it is lighter than the lit
     * scene the gate names. Below this share the window is not that scene; the frames without the pass are the
     * lightest ones, so the p99 and the max (the heaviest frames) are not moved by them, the average slightly.
     */
    minPostShare: 0.95,
    /** 1080p at the default zoom: the size the mandate names. A smaller drawing buffer is not this gate. */
    viewport: { width: 1920, height: 1080 },
    /** The post-processing pass of the Koncluí effects (KfxPost, Konclui/Ambience/phaser/postFilter.ts). */
    postFilter: "KfxPost",
} as const;

export type Gate1Mode = keyof typeof GATE1.nightLevels;
export const GATE1_MODES: readonly Gate1Mode[] = ["day", "dusk", "night"];

export type GpuTimerName = "webgl2" | "webgl1-ext" | "none";

/**
 * Which WebGL context the gate runs on. `webgl2` forces it (`?phaserMode=webgl2`): the gate's own definition and every
 * number of it so far. `default` forces nothing, so the page gets what a visitor gets (Phaser's own choice, WebGL 1 in
 * Phaser 4.2), and the GPU time then comes from the WebGL1 timer extension. Both are judged by the same limits.
 */
export type Gate1Context = "webgl2" | "default";
export const GATE1_CONTEXTS: readonly Gate1Context[] = ["webgl2", "default"];

/** What a run was asked to measure besides the gate's own scene: the context, and extra localStorage flags. */
export interface Gate1Setup {
    readonly context: Gate1Context;
    /** localStorage keys the command line added (`--flag key=value`), in the order given. */
    readonly flags: Readonly<Record<string, string>>;
}

export const GATE1_DEFAULT_SETUP: Gate1Setup = { context: "webgl2", flags: {} };

/** The draw calls of a window: drawArrays, drawElements and their instanced forms, per frame. */
export interface DrawCallsReading {
    readonly avg: number;
    readonly max: number;
}

/** What the probe reads of `e2eHooks.getFrameBench()` (play/src/front/Utils/FrameBench.ts). */
export interface FrameBenchReading {
    readonly frames: number;
    readonly gpuTimer: GpuTimerName;
    /** Null when there is no timer or no resolved sample: never 0. */
    readonly avgGpuMs: number | null;
    readonly p95GpuMs: number | null;
    readonly p99GpuMs: number | null;
    readonly maxGpuMs: number | null;
    readonly avgFrameMs: number | null;
    readonly p99FrameMs: number | null;
    readonly maxFrameMs: number | null;
    readonly mirrorUploadBytesPerSec: number | null;
    readonly fullMapUploads: number;
    /** Uploads of CPU data of 1 MiB or more in one call, and the biggest single upload, in bytes. */
    readonly largeUploads: number;
    readonly largestUploadBytes: number;
    /** Allocations without CPU data (render targets): reported, not judged, because they move no CPU data. */
    readonly allocations: number;
    /** Rendered frames of the window, and the share of them in which the post pass was active (null: not known). */
    readonly renderedFrames: number;
    readonly postFilterShare: number | null;
    readonly activeFullAvatars: number;
    readonly activeDotAvatars: number;
    readonly culledAvatars: number;
    readonly bakedAvatarTextures: number;
    /** Draw calls per frame over the window: reported, not judged. Null when the bench could not count them. */
    readonly drawCalls: DrawCallsReading | null;
    /** GPU samples in the window, and rendered frames since the start that produced none. */
    readonly gpuSamples: number;
    readonly gpuDroppedFrames: number;
}

/** What the probe reads of `e2eHooks.getRendererInfo()`. */
export interface RendererReading {
    readonly renderer: string;
    readonly version: string | null;
    readonly width: number;
    readonly height: number;
    readonly activeFilters: readonly string[];
    readonly normalMapLoaded: boolean;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        throw new Error(`gate 1: ${path} is missing`);
    }
    return value as Record<string, unknown>;
}

function finite(source: Record<string, unknown>, name: string, path: string): number {
    const value = source[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`gate 1: ${path}.${name} is not a finite number`);
    }
    return value;
}

function finiteOrNull(source: Record<string, unknown>, name: string, path: string): number | null {
    return source[name] === null ? null : finite(source, name, path);
}

function drawCallsOf(bench: Record<string, unknown>, path: string): DrawCallsReading | null {
    const value = bench.drawCalls;
    if (value === null) {
        return null;
    }
    if (typeof value !== "object" || value === undefined) {
        throw new Error(`gate 1: ${path}.drawCalls is neither null nor an object with avg and max`);
    }
    const stats = value as Record<string, unknown>;
    return { avg: finite(stats, "avg", `${path}.drawCalls`), max: finite(stats, "max", `${path}.drawCalls`) };
}

/** Checks the object the page returned for one 300-frame window. A bench that changed shape fails here, by name. */
export function parseFrameBench(value: unknown, path = "bench"): FrameBenchReading {
    const bench = asRecord(value, path);
    const timer = bench.gpuTimer;
    if (timer !== "webgl2" && timer !== "webgl1-ext" && timer !== "none") {
        throw new Error(`gate 1: ${path}.gpuTimer is not webgl2, webgl1-ext or none`);
    }
    return {
        frames: finite(bench, "frames", path),
        gpuTimer: timer,
        avgGpuMs: finiteOrNull(bench, "avgGpuMs", path),
        p95GpuMs: finiteOrNull(bench, "p95GpuMs", path),
        p99GpuMs: finiteOrNull(bench, "p99GpuMs", path),
        maxGpuMs: finiteOrNull(bench, "maxGpuMs", path),
        avgFrameMs: finiteOrNull(bench, "avgFrameMs", path),
        p99FrameMs: finiteOrNull(bench, "p99FrameMs", path),
        maxFrameMs: finiteOrNull(bench, "maxFrameMs", path),
        mirrorUploadBytesPerSec: finiteOrNull(bench, "mirrorUploadBytesPerSec", path),
        fullMapUploads: finite(bench, "fullMapUploads", path),
        largeUploads: finite(bench, "largeUploads", path),
        largestUploadBytes: finite(bench, "largestUploadBytes", path),
        allocations: finite(bench, "allocations", path),
        renderedFrames: finite(bench, "renderedFrames", path),
        postFilterShare: finiteOrNull(bench, "postFilterShare", path),
        activeFullAvatars: finite(bench, "activeFullAvatars", path),
        activeDotAvatars: finite(bench, "activeDotAvatars", path),
        culledAvatars: finite(bench, "culledAvatars", path),
        bakedAvatarTextures: finite(bench, "bakedAvatarTextures", path),
        drawCalls: drawCallsOf(bench, path),
        gpuSamples: finite(bench, "gpuSamples", path),
        gpuDroppedFrames: finite(bench, "gpuDroppedFrames", path),
    };
}

/** Checks the renderer description the page returned. */
export function parseRendererInfo(value: unknown, path = "renderer"): RendererReading {
    const info = asRecord(value, path);
    if (typeof info.renderer !== "string") {
        throw new Error(`gate 1: ${path}.renderer is not a string`);
    }
    if (info.version !== null && typeof info.version !== "string") {
        throw new Error(`gate 1: ${path}.version is neither a string nor null`);
    }
    if (!Array.isArray(info.activeFilters) || info.activeFilters.some((name) => typeof name !== "string")) {
        throw new Error(`gate 1: ${path}.activeFilters is not a list of names`);
    }
    return {
        renderer: info.renderer,
        version: info.version,
        // A context that is gone reports no size: 0 reads as too small rather than as an error
        width: typeof info.width === "number" ? info.width : 0,
        height: typeof info.height === "number" ? info.height : 0,
        activeFilters: info.activeFilters as string[],
        normalMapLoaded: info.normalMapLoaded === true,
    };
}

/** The four placement groups of the synthetic crowd (play/src/front/Utils/SyntheticCrowd.ts CROWD_GROUPS). */
export const CROWD_GROUP_NAMES = ["glass", "lights", "borders", "spread"] as const;

/** What the probe reads of `e2eHooks.spawnSyntheticCrowd()`: how many entered, where they were placed, with what. */
export interface CrowdReading {
    readonly requested: number;
    readonly inScene: number;
    readonly groups: Readonly<Record<(typeof CROWD_GROUP_NAMES)[number], number>>;
    /** Groups with no anchor in the map, whose bots were spread over the map instead. */
    readonly fallbackGroups: readonly string[];
    readonly layersPerRecipe: { readonly min: number; readonly max: number };
}

/** Checks the spawn report the page returned, naming the field that changed shape. */
export function parseCrowdReport(value: unknown, requested: number, path = "crowd"): CrowdReading {
    const report = asRecord(value, path);
    const groups = asRecord(report.groups, `${path}.groups`);
    const layers = asRecord(report.layersPerRecipe, `${path}.layersPerRecipe`);
    if (!Array.isArray(report.fallbackGroups) || report.fallbackGroups.some((name) => typeof name !== "string")) {
        throw new Error(`gate 1: ${path}.fallbackGroups is not a list of names`);
    }
    return {
        requested,
        inScene: finite(report, "inScene", path),
        groups: {
            glass: finite(groups, "glass", `${path}.groups`),
            lights: finite(groups, "lights", `${path}.groups`),
            borders: finite(groups, "borders", `${path}.groups`),
            spread: finite(groups, "spread", `${path}.groups`),
        },
        fallbackGroups: report.fallbackGroups as string[],
        layersPerRecipe: {
            min: finite(layers, "min", `${path}.layersPerRecipe`),
            max: finite(layers, "max", `${path}.layersPerRecipe`),
        },
    };
}

/** What `e2eHooks.setBenchNight(level)` returned: the hour fixed and whether the night-only lights are on there. */
export interface NightReading {
    readonly level: number | null;
    readonly hour: number | null;
    readonly nightOn: boolean;
}

export function parseNightResult(value: unknown, path = "night"): NightReading {
    const result = asRecord(value, path);
    if (typeof result.nightOn !== "boolean") {
        throw new Error(`gate 1: ${path}.nightOn is not a boolean`);
    }
    return {
        level: finiteOrNull(result, "level", path),
        hour: finiteOrNull(result, "hour", path),
        nightOn: result.nightOn,
    };
}

/**
 * The page error of a client that does not know `?phaserMode=webgl2` (play/src/front/Components/App.svelte, an
 * uncommitted change that has to land with this gate), or undefined when none of the errors is that one.
 */
export function phaserModeProblem(pageErrors: readonly string[]): string | undefined {
    return pageErrors.some((message) => message.includes("phaserMode parameter must be one of"))
        ? "the client behind this URL does not accept ?phaserMode=webgl2 (play/src/front/Components/App.svelte): " +
              "it needs the change that adds that case, and it was not built with it"
        : undefined;
}

/** "WebGL 1" or "WebGL 2" from a VERSION string such as "WebGL 1.0 (OpenGL ES 2.0 Chromium)"; null when it is neither. */
export function webglMajor(version: string | null): 1 | 2 | null {
    const match = version === null ? null : /^WebGL (\d)/.exec(version);
    return match?.[1] === "1" ? 1 : match?.[1] === "2" ? 2 : null;
}

/** Why a renderer cannot be judged, known before the crowd is spawned. Empty when it can. */
export function rendererProblems(renderer: RendererReading, context: Gate1Context = "webgl2"): string[] {
    const problems: string[] = [];
    if (renderer.renderer === "unknown" || renderer.renderer === "") {
        problems.push(
            "the page cannot name its GPU (WEBGL_debug_renderer_info is missing), so it cannot be told from a software renderer",
        );
    } else if (isSoftwareRenderer(renderer.renderer)) {
        problems.push(
            `the renderer is a software rasteriser (${renderer.renderer}): its frame times say nothing about a GPU`,
        );
    }
    if (context === "webgl2") {
        if (renderer.version === null || !renderer.version.startsWith("WebGL 2")) {
            problems.push(`a WebGL 2 context is required (the page has ${renderer.version ?? "none"})`);
        }
    } else if (webglMajor(renderer.version) === null) {
        // The default context is whatever the client creates: any WebGL version is a valid run, none is not
        problems.push(`the page reports no WebGL context version (it has ${renderer.version ?? "none"})`);
    }
    if (renderer.width < GATE1.viewport.width || renderer.height < GATE1.viewport.height) {
        problems.push(
            `the drawing buffer is ${renderer.width}x${renderer.height}, below the ${GATE1.viewport.width}x${GATE1.viewport.height} the gate is defined at`,
        );
    }
    return problems;
}

export interface Gate1Capture {
    readonly mode: Gate1Mode;
    readonly nightLevel: number;
    /** What `setBenchNight` said for this window: the hour fixed and whether the night-only lights are on. */
    readonly night: NightReading;
    /** The renderer as it was when this window was captured (informational: the post share decides, see GATE1). */
    readonly renderer: RendererReading;
    readonly bench: FrameBenchReading;
    readonly screenshot?: string;
}

export interface Gate1Measurement {
    /** The context and the extra flags this run was asked for: every number below belongs to them. */
    readonly setup: Gate1Setup;
    readonly renderer: RendererReading;
    readonly crowd: CrowdReading;
    readonly captures: readonly Gate1Capture[];
}

export type Gate1Status = "pass" | "fail" | "invalid";

export interface Gate1Criterion {
    readonly mode: Gate1Mode;
    readonly name: "avgGpuMs" | "p99GpuMs" | "maxGpuMs" | "fullMapUploads" | "largeUploads";
    readonly limit: number;
    readonly actual: number | null;
    readonly pass: boolean;
}

export interface Gate1Verdict {
    /** The context this verdict was reached on: a verdict on the default context is not one on WebGL 2. */
    readonly context: Gate1Context;
    readonly status: Gate1Status;
    readonly exitCode: 0 | 1 | 2;
    /** Why the run cannot be judged; empty unless status is invalid. */
    readonly invalid: readonly string[];
    /** Every limit of every mode, in the order the gate lists them. Present even when the run is invalid. */
    readonly criteria: readonly Gate1Criterion[];
}

const CRITERIA = ["avgGpuMs", "p99GpuMs", "maxGpuMs", "fullMapUploads", "largeUploads"] as const;

function criteriaOf(capture: Gate1Capture): Gate1Criterion[] {
    return CRITERIA.map((name) => {
        const limit = GATE1.limits[name];
        const actual = capture.bench[name];
        // A missing figure is not a pass: null never compares as within the limit
        return { mode: capture.mode, name, limit, actual, pass: actual !== null && actual <= limit };
    });
}

/** The timer extension a context version should offer, for the message of a run that has none. */
function expectedTimerExtension(version: string | null): string {
    const major = webglMajor(version);
    if (major === 1) return "EXT_disjoint_timer_query";
    if (major === 2) return "EXT_disjoint_timer_query_webgl2";
    return "EXT_disjoint_timer_query or EXT_disjoint_timer_query_webgl2";
}

function captureProblems(
    capture: Gate1Capture,
    crowd: number,
    context: Gate1Context,
    startVersion: string | null,
): string[] {
    const { bench, mode } = capture;
    const problems: string[] = [];
    if (capture.renderer.version !== startVersion) {
        problems.push(
            `${mode}: the context was ${startVersion ?? "none"} when the run began and is ${capture.renderer.version ?? "none"} ` +
                `when the window was captured (lost and recreated?): the windows are not on one context`,
        );
    }
    if (bench.frames !== GATE1.frames) {
        problems.push(`${mode}: the window has ${bench.frames} frames, ${GATE1.frames} are needed`);
    }
    if (bench.gpuTimer === "none") {
        problems.push(
            `${mode}: the browser offers no GPU timer query on this ${context === "default" ? "default " : ""}` +
                `${capture.renderer.version ?? "unknown"} context (gpuTimer none: ${expectedTimerExtension(capture.renderer.version)} ` +
                `is missing), so no GPU time was measured`,
        );
    } else if (bench.gpuSamples === 0 || bench.avgGpuMs === null) {
        problems.push(`${mode}: the GPU timer produced no sample`);
    } else if (bench.frames > 0 && bench.gpuSamples / bench.frames < GPU_MIN_COVERAGE) {
        problems.push(
            `${mode}: only ${bench.gpuSamples} of ${bench.frames} frames have a GPU sample ` +
                `(${bench.gpuDroppedFrames} dropped); ${Math.round(GPU_MIN_COVERAGE * 100)}% are needed, because the dropped ones are where the GPU fell behind`,
        );
    }
    const avatars = bench.activeFullAvatars + bench.activeDotAvatars + bench.culledAvatars;
    if (avatars < crowd) {
        problems.push(
            `${mode}: the scene holds ${avatars} remote avatars at the end of the window, ${crowd} are needed`,
        );
    }
    if (bench.postFilterShare === null) {
        problems.push(
            `${mode}: the window does not say whether the post pass ${GATE1.postFilter} ran (no rendered frame was sampled)`,
        );
    } else if (bench.postFilterShare < GATE1.minPostShare) {
        problems.push(
            `${mode}: the post pass ${GATE1.postFilter} was active in only ${(bench.postFilterShare * 100).toFixed(1)}% of the ` +
                `${bench.renderedFrames} rendered frames, below the ${Math.round(GATE1.minPostShare * 100)}% needed: ` +
                `the window is lighter than the lit scene the gate names`,
        );
    }
    if (capture.night.nightOn !== GATE1.nightLightsOn[mode]) {
        problems.push(
            `${mode}: the night-only lights are ${capture.night.nightOn ? "on" : "off"} at level ${capture.nightLevel}, ` +
                `${GATE1.nightLightsOn[mode] ? "on" : "off"} was expected for this window`,
        );
    }
    return problems;
}

/** Decides the gate from the readings. Pure: the same measurement always gives the same verdict. */
export function judgeGate1(measurement: Gate1Measurement): Gate1Verdict {
    const { context } = measurement.setup;
    const invalid: string[] = [...rendererProblems(measurement.renderer, context)];
    if (measurement.crowd.inScene < measurement.crowd.requested || measurement.crowd.requested < GATE1.crowd) {
        invalid.push(
            `only ${measurement.crowd.inScene} of the ${GATE1.crowd} synthetic players entered the scene (${measurement.crowd.requested} requested)`,
        );
    }
    if (measurement.crowd.fallbackGroups.length > 0) {
        invalid.push(
            `the crowd group(s) ${measurement.crowd.fallbackGroups.join(", ")} had no anchor in the map (no effects manifest, ` +
                `or no glass face, light or room in it) and were spread over the map instead: the bots were not all ` +
                `in front of the glass, under the lights and across the zone borders the gate names`,
        );
    }
    if (measurement.crowd.layersPerRecipe.min < 2) {
        invalid.push(
            `a synthetic avatar has ${measurement.crowd.layersPerRecipe.min} layer(s): a single layer cannot exercise the avatar bake`,
        );
    }
    for (const mode of GATE1_MODES) {
        if (!measurement.captures.some((capture) => capture.mode === mode)) {
            invalid.push(`${mode}: no window was captured`);
        }
    }
    const criteria: Gate1Criterion[] = [];
    for (const capture of measurement.captures) {
        invalid.push(...captureProblems(capture, GATE1.crowd, context, measurement.renderer.version));
        criteria.push(...criteriaOf(capture));
    }
    if (invalid.length > 0) {
        return { context, status: "invalid", exitCode: 2, invalid, criteria };
    }
    return criteria.every((criterion) => criterion.pass)
        ? { context, status: "pass", exitCode: 0, invalid, criteria }
        : { context, status: "fail", exitCode: 1, invalid, criteria };
}

/** What the browser side lets the measurement do. `gate1Browser.ts` implements it on Playwright; tests on canned data. */
export interface Gate1Session {
    /** `getRendererInfo()` of the page. */
    rendererInfo(): Promise<unknown>;
    /** `spawnSyntheticCrowd(count)` of the page. */
    spawnCrowd(count: number): Promise<unknown>;
    /** `setBenchNight(level)` and what it returned (the hour and `nightOn`); null gives the clock back. */
    setNight(level: number | null): Promise<unknown>;
    wait(ms: number): Promise<void>;
    /** `captureFrameBench()`: 300 consecutive frames and the drained GPU queries. */
    captureWindow(): Promise<unknown>;
    /** `panCamera(dx, dy, ms)`: resolves true when completed, false when replaced or released. */
    pan(dx: number, dy: number, ms: number): Promise<boolean>;
    releasePan(): Promise<void>;
    /** Saves a screenshot and returns its path, or undefined when screenshots are off. */
    screenshot(name: string): Promise<string | undefined>;
    /** `clearSyntheticCrowd()`. */
    clearCrowd(): Promise<void>;
}

export interface Gate1Options {
    /** What the run is measuring (default: WebGL 2, no extra flags); it goes into the measurement as given. */
    readonly setup?: Gate1Setup;
    /** Wait after the crowd entered, for the avatar builds and bakes to settle before the first window. */
    readonly settleMs: number;
    readonly log: (line: string) => void;
}

/** The effects re-read their QA hour once a second (browserEffectsPort.ts): measure only after a longer wait. */
export const NIGHT_SETTLE_MS = 2000;
/** Each pan leg: out, then back, over and over while a window is captured, so a slow GPU never outlasts the pan. */
export const PAN_LEG = { dx: 480, dy: 120, ms: 3000 } as const;

/** A run that stops before it can be judged: the verdict is invalid, with this as the reason. */
export class Gate1InvalidRun extends Error {}

async function captureWhilePanning(session: Gate1Session): Promise<unknown> {
    let capturing = true;
    let panError: { readonly error: unknown } | undefined;
    // The catch is attached where the loop starts: a pan that rejects while the capture is still running is kept, not
    // left as an unhandled rejection, which would kill the process before the cleanup of measureGate1 ran
    const panning = (async () => {
        let direction = 1;
        while (capturing) {
            const completed = await session.pan(direction * PAN_LEG.dx, direction * PAN_LEG.dy, PAN_LEG.ms);
            if (!completed) {
                return;
            }
            direction = -direction;
        }
    })().catch((error: unknown) => {
        panError = { error };
    });
    let captured: unknown;
    try {
        captured = await session.captureWindow();
    } finally {
        capturing = false;
        await session.releasePan();
        // The release replaces the leg in flight, which resolves false and ends the loop; a leg is only issued while
        // `capturing` is true, so none can start after the release
        await panning;
    }
    if (panError) {
        // The camera stopped moving part way through: the window is not the one asked for
        throw panError.error instanceof Error
            ? panError.error
            : new Error(`the camera pan failed: ${String(panError.error)}`);
    }
    return captured;
}

/**
 * Runs the gate's sequence on a session: spawn the crowd, then for day and night set the level, wait, pan the camera
 * and capture 300 frames, and clear the crowd and the night at the end whatever happened. Throws Gate1InvalidRun for a
 * renderer or a crowd that makes the rest pointless; any other error is a failed run.
 */
export async function measureGate1(session: Gate1Session, options: Gate1Options): Promise<Gate1Measurement> {
    const { log } = options;
    const setup = options.setup ?? GATE1_DEFAULT_SETUP;
    const renderer = parseRendererInfo(await session.rendererInfo());
    const problems = rendererProblems(renderer, setup.context);
    if (problems.length > 0) {
        throw new Gate1InvalidRun(problems.join("; "));
    }
    log(
        `renderer: ${renderer.renderer}, ${renderer.version}, ${renderer.width}x${renderer.height}; ` +
            `context ${setup.context}` +
            `${Object.keys(setup.flags).length > 0 ? `; flags ${formatFlags(setup.flags)}` : ""}`,
    );
    for (const note of flagNotes(setup)) log(`note: ${note}`);
    try {
        const crowd = parseCrowdReport(await session.spawnCrowd(GATE1.crowd), GATE1.crowd);
        if (crowd.inScene < crowd.requested) {
            throw new Gate1InvalidRun(
                `only ${crowd.inScene} of ${crowd.requested} synthetic players entered the scene`,
            );
        }
        log(
            `crowd: ${crowd.inScene} players in the scene (glass ${crowd.groups.glass}, lights ${crowd.groups.lights}, ` +
                `borders ${crowd.groups.borders}, spread ${crowd.groups.spread}; ` +
                `${crowd.layersPerRecipe.min} to ${crowd.layersPerRecipe.max} layers); settling ${Math.round(options.settleMs / 1000)} s`,
        );
        await session.wait(options.settleMs);

        const captures: Gate1Capture[] = [];
        for (const mode of GATE1_MODES) {
            const nightLevel = GATE1.nightLevels[mode];
            const night = parseNightResult(await session.setNight(nightLevel), `${mode}.night`);
            await session.wait(NIGHT_SETTLE_MS);
            const atCapture = parseRendererInfo(await session.rendererInfo(), `${mode}.renderer`);
            const bench = parseFrameBench(await captureWhilePanning(session), `${mode}.bench`);
            const screenshot = await session.screenshot(mode);
            log(
                `${mode}: gpu avg ${bench.avgGpuMs ?? "n/a"} ms, p99 ${bench.p99GpuMs ?? "n/a"} ms, max ${bench.maxGpuMs ?? "n/a"} ms ` +
                    `(${bench.gpuTimer} on ${atCapture.version ?? "no version"}), draw calls avg ${figure(bench.drawCalls?.avg ?? null, 1)} ` +
                    `max ${figure(bench.drawCalls?.max ?? null, 0)}, full-map uploads ${bench.fullMapUploads}, large uploads ${bench.largeUploads}, ` +
                    `post pass ${bench.postFilterShare === null ? "n/a" : `${Math.round(bench.postFilterShare * 100)}%`}`,
            );
            captures.push({
                mode,
                nightLevel,
                night,
                renderer: atCapture,
                bench,
                ...(screenshot ? { screenshot } : {}),
            });
        }
        return { setup, renderer, crowd, captures };
    } finally {
        // The crowd and the fixed hour belong to this run: leave neither in the page, and keep the first error
        await session.setNight(null).catch((error: unknown) => log(`could not give the clock back: ${String(error)}`));
        await session.clearCrowd().catch((error: unknown) => log(`could not clear the crowd: ${String(error)}`));
    }
}

function figure(value: number | null, digits = 2): string {
    return value === null ? "n/a" : value.toFixed(digits);
}

/**
 * What each flag the wave measures reads when the page has no key for it: a flag set to its default measures nothing new,
 * so `--flag=gameStepCap=1` (the cap is on by default since 2026-11-22) is a second run of the plain configuration. The
 * values are the client's own constants (GameLoopFlags.ts, postFilter.ts, AvatarZeroWork.ts), copied because the probe
 * does not import the client; a test pins the table to the flags the README names.
 */
export const GATE1_FLAG_DEFAULTS: Readonly<Record<string, string>> = {
    gameStepCap: "1",
    gameRenderSkipCovered: "0",
    gameNoStencil: "0",
    "konclui.fx.external": "0",
    avatarDetailBudget: "1",
    avatarZeroWork: "1",
    avatarBake: "1",
};

const AVATAR_FLAG_KEYS: readonly string[] = ["avatarDetailBudget", "avatarZeroWork", "avatarBake"];

/**
 * Lines of caution for the flags a run was given, printed with the flags and written under the verdict. They never stop
 * the run: a flag at its default is a legitimate control run, and the reader must only know that it is one.
 */
export function flagNotes(setup: Gate1Setup): string[] {
    const notes: string[] = [];
    for (const [key, value] of Object.entries(setup.flags)) {
        const fallback = GATE1_FLAG_DEFAULTS[key];
        if (fallback !== undefined && value === fallback) {
            notes.push(
                `${key}=${value} is that flag's default, so it measures nothing new; the change is ${key}=${fallback === "1" ? "0" : "1"}`,
            );
        }
        if (AVATAR_FLAG_KEYS.includes(key) && value !== fallback) {
            notes.push(
                `${key}=${value}: one avatar flag cannot be isolated, the run is invalid unless all three avatar flags are on (a normal run) or all off (FRAME_PROBE_GATE1_BASELINE=1)`,
            );
        }
    }
    if (setup.context === "default" && setup.flags.gameNoStencil === "1") {
        notes.push(
            "gameNoStencil drops the stencil buffer on this context but not the depth buffer, which is dropped only on the forced WebGL 2 context (App.svelte): this run measures the smaller change",
        );
    }
    return notes;
}

/** `key=value, key=value`, in the order the flags were given. */
export function formatFlags(flags: Readonly<Record<string, string>>): string {
    return Object.entries(flags)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
}

const CONTEXT_LABEL: Record<Gate1Context, string> = {
    webgl2: "WebGL 2 forced (?phaserMode=webgl2): the gate's own definition",
    default: "DEFAULT context (nothing forced: what a visitor gets), judged by the same limits",
};

/** The report in Markdown: the verdict first, the reasons if invalid, then the limits and the windows. */
export function renderGate1Markdown(measurement: Gate1Measurement | undefined, verdict: Gate1Verdict): string {
    const lines = [
        `# Gate 1: client frame pacing with ${GATE1.crowd} moving players`,
        "",
        `**${verdict.status.toUpperCase()}** (exit ${verdict.exitCode}) on the ${verdict.context === "default" ? "DEFAULT" : "WebGL 2"} context`,
        "",
        `Context: ${CONTEXT_LABEL[verdict.context]}.${
            measurement && Object.keys(measurement.setup.flags).length > 0
                ? ` Extra localStorage flags: ${formatFlags(measurement.setup.flags)}.`
                : ""
        }`,
        "",
        ...(measurement ? flagNotes(measurement.setup).flatMap((note) => [`Note: ${note}.`, ""]) : []),
    ];
    if (verdict.invalid.length > 0) {
        lines.push("The run cannot be judged:", "", ...verdict.invalid.map((reason) => `- ${reason}`), "");
    }
    if (measurement === undefined) {
        return `${lines.join("\n")}\n`;
    }
    const { crowd } = measurement;
    lines.push(
        `Renderer: ${measurement.renderer.renderer} (${measurement.renderer.version ?? "no version"}), drawing buffer ` +
            `${measurement.renderer.width}x${measurement.renderer.height}. Crowd: ${crowd.inScene} of ${crowd.requested} in the scene ` +
            `(glass ${crowd.groups.glass}, lights ${crowd.groups.lights}, borders ${crowd.groups.borders}, spread ${crowd.groups.spread}` +
            `${crowd.fallbackGroups.length > 0 ? `; FELL BACK to spread: ${crowd.fallbackGroups.join(", ")}` : ""}; ` +
            `${crowd.layersPerRecipe.min} to ${crowd.layersPerRecipe.max} layers per avatar).`,
        "",
        "| Mode | Metric | Limit | Measured | Result |",
        "|---|---|---|---|---|",
        ...verdict.criteria.map(
            (c) => `| ${c.mode} | ${c.name} | <= ${c.limit} | ${figure(c.actual)} | ${c.pass ? "pass" : "FAIL"} |`,
        ),
        "",
        "| Mode | Level | Hour | Night-only lights | Post pass share | Context | Timer | Frames | GPU samples | Dropped | GPU p95 ms |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
        ...measurement.captures.map(
            ({ mode, nightLevel, night, renderer, bench: b }) =>
                `| ${mode} | ${nightLevel} | ${night.hour ?? "n/a"} | ${night.nightOn ? "on" : "off"} | ` +
                `${b.postFilterShare === null ? "n/a" : `${Math.round(b.postFilterShare * 100)}%`} (${b.renderedFrames} frames) | ` +
                `${renderer.version ?? "no version"} | ` +
                `${b.gpuTimer} | ${b.frames} | ${b.gpuSamples} | ${b.gpuDroppedFrames} | ${figure(b.p95GpuMs)} |`,
        ),
        "",
        "| Mode | Frame avg ms | Frame p99 ms | Frame max ms | Draw calls avg | Draw calls max | Upload B/s | Largest upload B | Allocations | Full / dot / culled | Baked |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
        ...measurement.captures.map(
            ({ mode, bench: b }) =>
                `| ${mode} | ${figure(b.avgFrameMs)} | ${figure(b.p99FrameMs)} | ${figure(b.maxFrameMs)} | ` +
                `${figure(b.drawCalls?.avg ?? null, 1)} | ${figure(b.drawCalls?.max ?? null, 0)} | ` +
                `${figure(b.mirrorUploadBytesPerSec, 0)} | ${b.largestUploadBytes} | ${b.allocations} | ` +
                `${b.activeFullAvatars} / ${b.activeDotAvatars} / ${b.culledAvatars} | ${b.bakedAvatarTextures} |`,
        ),
        "",
        "Frame intervals are shown for reference and do not decide the gate: they cannot fall below the display period. " +
            "Draw calls are drawArrays, drawElements and their instanced forms counted per frame while the bench ran " +
            "(a wrapper on the context, which is also in the frame interval); they are reported, not judged.",
        "The dusk window is the mandate's literal night 0.85, a dusk look whose night-only lights are off; the night " +
            "window (level 1) has them on. Allocations (render targets, texImage2D with no data) move no CPU data and " +
            "are shown, not judged.",
    );
    return `${lines.join("\n")}\n`;
}

/**
 * Measures, judges and writes `gate1.json` and `gate1.md`. Returns the exit code: 0 pass, 1 a limit exceeded, 2 a run
 * that cannot be judged. A measurement that throws (the page crashed, a pan failed, the capture timed out) is a run
 * that cannot be judged too: its report says so, with the error, and the exit code is 2 after the session's cleanup.
 * `context` is read once the run is over and goes into gate1.json: the flags the page ran with, the URL it ended on.
 * `setup` is what the run was asked to measure (the WebGL context, the extra flags): it labels a report whose
 * measurement never completed too, so that an invalid run on the default context is not mistaken for one on WebGL 2.
 */
export async function runGate1Report(
    measure: () => Promise<Gate1Measurement>,
    write: (fileName: string, content: string) => void,
    log: (line: string) => void,
    context: () => Record<string, unknown> = () => ({}),
    setup: Gate1Setup = GATE1_DEFAULT_SETUP,
): Promise<number> {
    let measurement: Gate1Measurement | undefined;
    let verdict: Gate1Verdict;
    try {
        measurement = await measure();
        verdict = judgeGate1(measurement);
    } catch (error: unknown) {
        const reason =
            error instanceof Gate1InvalidRun
                ? error.message
                : `the run failed before it could be judged: ${error instanceof Error ? error.message : String(error)}`;
        verdict = { context: setup.context, status: "invalid", exitCode: 2, invalid: [reason], criteria: [] };
    }
    const markdown = renderGate1Markdown(measurement, verdict);
    write(
        "gate1.json",
        `${JSON.stringify({ schemaVersion: 3, gate: GATE1, setup, ...context(), verdict, measurement }, null, 2)}\n`,
    );
    write("gate1.md", markdown);
    log(markdown);
    return verdict.exitCode;
}
