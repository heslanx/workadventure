import { describe, expect, it, vi } from "vitest";
import {
    DOUBLE_CLICK_MS,
    TileInteractionController,
    WALK_POLL_MS,
    WALK_STATUS_INTERVAL_MS,
    type Point,
    type TileInteractionHost,
    type TileInteractionState,
    type TileMarks,
    type TilePointer,
} from "./TileInteractionController";

const TILE = 32;

type TestHost = TileInteractionHost & {
    scroll: Point;
    zoom: number;
    allowed: boolean;
    allowedToWalk: boolean;
    walking: boolean;
    finishWalk: () => void;
    walkTo: ReturnType<typeof vi.fn<(destination: Point) => Promise<void>>>;
    cancelWalk: ReturnType<typeof vi.fn<() => void>>;
    isWalking: ReturnType<typeof vi.fn<() => boolean>>;
    paint: ReturnType<typeof vi.fn<(marks: TileMarks) => void>>;
};

interface Setup {
    readonly controller: TileInteractionController;
    readonly host: TestHost;
    readonly states: TileInteractionState[];
}

/** A scene whose camera scrolls and zooms as Phaser's does: the world point under a screen point follows both. */
function setup(): Setup {
    const states: TileInteractionState[] = [];
    let finish: () => void = () => undefined;
    const host: TestHost = {
        scroll: { x: 0, y: 0 },
        zoom: 1,
        allowed: true,
        allowedToWalk: true,
        walking: false,
        finishWalk: () => finish(),
        tileSize: () => ({ width: TILE, height: TILE }),
        mapSize: () => ({ width: 20, height: 15 }),
        screenToWorld(point: Point): Point {
            return { x: point.x / host.zoom + host.scroll.x, y: point.y / host.zoom + host.scroll.y };
        },
        worldToScreen(point: Point): Point {
            return { x: (point.x - host.scroll.x) * host.zoom, y: (point.y - host.scroll.y) * host.zoom };
        },
        canSelect: () => host.allowed,
        canWalk: () => host.allowedToWalk,
        walkTo: vi.fn<(destination: Point) => Promise<void>>(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        ),
        isWalking: vi.fn<() => boolean>(() => host.walking),
        cancelWalk: vi.fn<() => void>(() => {
            host.walking = false;
            finish();
        }),
        paint: vi.fn<(marks: TileMarks) => void>(),
    };
    const controller = new TileInteractionController(host, (state) => states.push(state));
    return { controller, host, states };
}

function pointer(x: number, y: number, time: number, overrides: Partial<TilePointer> = {}): TilePointer {
    return { id: 1, x, y, button: "left", touch: false, time, ...overrides };
}

/** A left click on the middle of tile (column, row), as the mouse makes it: a press and a release in place. */
function click(
    { controller }: Setup,
    column: number,
    row: number,
    time: number,
    { overObject = false, overrides = {} }: { overObject?: boolean; overrides?: Partial<TilePointer> } = {},
): void {
    const x = column * TILE + TILE / 2;
    const y = row * TILE + TILE / 2;
    controller.pointerDown(pointer(x, y, time, overrides));
    controller.pointerUp(pointer(x, y, time + 40, overrides), overObject);
}

describe("TileInteractionController: a single click", () => {
    it("selects the tile under the pointer and asks the host to draw it", () => {
        const scene = setup();

        click(scene, 3, 2, 1000);

        expect(scene.controller.state.selected).toEqual({ tileX: 3, tileY: 2 });
        expect(scene.host.paint).toHaveBeenLastCalledWith({ selected: { tileX: 3, tileY: 2 }, hovered: undefined });
        expect(scene.host.walkTo).not.toHaveBeenCalled();
    });

    it("moves the selection to another tile", () => {
        const scene = setup();

        click(scene, 3, 2, 1000);
        click(scene, 5, 2, 1100);

        expect(scene.controller.state.selected).toEqual({ tileX: 5, tileY: 2 });
        expect(scene.host.walkTo).not.toHaveBeenCalled();
    });

    it("clears the selection when the same tile is clicked again after the double click window", () => {
        const scene = setup();

        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1000 + DOUBLE_CLICK_MS + 100);

        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.host.walkTo).not.toHaveBeenCalled();
        expect(scene.host.paint).toHaveBeenLastCalledWith({ selected: undefined, hovered: undefined });
    });

    it("selects nothing outside the map", () => {
        const scene = setup();

        click(scene, 20, 2, 1000);
        click(scene, 3, -1, 1100);

        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.host.paint).not.toHaveBeenCalled();
    });

    it("leaves a click on an avatar or an object to the scene's own handler", () => {
        const scene = setup();

        click(scene, 3, 2, 1000, { overObject: true });

        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.host.walkTo).not.toHaveBeenCalled();
    });

    it("selects nothing while the player may not use the map", () => {
        const scene = setup();
        scene.host.allowed = false;

        click(scene, 3, 2, 1000);

        expect(scene.controller.state.selected).toBeUndefined();
    });

    it("is cleared by Escape, which answers whether it had a selection to clear", () => {
        const scene = setup();

        expect(scene.controller.escape()).toBe(false);
        click(scene, 3, 2, 1000);
        expect(scene.controller.escape()).toBe(true);

        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.host.paint).toHaveBeenLastCalledWith({ selected: undefined, hovered: undefined });
        expect(scene.controller.escape()).toBe(false);
    });

    it("is dropped when the player may no longer use the map, as when the map editor opens", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);

        scene.host.allowed = false;
        scene.controller.update(1100);

        expect(scene.controller.state.selected).toBeUndefined();
    });
});

describe("TileInteractionController: a double click", () => {
    it("walks to the middle of the tile and clears the selection", () => {
        const scene = setup();

        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1000 + DOUBLE_CLICK_MS - 100);

        // Column 3, row 2 of 32 px tiles: its middle is at (112, 80).
        expect(scene.host.walkTo).toHaveBeenCalledExactlyOnceWith({ x: 112, y: 80 });
        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.host.paint).toHaveBeenLastCalledWith({ selected: undefined, hovered: undefined });
    });

    it("needs the second click within the window", () => {
        const scene = setup();

        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1000 + DOUBLE_CLICK_MS + 100);

        expect(scene.host.walkTo).not.toHaveBeenCalled();
    });

    it("needs both clicks on the same tile", () => {
        const scene = setup();

        click(scene, 3, 2, 1000);
        click(scene, 4, 2, 1100);

        expect(scene.host.walkTo).not.toHaveBeenCalled();
        expect(scene.controller.state.selected).toEqual({ tileX: 4, tileY: 2 });
    });

    it("does not walk a third time on a triple click", () => {
        const scene = setup();

        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);
        click(scene, 3, 2, 1200);

        expect(scene.host.walkTo).toHaveBeenCalledTimes(1);
    });

    it("does not walk where the room does not let the player move by clicking, and keeps to selecting", () => {
        const scene = setup();
        scene.host.allowedToWalk = false;

        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);

        expect(scene.host.walkTo).not.toHaveBeenCalled();
        expect(scene.controller.state.selected).toBeUndefined();
    });

    it("is not made of a click on an avatar and a click on the floor", () => {
        const scene = setup();

        click(scene, 3, 2, 1000, { overObject: true });
        click(scene, 3, 2, 1100);

        expect(scene.host.walkTo).not.toHaveBeenCalled();
    });
});

describe("TileInteractionController: a drag of the map", () => {
    it("is not a click: a press that moved past the drag threshold selects nothing", () => {
        const scene = setup();

        scene.controller.pointerDown(pointer(100, 100, 1000));
        scene.controller.pointerMove(pointer(100 + 20, 100, 1020), false);
        scene.controller.pointerUp(pointer(100 + 20, 100, 1040), false);

        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.host.paint).not.toHaveBeenCalled();
    });

    it("is not a click even when the pointer comes back to where it started", () => {
        const scene = setup();

        scene.controller.pointerDown(pointer(100, 100, 1000));
        scene.controller.pointerMove(pointer(160, 100, 1020), false);
        scene.controller.pointerMove(pointer(100, 100, 1040), false);
        scene.controller.pointerUp(pointer(100, 100, 1060), false);

        expect(scene.controller.state.selected).toBeUndefined();
    });

    it("still lets a press with a small jitter be a click", () => {
        const scene = setup();

        scene.controller.pointerDown(pointer(100, 100, 1000));
        scene.controller.pointerMove(pointer(103, 101, 1010), false);
        scene.controller.pointerUp(pointer(103, 101, 1040), false);

        expect(scene.controller.state.selected).toEqual({ tileX: 3, tileY: 3 });
    });

    it("does not pair a drag with the click before it into a double click", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);

        scene.controller.pointerDown(pointer(3 * TILE + 10, 2 * TILE + 10, 1100));
        scene.controller.pointerMove(pointer(3 * TILE + 50, 2 * TILE + 10, 1120), false);
        scene.controller.pointerUp(pointer(3 * TILE + 10, 2 * TILE + 10, 1140), false);
        click(scene, 3, 2, 1200);

        expect(scene.host.walkTo).not.toHaveBeenCalled();
    });

    it("is not a click when the press is cancelled, as when a modal takes the pointer away", () => {
        const scene = setup();

        scene.controller.pointerDown(pointer(100, 100, 1000));
        scene.controller.pointerCancel();
        scene.controller.pointerUp(pointer(100, 100, 1040), false);

        expect(scene.controller.state.selected).toBeUndefined();
    });
});

describe("TileInteractionController: other buttons and touch", () => {
    it("leaves a right click to the scene, which already walks there: no selection and no second walk", () => {
        const scene = setup();

        click(scene, 3, 2, 1000, { overrides: { button: "right" } });

        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.host.walkTo).not.toHaveBeenCalled();
    });

    it("does not take the release of the right button, while the left is held, for a left click", () => {
        const scene = setup();

        scene.controller.pointerDown(pointer(48, 48, 1000));
        scene.controller.pointerUp(pointer(48, 48, 1040, { button: "right" }), false);

        expect(scene.controller.state.selected).toBeUndefined();
    });

    it("keeps the selection through a right click until the walk it starts is noticed, then drops it", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 8, 4, 1700, { overrides: { button: "right" } });
        expect(scene.controller.state.selected).toEqual({ tileX: 3, tileY: 2 });

        scene.host.walking = true;
        scene.controller.update(1800);

        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.controller.state.walking).toBe(true);
        expect(scene.host.walkTo).not.toHaveBeenCalled();
    });

    it("leaves a touch tap to the scene, which walks on it: no selection and no second walk", () => {
        const scene = setup();

        click(scene, 3, 2, 1000, { overrides: { touch: true } });
        click(scene, 3, 2, 1100, { overrides: { touch: true } });

        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.host.walkTo).not.toHaveBeenCalled();
    });
});

describe("TileInteractionController: the tile under the pointer", () => {
    it("hovers the tile under the pointer and asks the host to draw it", () => {
        const scene = setup();

        scene.controller.pointerMove(pointer(100, 70, 1000, { button: "other" }), false);

        expect(scene.controller.state.hovered).toEqual({ tileX: 3, tileY: 2 });
        expect(scene.host.paint).toHaveBeenLastCalledWith({ selected: undefined, hovered: { tileX: 3, tileY: 2 } });
    });

    it("asks the host to draw again only when the tile changes", () => {
        const scene = setup();

        scene.controller.pointerMove(pointer(100, 70, 1000), false);
        scene.controller.pointerMove(pointer(105, 75, 1010), false);
        scene.controller.pointerMove(pointer(140, 75, 1020), false);

        expect(scene.host.paint).toHaveBeenCalledTimes(2);
    });

    it("follows the camera's zoom and scroll: the same pointer is over another tile", () => {
        const scene = setup();
        scene.host.zoom = 2;
        scene.host.scroll = { x: 96, y: 32 };

        // World x = 100 / 2 + 96 = 146 (tile 4), world y = 70 / 2 + 32 = 67 (tile 2) at zoom 2; tile (3, 2) at zoom 1.
        scene.controller.pointerMove(pointer(100, 70, 1000), false);

        expect(scene.controller.state.hovered).toEqual({ tileX: 4, tileY: 2 });
    });

    it("projects a tile back to the screen at the camera's zoom, so the projection and the pointer agree", () => {
        const scene = setup();
        scene.host.zoom = 2;
        scene.host.scroll = { x: 96, y: 32 };
        scene.controller.pointerMove(pointer(100, 70, 1000), false);
        const hovered = scene.controller.state.hovered;
        if (hovered === undefined) throw new Error("the pointer should hover a tile");

        const rect = scene.controller.project(hovered);

        // Tile (4, 2) starts at world (128, 64); the view starts at (96, 32) and magnifies by 2.
        expect(rect).toEqual({ x: 64, y: 64, width: 64, height: 64 });
        expect(100).toBeGreaterThanOrEqual(rect.x);
        expect(100).toBeLessThan(rect.x + rect.width);
        expect(70).toBeGreaterThanOrEqual(rect.y);
        expect(70).toBeLessThan(rect.y + rect.height);
    });

    it("projects the same tile bigger when the camera zooms in and elsewhere when it scrolls", () => {
        const scene = setup();
        const tile = { tileX: 4, tileY: 2 };

        const far = scene.controller.project(tile);
        scene.host.zoom = 3;
        const near = scene.controller.project(tile);
        scene.host.scroll = { x: 64, y: 0 };
        const scrolled = scene.controller.project(tile);

        expect([far.width, near.width]).toEqual([TILE, TILE * 3]);
        // Tile 4 at zoom 3 starts at x = 128 * 3 = 384; scrolling the view 64 world pixels right moves it 192 left.
        expect([near.x, scrolled.x]).toEqual([384, 192]);
    });

    it("is not drawn over an avatar, while a button is held, after the pointer leaves, or for touch", () => {
        const scene = setup();
        scene.controller.pointerMove(pointer(100, 70, 1000), false);

        scene.controller.pointerMove(pointer(100, 70, 1010), true);
        expect(scene.controller.state.hovered).toBeUndefined();

        scene.controller.pointerMove(pointer(100, 70, 1020), false);
        scene.controller.pointerOut();
        expect(scene.controller.state.hovered).toBeUndefined();

        scene.controller.pointerMove(pointer(100, 70, 1030, { touch: true }), false);
        expect(scene.controller.state.hovered).toBeUndefined();

        scene.controller.pointerMove(pointer(100, 70, 1040), false);
        scene.controller.pointerDown(pointer(100, 70, 1050));
        scene.controller.pointerMove(pointer(160, 70, 1060), false);
        expect(scene.controller.state.hovered).toBeUndefined();
    });

    it("is dropped when the player may no longer use the map", () => {
        const scene = setup();
        scene.controller.pointerMove(pointer(100, 70, 1000), false);

        scene.host.allowed = false;
        scene.controller.update(1100);

        expect(scene.controller.state.hovered).toBeUndefined();
    });
});

describe("TileInteractionController: a walk", () => {
    it("shows at once when the controller starts it, and the host is not asked before it can answer", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);

        click(scene, 3, 2, 1100);

        expect(scene.controller.state.walking).toBe(true);
        expect(scene.controller.state.walkStatus).toBe("going");
        expect(scene.states.at(-1)?.walking).toBe(true);
    });

    it("keeps showing a walk it started while the scene cannot yet say that the player walks", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);

        scene.controller.update(1100 + WALK_POLL_MS);
        scene.controller.update(1100 + 2 * WALK_POLL_MS);

        expect(scene.host.walking).toBe(false);
        expect(scene.controller.state.walking).toBe(true);
    });

    it("shows when the scene starts it, as a right click does, within the poll interval", () => {
        const scene = setup();
        scene.controller.update(1000);
        scene.host.walking = true;

        scene.controller.update(1000 + WALK_POLL_MS - 1);
        expect(scene.controller.state.walking).toBe(false);
        scene.controller.update(1000 + WALK_POLL_MS);

        expect(scene.controller.state.walking).toBe(true);
        expect(scene.controller.state.walkStatus).toBe("going");
    });

    it("asks the host whether the player walks no more than once per poll interval", () => {
        const scene = setup();

        for (let time = 1000; time < 1000 + WALK_POLL_MS * 4; time += 16) scene.controller.update(time);

        expect(scene.host.isWalking.mock.calls.length).toBeLessThanOrEqual(5);
        expect(scene.host.isWalking.mock.calls.length).toBeGreaterThan(1);
    });

    it("ends when the walk ends", async () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);

        scene.host.finishWalk();
        await Promise.resolve();
        await Promise.resolve();
        scene.controller.update(1200);

        expect(scene.controller.state.walking).toBe(false);
    });

    it("shows a host that breaks its contract by rejecting, and stops counting that walk", async () => {
        const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const scene = setup();
        scene.host.walkTo.mockRejectedValueOnce(new Error("no path"));
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);

        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
        scene.controller.update(1200);

        expect(report).toHaveBeenCalledTimes(1);
        expect(scene.controller.state.walking).toBe(false);
        report.mockRestore();
    });

    it("is ended by cancelling: the host stops the player and the state follows at once", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);

        const cancelled = scene.controller.cancelWalk();

        expect(cancelled).toBe(true);
        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(1);
        expect(scene.controller.state.walking).toBe(false);
        expect(scene.states.at(-1)?.walking).toBe(false);
    });

    it("has nothing to cancel when the player does not walk, and does not bother the host", () => {
        const scene = setup();

        expect(scene.controller.cancelWalk()).toBe(false);

        expect(scene.host.cancelWalk).not.toHaveBeenCalled();
    });

    it("says it was cancelled until the next walk, and the status changes no more than once a second", async () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        scene.controller.update(1100);
        click(scene, 3, 2, 1100);
        expect(scene.controller.state.walkStatus).toBe("going");

        scene.controller.cancelWalk();
        await Promise.resolve();
        await Promise.resolve();
        scene.controller.update(1100 + WALK_STATUS_INTERVAL_MS - 100);
        expect(scene.controller.state.walkStatus).toBe("going");
        scene.controller.update(1100 + WALK_STATUS_INTERVAL_MS + 100);

        expect(scene.controller.state.walking).toBe(false);
        expect(scene.controller.state.walkStatus).toBe("cancelled");
    });

    it("is ended by Escape before the selection: the walk goes on the first press, the selection on the next", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);
        click(scene, 6, 4, 5000);
        expect(scene.controller.state.selected).toEqual({ tileX: 6, tileY: 4 });

        expect(scene.controller.escape()).toBe(true);
        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(1);
        expect(scene.controller.state.walking).toBe(false);
        expect(scene.controller.state.selected).toEqual({ tileX: 6, tileY: 4 });

        expect(scene.controller.escape()).toBe(true);
        expect(scene.controller.state.selected).toBeUndefined();
        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(1);
        expect(scene.controller.escape()).toBe(false);
    });

    it("is ended by Escape when the scene started it, even before the poll has noticed it", () => {
        const scene = setup();
        scene.host.walking = true;

        expect(scene.controller.escape()).toBe(true);

        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(1);
        expect(scene.controller.state.walking).toBe(false);
    });

    it("leaves Escape to whoever has the controls: it ends no walk while the player may not use the map", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);
        scene.host.allowed = false;

        expect(scene.controller.escape()).toBe(false);

        expect(scene.host.cancelWalk).not.toHaveBeenCalled();
        expect(scene.controller.state.walking).toBe(true);
    });

    it("ends a walk cancelled while the host still searches for its path, as soon as the path starts", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);
        scene.controller.update(1100 + WALK_POLL_MS);
        scene.host.cancelWalk.mockClear();

        // No path yet: the host's cancel has nothing to end.
        scene.host.cancelWalk.mockImplementationOnce(() => undefined);
        expect(scene.controller.cancelWalk()).toBe(true);
        scene.controller.update(1100 + 2 * WALK_POLL_MS);
        expect(scene.controller.state.walking).toBe(false);
        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(1);

        // The host finds the path and the player starts along it.
        scene.host.walking = true;
        scene.controller.update(1100 + 3 * WALK_POLL_MS);

        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(2);
        expect(scene.host.walking).toBe(false);
        expect(scene.controller.state.walking).toBe(false);
    });

    it("ends a cancelled walk's path once, and leaves a walk started during its search alone", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);
        // The host is still searching, so there is no path to end and the first walk's promise stays unsettled.
        scene.host.cancelWalk.mockImplementation(() => {
            scene.host.walking = false;
        });
        scene.controller.cancelWalk();
        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(1);

        // A second walk starts while the first one searches.
        click(scene, 6, 4, 1200);
        click(scene, 6, 4, 1300);
        scene.host.walking = true;
        scene.controller.update(1400);
        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(2);

        // The first walk's path was ended: the second walk's path, which starts now, is its own.
        scene.host.walking = true;
        scene.controller.update(1400 + WALK_POLL_MS);
        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(2);
        expect(scene.host.walking).toBe(true);
        expect(scene.controller.state.walking).toBe(true);
    });

    it("does not end a path that starts after the player ended the walk that had one, before its promise settles", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);
        scene.host.walking = true;
        scene.controller.update(1100 + WALK_POLL_MS);
        expect(scene.controller.cancelWalk()).toBe(true);
        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(1);

        // A right click starts a walk in the same tick, before the first walk's promise has settled.
        scene.host.walking = true;
        scene.controller.update(1100 + 2 * WALK_POLL_MS);

        expect(scene.host.cancelWalk).toHaveBeenCalledTimes(1);
        expect(scene.host.walking).toBe(true);
        expect(scene.controller.state.walking).toBe(true);
    });

    it("does not show a walk cancelled during its search as going again at the next poll", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);
        scene.host.cancelWalk.mockImplementationOnce(() => undefined);

        scene.controller.cancelWalk();
        scene.controller.update(1100 + WALK_POLL_MS);
        scene.controller.update(1100 + 4 * WALK_POLL_MS);

        expect(scene.controller.state.walking).toBe(false);
        expect(scene.states.at(-1)?.walking).toBe(false);
    });

    it("stops ending walks once the cancelled one has settled, so a later walk is left alone", async () => {
        const scene = setup();
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1100);
        scene.controller.cancelWalk();
        await Promise.resolve();
        await Promise.resolve();
        scene.host.cancelWalk.mockClear();

        scene.host.walking = true;
        scene.controller.update(2000);

        expect(scene.host.cancelWalk).not.toHaveBeenCalled();
        expect(scene.controller.state.walking).toBe(true);
    });

    it("is not shown when the host throws before it has the walk, and the error is reported", () => {
        const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const scene = setup();
        scene.host.walkTo.mockImplementationOnce(() => {
            throw new Error("no scene");
        });
        click(scene, 3, 2, 1000);

        expect(() => click(scene, 3, 2, 1100)).not.toThrow();
        scene.controller.update(1100 + WALK_POLL_MS);

        expect(report).toHaveBeenCalledTimes(1);
        expect(scene.controller.state.walking).toBe(false);
        expect(scene.controller.state.walkStatus).toBe("idle");
        expect(scene.states.every((state) => !state.walking)).toBe(true);
        expect(scene.controller.cancelWalk()).toBe(false);
        report.mockRestore();
    });

    it("goes back to idle when a walk ends by arriving", () => {
        const scene = setup();
        scene.host.walking = true;
        scene.controller.update(1000);
        expect(scene.controller.state.walkStatus).toBe("going");

        scene.host.walking = false;
        scene.controller.update(1000 + WALK_STATUS_INTERVAL_MS + WALK_POLL_MS);

        expect(scene.controller.state.walkStatus).toBe("idle");
    });
});

describe("TileInteractionController: disposing", () => {
    it("takes its marks off the map and answers no more frames", () => {
        const scene = setup();
        click(scene, 3, 2, 1000);

        scene.controller.dispose();
        const calls = scene.states.length;
        scene.host.walking = true;
        scene.controller.update(5000);

        expect(scene.host.paint).toHaveBeenLastCalledWith({ selected: undefined, hovered: undefined });
        expect(scene.states).toHaveLength(calls);
    });
});
