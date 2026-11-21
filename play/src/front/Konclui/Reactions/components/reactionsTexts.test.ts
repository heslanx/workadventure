import { describe, expect, it } from "vitest";
import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { locales } from "../../../../i18n/i18n-util";
import { emoteIds } from "../domain/emoteCatalogue";

// The component tests read each text as its key, so the words are checked here against the real locales.

for (const locale of locales) loadLocale(locale);

describe("the reactions texts", () => {
    describe("in en-US", () => {
        const { reactions } = i18nObject("en-US").konclui;

        it("names who reacted and with what, and what an emote sent", () => {
            expect(reactions.reacted({ player: "Ana Ribeiro", emote: reactions.emote.lv() })).toBe(
                "Ana Ribeiro reacted: Love",
            );
            expect(reactions.sent({ emote: reactions.emote.lv() })).toBe("Sent: Love");
        });

        it("names a favourite reaction with its key", () => {
            expect(reactions.keyed({ name: reactions.native.applause(), key: 4 })).toBe("Applause · key 4");
        });

        it("says in sentence case why no emote can go", () => {
            expect(reactions.wait()).toBe("Wait a moment before the next emote.");
            expect(reactions.editing()).toBe("Finish editing your reactions to send emotes.");
            expect(reactions.blocked()).toBe("You can't send an emote right now.");
        });
    });

    describe("in pt-BR", () => {
        const { reactions } = i18nObject("pt-BR").konclui;

        it("has the labels of the reference for the emotes", () => {
            expect(emoteIds.map((id) => reactions.emote[id]())).toEqual([
                "Surpresa",
                "Dúvida",
                "Urgente",
                "Uau",
                "Amei",
                "Apaixonado",
                "Coração partido",
                "Feliz",
                "Haha",
                "Triste",
                "Bravo",
                "Irritado",
                "Gota de suor",
                "Nervoso",
                "Tonto",
                "Sem graça",
                "Ideia",
                "Pensando",
                "OK",
                "Não",
                "Nota 10",
                "Brilhou",
                "Dinheiro",
                "Música",
                "Sono",
                "Muito sono",
            ]);
        });

        it("has the names of the reference for the six reactions, with the key as it says it", () => {
            expect(
                (["like", "love", "haha", "applause", "adore", "thanks"] as const).map((id) => reactions.native[id]()),
            ).toEqual(["Curtir", "Amei", "Haha", "Palmas", "Adorei", "Obrigado"]);
            expect(reactions.keyed({ name: "Amei", key: 2 })).toBe("Amei · tecla 2");
        });

        it("says who reacted", () => {
            expect(reactions.reacted({ player: "Ana Ribeiro", emote: "Amei" })).toBe("Ana Ribeiro reagiu: Amei");
        });
    });

    describe("in every locale", () => {
        it.each(locales)("%s has a label for each of the 26 emotes and a name for each reaction", (locale) => {
            const { reactions } = i18nObject(locale).konclui;

            for (const id of emoteIds) {
                expect(reactions.emote[id](), `${locale} ${id}`).not.toBe("");
            }
            for (const id of ["like", "love", "haha", "applause", "adore", "thanks"] as const) {
                expect(reactions.native[id](), `${locale} ${id}`).not.toBe("");
            }
            expect(reactions.reacted({ player: "Ana", emote: "Love" })).toContain("Ana");
            expect(reactions.keyed({ name: "Love", key: 2 })).toContain("2");
        });
    });
});
