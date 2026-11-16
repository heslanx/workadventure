import { get, writable } from "svelte/store";
import HelpCameraSettingsPopup from "../Components/HelpSettings/HelpCameraSettingsPopup.svelte";
import type { MediaPermissionDeniedState } from "./MediaStatusStore";
import { mediaPermissionDeniedStore } from "./MediaStatusStore";
import { popupStore } from "./PopupStore";

const HELP_CAMERA_SETTINGS_POPUP_ID = "cameraAccessDenied";

function hasMediaPermissionDenied() {
    const mediaPermissionDenied = get(mediaPermissionDeniedStore);
    return mediaPermissionDenied.camera || mediaPermissionDenied.microphone;
}

export function showHelpCameraSettings() {
    if (!hasMediaPermissionDenied()) {
        return;
    }

    popupStore.addPopup(HelpCameraSettingsPopup, {}, HELP_CAMERA_SETTINGS_POPUP_ID);
}

/**
 * Opens the help for devices the caller knows are blocked (a failed request, a camera button the browser blocks).
 * showHelpCameraSettings() waits for the browser's permission state to say "denied", which a browser without the
 * Permissions API never does: the popup would never open for it.
 */
export function showHelpForBlockedDevices(blocked: Partial<MediaPermissionDeniedState>) {
    if (!blocked.camera && !blocked.microphone) {
        return;
    }

    popupStore.addPopup(
        HelpCameraSettingsPopup,
        { camera: blocked.camera, microphone: blocked.microphone },
        HELP_CAMERA_SETTINGS_POPUP_ID,
    );
}

export function hideHelpCameraSettings() {
    popupStore.removePopup(HELP_CAMERA_SETTINGS_POPUP_ID);
}

// It is ok to not unsubscribe to this store because it is a singleton.
// eslint-disable-next-line svelte/no-ignored-unsubscribe
mediaPermissionDeniedStore.subscribe((mediaPermissionDenied) => {
    if (mediaPermissionDenied.camera || mediaPermissionDenied.microphone) {
        popupStore.addPopup(HelpCameraSettingsPopup, {}, HELP_CAMERA_SETTINGS_POPUP_ID);
        return;
    }

    hideHelpCameraSettings();
});

export const helpWebRtcSettingsVisibleStore = writable<"pending" | "error" | "hidden">("hidden");
export const helpNotificationSettingsVisibleStore = writable(false);
