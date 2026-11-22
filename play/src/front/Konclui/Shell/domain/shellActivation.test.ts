import { describe, expect, it } from "vitest";
import {
    isShellActive,
    isShellFramed,
    isShellSettling,
    viewportLandmark,
    type ShellFrameGate,
    type ShellGate,
} from "./shellActivation";

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

describe("isShellFramed", () => {
    const created: ShellFrameGate = { ...ready, sceneLoaded: false, sceneCreated: true };

    it("lays the frame out as soon as the scene is created, before it is loaded or the shell is drawn", () => {
        expect(isShellFramed(created)).toBe(true);
        expect(isShellActive(created)).toBe(false);
    });

    it("lays the frame out while the loader of another map is up", () => {
        expect(isShellFramed({ ...created, loading: true })).toBe(true);
    });

    it("waits for a scene: a known room is not enough", () => {
        expect(isShellFramed({ ...created, sceneCreated: false })).toBe(false);
    });

    it.each<[string, Partial<ShellFrameGate>]>([
        ["the room opted out", { shellEnabled: false }],
        ["an entry screen is visible", { entryScreenVisible: true }],
        ["an error is visible", { errorVisible: true }],
    ])("does not lay the frame out while %s", (_label, change) => {
        expect(isShellFramed({ ...created, ...change })).toBe(false);
        expect(isShellFramed({ ...created, sceneLoaded: true, ...change })).toBe(false);
    });

    it("holds whenever the shell is active, so that drawing the chrome never moves the game", () => {
        const flags = [false, true];
        for (const shellEnabled of flags)
            for (const sceneLoaded of flags)
                for (const loading of flags)
                    for (const entryScreenVisible of flags)
                        for (const errorVisible of flags)
                            for (const sceneCreated of flags) {
                                const gate = {
                                    shellEnabled,
                                    sceneLoaded,
                                    loading,
                                    entryScreenVisible,
                                    errorVisible,
                                    sceneCreated,
                                };
                                if (isShellActive(gate)) expect(isShellFramed(gate)).toBe(true);
                            }
    });
});

describe("isShellSettling", () => {
    const created: ShellFrameGate = { ...ready, sceneLoaded: false, sceneCreated: true };

    it("holds the game element between the frame being laid out and the chrome being drawn", () => {
        expect(isShellSettling(created)).toBe(true);
        expect(isShellSettling({ ...created, loading: true })).toBe(true);
    });

    it("lets go as the chrome is drawn", () => {
        expect(isShellActive({ ...created, sceneLoaded: true })).toBe(true);
        expect(isShellSettling({ ...created, sceneLoaded: true })).toBe(false);
    });

    it("does not hold a game element that is not in the frame: an entry or error screen, an opt-out, no scene yet", () => {
        expect(isShellSettling({ ...created, entryScreenVisible: true })).toBe(false);
        expect(isShellSettling({ ...created, errorVisible: true })).toBe(false);
        expect(isShellSettling({ ...created, shellEnabled: false })).toBe(false);
        expect(isShellSettling({ ...created, sceneCreated: false })).toBe(false);
    });
});

describe("viewportLandmark", () => {
    it("is the main landmark while the shell is drawn and upstream draws no main of its own", () => {
        expect(viewportLandmark({ shellActive: true, upstreamMainDrawn: false })).toBe("main");
    });

    it("is a region while upstream draws a main inside it, so that the page has one", () => {
        expect(viewportLandmark({ shellActive: true, upstreamMainDrawn: true })).toBe("region");
    });

    it("names nothing outside the shell", () => {
        expect(viewportLandmark({ shellActive: false, upstreamMainDrawn: false })).toBeUndefined();
        expect(viewportLandmark({ shellActive: false, upstreamMainDrawn: true })).toBeUndefined();
    });
});
