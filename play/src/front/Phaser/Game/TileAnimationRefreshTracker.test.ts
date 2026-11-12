import { describe, expect, it, vi } from "vitest";
import { TileAnimationRefreshTracker } from "./TileAnimationRefreshTracker";

const animationFrames = [
    { tileid: 2, duration: 660 },
    { tileid: 3, duration: 220 },
];
const tileset = {
    firstgid: 5,
    tileData: { 2: { animation: animationFrames } },
    getAnimatedTileId(gid: number, elapsedMs: number) {
        if (gid !== 7) {
            return gid;
        }

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

function layer(cells: Array<[number, number, number]>, extra: Record<string, unknown> = {}) {
    const data = Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => ({ index: -1 })));
    for (const [x, y, index] of cells) {
        data[y][x] = { index };
    }

    return {
        visible: true,
        alpha: 1,
        x: 0,
        y: 0,
        timeElapsed: 0,
        tileset: [tileset],
        gidMap: { 6: tileset, 7: tileset },
        layer: { data },
        ...extra,
    };
}

const view = { x: 0, y: 0, width: 320, height: 192 };
const track = (tracker: TileAnimationRefreshTracker, layers: readonly unknown[], worldView = view, now = 0) =>
    tracker.shouldRedraw(layers, 32, 32, worldView, () => now);

describe("TileAnimationRefreshTracker", () => {
    it("redraws only when a visible animated cell changes picture", () => {
        const tracker = new TileAnimationRefreshTracker();
        const offscreen = layer([[25, 15, 7]]);
        expect(track(tracker, [offscreen])).toBe(false);

        const visible = layer([[4, 3, 7]]);
        tracker.reset();
        expect(track(tracker, [visible])).toBe(true);
        visible.timeElapsed = 300;
        expect(track(tracker, [visible], view, 100)).toBe(false);
        visible.timeElapsed = 700;
        expect(track(tracker, [visible], view, 200)).toBe(true);
        visible.timeElapsed = 900;
        expect(track(tracker, [visible], view, 300)).toBe(true);
    });

    it("includes the one-tile view margin and the camera's new position", () => {
        const tracker = new TileAnimationRefreshTracker();
        expect(track(tracker, [layer([[11, 6, 7]])])).toBe(true);
        tracker.reset();
        expect(track(tracker, [layer([[12, 6, 7]])])).toBe(false);

        const cameraMoved = new TileAnimationRefreshTracker();
        expect(track(cameraMoved, [layer([[25, 15, 7]])], { x: 640, y: 384, width: 320, height: 192 })).toBe(true);
    });

    it("ignores hidden, transparent, and static cells", () => {
        const tracker = new TileAnimationRefreshTracker();
        expect(track(tracker, [layer([[4, 3, 7]], { visible: false })])).toBe(false);
        expect(track(tracker, [layer([[4, 3, 7]], { alpha: 0 })])).toBe(false);
        expect(track(tracker, [layer([[4, 3, 6]])])).toBe(false);
    });

    it("redraws a newly visible or edited layer after immediate invalidation", () => {
        const tracker = new TileAnimationRefreshTracker();
        const changing = layer([[4, 3, 7]], { visible: false });
        expect(track(tracker, [changing])).toBe(false);
        changing.visible = true;
        tracker.reset();
        expect(track(tracker, [changing], view, 10)).toBe(true);
        changing.timeElapsed = 700;
        expect(track(tracker, [changing], view, 20)).toBe(true);
    });

    it("handles GPU tile layers and falls back when a layer cannot be inspected", () => {
        const tracker = new TileAnimationRefreshTracker();
        const gpuLayer = (cells: Array<[number, number, number]>) =>
            layer(cells, { tileset, gidMap: undefined, generateLayerDataTexture() {} });
        expect(track(tracker, [gpuLayer([[25, 15, 7]])])).toBe(false);

        tracker.reset();
        const visibleGpuLayer = gpuLayer([[4, 3, 7]]);
        expect(track(tracker, [visibleGpuLayer])).toBe(true);
        visibleGpuLayer.timeElapsed = 700;
        expect(track(tracker, [visibleGpuLayer], view, 100)).toBe(true);

        tracker.reset();
        expect(track(tracker, [{ visible: true, alpha: 1, tileset, timeElapsed: 0 }])).toBe(true);

        tracker.reset();
        const missingLookup = layer([[4, 3, 7]], { gidMap: undefined });
        expect(track(tracker, [missingLookup])).toBe(true);
    });

    it("rescans cells after map scripts change an animated tile", () => {
        const tracker = new TileAnimationRefreshTracker();
        const changing = layer([]);
        expect(track(tracker, [changing], view, 0)).toBe(false);

        changing.layer.data[2][2] = { index: 7 };
        expect(track(tracker, [changing], view, 2_001)).toBe(true);
    });

    it("disables the optimization after an inspection error", () => {
        const tracker = new TileAnimationRefreshTracker();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const brokenTileset = {
            ...tileset,
            getAnimatedTileId() {
                throw new Error("unreadable frame lookup");
            },
        };
        const broken = layer([[4, 3, 7]], { tileset: [brokenTileset], gidMap: { 7: brokenTileset } });

        expect(track(tracker, [broken])).toBe(true);
        expect(track(tracker, [layer([[4, 3, 7]])], view, 100)).toBe(true);
        expect(error).toHaveBeenCalledTimes(1);
        error.mockRestore();
    });

    it("falls back to redraws and disables the optimization when the clock throws", () => {
        const tracker = new TileAnimationRefreshTracker();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const readNow = () => {
            throw new Error("clock unavailable");
        };

        try {
            expect(tracker.shouldRedraw([layer([[4, 3, 7]])], 32, 32, view, readNow)).toBe(true);
            expect(tracker.shouldRedraw([layer([[25, 15, 7]])], 32, 32, view, () => 0)).toBe(true);
            expect(error).toHaveBeenCalledTimes(1);
        } finally {
            error.mockRestore();
        }
    });
});
