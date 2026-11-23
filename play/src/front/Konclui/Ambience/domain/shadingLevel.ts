// Which shading a room runs: the flag, the machine and the view decide. Pure: the page's facts are arguments.

/** The values of `konclui.fx.rim`: "0" or unset off, "1" the shading at the picked level, a forced level, the old rim. */
export type ShadingFlag = "off" | "auto" | "full" | "reduced" | "legacy";

/**
 * 0 off (the legacy program, or the shaded one with the shading switched off), 1 reduced, 2 full.
 * Reduced is one texture tap on a pixel where full is two: the cast (contact bands, the key's and the lamps' shadows, the
 * shadows of what is on furniture and on a wall) and a flat tone on the people, but no relief on the props (the normals are not
 * read) and no lamp pull or cylinder scan on the people. It is also fewer marked avatars (fewer batch breaks).
 */
export type ShadingLevel = 0 | 1 | 2;

export function parseShadingFlag(value: string | null | undefined): ShadingFlag {
    switch (value) {
        case "1":
            return "auto";
        case "full":
        case "reduced":
        case "legacy":
            return value;
        default:
            return "off";
    }
}

/** What the picker needs to know of the machine and the view. */
export interface ShadingFacts {
    /** The unmasked WebGL renderer string, or "" when the browser hides it. */
    readonly renderer: string;
    readonly maxFragmentUniformVectors: number;
    readonly zoom: number;
    /** The picture's size in device px: width x height of the canvas. */
    readonly viewPixels: number;
}

/** GPUs that cannot afford the full pass: software renderers and the weak integrated and mobile parts. */
export const WEAK_GPU =
    /SwiftShader|llvmpipe|Microsoft Basic|Mali-|Adreno \(TM\) [1-4]\d\d|PowerVR|Intel\(R\) HD Graphics|Intel.*(HD|UHD) Graphics [2-6]\d{2,3}\b/i;

export const MIN_FULL_VECTORS = 221;
export const MIN_FULL_ZOOM = 0.6;
export const MAX_FULL_PIXELS = 2_500_000;

/** Whether a flag asks for the new shading at all. */
export function shadingWanted(flag: ShadingFlag): boolean {
    return flag === "auto" || flag === "full" || flag === "reduced";
}

/**
 * The level the flag and the facts give. It starts at 2 and falls to 1 on a weak GPU, a GPU that gives a fragment
 * shader fewer than 221 uniform vectors, a camera zoomed out below 0.6 or a picture over 2.5 Mpx. A forced flag wins.
 */
export function pickShadingLevel(flag: ShadingFlag, facts: ShadingFacts): ShadingLevel {
    if (!shadingWanted(flag)) return 0;
    if (flag === "full") return 2;
    if (flag === "reduced") return 1;
    if (
        WEAK_GPU.test(facts.renderer) ||
        facts.maxFragmentUniformVectors < MIN_FULL_VECTORS ||
        facts.zoom < MIN_FULL_ZOOM ||
        facts.viewPixels > MAX_FULL_PIXELS
    ) {
        return 1;
    }
    return 2;
}
