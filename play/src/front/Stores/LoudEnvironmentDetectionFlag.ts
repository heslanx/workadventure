/**
 * Whether the loud environment detector runs. Off by default since the 2026-11-22 owner decision that noise suppression
 * is off for a user who never chose.
 *
 * The detector listens to the microphone while noise suppression is off, which is now every default user: each
 * microphone session fetches RNNoise (about 110 kB) and a worklet, and runs an analysis AudioWorklet for up to
 * LOUD_ENVIRONMENT_DETECTION_BUDGET_MS, to offer the "Enable noise suppression" toast. That is audio-thread work at
 * microphone start, the cost the owner is removing, and no run has measured it yet. It stays off until a browser run
 * measures the requests and the audio-thread cost on a fresh profile; flipping this constant (one line) turns it on.
 *
 * `localStorage["loudEnvironmentDetection"] = "1"` turns it on in a given browser, "0" turns it off if this constant is
 * ever true. A storage that cannot be read leaves the constant in charge.
 */
export const LOUD_ENVIRONMENT_DETECTION_ENABLED = false;
export const LOUD_ENVIRONMENT_DETECTION_STORAGE_KEY = "loudEnvironmentDetection";

export function isLoudEnvironmentDetectionEnabled(
    storage: Pick<Storage, "getItem"> | undefined = globalStorage(),
): boolean {
    try {
        const value = storage?.getItem(LOUD_ENVIRONMENT_DETECTION_STORAGE_KEY);
        if (value === "1") return true;
        if (value === "0") return false;
    } catch {
        // A blocked storage leaves the constant in charge
    }
    return LOUD_ENVIRONMENT_DETECTION_ENABLED;
}

function globalStorage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}
