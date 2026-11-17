/** A rectangle in world px: left, top, width, height. */
export type Rect = readonly [x: number, y: number, w: number, h: number];

/** A box in sprite px, as the effects manifest writes it: left, top, right, bottom. */
export type Box = readonly [x0: number, y0: number, x1: number, y1: number];

export interface Point {
    readonly x: number;
    readonly y: number;
}

export const inside = (x: number, y: number, [rx, ry, rw, rh]: Rect): boolean =>
    x >= rx && y >= ry && x < rx + rw && y < ry + rh;

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

/** People per room, counted by their feet. */
export function occupancy(rooms: readonly Room[], people: readonly Point[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const room of rooms) out[room.key] = people.filter((p) => inside(p.x, p.y, room.floor)).length;
    return out;
}
