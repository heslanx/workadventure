import { describe, expect, it } from "vitest";
import { lightUniformsInto } from "./lightUniforms";
import type { Light } from "./lights";

const light = (over: Partial<Light>): Light => ({
    x: 100,
    y: 200,
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

/** The code `postUniforms` held inline before it was extracted: the oracle the extraction is pinned to. */
function inline(lit: readonly Light[], lamps: number, L: Float32Array, LC: Float32Array, LClip: Float32Array): void {
    L.fill(0);
    LC.fill(0);
    LClip.fill(0);
    for (let i = 0; i < lit.length; i++) {
        const l = lit[i];
        const o = i * 4;
        L[o] = l.x;
        L[o + 1] = l.y;
        L[o + 2] = l.halo ? -l.reach : l.reach;
        L[o + 3] = l.squash;
        LC[o] = l.color[0];
        LC[o + 1] = l.color[1];
        LC[o + 2] = l.color[2];
        LC[o + 3] = l.power * (l.self ? Math.max(lamps, 0.75) : lamps);
        if (l.clip) {
            LClip[o] = l.clip[0];
            LClip[o + 1] = l.clip[1];
            LClip[o + 2] = l.clip[2];
            LClip[o + 3] = l.clip[3];
        }
    }
}

describe("lightUniformsInto", () => {
    const lit = [
        light({}),
        light({ x: 300, halo: false, reach: 80, squash: 0.6, power: 0.6, clip: [10, 20, 30, 40] }),
        light({ kind: "screen", self: true, color: [0.35, 0.63, 1], power: 1 }),
    ];

    it.each([0, 0.3, 0.9, 1])("writes what the inline code wrote, at night %s", (lamps) => {
        const a = [new Float32Array(128), new Float32Array(128), new Float32Array(128)];
        const b = [new Float32Array(128), new Float32Array(128), new Float32Array(128)];
        for (const f of b) f.fill(7); // stale values from a frame with more lights
        lightUniformsInto(lit, { lamps }, a[0], a[1], a[2]);
        inline(lit, lamps, b[0], b[1], b[2]);
        for (let k = 0; k < 3; k++) expect(Array.from(a[k])).toEqual(Array.from(b[k]));
    });

    it("keeps a screen at 0.75 of its light by day and gives a glowing lamp a negative reach", () => {
        const L = new Float32Array(128);
        const LC = new Float32Array(128);
        lightUniformsInto(lit, { lamps: 0 }, L, LC, new Float32Array(128));
        expect(LC[11]).toBeCloseTo(0.75);
        expect(LC[3]).toBe(0);
        expect(L[2]).toBe(-44);
        expect(L[6]).toBe(80);
    });
});
