import { describe, expect, it } from "vitest";
import { emoteCatalogue, emoteIds, findCatalogueEmote } from "./emoteCatalogue";
import { emoteArt } from "./emoteArt";

describe("the emote catalogue", () => {
    it("holds the 26 emotes of the reference, in its order", () => {
        expect(emoteCatalogue.map((emote) => emote.id)).toEqual([
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
        ]);
    });

    it("names an emote by an id of a-z and 0-9, short enough for the 32 units of the wire", () => {
        for (const id of emoteIds) {
            // Speech balloon (2) + one tag per letter of k and the id (2 each) + the cancel tag (2).
            expect(id).toMatch(/^[a-z0-9]{1,12}$/);
        }
        expect(new Set(emoteIds).size).toBe(emoteIds.length);
    });

    it("gives every emote a PNG of its own, with the PNG signature, 16 pixels wide and tall", () => {
        const pictures = new Set<string>();
        for (const { id, art } of emoteCatalogue) {
            const base64 = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(art)?.[1];
            expect(base64, id).toBeDefined();
            const bytes = Buffer.from(base64 ?? "", "base64");
            // 8-byte signature, then the IHDR chunk: width and height are the 4 bytes each at offsets 16 and 20.
            expect(bytes.subarray(0, 8).toString("hex"), id).toBe("89504e470d0a1a0a");
            expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], id).toEqual([16, 16]);
            pictures.add(art);
        }
        expect(pictures.size).toBe(26);
    });

    it("keeps the catalogue and the art module on the same ids", () => {
        expect(Object.keys(emoteArt).sort()).toEqual([...emoteIds].sort());
    });

    it("finds an emote by its id and nothing for an id it does not hold", () => {
        expect(findCatalogueEmote("lv")?.art).toBe(emoteArt.lv);
        expect(findCatalogueEmote("nope")).toBeUndefined();
        expect(findCatalogueEmote("constructor")).toBeUndefined();
    });
});
