// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/unbound-method -- expect() on vi.fn() members of module mocks */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import {
    askBeforeOpeningSites,
    changeNotification,
    ignoreFollowRequests,
    notificationState,
    type NotificationState,
} from "./notificationSettings";

// What upstream saves must read back as the dialog wrote it, and the browser notification switch must end as what
// the browser allowed, not as what was asked.

const saved = vi.hoisted(() => ({ notification: false, askSites: false, ignoreFollow: false }));

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: {
        getNotification: () => saved.notification,
        setNotification: (value: boolean) => {
            saved.notification = value;
        },
        getForceCowebsiteTrigger: () => saved.askSites,
        setForceCowebsiteTrigger: (value: boolean) => {
            saved.askSites = value;
        },
        getIgnoreFollowRequests: () => saved.ignoreFollow,
        setIgnoreFollowRequests: (value: boolean) => {
            saved.ignoreFollow = value;
        },
    },
}));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Stores/BrowserNotificationStore", () => ({ browserNotificationStore: { refresh: vi.fn() } }));

describe("the request settings", () => {
    afterEach(() => {
        saved.askSites = false;
        saved.ignoreFollow = false;
        vi.clearAllMocks();
    });

    it("reads back what 'ask before opening sites' saved, and reports the change", () => {
        expect(get(askBeforeOpeningSites)).toBe(false);

        askBeforeOpeningSites.set(true);

        expect(get(askBeforeOpeningSites)).toBe(true);
        expect(analyticsClient.trackAdminEvent).toHaveBeenCalledWith("settings.ask_website.changed", {
            value: "true",
        });

        askBeforeOpeningSites.set(false);

        expect(get(askBeforeOpeningSites)).toBe(false);
        expect(analyticsClient.trackAdminEvent).toHaveBeenLastCalledWith("settings.ask_website.changed", {
            value: "false",
        });
    });

    it("reads back what 'ignore follow requests' saved, and reports the change", () => {
        expect(get(ignoreFollowRequests)).toBe(false);

        ignoreFollowRequests.set(true);

        expect(get(ignoreFollowRequests)).toBe(true);
        expect(analyticsClient.trackAdminEvent).toHaveBeenCalledWith("settings.request_follow.changed", {
            value: "true",
        });
        expect(get(askBeforeOpeningSites)).toBe(false);
    });
});

describe("the browser notification switch", () => {
    let permission: string;
    let answer: () => Promise<string>;
    let shown: NotificationState[];
    let unsubscribe: () => void;

    /** A browser that asks the user for `answer`, and blocks the site for good once it was refused. */
    function browser(start: string, reply: () => Promise<string>): void {
        permission = start;
        answer = reply;
        vi.stubGlobal("Notification", {
            get permission() {
                return permission;
            },
            requestPermission: () =>
                answer().then((result) => {
                    permission = result;
                    return result;
                }),
        });
    }

    /** Watches the switch as a pane does, from the first read to the end of the test. */
    function watch(): NotificationState {
        unsubscribe = notificationState.subscribe((state) => shown.push(state));
        return shown[0];
    }

    beforeEach(() => {
        shown = [];
    });

    afterEach(() => {
        unsubscribe?.();
        saved.notification = false;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("starts as saved, where the browser has notifications and has not blocked the site", () => {
        browser("default", () => Promise.resolve("granted"));
        saved.notification = true;

        expect(watch()).toEqual({ on: true, blocked: false });
    });

    it("starts off where the browser has no notifications", () => {
        // jsdom has no Notification, as an iPhone's Safari tab has none.
        saved.notification = true;

        expect(watch()).toEqual({ on: false, blocked: false });
    });

    it("starts off and blocked where the browser blocked the site, whatever was saved", () => {
        browser("denied", () => Promise.resolve("denied"));
        saved.notification = true;

        expect(watch()).toEqual({ on: false, blocked: true });
    });

    it("shows the asked value at once, then on once the browser granted it, and saves it", async () => {
        browser("default", () => Promise.resolve("granted"));
        watch();

        changeNotification(true);

        expect(shown.at(-1)).toEqual({ on: true, blocked: false });
        expect(saved.notification).toBe(false);
        await vi.waitFor(() => expect(saved.notification).toBe(true));
        expect(shown.at(-1)).toEqual({ on: true, blocked: false });
    });

    it("goes back to off and blocked once the browser refused", async () => {
        browser("default", () => Promise.resolve("denied"));
        watch();

        changeNotification(true);

        expect(shown.at(-1)).toEqual({ on: true, blocked: false });
        await vi.waitFor(() => expect(shown.at(-1)).toEqual({ on: false, blocked: true }));
        expect(saved.notification).toBe(false);
    });

    it("turns off without asking the browser", async () => {
        browser("granted", () => Promise.reject(new Error("must not ask")));
        saved.notification = true;
        watch();

        changeNotification(false);

        await vi.waitFor(() => expect(saved.notification).toBe(false));
        expect(shown.at(-1)).toEqual({ on: false, blocked: false });
    });

    it("reports a failure and goes back to the saved value", async () => {
        const failure = new Error("the browser failed");
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        browser("default", () => Promise.reject(failure));
        watch();

        changeNotification(true);

        expect(shown.at(-1)).toEqual({ on: true, blocked: false });
        await vi.waitFor(() => expect(shown.at(-1)).toEqual({ on: false, blocked: false }));
        expect(error).toHaveBeenCalledWith("[konclui] preferences: notifications", failure);
        expect(saved.notification).toBe(false);
    });

    it("shows the block when the browser blocked the site and then failed", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        browser("default", () => Promise.resolve("denied"));
        // The browser records the refusal, then the request itself fails.
        vi.stubGlobal("Notification", {
            get permission() {
                return permission;
            },
            requestPermission: () => {
                permission = "denied";
                return Promise.reject(new Error("the browser failed"));
            },
        });
        watch();
        expect(shown[0]).toEqual({ on: false, blocked: false });

        changeNotification(true);

        await vi.waitFor(() => expect(shown.at(-1)).toEqual({ on: false, blocked: true }));
        expect(saved.notification).toBe(false);
    });
});
