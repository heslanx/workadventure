// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const structuredCloneSupported = vi.hoisted(() => ({ value: true }));
vi.mock("../../../src/front/Utils/BrowserCompatibility", () => ({
    isStructuredCloneSupported: () => structuredCloneSupported.value,
}));
// PwaInstallStore reads the game manager, which pulls in Phaser and the whole game: no screen of this list needs it.
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: {} }));

import { enableCameraSceneVisibilityStore } from "../../../src/front/Stores/MediaStore";
import { BOOT_SPLASH_ID } from "../../../src/front/Utils/BootSplash";
import { installBootSplashRemoval } from "../../../src/front/Utils/BootSplashScreens";
import { errorStore } from "../../../src/front/Stores/ErrorStore";
import { errorScreenStore } from "../../../src/front/Stores/ErrorScreenStore";
import { loaderVisibleStore } from "../../../src/front/Stores/LoaderStore";
import { loginSceneVisibleStore } from "../../../src/front/Stores/LoginSceneStore";
import { mapDeletedPromptStore } from "../../../src/front/Stores/MapDeletedPromptStore";
import { pwaInstallSceneVisibleStore } from "../../../src/front/Stores/PwaInstallStore";
import { selectCharacterSceneVisibleStore } from "../../../src/front/Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../../../src/front/Stores/SelectCompanionStore";

/**
 * The screens that GameOverlay.svelte switches between, each with how to show it and how to put it away. The
 * splash must leave for every one of them: a screen missing here is a splash that stays over that screen.
 */
const screens: { name: string; show: () => void; hide: () => void }[] = [
    { name: "loading", show: () => loaderVisibleStore.set(true), hide: () => loaderVisibleStore.set(false) },
    { name: "entry", show: () => loginSceneVisibleStore.set(true), hide: () => loginSceneVisibleStore.set(false) },
    {
        name: "error screen",
        show: () => errorScreenStore.setError({ type: "error", title: "t", subtitle: "s", details: "d" } as never),
        hide: () => errorScreenStore.delete(),
    },
    {
        name: "error dialog",
        show: () => errorStore.addErrorMessage("boom", { id: "boot-test" }),
        hide: () => errorStore.clearMessageById("boot-test"),
    },
    {
        name: "character choice",
        show: () => selectCharacterSceneVisibleStore.set(true),
        hide: () => selectCharacterSceneVisibleStore.set(false),
    },
    {
        name: "companion choice",
        show: () => selectCompanionSceneVisibleStore.set(true),
        hide: () => selectCompanionSceneVisibleStore.set(false),
    },
    {
        name: "camera setup",
        show: () => enableCameraSceneVisibilityStore.showEnableCameraScene(),
        hide: () => enableCameraSceneVisibilityStore.hideEnableCameraScene(),
    },
    {
        name: "app install",
        show: () => pwaInstallSceneVisibleStore.set(true),
        hide: () => pwaInstallSceneVisibleStore.set(false),
    },
    {
        name: "map deleted",
        show: () => mapDeletedPromptStore.set(true),
        hide: () => mapDeletedPromptStore.set(false),
    },
];

describe("installBootSplashRemoval", () => {
    let frames: (() => void)[];
    const scheduleFrame = (callback: () => void) => {
        frames.push(callback);
    };
    const runFrames = () => {
        const pending = frames;
        frames = [];
        pending.forEach((callback) => callback());
    };
    const splash = () => document.getElementById(BOOT_SPLASH_ID);
    let stop: (() => void) | undefined;

    beforeEach(() => {
        frames = [];
        structuredCloneSupported.value = true;
        document.head.innerHTML = "";
        document.body.innerHTML = `<div id="${BOOT_SPLASH_ID}"></div><div id="app"></div>`;
    });

    afterEach(() => {
        stop?.();
        stop = undefined;
        screens.forEach((screen) => screen.hide());
    });

    it("keeps the splash while no screen is shown", () => {
        stop = installBootSplashRemoval(scheduleFrame);

        runFrames();

        expect(splash()).not.toBeNull();
    });

    it.each(screens)("removes the splash on the frame after the $name screen shows", ({ show }) => {
        stop = installBootSplashRemoval(scheduleFrame);

        show();
        expect(splash()).not.toBeNull();
        runFrames();

        expect(splash()).toBeNull();
    });

    it("covers stores that GameOverlay.svelte still switches on", () => {
        // If the overlay stops reading one of them, the list in BootSplashScreens.ts has drifted from it.
        const overlay = readFileSync("src/front/Components/GameOverlay.svelte", "utf8");
        for (const store of [
            "loaderVisibleStore",
            "loginSceneVisibleStore",
            "errorScreenStore",
            "errorStore",
            "selectCharacterSceneVisibleStore",
            "selectCompanionSceneVisibleStore",
            "enableCameraSceneVisibilityStore",
            "pwaInstallSceneVisibleStore",
            "mapDeletedPromptStore",
        ]) {
            expect(overlay).toContain(`$${store}`);
        }
        expect(screens).toHaveLength(9);
    });

    it("removes the splash when the browser is not supported, because the app never starts the game there", () => {
        structuredCloneSupported.value = false;

        stop = installBootSplashRemoval(scheduleFrame);
        expect(splash()).not.toBeNull();
        runFrames();

        expect(splash()).toBeNull();
    });

    it("is called by src/svelte.ts once the app is mounted", () => {
        const entry = readFileSync("src/svelte.ts", "utf8");

        expect(entry).toMatch(/import \{ installBootSplashRemoval \} from "\.\/front\/Utils\/BootSplashScreens";/);
        const mount = entry.indexOf("mount(App");
        const call = entry.indexOf("installBootSplashRemoval();");
        expect(mount).toBeGreaterThan(-1);
        expect(call).toBeGreaterThan(mount);
    });
});
