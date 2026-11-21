import { emoteArt } from "./emoteArt";

/**
 * The emotes of the office, in the order the menu shows them (the reference's order: the signals first, then the
 * feelings, then the small talk). An id is the identity of an emote: it picks the art, the label and the wire value,
 * so an id never changes meaning and never takes a letter outside `a-z0-9` (the wire spells it with tag characters
 * that stand for those letters only, see `emoteWire.ts`).
 */
export const emoteIds = [
    "exc",
    "que",
    "exc2",
    "omg",
    "lv",
    "lv2",
    "bh",
    "heh",
    "lol",
    "sob",
    "an",
    "ag",
    "swt",
    "swt2",
    "tnt",
    "sg",
    "ic",
    "dots",
    "ok",
    "x",
    "no1",
    "wow",
    "cash",
    "mus",
    "zz",
    "zzz",
] as const;

export type EmoteId = (typeof emoteIds)[number];

export interface CatalogueEmote {
    readonly id: EmoteId;
    /** A `data:image/png;base64,` URL of the 16x16 art. */
    readonly art: string;
}

export const emoteCatalogue: readonly CatalogueEmote[] = emoteIds.map((id) => ({ id, art: emoteArt[id] }));

const byId: ReadonlyMap<string, CatalogueEmote> = new Map(emoteCatalogue.map((emote) => [emote.id, emote]));

/** The emote with this id, or `undefined` for anything the catalogue does not hold. */
export function findCatalogueEmote(id: string): CatalogueEmote | undefined {
    return byId.get(id);
}
