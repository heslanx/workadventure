import { writable } from "svelte/store";
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

/**
 * The quality the camera is captured and published with: "low" while the uplink cap is on, the saved setting otherwise.
 */
export function effectiveVideoQuality(capped: boolean, saved: VideoQualitySetting): VideoQualitySetting {
    return capped ? "low" : saved;
}
