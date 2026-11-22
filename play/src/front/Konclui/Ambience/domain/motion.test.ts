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

    it("finishes a transition of no length at the very moment it starts, not as NaN", () => {
        expect(progress(7, 7, 0)).toBe(1);
    });

    it("writes the drawn offset into an array, as offset() gives it, and still reports a moved pixel", () => {
        const c = new CloudClock([3, 1]);
        const out = [-1, -1];

        expect(c.advance(0.4)).toBe(true); // 1.2 px
        c.offsetInto(out);

        expect(out).toEqual(c.offset());
        expect(out).toEqual([1, 0]);
        expect(c.advance(0.1), "0.3 px more: the same pixel").toBe(false);
        expect(c.advance(1)).toBe(true);
    });
});
