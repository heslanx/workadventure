import { describe, expect, it } from "vitest";
import { escapeInSearch, foldName, isSearchShortcut, matchesName, type ShortcutEvent } from "./peopleSearch";

describe("foldName", () => {
    it("drops accents and case", () => {
        expect(foldName("João Álvares")).toBe("joao alvares");
        expect(foldName("ÇÃO")).toBe("cao");
    });

    it("leaves a letter that has no accent form as it is", () => {
        expect(foldName("Łukasz")).toBe("łukasz");
    });
});

describe("matchesName", () => {
    it("finds a name without the accents the user did not type", () => {
        expect(matchesName("João Silva", "joao")).toBe(true);
        expect(matchesName("Joao Silva", "joão")).toBe(true);
    });

    it("finds a name by any part of it, in any case", () => {
        expect(matchesName("Ana Beatriz Souza", "BEATRIZ")).toBe(true);
        expect(matchesName("Ana Beatriz Souza", "iz sou")).toBe(true);
    });

    it("ignores the spaces around the query", () => {
        expect(matchesName("Ana Souza", "  ana  ")).toBe(true);
    });

    it("holds every name for an empty query, or one of spaces", () => {
        expect(matchesName("Ana", "")).toBe(true);
        expect(matchesName("Ana", "   ")).toBe(true);
    });

    it("rejects a name that does not hold the query", () => {
        expect(matchesName("Ana Souza", "bruno")).toBe(false);
    });
});

describe("isSearchShortcut", () => {
    const press = (overrides: Partial<ShortcutEvent>): ShortcutEvent => ({
        key: "k",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        ...overrides,
    });

    it("is Ctrl+K and ⌘K, in either case of the letter", () => {
        expect(isSearchShortcut(press({ ctrlKey: true }))).toBe(true);
        expect(isSearchShortcut(press({ metaKey: true }))).toBe(true);
        expect(isSearchShortcut(press({ ctrlKey: true, key: "K" }))).toBe(true);
    });

    it("is not K alone, nor another letter with the modifier", () => {
        expect(isSearchShortcut(press({}))).toBe(false);
        expect(isSearchShortcut(press({ ctrlKey: true, key: "j" }))).toBe(false);
    });

    it("leaves Ctrl+Shift+K and Ctrl+Alt+K to the browser", () => {
        expect(isSearchShortcut(press({ ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(isSearchShortcut(press({ ctrlKey: true, altKey: true }))).toBe(false);
    });
});

describe("escapeInSearch", () => {
    it("clears what was typed first", () => {
        expect(escapeInSearch("ana")).toBe("clear");
    });

    it("closes the panel when there is nothing to clear", () => {
        expect(escapeInSearch("")).toBe("close");
    });
});
