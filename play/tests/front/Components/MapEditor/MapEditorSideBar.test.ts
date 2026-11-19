// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { loadLocale } from "../../../../src/i18n/i18n-util.sync";
import { setLocale } from "../../../../src/i18n/i18n-svelte";
import { mapEditorSelectedToolStore } from "../../../../src/front/Stores/MapEditorStore";
import MapEditorSideBar from "../../../../src/front/Components/MapEditor/MapEditorSideBar.svelte";

// jsdom applies no stylesheet: the dock's 36 px box, 10 px radius, 18 px glyph and mint selected fill come from
// `.k-control` (konclui.css), so the markup is checked for the class and for the glyph as the button's direct child.

vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../src/front/Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../../../src/front/Phaser/Game/MapEditor/MapEditorModeManager", () => ({
    EditorToolName: {
        ExploreTheRoom: "ExploreTheRoom",
        EntityEditor: "EntityEditor",
        TrashEditor: "TrashEditor",
        AreaEditor: "AreaEditor",
        WAMSettingsEditor: "WAMSettingsEditor",
        CloseMapEditor: "CloseMapEditor",
    },
}));
vi.mock("../../../../src/front/Stores/MapEditorStore", async () => {
    const { writable } = await import("svelte/store");
    return { mapEditorSelectedToolStore: writable(undefined), mapEditorVisibilityStore: writable(true) };
});
vi.mock("../../../../src/front/Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return { mapEditorActivated: writable(true), mapEditorActivatedForThematics: writable(false) };
});
vi.mock("../../../../src/front/Utils/BreakpointsUtils", () => ({ isMediaBreakpointUp: () => false }));

let target: HTMLElement;
let component: ReturnType<typeof mount> | undefined;

function rail(): HTMLElement {
    const element = target.querySelector<HTMLElement>("section.side-bar-container");
    if (element === null) throw new Error("The map editor rail was not rendered");
    return element;
}

describe("MapEditorSideBar", () => {
    beforeEach(() => {
        loadLocale("en-US");
        setLocale("en-US");
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe(): void {}
                unobserve(): void {}
                disconnect(): void {}
            },
        );
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent, { outro: false });
        mapEditorSelectedToolStore.set(undefined);
        vi.unstubAllGlobals();
        target.remove();
    });

    it("draws the close, collapse and tool buttons as dock controls with their glyph as the direct child", () => {
        component = mount(MapEditorSideBar, { target });
        flushSync();

        const buttons = [...rail().querySelectorAll("button")];
        // Close, collapse, then the five tools of an editor that may edit the map.
        expect(buttons).toHaveLength(7);
        for (const button of buttons) {
            const name = button.getAttribute("aria-label") ?? "";
            expect(button.classList.contains("k-control"), name).toBe(true);
            expect(button.querySelector(":scope > svg"), name).not.toBeNull();
            expect(button.className, name).not.toMatch(/(?:^|\s)(?:p-3|w-12|aspect-square|rounded)(?:\s|$)/);
        }
    });

    it("gives the close and the collapse buttons the same box", () => {
        component = mount(MapEditorSideBar, { target });
        flushSync();

        const close = rail().querySelector('[data-testid="closeMapEditorButton"]');
        const collapse = rail().querySelector('[data-testid="hideMapEditorButton"]');
        expect(close?.className).toBe(collapse?.className);
    });

    it("sets both groups at the dock's 6 px edge and 6 px gap", () => {
        component = mount(MapEditorSideBar, { target });
        flushSync();

        const groups = [...rail().querySelectorAll(".k-chrome")];
        expect(groups).toHaveLength(2);
        for (const group of groups) {
            expect(group.classList.contains("p-1.5")).toBe(true);
            expect(group.classList.contains("gap-1.5")).toBe(true);
        }
    });

    it("marks the active tool pressed and leaves its fill to the dock's selected look", () => {
        mapEditorSelectedToolStore.set("AreaEditor" as never);
        component = mount(MapEditorSideBar, { target });
        flushSync();

        const active = rail().querySelector<HTMLElement>("button#AreaEditor");
        const other = rail().querySelector<HTMLElement>("button#EntityEditor");
        expect(active?.getAttribute("aria-pressed")).toBe("true");
        expect(other?.getAttribute("aria-pressed")).toBe("false");
        // A utility fill or hover would outrank `.k-control[aria-pressed="true"]` and its hover.
        for (const button of [active, other]) {
            expect(button?.className).not.toMatch(/bg-secondary|hover:bg-/);
        }
    });
});
