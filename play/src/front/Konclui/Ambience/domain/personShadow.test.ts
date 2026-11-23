import { describe, expect, it } from "vitest";
import { keyLightAt, newKeyLight } from "./keyLight";
import type { Light } from "./lights";
import {
    STAMP_ATLAS_HEIGHT,
    STAMP_ATLAS_WIDTH,
    STAMP_COLOUR,
    STAMP_SIZE,
    STAMP_TAILS,
    TAIL_WIDTH_FAR,
    stampWidths,
    LAMP_PICK_LIGHT,
    newPersonShadow,
    personShadowFrames,
    pickPersonShadow,
    pickStamp,
    stampFrameAt,
    stampFrameName,
} from "./personShadow";

const pool = (x: number, y: number, over: Partial<Light> = {}): Light => ({
    x,
    y,
    reach: 44,
    color: [1, 0.737, 0.314],
    power: 0.95,
    squash: 0.8,
    clip: null,
    kind: "arc",
    self: false,
    night: false,
    halo: true,
    ...over,
});

function frame(data: Uint8ClampedArray, dir: number, cls: number): number[][] {
    const [ox, oy] = stampFrameAt(dir, cls);
    const rows: number[][] = [];
    for (let y = 0; y < STAMP_SIZE; y++) {
        const row: number[] = [];
        for (let x = 0; x < STAMP_SIZE; x++) row.push(data[((oy + y) * STAMP_ATLAS_WIDTH + ox + x) * 4 + 3]);
        rows.push(row);
    }
    return rows;
}

const cells = (rows: number[][]) => rows.flat().filter((a) => a > 0).length;

describe("personShadowFrames", () => {
    const atlas = personShadowFrames();

    it("is 16 directions by 4 lengths of 40 x 40 frames, all in the navy of the ground's veil", () => {
        expect(atlas.length).toBe(STAMP_ATLAS_WIDTH * STAMP_ATLAS_HEIGHT * 4);
        expect([atlas[0], atlas[1], atlas[2]]).toEqual([...STAMP_COLOUR]);
        expect(stampFrameName(3, 2)).toBe("d3-2");
    });

    it("is the same on every call", () => {
        expect(Buffer.from(personShadowFrames()).equals(Buffer.from(atlas))).toBe(true);
    });

    it("draws a 12 x 5 oval at the feet in every frame, and a longer tail in a longer class", () => {
        for (let dir = 0; dir < 16; dir++) {
            const sizes = [0, 1, 2, 3].map((cls) => cells(frame(atlas, dir, cls)));
            for (let i = 1; i < 4; i++) expect(sizes[i], `direction ${dir}`).toBeGreaterThan(sizes[i - 1]);
            const f = frame(atlas, dir, 0);
            expect(f[20][20]).toBe(255); // the feet
            expect(f[20][15]).toBe(255); // 6 px left of them: the blob's reach
        }
        expect(STAMP_TAILS).toEqual([0, 7, 12, 16]);
    });

    it("lays the tail along its direction (straight down: below the blob, centred)", () => {
        // direction 4 is (0, 1) in LAMP_DIRECTIONS
        const f = frame(atlas, 4, 3);
        expect(f[20 + 12][20]).toBeGreaterThan(0);
        expect(f[20 - 6][20]).toBe(0);
        // the far half of the tail is lighter than the near half
        expect(f[20 + 12][20]).toBeLessThan(f[20 + 5][20]);
        expect(f[20 + 5][20]).toBe(255);
    });

    // Seen failing in the lab (review of 2026-11-23): a person's cast shadow was a 1 to 2 px stick beside the feet, a scratch
    // against a 14 x 26 figure. A stamp is an elongated oval: 12 px across at the feet, a tail not narrower than 5.
    it("is an oval of body width, not a stick: at least 5 px across all along the tail, a 12 x 5 oval at the feet, in every direction", () => {
        for (let dir = 0; dir < 16; dir++) {
            for (let cls = 1; cls < 4; cls++) {
                const w = stampWidths(atlas, dir, cls);
                expect(w.tail, `direction ${dir} class ${cls}`).toBeGreaterThanOrEqual(TAIL_WIDTH_FAR);
                expect(w.oval, `direction ${dir} class ${cls}`).toBeGreaterThanOrEqual(4);
            }
            expect(cells(frame(atlas, dir, 0)), `direction ${dir}`).toBeGreaterThanOrEqual(40); // the 12 x 5 oval
        }
    });

    it("measures a stick as one: a one-pixel line fails the width check", () => {
        const stick = new Uint8ClampedArray(STAMP_ATLAS_WIDTH * STAMP_ATLAS_HEIGHT * 4);
        const [ox, oy] = stampFrameAt(4, 3);
        for (let y = 22; y < 38; y++) stick[((oy + y) * STAMP_ATLAS_WIDTH + ox + 20) * 4 + 3] = 255;
        expect(stampWidths(stick, 4, 3).tail).toBeLessThan(TAIL_WIDTH_FAR);
    });

    it("reaches 14 to 22 px from the feet along its direction, by class", () => {
        const f = frame(atlas, 4, 3); // straight down
        const last = f.reduce((at, row, y) => (row[20] > 0 ? y : at), 0);
        expect(last - 20 + 1).toBeGreaterThanOrEqual(14);
        expect(last - 20 + 1).toBeLessThanOrEqual(22);
    });

    it("keeps everything inside its frame: nothing is drawn on the cell's border", () => {
        for (let dir = 0; dir < 16; dir++) {
            const f = frame(atlas, dir, 3);
            for (let i = 0; i < STAMP_SIZE; i++) {
                expect(f[0][i] + f[STAMP_SIZE - 1][i] + f[i][0] + f[i][STAMP_SIZE - 1]).toBe(0);
            }
        }
    });
});

describe("pickPersonShadow", () => {
    const key = newKeyLight();
    keyLightAt(17.4, key);

    it("follows the key where no lamp reaches, by day too", () => {
        const s = newPersonShadow();
        pickPersonShadow(s, 500, 500, [pool(100, 100)], 0, key, 0.62);
        // the key points lower-left at 1:1: direction 6 in LAMP_DIRECTIONS (-1, 1)
        expect(s.direction).toBe(6); // (-0.707, 0.707), lower-left
        expect(s.alpha).toBeCloseTo(0.62);
        expect(s.lengthClass).toBe(3);
    });

    // Seen failing in the lab (review of 2026-11-23): a person 80 px from a floor lamp, in the outer ring of its pool, cast
    // toward the lamp because the moon won there. The ring counts: the stamp points away from the lamp from LAMP_PICK_LIGHT.
    it("throws the shadow away from a lamp whose outer ring covers the feet, not toward it with the moon", () => {
        expect(LAMP_PICK_LIGHT).toBe(0.05);
        const s = newPersonShadow();
        // 30 px west of a lamp of reach 44 (power .95): light about .95 * (1 - .68) ^ 1.4 = 0.19: the ring; the moon's
        // direction at 17.4 is lower-left, which here is toward the lamp's side
        pickPersonShadow(s, 70, 100, [pool(100, 100)], 1, key, 0.45);
        expect([8, 9, 10, 11, 12]).toContain(s.direction); // west: away from the lamp
        const edge = newPersonShadow();
        // 38 px out: .95 * (1 - .864) ^ 1.4 = 0.058: still the lamp's
        pickPersonShadow(edge, 62, 100, [pool(100, 100)], 1, key, 0.45);
        expect([8, 9, 10, 11, 12]).toContain(edge.direction);
    });

    it("throws the shadow away from the strongest lamp when its light is at least 0.05, and darkens it a little", () => {
        const s = newPersonShadow();
        pickPersonShadow(s, 115, 106, [pool(100, 100)], 1, key, 0.45);
        // east of the lamp: the shadow points east (direction 0) or south-east, never west
        expect([0, 1, 2]).toContain(s.direction);
        expect(s.alpha).toBeGreaterThan(0.45);
        expect(s.alpha).toBeLessThanOrEqual(0.45 + 0.18);
    });

    // Seen failing in the lab: a person standing right under an arc lamp got a wide bar with a stem, a signpost's shadow.
    it("gives a person right under a lamp a plain oval, no tail, and one farther off a tail along the lamp's away", () => {
        const under = newPersonShadow();
        pickPersonShadow(under, 103, 104, [pool(100, 100)], 1, key, 0.45);
        expect(under.lengthClass).toBe(0);
        expect(cells(frame(personShadowFrames(), under.direction, under.lengthClass))).toBe(
            cells(frame(personShadowFrames(), 0, 0)),
        );
        const off = newPersonShadow();
        pickPersonShadow(off, 125, 106, [pool(100, 100)], 1, key, 0.45);
        expect(off.lengthClass).toBeGreaterThan(0);
    });

    it("ignores a lamp too faint at the feet, and a night of 0", () => {
        const far = newPersonShadow();
        pickPersonShadow(far, 140, 100, [pool(100, 100)], 1, key, 0.45);
        expect(far.direction).toBe(6);
        const day = newPersonShadow();
        pickPersonShadow(day, 100, 110, [pool(100, 100)], 0, key, 0.6);
        expect(day.direction).toBe(6);
    });

    it("keeps its stamp against small moves and changes it for a clear one, with no hysteresis for the first pick", () => {
        const s = newPersonShadow();
        pickPersonShadow(s, 115, 106, [pool(100, 100)], 1, key, 0.45);
        const first = s.direction;
        // a small move that changes the nearest direction but not by 15 degrees: kept
        pickPersonShadow(s, 115, 108, [pool(100, 100)], 1, key, 0.45);
        pickPersonShadow(s, 115, 105, [pool(100, 100)], 1, key, 0.45);
        expect(s.direction).toBe(first);
        // the other side of the lamp: clearly different
        pickPersonShadow(s, 85, 106, [pool(100, 100)], 1, key, 0.45);
        expect(s.direction).not.toBe(first);
    });

    it("writes into the record it is given and returns nothing", () => {
        const s = newPersonShadow();
        expect(pickPersonShadow(s, 0, 0, [], 0, key, 0.5)).toBeUndefined();
        expect(s.picked).toBe(true);
    });
});

describe("pickStamp", () => {
    const key = newKeyLight();
    keyLightAt(17.4, key);

    it("picks what pickPersonShadow picks, from a person and the light they stand in", () => {
        const a = newPersonShadow();
        const b = newPersonShadow();
        pickPersonShadow(a, 115, 106, [pool(100, 100)], 1, key, key.strength);
        pickStamp({ x: 115, y: 106, shadow: b }, { pools: [pool(100, 100)], lamps: 1, key });
        expect(b).toEqual({ ...a, atPools: b.atPools });
    });

    it("does nothing for a person who stands in the same light where they stood", () => {
        const s = newPersonShadow();
        const pools = [pool(100, 100)];
        const light = { pools, lamps: 1, key };
        pickStamp({ x: 115, y: 106, shadow: s }, light);
        s.alpha = 0.123; // marks the record: a second pick for the same feet must not rewrite it
        pickStamp({ x: 115, y: 106, shadow: s }, light);
        expect(s.alpha).toBe(0.123);
        pickStamp({ x: 116, y: 106, shadow: s }, light);
        expect(s.alpha).not.toBe(0.123);
    });
});
