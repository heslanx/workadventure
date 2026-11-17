import { describe, expect, it } from "vitest";
import { combinationKeys, movementKeys } from "./shortcutKeys";

describe("combinationKeys", () => {
    const plain = { label: "D", mod: false, alt: false, shift: false };

    it("is the key alone without modifiers", () => {
        expect(combinationKeys(plain, { mac: false, shift: "Shift" })).toEqual(["D"]);
    });

    it("names the modifiers of the platform, in pressing order", () => {
        const all = { ...plain, mod: true, alt: true, shift: true };
        expect(combinationKeys(all, { mac: false, shift: "Shift" })).toEqual(["Ctrl", "Alt", "Shift", "D"]);
        expect(combinationKeys(all, { mac: true, shift: "⇧" })).toEqual(["⌘", "⌥", "⇧", "D"]);
    });
});

describe("movementKeys", () => {
    it("follows the keyboard layout of the locale", () => {
        expect(movementKeys("pt-BR")).toEqual(["W", "A", "S", "D"]);
        expect(movementKeys("fr-FR")).toEqual(["Z", "Q", "S", "D"]);
    });
});
