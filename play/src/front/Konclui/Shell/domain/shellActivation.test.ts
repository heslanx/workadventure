import { describe, expect, it } from "vitest";
import { isShellActive, type ShellGate } from "./shellActivation";

const ready: ShellGate = {
    shellEnabled: true,
    sceneLoaded: true,
    loading: false,
    entryScreenVisible: false,
    errorVisible: false,
};

describe("isShellActive", () => {
    it("draws the shell in an enabled room once the scene is ready", () => {
        expect(isShellActive(ready)).toBe(true);
    });

    it.each<[string, Partial<ShellGate>]>([
        ["the room opted out", { shellEnabled: false }],
        ["the scene has not loaded", { sceneLoaded: false }],
        ["the loader is visible", { loading: true }],
        ["an entry screen is visible", { entryScreenVisible: true }],
        ["an error is visible", { errorVisible: true }],
    ])("does not draw the shell while %s", (_label, change) => {
        expect(isShellActive({ ...ready, ...change })).toBe(false);
    });
});
