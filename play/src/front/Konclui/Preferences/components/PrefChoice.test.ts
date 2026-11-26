// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import PrefChoice from "./PrefChoice.svelte";

describe("PrefChoice", () => {
    const target = document.createElement("div");
    let choice: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mounted = choice;
        choice = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
    });

    interface Extra {
        actionLabel?: string;
        onaction?: () => void;
        error?: string;
    }

    function show(value: string, onchange = vi.fn(), onreselect?: () => void, hint?: string, extra: Extra = {}) {
        document.body.append(target);
        choice = mount(PrefChoice, {
            target,
            props: {
                title: "Quality",
                hint,
                value,
                onchange,
                onreselect,
                ...extra,
                options: [
                    { value: "low", label: "Low" },
                    { value: "high", label: "High", unavailable: "Needs a good connection" },
                    { value: "auto", label: "Auto" },
                ],
            },
        });
        flushSync();
        return onchange;
    }

    const radios = () => [...target.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const actions = () => [...target.querySelectorAll<HTMLButtonElement>("button:not([role=radio])")];

    it("is one tab stop, on the chosen option", () => {
        show("auto");

        expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);
        expect(target.querySelector('[role="radiogroup"]')?.getAttribute("aria-labelledby")).toBeTruthy();
    });

    it("chooses with the arrows and skips nothing, but never picks an unavailable option", () => {
        const onchange = show("low");

        radios()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(document.activeElement).toBe(radios()[1]);
        expect(onchange).not.toHaveBeenCalled();

        radios()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(document.activeElement).toBe(radios()[2]);
        expect(onchange).toHaveBeenCalledWith("auto");
    });

    it("keeps an unavailable option focusable, marked and explained", () => {
        const onchange = show("low");

        radios()[1].click();

        expect(radios()[1].getAttribute("aria-disabled")).toBe("true");
        expect(radios()[1].title).toBe("Needs a good connection");
        expect(radios()[1].hasAttribute("disabled")).toBe(false);
        expect(onchange).not.toHaveBeenCalled();
    });

    describe("when the chosen option is chosen again", () => {
        it("tells whoever asked to hear it, and changes nothing", () => {
            const onreselect = vi.fn();
            const onchange = show("auto", vi.fn(), onreselect);

            radios()[2].click();

            expect(onreselect).toHaveBeenCalledOnce();
            expect(onchange).not.toHaveBeenCalled();
        });

        it("does nothing when nobody asked to hear it", () => {
            const onchange = show("auto");

            radios()[2].click();

            expect(onchange).not.toHaveBeenCalled();
            expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
        });

        it("does not tell when another option is chosen: that is a change", () => {
            const onreselect = vi.fn();
            const onchange = show("auto", vi.fn(), onreselect);

            radios()[0].click();

            expect(onchange).toHaveBeenCalledExactlyOnceWith("low");
            expect(onreselect).not.toHaveBeenCalled();
        });

        it.each(["low", "high"])("does not tell for an unavailable option, with %s chosen", (chosen) => {
            const onreselect = vi.fn();
            show(chosen, vi.fn(), onreselect);

            radios()[1].click();

            expect(onreselect).not.toHaveBeenCalled();
        });

        it("does not tell for the keys that move between options, which choose only other ones", () => {
            const onreselect = vi.fn();
            show("low", vi.fn(), onreselect);

            // From the unavailable option back onto the chosen one, and Home on the chosen one itself
            radios()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
            radios()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));

            expect(onreselect).not.toHaveBeenCalled();
        });

        describe("the note", () => {
            const describedBy = () => radios().map((radio) => radio.getAttribute("aria-describedby"));

            it("also describes the chosen option, which now acts, and no other one", () => {
                show("auto", vi.fn(), vi.fn(), "Lowered for now");

                const hint = target.querySelector("small");
                expect(hint?.id).toBeTruthy();
                expect(describedBy()).toEqual([null, null, hint?.id]);
            });

            it("is not repeated on any option while nobody asked to hear the choice again", () => {
                show("auto", vi.fn(), undefined, "Lowered for now");

                expect(describedBy()).toEqual([null, null, null]);
            });

            it("is not referred to when there is no note", () => {
                show("auto", vi.fn(), vi.fn());

                expect(describedBy()).toEqual([null, null, null]);
            });
        });

        it.each([" ", "Enter"])("leaves %j to the button, whose click is what tells", (key) => {
            const onreselect = vi.fn();
            show("auto", vi.fn(), onreselect);

            const keydown = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
            radios()[2].dispatchEvent(keydown);

            expect(keydown.defaultPrevented).toBe(false);
            expect(onreselect).not.toHaveBeenCalled();
        });
    });

    describe("the note", () => {
        it("is announced politely, as one sentence, when its text changes", () => {
            show("auto", vi.fn(), undefined, "Lowered for now");

            const note = target.querySelector("small");
            expect(note?.getAttribute("aria-live")).toBe("polite");
            expect(note?.getAttribute("aria-atomic")).toBe("true");
        });

        it("is announced as well when it is a problem", () => {
            show("auto", vi.fn(), undefined, "Lowered for now", { error: "Could not save" });

            const note = target.querySelector("small");
            expect(note?.textContent).toBe("Could not save");
            expect(note?.classList.contains("k-pref-error")).toBe(true);
            expect(note?.getAttribute("aria-live")).toBe("polite");
        });
    });

    describe("the action beside the note", () => {
        const offer = (onaction = vi.fn()): Extra => ({ actionLabel: "Try now", onaction });

        it("is not there when none is given, so the row is the one it was", () => {
            show("auto", vi.fn(), vi.fn(), "Lowered for now");

            expect(actions()).toEqual([]);
        });

        it.each<[string, Extra]>([
            ["a label", { actionLabel: "Try now" }],
            ["a handler", { onaction: () => undefined }],
        ])("is not there with %s alone: a button with no name or no effect is not offered", (_what, extra) => {
            show("auto", vi.fn(), vi.fn(), "Lowered for now", extra);

            expect(actions()).toEqual([]);
        });

        it("is a button named by its label, after the note and before the choices", () => {
            show("auto", vi.fn(), vi.fn(), "Lowered for now", offer());

            const [button] = actions();
            const note = target.querySelector("small");
            const group = target.querySelector('[role="radiogroup"]');
            expect(actions()).toHaveLength(1);
            expect(button.textContent?.trim()).toBe("Try now");
            expect(button.type).toBe("button");
            expect(button.className).toContain("k-pref-button");
            expect(note?.compareDocumentPosition(button)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
            expect(button.compareDocumentPosition(group as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        });

        // The dialog's styles for the button (the gap above it, the finger's height) name `.k-pref-text > .k-pref-button`.
        it("is a child of the text column, which the dialog's styles for it name", () => {
            show("auto", vi.fn(), vi.fn(), "Lowered for now", offer());

            expect(actions()[0].parentElement?.classList.contains("k-pref-text")).toBe(true);
        });

        it("is in the tab order and exposed to assistive technology", () => {
            show("auto", vi.fn(), vi.fn(), "Lowered for now", offer());

            const [button] = actions();
            expect(button.tabIndex).toBe(0);
            expect(button.closest("[aria-hidden]")).toBeNull();
            expect(button.closest("[inert]")).toBeNull();
        });

        it("is outside the note, so the note is announced alone, and outside the choices", () => {
            show("auto", vi.fn(), vi.fn(), "Lowered for now", offer());

            const [button] = actions();
            expect(button.closest("[aria-live]")).toBeNull();
            expect(button.closest('[role="radiogroup"]')).toBeNull();
            expect(target.querySelector("small")?.contains(button)).toBe(false);
        });

        it("is described by the note, as the chosen option is", () => {
            show("auto", vi.fn(), vi.fn(), "Lowered for now", offer());

            const [button] = actions();
            expect(button.getAttribute("aria-describedby")).toBe(target.querySelector("small")?.id);
            expect(radios()[2].getAttribute("aria-describedby")).toBe(target.querySelector("small")?.id);
        });

        it("is described by nothing when there is no note", () => {
            show("auto", vi.fn(), undefined, undefined, offer());

            expect(actions()[0].hasAttribute("aria-describedby")).toBe(false);
        });

        it("calls its handler once, and changes nothing else: neither a change nor a choice again", () => {
            const onaction = vi.fn();
            const onreselect = vi.fn();
            const onchange = show("auto", vi.fn(), onreselect, "Lowered for now", offer(onaction));

            actions()[0].click();

            expect(onaction).toHaveBeenCalledOnce();
            expect(onchange).not.toHaveBeenCalled();
            expect(onreselect).not.toHaveBeenCalled();
        });

        it("leaves choosing the chosen option again as it was: it still tells, and the action is not called", () => {
            const onaction = vi.fn();
            const onreselect = vi.fn();
            show("auto", vi.fn(), onreselect, "Lowered for now", offer(onaction));

            radios()[2].click();

            expect(onreselect).toHaveBeenCalledOnce();
            expect(onaction).not.toHaveBeenCalled();
        });

        it.each([" ", "Enter"])("leaves %j to the button, whose click is what acts", (key) => {
            const onaction = vi.fn();
            show("auto", vi.fn(), vi.fn(), "Lowered for now", offer(onaction));

            const keydown = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
            actions()[0].dispatchEvent(keydown);

            expect(keydown.defaultPrevented).toBe(false);
            expect(onaction).not.toHaveBeenCalled();
        });

        // The action goes away with the state it acts on; focus left on it would fall to the page. So the focus is
        // already on the option that is the tab stop (the chosen one, or the first while none is chosen), when it acts.
        it.each<[string, number]>([
            ["auto", 2],
            ["high", 1],
            ["missing", 0],
        ])("puts the focus on the tab stop before it acts, with %j chosen", (chosen, stop) => {
            let focusedWhenCalled: Element | null = null;
            const onaction = vi.fn(() => {
                focusedWhenCalled = document.activeElement;
            });
            show(chosen, vi.fn(), undefined, "Lowered for now", offer(onaction));
            actions()[0].focus();

            actions()[0].click();

            expect(radios()[stop].tabIndex).toBe(0);
            expect(focusedWhenCalled).toBe(radios()[stop]);
            expect(document.activeElement).toBe(radios()[stop]);
        });
    });
});

// The dialog's styles for the action. jsdom applies no stylesheet and lays nothing out, so this reads the rules as text;
// that the button sits on its own line at 360 px and at 880 px, and that a finger lands on it, is for a browser.
describe("the action's place in the dialog's styles", () => {
    const dialog = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "PreferencesDialog.svelte"), "utf8");
    const styles = dialog.slice(dialog.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");
    const ACTION = ".k-prefs :global(.k-pref-text > .k-pref-button)";

    /** The declarations of `selector` outside every media query, or inside the one whose condition is `condition`. */
    function declarations(selector: string, condition?: string): Map<string, string> {
        const scope =
            condition === undefined
                ? styles.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
                : mediaBlock(condition);
        const found = new Map<string, string>();
        for (const [, head = "", body = ""] of scope.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
            if (head.trim() !== selector) continue;
            for (const declaration of body.split(";")) {
                const colon = declaration.indexOf(":");
                if (colon > 0) found.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
            }
        }
        return found;
    }

    function mediaBlock(condition: string): string {
        const start = styles.indexOf(`@media ${condition} {`);
        if (start < 0) throw new Error(`The dialog has no @media ${condition}`);
        const open = styles.indexOf("{", start);
        let depth = 0;
        for (let index = open; index < styles.length; index++) {
            if (styles[index] === "{") depth++;
            if (styles[index] === "}" && --depth === 0) return styles.slice(open + 1, index);
        }
        throw new Error(`@media ${condition} is not closed`);
    }

    it("has a gap of 8 px above it, on every pointer", () => {
        expect(declarations(ACTION).get("margin-top")).toBe("8px");
    });

    it("is the 36 px of the other buttons by default, and 44 px high, a finger's size, on a coarse pointer", () => {
        expect(declarations(ACTION).has("min-height")).toBe(false);
        expect(styles).toMatch(/:global\(\.k-pref-button\) \{[^}]*min-height: 36px;/);
        expect(declarations(ACTION, "(pointer: coarse)").get("min-height")).toBe("44px");
    });
});
