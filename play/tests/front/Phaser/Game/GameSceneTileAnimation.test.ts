// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import type { Room } from "../../../../src/front/Connection/Room";
import { localUserStore } from "../../../../src/front/Connection/LocalUserStore";

// GameScene is too heavy to boot in a unit test, so the scene is built with its real constructor and only what
// needs a running Phaser game (the clock, the camera, the map wrapper) is replaced.

interface TileAnimationInternals {
    time: unknown;
    cameras: unknown;
    gameMapFrontWrapper: unknown;
    configureTileAnimations(): void;
}

const animationFrames = [
    { tileid: 2, duration: 660 },
    { tileid: 3, duration: 220 },
];
const tileset = {
    firstgid: 5,
    tileData: { 2: { animation: animationFrames } },
    getAnimatedTileId(gid: number, elapsedMs: number) {
        let elapsed = elapsedMs % 880;
        for (const frame of animationFrames) {
            if (elapsed < frame.duration) {
                return this.firstgid + frame.tileid;
            }
            elapsed -= frame.duration;
        }
        return gid;
    },
};

/** A scene whose only animated tile (gid 7, frame change at 660 ms) is on screen. */
function createSceneWithVisibleAnimatedTile() {
    const room = { key: "https://play.example/_/global/map.json", mapUrl: "https://play.example/map.json" };
    const scene = new GameScene(room as unknown as Room, "tile-animation-scene");
    const internals = scene as unknown as TileAnimationInternals;

    const data = Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => ({ index: -1 })));
    data[3][4] = { index: 7 };
    const animatedLayer = {
        visible: true,
        alpha: 1,
        x: 0,
        y: 0,
        timeElapsed: 0,
        tileset: [tileset],
        gidMap: { 7: tileset },
        layer: { data },
    };

    const timerCallbacks: Array<() => void> = [];
    internals.time = {
        addEvent: (config: { callback: () => void }) => {
            timerCallbacks.push(config.callback);
            return { remove: vi.fn() };
        },
    };
    internals.cameras = { main: { worldView: { x: 0, y: 0, width: 320, height: 192 } } };
    internals.gameMapFrontWrapper = {
        phaserLayers: [animatedLayer],
        phaserMap: { tileWidth: 32, tileHeight: 32 },
        getTileAnimationRefreshDelay: () => 100,
        setTileAnimationsPaused: vi.fn(),
    };

    const markDirty = vi.spyOn(scene, "markDirty").mockImplementation(() => {});
    internals.configureTileAnimations();
    // Configuring the timer repaints once by itself; the tests count the repaints the timer asks for.
    markDirty.mockClear();

    const tick = () => timerCallbacks[timerCallbacks.length - 1]();
    return { internals, animatedLayer, markDirty, tick };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("GameScene animated tile timer", () => {
    it("repaints only on a tick where a visible animated tile changed picture", () => {
        const { animatedLayer, markDirty, tick } = createSceneWithVisibleAnimatedTile();

        tick();
        expect(markDirty).toHaveBeenCalledTimes(1);

        animatedLayer.timeElapsed = 300;
        tick();
        expect(markDirty).toHaveBeenCalledTimes(1);

        animatedLayer.timeElapsed = 700;
        tick();
        expect(markDirty).toHaveBeenCalledTimes(2);
    });

    it("never repaints while the user disabled animations", () => {
        vi.spyOn(localUserStore, "getDisableAnimations").mockReturnValue(true);
        const { animatedLayer, markDirty, tick } = createSceneWithVisibleAnimatedTile();

        tick();
        animatedLayer.timeElapsed = 700;
        tick();

        expect(markDirty).not.toHaveBeenCalled();
    });

    it("repaints on the first tick after the timer is configured again, as on a map reload", () => {
        const { internals, markDirty, tick } = createSceneWithVisibleAnimatedTile();
        tick();
        tick();
        expect(markDirty).toHaveBeenCalledTimes(1);

        internals.configureTileAnimations();
        markDirty.mockClear();
        tick();

        expect(markDirty).toHaveBeenCalledTimes(1);
    });
});
