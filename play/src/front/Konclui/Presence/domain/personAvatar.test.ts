import { describe, expect, it } from "vitest";
import { AVATAR_TONE_COUNT, initialsOf, toneOf } from "./personAvatar";

// The expected values were computed with the reference theme's own `initials` and `tone` (theme/moment-hud.js), not
// with this module, so a person keeps the colour they had.
const REFERENCE: readonly [name: string, initials: string, tone: number][] = [
    ["Ana Ribeiro", "AR", 5],
    ["Erick", "E", 3],
    ["Zoë Å", "ZÅ", 0],
    ["maria da silva", "MD", 1],
    ["日本語 名前", "日名", 2],
    ["A", "A", 0],
    ["  spaced   out  name ", "SO", 4],
    ["Fábio", "F", 4],
];

describe("initialsOf", () => {
    it.each(REFERENCE)("reads %s as %s", (name, initials) => {
        expect(initialsOf(name)).toBe(initials);
    });

    it("keeps two words of a longer name", () => {
        expect(initialsOf("Ana Maria Ribeiro")).toBe("AM");
    });

    it.each(["", "   "])("answers ? for a name with no letters (%j)", (name) => {
        expect(initialsOf(name)).toBe("?");
    });

    it("keeps a first character outside the basic plane whole", () => {
        expect(initialsOf("🎉 Party")).toBe("🎉P");
    });
});

describe("toneOf", () => {
    it.each(REFERENCE)("gives %s the reference's tone", (name, _initials, tone) => {
        expect(toneOf(name)).toBe(tone);
    });

    it("stays inside the tones the avatar draws", () => {
        const names = ["Bruno", "Carla", "Diego", "Elisa", "Gabi", "Heitor", "🎉 Party", ""];
        for (const name of names) {
            expect(toneOf(name)).toBeGreaterThanOrEqual(0);
            expect(toneOf(name)).toBeLessThan(AVATAR_TONE_COUNT);
        }
    });

    it("is the same for the same name", () => {
        expect(toneOf("Ana Ribeiro")).toBe(toneOf("Ana Ribeiro"));
    });
});
