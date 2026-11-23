/**
 * The pure parts of the shader lab: presets, the camera's world rectangle, synthetic people, picture diffs and the
 * numbers taken from them. No DOM, no GL, no I/O: the page (lab.ts) and the unit tests both import this file.
 */
import type { Camera, Point, Size } from "./args";

export interface Preset {
    readonly camera: Camera;
    readonly people: readonly Point[];
    readonly note: string;
}

/**
 * The views the owner looked at, centres and feet read from the built map (fx/manifest.json lights, office.wam):
 * the arcs flank the reception desk at (1151,1281) and (1568,1280); the lounge lamps are the arc at (2453,1108) and
 * the pendant at (2373,1278); the entrance's door light hangs at (1392,1522). The feet stand under a lamp's pool, beside
 * it, and away from it, so a person lit from one side and one lit from none are in the same picture.
 */
export const PRESETS: Readonly<Record<string, Preset>> = {
    reception: {
        camera: { x: 1391, y: 1330, zoom: 2 },
        people: [
            { x: 1176, y: 1334 },
            { x: 1222, y: 1340 },
            { x: 1392, y: 1404 },
            { x: 1608, y: 1332 },
            { x: 1560, y: 1346 },
        ],
        note: "reception desk between the two arc lamps (1151,1281) and (1568,1280)",
    },
    lounge: {
        camera: { x: 2415, y: 1200, zoom: 2 },
        people: [
            { x: 2430, y: 1182 },
            { x: 2478, y: 1170 },
            { x: 2384, y: 1262 },
            { x: 2338, y: 1236 },
            { x: 2520, y: 1250 },
        ],
        note: "lounge with the two lamps: the arc (2453,1108) and the pendant (2373,1278)",
    },
    entrance: {
        camera: { x: 1392, y: 1536, zoom: 2 },
        people: [
            { x: 1392, y: 1566 },
            { x: 1356, y: 1534 },
            { x: 1430, y: 1536 },
            { x: 1392, y: 1606 },
        ],
        note: "the entrance glass and its door light (1392,1522), the path out to the lawn",
    },
    "floor-lamps": {
        camera: { x: 600, y: 1296, zoom: 2 },
        people: [
            { x: 596, y: 1196 },
            { x: 640, y: 1210 },
            { x: 596, y: 1484 },
            { x: 530, y: 1470 },
        ],
        note: "the two floor lamps of the west lounge (576,1152) and (576,1440)",
    },
    overview: {
        camera: { x: 1392, y: 896, zoom: 0.75 },
        people: [
            { x: 1176, y: 1334 },
            { x: 1608, y: 1332 },
            { x: 2430, y: 1182 },
            { x: 1392, y: 1404 },
        ],
        note: "the whole building at zoom 0.75 (use --size 2048x1200 to see all of it)",
    },
};

export const DEFAULT_PRESET = "reception";

export function presetNames(): string[] {
    return Object.keys(PRESETS);
}

/** [x, y, w, h] in map px of what the window shows: the shader's `uWorld`. */
export function viewRect(camera: Camera, size: Size): [number, number, number, number] {
    const w = size.width / camera.zoom;
    const h = size.height / camera.zoom;
    return [camera.x - w / 2, camera.y - h / 2, w, h];
}

/** The decimal hour from `--hour`, else the client's `konclui.fx.hour` switch, else 22 (night). */
export function resolveHour(hour: number | undefined, flags: Readonly<Record<string, string>>): number {
    if (hour !== undefined) return hour;
    const raw = flags["konclui.fx.hour"];
    if (raw !== undefined) {
        const value = Number(raw);
        if (Number.isFinite(value) && value >= 0 && value <= 24) return value;
        throw new Error(`konclui.fx.hour must be 0 to 24, got "${raw}"`);
    }
    return 22;
}

/** What `konclui.fx.rim` asks of the lab, as the client reads it (browserEffectsPort.ts). */
export type RimMode = "off" | "on" | "legacy" | "full" | "reduced";

export function rimMode(flags: Readonly<Record<string, string>>): RimMode {
    const raw = flags["konclui.fx.rim"];
    if (raw === undefined || raw === "" || raw === "0") return "off";
    if (raw === "legacy" || raw === "full" || raw === "reduced") return raw;
    if (raw === "1") return "on";
    throw new Error(`konclui.fx.rim must be 0, 1, full, reduced or legacy, got "${raw}"`);
}

// ---------------------------------------------------------------------------------------------------------------
// Synthetic people

/** The avatar's cell: 14 wide, 26 tall, the feet on the row under it, as the legacy rim's box assumes (|dx| < 10). */
export const AVATAR_W = 14;
export const AVATAR_H = 26;

const CLOTHES: readonly (readonly [number, number, number])[] = [
    [214, 92, 74],
    [74, 144, 217],
    [236, 184, 64],
    [112, 190, 112],
    [170, 110, 200],
    [232, 232, 226],
];
const SKIN: readonly (readonly [number, number, number])[] = [
    [240, 200, 160],
    [198, 146, 104],
    [140, 94, 66],
];
const OUTLINE: readonly [number, number, number] = [26, 28, 44];

/** Cell values: 0 empty, 1 outline, 2 skin, 3 clothes, 4 legs. Built once: a capsule with a head, a torso and legs. */
export function avatarCells(): Uint8Array {
    const inside = new Uint8Array(AVATAR_W * AVATAR_H);
    const set = (x: number, y: number, v: number) => {
        if (x >= 0 && x < AVATAR_W && y >= 0 && y < AVATAR_H) inside[y * AVATAR_W + x] = v;
    };
    for (let y = 0; y < AVATAR_H; y++) {
        for (let x = 0; x < AVATAR_W; x++) {
            const dx = (x - 6.5) / 4.2;
            const dy = (y - 4.5) / 4.6;
            if (dx * dx + dy * dy <= 1)
                set(x, y, 2); // head
            else if (y >= 9 && y <= 18 && x >= 2 && x <= 11)
                set(x, y, 3); // torso, rounded at the shoulders
            else if (y >= 19 && y <= 25 && ((x >= 3 && x <= 5) || (x >= 8 && x <= 10))) set(x, y, 4); // legs
        }
    }
    set(2, 9, 0);
    set(11, 9, 0);
    // the outline is the body's own pixels that touch empty space
    const out = inside.slice();
    for (let y = 0; y < AVATAR_H; y++) {
        for (let x = 0; x < AVATAR_W; x++) {
            if (inside[y * AVATAR_W + x] === 0) continue;
            const edge = [
                [x - 1, y],
                [x + 1, y],
                [x, y - 1],
                [x, y + 1],
            ].some(
                ([nx, ny]) => nx < 0 || ny < 0 || nx >= AVATAR_W || ny >= AVATAR_H || inside[ny * AVATAR_W + nx] === 0,
            );
            if (edge) out[y * AVATAR_W + x] = 1;
        }
    }
    return out;
}

export interface PeopleDrawn {
    /** Pixels written, per person. */
    readonly pixels: number[];
}

/**
 * Draws the people into an RGBA frame of `width` x `height` (row 0 on top). With `mark`, each body pixel gets alpha 0,
 * the mark the shaded program reads as "a person" (plan 2f); without it, alpha 255 as today's filter expects.
 * Feet at (x, y): the body fills x-7..x+6 and y-26..y-1. Deterministic: the clothes follow the index.
 */
export function drawPeople(
    rgba: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    feet: readonly Point[],
    mark: boolean,
): PeopleDrawn {
    const cells = avatarCells();
    const pixels: number[] = [];
    feet.forEach((foot, index) => {
        const cloth = CLOTHES[index % CLOTHES.length];
        const skin = SKIN[index % SKIN.length];
        const left = Math.round(foot.x) - 7;
        const top = Math.round(foot.y) - AVATAR_H;
        let count = 0;
        for (let y = 0; y < AVATAR_H; y++) {
            for (let x = 0; x < AVATAR_W; x++) {
                const cell = cells[y * AVATAR_W + x];
                const mx = left + x;
                const my = top + y;
                if (cell === 0 || mx < 0 || my < 0 || mx >= width || my >= height) continue;
                const colour = cell === 1 ? OUTLINE : cell === 2 ? skin : cell === 3 ? cloth : [60, 70, 110];
                const at = (my * width + mx) * 4;
                rgba[at] = colour[0];
                rgba[at + 1] = colour[1];
                rgba[at + 2] = colour[2];
                rgba[at + 3] = mark ? 0 : 255;
                count += 1;
            }
        }
        pixels.push(count);
    });
    return { pixels };
}

// ---------------------------------------------------------------------------------------------------------------
// Picture comparison

/** The most a channel may differ for two pictures to count as the same: GPU rounding, not light. */
export const SAME_THRESHOLD = 2;

export interface DiffStats {
    readonly pixels: number;
    readonly changed: number;
    /** changed / pixels */
    readonly changedShare: number;
    /** The largest channel delta, 0..255. */
    readonly maxDelta: number;
}

/** Counts the pixels of two same-size RGBA pictures whose largest channel delta exceeds `threshold` (alpha ignored). */
export function diffStats(
    a: Uint8ClampedArray | Uint8Array,
    b: Uint8ClampedArray | Uint8Array,
    threshold = SAME_THRESHOLD,
    inside?: (index: number) => boolean,
): DiffStats {
    if (a.length !== b.length) throw new Error(`pictures differ in size: ${a.length} and ${b.length} bytes`);
    let pixels = 0;
    let changed = 0;
    let maxDelta = 0;
    for (let i = 0, p = 0; i < a.length; i += 4, p++) {
        if (inside && !inside(p)) continue;
        pixels += 1;
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (d > maxDelta) maxDelta = d;
        if (d > threshold) changed += 1;
    }
    return { pixels, changed, changedShare: pixels === 0 ? 0 : changed / pixels, maxDelta };
}

/** The off picture dimmed to 40%, with the pixels that changed painted red. Same size, opaque. */
export function diffImage(
    off: Uint8ClampedArray | Uint8Array,
    on: Uint8ClampedArray | Uint8Array,
    threshold = SAME_THRESHOLD,
): Uint8ClampedArray {
    if (off.length !== on.length) throw new Error(`pictures differ in size: ${off.length} and ${on.length} bytes`);
    const out = new Uint8ClampedArray(off.length);
    for (let i = 0; i < off.length; i += 4) {
        const d = Math.max(
            Math.abs(off[i] - on[i]),
            Math.abs(off[i + 1] - on[i + 1]),
            Math.abs(off[i + 2] - on[i + 2]),
        );
        if (d > threshold) {
            out[i] = 255;
            out[i + 1] = 20;
            out[i + 2] = 20;
        } else {
            out[i] = off[i] * 0.4;
            out[i + 1] = off[i + 1] * 0.4;
            out[i + 2] = off[i + 2] * 0.4;
        }
        out[i + 3] = 255;
    }
    return out;
}

/** Rec. 601 luma of a pixel, 0..255, the shader's `lum`. */
export function luma(rgba: Uint8ClampedArray | Uint8Array, pixel: number): number {
    const i = pixel * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

/** Flips rows (GL reads bottom-up) into a new array, and optionally forces alpha to 255 for a PNG. */
export function flipRows(
    src: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    opaque: boolean,
): Uint8ClampedArray {
    const out = new Uint8ClampedArray(src.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
        out.set(src.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    }
    if (opaque) for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// GPU timing

export interface TimingStats {
    readonly count: number;
    readonly mean: number;
    readonly median: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) return Number.NaN;
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarizeTimes(samples: readonly number[]): TimingStats | null {
    if (samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
        count: sorted.length,
        mean: sum / sorted.length,
        median: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1],
    };
}

/** A software renderer's timings say nothing about a GPU. */
export function isSoftwareRenderer(renderer: string): boolean {
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(renderer);
}

// ---------------------------------------------------------------------------------------------------------------
// Shader diagnostics

export interface ShaderError {
    readonly line: number | undefined;
    readonly message: string;
    readonly excerpt: string;
}

/**
 * Turns a driver's info log into the offending lines. ANGLE and most drivers print "ERROR: 0:LINE: message"; the source
 * the lab gave the driver is numbered from 1, so the excerpt is that line with its two neighbours.
 */
export function shaderErrors(log: string, source: string): ShaderError[] {
    const lines = source.split("\n");
    const errors: ShaderError[] = [];
    for (const entry of log.split("\n")) {
        const match = /(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(entry.trim());
        if (!match) continue;
        const line = Number(match[1]);
        const first = Math.max(1, line - 1);
        const last = Math.min(lines.length, line + 1);
        const excerpt: string[] = [];
        for (let n = first; n <= last; n++)
            excerpt.push(`${n === line ? ">" : " "} ${String(n).padStart(4)} | ${lines[n - 1]}`);
        errors.push({ line, message: match[2], excerpt: excerpt.join("\n") });
    }
    return errors;
}

/** The message the lab dies with: the driver's own words and, per error, the source line it points at. */
export function compileFailure(name: string, stage: "compile" | "link", log: string, source: string): string {
    const found = shaderErrors(log, source);
    const detail = found.map((e) => `  line ${e.line}: ${e.message}\n${e.excerpt}`).join("\n");
    return `shader "${name}" does not ${stage}:\n${log.trim()}${detail === "" ? "" : `\n${detail}`}`;
}

/** The pragma line Phaser's template engine reads, which a plain GL driver rejects. */
export function forProbe(source: string): string {
    return source.replace(/^#pragma phaserTemplate\(.*\)$/gm, "");
}
