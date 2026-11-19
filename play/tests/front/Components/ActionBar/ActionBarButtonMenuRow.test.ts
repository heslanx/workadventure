// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import ActionBarButton from "../../../../src/front/Components/ActionBar/ActionBarButton.svelte";

// The menu branch of upstream's action bar button: the row every upstream menu row of the dock's profile menu draws.

vi.mock("../../../../src/front/Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return { helpTextDisabledStore: writable(false) };
});
vi.mock("../../../../src/front/Components/Tooltip/HelpTooltip.svelte", () => ({ default: () => undefined }));

const glyph = createRawSnippet(() => ({ render: () => '<svg data-testid="glyph" width="20" height="20"></svg>' }));

describe("a menu row of the action bar button", () => {
    let target: HTMLElement;
    let mounted: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(async () => {
        const component = mounted;
        mounted = undefined;
        if (component) await unmount(component);
        target.remove();
    });

    const render = (props: Record<string, unknown>) => {
        mounted = mount(ActionBarButton, { target, props: { context: "menu", children: glyph, ...props } });
        flushSync();
        const row = target.querySelector("button");
        if (!row) throw new Error("no row");
        return row;
    };

    it("is a menu row with the lead, the label and nothing after them", () => {
        const row = render({ label: "Map editor" });

        expect(row.getAttribute("type")).toBe("button");
        expect(row.classList.contains("k-menu-row")).toBe(true);
        expect([...row.children].map((child) => child.className)).toEqual([
            "k-menu-lead",
            "flex min-w-0 flex-1 flex-col",
        ]);
        expect(row.querySelector(".k-menu-lead > [data-testid='glyph']")).not.toBeNull();
        expect(row.querySelector(".k-menu-label")?.textContent?.trim()).toBe("Map editor");
    });

    it("keeps the empty lead when the row has no picture", () => {
        const row = render({ label: "Applaud", hasImage: false });

        expect(row.firstElementChild?.classList.contains("k-menu-lead")).toBe(true);
        expect(row.firstElementChild?.childElementCount).toBe(0);
    });

    it("shows a switched-on row with the mint ink and the check mark, without a fill", () => {
        const row = render({ label: "Map editor", state: "active", pressed: true });

        expect(row.classList.contains("row-on")).toBe(true);
        expect(row.className).not.toContain("bg-secondary");
        expect(row.lastElementChild?.classList.contains("k-menu-mark")).toBe(true);
        expect(row.getAttribute("aria-pressed")).toBe("true");
    });

    it("draws no mark on a row that is off", () => {
        const row = render({ label: "Map editor", pressed: false });

        expect(row.querySelector(".k-menu-mark")).toBeNull();
        expect(row.classList.contains("row-on")).toBe(false);
    });

    it("marks a row that cannot act as unavailable and gives its reason under the label", () => {
        const onclick = vi.fn();
        const row = render({ label: "Room list", state: "disabled", blockedReason: "Turned off", onclick });

        row.click();

        expect(row.getAttribute("aria-disabled")).toBe("true");
        expect(onclick).not.toHaveBeenCalled();
        expect(row.querySelector(".k-menu-label + span")?.textContent?.trim()).toBe("Turned off");
    });

    it("leaves the action bar's own button out of the menu standard", () => {
        const button = render({ context: "actionBar", ariaLabel: "Camera" });

        expect(button.classList.contains("k-menu-row")).toBe(false);
        expect(button.querySelector(".k-menu-lead")).toBeNull();
    });
});
