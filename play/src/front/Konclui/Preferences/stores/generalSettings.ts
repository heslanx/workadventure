import { derived, get, type Readable } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { connectionManager } from "../../../Connection/ConnectionManager";
import { localUserStore } from "../../../Connection/LocalUserStore";
import type { Locales } from "../../../../i18n/i18n-types";
import { invitePreferencesStore, setInviteEntryPoint } from "../../../Stores/InvitePreferencesStore";
import {
    handleOpenMenuEvent,
    menuVisiblilityStore,
    showMenuItem,
    subMenusStore,
    type MenuItem,
} from "../../../Stores/MenuStore";
import { onboardingStore } from "../../../Stores/OnboardingStore";
import { setCurrentLocale } from "../../../Utils/locales";

// The general settings and the ways out to upstream's own views, as upstream's settings, profile menu and invite
// write them (SettingsSubMenu.svelte, ProfileMenuContent.svelte, GuestSubMenu.svelte, HelpSubMenu.svelte).

export function setLanguage(locale: Locales): void {
    setCurrentLocale(locale).catch((error: unknown) => console.error("[konclui] preferences: language", error));
}

/** Whether the page can go full screen: an iPhone has no Fullscreen API, and an iframe may not be allowed it. */
export function fullscreenAvailable(): boolean {
    return document.fullscreenEnabled;
}

/** Whether the page is full screen now, whichever way it got there or left (Esc, F11, the browser's own button). */
export function isFullscreen(): boolean {
    return document.fullscreenElement !== null;
}

/**
 * Enters or leaves full screen now and saves the choice, which upstream applies again at the next visit. The
 * promise rejects when the browser refuses; then the choice is not saved.
 */
export async function setFullscreen(on: boolean): Promise<void> {
    analyticsClient.trackAdminEvent("settings.fullscreen.changed", { value: on ? "true" : "false" });
    if (!on && isFullscreen()) {
        await document.exitFullscreen();
    } else if (on && !isFullscreen()) {
        await document.documentElement.requestFullscreen();
    }
    localUserStore.setFullscreen(on);
}

/** Saves full screen off after the page left it another way (Esc, F11, the browser's button). */
export function keepFullscreenOff(): void {
    if (localUserStore.getFullscreen()) localUserStore.setFullscreen(false);
}

/** The first visit's guided tour, again. */
export function restartTour(): void {
    onboardingStore.restart();
}

/**
 * Opens one of upstream's menu views (its credits, report, contact, account, shortcut editor or a map's own menu).
 * `showMenuItem` closes the menu when it is already open; this switches it to the view instead.
 */
export function openUpstreamMenu(key: string): void {
    if (get(menuVisiblilityStore)) {
        handleOpenMenuEvent(key);
        return;
    }
    showMenuItem(key);
}

/**
 * Upstream's menu views the user can open now: each has a visibility of its own (an account only when signed in, a
 * report page only when the room has one), and a map's scripts add views while it runs.
 */
export const visibleUpstreamMenus: Readable<MenuItem[]> = derived<typeof subMenusStore, MenuItem[]>(
    subMenusStore,
    (items, set) =>
        derived(
            items.map((item) => item.visible),
            (visible) => items.filter((_, index) => visible[index]),
        ).subscribe(set),
    [],
);

/** Whether the room lets the user change the name: an OpenID name policy can force the account's name. */
export function nameIsEditable(): boolean {
    return connectionManager.currentRoom?.opidWokaNamePolicy !== "force_opid";
}

export function logout(): void {
    analyticsClient.trackAdminEvent("auth.logout_clicked");
    connectionManager.logout();
}

export function setInviteWalksToMe(on: boolean): void {
    invitePreferencesStore.update((preferences) => ({ ...preferences, walkAutomatically: on }));
}

export function setInviteChoosesEntry(on: boolean): void {
    invitePreferencesStore.update((preferences) => ({ ...preferences, showZoneSelect: on }));
}

export function setInviteEntry(entryPoint: string): void {
    setInviteEntryPoint(entryPoint);
}

export function reportLinkCopied(): void {
    analyticsClient.trackAdminEvent("invite.sent", { inviteType: "copy_link" });
}
