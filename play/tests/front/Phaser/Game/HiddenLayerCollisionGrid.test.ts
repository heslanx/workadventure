// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { GameMapFrontWrapper } from "../../../../src/front/Phaser/Game/GameMap/GameMapFrontWrapper";

/*
 * Upstream skipped every layer hidden in Tiled when it built the pathfinding grid, while the keyboard
 * (Arcade) colliders of the same layer kept colliding, so click-to-walk crossed invisible walls. The rule
 * here is upstream's fix (workadventure/workadventure 7d24e49, issue #7063, and upstream master): the grid
 * drops a layer only once WA.room.hideLayer hid it, which is also when Arcade turns its collisions off.
 */

const COLLIDER = 1;
const EXIT = 2;
const START = 3;

type FakeLayer = {
    visible: boolean;
    layerIndex: number;
    /** What the Arcade collider of this layer does: the last value given to setCollisionByProperty. */
    arcadeCollides: boolean;
    layer: {
        name: string;
        properties: { name: string; value: unknown }[];
        data: { index: number; x: number; y: number; properties: Record<string, unknown>; setCollision(): void }[][];
    };
    setVisible(visible: boolean): FakeLayer;
    setCollisionByProperty: ReturnType<typeof vi.fn>;
    putTileAt(
        index: number,
        x: number,
        y: number,
    ): { index: number; properties: Record<string, unknown>; setCollision(): void };
};

type LayerSpec = {
    name: string;
    visibleInTiled?: boolean;
    exit?: boolean;
    /** One row of tile indexes; 1 is a tile with the "collides" property, -1 is empty, others are plain. */
    tiles: number[];
};

function makeLayer(spec: LayerSpec, layerIndex: number): FakeLayer {
    const tile = (index: number, x: number) => ({
        index,
        x,
        y: 0,
        properties: index === COLLIDER ? { collides: true } : {},
        setCollision: () => undefined,
    });
    const fake: FakeLayer = {
        visible: spec.visibleInTiled ?? true,
        layerIndex,
        arcadeCollides: true,
        layer: {
            name: spec.name,
            properties: spec.exit ? [{ name: "exitUrl", value: "/_/global/example.com/map.json" }] : [],
            data: [spec.tiles.map(tile)],
        },
        setVisible(visible: boolean) {
            this.visible = visible;
            return this;
        },
        setCollisionByProperty: vi.fn((_properties: unknown, collides?: boolean) => {
            fake.arcadeCollides = collides ?? true;
            return fake;
        }),
        putTileAt(index: number, x: number, y: number) {
            const placed = tile(index, x);
            placed.y = y;
            this.layer.data[y][x] = placed;
            return placed;
        },
    };
    return fake;
}

// Skip the Phaser-heavy constructor: set only what the collision grid, setLayerVisibility and putTile read.
function makeWrapper(specs: LayerSpec[]): { wrapper: GameMapFrontWrapper; layers: FakeLayer[] } {
    const layers = specs.map(makeLayer);
    const width = specs[0].tiles.length;
    const wrapper = Object.assign(Object.create(GameMapFrontWrapper.prototype) as GameMapFrontWrapper, {
        gameMap: {
            getMap: () => ({ width, height: 1 }),
            getWamFile: () => undefined,
            getIndexForTileType: (tile: string | number) => tile,
            putTileInFlatLayer: () => undefined,
            getTileProperty: (index: number) => (index === COLLIDER ? [{ name: "collides", value: true }] : []),
        },
        phaserLayers: layers,
        // The synthetic layers are told apart by identity in HEAD's filter and by name here.
        entitiesCollisionLayer: layers.find((l) => l.layer.name === "__entitiesCollisionLayer"),
        areasCollisionLayer: layers.find((l) => l.layer.name === "__areasCollisionLayer"),
        perLayerCollisionGridCache: new Map(),
        dirtyLayerIndices: new Set(),
        scriptHiddenLayers: new Set(),
        collisionGridDirty: true,
        areasCollisionLayerDirty: false,
        mapChangedSubject: new Subject(),
    });
    return { wrapper, layers };
}

/** Where the grid and the Arcade flag of a layer disagree, from the layer's own tiles. */
function gridCollidersAgreeWithArcade(wrapper: GameMapFrontWrapper, layer: FakeLayer, x: number): boolean {
    const hasCollider = layer.layer.data[0][x].properties.collides === true;
    const gridBlocks = wrapper.getCollisionGrid({ emitMapChangedEvent: false })[0][x] === COLLIDER;
    return gridBlocks === (hasCollider && layer.arcadeCollides);
}

describe("collision grid of hidden layers", () => {
    it("keeps the collisions of a layer hidden in Tiled, like the keyboard colliders", () => {
        const { wrapper } = makeWrapper([{ name: "collisions", visibleInTiled: false, tiles: [COLLIDER, -1] }]);
        expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, 0]]);
    });

    it("keeps the exit tiles of an exit layer hidden in Tiled, so click-to-walk avoids them like a visible one", () => {
        const { wrapper } = makeWrapper([{ name: "exit", visibleInTiled: false, exit: true, tiles: [5, -1] }]);
        expect(wrapper.getCollisionGrid()).toEqual([[EXIT, 0]]);
    });

    it("keeps the start tiles of the start layer hidden in Tiled", () => {
        const { wrapper } = makeWrapper([{ name: "start", visibleInTiled: false, tiles: [5, -1] }]);
        expect(wrapper.getCollisionGrid()).toEqual([[START, 0]]);
    });

    it("keeps a collider on an exit tile of a layer hidden in Tiled", () => {
        const { wrapper } = makeWrapper([
            { name: "exit", visibleInTiled: false, exit: true, tiles: [5, 5] },
            { name: "walls", visibleInTiled: false, tiles: [COLLIDER, -1] },
        ]);
        expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, EXIT]]);
    });

    it("keeps the invisible synthetic entity and area layers in the grid as before", () => {
        const { wrapper } = makeWrapper([
            { name: "__entitiesCollisionLayer", visibleInTiled: false, tiles: [COLLIDER, -1] },
            { name: "__areasCollisionLayer", visibleInTiled: false, tiles: [-1, COLLIDER] },
        ]);
        expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, COLLIDER]]);
    });

    it("drops the collisions of a layer hidden with WA.room.hideLayer until it is shown again", () => {
        const { wrapper, layers } = makeWrapper([{ name: "collisions", tiles: [COLLIDER, -1] }]);
        wrapper.setLayerVisibility("collisions", false);
        expect(wrapper.getCollisionGrid()).toEqual([[0, 0]]);
        expect(layers[0].setCollisionByProperty).toHaveBeenLastCalledWith({ collides: true }, false);
        expect(gridCollidersAgreeWithArcade(wrapper, layers[0], 0)).toBe(true);

        wrapper.setLayerVisibility("collisions", true);
        expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, 0]]);
        expect(layers[0].setCollisionByProperty).toHaveBeenLastCalledWith({ collides: true }, true);
        expect(gridCollidersAgreeWithArcade(wrapper, layers[0], 0)).toBe(true);
    });

    it("opens and closes a door layer that is hidden in Tiled, as the Konclui lock layers do", () => {
        const { wrapper, layers } = makeWrapper([
            { name: "lock-room_01", visibleInTiled: false, tiles: [COLLIDER, -1] },
        ]);
        // Before any script runs, Arcade collides on it, so the grid does too.
        expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, 0]]);
        expect(gridCollidersAgreeWithArcade(wrapper, layers[0], 0)).toBe(true);

        wrapper.setLayerVisibility("lock-room_01", false); // applyLocks, room unlocked
        expect(wrapper.getCollisionGrid()).toEqual([[0, 0]]);
        expect(gridCollidersAgreeWithArcade(wrapper, layers[0], 0)).toBe(true);

        wrapper.setLayerVisibility("lock-room_01", true); // applyLocks, room locked
        expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, 0]]);
        expect(gridCollidersAgreeWithArcade(wrapper, layers[0], 0)).toBe(true);
    });

    it("hides and shows every layer of a group by its prefix, and only those", () => {
        const { wrapper, layers } = makeWrapper([
            { name: "group/a", tiles: [COLLIDER, -1, -1] },
            { name: "group/b", tiles: [-1, COLLIDER, -1] },
            { name: "groupie/c", tiles: [-1, -1, COLLIDER] },
        ]);
        wrapper.setLayerVisibility("group", false);
        expect(wrapper.getCollisionGrid()).toEqual([[0, 0, COLLIDER]]);
        expect(layers[0].setCollisionByProperty).toHaveBeenLastCalledWith({ collides: true }, false);
        expect(layers[1].setCollisionByProperty).toHaveBeenLastCalledWith({ collides: true }, false);
        expect(layers[2].setCollisionByProperty).not.toHaveBeenCalled();

        wrapper.setLayerVisibility("group", true);
        expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, COLLIDER, COLLIDER]]);
        expect(layers[0].setCollisionByProperty).toHaveBeenLastCalledWith({ collides: true }, true);
        expect(layers[1].setCollisionByProperty).toHaveBeenLastCalledWith({ collides: true }, true);
    });

    it("prefers a layer named exactly like the argument over the group of that name", () => {
        const { wrapper } = makeWrapper([
            { name: "group", tiles: [COLLIDER, -1] },
            { name: "group/a", tiles: [-1, COLLIDER] },
        ]);
        wrapper.setLayerVisibility("group", false);
        expect(wrapper.getCollisionGrid()).toEqual([[0, COLLIDER]]);
    });

    it("changes nothing and warns when no layer has that name", () => {
        const { wrapper, layers } = makeWrapper([{ name: "collisions", tiles: [COLLIDER, -1] }]);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, 0]]);
            wrapper.setLayerVisibility("nope", false);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(layers[0].setCollisionByProperty).not.toHaveBeenCalled();
            expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, 0]]);
        } finally {
            warn.mockRestore();
        }
    });

    it("shows a tile put on a layer while a script had hidden it only once the layer is shown", () => {
        const { wrapper } = makeWrapper([{ name: "collisions", tiles: [-1, -1] }]);
        expect(wrapper.getCollisionGrid()).toEqual([[0, 0]]);

        wrapper.setLayerVisibility("collisions", false);
        wrapper.putTile(COLLIDER, 1, 0, "collisions");
        expect(wrapper.getCollisionGrid()).toEqual([[0, 0]]);

        wrapper.setLayerVisibility("collisions", true);
        expect(wrapper.getCollisionGrid()).toEqual([[0, COLLIDER]]);
    });

    it("sees a tile put or removed on a layer hidden in Tiled", () => {
        const { wrapper } = makeWrapper([{ name: "collisions", visibleInTiled: false, tiles: [COLLIDER, -1] }]);
        expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, 0]]);

        wrapper.putTile(COLLIDER, 1, 0, "collisions");
        expect(wrapper.getCollisionGrid()).toEqual([[COLLIDER, COLLIDER]]);

        wrapper.putTile(null, 0, 0, "collisions");
        expect(wrapper.getCollisionGrid()).toEqual([[0, COLLIDER]]);
    });
});
