import type { Component } from "svelte";
import { get, readable, writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppFrameComponent } from "./ClientExtensionPoints";

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

describe("app frame", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    const frame: AppFrameComponent = () => ({});

    it("is absent until an extension registers one, so that the app is not framed", async () => {
        const { getAppFrame } = await import("./ClientExtensionPoints");

        expect(getAppFrame()).toBeUndefined();
    });

    it("hands the registered frame to the app", async () => {
        const { getAppFrame, registerAppFrame } = await import("./ClientExtensionPoints");

        registerAppFrame(frame);

        expect(getAppFrame()).toBe(frame);
    });

    it("keeps the last frame registered", async () => {
        const { getAppFrame, registerAppFrame } = await import("./ClientExtensionPoints");
        const later: AppFrameComponent = () => ({});

        registerAppFrame(frame);
        registerAppFrame(later);

        expect(getAppFrame()).toBe(later);
    });
});

describe("activeActionBar", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    const dock: Component = () => ({});
    const otherDock: Component = () => ({});

    async function loadPort() {
        return await import("./ClientExtensionPoints");
    }

    it("is undefined when no extension replaces the action bar, so that the default one shows", async () => {
        const { activeActionBar } = await loadPort();

        expect(get(activeActionBar)).toBeUndefined();
    });

    it("stays undefined while the registered override is not active", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();

        registerActionBar({ component: dock, active: readable(false) });

        expect(get(activeActionBar)).toBeUndefined();
    });

    it("is the override component while the override is active", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();

        registerActionBar({ component: dock, active: readable(true) });

        expect(get(activeActionBar)).toBe(dock);
    });

    it("follows the active store of the override and tells its subscribers each time it changes", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();
        const active = writable(false);
        registerActionBar({ component: dock, active });
        const seen: Array<Component | undefined> = [];
        const unsubscribe = activeActionBar.subscribe((component) => seen.push(component));

        active.set(true);
        active.set(false);
        unsubscribe();

        expect(seen).toEqual([undefined, dock, undefined]);
    });

    it("picks up an override registered after a consumer subscribed", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();
        const seen: Array<Component | undefined> = [];
        const unsubscribe = activeActionBar.subscribe((component) => seen.push(component));

        registerActionBar({ component: dock, active: readable(true) });
        unsubscribe();

        expect(seen).toEqual([undefined, dock]);
    });

    it("switches to the override registered last and ignores the active store of the one it replaced", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();
        const firstActive = writable(true);
        registerActionBar({ component: dock, active: firstActive });
        const seen: Array<Component | undefined> = [];
        const unsubscribe = activeActionBar.subscribe((component) => seen.push(component));

        registerActionBar({ component: otherDock, active: readable(false) });
        firstActive.set(false);
        firstActive.set(true);
        unsubscribe();

        expect(seen).toEqual([dock, undefined]);
    });

    it("stops listening to the active store of the override once nothing reads the action bar", async () => {
        const { activeActionBar, registerActionBar } = await loadPort();
        let listeners = 0;
        const active = readable(true, () => {
            listeners += 1;
            return () => {
                listeners -= 1;
            };
        });
        registerActionBar({ component: dock, active });

        const unsubscribe = activeActionBar.subscribe(() => undefined);
        expect(listeners).toBe(1);
        unsubscribe();

        expect(listeners).toBe(0);
    });
});
