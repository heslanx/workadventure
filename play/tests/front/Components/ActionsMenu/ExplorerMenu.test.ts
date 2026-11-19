// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { loadLocale } from "../../../../src/i18n/i18n-util.sync";
import { setLocale } from "../../../../src/i18n/i18n-svelte";
import { gameViewportBounds } from "../../../../src/front/ExternalModule/ClientExtensionPoints";
import ExplorerMenu from "../../../../src/front/Components/ActionsMenu/ExplorerMenu.svelte";

// The zoom controls keep their 0.5rem from the edge of the game: when an extension draws the game in a frame
// narrower than the window, that edge is the frame's, not the window's.

vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../src/front/Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../../../src/front/Stores/MapEditorStore", async () => {
    const { writable } = await import("svelte/store");
    return { mapEditorModeStore: writable(false) };
});
vi.mock("../../../../src/front/Stores/CameraStore", async () => {
    const { writable } = await import("svelte/store");
    return { cameraDetachedStore: writable(false) };
});
vi.mock("../../../../src/front/Phaser/Game/MapEditor/MapEditorModeManager", () => ({
    EditorToolName: { ExploreTheRoom: "explore" },
}));
vi.mock("../../../../src/front/Phaser/Game/CameraZoomUtils", () => ({
    BUTTON_ZOOM_FACTOR_PER_SECOND: 1,
    BUTTON_ZOOM_STEP_FACTOR: 1,
}));

let target: HTMLElement;
let component: ReturnType<typeof mount> | undefined;

function controls(): HTMLElement {
    const element = target.querySelector<HTMLElement>('[data-testid="actions-explorer"]');
    if (element === null) throw new Error("The zoom controls were not rendered");
    return element;
}

describe("ExplorerMenu", () => {
    beforeEach(() => {
        loadLocale("en-US");
        setLocale("en-US");
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 1451 });
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(async () => {
        const mountedComponent = component;
        component = undefined;
        if (mountedComponent) await unmount(mountedComponent, { outro: false });
        gameViewportBounds.set(undefined);
        target.remove();
    });

    it("sits 0.5rem from the window's edge when the game fills the window", () => {
        component = mount(ExplorerMenu, { target, props: {} });
        flushSync();

        expect(controls().style.right).toBe("calc(0px + 0.5rem)");
    });

    it("sits 0.5rem from the frame's edge when the game is drawn in a frame", () => {
        gameViewportBounds.set({ left: 356, top: 6, width: 1089, height: 843 });

        component = mount(ExplorerMenu, { target, props: {} });
        flushSync();

        expect(controls().style.right).toBe("calc(6px + 0.5rem)");
    });

    it("adds the map editor's panel to the frame's gutter", () => {
        gameViewportBounds.set({ left: 356, top: 6, width: 1089, height: 843 });

        component = mount(ExplorerMenu, { target, props: { mapEditorRightOffset: 300 } });
        flushSync();

        expect(controls().style.right).toBe("calc(306px + 0.5rem)");
    });

    // jsdom applies no stylesheet: the dock's 36 px box, 10 px radius and 18 px glyph come from `.k-control`
    // (konclui.css), which sizes the glyph only when it is the button's direct child.
    it("draws every zoom control as a dock control with its glyph as the direct child", () => {
        component = mount(ExplorerMenu, { target, props: {} });
        flushSync();

        const buttons = [...controls().querySelectorAll("button")];
        expect(buttons).toHaveLength(3);
        for (const button of buttons) {
            expect(button.classList.contains("k-control"), button.getAttribute("aria-label") ?? "").toBe(true);
            expect(button.querySelector(":scope > svg")).not.toBeNull();
            expect(button.className).not.toMatch(/(?:^|\s)(?:p-2|min-h-7|min-w-7|rounded)(?:\s|$)/);
        }
    });

    it("sets the controls 6 px apart inside a 6 px edge, as the dock does", () => {
        component = mount(ExplorerMenu, { target, props: {} });
        flushSync();

        expect(controls().classList.contains("p-1.5")).toBe(true);
        const columns = [...controls().querySelectorAll(":scope > div, :scope > div > div")];
        expect(columns).toHaveLength(2);
        for (const column of columns) expect(column.classList.contains("gap-1.5")).toBe(true);
    });
});
