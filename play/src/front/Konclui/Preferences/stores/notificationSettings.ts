import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { browserNotificationStore } from "../../../Stores/BrowserNotificationStore";

// The notification and request settings, written the way upstream's settings write them (SettingsSubMenu.svelte).

/** Whether this browser has notifications at all: an iPhone's Safari tab has none. */
export function notificationsSupported(): boolean {
    return "Notification" in window;
}

/** Whether the user blocked notifications for the site: the browser no longer asks, so the switch cannot turn on. */
export function notificationsBlocked(): boolean {
    return notificationsSupported() && Notification.permission === "denied";
}

/**
 * Turns the browser notifications on or off and answers what they end up as: turning them on asks the browser
 * first, and a refusal leaves them off.
 */
export async function setNotification(on: boolean): Promise<boolean> {
    analyticsClient.trackAdminEvent("settings.notification.changed", { value: on ? "true" : "false" });
    if (!on || Notification.permission === "granted") {
        localUserStore.setNotification(on);
        browserNotificationStore.refresh();
        return on;
    }
    const granted = (await Notification.requestPermission()) === "granted";
    localUserStore.setNotification(granted);
    browserNotificationStore.refresh();
    return granted;
}

export function setAskBeforeOpeningSites(on: boolean): void {
    analyticsClient.trackAdminEvent("settings.ask_website.changed", { value: on ? "true" : "false" });
    localUserStore.setForceCowebsiteTrigger(on);
}

export function setIgnoreFollowRequests(on: boolean): void {
    analyticsClient.trackAdminEvent("settings.request_follow.changed", { value: on ? "true" : "false" });
    localUserStore.setIgnoreFollowRequests(on);
}
