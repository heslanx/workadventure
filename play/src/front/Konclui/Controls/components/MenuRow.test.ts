// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import MenuRow from "./MenuRow.svelte";

const lead = createRawSnippet(() => ({ render: () => '<svg data-testid="glyph"></svg>' }));

describe("MenuRow", () => {
    let target: HTMLElement | undefined;
    let mounted: ReturnType<typeof mount> | undefined;

    function render(props: Record<string, unknown>): HTMLButtonElement {
        target = document.createElement("div");
        document.body.append(target);
        mounted = mount(MenuRow, { target, props: { lead, label: "Name", ...props } });
        flushSync();
        const button = target.querySelector("button");
        if (!button) throw new Error("the row did not render a button");
        return button;
    }

    afterEach(async () => {
        const current = mounted;
        mounted = undefined;
        if (current) await unmount(current);
        target?.remove();
    });

    it("is the shared row: a plain button with the lead slot, the label and no mark", () => {
        const button = render({});

        expect(button.type).toBe("button");
        expect(button.classList.contains("k-menu-row")).toBe(true);
        expect(button.querySelector(".k-menu-lead")?.getAttribute("aria-hidden")).toBe("true");
        expect(button.querySelector(".k-menu-lead [data-testid='glyph']")).not.toBeNull();
        expect(button.querySelector(".k-menu-label")?.textContent).toBe("Name");
        expect(button.querySelector(".k-menu-mark")).toBeNull();
    });

    it("draws the check at the end when the row is marked", () => {
        const button = render({ marked: true });

        const mark = button.querySelector(".k-menu-mark");
        expect(mark).not.toBeNull();
        expect(button.lastElementChild).toBe(mark);
        expect(mark?.getAttribute("aria-hidden")).toBe("true");
    });

    it("leaves the role, the state and the test id to the caller", () => {
        const onclick = vi.fn();
        const button = render({
            role: "menuitemradio",
            "aria-checked": true,
            "aria-disabled": true,
            tabindex: -1,
            "data-testid": "row-a",
            onclick,
        });

        expect(button.getAttribute("role")).toBe("menuitemradio");
        expect(button.getAttribute("aria-checked")).toBe("true");
        expect(button.getAttribute("aria-disabled")).toBe("true");
        expect(button.hasAttribute("disabled")).toBe(false);
        expect(button.tabIndex).toBe(-1);
        expect(button.dataset.testid).toBe("row-a");
        button.click();
        expect(onclick).toHaveBeenCalledOnce();
    });
});
