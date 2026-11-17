// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { shortcutOverridesStore, shortcutsStore } from "../../../Stores/ShortcutsStore";
import ShortcutsPane from "./ShortcutsPane.svelte";

// The shortcut recorder against upstream's real shortcut store: what it records, what it refuses and why, the
// replace that moves keys over, and where the focus goes when the button under it vanishes.

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy(() => keys.join("."), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../../../WebRtc/DeviceUtils", () => ({ isMac: () => false }));

const T = "konclui.preferences.shortcuts";

describe("the shortcut recorder", () => {
    const target = document.createElement("div");
    let pane: ReturnType<typeof mount> | undefined;
    let assign: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        shortcutOverridesStore.resetAll();
        assign = vi.spyOn(shortcutOverridesStore, "assign");
        document.body.append(target);
        pane = mount(ShortcutsPane, { target });
        flushSync();
    });

    afterEach(async () => {
        const mounted = pane;
        pane = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        vi.restoreAllMocks();
        shortcutOverridesStore.resetAll();
        localStorage.clear();
    });

    /** The row of an action, by its title. */
    function row(action: string): HTMLElement {
        const title = [...target.querySelectorAll("b")].find((element) => element.textContent === `${T}.${action}`);
        const item = title?.closest<HTMLElement>(".k-pref-item");
        if (!item) throw new Error(`no row for ${action}`);
        return item;
    }

    function button(action: string, text: string): HTMLButtonElement | undefined {
        return [...row(action).querySelectorAll("button")].find((element) => element.textContent === `${T}.${text}`);
    }

    function changeButton(action: string): HTMLButtonElement {
        const found = [...row(action).querySelectorAll("button")].find(
            (element) => element.textContent === `${T}.change` || element.textContent === `${T}.pressKeys`,
        );
        if (!found) throw new Error(`no change button for ${action}`);
        return found;
    }

    function record(action: string, init: KeyboardEventInit): KeyboardEvent {
        const change = changeButton(action);
        change.focus();
        change.click();
        flushSync();
        const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
        change.dispatchEvent(event);
        flushSync();
        return event;
    }

    const alert = (action: string) => row(action).querySelector('[role="alert"]')?.textContent;

    it("records the keys pressed on the Change button as the action's new shortcut", () => {
        record("follow", { key: "k", code: "KeyK", ctrlKey: true });

        expect(assign).toHaveBeenCalledWith("follow", {
            code: "KeyK",
            label: "K",
            mod: true,
            alt: false,
            shift: false,
        });
        expect(get(shortcutsStore).follow?.code).toBe("KeyK");
    });

    it("lets Tab leave the button instead of recording it", () => {
        const event = record("follow", { key: "Tab", code: "Tab" });

        expect(event.defaultPrevented).toBe(false);
        expect(assign).not.toHaveBeenCalled();
        expect(changeButton("follow").textContent).toBe(`${T}.change`);
        expect(alert("follow")).toBeUndefined();
    });

    it("refuses keys the browser keeps for itself", () => {
        record("follow", { key: "t", code: "KeyT", ctrlKey: true });

        expect(alert("follow")).toBe(`${T}.reserved`);
        expect(assign).not.toHaveBeenCalled();
    });

    it("refuses a key a fixed shortcut uses", () => {
        record("follow", { key: " ", code: "Space" });

        expect(alert("follow")).toBe(`${T}.fixedTaken`);
        expect(assign).not.toHaveBeenCalled();
    });

    it("offers to move keys another action uses, and keeps the focus on the row when Replace goes", () => {
        record("follow", { key: "c", code: "KeyC" });
        expect(alert("follow")).toBe(`${T}.taken`);
        expect(assign).not.toHaveBeenCalled();

        const replace = button("follow", "replace");
        replace?.focus();
        replace?.click();
        flushSync();

        expect(assign).toHaveBeenCalledWith(
            "follow",
            { code: "KeyC", label: "C", mod: false, alt: false, shift: false },
            "openChat",
        );
        expect(get(shortcutsStore).openChat).toBeNull();
        expect(button("follow", "replace")).toBeUndefined();
        expect(document.activeElement).toBe(changeButton("follow"));
    });

    it("keeps the focus on the row when its Reset button goes", () => {
        record("follow", { key: "k", code: "KeyK", ctrlKey: true });
        const reset = button("follow", "reset");
        reset?.focus();

        reset?.click();
        flushSync();

        expect(get(shortcutsStore).follow?.code).toBe("KeyF");
        expect(button("follow", "reset")).toBeUndefined();
        expect(document.activeElement).toBe(changeButton("follow"));
    });

    it("moves the focus to the first Change button when the reset-all row goes", () => {
        record("openChat", { key: "k", code: "KeyK", ctrlKey: true });
        const resetAll = [...target.querySelectorAll<HTMLButtonElement>(".k-pref-row")].find((element) =>
            element.textContent?.includes(`${T}.resetAll`),
        );
        resetAll?.focus();

        resetAll?.click();
        flushSync();

        expect(get(shortcutsStore).openChat?.code).toBe("KeyC");
        expect(target.querySelector(".k-pref-row")).toBeNull();
        expect(document.activeElement).toBe(changeButton("walkMyDesk"));
    });
});
