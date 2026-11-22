import { describe, expect, it } from "vitest";
import type { Rect } from "./geometry";
import type { LightReach, SpriteSpec } from "./lights";
import {
    emissiveRect,
    lightsFrom,
    spritePoint,
    staticLights,
    touchesView,
    ViewCache,
    visibleLights,
    visibleRects,
} from "./lights";

describe("lights", () => {
    it("finds a lamp's shade, a totem's foot, the point below a screen and the middle of a glyph", () => {
        const arc: SpriteSpec = { kind: "arc", w: 64, h: 64, foot: [16, 63], head: [42, 18] };
        expect(spritePoint(arc, "head", 100, 200)).toEqual({ x: 142, y: 218 });
        const totem: SpriteSpec = {
            kind: "totem",
            w: 32,
            h: 96,
            foot: [16, 89],
            head: [15.5, 18],
            glyph: [10, 12, 22, 26],
        };
        expect(spritePoint(totem, "foot", 0, 0)).toEqual({ x: 16, y: 89 });
        expect(spritePoint(totem, "glyph", 0, 0)).toEqual({ x: 16, y: 19 });
        const tv: SpriteSpec = { kind: "tv", w: 64, h: 64, foot: [32, 48], screen: [11, 21, 54, 44] };
        expect(spritePoint(tv, "front", 0, 0)).toEqual({ x: 32.5, y: 54 });
        expect(emissiveRect(tv, 10, 20)).toEqual([21, 41, 43, 23]);
        expect(emissiveRect(arc, 100, 200), "the bulb under the cap of an arc lamp").toEqual([138, 221, 8, 2]);
        const standing: SpriteSpec = { kind: "floor", w: 32, h: 64, foot: [16, 54], head: [16, 17] };
        expect(emissiveRect(standing, 0, 0), "the flame on top of a standing lamp").toEqual([13, 12, 6, 2]);
        expect(emissiveRect(totem, 0, 0), "the K keeps its light").toEqual([10, 12, 12, 14]);
    });

    it("matches placed sprites by texture path, keeps their light in their room, and lights TVs only in a meeting", () => {
        const specs: Record<string, SpriteSpec> = {
            "mobilia/sprites/roomdecor/arc.png": { kind: "arc", w: 64, h: 64, foot: [16, 63], head: [42, 18] },
            "mobilia/sprites/walldecor/tv.png": {
                kind: "tv",
                w: 64,
                h: 64,
                foot: [32, 48],
                screen: [11, 21, 54, 44],
            },
        };
        const room: Rect = [0, 0, 400, 300];
        const images = [
            { key: "http://x/map-storage/r/entities/mobilia/sprites/roomdecor/arc.png", x: 100, y: 100 },
            { key: "http://x/map-storage/r/entities/mobilia/sprites/walldecor/tv.png", x: 600, y: 600 },
            { key: "http://x/map-storage/r/entities/mobilia/sprites/other.png", x: 0, y: 0 },
        ];
        const { pools, emissive } = lightsFrom(images, specs, [room]);
        expect(
            pools.map((l) => l.kind),
            "the cone: pools widening down from the shade",
        ).toEqual(["arc", "arc", "arc"]);
        for (const pool of pools) expect(pool.clip).toBe(room);
        expect(pools[0].y < pools[1].y && pools[1].y < pools[2].y && pools[0].reach < pools[2].reach).toBe(true);
        expect(emissive).toHaveLength(1);
        const meeting = lightsFrom(images, specs, [room], (x, y) => x > 500 && y > 500);
        expect(meeting.pools.some((l) => l.kind === "tv" && l.clip === null)).toBe(true);
        expect(meeting.emissive).toHaveLength(2);
    });

    it("lights the entrance on each side of the facade and the pool on water only", () => {
        const lobby: Rect = [0, 0, 100, 100];
        const [door, pool] = staticLights([
            { kind: "door", at: [50, 90], r: 150, squash: 0.4, clip: lobby },
            { kind: "pool", at: [5, 5], r: 90 },
        ]);
        expect(door.clip).toEqual(lobby);
        expect(door.squash).toBe(0.4);
        expect(pool.power, "negative power: water only").toBeLessThan(0);
        expect(staticLights([{ kind: "unknown", at: [0, 0] }])).toHaveLength(0);
    });

    it("keeps only what reaches the view, at most the shader's 32, the nearest and strongest first", () => {
        const l = (x: number, y: number, reach = 20, power = 1): LightReach => ({ x, y, reach, power, squash: 1 });
        const lights = [
            l(5000, 5000),
            l(110, 100),
            l(400, 300),
            l(-30, 50, 40),
            ...Array.from({ length: 40 }, (_, i) => l(i * 10, 50)),
        ];
        const seen = visibleLights(lights, [0, 0, 500, 400]);
        expect(seen).toHaveLength(32);
        expect(seen).not.toContain(lights[0]);
        const near = visibleLights([l(250, 200), l(10, 10)], [0, 0, 500, 400]);
        expect(near[0].x).toBe(250);
        const rects = visibleRects([{ rect: [10, 10, 5, 5] }, { rect: [900, 900, 5, 5] }], [0, 0, 500, 400]);
        expect(rects).toHaveLength(1);
    });
});

describe("the lights kept for the camera's cell", () => {
    const l = (x: number, y: number, reach = 20): LightReach => ({ x, y, reach, power: 1, squash: 1 });
    const lights = [l(50, 50), l(300, 50), l(1000, 1000)];
    const cache = (): ViewCache<LightReach> => new ViewCache(16, (area) => visibleLights(lights, area, 32));

    it("answer the same view again without working it out, a footstep's draw", () => {
        const kept = cache();

        const first = kept.get([0, 0, 200, 100], 1);
        const again = kept.get([0, 0, 200, 100], 1);

        expect(again).toBe(first);
        expect(kept.runs).toBe(1);
    });

    it("answer a camera that moved inside its cell without working it out, and the next cell with one run", () => {
        const kept = cache();
        kept.get([0, 0, 200, 100], 1);

        kept.get([15.9, 15.9, 200, 100], 1);
        expect(kept.runs).toBe(1);
        kept.get([16, 0, 200, 100], 1);
        expect(kept.runs).toBe(2);
    });

    it("work it out again when the fixtures change (the version), when the view's size changes, and not before", () => {
        const kept = cache();
        kept.get([0, 0, 200, 100], 1);

        kept.get([0, 0, 200, 100], 2);
        kept.get([0, 0, 220, 100], 2);

        expect(kept.runs).toBe(3);
    });

    it("never miss a light the exact view reaches, wherever in its cell the camera is", () => {
        // a light whose reach just touches the view at its right edge when the camera stands at 15.9 of its cell
        const edge = [l(215.8 + 20, 50)]; // its left reach edge is x = 215.8, just inside the exact view's right edge, 15.9 + 200
        const kept = new ViewCache<LightReach>(16, (area) => visibleLights(edge, area, 32));

        expect(visibleLights(edge, [15.9, 0, 200, 100]), "the exact view reaches it").toHaveLength(1);
        expect(kept.get([15.9, 0, 200, 100], 1)).toHaveLength(1);
        expect(kept.get([0, 0, 200, 100], 1), "the cell's other end: kept too, it is a superset").toHaveLength(1);
    });

    it("hand the computation an area that covers every view of the cell", () => {
        const areas: number[][] = [];
        const kept = new ViewCache<number>(16, (area) => {
            areas.push([...area]);
            return [];
        });

        kept.get([35, 20, 300, 200], 1);

        const [x, y, w, h] = areas[0];
        expect([x, y], "the cell's corner").toEqual([32, 16]);
        expect(x + w, "reaches the right edge of the widest view of the cell").toBeGreaterThanOrEqual(47.99 + 300);
        expect(y + h).toBeGreaterThanOrEqual(31.99 + 200);
    });
});

describe("touchesView", () => {
    it("is true for a rectangle that overlaps the view and false for one that only shares an edge", () => {
        expect(touchesView([10, 10, 5, 5], [0, 0, 100, 100])).toBe(true);
        expect(touchesView([100, 0, 5, 5], [0, 0, 100, 100])).toBe(false);
        expect(touchesView([-5, 0, 5, 5], [0, 0, 100, 100])).toBe(false);
    });
});
