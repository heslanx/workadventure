// @vitest-environment jsdom
import * as Phaser from "phaser";
import { readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneFrameContext } from "../../../ExternalModule/ClientExtensionPoints";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
import { NOT_WALKING } from "../domain/walk";
import { createTileInteractionExtension } from "./tileInteractionExtension";

const TILE = 32;
const { POINTER_DOWN, POINTER_MOVE, POINTER_UP, GAME_OUT, POINTER_UP_OUTSIDE } = Phaser.Input.Events;

type Handler = (...args: never[]) => void;

/** The scene's input as the extension reads it: listeners by event name, and a way to fire them. */
function createScene() {
    const listeners = new Map<string, Set<Handler>>();
    const emitter = {
        on: vi.fn((name: string, handler: Handler) => {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name)?.add(handler);
        }),
        off: vi.fn((name: string, handler: Handler) => {
            listeners.get(name)?.delete(handler);
        }),
    };
    const graphics = {
        strokes: 0,
        cleared: 0,
        destroyed: false,
        clear() {
            graphics.cleared++;
            return graphics;
        },
        lineStyle: () => graphics,
        fillStyle: () => graphics,
        strokeRect() {
            graphics.strokes++;
            return graphics;
        },
        fillRect: () => graphics,
        setDepth: () => graphics,
        destroy() {
            graphics.destroyed = true;
        },
    };
    const camera = {
        getWorldPoint: (x: number, y: number) => ({ x, y }),
        matrixCombined: { transformPoint: (x: number, y: number) => ({ x, y }) },
    };
    const cameraManager = {
        getCamera: () => camera,
        startWalkFraming: vi.fn(() => 7),
        endWalkFraming: vi.fn(),
    };
    const player = { getPathAhead: vi.fn((): unknown[] => []), finishFollowingPath: vi.fn() };
    const input = { ...emitter, keyboard: { ...emitter } };
    const game = { events: emitter };
    let finishMove: () => void = () => undefined;
    let failMove: (error: unknown) => void = () => undefined;
    const scene = {
        input,
        game,
        add: { graphics: () => graphics },
        scale: { displayScale: { x: 1 } },
        cameras: { main: { zoom: 1 } },
        room: { primaryColor: undefined as string | undefined },
        markDirty: vi.fn(),
        getGameMapFrontWrapper: () => ({
            getTileDimensions: () => ({ width: TILE, height: TILE }),
            getMap: () => ({ width: 20, height: 15 }),
        }),
        getCameraManager: () => cameraManager,
        userInputManager: { isControlsEnabled: true, isRightClickEnabled: true },
        CurrentPlayer: player,
        moveTo: vi.fn(
            () =>
                new Promise<{ x: number; y: number; cancelled: boolean }>((resolve, reject) => {
                    finishMove = () => resolve({ x: 0, y: 0, cancelled: false });
                    failMove = reject;
                }),
        ),
    };
    return {
        scene: scene as unknown as GameScene,
        fake: scene,
        graphics,
        cameraManager,
        player,
        finishMove: () => finishMove(),
        failMove: (error: unknown) => failMove(error),
        listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) + 0,
        fire(name: string, ...args: unknown[]) {
            for (const handler of [...(listeners.get(name) ?? [])]) (handler as (...a: unknown[]) => void)(...args);
        },
    };
}

type Scene = ReturnType<typeof createScene>;

function pointer(x: number, y: number, time: number, extra: Record<string, unknown> = {}) {
    return { id: 1, x, y, button: 0, wasTouch: false, event: { timeStamp: time }, ...extra };
}

function frame(scene: Scene, time = 0, withPlayer = true): SceneFrameContext {
    return { scene: scene.scene, time, currentPlayer: withPlayer ? {} : undefined } as unknown as SceneFrameContext;
}

/** A left click on the middle of tile (column, row): the press, and the release in place. */
function click(scene: Scene, column: number, row: number, time: number, over: unknown[] = [], extra = {}) {
    const x = column * TILE + TILE / 2;
    const y = row * TILE + TILE / 2;
    scene.fire(POINTER_DOWN, pointer(x, y, time, extra), over);
    scene.fire(POINTER_UP, pointer(x, y, time + 40, extra), over);
}

describe("the tile interaction extension", () => {
    const active = writable(true);
    const publish = vi.fn();
    const options = { active, publish };

    beforeEach(() => {
        active.set(true);
        mapEditorModeStore.set(false);
    });

    afterEach(() => {
        publish.mockReset();
        vi.restoreAllMocks();
    });

    it("waits for the scene to create the current player, and listens to nothing before", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);

        extension.onFrame?.(frame(scene, 0, false));

        expect(scene.listenerCount()).toBe(0);
    });

    it("selects a tile on a click, draws it, and walks there on a double click through the scene's own pathfinding", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        click(scene, 3, 2, 1000);
        expect(scene.graphics.strokes).toBe(1);
        click(scene, 3, 2, 1200);

        expect(scene.fake.moveTo).toHaveBeenCalledExactlyOnceWith(
            { x: 3 * TILE + TILE / 2, y: 2 * TILE + TILE / 2 },
            true,
        );
        expect(scene.cameraManager.startWalkFraming).toHaveBeenCalledWith({
            x: 3 * TILE + TILE / 2,
            y: 2 * TILE + TILE / 2,
        });
        expect(publish).toHaveBeenLastCalledWith({ walking: true, walkStatus: "going" });
    });

    it("lets the view settle back when the walk ends, however it ends", async () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1200);

        scene.finishMove();

        await vi.waitFor(() => expect(scene.cameraManager.endWalkFraming).toHaveBeenCalledExactlyOnceWith(7));
    });

    it("reports a walk that failed, and still lets the view settle back", async () => {
        const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1200);

        scene.failMove(new Error("No path found"));

        await vi.waitFor(() => expect(scene.cameraManager.endWalkFraming).toHaveBeenCalledWith(7));
        expect(report).toHaveBeenCalledTimes(1);
        expect(String(report.mock.calls[0]?.[0])).toContain("could not walk");
    });

    it("selects nothing on a map that does not say its size, which has no grid to walk on", () => {
        const scene = createScene();
        scene.fake.getGameMapFrontWrapper = () =>
            ({
                getTileDimensions: () => ({ width: TILE, height: TILE }),
                getMap: () => ({}),
            }) as never;
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        click(scene, 3, 2, 1000);

        expect(scene.graphics.strokes).toBe(0);
    });

    it("draws the selection again when the camera zooms, so its lines keep their width on screen", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));
        click(scene, 3, 2, 1000);
        const cleared = scene.graphics.cleared;

        scene.fake.cameras.main.zoom = 2;
        extension.onFrame?.(frame(scene, 1100));

        expect(scene.graphics.cleared).toBeGreaterThan(cleared);
    });

    it("walks nowhere on a right click or a touch tap, which the scene's own handler already walks", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        click(scene, 3, 2, 1000, [], { button: 2 });
        click(scene, 3, 2, 1100, [], { button: 2 });
        click(scene, 4, 2, 2000, [], { wasTouch: true });
        click(scene, 4, 2, 2100, [], { wasTouch: true });

        expect(scene.fake.moveTo).not.toHaveBeenCalled();
        expect(scene.graphics.strokes).toBe(0);
    });

    it("leaves a click on an avatar or an object to the scene", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        click(scene, 3, 2, 1000, [{}]);
        click(scene, 3, 2, 1100, [{}]);

        expect(scene.fake.moveTo).not.toHaveBeenCalled();
        expect(scene.graphics.strokes).toBe(0);
    });

    it("does not mistake a drag of the map for a click", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        scene.fire(POINTER_DOWN, pointer(100, 100, 1000), []);
        scene.fire(POINTER_MOVE, pointer(160, 100, 1020), []);
        scene.fire(POINTER_UP, pointer(160, 100, 1040), []);

        expect(scene.graphics.strokes).toBe(0);
    });

    it("draws the tile under the pointer and takes it away when the pointer leaves the game", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        scene.fire(POINTER_MOVE, pointer(100, 70, 1000, { button: 0 }), []);
        expect(scene.graphics.strokes).toBe(1);
        const cleared = scene.graphics.cleared;
        scene.fire(GAME_OUT);

        expect(scene.graphics.cleared).toBeGreaterThan(cleared);
        expect(scene.graphics.strokes).toBe(1);
    });

    it("leaves the scene of a room whose office shell is off as upstream has it: no listener, nothing drawn", () => {
        active.set(false);
        const scene = createScene();
        const extension = createTileInteractionExtension(options);

        extension.onFrame?.(frame(scene, 100));
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1200);

        expect(scene.listenerCount()).toBe(0);
        expect(scene.fake.moveTo).not.toHaveBeenCalled();
        expect(scene.graphics.strokes).toBe(0);
    });

    it("starts when the shell turns on after the first frames, and stops when it turns off, as a loader or an error screen covers the map", () => {
        active.set(false);
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        active.set(true);
        extension.onFrame?.(frame(scene, 200));
        click(scene, 3, 2, 1000);
        expect(scene.graphics.strokes).toBe(1);
        active.set(false);
        click(scene, 5, 2, 2000);
        click(scene, 5, 2, 2100);
        extension.onFrame?.(frame(scene, 2200));

        expect(scene.fake.moveTo).not.toHaveBeenCalled();
        expect(scene.graphics.strokes).toBe(1);
        expect(scene.graphics.cleared).toBeGreaterThan(1);
    });

    it("follows the shell from the scene's first frame to its shutdown, and lets the store go", () => {
        let followers = 0;
        const watched = readable(true, () => {
            followers += 1;
            return () => {
                followers -= 1;
            };
        });
        const scene = createScene();
        const extension = createTileInteractionExtension({ active: watched, publish });

        extension.onFrame?.(frame(scene, 100));
        extension.onFrame?.(frame(scene, 200));
        expect(followers).toBe(1);
        extension.onShutdown?.(scene.scene);

        expect(followers).toBe(0);
    });

    it("does nothing while the map editor is open, or while the player's controls are off", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        mapEditorModeStore.set(true);
        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1200);
        mapEditorModeStore.set(false);
        scene.fake.userInputManager.isControlsEnabled = false;
        click(scene, 3, 2, 3000);
        click(scene, 3, 2, 3200);

        expect(scene.fake.moveTo).not.toHaveBeenCalled();
        expect(scene.graphics.strokes).toBe(0);
    });

    it("does not walk where a script disabled click to move, and keeps to selecting", () => {
        const scene = createScene();
        scene.fake.userInputManager.isRightClickEnabled = false;
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        click(scene, 3, 2, 1000);
        click(scene, 3, 2, 1200);

        expect(scene.fake.moveTo).not.toHaveBeenCalled();
    });

    it("clears the selection on Escape, unless the key comes from a control that uses it", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));
        click(scene, 3, 2, 1000);
        const cleared = scene.graphics.cleared;

        scene.fire("keydown-ESC", { target: document.createElement("input") });
        expect(scene.graphics.cleared).toBe(cleared);
        scene.fire("keydown-ESC", { target: document.body });

        expect(scene.graphics.cleared).toBeGreaterThan(cleared);
    });

    it("sees a walk the scene started, as a right click does, within a few frames", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));
        scene.player.getPathAhead.mockReturnValue([{ x: 10, y: 10 }]);

        extension.onFrame?.(frame(scene, 100 + 50));

        expect(publish).toHaveBeenLastCalledWith({ walking: true, walkStatus: "going" });
    });

    it("ends the walk in progress where the player stands", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));
        scene.player.getPathAhead.mockReturnValue([{ x: 10, y: 10 }]);
        extension.onFrame?.(frame(scene, 200));

        const cancelled = extension.cancelWalk();

        expect(cancelled).toBe(true);
        expect(scene.player.finishFollowingPath).toHaveBeenCalledExactlyOnceWith(true);
        expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ walking: false }));
    });

    it("has no walk to end before a scene runs, or when the player stands", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        expect(extension.cancelWalk()).toBe(false);

        extension.onFrame?.(frame(scene, 100));

        expect(extension.cancelWalk()).toBe(false);
        expect(scene.player.finishFollowingPath).not.toHaveBeenCalled();
    });

    it("takes every listener off, the marks off the map and the walk off the tools when the scene shuts down", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));
        expect(scene.listenerCount()).toBeGreaterThan(0);

        extension.onShutdown?.(scene.scene);

        expect(scene.listenerCount()).toBe(0);
        expect(scene.graphics.destroyed).toBe(true);
        expect(publish).toHaveBeenLastCalledWith(NOT_WALKING);
    });

    it("starts over in the next scene, with its own listeners and its own marks", () => {
        const first = createScene();
        const second = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(first, 100));
        extension.onShutdown?.(first.scene);

        extension.onFrame?.(frame(second, 100));
        click(second, 3, 2, 1000);

        expect(first.listenerCount()).toBe(0);
        expect(second.graphics.strokes).toBe(1);
    });

    it("moves to a new scene it was not told had gone, without leaving listeners on the old one", () => {
        const first = createScene();
        const second = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(first, 100));

        extension.onFrame?.(frame(second, 100));

        expect(first.listenerCount()).toBe(0);
        expect(second.listenerCount()).toBeGreaterThan(0);
    });

    it("listens to the pointer's cancel events too, so a lost press is not a click", () => {
        const scene = createScene();
        const extension = createTileInteractionExtension(options);
        extension.onFrame?.(frame(scene, 100));

        scene.fire(POINTER_DOWN, pointer(48, 48, 1000), []);
        scene.fire(POINTER_UP_OUTSIDE);
        scene.fire(POINTER_UP, pointer(48, 48, 1040), []);

        expect(scene.graphics.strokes).toBe(0);
    });
});
