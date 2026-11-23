import type { KeyLight } from "./keyLight";

/** How hard the contact band under every object bites the floor, 0..1. */
export const CONTACT_STRENGTH = 0.42;
/** How much of the light on a person's side shows on them. */
export const PERSON_LIGHT = 0.9;
/** The ambient's colour inside a key shadow, by day and at night: the navy the shade pulls toward. */
const KEY_SHADE_DAY = [0.5, 0.58, 0.8] as const;
const KEY_SHADE_NIGHT = [0.36, 0.4, 0.66] as const;

/** Where the shading's uniforms are written: three arrays made once, rewritten on each draw. */
export interface ShadeUniforms {
    shade: number[];
    key: number[];
    keyShade: number[];
}

export function newShadeUniforms(): ShadeUniforms {
    return { shade: [0, 0, 0, 0], key: [0, 1, 1, 0], keyShade: [1, 1, 1] };
}

/**
 * `uShade`, `uKey` and `uKeyShade` for a level (0 off, 1 reduced, 2 full). Allocation-free: it writes into `out`.
 * The key's z is how high the light stands (a short shadow is a high light), kept between 1 and 1.6 so a face turned
 * from the light never goes fully flat.
 */
export function shadeUniformsInto(out: ShadeUniforms, key: KeyLight, level: 0 | 1 | 2): void {
    const s = out.shade;
    s[0] = level;
    s[1] = level > 0 ? CONTACT_STRENGTH : 0;
    s[2] = level > 0 ? key.strength : 0;
    s[3] = level > 1 ? PERSON_LIGHT : 0;
    const k = out.key;
    k[0] = key.dx;
    k[1] = key.dy;
    k[2] = Math.min(1.6, Math.max(1, 0.6 / key.length));
    k[3] = key.weight;
    const m = key.nightMix;
    const c = out.keyShade;
    for (let i = 0; i < 3; i++) c[i] = KEY_SHADE_DAY[i] + (KEY_SHADE_NIGHT[i] - KEY_SHADE_DAY[i]) * m;
}
