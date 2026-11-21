/** The place of one control on the screen. Only where it starts and how wide it is matters. */
export interface GridBox {
    readonly left: number;
    readonly top: number;
    readonly width: number;
}

// Two controls whose tops differ by less than this are in one row: layout rounds to a pixel, never to two.
const SAME_ROW_PX = 2;

/**
 * The control to move the focus to when `key` is pressed on the control `from` of a wrapped grid, or `undefined`
 * when the key moves nothing there (another key, or the edge of the grid). The boxes are in reading order.
 *
 * Left and right go to the neighbour in reading order, Home and End to the first and the last, and up and down to
 * the control of the nearest row above or below that is closest to the same column. The number of columns is not
 * needed, so the grid may wrap differently on a phone and a desktop.
 */
export function nextGridIndex(boxes: readonly GridBox[], from: number, key: string): number | undefined {
    const last = boxes.length - 1;
    switch (key) {
        case "ArrowLeft":
            return from > 0 ? from - 1 : undefined;
        case "ArrowRight":
            return from < last ? from + 1 : undefined;
        case "Home":
            return from > 0 ? 0 : undefined;
        case "End":
            return from < last ? last : undefined;
        case "ArrowUp":
            return nearestInRow(boxes, from, -1);
        case "ArrowDown":
            return nearestInRow(boxes, from, 1);
        default:
            return undefined;
    }
}

function nearestInRow(boxes: readonly GridBox[], from: number, direction: 1 | -1): number | undefined {
    const origin = boxes[from];
    if (origin === undefined) return undefined;
    const centre = origin.left + origin.width / 2;
    let best: { index: number; rowDistance: number; columnDistance: number } | undefined;
    boxes.forEach((box, index) => {
        const rowDistance = (box.top - origin.top) * direction;
        if (rowDistance <= SAME_ROW_PX) return;
        const columnDistance = Math.abs(box.left + box.width / 2 - centre);
        const closer =
            best === undefined ||
            rowDistance < best.rowDistance - SAME_ROW_PX ||
            (Math.abs(rowDistance - best.rowDistance) <= SAME_ROW_PX && columnDistance < best.columnDistance);
        if (closer) best = { index, rowDistance, columnDistance };
    });
    return best?.index;
}
