// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { askPictureInPictureActivatingStore } from "../../../../src/front/Stores/PeerStore";
import { LEAVE_HINT_DURATION_MS } from "../../../../src/front/Utils/PageLeave";
import PictureInPicture from "../../../../src/front/Components/Video/PictureInPicture.svelte";

// The component is cut from the game and the video stack at their modules: what it reads is a call and some stores.

vi.mock("../../../../src/front/Stores/StreamableCollectionStore", async () => {
    const { readable } = await import("svelte/store");
    return {
        // In a conversation: there is something to show in the picture-in-picture window.
        isInRemoteConversation: readable(true),
        streamableCollectionStore: readable(new Map()),
    };
});
vi.mock("../../../../src/front/Stores/PeerStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        activePictureInPictureStore: writable(false),
        askPictureInPictureActivatingStore: writable(false),
        pictureInPictureSupportedStore: writable(true),
    };
});
vi.mock("../../../../src/front/Connection/LocalUserStore", () => ({
    localUserStore: { getAllowPictureInPicture: () => true },
}));
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => undefined },
}));
vi.mock("../../../../src/front/Components/Video/PictureInPicture/DesktopMiniWindow.svelte", () => ({
    default: () => undefined,
}));

describe("PictureInPicture", () => {
    let target: HTMLElement;
    let component: ReturnType<typeof mount> | undefined;
    // The window never opens: the test only needs to know whether the browser was asked for it.
    const requestWindow = vi.fn(() => new Promise<Window>(() => {}));

    // A click on the picture-in-picture button, or the browser asking for it when the page is hidden.
    function askForPictureInPicture() {
        askPictureInPictureActivatingStore.set(false);
        askPictureInPictureActivatingStore.set(true);
    }

    beforeEach(() => {
        vi.useFakeTimers();
        requestWindow.mockClear();
        Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: { requestWindow } });
        target = document.createElement("div");
        document.body.appendChild(target);
        component = mount(PictureInPicture, { target, props: {} });
        flushSync();
    });

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) {
            await unmount(mounted);
        }
        target.remove();
        askPictureInPictureActivatingStore.set(false);
        Reflect.deleteProperty(window, "documentPictureInPicture");
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("opens the picture-in-picture window while the page stays", () => {
        askForPictureInPicture();

        expect(requestWindow).toHaveBeenCalledOnce();
    });

    it("refuses it when the page is leaving, but opens it again after a navigation was cancelled or a file downloaded", () => {
        // beforeunload, and no pagehide after it.
        window.dispatchEvent(new Event("beforeunload"));
        askForPictureInPicture();
        expect(requestWindow).not.toHaveBeenCalled();

        vi.advanceTimersByTime(LEAVE_HINT_DURATION_MS);
        askForPictureInPicture();
        expect(requestWindow).toHaveBeenCalledOnce();
    });

    it("refuses it for good once the page is hidden for good", () => {
        window.dispatchEvent(new Event("beforeunload"));
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
        vi.advanceTimersByTime(10 * LEAVE_HINT_DURATION_MS);

        askForPictureInPicture();

        expect(requestWindow).not.toHaveBeenCalled();
    });

    it("stops watching the page when it is destroyed", async () => {
        const mounted = component;
        component = undefined;
        if (mounted) {
            await unmount(mounted);
        }

        window.dispatchEvent(new Event("beforeunload"));

        expect(vi.getTimerCount()).toBe(0);
    });
});
