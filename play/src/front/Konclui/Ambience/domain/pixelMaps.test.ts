import { describe, expect, it } from "vitest";
import { glassPanes, maskAt, measureFootprint, packMasks, paintBackOf, starSlots } from "./pixelMaps";

/** A width x height RGBA picture painted by `paint(x, y)`. */
function picture(
    width: number,
    height: number,
    paint: (x: number, y: number) => readonly [number, number, number, number],
): { width: number; height: number; data: Uint8ClampedArray } {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
    return { width, height, data };
}

describe("pixel maps", () => {
    it("packs the masks two pixels to a byte and reads them back as colours", () => {
        const masks = packMasks(
            picture(4, 2, (x) => (x < 2 ? [255, 0, 0, 255] : x === 2 ? [0, 128, 128, 255] : [0, 0, 0, 255])),
        );

        expect(masks.width).toBe(2);
        expect(masks.height).toBe(1);
        expect(maskAt(masks, 1, 1)).toEqual([255, 0, 0]); // outside
        expect(maskAt(masks, 2, 0)).toEqual([0, 128, 128]); // facade glass and water
        expect(maskAt(masks, -1, 0)).toEqual([0, 0, 0]);
        expect(maskAt(masks, 4, 0)).toEqual([0, 0, 0]);
    });

    it("measures the bottom of a silhouette, and nothing for an empty or tiny one", () => {
        const opaque = (x0: number, y0: number, x1: number, y1: number) =>
            picture(10, 10, (x, y) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? [0, 0, 0, 255] : [0, 0, 0, 0]));

        expect(measureFootprint(opaque(2, 1, 7, 9))).toEqual([3, 6, 7, 10]);
        expect(measureFootprint(opaque(2, 5, 7, 9))).toBeNull();
        expect(measureFootprint(picture(10, 10, () => [0, 0, 0, 0]))).toBeNull();
    });

    it("turns a brand piece's logo into its body colour below the top quarter", () => {
        const logo = [250, 250, 250, 255] as const;
        const body = [10, 20, 30, 255] as const;
        const totem = picture(1, 4, (_x, y) => (y === 0 || y === 3 ? logo : body));

        paintBackOf(totem.data, 1, 4);

        expect([...totem.data]).toEqual([...logo, ...body, ...body, ...body]);
    });

    it("finds the panes of a glass face between its mullions", () => {
        const face = [10, 30, 70] as const;
        const band = picture(20, 64, (x, y) =>
            y >= 4 && y <= 20 && x !== 8 && x !== 9 ? [255, 0, 0, 255] : [0, 0, 0, 255],
        );

        expect(glassPanes(face, band.data, 100, 100)).toEqual([
            [10, 18, 14, 31],
            [20, 30, 14, 31],
        ]);
        expect(glassPanes(face, picture(20, 64, () => [0, 0, 0, 255]).data, 100, 100)).toBeNull();
        expect(glassPanes(face, band.data, 10, 100)).toBeNull();
    });

    it("places the sun stars on calm deep water, far apart, with staggered phases", () => {
        const stars = starSlots(picture(300, 300, () => [0, 40, 1, 255]));
        const picked = [0, 1, 2, 3, 4].filter((k) => stars[k * 4] !== 0 || stars[k * 4 + 1] !== 0);

        expect(picked.length).toBeGreaterThan(1);
        picked.forEach((k) => expect(stars[k * 4 + 2]).toBe(k * 3));
        for (const a of picked) {
            for (const b of picked) {
                if (a < b) {
                    const d = Math.hypot(stars[a * 4] - stars[b * 4], stars[a * 4 + 1] - stars[b * 4 + 1]);
                    expect(d).toBeGreaterThan(90);
                }
            }
        }
        expect([...starSlots(picture(300, 300, () => [0, 40, 1, 0]))].every((v) => v === 0)).toBe(true);
    });
});
