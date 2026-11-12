type TileAnimationData = {
    animation?: unknown[];
};

type TileAnimationTileset = {
    firstgid?: number;
    tileData?: Record<string, TileAnimationData | undefined>;
    getAnimatedTileId?: (gid: number, timeElapsed: number) => number;
};

type TileAnimationLayer = {
    visible?: boolean;
    alpha?: number;
    x?: number;
    y?: number;
    layer?: { data?: unknown };
    tileset?: TileAnimationTileset | TileAnimationTileset[];
    gidMap?: Record<number, TileAnimationTileset>;
    timeElapsed?: number;
    generateLayerDataTexture?: unknown;
};

type AnimatedTileCell = {
    layer: TileAnimationLayer;
    x: number;
    y: number;
    gid: number;
};

export type CameraWorldView = {
    x: number;
    y: number;
    width: number;
    height: number;
};

const TILE_SIZE_FALLBACK = 32;
const ANIMATED_CELL_REFRESH_INTERVAL_MS = 2_000;

/**
 * Avoids tile-animation redraws unless a visible animated cell changes picture.
 * Unknown Phaser layer shapes fall back to the original redraw behavior.
 */
export class TileAnimationRefreshTracker {
    private animatedCells: AnimatedTileCell[] | null | undefined;
    private animatedCellsScannedAt = Number.NEGATIVE_INFINITY;
    private shownFrameByLayer = new WeakMap<object, Map<number, number>>();
    private disabled = false;

    public reset(): void {
        this.animatedCells = undefined;
        this.animatedCellsScannedAt = Number.NEGATIVE_INFINITY;
        this.shownFrameByLayer = new WeakMap<object, Map<number, number>>();
        this.disabled = false;
    }

    public shouldRedraw(
        rawLayers: readonly unknown[],
        tileWidth: number,
        tileHeight: number,
        worldView: CameraWorldView | undefined,
        readNow: () => number,
    ): boolean {
        if (this.disabled || !worldView) {
            return true;
        }

        try {
            const now = readNow();
            if (!Number.isFinite(now)) {
                return true;
            }

            const width = Number.isFinite(tileWidth) && tileWidth > 0 ? tileWidth : TILE_SIZE_FALLBACK;
            const height = Number.isFinite(tileHeight) && tileHeight > 0 ? tileHeight : TILE_SIZE_FALLBACK;
            if (
                !Number.isFinite(worldView.x) ||
                !Number.isFinite(worldView.y) ||
                !Number.isFinite(worldView.width) ||
                !Number.isFinite(worldView.height)
            ) {
                return true;
            }

            if (
                this.animatedCells === undefined ||
                now - this.animatedCellsScannedAt > ANIMATED_CELL_REFRESH_INTERVAL_MS
            ) {
                this.animatedCellsScannedAt = now;
                this.animatedCells = this.findAnimatedCells(rawLayers, width, height);
            }

            if (this.animatedCells === null) {
                return true;
            }

            const minX = Math.floor(worldView.x / width) - 1;
            const minY = Math.floor(worldView.y / height) - 1;
            const maxX = Math.ceil((worldView.x + worldView.width) / width) + 1;
            const maxY = Math.ceil((worldView.y + worldView.height) / height) + 1;
            let redraw = false;

            for (const cell of this.animatedCells) {
                if (cell.x < minX || cell.x > maxX || cell.y < minY || cell.y > maxY) {
                    continue;
                }

                const tileset = cell.layer.gidMap
                    ? cell.layer.gidMap[cell.gid]
                    : "generateLayerDataTexture" in cell.layer
                      ? cell.layer.tileset
                      : undefined;
                if (
                    !tileset ||
                    Array.isArray(tileset) ||
                    typeof tileset.getAnimatedTileId !== "function" ||
                    typeof cell.layer.timeElapsed !== "number" ||
                    !Number.isFinite(cell.layer.timeElapsed)
                ) {
                    return true;
                }

                const frameId = tileset.getAnimatedTileId(cell.gid, cell.layer.timeElapsed);
                if (!Number.isFinite(frameId)) {
                    return true;
                }

                let shownFrames = this.shownFrameByLayer.get(cell.layer);
                if (!shownFrames) {
                    shownFrames = new Map<number, number>();
                    this.shownFrameByLayer.set(cell.layer, shownFrames);
                }

                if (shownFrames.get(cell.gid) !== frameId) {
                    shownFrames.set(cell.gid, frameId);
                    redraw = true;
                }
            }

            return redraw;
        } catch (error) {
            this.disabled = true;
            console.error("Tile animation refresh optimization disabled; using original behavior.", error);
            return true;
        }
    }

    private findAnimatedCells(
        rawLayers: readonly unknown[],
        tileWidth: number,
        tileHeight: number,
    ): AnimatedTileCell[] | null {
        const cells: AnimatedTileCell[] = [];
        let unknownLayer = false;

        for (const rawLayer of rawLayers) {
            if (!rawLayer || typeof rawLayer !== "object") {
                continue;
            }

            const layer = rawLayer as TileAnimationLayer;
            if (!layer.visible || (typeof layer.alpha === "number" && layer.alpha <= 0)) {
                continue;
            }

            const tilesets = Array.isArray(layer.tileset) ? layer.tileset : [layer.tileset];
            const animatedGids = new Set<number>();
            for (const tileset of tilesets) {
                if (!tileset || typeof tileset !== "object" || !tileset.tileData) {
                    continue;
                }
                if (typeof tileset.firstgid !== "number" || !Number.isFinite(tileset.firstgid)) {
                    continue;
                }

                for (const [localId, tileData] of Object.entries(tileset.tileData)) {
                    const localIndex = Number(localId);
                    if (
                        Number.isFinite(localIndex) &&
                        Array.isArray(tileData?.animation) &&
                        tileData.animation.length > 0
                    ) {
                        animatedGids.add(tileset.firstgid + localIndex);
                    }
                }
            }

            if (animatedGids.size === 0) {
                continue;
            }

            const rows = layer.layer?.data;
            if (!Array.isArray(rows)) {
                unknownLayer = true;
                continue;
            }

            const xOffset = Math.round((layer.x ?? 0) / tileWidth);
            const yOffset = Math.round((layer.y ?? 0) / tileHeight);
            for (let y = 0; y < rows.length; y++) {
                const row = rows[y];
                if (!Array.isArray(row)) {
                    unknownLayer = true;
                    continue;
                }

                for (let x = 0; x < row.length; x++) {
                    const tile = row[x] as { index?: unknown } | null | undefined;
                    if (tile && typeof tile.index === "number" && animatedGids.has(tile.index)) {
                        cells.push({ layer, x: x + xOffset, y: y + yOffset, gid: tile.index });
                    }
                }
            }
        }

        return unknownLayer ? null : cells;
    }
}
