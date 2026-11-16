import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("gameViewportBounds", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    async function loadPort() {
        return (await import("./ClientExtensionPoints")).gameViewportBounds;
    }

    it("is unset until an extension measures the game area, so that consumers fall back to the window", async () => {
        const gameViewportBounds = await loadPort();

        expect(get(gameViewportBounds)).toBeUndefined();
    });

    it("holds the area an extension registers and tells its subscribers each time it changes", async () => {
        const gameViewportBounds = await loadPort();
        const seen: Array<unknown> = [];
        const unsubscribe = gameViewportBounds.subscribe((bounds) => seen.push(bounds));

        gameViewportBounds.set({ left: 362, top: 6, width: 1072, height: 788 });
        gameViewportBounds.set({ left: 0, top: 0, width: 640, height: 480 });
        unsubscribe();

        expect(seen).toEqual([
            undefined,
            { left: 362, top: 6, width: 1072, height: 788 },
            { left: 0, top: 0, width: 640, height: 480 },
        ]);
    });

    it("goes back to the window when the extension clears its area", async () => {
        const gameViewportBounds = await loadPort();
        gameViewportBounds.set({ left: 362, top: 6, width: 1072, height: 788 });

        gameViewportBounds.set(undefined);

        expect(get(gameViewportBounds)).toBeUndefined();
    });
});
