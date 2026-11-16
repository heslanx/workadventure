import { describe, expect, it } from "vitest";
import { isShellEnabled } from "./roomMetadata";

describe("isShellEnabled", () => {
    it.each([
        ["absent metadata", undefined],
        ["null metadata", null],
        ["empty metadata", {}],
        ["metadata of a room that is not the office", { theme: "dark", modules: ["chat"] }],
        ["a konclui entry without shell", { konclui: {} }],
        ["shell set to true", { konclui: { shell: true } }],
        ["a null konclui entry", { konclui: null }],
        ["a konclui entry that is not an object", { konclui: "off" }],
        ["shell given as the string false", { konclui: { shell: "false" } }],
        ["shell given as zero", { konclui: { shell: 0 } }],
        ["shell given as null", { konclui: { shell: null } }],
        ["an array", [{ konclui: { shell: false } }]],
        ["a string", "konclui"],
        ["a number", 0],
        ["a boolean false", false],
    ])("keeps the shell for %s", (_label, metadata) => {
        expect(isShellEnabled(metadata)).toBe(true);
    });

    it("opts out only when konclui.shell is the literal false", () => {
        expect(isShellEnabled({ konclui: { shell: false } })).toBe(false);
    });

    it("opts out even when the metadata carries other fields", () => {
        expect(isShellEnabled({ theme: "dark", konclui: { shell: false, extra: 1 } })).toBe(false);
    });
});
