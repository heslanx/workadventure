import type { Box, Point, Rect } from "./geometry";
import { inside } from "./geometry";
import type { Rgb } from "./timeOfDay";

/** The sprite point a pool hangs from: a lamp's shade, its foot, below a screen, a glyph's middle, or the centre. */
export type Anchor = "head" | "foot" | "front" | "glyph" | "centre";

/** A pool of light: where it hangs, its offset, reach, squash (its height over its width) and power. */
export type Pool = readonly [where: Anchor, dx: number, dy: number, reach: number, squash: number, power: number];

/**
 * Light by kind of sprite (the effects build names the kinds). A pool on the floor is seen in 3/4, hence its squash.
 * `emissive` is the part of the sprite that keeps its own light at night (bulb under the shade, screen, glyph), with
 * its tint; `meeting` lights it only during a meeting.
 */
export interface LightKind {
    readonly color: Rgb;
    readonly pools: readonly Pool[];
    readonly emissive?: "bulb" | "screen" | "glyph";
    readonly bulb?: "under" | "top";
    readonly tint?: Rgb;
    readonly halo?: boolean;
    readonly self?: boolean;
    readonly night?: boolean;
    readonly meeting?: boolean;
}

const AMBER: Rgb = [255, 188, 80];

export const LIGHT_KINDS: Readonly<Partial<Record<string, LightKind>>> = {
    arc: {
        color: AMBER,
        pools: [
            ["head", 0, 18, 44, 0.8, 0.95],
            ["head", 0, 48, 80, 0.6, 0.6],
            ["head", 0, 84, 96, 0.5, 0.45],
        ],
        emissive: "bulb",
        bulb: "under",
        halo: true,
    },
    floor: {
        color: AMBER,
        pools: [
            ["head", 0, 14, 38, 0.8, 0.95],
            ["head", 0, 40, 66, 0.6, 0.6],
            ["head", 0, 72, 80, 0.5, 0.42],
        ],
        emissive: "bulb",
        bulb: "top",
        halo: true,
    },
    desk: { color: AMBER, pools: [["centre", 0, 0, 40, 0.7, 0.75]], halo: true },
    screen: {
        color: [90, 160, 255],
        pools: [["front", 0, 0, 40, 0.6, 1]],
        emissive: "screen",
        tint: [0.62, 0.8, 1.05],
        self: true,
        night: true,
    },
    tv: {
        color: [40, 190, 230],
        pools: [
            ["front", 0, 30, 64, 1, 1.2],
            ["front", 0, -6, 30, 0.6, 0.9],
        ],
        emissive: "screen",
        meeting: true,
        self: true,
        halo: true,
    },
    led: { color: [170, 235, 255], pools: [["front", 0, 0, 130, 0.55, 0.8]], emissive: "screen", self: true },
    totem: {
        color: [40, 190, 180],
        pools: [["foot", 0, -6, 50, 0.45, 0.6]],
        emissive: "glyph",
        tint: [0.75, 1, 1],
        self: true,
    },
    appliance: { color: [215, 238, 255], pools: [["front", 0, 0, 40, 0.6, 0.7]], emissive: "screen", self: true },
    arcade: { color: [255, 110, 210], pools: [["front", 0, 0, 40, 0.6, 0.85]], emissive: "screen", self: true },
    sign: {
        color: [60, 230, 230],
        pools: [["glyph", 0, 4, 34, 0.7, 0.55]],
        emissive: "glyph",
        tint: [0.75, 1, 1],
        self: true,
    },
};

type Tint = readonly [r: number, g: number, b: number, amount: number];

// A bulb under a shade is painted lit over its pixels, not just kept bright.
const BULB: Tint = [1, 0.94, 0.55, 0.95];

// Sent once as a table: the shader's uniform budget holds a 4-entry table but not one tint per rect (some GPUs give
// a fragment shader 221 vectors; POST used 233).
export const EMISSIVE_TINTS: readonly Tint[] = [[1, 1, 1, 0], [0.62, 0.8, 1.05, 0], [0.75, 1, 1, 0], BULB];

const tintIndex = (kind: LightKind): number =>
    kind.emissive === "bulb" ? 3 : kind.emissive === "glyph" ? 2 : kind.tint ? 1 : 0;

export interface StaticKind {
    readonly color: Rgb;
    readonly power: number;
    readonly reach?: number;
    readonly squash?: number;
    /** Only the open water glows. */
    readonly water?: boolean;
}

/** Light no object carries: the entrance, inside and out, the fountain, the pool. */
export const STATIC_KINDS: Readonly<Partial<Record<string, StaticKind>>> = {
    door: { color: [255, 200, 105], power: 1 },
    doorLawn: { color: [220, 190, 110], power: 0.5 },
    fountain: { color: [90, 230, 225], power: 0.8, reach: 60, squash: 0.7 },
    pool: { color: [30, 185, 180], power: 0.35, squash: 0.8, water: true },
};

/** A sprite's light spec in the effects manifest, in sprite px. */
export interface SpriteSpec {
    readonly kind: string;
    readonly w: number;
    readonly h: number;
    readonly foot: readonly [x: number, y: number];
    readonly head?: readonly [x: number, y: number];
    readonly screen?: Box;
    readonly glyph?: Box;
}

/** A scene image as placed: its texture key and top-left corner. */
export interface PlacedImage {
    readonly key: string;
    readonly x: number;
    readonly y: number;
}

/** A light as the shader takes it, colour in 0..1. */
export interface Light {
    readonly x: number;
    readonly y: number;
    readonly reach: number;
    readonly color: Rgb;
    readonly power: number;
    readonly squash: number;
    readonly clip: Rect | null;
    readonly kind: string;
    readonly self: boolean;
    readonly night: boolean;
    readonly halo: boolean;
}

export interface EmissiveRect {
    readonly rect: Rect;
    /** An `EMISSIVE_TINTS` index. */
    readonly tint: number;
    readonly kind: string;
}

/** The light spec key of a scene image: its texture key from "entities/" on, as the effects build keys lights. */
export function specKey(textureKey: string): string | null {
    const i = textureKey.indexOf("/entities/");
    return i < 0 ? null : textureKey.slice(i + "/entities/".length);
}

/** A sprite point in world px, for an image whose top-left corner is at (x, y). */
export function spritePoint(spec: SpriteSpec, where: Anchor, x: number, y: number): Point {
    const [sx0, sy0, sx1, sy1] = spec.screen || spec.glyph || [0, 0, spec.w, spec.h];
    switch (where) {
        case "head":
            if (!spec.head) throw new Error(`The ${spec.kind} light spec has no head to hang a pool from`);
            return { x: x + spec.head[0], y: y + spec.head[1] };
        case "foot":
            return { x: x + spec.foot[0], y: y + spec.foot[1] };
        case "front":
            return { x: x + (sx0 + sx1) / 2, y: y + sy1 + 10 };
        case "glyph":
            return { x: x + (sx0 + sx1) / 2, y: y + (sy0 + sy1) / 2 };
        default:
            return { x: x + spec.w / 2, y: y + spec.h * 0.6 };
    }
}

/** The part of a sprite that keeps its own light at night, [x, y, w, h] in world px, or null. */
export function emissiveRect(spec: SpriteSpec, x: number, y: number): Rect | null {
    const kind = LIGHT_KINDS[spec.kind];
    if (kind?.emissive === "bulb" && spec.head) {
        // under an arc lamp's cap; on top of a standing lamp's shade
        const [hx, hy] = [Math.round(x + spec.head[0]), Math.round(y + spec.head[1])];
        return kind.bulb === "top" ? [hx - 3, hy - 5, 6, 2] : [hx - 4, hy + 3, 8, 2];
    }
    const r = kind?.emissive === "glyph" ? spec.glyph || spec.screen : kind?.emissive === "screen" ? spec.screen : null;
    return r ? [x + r[0], y + r[1], r[2] - r[0], r[3] - r[1]] : null;
}

/** The room floor holding a point, or null (the hall): its light stays inside. */
export function spaceOf(x: number, y: number, spaces: readonly Rect[] = []): Rect | null {
    return spaces.find((r) => inside(x, y, r)) || null;
}

const light = (
    x: number,
    y: number,
    reach: number,
    color: Rgb,
    power: number,
    squash: number,
    clip: Rect | null,
    kind: string,
    self = false,
    night = false,
    halo = false,
): Light => ({
    x,
    y,
    reach,
    color: [color[0] / 255, color[1] / 255, color[2] / 255],
    power,
    squash,
    clip,
    kind,
    self,
    night,
    halo,
});

/**
 * Lights of the placed sprites: specs from the manifest, room floors (spaces) that keep a light in. A TV lights only
 * while its room holds a meeting (`meetingAt(x, y)` true).
 */
export function lightsFrom(
    images: readonly PlacedImage[],
    specs: Readonly<Partial<Record<string, SpriteSpec>>>,
    spaces: readonly Rect[] = [],
    meetingAt: (x: number, y: number) => boolean = () => false,
): { pools: Light[]; emissive: EmissiveRect[] } {
    const pools: Light[] = [];
    const emissive: EmissiveRect[] = [];
    for (const image of images) {
        const key = specKey(image.key);
        const spec = key === null ? undefined : specs[key];
        const kind = spec && LIGHT_KINDS[spec.kind];
        if (!spec || !kind) continue;
        const front = spritePoint(spec, "front", image.x, image.y);
        if (kind.meeting && !meetingAt(front.x, front.y)) continue;
        for (const [where, dx, dy, reach, squash, power] of kind.pools) {
            const at = spritePoint(spec, where, image.x, image.y);
            const clip = spaceOf(at.x, at.y + dy, spaces) || spaceOf(front.x, front.y + 30, spaces);
            pools.push(
                light(
                    at.x + dx,
                    at.y + dy,
                    reach,
                    kind.color,
                    power,
                    squash,
                    clip,
                    spec.kind,
                    Boolean(kind.self),
                    Boolean(kind.night),
                    Boolean(kind.halo),
                ),
            );
        }
        const rect = emissiveRect(spec, image.x, image.y);
        if (rect) emissive.push({ rect, tint: tintIndex(kind), kind: spec.kind });
    }
    return { pools, emissive };
}

interface StaticLightBase {
    readonly kind: string;
    readonly power?: number;
    readonly clip?: Rect | null;
}

/** A carpet of light fading away from its top edge. */
export interface StaticCarpet extends StaticLightBase {
    readonly rect: Rect;
}

export interface StaticPoint extends StaticLightBase {
    readonly at: readonly [x: number, y: number];
    readonly r?: number;
    readonly squash?: number;
}

export type StaticLightSpec = StaticCarpet | StaticPoint;

/**
 * The manifest's static lights in the same form: a negative power lights the open water only; clip keeps a light on
 * one side of a wall (the entrance's light inside the lobby, and out on the path); a carpet's squash is minus its
 * height; squash 0 is a band that fades only sideways.
 */
export function staticLights(list: readonly StaticLightSpec[] = []): Light[] {
    const out: Light[] = [];
    for (const l of list) {
        const kind = STATIC_KINDS[l.kind];
        if (!kind) continue;
        const power = (kind.water ? -1 : 1) * (l.power ?? kind.power);
        if ("rect" in l) {
            out.push(light(l.rect[0], l.rect[1], l.rect[2], kind.color, power, -l.rect[3], l.clip || null, l.kind));
        } else {
            // A kind with no default reach or squash leaves NaN, as the reference left undefined: such a light is
            // never in view and never lights a pixel.
            const reach = l.r || kind.reach || Number.NaN;
            const squash = l.squash ?? kind.squash ?? Number.NaN;
            out.push(light(l.at[0], l.at[1], reach, kind.color, power, squash, l.clip || null, l.kind));
        }
    }
    return out;
}

export type LightReach = Pick<Light, "x" | "y" | "reach" | "power" | "squash"> & { readonly clip?: Rect | null };

/** The lights that reach into the view, nearest and strongest first, at most `max`. */
export function visibleLights<T extends LightReach>(lights: readonly T[], view: Rect, max = 32): T[] {
    const [vx, vy, vw, vh] = view;
    const cx = vx + vw / 2;
    const cy = vy + vh / 2;
    const reaches = (l: T): boolean => {
        if (l.squash < 0) return l.x < vx + vw && l.x + l.reach > vx && l.y < vy + vh && l.y - l.squash > vy;
        if (l.squash === 0) {
            return (
                l.x + l.reach > vx &&
                l.x - l.reach < vx + vw &&
                (!l.clip || (l.clip[1] < vy + vh && l.clip[1] + l.clip[3] > vy))
            );
        }
        return l.x + l.reach > vx && l.x - l.reach < vx + vw && l.y + l.reach > vy && l.y - l.reach < vy + vh;
    };
    return lights
        .filter(reaches)
        .map((l) => ({
            l,
            score: l.squash <= 0 ? -1 : Math.hypot(l.x - cx, l.y - cy) / (Math.abs(l.power) * l.reach),
        }))
        .sort((a, b) => a.score - b.score)
        .slice(0, max)
        .map((e) => e.l);
}

/** Whether a rectangle touches the view. */
export function touchesView(rect: Rect, view: Rect): boolean {
    return (
        rect[0] + rect[2] > view[0] &&
        rect[0] < view[0] + view[2] &&
        rect[1] + rect[3] > view[1] &&
        rect[1] < view[1] + view[3]
    );
}

/** Emissive rectangles in view, at most `max`. */
export function visibleRects<T extends { readonly rect: Rect }>(items: readonly T[], view: Rect, max = 24): T[] {
    return items.filter(({ rect }) => touchesView(rect, view)).slice(0, max);
}

/** A view as the cache hands it to its computation: reused, so read it and do not keep it. */
type ViewRect = [x: number, y: number, w: number, h: number];

/**
 * What a computation over the camera's view gave, kept while the view stays in one cell of a grid of `cell` px (its
 * size rounded to whole px) and `version` is the same: a footstep, which draws the scene again with the camera where
 * it was, finds the answer ready, and a camera that walks recomputes once per cell instead of once per frame.
 *
 * The computation is given the whole area every view of that cell could cover (the cell's corner, the view's size and
 * one cell of slack), so what it keeps is a superset of what the exact view would: a light or a rectangle that touches
 * the exact view is never missing, one that lies within a cell outside it may be there. Fixtures are static in world
 * space, so `version` changes only when the fixtures do (the caller counts that) and the answer for a cell stays right.
 */
export class ViewCache<T> {
    /** How many times the computation ran: a measure for tests. */
    public runs = 0;
    private result: readonly T[] = [];
    private cellX = Number.NaN;
    private cellY = Number.NaN;
    private width = Number.NaN;
    private height = Number.NaN;
    private version = Number.NaN;
    private readonly area: ViewRect = [0, 0, 0, 0];

    constructor(
        private readonly cell: number,
        private readonly compute: (area: Rect) => readonly T[],
    ) {}

    get(view: Rect, version: number): readonly T[] {
        const cellX = Math.floor(view[0] / this.cell);
        const cellY = Math.floor(view[1] / this.cell);
        const width = Math.round(view[2]);
        const height = Math.round(view[3]);
        if (
            cellX === this.cellX &&
            cellY === this.cellY &&
            width === this.width &&
            height === this.height &&
            version === this.version
        ) {
            return this.result;
        }
        this.cellX = cellX;
        this.cellY = cellY;
        this.width = width;
        this.height = height;
        this.version = version;
        // the exact view starts less than a cell past the corner and is at most half a px wider than its rounding
        this.area[0] = cellX * this.cell;
        this.area[1] = cellY * this.cell;
        this.area[2] = width + this.cell + 1;
        this.area[3] = height + this.cell + 1;
        this.runs += 1;
        this.result = this.compute(this.area);
        return this.result;
    }
}
