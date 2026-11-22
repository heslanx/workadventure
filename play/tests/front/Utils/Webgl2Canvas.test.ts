// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";
import { createWebgl2Canvas, phaserWebgl2Attributes } from "../../../src/front/Utils/Webgl2Canvas";

/** The attributes Phaser passes: the standard ones, and willReadFrequently, which it sends and WebGL ignores. */
type PhaserAttributes = WebGLContextAttributes & { willReadFrequently?: boolean };

/** The render keys of the game config in App.svelte, read from the file so that a change there is seen here. */
const APP = readFileSync(resolve(__dirname, "../../../src/front/Components/App.svelte"), "utf8");

function appLikeConfig(extra: Phaser.Types.Core.GameConfig = {}): Phaser.Types.Core.GameConfig {
    return {
        type: Phaser.WEBGL,
        render: { pixelArt: false, roundPixels: false, antialias: false, antialiasGL: false },
        powerPreference: "low-power",
        backgroundColor: "#0e2236",
        ...extra,
    };
}

/**
 * What Phaser 4.2.1's WebGLRenderer passes to canvas.getContext for the config: the real constructor runs, against a
 * canvas that has no context, and the arguments of its getContext call are read.
 */
function phaserContextAttributes(config: Phaser.Core.Config): PhaserAttributes {
    const getContext = vi.fn(() => null);
    const game = { config, canvas: { getContext }, textures: {}, scale: {} };
    const Renderer = Phaser.Renderer.WebGL.WebGLRenderer as unknown as new (game: unknown) => unknown;
    expect(() => new Renderer(game)).toThrow("WebGL unsupported");
    expect(getContext).toHaveBeenCalledWith("webgl", expect.anything());
    return (getContext.mock.calls[0] as unknown as [string, PhaserAttributes])[1];
}

/** The attributes without the two that differ on purpose or mean nothing to WebGL (see the first test). */
function comparable(attributes: PhaserAttributes): PhaserAttributes {
    const copy: Record<string, unknown> = { ...attributes };
    delete copy.failIfMajorPerformanceCaveat;
    delete copy.willReadFrequently;
    return copy;
}

describe("phaserWebgl2Attributes", () => {
    it("asks for what Phaser's own renderer asks for, but for failIfMajorPerformanceCaveat", () => {
        const config = new Phaser.Core.Config(appLikeConfig());

        const { failIfMajorPerformanceCaveat, ...ours } = phaserWebgl2Attributes(config);
        const {
            failIfMajorPerformanceCaveat: phaserCaveat,
            willReadFrequently,
            ...phaser
        } = phaserContextAttributes(config);

        expect(ours).toEqual(phaser);
        expect(phaser).toMatchObject({ depth: true, powerPreference: "low-power", stencil: true, alpha: false });
        // The one difference is on purpose: a software renderer fails the run
        expect(phaserCaveat).toBe(false);
        expect(failIfMajorPerformanceCaveat).toBe(true);
        expect(willReadFrequently).toBe(false);
    });

    it("follows the game config, so that a change of the config cannot drift from the context", () => {
        const config = new Phaser.Core.Config(
            appLikeConfig({
                powerPreference: "high-performance",
                render: { antialiasGL: true, transparent: true, preserveDrawingBuffer: true },
            }),
        );

        const ours = comparable(phaserWebgl2Attributes(config));

        expect(ours).toEqual(comparable(phaserContextAttributes(config)));
        expect(ours).toMatchObject({ powerPreference: "high-performance", alpha: true, antialias: true });
    });
});

describe("createWebgl2Canvas", () => {
    it("returns the canvas and the context created with the attributes", () => {
        const context = {} as WebGL2RenderingContext;
        const getContext = vi.fn(() => context);
        const canvas = { getContext } as unknown as HTMLCanvasElement;
        const doc = { createElement: vi.fn(() => canvas) };
        const config = new Phaser.Core.Config(appLikeConfig());

        const result = createWebgl2Canvas(doc, config);

        expect(doc.createElement).toHaveBeenCalledWith("canvas");
        expect(getContext).toHaveBeenCalledWith("webgl2", phaserWebgl2Attributes(config));
        expect(result.canvas).toBe(canvas);
        expect(result.context).toBe(context);
    });

    it("throws when the context is unavailable, instead of falling back", () => {
        const doc = { createElement: () => ({ getContext: () => null }) };

        expect(() => createWebgl2Canvas(doc as unknown as Document, new Phaser.Core.Config(appLikeConfig()))).toThrow(
            "WebGL2 context is unavailable",
        );
    });
});

describe("App.svelte hands the context to Phaser only for phaserMode=webgl2", () => {
    it("adds canvas and context to the config in that branch alone, so the default config is Phaser's own", () => {
        // No own canvas key in the config literal: Phaser reads a missing key as null, an undefined one as undefined
        const literal = APP.slice(
            APP.indexOf("const config: Phaser.Types.Core.GameConfig = {"),
            APP.indexOf("game = new Game(config)"),
        );
        const branch = literal.slice(literal.indexOf('if (phaserMode === "webgl2") {'));
        const configLiteral = literal.slice(0, literal.indexOf('if (phaserMode === "webgl2") {'));

        expect(configLiteral).not.toMatch(/^\s{12}canvas:/m);
        expect(configLiteral).not.toMatch(/^\s{12}context:/m);
        expect(branch).toContain("createWebgl2Canvas(document, new Phaser.Core.Config(config))");
        expect(branch).toContain("config.canvas = canvas;");
        expect(branch).toContain("config.context = context;");
        expect(APP.match(/config\.(canvas|context) =/g)).toHaveLength(2);
        // The default and "webgl" modes read the same mode as before
        expect(APP).toMatch(/case "webgl2":\n\s+case "webgl":\n\s+mode = Phaser\.WEBGL;/);
    });
});
