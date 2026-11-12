import { describe, expect, it, vi } from "vitest";
import { updateScriptedTileWallEdges } from "./GameMap/ScriptedTileWallEdges";
import {
    ThinWallsController,
    type ThinWallCollisionLayer,
    type ThinWallConfiguration,
    type ThinWallTile,
} from "./ThinWallsController";

class TestTile implements ThinWallTile {
    public collision: boolean[] | undefined;
    public recalculateFaces: boolean | undefined;

    constructor(
        public x: number,
        public y: number,
        public index: number,
        public properties: Record<string, unknown> = {},
    ) {}

    public setCollision(left: boolean, right: boolean, up: boolean, down: boolean, recalculateFaces = true): this {
        this.collision = [left, right, up, down];
        this.recalculateFaces = recalculateFaces;
        return this;
    }
}

function sourceLayer(
    name: string,
    visible: boolean,
    edges: Record<string, string>,
): ThinWallConfiguration["layers"][number] {
    const width = 4;
    const height = 3;
    const data = Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => {
            const value = edges[`${x},${y}`];
            return new TestTile(x, y, value ? 7 : -1, value ? { wallEdges: value } : {});
        }),
    );
    return { visible, layer: { name, width, height, data } };
}

function collisionLayer(): ThinWallCollisionLayer & { destroyed: boolean } {
    const layer = {
        visible: true,
        destroyed: false,
        layer: {
            name: "helper",
            width: 4,
            height: 3,
            data: Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => null as ThinWallTile | null)),
        },
        putTileAt(index: number, x: number, y: number) {
            const tile = new TestTile(x, y, index);
            const row = this.layer.data[y];
            if (!row) return null;
            row[x] = tile;
            return tile;
        },
        setVisible(visible: boolean) {
            this.visible = visible;
            return this;
        },
        setDepth() {
            return this;
        },
        destroy() {
            this.destroyed = true;
        },
    };
    return layer as unknown as ThinWallCollisionLayer & { destroyed: boolean };
}

function tileAt(layer: ThinWallCollisionLayer, x: number, y: number): TestTile | undefined {
    return layer.layer.data[y]?.[x] as unknown as TestTile | undefined;
}

function configuration(
    layers: ThinWallConfiguration["layers"],
    createLayer: (name: string) => (ThinWallCollisionLayer & { destroyed: boolean }) | null = vi.fn(() =>
        collisionLayer(),
    ),
): ThinWallConfiguration & {
    created: ReturnType<typeof collisionLayer>[];
    colliders: Array<{ destroyed: boolean }>;
    conditions: Map<string, string[]>;
} {
    const created: ReturnType<typeof collisionLayer>[] = [];
    const colliders: Array<{ destroyed: boolean }> = [];
    const conditions = new Map<string, string[]>();
    return {
        layers,
        width: 4,
        height: 3,
        tileIndex: 1,
        createLayer: (name) => {
            const layer = createLayer(name);
            if (layer) created.push(layer);
            return layer;
        },
        addCollider: () => {
            const collider = { destroyed: false };
            colliders.push(collider);
            return { destroy: () => (collider.destroyed = true) };
        },
        pathfinding: {
            clearDirectionalConditions: () => conditions.clear(),
            setDirectionalCondition: (x, y, directions) => conditions.set(`${x},${y}`, directions),
        },
        created,
        colliders,
        conditions,
    };
}

describe("ThinWallsController", () => {
    it("blocks edge crossings on both tiles while leaving both tiles walkable along the wall", () => {
        const controller = new ThinWallsController();
        const source = sourceLayer("thin-walls", true, { "1,1": "e" });
        const setup = configuration([source]);

        controller.rebuild(setup);

        const [layer] = setup.created;
        expect(layer.visible).toBe(false);
        expect(tileAt(layer, 1, 1)?.collision).toEqual([false, true, false, false]);
        expect(tileAt(layer, 2, 1)?.collision).toEqual([true, false, false, false]);
        expect(tileAt(layer, 1, 1)?.recalculateFaces).toBe(false);
        expect(setup.conditions.get("1,1")).not.toContain("RIGHT");
        expect(setup.conditions.get("1,1")).not.toContain("TOP_RIGHT");
        expect(setup.conditions.get("1,1")).toContain("TOP");
        expect(setup.conditions.get("2,1")).not.toContain("LEFT");
        expect(setup.conditions.get("2,1")).toContain("BOTTOM");
    });

    it("projects scripted replacement and removal into current collisions and paths", () => {
        const controller = new ThinWallsController();
        const source = sourceLayer("thin-walls", true, { "1,1": "e" });
        const setup = configuration([source]);
        controller.rebuild(setup);
        const tile = source.layer.data[1]?.[1];
        if (!tile || !tile.properties) throw new Error("Expected authored wall tile");

        const previousEdges = tile.properties.wallEdges;
        tile.index = 8;
        const changed = updateScriptedTileWallEdges(
            { index: tile.index, properties: tile.properties },
            [{ name: "wallEdges", value: "n" }],
            previousEdges,
        );
        expect(changed).toBe(true);
        controller.rebuild(setup);

        expect(setup.created[0].destroyed).toBe(true);
        expect(tileAt(setup.created[1], 1, 1)?.collision).toEqual([false, false, true, false]);
        expect(tileAt(setup.created[1], 1, 0)?.collision).toEqual([false, false, false, true]);
        expect(setup.conditions.get("1,1")).toContain("RIGHT");
        expect(setup.conditions.get("1,1")).not.toContain("TOP");
        expect(setup.conditions.has("2,1")).toBe(false);

        const removedEdges = tile.properties.wallEdges;
        tile.index = -1;
        expect(updateScriptedTileWallEdges({ index: tile.index, properties: tile.properties }, [], removedEdges)).toBe(
            true,
        );
        controller.rebuild(setup);

        expect(setup.created[1].destroyed).toBe(true);
        expect(setup.colliders[1].destroyed).toBe(true);
        expect(setup.conditions.size).toBe(0);
        expect(setup.created).toHaveLength(2);
    });

    it("ignores hidden layers, synthetic layers, empty tiles, and unknown edge letters", () => {
        const controller = new ThinWallsController();
        const setup = configuration([
            sourceLayer("hidden", false, { "1,1": "e" }),
            sourceLayer("__entitiesCollisionLayer", true, { "1,1": "e" }),
            sourceLayer("thin-walls", true, { "1,1": "xE " }),
        ]);

        controller.rebuild(setup);

        expect(setup.created).toHaveLength(0);
        expect(setup.conditions.size).toBe(0);
    });

    it("clears old conditions and destroys the previous and current helpers on rebuild and reset", () => {
        const controller = new ThinWallsController();
        const first = configuration([sourceLayer("thin-walls", true, { "1,1": "e" })]);
        controller.rebuild(first);
        const second = configuration([sourceLayer("thin-walls", true, { "2,1": "s" })]);
        second.pathfinding = first.pathfinding;
        second.conditions = first.conditions;

        controller.rebuild(second);

        expect(first.created[0].destroyed).toBe(true);
        expect(first.colliders[0].destroyed).toBe(true);
        expect(second.conditions.has("2,1")).toBe(true);
        expect(second.created).toHaveLength(1);
        controller.destroy(second.pathfinding);
        expect(second.created[0].destroyed).toBe(true);
        expect(second.colliders[0].destroyed).toBe(true);
        expect(second.conditions.size).toBe(0);
    });

    it("clears partial directional conditions if path setup fails", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const controller = new ThinWallsController();
        const setup = configuration([sourceLayer("thin-walls", true, { "1,1": "n", "2,1": "s" })]);
        const setDirectionalCondition = setup.pathfinding.setDirectionalCondition.bind(setup.pathfinding);
        setup.pathfinding.setDirectionalCondition = (x, y, directions) => {
            setDirectionalCondition(x, y, directions);
            throw new Error("pathfinding setup failed");
        };

        try {
            controller.rebuild(setup);
            expect(setup.conditions.size).toBe(0);
            expect(setup.created).toHaveLength(0);
            expect(error).toHaveBeenCalledWith("[konclui] thin walls incomplete:", expect.any(Error));
        } finally {
            error.mockRestore();
        }
    });

    it("preserves directional conditions if helper-layer creation fails", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const controller = new ThinWallsController();
        const setup = configuration([sourceLayer("thin-walls", true, { "1,1": "n" })], () => null);

        try {
            controller.rebuild(setup);
            expect(setup.conditions.has("1,1")).toBe(true);
            expect(error).toHaveBeenCalledWith("[konclui] thin walls incomplete:", expect.any(Error));
        } finally {
            error.mockRestore();
        }
    });

    it("preserves directional conditions and releases the helper layer if collider creation fails", () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const controller = new ThinWallsController();
        const setup = configuration([sourceLayer("thin-walls", true, { "1,1": "w" })]);
        setup.addCollider = () => {
            throw new Error("collider setup failed");
        };

        try {
            controller.rebuild(setup);
            expect(setup.conditions.has("1,1")).toBe(true);
            expect(setup.created).toHaveLength(1);
            expect(setup.created[0].destroyed).toBe(true);
            expect(error).toHaveBeenCalledWith("[konclui] thin walls incomplete:", expect.any(Error));
        } finally {
            error.mockRestore();
        }
    });
});
