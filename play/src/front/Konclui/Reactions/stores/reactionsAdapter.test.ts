import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import type { Locales } from "../../../../i18n/i18n-types";
import { encodeEmoteWire } from "../domain/emoteWire";
import { emoteArt } from "../domain/emoteArt";

loadLocale("en-US");
loadLocale("pt-BR");

// The language of the app, which a test can switch: the adapter must read it when a name is made, not when it loads.
const language = await vi.hoisted(async () => {
    const { writable } = await import("svelte/store");
    return writable<unknown>(undefined);
});

vi.mock("../../../../i18n/i18n-svelte", () => ({ LL: language }));

function speak(locale: Locales): void {
    language.set(i18nObject(locale));
}

describe("the provider of the pixel emotes", () => {
    beforeEach(() => {
        speak("en-US");
    });

    async function load() {
        return await import("./reactionsAdapter");
    }

    it("tells the engine which emote message is a custom emote, with its art and its id", async () => {
        const { customEmoteProvider } = await load();

        const emote = customEmoteProvider.resolve(encodeEmoteWire("lv"));

        expect(emote?.id).toBe("lv");
        expect(emote?.src).toBe(emoteArt.lv);
    });

    it("tells the engine nothing for an emoji or an id of the catalogue it does not hold", async () => {
        const { customEmoteProvider } = await load();

        expect(customEmoteProvider.resolve("👍")).toBeUndefined();
        expect(customEmoteProvider.resolve(encodeEmoteWire("zzzz"))).toBeUndefined();
    });

    it("names the picture over a character after who reacted and with what", async () => {
        const { customEmoteProvider } = await load();

        const emote = customEmoteProvider.resolve(encodeEmoteWire("lv"));

        expect(emote?.accessibleName("Ana Ribeiro")).toBe("Ana Ribeiro reacted: Love");
    });

    it("names the picture in the language of the moment it is made", async () => {
        const { customEmoteProvider } = await load();
        const emote = customEmoteProvider.resolve(encodeEmoteWire("lv"));

        speak("pt-BR");

        expect(emote?.accessibleName("Ana Ribeiro")).toBe("Ana Ribeiro reagiu: Amei");
    });
});

describe("describeNativeReaction", () => {
    beforeEach(() => {
        speak("en-US");
    });

    async function load() {
        return await import("./reactionsAdapter");
    }

    it("names a favourite reaction with its key, as the reference does", async () => {
        const { describeNativeReaction } = await load();

        expect(describeNativeReaction("red heart", 2)).toBe("Love · key 2");
        expect(describeNativeReaction("thumbs up", 1)).toBe("Like · key 1");
    });

    it("names it in the reference's words in Portuguese", async () => {
        const { describeNativeReaction } = await load();
        speak("pt-BR");

        expect(describeNativeReaction("red heart", 2)).toBe("Amei · tecla 2");
        expect(describeNativeReaction("clapping hands", 4)).toBe("Palmas · tecla 4");
    });

    it("leaves a reaction the player chose to name itself", async () => {
        const { describeNativeReaction } = await load();

        expect(describeNativeReaction("grinning face", 3)).toBeUndefined();
    });
});
