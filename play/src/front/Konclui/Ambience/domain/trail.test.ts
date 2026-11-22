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

describe("Trail, as a frame uses it", () => {
    /** A walker who has stepped `n` times along the lawn: x = 6 per step, 20 ms apart. */
    function walked(n: number, options = { spacing: 5, life: 1000, max: 4 }): Trail {
        const t = new Trail(options);
        for (let i = 0; i <= n; i++) t.step("a", i * 6, 0, i * 20, true);
        return t;
    }

    it("writes the uniforms into the array it is given, the same as it makes them", () => {
        const t = walked(6);
        const [made, count] = t.uniforms(500);
        const out = new Float32Array(16).fill(7); // dirty: the slots past the steps must be cleared

        const written = t.uniformsInto(out, 500);

        expect(written).toBe(count);
        expect([...out]).toEqual([...made]);
    });

    it("drops the steps that outlived their life without making a new list", () => {
        const t = walked(3);
        const list = t.steps;

        expect(t.alive(20 + 1000)).toBe(true); // the steps at 0 and 20... only the one at 60 and later remain
        expect(t.steps.map((s) => s.at)).toEqual([40, 60]);
        expect(t.steps, "the same array, edited").toBe(list);
        expect(t.alive(5000)).toBe(false);
    });

    it("forgets the walkers a predicate does not know, without a set made for it", () => {
        const t = new Trail({ spacing: 5 });
        t.step("a", 0, 0, 0, true);
        t.step("b", 0, 0, 0, true);

        t.forgetUnless((id) => id === "a");

        expect(t.step("a", 10, 0, 10, true), "a kept walker steps on").toBe(true);
        expect(t.step("b", 10, 0, 10, true), "a forgotten one starts again").toBe(false);
    });

    it("lets a walker who left the view start again on return, not leave a step across the map", () => {
        const t = new Trail({ spacing: 5 });
        t.step(7, 0, 0, 0, true);

        t.release(7);

        expect(t.step(7, 900, 0, 10, true)).toBe(false);
        expect(t.steps).toHaveLength(0);
    });

    it("keeps the walking direction of a step when the walker's record is rewritten in place", () => {
        const t = new Trail({ spacing: 5 });
        t.step("a", 0, 0, 0, true);
        t.step("a", 0, 6, 10, true); // south
        t.step("a", 6, 6, 20, true); // east

        expect(t.steps.map((s) => s.angle)).toEqual([Math.PI / 2, 0]);
    });
});
