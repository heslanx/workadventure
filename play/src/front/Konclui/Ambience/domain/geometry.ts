/** A rectangle in world px: left, top, width, height. */
export type Rect = readonly [x: number, y: number, w: number, h: number];

/** A box in sprite px, as the effects manifest writes it: left, top, right, bottom. */
export type Box = readonly [x0: number, y0: number, x1: number, y1: number];

export interface Point {
    readonly x: number;
    readonly y: number;
}

// Read by index: a destructured parameter makes an iterator on each call, and this runs for every character in a room.
export const inside = (x: number, y: number, rect: Rect): boolean =>
    x >= rect[0] && y >= rect[1] && x < rect[0] + rect[2] && y < rect[1] + rect[3];

/** Share of the view [x, y, w, h] that a rectangle covers (0..1). */
export function coverage(rect: Rect, view: Rect): number {
    const w = Math.max(0, Math.min(rect[0] + rect[2], view[0] + view[2]) - Math.max(rect[0], view[0]));
    const h = Math.max(0, Math.min(rect[1] + rect[3], view[1] + view[3]) - Math.max(rect[1], view[1]));
    return view[2] > 0 && view[3] > 0 ? (w * h) / (view[2] * view[3]) : 0;
}

export interface Room {
    readonly key: string;
    readonly floor: Rect;
}

/** Adds one to the count of each room whose floor holds the point (people are counted by their feet), making nothing. */
export function countInRooms(counts: Int32Array, rooms: readonly Room[], x: number, y: number): void {
    for (let i = 0; i < rooms.length; i++) if (inside(x, y, rooms[i].floor)) counts[i] += 1;
}

/**
 * A number worked out from the camera's view and kept while the view stays in one cell of a grid of `cell` px (its
 * size rounded to whole px): for what the masks say about the view, which a footstep does not change.
 */
export class CellValue {
    /** How many times the number was worked out: a measure for tests. */
    public runs = 0;
    private cellX = Number.NaN;
    private cellY = Number.NaN;
    private width = Number.NaN;
    private height = Number.NaN;
    private value = 0;

    constructor(
        private readonly cell: number,
        private readonly compute: (view: Rect) => number,
    ) {}

    get(view: Rect): number {
        const cellX = Math.floor(view[0] / this.cell);
        const cellY = Math.floor(view[1] / this.cell);
        const width = Math.round(view[2]);
        const height = Math.round(view[3]);
        if (cellX !== this.cellX || cellY !== this.cellY || width !== this.width || height !== this.height) {
            this.cellX = cellX;
            this.cellY = cellY;
            this.width = width;
            this.height = height;
            this.runs += 1;
            this.value = this.compute(view);
        }
        return this.value;
    }
}
