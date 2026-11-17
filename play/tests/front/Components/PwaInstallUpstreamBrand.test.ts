// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import PwaInstallScreen from "../../../src/front/Components/PwaInstall/PwaInstallScreen.svelte";
import enUsWarning from "../../../src/i18n/en-US/warning";
import ptBrWarning from "../../../src/i18n/pt-BR/warning";

// An unbranded room: the screen falls back to its own default artwork.
const { room } = vi.hoisted(() => ({
    room: { loginSceneLogo: undefined, backgroundSceneImage: undefined, showPoweredBy: undefined },
}));

vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { currentStartedRoom: room, currentStartedRoomPromise: Promise.resolve(room) },
}));
vi.mock("../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const messages = new Proxy({}, { get: () => () => "Test label" });
    return { LL: readable({ a11y: messages, warning: { pwaInstall: messages } }) };
});
vi.mock("../../../src/front/Administration/AnalyticsClient", () => ({
    analyticsClient: { trackAdminEvent: vi.fn() },
}));
vi.mock("../../../src/front/Stores/PwaInstallStore", async () => {
    const { readable } = await import("svelte/store");
    return {
        pwaInstallUiStore: readable({ isIos: false, deferredPrompt: null, installing: false }),
        initPwaInstallUiListeners: () => () => {},
        installPwaFromStore: vi.fn(),
        continuePwaInBrowser: vi.fn(),
        neverShowPwaPage: vi.fn(),
    };
});
vi.mock("../../../src/front/Utils/PwaInstallEligibility", () => ({
    detectIos: () => false,
    markPwaPromptNeverShow: vi.fn(),
}));

describe("upstream brand on the PWA install and unsupported-browser screens", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent);
        target.replaceChildren();
    });

    it("shows no photo of the upstream product behind the Konclui logo", () => {
        flushSync(() => {
            component = mount(PwaInstallScreen, { target });
        });

        expect(target.querySelector("img[src*='konclui-logo']")).not.toBeNull();
        expect(target.querySelector("img[src*='pwa-background-image']")).toBeNull();
    });

    it.each([
        { locale: "en-US", warning: enUsWarning },
        { locale: "pt-BR", warning: ptBrWarning },
    ])("names no upstream product in the $locale copy", ({ warning }) => {
        const screens = new Set(["pwaInstall", "browserNotSupported"]);
        const copy = JSON.stringify(Object.entries(warning).filter(([section]) => screens.has(section)));

        expect(copy).toContain("Koncluí");
        expect(copy).not.toMatch(/workadventure/i);
    });
});
