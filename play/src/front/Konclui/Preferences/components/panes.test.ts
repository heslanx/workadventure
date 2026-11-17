// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/unbound-method -- expect() on vi.fn() members of module mocks */
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount, type Component } from "svelte";
import { get } from "svelte/store";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { allowPictureInPictureStore } from "../../../Stores/PeerStore";
import { FEATURES_KEY, parseFeatures } from "../domain/effectSwitches";
import { pauseTileAnimations } from "../stores/gameCommands";
import { closePreferences } from "../stores/preferencesStore";
import MiniPane from "./MiniPane.svelte";
import NotificationsPane from "./NotificationsPane.svelte";
import PerformancePane from "./PerformancePane.svelte";

// One section per kind of storage: a saved setting (localUserStore), an upstream store, and the effect switches in
// localStorage. Each test presses a switch and checks the write went through the API upstream's own screen uses.

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy(() => keys.join("."), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: {
        getNotification: vi.fn(() => false),
        setNotification: vi.fn(),
        getForceCowebsiteTrigger: vi.fn(() => false),
        setForceCowebsiteTrigger: vi.fn(),
        getIgnoreFollowRequests: vi.fn(() => false),
        setIgnoreFollowRequests: vi.fn(),
        getDisableAnimations: vi.fn(() => false),
        setDisableAnimations: vi.fn(),
    },
}));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Stores/BrowserNotificationStore", () => ({ browserNotificationStore: { refresh: vi.fn() } }));
vi.mock("../../../Stores/PeerStore", async () => {
    const { writable } = await import("svelte/store");
    const allow = writable(true);
    return {
        allowPictureInPictureStore: { subscribe: allow.subscribe, set: vi.fn(allow.set) },
        askPictureInPictureActivatingStore: writable(false),
        pictureInPictureSupportedStore: writable(true),
    };
});
vi.mock("../../../Stores/StreamableCollectionStore", async () => {
    const { writable } = await import("svelte/store");
    return { isInRemoteConversation: writable(false) };
});
vi.mock("../stores/preferencesStore", () => ({ closePreferences: vi.fn() }));
vi.mock("../stores/gameCommands", () => ({ pauseTileAnimations: vi.fn() }));

describe("the preference sections", () => {
    const target = document.createElement("div");
    let pane: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mounted = pane;
        pane = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        localStorage.clear();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    function show(component: Component): void {
        document.body.append(target);
        pane = mount(component, { target });
        flushSync();
    }

    /** The switch whose title is the text of `key`. */
    function switchFor(key: string): HTMLButtonElement {
        const title = [...target.querySelectorAll("b")].find((element) => element.textContent === key);
        const button = target.querySelector<HTMLButtonElement>(`[role="switch"][aria-labelledby="${title?.id}"]`);
        if (!button) throw new Error(`no switch titled ${key}`);
        return button;
    }

    function press(button: HTMLButtonElement): void {
        button.click();
        flushSync();
    }

    it("saves a localUserStore setting the way upstream's settings do", () => {
        show(NotificationsPane);
        const askSites = switchFor("konclui.preferences.notifications.askSites");
        expect(askSites.getAttribute("aria-checked")).toBe("false");

        press(askSites);

        expect(localUserStore.setForceCowebsiteTrigger).toHaveBeenCalledWith(true);
        expect(askSites.getAttribute("aria-checked")).toBe("true");
        expect(localUserStore.setIgnoreFollowRequests).not.toHaveBeenCalled();
    });

    it("gives every switch its own name, unlike upstream's two cowebsiteTrigger-toggle ids", () => {
        show(NotificationsPane);

        const names = [...target.querySelectorAll('[role="switch"]')].map((element) =>
            element.getAttribute("aria-labelledby"),
        );
        expect(new Set(names).size).toBe(names.length);
    });

    it("keeps the notifications switch focusable and says why where the browser has none", () => {
        show(NotificationsPane);
        const browser = switchFor("konclui.preferences.notifications.browser");

        press(browser);

        expect(browser.getAttribute("aria-disabled")).toBe("true");
        expect(browser.getAttribute("aria-checked")).toBe("false");
        expect(target.textContent).toContain("konclui.preferences.notifications.browserUnsupported");
        expect(localUserStore.setNotification).not.toHaveBeenCalled();
    });

    it("shows the browser's refusal in the switch's hint", async () => {
        const permission = { value: "default" };
        vi.stubGlobal("Notification", {
            get permission() {
                return permission.value;
            },
            requestPermission: vi.fn(() => {
                permission.value = "denied";
                return Promise.resolve("denied");
            }),
        });
        show(NotificationsPane);
        const browser = switchFor("konclui.preferences.notifications.browser");
        expect(target.textContent).not.toContain("browserBlocked");

        press(browser);
        await vi.waitFor(() => {
            flushSync();
            expect(target.textContent).toContain("konclui.preferences.notifications.browserBlocked");
        });

        expect(browser.getAttribute("aria-checked")).toBe("false");
        expect(localUserStore.setNotification).toHaveBeenCalledWith(false);
    });

    it("keeps the mini mode's open-now row, with the reason it cannot open outside a conversation", () => {
        show(MiniPane);
        const row = [...target.querySelectorAll<HTMLButtonElement>(".k-pref-row")].find((element) =>
            element.textContent?.includes("konclui.preferences.mini.openNow"),
        );

        row?.click();
        flushSync();

        expect(row?.getAttribute("aria-disabled")).toBe("true");
        expect(row?.textContent).toContain("konclui.preferences.mini.openNowUnavailable");
        expect(closePreferences).not.toHaveBeenCalled();
    });

    it("writes the mini mode through upstream's store, which saves it", () => {
        show(MiniPane);
        const automatic = switchFor("konclui.preferences.mini.automatic");
        expect(automatic.getAttribute("aria-checked")).toBe("true");

        press(automatic);

        expect(allowPictureInPictureStore.set).toHaveBeenCalledWith(false);
        expect(get(allowPictureInPictureStore)).toBe(false);
        expect(automatic.getAttribute("aria-checked")).toBe("false");
    });

    it("switches an effect through the switches store, which saves it in localStorage for the effects", () => {
        show(PerformancePane);
        const water = switchFor("konclui.preferences.performance.water");
        expect(water.getAttribute("aria-checked")).toBe("true");

        press(water);

        expect(parseFeatures(localStorage.getItem(FEATURES_KEY)).water).toBe(false);
        expect(water.getAttribute("aria-checked")).toBe("false");
    });

    it("chooses an effects level as a radio group and shows a mix of switches as none of them", () => {
        show(PerformancePane);
        const radios = () => [...target.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
        expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);

        press(radios()[0]);
        expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

        press(switchFor("konclui.preferences.performance.water"));
        expect(radios().every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
        expect(target.textContent).toContain("konclui.preferences.performance.custom");
    });

    it("turns the map animations off in the saved setting and in the running map", () => {
        show(PerformancePane);

        press(switchFor("konclui.preferences.performance.animations"));

        expect(localUserStore.setDisableAnimations).toHaveBeenCalledWith(true);
        expect(pauseTileAnimations).toHaveBeenCalledWith(true);
    });

    it("leaves out the vignette, which nothing in this client draws", () => {
        show(PerformancePane);

        expect(target.textContent).not.toContain("vignette");
    });
});
