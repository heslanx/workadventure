import type { Switch } from "./types";
import {
    BudgetSyntaxError,
    parseBudget,
    parseExpectation,
    parseReduction,
    type Budget,
    type Expectation,
    type Reduction,
} from "./verdict";

export class UsageError extends Error {}

export const USAGE = `Usage: npx tsx frame-probe/run.ts <command> <url> [options]     (from benchmark/)

Commands
  frames <room url>    The frame-time gate: records Phaser frames of a real browser in the room, at the default zoom
                       and at the whole-map zoom, and judges them against the budgets given.
  compare <room url>   Walks the entry and the settings and saves one screenshot per step; with --reference-url it
                       walks the reference too and saves each step side by side.
  panel <room url>     The side panel pass: arrival by width, Escape, focus return, the people and chat buttons.
  gate1 <room url>     Gate 1 of the mandate, from one command: 999 synthetic moving players in the room (spawned inside
                       the page, no bots needed), 300 frames in day and 300 in night while the camera pans, judged on
                       GPU time: avg <= 11.0 ms, p99 <= 15.5 ms, max <= 16.7 ms, and 0 full-map texture uploads.

The bots are not started by this tool (gate1 needs none: its crowd is made inside the page). For frames, start them first (benchmark/scripts/load-staircase.sh) on the same room and
keep them running for as long as "frames --dry-run" says.

Options for every command
  --out-dir=DIR            Where reports and screenshots go (default: a new folder under the system temp directory)
  --renderer=gpu|swiftshader   gpu (default) needs a real GPU: a software rasteriser makes the run invalid
  --angle=BACKEND          ANGLE backend for the GPU, "none" to leave it to Chromium (default: metal on macOS)
  --playwright-dir=DIR     Take @playwright/test from the package in DIR instead of the workspace install
  --locale=TAG             Browser locale (default pt-BR: the entry flow is read by its Portuguese labels)

Options for frames
  --runs=3                 Rounds of the whole matrix; the figure of a condition is the median of its runs
  --fx=on,off              Scene effects (konclui.fx.off) to measure
  --detail-budget=off,on   Avatar detail budget (localStorage avatarDetailBudget) to measure
  --views=default,wholeMap Phases to measure; wholeMap needs the wheel step
  --settle-seconds=5       Wait after entering, before the first recording
  --record-seconds=25      Length of each recording
  --wheel-delta=800        deltaY of each wheel event (positive zooms out); --wheel-events=2 sends that many
  --zoom-window-seconds=2  Recording and long-task window that starts at the first wheel event
  --zoom-settle-seconds=2  Quiet time after the scale stopped changing, before the whole-map recording
  --ws-sample-seconds=5    WebSocket bytes are counted through CDP in their own window after each recording, so the
                           protocol's per-frame copy never sits inside the frame numbers. 0 turns it off
  --width=1451 --height=855
  --name=Probe             Guest name
  --allow-software-renderer    Accept a software rasteriser as the renderer
  --screenshots            Save a screenshot at the end of each phase of every run
  --budget=METRIC=LIMIT[@VIEW][:fx=on|off][:detail=on|off]
                           Median over the runs must be at most LIMIT, in every condition measured or only in the one
                           the conditions after ":" name. Repeat for more.
                           e.g. --budget=work.p95=16.7@default --budget=longTasks.count=0@zoom:detail=on
  --require-reduction=METRIC=PERCENT[@VIEW]  Median with the detail budget on must be at least PERCENT below it off
  --expect-at-least=METRIC=MIN[@VIEW]      The lowest run of every condition must reach MIN, or the run is invalid: the
                           crowd the bots should make. e.g. --expect-at-least=nameTags.present=300@wholeMap
  --dry-run                Print the plan and how long it takes; start no browser

Options for compare
  --reference-url=URL      The reference to put beside the native build
  --viewports=WxH,...      Default 1451x855

Options for panel
  --viewports=WxH,...      Default 1440x900,1000x800,768x1024,360x780

Options for gate1
  --settle-seconds=10      Wait after the crowd entered, for the avatar builds and bakes, before the first window
  --name=Probe             Guest name
  --context=webgl2|default webgl2 (default) forces a WebGL 2 context (?phaserMode=webgl2), the gate's own definition.
                           default forces nothing: the page gets what a visitor gets (Phaser's WebGL 1) and the GPU time
                           comes from EXT_disjoint_timer_query. Same limits; the report is labelled DEFAULT, and the run
                           is invalid, never a pass, when that context has no timer. The URL must not carry phaserMode.
  --repeats=3              Windows captured of each mode, an odd number. A GPU limit fails when at least half of them,
                           rounded up (2 of 3), exceed it; an upload limit fails on any. Each window is bracketed by a
                           contention canary (a fixed 256x256 pass timed apart from the game): a window whose canary
                           reads outside 0.5 to 2x of the session's baseline (provisional) is left out, and a mode with too few
                           windows left is invalid, never a pass or a fail.
  --shading-control        After the run, reload the page with the shading off (konclui.fx.rim=0) in the same browser
                           session and capture the same windows. A GPU limit that is also exceeded there is reported as
                           CONTENTION, not as the shading's.
  --flag=KEY=VALUE         Set a localStorage key before the page loads, to measure a flag without editing the probe
                           (e.g. --flag=gameStepCap=0 --flag=konclui.fx.external=1). Repeat for more; recorded in the
                           report. The gate's own keys (konclui.e2e.bench, konclui.fx.rim, konclui.fx.off) cannot be set.
                           A flag set to its default measures nothing new (gameStepCap is on by default: its change is =0;
                           gameRenderSkipCovered, gameNoStencil and konclui.fx.external are off by default: theirs is =1).
  The viewport is fixed at 1920x1080, the size the gate is defined at; it needs a real GPU and a browser that offers a
  GPU timer query. Open the room at a URL whose client has window.e2eHooks (any Koncluí build).

Exit codes (gate1): 0 every limit held in day and in night, 1 a limit was exceeded, 2 the run cannot be judged (software
renderer, no GPU timer, a crowd that did not enter, fewer than 300 frames or 90% GPU samples, no post pass) or failed.

Exit codes (frames): 0 every budget held (or none was given), 1 a budget was exceeded, 2 the measurement cannot be
trusted (a run failed, a recording was cut, a software renderer, an expected crowd that is not there, a metric no run
could read) or the arguments are wrong.
panel: 0 all checks passed, 1 one failed, 2 it could not run.`;

export interface Viewport {
    readonly width: number;
    readonly height: number;
}

export interface BrowserOptions {
    readonly renderer: "gpu" | "swiftshader";
    readonly angle: string | undefined;
    readonly playwrightDir: string | undefined;
    readonly locale: string;
}

export interface FramesConfig {
    readonly command: "frames";
    readonly url: string;
    readonly browser: BrowserOptions;
    readonly outDir: string | undefined;
    readonly runs: number;
    readonly fx: readonly Switch[];
    readonly detailBudget: readonly Switch[];
    readonly views: readonly ("default" | "wholeMap")[];
    readonly settleSeconds: number;
    readonly recordSeconds: number;
    readonly wheelDelta: number;
    readonly wheelEvents: number;
    readonly zoomWindowSeconds: number;
    readonly zoomSettleSeconds: number;
    readonly wsSampleSeconds: number;
    readonly viewport: Viewport;
    readonly name: string;
    readonly allowSoftwareRenderer: boolean;
    readonly screenshots: boolean;
    readonly dryRun: boolean;
    readonly budgets: readonly Budget[];
    readonly reductions: readonly Reduction[];
    readonly expectations: readonly Expectation[];
}

export interface CompareConfig {
    readonly command: "compare";
    readonly url: string;
    readonly referenceUrl: string | undefined;
    readonly browser: BrowserOptions;
    readonly outDir: string | undefined;
    readonly viewports: readonly Viewport[];
}

export interface PanelConfig {
    readonly command: "panel";
    readonly url: string;
    readonly browser: BrowserOptions;
    readonly outDir: string | undefined;
    readonly viewports: readonly Viewport[];
}

export interface Gate1Config {
    readonly command: "gate1";
    readonly url: string;
    readonly browser: BrowserOptions;
    readonly outDir: string | undefined;
    readonly settleSeconds: number;
    readonly name: string;
    /** The WebGL context of the run: forced to WebGL 2 (the gate's definition) or left to the client's default. */
    readonly context: "webgl2" | "default";
    /** localStorage keys to set before the page loads (`--flag=KEY=VALUE`), in the order given. */
    readonly flags: Readonly<Record<string, string>>;
    /** Windows captured of each mode (odd). */
    readonly repeats: number;
    /** Whether to capture the same windows again with the shading off, in the same browser session. */
    readonly shadingControl: boolean;
}

export type ProbeConfig = FramesConfig | CompareConfig | PanelConfig | Gate1Config;

export interface ParseEnvironment {
    readonly platform: string;
}

const COMMON_FLAGS = ["out-dir", "renderer", "angle", "playwright-dir", "locale"];
const ALLOWED_FLAGS: Record<ProbeConfig["command"], readonly string[]> = {
    frames: [
        ...COMMON_FLAGS,
        "runs",
        "fx",
        "detail-budget",
        "views",
        "settle-seconds",
        "record-seconds",
        "wheel-delta",
        "wheel-events",
        "zoom-window-seconds",
        "zoom-settle-seconds",
        "ws-sample-seconds",
        "width",
        "height",
        "name",
        "allow-software-renderer",
        "screenshots",
        "budget",
        "require-reduction",
        "expect-at-least",
        "dry-run",
    ],
    compare: [...COMMON_FLAGS, "reference-url", "viewports"],
    panel: [...COMMON_FLAGS, "viewports"],
    gate1: [...COMMON_FLAGS, "settle-seconds", "name", "context", "flag", "repeats", "shading-control"],
};
const BOOLEAN_FLAGS = ["allow-software-renderer", "screenshots", "dry-run", "shading-control"];

interface RawArguments {
    readonly positionals: string[];
    readonly flags: Map<string, string[]>;
}

function splitArguments(argv: readonly string[], allowed: readonly string[]): RawArguments {
    const positionals: string[] = [];
    const flags = new Map<string, string[]>();
    for (const argument of argv) {
        if (!argument.startsWith("--")) {
            positionals.push(argument);
            continue;
        }
        const equals = argument.indexOf("=");
        const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
        if (!allowed.includes(name)) {
            throw new UsageError(`unknown option --${name} for this command`);
        }
        if (equals === -1 && !BOOLEAN_FLAGS.includes(name)) {
            throw new UsageError(`--${name} needs a value: --${name}=VALUE`);
        }
        flags.set(name, [...(flags.get(name) ?? []), equals === -1 ? "true" : argument.slice(equals + 1)]);
    }
    return { positionals, flags };
}

function last(raw: RawArguments, name: string): string | undefined {
    return raw.flags.get(name)?.at(-1);
}

function number(raw: RawArguments, name: string, fallback: number, minimum: number, integer = false): number {
    const text = last(raw, name);
    if (text === undefined) {
        return fallback;
    }
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
        throw new UsageError(`--${name} must be ${integer ? "a whole number" : "a number"} of ${minimum} or more`);
    }
    return value;
}

function list<T extends string>(raw: RawArguments, name: string, allowed: readonly T[], fallback: readonly T[]): T[] {
    const text = last(raw, name);
    if (text === undefined) {
        return [...fallback];
    }
    const values = text.split(",").map((value) => value.trim());
    const unknown = values.find((value) => !(allowed as readonly string[]).includes(value));
    if (unknown !== undefined || values.length === 0) {
        throw new UsageError(`--${name} takes ${allowed.join(" and/or ")}, separated by commas (got "${text}")`);
    }
    return [...new Set(values as T[])];
}

export function parseViewport(text: string): Viewport {
    const match = /^(\d+)x(\d+)$/.exec(text.trim());
    if (match === null || Number(match[1]) < 200 || Number(match[2]) < 200) {
        throw new UsageError(`a viewport is WIDTHxHEIGHT of at least 200x200, e.g. 375x812 (got "${text}")`);
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}

function viewports(raw: RawArguments, fallback: string): Viewport[] {
    return (last(raw, "viewports") ?? fallback).split(",").map(parseViewport);
}

function browserOptions(raw: RawArguments, environment: ParseEnvironment): BrowserOptions {
    const renderer = last(raw, "renderer") ?? "gpu";
    if (renderer !== "gpu" && renderer !== "swiftshader") {
        throw new UsageError(`--renderer takes gpu or swiftshader (got "${renderer}")`);
    }
    const angle = last(raw, "angle") ?? (environment.platform === "darwin" ? "metal" : "none");
    return {
        renderer,
        angle: angle === "none" ? undefined : angle,
        playwrightDir: last(raw, "playwright-dir"),
        locale: last(raw, "locale") ?? "pt-BR",
    };
}

function roomUrl(text: string | undefined, what: string): string {
    if (text === undefined) {
        throw new UsageError(`${what} needs the room URL as its first argument`);
    }
    try {
        const url = new URL(text);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new Error("not http");
        }
    } catch {
        throw new UsageError(`"${text}" is not an http(s) URL`);
    }
    return text;
}

/**
 * `--flag=KEY=VALUE` as a record, in the order given. A flag with no "=", an empty key or an empty value is a typo that
 * would otherwise measure the default configuration under the name of a flag, so it stops the run; so does one key
 * given two different values.
 */
export function parseStorageFlags(values: readonly string[]): Record<string, string> {
    const flags = new Map<string, string>();
    for (const text of values) {
        const equals = text.indexOf("=");
        const key = equals === -1 ? text : text.slice(0, equals);
        const value = equals === -1 ? "" : text.slice(equals + 1);
        if (key === "" || /\s/.test(key) || value === "") {
            throw new UsageError(
                `--flag takes KEY=VALUE with no space in the key and a value, e.g. --flag=gameStepCap=0 (got "${text}")`,
            );
        }
        const earlier = flags.get(key);
        if (earlier !== undefined && earlier !== value) {
            throw new UsageError(`--flag ${key} is given two values (${earlier} and ${value})`);
        }
        flags.set(key, value);
    }
    return Object.fromEntries(flags);
}

/** `--repeats`: an odd count, so that "at least half" is a majority and never a tie. */
function gate1Repeats(raw: RawArguments): number {
    const repeats = number(raw, "repeats", 3, 1, true);
    if (repeats % 2 === 0) {
        throw new UsageError(`--repeats must be odd (got ${repeats}): with an even count half of the windows is a tie`);
    }
    return repeats;
}

function gate1Context(raw: RawArguments): "webgl2" | "default" {
    const context = last(raw, "context") ?? "webgl2";
    if (context !== "webgl2" && context !== "default") {
        throw new UsageError(`--context takes webgl2 or default (got "${context}")`);
    }
    return context;
}

/** Reads the command line. Throws UsageError for anything it does not understand: a typo must not become a default. */
export function parseArgs(argv: readonly string[], environment: ParseEnvironment): ProbeConfig {
    const [command, ...rest] = argv;
    if (command !== "frames" && command !== "compare" && command !== "panel" && command !== "gate1") {
        throw new UsageError(`the first argument must be frames, compare, panel or gate1 (got "${command ?? ""}")`);
    }
    const raw = splitArguments(rest, ALLOWED_FLAGS[command]);
    if (raw.positionals.length > 1) {
        throw new UsageError(`expected one room URL, got ${raw.positionals.length} arguments`);
    }
    const url = roomUrl(raw.positionals[0], command);
    const browser = browserOptions(raw, environment);
    const outDir = last(raw, "out-dir");

    if (command === "compare") {
        const referenceUrl = last(raw, "reference-url");
        return {
            command,
            url,
            referenceUrl: referenceUrl === undefined ? undefined : roomUrl(referenceUrl, "--reference-url"),
            browser,
            outDir,
            viewports: viewports(raw, "1451x855"),
        };
    }
    if (command === "gate1") {
        return {
            command,
            url,
            browser,
            outDir,
            settleSeconds: number(raw, "settle-seconds", 10, 0),
            name: last(raw, "name") ?? "Probe",
            context: gate1Context(raw),
            flags: parseStorageFlags(raw.flags.get("flag") ?? []),
            repeats: gate1Repeats(raw),
            shadingControl: raw.flags.has("shading-control"),
        };
    }
    if (command === "panel") {
        return { command, url, browser, outDir, viewports: viewports(raw, "1440x900,1000x800,768x1024,360x780") };
    }
    try {
        return {
            command,
            url,
            browser,
            outDir,
            runs: number(raw, "runs", 3, 1, true),
            fx: list(raw, "fx", ["on", "off"], ["on", "off"]),
            detailBudget: list(raw, "detail-budget", ["off", "on"], ["off", "on"]),
            views: list(raw, "views", ["default", "wholeMap"], ["default", "wholeMap"]),
            settleSeconds: number(raw, "settle-seconds", 5, 0),
            recordSeconds: number(raw, "record-seconds", 25, 1),
            wheelDelta: number(raw, "wheel-delta", 800, 1),
            wheelEvents: number(raw, "wheel-events", 2, 1, true),
            zoomWindowSeconds: number(raw, "zoom-window-seconds", 2, 1),
            zoomSettleSeconds: number(raw, "zoom-settle-seconds", 2, 0),
            wsSampleSeconds: number(raw, "ws-sample-seconds", 5, 0, true),
            viewport: {
                width: number(raw, "width", 1451, 200, true),
                height: number(raw, "height", 855, 200, true),
            },
            name: last(raw, "name") ?? "Probe",
            allowSoftwareRenderer: raw.flags.has("allow-software-renderer"),
            screenshots: raw.flags.has("screenshots"),
            dryRun: raw.flags.has("dry-run"),
            budgets: (raw.flags.get("budget") ?? []).map(parseBudget),
            reductions: (raw.flags.get("require-reduction") ?? []).map(parseReduction),
            expectations: (raw.flags.get("expect-at-least") ?? []).map(parseExpectation),
        };
    } catch (error: unknown) {
        if (error instanceof BudgetSyntaxError) {
            throw new UsageError(error.message);
        }
        throw error;
    }
}
