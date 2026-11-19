// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { loadLocale } from "../../../../src/i18n/i18n-util.sync";
import { setLocale } from "../../../../src/i18n/i18n-svelte";
import { mapExplorationAreasStore, mapExplorationEntitiesStore } from "../../../../src/front/Stores/MapEditorStore";
import Explorer from "../../../../src/front/Components/Exploration/Explorer.svelte";

// jsdom applies no stylesheet: the menu row and the dock control come from `.k-menu-row`, `.k-menu-lead` and
// `.k-control` (konclui.css), so the markup is checked for the classes and for the glyph where they size it.

vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => ({ applicationManager: { applications: [] } }) },
}));
vi.mock("../../../../src/front/Administration/AnalyticsClient", () => ({
    analyticsClient: { trackAdminEvent: () => undefined },
}));
vi.mock("../../../../src/front/Stores/MapEditorStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        mapEditorModeStore: writable(true),
        mapExplorationAreasStore: writable(undefined),
        mapExplorationEntitiesStore: writable(new Map()),
        mapExplorationObjectSelectedStore: writable(undefined),
    };
});
vi.mock("../../../../src/front/Stores/GameSceneStore", async () => {
    const { writable } = await import("svelte/store");
    return { extensionModuleStore: writable([]) };
});
vi.mock("../../../../src/front/Stores/ErrorStore", () => ({ warningMessageStore: {} }));
vi.mock("../../../../src/front/Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { mapExplorerSearchinputFocusStore: writable(false), inputFormFocusStore: writable(false) };
});

function entity(id: string, name: string) {
    return {
        entityId: id,
        getEntityData: () => ({ name }),
        getPrefab: () => ({ name, imagePath: `/${id}.png` }),
        getProperties: () => [],
    };
}

function area(name: string) {
    return { getAreaData: () => ({ name }), getProperties: () => [] };
}

let target: HTMLElement;
let component: ReturnType<typeof mount> | undefined;

function render(entities: number, areas: number): void {
    mapExplorationEntitiesStore.set(
        new Map(Array.from({ length: entities }, (_, i) => [`e${i}`, entity(`e${i}`, `Object ${i}`)])) as never,
    );
    mapExplorationAreasStore.set(
        new Map(Array.from({ length: areas }, (_, i) => [`a${i}`, area(`Area ${i}`)])) as never,
    );
    component = mount(Explorer, { target });
    flushSync();
}

function header(kind: "entities" | "areas"): HTMLElement {
    const element = target.querySelector<HTMLElement>(`.${kind}`);
    if (element === null) throw new Error(`The ${kind} header was not rendered`);
    return element;
}

const text = (element: Element) => element.textContent?.replace(/\s+/g, " ").trim();

describe("Explorer", () => {
    beforeEach(() => {
        loadLocale("en-US");
        setLocale("en-US");
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent, { outro: false });
        target.remove();
    });

    it("counts in the plural the language asks for", () => {
        render(2, 1);

        expect(text(header("entities"))).toBe("2 objects found");
        expect(text(header("areas"))).toBe("1 area found");
    });

    it("counts one object in the singular and many areas in the plural", () => {
        render(1, 27);

        expect(text(header("entities"))).toBe("1 object found");
        expect(text(header("areas"))).toBe("27 areas found");
    });

    it("lays the header rows out as menu rows with an 18 px glyph lead and a dock-sized toggle", () => {
        render(2, 1);

        for (const row of [header("entities"), header("areas")]) {
            expect(row.classList.contains("k-menu-row")).toBe(true);
            expect(row.querySelector(":scope > .k-menu-lead > svg")).not.toBeNull();
            expect(row.querySelector("img")).toBeNull();
            const toggle = row.querySelector("button");
            expect(toggle?.classList.contains("k-control")).toBe(true);
            expect(toggle?.querySelector(":scope > svg")).not.toBeNull();
        }
    });

    it("points the chevron down while the list is closed and up once it is open", () => {
        render(2, 1);
        const toggle = target.querySelector<HTMLButtonElement>('[data-testid="toggleFolderArea"]');
        const chevron = () => toggle?.querySelector("svg");

        // Upstream's glyph is the down chevron, turned over while the list is open.
        expect(toggle?.getAttribute("aria-expanded")).toBe("false");
        expect(chevron()?.classList.contains("rotate-180")).toBe(false);
        toggle?.click();
        flushSync();
        expect(toggle?.getAttribute("aria-expanded")).toBe("true");
        expect(chevron()?.classList.contains("rotate-180")).toBe(true);
    });

    it("lays the item rows out as menu rows whose controls are dock controls", () => {
        render(1, 1);
        target.querySelector<HTMLButtonElement>('[data-testid="toggleFolderEntity"]')?.click();
        target.querySelector<HTMLButtonElement>('[data-testid="toggleFolderArea"]')?.click();
        flushSync();

        const items = [...target.querySelectorAll<HTMLElement>(".entity-items .item, .area-items .item")];
        expect(items).toHaveLength(2);
        for (const item of items) {
            expect(item.classList.contains("k-menu-row")).toBe(true);
            expect(item.querySelector(":scope > .k-menu-lead > :is(svg, img)")).not.toBeNull();
            expect(item.querySelector(":scope > .k-menu-label")).not.toBeNull();
            const buttons = [...item.querySelectorAll("button")];
            expect(buttons).toHaveLength(2);
            for (const button of buttons) {
                expect(button.classList.contains("k-control")).toBe(true);
                expect(button.querySelector(":scope > svg")).not.toBeNull();
            }
        }
    });

    it("draws every filter chip as a dock control, in a row that wraps instead of hiding chips", () => {
        render(0, 0);

        const row = target.querySelector<HTMLElement>(".filter-chips");
        expect(row?.classList.contains("flex-wrap")).toBe(true);
        expect(row?.className).not.toMatch(/overflow-x-scroll/);
        const chips = [...(row?.querySelectorAll("button") ?? [])];
        expect(chips).toHaveLength(13);
        for (const chip of chips) {
            expect(chip.classList.contains("k-control"), chip.getAttribute("aria-label") ?? "").toBe(true);
        }
    });

    it("exposes a filter's state on its chip and paints it with no inline colour", () => {
        render(0, 0);
        const chip = () => target.querySelector<HTMLButtonElement>('[data-testid="exitAreaProperty"]');

        expect(chip()?.getAttribute("aria-pressed")).toBe("false");
        chip()?.click();
        flushSync();
        expect(chip()?.getAttribute("aria-pressed")).toBe("true");
        // The pressed fill is `.k-control[aria-pressed="true"]`, which an inline colour would override.
        expect(chip()?.getAttribute("style") ?? "").not.toMatch(/background/);
        chip()?.click();
        flushSync();
        expect(chip()?.getAttribute("aria-pressed")).toBe("false");
    });
});
