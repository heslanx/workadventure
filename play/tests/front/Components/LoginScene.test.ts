// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import LoginScene from "../../../src/front/Components/Login/LoginScene.svelte";
import type { Game } from "../../../src/front/Phaser/Game/Game";

const { room } = vi.hoisted(() => ({
    room: {
        loginSceneLogo: undefined as string | undefined,
        backgroundSceneImage: undefined as string | undefined,
        showPoweredBy: undefined as boolean | undefined,
    },
}));
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { currentStartedRoom: room, getPlayerName: () => "" },
}));
// The real module is the Phaser scene: the component only needs its name.
vi.mock("../../../src/front/Phaser/Login/LoginScene", () => ({ LoginSceneName: "LoginScene" }));
vi.mock("../../../src/front/Enum/EnvironmentVariable", () => ({ MAX_USERNAME_LENGTH: 10 }));
vi.mock("../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const label = () => "Test label";
    return {
        LL: readable({
            a11y: { compRoomLogo: label, compPoweredByWorkAdventure: label },
            login: { input: { name: { placeholder: label, empty: label } }, continue: label },
        }),
        locale: readable("en"),
    };
});

describe("login screen branding", () => {
    const target = document.createElement("div");
    const game = { scene: { getScene: () => ({ login: vi.fn() }) } } as unknown as Game;
    let component: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent);
        target.replaceChildren();
        room.loginSceneLogo = undefined;
        room.backgroundSceneImage = undefined;
        room.showPoweredBy = undefined;
    });

    const logo = () => target.querySelector("img.main-logo")?.getAttribute("src");
    const background = () => target.querySelector("[style*='background-image']");
    const poweredBy = () => target.querySelector("img[src*='Powered_By_WorkAdventure']");

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

    it("hides the WorkAdventure credit when the room turns it off", () => {
        room.loginSceneLogo = "https://cdn.example.com/room-logo.svg";
        room.showPoweredBy = false;
        component = mount(LoginScene, { target, props: { game } });

        expect(poweredBy()).toBeNull();
    });
});
