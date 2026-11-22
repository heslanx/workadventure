import { describe, expect, it } from "vitest";
import {
    bytesPerPixel,
    describeTextureUpload,
    watchTextureUploads,
    type TextureUpload,
} from "../../../src/front/Utils/GlTextureUploads";

const TEXTURE_2D = 0x0de1;
const RGBA = 0x1908;
const RGB = 0x1907;
const UNSIGNED_BYTE = 0x1401;
const FLOAT = 0x1406;
const UNSIGNED_SHORT_5_6_5 = 0x8363;

describe("describeTextureUpload", () => {
    it("sizes an explicit RGBA8 texImage2D as width x height x 4", () => {
        const upload = describeTextureUpload("texImage2D", [
            TEXTURE_2D,
            0,
            RGBA,
            100,
            50,
            0,
            RGBA,
            UNSIGNED_BYTE,
            new Uint8Array(0),
        ]);

        expect(upload).toEqual({ kind: "texImage2D", width: 100, height: 50, bytes: 20_000, cpuData: true });
    });

    it("sizes the full-map canvas upload Phaser makes (6 arguments, a canvas) as the 19.7 MB the mandate names", () => {
        // 2752 x 1792 x 4 bytes, worked by hand: 4,931,584 pixels
        const canvas = { width: 2752, height: 1792 };

        const upload = describeTextureUpload("texImage2D", [TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, canvas]);

        expect(upload?.bytes).toBe(19_726_336);
    });

    it("reads the size of an image or a video before the generic width and height", () => {
        const image = { naturalWidth: 32, naturalHeight: 16, width: 999, height: 999 };
        const video = { videoWidth: 8, videoHeight: 4, width: 999, height: 999 };

        expect(describeTextureUpload("texImage2D", [TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, image])?.bytes).toBe(
            32 * 16 * 4,
        );
        expect(describeTextureUpload("texImage2D", [TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, video])?.bytes).toBe(
            8 * 4 * 4,
        );
    });

    it("sizes texSubImage2D in both of its shapes by the sub-rectangle, not by the texture", () => {
        const explicit = describeTextureUpload("texSubImage2D", [
            TEXTURE_2D,
            0,
            10,
            20,
            64,
            32,
            RGBA,
            UNSIGNED_BYTE,
            new Uint8Array(0),
        ]);
        const fromSource = describeTextureUpload("texSubImage2D", [
            TEXTURE_2D,
            0,
            10,
            20,
            RGBA,
            UNSIGNED_BYTE,
            { width: 16, height: 16 },
        ]);

        expect(explicit).toEqual({
            kind: "texSubImage2D",
            width: 64,
            height: 32,
            bytes: 64 * 32 * 4,
            cpuData: true,
        });
        expect(fromSource?.bytes).toBe(16 * 16 * 4);
    });

    it("accepts the WebGL2 shape with a source offset (10 arguments)", () => {
        const upload = describeTextureUpload("texImage2D", [
            TEXTURE_2D,
            0,
            RGBA,
            10,
            10,
            0,
            RGBA,
            UNSIGNED_BYTE,
            new Uint8Array(0),
            0,
        ]);

        expect(upload?.bytes).toBe(400);
    });

    it("marks texImage2D with null data, or a buffer offset, as an allocation: no CPU data moves", () => {
        // Phaser's WebGLTextureWrapper creates a render target with texImage2D(..., null)
        const sizes = [TEXTURE_2D, 0, RGBA, 2752, 1792, 0, RGBA, UNSIGNED_BYTE];

        expect(describeTextureUpload("texImage2D", [...sizes, null])).toMatchObject({
            cpuData: false,
            bytes: 19_726_336,
        });
        expect(describeTextureUpload("texImage2D", [...sizes, undefined])?.cpuData).toBe(false);
        // A pixel unpack buffer offset: the data is already on the GPU
        expect(describeTextureUpload("texImage2D", [...sizes, 0])?.cpuData).toBe(false);
        expect(describeTextureUpload("texImage2D", [...sizes, new Uint8Array(0)])?.cpuData).toBe(true);
        // A canvas, an image or a video is always CPU data
        expect(
            describeTextureUpload("texImage2D", [TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, { width: 4, height: 4 }])
                ?.cpuData,
        ).toBe(true);
    });

    it("gives nothing for a source that has no size or a call shape the specification does not have", () => {
        expect(describeTextureUpload("texImage2D", [TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, {}])).toBeUndefined();
        expect(describeTextureUpload("texImage2D", [TEXTURE_2D, 0, RGBA])).toBeUndefined();
    });
});

describe("bytesPerPixel", () => {
    it.each([
        ["RGB8", RGB, UNSIGNED_BYTE, 3],
        ["RGBA32F", RGBA, FLOAT, 16],
        ["a packed 5-6-5 pixel, whatever the format", RGB, UNSIGNED_SHORT_5_6_5, 2],
        ["a format it does not know, counted as RGBA8", 0x1234, UNSIGNED_BYTE, 4],
    ])("%s", (_name, format, type, expected) => {
        expect(bytesPerPixel(format, type)).toBe(expected);
    });
});

/** A stand-in context whose upload methods live on the prototype, as in a browser. */
function fakeGl() {
    const calls: { name: string; self: unknown; args: unknown[] }[] = [];
    class Gl {
        texImage2D(...args: unknown[]) {
            calls.push({ name: "texImage2D", self: this, args });
            return "image-result";
        }
        texSubImage2D(...args: unknown[]) {
            calls.push({ name: "texSubImage2D", self: this, args });
        }
    }
    return { gl: new Gl(), calls, prototype: Gl.prototype };
}

const IMAGE_ARGS = [TEXTURE_2D, 0, RGBA, 4, 4, 0, RGBA, UNSIGNED_BYTE, null];

describe("watchTextureUploads", () => {
    it("reports every upload with its size, calls the original with the same receiver and arguments and returns its result", () => {
        const { gl, calls } = fakeGl();
        const seen: TextureUpload[] = [];
        const stop = watchTextureUploads(gl, (upload) => seen.push(upload));

        const result = gl.texImage2D(...IMAGE_ARGS);
        gl.texSubImage2D(TEXTURE_2D, 0, 0, 0, 2, 2, RGBA, UNSIGNED_BYTE, null);
        stop();

        expect(result).toBe("image-result");
        expect(calls.map((call) => [call.name, call.self === gl])).toEqual([
            ["texImage2D", true],
            ["texSubImage2D", true],
        ]);
        expect(calls[0].args).toEqual(IMAGE_ARGS);
        expect(seen.map((upload) => [upload.kind, upload.bytes])).toEqual([
            ["texImage2D", 64],
            ["texSubImage2D", 16],
        ]);
    });

    it("puts the prototype methods back when it stops, leaving no own property, and counts nothing after", () => {
        const { gl, prototype } = fakeGl();
        const seen: TextureUpload[] = [];
        const stop = watchTextureUploads(gl, (upload) => seen.push(upload));
        expect(Object.hasOwn(gl, "texImage2D")).toBe(true);

        stop();
        gl.texImage2D(...IMAGE_ARGS);

        expect(Object.hasOwn(gl, "texImage2D")).toBe(false);
        expect(Object.hasOwn(gl, "texSubImage2D")).toBe(false);
        expect(Object.getPrototypeOf(gl)).toBe(prototype);
        expect(seen).toEqual([]);
    });

    it("puts back an own method it replaced", () => {
        const own = () => "own";
        const gl = { texImage2D: own, texSubImage2D: () => undefined };
        const stop = watchTextureUploads(gl, () => undefined);

        stop();

        expect(gl.texImage2D).toBe(own);
    });

    it("does not count an upload that throws", () => {
        const gl = {
            texImage2D: () => {
                throw new Error("INVALID_VALUE");
            },
            texSubImage2D: () => undefined,
        };
        const seen: TextureUpload[] = [];
        const stop = watchTextureUploads(gl, (upload) => seen.push(upload));

        expect(() => gl.texImage2D()).toThrow("INVALID_VALUE");
        stop();

        expect(seen).toEqual([]);
    });

    it("refuses to watch a context twice, and allows it again after the first watch stopped", () => {
        const { gl } = fakeGl();
        const stop = watchTextureUploads(gl, () => undefined);

        expect(() => watchTextureUploads(gl, () => undefined)).toThrow("already being counted");
        stop();
        expect(() => watchTextureUploads(gl, () => undefined)()).not.toThrow();
    });

    it("leaves a method someone else replaced meanwhile as it is", () => {
        const { gl } = fakeGl();
        const stop = watchTextureUploads(gl, () => undefined);
        const theirs = () => "theirs";
        Object.defineProperty(gl, "texImage2D", { value: theirs, configurable: true, writable: true });

        stop();

        expect(Object.getOwnPropertyDescriptor(gl, "texImage2D")?.value).toBe(theirs);
    });
});
