import type { Light } from "./lights";
import type { Look } from "./timeOfDay";

/**
 * The lamps' uniforms as the camera pass reads them, written into the three scratch arrays (each 4 floats a light, the
 * pass takes 32): where it hangs and its reach (negative for a lamp that also glows), the colour with the power in w
 * (a screen's own light keeps at least 0.75 of its night), and the room that holds it in. The arrays are zeroed first.
 * Nothing is made, so a draw can call it.
 */
export function lightUniformsInto(
    lit: readonly Light[],
    look: Pick<Look, "lamps">,
    L: Float32Array,
    LC: Float32Array,
    LClip: Float32Array,
): void {
    L.fill(0);
    LC.fill(0);
    LClip.fill(0);
    for (let i = 0; i < lit.length; i++) {
        const l = lit[i];
        const o = i * 4;
        L[o] = l.x;
        L[o + 1] = l.y;
        L[o + 2] = l.halo ? -l.reach : l.reach;
        L[o + 3] = l.squash;
        LC[o] = l.color[0];
        LC[o + 1] = l.color[1];
        LC[o + 2] = l.color[2];
        LC[o + 3] = l.power * (l.self ? Math.max(look.lamps, 0.75) : look.lamps);
        if (l.clip) {
            LClip[o] = l.clip[0];
            LClip[o + 1] = l.clip[1];
            LClip[o + 2] = l.clip[2];
            LClip[o + 3] = l.clip[3];
        }
    }
}
