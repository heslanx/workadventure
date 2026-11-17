import { describe, expect, it } from "vitest";
import { effectsManifestSchema } from "./effectsManifest";

const manifest = {
    version: 1,
    map: [2752, 1792],
    water: {
        rect: [1152, 192, 480, 1024],
        palette: [[120, 220, 203]],
        glint: [[156, 240, 220]],
        waterline: [143, 230, 210],
    },
    lights: {
        "escritorio-moderno/sprites/mo-153.png": {
            kind: "screen",
            w: 32,
            h: 32,
            foot: [15.4, 32],
            screen: [7, 12, 20, 21],
        },
    },
    shadows: { "escritorio-moderno/sprites/mo-160.png": [11, 19, 22, 23], "konclui/sprites/rug.png": null },
    staticLights: [
        { kind: "door", at: [1392, 1522], r: 245, squash: 0.22, power: 0.85, clip: [192, 192, 2400, 1344] },
        { kind: "pool", rect: [1152, 192, 480, 1024] },
    ],
    rooms: [
        {
            key: "room_01",
            name: "Sala 01",
            layer: "lock-room_01",
            rect: [610, 256, 348, 352],
            floor: [608, 256, 352, 288],
        },
    ],
    spaces: [[192, 196, 416, 768]],
    glassFaces: [[608, 1312, 252]],
    ink: [10, 10, 61],
};

/** The manifest without the named parts. */
const without = (...parts: string[]): Record<string, unknown> =>
    Object.fromEntries(Object.entries(manifest).filter(([part]) => !parts.includes(part)));

describe("effects manifest", () => {
    it("reads the manifest fx.py writes, keeping what the effects use", () => {
        const parsed = effectsManifestSchema.parse(manifest);

        expect(parsed.map).toEqual([2752, 1792]);
        expect(parsed.staticLights).toEqual(manifest.staticLights);
        expect(parsed.shadows).toEqual(manifest.shadows);
        expect(parsed.rooms[0]).toEqual({
            key: "room_01",
            layer: "lock-room_01",
            rect: [610, 256, 348, 352],
            floor: [608, 256, 352, 288],
        });
        expect(parsed).not.toHaveProperty("version");
    });

    it("accepts a manifest without the optional parts", () => {
        const required = without("shadows", "staticLights", "spaces", "glassFaces");

        expect(effectsManifestSchema.safeParse(required).success).toBe(true);
    });

    it("rejects a manifest missing what the effects need", () => {
        expect(effectsManifestSchema.safeParse(without("ink")).success).toBe(false);
        expect(effectsManifestSchema.safeParse({ ...manifest, map: [2752] }).success).toBe(false);
    });
});
