// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { gameViewportBounds } from "../../../src/front/ExternalModule/ClientExtensionPoints";
import {
    chatSidebarWidthStore,
    hideActionBarStoreBecauseOfChatBar,
} from "../../../src/front/Chat/ChatSidebarWidthStore";
import { chatVisibilityStore } from "../../../src/front/Stores/ChatStore";

/**
 * The action bar steps aside when less than 285 px are left for it beside the chat. The window is 1000 px wide
 * in every case below.
 */
describe("hideActionBarStoreBecauseOfChatBar", () => {
    const originalWidth = window.innerWidth;
    let unsubscribe: (() => void) | undefined;

    beforeEach(() => {
        Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1000 });
        chatVisibilityStore.set(true);
        chatSidebarWidthStore.set(500);
        // The window size only follows resize events while something subscribes.
        unsubscribe = hideActionBarStoreBecauseOfChatBar.subscribe(() => {});
        window.dispatchEvent(new Event("resize"));
    });

    afterEach(() => {
        unsubscribe?.();
        gameViewportBounds.set(undefined);
        chatVisibilityStore.set(false);
        Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: originalWidth });
    });

    it("counts the chat against the window when no extension measured the game area", () => {
        chatSidebarWidthStore.set(720);

        expect(get(hideActionBarStoreBecauseOfChatBar)).toBe(true);

        chatSidebarWidthStore.set(715);

        expect(get(hideActionBarStoreBecauseOfChatBar)).toBe(false);
    });

    it("measures the room left in the area an extension measured, not in the window", () => {
        gameViewportBounds.set({ left: 700, top: 0, width: 280, height: 800 });

        expect(get(hideActionBarStoreBecauseOfChatBar)).toBe(true);

        gameViewportBounds.set({ left: 700, top: 0, width: 290, height: 800 });

        expect(get(hideActionBarStoreBecauseOfChatBar)).toBe(false);
    });

    it("does not take the chat off an area that already leaves it out", () => {
        chatSidebarWidthStore.set(800);

        gameViewportBounds.set({ left: 800, top: 0, width: 400, height: 800 });

        expect(get(hideActionBarStoreBecauseOfChatBar)).toBe(false);
    });
});
