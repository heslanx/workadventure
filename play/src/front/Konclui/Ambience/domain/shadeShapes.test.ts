import { describe, expect, it } from "vitest";
import {
    castShape,
    closeGaps,
    lowerPart,
    FRAGMENTED_RUNS_PER_ROW,
    footRuns,
    hasPaintedShadow,
    lengthScale,
    placedSilhouette,
    shearRuns,
    silhouetteOf,
    SOLID_ALPHA,
    type Shear,
    type Silhouette,
} from "./shadeShapes";
import cases from "./__fixtures__/shade-shapes-cases.json";

/** RGBA from rows of characters: '#' opaque, '+' partial alpha (64), '.' empty. */
function picture(rows: string[]): { data: Uint8ClampedArray; width: number; height: number } {
    const width = rows[0].length;
    const data = new Uint8ClampedArray(width * rows.length * 4);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = row[x] === "#" ? 255 : row[x] === "+" ? 64 : 0;
    });
    return { data, width, height: rows.length };
}

/** The shared fixture's pictures (also read by tools/test_kinds.py): rows of tokens to RGBA. */
function fixturePicture(rows: readonly string[]): { data: Uint8ClampedArray; width: number; height: number } {
    const tokens = cases.tokens as Record<string, number[]>;
    const width = rows[0].length;
    const data = new Uint8ClampedArray(width * rows.length * 4);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) data.set(tokens[row[x]], (y * width + x) * 4);
    });
    return { data, width, height: rows.length };
}

function silhouette(rows: string[]): Silhouette {
    const p = picture(rows);
    const sil = silhouetteOf(p, p.width, p.height);
    if (!sil) throw new Error("empty");
    return sil;
}

describe("silhouetteOf", () => {
    it("reads the runs of each row, the top and the foot", () => {
        const sil = silhouette(["....", ".##.", "#..#", "####", "...."]);
        expect(sil.top).toBe(1);
        expect(sil.foot).toBe(3);
        const runs = (r: number) => Array.from(sil.runs.slice(sil.starts[r] * 2, sil.starts[r + 1] * 2));
        expect(runs(0)).toEqual([]);
        expect(runs(1)).toEqual([1, 3]);
        expect(runs(2)).toEqual([0, 1, 3, 4]);
        expect(runs(3)).toEqual([0, 4]);
        expect(footRuns(sil)).toEqual([[0, 4]]);
    });

    it("counts alpha of SOLID_ALPHA as the piece and one under as not", () => {
        const data = new Uint8ClampedArray(2 * 4);
        data[3] = SOLID_ALPHA;
        data[7] = SOLID_ALPHA - 1;
        const sil = silhouetteOf({ data }, 2, 1);
        expect(Array.from(sil?.runs ?? [])).toEqual([0, 1]);
        expect(silhouetteOf({ data: new Uint8ClampedArray(8) }, 2, 1)).toBeNull();
    });

    // Seen failing: the lounge's bedside tables carry a baked pool of light (alpha 130 to 155) under them. Read at 128 the
    // pool was the piece, its lowest row was the foot and the table's shadow started 16 px below the legs.
    it("does not take a layer of partial alpha for the piece (the foot stays on the legs)", () => {
        const pool = cases.cases.find((c) => c.name.startsWith("a bright warm pool"));
        if (!pool) throw new Error("fixture case missing");
        const { data, width, height } = fixturePicture(pool.rows);
        const sil = silhouetteOf({ data }, width, height);
        expect(sil?.foot).toBe(pool.foot);
        expect(sil?.top).toBe(pool.top);
    });
});

describe("placedSilhouette", () => {
    const sil = silhouette(["##..", "##..", "####"]);

    it("is the same silhouette when nothing changes", () => {
        expect(placedSilhouette(sil, 4, 3, false)).toBe(sil);
    });

    it("mirrors a flipped piece", () => {
        const flipped = placedSilhouette(sil, 4, 3, true);
        expect(Array.from(flipped.runs.slice(flipped.starts[0] * 2, flipped.starts[1] * 2))).toEqual([2, 4]);
        expect(flipped.foot).toBe(2);
    });

    it("resamples to the size it is drawn at", () => {
        const big = placedSilhouette(sil, 8, 6, false);
        expect(big.height).toBe(6);
        expect(big.foot).toBe(5);
        expect(Array.from(big.runs.slice(big.starts[5] * 2, big.starts[6] * 2))).toEqual([0, 8]);
        expect(Array.from(big.runs.slice(big.starts[0] * 2, big.starts[1] * 2))).toEqual([0, 4]);
    });
});

describe("hasPaintedShadow", () => {
    const sil = (rows: string[]) => {
        const p = picture(rows);
        return { p, s: silhouetteOf(p, p.width, p.height) as Silhouette };
    };

    it("is true with six partial-alpha pixels in the bottom quarter of the piece's rows", () => {
        const { p, s } = sil(["....", ".##.", ".##.", ".##.", "####", "++++", "++.."]);
        expect(hasPaintedShadow(p, p.width, p.height, s)).toBe(true);
    });

    it("is false with five, and false for a clean cut-out", () => {
        const five = sil(["....", ".##.", ".##.", ".##.", "####", "++++", "+..."]);
        expect(hasPaintedShadow(five.p, five.p.width, five.p.height, five.s)).toBe(false);
        const clean = sil(["....", ".##.", ".##.", ".##.", "####"]);
        expect(hasPaintedShadow(clean.p, clean.p.width, clean.p.height, clean.s)).toBe(false);
    });

    it("does not count partial alpha far above the foot (a soft edge higher up is not a shadow)", () => {
        const high = sil(["++++", "++++", ".##.", ".##.", ".##.", ".##.", ".##.", "####"]);
        expect(hasPaintedShadow(high.p, high.p.width, high.p.height, high.s)).toBe(false);
    });
});

describe("the shared picture cases (the same rows run in tools/test_kinds.py)", () => {
    it.each(cases.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
        const { data, width, height } = fixturePicture(c.rows);
        const sil = silhouetteOf({ data }, width, height);
        expect(sil?.top).toBe(c.top);
        expect(sil?.foot).toBe(c.foot);
        expect(hasPaintedShadow({ data }, width, height, sil as Silhouette)).toBe(c.painted);
    });
});

describe("castShape", () => {
    it("drops a thin stem above the foot and keeps a leg at the foot", () => {
        // a leaf blob on a one-pixel stem on a pot, and two one-pixel legs under a seat
        const plant = silhouette(["..###..", "..###..", "...#...", "...#...", "...#...", ".#####.", ".#####."]);
        const shape = castShape(plant);
        const runs = (r: number) => Array.from(shape.runs.slice(shape.starts[r] * 2, shape.starts[r + 1] * 2));
        expect(runs(0)).toEqual([2, 5]);
        expect(runs(2)).toEqual([]);
        expect(runs(3)).toEqual([]);
        expect(runs(4)).toEqual([3, 4]); // the last three rows keep what they have
        expect(runs(6)).toEqual([1, 6]);
        expect(shape.foot).toBe(plant.foot);
        const chair = silhouette(["####", "####", "#..#", "#..#"]);
        expect(Array.from(castShape(chair).runs)).toEqual(Array.from(chair.runs));
    });

    it("keeps a thin thing whole: a pole is its own shadow", () => {
        const pole = silhouette(["#", "#", "#", "#", "#", "#"]);
        expect(castShape(pole)).toBe(pole);
    });
});

// Seen failing in the lab (review of 2026-11-23): the bird of paradise at the pool room's ledge threw a scatter of 4 to 8 px
// specks, the lounge's big plant a thin disconnected tail: its leaves are drawn a pixel or two apart and each threw its own.
describe("castShape of a fragmented piece (leaves)", () => {
    const leaves = () =>
        silhouette([
            "#.##..##.#",
            ".###.###..",
            "#.##.##.#.",
            ".###..###.",
            "#.##.##.#.",
            ".###.###..",
            "...###....",
            "..#####...",
        ]);

    it("closes the gaps of 3 px or less inside a row, so the leaves are one mass, and leaves the foot row alone", () => {
        const plant = leaves();
        let runs = 0;
        let rows = 0;
        for (let r = plant.top; r <= plant.foot; r++) {
            if (plant.starts[r + 1] > plant.starts[r]) rows += 1;
            runs += plant.starts[r + 1] - plant.starts[r];
        }
        expect(runs / rows).toBeGreaterThan(FRAGMENTED_RUNS_PER_ROW);
        const shape = castShape(plant);
        const row = (r: number) => Array.from(shape.runs.slice(shape.starts[r] * 2, shape.starts[r + 1] * 2));
        // row 0: the 1 px specks at its ends are thin and go, the two leaves left are closed into one; row 1 likewise
        expect(row(0)).toEqual([2, 8]);
        expect(row(1)).toEqual([1, 8]);
        expect(shape.starts[shape.foot + 1] - shape.starts[shape.foot]).toBe(
            plant.starts[plant.foot + 1] - plant.starts[plant.foot],
        );
        expect(shape.foot).toBe(plant.foot);
    });

    it("closeGaps joins runs at most `maxGap` apart and no farther, and never the foot row", () => {
        const two = silhouette(["#...#", "#..#.", "#####"]);
        const closed = closeGaps(two, 2);
        const row = (r: number) => Array.from(closed.runs.slice(closed.starts[r] * 2, closed.starts[r + 1] * 2));
        expect(row(0)).toEqual([0, 1, 4, 5]); // 3 apart: kept apart
        expect(row(1)).toEqual([0, 4]); // 2 apart: closed
        expect(row(2)).toEqual([0, 5]);
    });

    it("keeps a lattice (two posts and a bar) a lattice: a frame's two runs a row are under the limit", () => {
        const frame = silhouette(["######", "##..##", "##..##", "##..##", "##..##", "##..##"]);
        expect(castShape(frame)).toBe(frame);
    });
});

describe("lowerPart (a lamp's own picture casts its base, not its arc)", () => {
    it("keeps the lowest share of the rows, the foot row where it was, and everything above gone", () => {
        const lamp = silhouette([
            "######",
            ".#....",
            ".#....",
            ".#....",
            ".#....",
            ".#....",
            ".#....",
            "..##..",
            ".####.",
        ]);
        const base = lowerPart(lamp, 0.35); // 9 rows: the lowest 4
        expect(base.foot).toBe(lamp.foot);
        expect(base.top).toBe(5);
        for (let r = 0; r < 5; r++) expect(base.starts[r + 1] - base.starts[r]).toBe(0);
        expect(Array.from(base.runs.slice(base.starts[8] * 2, base.starts[9] * 2))).toEqual([1, 5]);
    });

    it("returns the silhouette itself when the share covers every row", () => {
        const pole = silhouette(["#", "#"]);
        expect(lowerPart(pole, 1)).toBe(pole);
    });
});

describe("lengthScale", () => {
    it("keeps a shadow between its floor and its cap", () => {
        expect(10 * 0.28 * lengthScale(10, 0.28, 3, 22)).toBeCloseTo(3);
        expect(100 * 0.6 * lengthScale(100, 0.6, 3, 22)).toBeCloseTo(22);
        expect(lengthScale(20, 0.5, 3, 22)).toBe(1);
    });
});

describe("shearRuns", () => {
    const pole = silhouette(["#", "#", "#", "#", "#", "#", "#", "#", "#", "#"]);

    function cells(sil: Silhouette, sx: number, sy: number, m: number): Map<string, number> {
        const out = new Map<string, number>();
        shearRuns(sil, 0, 0, { sx, sy, m }, (y, x0, x1, share) => {
            for (let x = x0; x < x1; x++) out.set(`${x},${y}`, Math.max(out.get(`${x},${y}`) ?? 0, share));
        });
        return out;
    }

    it("lays a pole's shadow straight down, nearest the foot first (golden)", () => {
        const c = cells(pole, 0, 0.5, 1);
        const rows = [...c.keys()].map((k) => Number(k.split(",")[1])).sort((a, b) => a - b);
        expect(rows).toEqual([9, 10, 11, 12, 13, 14]);
        // the near half of the height (Z / H under a half) reaches rows 9..11, the far half rows 12..14
        for (let y = 9; y <= 11; y++) expect(c.get(`0,${y}`)).toBeLessThan(0.5);
        expect(c.get("0,14")).toBeGreaterThanOrEqual(0.5);
    });

    it("leans a pole's shadow along a 1:1 slope to the left, one pixel a pixel", () => {
        const c = cells(pole, -1, 1, 1);
        for (let z = 0; z <= 9; z++) expect(c.has(`${-z},${9 + z}`), `Z ${z}`).toBe(true);
    });

    it("leaves no hole at a large shear: consecutive cells of the chain touch", () => {
        for (const [sx, sy, m] of [
            [1, 1, 1.4],
            [-0.9, 0.9, 1.8],
            [0.45, 0.9, 2],
        ]) {
            const c = cells(pole, sx, sy, m);
            const steps = new Set<number>();
            for (const key of c.keys()) steps.add(Number(key.split(",")[1]));
            const ys = [...steps].sort((a, b) => a - b);
            // rows are contiguous
            for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], `${sx},${sy},${m}`).toBe(1);
            // and in each row the cells touch their neighbours
            const byRow = new Map<number, number[]>();
            for (const key of c.keys()) {
                const [x, y] = key.split(",").map(Number);
                byRow.set(y, [...(byRow.get(y) ?? []), x]);
            }
            for (let i = 1; i < ys.length; i++) {
                const a = byRow.get(ys[i - 1]) ?? [];
                const b = byRow.get(ys[i]) ?? [];
                const gap = Math.min(...a.flatMap((x) => b.map((z) => Math.abs(x - z))));
                expect(gap, `rows ${ys[i - 1]}..${ys[i]}`).toBeLessThanOrEqual(Math.ceil(Math.abs(sx * m)));
            }
        }
    });

    it("shears a box and a wide piece as a whole, not as a box hull: a notch stays a notch", () => {
        const arch = silhouette(["####", "#..#", "#..#"]);
        const c = cells(arch, 0, 1, 1);
        // the arch's legs reach the foot row (2) and the row below it (3); only its top bar, 2 px up, reaches row 4
        expect(c.has("1,2")).toBe(false);
        expect(c.has("1,3")).toBe(false);
        expect(c.has("1,4")).toBe(true);
        expect(c.has("0,3")).toBe(true);
    });
});

describe("shearRuns of a box with a swept footprint", () => {
    const rows = Array.from({ length: 40 }, () => "#".repeat(20));
    const sil = silhouetteOf(
        {
            data: Uint8ClampedArray.from(
                rows.flatMap((row) => [...row].flatMap((c) => [0, 0, 0, c === "#" ? 255 : 0])),
            ),
        },
        20,
        40,
    ) as Silhouette;
    const base = { sx: 1, sy: 0.5, m: 1, foot: 39, cap: 20 } as const;
    const cells = (shear: Shear): { y: number; x0: number; x1: number; share: number }[] => {
        const out: { y: number; x0: number; x1: number; share: number }[] = [];
        shearRuns(sil, 0, 0, shear, (y, x0, x1, share) => out.push({ y, x0, x1, share }));
        return out;
    };

    it("without `sweep` sets the top face down once at the far end (as it always did)", () => {
        const far = cells(base).filter((c) => c.y < 39);
        expect(far.length).toBeGreaterThan(0);
        expect(Math.min(...far.map((c) => c.y))).toBeLessThan(39 - 6);
    });

    it("with `sweep` stays within the footprint's depth over the foot line and gives both bands of the stepped edge", () => {
        const all = cells({ ...base, sweep: { runs: [[0, 20]], depth: 6 } });
        // the sheared line goes down the screen (sy > 0): nothing is higher than `depth` over the foot row
        expect(Math.min(...all.map((c) => c.y))).toBeGreaterThanOrEqual(39 - 6);
        expect(all.some((c) => c.share < 0.5)).toBe(true);
        expect(all.some((c) => c.share >= 0.5)).toBe(true);
        // slices follow the shear: the far end is `cap` px along it
        expect(Math.max(...all.map((c) => c.x1))).toBe(20 + 20);
    });
    it("a light that falls straight down the screen leaves a wedge: narrower and shorter at the far end, not a rectangle", () => {
        const down = {
            sx: 0,
            sy: 1,
            m: 1,
            foot: 39,
            cap: 20,
            sweep: { runs: [[0, 20]] as [number, number][], depth: 6 },
        };
        const all = cells(down);
        const width = (rows: typeof all): number =>
            Math.max(...rows.map((c) => c.x1)) - Math.min(...rows.map((c) => c.x0));
        const near = all.filter((c) => c.y >= 39 - 6 && c.y <= 39 && c.share < 0.15);
        const far = all.filter((c) => c.share > 0.85);
        expect(near.length).toBeGreaterThan(0);
        expect(far.length).toBeGreaterThan(0);
        expect(width(far)).toBeLessThan(width(near) * 0.5);
        // shorter than the same light would drag it if it leaned: the far end is not `cap` px down
        expect(Math.max(...all.map((c) => c.y))).toBeLessThan(39 + 20);
        // and it never leaves the footprint's columns
        expect(Math.min(...all.map((c) => c.x0))).toBeGreaterThanOrEqual(0);
        expect(Math.max(...all.map((c) => c.x1))).toBeLessThanOrEqual(20);
    });

    it("a light that leans keeps the full width and length of the sweep (no taper)", () => {
        const all = cells({ ...base, sweep: { runs: [[0, 20]], depth: 6 } });
        const far = all.filter((c) => c.share > 0.85);
        expect(Math.max(...far.map((c) => c.x1)) - Math.min(...far.map((c) => c.x0))).toBeGreaterThanOrEqual(20);
    });

    it("never casts a row wider than the swept footprint (a disc under a pole throws the pole's shadow)", () => {
        const all = cells({ ...base, sweep: { runs: [[8, 11]], depth: 2 } });
        expect(all.length).toBeGreaterThan(0);
        expect(Math.max(...all.map((c) => c.x1 - c.x0))).toBeLessThanOrEqual(3);
    });
});

describe("shearRuns of a swept footprint under a picture that is not as wide as it", () => {
    const silOf = (rows: string[]): Silhouette =>
        silhouetteOf(
            {
                data: Uint8ClampedArray.from(
                    rows.flatMap((row) => [...row].flatMap((c) => [0, 0, 0, c === "#" ? 255 : 0])),
                ),
            },
            rows[0].length,
            rows.length,
        ) as Silhouette;
    const cells = (
        sil: Silhouette,
        shear: Shear,
    ): { y: number; x0: number; x1: number; share: number; ox: number }[] => {
        const out: { y: number; x0: number; x1: number; share: number; ox: number }[] = [];
        // the shear moves a row by round(sx * m * height): what is left of a cell once that is taken off is a column of the picture
        shearRuns(sil, 0, 0, shear, (y, x0, x1, share) =>
            out.push({ y, x0, x1, share, ox: Math.round(shear.sx * shear.m * share * (shear.cap ?? 0)) }),
        );
        return out;
    };

    it("a pole on a disc sweeps the pole's width above the disc, not the disc's (a thin pole keeps a thin shadow)", () => {
        // 3 px pole over 30 rows, on a disc 20 wide and 8 rows deep: the base row is the disc's
        const sil = silOf([
            ...Array.from({ length: 30 }, () => " ".repeat(8) + "###" + " ".repeat(9)),
            ...Array.from({ length: 8 }, () => "#".repeat(20)),
        ]);
        const shear: Shear = { sx: 1, sy: 0.5, m: 1, foot: 37, cap: 24, sweep: { runs: [[0, 20]], depth: 6 } };
        const all = cells(sil, shear);
        // over the disc's own 8 rows the slices may be the disc's; past them (a third of the way and more) only the pole is left
        const past = all.filter((c) => c.share > 0.4);
        expect(past.length).toBeGreaterThan(20);
        expect(Math.max(...past.map((c) => c.x1 - c.x0))).toBeLessThanOrEqual(3);
        // and it reaches the end of the sweep: the shadow is a thin line out to `cap` px along the light
        expect(Math.max(...all.map((c) => c.x1))).toBeGreaterThanOrEqual(8 + 24);
    });

    it("a table on two legs casts its legs as two stripes, then its top as one band: nothing is cast where the picture has nothing", () => {
        // 20 rows of top over 6 rows of two legs, 4 wide each, at the ends: the top is the body the legs carry
        const sil = silOf([
            ...Array.from({ length: 20 }, () => "#".repeat(30)),
            ...Array.from({ length: 6 }, () => "####" + " ".repeat(22) + "####"),
        ]);
        const shear: Shear = {
            sx: 1,
            sy: 0.3,
            m: 1,
            foot: 25,
            cap: 16,
            sweep: {
                runs: [
                    [0, 4],
                    [26, 30],
                ],
                depth: 2,
            },
        };
        const all = cells(sil, shear);
        expect(all.length).toBeGreaterThan(0);
        // the legs are 6 of the 16 px of height: what is cast at their heights is on a leg, with the gap between them left bare
        const onALeg = (from: number, to: number): boolean => (from >= -1 && to <= 5) || (from >= 25 && to <= 31);
        const low = all.filter((c) => c.share < 0.3);
        expect(low.length).toBeGreaterThan(0);
        for (const c of low) expect(onALeg(c.x0 - c.ox, c.x1 - c.ox)).toBe(true);
        // and over them the top is cast whole, between the legs too: it is the picture's body, not a ghost
        const high = all.filter((c) => c.share > 0.45);
        expect(high.length).toBeGreaterThan(0);
        expect(Math.max(...high.map((c) => c.x1 - c.x0))).toBe(30);
    });

    it("never casts a body wider than the base it stands on: a top that overhangs its legs is cut to their span", () => {
        // a top 36 wide over legs that span columns 3 to 33
        const sil = silOf([
            ...Array.from({ length: 20 }, () => "#".repeat(36)),
            ...Array.from({ length: 6 }, () => " ".repeat(3) + "####" + " ".repeat(22) + "####" + " ".repeat(3)),
        ]);
        const shear: Shear = {
            sx: 1,
            sy: 0.3,
            m: 1,
            foot: 25,
            cap: 16,
            sweep: {
                runs: [
                    [3, 7],
                    [29, 33],
                ],
                depth: 2,
            },
        };
        const all = cells(sil, shear);
        expect(all.length).toBeGreaterThan(0);
        for (const c of all) {
            expect(c.x0 - c.ox).toBeGreaterThanOrEqual(3 - 1);
            expect(c.x1 - c.ox).toBeLessThanOrEqual(33 + 1);
        }
    });
});
