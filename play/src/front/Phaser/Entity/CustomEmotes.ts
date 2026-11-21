/**
 * Custom emotes: pictures an extension adds to the emotes a character draws over its head.
 *
 * The engine knows nothing of the wire format or of the art. An extension registers a provider that says which
 * emote message stands for which picture, and `Character.playEmote` asks it first. With no provider registered, and
 * for every message the provider does not recognise, the emote is the emoji text it has always been.
 *
 * The art of an emote is decoded once into one texture of the game's texture manager, found again by the key of the
 * emote, so a hundred plays by a hundred characters create one texture. Drawing one is a small DOM image, as the
 * emoji text is a DOM span: it lives in the same layer, above the map, and carries a name for assistive technology.
 */

/** A picture an emote message stands for. */
export interface CustomEmote {
    /** Identifies the art: two emotes with one id share one texture. */
    readonly id: string;
    /** The art, a `data:image/png;base64,` URL. Only such a URL is ever loaded, never one a player sent. */
    readonly src: string;
    /** The name of the picture drawn over the character called `playerName`: who reacted, and with what. */
    accessibleName(playerName: string): string;
}

export interface CustomEmoteProvider {
    /** The custom emote this emote message stands for, or `undefined` when it is a plain emoji. */
    resolve(emote: string): CustomEmote | undefined;
}

/** What the loader needs of the game's texture manager. */
export interface CustomEmoteTextures {
    exists(key: string): boolean;
    addImage(key: string, source: HTMLImageElement): unknown;
}

/** Turns the art into a decoded image. It is a parameter so that a test can stand in for the browser. */
export type DecodeImage = (src: string) => Promise<HTMLImageElement>;

const DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

/** The size the art is drawn at: the 16 pixel pictures twice, so every pixel stays a whole square. */
const EMOTE_SIZE_PX = 32;

let provider: CustomEmoteProvider | undefined;

// The ids whose bad art was reported, so a broken catalogue says so once and not on every play.
const reportedBadArt = new Set<string>();

/**
 * Registers the provider. A later registration replaces the earlier one. Returns the function that unregisters it,
 * which does nothing when a later provider has taken its place or when it is called again.
 */
export function registerCustomEmoteProvider(next: CustomEmoteProvider): () => void {
    provider = next;
    return () => {
        if (provider === next) provider = undefined;
    };
}

/**
 * The custom emote an emote message stands for, or `undefined`: nothing is registered, the message is an emoji, or the
 * art the provider gave is not a PNG data URL (which is reported, and the message then shows as the text it is).
 */
export function findCustomEmote(emote: string): CustomEmote | undefined {
    const found = provider?.resolve(emote);
    if (found === undefined) return undefined;
    if (!DATA_URL.test(found.src)) {
        if (!reportedBadArt.has(found.id)) {
            reportedBadArt.add(found.id);
            console.error(`The custom emote "${found.id}" has art that is not a PNG data URL, so it is shown as text`);
        }
        return undefined;
    }
    return found;
}

export const customEmoteTextureKey = (id: string): string => `custom-emote-${id}`;

// Loads that have started and not finished, by texture manager and key, so two characters that play one emote for
// the first time at once decode the art once. A weak key lets a manager go with its game.
const loading = new WeakMap<object, Map<string, Promise<void>>>();

function decodePng(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("The custom emote art could not be decoded"));
        image.src = src;
    });
}

async function ensureTexture(textures: CustomEmoteTextures, emote: CustomEmote, decode: DecodeImage): Promise<void> {
    const key = customEmoteTextureKey(emote.id);
    if (textures.exists(key)) return;
    let pending = loading.get(textures);
    if (pending === undefined) {
        pending = new Map();
        loading.set(textures, pending);
    }
    let load = pending.get(key);
    if (load === undefined) {
        const started = pending;
        load = decode(emote.src)
            .then((image) => {
                // Something else may have added the key while the art decoded: adding it again is an error.
                if (!textures.exists(key)) textures.addImage(key, image);
            })
            .finally(() => started.delete(key));
        pending.set(key, load);
    }
    await load;
}

/**
 * The element that draws `emote` over the character called `playerName`, ready to be put in a DOM element of the
 * scene. It resolves once the art is a texture, which is at once for every play after the first. It rejects when the
 * art cannot be decoded; the caller then shows the emoji text instead.
 */
export async function loadCustomEmoteElement(
    textures: CustomEmoteTextures,
    emote: CustomEmote,
    playerName: string,
    decode: DecodeImage = decodePng,
): Promise<HTMLElement> {
    await ensureTexture(textures, emote, decode);
    const picture = document.createElement("img");
    picture.src = emote.src;
    picture.alt = emote.accessibleName(playerName);
    picture.width = EMOTE_SIZE_PX;
    picture.height = EMOTE_SIZE_PX;
    picture.draggable = false;
    picture.style.cssText = `display:block;width:${EMOTE_SIZE_PX}px;height:${EMOTE_SIZE_PX}px;image-rendering:pixelated;`;
    return picture;
}
