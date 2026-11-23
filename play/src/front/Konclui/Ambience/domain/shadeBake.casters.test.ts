import { describe, expect, it } from "vitest";
import { keyLightAt, newKeyLight, type KeyLight } from "./keyLight";
import type { Light } from "./lights";
import type { CasterLamp } from "./lamps";
import {
    CastBake,
    bakeCast,
    castersSignature,
    newCastBuffer,
    placedCaster,
    type BakeCaster,
    type BakeInput,
    type BakePiece,
} from "./shadeBake";
import { silhouetteOf } from "./shadeShapes";

// The caster entries of the manifest: a piece whose rows are not its height throws its key and lamp shadows from `h`, starting
// at its foot line. A piece with no entry is shaded as it always was.

const W = 120;
const H = 100;

function sil(rows: string[]) {
    const width = rows[0].length;
    const data = new Uint8ClampedArray(width * rows.length * 4);
    rows.forEach((row, y) => {
        for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = row[x] === "#" ? 255 : 0;
    });
    return silhouetteOf({ data }, width, rows.length);
}

/** A bench seen from above: 30 wide, 24 rows deep. */
const FLAT = Array.from({ length: 24 }, () => "#".repeat(30));
/** A pole: 2 wide, 30 rows tall. */
const POLE = Array.from({ length: 30 }, () => "##");

function piece(rows: string[], x: number, y: number, caster?: BakeCaster | null, key = "k"): BakePiece {
    return {
        key,
        x,
        y,
        kind: "stand",
        silhouette: sil(rows),
        painted: false,
        ...(caster === undefined ? {} : { caster }),
    };
}

function keyAt(hour: number): KeyLight {
    const k = newKeyLight();
    keyLightAt(hour, k);
    return k;
}

function input(pieces: BakePiece[], extra: Partial<BakeInput> = {}): BakeInput {
    return { width: W, height: H, pieces, spaces: [], building: null, lamps: [], key: keyAt(15.5), ...extra };
}

const px = (out: Uint8Array, x: number, y: number, c: number): number => out[((H - 1 - y) * W + x) * 4 + c];

function bake(i: BakeInput, options = {}): Uint8Array {
    const out = newCastBuffer(W, H);
    bakeCast(i, out, options);
    return out;
}

/** The map pixels the key's channel marks outside the pictures, as [x, y]. */
function shadowCells(out: Uint8Array): [number, number][] {
    const cells: [number, number][] = [];
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (px(out, x, y, 1) > 0 && px(out, x, y, 3) !== 255) cells.push([x, y]);
    return cells;
}

function checksum(bytes: Uint8Array): string {
    // FNV-1a over the bytes: enough to tell any changed byte of a bake from the same bake
    let h = 0x811c9dc5;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return h.toString(16).padStart(8, "0");
}
const sum = checksum;
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

describe("a piece without a caster entry", () => {
    it("is baked byte for byte as before the entries existed (the checksum is of the bake at 7971a2b22)", () => {
        const pieces = [piece(FLAT, 10, 10), piece(POLE, 60, 8), piece(["####", "####", "####"], 90, 40)];
        const day = bake(input(pieces));
        const dusk = bake(input(pieces, { key: keyAt(19.3) }));

        expect(sum(day)).toBe("f95cb27d");
        expect(sum(dusk)).toBe("d8d2426d");
    });

    it("is not changed by a null caster, nor by an entry whose h is its rows and whose foot is its lowest row", () => {
        const plain = [piece(FLAT, 10, 10), piece(POLE, 60, 8)];
        const rows = [
            piece(FLAT, 10, 10, { h: 24, foot: null, span: null }),
            piece(POLE, 60, 8, { h: 30, foot: 29, span: null }),
        ];
        const nulls = [piece(FLAT, 10, 10, null), piece(POLE, 60, 8, null)];

        expect(same(bake(input(rows)), bake(input(plain)))).toBe(true);
        expect(same(bake(input(nulls)), bake(input(plain)))).toBe(true);
    });
});

describe("a flat wide piece with an entry (a bench: 40 rows deep, 10 px high)", () => {
    const BENCH = Array.from({ length: 40 }, () => "#".repeat(30));
    const key = keyAt(15.5);
    const entry: BakeCaster = { h: 10, foot: null, span: null };
    const today = bake(input([piece(BENCH, 40, 30)]), { contact: false });
    const withEntry = bake(input([piece(BENCH, 40, 30, entry)]), { contact: false });
    const foot = 30 + 39;

    it("throws a shadow as long as its height, not as long as its rows", () => {
        const last = (cells: [number, number][]): number => Math.max(...cells.map(([, y]) => y));
        const reach = Math.ceil(10 * key.length * key.dy) + 1;

        expect(last(shadowCells(today))).toBeGreaterThan(foot + reach + 3);
        expect(last(shadowCells(withEntry))).toBeLessThanOrEqual(foot + reach);
        expect(shadowCells(withEntry).length).toBeLessThan(shadowCells(today).length);
    });

    it("starts at the foot line and peeks out of the picture along the whole depth on the side the light points to", () => {
        const cells = shadowCells(withEntry);
        const sideways = cells.filter(([x, y]) => y < foot - 4 && x < 40);

        expect(cells.some(([, y]) => Math.abs(y - foot) <= 1)).toBe(true);
        expect(Math.min(...cells.map(([, y]) => y))).toBeGreaterThanOrEqual(30 - 1);
        // the light leans left (dx < 0): the strip beside the picture runs along the footprint, 40 - 10 rows, less the 4 rows near
        // the foot left out above and the 3 the shadow is moved down by
        expect(key.dx).toBeLessThan(0);
        expect(new Set(sideways.map(([, y]) => y)).size).toBeGreaterThanOrEqual(40 - 10 - 4 - 4);
    });

    it("marks only receivers: nothing under its own picture, and the picture is still solid", () => {
        for (const [x, y] of shadowCells(withEntry)) expect(px(withEntry, x, y, 3)).not.toBe(255);
        expect(px(withEntry, 50, 40, 3)).toBe(255);
    });
});

describe("a tall thin piece with an entry", () => {
    it("keeps its shadow when h is its rows, shortens it when h is less and lengthens it when h is more", () => {
        const length = (caster: BakeCaster | null): number => {
            const cells = shadowCells(
                bake(input([piece(POLE, 50, 10, caster)], { key: keyAt(12.5) }), { contact: false }),
            );
            return Math.max(...cells.map(([, y]) => y)) - (10 + 29);
        };
        const plain = length(null);

        expect(length({ h: 30, foot: null, span: null })).toBe(plain);
        expect(length({ h: 12, foot: null, span: null })).toBeLessThan(plain);
        expect(length({ h: 60, foot: null, span: null })).toBeGreaterThan(plain);
    });

    it("never goes past the cap, whatever h says", () => {
        const cells = shadowCells(
            bake(input([piece(POLE, 50, 10, { h: 400, foot: null, span: null })], { key: keyAt(12.5) }), {
                contact: false,
            }),
        );

        expect(Math.max(...cells.map(([, y]) => y)) - (10 + 29)).toBeLessThanOrEqual(23);
    });
});

describe("foot and span", () => {
    it("starts the shadow at the given foot row instead of the lowest row, and leaves the rows under it out", () => {
        const rows = Array.from({ length: 20 }, () => "#".repeat(10));
        const lowest = shadowCells(
            bake(input([piece(rows, 40, 20, { h: 20, foot: null, span: null })]), { contact: false }),
        );
        const raised = shadowCells(
            bake(input([piece(rows, 40, 20, { h: 12, foot: 11, span: null })]), { contact: false }),
        );

        expect(Math.max(...lowest.map(([, y]) => y))).toBeGreaterThan(20 + 19);
        expect(Math.max(...raised.map(([, y]) => y))).toBeLessThanOrEqual(20 + 11 + 5);
        expect(raised.some(([, y]) => Math.abs(y - (20 + 11)) <= 1)).toBe(true);
    });

    it("puts the contact band under the span only, and under the given foot", () => {
        const wide = piece(FLAT, 30, 20, { h: 24, foot: null, span: [4, 12] });
        const out = bake(input([wide]), { key: false, lamp: false, surface: false });

        expect(px(out, 30 + 6, 20 + 24, 2)).toBe(255);
        expect(px(out, 30 + 20, 20 + 24, 2)).toBe(0);
        expect(px(out, 30 + 1, 20 + 24, 2)).toBe(0);
        const base = bake(input([piece(FLAT, 30, 20)]), { key: false, lamp: false, surface: false });
        expect(px(base, 30 + 20, 20 + 24, 2)).toBe(255);
    });
});

describe("the lamps' shadows", () => {
    const pool: Light = {
        x: 20,
        y: 30,
        reach: 50,
        color: [1, 0.737, 0.314],
        power: 0.95,
        squash: 0.8,
        clip: null,
        kind: "arc",
        self: false,
        night: false,
        halo: true,
    };
    const lamp: CasterLamp = { piece: 0, x: 20, y: 12, z: 42, gx: 20, gy: 40, reach: 50, squash: 0.6, pools: [pool] };
    const lampPiece = piece(["##", "##"], 19, 10, null, "lamp");
    const lit = (caster: BakeCaster | null): Uint8Array =>
        bake(input([lampPiece, piece(FLAT, 50, 36, caster)], { lamps: [lamp] }), {
            solid: true,
            contact: false,
            key: false,
            surface: false,
        });
    const reds = (out: Uint8Array): number => {
        let n = 0;
        for (let i = 0; i < out.length; i += 4) if (out[i] > 0) n += 1;
        return n;
    };

    it("take the length from h too", () => {
        const today = lit(null);
        const flat = lit({ h: 6, foot: null, span: null });

        expect(reds(today)).toBeGreaterThan(0);
        expect(reds(flat)).toBeGreaterThan(0);
        expect(reds(flat)).toBeLessThan(reds(today));
        expect(same(lit({ h: 24, foot: null, span: null }), today)).toBe(true);
    });
});

describe("determinism with entries", () => {
    const entries = [
        piece(FLAT, 10, 10, { h: 6, foot: null, span: [2, 20] }),
        piece(POLE, 60, 8, { h: 12, foot: null, span: null }),
        piece(FLAT, 70, 50, { h: 40, foot: 20, span: null }),
        piece(POLE, 100, 60),
    ];

    it("gives the same bytes in slices of one caster as in one go", () => {
        for (const hour of [12.5, 22]) {
            const whole = newCastBuffer(W, H);
            bakeCast(input(entries, { key: keyAt(hour) }), whole);
            const sliced = newCastBuffer(W, H);
            const job = new CastBake(input(entries, { key: keyAt(hour) }), sliced);
            let steps = 0;
            while (!job.step(1)) steps += 1;
            expect(steps).toBeGreaterThan(entries.length);
            expect(same(sliced, whole)).toBe(true);
        }
    });

    it("gives the same bytes on two runs, whatever was in the buffer before", () => {
        const a = newCastBuffer(W, H);
        const b = newCastBuffer(W, H);
        b.fill(99);
        bakeCast(input(entries), a);
        bakeCast(input(entries), b);
        expect(same(a, b)).toBe(true);
    });
});

describe("placedCaster", () => {
    const flat = sil(FLAT);
    const spec = { h: 6, foot: 20, span: [4, 12] as [number, number] };

    it("is null without an entry or a picture, and carries h, foot and span through when the piece is drawn as it is", () => {
        expect(placedCaster(undefined, flat, 30, 24, false)).toBeNull();
        expect(placedCaster(spec, null, 30, 24, false)).toBeNull();
        expect(placedCaster(spec, flat, 30, 24, false)).toEqual({ h: 6, foot: 20, span: [4, 12] });
        expect(placedCaster({ h: 6 }, flat, 30, 24, false)).toEqual({ h: 6, foot: null, span: null });
    });

    it("follows the mirror and the resampling: the span flips and scales, the foot scales, h is in map px and stays", () => {
        const big = sil(Array.from({ length: 48 }, () => "#".repeat(60)));

        expect(placedCaster(spec, flat, 30, 24, true)).toEqual({ h: 6, foot: 20, span: [18, 26] });
        expect(placedCaster(spec, big, 30, 24, false)).toEqual({ h: 6, foot: 41, span: [8, 24] });
    });
});

describe("castersSignature", () => {
    it("is empty without casters and changes when any entry, key, or part of an entry does", () => {
        const a = { x: { h: 6 }, y: { h: 8, foot: 3, span: [1, 4] as [number, number] } };

        expect(castersSignature(undefined)).toBe("");
        expect(castersSignature(a)).toBe(castersSignature({ y: a.y, x: a.x }));
        const variants = [
            { ...a, x: { h: 7 } },
            { ...a, y: { ...a.y, foot: 4 } },
            { ...a, y: { ...a.y, span: [1, 5] as [number, number] } },
            { ...a, z: { h: 1 } },
            { x: a.x },
        ];
        for (const v of variants) expect(castersSignature(v)).not.toBe(castersSignature(a));
    });
});
