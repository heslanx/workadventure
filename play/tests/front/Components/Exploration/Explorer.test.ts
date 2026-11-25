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

    it("turns the chevron on the theme's spring: over while the list is shut, upright once it is open", () => {
        render(2, 1);
        const toggle = target.querySelector<HTMLButtonElement>('[data-testid="toggleFolderArea"]');
        const chevron = () => toggle?.querySelector(":scope > svg");

        // The glyph is the up chevron. `.k-turn` (konclui.css) turns it upright while its button is `aria-expanded`, and
        // `--k-turn-closed` says how far over it lies while the list is shut: 180 degrees, so it points down.
        expect(chevron()?.classList.contains("k-turn")).toBe(true);
        expect(chevron()?.getAttribute("class")).toContain("[--k-turn-closed:180deg]");
        expect(chevron()?.classList.contains("rotate-180")).toBe(false);
        expect(toggle?.getAttribute("aria-expanded")).toBe("false");
        toggle?.click();
        flushSync();
        expect(toggle?.getAttribute("aria-expanded")).toBe("true");
        expect(chevron()?.parentElement).toBe(toggle);
    });

    describe("a list's rows", () => {
        // The entity list is the first disclosure of the card and the area list the second, shut or open.
        const disclosure = (kind: "entity" | "area"): HTMLElement | undefined =>
            target.querySelectorAll<HTMLElement>(".k-disclosure")[kind === "entity" ? 0 : 1];
        const rows = (kind: "entity" | "area") => target.querySelectorAll(`.${kind}-items .item`);
        const toggle = (kind: "entity" | "area") =>
            target.querySelector<HTMLButtonElement>(
                `[data-testid="toggleFolder${kind === "entity" ? "Entity" : "Area"}"]`,
            );
        const type = (value: string) => {
            const input = target.querySelector("input");
            if (input === null) throw new Error("The search field was not rendered");
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            flushSync();
        };

        it("open and shut as a disclosure, a box that holds its rows and grows to them", () => {
            render(2, 1);

            const lists = [...target.querySelectorAll(".k-disclosure")];
            expect(lists).toHaveLength(2);
            for (const list of lists) {
                expect(list.querySelector(":scope > .k-disclosure-body")).not.toBeNull();
                expect(list.classList.contains("is-open")).toBe(false);
            }
        });

        it("are not drawn until a list is first opened: a room can hold hundreds that nobody asked to see", () => {
            render(3, 2);

            expect(rows("entity")).toHaveLength(0);
            expect(rows("area")).toHaveLength(0);

            toggle("entity")?.click();
            flushSync();

            expect(rows("entity")).toHaveLength(3);
            expect(rows("area")).toHaveLength(0);
        });

        it("are in the disclosure that opens with the list, in the same flush", () => {
            render(3, 2);

            toggle("entity")?.click();
            flushSync();

            expect(disclosure("entity")?.classList.contains("is-open")).toBe(true);
            expect(
                disclosure("entity")?.querySelectorAll(":scope > .k-disclosure-body .entity-items .item"),
            ).toHaveLength(3);
            expect(disclosure("area")?.classList.contains("is-open")).toBe(false);
        });

        it("stay in the page while the list is shut again, so that the box can close on them", () => {
            render(3, 2);
            toggle("entity")?.click();
            flushSync();

            toggle("entity")?.click();
            flushSync();

            expect(disclosure("entity")?.classList.contains("is-open")).toBe(false);
            expect(rows("entity")).toHaveLength(3);
            expect(toggle("entity")?.getAttribute("aria-expanded")).toBe("false");
        });

        it("take no room while a list that has none is open: it stays shut", () => {
            render(0, 0);

            toggle("entity")?.click();
            flushSync();

            expect(toggle("entity")?.getAttribute("aria-expanded")).toBe("true");
            expect(target.querySelector(".k-disclosure.is-open")).toBeNull();
        });

        it("change while the list is open, and the box follows what is in it", () => {
            render(3, 1);
            toggle("entity")?.click();
            flushSync();
            const list = () => disclosure("entity");
            expect(rows("entity")).toHaveLength(3);

            // Typing finds fewer rows and the same list holds them; clearing it brings them all back, the list open.
            type("Object 1");
            type("Object 1");
            expect(rows("entity")).toHaveLength(1);
            expect(list()?.classList.contains("is-open")).toBe(true);

            type("");
            type("");
            expect(rows("entity")).toHaveLength(3);
            expect(list()?.classList.contains("is-open")).toBe(true);
        });

        it("keep their 2 px gap above them through the disclosure, so a shut list leaves the column as it was", () => {
            render(1, 1);
            toggle("entity")?.click();
            flushSync();

            // The box takes 2 px back from the column's gap and the rows give it again inside the box: shut, the box is
            // as high as nothing, and open, the rows start where they always did.
            for (const list of [disclosure("entity"), disclosure("area")]) {
                expect(list?.classList.contains("-mt-0.5")).toBe(true);
            }
            expect(target.querySelector(".entity-items")?.classList.contains("pt-0.5")).toBe(true);
        });
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
