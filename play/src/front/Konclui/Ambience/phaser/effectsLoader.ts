import { asError } from "catch-unknown";
import { effectsManifestSchema, type EffectTexture, type EffectsManifest } from "../domain/effectsManifest";

/** A map folder's fx/: its manifest and its pictures. */
export interface EffectsData {
    readonly manifest: EffectsManifest;
    readonly images: Readonly<Record<EffectTexture, HTMLImageElement>>;
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
 * Loads fx/ beside the map file. Resolves `undefined` for a room without effects (a 404 for fx/manifest.json) and, with
 * a warning, when the folder cannot be read: any other status, a manifest that does not parse, a picture that fails.
 */
export async function loadEffectsData(mapUrl: string): Promise<EffectsData | undefined> {
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
        const [water, waterData, glass, masks, tvSlide, occluders] = await Promise.all([
            picture("water"),
            picture("water-data"),
            picture("glass"),
            picture("masks"),
            picture("tv-slide"),
            picture("occluders"),
        ]);
        const images: Record<EffectTexture, HTMLImageElement> = {
            water,
            "water-data": waterData,
            glass,
            masks,
            "tv-slide": tvSlide,
            occluders,
        };
        return { manifest, images };
    } catch (error: unknown) {
        console.warn("[konclui] fx not loaded:", asError(error));
        return undefined;
    }
}
