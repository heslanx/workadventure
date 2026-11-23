import * as Phaser from "phaser";
import { POST, POST_SHADED } from "../domain/shaders";

const POST_NODE = "KfxPost";
/** The camera pass with the shading (konclui.fx.rim): registered only for a room that asks for it. */
export const SHADED_POST_NODE = "KfxPostShaded";

/**
 * Whether the camera pass sits on the camera's external filter list, where Phaser 4.2.1 draws the last filter straight
 * to the canvas (no pooled framebuffer and no closing full-screen blit) while the camera fills the canvas. Off until
 * Gate 1 measures it on a real run (docs/PERFORMANCE.md): the estimate is 0.05 to 0.2 ms on an M1 Max, unmeasured.
 * `localStorage["konclui.fx.external"] = "1"` turns it on, "0" off; read once, when the effects are built. A storage
 * that cannot be read leaves the constant in charge.
 */
export const EXTERNAL_POST_FILTER_ENABLED = false;
export const EXTERNAL_POST_FILTER_STORAGE_KEY = "konclui.fx.external";

let warnedBlockedStorage = false;

/** Lets a test see the blocked-storage warning again: it is said once per page load. */
export function resetExternalPostFilterStorageWarningForTests(): void {
    warnedBlockedStorage = false;
}

/** Whether the camera pass goes on the external list: the constant, unless this browser's storage says "1" or "0". */
export function isExternalPostFilterEnabled(storage: Pick<Storage, "getItem"> | undefined = globalStorage()): boolean {
    try {
        const value = storage?.getItem(EXTERNAL_POST_FILTER_STORAGE_KEY);
        if (value === "1") return true;
        if (value === "0") return false;
    } catch (error: unknown) {
        if (!warnedBlockedStorage) {
            warnedBlockedStorage = true;
            console.warn("The storage is blocked, so the external post filter flag keeps its default", error);
        }
    }
    return EXTERNAL_POST_FILTER_ENABLED;
}

function globalStorage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

/** A uniform value as Phaser's program manager takes it. */
export type UniformValue = number | number[] | readonly number[] | Float32Array;

/** What the camera pass reads on each draw: its uniforms, the masks texture, and optional 2.5D normals texture. */
export interface PostSource {
    postUniforms(): Record<string, UniformValue>;
    masksTexture(): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null;
    normalsTexture?(): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null;
    /** The cast texture the shaded pass reads (unit 3): the shadows baked from the map's pieces. */
    castTexture?(): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null;
}

// Phaser builds a filter's render node itself from the controller's node name; the node finds what to draw here.
const sources = new WeakMap<Phaser.Filters.Controller, PostSource>();

/** The node name and the fragment source of the camera pass: the legacy program, or with `shaded` the one with the shading. */
export function postProgram(shaded: boolean): { readonly node: string; readonly source: string } {
    return shaded ? { node: SHADED_POST_NODE, source: POST_SHADED } : { node: POST_NODE, source: POST };
}

function registerPostNode(renderer: Phaser.Renderer.WebGL.WebGLRenderer, shaded: boolean): string {
    const { node: name, source } = postProgram(shaded);
    const nodes = renderer.renderNodes;
    if (nodes.hasNode(name)) return name;
    class PostNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
        constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
            super(name, manager, undefined, source);
        }

        override setupTextures(
            controller: Phaser.Filters.Controller,
            textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[],
        ): void {
            const source = sources.get(controller);
            const masks = source?.masksTexture();
            if (masks) textures[1] = masks;
            const normals = source?.normalsTexture?.() ?? masks;
            if (normals) textures[2] = normals;
            // unit 3 is the cast texture: the program that reads it is the only one that has the sampler
            if (shaded) {
                const cast = source?.castTexture?.();
                if (cast) textures[3] = cast;
            }
        }

        override setupUniforms(controller: Phaser.Filters.Controller): void {
            const source = sources.get(controller);
            if (!source) return;
            const programs = this.programManager;
            programs.setUniform("uMasks", 1);
            programs.setUniform("uNormals", 2);
            if (shaded) programs.setUniform("uCast", 3);
            // for...in, not Object.entries: this runs on every draw and the pairs are garbage
            const uniforms = source.postUniforms();
            for (const name in uniforms) programs.setUniform(name, uniforms[name]);
        }
    }
    nodes.addNodeConstructor(name, PostNode);
    return name;
}

/** Which of the camera's two filter lists holds the pass. */
export type PostFilterList = "internal" | "external";

/** The camera pass and where it sits. */
export interface PostFilter {
    readonly controller: Phaser.Filters.Controller;
    /** The list the pass is on now. */
    readonly list: PostFilterList;
    /** Before each draw: with the external list asked for, puts the pass where the camera's geometry allows. */
    place(): void;
    /** Takes the pass off its list and destroys it. */
    remove(): void;
}

/**
 * Whether Phaser would draw an external filter straight to the canvas AND hand it the same picture the internal list
 * does. The camera node (renderNodes/Camera.js) renders the camera into a framebuffer of the camera's size, with its
 * scroll and zoom already applied (those are in `camera.matrix`, which both lists see). It then copies that picture to a
 * canvas-sized context before an external filter whenever the camera is not at the canvas origin (`matrixExternal` is
 * the camera's x and y) or its size is not the canvas's: the filter would then read a canvas-sized texture with the
 * camera's picture pasted in, so `outTexCoord` would no longer be the camera's own, and the copy is the very blit the
 * move is meant to save. A camera alpha below 1 also keeps the last filter off the canvas. In all of these the pass
 * stays on the internal list, whose picture is the camera's own.
 *
 * What this does NOT establish: that the pixels are the same. Where the camera fills the canvas both lists hand the
 * shader the same texture (read from Phaser 4.2.1's Camera.js, not run). But the direct draw skips the closing blit,
 * with its `alphaStrategy` and tint, and blends the shader's output onto the canvas itself; where the shader writes
 * alpha below 1 (it writes `vec4(0.0)` on some paths) that can differ from the internal list. Only a pixel comparison
 * of the day, dusk and night frames, one of them over a translucent or transparent canvas if the app can make one,
 * settles it (docs/PERFORMANCE.md, Gate 1).
 */
function cameraFillsCanvas(
    renderer: Phaser.Renderer.WebGL.WebGLRenderer,
    camera: Phaser.Cameras.Scene2D.Camera,
): boolean {
    return (
        camera.x === 0 &&
        camera.y === 0 &&
        camera.alpha === 1 &&
        Math.round(camera.width) === renderer.width &&
        Math.round(camera.height) === renderer.height
    );
}

/**
 * The camera pass of the effects: a filter on one of the camera's lists, off until `active` is set. The internal list
 * is today's path. With `external` set the pass goes on the external list while the camera fills the canvas, and moves
 * back to the internal one whenever it does not (`place`). It is never on both. The caller calls `remove` when done.
 * With `shaded` the pass is the one with the shading (POST_SHADED, its own node, registered only then); without it the
 * node is the legacy one, exactly as before.
 */
export function addPostFilter(
    renderer: Phaser.Renderer.WebGL.WebGLRenderer,
    camera: Phaser.Cameras.Scene2D.Camera,
    source: PostSource,
    external: boolean = isExternalPostFilterEnabled(),
    shaded = false,
): PostFilter {
    const node = registerPostNode(renderer, shaded);
    const controller = new Phaser.Filters.Controller(camera, node);
    sources.set(controller, source);
    controller.active = false;
    let list: PostFilterList = external && cameraFillsCanvas(renderer, camera) ? "external" : "internal";
    camera.filters[list].add(controller);
    return {
        controller,
        get list() {
            return list;
        },
        place() {
            if (!external) return;
            const wanted: PostFilterList = cameraFillsCanvas(renderer, camera) ? "external" : "internal";
            if (wanted === list) return;
            // `remove` destroys a controller unless it ignores destruction: this one is only changing lists.
            controller.ignoreDestroy = true;
            camera.filters[list].remove(controller);
            camera.filters[wanted].add(controller);
            controller.ignoreDestroy = false;
            list = wanted;
        },
        remove() {
            camera.filters[list].remove(controller, true);
        },
    };
}
