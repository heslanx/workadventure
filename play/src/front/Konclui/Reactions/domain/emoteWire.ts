import type { CatalogueEmote } from "./emoteCatalogue";
import { findCatalogueEmote } from "./emoteCatalogue";

/**
 * How an emote of the catalogue travels in the emote message WorkAdventure already has.
 *
 * The server relays an emote only when it is made of emoji characters and is at most 32 UTF-16 units long
 * (`back/src/Services/EmoteValidator.ts`), so a text such as `:k-lv:` never reaches another player. An emote is sent
 * as the speech balloon, then `k` and its id spelled in Unicode tag characters (U+E0020 to U+E007E, which are emoji
 * components and draw nothing), then the cancel tag. A client that knows no custom emote shows the speech balloon,
 * which is a sensible emoji; one that does decodes the id and draws the art.
 */

const SPEECH_BALLOON = "\u{1F4AC}";
const TAG_OFFSET = 0xe0000;
const CANCEL_TAG = "\u{E007F}";

const WIRE_PATTERN = /^\u{1F4AC}([\u{E0020}-\u{E007E}]+)\u{E007F}$/u;
const NAME_PATTERN = /^k([a-z0-9]+)$/;

/** The wire value of an emote id. The id must be of letters a-z and digits, which the catalogue guarantees. */
export function encodeEmoteWire(id: string): string {
    if (!/^[a-z0-9]+$/.test(id)) {
        throw new Error(`An emote id is made of a-z and 0-9 only, got "${id}"`);
    }
    const tags = Array.from(`k${id}`, (letter) => String.fromCodePoint(TAG_OFFSET + letter.charCodeAt(0))).join("");
    return SPEECH_BALLOON + tags + CANCEL_TAG;
}

/**
 * The id inside a wire value, or `undefined` when the text is not one: a plain emoji, a flag drawn with tag
 * characters, or a value that has something before, after or between the parts. Whether the catalogue holds the id is
 * `resolveEmoteWire`'s question.
 */
export function decodeEmoteWire(wire: string): string | undefined {
    const tags = WIRE_PATTERN.exec(wire)?.[1];
    if (tags === undefined) return undefined;
    const name = Array.from(tags, (tag) => String.fromCharCode((tag.codePointAt(0) ?? 0) - TAG_OFFSET)).join("");
    return NAME_PATTERN.exec(name)?.[1];
}

/** The catalogue emote a received emote message stands for, or `undefined` when it is an emoji or an unknown id. */
export function resolveEmoteWire(wire: string): CatalogueEmote | undefined {
    const id = decodeEmoteWire(wire);
    return id === undefined ? undefined : findCatalogueEmote(id);
}
