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

    describe("the shading's optional keys (kinds, painted, building)", () => {
        it("reads what each placed sprite is to the shading, the sprites that carry a painted shadow and the building", () => {
            const parsed = effectsManifestSchema.parse({
                ...manifest,
                building: [192, 192, 2400, 1408],
                kinds: { "escritorio-moderno/sprites/mo-153.png": "top", "konclui/sprites/rug.png": "floor" },
                painted: ["escritorio-moderno/sprites/mo-160.png"],
            });
            expect(parsed.building).toEqual([192, 192, 2400, 1408]);
            expect(parsed.kinds?.["konclui/sprites/rug.png"]).toBe("floor");
            expect(parsed.painted).toEqual(["escritorio-moderno/sprites/mo-160.png"]);
        });

        // An old build has none of them: the runtime then classifies by prefab and treats `painted` as empty.
        it("leaves them out for a build that has none", () => {
            const parsed = effectsManifestSchema.parse(manifest);
            expect(parsed.kinds).toBeUndefined();
            expect(parsed.painted).toBeUndefined();
            expect(parsed.building).toBeUndefined();
        });

        it("rejects a kind that is not one of the four", () => {
            expect(effectsManifestSchema.safeParse({ ...manifest, kinds: { "a.png": "wall" } }).success).toBe(false);
            expect(effectsManifestSchema.safeParse({ ...manifest, painted: [1] }).success).toBe(false);
        });
    });

    describe("the casters (the height, foot and footprint of a piece whose rows are not its height)", () => {
        const sprite = "mobilia/sprites/seating/mob-6cdb5db3.png";

        it("reads an entry with an h alone, and one with a foot and a span", () => {
            const parsed = effectsManifestSchema.parse({
                ...manifest,
                casters: { [sprite]: { h: 18 }, "konclui/sprites/sofa.png": { h: 14.5, foot: 33, span: [2, 60] } },
            });

            expect(parsed.casters).toEqual({
                [sprite]: { h: 18 },
                "konclui/sprites/sofa.png": { h: 14.5, foot: 33, span: [2, 60] },
            });
        });

        it("leaves them out of a manifest that has none (the committed one), which is read as it always was", () => {
            const parsed = effectsManifestSchema.parse(manifest);

            expect(parsed).not.toHaveProperty("casters");
            expect(effectsManifestSchema.parse({ ...manifest, casters: {} }).casters).toEqual({});
        });

        it.each([
            ["an h of 0", { h: 0 }, /h is its height in px: more than 0/],
            ["a negative h", { h: -3 }, /more than 0/],
            ["no h", { foot: 4 }, /Required/],
            ["a foot that is not a whole row", { h: 5, foot: 3.5 }, /foot is a row of the sprite: a whole number/],
            ["a negative foot", { h: 5, foot: -1 }, /foot is a row of the sprite: 0 or more/],
            ["a span that ends before it starts", { h: 5, span: [9, 4] }, /span is \[x0, x1\] with x1 after x0/],
            ["a span of one number", { h: 5, span: [9] }, /./],
            ["an h that is not a number", { h: "18" }, /./],
        ])("rejects %s with a message that says which part is wrong", (_what, entry, message) => {
            const result = effectsManifestSchema.safeParse({ ...manifest, casters: { [sprite]: entry } });

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].path).toEqual([
                    "casters",
                    sprite,
                    ...result.error.issues[0].path.slice(2),
                ]);
                expect(result.error.issues.map((i) => i.message).join("; ")).toMatch(message);
            }
        });
    });
});
