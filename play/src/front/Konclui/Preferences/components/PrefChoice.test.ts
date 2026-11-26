// @vitest-environment jsdom
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

    function show(value: string, onchange = vi.fn(), onreselect?: () => void, hint?: string) {
        document.body.append(target);
        choice = mount(PrefChoice, {
            target,
            props: {
                title: "Quality",
                hint,
                value,
                onchange,
                onreselect,
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
});
