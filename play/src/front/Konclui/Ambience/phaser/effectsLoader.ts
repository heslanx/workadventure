import { asError } from "catch-unknown";
import { effectsManifestSchema, type EffectTexture, type EffectsManifest } from "../domain/effectsManifest";

/** A map folder's fx/: its manifest and its pictures. */
export interface EffectsData {
    readonly manifest: EffectsManifest;
    readonly images: Readonly<Record<EffectTexture, HTMLImageElement>>;
    /** Optional silhouette-aware 2.5D normal map (`fx/normal.png`, OpenGL RGB + opaque-entity Alpha). */
    readonly normal?: HTMLImageElement;
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`could not load ${url}`));
        img.src = url;
    });
}

/**
 * The normal map, asked for only when the manifest lists it and the caller wants it. A picture that fails, or is not the
 * map's size (its pixels are looked up by the map's coordinates), is reported and left out: the room keeps the flat
 * look it had without it.
 */
async function loadNormal(url: string, map: readonly [number, number]): Promise<HTMLImageElement | undefined> {
    try {
        const image = await loadImage(url);
        if (image.width !== map[0] || image.height !== map[1]) {
            console.warn(
                `[konclui] fx normal.png is ${image.width}x${image.height}, not the map's ${map[0]}x${map[1]}; ignored`,
            );
            return undefined;
        }
        return image;
    } catch (error: unknown) {
        console.warn("[konclui] fx normal.png not loaded; flat normals:", asError(error));
        return undefined;
    }
}

export interface LoadOptions {
    /** Whether to fetch `normal.png` when the manifest lists it. Off by default: nothing draws with it until asked. */
    readonly normal?: boolean;
}

/**
 * Loads fx/ beside the map file. Resolves `undefined` for a room without effects (a 404 for fx/manifest.json) and, with
 * a warning, when the folder cannot be read: any other status, a manifest that does not parse, a picture that fails.
 */
export async function loadEffectsData(mapUrl: string, options: LoadOptions = {}): Promise<EffectsData | undefined> {
    const base = new URL("fx/", mapUrl).href;
    try {
        const response = await fetch(`${base}manifest.json`, { cache: "no-cache" });
        if (response.status === 404) return undefined;
        if (!response.ok) {
            console.warn("[konclui] fx not loaded:", response.status, base);
            return undefined;
        }
        const manifest = effectsManifestSchema.parse(await response.json());
        const picture = (name: EffectTexture): Promise<HTMLImageElement> => loadImage(`${base}${name}.png`);
        const [water, waterData, glass, masks, tvSlide, occluders, normal] = await Promise.all([
            picture("water"),
            picture("water-data"),
            picture("glass"),
            picture("masks"),
            picture("tv-slide"),
            picture("occluders"),
            manifest.normal === true && options.normal === true
                ? loadNormal(`${base}normal.png`, manifest.map)
                : Promise.resolve(undefined),
        ]);
        const images: Record<EffectTexture, HTMLImageElement> = {
            water,
            "water-data": waterData,
            glass,
            masks,
            "tv-slide": tvSlide,
            occluders,
        };
        return { manifest, images, normal };
    } catch (error: unknown) {
        console.warn("[konclui] fx not loaded:", asError(error));
        return undefined;
    }
}
