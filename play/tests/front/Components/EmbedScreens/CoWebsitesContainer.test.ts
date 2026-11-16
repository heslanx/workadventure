// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { get } from "svelte/store";
import CoWebsitesContainer from "../../../../src/front/Components/EmbedScreens/CoWebsitesContainer.svelte";
import { gameViewportBounds } from "../../../../src/front/ExternalModule/ClientExtensionPoints";
import { coWebsiteRatio, coWebsites } from "../../../../src/front/Stores/CoWebsiteStore";
import type { CoWebsite } from "../../../../src/front/WebRtc/CoWebsite/CoWebsite";

// The players and their classes drag in Jitsi, BigBlueButton and the video stack. A co-website that is none of
// those classes renders no player, which is all the divider needs.
vi.mock("../../../../src/front/Components/Cowebsites/JistiCowebsiteComponent.svelte", () => ({ default: () => {} }));
vi.mock("../../../../src/front/Components/Cowebsites/SimpleCowebsiteComponent.svelte", () => ({ default: () => {} }));
vi.mock("../../../../src/front/Components/Cowebsites/ImageCowebsiteComponent.svelte", () => ({ default: () => {} }));
vi.mock("../../../../src/front/Components/Cowebsites/BigBlueButtonCowebsiteComponent.svelte", () => ({
    default: () => {},
}));
vi.mock("../../../../src/front/Components/Cowebsites/VideoCowebsiteComponent.svelte", () => ({ default: () => {} }));
vi.mock(
    "../../../../src/front/Components/EmbedScreens/CoWebsitesContainer.svelte?svelte&type=style&lang.css",
    () => ({}),
);
vi.mock("../../../../src/front/WebRtc/CoWebsite/JitsiCoWebsite", () => ({ JitsiCoWebsite: class {} }));
vi.mock("../../../../src/front/WebRtc/CoWebsite/SimpleCoWebsite", () => ({ SimpleCoWebsite: class {} }));
vi.mock("../../../../src/front/WebRtc/CoWebsite/ImageCoWebsite", () => ({ ImageCoWebsite: class {} }));
vi.mock("../../../../src/front/WebRtc/CoWebsite/BBBCoWebsite", () => ({ BBBCoWebsite: class {} }));
vi.mock("../../../../src/front/WebRtc/CoWebsite/VideoCoWebsite", () => ({ VideoCoWebsite: class {} }));
vi.mock("../../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Any message path resolves to a function that returns a label, whatever store imports it.
    const messages = (): unknown => new Proxy(() => "Label", { get: () => messages() });
    const LL = readable(messages());
    return { default: LL, LL };
});

function fakeCoWebsite(id: string): CoWebsite {
    return {
        getId: () => id,
        getUrl: () => new URL(`https://${id}.example`),
        getWidthPercent: () => undefined,
        getIcon: () => "https://cowebsite.example/icon.svg",
        getTitle: () => id,
        getHideUrl: () => true,
        isClosable: () => true,
        shouldCloseOnOpenInNewTab: () => false,
    } as unknown as CoWebsite;
}

function setWindowSize(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
    window.dispatchEvent(new Event("resize"));
}

/**
 * The divider sits on the edge between the game and the co-website panel, which is at the right of the area it
 * splits. The window is 1000 x 800 in every case below.
 */
describe("CoWebsitesContainer divider", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    function dragDividerTo(clientX: number, clientY: number) {
        const divider = target.querySelector('[role="separator"]');
        if (!divider) {
            throw new Error("The divider is not rendered");
        }
        divider.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        document.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY, bubbles: true }));
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }

    beforeEach(() => {
        class ResizeObserverStub {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        vi.stubGlobal("ResizeObserver", ResizeObserverStub);
        setWindowSize(1000, 800);
        coWebsites.add(fakeCoWebsite("cowebsite-1"));
        document.body.appendChild(target);
        component = mount(CoWebsitesContainer, { target });
    });

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target.remove();
        coWebsites.removeAll();
        coWebsiteRatio.set(0.5);
        gameViewportBounds.set(undefined);
        vi.unstubAllGlobals();
        Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: originalWidth });
        Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: originalHeight });
    });

    it("reads the pointer against the window when no extension measured the game area", () => {
        dragDividerTo(700, 400);

        expect(get(coWebsiteRatio)).toBeCloseTo(0.3);
    });

    it("reads the pointer against the area an extension measured, not against the window", () => {
        gameViewportBounds.set({ left: 400, top: 0, width: 600, height: 800 });

        dragDividerTo(700, 400);

        expect(get(coWebsiteRatio)).toBeCloseTo(0.5);
    });
});
