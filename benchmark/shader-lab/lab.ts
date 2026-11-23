/**
 * The page side of the shader lab: runs in Chrome, bundled by run.ts together with the runtime's real shader source.
 * It builds the colour frame the camera pass would receive, compiles the real programs on a bare WebGL context, sets
 * their uniforms for the hour, camera and people, draws the pass, reads the pixels and times the pass on the GPU.
 * Nothing here talks to Phaser: the lab measures the filter, the Phaser probe (plan S0) measures the scene around it.
 */
import { createGpuFrameTimer } from "../../play/src/front/Utils/GpuFrameTimer";
import type { Point, Size } from "./args";
import { buildCasts, channelCounts, ELEMENTS, missingBakeHooks, type BakeHooks, type CastSet } from "./castBake";
import { compositeStamps, planStamps, type StampHooks, type StampPlan } from "./stamps";
import {
    AVATAR_H,
    AVATAR_W,
    avatarCells,
    compileFailure,
    diffImage,
    diffStats,
    drawPeople,
    flipRows,
    forProbe,
    isSoftwareRenderer,
    luma,
    rimMode,
    summarizeTimes,
    viewRect,
    type DiffStats,
    type TimingStats,
} from "./model";
import { paintOrder, placementsOf, type Collection, type Placement, type Wam } from "./placements";
import {
    mapLights,
    postUniforms,
    shadeUniforms,
    type Lights,
    type ManifestSlice,
    type RuntimeHooks,
    type UniformRecord,
    type UniformValue,
} from "./uniforms";

import {
    castersHonoured,
    litTowardLamp,
    nearestLampSide,
    reliefAgreement,
    shiftedMismatch,
    SHIMMER_SLACK,
    visibleShadowCoverage,
    type CoveragePiece,
    type PoolLike,
} from "./acceptance";

type Gl = WebGLRenderingContext | WebGL2RenderingContext;

export interface Deps {
    /** Every export of domain/shaders.ts: POST always, POST_SHADED and forProbe once the runtime lane lands them. */
    readonly shaders: Readonly<Record<string, unknown>>;
    readonly hooks: RuntimeHooks & BakeHooks & StampHooks;
    /** Which optional runtime modules the bundle found. */
    readonly present: readonly string[];
}

export interface LabRequest {
    readonly base: string;
    readonly frameUrl: string | null;
    readonly hour: number;
    readonly camera: { x: number; y: number; zoom: number };
    readonly size: Size;
    readonly people: readonly Point[];
    readonly flags: Readonly<Record<string, string>>;
    readonly gl: 1 | 2;
    readonly timing: boolean;
    readonly timingDraws: number;
    readonly timingSize: Size;
    readonly onShader: string | null;
    readonly offShader: string | null;
    readonly clouds: boolean;
    readonly selfTest: boolean;
    /** People are drawn with no mark (alpha 255), as the avatars beyond the marks' cap are, and the first eight go into uCrowd. */
    readonly unmarked: boolean;
    /** Also render the shimmer check: four fractional scrolls at zoom 1 and 2, off and on. */
    readonly shimmer: boolean;
}

export interface LabResult {
    /** File name -> PNG as a base64 string. */
    readonly files: Record<string, string>;
    readonly json: Record<string, unknown>;
    readonly log: string[];
}

const VERTEX = `attribute vec2 aPos;
varying vec2 outTexCoord;
void main() { outTexCoord = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// The camera pass: the whole-map frame seen through the window, one nearest sample per screen pixel, as Phaser's camera
// framebuffer is. The frame is stored row-flipped (map row y in buffer row H-1-y), so `1.0 - v` undoes it.
const CAMERA = `precision highp float;
uniform sampler2D uFrame;
uniform vec4 uWorld;
uniform vec2 uMap;
uniform vec2 uRes;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // 0.002 px: a point on the edge of a map pixel (a scroll of half a pixel at zoom 1) is read from the same side every time, as the
  // shaded pass does for its own lookups, so the frame itself does not flip between two pictures
  vec2 w = floor(uWorld.xy + px / uRes * uWorld.zw + 0.002);
  if (w.x < 0.0 || w.y < 0.0 || w.x >= uMap.x || w.y >= uMap.y) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 uv = (w + 0.5) / uMap;
  gl_FragColor = texture2D(uFrame, vec2(uv.x, 1.0 - uv.y));
}
`;

// The orientation self-test: POST's own world and mapUV maths, writing the masks texture back as colour.
const MASKS_PROBE = `precision highp float;
uniform sampler2D uMasks;
uniform vec4 uWorld;
uniform vec2 uMap;
varying vec2 outTexCoord;
vec2 toWorld(vec2 uv) { return uWorld.xy + vec2(uv.x, 1.0 - uv.y) * uWorld.zw; }
vec2 mapUV(vec2 w, float scale) { vec2 uv = (floor(w * scale) + 0.5) / (uMap * scale); return vec2(uv.x, 1.0 - uv.y); }
void main() {
  vec2 w = floor(toWorld(outTexCoord)) + 0.5;
  gl_FragColor = vec4(texture2D(uMasks, mapUV(w, 1.0)).rgb, 1.0);
}
`;

const GL_TYPES = {
    FLOAT: 0x1406,
    FLOAT_VEC2: 0x8b50,
    FLOAT_VEC3: 0x8b51,
    FLOAT_VEC4: 0x8b52,
    INT: 0x1404,
    SAMPLER_2D: 0x8b5e,
} as const;

const SCRATCH_UNIT = 7;
/** The runtime's own `forProbe` when domain/shaders.ts exports one (plan 1d), else the lab's identical strip. */
let stripPragma: (source: string) => string = forProbe;
const SAMPLER_UNITS: Readonly<Record<string, number>> = { uMainSampler: 0, uMasks: 1, uNormals: 2, uCast: 3 };

interface UniformInfo {
    readonly name: string;
    readonly type: number;
    readonly size: number;
    readonly location: WebGLUniformLocation;
}

interface Program {
    readonly name: string;
    readonly program: WebGLProgram;
    readonly uniforms: Map<string, UniformInfo>;
    /** One vector per element of every declared uniform, unpacked: the number the plan and shaders.test.ts count. */
    readonly vectors: number;
    readonly log: string;
    readonly translatedLength: number | null;
    readonly length: number;
}

interface Target {
    readonly framebuffer: WebGLFramebuffer;
    readonly texture: WebGLTexture;
    readonly width: number;
    readonly height: number;
}

function toBase64(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}

async function pngOf(rgba: Uint8ClampedArray, width: number, height: number): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context for the PNG");
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png");
    });
    if (!blob) throw new Error("canvas.toBlob gave no PNG");
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** A WebGL context and the few objects the lab needs on it. */
class Engine {
    readonly gl: Gl;
    readonly version: 1 | 2;
    readonly renderer: string;
    private readonly quad: WebGLBuffer;
    private readonly textures = new Map<number, WebGLTexture>();

    constructor(version: 1 | 2) {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const gl = canvas.getContext(version === 2 ? "webgl2" : "webgl", {
            antialias: false,
            alpha: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            powerPreference: "high-performance",
        }) as Gl | null;
        if (!gl) throw new Error(`this browser gave no WebGL${version} context`);
        this.gl = gl;
        this.version = version;
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        this.renderer = info
            ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
            : String(gl.getParameter(gl.RENDERER));
        const quad = gl.createBuffer();
        if (!quad) throw new Error("no buffer");
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        this.quad = quad;
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
    }

    private compileShader(type: number, source: string, name: string): WebGLShader {
        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) throw new Error("no shader object");
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(compileFailure(name, "compile", gl.getShaderInfoLog(shader) ?? "(no log)", source));
        }
        return shader;
    }

    /** Compiles and links `fragment` with the lab's vertex shader; throws, with the driver's message, if it does not. */
    program(name: string, fragment: string): Program {
        const gl = this.gl;
        const source = stripPragma(fragment);
        const vertex = this.compileShader(gl.VERTEX_SHADER, VERTEX, `${name} vertex`);
        const shader = this.compileShader(gl.FRAGMENT_SHADER, source, name);
        const program = gl.createProgram();
        if (!program) throw new Error("no program object");
        gl.attachShader(program, vertex);
        gl.attachShader(program, shader);
        gl.bindAttribLocation(program, 0, "aPos");
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(compileFailure(name, "link", gl.getProgramInfoLog(program) ?? "(no log)", source));
        }
        const uniforms = new Map<string, UniformInfo>();
        let vectors = 0;
        const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
        for (let i = 0; i < count; i++) {
            const info = gl.getActiveUniform(program, i);
            const location = info && gl.getUniformLocation(program, info.name);
            if (!info || !location) continue;
            if (info.type !== GL_TYPES.SAMPLER_2D) vectors += info.size;
            uniforms.set(info.name, { name: info.name, type: info.type, size: info.size, location });
        }
        const debug = gl.getExtension("WEBGL_debug_shaders");
        const translated = debug ? debug.getTranslatedShaderSource(shader) : null;
        const log = [gl.getShaderInfoLog(shader), gl.getProgramInfoLog(program)].filter(Boolean).join("\n").trim();
        return {
            name,
            program,
            uniforms,
            vectors,
            log,
            translatedLength: translated === null ? null : translated.length,
            length: source.length,
        };
    }

    target(width: number, height: number): Target {
        const gl = this.gl;
        const texture = gl.createTexture();
        const framebuffer = gl.createFramebuffer();
        if (!texture || !framebuffer) throw new Error("no framebuffer");
        // a scratch unit: creating a target must not unbind what units 0 to 3 hold
        gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.sampling(gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`framebuffer ${width}x${height} is not complete`);
        }
        return { framebuffer, texture, width, height };
    }

    private sampling(filter: number): void {
        const gl = this.gl;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /** Fills a unit from a decoded image, an ImageBitmap made with imageOrientation "flipY" and premultiplyAlpha "none". */
    setBitmap(unit: number, bitmap: ImageBitmap): void {
        const gl = this.gl;
        this.unitTexture(unit);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    }

    /** Fills a unit from RGBA bytes whose first row is the map's LAST row (the plan's `kfx-cast` orientation). */
    setPixels(unit: number, rgbaFlipped: Uint8Array | Uint8ClampedArray, width: number, height: number): void {
        const gl = this.gl;
        this.unitTexture(unit);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            width,
            height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array(rgbaFlipped.buffer, rgbaFlipped.byteOffset, rgbaFlipped.byteLength),
        );
    }

    private unitTexture(unit: number): WebGLTexture {
        const gl = this.gl;
        let texture = this.textures.get(unit);
        if (!texture) {
            const created = gl.createTexture();
            if (!created) throw new Error("no texture");
            texture = created;
            this.textures.set(unit, texture);
        }
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        this.sampling(gl.NEAREST);
        return texture;
    }

    bindTarget(unit: number, target: Target): void {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
    }

    /** Sets every uniform of `program` that `values` names; returns the declared ones it does not name. */
    apply(program: Program, values: UniformRecord): string[] {
        const gl = this.gl;
        gl.useProgram(program.program);
        const unset: string[] = [];
        for (const [name, info] of program.uniforms) {
            if (info.type === GL_TYPES.SAMPLER_2D) {
                const base = name.replace(/\[0\]$/, "");
                const unit =
                    SAMPLER_UNITS[base] ?? (values[name] as number | undefined) ?? (values[base] as number | undefined);
                if (typeof unit !== "number") unset.push(name);
                else gl.uniform1i(info.location, unit);
                continue;
            }
            const value = values[name] ?? values[name.replace(/\[0\]$/, "")];
            if (value === undefined) {
                unset.push(name);
                continue;
            }
            this.setUniform(info, value);
        }
        return unset;
    }

    private setUniform(info: UniformInfo, value: UniformValue): void {
        const gl = this.gl;
        const data = typeof value === "number" ? [value] : value;
        const floats = data instanceof Float32Array ? data : new Float32Array(data);
        switch (info.type) {
            case GL_TYPES.FLOAT:
                gl.uniform1fv(info.location, floats.subarray(0, info.size));
                break;
            case GL_TYPES.FLOAT_VEC2:
                gl.uniform2fv(info.location, floats.subarray(0, info.size * 2));
                break;
            case GL_TYPES.FLOAT_VEC3:
                gl.uniform3fv(info.location, floats.subarray(0, info.size * 3));
                break;
            case GL_TYPES.FLOAT_VEC4:
                gl.uniform4fv(info.location, floats.subarray(0, info.size * 4));
                break;
            case GL_TYPES.INT:
                gl.uniform1iv(info.location, Int32Array.from(floats.subarray(0, info.size)));
                break;
            default:
                throw new Error(`uniform ${info.name} has a type the lab does not set (0x${info.type.toString(16)})`);
        }
    }

    /** One full-screen draw into `target`. */
    draw(program: Program, target: Target): void {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
        gl.useProgram(program.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    read(target: Target): Uint8Array {
        const gl = this.gl;
        const out = new Uint8Array(target.width * target.height * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
        return out;
    }

    /** The GL error code, 0 if none. */
    error(): number {
        return this.gl.getError();
    }

    maxFragmentVectors(): number {
        return this.gl.getParameter(this.gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Assets

interface Assets {
    readonly manifest: ManifestSlice & { readonly normal?: boolean; readonly rooms: unknown[] };
    readonly placements: Placement[];
    readonly lights: Lights;
    readonly mapW: number;
    readonly mapH: number;
    readonly masks: ImageBitmap;
    readonly maskPixels: Uint8ClampedArray;
    readonly normals: ImageBitmap | null;
    readonly frame: Uint8ClampedArray;
    readonly frameSource: string;
    readonly unknownPrefabs: number;
    /** 1 where a rug's own pixel is visible (not covered by another piece's picture). */
    readonly rugMask: Uint8Array;
    readonly rugPixels: number;
    /** 1 where the normal map holds a FLAT normal on a prop pixel (a slab's inside, a lamp): relief must leave it as it was. */
    readonly flatMask: Uint8Array;
    /** The normal map's RGBA, map-sized, row 0 on top (null when the build has none). */
    readonly normalData: Uint8ClampedArray | null;
    /** Every piece's decoded picture by key (null when unreadable): the bake's input. */
    readonly sprites: ReadonlyMap<string, ImageData | null>;
}

let cache: { key: string; assets: Assets } | null = null;

async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return (await response.json()) as T;
}

async function bitmapOf(url: string, flip: boolean): Promise<ImageBitmap> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return createImageBitmap(await response.blob(), {
        imageOrientation: flip ? "flipY" : "none",
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
    });
}

function pixelsOf(bitmap: ImageBitmap): Uint8ClampedArray {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no 2d context");
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

const RUG_TAG = "Tapetes e pisos";
const RUG_NAME = /(?<!\w)(tapete|carpete|capacho|rug|carpet)(?!\w)/i;

async function loadAssets(request: LabRequest): Promise<Assets> {
    const key = `${request.base}|${request.frameUrl}`;
    if (cache?.key === key) return cache.assets;
    const manifest = await getJson<Assets["manifest"]>(`${request.base}/fx/manifest.json`);
    const wam = await getJson<Wam>(`${request.base}/office.wam`);
    const collections: Collection[] = [];
    for (const entry of wam.entityCollections)
        collections.push(await getJson<Collection>(`${request.base}/${entry.url}`));
    const { placements, unknown } = placementsOf(wam, collections);
    const [mapW, mapH] = manifest.map;
    const masks = await bitmapOf(`${request.base}/fx/masks.png`, true);
    const maskSource = await bitmapOf(`${request.base}/fx/masks.png`, false);
    const maskPixels = pixelsOf(maskSource);
    const normals = manifest.normal ? await bitmapOf(`${request.base}/fx/normal.png`, true) : null;
    // The rugs' own pixels, for the stripes check: the opaque pixels of every rug picture, minus the pixels of any other
    // piece (a sofa or a table on the rug is not the rug, and may be shaded). Decoded once per picture.
    const rugMask = new Uint8Array(mapW * mapH);
    const decoded = new Map<string, ImageData | null>();
    const decode = async (key: string): Promise<ImageData | null> => {
        if (decoded.has(key)) return decoded.get(key) ?? null;
        let data: ImageData | null = null;
        try {
            const bitmap = await bitmapOf(`${request.base}/entities/${key}`, false);
            data = new ImageData(new Uint8ClampedArray(pixelsOf(bitmap)), bitmap.width, bitmap.height);
        } catch {
            data = null;
        }
        decoded.set(key, data);
        return data;
    };
    const isRug = (p: Placement): boolean => p.tags.includes(RUG_TAG) || RUG_NAME.test(p.name);
    const stamp = async (p: Placement, value: number): Promise<void> => {
        const picture = await decode(p.key);
        if (!picture) return;
        for (let y = 0; y < picture.height; y++) {
            const my = p.y + y;
            if (my < 0 || my >= mapH) continue;
            for (let x = 0; x < picture.width; x++) {
                const mx = p.x + x;
                if (mx >= 0 && mx < mapW && picture.data[(y * picture.width + x) * 4 + 3] >= 128)
                    rugMask[my * mapW + mx] = value;
            }
        }
    };
    for (const p of placements) if (isRug(p)) await stamp(p, 1);
    for (const p of placements) if (!isRug(p)) await stamp(p, 0);
    let rugPixels = 0;
    for (let i = 0; i < rugMask.length; i++) rugPixels += rugMask[i];
    const flatMask = new Uint8Array(mapW * mapH);
    let normalData: Uint8ClampedArray | null = null;
    if (manifest.normal) {
        const flat = pixelsOf(await bitmapOf(`${request.base}/fx/normal.png`, false));
        normalData = flat;
        for (let i = 0; i < flatMask.length; i++) {
            const n = i * 4;
            if (
                flat[n + 3] === 255 &&
                Math.abs(flat[n] - 128) <= 2 &&
                Math.abs(flat[n + 1] - 128) <= 2 &&
                flat[n + 2] >= 253
            )
                flatMask[i] = 1;
        }
    }
    let frame: Uint8ClampedArray;
    let frameSource: string;
    if (request.frameUrl !== null) {
        const picture = await bitmapOf(request.frameUrl, false);
        if (picture.width !== mapW || picture.height !== mapH) {
            throw new Error(`the colour frame is ${picture.width}x${picture.height}, the map ${mapW}x${mapH}`);
        }
        frame = new Uint8ClampedArray(pixelsOf(picture));
        for (let i = 3; i < frame.length; i += 4) frame[i] = 255;
        frameSource = request.frameUrl;
    } else {
        frame = await composeFrame(request.base, placements, maskPixels, mapW, mapH);
        frameSource = "composed from office.wam (flat floor, the pictures at their placements, no wall or tile art)";
    }
    const assets: Assets = {
        manifest,
        placements,
        lights: mapLights(manifest, placements),
        mapW,
        mapH,
        masks,
        maskPixels,
        normals,
        frame,
        frameSource,
        unknownPrefabs: unknown,
        rugMask,
        rugPixels,
        flatMask,
        normalData,
        sprites: decoded,
    };
    // one lab call runs at a time per page (run.ts awaits each), so no other call can have replaced `cache` meanwhile
    // eslint-disable-next-line require-atomic-updates
    cache = { key, assets };
    return assets;
}

/** Floor and lawn from the masks, then every piece's picture at its placement in painter's order. */
async function composeFrame(
    base: string,
    placements: readonly Placement[],
    masks: Uint8ClampedArray,
    w: number,
    h: number,
): Promise<Uint8ClampedArray> {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no 2d context");
    const flat = context.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const outside = masks[i * 4] > 191;
        const wall = Math.abs(masks[i * 4] / 255 - 0.376) < 0.1;
        const colour = outside ? [115, 188, 111] : wall ? [70, 78, 104] : [214, 216, 228];
        flat.data[i * 4] = colour[0];
        flat.data[i * 4 + 1] = colour[1];
        flat.data[i * 4 + 2] = colour[2];
        flat.data[i * 4 + 3] = 255;
    }
    context.putImageData(flat, 0, 0);
    context.imageSmoothingEnabled = false;
    const pictures = new Map<string, ImageBitmap>();
    for (const p of placements) {
        if (pictures.has(p.key)) continue;
        try {
            pictures.set(p.key, await bitmapOf(`${base}/entities/${p.key}`, false));
        } catch {
            // a missing picture is left out of the composition; the lab prints how many were composed
        }
    }
    const heights = new Map([...pictures].map(([key, bitmap]) => [key, bitmap.height]));
    for (const p of paintOrder(placements, heights)) {
        const picture = pictures.get(p.key);
        if (picture) context.drawImage(picture, p.x, p.y);
    }
    return new Uint8ClampedArray(context.getImageData(0, 0, w, h).data);
}

// ---------------------------------------------------------------------------------------------------------------
// One render

interface Variant {
    readonly id: string;
    readonly label: string;
    readonly program: Program;
    readonly values: UniformRecord;
    readonly marks: boolean;
    /** The people are in the frame (alpha 0 where marked) for this variant. */
    readonly people: boolean;
    /** The people's floor stamps are composited into the frame. */
    readonly stamps: boolean;
    /**
     * The cast texture the program reads: map-sized and row-flipped; null for the runtime's 1x1 dummy (before a first bake: no
     * shadow, no relief); "none" for one texel of zeros, a floor receiver that takes relief (relief alone, without any shadow).
     */
    readonly cast: Uint8Array | "none" | null;
}

/** The runtime's dummy (`CAST_DUMMY`, pinned by a test): one texel with no shadow and the alpha of a floor piece, so nothing is shaded and no prop takes relief. */
const DUMMY_CAST = new Uint8Array([0, 0, 0, 40]);
const NO_CAST = new Uint8Array([0, 0, 0, 0]);

function peopleAt(feet: readonly Point[], mx: number, my: number): boolean {
    const cells = peopleCells;
    for (const foot of feet) {
        const x = mx - (Math.round(foot.x) - 7);
        const y = my - (Math.round(foot.y) - AVATAR_H);
        if (x >= 0 && y >= 0 && x < AVATAR_W && y < AVATAR_H && cells[y * AVATAR_W + x] !== 0) return true;
    }
    return false;
}
const peopleCells = avatarCells();

/** What goes under the people: the stamps of the runtime's atlas and the hooks that place them. */
interface StampKit {
    readonly plan: StampPlan;
    readonly hooks: StampHooks;
}

/** Frame buffers in the row-flipped upload order, made on first use: the people in (marked or opaque), the stamps under. */
class FrameSet {
    private readonly made = new Map<string, Uint8ClampedArray>();

    constructor(
        private readonly assets: Assets,
        private readonly feet: readonly Point[],
        private readonly kit: StampKit | null,
    ) {}

    get(variant: Pick<Variant, "people" | "marks" | "stamps">): Uint8ClampedArray {
        const mode = variant.people ? (variant.marks ? "marked" : "plain") : "none";
        const stamps = variant.stamps && this.kit !== null;
        const key = `${mode}|${stamps}`;
        let frame = this.made.get(key);
        if (!frame) {
            const { mapW, mapH } = this.assets;
            const copy = new Uint8ClampedArray(this.assets.frame);
            if (stamps && this.kit) compositeStamps(copy, mapW, mapH, this.kit.plan, this.kit.hooks);
            if (mode !== "none") drawPeople(copy, mapW, mapH, this.feet, mode === "marked");
            frame = flipRows(copy, mapW, mapH, false);
            this.made.set(key, frame);
        }
        return frame;
    }
}

/** The textures every program reads besides the frame: masks, normals and the dummy cast, on units 1 to 3. */
function prepareEngine(engine: Engine, assets: Assets): void {
    engine.setBitmap(1, assets.masks);
    if (assets.normals) engine.setBitmap(2, assets.normals);
    engine.setPixels(3, DUMMY_CAST, 1, 1);
}

interface Extras {
    readonly extras: PlanExtras;
    readonly notes: string[];
    /** The bake's own report (times, counts, which stand pieces throw no shadow), or null when nothing was baked. */
    readonly bake: Record<string, unknown> | null;
}

/** The CPU work of the shaded program: the cast bake for the hour, and where each person's stamp goes. */
function buildExtras(deps: Deps, request: LabRequest, assets: Assets, size: Size, view: readonly number[]): Extras {
    const notes: string[] = [];
    const shadedProgram = request.onShader !== null || typeof deps.shaders.POST_SHADED === "string";
    if (!shadedProgram || rimMode(request.flags) === "legacy")
        return { extras: { casts: null, kit: null }, notes, bake: null };
    let casts: CastSet | null = null;
    let report: Record<string, unknown> | null = null;
    const missing = missingBakeHooks(deps.hooks);
    if (missing.length > 0) notes.push(`cast bake skipped: the tree lacks ${missing.join(", ")}`);
    else {
        try {
            casts = buildCasts(
                {
                    placements: assets.placements,
                    sprites: assets.sprites,
                    manifest: assets.manifest,
                    maskPixels: assets.maskPixels,
                },
                deps.hooks,
                request.hour,
            );
            report = casts.report;
        } catch (error: unknown) {
            notes.push(`cast bake failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const common = postUniforms({
        manifest: assets.manifest,
        lights: assets.lights,
        hour: request.hour,
        view: view as [number, number, number, number],
        resolution: [size.width, size.height],
        people: request.people,
        clouds: request.clouds,
        rim: 0,
        normalsOn: 0,
        hooks: deps.hooks,
    });
    let kit: StampKit | null = null;
    const key = casts?.key ?? (deps.hooks.newKeyLight ? deps.hooks.newKeyLight() : null);
    if (key && !casts && deps.hooks.keyLightAt) deps.hooks.keyLightAt(request.hour, key);
    if (key) {
        const stamp = planStamps(deps.hooks, request.people, common.lit, common.look.lamps, key);
        if (stamp) kit = { plan: stamp, hooks: deps.hooks };
    }
    return { extras: { casts, kit }, notes, bake: report };
}

interface Rendered {
    readonly pixels: Uint8ClampedArray;
    readonly alphaMin: number;
}

/** Puts a variant's frame and cast texture on their units. */
function bindInputs(engine: Engine, variant: Variant, frames: FrameSet, assets: Assets): void {
    engine.setPixels(0, frames.get(variant), assets.mapW, assets.mapH);
    if (variant.cast === "none") engine.setPixels(3, NO_CAST, 1, 1);
    else if (variant.cast) engine.setPixels(3, variant.cast, assets.mapW, assets.mapH);
    else engine.setPixels(3, DUMMY_CAST, 1, 1);
}

function renderVariant(
    engine: Engine,
    camera: Program,
    variant: Variant,
    frames: FrameSet,
    assets: Assets,
    size: Size,
    view: readonly number[],
): Rendered {
    bindInputs(engine, variant, frames, assets);
    return drawPass(engine, camera, variant, assets, size, view);
}

function drawPass(
    engine: Engine,
    camera: Program,
    variant: Variant,
    assets: Assets,
    size: Size,
    view: readonly number[],
): Rendered {
    const cam = engine.target(size.width, size.height);
    const out = engine.target(size.width, size.height);
    // unit 0 is the frame while the camera pass runs, then the camera's picture
    engine.apply(camera, {
        uWorld: [...view],
        uMap: [assets.mapW, assets.mapH],
        uRes: [size.width, size.height],
        uFrame: 0,
    });
    engine.draw(camera, cam);
    engine.bindTarget(0, cam);
    engine.apply(variant.program, variant.values);
    engine.draw(variant.program, out);
    const raw = engine.read(out);
    let alphaMin = 255;
    for (let i = 3; i < raw.length; i += 4) if (raw[i] < alphaMin) alphaMin = raw[i];
    return { pixels: flipRows(raw, size.width, size.height, true), alphaMin };
}

function sourceOf(deps: Deps, name: string): string {
    const value = deps.shaders[name];
    if (typeof value !== "string") throw new Error(`domain/shaders.ts does not export ${name} as a string`);
    return value;
}

interface Plan {
    readonly off: Variant;
    readonly on: Variant;
    readonly elements: Variant[];
    readonly skipped: { id: string; reason: string }[];
    readonly notes: string[];
    readonly shaded: boolean;
}

/** What the shaded program may be given beyond uniforms: the baked cast textures and the people's stamps. */
interface PlanExtras {
    readonly casts: CastSet | null;
    readonly kit: StampKit | null;
}

/** Which programs and uniforms make "off", "on" and each element alone, from what the tree offers (see the README). */
function plan(
    engine: Engine,
    deps: Deps,
    request: LabRequest,
    assets: Assets,
    size: Size,
    view: readonly number[],
    feet: readonly Point[],
    extras: PlanExtras = { casts: null, kit: null },
): Plan {
    const notes: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const mode = rimMode(request.flags);
    const offSource = request.offShader ?? sourceOf(deps, "POST");
    const shadedSource =
        request.onShader ?? (typeof deps.shaders.POST_SHADED === "string" ? deps.shaders.POST_SHADED : null);
    const shaded = shadedSource !== null && mode !== "legacy";
    const common = postUniforms({
        manifest: assets.manifest,
        lights: assets.lights,
        hour: request.hour,
        view: view as [number, number, number, number],
        resolution: [size.width, size.height],
        people: feet,
        clouds: request.clouds,
        rim: 0,
        normalsOn: assets.normals ? 1 : 0,
        hooks: deps.hooks,
    });
    notes.push(...common.notes);
    const offProgram = engine.program("POST (off)", offSource);
    const off: Variant = {
        id: "off",
        label: "off",
        program: offProgram,
        values: { ...common.values, uRimOn: 0, uPeopleN: 0 },
        marks: false,
        people: false,
        stamps: false,
        cast: null,
    };
    const normalsOn = assets.normals ? 1 : 0;
    if (!shaded) {
        // Today's tree: one program, the rim switch uRimOn, the normals switch uNormalsOn and the people count uPeopleN.
        const on: Variant = {
            id: "on",
            label: "on (legacy rim)",
            program: offProgram,
            values: { ...common.values, uRimOn: 1, uNormalsOn: normalsOn },
            marks: false,
            people: true,
            stamps: false,
            cast: null,
        };
        const elements: Variant[] = [
            { ...on, id: "bevel", label: "props' bevel only", values: { ...on.values, uPeopleN: 0 } },
            { ...on, id: "person-rim", label: "people's rim only", values: { ...on.values, uNormalsOn: 0 } },
        ];
        // The people are in the "off" picture too, so the diff shows the light and not the avatars themselves.
        return { off: { ...off, people: true }, on, elements, skipped, notes, shaded };
    }
    const level: 1 | 2 = mode === "reduced" ? 1 : 2;
    const program = engine.program("POST_SHADED", shadedSource);
    const shade = shadeUniforms(level, request.hour, common.look, deps.hooks);
    notes.push(
        `shade uniforms: ${shade.source}${shade.key ? ` (key direction ${shade.key.dirIndex}, length ${shade.key.length})` : ""}`,
        ...shade.notes,
    );
    // the avatars beyond the marks' cap: unmarked, and told to the shader by their feet (the runtime lists the 8 nearest)
    const crowd = new Array<number>(32).fill(0);
    if (request.unmarked) {
        feet.slice(0, 8).forEach((foot, k) => {
            crowd[k * 4] = Math.round(foot.x);
            crowd[k * 4 + 1] = Math.round(foot.y);
            crowd[k * 4 + 2] = 1;
        });
        notes.push(`unmarked people: drawn with alpha 255, the first ${Math.min(8, feet.length)} listed in uCrowd`);
    }
    const base: UniformRecord = { ...common.values, uNormalsOn: normalsOn, ...shade.values, "uCrowd[0]": crowd };
    const { casts, kit } = extras;
    if (!casts)
        notes.push("no cast texture: the runtime's shadeBake.ts or one of its inputs is missing, so no cast shadow");
    if (!kit) notes.push("no people stamps: the runtime's personShadow.ts is missing");
    const on: Variant = {
        id: "on",
        label: `on (shaded, level ${level}${casts ? ", baked cast" : ", no cast"}${kit ? ", stamps" : ""})`,
        program,
        values: base,
        marks: !request.unmarked,
        people: true,
        stamps: kit !== null,
        cast: casts?.all ?? null,
    };
    const alone = (
        id: string,
        label: string,
        mutate: (u: UniformRecord) => void,
        options: { cast?: Uint8Array | "none" | null; stamps?: boolean } = {},
    ): Variant => {
        const values: UniformRecord = { ...base, uShade: [...(base.uShade as number[])] };
        mutate(values);
        return {
            id,
            label,
            program,
            values,
            marks: !request.unmarked,
            people: true,
            stamps: options.stamps === true && kit !== null,
            cast: options.cast ?? null,
        };
    };
    const level0 = (u: UniformRecord): void => {
        u.uShade = [level, (base.uShade as number[])[1], (base.uShade as number[])[2], 0];
        u.uNormalsOn = 0;
    };
    const elements: Variant[] = [
        alone(
            "relief",
            "relief only (no cast, no key shadow, people lit by nothing)",
            (u) => {
                u.uShade = [level, 0, 0, 0];
            },
            { cast: "none" },
        ),
        alone("person-light", "person light only (uShade.w, no relief)", (u) => {
            u.uShade = [level, 0, 0, (base.uShade as number[])[3]];
            u.uNormalsOn = 0;
        }),
    ];
    if (casts) {
        // Each baked element alone: the receiver mask stays (it says where a shadow may land), relief and person light go
        for (const element of ELEMENTS) {
            elements.push(
                alone(element, `${element} shadow only (baked ${element}, no relief)`, level0, {
                    cast: casts.alone[element],
                }),
            );
        }
    } else {
        for (const element of ELEMENTS)
            skipped.push({ id: `el-${element}`, reason: "no cast texture (see the notes)" });
    }
    if (kit) {
        elements.push(
            alone(
                "person-shadow",
                "people's stamps only",
                (u) => {
                    u.uShade = [level, 0, 0, 0];
                    u.uNormalsOn = 0;
                },
                { stamps: true },
            ),
        );
    } else skipped.push({ id: "el-person-shadow", reason: "no people stamps (see the notes)" });
    return { off: { ...off, people: true }, on, elements, skipped, notes, shaded };
}

// ---------------------------------------------------------------------------------------------------------------
// Statistics

/** What the owner asked to see, as a number: where a lamp that has casters lights the view, its shadow is evident there. */
export const LAMP_SHADOW_MIN_SHARE = 0.01;
export const LAMP_SHADOW_MIN_DELTA = 50;

/**
 * The lamp-shadow acceptance of one view: with at least one caster lamp that has casters in or near the view, the lamp element
 * alone must change at least 1% of the window with a largest channel delta of 50 or more. `meets` is null when no such lamp is
 * there (a window of floor lamps with no furniture near them has nothing to cast a shadow from; that is not a failure).
 */
export function lampShadowAcceptance(
    lamp: Record<string, unknown> | undefined,
    bake: unknown,
    view: readonly number[],
    night = true,
): Record<string, unknown> {
    // a lamp counts when the spot its light lands on (under its source) is in the window: a window that holds only the rim of
    // a pool sees only a sliver of what the lamp does
    const lamps = ((bake as { lamps?: { under: number[]; casters: unknown[] }[] } | null)?.lamps ?? []).filter(
        (l) =>
            l.casters.length > 0 &&
            l.under[0] >= view[0] &&
            l.under[0] <= view[0] + view[2] &&
            l.under[1] >= view[1] &&
            l.under[1] <= view[1] + view[3],
    );
    const share = Number(lamp?.changedShare ?? 0);
    const maxDelta = Number(lamp?.maxDelta ?? 0);
    return {
        lampShadow: {
            casterLampsInView: lamps.length,
            changedShare: share,
            maxDelta,
            minShare: LAMP_SHADOW_MIN_SHARE,
            minDelta: LAMP_SHADOW_MIN_DELTA,
            // the lamps are on at night only: by day there is no light for a shadow to take away
            meets:
                lamps.length === 0 || !night
                    ? null
                    : share >= LAMP_SHADOW_MIN_SHARE && maxDelta >= LAMP_SHADOW_MIN_DELTA,
        },
    };
}

function regionCounts(
    off: Uint8ClampedArray,
    other: Uint8ClampedArray,
    size: Size,
    view: readonly number[],
    assets: Assets,
    feet: readonly Point[],
): Record<string, number> {
    const result = {
        rugChanged: 0,
        flatPropChanged: 0,
        wallWaterFacadeChanged: 0,
        personPixels: 0,
        changedOutsidePeople: 0,
        changedOnPeople: 0,
    };
    for (let sy = 0; sy < size.height; sy++) {
        for (let sx = 0; sx < size.width; sx++) {
            const p = sy * size.width + sx;
            const i = p * 4;
            const delta = Math.max(
                Math.abs(off[i] - other[i]),
                Math.abs(off[i + 1] - other[i + 1]),
                Math.abs(off[i + 2] - other[i + 2]),
            );
            const mx = Math.floor(view[0] + ((sx + 0.5) / size.width) * view[2]);
            const my = Math.floor(view[1] + ((sy + 0.5) / size.height) * view[3]);
            const person = peopleAt(feet, mx, my);
            if (person) result.personPixels += 1;
            if (delta <= 2) continue;
            if (person) result.changedOnPeople += 1;
            else result.changedOutsidePeople += 1;
            if (mx >= 0 && my >= 0 && mx < assets.mapW && my < assets.mapH) {
                const m = (my * assets.mapW + mx) * 4;
                const r = assets.maskPixels[m] / 255;
                const g = assets.maskPixels[m + 1] / 255;
                const b = assets.maskPixels[m + 2] / 255;
                if (Math.abs(r - 0.376) < 0.1 || Math.abs(g - 0.5) < 0.1 || Math.abs(b - 0.5) < 0.1)
                    result.wallWaterFacadeChanged += 1;
            }
            if (
                mx >= 0 &&
                my >= 0 &&
                mx < assets.mapW &&
                my < assets.mapH &&
                assets.rugMask[my * assets.mapW + mx] === 1
            ) {
                result.rugChanged += 1;
            }
            if (
                mx >= 0 &&
                my >= 0 &&
                mx < assets.mapW &&
                my < assets.mapH &&
                assets.flatMask[my * assets.mapW + mx] === 1 &&
                !person
            ) {
                result.flatPropChanged += 1;
            }
        }
    }
    return result;
}

/** Mean luma of the pixels of the people in a picture, 0..255; a measure of how lit they are. */
function personLuma(
    pixels: Uint8ClampedArray,
    size: Size,
    view: readonly number[],
    feet: readonly Point[],
): number | null {
    let sum = 0;
    let n = 0;
    for (let sy = 0; sy < size.height; sy++) {
        for (let sx = 0; sx < size.width; sx++) {
            const mx = Math.floor(view[0] + ((sx + 0.5) / size.width) * view[2]);
            const my = Math.floor(view[1] + ((sy + 0.5) / size.height) * view[3]);
            if (!peopleAt(feet, mx, my)) continue;
            sum += luma(pixels, sy * size.width + sx);
            n += 1;
        }
    }
    return n === 0 ? null : sum / n;
}

/**
 * For each person: how much brighter or darker the shaded picture is than the off one on the left half and on the right half
 * of their pixels (a ratio of mean luma), the side a lamp lighting them is on (the strongest pool covering their feet with at
 * least 0.15 of light, at night), and which side is lit more. The reviewers saw a person beside a lamp lit on the far side.
 */
export interface PersonSide {
    readonly x: number;
    readonly y: number;
    readonly ratioLeft: number | null;
    readonly ratioRight: number | null;
    readonly lamp: "left" | "right" | null;
    readonly litSide: "left" | "right" | "even" | null;
    /** The side of the nearest lamp within 100 px (its pool or the rim of it), and how far: null when none is that near. */
    readonly nearLamp: "left" | "right" | null;
    readonly nearLampPx: number | null;
    /** null when no lamp is near; else whether the person is lit on the side that faces it. */
    readonly litTowardLamp: boolean | null;
}

export function personSides(
    off: Uint8ClampedArray,
    on: Uint8ClampedArray,
    size: Size,
    view: readonly number[],
    feet: readonly Point[],
    pools: readonly {
        x: number;
        y: number;
        reach: number;
        squash: number;
        power: number;
        clip: readonly number[] | null;
    }[],
    night: number,
): PersonSide[] {
    return feet.map((foot) => {
        const fx = Math.round(foot.x);
        const fy = Math.round(foot.y);
        const sums = { left: [0, 0, 0], right: [0, 0, 0] };
        for (let sy = 0; sy < size.height; sy++) {
            for (let sx = 0; sx < size.width; sx++) {
                const mx = Math.floor(view[0] + ((sx + 0.5) / size.width) * view[2]);
                const my = Math.floor(view[1] + ((sy + 0.5) / size.height) * view[3]);
                const cx = mx - (fx - 7);
                const cy = my - (fy - AVATAR_H);
                if (cx < 0 || cy < 0 || cx >= AVATAR_W || cy >= AVATAR_H || peopleCells[cy * AVATAR_W + cx] === 0)
                    continue;
                const half = cx < AVATAR_W / 2 ? sums.left : sums.right;
                half[0] += luma(on, sy * size.width + sx);
                half[1] += luma(off, sy * size.width + sx);
                half[2] += 1;
            }
        }
        const ratio = (h: number[]): number | null => (h[2] === 0 || h[1] === 0 ? null : h[0] / h[1]);
        const left = ratio(sums.left);
        const right = ratio(sums.right);
        let best = 0;
        let lamp: "left" | "right" | null = null;
        if (night > 0.5) {
            for (const pool of pools) {
                if (
                    pool.clip &&
                    !(
                        fx >= pool.clip[0] &&
                        fy >= pool.clip[1] &&
                        fx < pool.clip[0] + pool.clip[2] &&
                        fy < pool.clip[1] + pool.clip[3]
                    )
                )
                    continue;
                const d = Math.hypot(fx - pool.x, (fy - pool.y) / pool.squash) / Math.abs(pool.reach);
                const f = d < 1 ? Math.abs(pool.power) * Math.pow(1 - d, 1.4) : 0;
                if (f > best) {
                    best = f;
                    lamp = pool.x < fx - 3 ? "left" : pool.x > fx + 3 ? "right" : null;
                }
            }
        }
        if (best < 0.15) lamp = null;
        const litSide =
            left === null || right === null
                ? null
                : Math.abs(left - right) < 0.04
                  ? "even"
                  : left > right
                    ? "left"
                    : "right";
        const near = night > 0.5 ? nearestLampSide(pools, fx, fy) : { side: null, distance: null };
        return {
            x: foot.x,
            y: foot.y,
            ratioLeft: left,
            ratioRight: right,
            lamp,
            litSide,
            nearLamp: near.side,
            nearLampPx: near.distance,
            litTowardLamp: litTowardLamp(near.side, litSide),
        };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Timing

interface TimingRow {
    readonly variant: string;
    readonly program: string;
    readonly samples: TimingStats | null;
    readonly dropped: number;
    readonly method: string | null;
    readonly roundMedians?: readonly number[];
    readonly note?: string;
}

/** A query's result becomes readable at a frame boundary, so the timing loop waits for animation frames, not tasks. */
async function nextFrame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

/** Timed draws issued per animation frame: the timer keeps 8 queries in flight, so 4 leaves room to resolve. */
const DRAWS_PER_FRAME = 4;
/** Interleaved rounds of `timingDraws` timed draws per variant. */
const TIMING_ROUNDS = 3;

async function timeVariants(
    request: LabRequest,
    deps: Deps,
    assets: Assets,
    version: 1 | 2,
    built: Extras,
): Promise<Record<string, unknown>> {
    const engine = new Engine(version);
    const software = isSoftwareRenderer(engine.renderer);
    const size = request.timingSize;
    // the same camera at the timing window's size: at zoom 2 a 1920x1080 window sees 960x540 map px, as the game does
    const view = viewRect(request.camera, size);
    const feet = request.people;
    const cameraProgram = engine.program("camera", CAMERA);
    prepareEngine(engine, assets);
    const p = plan(engine, deps, request, assets, size, view, feet, built.extras);
    const frames = new FrameSet(assets, feet, built.extras.kit);
    const rows: TimingRow[] = [];
    const created = createGpuFrameTimer(engine.gl, request.timingDraws + 64);
    if (created.unavailable !== undefined) {
        return {
            version,
            renderer: engine.renderer,
            software,
            gpuTimer: "unavailable",
            reason: created.unavailable,
            rows,
        };
    }
    created.timer.finish();
    // Rounds interleave the variants (off, on, off, on...) so a drift of the GPU's clock shows in the per-round medians.
    const collected = new Map<
        string,
        { samples: number[]; medians: number[]; dropped: number; method: string | null; note?: string }
    >();
    for (let round = 0; round < TIMING_ROUNDS; round++) {
        for (const variant of [p.off, p.on]) {
            const entry = collected.get(variant.id) ?? { samples: [], medians: [], dropped: 0, method: null };
            collected.set(variant.id, entry);
            bindInputs(engine, variant, frames, assets);
            const cam = engine.target(size.width, size.height);
            const out = engine.target(size.width, size.height);
            engine.apply(cameraProgram, {
                uWorld: [...view],
                uMap: [assets.mapW, assets.mapH],
                uRes: [size.width, size.height],
                uFrame: 0,
            });
            engine.draw(cameraProgram, cam);
            engine.bindTarget(0, cam);
            engine.apply(variant.program, variant.values);
            const samples: number[] = [];
            const timer = createGpuFrameTimer(engine.gl, 0, {
                sample: (ms) => samples.push(ms),
                dropped: () => undefined,
            });
            if (timer.unavailable !== undefined || !timer.timer) {
                entry.note = timer.unavailable;
                continue;
            }
            const gpu = timer.timer;
            for (let i = 0; i < 10; i++) {
                engine.draw(variant.program, out);
                await nextFrame();
            }
            let issued = 0;
            const limit = request.timingDraws * 6;
            while (samples.length < request.timingDraws && issued < limit) {
                for (let k = 0; k < DRAWS_PER_FRAME; k++) {
                    gpu.begin();
                    engine.draw(variant.program, out);
                    gpu.end();
                    issued += 1;
                }
                await nextFrame();
                gpu.poll();
            }
            for (let i = 0; i < 30 && gpu.pendingCount > 0; i++) {
                await nextFrame();
                gpu.poll();
            }
            const finished = gpu.finish();
            const kept = samples.slice(0, request.timingDraws);
            entry.samples.push(...kept);
            entry.dropped += finished.dropped;
            entry.method = gpu.method;
            const roundStats = summarizeTimes(kept);
            if (roundStats) entry.medians.push(roundStats.median);
        }
    }
    for (const variant of [p.off, p.on]) {
        const entry = collected.get(variant.id);
        rows.push({
            variant: variant.id,
            program: variant.program.name,
            samples: entry ? summarizeTimes(entry.samples) : null,
            roundMedians: entry?.medians ?? [],
            dropped: entry?.dropped ?? 0,
            method: entry?.method ?? null,
            note: entry?.note,
        });
    }
    const error = engine.error();
    return {
        version,
        renderer: engine.renderer,
        software,
        valid: !software,
        gpuTimer: rows.some((r) => r.samples !== null) ? "ok" : "unavailable",
        size: `${size.width}x${size.height}`,
        draws: request.timingDraws,
        rounds: TIMING_ROUNDS,
        glError: error,
        rows,
        programs: [p.off.program, p.on.program].map((q) => ({
            name: q.name,
            vectors: q.vectors,
            length: q.length,
            translatedLength: q.translatedLength,
        })),
        maxFragmentUniformVectors: engine.maxFragmentVectors(),
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Self-test

function selfTest(deps: Deps, assets: Assets): Record<string, unknown> {
    const engine = new Engine(1);
    const size = { width: 256, height: 160 };
    const out: Record<string, unknown> = {};
    // 1. texture orientation: POST's own mapUV over the masks, at the map's four corners, against the decoded PNG
    const probe = engine.program("masks probe", MASKS_PROBE);
    engine.setBitmap(1, assets.masks);
    const corners: [string, number, number][] = [
        ["top-left", 0, 0],
        ["top-right", assets.mapW - size.width, 0],
        ["bottom-left", 0, assets.mapH - size.height],
        ["bottom-right", assets.mapW - size.width, assets.mapH - size.height],
    ];
    const orientation: Record<string, number> = {};
    for (const [name, x0, y0] of corners) {
        const target = engine.target(size.width, size.height);
        engine.apply(probe, { uMasks: 1, uWorld: [x0, y0, size.width, size.height], uMap: [assets.mapW, assets.mapH] });
        engine.draw(probe, target);
        const picture = flipRows(engine.read(target), size.width, size.height, true);
        let mismatches = 0;
        for (let y = 0; y < size.height; y++) {
            for (let x = 0; x < size.width; x++) {
                const m = ((y0 + y) * assets.mapW + x0 + x) * 4;
                const i = (y * size.width + x) * 4;
                if (
                    Math.max(
                        Math.abs(picture[i] - assets.maskPixels[m]),
                        Math.abs(picture[i + 1] - assets.maskPixels[m + 1]),
                        Math.abs(picture[i + 2] - assets.maskPixels[m + 2]),
                    ) > 1
                )
                    mismatches += 1;
            }
        }
        orientation[name] = mismatches;
    }
    out.maskOrientationMismatches = orientation;
    // 2. the camera pass against a CPU nearest crop of the frame at a fractional scroll and zoom 2
    const cameraProgram = engine.program("camera", CAMERA);
    const view = viewRect({ x: 1391.37, y: 1330.81, zoom: 2 }, size);
    const frames = new FrameSet(assets, [], null);
    engine.setPixels(0, frames.get({ people: false, marks: false, stamps: false }), assets.mapW, assets.mapH);
    const cam = engine.target(size.width, size.height);
    engine.apply(cameraProgram, {
        uWorld: [...view],
        uMap: [assets.mapW, assets.mapH],
        uRes: [size.width, size.height],
        uFrame: 0,
    });
    engine.draw(cameraProgram, cam);
    const gpu = flipRows(engine.read(cam), size.width, size.height, true);
    let cameraMismatches = 0;
    for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width; x++) {
            const mx = Math.floor(view[0] + ((x + 0.5) / size.width) * view[2]);
            const my = Math.floor(view[1] + ((y + 0.5) / size.height) * view[3]);
            const f = (my * assets.mapW + mx) * 4;
            const i = (y * size.width + x) * 4;
            if (
                Math.abs(gpu[i] - assets.frame[f]) +
                    Math.abs(gpu[i + 1] - assets.frame[f + 1]) +
                    Math.abs(gpu[i + 2] - assets.frame[f + 2]) >
                2
            )
                cameraMismatches += 1;
        }
    }
    out.cameraMismatches = cameraMismatches;
    // 3. the legacy POST renders the same twice
    const request = selfRequest();
    const p = plan(engine, deps, request, assets, request.size, viewRect(request.camera, request.size), []);
    prepareEngine(engine, assets);
    const frames2 = new FrameSet(assets, [], null);
    const a = renderVariant(
        engine,
        cameraProgram,
        p.off,
        frames2,
        assets,
        request.size,
        viewRect(request.camera, request.size),
    );
    const b = renderVariant(
        engine,
        cameraProgram,
        p.off,
        frames2,
        assets,
        request.size,
        viewRect(request.camera, request.size),
    );
    out.legacyTwiceDiffers = diffStats(a.pixels, b.pixels, 0).changed;
    out.glError = engine.error();
    out.pass =
        Object.values(orientation).every((n) => n === 0) &&
        cameraMismatches === 0 &&
        out.legacyTwiceDiffers === 0 &&
        out.glError === 0;
    return out;
}

function selfRequest(): LabRequest {
    return {
        base: "",
        frameUrl: null,
        hour: 22,
        camera: { x: 1391, y: 1330, zoom: 2 },
        size: { width: 256, height: 160 },
        people: [],
        flags: {},
        gl: 1,
        timing: false,
        timingDraws: 1,
        timingSize: { width: 256, height: 160 },
        onShader: null,
        offShader: null,
        clouds: true,
        selfTest: false,
        unmarked: false,
        shimmer: false,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Entry

async function sheetOf(tiles: { label: string; pixels: Uint8ClampedArray }[], size: Size): Promise<string> {
    const columns = 2;
    const rows = Math.ceil(tiles.length / columns);
    const canvas = document.createElement("canvas");
    canvas.width = size.width * columns;
    canvas.height = size.height * rows;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    tiles.forEach((tile, index) => {
        const x = (index % columns) * size.width;
        const y = Math.floor(index / columns) * size.height;
        context.putImageData(new ImageData(new Uint8ClampedArray(tile.pixels), size.width, size.height), x, y);
        context.font = "14px monospace";
        context.fillStyle = "#000";
        context.fillRect(x, y, context.measureText(tile.label).width + 12, 20);
        context.fillStyle = "#fff";
        context.fillText(tile.label, x + 6, y + 15);
    });
    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png");
    });
    if (!blob) throw new Error("no PNG for the sheet");
    return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

function statsOf(a: Uint8ClampedArray, b: Uint8ClampedArray): DiffStats {
    return diffStats(a, b);
}

export async function runLab(deps: Deps, request: LabRequest): Promise<LabResult> {
    const log: string[] = [];
    const files: Record<string, string> = {};
    const assets = await loadAssets(request);
    log.push(`frame: ${assets.frameSource}`);
    if (assets.unknownPrefabs > 0)
        log.push(`${assets.unknownPrefabs} entities named a prefab no collection has: left out`);
    const engine = new Engine(request.gl);
    const unmasked = engine.renderer;
    const view = viewRect(request.camera, request.size);
    const feet = request.people;
    const cameraProgram = engine.program("camera", CAMERA);
    const built = buildExtras(deps, request, assets, request.size, view);
    log.push(...built.notes);
    prepareEngine(engine, assets);
    const p = plan(engine, deps, request, assets, request.size, view, feet, built.extras);
    log.push(...p.notes);
    const frames = new FrameSet(assets, feet, built.extras.kit);
    const unset: Record<string, string[]> = {};
    const offRender = renderVariant(engine, cameraProgram, p.off, frames, assets, request.size, view);
    unset.off = engine.apply(p.off.program, p.off.values);
    const onRender = renderVariant(engine, cameraProgram, p.on, frames, assets, request.size, view);
    unset.on = engine.apply(p.on.program, p.on.values);
    files["off.png"] = await pngOf(offRender.pixels, request.size.width, request.size.height);
    files["on.png"] = await pngOf(onRender.pixels, request.size.width, request.size.height);
    files["diff.png"] = await pngOf(
        diffImage(offRender.pixels, onRender.pixels),
        request.size.width,
        request.size.height,
    );
    const tiles = [
        { label: "off", pixels: offRender.pixels },
        { label: p.on.label, pixels: onRender.pixels },
        { label: "diff (red: changed)", pixels: diffImage(offRender.pixels, onRender.pixels) },
    ];
    const variants: Record<string, unknown> = {};
    const record = (id: string, label: string, render: Rendered, programName: string) => {
        const s = statsOf(offRender.pixels, render.pixels);
        const regions = regionCounts(offRender.pixels, render.pixels, request.size, view, assets, feet);
        variants[id] = {
            label,
            program: programName,
            changedShare: s.changedShare,
            changedPixels: s.changed,
            maxDelta: s.maxDelta,
            alphaMin: render.alphaMin,
            ...regions,
            personLuma: personLuma(render.pixels, request.size, view, feet),
        };
    };
    record("on", p.on.label, onRender, p.on.program.name);
    const elementPixels = new Map<string, Uint8ClampedArray>();
    for (const element of p.elements) {
        const render = renderVariant(engine, cameraProgram, element, frames, assets, request.size, view);
        elementPixels.set(element.id, render.pixels);
        files[`el-${element.id}.png`] = await pngOf(render.pixels, request.size.width, request.size.height);
        record(element.id, element.label, render, element.program.name);
        tiles.push({ label: `el-${element.id}: ${element.label}`, pixels: diffImage(offRender.pixels, render.pixels) });
    }
    files["sheet.png"] = await sheetOf(tiles, request.size);
    (variants.on as Record<string, unknown>).offPersonLuma = personLuma(offRender.pixels, request.size, view, feet);
    (variants.on as Record<string, unknown>).personSides = personSides(
        offRender.pixels,
        onRender.pixels,
        request.size,
        view,
        feet,
        assets.lights.pools,
        request.hour >= 20.5 || request.hour <= 5 ? 1 : 0,
    );
    const night = request.hour >= 20.5 || request.hour <= 5;
    // level 1 (reduced) has no lamp pull in the relief and no light on people: those two acceptances are for level 2
    const full = rimMode(request.flags) !== "reduced";
    const nightPools = assets.lights.pools.filter((l) => !l.night || night) as PoolLike[];
    const personSidesList = (variants.on as { personSides: ReturnType<typeof personSides> }).personSides;
    const nearChecked = personSidesList.filter((side) => side.litTowardLamp !== null);
    const extraAcceptance: Record<string, unknown> = {
        peopleLampSide: {
            checked: nearChecked.length,
            failures: nearChecked
                .filter((side) => side.litTowardLamp === false)
                .map((side) => ({ x: side.x, y: side.y, nearLamp: side.nearLamp, litSide: side.litSide })),
            // unmarked people are lit by nothing (the marks' cap: 20 at level 2): the check is for the ones that carry a mark
            meets:
                nearChecked.length === 0 || request.unmarked || !full
                    ? null
                    : nearChecked.every((side) => side.litTowardLamp === true),
        },
    };
    const reliefPixels = elementPixels.get("relief");
    if (reliefPixels && assets.normalData && request.hour !== undefined) {
        extraAcceptance.reliefLit = reliefAgreement({
            off: offRender.pixels,
            relief: reliefPixels,
            size: request.size,
            view,
            normals: assets.normalData,
            mapWidth: assets.mapW,
            mapHeight: assets.mapH,
            pools: night && full ? nightPools : [],
            isPerson: (mx, my) => peopleAt(feet, mx, my),
        });
    }
    const picturesOf = (ids: readonly string[]): Uint8ClampedArray[] =>
        ids.map((id) => elementPixels.get(id)).filter((pixels): pixels is Uint8ClampedArray => pixels !== undefined);
    const shadowPictures = picturesOf(["key", "lamp", "surface"]);
    if (shadowPictures.length > 0 && built.extras.casts) {
        const pieces: CoveragePiece[] = built.extras.casts.pieces.map((piece) => {
            const image = assets.sprites.get(piece.key) ?? null;
            return {
                key: piece.key,
                x: piece.x,
                y: piece.y,
                width: image?.width ?? 0,
                height: image?.height ?? 0,
                kind: piece.kind,
                solid: (px, py) =>
                    image !== null &&
                    px >= 0 &&
                    py >= 0 &&
                    px < image.width &&
                    py < image.height &&
                    image.data[(py * image.width + px) * 4 + 3] >= 200,
            };
        });
        extraAcceptance.shadowCoverage = visibleShadowCoverage({
            off: offRender.pixels,
            standElements: picturesOf(["key", "lamp"]),
            topElements: picturesOf(["key", "surface"]),
            size: request.size,
            view,
            pieces,
            isWall: (mx, my) =>
                mx >= 0 &&
                my >= 0 &&
                mx < assets.mapW &&
                my < assets.mapH &&
                Math.abs(assets.maskPixels[(my * assets.mapW + mx) * 4] / 255 - 0.376) < 0.1,
            reach: 36,
        });
    }
    const casterReport = (built.bake as { casters?: Parameters<typeof castersHonoured>[0] } | null)?.casters;
    const honoured = castersHonoured(casterReport);
    if (honoured) extraAcceptance.castersHonoured = honoured;
    if (request.unmarked) {
        const reliefVariant = variants.relief as { changedOnPeople?: number } | undefined;
        extraAcceptance.unmarkedPeopleTakeNoRelief = {
            listed: Math.min(8, feet.length),
            people: feet.length,
            reliefChangedOnPeople: reliefVariant?.changedOnPeople ?? null,
            // up to 8 are listed: beyond them an unmarked avatar still takes a prop's relief (the budget's 209 vectors)
            meets: feet.length > 8 ? null : (reliefVariant?.changedOnPeople ?? 0) === 0,
        };
    }
    const compile = [p.off.program, p.on.program, ...p.elements.map((e) => e.program)]
        .filter((q, i, all) => all.findIndex((r) => r.name === q.name) === i)
        .map((q) => ({
            name: q.name,
            status: "ok",
            log: q.log,
            vectors: q.vectors,
            sourceLength: q.length,
            translatedLength: q.translatedLength,
        }));
    const glErrors = engine.error();
    const json: Record<string, unknown> = {
        request: {
            hour: request.hour,
            camera: request.camera,
            size: request.size,
            people: feet,
            flags: request.flags,
            gl: request.gl,
            frame: assets.frameSource,
        },
        shaded: p.shaded,
        renderer: unmasked,
        software: isSoftwareRenderer(unmasked),
        view,
        variants,
        skippedElements: p.skipped,
        bake: built.bake,
        castChannels: built.extras.casts
            ? {
                  map: channelCounts(built.extras.casts.all, assets.mapW, assets.mapH),
                  view: channelCounts(built.extras.casts.all, assets.mapW, assets.mapH, view),
              }
            : null,
        acceptance: {
            ...lampShadowAcceptance(variants.lamp as Record<string, unknown> | undefined, built.bake, view, night),
            ...extraAcceptance,
        },
        stamps: built.extras.kit
            ? built.extras.kit.plan.stamps.map((s) => ({
                  x: s.x,
                  y: s.y,
                  direction: s.direction,
                  lengthClass: s.lengthClass,
                  alpha: s.alpha,
              }))
            : null,
        unsetUniforms: unset,
        compile,
        maxFragmentUniformVectors: engine.maxFragmentVectors(),
        glError: glErrors,
        lights: {
            pools: assets.lights.pools.length,
            emissive: assets.lights.emissive.length,
        },
        rugPixelsInMap: assets.rugPixels,
        optionalRuntimeModules: deps.present,
    };
    if (request.selfTest) json.selfTest = selfTest(deps, assets);
    if (request.shimmer) {
        // a camera one screen px to the right must give the picture one px to the left, at any fractional scroll: counted for the
        // pass as it is today (off) and for the shaded one (on); the shaded one may not swim more
        const at = (variant: Variant, camera: { x: number; y: number; zoom: number }): Uint8ClampedArray => {
            const moved = viewRect(camera, request.size);
            const shifted: Variant = { ...variant, values: { ...variant.values, uWorld: [...moved] } };
            return renderVariant(engine, cameraProgram, shifted, frames, assets, request.size, moved).pixels;
        };
        const slack = Math.ceil(SHIMMER_SLACK * request.size.width * request.size.height);
        const rows: { zoom: number; scroll: number; off: number; on: number }[] = [];
        for (const zoom of [1, 2]) {
            for (const scroll of [0, 0.25, 0.5, 0.75]) {
                const x = Math.round(request.camera.x) + scroll;
                const row = { zoom, scroll, off: 0, on: 0 };
                for (const variant of [p.off, p.on] as const) {
                    const base = at(variant, { x, y: request.camera.y, zoom });
                    const moved = at(variant, { x: x + 1 / zoom, y: request.camera.y, zoom });
                    row[variant === p.off ? "off" : "on"] = shiftedMismatch(base, moved, request.size);
                }
                rows.push(row);
            }
        }
        (json.acceptance as Record<string, unknown>).shimmer = {
            rows,
            slack,
            meets: rows.every((row) => row.on <= row.off + slack),
            note: "mismatching px between a picture and the same scene one screen px along; on may not exceed off by more than slack",
        };
    }
    if (request.timing) {
        const timing: Record<string, unknown> = {};
        for (const version of [1, 2] as const) {
            try {
                timing[`webgl${version}`] = await timeVariants(request, deps, assets, version, built);
            } catch (error: unknown) {
                timing[`webgl${version}`] = { error: error instanceof Error ? error.message : String(error) };
            }
        }
        json.timing = timing;
    }
    return { files, json, log };
}

export function install(deps: Deps): void {
    if (typeof deps.shaders.forProbe === "function") stripPragma = deps.shaders.forProbe as (source: string) => string;
    (window as unknown as { runLab: (request: LabRequest) => Promise<LabResult> }).runLab = (request) =>
        runLab(deps, request);
}
