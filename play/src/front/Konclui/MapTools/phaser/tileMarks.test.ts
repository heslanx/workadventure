import { describe, expect, it, vi } from "vitest";
import { createTileMarks, type MarkGraphics, type MarkScene } from "./tileMarks";

const TILE = { width: 32, height: 32 };

interface Drawn {
    op: string;
    args: number[];
}

function setup({ zoom = 1, displayScale = 1, color = 0xff8000 } = {}) {
    const drawn: Drawn[] = [];
    const camera = { zoom };
    const record =
        (op: string) =>
        (...args: number[]) => {
            drawn.push({ op, args });
            return graphics;
        };
    const graphics: MarkGraphics & { depth?: number; destroyed: boolean } = {
        destroyed: false,
        clear: () => {
            drawn.length = 0;
            return graphics;
        },
        lineStyle: record("lineStyle"),
        fillStyle: record("fillStyle"),
        strokeRect: record("strokeRect"),
        fillRect: record("fillRect"),
        setDepth: (depth: number) => {
            graphics.depth = depth;
            return graphics;
        },
        destroy: () => {
            graphics.destroyed = true;
        },
    };
    const scene: MarkScene = {
        add: { graphics: () => graphics },
        scale: { displayScale: { x: displayScale } },
        cameras: { main: camera },
        markDirty: vi.fn(),
    };
    return { view: createTileMarks(scene, () => TILE, color), drawn, graphics, camera, scene };
}

const ops = (drawn: Drawn[]) => drawn.map((entry) => entry.op);

describe("the tile marks", () => {
    it("lie on the floor, above the ground layers and below the avatars", () => {
        const { graphics } = setup();

        expect(graphics.depth).toBe(-1);
    });

    it("draw nothing for no tile", () => {
        const { view, drawn } = setup();

        view.paint({ selected: undefined, hovered: undefined });

        expect(drawn).toEqual([]);
    });

    it("draw the selected tile as a faint fill with a 2 px outline inside it, and ask the scene to redraw", () => {
        const { view, drawn, scene } = setup();

        view.paint({ selected: { tileX: 3, tileY: 2 }, hovered: undefined });

        expect(ops(drawn)).toEqual(["fillStyle", "fillRect", "lineStyle", "strokeRect"]);
        expect(drawn[1]?.args).toEqual([96, 64, 32, 32]);
        expect(drawn[2]?.args.slice(0, 1)).toEqual([2]);
        expect(drawn[3]?.args).toEqual([96 + 1, 64 + 1, 30, 30]);
        expect(scene.markDirty).toHaveBeenCalled();
    });

    it("draw the hovered tile as a thinner outline with no fill", () => {
        const { view, drawn } = setup();

        view.paint({ selected: undefined, hovered: { tileX: 1, tileY: 1 } });

        expect(ops(drawn)).toEqual(["lineStyle", "strokeRect"]);
        expect(drawn[0]?.args[0]).toBe(1);
    });

    it("leave the hover off the selected tile, which already says so", () => {
        const { view, drawn } = setup();

        view.paint({ selected: { tileX: 1, tileY: 1 }, hovered: { tileX: 1, tileY: 1 } });

        expect(ops(drawn)).toEqual(["fillStyle", "fillRect", "lineStyle", "strokeRect"]);
    });

    it("keep their width on screen: zoomed out, the line is wider in the map", () => {
        const { view, drawn } = setup({ zoom: 0.5 });

        view.paint({ selected: { tileX: 0, tileY: 0 }, hovered: undefined });

        expect(drawn[2]?.args[0]).toBe(4);
    });

    it("measure the line in the game's pixels, which are bigger than a CSS pixel on a scaled canvas", () => {
        const { view, drawn } = setup({ displayScale: 0.5 });

        view.paint({ selected: { tileX: 0, tileY: 0 }, hovered: undefined });

        expect(drawn[2]?.args[0]).toBe(1);
    });

    it("take the colour they are given", () => {
        const { view, drawn } = setup({ color: 0xff8000 });

        view.paint({ selected: { tileX: 0, tileY: 0 }, hovered: undefined });

        expect(drawn[0]?.args[0]).toBe(0xff8000);
    });

    it("draw again when the camera zooms, and only then", () => {
        const { view, drawn, camera } = setup();
        view.paint({ selected: { tileX: 0, tileY: 0 }, hovered: undefined });
        expect(drawn[2]?.args[0]).toBe(2);

        view.refresh();
        expect(drawn).toHaveLength(4);
        camera.zoom = 2;
        view.refresh();

        // At twice the zoom a map pixel is two screen pixels, so a 2 px line is one map pixel.
        expect(drawn[2]?.args[0]).toBe(1);
    });

    it("have nothing to draw again when there is no selection", () => {
        const { view, drawn, camera } = setup();
        view.paint({ selected: undefined, hovered: { tileX: 1, tileY: 1 } });
        camera.zoom = 2;

        view.refresh();

        expect(drawn[0]?.args[0]).toBe(1);
    });

    it("are taken off the map with the scene", () => {
        const { view, graphics } = setup();

        view.destroy();

        expect(graphics.destroyed).toBe(true);
    });
});
