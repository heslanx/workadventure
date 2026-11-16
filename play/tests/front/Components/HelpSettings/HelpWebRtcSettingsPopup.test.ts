// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { flushSync, mount, unmount } from "svelte";
import HelpWebRtcSettingsPopup from "../../../../src/front/Components/HelpSettings/HelpWebRtcSettingsPopup.svelte";
import { helpWebRtcSettingsVisibleStore } from "../../../../src/front/Stores/HelpSettingsStore";

const mocks = vi.hoisted(() => ({
    notAskAgain: false,
    addWarningMessage: vi.fn(),
}));

vi.mock("../../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every message reads as its own path, e.g. "camera.webrtc.error".
    const messages = (path: string): unknown =>
        new Proxy(() => path, {
            get: (_target, name) => messages(path === "" ? String(name) : `${path}.${String(name)}`),
        });
    return { LL: readable(messages("")), locale: readable("en-US") };
});
vi.mock("../../../../src/front/Utils/reducedMotion", () => ({ fly: () => ({ duration: 0 }) }));
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { currentStartedRoom: { backgroundColor: undefined } },
}));
vi.mock("../../../../src/front/Stores/ErrorStore", () => ({
    warningMessageStore: { addWarningMessage: mocks.addWarningMessage },
}));
vi.mock("../../../../src/front/Connection/LocalUserStore", () => ({
    localUserStore: {
        getNotAskAgainHelpWebRtcSettingsPopup: () => mocks.notAskAgain,
        setNotAskAgainHelpWebRtcSettingsPopup: vi.fn(),
    },
}));

describe("video relay help popup", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        mocks.addWarningMessage.mockClear();
        helpWebRtcSettingsVisibleStore.set("error");
    });

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent);
        target.replaceChildren();
        mocks.notAskAgain = false;
    });

    it("shows its options and no warning by default", () => {
        component = mount(HelpWebRtcSettingsPopup, { target });
        flushSync();

        expect(mocks.addWarningMessage).not.toHaveBeenCalled();
        expect(target.textContent).toContain("camera.webrtc.solutionVpn");
        expect(get(helpWebRtcSettingsVisibleStore)).toBe("error");
    });

    it("warns with the cause and the fix, not with options that are not shown, after 'don't warn me again'", () => {
        mocks.notAskAgain = true;

        component = mount(HelpWebRtcSettingsPopup, { target });
        flushSync();

        expect(mocks.addWarningMessage).toHaveBeenCalledTimes(1);
        expect(mocks.addWarningMessage).toHaveBeenCalledWith("camera.webrtc.error");
        expect(mocks.addWarningMessage).not.toHaveBeenCalledWith("camera.webrtc.content");
        expect(get(helpWebRtcSettingsVisibleStore)).toBe("hidden");
    });
});
