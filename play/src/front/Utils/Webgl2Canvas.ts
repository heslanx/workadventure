import type * as Phaser from "phaser";

/** The settings of the Phaser config that Phaser itself turns into the attributes of the WebGL context it creates. */
export type PhaserContextSettings = Pick<
    Phaser.Core.Config,
    | "transparent"
    | "desynchronized"
    | "antialiasGL"
    | "premultipliedAlpha"
    | "stencil"
    | "powerPreference"
    | "preserveDrawingBuffer"
>;

export interface Webgl2ContextOptions {
    /**
     * Whether the default framebuffer has a depth buffer. Phaser asks for one and never turns the depth test on (its
     * state sets `depthTest: false` and nothing in the game sets it), so the `gameNoStencil` flag drops it. It is the
     * one attribute the Phaser config does not carry.
     */
    depth?: boolean;
}

/**
 * The attributes of the WebGL2 context for a `phaserMode=webgl2` run. They are the ones Phaser 4.2.1 asks for in
 * WebGLRenderer (contextCreationConfig), read from the same resolved config, so that the run measures the GPU, the
 * framebuffer layout and the screenshots of the default path: depth is on there unless the options say otherwise, and
 * powerPreference comes from the game config (the integrated GPU on a machine with two).
 *
 * The one deliberate difference is failIfMajorPerformanceCaveat: Phaser leaves it false, this run sets it so that a
 * software renderer fails the run instead of producing numbers that are not a GPU's.
 */
export function phaserWebgl2Attributes(
    settings: PhaserContextSettings,
    options: Webgl2ContextOptions = {},
): WebGLContextAttributes {
    return {
        alpha: settings.transparent,
        desynchronized: settings.desynchronized,
        depth: options.depth ?? true,
        antialias: settings.antialiasGL,
        premultipliedAlpha: settings.premultipliedAlpha,
        stencil: settings.stencil,
        failIfMajorPerformanceCaveat: true,
        powerPreference: settings.powerPreference as WebGLPowerPreference,
        preserveDrawingBuffer: settings.preserveDrawingBuffer,
    };
}

/**
 * A canvas with its own WebGL2 context, to hand to Phaser as `config.canvas` and `config.context` (Phaser adopts both,
 * sizes the canvas, styles it and puts it in the scale manager's parent as it does for its own canvas, and listens to
 * context loss and restore on it). Throws when the context is unavailable: a run that asked for WebGL2 must not fall
 * back to anything else.
 */
export function createWebgl2Canvas(
    doc: Pick<Document, "createElement">,
    settings: PhaserContextSettings,
    options: Webgl2ContextOptions = {},
): { canvas: HTMLCanvasElement; context: WebGL2RenderingContext } {
    const canvas = doc.createElement("canvas");
    const context = canvas.getContext("webgl2", phaserWebgl2Attributes(settings, options));
    if (!context) {
        throw new Error("The requested WebGL2 context is unavailable");
    }
    return { canvas, context };
}
