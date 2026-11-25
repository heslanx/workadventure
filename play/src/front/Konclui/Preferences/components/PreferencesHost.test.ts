// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { trackFormFocus } from "../../../Utils/trackFormFocus";
import { stubWebAnimations, type WebAnimationsStub } from "../../../Utils/webAnimationsStub";
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
// The section row follows a media query; jsdom has no matchMedia, so the dialog sees a wide screen. A test that needs
// another answer (a viewer who reduces motion, a pointer that hovers) stubs it again and puts this one back.
const matchMediaWhere = (answer: (query: string) => boolean) =>
    vi.fn((query: string) => ({
        matches: answer(query),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
vi.stubGlobal(
    "matchMedia",
    matchMediaWhere(() => false),
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

    it("closes on a press on the scrim around it, and not on a press inside the box", () => {
        openFromGear();
        const scrim = target.querySelector<HTMLElement>(".k-prefs-scrim");

        dialog()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        flushSync();
        expect(dialog()).not.toBeNull();

        scrim?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
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

    describe("its entrance and its exit", () => {
        let animations: WebAnimationsStub;

        beforeEach(() => {
            animations = stubWebAnimations();
        });

        afterEach(() => {
            animations.restore();
            vi.stubGlobal(
                "matchMedia",
                matchMediaWhere(() => false),
            );
        });

        const scrim = () => target.querySelector<HTMLElement>(".k-prefs-scrim");
        const dim = () => target.querySelector<HTMLElement>(".k-prefs-dim");
        const durations = () => animations.moving().map((animation) => animation.options.duration);
        const openAndSettle = async (pane?: string) => {
            openFromGear(pane);
            await animations.settle();
            await animations.finishMoving();
        };

        it("arrives on the surface transition, the box and its dimming together, the scrim not at all", async () => {
            openFromGear();
            await animations.settle();

            expect(durations()).toEqual([290, 290]);
            expect(dialog()?.classList.contains("k-enter")).toBe(false);
            expect(dim()?.getAttribute("aria-hidden")).toBe("true");
        });

        it("stays in the page for the length of its exit: the box and the dimming out of reach, the scrim not", async () => {
            await openAndSettle();

            closePreferences();
            flushSync();
            await animations.settle();

            expect(dialog()).not.toBeNull();
            expect(dialog()?.inert).toBe(true);
            expect(dim()?.inert).toBe(true);
            // A press on the leaving dialog falls to the scrim, which takes it, and not through to the game.
            expect(scrim()).not.toBeNull();
            expect(scrim()?.inert).not.toBe(true);
            expect(scrim()?.contains(dialog())).toBe(true);
            expect(durations()).toEqual([200, 200]);
            expect(document.activeElement).toBe(gear);

            await animations.finishMoving();

            expect(dialog()).toBeNull();
            expect(scrim()).toBeNull();
            expect(document.activeElement).toBe(gear);
        });

        it("takes a press on the scrim during the exit without doing anything to a dialog that is already closed", async () => {
            await openAndSettle();
            closePreferences();
            flushSync();
            await animations.settle();

            scrim()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            flushSync();

            expect(get(preferencesStore).open).toBe(false);
            expect(document.activeElement).toBe(gear);
            expect(dialog()).not.toBeNull();
        });

        it("leaves the keys of the page alone while it leaves: Tab and Escape on the opener are the page's own", async () => {
            await openAndSettle();
            closePreferences();
            flushSync();
            await animations.settle();
            expect(dialog()).not.toBeNull();

            // None is taken by the box that is still on its way out: a Tab from the opener goes where the browser takes
            // it (a Shift+Tab too, which the box would send to its last control), and an Escape goes on to the page.
            const taken = (key: string, init: KeyboardEventInit = {}): boolean => {
                const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
                gear.dispatchEvent(event);
                return event.defaultPrevented;
            };

            expect(taken("Tab")).toBe(false);
            expect(taken("Tab", { shiftKey: true })).toBe(false);
            expect(taken("Escape")).toBe(false);
            expect(document.activeElement).toBe(gear);
        });

        it("keeps the sections it showed while it leaves", async () => {
            await openAndSettle("shortcuts");

            closePreferences();
            flushSync();
            await animations.settle();

            expect(tab("shortcuts")?.getAttribute("aria-selected")).toBe("true");
            expect(target.querySelector("h2")?.textContent).toBe("konclui.preferences.panes.shortcuts");
        });

        it("leaves in the same flush, with nothing to hold, for a viewer who reduces motion", async () => {
            await openAndSettle();
            vi.stubGlobal(
                "matchMedia",
                matchMediaWhere((query) => query.includes("reduce")),
            );
            const before = animations.animations.length;

            closePreferences();
            flushSync();

            expect(dialog()).toBeNull();
            expect(scrim()).toBeNull();
            expect(animations.animations.length).toBe(before);
            expect(document.activeElement).toBe(gear);
        });

        it("appears at its final state, with no animation, for a viewer who reduces motion", async () => {
            vi.stubGlobal(
                "matchMedia",
                matchMediaWhere((query) => query.includes("reduce")),
            );

            openFromGear();
            await animations.settle();

            expect(dialog()).not.toBeNull();
            expect(animations.animations).toHaveLength(0);
        });

        it("is the same dialog when it is opened again during its exit, and takes the focus on its section's tab", async () => {
            await openAndSettle("media");
            const before = dialog();
            closePreferences();
            flushSync();
            await animations.settle();
            expect(document.activeElement).toBe(gear);

            openFromGear("sounds");
            await animations.settle();

            expect(dialog()).toBe(before);
            expect(tab("sounds")?.getAttribute("aria-selected")).toBe("true");
            expect(document.activeElement).toBe(tab("sounds"));
            await animations.finishMoving();
            expect(dialog()).toBe(before);
        });

        it("does not take the focus back to the tab when a section is chosen while it is open", async () => {
            await openAndSettle();
            const close = target.querySelector<HTMLButtonElement>('button[aria-label="konclui.preferences.close"]');
            close?.focus();

            openPreferences("sounds");
            flushSync();

            expect(document.activeElement).toBe(close);
        });
    });

    describe("its tabs", () => {
        beforeEach(() => {
            vi.stubGlobal(
                "matchMedia",
                matchMediaWhere((query) => query === "(hover: hover)"),
            );
        });

        afterEach(() => {
            vi.stubGlobal(
                "matchMedia",
                matchMediaWhere(() => false),
            );
        });

        it("have one pill under them that follows the pointer, and give under a press, like every control", () => {
            openFromGear();

            const list = target.querySelector('[role="tablist"]');
            expect(list?.classList.contains("k-glide")).toBe(true);
            expect(list?.classList.contains("k-glide-on")).toBe(true);
            expect(list?.querySelectorAll(".k-glide-pill")).toHaveLength(1);
            expect(
                [...target.querySelectorAll('[role="tab"]')].every((element) => element.classList.contains("k-press")),
            ).toBe(true);
            expect(target.querySelector(".k-prefs-close")?.classList.contains("k-press")).toBe(true);
        });

        it("keep their own hover where there is no hover to follow", () => {
            vi.stubGlobal(
                "matchMedia",
                matchMediaWhere(() => false),
            );
            openFromGear();

            expect(target.querySelector(".k-glide-pill")).toBeNull();
            expect(target.querySelector('[role="tablist"]')?.classList.contains("k-glide-on")).toBe(false);
        });
    });
});
