import { describe, expect, it } from "vitest";
import { CloudClock, progress } from "./motion";

describe("motion", () => {
    it("drifts clouds in whole pixels and reports when the drawn offset moved", () => {
        const c = new CloudClock([3, 1]);
        expect(c.offset()).toEqual([0, 0]);
        expect(c.advance(0.22)).toBe(false); // 0.66 px: same pixel
        expect(c.advance(0.22)).toBe(true);
        expect(c.offset()).toEqual([1, 0]);
    });

    it("eases transitions from 0 to 1", () => {
        expect(progress(0, 0, 500)).toBe(0);
        expect(progress(250, 0, 500)).toBe(0.5);
        expect(progress(900, 0, 500)).toBe(1);
        expect(progress(10, 0, 0)).toBe(1);
    });
});
