/** The keys that move the focus along the list of people. */
export type RowKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function isRowKey(key: string): key is RowKey {
    return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
}

/**
 * The row the focus moves to. A list of two hundred people cannot be crossed with Tab alone, so the arrows, Home and
 * End move along it, and stop at its ends. `current` is -1 when the focus is not on a row: Down then reaches the first
 * row and Up the last.
 */
export function rowAfterKey(key: RowKey, current: number, count: number): number {
    if (count <= 0) return -1;
    switch (key) {
        case "Home":
            return 0;
        case "End":
            return count - 1;
        case "ArrowDown":
            return Math.min(current + 1, count - 1);
        case "ArrowUp":
            return current < 0 ? count - 1 : Math.max(current - 1, 0);
        default: {
            const unreachable: never = key;
            throw new Error(`Unhandled key: ${String(unreachable)}`);
        }
    }
}
