/**
 * Command line of the shader lab (run.ts). Pure: no I/O, so the unit tests cover the whole grammar.
 *
 *   npx tsx shader-lab/run.ts <built map dir> --out <dir> [--hour 19.3] [--camera x,y,zoom]
 *       [--people x,y;x,y...] [--flag key=value ...] [--preset name|all] [--size 960x540] [--gl 1|2]
 */

export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UsageError";
    }
}

export interface Camera {
    /** The world point at the centre of the window, in map px (fractions allowed: a sub-pixel scroll). */
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
}

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface Size {
    readonly width: number;
    readonly height: number;
}

export interface LabConfig {
    readonly dist: string;
    readonly out: string;
    /** Decimal hour in the office's zone; undefined means `konclui.fx.hour` from the flags, else 22. */
    readonly hour: number | undefined;
    readonly camera: Camera | undefined;
    readonly people: readonly Point[] | undefined;
    /** The localStorage switches of the client the lab honours: konclui.fx.hour, konclui.fx.rim, konclui.fx.off. */
    readonly flags: Readonly<Record<string, string>>;
    /** A preset name, "all", or undefined (the default preset). */
    readonly preset: string | undefined;
    readonly size: Size;
    /** The context the pictures are drawn on. Timing runs on both unless `timing` is off. */
    readonly gl: 1 | 2;
    /** "map" (the build's whole-map render if there is one, else composed) or "compose" or a PNG path. */
    readonly frame: string;
    readonly timing: boolean;
    readonly timingDraws: number;
    readonly timingSize: Size;
    readonly onShader: string | undefined;
    readonly offShader: string | undefined;
    readonly channel: "chrome" | "chromium";
    readonly listPresets: boolean;
    readonly clouds: boolean;
    /** Run the Phaser probe (phaser-probe.ts) instead of the lab: no built map needed. */
    readonly phaser: boolean;
    /** Draw the people with no mark, as the avatars beyond the marks' cap are, and list the first eight in uCrowd. */
    readonly unmarked: boolean;
    /** Also render the shimmer check (four fractional scrolls at zoom 1 and 2) and count what swims. */
    readonly shimmer: boolean;
}

export const DEFAULT_SIZE: Size = { width: 960, height: 540 };
export const DEFAULT_TIMING_SIZE: Size = { width: 1920, height: 1080 };
export const DEFAULT_TIMING_DRAWS = 200;

const VALUE_FLAGS = new Set([
    "out",
    "hour",
    "camera",
    "people",
    "preset",
    "size",
    "gl",
    "frame",
    "timing-draws",
    "timing-size",
    "on-shader",
    "off-shader",
    "channel",
]);
const SWITCH_FLAGS = new Set([
    "no-timing",
    "list-presets",
    "no-clouds",
    "webgl2",
    "phaser",
    "unmarked",
    "shimmer",
    "help",
]);

function number(text: string, what: string): number {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) throw new UsageError(`${what} must be a number, got "${text}"`);
    return value;
}

/** "x,y,zoom". */
export function parseCamera(text: string): Camera {
    const parts = text.split(",");
    if (parts.length !== 3) throw new UsageError(`--camera takes x,y,zoom, got "${text}"`);
    const [x, y, zoom] = parts.map((part) => number(part, "--camera"));
    if (zoom <= 0) throw new UsageError(`--camera zoom must be above 0, got ${zoom}`);
    return { x, y, zoom };
}

/** "x,y;x,y": the feet of the people, in map px. */
export function parsePeople(text: string): Point[] {
    if (text.trim() === "" || text === "none") return [];
    return text.split(";").map((pair) => {
        const parts = pair.split(",");
        if (parts.length !== 2) throw new UsageError(`--people takes x,y;x,y..., got "${pair}"`);
        return { x: number(parts[0], "--people"), y: number(parts[1], "--people") };
    });
}

/** "960x540". */
export function parseSize(text: string, option = "--size"): Size {
    const match = /^(\d+)x(\d+)$/.exec(text);
    if (!match) throw new UsageError(`${option} takes WIDTHxHEIGHT, got "${text}"`);
    const size = { width: Number(match[1]), height: Number(match[2]) };
    if (size.width < 16 || size.height < 16 || size.width > 4096 || size.height > 4096) {
        throw new UsageError(`${option} must be between 16 and 4096 px each way, got ${text}`);
    }
    return size;
}

/** "key=value". The key keeps its dots (konclui.fx.rim). */
export function parseFlag(text: string): [string, string] {
    const at = text.indexOf("=");
    if (at <= 0) throw new UsageError(`--flag takes key=value, got "${text}"`);
    return [text.slice(0, at), text.slice(at + 1)];
}

export function parseArgs(argv: readonly string[]): LabConfig {
    const positional: string[] = [];
    const values = new Map<string, string>();
    const switches = new Set<string>();
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith("--")) {
            positional.push(arg);
            continue;
        }
        const eq = arg.indexOf("=");
        // --flag is the one option that takes more than one value: --flag a=b c=d, or --flag=a=b
        const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
        const inline = eq < 0 ? undefined : arg.slice(eq + 1);
        if (name === "flag") {
            const taken = inline === undefined ? [] : [inline];
            while (inline === undefined && i + 1 < argv.length && !argv[i + 1].startsWith("--")) taken.push(argv[++i]);
            if (taken.length === 0) throw new UsageError("--flag takes key=value");
            for (const item of taken) {
                const [key, value] = parseFlag(item);
                flags[key] = value;
            }
        } else if (SWITCH_FLAGS.has(name)) {
            if (inline !== undefined) throw new UsageError(`--${name} takes no value`);
            switches.add(name);
        } else if (VALUE_FLAGS.has(name)) {
            const value = inline ?? argv[++i];
            if (value === undefined || (inline === undefined && value.startsWith("--"))) {
                throw new UsageError(`--${name} needs a value`);
            }
            values.set(name, value);
        } else {
            throw new UsageError(`unknown option --${name}`);
        }
    }
    if (switches.has("help")) throw new UsageError(USAGE);
    const listPresets = switches.has("list-presets");
    if (positional.length > 1) throw new UsageError(`one map directory only, got ${positional.join(", ")}`);
    const phaser = switches.has("phaser");
    if (positional.length === 0 && !listPresets && !phaser)
        throw new UsageError(`the built map directory is required\n${USAGE}`);
    const out = values.get("out");
    if (out === undefined && !listPresets) throw new UsageError(`--out <dir> is required\n${USAGE}`);
    const gl = switches.has("webgl2") ? "2" : (values.get("gl") ?? "1");
    if (gl !== "1" && gl !== "2") throw new UsageError(`--gl is 1 or 2, got "${gl}"`);
    const channel = values.get("channel") ?? "chrome";
    if (channel !== "chrome" && channel !== "chromium") throw new UsageError(`--channel is chrome or chromium`);
    const draws = values.has("timing-draws") ? number(values.get("timing-draws") ?? "", "--timing-draws") : 200;
    if (!Number.isInteger(draws) || draws < 1 || draws > 5000) throw new UsageError("--timing-draws is 1 to 5000");
    const hourText = values.get("hour");
    const hour = hourText === undefined ? undefined : number(hourText, "--hour");
    if (hour !== undefined && (hour < 0 || hour > 24)) throw new UsageError(`--hour is 0 to 24, got ${hour}`);
    const cameraText = values.get("camera");
    const peopleText = values.get("people");
    return {
        dist: positional[0] ?? "",
        out: out ?? "",
        hour,
        camera: cameraText === undefined ? undefined : parseCamera(cameraText),
        people: peopleText === undefined ? undefined : parsePeople(peopleText),
        flags,
        preset: values.get("preset"),
        size: values.has("size") ? parseSize(values.get("size") ?? "") : DEFAULT_SIZE,
        gl: gl === "2" ? 2 : 1,
        frame: values.get("frame") ?? "map",
        timing: !switches.has("no-timing"),
        timingDraws: draws,
        timingSize: values.has("timing-size")
            ? parseSize(values.get("timing-size") ?? "", "--timing-size")
            : DEFAULT_TIMING_SIZE,
        onShader: values.get("on-shader"),
        offShader: values.get("off-shader"),
        channel,
        listPresets,
        clouds: !switches.has("no-clouds"),
        phaser,
        unmarked: switches.has("unmarked"),
        shimmer: switches.has("shimmer"),
    };
}

export const USAGE = `usage: npx tsx shader-lab/run.ts <built map dir> --out <dir> [options]
  --hour H              decimal hour (default: flag konclui.fx.hour, else 22)
  --camera x,y,zoom     window centre in map px and zoom (default: the preset's)
  --people x,y;x,y      feet of the people in map px (default: the preset's; "none")
  --preset NAME|all     a view the owner looked at (--list-presets)
  --flag k=v [k=v ...]  konclui.fx.hour, konclui.fx.rim (1|full|reduced|legacy|0), konclui.fx.off
  --size WxH            window in screen px (default 960x540)
  --gl 1|2 (--webgl2)   context of the pictures (default 1); timing runs on both
  --frame map|compose|FILE   colour frame (default: the build's render, else composed)
  --no-timing  --timing-draws N  --timing-size WxH
  --on-shader FILE  --off-shader FILE   GLSL to use instead of the tree's
  --no-clouds  --channel chrome|chromium  --list-presets
  --unmarked            draw the people with no mark (the avatars beyond the cap), the first 8 in uCrowd
  --shimmer             also check, at 4 fractional scrolls and zoom 1 and 2, that nothing swims
  --phaser              the Phaser probe instead (no map needed): draw calls, alpha, blend, cast row order, whole-frame GPU time`;
