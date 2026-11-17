import { describe, expect, it } from "vitest";
import { Trail } from "./trail";

describe("Trail", () => {
    it("steps every few px walked on the lawn, prints a footprint every third, never where someone just stands", () => {
        const t = new Trail({ spacing: 5, life: 1000, max: 4 });
        expect(t.step("a", 0, 0, 0, true)).toBe(false); // first sighting
        expect(t.step("a", 2, 0, 10, true)).toBe(false); // not far enough
        expect(t.step("a", 6, 0, 20, true)).toBe(true);
        expect(t.step("a", 12, 0, 30, false)).toBe(false); // off the lawn
        for (let i = 3; i < 9; i++) t.step("a", i * 6, 0, i * 10, true);
        expect(t.steps, "only the newest are drawn").toHaveLength(4);
        expect(t.steps.map((s) => s.foot)).toEqual([1, 0, 0, 2]); // moves 6..9: every third a print, right then left
        expect(t.steps[0].angle, "walking east").toBe(0);
        const [data, count] = t.uniforms(500);
        expect(count).toBe(4);
        const age = data[6] - 2 * Math.floor(data[6] / 2);
        expect(age).toBeGreaterThan(0.4); // age 0..1, foot in the twos
        expect(age).toBeLessThan(0.5);
        expect(Math.floor(data[2] / 2), "a right footprint").toBe(1);
        expect(Math.floor(data[14] / 2), "then a left one").toBe(2);
        expect(t.alive(2000)).toBe(false);
        t.forget(new Set());
        expect(t.step("a", 100, 0, 3000, true), "a forgotten walker starts again").toBe(false);
    });
});
