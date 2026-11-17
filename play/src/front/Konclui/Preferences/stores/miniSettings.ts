import { get } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { allowPictureInPictureStore, askPictureInPictureActivatingStore } from "../../../Stores/PeerStore";

// The mini mode, as upstream's settings and picture-in-picture button drive it (SettingsSubMenu.svelte,
// PictureInPictureMenuItem.svelte, ProfileMenuContent.svelte).

/** Whether the mini mode opens by itself when the user leaves the tab; the store saves it. */
export function setAllowPictureInPicture(on: boolean): void {
    analyticsClient.trackAdminEvent("settings.picture_in_picture.changed", { value: on ? "true" : "false" });
    allowPictureInPictureStore.set(on);
}

/** Opens the mini mode now: the desktop app's mini window there, the browser's picture-in-picture elsewhere. */
export function openMiniModeNow(): void {
    const desktopWindows = window.WAD?.desktop ? window.WAD.windows : undefined;
    analyticsClient.trackAdminEvent("meeting.picture_in_picture.toggled", { open: true });
    // Opening it by hand allows it, as upstream's button does.
    if (!get(allowPictureInPictureStore)) allowPictureInPictureStore.set(true);
    if (desktopWindows) {
        desktopWindows.openMiniWindow();
        return;
    }
    askPictureInPictureActivatingStore.set(true);
}
