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
    /** The building's outline [x, y, w, h]: a shadow cast in the garden stays out of it. */
    building: quad.optional(),
    /**
     * What each placed sprite is to the shading, by sprite key (casterKind.ts has the rules): a piece that stands and
     * casts a shadow, sits on furniture, hangs on a wall, or is a floor piece. A build without it leaves the runtime to
     * work it out from the prefab.
     */
    kinds: z.record(z.enum(["stand", "top", "hang", "floor"])).optional(),
    /** The sprite keys whose picture carries its own contact shadow: the runtime draws none for them. */
    painted: z.array(z.string()).optional(),
    /** [x0, x1, foot] of each glass face. */
    glassFaces: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(),
    /** The night's darkest colour, 0..255. */
    ink: rgb,
    /**
     * True when fx/ holds `normal.png`: the map-space normal texture of the placed sprites (RGB = (n + 1) / 2, +Y up,
     * alpha 255 under a sprite pixel), the size of `map`. The file is asked for only when this says so, so a room
     * without it makes no request that fails.
     */
    normal: z.boolean().optional(),
});

export type EffectsManifest = z.infer<typeof effectsManifestSchema>;
