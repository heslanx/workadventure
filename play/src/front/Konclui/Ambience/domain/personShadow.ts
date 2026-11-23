// The shadow under a person: a pooled stamp, built from the feet and never from the walk frame (a simple, fixed
// caster for a picture that animates). An atlas of 16 directions by 4 lengths of 40 x 40 frames, each a contact blob at
// the feet and a tail along the direction in two steps; the stamp is picked by the strongest lamp at the feet, else the
// key light, and kept until the answer moves clearly away from it so that a step across a pool does not flicker.
import { lampDirection, LAMP_DIRECTIONS, lampShadowLength } from "./lamps";
import type { KeyLight } from "./keyLight";
import type { Light } from "./lights";

export const STAMP_SIZE = 40;
export const STAMP_DIRECTIONS = 16;
/**
 * The tail's length in px for each of the four length classes, from the edge of the foot oval. Class 0 has none: a person
 * right under a lamp has the light overhead, so the shadow is a plain oval under the feet (a tail there read as a signpost:
 * a bar with a stem). The others are 7, 12 and 16 px: with the 12 px oval the stamp reaches 14 to 22 px from the feet.
 */
export const STAMP_TAILS: readonly number[] = [0, 7, 12, 16];
/** A person nearer than this to the spot under a lamp (the floor's distance) has no tail. */
export const OVERHEAD_PX = 14;
/** The tail's width in px where it leaves the oval and at its end: a body's shadow, not a scratch (checked by `stampWidths`). */
export const TAIL_WIDTH_NEAR = 8;
export const TAIL_WIDTH_FAR = 5;
/**
 * How tall a person is, for the length of their shadow (the key's length is over a height): the real avatars are 31 px tall at
 * the median, 21 across the body and 10 across the feet (480 frames of the Female and Male sheets of
 * play/public/resources/characters/pipoya, measured on 2026-11-23); the lab's capsule is 14 x 26.
 */
export const BODY_HEIGHT = 30;
export const STAMP_CLASSES = STAMP_TAILS.length;
/** The atlas, in px: one column for each direction and one row for each length class. */
export const STAMP_ATLAS_WIDTH = STAMP_SIZE * STAMP_DIRECTIONS;
export const STAMP_ATLAS_HEIGHT = STAMP_SIZE * STAMP_CLASSES;
/** The colour of every stamp (10, 10, 61), the navy the ground's veil uses. */
export const STAMP_COLOUR: readonly [number, number, number] = [10, 10, 61];
/** The tail beyond its half is drawn at this share of the alpha. */
const TAIL_FAR_ALPHA = 0.55;
/**
 * A lamp counts for a person's shadow from this much light (the lamp's falloff, times the night): the outer ring of a pool
 * counts, as it does for the shader's light on the person and for the props' own shadows (they give way to a lamp's from
 * the same 0.05), so a person beside a lamp is lit from it and casts away from it.
 */
export const LAMP_PICK_LIGHT = 0.05;
/** A lamp's own light adds this to a stamp's alpha inside a pool, so a person's veil matches a prop's carved shadow. */
export const LAMP_ALPHA = 0.18;
const KEEP_COS = Math.cos((15 * Math.PI) / 180);
const KEEP_PX = 2.4;
const MAX_TAIL = STAMP_TAILS[STAMP_CLASSES - 1];

/** Frame names in the atlas texture: `d<direction>-<class>`. */
export function stampFrameName(direction: number, lengthClass: number): string {
    return FRAME_NAMES[lengthClass * STAMP_DIRECTIONS + direction];
}

// Made once: a name built with a template on each call is a string for every person on every draw.
const FRAME_NAMES: readonly string[] = Array.from(
    { length: STAMP_DIRECTIONS * STAMP_CLASSES },
    (_, i) => `d${i % STAMP_DIRECTIONS}-${Math.floor(i / STAMP_DIRECTIONS)}`,
);

/** Where a frame sits in the atlas. */
export function stampFrameAt(direction: number, lengthClass: number): readonly [x: number, y: number] {
    return [direction * STAMP_SIZE, lengthClass * STAMP_SIZE];
}

/** Whether the pixel at (px, py), measured from the feet, is in the stamp for a direction and a tail length: 0, 1 or the far share. */
function stampAlpha(dx: number, dy: number, tail: number, px: number, py: number): number {
    // the oval under the feet
    if ((px / 6) * (px / 6) + (py / 2.5) * (py / 2.5) <= 1) return 1;
    if (tail === 0) return 0;
    // the tail: along the direction from the oval's edge, `s` px out, `q` px off its axis; it narrows from 8 px to 5
    const s = px * dx + py * dy;
    const q = Math.abs(-px * dy + py * dx);
    const into = s - 2;
    if (into < 0 || into > tail) return 0;
    const half = (TAIL_WIDTH_NEAR - (TAIL_WIDTH_NEAR - TAIL_WIDTH_FAR) * (into / tail)) / 2;
    if (q > half) return 0;
    return into <= tail / 2 ? 1 : TAIL_FAR_ALPHA;
}

/**
 * The atlas pixels, RGBA, pixel by pixel (nearest: whole pixels at any zoom). Each frame is centred on the feet at
 * (20, 20): a 12 x 5 oval, and a tail of 8 px narrowing to 5 along the direction (none in class 0), the near half at full
 * alpha and the far half at 55%: a stepped, elongated oval, the same two bands as an object's shadow. The result is the
 * same on every call.
 */
export function personShadowFrames(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(STAMP_ATLAS_WIDTH * STAMP_ATLAS_HEIGHT * 4);
    const centre = STAMP_SIZE / 2;
    for (let cls = 0; cls < STAMP_CLASSES; cls++) {
        const tail = STAMP_TAILS[cls];
        for (let dir = 0; dir < STAMP_DIRECTIONS; dir++) {
            const [dx, dy] = LAMP_DIRECTIONS[dir];
            const [ox, oy] = stampFrameAt(dir, cls);
            for (let y = 0; y < STAMP_SIZE; y++) {
                for (let x = 0; x < STAMP_SIZE; x++) {
                    const alpha = stampAlpha(dx, dy, tail, x + 0.5 - centre, y + 0.5 - centre);
                    const i = ((oy + y) * STAMP_ATLAS_WIDTH + ox + x) * 4;
                    data[i] = STAMP_COLOUR[0];
                    data[i + 1] = STAMP_COLOUR[1];
                    data[i + 2] = STAMP_COLOUR[2];
                    data[i + 3] = Math.round(alpha * 255);
                }
            }
        }
    }
    return data;
}

/**
 * How wide a stamp is, in px across its axis, measured on the pixels of the atlas: the tail's mean width (over its first
 * three quarters; a diagonal axis counts pixels per step with up to a pixel of noise, so a mean, not a minimum) and the oval's widest. A stamp under 5 px across reads as a scratch beside the feet; the lab and the
 * tests hold the tail to `TAIL_WIDTH_FAR`.
 */
export function stampWidths(
    atlas: Uint8ClampedArray,
    direction: number,
    lengthClass: number,
): { tail: number; oval: number } {
    const [dx, dy] = LAMP_DIRECTIONS[direction];
    const [ox, oy] = stampFrameAt(direction, lengthClass);
    const centre = STAMP_SIZE / 2;
    const tail = STAMP_TAILS[lengthClass];
    const across = new Map<number, number>();
    let oval = 0;
    for (let y = 0; y < STAMP_SIZE; y++) {
        for (let x = 0; x < STAMP_SIZE; x++) {
            if (atlas[((oy + y) * STAMP_ATLAS_WIDTH + ox + x) * 4 + 3] === 0) continue;
            const px = x + 0.5 - centre;
            const py = y + 0.5 - centre;
            const s = px * dx + py * dy;
            // count the pixels at each whole step along the axis: the width of the shape there
            const step = Math.round(s);
            across.set(step, (across.get(step) ?? 0) + 1);
        }
    }
    for (const [step, n] of across) if (Math.abs(step) <= 3) oval = Math.max(oval, n);
    let sum = 0;
    let steps = 0;
    if (tail > 0) {
        for (let step = 4; step <= 2 + Math.floor(tail * 0.75); step++) {
            sum += across.get(step) ?? 0;
            steps += 1;
        }
    }
    return { tail: steps > 0 ? sum / steps : 0, oval };
}

/** A person as the stamp is picked for them: their feet and the shadow kept for them. */
export interface ShadowedPerson {
    readonly x: number;
    readonly y: number;
    readonly shadow: PersonShadow;
}

/** The light a person stands in: the lights drawn now, the night's strength (0 by day) and the key. */
export interface ShadowLight {
    readonly pools: readonly Light[];
    readonly lamps: number;
    readonly key: KeyLight;
}

/** A person's shadow as it stands: the picked frame and the alpha to draw it at. One record each, rewritten in place. */
export interface PersonShadow {
    direction: number;
    lengthClass: number;
    alpha: number;
    /** Whether a first pick was made: the first one is taken as it comes, with no hysteresis. */
    picked: boolean;
    // what the last pick was made for: the same feet in the same light give the same answer, so a person who stands
    // still costs nothing
    atX: number;
    atY: number;
    atLamps: number;
    atKey: number;
    atPools: readonly Light[] | undefined;
}

export function newPersonShadow(): PersonShadow {
    return {
        direction: 0,
        lengthClass: 0,
        alpha: 0,
        picked: false,
        atX: Number.NaN,
        atY: Number.NaN,
        atLamps: Number.NaN,
        atKey: Number.NaN,
        atPools: undefined,
    };
}

function classOf(tail: number): number {
    let best = 0;
    for (let i = 1; i < STAMP_CLASSES; i++)
        if (Math.abs(STAMP_TAILS[i] - tail) < Math.abs(STAMP_TAILS[best] - tail)) best = i;
    return best;
}

/**
 * Picks the stamp for a person standing at (x, y): the strongest lamp whose light there is at least 0.15 (the pool's
 * falloff times `lamps`, the night's strength) throws the shadow away from it; failing that the key does. The direction
 * and the length class stay as they were unless the new answer is more than ~15 degrees or 2.4 px away from the
 * stamp's own, so a person's shadow does not flicker at the edge of a choice. Writes into `out`; allocates nothing.
 * `pools` are the lights drawn now (`lamps` 0 by day: no lamp counts).
 */
export function pickStamp(person: ShadowedPerson, light: ShadowLight): void {
    // The arguments are objects, not numbers: a call with a double argument makes a heap number for it when the callee
    // is not inlined, for every person on every draw.
    const out = person.shadow;
    const x = person.x;
    const y = person.y;
    const pools = light.pools;
    const lamps = light.lamps;
    const key = light.key;
    const keyStrength = key.strength;
    // the key as a number: its direction, length and strength are what a pick reads of it
    const keyState = key.dirIndex * 1e6 + key.length * 1e3 + keyStrength;
    if (out.atX === x && out.atY === y && out.atLamps === lamps && out.atKey === keyState && out.atPools === pools)
        return;
    out.atX = x;
    out.atY = y;
    out.atLamps = lamps;
    out.atKey = keyState;
    out.atPools = pools;
    // The pool falloff is worked out in the loop, in plain numbers (not through `poolFalloff`, and `sqrt` for `hypot`):
    // a call that returns a double, and `hypot` itself, make a heap number each, and this runs for every person on
    // every draw.
    let best = 0;
    let bx = 0;
    let by = 0;
    let bs = 1;
    if (lamps > 0) {
        for (let i = 0; i < pools.length; i++) {
            const pool = pools[i];
            if (pool.kind !== "arc" && pool.kind !== "floor" && pool.kind !== "desk") continue;
            const clip = pool.clip;
            if (clip && !(x >= clip[0] && y >= clip[1] && x < clip[0] + clip[2] && y < clip[1] + clip[3])) continue;
            const ex = x - pool.x;
            const ey = (y - pool.y) / pool.squash;
            const d = Math.sqrt(ex * ex + ey * ey) / Math.abs(pool.reach);
            if (d >= 1) continue;
            const light = Math.abs(pool.power) * Math.pow(1 - d, 1.4) * lamps;
            if (light > best) {
                best = light;
                bx = pool.x;
                by = pool.y;
                bs = pool.squash;
            }
        }
    }
    let dx = key.dx;
    let dy = key.dy;
    let tail = Math.min(MAX_TAIL, BODY_HEIGHT * key.length);
    let lampLight = 0;
    if (best >= LAMP_PICK_LIGHT) {
        dx = x - bx;
        dy = y - by;
        // the floor's distance from the spot under the lamp: the squash of the 3/4 view undone
        const ground = Math.sqrt(dx * dx + (dy / bs) * (dy / bs));
        tail = ground < OVERHEAD_PX ? 0 : Math.min(MAX_TAIL, BODY_HEIGHT * lampShadowLength(ground, 42));
        lampLight = Math.min(1, best);
    }
    const wanted = dx === 0 && dy === 0 ? 0 : lampDirection(dx, dy);
    const wantedClass = classOf(tail);
    if (!out.picked) {
        out.direction = wanted;
        out.lengthClass = wantedClass;
        out.picked = true;
    } else {
        if (wanted !== out.direction) {
            // the angle between the stamp's direction and the wanted one: a dot product under cos(15 degrees) of unit vectors
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const current = LAMP_DIRECTIONS[out.direction];
            if ((current[0] * dx + current[1] * dy) / len < KEEP_COS) out.direction = wanted;
        }
        if (wantedClass !== out.lengthClass && Math.abs(tail - STAMP_TAILS[out.lengthClass]) > KEEP_PX) {
            out.lengthClass = wantedClass;
        }
    }
    out.alpha = Math.min(1, keyStrength + LAMP_ALPHA * lampLight);
}

/**
 * `pickStamp` with the plan's argument list (the shader lab and the tests call it so): it makes two small objects, so
 * the scene's frame uses `pickStamp`, which makes nothing.
 */
export function pickPersonShadow(
    out: PersonShadow,
    x: number,
    y: number,
    pools: readonly Light[],
    lamps: number,
    key: KeyLight,
    keyStrength: number,
): void {
    pickStamp({ x, y, shadow: out }, { pools, lamps, key: { ...key, strength: keyStrength } });
}
