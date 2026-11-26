import { get, writable, type Unsubscriber } from "svelte/store";
import type { VideoQualitySetting } from "../Connection/LocalUserStore";

/**
 * What the uplink limitation detector (UplinkLimitationDetector) decided about the camera, in a leaf of its own: the
 * stores that the media code reads (MediaStore, LiveKitRoom) and the ones the interface shows must not have to import
 * the detector, and the detector must not import them back.
 *
 * Session only, on purpose. The saved camera quality (videoQualityStore) is the user's choice and is persisted;
 * nothing here ever writes to it.
 */

/**
 * The camera is capped to "low" for lack of upload. The saved setting stays what the user chose: the effective one is
 * effectiveVideoQuality().
 */
export const uplinkCapStore = writable(false);

/**
 * The user should be told about the cap. Raised by the first cap of an episode, lowered when the cap is lifted or
 * cleared: a recovery trial that fails and caps again is not news a second time.
 */
export const uplinkCapNoticeStore = writable(false);

const clearRequestListeners = new Set<() => void>();

/**
 * The user asks to take the cap off by hand. The leaf only carries the request: the detector decided the cap, so it
 * listens (onUplinkCapClearRequest) and clears the cap and what it learned with it. With no cap on, nothing happens.
 */
export function requestUplinkCapClear(): void {
    if (!get(uplinkCapStore)) {
        return;
    }
    for (const listener of clearRequestListeners) {
        listener();
    }
}

/** Listens for requestUplinkCapClear. Returns the function that stops listening. */
export function onUplinkCapClearRequest(listener: () => void): Unsubscriber {
    clearRequestListeners.add(listener);
    return () => {
        clearRequestListeners.delete(listener);
    };
}

/**
 * The quality the camera is captured and published with: "low" while the uplink cap is on, the saved setting otherwise.
 */
export function effectiveVideoQuality(capped: boolean, saved: VideoQualitySetting): VideoQualitySetting {
    return capped ? "low" : saved;
}
