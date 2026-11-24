// The order of the water and the tile layer under it. The water shader repaints the pool's open water opaque (it writes alpha 1
// over every pixel of the water mask), so whatever the "decor" tile layer holds over the pool is hidden when the shader is
// above that layer: the painted glints and ripple frames (tiles i6..i145 of Konclui_Decor, 75 of 80 placed over the pool lie
// wholly under the mask) never showed. By day they are drawn over the shader. At night the shader has no glitter, stars or
// caustics of its own (they are the sun's) and the painted ones are fixed near-white pixels that would sparkle on the lit
// water: the shader is above the layer again and hides them.

/** The sun the water shader calls day: its `sunny` is `uSun > WATER_SUNNY_ABOVE`, where uSun is the larger of sun and clouds. */
export const WATER_SUNNY_ABOVE = 0.3;
/** Half the dead band around that level: the order flips on a rise past the level plus this and a fall under it minus this. */
export const SUNNY_BAND = 0.02;

/** The sun the shader is given. */
export function waterSun(sun: number, clouds: number): number {
    return Math.max(sun, clouds);
}

/**
 * Whether the painted glints and ripples of the decor layer show over the water, given whether they did and the light now.
 * A band round the shader's own level keeps the order from flipping back and forth while the sun sits on it.
 */
export function paintedFramesShow(was: boolean, sun: number, clouds: number): boolean {
    const level = waterSun(sun, clouds);
    return was ? level > WATER_SUNNY_ABOVE - SUNNY_BAND : level > WATER_SUNNY_ABOVE + SUNNY_BAND;
}

/**
 * Puts `water` next to `decor` in the display list: right before it when the painted frames show (the layer is drawn over the
 * water), right after it when they do not. Both have the same depth, so the list's order decides; everything else keeps its
 * place. Returns whether the list changed.
 */
export function orderWater(list: unknown[], water: unknown, decor: unknown, framesShow: boolean): boolean {
    const decorAt = list.indexOf(decor);
    const waterAt = list.indexOf(water);
    if (decorAt < 0 || waterAt < 0) return false;
    if (framesShow ? waterAt === decorAt - 1 : waterAt === decorAt + 1) return false;
    list.splice(waterAt, 1);
    const at = list.indexOf(decor);
    list.splice(framesShow ? at : at + 1, 0, water);
    return true;
}
