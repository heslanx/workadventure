// @vitest-environment jsdom
import { get, readable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { controllerConstructed, createDetector } = vi.hoisted(() => ({
    controllerConstructed: vi.fn(),
    createDetector: vi.fn(),
}));

vi.mock("./LoudEnvironmentDetectionController", () => ({
    LoudEnvironmentDetectionController: class {
        constructor() {
            controllerConstructed();
        }
        destroy() {}
    },
}));
vi.mock("../WebRtc/NoiseSuppression/BackgroundNoiseDetector", () => ({
    BACKGROUND_NOISE_SAMPLE_RATE: 16000,
    createBackgroundNoiseDetector: createDetector,
}));
vi.mock("../WebRtc/AudioContextManager", () => ({ audioContextManager: { getAnalysisContext: vi.fn() } }));
vi.mock("@sentry/svelte", () => ({ captureException: vi.fn() }));
vi.mock("./MediaStore", () => ({
    rawLocalAudioTrackStore: readable({ type: "error" }),
    requestedMicrophoneDeviceIdStore: readable(undefined),
    requestedMicrophoneState: readable(true),
    silentStore: readable(false),
}));
vi.mock("./NoiseSuppressionStore", () => ({ noiseSuppressionEnabledStore: readable(false) }));

const { loudEnvironmentWarningStore } = await import("./LoudEnvironmentWarningStore");

describe("loudEnvironmentWarningStore", () => {
    beforeEach(() => {
        controllerConstructed.mockClear();
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it("builds no detector, and so requests no RNNoise or worklet, for a user who did not turn the flag on", () => {
        const warnings: boolean[] = [];
        const unsubscribe = loudEnvironmentWarningStore.subscribe((warning) => warnings.push(warning));

        expect(controllerConstructed).not.toHaveBeenCalled();
        expect(createDetector).not.toHaveBeenCalled();
        expect(get(loudEnvironmentWarningStore)).toBe(false);
        unsubscribe();
    });

    it("builds the controller once the flag is turned on in the browser", () => {
        localStorage.setItem("loudEnvironmentDetection", "1");

        const unsubscribe = loudEnvironmentWarningStore.subscribe(() => undefined);

        expect(controllerConstructed).toHaveBeenCalledTimes(1);
        unsubscribe();
    });
});
