import { z } from "zod";

// The data contract of a map folder's fx/ (hq-office fx.py): manifest.json and the pictures beside it. A room whose
// map folder has no fx/manifest.json gets no effect.

/** The pictures of fx/, loaded beside the manifest as `<name>.png`. */
export const EFFECT_TEXTURES = ["water", "water-data", "glass", "masks", "tv-slide", "occluders"] as const;

export type EffectTexture = (typeof EFFECT_TEXTURES)[number];

const pair = z.tuple([z.number(), z.number()]);
const rgb = z.tuple([z.number(), z.number(), z.number()]);
const quad = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const spriteSpec = z.object({
    kind: z.string(),
    w: z.number(),
    h: z.number(),
    foot: pair,
    head: pair.optional(),
    screen: quad.optional(),
    glyph: quad.optional(),
});

const staticBase = {
    kind: z.string(),
    power: z.number().optional(),
    clip: quad.nullable().optional(),
};

const staticLight = z.union([
    z.object({ ...staticBase, rect: quad }),
    z.object({ ...staticBase, at: pair, r: z.number().optional(), squash: z.number().optional() }),
]);

const room = z.object({
    key: z.string(),
    /** The map layer shown while the room is locked. */
    layer: z.string(),
    /** The room with its walls, frosted from outside while locked. */
    rect: quad,
    /** Where its people stand. */
    floor: quad,
});

export const effectsManifestSchema = z.object({
    /** The map's size in px. */
    map: pair,
    water: z.object({
        rect: quad,
        glint: z.array(rgb),
        waterline: rgb,
    }),
    /** Light specs by sprite key (`specKey`). */
    lights: z.record(spriteSpec),
    /** Footprints [x0, y0, x1, y1] by sprite key, for the ground shadow; null for a sprite that casts none. */
    shadows: z.record(quad.nullable()).optional(),
    staticLights: z.array(staticLight).optional(),
    rooms: z.array(room),
    /** The room floors that keep a light in. */
    spaces: z.array(quad).optional(),
    /** [x0, x1, foot] of each glass face. */
    glassFaces: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(),
    /** The night's darkest colour, 0..255. */
    ink: rgb,
});

export type EffectsManifest = z.infer<typeof effectsManifestSchema>;
