import { describe, expect, it, vi } from "vitest";
import { CAST_DUMMY, FLOOR_PIECE } from "../domain/shadeBake";
import { CastTexture, type CastRenderer } from "./castTexture";

function setup() {
    const texture = { update: vi.fn(), destroy: vi.fn() };
    const create = vi.fn(() => texture);
    const renderer = {
        gl: { CLAMP_TO_EDGE: 33071, NEAREST: 9728, RGBA: 6408 },
        createUint8ArrayTexture: create,
    } as unknown as CastRenderer;
    return { texture, renderer, create };
}

describe("CastTexture", () => {
    it("starts as one pixel of (0, 0, 0, 40), not premultiplied and not flipped: no shadow, and no prop takes relief", () => {
        const { renderer, create } = setup();
        new CastTexture(renderer, 64, 32);
        expect(create).toHaveBeenCalledWith(new Uint8Array([0, 0, 0, 40]), 1, 1, false, false);
    });

    it("starts with the alpha of a floor piece, which the shader reads as a receiver that takes no relief", () => {
        // POST_SHADED: prop = nm.a > 0.5 && !(sh.a > 0.1 && sh.a < 0.25); with the dummy up, a rug stamped in an old build's
        // normal.png must not show its stripes in the second before the first bake lands
        const alpha = CAST_DUMMY[3] / 255;
        expect(alpha).toBeGreaterThan(0.1);
        expect(alpha).toBeLessThan(0.25);
        expect(CAST_DUMMY[0] + CAST_DUMMY[1] + CAST_DUMMY[2]).toBe(0);
        expect(CAST_DUMMY[3]).toBe(FLOOR_PIECE);
    });

    it("makes the CPU copy at the first bake, at the map's size, and keeps it", () => {
        const { renderer } = setup();
        const cast = new CastTexture(renderer, 64, 32);
        const first = cast.pixels;
        expect(first.length).toBe(64 * 32 * 4);
        expect(cast.pixels).toBe(first);
    });

    it("uploads the whole buffer, unflipped, clamped and nearest, and counts the bytes", () => {
        const { renderer, texture } = setup();
        const cast = new CastTexture(renderer, 64, 32);
        expect(texture.update).not.toHaveBeenCalled();
        cast.upload();
        expect(texture.update).toHaveBeenCalledWith(cast.pixels, 64, 32, false, 33071, 33071, 9728, 9728, 6408);
        expect(cast.uploads).toBe(1);
        expect(cast.uploadedBytes).toBe(64 * 32 * 4);
    });

    it("frees the GPU texture and the CPU copy", () => {
        const { renderer, texture } = setup();
        const cast = new CastTexture(renderer, 8, 8);
        const buffer = cast.pixels;
        cast.destroy();
        expect(texture.destroy).toHaveBeenCalled();
        expect(cast.pixels).not.toBe(buffer);
    });
});
