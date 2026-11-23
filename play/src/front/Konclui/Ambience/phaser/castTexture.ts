import type * as Phaser from "phaser";
import { CAST_CHANNELS, CAST_DUMMY, newCastBuffer } from "../domain/shadeBake";

type GlTexture = Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper;

/** What the cast texture needs of the renderer. */
export interface CastRenderer {
    readonly gl: Pick<WebGLRenderingContext, "CLAMP_TO_EDGE" | "NEAREST" | "RGBA">;
    createUint8ArrayTexture(data: Uint8Array, width: number, height: number, pma?: boolean, flipY?: boolean): GlTexture;
}

/**
 * The cast texture (`kfx-cast`): the map's size, RGBA8, nearest, clamped, no mipmaps, not premultiplied (the channels hold
 * data, not colour) and not flipped (the bake writes its rows already flipped). Before the first bake it is one pixel,
 * `CAST_DUMMY` (0, 0, 0, 40): the alpha of a floor piece, so no prop takes relief from a normal map that still holds a rug,
 * and its zero channels shade nothing. The CPU copy is made
 * at the first bake, not before; the whole buffer goes up once when a bake finishes, never on a steady frame.
 */
export class CastTexture {
    private buffer: Uint8Array | undefined;
    private texture: GlTexture;
    /** How many whole-buffer uploads were made, and their bytes: for tests and the lab. */
    uploads = 0;
    uploadedBytes = 0;

    constructor(
        private readonly renderer: CastRenderer,
        readonly width: number,
        readonly height: number,
    ) {
        this.texture = renderer.createUint8ArrayTexture(new Uint8Array(CAST_DUMMY), 1, 1, false, false);
    }

    /** The CPU copy a bake writes into: made on the first call. */
    get pixels(): Uint8Array {
        this.buffer ??= newCastBuffer(this.width, this.height);
        return this.buffer;
    }

    get glTexture(): GlTexture {
        return this.texture;
    }

    /** Puts the whole buffer on the GPU (the pixels of a finished bake). */
    upload(): void {
        const gl = this.renderer.gl;
        const pixels = this.pixels;
        this.texture.update(
            pixels,
            this.width,
            this.height,
            false,
            gl.CLAMP_TO_EDGE,
            gl.CLAMP_TO_EDGE,
            gl.NEAREST,
            gl.NEAREST,
            gl.RGBA,
        );
        this.uploads += 1;
        this.uploadedBytes += this.width * this.height * CAST_CHANNELS;
    }

    destroy(): void {
        this.texture.destroy();
        this.buffer = undefined;
    }
}
