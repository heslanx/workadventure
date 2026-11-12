import type { DirectionalPathfindingDirection } from "../../Utils/PathfindingManager";
import type * as Phaser from "phaser";

type WallEdge = "n" | "e" | "s" | "w";

export interface ThinWallTile {
    x: number;
    y: number;
    index: number;
    properties?: Record<string, unknown>;
    setCollision(left: boolean, right: boolean, up: boolean, down: boolean, recalculateFaces?: boolean): this;
}

export interface ThinWallLayer {
    visible: boolean;
    layer: {
        name: string;
        width: number;
        height: number;
        data: Array<Array<ThinWallTile | null>>;
    };
}

export type ThinWallCollisionLayer = Phaser.Tilemaps.TilemapLayer;

export interface ThinWallCollider {
    destroy(): void;
}

export interface ThinWallPathfinder {
    setDirectionalCondition(x: number, y: number, allowedDirections: DirectionalPathfindingDirection[]): void;
    clearDirectionalConditions(): void;
}

export interface ThinWallConfiguration {
    layers: readonly ThinWallLayer[];
    width: number;
    height: number;
    tileIndex: number;
    createLayer(name: string): ThinWallCollisionLayer | null;
    addCollider(layer: ThinWallCollisionLayer): ThinWallCollider;
    pathfinding: ThinWallPathfinder;
}

const EDGE_NEIGHBOURS: Record<WallEdge, readonly [number, number, WallEdge]> = {
    n: [0, -1, "s"],
    e: [1, 0, "w"],
    s: [0, 1, "n"],
    w: [-1, 0, "e"],
};

const EDGE_BLOCKED_DIRECTIONS: Record<WallEdge, readonly DirectionalPathfindingDirection[]> = {
    n: ["TOP", "TOP_LEFT", "TOP_RIGHT"],
    e: ["RIGHT", "TOP_RIGHT", "BOTTOM_RIGHT"],
    s: ["BOTTOM", "BOTTOM_LEFT", "BOTTOM_RIGHT"],
    w: ["LEFT", "TOP_LEFT", "BOTTOM_LEFT"],
};

const ALL_DIRECTIONS: DirectionalPathfindingDirection[] = [
    "TOP",
    "TOP_RIGHT",
    "RIGHT",
    "BOTTOM_RIGHT",
    "BOTTOM",
    "BOTTOM_LEFT",
    "LEFT",
    "TOP_LEFT",
];

function collectWallEdges(layers: readonly ThinWallLayer[], width: number, height: number): Map<number, Set<WallEdge>> {
    const edgesByTile = new Map<number, Set<WallEdge>>();
    const mark = (x: number, y: number, edge: WallEdge): void => {
        if (x < 0 || y < 0 || x >= width || y >= height) {
            return;
        }
        const key = y * width + x;
        let edges = edgesByTile.get(key);
        if (!edges) {
            edges = new Set<WallEdge>();
            edgesByTile.set(key, edges);
        }
        edges.add(edge);
    };

    for (const layer of layers) {
        if (!layer.visible || layer.layer.name.startsWith("__")) {
            continue;
        }
        for (const row of layer.layer.data) {
            for (const tile of row) {
                if (!tile || tile.index === -1) {
                    continue;
                }
                const wallEdges = tile.properties?.wallEdges;
                if (typeof wallEdges !== "string") {
                    continue;
                }
                for (const edge of new Set(wallEdges)) {
                    if (edge !== "n" && edge !== "e" && edge !== "s" && edge !== "w") {
                        continue;
                    }
                    const [dx, dy, opposite] = EDGE_NEIGHBOURS[edge];
                    mark(tile.x, tile.y, edge);
                    mark(tile.x + dx, tile.y + dy, opposite);
                }
            }
        }
    }

    return edgesByTile;
}

export class ThinWallsController {
    private collisionLayer: ThinWallCollisionLayer | undefined;
    private collider: ThinWallCollider | undefined;
    private layerSequence = 0;

    public rebuild(configuration: ThinWallConfiguration): void {
        let edgesByTile: Map<number, Set<WallEdge>>;
        try {
            this.releaseResources();
            configuration.pathfinding.clearDirectionalConditions();
            edgesByTile = collectWallEdges(configuration.layers, configuration.width, configuration.height);
            if (edgesByTile.size === 0) {
                return;
            }

            for (const [key, edges] of edgesByTile) {
                const blocked = new Set<DirectionalPathfindingDirection>();
                for (const edge of edges) {
                    for (const direction of EDGE_BLOCKED_DIRECTIONS[edge]) {
                        blocked.add(direction);
                    }
                }
                configuration.pathfinding.setDirectionalCondition(
                    key % configuration.width,
                    Math.floor(key / configuration.width),
                    ALL_DIRECTIONS.filter((direction) => !blocked.has(direction)),
                );
            }
        } catch (error: unknown) {
            this.clearDirectionalConditions(configuration.pathfinding);
            console.error("[konclui] thin walls incomplete:", error);
            return;
        }

        if (configuration.tileIndex < 0) {
            return;
        }

        let nextLayer: ThinWallCollisionLayer | undefined;
        let nextCollider: ThinWallCollider | undefined;
        try {
            nextLayer = configuration.createLayer(`__koncluiThinWalls${++this.layerSequence}`) ?? undefined;
            if (!nextLayer) {
                throw new Error("Thin-wall collision layer was not created");
            }

            for (const [key, edges] of edgesByTile) {
                const x = key % configuration.width;
                const y = Math.floor(key / configuration.width);
                const tile = nextLayer.putTileAt(configuration.tileIndex, x, y, false);
                if (!tile) {
                    throw new Error(`Thin-wall collision tile was not created at ${x},${y}`);
                }
                // Keep the authored edge flags as separate faces; Phaser's face merge drops shared boundaries.
                tile.setCollision(edges.has("w"), edges.has("e"), edges.has("n"), edges.has("s"), false);
            }

            nextLayer.setVisible(false).setDepth(-2);
            nextCollider = configuration.addCollider(nextLayer);
            this.collisionLayer = nextLayer;
            this.collider = nextCollider;
        } catch (error: unknown) {
            this.releasePartialResources(nextCollider, nextLayer);
            console.error("[konclui] thin walls incomplete:", error);
        }
    }

    public destroy(pathfinding: ThinWallPathfinder): void {
        this.clearDirectionalConditions(pathfinding);
        this.releaseResources();
    }

    private clearDirectionalConditions(pathfinding: ThinWallPathfinder): void {
        try {
            pathfinding.clearDirectionalConditions();
        } catch (error: unknown) {
            console.error("[konclui] thin-wall path conditions could not be cleared:", error);
        }
    }

    private releaseResources(): void {
        const collider = this.collider;
        const layer = this.collisionLayer;
        this.collider = undefined;
        this.collisionLayer = undefined;
        this.releasePartialResources(collider, layer);
    }

    private releasePartialResources(
        collider: ThinWallCollider | undefined,
        layer: ThinWallCollisionLayer | undefined,
    ): void {
        try {
            collider?.destroy();
        } catch (error: unknown) {
            console.error("[konclui] thin-wall collider could not be destroyed:", error);
        }
        try {
            layer?.destroy();
        } catch (error: unknown) {
            console.error("[konclui] thin-wall layer could not be destroyed:", error);
        }
    }
}
