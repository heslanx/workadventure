import { describe, expect, it } from "vitest";
import { LAMP_DIRECTIONS, casterLampsFrom, lampDirection, lampLight, lampShadowLength, poolFalloff } from "./lamps";
import { lightsFrom, type SpriteSpec } from "./lights";

const spec = (kind: string, extra: Partial<SpriteSpec> = {}): SpriteSpec => ({
    kind,
    w: 32,
    h: 96,
    foot: [16, 96],
    head: [16, 10],
    ...extra,
});

const SPECS = {
    "p/arc.png": spec("arc"),
    "p/floor.png": spec("floor"),
    "p/desk.png": spec("desk", { h: 32, head: undefined }),
    "p/screen.png": spec("screen", { screen: [4, 4, 28, 20], head: undefined }),
};
const image = (name: string, x: number, y: number) => ({ key: `maps/entities/${name}`, x, y });

describe("casterLampsFrom", () => {
    const images = [
        image("p/arc.png", 100, 100),
        image("p/screen.png", 200, 100),
        image("p/desk.png", 300, 100),
        image("p/floor.png", 400, 100),
    ];
    const lamps = casterLampsFrom(images, SPECS);

    it("keeps arc, floor and desk lamps and leaves out screens, which only add light", () => {
        expect(lamps.map((l) => l.piece)).toEqual([0, 2, 3]);
    });

    it("hangs an arc and a floor lamp's source at its head 42 px up and a desk lamp's at 24", () => {
        expect(lamps.map((l) => l.z)).toEqual([42, 24, 42]);
        expect([lamps[0].x, lamps[0].y]).toEqual([116, 110]);
    });

    // Seen failing: the shadows pointed away from the lamp's head, which is up to 84 px above the floor the lamp lights, so a
    // table beside the lit spot got a shadow toward the lamp's pole. The spot under the lamp is its widest pool's centre.
    it("puts the spot a shadow points away from at the centre of the widest pool, not at the head", () => {
        const [arc] = lamps;
        const widest = arc.pools.reduce((a, b) => (Math.abs(b.reach) > Math.abs(a.reach) ? b : a));
        expect([arc.gx, arc.gy]).toEqual([widest.x, widest.y]);
        expect(arc.reach).toBe(Math.abs(widest.reach));
        expect(arc.squash).toBe(widest.squash);
        expect(arc.gy).toBeGreaterThan(arc.y + 40);
    });

    it("takes the pools the camera pass draws, from lightsFrom itself", () => {
        expect(lamps[0].pools).toEqual(lightsFrom([images[0]], SPECS).pools);
        expect(lamps[0].pools).toHaveLength(3);
    });
});

describe("poolFalloff and lampLight", () => {
    const pool = { ...lightsFrom([image("p/arc.png", 0, 0)], SPECS).pools[0] };

    it("is the shader's formula: power x (1 - d)^1.4 with d over the squashed reach, 0 outside", () => {
        expect(poolFalloff(pool, pool.x, pool.y)).toBeCloseTo(pool.power);
        const d = 0.5;
        expect(poolFalloff(pool, pool.x + pool.reach * d, pool.y)).toBeCloseTo(pool.power * Math.pow(1 - d, 1.4));
        expect(poolFalloff(pool, pool.x, pool.y + pool.reach * pool.squash * d)).toBeCloseTo(
            pool.power * Math.pow(1 - d, 1.4),
        );
        expect(poolFalloff(pool, pool.x + pool.reach, pool.y)).toBe(0);
    });

    it("is 0 outside the pool's room", () => {
        const clipped = { ...pool, clip: [0, 0, 5, 5] as const };
        expect(poolFalloff(clipped, pool.x, pool.y)).toBe(0);
    });

    it("sums a lamp's pools", () => {
        const [lamp] = casterLampsFrom([image("p/arc.png", 0, 0)], SPECS);
        const sum = lamp.pools.reduce((s, p) => s + poolFalloff(p, 16, 40), 0);
        expect(lampLight(lamp, 16, 40)).toBeCloseTo(sum);
        expect(sum).toBeGreaterThan(0);
    });
});

describe("lampDirection", () => {
    it("has sixteen directions at slopes 0, 1:2, 1:1 and 2:1, all unit vectors", () => {
        expect(LAMP_DIRECTIONS).toHaveLength(16);
        const slopes = new Set(
            LAMP_DIRECTIONS.map(
                ([x, y]) =>
                    Math.round((Math.min(Math.abs(x), Math.abs(y)) / Math.max(Math.abs(x), Math.abs(y), 1e-9)) * 100) /
                    100,
            ),
        );
        expect([...slopes].sort()).toEqual([0, 0.5, 1]);
        for (const [x, y] of LAMP_DIRECTIONS) expect(Math.hypot(x, y)).toBeCloseTo(1);
    });

    it("picks the nearest of them", () => {
        const [x, y] = LAMP_DIRECTIONS[lampDirection(10, 0.5)];
        expect(x).toBe(1);
        expect(y).toBe(0);
        const [dx, dy] = LAMP_DIRECTIONS[lampDirection(-7, 7.2)];
        expect(dx).toBeCloseTo(-Math.SQRT1_2);
        expect(dy).toBeCloseTo(Math.SQRT1_2);
        expect(LAMP_DIRECTIONS[lampDirection(0, -9)]).toEqual(LAMP_DIRECTIONS[12]);
    });

    it("lengthens a shadow with the distance and holds it between 0.4 and 1", () => {
        expect(lampShadowLength(5, 42)).toBe(0.4);
        expect(lampShadowLength(100, 42)).toBe(1);
        expect(lampShadowLength(40, 42)).toBeCloseTo(40 / (1.25 * 42));
    });
});
