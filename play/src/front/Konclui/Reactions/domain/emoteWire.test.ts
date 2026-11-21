import { describe, expect, it } from "vitest";
import { emoteCatalogue, emoteIds } from "./emoteCatalogue";
import { decodeEmoteWire, encodeEmoteWire, resolveEmoteWire } from "./emoteWire";

// The rule of the server, copied from `back/src/Services/EmoteValidator.ts`: it relays an emote only when every
// character is an emoji or an emoji component and the text is at most 32 UTF-16 units. A copy, because the play
// package does not import the back; the first test of each group is what keeps a wire value inside it.
const SERVER_EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component})+$/u;
const SERVER_MAX_LENGTH = 32;

const SPEECH_BALLOON = "\u{1F4AC}";

describe("encodeEmoteWire", () => {
    it("spells the speech balloon, then k and the id in tag characters, then the cancel tag", () => {
        // k = U+E006B, l = U+E006C, v = U+E0076: the tag character of a letter is U+E0000 plus the letter's code.
        expect(encodeEmoteWire("lv")).toBe("\u{1F4AC}\u{E006B}\u{E006C}\u{E0076}\u{E007F}");
        expect(encodeEmoteWire("no1")).toBe("\u{1F4AC}\u{E006B}\u{E006E}\u{E006F}\u{E0031}\u{E007F}");
    });

    it.each(emoteIds)("gives %s a value the server relays", (id) => {
        const wire = encodeEmoteWire(id);

        expect(SERVER_EMOJI_ONLY.test(wire)).toBe(true);
        expect(wire.length).toBeLessThanOrEqual(SERVER_MAX_LENGTH);
    });

    it("shows a client that knows no custom emote the speech balloon and nothing else", () => {
        for (const { id } of emoteCatalogue) {
            // Tag characters and the cancel tag are invisible: the balloon is all a plain client draws.
            expect(encodeEmoteWire(id).replace(/[\u{E0000}-\u{E007F}]/gu, "")).toBe(SPEECH_BALLOON);
        }
    });

    it.each(["", "Lv", "lv-2", "a b", "é", ":k-lv:"])("refuses the id %j, which the wire cannot spell", (id) => {
        expect(() => encodeEmoteWire(id)).toThrow("a-z and 0-9");
    });
});

describe("decodeEmoteWire", () => {
    it("reads back the id of every emote of the catalogue", () => {
        for (const { id } of emoteCatalogue) {
            expect(decodeEmoteWire(encodeEmoteWire(id))).toBe(id);
        }
    });

    it("reads a value a client of another build sent, written out character by character", () => {
        expect(decodeEmoteWire("\u{1F4AC}\u{E006B}\u{E006C}\u{E0076}\u{E007F}")).toBe("lv");
    });

    it.each([
        ["a plain emoji", "👍"],
        ["a text", ":k-lv:"],
        ["an empty text", ""],
        ["the balloon alone", SPEECH_BALLOON],
        ["the balloon with a cancel tag and no name", "\u{1F4AC}\u{E007F}"],
        ["a value without the cancel tag", "\u{1F4AC}\u{E006B}\u{E006C}\u{E0076}"],
        ["a value with an emoji before it", "👍\u{1F4AC}\u{E006B}\u{E006C}\u{E0076}\u{E007F}"],
        ["a value with an emoji after it", "\u{1F4AC}\u{E006B}\u{E006C}\u{E0076}\u{E007F}👍"],
        ["a value with a plain letter inside", "\u{1F4AC}\u{E006B}l\u{E0076}\u{E007F}"],
        ["an id in capitals", "\u{1F4AC}\u{E006B}\u{E004C}\u{E0056}\u{E007F}"],
        ["a name that does not start with k", "\u{1F4AC}\u{E006C}\u{E0076}\u{E007F}"],
        // The flag of England is a black flag followed by tag characters "gbeng" and the cancel tag: the same
        // building blocks, and it must stay a flag.
        ["a flag drawn with tag characters", "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"],
        [
            "a flag whose tag characters spell an emote of the catalogue",
            "\u{1F3F4}\u{E006B}\u{E006C}\u{E0076}\u{E007F}",
        ],
    ])("reads %s as no custom emote", (_label, text) => {
        expect(decodeEmoteWire(text)).toBeUndefined();
    });
});

describe("resolveEmoteWire", () => {
    it("finds the catalogue emote a value names, with its art", () => {
        const emote = resolveEmoteWire(encodeEmoteWire("lv"));

        expect(emote?.id).toBe("lv");
        expect(emote?.art).toMatch(/^data:image\/png;base64,/);
    });

    it("finds nothing for an id the catalogue does not hold, so an unknown emote shows as the balloon", () => {
        expect(resolveEmoteWire(encodeEmoteWire("zzzz"))).toBeUndefined();
    });

    it("finds nothing for an emoji, so what upstream sends keeps its own drawing", () => {
        expect(resolveEmoteWire("😂")).toBeUndefined();
    });
});
