import { describe, expect, it } from "vitest";
import { maskAt, maskByteAt, packMasks } from "./pixelMaps";

// What the scene effects read of the packed masks (SceneEffects.ts: outside, on water, polished, per walker and per
// frame). The bits are the contract: they are tested here, from the consumer's side, because the effects test with
// masks that are one colour all over.

/** Six 2 x 2 px cells in a row: outside, polished, lawn, water, wall, facade glass; then a seventh, empty. */
const CELLS: readonly (readonly [number, number, number])[] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [0, 0, 128],
    [128, 0, 0],
    [0, 128, 0],
    [0, 0, 0],
];

function masks() {
    const width = CELLS.length * 2;
    const data = new Uint8ClampedArray(width * 2 * 4);
    for (let y = 0; y < 2; y++) {
        for (let x = 0; x < width; x++) data.set([...CELLS[Math.floor(x / 2)], 255], (y * width + x) * 4);
    }
    return packMasks({ width, height: 2, data });
}

describe("the packed masks, read a byte at a time", () => {
    it("gives the bits the effects test: 1 outside, 2 polished, 4 lawn, 8 water, 16 wall, 32 facade glass", () => {
        const packed = masks();

        expect(CELLS.map((_, i) => maskByteAt(packed, i * 2 + 1, 1))).toEqual([1, 2, 4, 8, 16, 32, 0]);
    });

    it("gives nothing outside the picture, on any side", () => {
        const packed = masks();

        expect([
            maskByteAt(packed, -1, 0),
            maskByteAt(packed, 0, -1),
            maskByteAt(packed, CELLS.length * 2, 0),
            maskByteAt(packed, 0, 2),
        ]).toEqual([0, 0, 0, 0]);
    });

    it("is what the colour lookup is made from: the same cells, as colours", () => {
        const packed = masks();

        expect(CELLS.map((_, i) => maskAt(packed, i * 2, 0))).toEqual([
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
            [0, 0, 128],
            [96, 0, 0],
            [0, 128, 0],
            [0, 0, 0],
        ]);
    });
});
