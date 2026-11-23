// The lamps that cast shadows, and the CPU twin of the camera pass's pool falloff: what a lamp's shadow takes away is the
// light the shader would have given those pixels, so the two must be the same formula.
import type { Rect } from "./geometry";
import { inside } from "./geometry";
import { LIGHT_KINDS, lightsFrom, specKey, spritePoint, type Light, type PlacedImage, type SpriteSpec } from "./lights";

/** Kinds of light whose source hangs above the floor and is blocked by what stands near it. Screens and TVs only add light. */
export const CASTING_KINDS: Readonly<Record<string, number>> = { arc: 42, floor: 42, desk: 24 };

/** A lamp that casts: where its light comes from (screen x, y and its height over the floor) and its pools. */
export interface CasterLamp {
    /** The index of the placed image, in the order given to `casterLampsFrom`. */
    readonly piece: number;
    readonly x: number;
    readonly y: number;
    /** The source's height over the floor in px: how long a shadow is for a caster at a distance. */
    readonly z: number;
    /**
     * Where the light lands under its source: the centre of its widest pool. A shadow points away from this point, not from
     * the head (an arc lamp's head is 80 px above the floor it lights, and a table's shadow does not fall away from the
     * bulb's picture but from the spot on the floor the bulb is over).
     */
    readonly gx: number;
    readonly gy: number;
    /** The widest pool's reach and squash: what counts as near the lamp. */
    readonly reach: number;
    readonly squash: number;
    readonly pools: readonly Light[];
}

/**
 * The lamps among placed images that cast shadows (arc, floor and desk lamps, by their light spec), each with the pools
 * the camera pass draws for it (from `lightsFrom`, so a pool is never described twice).
 */
export function casterLampsFrom(
    images: readonly PlacedImage[],
    specs: Readonly<Partial<Record<string, SpriteSpec>>>,
    spaces: readonly Rect[] = [],
): CasterLamp[] {
    const lamps: CasterLamp[] = [];
    for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const key = specKey(image.key);
        const spec = key === null ? undefined : specs[key];
        const z = spec ? CASTING_KINDS[spec.kind] : undefined;
        if (!spec || z === undefined || !LIGHT_KINDS[spec.kind]) continue;
        const kind = LIGHT_KINDS[spec.kind];
        if (kind?.pools[0][0] === "head" && !spec.head) continue;
        const at = spritePoint(spec, kind?.pools[0][0] ?? "centre", image.x, image.y);
        const { pools } = lightsFrom([image], specs, spaces);
        if (pools.length === 0) continue;
        let widest = pools[0];
        for (const pool of pools) if (Math.abs(pool.reach) > Math.abs(widest.reach)) widest = pool;
        lamps.push({
            piece: i,
            x: at.x,
            y: at.y,
            z,
            gx: widest.x,
            gy: widest.y,
            reach: Math.abs(widest.reach),
            squash: widest.squash,
            pools,
        });
    }
    return lamps;
}

/** What one pool gives the pixel centred at (wx, wy), before the night's strength: power x (1 - d)^1.4, as POST computes it. */
export function poolFalloff(pool: Light, wx: number, wy: number): number {
    if (pool.clip && !inside(wx, wy, pool.clip)) return 0;
    const ex = wx - pool.x;
    const ey = (wy - pool.y) / pool.squash;
    const d = Math.sqrt(ex * ex + ey * ey) / Math.abs(pool.reach);
    return d < 1 ? Math.abs(pool.power) * Math.pow(1 - d, 1.4) : 0;
}

/** What a lamp gives the pixel centred at (wx, wy): the sum over its pools. This is the light its shadow takes away. */
export function lampLight(lamp: CasterLamp, wx: number, wy: number): number {
    let sum = 0;
    for (let i = 0; i < lamp.pools.length; i++) sum += poolFalloff(lamp.pools[i], wx, wy);
    return sum;
}

/** The sixteen directions a lamp's shadow may take: slopes 0, 1:2, 1:1 and 2:1 in each quadrant. Unit vectors, y down. */
export const LAMP_DIRECTIONS: readonly (readonly [dx: number, dy: number])[] = (() => {
    const slopes: [number, number][] = [
        [1, 0],
        [2, 1],
        [1, 1],
        [1, 2],
    ];
    const out: [number, number][] = [];
    for (let q = 0; q < 4; q++) {
        for (const [a, b] of slopes) {
            // rotate (a, b) by q quarter turns
            let x = a;
            let y = b;
            for (let k = 0; k < q; k++) [x, y] = [-y, x];
            const len = Math.hypot(x, y);
            out.push([x / len, y / len]);
        }
    }
    return out;
})();

/** The index into `LAMP_DIRECTIONS` nearest the direction (dx, dy), which need not be unit. */
export function lampDirection(dx: number, dy: number): number {
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return 0;
    let best = 0;
    let bestDot = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < LAMP_DIRECTIONS.length; i++) {
        const direction = LAMP_DIRECTIONS[i];
        const dot = (direction[0] * dx + direction[1] * dy) / len;
        if (dot > bestDot) {
            bestDot = dot;
            best = i;
        }
    }
    return best;
}

/**
 * The shear of a lamp's shadow per px of height for a caster `distance` px from the point under a source `z` high (the
 * floor's distance: the squash of the 3/4 view already undone). A caster right under the lamp throws a short shadow, one far
 * from it a long one; the length is kept in 0.4 to 1.0 so that a shadow always shows and never lies down.
 */
export function lampShadowLength(distance: number, z: number): number {
    return Math.min(1, Math.max(0.4, distance / (1.25 * z)));
}
