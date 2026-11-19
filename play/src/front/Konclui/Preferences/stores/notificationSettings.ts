import { writable, type Readable } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { browserNotificationStore } from "../../../Stores/BrowserNotificationStore";
import { savedSetting } from "./savedSetting";

// The notification and request settings, written the way upstream's settings write them (SettingsSubMenu.svelte).

/** Whether this browser has notifications at all: an iPhone's Safari tab has none. */
export function notificationsSupported(): boolean {
    return "Notification" in window;
}

/** Whether the user blocked notifications for the site: the browser no longer asks, so the switch cannot turn on. */
function notificationsBlocked(): boolean {
    return notificationsSupported() && Notification.permission === "denied";
}

/** Saves the notification choice and tells the browser notification switch to read it again. */
function saveNotification(on: boolean): void {
    localUserStore.setNotification(on);
    browserNotificationStore.refresh();
}

/**
 * Turns the browser notifications on or off and answers what they end up as: turning them on asks the browser
 * first, and a refusal leaves them off.
 */
async function setNotification(on: boolean): Promise<boolean> {
    analyticsClient.trackAdminEvent("settings.notification.changed", { value: on ? "true" : "false" });
    if (!on || Notification.permission === "granted") {
        saveNotification(on);
        return on;
    }
    const granted = (await Notification.requestPermission()) === "granted";
    saveNotification(granted);
    return granted;
}

export const askBeforeOpeningSites = savedSetting(
    () => localUserStore.getForceCowebsiteTrigger(),
    (on: boolean) => {
        analyticsClient.trackAdminEvent("settings.ask_website.changed", { value: on ? "true" : "false" });
        localUserStore.setForceCowebsiteTrigger(on);
    },
);

export const ignoreFollowRequests = savedSetting(
    () => localUserStore.getIgnoreFollowRequests(),
    (on: boolean) => {
        analyticsClient.trackAdminEvent("settings.request_follow.changed", { value: on ? "true" : "false" });
        localUserStore.setIgnoreFollowRequests(on);
    },
);

export interface NotificationState {
    on: boolean;
    /** The browser blocked the site: the switch stays off and says why, as the browser will not ask again. */
    blocked: boolean;
}

function savedNotificationState(): NotificationState {
    const blocked = notificationsBlocked();
    return { on: notificationsSupported() && !blocked && localUserStore.getNotification(), blocked };
}

// The state is read again for each first subscriber, as the permission may have changed in the browser's own
// settings since. The placeholder is never seen: `window` may not exist where this module loads.
const notification = writable<NotificationState>({ on: false, blocked: false }, (set) => {
    set(savedNotificationState());
});

/** The browser notification switch: what it shows, and whether the browser blocked it. */
export const notificationState: Readable<NotificationState> = { subscribe: notification.subscribe };

/**
 * Changes the browser notifications. The switch shows the asked value at once, then what the browser granted, as it
 * may refuse; a failure is reported and the switch goes back to what is saved, with the browser's block read again.
 */
export function changeNotification(on: boolean): void {
    notification.update((state) => ({ ...state, on }));
    setNotification(on)
        .then((granted) => {
            notification.set({ on: granted, blocked: notificationsBlocked() });
        })
        .catch((error: unknown) => {
            console.error("[konclui] preferences: notifications", error);
            notification.set(savedNotificationState());
        });
}
