import { describe, expect, it } from "vitest";
import { MAX_CHANGES, ShadingGovernor } from "./shadingGovernor";

/** Pushes `n` intervals of `ms`, returns how many changed the level. */
function feed(governor: ShadingGovernor, n: number, ms: number): number {
    let changes = 0;
    for (let i = 0; i < n; i++) if (governor.push(ms)) changes += 1;
    return changes;
}

describe("ShadingGovernor", () => {
    it("steps down one level after 90 slow intervals in a row, not 89", () => {
        const g = new ShadingGovernor(2);
        expect(feed(g, 89, 30)).toBe(0);
        expect(g.level).toBe(2);
        expect(feed(g, 1, 30)).toBe(1);
        expect(g.level).toBe(1);
    });

    it("counts only intervals in a row: one that is not slow starts the count over", () => {
        const g = new ShadingGovernor(2);
        feed(g, 89, 30);
        feed(g, 1, 20);
        feed(g, 89, 30);
        expect(g.level).toBe(2);
    });

    it("ignores the intervals of a hidden tab", () => {
        const g = new ShadingGovernor(2);
        feed(g, 500, 400);
        expect(g.level).toBe(2);
    });

    it("steps up after 600 fast intervals once 30 s have passed since the last change, never above its ceiling", () => {
        const g = new ShadingGovernor(2);
        feed(g, 90, 30);
        expect(g.level).toBe(1);
        // 600 intervals of 13 ms are 7.8 s: not enough time yet
        expect(feed(g, 600, 13)).toBe(0);
        expect(g.level).toBe(1);
        // 30 s in all: 2,300 more intervals of 13 ms
        expect(feed(g, 2300, 13)).toBe(1);
        expect(g.level).toBe(2);
        expect(feed(g, 5000, 5)).toBe(0);
        expect(new ShadingGovernor(1).push(5)).toBe(false);
    });

    it("locks after three changes in a session", () => {
        const g = new ShadingGovernor(2);
        let changes = 0;
        for (let round = 0; round < 6; round++) {
            changes += feed(g, 90, 30);
            changes += feed(g, 3000, 10);
        }
        expect(changes).toBe(MAX_CHANGES);
        expect(g.locked).toBe(true);
        const level = g.level;
        feed(g, 500, 40);
        expect(g.level).toBe(level);
    });

    it("can fall to level 0 and stops there", () => {
        const g = new ShadingGovernor(1);
        feed(g, 90, 30);
        expect(g.level).toBe(0);
        expect(feed(g, 200, 30)).toBe(0);
    });
});
