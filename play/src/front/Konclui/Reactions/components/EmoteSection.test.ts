// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { Emoji } from "../../../Stores/Utils/emojiSchema";
import { emoteCatalogue } from "../domain/emoteCatalogue";
import { EMOTE_COOLDOWN_MS } from "../domain/emoteCooldown";
import EmoteSection from "./EmoteSection.svelte";

// The three stores of the app the section and the sender read and write.
const app = await vi.hoisted(async () => {
    const { writable } = await import("svelte/store");
    return {
        emoteStore: writable<Emoji | null>(null),
        emoteMenuStore: writable(false),
        enableUserInputsStore: writable(true),
    };
});

vi.mock("../../../Stores/EmoteStore", () => ({ emoteStore: app.emoteStore, emoteMenuStore: app.emoteMenuStore }));
vi.mock("../../../Stores/UserInputStore", () => ({ enableUserInputsStore: app.enableUserInputsStore }));
// The texts read as their keys: the words themselves are checked against the real locales in reactionsTexts.test.ts.
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])) };
});

const WIRE_LV = "\u{1F4AC}\u{E006B}\u{E006C}\u{E0076}\u{E007F}";

describe("EmoteSection", () => {
    let target: HTMLElement;
    let mounted: ReturnType<typeof mount> | undefined;
    let sent: Emoji[];
    let stopListening: () => void;

    // One clock for the whole file, which only runs forward: the cooldown lives in a module that the tests share, and a
    // test that starts ten seconds after the last one starts with the cooldown over.
    beforeAll(() => {
        vi.useFakeTimers();
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    beforeEach(() => {
        vi.advanceTimersByTime(10_000);
        app.emoteStore.set(null);
        app.emoteMenuStore.set(false);
        app.enableUserInputsStore.set(true);
        sent = [];
        stopListening = app.emoteStore.subscribe((emoji) => {
            if (emoji) sent.push(emoji);
        });
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(async () => {
        const component = mounted;
        mounted = undefined;
        if (component) await unmount(component);
        target.remove();
        stopListening();
        vi.restoreAllMocks();
    });

    function show(): void {
        mounted = mount(EmoteSection, { target });
        flushSync();
    }

    const buttons = () => [...target.querySelectorAll<HTMLButtonElement>("button")];
    const button = (id: string) => target.querySelector<HTMLButtonElement>(`[data-testid="konclui-emote-${id}"]`);
    const status = () => target.querySelector('[data-testid="konclui-emotes-status"]')?.textContent ?? "";
    const press = (id: string) => {
        button(id)?.click();
        flushSync();
    };

    describe("what it draws", () => {
        it("offers the 26 emotes in a toolbar, each a button named by its label and drawn by its art", () => {
            show();

            const toolbar = target.querySelector('[role="toolbar"]');
            expect(toolbar?.getAttribute("aria-label")).toBe("konclui.reactions.title");
            expect(buttons().map((each) => each.getAttribute("aria-label"))).toEqual(
                emoteCatalogue.map((emote) => `konclui.reactions.emote.${emote.id}`),
            );
            expect(buttons().every((each) => each.type === "button")).toBe(true);
            expect(button("lv")?.querySelector("img")?.getAttribute("src")).toBe(emoteCatalogue[4].art);
            expect(button("lv")?.querySelector("img")?.getAttribute("alt")).toBe("");
        });

        it("makes one tab stop of the grid, on the first emote", () => {
            show();

            expect(buttons().filter((each) => each.tabIndex === 0)).toEqual([buttons()[0]]);
        });

        it("keeps a line for the status in the page from the start, empty while nothing needs saying", () => {
            show();

            const line = target.querySelector('[data-testid="konclui-emotes-status"]');
            expect(line?.getAttribute("role")).toBe("status");
            expect(line?.textContent).toBe("");
            expect(buttons().some((each) => each.hasAttribute("aria-disabled"))).toBe(false);
        });
    });

    describe("sending", () => {
        it("sends the emote the moment it is pressed, as the message the server relays", () => {
            show();

            press("lv");

            expect(sent).toEqual([{ emoji: WIRE_LV, name: "lv" }]);
        });

        it("marks the emote that left and says so, within the press", () => {
            show();

            press("lv");

            expect(button("lv")?.getAttribute("data-sent")).toBe("true");
            expect(button("ok")?.hasAttribute("data-sent")).toBe(false);
            expect(status()).toContain("konclui.reactions.sent");
            expect(status()).toContain("konclui.reactions.emote.lv");
        });

        it("keeps every emote focusable but unavailable during the cooldown, and points each at the reason", () => {
            show();
            press("lv");

            const statusLine = target.querySelector('[data-testid="konclui-emotes-status"]');
            for (const each of buttons()) {
                expect(each.getAttribute("aria-disabled")).toBe("true");
                expect(each.disabled).toBe(false);
                expect(each.getAttribute("aria-describedby")).toBe(statusLine?.id);
            }
        });

        it("sends nothing for a press during the cooldown, and says to wait", () => {
            show();
            press("lv");

            press("ok");

            expect(sent).toHaveLength(1);
            expect(status()).toContain("konclui.reactions.wait");
        });

        it("makes every emote available again, and the message gone, when the cooldown ends", () => {
            show();
            press("lv");
            press("ok");

            vi.advanceTimersByTime(EMOTE_COOLDOWN_MS);
            flushSync();

            expect(status()).toBe("");
            expect(buttons().some((each) => each.hasAttribute("aria-disabled"))).toBe(false);
            press("ok");
            expect(sent.map((emoji) => emoji.name)).toEqual(["lv", "ok"]);
        });

        it("says that the next emote left, not that it was too soon, when the earlier press is long forgotten", () => {
            show();
            press("lv");
            press("ok");
            vi.advanceTimersByTime(EMOTE_COOLDOWN_MS);
            flushSync();

            press("ok");

            expect(status()).toContain("konclui.reactions.sent");
            expect(status()).not.toContain("konclui.reactions.wait");
        });

        it("says why the emotes wait when it is opened during a cooldown, not just that they dim", async () => {
            show();
            press("lv");
            await unmount(mounted as ReturnType<typeof mount>);

            show();

            expect(status()).toContain("konclui.reactions.sent");
            expect(button("ok")?.getAttribute("aria-disabled")).toBe("true");
        });

        it("sends nothing and says why while the reactions are being edited", () => {
            show();
            app.emoteMenuStore.set(true);
            flushSync();

            press("lv");

            expect(sent).toHaveLength(0);
            expect(status()).toBe("konclui.reactions.editing");
            expect(button("lv")?.getAttribute("aria-disabled")).toBe("true");
        });

        it("sends nothing and says why while the player's keys belong to something else", () => {
            show();
            app.enableUserInputsStore.set(false);
            flushSync();

            press("lv");

            expect(sent).toHaveLength(0);
            expect(status()).toBe("konclui.reactions.blocked");
        });

        it("becomes available again when what held it ends", () => {
            show();
            app.emoteMenuStore.set(true);
            flushSync();
            app.emoteMenuStore.set(false);
            flushSync();

            expect(status()).toBe("");
            press("lv");
            expect(sent).toHaveLength(1);
        });
    });

    describe("the keyboard", () => {
        const key = (id: string, name: string): KeyboardEvent => {
            const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
            button(id)?.dispatchEvent(event);
            flushSync();
            return event;
        };

        it("moves the focus along the grid with the arrows, and the tab stop with it", () => {
            show();
            button("exc")?.focus();

            key("exc", "ArrowRight");

            expect(document.activeElement).toBe(button("que"));
            expect(button("que")?.tabIndex).toBe(0);
            expect(button("exc")?.tabIndex).toBe(-1);
        });

        it("moves to the first and the last emote with Home and End", () => {
            show();
            button("exc")?.focus();

            key("exc", "End");
            expect(document.activeElement).toBe(button("zzz"));

            key("zzz", "Home");
            expect(document.activeElement).toBe(button("exc"));
        });

        it("moves down to the emote below, where the grid has rows", () => {
            // jsdom lays nothing out: give the 26 buttons the places of a grid nine wide.
            vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
                const index = emoteCatalogue.findIndex((emote) => `konclui-emote-${emote.id}` === this.dataset.testid);
                return { left: (index % 9) * 48, top: Math.floor(index / 9) * 48, width: 40, height: 40 } as DOMRect;
            });
            show();
            button("exc")?.focus();

            key("exc", "ArrowDown");

            // The first emote is at index 0, so the one below it, nine on, is "sob".
            expect(document.activeElement).toBe(button("sob"));
        });

        it("keeps the arrow keys, Home, End, Enter and Space from the game, which walks and acts on them", () => {
            const reachedTheGame = vi.fn();
            window.addEventListener("keydown", reachedTheGame);
            show();
            button("exc")?.focus();

            for (const name of ["ArrowRight", "ArrowUp", "Home", "End", "Enter", " "]) {
                key("que", name);
            }
            window.removeEventListener("keydown", reachedTheGame);

            expect(reachedTheGame).not.toHaveBeenCalled();
        });

        it("lets other keys through, so the game's own shortcuts keep working from the grid", () => {
            const reachedTheGame = vi.fn();
            window.addEventListener("keydown", reachedTheGame);
            show();

            key("exc", "m");
            window.removeEventListener("keydown", reachedTheGame);

            expect(reachedTheGame).toHaveBeenCalledTimes(1);
        });

        it("sends the focused emote on Enter and Space as a button does, through its click", () => {
            show();
            button("lv")?.focus();

            button("lv")?.click();
            flushSync();

            expect(sent.map((emoji) => emoji.name)).toEqual(["lv"]);
        });

        /** What the keyboard does with whatever holds the focus: the key goes to that element and bubbles up. */
        const pressOnFocused = (name: string): KeyboardEvent => {
            const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
            (document.activeElement ?? document.body).dispatchEvent(event);
            flushSync();
            return event;
        };

        it("hands the arrow keys back to the game after a click of the pointer, which leaves the focus on the button", () => {
            const reachedTheGame = vi.fn();
            window.addEventListener("keydown", reachedTheGame);
            show();
            // A browser focuses the button when the pointer goes down, and clicks it when the pointer is up: `detail` is
            // the number of clicks, which is 0 for a click that the keyboard makes.
            button("lv")?.focus();
            button("lv")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
            flushSync();

            pressOnFocused("ArrowRight");
            window.removeEventListener("keydown", reachedTheGame);

            expect(sent.map((emoji) => emoji.name)).toEqual(["lv"]);
            expect(document.activeElement).not.toBe(button("lv"));
            expect(reachedTheGame).toHaveBeenCalledTimes(1);
        });

        it("keeps the focus, and the arrow keys from the game, after the keyboard sends an emote", () => {
            const reachedTheGame = vi.fn();
            window.addEventListener("keydown", reachedTheGame);
            show();
            button("lv")?.focus();
            // `click()` is what Enter and Space do to a focused button: a click with no pointer.
            button("lv")?.click();
            flushSync();

            const arrow = pressOnFocused("ArrowRight");
            window.removeEventListener("keydown", reachedTheGame);

            expect(sent.map((emoji) => emoji.name)).toEqual(["lv"]);
            // The arrow moved the focus to the emote after "lv" in the grid, so the grid kept the key.
            expect(document.activeElement).toBe(button("lv2"));
            expect(arrow.defaultPrevented).toBe(true);
            expect(reachedTheGame).not.toHaveBeenCalled();
        });

        it("hands the arrow keys back after a click of the pointer that sent nothing, as the cooldown holds the emotes", () => {
            const reachedTheGame = vi.fn();
            window.addEventListener("keydown", reachedTheGame);
            show();
            press("lv");
            button("ok")?.focus();
            button("ok")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
            flushSync();

            pressOnFocused("ArrowDown");
            window.removeEventListener("keydown", reachedTheGame);

            expect(sent).toHaveLength(1);
            expect(reachedTheGame).toHaveBeenCalledTimes(1);
        });
    });
});
