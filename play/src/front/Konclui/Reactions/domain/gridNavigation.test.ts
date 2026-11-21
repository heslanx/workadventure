import { describe, expect, it } from "vitest";
import { nextGridIndex, type GridBox } from "./gridNavigation";

/** Seven 40 px controls 48 px apart, three to a row, so the last row holds one: 0 1 2 / 3 4 5 / 6. */
const boxes: GridBox[] = Array.from({ length: 7 }, (_unused, index) => ({
    left: (index % 3) * 48,
    top: Math.floor(index / 3) * 48,
    width: 40,
}));

describe("nextGridIndex", () => {
    it.each([
        ["right", "ArrowRight", 1, 2],
        ["left", "ArrowLeft", 4, 3],
        ["down", "ArrowDown", 1, 4],
        ["up", "ArrowUp", 5, 2],
        ["right across the end of a row", "ArrowRight", 2, 3],
        ["left across the start of a row", "ArrowLeft", 3, 2],
        ["Home", "Home", 5, 0],
        ["End", "End", 1, 6],
    ])("moves the focus %s", (_name, key, from, to) => {
        expect(nextGridIndex(boxes, from, key)).toBe(to);
    });

    it("goes down to the control closest to the same column when the row below is shorter", () => {
        // From control 5, in the third column, the last row holds only the control of the first column: the closest.
        expect(nextGridIndex(boxes, 5, "ArrowDown")).toBe(6);
    });

    it.each([
        ["left at the first control", "ArrowLeft", 0],
        ["right at the last control", "ArrowRight", 6],
        ["up in the first row", "ArrowUp", 1],
        ["down in the last row", "ArrowDown", 6],
        ["Home on the first control", "Home", 0],
        ["End on the last control", "End", 6],
        ["a letter", "a", 3],
        ["Enter, which presses the control", "Enter", 3],
    ])("moves the focus nowhere for %s", (_name, key, from) => {
        expect(nextGridIndex(boxes, from, key)).toBeUndefined();
    });

    it("reads a wrap that differs from the first, as the same grid on a narrower screen does", () => {
        const twoWide: GridBox[] = Array.from({ length: 5 }, (_unused, index) => ({
            left: (index % 2) * 48,
            top: Math.floor(index / 2) * 48,
            width: 40,
        }));

        expect(nextGridIndex(twoWide, 1, "ArrowDown")).toBe(3);
        expect(nextGridIndex(twoWide, 3, "ArrowDown")).toBe(4);
        expect(nextGridIndex(twoWide, 4, "ArrowDown")).toBeUndefined();
    });

    it("does not treat a sub-pixel difference in the top of a row as another row", () => {
        const jagged: GridBox[] = [
            { left: 0, top: 0, width: 40 },
            { left: 48, top: 0.4, width: 40 },
            { left: 0, top: 48, width: 40 },
        ];

        expect(nextGridIndex(jagged, 0, "ArrowDown")).toBe(2);
        expect(nextGridIndex(jagged, 1, "ArrowUp")).toBeUndefined();
    });
});
