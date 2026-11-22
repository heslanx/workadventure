/**
 * Counts the bytes the CPU sends to the GPU through texImage2D and texSubImage2D, for the e2eHooks frame bench. The two
 * methods of one context are wrapped while a watch is on and put back when it stops: nothing is patched otherwise.
 *
 * Phaser reads `renderer.gl` at each call (WebGLTextureWrapper), so an own property on that object is seen by every
 * upload of the game. The size is computed from the arguments: width x height x bytes per pixel of the format and
 * type. That is the size of the data handed over, not of what the driver stores (it may convert or pad). Phaser 4
 * uses texImage2D only; texSubImage2D is wrapped because the Koncluí mirror may move to dirty sub-rectangles.
 */

export interface TextureUpload {
    kind: "texImage2D" | "texSubImage2D";
    width: number;
    height: number;
    /** Width x height x bytes per pixel: the data handed over, or the storage allocated when `cpuData` is false. */
    bytes: number;
    /**
     * Whether the call hands the GPU pixels from the CPU (an image, a canvas, a typed array). False for an allocation:
     * texImage2D with null data, which Phaser calls to create a render target (WebGLTextureWrapper.js), or with a
     * buffer offset (a pixel unpack buffer, already on the GPU). Those move no CPU data and are counted apart.
     */
    cpuData: boolean;
}

// Component counts per pixel by pixel format, from the WebGL 1 and 2 specifications
const CHANNELS = new Map<number, number>([
    [0x1906, 1], // ALPHA
    [0x1907, 3], // RGB
    [0x1908, 4], // RGBA
    [0x1909, 1], // LUMINANCE
    [0x190a, 2], // LUMINANCE_ALPHA
    [0x1903, 1], // RED
    [0x8227, 2], // RG
    [0x1902, 1], // DEPTH_COMPONENT
    [0x8d94, 1], // RED_INTEGER
    [0x8228, 2], // RG_INTEGER
    [0x8d98, 3], // RGB_INTEGER
    [0x8d99, 4], // RGBA_INTEGER
]);

// Bytes per component by pixel type
const BYTES_PER_COMPONENT = new Map<number, number>([
    [0x1400, 1], // BYTE
    [0x1401, 1], // UNSIGNED_BYTE
    [0x1402, 2], // SHORT
    [0x1403, 2], // UNSIGNED_SHORT
    [0x140b, 2], // HALF_FLOAT
    [0x8d61, 2], // HALF_FLOAT_OES
    [0x1404, 4], // INT
    [0x1405, 4], // UNSIGNED_INT
    [0x1406, 4], // FLOAT
]);

// Bytes per pixel for the packed types, whatever the format
const BYTES_PER_PACKED_PIXEL = new Map<number, number>([
    [0x8033, 2], // UNSIGNED_SHORT_4_4_4_4
    [0x8034, 2], // UNSIGNED_SHORT_5_5_5_1
    [0x8363, 2], // UNSIGNED_SHORT_5_6_5
    [0x8368, 4], // UNSIGNED_INT_2_10_10_10_REV
    [0x8c3b, 4], // UNSIGNED_INT_10F_11F_11F_REV
    [0x8c3e, 4], // UNSIGNED_INT_5_9_9_9_REV
    [0x84fa, 4], // UNSIGNED_INT_24_8
    [0x8dad, 8], // FLOAT_32_UNSIGNED_INT_24_8_REV
]);

const RGBA8_BYTES_PER_PIXEL = 4;

/** Bytes of one pixel. A format or type this table does not know counts as RGBA8, the format of every Phaser texture. */
export function bytesPerPixel(format: unknown, type: unknown): number {
    if (typeof type === "number") {
        const packed = BYTES_PER_PACKED_PIXEL.get(type);
        if (packed !== undefined) {
            return packed;
        }
    }
    const channels = typeof format === "number" ? CHANNELS.get(format) : undefined;
    const component = typeof type === "number" ? BYTES_PER_COMPONENT.get(type) : undefined;
    return channels !== undefined && component !== undefined ? channels * component : RGBA8_BYTES_PER_PIXEL;
}

function numberProperty(source: unknown, name: string): number | undefined {
    if (typeof source !== "object" || source === null) {
        return undefined;
    }
    const value = (source as Record<string, unknown>)[name];
    return typeof value === "number" && value > 0 ? value : undefined;
}

/** The size of a TexImageSource: a video, an image, a VideoFrame, then a canvas, ImageBitmap or ImageData. */
function sourceSize(source: unknown): { width: number; height: number } | undefined {
    for (const [width, height] of [
        ["videoWidth", "videoHeight"],
        ["naturalWidth", "naturalHeight"],
        ["displayWidth", "displayHeight"],
        ["width", "height"],
    ]) {
        const w = numberProperty(source, width);
        const h = numberProperty(source, height);
        if (w !== undefined && h !== undefined) {
            return { width: w, height: h };
        }
    }
    return undefined;
}

/**
 * What one call uploads, from its arguments. The two methods have a fixed set of shapes in WebGL 1 and 2: explicit
 * sizes (9 arguments, 10 with a source offset) or a TexImageSource (6 for texImage2D, 7 for texSubImage2D). Undefined
 * for any other call, which the specification does not allow and which therefore never reaches a real context.
 */
export function describeTextureUpload(
    kind: TextureUpload["kind"],
    args: readonly unknown[],
): TextureUpload | undefined {
    const image = kind === "texImage2D";
    const withSource = image ? args.length === 6 : args.length === 7;
    let width: unknown;
    let height: unknown;
    let format: unknown;
    let type: unknown;
    let cpuData = true;
    if (withSource) {
        const size = sourceSize(args[args.length - 1]);
        width = size?.width;
        height = size?.height;
        format = image ? args[3] : args[4];
        type = image ? args[4] : args[5];
    } else if (args.length === 9 || args.length === 10) {
        width = image ? args[3] : args[4];
        height = image ? args[4] : args[5];
        format = args[6];
        type = args[7];
        cpuData = args[8] !== null && args[8] !== undefined && typeof args[8] !== "number";
    } else {
        return undefined;
    }
    if (typeof width !== "number" || typeof height !== "number") {
        return undefined;
    }
    return { kind, width, height, bytes: width * height * bytesPerPixel(format, type), cpuData };
}

const UPLOAD_METHODS = ["texImage2D", "texSubImage2D"] as const;

type UploadMethod = (this: unknown, ...args: unknown[]) => unknown;

// A context watched twice would be wrapped twice and each upload counted twice
const watched = new WeakSet<object>();

/**
 * Calls `onUpload` for every texImage2D and texSubImage2D on `gl` until the returned function is called, which puts
 * the methods back. `onUpload` runs after the upload returned, so a call that throws is not counted. If someone else
 * replaced a method meanwhile, that method is left as it is: it is theirs now.
 */
export function watchTextureUploads(gl: object, onUpload: (upload: TextureUpload) => void): () => void {
    if (watched.has(gl)) {
        throw new Error("Texture uploads on this context are already being counted: stop that watch first.");
    }
    const context = gl as Record<string, unknown>;
    const restore: (() => void)[] = [];
    for (const kind of UPLOAD_METHODS) {
        const original = context[kind];
        if (typeof original !== "function") {
            continue;
        }
        const own = Object.getOwnPropertyDescriptor(context, kind);
        const wrapper: UploadMethod = function (this: unknown, ...args: unknown[]) {
            const result = (original as UploadMethod).apply(this, args);
            const upload = describeTextureUpload(kind, args);
            if (upload) {
                onUpload(upload);
            }
            return result;
        };
        Object.defineProperty(context, kind, { value: wrapper, configurable: true, writable: true });
        restore.push(() => {
            if (context[kind] !== wrapper) {
                return;
            }
            if (own) {
                Object.defineProperty(context, kind, own);
            } else {
                delete context[kind];
            }
        });
    }
    watched.add(gl);
    return () => {
        for (const undo of restore) {
            undo();
        }
        watched.delete(gl);
    };
}
