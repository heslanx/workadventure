// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { loadLocale } from "../../../src/i18n/i18n-util.sync";
import { setLocale } from "../../../src/i18n/i18n-svelte";
import { GameSceneNotFoundError } from "../../../src/front/Phaser/Game/GameManager";
import EnableCameraScene from "../../../src/front/Components/EnableCamera/EnableCameraScene.svelte";
import type { Game } from "../../../src/front/Phaser/Game/Game";

// Link seam: the game manager. Whether a game scene exists is what tells the way into the room from the profile menu.
const gameScene = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("../../../src/front/Phaser/Game/GameManager", () => {
    class GameSceneNotFoundError extends Error {}
    return {
        GameSceneNotFoundError,
        gameManager: {
            currentStartedRoom: { backgroundColor: undefined, backgroundSceneImage: undefined, legals: {} },
            getCurrentGameScene: () => gameScene.lookup(),
        },
    };
});
// The real module is the Phaser scene: the component only needs its name.
vi.mock("../../../src/front/Phaser/Login/EnableCameraScene", () => ({ EnableCameraSceneName: "EnableCameraScene" }));
// The devices are not under test, and the real store reaches the browser's media and permission APIs.
vi.mock("../../../src/front/Stores/MediaStore", async () => {
    const { readable } = await import("svelte/store");
    const unused = () => undefined;
    return {
        requestedCameraDeviceIdStore: { set: unused },
        requestedMicrophoneDeviceIdStore: { set: unused },
        batchGetUserMediaStore: { startBatch: unused, commitChanges: unused },
        cameraListStore: readable([]),
        microphoneListStore: readable([]),
        speakerListStore: readable([]),
        speakerSelectedStore: readable(undefined),
        localVolumeStore: readable([]),
        localStreamStore: readable({ type: "error" }),
        requestedCameraState: { enableWebcam: unused, disableWebcam: unused },
        requestedMicrophoneState: { enableMicrophone: unused, disableMicrophone: unused },
    };
});
vi.mock("../../../src/front/Stores/MyMediaStore", () => ({
    myCameraStore: { set: () => undefined },
    myMicrophoneStore: { set: () => undefined },
}));
vi.mock("../../../src/front/Connection/LocalUserStore", () => ({ localUserStore: {} }));
vi.mock("../../../src/front/WebRtc/AudioOutputManager", () => ({ playSpeakerTestSound: () => Promise.resolve() }));
// Each device picker is a component of its own, with its own tests.
vi.mock("../../../src/front/Components/EnableCamera/HorizontalSoundMeterWidget.svelte", () => ({ default: () => {} }));
vi.mock("../../../src/front/Components/EnableCamera/SelectMicrophone.svelte", () => ({ default: () => {} }));
vi.mock("../../../src/front/Components/EnableCamera/SelectCamera.svelte", () => ({ default: () => {} }));
vi.mock("../../../src/front/Components/EnableCamera/SelectSpeaker.svelte", () => ({ default: () => {} }));

describe("camera screen button", () => {
    const game = { scene: { getScene: () => ({ login: vi.fn() }) } } as unknown as Game;
    let target: HTMLElement;
    let component: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent);
        target.remove();
        gameScene.lookup.mockReset();
    });

    const showScreen = (locale: "en-US" | "pt-BR") => {
        loadLocale(locale);
        setLocale(locale);
        component = mount(EnableCameraScene, { target, props: { game } });
    };
    const submitButton = () => target.querySelector("button.enableCameraSceneFormSubmit");

    // On the way into the room this click is the one that enters the office. Reopened from the profile menu, the
    // room is already there and the click saves the devices.
    describe.each([
        { locale: "en-US", entering: "Enter the office", saving: "Save settings" },
        { locale: "pt-BR", entering: "Entrar no escritório", saving: "Salvar configurações" },
    ] as const)("in $locale", ({ locale, entering, saving }) => {
        it(`reads ${entering} on the way into the room`, () => {
            gameScene.lookup.mockImplementation(() => {
                throw new GameSceneNotFoundError("Not the Game Scene");
            });

            showScreen(locale);

            expect(submitButton()?.textContent?.trim()).toBe(entering);
        });

        it(`reads ${saving} when reopened from the profile menu`, () => {
            gameScene.lookup.mockReturnValue({});

            showScreen(locale);

            expect(submitButton()?.textContent?.trim()).toBe(saving);
        });
    });

    it("does not hide a failure to find out where the page was opened from", () => {
        gameScene.lookup.mockImplementation(() => {
            throw new Error("scene plugin is gone");
        });

        expect(() => showScreen("en-US")).toThrow("scene plugin is gone");
    });
});
