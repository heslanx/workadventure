import { describe, expect, it } from "vitest";
import { WATER } from "./shaders";
import { SUNNY_BAND, WATER_SUNNY_ABOVE, orderWater, paintedFramesShow, waterSun } from "./waterLayers";

describe("the sun the water shader calls day", () => {
    it("is the level the shader's own `sunny` tests, in the shader's source", () => {
        expect(WATER).toContain(`bool sunny = uSun > ${WATER_SUNNY_ABOVE.toFixed(1)};`);
        expect(WATER_SUNNY_ABOVE).toBe(0.3);
    });

    it("is the larger of the sun and the clouds, as the shader is given it", () => {
        expect(waterSun(0.2, 0.5)).toBe(0.5);
        expect(waterSun(0.9, 0.5)).toBe(0.9);
    });
});

describe("paintedFramesShow (the glints and ripples over the water by day, under it at night)", () => {
    it("shows them at noon and hides them at night", () => {
        expect(paintedFramesShow(false, 1, 0)).toBe(true);
        expect(paintedFramesShow(true, 0, 0)).toBe(false);
        expect(paintedFramesShow(false, 0, 0)).toBe(false);
    });

    it("flips on the shader's own level, with a band round it so that a sun resting there does not make it flip", () => {
        const edge = WATER_SUNNY_ABOVE;
        expect(paintedFramesShow(false, edge + SUNNY_BAND + 0.001, 0)).toBe(true);
        expect(paintedFramesShow(false, edge + SUNNY_BAND - 0.001, 0)).toBe(false);
        expect(paintedFramesShow(true, edge - SUNNY_BAND + 0.001, 0)).toBe(true);
        expect(paintedFramesShow(true, edge - SUNNY_BAND - 0.001, 0)).toBe(false);
        for (const was of [true, false]) expect(paintedFramesShow(was, edge, 0)).toBe(was);
    });

    it("follows a bright cloudy sky as the shader's glitter does (uSun is the larger of sun and clouds)", () => {
        expect(paintedFramesShow(false, 0, 1)).toBe(true);
    });
});

describe("orderWater", () => {
    const names = (list: unknown[]): string => list.map((o) => (o as { n: string }).n).join(" ");
    const mk = (n: string) => ({ n });
    const scene = () => {
        const [floor, decor, water, ground, walls] = ["floor", "decor", "water", "ground", "walls"].map(mk);
        return { list: [floor, decor, water, ground, walls], decor, water };
    };

    it("puts the water right before the decor layer when the painted frames show, so the layer is drawn over it", () => {
        const s = scene();
        expect(orderWater(s.list, s.water, s.decor, true)).toBe(true);
        expect(names(s.list)).toBe("floor water decor ground walls");
    });

    it("puts it right after the layer when they do not (the order the build gives it), and moves nothing else", () => {
        const s = scene();
        orderWater(s.list, s.water, s.decor, true);
        expect(orderWater(s.list, s.water, s.decor, false)).toBe(true);
        expect(names(s.list)).toBe("floor decor water ground walls");
    });

    it("changes nothing, and says so, when the water is already where it belongs or one of the two is not listed", () => {
        const s = scene();
        expect(orderWater(s.list, s.water, s.decor, false)).toBe(false);
        expect(names(s.list)).toBe("floor decor water ground walls");
        expect(orderWater(s.list, mk("elsewhere"), s.decor, true)).toBe(false);
        expect(orderWater(s.list, s.water, mk("elsewhere"), true)).toBe(false);
        expect(names(s.list)).toBe("floor decor water ground walls");
    });
});
