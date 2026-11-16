import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const scene = vi.hoisted(() => ({
    setVariableFromApp: vi.fn(),
    stopFollowRemotePlayer: vi.fn(),
    tutorialDone: undefined as boolean | undefined,
}));

// Link seam: the Phaser game. The store only reads the player variables and the camera of the current scene.
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => ({
            room: { metadata: { enableTutorial: true } },
            getPlayerVariablesManager: () => ({
                variables: new Map(scene.tutorialDone === undefined ? [] : [["tutorialDone", scene.tutorialDone]]),
                setVariableFromApp: scene.setVariableFromApp,
            }),
            getCameraManager: () => ({ stopFollowRemotePlayer: scene.stopFollowRemotePlayer }),
        }),
    },
}));

vi.mock("../../../src/front/Enum/EnvironmentVariable", () => ({ ENABLE_TUTORIAL: true }));

vi.mock("../../../src/front/Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { inJitsiStore: writable(false), inLivekitStore: writable(false), inBbbStore: writable(false) };
});

const touchScreen = vi.hoisted(() => ({ primaryTouchDevice: false }));
vi.mock("../../../src/front/Touch/TouchScreenManager", () => ({ touchScreenManager: touchScreen }));

import {
    isMobileOnboarding,
    onboardingProgressStore,
    onboardingStore,
} from "../../../src/front/Stores/OnboardingStore";

describe("onboardingStore", () => {
    beforeEach(() => {
        scene.setVariableFromApp.mockClear();
        scene.stopFollowRemotePlayer.mockClear();
        scene.tutorialDone = undefined;
        touchScreen.primaryTouchDevice = false;
        onboardingStore.cancel();
        scene.setVariableFromApp.mockClear();
    });

    it("walks through the desktop steps and reports the position in the run", () => {
        onboardingStore.start();
        expect(get(onboardingStore)).toBe("welcome");
        expect(get(onboardingProgressStore)).toEqual({ current: 1, total: 7 });

        onboardingStore.next();
        expect(get(onboardingStore)).toBe("movement");
        expect(get(onboardingProgressStore)).toEqual({ current: 2, total: 7 });
    });

    it("counts only the steps of the short mobile run", () => {
        touchScreen.primaryTouchDevice = true;
        onboardingStore.start();

        expect(get(isMobileOnboarding)).toBe(true);
        expect(get(onboardingProgressStore)).toEqual({ current: 1, total: 4 });
    });

    it("goes back one step, and stays on the first step", () => {
        onboardingStore.start();
        onboardingStore.next();
        onboardingStore.next();
        expect(get(onboardingStore)).toBe("communication");

        onboardingStore.back();
        expect(get(onboardingStore)).toBe("movement");
        onboardingStore.back();
        expect(get(onboardingStore)).toBe("welcome");
        onboardingStore.back();
        expect(get(onboardingStore)).toBe("welcome");
    });

    it("reports no position when the tutorial is not running", () => {
        expect(get(onboardingStore)).toBeNull();
        expect(get(onboardingProgressStore)).toBeUndefined();
    });

    it("marks the tutorial as done when the user skips it", () => {
        onboardingStore.start();
        onboardingStore.skip();

        expect(get(onboardingStore)).toBeNull();
        expect(scene.setVariableFromApp).toHaveBeenCalledWith("tutorialDone", true, {
            persist: true,
            scope: "world",
        });
    });

    it("closes the tutorial without marking it as done when it is cancelled", () => {
        onboardingStore.start();
        onboardingStore.cancel();

        expect(get(onboardingStore)).toBeNull();
        expect(scene.setVariableFromApp).not.toHaveBeenCalled();
        expect(scene.stopFollowRemotePlayer).toHaveBeenCalled();
    });
});
