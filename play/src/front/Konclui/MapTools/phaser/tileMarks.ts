import type { TileMarks } from "../../../Phaser/Game/TileInteractionController";

/** Line widths on screen, in CSS pixels: the marks keep them whatever the camera's zoom. */
const SELECTED_LINE = 2;
const HOVER_LINE = 1;
const SELECTED_FILL_ALPHA = 0.12;
const SELECTED_LINE_ALPHA = 0.9;
const HOVER_LINE_ALPHA = 0.45;
/** On the floor, as the walk's destination marker: above the ground layers, below the avatars and the furniture. */
const FLOOR_DEPTH = -1;

/** The part of a Phaser graphics object the marks use, so a test can stand in for it. */
export interface MarkGraphics {
    clear(): this;
    lineStyle(width: number, color: number, alpha?: number): this;
    fillStyle(color: number, alpha?: number): this;
    strokeRect(x: number, y: number, width: number, height: number): this;
    fillRect(x: number, y: number, width: number, height: number): this;
    setDepth(depth: number): this;
    destroy(): void;
}

/** The part of the game scene the marks use. */
export interface MarkScene {
    readonly add: { graphics(): MarkGraphics };
    readonly scale: { readonly displayScale: { readonly x: number } };
    readonly cameras: { readonly main: { readonly zoom: number } };
    readonly markDirty: () => void;
}

export interface TileMarksView {
    paint(marks: TileMarks): void;
    /** Draws again when the camera's zoom changed, so the lines keep their width on screen. Cheap when it did not. */
    refresh(): void;
    destroy(): void;
}

/**
 * Draws the selected tile and the tile under the pointer on the floor of the map, in world space, so the camera
 * moves them with the map and no page element follows it. The selection is a 2 px outline over a faint fill; the hover
 * is a thinner, fainter outline, and it is not drawn on the selected tile, which already says so. `color` is the room's
 * primary colour as Phaser reads it.
 */
export function createTileMarks(
    scene: MarkScene,
    tileSize: () => { readonly width: number; readonly height: number },
    color: number,
): TileMarksView {
    const graphics = scene.add.graphics().setDepth(FLOOR_DEPTH);
    let marks: TileMarks = { selected: undefined, hovered: undefined };
    let drawnAt: number | undefined;

    const mapPixelsPerCssPixel = (): number => scene.scale.displayScale.x / scene.cameras.main.zoom;

    function draw(): void {
        const { width, height } = tileSize();
        const unit = mapPixelsPerCssPixel();
        drawnAt = unit;
        graphics.clear();
        const { selected, hovered } = marks;
        if (hovered !== undefined && !(selected?.tileX === hovered.tileX && selected.tileY === hovered.tileY)) {
            const line = HOVER_LINE * unit;
            graphics.lineStyle(line, color, HOVER_LINE_ALPHA);
            graphics.strokeRect(
                hovered.tileX * width + line / 2,
                hovered.tileY * height + line / 2,
                width - line,
                height - line,
            );
        }
        if (selected !== undefined) {
            const line = SELECTED_LINE * unit;
            graphics.fillStyle(color, SELECTED_FILL_ALPHA);
            graphics.fillRect(selected.tileX * width, selected.tileY * height, width, height);
            graphics.lineStyle(line, color, SELECTED_LINE_ALPHA);
            graphics.strokeRect(
                selected.tileX * width + line / 2,
                selected.tileY * height + line / 2,
                width - line,
                height - line,
            );
        }
        // The scene only redraws when something marks it dirty.
        scene.markDirty();
    }

    return {
        paint(next) {
            marks = next;
            draw();
        },
        refresh() {
            if (drawnAt === undefined || marks.selected === undefined) return;
            if (Math.abs(mapPixelsPerCssPixel() - drawnAt) > 1e-6) draw();
        },
        destroy() {
            graphics.destroy();
        },
    };
}
