// The key light of the shading: the sun by day, the moon at night, one direction for every object and person on the
// map, from the hour the effects already compute. A piecewise-linear table by hour, then the direction snapped to five
// slopes so that a shadow's edge is a clean pixel line, and the length to steps of 0.04 so the shadow bake runs about a
// dozen times a day, not every minute.

/** A key light as the bake and the uniforms read it. One record, rewritten by `keyLightAt`. */
export interface KeyLight {
    /** 0..4: the direction, from lower-left (0) to lower-right (4); 2 is straight down. */
    dirIndex: number;
    /** The unit vector a shadow points to: x right, y down. */
    dx: number;
    dy: number;
    /** The shadow's length over the object's height, in steps of `LENGTH_STEP`. */
    length: number;
    /** How dark the shadow is, 0..1. */
    strength: number;
    /** The key's weight in the props' relief, 0..1. */
    weight: number;
    /** 0 by day, 1 at night: which of the two shadow colours the ambient goes toward. */
    nightMix: number;
}

export const LENGTH_STEP = 0.04;

/** The slopes a shadow may have: 1:1 left, 1:2 left, straight, 1:2 right, 1:1 right. Unit vectors (x, y down). */
const SLOPE = Math.SQRT1_2;
const TWO = Math.sqrt(0.2);
export const KEY_DIRECTIONS: readonly (readonly [dx: number, dy: number])[] = [
    [-SLOPE, SLOPE],
    [-TWO, 2 * TWO],
    [0, 1],
    [TWO, 2 * TWO],
    [SLOPE, SLOPE],
];
const ANGLES = [-45, -26.565, 0, 26.565, 45];

/** hour, angle from straight down (degrees, + toward +x), shadow length over height, strength, relief weight, night mix */
type Row = readonly [hour: number, theta: number, length: number, strength: number, weight: number, night: number];

// Afternoon and golden-hour shadows fall lower-left as `look.shadow` already does; the morning mirrors to lower-right.
// The moon sits at the sunset direction, so nothing turns at dusk.
const TABLE: readonly Row[] = [
    [0, -45, 0.45, 0.45, 0.35, 1],
    [5.2, -45, 0.45, 0.45, 0.35, 1],
    [6.3, 45, 0.55, 0.5, 0.6, 0.5],
    [7.5, 33, 0.4, 0.6, 1, 0],
    [13, 0, 0.28, 0.6, 1, 0],
    [15.5, -20, 0.36, 0.6, 1, 0],
    [17.4, -45, 0.6, 0.62, 1, 0],
    [18.3, -45, 0.55, 0.55, 0.8, 0.4],
    [19.3, -45, 0.5, 0.5, 0.5, 0.8],
    [20.3, -45, 0.45, 0.45, 0.35, 1],
    [24, -45, 0.45, 0.45, 0.35, 1],
];

/**
 * The key at an hour (0..24, the hour the effects use; it is a parameter, never read from a clock), written into `out`.
 * Returns the state id: it changes only when the snapped direction or length does, or the night passes its half (the lamps' turn
 * to cast the shadows), which is when the bake must run again.
 */
export function keyLightAt(hour: number, out: KeyLight): number {
    const h = ((hour % 24) + 24) % 24;
    let i = 1;
    while (i < TABLE.length - 1 && TABLE[i][0] <= h) i += 1;
    const a = TABLE[i - 1];
    const b = TABLE[i];
    const t = b[0] > a[0] ? (h - a[0]) / (b[0] - a[0]) : 0;
    const lerp = (k: 1 | 2 | 3 | 4 | 5): number => a[k] + (b[k] - a[k]) * t;
    const theta = lerp(1);
    let nearest = 0;
    for (let k = 1; k < ANGLES.length; k++) {
        if (Math.abs(ANGLES[k] - theta) < Math.abs(ANGLES[nearest] - theta)) nearest = k;
    }
    const length = Math.round(lerp(2) / LENGTH_STEP) * LENGTH_STEP;
    out.dirIndex = nearest;
    out.dx = KEY_DIRECTIONS[nearest][0];
    out.dy = KEY_DIRECTIONS[nearest][1];
    out.length = Math.round(length * 100) / 100;
    out.strength = lerp(3);
    out.weight = lerp(4);
    out.nightMix = lerp(5);
    // the night's lamps take over a piece's shadow from NIGHT_LAMPS_FROM (shadeBake): the bake of the key redoes when that flips
    return nearest * 64 + Math.round(length / LENGTH_STEP) + (out.nightMix >= 0.5 ? 1024 : 0);
}

export function newKeyLight(): KeyLight {
    return { dirIndex: 2, dx: 0, dy: 1, length: 0.3, strength: 0, weight: 0, nightMix: 0 };
}
