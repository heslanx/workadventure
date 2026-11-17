// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import LoaderScene from "../../../src/front/Components/Loader/LoaderScene.svelte";

const { room } = vi.hoisted(() => ({
    room: {
        loadingLogo: undefined as string | undefined,
        backgroundSceneImage: undefined as string | undefined,
        backgroundColor: undefined as string | undefined,
        primaryColor: undefined as string | undefined,
    },
}));
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: { currentStartedRoom: room } }));
vi.mock("../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return { default: readable({ a11y: { compRoomLogo: () => "Logo", compLoading: () => "Loading" } }) };
});

describe("loading screen branding", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent, { outro: false });
        target.replaceChildren();
        room.loadingLogo = undefined;
        room.backgroundSceneImage = undefined;
        room.backgroundColor = undefined;
        room.primaryColor = undefined;
    });

    const dimLayer = () => target.querySelector<HTMLElement>(".opacity-70");
    const progressFill = () => target.querySelector<HTMLElement>("[role='progressbar'] > div");

    it("shows the Konclui logo on an opaque page for a room without branding", () => {
        component = mount(LoaderScene, { target, intro: false });

        expect(target.querySelector("img[alt='Logo']")?.getAttribute("src")).toContain("konclui-logo.svg");
        expect(target.querySelector("[style*='background-image']")).toBeNull();
        // Without a background image nothing else covers the scene: the root itself must be opaque.
        expect(target.firstElementChild?.classList.contains("bg-contrast-1100")).toBe(true);
        // The dim layer takes the page colour, so it adds no tint of its own.
        expect(dimLayer()?.getAttribute("style")).toContain("var(--contrast-1100)");
    });

    it("displays the room logo, background image and background colour", () => {
        room.loadingLogo = "https://cdn.example.com/room-loader.svg";
        room.backgroundSceneImage = "https://cdn.example.com/room-background.webp";
        room.backgroundColor = "rgb(18, 52, 86)";
        component = mount(LoaderScene, { target, intro: false });

        expect(target.querySelector("img[alt='Logo']")?.getAttribute("src")).toBe(room.loadingLogo);
        expect(target.querySelector("[style*='background-image']")?.getAttribute("style")).toContain(
            room.backgroundSceneImage,
        );
        expect(dimLayer()?.style.backgroundColor).toBe("rgb(18, 52, 86)");
    });

    it("paints the progress bar with the theme accent, whatever primary colour the room sets", () => {
        room.primaryColor = "rgb(255, 0, 0)";
        component = mount(LoaderScene, { target, intro: false });

        expect(progressFill()?.classList.contains("bg-secondary")).toBe(true);
        expect(progressFill()?.style.backgroundColor).toBe("");
    });
});
