import { describe, expect, it } from "vitest";
import {
    isLoudEnvironmentDetectionEnabled,
    LOUD_ENVIRONMENT_DETECTION_ENABLED,
    LOUD_ENVIRONMENT_DETECTION_STORAGE_KEY,
} from "./LoudEnvironmentDetectionFlag";

function storageWith(value: string | null): Pick<Storage, "getItem"> {
    return { getItem: (key) => (key === LOUD_ENVIRONMENT_DETECTION_STORAGE_KEY ? value : null) };
}

describe("the loud environment detection flag", () => {
    // The detector costs a fetch of RNNoise and a worklet at each microphone start, now for every default user:
    // enabling it by default is a change of that constant and of this test, after a browser run measures it.
    it("ships off until a browser run measures the cost of the detector for a default user", () => {
        expect(LOUD_ENVIRONMENT_DETECTION_ENABLED).toBe(false);
    });

    it('is on only when the storage says "1", and off when it says "0"', () => {
        expect(isLoudEnvironmentDetectionEnabled(storageWith(null))).toBe(LOUD_ENVIRONMENT_DETECTION_ENABLED);
        expect(isLoudEnvironmentDetectionEnabled(storageWith("1"))).toBe(true);
        expect(isLoudEnvironmentDetectionEnabled(storageWith("0"))).toBe(false);
    });

    it.each(["true", "", "on"])("leaves the default for the value %j", (value) => {
        expect(isLoudEnvironmentDetectionEnabled(storageWith(value))).toBe(LOUD_ENVIRONMENT_DETECTION_ENABLED);
    });

    it("keeps the default, without throwing, when the storage cannot be read", () => {
        const blocked = {
            getItem: () => {
                throw new Error("blocked");
            },
        };

        expect(isLoudEnvironmentDetectionEnabled(blocked)).toBe(LOUD_ENVIRONMENT_DETECTION_ENABLED);
        expect(isLoudEnvironmentDetectionEnabled(undefined)).toBe(LOUD_ENVIRONMENT_DETECTION_ENABLED);
    });
});
