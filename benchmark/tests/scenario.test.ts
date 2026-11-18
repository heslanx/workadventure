import { describe, expect, it } from "vitest";
import { MAP_BOUNDS, type Position, viewportFor } from "../src/protocol";
import { hasRole, hash01, motionFor } from "../src/scenario";

function distance(a: Position, b: Position): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("viewport sizes", () => {
    it("keeps the 640 x 400 box of the baselines for bot", () => {
        // Literal from the box every baseline used: half 320 x 200 around the bot, not clipped to the map.
        expect(viewportFor("bot", { x: 10, y: 20 })).toEqual({ left: -310, top: -180, right: 330, bottom: 220 });
    });

    it("gives a browser its 960 x 540 canvas plus a 300 px margin on every side", () => {
        expect(viewportFor("browser", { x: 1000, y: 800 })).toEqual({
            left: 220,
            top: 230,
            right: 1780,
            bottom: 1370,
        });
    });

    it("clips a browser viewport to the map at its edges", () => {
        expect(viewportFor("browser", { x: 100, y: 100 })).toEqual({ left: 0, top: 0, right: 880, bottom: 670 });
        expect(viewportFor("browser", { x: 2700, y: 1750 })).toEqual({
            left: 1920,
            top: 1180,
            right: 2752,
            bottom: 1792,
        });
    });

    it("gives zoomout the whole 2752 x 1792 map wherever the bot stands", () => {
        const whole = { left: 0, top: 0, right: 2752, bottom: 1792 };

        expect(viewportFor("zoomout", { x: 5, y: 5 })).toEqual(whole);
        expect(viewportFor("zoomout", { x: 2000, y: 1500 })).toEqual(whole);
    });
});

describe("ellipse pattern", () => {
    it("reproduces the points the baseline runs walked", () => {
        // Literals computed with the pre-flag formula (angle = index * golden angle + step * 0.05), so a changed
        // path shows up here before it silently invalidates a comparison with baseline-300.json.
        const ellipse = motionFor("ellipse");

        expect(ellipse.positionAt(0, 0)).toEqual({ x: 1056, y: 1290 });
        expect(ellipse.positionAt(0, 1)).toEqual({ x: 1093, y: 1289 });
        expect(ellipse.positionAt(3, 10)).toEqual({ x: 1783, y: 829 });
        expect(ellipse.positionAt(17, 377)).toEqual({ x: 1086, y: 200 });
        expect(ellipse.positionAt(999, 5)).toEqual({ x: 539, y: 357 });
    });

    it("never stops and never pauses, like the baseline bots", () => {
        const ellipse = motionFor("ellipse");

        expect(ellipse.movingAt(4, 9)).toBe(true);
        expect(ellipse.pauseTicksAfter(4, 9)).toBe(0);
    });
});

describe("closed patterns", () => {
    it.each(["ellipse", "ring", "plaza"] as const)("%s visits no point twice within a period", (pattern) => {
        // The move probe matches an arrival to the latest step at that point: a repeat inside the look-back window
        // would credit a delivery to the wrong move.
        const motion = motionFor(pattern);
        const period = motion.periodSteps ?? 0;

        for (const index of [0, 1, 2, 3, 77, 999]) {
            const points = new Set<string>();
            for (let step = 0; step < period; step++) {
                const point = motion.positionAt(index, step);
                points.add(`${point.x},${point.y}`);
            }
            expect(points.size).toBe(period);
        }
    });

    it.each(["ring", "plaza"] as const)("%s repeats its lap exactly after one period", (pattern) => {
        const motion = motionFor(pattern);
        const period = motion.periodSteps ?? 0;

        for (const index of [0, 1, 2, 3, 77, 999]) {
            for (let step = 0; step < period; step++) {
                expect(motion.positionAt(index, step + period)).toEqual(motion.positionAt(index, step));
            }
        }
    });

    it("keeps a ring bot on a 300 px circle around (1056, 745), a move of about 36 px at a time", () => {
        const ring = motionFor("ring");

        for (let step = 0; step < 104; step++) {
            const point = ring.positionAt(5, step);
            expect(distance(point, { x: 1056, y: 745 })).toBeGreaterThan(299);
            expect(distance(point, { x: 1056, y: 745 })).toBeLessThan(301);
            expect(distance(point, ring.positionAt(5, step + 1))).toBeLessThan(40);
        }
        expect(ring.periodSteps).toBe(52);
    });

    it("keeps every plaza bot inside the Plateia rectangle (192, 416, 416 x 544) on its lap", () => {
        const plaza = motionFor("plaza");

        for (const index of [0, 1, 2, 3, 4, 50, 51, 999]) {
            for (let step = 0; step < 108; step++) {
                const point = plaza.positionAt(index, step);
                expect(point.x).toBeGreaterThanOrEqual(192);
                expect(point.x).toBeLessThanOrEqual(608);
                expect(point.y).toBeGreaterThanOrEqual(416);
                expect(point.y).toBeLessThanOrEqual(960);
                expect(distance(point, plaza.positionAt(index, step + 1))).toBeLessThan(40);
            }
        }
    });

    it("puts plaza bots on four lanes 16 px apart, so they do not all walk the same line", () => {
        const plaza = motionFor("plaza");
        const leftEdge = (index: number) =>
            Math.min(...Array.from({ length: 54 }, (_, step) => plaza.positionAt(index, step).x));

        expect([0, 1, 2, 3, 4, 5].map(leftEdge)).toEqual([192, 208, 224, 240, 192, 208]);
    });
});

describe("walk-stop pattern", () => {
    const walk = motionFor("walk-stop");

    it("walks 12 moves, stops on the 12th and stays silent for 5 to 30 ticks", () => {
        for (const index of [0, 5, 400]) {
            for (let step = 1; step <= 120; step++) {
                const endsLeg = step % 12 === 0;
                expect(walk.movingAt(index, step)).toBe(!endsLeg);
                const pause = walk.pauseTicksAfter(index, step);
                if (endsLeg) {
                    expect(pause).toBeGreaterThanOrEqual(5);
                    expect(pause).toBeLessThanOrEqual(30);
                } else {
                    expect(pause).toBe(0);
                }
            }
        }
    });

    it("walks the next leg from the spot where the last one stopped", () => {
        // Step 12 is the stop; step 13 is one twelfth of the way to the next stop, not a jump from somewhere else.
        const stop = walk.positionAt(5, 12);

        expect(distance(walk.positionAt(5, 13), stop)).toBeLessThan(70);
        expect(distance(walk.positionAt(5, 11), stop)).toBeLessThan(70);
    });

    it("never sends the same point twice in a row and stays on the map", () => {
        for (const index of [0, 1, 2, 250, 251, 999]) {
            for (let step = 0; step < 600; step++) {
                const point = walk.positionAt(index, step);
                expect(distance(point, walk.positionAt(index, step + 1))).toBeGreaterThan(0);
                expect(point.x).toBeGreaterThanOrEqual(0);
                expect(point.x).toBeLessThanOrEqual(MAP_BOUNDS.width);
                expect(point.y).toBeGreaterThanOrEqual(0);
                expect(point.y).toBeLessThanOrEqual(MAP_BOUNDS.height);
            }
        }
    });

    it("gives each bot its own part of the floor and the same path in every process", () => {
        expect(walk.positionAt(1, 7)).not.toEqual(walk.positionAt(2, 7));
        expect(motionFor("walk-stop").positionAt(1, 7)).toEqual(walk.positionAt(1, 7));
        expect(walk.periodSteps).toBeUndefined();
    });
});

describe("who walks and who watches", () => {
    const countRole = (role: "walker" | "member" | "watcher", from: number, count: number, share: number) =>
        Array.from({ length: count }, (_, offset) => hasRole(role, from + offset, share)).filter(Boolean).length;

    it.each([0.05, 0.2, 0.5, 0.9])("selects %s of any run of consecutive bots, within two bots", (share) => {
        for (const from of [0, 250, 500, 13]) {
            expect(Math.abs(countRole("walker", from, 250, share) - 250 * share)).toBeLessThanOrEqual(2);
        }
    });

    it("selects nobody at 0 and everybody at 1", () => {
        expect(countRole("walker", 0, 100, 0)).toBe(0);
        expect(countRole("walker", 0, 100, 1)).toBe(100);
    });

    it("gives the same answer to a bot whichever process it runs in", () => {
        // 1000 bots in one process, or 4 x 250 with offsets 0, 250, 500, 750: the same 200 walkers either way.
        const single = countRole("walker", 0, 1000, 0.2);
        const split = [0, 250, 500, 750].reduce((total, offset) => total + countRole("walker", offset, 250, 0.2), 0);

        expect(split).toBe(single);
    });

    it("keeps walking independent of watching", () => {
        // 20% walkers x 50% watchers should overlap in about 10% of the bots; correlated roles would not.
        let both = 0;
        for (let index = 0; index < 1000; index++) {
            if (hasRole("walker", index, 0.2) && hasRole("watcher", index, 0.5)) {
                both += 1;
            }
        }

        expect(both).toBeGreaterThan(85);
        expect(both).toBeLessThan(115);
    });

    it("makes every watcher a member when the watchers are the smaller share", () => {
        for (let index = 0; index < 500; index++) {
            if (hasRole("watcher", index, 0.3)) {
                expect(hasRole("member", index, 0.6)).toBe(true);
            }
        }
    });
});

describe("hash01", () => {
    it("is deterministic and stays in [0, 1)", () => {
        expect(hash01(3, 4, 5)).toBe(hash01(3, 4, 5));
        for (let index = 0; index < 1000; index++) {
            const value = hash01(index, index * 7, 3);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });
});
