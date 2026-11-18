// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { loadLocale } from "../../../src/i18n/i18n-util.sync";
import { setLocale } from "../../../src/i18n/i18n-svelte";
import LoginScene from "../../../src/front/Components/Login/LoginScene.svelte";
import type { Game } from "../../../src/front/Phaser/Game/Game";

const { room } = vi.hoisted(() => ({
    room: {
        loginSceneLogo: undefined as string | undefined,
        backgroundSceneImage: undefined as string | undefined,
        backgroundColor: undefined as string | undefined,
        showPoweredBy: undefined as boolean | undefined,
    },
}));
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { currentStartedRoom: room, getPlayerName: () => "" },
}));
// The real module is the Phaser scene: the component only needs its name.
vi.mock("../../../src/front/Phaser/Login/LoginScene", () => ({ LoginSceneName: "LoginScene" }));
vi.mock("../../../src/front/Enum/EnvironmentVariable", () => ({ MAX_USERNAME_LENGTH: 10 }));

describe("login screen branding", () => {
    const target = document.createElement("div");
    const game = { scene: { getScene: () => ({ login: vi.fn() }) } } as unknown as Game;
    let component: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent);
        target.replaceChildren();
        room.loginSceneLogo = undefined;
        room.backgroundSceneImage = undefined;
        room.backgroundColor = undefined;
        room.showPoweredBy = undefined;
    });

    const logo = () => target.querySelector("img.main-logo")?.getAttribute("src");
    const background = () => target.querySelector("[style*='background-image']");
    const poweredBy = () => target.querySelector("img[src*='Powered_By_WorkAdventure']");
    const pageBackdrop = () =>
        [...target.querySelectorAll("div")].find((div) => div.classList.contains("bg-(image:--k-page-backdrop)"));
    const dimmingLayer = () => target.querySelector<HTMLElement>("div.bg-contrast.opacity-80");

    it("shows the Konclui logo alone for a room without branding", () => {
        component = mount(LoginScene, { target, props: { game } });

        expect(logo()).toContain("konclui-logo.svg");
        expect(background()).toBeNull();
        expect(poweredBy()).toBeNull();
    });

    it("displays the room logo and background, credited to WorkAdventure", () => {
        room.loginSceneLogo = "https://cdn.example.com/room-logo.svg";
        room.backgroundSceneImage = "https://cdn.example.com/room-background.webp";
        component = mount(LoginScene, { target, props: { game } });

        expect(logo()).toBe(room.loginSceneLogo);
        expect(background()?.getAttribute("style")).toContain(room.backgroundSceneImage);
        expect(poweredBy()).not.toBeNull();
    });

    it("draws the Konclui page backdrop, undimmed, for a room without a background color or image", () => {
        component = mount(LoginScene, { target, props: { game } });

        expect(pageBackdrop()).toBeDefined();
        expect(dimmingLayer()).toBeNull();
    });

    it("keeps the room's own background color instead of the Konclui backdrop", () => {
        room.backgroundColor = "rgb(17, 34, 51)";
        component = mount(LoginScene, { target, props: { game } });

        expect(pageBackdrop()).toBeUndefined();
        expect(dimmingLayer()?.style.backgroundColor).toBe("rgb(17, 34, 51)");
    });

    it("dims the room's background image instead of drawing the Konclui backdrop", () => {
        room.backgroundSceneImage = "https://cdn.example.com/room-background.webp";
        component = mount(LoginScene, { target, props: { game } });

        expect(pageBackdrop()).toBeUndefined();
        expect(dimmingLayer()).not.toBeNull();
    });

    it("hides the WorkAdventure credit when the room turns it off", () => {
        room.loginSceneLogo = "https://cdn.example.com/room-logo.svg";
        room.showPoweredBy = false;
        component = mount(LoginScene, { target, props: { game } });

        expect(poweredBy()).toBeNull();
    });
});

describe("login screen button", () => {
    const target = document.createElement("div");
    const game = { scene: { getScene: () => ({ login: vi.fn() }) } } as unknown as Game;
    let component: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent);
        target.replaceChildren();
    });

    // The name screen is the first of up to three steps (avatar, camera), and it reopens from the profile menu inside
    // the room, so the button says Continue and not that it enters the world.
    it.each([
        { locale: "en-US", label: "Continue" },
        { locale: "pt-BR", label: "Continuar" },
    ] as const)("reads $label in $locale", ({ locale, label }) => {
        loadLocale(locale);
        setLocale(locale);
        component = mount(LoginScene, { target, props: { game } });

        expect(target.querySelector("button.loginSceneFormSubmit")?.textContent?.trim()).toBe(label);
    });
});
