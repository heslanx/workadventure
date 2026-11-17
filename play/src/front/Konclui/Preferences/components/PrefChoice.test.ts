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

    function show(value: string, onchange = vi.fn()) {
        document.body.append(target);
        choice = mount(PrefChoice, {
            target,
            props: {
                title: "Quality",
                value,
                onchange,
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
});
