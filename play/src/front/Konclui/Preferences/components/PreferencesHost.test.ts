// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { trackFormFocus } from "../../../Utils/trackFormFocus";
import { closePreferences, openPreferences, preferencesStore } from "../stores/preferencesStore";
import PreferencesHost from "./PreferencesHost.svelte";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every key reads as its own path, so a test finds a text by the key that names it.
    const path = (keys: string[]): unknown =>
        new Proxy(() => keys.join("."), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
// The section row follows a media query; jsdom has no matchMedia, so the dialog sees a wide screen.
vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })),
);
// The sections have tests of their own: here each one is an empty stand-in.
vi.mock("./GeneralPane.svelte", () => ({ default: () => undefined }));
vi.mock("./MediaPane.svelte", () => ({ default: () => undefined }));
vi.mock("./SoundsPane.svelte", () => ({ default: () => undefined }));
vi.mock("./NotificationsPane.svelte", () => ({ default: () => undefined }));
vi.mock("./MiniPane.svelte", () => ({ default: () => undefined }));
vi.mock("./PerformancePane.svelte", () => ({ default: () => undefined }));
vi.mock("./ShortcutsPane.svelte", () => ({ default: () => undefined }));
vi.mock("./ProfilePane.svelte", () => ({ default: () => undefined }));

describe("the preferences dialog", () => {
    const target = document.createElement("div");
    let host: ReturnType<typeof mount> | undefined;
    let gear: HTMLButtonElement;

    beforeEach(() => {
        gear = document.createElement("button");
        document.body.append(gear, target);
        host = mount(PreferencesHost, { target });
    });

    afterEach(async () => {
        closePreferences();
        const mounted = host;
        host = undefined;
        if (mounted) await unmount(mounted);
        document.body.replaceChildren();
        target.replaceChildren();
    });

    const dialog = () => target.querySelector<HTMLElement>('[role="dialog"]');
    const tab = (pane: string) => target.querySelector<HTMLButtonElement>(`[role="tab"][id$="-tab-${pane}"]`);
    const press = (element: Element, key: string, init: KeyboardEventInit = {}) => {
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
        flushSync();
    };
    const openFromGear = (pane?: string) => {
        gear.focus();
        openPreferences(pane);
        flushSync();
    };

    it("stays closed until something opens it", () => {
        flushSync();
        expect(dialog()).toBeNull();
    });

    it("opens as a labelled modal dialog on the section asked for, with the focus on its tab", () => {
        openFromGear("shortcuts");

        expect(dialog()?.getAttribute("aria-modal")).toBe("true");
        expect(dialog()?.getAttribute("aria-label")).toBe("konclui.preferences.dialog");
        expect(tab("shortcuts")?.getAttribute("aria-selected")).toBe("true");
        expect(tab("general")?.getAttribute("aria-selected")).toBe("false");
        expect(document.activeElement).toBe(tab("shortcuts"));
        expect(target.querySelector("h2")?.textContent).toBe("konclui.preferences.panes.shortcuts");
    });

    it("closes on Escape and gives the focus back to the opener", () => {
        openFromGear();

        press(tab("general") as HTMLElement, "Escape");

        expect(get(preferencesStore).open).toBe(false);
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(gear);
    });

    it("closes from its close button too", () => {
        openFromGear();

        target.querySelector<HTMLButtonElement>('button[aria-label="konclui.preferences.close"]')?.click();
        flushSync();

        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(gear);
    });

    it("moves between sections with the arrow keys, wrapping at the ends", () => {
        openFromGear();

        press(tab("general") as HTMLElement, "ArrowDown");
        expect(tab("media")?.getAttribute("aria-selected")).toBe("true");
        expect(document.activeElement).toBe(tab("media"));
        expect(tab("media")?.tabIndex).toBe(0);
        expect(tab("general")?.tabIndex).toBe(-1);

        press(tab("media") as HTMLElement, "ArrowUp");
        press(tab("general") as HTMLElement, "ArrowUp");
        expect(document.activeElement).toBe(tab("profile"));
        expect(get(preferencesStore).pane).toBe("profile");

        press(tab("profile") as HTMLElement, "Home");
        expect(get(preferencesStore).pane).toBe("general");
    });

    it("holds the game's keys through upstream's form-focus tracking while the focus is inside", () => {
        // MainLayout.svelte runs this on the page and writes the result to inputFormFocusStore, which the game reads.
        const held: boolean[] = [];
        const stopTracking = trackFormFocus(document, (focused) => held.push(focused));
        try {
            openFromGear();
            expect(held.at(-1)).toBe(true);

            press(tab("general") as HTMLElement, "ArrowDown");
            expect(document.activeElement).toBe(tab("media"));
            expect(held.at(-1)).toBe(true);

            dialog()?.focus();
            expect(held.at(-1)).toBe(true);

            press(tab("media") as HTMLElement, "Escape");
            expect(document.activeElement).toBe(gear);
            expect(held.at(-1)).toBe(false);
        } finally {
            stopTracking();
        }
    });

    it("closes on Escape and brings Tab back in when the focus fell out of the dialog", () => {
        openFromGear();
        (document.activeElement as HTMLElement).blur();
        expect(document.activeElement).toBe(document.body);

        press(document.body, "Tab");
        expect(document.activeElement).toBe(tab("general"));

        (document.activeElement as HTMLElement).blur();
        press(document.body, "Escape");
        expect(dialog()).toBeNull();
        expect(document.activeElement).toBe(gear);
    });

    it("enters at the last control on Shift+Tab from the box itself", () => {
        openFromGear();
        dialog()?.focus();

        press(dialog() as HTMLElement, "Tab", { shiftKey: true });

        expect(document.activeElement).toBe(target.querySelector('button[aria-label="konclui.preferences.close"]'));
    });

    it("keeps Tab inside the dialog", () => {
        openFromGear();
        const close = target.querySelector<HTMLButtonElement>('button[aria-label="konclui.preferences.close"]');
        close?.focus();

        press(close as HTMLElement, "Tab");
        expect(document.activeElement).toBe(tab("general"));

        press(tab("general") as HTMLElement, "Tab", { shiftKey: true });
        expect(document.activeElement).toBe(close);
    });
});
