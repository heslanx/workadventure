// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapFrontWrapper } from "../../../../src/front/Phaser/Game/GameMap/GameMapFrontWrapper";

const WALL_TILE = 7;
const PLAIN_TILE = 8;
const OTHER_WALL_TILE = 9;

interface FakeTile {
    x: number;
    y: number;
    index: number;
    properties: Record<string, unknown>;
    setCollision: (collides: boolean) => void;
}

/**
 * Builds a wrapper around a one-tile layer, bypassing the Phaser tilemap the real constructor needs.
 *
 * Like Phaser's putTileAt, the fake layer keeps the Tile object of an occupied cell and only changes its index, so
 * the properties of the tile that was there stay behind. That is the case the wall-edge bookkeeping exists for.
 */
function createWrapper() {
    const tile: FakeTile = { x: 0, y: 0, index: WALL_TILE, properties: { wallEdges: "e" }, setCollision: vi.fn() };
    const layer = {
        layerIndex: 0,
        layer: { name: "walls", data: [[tile]] },
        putTileAt: (index: number): FakeTile => {
            tile.index = index;
            return tile;
        },
    };
    const tileProperties: Record<number, Array<{ name: string; value?: unknown }>> = {
        [WALL_TILE]: [{ name: "wallEdges", value: "e" }],
        [PLAIN_TILE]: [],
        [OTHER_WALL_TILE]: [{ name: "wallEdges", value: "n" }],
    };
    const tileTypes: Record<string, number> = { wall: WALL_TILE, plain: PLAIN_TILE, northWall: OTHER_WALL_TILE };
    const wrapper = Object.create(GameMapFrontWrapper.prototype) as GameMapFrontWrapper;
    Object.assign(wrapper, {
        phaserLayers: [layer],
        dirtyLayerIndices: new Set<number>(),
        collisionGridDirty: false,
        gameMap: {
            getIndexForTileType: (name: string) => tileTypes[name],
            putTileInFlatLayer: vi.fn(),
            getTileProperty: (index: number) => tileProperties[index] ?? [],
        },
    });
    return { wrapper, tile };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("GameMapFrontWrapper.putTile and thin walls", () => {
    it("reports a changed wall edge and drops the stale edge left on the reused tile", () => {
        const { wrapper, tile } = createWrapper();

        expect(wrapper.putTile("plain", 0, 0, "walls")).toBe(true);

        expect(tile.index).toBe(PLAIN_TILE);
        expect(tile.properties).toEqual({});
    });

    it("reports a replacement that moves the wall to another edge", () => {
        const { wrapper, tile } = createWrapper();

        expect(wrapper.putTile("northWall", 0, 0, "walls")).toBe(true);

        expect(tile.properties).toEqual({ wallEdges: "n" });
    });

    it("reports nothing when the replacement keeps the same wall edge", () => {
        const { wrapper, tile } = createWrapper();

        expect(wrapper.putTile("wall", 0, 0, "walls")).toBe(false);

        expect(tile.properties).toEqual({ wallEdges: "e" });
    });

    it("reports the removal of a wall tile", () => {
        const { wrapper, tile } = createWrapper();

        expect(wrapper.putTile(null, 0, 0, "walls")).toBe(true);

        expect(tile.index).toBe(-1);
        expect(tile.properties).toEqual({});
    });

    it("reports nothing when the layer or the tile type is unknown", () => {
        const { wrapper, tile } = createWrapper();
        vi.spyOn(console, "error").mockImplementation(() => {});

        expect(wrapper.putTile("plain", 0, 0, "missing layer")).toBe(false);
        expect(wrapper.putTile("missing tile", 0, 0, "walls")).toBe(false);

        expect(tile.properties).toEqual({ wallEdges: "e" });
    });
});
