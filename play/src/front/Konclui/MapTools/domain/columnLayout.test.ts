import { describe, expect, it } from "vitest";
import {
    BASE_CONTROLS,
    COLUMN_WIDTH,
    CONTROL_GAP,
    CONTROL_SIZE,
    MAX_TOOLS,
    columnBox,
    columnHeight,
    intersects,
} from "./columnLayout";

describe("the zoom column's height", () => {
    it("is its controls, the gaps between them and the padding around: 36 px, 6 px and 6 px", () => {
        expect(columnHeight(BASE_CONTROLS)).toBe(3 * 36 + 2 * 6 + 12);
        expect(columnHeight(BASE_CONTROLS + MAX_TOOLS)).toBe(6 * 36 + 5 * 6 + 12);
        expect(columnHeight(0)).toBe(12);
    });

    it("is 132 px with upstream's three controls and 258 px with the three tools above them", () => {
        expect(columnHeight(3)).toBe(132);
        expect(columnHeight(6)).toBe(258);
    });
});

describe("the zoom column in a viewport", () => {
    it("stands 8 px in from the right edge, 48 px wide, and its bottom edge is the offset above the viewport's", () => {
        const column = columnBox({ width: 375, height: 812 }, 84, BASE_CONTROLS);

        expect(column).toEqual({ left: 319, right: 367, top: 596, bottom: 728 });
        expect(column.right - column.left).toBe(COLUMN_WIDTH);
    });

    it("adds each tool to the height and nothing to the width, so only the top moves", () => {
        const without = columnBox({ width: 375, height: 812 }, 84, BASE_CONTROLS);
        const withTools = columnBox({ width: 375, height: 812 }, 84, BASE_CONTROLS + MAX_TOOLS);

        expect(withTools.top).toBe(without.top - MAX_TOOLS * (CONTROL_SIZE + CONTROL_GAP));
        expect([withTools.left, withTools.right, withTools.bottom]).toEqual([
            without.left,
            without.right,
            without.bottom,
        ]);
    });

    it("meets another box only where their areas share a pixel", () => {
        const column = { left: 100, right: 148, top: 100, bottom: 200 };

        expect(intersects(column, { left: 148, right: 300, top: 0, bottom: 1000 })).toBe(false);
        expect(intersects(column, { left: 147, right: 300, top: 0, bottom: 1000 })).toBe(true);
        expect(intersects(column, { left: 0, right: 1000, top: 200, bottom: 300 })).toBe(false);
        expect(intersects(column, { left: 0, right: 1000, top: 199, bottom: 300 })).toBe(true);
    });
});
