/**
 * The lab's call of the runtime's cast bake (plan 1a/2e): the real `bakeCast` on the real pieces of the built map, each
 * element alone for the isolated pictures, with the CPU time of each. The bake is imported by run.ts when its file is
 * in the tree; this module only assembles its input (placements, decoded pictures, manifest) and reads its output.
 */
import type {
    BakeCaster,
    BakeInput,
    BakeOptions,
    BakePiece,
    BakeStats,
} from "../../play/src/front/Konclui/Ambience/domain/shadeBake";
import type { CasterSpec } from "../../play/src/front/Konclui/Ambience/domain/effectsManifest";
import type { CasterKind } from "../../play/src/front/Konclui/Ambience/domain/casterKind";
import type { CasterLamp } from "../../play/src/front/Konclui/Ambience/domain/lamps";
import type { Silhouette } from "../../play/src/front/Konclui/Ambience/domain/shadeShapes";
import type { Rect } from "../../play/src/front/Konclui/Ambience/domain/geometry";
import type { PlacedImage, SpriteSpec } from "../../play/src/front/Konclui/Ambience/domain/lights";
import type { KeyLightLike } from "./uniforms";
import type { Placement } from "./placements";

/** The runtime exports the cast bake needs; each is present when its file is. */
export interface BakeHooks {
    bakeCast?: (input: BakeInput, out: Uint8Array, options?: BakeOptions) => BakeStats;
    newCastBuffer?: (width: number, height: number) => Uint8Array;
    lampCasters?: (input: BakeInput, lampIndex: number) => number[];
    silhouetteOf?: (rgba: { data: ArrayLike<number> }, width: number, height: number) => Silhouette | null;
    hasPaintedShadow?: (rgba: { data: ArrayLike<number> }, width: number, height: number, sil: Silhouette) => boolean;
    lengthScale?: (height: number, length: number, lo: number, hi: number) => number;
    /** A manifest's caster entry, for a piece placed with this silhouette from a picture of this size. */
    placedCaster?: (
        entry: CasterSpec | undefined,
        sil: Silhouette | null,
        sourceWidth: number,
        sourceHeight: number,
        flipX: boolean,
    ) => BakeCaster | null;
    classifyPiece?: (input: {
        name?: string;
        tags?: readonly string[];
        depthOffset?: number;
        key?: string;
    }) => CasterKind;
    casterLampsFrom?: (
        images: readonly PlacedImage[],
        specs: Readonly<Partial<Record<string, SpriteSpec>>>,
        spaces?: readonly Rect[],
    ) => CasterLamp[];
    newKeyLight?(): KeyLightLike;
    keyLightAt?(hour: number, out: KeyLightLike): number;
    SHADOW_FLOOR_PX?: number;
    SHADOW_CAP_PX?: number;
}

/** The names a `BakeHooks` must have for the lab to bake. */
export const REQUIRED_BAKE_HOOKS = [
    "bakeCast",
    "placedCaster",
    "newCastBuffer",
    "silhouetteOf",
    "hasPaintedShadow",
    "classifyPiece",
    "casterLampsFrom",
    "newKeyLight",
    "keyLightAt",
] as const;

export function missingBakeHooks(hooks: BakeHooks): string[] {
    return REQUIRED_BAKE_HOOKS.filter((name) => typeof hooks[name] !== "function");
}

/** What the bake reads of the built map. */
export interface BakeSource {
    readonly placements: readonly Placement[];
    /** Decoded pictures by key; null for one that could not be read (it casts nothing). */
    readonly sprites: ReadonlyMap<string, ImageData | null>;
    readonly manifest: {
        readonly map: readonly [number, number];
        readonly lights: Readonly<Partial<Record<string, SpriteSpec>>>;
        readonly spaces?: readonly Rect[];
        readonly building?: readonly number[];
        readonly kinds?: Readonly<Record<string, CasterKind>>;
        readonly painted?: readonly string[];
        /** The build's optional caster entries by sprite key (a manifest without them shades every piece by its rows). */
        readonly casters?: Readonly<Record<string, CasterSpec>>;
    };
    readonly maskPixels: Uint8ClampedArray;
}

export const ELEMENTS = ["contact", "key", "lamp", "surface"] as const;
export type CastElement = (typeof ELEMENTS)[number];

export interface CastSet {
    /** Everything baked: what the shaded program reads at full strength. */
    readonly all: Uint8Array;
    /** One element alone (the receiver mask, A, always kept: it says where a shadow may land). */
    readonly alone: Readonly<Record<CastElement, Uint8Array>>;
    readonly key: KeyLightLike;
    readonly report: Record<string, unknown>;
    /** The pieces the bake read, in placement order, with their kind and silhouette: the coverage check's input. */
    readonly pieces: readonly BakePiece[];
}

const WALL = 0.376;

/** Pieces as the bake reads them, with how each one was classified (the manifest's `kinds` when the build has them). */
export function bakePieces(
    source: BakeSource,
    hooks: BakeHooks,
): {
    pieces: BakePiece[];
    kinds: Record<string, number>;
    classifiedFrom: string;
    painted: number;
    unreadable: number;
    /** Placed pieces with an entry in the manifest's casters, and those the bake was given a caster for. */
    casterEntries: number;
    casterApplied: number;
    /** Keys with an entry and a readable picture that the bake was NOT given a caster for: the entry was dropped on the way. */
    casterDropped: string[];
} {
    const sil = new Map<string, Silhouette | null>();
    const paintedKeys = new Set(source.manifest.painted ?? []);
    const counts: Record<string, number> = { stand: 0, top: 0, hang: 0, floor: 0 };
    let painted = 0;
    let unreadable = 0;
    let casterEntries = 0;
    let casterApplied = 0;
    const casterDropped = new Set<string>();
    const pieces = source.placements.map((p): BakePiece => {
        const image = source.sprites.get(p.key) ?? null;
        let silhouette = sil.get(p.key);
        if (silhouette === undefined) {
            silhouette = image ? (hooks.silhouetteOf?.(image, image.width, image.height) ?? null) : null;
            sil.set(p.key, silhouette);
        }
        if (!silhouette) unreadable += 1;
        const kind =
            source.manifest.kinds?.[p.key] ??
            hooks.classifyPiece?.({ name: p.name, tags: p.tags, depthOffset: p.depthOffset, key: p.key }) ??
            "stand";
        counts[kind] += 1;
        const isPainted =
            paintedKeys.has(p.key) ||
            (image !== null &&
                silhouette !== null &&
                hooks.hasPaintedShadow?.(image, image.width, image.height, silhouette) === true);
        if (isPainted) painted += 1;
        const entry = source.manifest.casters?.[p.key];
        const caster =
            entry && image ? (hooks.placedCaster?.(entry, silhouette, image.width, image.height, false) ?? null) : null;
        if (entry) casterEntries += 1;
        if (caster) casterApplied += 1;
        else if (entry && silhouette) casterDropped.add(p.key);
        return { key: p.key, x: p.x, y: p.y, kind, silhouette, painted: isPainted, caster };
    });
    return {
        pieces,
        kinds: counts,
        classifiedFrom: source.manifest.kinds ? "manifest.kinds" : "the runtime's classifyPiece on the prefab",
        painted,
        unreadable,
        casterEntries,
        casterApplied,
        casterDropped: [...casterDropped].sort(),
    };
}

function timed<T>(run: () => T): { value: T; ms: number } {
    const start = performance.now();
    const value = run();
    return { value, ms: performance.now() - start };
}

/**
 * Bakes the cast texture for an hour: everything, then each element alone (receiver mask kept). Also checks, piece by
 * piece, that every standing piece throws a key shadow of at least 8 px outside its silhouette (a bake of that piece on
 * a canvas of its own, no room clip), and lists the ones that do not with the reason.
 */
export function buildCasts(source: BakeSource, hooks: BakeHooks, hour: number): CastSet {
    const missing = missingBakeHooks(hooks);
    if (missing.length > 0) throw new Error(`the bake needs ${missing.join(", ")} from the runtime`);
    const { bakeCast, newCastBuffer, casterLampsFrom, newKeyLight, keyLightAt } = hooks as Required<
        Pick<BakeHooks, "bakeCast" | "newCastBuffer" | "casterLampsFrom" | "newKeyLight" | "keyLightAt">
    >;
    const [width, height] = source.manifest.map;
    const key = newKeyLight();
    keyLightAt(hour, key);
    const pieceTimer = timed(() => bakePieces(source, hooks));
    const { pieces, kinds, classifiedFrom, painted, unreadable, casterEntries, casterApplied, casterDropped } =
        pieceTimer.value;
    const lamps = casterLampsFrom(
        source.placements.map((p) => ({ key: `/entities/${p.key}`, x: p.x, y: p.y })),
        source.manifest.lights,
        source.manifest.spaces,
    );
    const m = source.manifest.building;
    const building: Rect | null = m && m.length === 4 ? [m[0], m[1], m[2], m[3]] : null;
    const input: BakeInput = {
        width,
        height,
        pieces,
        spaces: source.manifest.spaces ?? [],
        building,
        lamps,
        key: key as unknown as BakeInput["key"],
        isWall: (x, y) => {
            if (x < 0 || y < 0 || x >= width || y >= height) return false;
            return Math.abs(source.maskPixels[(y * width + x) * 4] / 255 - WALL) < 0.1;
        },
    };
    const milliseconds: Record<string, number> = { silhouettesAndKinds: pieceTimer.ms };
    const stats: Record<string, BakeStats> = {};
    const run = (name: string, options: BakeOptions): Uint8Array => {
        const out = newCastBuffer(width, height);
        const result = timed(() => bakeCast(input, out, options));
        milliseconds[name] = result.ms;
        stats[name] = result.value;
        return out;
    };
    const all = run("all", {});
    const none = { solid: true, contact: false, key: false, lamp: false, surface: false };
    const alone = {
        contact: run("contact", { ...none, contact: true }),
        key: run("key", { ...none, key: true }),
        lamp: run("lamp", { ...none, lamp: true }),
        surface: run("surface", { ...none, surface: true }),
    };
    // the casters, read at full map: the key's shadows with the entries against the same bake with the entries taken off. An entry
    // the bake ignores changes nothing; one that is honoured changes the key's pixels of the pieces whose rows are not their height.
    let keyPixelsChanged = 0;
    let expectedChange = 0;
    if (casterApplied > 0) {
        const bare = newCastBuffer(width, height);
        bakeCast({ ...input, pieces: pieces.map((p) => ({ ...p, caster: null })) }, bare, { ...none, key: true });
        const withEntries = alone.key;
        for (let i = 1; i < bare.length; i += 4) if (bare[i] !== withEntries[i]) keyPixelsChanged += 1;
        for (const p of pieces) {
            const rows = p.silhouette ? p.silhouette.foot - p.silhouette.top + 1 : 0;
            if (
                p.kind === "stand" &&
                p.caster &&
                (p.caster.h !== rows || (p.caster.foot ?? p.silhouette?.foot) !== p.silhouette?.foot)
            )
                expectedChange += 1;
        }
    }
    const lacking = standPiecesWithoutShadow(source, hooks, pieces, key);
    const surfaces = surfacePiecesWithoutShadow(source, hooks, pieces, key);
    const lampReport = lamps.map((lamp, i) => ({
        at: [Math.round(lamp.x), Math.round(lamp.y)],
        under: [Math.round(lamp.gx), Math.round(lamp.gy)],
        reach: lamp.reach,
        casters: hooks.lampCasters ? hooks.lampCasters(input, i).map((p) => pieces[p].key.split("/").pop()) : null,
    }));
    const standPieces = pieces.filter((p) => p.kind === "stand" && p.silhouette !== null);
    const report: Record<string, unknown> = {
        bytes: all.length,
        ms: milliseconds,
        hour,
        key: { dirIndex: key.dirIndex, length: key.length },
        pieces: pieces.length,
        kinds,
        classifiedFrom,
        paintedPieces: painted,
        unreadablePieces: unreadable,
        casterLamps: lamps.length,
        lamps: lampReport,
        stats,
        standPieces: standPieces.length,
        standWithShadowPx: lacking.withShadow,
        standWithShadowShare: standPieces.length === 0 ? null : lacking.withShadow / standPieces.length,
        standWithoutShadow: lacking.list,
        floatingShadows: lacking.floating,
        topPieces: surfaces.tops,
        topsWithoutShadow: surfaces.topsWithout,
        hangPieces: surfaces.hangs,
        hangsWithoutShadow: surfaces.hangsWithout,
        shadowLengthPx: lacking.lengths,
        casters: {
            entries: casterEntries,
            applied: casterApplied,
            dropped: casterDropped,
            expectedChange,
            keyPixelsChanged,
        },
    };
    return { all, alone, key, report, pieces };
}

/** The shadow a stand piece throws, alone on a canvas of its own with the room clip off: pixels outside it, and its length. */
function standPiecesWithoutShadow(
    source: BakeSource,
    hooks: BakeHooks,
    pieces: readonly BakePiece[],
    key: KeyLightLike,
): {
    withShadow: number;
    floating: { key: string; x: number; y: number }[];
    list: { key: string; x: number; y: number; reason: string; pixels: number }[];
    lengths: Record<string, number> | null;
} {
    const { bakeCast, newCastBuffer } = hooks as Required<Pick<BakeHooks, "bakeCast" | "newCastBuffer">>;
    const floorPx = hooks.SHADOW_FLOOR_PX ?? 3;
    const capPx = hooks.SHADOW_CAP_PX ?? 22;
    const seen = new Map<string, { pixels: number; length: number; attached: boolean }>();
    const list: { key: string; x: number; y: number; reason: string; pixels: number }[] = [];
    let withShadow = 0;
    const floating: { key: string; x: number; y: number }[] = [];
    let shortest = Infinity;
    let longest = 0;
    for (const piece of pieces) {
        if (piece.kind !== "stand" || !piece.silhouette) continue;
        let measured = seen.get(piece.key);
        if (!measured) {
            const sil = piece.silhouette;
            const margin = capPx + 6;
            const width = sil.width + margin * 2;
            const height = sil.height + margin * 2;
            const canvas = newCastBuffer(width, height);
            bakeCast(
                {
                    width,
                    height,
                    pieces: [{ ...piece, x: margin, y: margin }],
                    spaces: [],
                    building: null,
                    lamps: [],
                    key: key as unknown as BakeInput["key"],
                },
                canvas,
                { solid: true, contact: false, key: true, lamp: false, surface: false },
            );
            let pixels = 0;
            // the shadow starts at the object: a shadow cell on the foot row or the row below it (the reviewers saw a table's
            // shadow 16 px under its legs, and the count of its pixels alone passed it)
            let attached = false;
            // measured on the picture, not on the silhouette: a layer of partial alpha that the silhouette took for the piece moves
            // the silhouette's foot with it, and a shadow attached to that foot floats
            const image = source.sprites.get(piece.key);
            let solidFoot = sil.foot;
            if (image) {
                for (let row = image.height - 1; row >= 0; row--) {
                    let found = false;
                    for (let x = 0; x < image.width && !found; x++)
                        found = image.data[(row * image.width + x) * 4 + 3] === 255;
                    if (found) {
                        solidFoot = row;
                        break;
                    }
                }
            }
            const footRow = margin + (piece.caster?.foot ?? solidFoot);
            for (let i = 0; i < canvas.length; i += 4) {
                if (canvas[i + 1] > 0 && canvas[i + 3] !== 255) {
                    pixels += 1;
                    const row = height - 1 - Math.floor(i / 4 / width);
                    if (Math.abs(row - footRow) <= 1) attached = true;
                }
            }
            const rows = piece.caster ? piece.caster.h : sil.foot - sil.top + 1;
            const scale = hooks.lengthScale ? hooks.lengthScale(rows, key.length, floorPx, capPx) : 1;
            measured = { pixels, length: scale * key.length * rows, attached };
            seen.set(piece.key, measured);
        }
        if (!measured.attached) floating.push({ key: piece.key, x: piece.x, y: piece.y });
        shortest = Math.min(shortest, measured.length);
        longest = Math.max(longest, measured.length);
        if (measured.pixels >= 8) withShadow += 1;
        else
            list.push({
                key: piece.key,
                x: piece.x,
                y: piece.y,
                reason: `${measured.pixels} shadow px outside its silhouette`,
                pixels: measured.pixels,
            });
    }
    return {
        withShadow,
        floating,
        list,
        lengths: Number.isFinite(shortest) ? { min: shortest, max: longest, cap: capPx } : null,
    };
}

/**
 * Every top and hang piece, alone on a canvas with a support under it (a solid block for a piece on furniture, a wall for a
 * hanging one): does it leave a shadow of its own on it? The owner asked for ALL the objects to cast; the stand pieces' check is
 * above, this is the other two kinds'. Each distinct picture once.
 */
function surfacePiecesWithoutShadow(
    source: BakeSource,
    hooks: BakeHooks,
    pieces: readonly BakePiece[],
    key: KeyLightLike,
): { tops: number; hangs: number; topsWithout: string[]; hangsWithout: string[] } {
    const { bakeCast, newCastBuffer, silhouetteOf } = hooks as Required<
        Pick<BakeHooks, "bakeCast" | "newCastBuffer" | "silhouetteOf">
    >;
    const seen = new Map<string, number>();
    const out = { tops: 0, hangs: 0, topsWithout: [] as string[], hangsWithout: [] as string[] };
    for (const piece of pieces) {
        if ((piece.kind !== "top" && piece.kind !== "hang") || !piece.silhouette) continue;
        let pixels = seen.get(piece.key);
        if (pixels === undefined) {
            const sil = piece.silhouette;
            const margin = 12;
            const width = sil.width + margin * 2;
            const height = sil.height + margin * 2;
            const block = new Uint8ClampedArray(width * height * 4).fill(255);
            const support = silhouetteOf({ data: block }, width, height);
            const canvas = newCastBuffer(width, height);
            const kind = piece.kind;
            bakeCast(
                {
                    width,
                    height,
                    pieces:
                        kind === "hang"
                            ? [{ ...piece, x: margin, y: margin }]
                            : [
                                  { key: "support", x: 0, y: 0, kind: "stand", silhouette: support, painted: false },
                                  { ...piece, x: margin, y: margin },
                              ],
                    spaces: [],
                    building: null,
                    lamps: [],
                    key: key as unknown as BakeInput["key"],
                    // a hanging piece has the wall all round it; a piece on furniture has the solid block under it
                    isWall: kind === "hang" ? () => true : undefined,
                },
                canvas,
                { contact: false, lamp: false, key: false },
            );
            pixels = 0;
            for (let i = 0; i < canvas.length; i += 4) if (canvas[i + 1] > 0 && canvas[i + 3] === 128) pixels += 1;
            seen.set(piece.key, pixels);
        }
        if (piece.kind === "top") {
            out.tops += 1;
            if (pixels < 2) out.topsWithout.push(piece.key);
        } else {
            out.hangs += 1;
            if (pixels < 2) out.hangsWithout.push(piece.key);
        }
    }
    return out;
}

/** How many pixels of a cast buffer each channel marks, inside a map rectangle (the whole map by default). */
export interface ChannelCounts {
    readonly pixels: number;
    /** R > 0: lamp light blocked. */
    readonly lamp: number;
    /** G 128 or 255: inside a key shadow, and G 255: its umbra. */
    readonly key: number;
    readonly umbra: number;
    /** B > 0: a contact band, and B 255: the hard one. */
    readonly contact: number;
    readonly hardContact: number;
    /** A 128: a surface that takes contact only; A 255: covered by a picture (not a receiver). */
    readonly surface: number;
    readonly solid: number;
}

/** The buffer's row for map row y is `height - 1 - y` (the texture is uploaded without flipping). */
export function channelCounts(
    cast: Uint8Array,
    width: number,
    height: number,
    rect: readonly [number, number, number, number] = [0, 0, width, height],
): ChannelCounts {
    const x0 = Math.max(0, Math.floor(rect[0]));
    const y0 = Math.max(0, Math.floor(rect[1]));
    const x1 = Math.min(width, Math.ceil(rect[0] + rect[2]));
    const y1 = Math.min(height, Math.ceil(rect[1] + rect[3]));
    const counts = { pixels: 0, lamp: 0, key: 0, umbra: 0, contact: 0, hardContact: 0, surface: 0, solid: 0 };
    for (let y = y0; y < y1; y++) {
        const row = (height - 1 - y) * width * 4;
        for (let x = x0; x < x1; x++) {
            const i = row + x * 4;
            counts.pixels += 1;
            if (cast[i] > 0) counts.lamp += 1;
            if (cast[i + 1] > 0) counts.key += 1;
            if (cast[i + 1] === 255) counts.umbra += 1;
            if (cast[i + 2] > 0) counts.contact += 1;
            if (cast[i + 2] === 255) counts.hardContact += 1;
            if (cast[i + 3] === 128) counts.surface += 1;
            if (cast[i + 3] === 255) counts.solid += 1;
        }
    }
    return counts;
}
