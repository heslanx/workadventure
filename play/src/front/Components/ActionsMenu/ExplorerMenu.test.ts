// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cameraDetachedStore } from "../../Stores/CameraStore";
import { mapEditorModeStore } from "../../Stores/MapEditorStore";

vi.mock("../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { default: readable(path([])), LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: { getCurrentGameScene: vi.fn() } }));
vi.mock("../../Phaser/Game/MapEditor/MapEditorModeManager", () => ({ EditorToolName: { ExploreTheRoom: "explore" } }));

const { registerMapTools } = await import("../../ExternalModule/ClientExtensionPoints");
const { default: ExplorerMenu } = await import("./ExplorerMenu.svelte");
const { default: Tools } = await import("./ExplorerMenuToolsFixture.svelte");

// The slot is registered once for the whole file, as the app does, and switched with its `active` store.
const toolsActive = writable(false);
registerMapTools({ component: Tools, active: toolsActive });

describe("ExplorerMenu", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        toolsActive.set(false);
    });

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        cameraDetachedStore.set(false);
        mapEditorModeStore.set(false);
    });

    function show(): void {
        document.body.append(target);
        component = mount(ExplorerMenu, { target });
        flushSync();
    }

    const column = () => target.querySelector<HTMLElement>('[data-testid="actions-explorer"] .k-control-column');
    const labels = (): string[] =>
        [...(column()?.querySelectorAll("button") ?? [])].map(
            (button) => button.getAttribute("aria-label") ?? button.dataset.testid ?? "",
        );

    describe("with no tools registered as active, which is upstream's own column", () => {
        it("draws the zoom controls and the explore control, and nothing else", () => {
            show();

            expect(labels()).toEqual([
                "mapEditor.explorer.zoomIn",
                "mapEditor.explorer.zoomOut",
                "mapEditor.explorer.title",
            ]);
        });

        it("swaps the explore control for 'show my location' once the view is dragged away from the avatar", () => {
            cameraDetachedStore.set(true);
            show();

            expect(labels()).toEqual([
                "mapEditor.explorer.zoomIn",
                "mapEditor.explorer.zoomOut",
                "mapEditor.explorer.showMyLocation",
            ]);
            expect(target.querySelector('[data-testid="center-camera-on-player"]')).not.toBeNull();
        });
    });

    describe("with tools active", () => {
        it("draws them as rows of the same column, above the zoom controls", () => {
            toolsActive.set(true);
            show();

            expect(labels()).toEqual([
                "fixture-tool-a",
                "fixture-tool-b",
                "mapEditor.explorer.zoomIn",
                "mapEditor.explorer.zoomOut",
                "mapEditor.explorer.title",
            ]);
        });

        it("puts them in and takes them out as they turn on and off, in the same capsule", () => {
            show();
            const capsule = target.querySelector('[data-testid="actions-explorer"]');

            toolsActive.set(true);
            flushSync();
            expect(
                target.querySelector('[data-testid="fixture-tool-a"]')?.closest('[data-testid="actions-explorer"]'),
            ).toBe(capsule);
            toolsActive.set(false);
            flushSync();

            expect(target.querySelector('[data-testid="fixture-tool-a"]')).toBeNull();
        });

        it("keeps the explore control after a drag, since the tools own the way back to the avatar", () => {
            toolsActive.set(true);
            cameraDetachedStore.set(true);
            show();

            expect(labels()).toContain("mapEditor.explorer.title");
            expect(target.querySelector('[data-testid="center-camera-on-player"]')).toBeNull();
        });

        it("still shows upstream's 'show my location' in the map editor, where the tools step aside", () => {
            toolsActive.set(true);
            mapEditorModeStore.set(true);
            show();

            expect(target.querySelector('[data-testid="center-camera-on-player"]')).not.toBeNull();
            expect(labels()).not.toContain("mapEditor.explorer.title");
        });
    });
});
