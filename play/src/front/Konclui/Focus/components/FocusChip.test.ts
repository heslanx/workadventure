// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { Writable } from "svelte/store";
import { isInActiveConversationStore } from "../../../Stores/StreamableCollectionStore";
import { stubWebAnimations, type WebAnimationsStub } from "../../../Utils/webAnimationsStub";
import { endFocus, publishSeat, startFocus } from "../stores/focusStore";
import FocusChip from "./FocusChip.svelte";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../../../Stores/StreamableCollectionStore", async () => {
    const { writable } = await import("svelte/store");
    return { isInActiveConversationStore: writable(false) };
});

const conversation = isInActiveConversationStore as unknown as Writable<boolean>;

describe("FocusChip", () => {
    const target = document.createElement("div");
    let chip: ReturnType<typeof mount> | undefined;
    const returnFocus = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    });

    afterEach(async () => {
        const mounted = chip;
        chip = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        publishSeat(false);
        conversation.set(false);
        returnFocus.mockReset();
        vi.useRealTimers();
    });

    function show(): void {
        document.body.append(target);
        chip = mount(FocusChip, { target, props: { returnFocus } });
        flushSync();
    }

    const status = (): Element => {
        const element = target.querySelector('[role="status"]');
        if (!element) throw new Error("no status region");
        return element;
    };
    const button = (): HTMLButtonElement => {
        const element = target.querySelector("button");
        if (!element) throw new Error("no button");
        return element;
    };
    const chipText = (): string => target.querySelector('[data-testid="konclui-focus-chip"]')?.textContent ?? "";

    describe("offer", () => {
        it("shows nothing while the player stands, and keeps its status region mounted and empty", () => {
            show();

            expect(target.querySelector('[data-testid="konclui-focus-chip"]')).toBeNull();
            expect(target.querySelector("button")).toBeNull();
            expect(status().textContent).toBe("");
            expect(status().getAttribute("aria-live")).toBe("polite");
        });

        it("offers focus when the player sits, with a real button that starts nothing by itself", () => {
            show();

            publishSeat(true);
            flushSync();

            expect(chipText()).toContain("konclui.focus.title");
            expect(chipText()).toContain("konclui.focus.offerHint");
            expect(button().textContent?.trim()).toBe("konclui.focus.start");
            expect(button().type).toBe("button");
            expect(button().disabled).toBe(false);
            expect(button().hasAttribute("aria-disabled")).toBe(false);
            expect(status().textContent).toBe("");
            expect(target.querySelector('[role="timer"]')).toBeNull();
        });
    });

    describe("running", () => {
        it("starts on the click, at once, and the same button now ends it", () => {
            publishSeat(true);
            show();

            button().click();
            flushSync();

            expect(chipText()).toContain("konclui.focus.active");
            expect(chipText()).toContain("konclui.focus.activeHint");
            expect(button().textContent?.trim()).toBe("konclui.focus.end");
        });

        it("keeps the ticking time in its own timer that is not live, and announces the phase without it", () => {
            publishSeat(true);
            startFocus();
            show();

            const timer = target.querySelector('[role="timer"]');
            expect(timer?.getAttribute("aria-live")).toBe("off");
            expect(timer?.textContent).toBe("konclui.focus.justStarted");
            expect(status().textContent).toBe("konclui.focus.active");
            expect(status().contains(timer)).toBe(false);
        });

        it("moves the time on every 20 seconds, so a minute reads as a minute", () => {
            publishSeat(true);
            startFocus();
            show();

            vi.advanceTimersByTime(60_000);
            flushSync();

            expect(target.querySelector('[role="timer"]')?.textContent).toBe('konclui.focus.minutes{"minutes":1}');
        });

        it("says hours and minutes, the minutes with two digits", () => {
            publishSeat(true);
            startFocus();
            show();

            vi.advanceTimersByTime(65 * 60_000);
            flushSync();

            expect(target.querySelector('[role="timer"]')?.textContent).toBe(
                'konclui.focus.hoursMinutes{"hours":1,"minutes":"05"}',
            );
        });
    });

    describe("ended", () => {
        it("ends on the click, says so, and offers the way back with the same focused button", () => {
            publishSeat(true);
            startFocus();
            show();
            button().focus();

            button().click();
            flushSync();

            expect(chipText()).toContain("konclui.focus.ended");
            expect(chipText()).toContain("konclui.focus.endedHint");
            expect(button().textContent?.trim()).toBe("konclui.focus.resume");
            expect(status().textContent).toBe("konclui.focus.ended");
            expect(document.activeElement).toBe(button());
        });

        it("resumes on the next click", () => {
            publishSeat(true);
            startFocus();
            endFocus();
            show();

            button().click();
            flushSync();

            expect(chipText()).toContain("konclui.focus.active");
        });
    });

    describe("leaving", () => {
        it("goes away when the player stands up, and hands the key focus back when it held it", () => {
            publishSeat(true);
            show();
            button().focus();

            publishSeat(false);
            flushSync();

            expect(target.querySelector('[data-testid="konclui-focus-chip"]')).toBeNull();
            expect(returnFocus).toHaveBeenCalledTimes(1);
        });

        it("does not touch the key focus when it was elsewhere", () => {
            publishSeat(true);
            show();
            const elsewhere = document.createElement("input");
            document.body.append(elsewhere);
            elsewhere.focus();

            publishSeat(false);
            flushSync();

            expect(returnFocus).not.toHaveBeenCalled();
            elsewhere.remove();
        });

        it("gives way to a conversation, and hands the key focus back too", () => {
            publishSeat(true);
            startFocus();
            show();
            button().focus();

            conversation.set(true);
            flushSync();

            expect(target.querySelector('[data-testid="konclui-focus-chip"]')).toBeNull();
            expect(returnFocus).toHaveBeenCalledTimes(1);

            conversation.set(false);
            flushSync();
            expect(chipText()).toContain("konclui.focus.active");
        });
    });

    describe("its entrance and its exit", () => {
        let animations: WebAnimationsStub;

        beforeEach(() => {
            animations = stubWebAnimations();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
        });

        afterEach(() => {
            animations.restore();
            vi.unstubAllGlobals();
        });

        const chipElement = () => target.querySelector<HTMLElement>('[data-testid="konclui-focus-chip"]');
        const durations = () => animations.moving().map((animation) => animation.options.duration);

        it("rises in on the surface transition, 6 px from below, not on a keyframe of its own", async () => {
            show();

            publishSeat(true);
            flushSync();
            await animations.settle();

            expect(chipElement()?.classList.contains("k-enter")).toBe(false);
            expect(durations()).toEqual([290]);
        });

        it("stays in the page for the length of its exit, inert and with the words it had, and is then taken away", async () => {
            publishSeat(true);
            show();
            await animations.settle();
            await animations.finishMoving();

            publishSeat(false);
            flushSync();
            await animations.settle();

            expect(chipElement()).not.toBeNull();
            expect(chipElement()?.inert).toBe(true);
            expect(chipText()).toContain("konclui.focus.title");
            expect(durations()).toEqual([200]);

            await animations.finishMoving();

            expect(chipElement()).toBeNull();
        });

        it("has handed the key focus back before it goes inert, so the focus never falls to the page", async () => {
            publishSeat(true);
            show();
            await animations.settle();
            await animations.finishMoving();
            button().focus();
            let inertWhenHandedBack: boolean | undefined;
            returnFocus.mockImplementation(() => {
                inertWhenHandedBack = chipElement()?.inert === true;
            });

            publishSeat(false);
            flushSync();

            // The hand-back runs before the page is updated, and the browser takes the focus off a chip that is inert.
            expect(returnFocus).toHaveBeenCalledTimes(1);
            expect(inertWhenHandedBack).toBe(false);
            expect(chipElement()?.inert).toBe(true);
        });

        it("is the same chip when the player sits again during its exit, and is not inert", async () => {
            publishSeat(true);
            show();
            await animations.settle();
            await animations.finishMoving();
            const before = chipElement();
            publishSeat(false);
            flushSync();
            await animations.settle();

            publishSeat(true);
            flushSync();
            await animations.settle();
            await animations.finishMoving();

            expect(chipElement()).toBe(before);
            expect(chipElement()?.inert).not.toBe(true);
        });

        it("leaves in the same flush, with nothing to hold, for a viewer who reduces motion", async () => {
            publishSeat(true);
            show();
            await animations.settle();
            await animations.finishMoving();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
            const before = animations.animations.length;

            publishSeat(false);
            flushSync();

            expect(chipElement()).toBeNull();
            expect(animations.animations.length).toBe(before);
        });

        it("appears at its final state, with no animation, for a viewer who reduces motion", async () => {
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
            show();

            publishSeat(true);
            flushSync();
            await animations.settle();

            expect(chipElement()).not.toBeNull();
            expect(animations.animations).toHaveLength(0);
        });

        it("gives under the press of its button, like every control that is clicked often", () => {
            publishSeat(true);
            show();

            expect(button().classList.contains("k-press")).toBe(true);
        });
    });

    describe("keys and pointer", () => {
        function press(key: string): { reachedPage: boolean } {
            const seen = { reachedPage: false };
            const listen = (): void => {
                seen.reachedPage = true;
            };
            window.addEventListener("keydown", listen);
            button().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
            window.removeEventListener("keydown", listen);
            return seen;
        }

        it("keeps Space and Enter on the button, so the game does not read them as interact", () => {
            publishSeat(true);
            show();

            expect(press(" ").reachedPage).toBe(false);
            expect(press("Enter").reachedPage).toBe(false);
        });

        it("lets every other key through to the game, so the arrows still walk", () => {
            publishSeat(true);
            show();

            expect(press("ArrowLeft").reachedPage).toBe(true);
        });

        it("lets go of the key focus after a pointer click, but keeps it after a keyboard one", () => {
            publishSeat(true);
            show();
            button().focus();

            button().click();
            flushSync();
            expect(document.activeElement).toBe(button());

            button().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
            flushSync();
            expect(document.activeElement).not.toBe(button());
        });
    });
});

// jsdom resolves neither calc() nor the cascade of a compiled Svelte style, so the geometry and the motion are checked
// on the source, as the call indicator's are.
describe("FocusChip layout", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "FocusChip.svelte"), "utf8");

    function rule(selector: string): string {
        const match = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(source);
        if (!match) throw new Error(`the ${selector} rule is missing from FocusChip.svelte`);
        return match[1];
    }

    it("keeps the chip clear of the map zoom column on the narrowest phone", () => {
        const cap = /(?<![-\w])max-width:\s*calc\(\s*100%\s*-\s*(\d+)px\s*\)/.exec(rule(".chip"));

        expect(cap, "the chip has no max-width of the form calc(100% - Npx)").not.toBeNull();
        // The column reaches 64 px in from the right edge (8 + 56); the chip is centred in a stack with 8 px of padding.
        const screen = 375;
        const chipWidth = screen - 2 * 8 - Number(cap?.[1]);
        expect(screen / 2 + chipWidth / 2).toBeLessThanOrEqual(screen - (8 + 56) - 8);
    });

    it("lets a click through the row around it and takes it only on the chip", () => {
        expect(rule(".focus")).toMatch(/pointer-events:\s*none/);
        expect(rule(".chip")).toMatch(/pointer-events:\s*auto/);
    });

    it("draws the flat chrome material and no glass", () => {
        expect(source).toContain('class="chip k-chrome"');
        expect(source).not.toMatch(/backdrop-filter|filter:\s*blur/);
    });

    it("has no keyframes of its own: it rises through the surface transition, which reads reduced motion itself", () => {
        expect(source).not.toContain("@keyframes");
        expect(source).not.toMatch(/animation:/);
        expect(source).toMatch(
            /\{#if chip\.kind !== "hidden"\}\s*<div\s[^>]*class="chip k-chrome"[^>]*\btransition:surface\b/,
        );
    });

    it("drops the hint on a phone and keeps a 44 px hit area on the button", () => {
        expect(source).toMatch(/@media \(max-width: 767px\) \{\s*\.hint \{\s*display: none;/);
        expect(rule(".action")).toMatch(/min-height:\s*36px/);
        expect(source).toMatch(/\.action::after \{[^}]*inset:\s*-4px/);
    });

    it("never uses the disabled attribute", () => {
        expect(source).not.toMatch(/\bdisabled\b/);
    });
});
