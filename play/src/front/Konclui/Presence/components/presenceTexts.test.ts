import { describe, expect, it } from "vitest";
import { i18nObject } from "../../../../i18n/i18n-util";
import { loadLocale } from "../../../../i18n/i18n-util.sync";

// The component tests read each text as its key, so the words, and the plural forms that change with the number, are
// checked here against the real locales.

// Loaded before the describe blocks below read them.
loadLocale("en-US");
loadLocale("pt-BR");
loadLocale("ar-SA");

describe("the presence texts", () => {
    describe("in en-US", () => {
        const { konclui } = i18nObject("en-US");

        it("says person for one and people for more", () => {
            expect(konclui.call.conversation({ count: 1 })).toBe("Conversation with 1 person");
            expect(konclui.call.conversation({ count: 2 })).toBe("Conversation with 2 people");
        });

        it("puts the name of the room first", () => {
            expect(konclui.call.conversationIn({ place: "Sala 01", count: 3 })).toBe(
                "Sala 01 · conversation with 3 people",
            );
        });

        it("counts the people online and nearby", () => {
            expect(konclui.pill.online({ count: 12 })).toBe("12 online");
            expect(konclui.nearby({ count: 3 })).toBe("3 nearby");
        });
    });

    describe("in pt-BR", () => {
        const { konclui } = i18nObject("pt-BR");

        it("says pessoa for one and pessoas for more", () => {
            expect(konclui.call.conversation({ count: 1 })).toBe("Conversa com 1 pessoa");
            expect(konclui.call.conversation({ count: 4 })).toBe("Conversa com 4 pessoas");
        });

        it("has the reference's words for the place and the people nearby", () => {
            expect(konclui.place.entrance()).toBe("Entrada");
            expect(konclui.place.outside()).toBe("Área externa");
            expect(konclui.nearby({ count: 3 })).toBe("3 por perto");
            expect(konclui.pill.nobodyNearby()).toBe("Ninguém por perto");
            expect(konclui.call.stepAway()).toBe("afaste-se para sair");
            expect(konclui.call.leaveRoom()).toBe("saia da sala para encerrar");
        });
    });

    describe("in the locales that carry the en-US text", () => {
        // Arabic and the two Sorbian languages have plural forms the two English ones do not cover: a text with only
        // `person|people` would be blank for 0 or 2 (Arabic) and for 2 (Sorbian). Every locale gets words for these.
        it.each(["ar-SA", "dsb-DE", "hsb-DE", "de-DE"] as const)("%s has words for every count", (locale) => {
            loadLocale(locale);
            const { konclui } = i18nObject(locale);

            for (const count of [0, 1, 2, 3, 4, 5, 11, 22, 100, 102]) {
                expect(konclui.call.conversation({ count })).toBe(
                    `Conversation with ${count} ${count === 1 ? "person" : "people"}`,
                );
                expect(konclui.call.conversationIn({ place: "Sala 01", count })).toBe(
                    `Sala 01 · conversation with ${count} ${count === 1 ? "person" : "people"}`,
                );
            }
        });
    });
});
