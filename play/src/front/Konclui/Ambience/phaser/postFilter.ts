import * as Phaser from "phaser";
import { POST } from "../domain/shaders";

const POST_NODE = "KfxPost";

/** A uniform value as Phaser's program manager takes it. */
export type UniformValue = number | number[] | readonly number[] | Float32Array;

/** What the camera pass reads on each draw: its uniforms and the masks texture. */
export interface PostSource {
    postUniforms(): Record<string, UniformValue>;
    masksTexture(): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null;
}

// Phaser builds a filter's render node itself from the controller's node name; the node finds what to draw here.
const sources = new WeakMap<Phaser.Filters.Controller, PostSource>();

function registerPostNode(renderer: Phaser.Renderer.WebGL.WebGLRenderer): void {
    const nodes = renderer.renderNodes;
    if (nodes.hasNode(POST_NODE)) return;
    class PostNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
        constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
            super(POST_NODE, manager, undefined, POST);
        }

        override setupTextures(
            controller: Phaser.Filters.Controller,
            textures: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper[],
        ): void {
            const masks = sources.get(controller)?.masksTexture();
            if (masks) textures[1] = masks;
        }

        override setupUniforms(controller: Phaser.Filters.Controller): void {
            const source = sources.get(controller);
            if (!source) return;
            const programs = this.programManager;
            programs.setUniform("uMasks", 1);
            for (const [name, value] of Object.entries(source.postUniforms())) programs.setUniform(name, value);
        }
    }
    nodes.addNodeConstructor(POST_NODE, PostNode);
}

/**
 * The camera pass of the effects: a filter at the end of the camera's internal list, off until `active` is set. The
 * caller removes it from the list when done.
 */
export function addPostFilter(
    renderer: Phaser.Renderer.WebGL.WebGLRenderer,
    camera: Phaser.Cameras.Scene2D.Camera,
    source: PostSource,
): Phaser.Filters.Controller {
    registerPostNode(renderer);
    const controller = new Phaser.Filters.Controller(camera, POST_NODE);
    sources.set(controller, source);
    controller.active = false;
    camera.filters.internal.add(controller);
    return controller;
}
