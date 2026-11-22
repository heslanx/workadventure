// @vitest-environment jsdom
//@ts-ignore Forcing environment variables in global object
window.env = {
    MAX_USERNAME_LENGTH: 10,
    DEBUG_MODE: true,
};

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/front/Enum/EnvironmentVariable.ts", () => {
    return {
        MAX_USERNAME_LENGTH: 10,
    };
});

import {
    areCharacterTexturesValid,
    isUserNameValid,
    maxUserNameLength,
} from "../../../../src/front/Connection/LocalUserUtils";
import { localUserStore, NOISE_SUPPRESSION_ENABLED_DEFAULT } from "../../../../src/front/Connection/LocalUserStore";

describe("isUserNameValid()", () => {
    it("should validate name with letters", () => {
        expect(isUserNameValid("toto")).toBe(true);
    });

    it("should not validate empty name", () => {
        expect(isUserNameValid("")).toBe(false);
    });
    it("should not validate string with too many letters", () => {
        let testString = "";
        for (let i = 0; i < maxUserNameLength + 2; i++) {
            testString += "a";
        }
        expect(isUserNameValid(testString)).toBe(false);
    });
    it("should not validate spaces", () => {
        expect(isUserNameValid(" ")).toBe(false);
    });
    it("should validate special characters", () => {
        expect(isUserNameValid("%&-")).toBe(true);
    });
    it("should validate accents", () => {
        expect(isUserNameValid("éàëè")).toBe(true);
    });
    it("should validate chinese characters", () => {
        expect(isUserNameValid("中文鍵盤")).toBe(true);
    });
});

describe("areCharacterTextureValid()", () => {
    it("should validate default textures array", () => {
        expect(areCharacterTexturesValid(["male1", "male2"])).toBe(true);
    });

    it("should not validate an empty array", () => {
        expect(areCharacterTexturesValid([])).toBe(false);
    });
    it("should not validate space only strings", () => {
        expect(areCharacterTexturesValid([" ", "male1"])).toBe(false);
    });

    it("should not validate empty strings", () => {
        expect(areCharacterTexturesValid(["", "male1"])).toBe(false);
    });
});

describe("localUserStore microphone noise suppression settings", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("keeps advanced noise suppression off and browser noise suppression on for a user who never chose", () => {
        expect(NOISE_SUPPRESSION_ENABLED_DEFAULT).toBe(false);
        expect(localUserStore.getNoiseSuppressionEnabled()).toBe(false);
        expect(localUserStore.getNoiseSuppressionProvider()).toBe("workadventure");
        expect(localUserStore.getMicrophoneBrowserNoiseSuppression()).toBe(true);
    });

    it("never writes the setting just by reading it, so the default stays distinguishable from a choice", () => {
        localUserStore.getNoiseSuppressionEnabled();

        expect(localStorage.getItem("noiseSuppressionEnabled")).toBeNull();
    });

    it("keeps advanced noise suppression on for a user who turned it on", () => {
        localUserStore.setNoiseSuppressionEnabled(true);

        expect(localUserStore.getNoiseSuppressionEnabled()).toBe(true);
    });

    it("keeps the choice of a user who turned it on before the default changed", () => {
        // The old default wrote nothing, so a stored "true" can only come from a user who turned it on
        localStorage.setItem("noiseSuppressionEnabled", "true");

        expect(localUserStore.getNoiseSuppressionEnabled()).toBe(true);
    });

    // The provider and engine selects only show while noise suppression is on, and under the old default (on) the enabled
    // key was never written: a stored provider or engine is a user who set it up while it was on by default.
    it.each([
        ["voiceIsolation provider", "noiseSuppressionProvider", "voiceIsolation"],
        ["workadventure provider", "noiseSuppressionProvider", "workadventure"],
        ["dtln engine", "noiseSuppressionEngine", "dtln"],
        ["deepfilternet engine", "noiseSuppressionEngine", "deepfilternet"],
    ])("keeps it on for a user of the old default who chose a %s and never wrote the enabled key", (_, key, value) => {
        localStorage.setItem(key, value);

        expect(localUserStore.getNoiseSuppressionEnabled()).toBe(true);
        expect(localStorage.getItem("noiseSuppressionEnabled")).toBeNull();
    });

    it("lets an explicit off win over a stored provider or engine", () => {
        localStorage.setItem("noiseSuppressionProvider", "voiceIsolation");
        localStorage.setItem("noiseSuppressionEngine", "dtln");
        localUserStore.setNoiseSuppressionEnabled(false);

        expect(localUserStore.getNoiseSuppressionEnabled()).toBe(false);
    });

    it("does not read an unknown stored provider or engine as a choice", () => {
        localStorage.setItem("noiseSuppressionProvider", "something");
        localStorage.setItem("noiseSuppressionEngine", "something");

        expect(localUserStore.getNoiseSuppressionEnabled()).toBe(NOISE_SUPPRESSION_ENABLED_DEFAULT);
    });

    it("falls to the default when the stored value is neither true nor false", () => {
        localStorage.setItem("noiseSuppressionEnabled", "yes");

        expect(localUserStore.getNoiseSuppressionEnabled()).toBe(NOISE_SUPPRESSION_ENABLED_DEFAULT);
    });

    it("keeps advanced noise suppression off when explicitly disabled", () => {
        localUserStore.setNoiseSuppressionEnabled(false);

        expect(localUserStore.getNoiseSuppressionEnabled()).toBe(false);
    });

    it("does not migrate the legacy browser provider to active WorkAdventure noise suppression", () => {
        localStorage.setItem("noiseSuppressionEnabled", "true");
        localStorage.setItem("noiseSuppressionProvider", "browser");

        expect(localUserStore.getNoiseSuppressionEnabled()).toBe(false);
        expect(localStorage.getItem("noiseSuppressionEnabled")).toBe("false");
        expect(localStorage.getItem("noiseSuppressionProvider")).toBe("workadventure");
        expect(localUserStore.getNoiseSuppressionProvider()).toBe("workadventure");
        expect(localUserStore.getMicrophoneBrowserNoiseSuppression()).toBe(true);
    });

    it("persists browser noise suppression when explicitly disabled", () => {
        localUserStore.setMicrophoneBrowserNoiseSuppression(false);

        expect(localUserStore.getMicrophoneBrowserNoiseSuppression()).toBe(false);
    });
});
