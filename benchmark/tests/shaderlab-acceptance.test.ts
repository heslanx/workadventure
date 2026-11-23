/**
 * The lab's arithmetic acceptances (shader-lab/acceptance.ts), each of which answers a defect the reviewers of 2026-11-23 saw in a
 * picture and measured by hand. Each test builds the defect and the fix as small pictures and checks the number tells them apart,
 * so the acceptance fails when the thing it guards comes back.
 */
import { describe, expect, it } from "vitest";
import {
    castersHonoured,
    COVERAGE_DELTA,
    LAMP_NEAR_PX,
    litTowardLamp,
    nearestLampSide,
    lampPullAt,
    pearson,
    reliefAgreement,
    shiftedMismatch,
    SHIMMER_SLACK,
    visibleShadowCoverage,
    type CoveragePiece,
    type PoolLike,
} from "../shader-lab/acceptance";

/** A grey RGBA picture of `w` x `h`, each pixel from `at(x, y)` (a grey level). */
function grey(w: number, h: number, at: (x: number, y: number) => number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = at(x, y);
            out.set([v, v, v, 255], (y * w + x) * 4);
        }
    }
    return out;
}

const pool = (over: Partial<PoolLike> = {}): PoolLike => ({
    x: 20,
    y: 20,
    reach: 40,
    squash: 1,
    power: 1,
    clip: null,
    kind: "arc",
    ...over,
});

describe("pearson", () => {
    it("is 1 for a line, -1 for its reverse, and null with no spread or fewer than three pairs", () => {
        expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
        expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
        expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
        expect(pearson([1, 2], [1, 2])).toBeNull();
    });
});

describe("shiftedMismatch (shimmer)", () => {
    const size = { width: 8, height: 4 };
    const ramp = (shift: number) => grey(8, 4, (x) => ((x + shift) * 29) % 251);

    it("is 0 when the moved picture is the base one pixel along, at every row", () => {
        expect(shiftedMismatch(ramp(0), ramp(1), size)).toBe(0);
    });

    it("counts every pixel that differs: a picture that swims by a column fails", () => {
        const base = ramp(0);
        const swims = ramp(1);
        // one column of the moved picture comes from the wrong texel (a tie read the other way)
        for (let y = 0; y < 4; y++) swims.set([200, 200, 200, 255], (y * 8 + 3) * 4);
        expect(shiftedMismatch(base, swims, size)).toBe(4);
    });

    it("allows the shaded pass a slack of 0.02% of a window over today's, far under what a swimming lookup costs (1,000 to 6,000 px)", () => {
        expect(Math.ceil(SHIMMER_SLACK * 960 * 540)).toBeLessThan(150);
        expect(Math.ceil(SHIMMER_SLACK * 960 * 540)).toBeGreaterThan(50);
    });

    it("ignores a delta of 2 or less (the lab's noise floor)", () => {
        const base = ramp(0);
        const moved = ramp(1);
        moved[0] += 2;
        expect(shiftedMismatch(base, moved, size)).toBe(0);
        moved[0] += 1;
        expect(shiftedMismatch(base, moved, size)).toBe(1);
    });
});

describe("lampPullAt", () => {
    it("pulls toward the lamp, with the lamp 42 px up, and is nothing outside the pool or its clip", () => {
        const here = lampPullAt([pool()], 10, 20);
        expect(here.light).toBeGreaterThan(0);
        expect(here.pullX).toBeGreaterThan(0); // the lamp is to the right of a pixel at x 10
        expect(Math.abs(here.pullY)).toBeLessThan(0.05);
        expect(lampPullAt([pool()], 70, 20).light).toBe(0);
        expect(lampPullAt([pool({ clip: [0, 0, 5, 5] })], 10, 20).light).toBe(0);
    });
});

describe("reliefAgreement", () => {
    const size = { width: 40, height: 40 };
    const view = [0, 0, 40, 40];
    // a dome on a sofa left of a lamp at x 60: normals lean to +x on the right of the dome's centre and to -x on its left
    const normals = (flip: boolean): Uint8ClampedArray => {
        const out = new Uint8ClampedArray(40 * 40 * 4);
        for (let y = 5; y < 35; y++) {
            for (let x = 5; x < 35; x++) {
                const nx = (x - 20) / 15;
                const lean = flip ? -nx : nx;
                out.set([Math.round(((lean + 1) / 2) * 255), 128, 220, 255], (y * 40 + x) * 4);
            }
        }
        return out;
    };
    const off = grey(40, 40, () => 100);
    // the relief as it should be: lighter on the side that leans to the lamp (+x), darker away from it
    const lit = grey(40, 40, (x) => (x >= 5 && x < 35 ? Math.round(100 * (1 + 0.3 * ((x - 20) / 15))) : 100));
    // the failure: the moon's side wins, lighter on the far side, and everything else darker
    const wrong = grey(40, 40, (x) => (x >= 5 && x < 35 ? Math.round(100 * (0.8 - 0.1 * ((x - 20) / 15))) : 100));
    const input = (relief: Uint8ClampedArray, n: Uint8ClampedArray) => ({
        off,
        relief,
        size,
        view,
        normals: n,
        mapWidth: 40,
        mapHeight: 40,
        pools: [pool({ x: 60, y: 20, reach: 80 })],
        isPerson: () => false,
    });

    it("passes when the side that leans to the lamp is brighter and the relief does not only darken", () => {
        const result = reliefAgreement(input(lit, normals(false)));
        expect(result.covered).toBeGreaterThan(200);
        expect(result.correlation).toBeGreaterThan(0.9);
        expect(result.lightShare).toBeGreaterThan(0.4);
        expect(result.meets).toBe(true);
    });

    it("fails when the lamp-facing side is the dark one (the moon won inside the pool)", () => {
        const result = reliefAgreement(input(lit, normals(true)));
        expect(result.correlation).toBeLessThan(0);
        expect(result.meets).toBe(false);
    });

    it("fails when the relief only darkens, however it leans (96% of it was darker, a prop lost 16% of its brightness)", () => {
        const result = reliefAgreement(input(wrong, normals(false)));
        expect(result.lightShare).toBe(0);
        expect(result.meets).toBe(false);
    });

    it("says nothing (null) when a lamp lights too few prop pixels in the window to tell", () => {
        const result = reliefAgreement({ ...input(lit, normals(false)), pools: [] });
        expect(result.covered).toBe(0);
        expect(result.meets).toBeNull();
    });

    it("leaves out people and pixels with no normal", () => {
        const result = reliefAgreement({ ...input(lit, new Uint8ClampedArray(40 * 40 * 4)), isPerson: () => false });
        expect(result.covered).toBe(0);
        const everyone = reliefAgreement({ ...input(lit, normals(false)), isPerson: () => true });
        expect(everyone.covered).toBe(0);
    });
});

describe("visibleShadowCoverage", () => {
    const size = { width: 60, height: 40 };
    const view = [0, 0, 60, 40];
    const off = grey(60, 40, () => 160);
    const piece = (over: Partial<CoveragePiece> = {}): CoveragePiece => ({
        key: "a/b.png",
        x: 10,
        y: 5,
        width: 6,
        height: 10,
        kind: "stand",
        solid: (px, py) => px >= 0 && py >= 0 && px < 6 && py < 10,
        ...over,
    });
    const run = (element: Uint8ClampedArray, pieces: CoveragePiece[], walls = false, base = off) =>
        visibleShadowCoverage({
            off: base,
            standElements: [element],
            topElements: [element],
            size,
            view,
            pieces,
            isWall: () => walls,
            reach: 20,
        });
    /** A shadow of `n` pixels under the piece, darker than the floor by `delta`. */
    const shadow = (n: number, delta: number): Uint8ClampedArray =>
        grey(60, 40, (x, y) => (y >= 16 && y < 18 && x >= 10 && x < 10 + n / 2 ? 160 - delta : 160));

    it("counts a piece whose shadow shows beside it", () => {
        const c = run(shadow(20, 40), [piece()]);
        expect(c.stand.inWindow).toBe(1);
        expect(c.stand.visible).toBe(1);
        expect(c.stand.without).toEqual([]);
    });

    it("lists a piece with no shadow in the picture, and a shadow too faint to see does not count (a navy rug)", () => {
        const none = run(off, [piece()]);
        expect(none.stand.without[0]).toMatchObject({ key: "a/b.png", reason: "none", pixels: 0 });
        const faint = run(shadow(20, COVERAGE_DELTA), [piece()]);
        expect(faint.stand.visible).toBe(0);
    });

    it("says why: a wall behind it, or a floor too dark to show a shadow", () => {
        expect(run(off, [piece()], true).stand.without[0].reason).toBe("wall");
        const dark = grey(60, 40, () => 12);
        expect(run(dark, [piece()], false, dark).stand.without[0].reason).toBe("dark receiver");
    });

    it("does not count the piece's own pixels as its shadow", () => {
        // a change only inside the piece's own picture (its relief) is not a shadow
        const inside = grey(60, 40, (x, y) => (x >= 10 && x < 16 && y >= 5 && y < 15 ? 90 : 160));
        expect(run(inside, [piece()]).stand.visible).toBe(0);
    });

    it("judges only pieces wholly in the window with their reach, and only stand and top ones", () => {
        const c = run(off, [
            piece({ x: 50 }),
            piece({ kind: "hang" }),
            piece({ kind: "floor" }),
            piece({ kind: "top" }),
        ]);
        expect(c.stand.inWindow).toBe(0);
        expect(c.top.inWindow).toBe(1);
        expect(c.top.without).toHaveLength(1);
    });
});

describe("nearestLampSide and litTowardLamp", () => {
    it("names the side of the lamp whose pool reaches the feet within 100 px, and none when its pool does not", () => {
        const lamp = pool({ x: 100, y: 100, reach: 120 });
        expect(nearestLampSide([lamp], 160, 100)).toEqual({ side: "left", distance: 60 }); // the lamp is on their left
        expect(nearestLampSide([lamp], 40, 100)).toEqual({ side: "right", distance: 60 });
        // 98 px away with a pool that ends at 60: the lamp lights nobody there
        expect(nearestLampSide([pool({ x: 100, y: 100, reach: 60 })], 198, 100)).toEqual({
            side: null,
            distance: null,
        });
        // beyond LAMP_NEAR_PX even in a big pool
        expect(nearestLampSide([pool({ x: 100, y: 100, reach: 400 })], 100 + LAMP_NEAR_PX + 20, 100).side).toBeNull();
        // a screen's pool is not a lamp
        expect(nearestLampSide([pool({ x: 100, y: 100, reach: 120, kind: "screen" })], 130, 100).side).toBeNull();
    });

    it("is true only for a person lit on the lamp's side: the far side and 'even' fail", () => {
        expect(litTowardLamp("left", "left")).toBe(true);
        expect(litTowardLamp("left", "right")).toBe(false);
        expect(litTowardLamp("left", "even")).toBe(false);
        expect(litTowardLamp(null, "left")).toBeNull();
        expect(litTowardLamp("left", null)).toBeNull();
    });
});

describe("castersHonoured", () => {
    const used = { entries: 105, applied: 105, dropped: [], expectedChange: 62, keyPixelsChanged: 12000 };

    it("meets when every entry reached the bake and the key shadows changed", () => {
        expect(castersHonoured(used)).toEqual({ ...used, meets: true });
    });

    it("is not applicable for a manifest with no entry, nor without a report", () => {
        expect(
            castersHonoured({ ...used, entries: 0, applied: 0, expectedChange: 0, keyPixelsChanged: 0 })?.meets,
        ).toBeNull();
        expect(castersHonoured(undefined)).toBeNull();
        expect(castersHonoured(null)).toBeNull();
    });

    it("fails when an entry was dropped on the way to the bake", () => {
        expect(castersHonoured({ ...used, applied: 104, dropped: ["a/bench.png"] })?.meets).toBe(false);
        expect(castersHonoured({ ...used, applied: 0, dropped: [] })?.meets).toBe(false);
    });

    it("fails when the bake gave the same key shadows with the entries as without them, though entries ask for a change", () => {
        expect(castersHonoured({ ...used, keyPixelsChanged: 0 })?.meets).toBe(false);
    });

    it("lets entries that all say the rows (h equal to rows) change nothing", () => {
        expect(castersHonoured({ ...used, expectedChange: 0, keyPixelsChanged: 0 })?.meets).toBe(true);
    });
});
