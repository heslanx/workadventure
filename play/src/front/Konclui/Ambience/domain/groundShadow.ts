import type { Box, Rect } from "./geometry";
import type { PlacedImage } from "./lights";
import { specKey } from "./lights";

/**
 * What blocks light at floor level for the occlusion field: the footprint [x, y, w, h] in world px of every placed
 * image whose sprite stands on the floor (shadows: the manifest's footprints by sprite key).
 */
export function footprints(
    images: readonly PlacedImage[],
    shadows: Readonly<Partial<Record<string, Box | null>>>,
): Rect[] {
    const out: Rect[] = [];
    for (const image of images) {
        const key = specKey(image.key);
        const f = key === null ? undefined : shadows[key];
        if (f) out.push([image.x + f[0], image.y + f[1], f[2] - f[0], f[3] - f[1]]);
    }
    return out;
}
