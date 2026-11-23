// The cast texture's pixels, worked out on the CPU from the map's pieces: one RGBA byte per channel for each map pixel,
// read by the camera pass (`uCast`, whole map pixels, nearest) to shade the floor and the surfaces under it.
//   R  lamp light blocked, 0..255 of 1.5 (what the shader takes off the pool there, before the night's strength); at least
//      LAMP_SHADOW_MIN anywhere in a lamp's shadow, lit or not: above 0 means "in a lamp's shadow"
//   G  the key's shadow: 0 none, 128 the outer half, 255 the umbra (the half of the length nearest the object)
//   B  contact: 0 none, 128 soft, 255 hard (the band under an object's base)
//   A  0 a floor that receives, 40 a rug or floor piece (receives, and takes no relief), 128 a surface that takes the
//      contact band and the key's shadow of what stands on it (the support of a piece on furniture, the wall behind a
//      hanging one), 255 covered by a picture
// A pixel's row is H - 1 - y in the buffer: the texture is uploaded without flipping.
// Pure: typed arrays in, typed arrays out, no clock, no allocation per pixel. The static part (solid, contact, surfaces
// and the lamps' shadows) does not depend on the hour; the key's part (G) does, so an hour's change redoes only G.
import type { CasterKind } from "./casterKind";
import type { Rect } from "./geometry";
import type { KeyLight } from "./keyLight";
import { lampDirection, lampLight, lampShadowLength, LAMP_DIRECTIONS, type CasterLamp } from "./lamps";
import { castShape, footRuns, lowerPart, lengthScale, shearRuns, type Shear, type Silhouette } from "./shadeShapes";
import type { CasterSpec } from "./effectsManifest";

export const CAST_CHANNELS = 4;
/** A shadow is at least this long, in px, so that a short object still grounds, and at most this (a lamp's: `LAMP_CAP_PX`). */
export const SHADOW_FLOOR_PX = 3;
export const SHADOW_CAP_PX = 22;
/** A lamp's shadows are longer than the key's (the owner asked for shadows cast from the lamps and saw none): 5 to 36 px. */
export const LAMP_FLOOR_PX = 5;
export const LAMP_CAP_PX = 36;
/** The far half of a lamp's shadow takes this share of the lamp's light off; the near half takes all of it. */
export const LAMP_FAR_SHARE = 0.6;
/**
 * A pixel in a lamp's shadow has at least this much in R even where the pool gives it no light: the shadow of an object near a
 * lamp is one shadow, pointing away from the lamp from its foot to its tip, and the moon's does not take over where the pool
 * ends (the reviewers saw two shadows of one plant, one each way). The shader reads R above 0 as "in a lamp's shadow".
 */
export const LAMP_SHADOW_MIN = 10;
/**
 * A shadow that lies sideways would be one pixel thick (the shear keeps only the object's front face and no depth): a table's
 * footprint is a few px deep, so a lamp's sideways shadow is filled up from the foot line by this share of the foot's width,
 * 2 to 10 px, as much as the direction is sideways.
 */
export const LAMP_DEPTH_SHARE = 0.6;
export const LAMP_DEPTH_MIN_PX = 2;
export const LAMP_DEPTH_MAX_PX = 10;
/** A piece on furniture throws a shadow of 2 to 3 px on what it stands on, along the key; one on a wall a drop shadow of 2 and 4 px. */
export const TOP_FLOOR_PX = 2;
export const TOP_CAP_PX = 3;
export const HANG_NEAR_PX = 2;
export const HANG_FAR_PX = 4;
/** How far from a piece on furniture, sideways and down, its support is marked as able to take its shadow. */
const SURFACE_ZONE = 4;
/** Alpha of a rug or floor piece: a floor that receives, with no relief (the shader reads 0.1 to 0.25 as that). */
export const FLOOR_PIECE = 40;
/**
 * The cast texture before the first bake lands: one texel, no shadow, alpha of a floor piece. A floor piece is a receiver with
 * no relief, so the props of an old build (whose normals still hold the rugs) show no stripes for the second the bake takes,
 * and nothing is shaded at all, as the dummy's zero channels say.
 */
export const CAST_DUMMY: readonly [number, number, number, number] = [0, 0, 0, FLOOR_PIECE];
const KEY_FAR = 128;
const KEY_NEAR = 255;
const SOFT = 128;
const HARD = 255;
/** The most a lamp's blocked light stores: the shader multiplies the byte back by this. */
export const BLOCKED_SCALE = 1.5;
/**
 * A lamp's casters stand inside its widest pool (the squash of the floor undone) and out to this many times its reach, at least
 * `LAMP_MIN_PX` from the spot under the lamp. At 1.1 (the pool and a little beyond) most of the office's furniture was out of
 * reach and the lamp's shadow changed 0.86% of the reception window; what stands in the pool's outer fringe or just outside still
 * is lit by the lamp's halo and by the eye, and its shadow points away from the lamp.
 */
export const LAMP_REACH_FACTOR = 1.4;
export const LAMP_MIN_PX = 10;
/**
 * A standing piece's shadow must land on the floor: at least this share of the pixels it is cast to (the rest fall on a wall, or
 * on another piece's picture). A shelf against a side wall threw its shadow into the wall, a monitor's fell on the desk's own front,
 * and nothing showed. Under the share the shadow is cast again straight down, then to the other side, and the best one is kept.
 */
export const LANDING_MIN_SHARE = 0.34;
/** ... but a shadow of fewer than this many pixels in all is not tried again (a pole's, a leg's). */
export const LANDING_MIN_PX = 12;
/**
 * A lamp's own picture casts only its lowest part: the base and the foot of its pole. Its arc and its shade hang in the air and the
 * light comes from them: cast whole, an arc lamp threw a wire of a shadow 60 px across the floor (a hoop by day).
 */
export const LAMP_OWN_SHADOW_ROWS = 0.35;
/** From this much night the key is the moon and the lamps are on: a piece near a lamp casts its one shadow away from the lamp. */
export const NIGHT_LAMPS_FROM = 0.5;
/**
 * Whether a piece carries a lamp: the foot of the lamp's own picture stands inside the piece's box (a bedside lamp on its
 * table, a lamp on a counter). The table does not throw a shadow from the lamp it holds (it came out as a block 35 px long
 * under the table); the key's shadow and the contact band ground it.
 */
export function carriesLamp(input: BakeInput, piece: BakePiece, sil: Silhouette, lamp: CasterLamp): boolean {
    const own = input.pieces[lamp.piece];
    const ownSil = own?.silhouette;
    if (!own || !ownSil || own === piece) return false;
    const [fx, fy] = footCentre(own, ownSil);
    return fx >= piece.x && fx <= piece.x + sil.width && fy >= piece.y + sil.top && fy <= piece.y + sil.foot + 1;
}

/** How a lamp's shadow of one standing piece falls: its shear and the depth a sideways shadow is filled up to. */
interface LampShadow {
    readonly shear: Shear;
    readonly depth: number;
    readonly direction: number;
    /** How far the piece's foot is from the spot under the lamp, over the lamp's reach: 0 under it, 1 at the rim. */
    readonly nearness: number;
    readonly light: number;
}

/**
 * The shadow a lamp throws from a standing piece, or null when the piece is not one of its casters: not the piece that carries it
 * and not right under it (a lamp's own picture is a caster too, from the spot under its head: an arc lamp's foot stands 45 px from
 * where its light lands and its base is lit from the head's side; a table lamp's foot is under its head and is not), inside its widest pool and a little beyond (`LAMP_REACH_FACTOR`), in the lamp's room.
 */
function lampShadowOf(input: BakeInput, piece: BakePiece, lamp: CasterLamp): LampShadow | null {
    const sil = piece.silhouette;
    if (!sil || piece.kind !== "stand" || carriesLamp(input, piece, sil, lamp)) return null;
    const [fx, fy] = footCentre(piece, sil);
    const ddx = fx - lamp.gx;
    const ddy = fy - lamp.gy;
    if (Math.hypot(ddx, ddy) < LAMP_MIN_PX) return null;
    const ground = Math.hypot(ddx, ddy / lamp.squash);
    if (ground > lamp.reach * LAMP_REACH_FACTOR) return null;
    if (regionAt(input, fx, fy) !== regionAt(input, lamp.gx, lamp.gy)) return null;
    const direction = lampDirection(ddx, ddy);
    const dir = LAMP_DIRECTIONS[direction];
    const k = lampShadowLength(ground, lamp.z);
    const footWidth = baseRuns(piece, sil).reduce((sum, [a, b]) => sum + b - a, 0);
    return {
        shear: standShear(piece, sil, dir[0] * k, dir[1] * k, k, LAMP_FLOOR_PX, LAMP_CAP_PX),
        depth: Math.round(
            Math.min(LAMP_DEPTH_MAX_PX, Math.max(LAMP_DEPTH_MIN_PX, footWidth * LAMP_DEPTH_SHARE)) *
                (1 - Math.abs(dir[1])),
        ),
        direction,
        nearness: ground / lamp.reach,
        light: lampLight(lamp, fx + 0.5, fy + 0.5),
    };
}

/** The cost of clearing 256 rows of the buffer, in the unit a slice counts (one caster). */
const CLEAR_CHUNK_ROWS = 256;
const CLEAR_COST = 64;
const LAMP_COST = 8;

/** One placed image as the bake reads it: where its top-left corner is (whole px), what it is, and its shape. */
export interface BakePiece {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly kind: CasterKind;
    /** Null when the picture could not be read: such a piece casts nothing and hides nothing. */
    readonly silhouette: Silhouette | null;
    /** Its picture has a painted contact shadow: no contact band is drawn for it. */
    readonly painted: boolean;
    /** The manifest's caster entry for the piece, as `placedCaster` made it: its shadow's length comes from it, not from its rows. */
    readonly caster?: BakeCaster | null;
}

/**
 * What a caster entry of the manifest says of a placed piece, in the placed silhouette's own rows and columns: the height of the
 * part that throws the shadow (px), the row of its base and the columns [x0, x1) of its footprint (null: the whole foot row).
 */
export interface BakeCaster {
    readonly h: number;
    readonly foot: number | null;
    readonly span: readonly [number, number] | null;
}

/**
 * A manifest's caster entry for a piece placed with `sil` (already resampled to the size it is drawn at and mirrored when
 * flipped) from a sprite `sourceWidth` x `sourceHeight`: the foot and the span follow the resampling and the mirror, the height
 * is in px of the map and so is not scaled. Null when there is no entry or the entry does not fit the picture.
 */
export function placedCaster(
    entry: CasterSpec | undefined,
    sil: Silhouette | null,
    sourceWidth: number,
    sourceHeight: number,
    flipX: boolean,
): BakeCaster | null {
    if (!entry || !sil || !(entry.h > 0)) return null;
    const rowScale = sil.height / Math.max(1, sourceHeight);
    const colScale = sil.width / Math.max(1, sourceWidth);
    const foot = entry.foot === undefined ? null : Math.min(sil.height - 1, Math.floor((entry.foot + 0.5) * rowScale));
    let span: [number, number] | null = null;
    if (entry.span) {
        let x0 = Math.round(entry.span[0] * colScale);
        let x1 = Math.round(entry.span[1] * colScale);
        if (flipX) [x0, x1] = [sil.width - x1, sil.width - x0];
        if (x1 > x0) span = [x0, x1];
    }
    return { h: entry.h, foot, span };
}

/** A string that changes when, and only when, the casters do: the bake's states are taken again when it does. */
export function castersSignature(casters: Readonly<Record<string, CasterSpec>> | undefined): string {
    if (!casters) return "";
    return Object.keys(casters)
        .sort()
        .map((key) => {
            const c = casters[key];
            return `${key}:${c.h},${c.foot ?? ""},${c.span ? `${c.span[0]}-${c.span[1]}` : ""}`;
        })
        .join(";");
}

/** The row a caster piece's base is on: its entry's `foot` when a row of the picture holds it, else the lowest opaque row. */
function baseRow(piece: BakePiece, sil: Silhouette): number {
    const foot = piece.caster?.foot;
    if (foot === null || foot === undefined || foot < sil.top) return sil.foot;
    return Math.min(foot, sil.height - 1);
}

/** The runs of the base row, or of the nearest row above it that has some (a base row under the lowest opaque row has none). */
function baseRuns(piece: BakePiece, sil: Silhouette): [number, number][] {
    if (!piece.caster) return footRuns(sil);
    let row = Math.min(baseRow(piece, sil), sil.foot);
    while (row > sil.top && sil.starts[row] === sil.starts[row + 1]) row -= 1;
    const out: [number, number][] = [];
    const span = piece.caster.span;
    for (let k = sil.starts[row]; k < sil.starts[row + 1]; k++) {
        const a = span ? Math.max(sil.runs[k * 2], span[0]) : sil.runs[k * 2];
        const b = span ? Math.min(sil.runs[k * 2 + 1], span[1]) : sil.runs[k * 2 + 1];
        if (b > a) out.push([a, b]);
    }
    return out.length > 0 ? out : footRuns(sil);
}

/**
 * The shear of a standing piece's shadow along (sx, sy) per px of height, `length` being the light's shadow per px of height.
 * Without a caster entry the piece's rows are its height. With one the length comes from its `h` (kept between `lo` and `hi`),
 * the shadow starts at the piece's base row, and a piece lower than its rows is a box: its first `h` rows are its front face and
 * the rows over them its top face, whose px up the screen are depth (`Shear`). So a flat piece's shadow peeks out of its picture
 * by about `h` along the light, and a piece whose `h` is its rows (or more) is sheared as a wall, as it always was.
 */
function standShear(
    piece: BakePiece,
    sil: Silhouette,
    sx: number,
    sy: number,
    length: number,
    lo: number,
    hi: number,
): Shear {
    const c = piece.caster;
    if (!c) return { sx, sy, m: lengthScale(sil.foot - sil.top + 1, length, lo, hi) };
    const foot = baseRow(piece, sil);
    const rows = Math.max(1, foot - sil.top + 1);
    // a piece at least as tall as its rows is a wall; a lower one is a box: `h` rows of front face, the rest of its rows a top face
    return c.h >= rows
        ? { sx, sy, m: lengthScale(c.h, length, lo, hi), foot, rise: c.h / rows }
        : { sx, sy, m: lengthScale(c.h, length, lo, hi), foot, cap: c.h };
}

export interface BakeInput {
    /** The map's size in px, and so the buffer's: `width * height * 4` bytes. */
    readonly width: number;
    readonly height: number;
    readonly pieces: readonly BakePiece[];
    /** The room floors: a shadow stays in the room its object stands in. */
    readonly spaces: readonly Rect[];
    /** The building's outline: a shadow of the garden stays out of it, and the hall's stays in it. */
    readonly building: Rect | null;
    /** The lamps that cast, as `casterLampsFrom` made them from `pieces`, in the same order. */
    readonly lamps: readonly CasterLamp[];
    readonly key: KeyLight;
    /** Whether a map pixel is a wall (for the drop edge of a piece hung on one). */
    readonly isWall?: (x: number, y: number) => boolean;
}

/**
 * Which elements to bake (all of them by default): the lab isolates one at a time. `key` is the standing pieces' shadows on the
 * floor, `surface` the contact ring and the shadows of what is on furniture and on a wall (hour-dependent too).
 */
export interface BakeOptions {
    readonly solid?: boolean;
    readonly contact?: boolean;
    readonly key?: boolean;
    readonly lamp?: boolean;
    readonly surface?: boolean;
}

/** Which of the two independent parts a job redoes: what the hour does not touch, and what it does. */
export interface BakeParts {
    readonly fixed: boolean;
    readonly key: boolean;
}

export interface BakeStats {
    casters: number;
    solidPixels: number;
    contactPixels: number;
    keyPixels: number;
    lampPixels: number;
    surfacePixels: number;
    /** Pixels a piece on furniture or on a wall shades on what holds it. */
    surfaceShadowPixels: number;
    lampsWithShadow: number;
}

/** A piece's room: the index of the space holding its foot, -1 outside the building, -2 in the hall. */
function regionAt(input: BakeInput, x: number, y: number): number {
    const { spaces, building } = input;
    for (let i = 0; i < spaces.length; i++) {
        const r = spaces[i];
        if (x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]) return i;
    }
    if (
        building &&
        !(x >= building[0] && y >= building[1] && x < building[0] + building[2] && y < building[1] + building[3])
    ) {
        return -1;
    }
    return building ? -2 : -1;
}

function inRegion(input: BakeInput, region: number, x: number, y: number): boolean {
    if (region >= 0) {
        const r = input.spaces[region];
        return x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];
    }
    return regionAt(input, x, y) === region;
}

/** The centre of a piece's foot row in map px: where its shadow starts, and what room it stands in. */
function footCentre(piece: BakePiece, sil: Silhouette): [number, number] {
    if (piece.caster) {
        const runs = baseRuns(piece, sil);
        return [piece.x + (runs[0][0] + runs[runs.length - 1][1]) / 2, piece.y + baseRow(piece, sil)];
    }
    const first = sil.starts[sil.foot];
    const last = sil.starts[sil.foot + 1];
    return [piece.x + (sil.runs[first * 2] + sil.runs[last * 2 - 1]) / 2, piece.y + sil.foot];
}

/**
 * The bake, in slices: `step(budget)` does work worth `budget` casters and says whether it is finished. A slice is
 * counted in items (casters, a lamp counting for 8, 256 rows cleared for 64), never in time, so a run is the same
 * on any machine. All of it goes into `out`, the CPU copy; the caller puts it on the GPU once, when it is finished.
 */
export class CastBake {
    readonly stats: BakeStats = {
        casters: 0,
        solidPixels: 0,
        contactPixels: 0,
        keyPixels: 0,
        lampPixels: 0,
        surfacePixels: 0,
        surfaceShadowPixels: 0,
        lampsWithShadow: 0,
    };
    private readonly phases: { total: number; cost: number; run: (i: number) => void }[] = [];
    private phase = 0;
    private item = 0;
    private scratch = new Uint8Array(0);
    /** The pieces that are a lamp's own picture: they cast their lowest part only (`LAMP_OWN_SHADOW_ROWS`). */
    private readonly ownPieces: ReadonlySet<number>;
    /** At night: for each piece, the lamp whose shadow of it is its one shadow (-1 for none). Empty by day. */
    private lampOf: Int16Array = new Int16Array(0);
    private readonly w: number;
    private readonly h: number;

    constructor(
        private readonly input: BakeInput,
        private readonly out: Uint8Array,
        private readonly options: BakeOptions = {},
        readonly parts: BakeParts = { fixed: true, key: true },
    ) {
        this.w = input.width;
        this.h = input.height;
        this.ownPieces = new Set(input.lamps.map((l) => l.piece));
        if (out.length !== this.w * this.h * CAST_CHANNELS) {
            throw new Error(`the cast buffer holds ${out.length} bytes, not ${this.w * this.h * CAST_CHANNELS}`);
        }
        const n = input.pieces.length;
        const on = (flag: boolean | undefined): boolean => flag !== false;
        const chunks = Math.ceil(this.h / CLEAR_CHUNK_ROWS);
        if (parts.fixed) {
            this.add(chunks, CLEAR_COST, (i) => this.clear(i, [0, 2, 3]));
            if (on(options.solid)) this.add(n, 1, (i) => this.solid(i));
            if (on(options.contact)) this.add(n, 1, (i) => this.contact(i));
            if (on(options.surface)) this.add(n, 1, (i) => this.surface(i));
            if (on(options.lamp)) this.add(input.lamps.length, LAMP_COST, (i) => this.lamp(i));
        }
        if (parts.key) {
            if (input.key.nightMix >= NIGHT_LAMPS_FROM && input.lamps.length > 0) this.pickLamps();
            this.add(chunks, CLEAR_COST, (i) => this.clear(i, [1]));
            if (on(options.key) || on(options.surface)) this.add(n, 1, (i) => this.key(i));
        }
    }

    private add(total: number, cost: number, run: (i: number) => void): void {
        if (total > 0) this.phases.push({ total, cost, run });
    }

    get done(): boolean {
        return this.phase >= this.phases.length;
    }

    /** Does work worth `budget` casters; true when the whole bake is done. */
    step(budget: number): boolean {
        let left = budget;
        while (left > 0 && this.phase < this.phases.length) {
            const phase = this.phases[this.phase];
            phase.run(this.item);
            left -= phase.cost;
            this.item += 1;
            if (this.item >= phase.total) {
                this.phase += 1;
                this.item = 0;
            }
        }
        return this.done;
    }

    private clear(chunk: number, channels: readonly number[]): void {
        const row0 = chunk * CLEAR_CHUNK_ROWS;
        const row1 = Math.min(this.h, row0 + CLEAR_CHUNK_ROWS);
        const out = this.out;
        const from = row0 * this.w * CAST_CHANNELS;
        const to = row1 * this.w * CAST_CHANNELS;
        if (channels.length === 1) {
            const c = channels[0];
            for (let i = from + c; i < to; i += CAST_CHANNELS) out[i] = 0;
        } else {
            for (let i = from; i < to; i += CAST_CHANNELS) {
                out[i] = 0;
                out[i + 2] = 0;
                out[i + 3] = 0;
            }
        }
    }

    /** The index of channel `c` of the map pixel (x, y), or -1 outside the map. */
    private at(x: number, y: number, c: number): number {
        return x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : ((this.h - 1 - y) * this.w + x) * CAST_CHANNELS + c;
    }

    private solid(i: number): void {
        const piece = this.input.pieces[i];
        const sil = piece.silhouette;
        if (!sil) return;
        const out = this.out;
        // A rug or floor piece covers nothing and receives shadows like the floor, but it is marked (alpha 40) so that the
        // camera pass gives it no relief even where the normal map has pixels under it (a map built before the build
        // stopped stamping floor pieces: the owner saw stripes on a rug's border).
        const floor = piece.kind === "floor";
        for (let r = sil.top; r <= sil.foot; r++) {
            const y = piece.y + r;
            for (let k = sil.starts[r]; k < sil.starts[r + 1]; k++) {
                const x0 = Math.max(0, piece.x + sil.runs[k * 2]);
                const x1 = Math.min(this.w, piece.x + sil.runs[k * 2 + 1]);
                const base = this.at(0, y, 3);
                if (base < 0) continue;
                if (floor) {
                    for (let x = x0; x < x1; x++)
                        if (out[base + x * CAST_CHANNELS] === 0) out[base + x * CAST_CHANNELS] = FLOOR_PIECE;
                    continue;
                }
                for (let x = x0; x < x1; x++) out[base + x * CAST_CHANNELS] = 255;
                this.stats.solidPixels += Math.max(0, x1 - x0);
            }
        }
    }

    private contact(i: number): void {
        const piece = this.input.pieces[i];
        const sil = piece.silhouette;
        if (!sil || piece.kind !== "stand" || piece.painted) return;
        const foot = piece.caster ? baseRow(piece, sil) : sil.foot;
        for (const [a, b] of baseRuns(piece, sil)) {
            this.band(piece.x + a - 1, piece.x + b + 1, piece.y + foot + 1, HARD);
            this.band(piece.x + a, piece.x + b, piece.y + foot + 2, SOFT);
            for (let d = 0; d <= 2; d++) this.band(piece.x + a - 1, piece.x + b + 1, piece.y + foot - d, SOFT);
        }
    }

    private band(x0: number, x1: number, y: number, value: number): void {
        const base = this.at(0, y, 2);
        if (base < 0) return;
        const out = this.out;
        for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) {
            const j = base + x * CAST_CHANNELS;
            if (out[j] < value) {
                out[j] = value;
                this.stats.contactPixels += 1;
            }
        }
    }

    /**
     * A piece on furniture or on a wall: a ring of contact (1 px, soft) on what holds it, and that support marked (alpha 128)
     * as far as its shadow can reach, sideways and down, so the key's part can put the shadow there. The static part: the
     * hour decides only what lands on the marked pixels.
     */
    private surface(i: number): void {
        const piece = this.input.pieces[i];
        const sil = piece.silhouette;
        if (!sil || (piece.kind !== "top" && piece.kind !== "hang")) return;
        const hang = piece.kind === "hang";
        const pad = SURFACE_ZONE + 1;
        const w = sil.width + pad * 2;
        const h = sil.height + pad * 2;
        const own = new Uint8Array(w * h);
        const zone = new Uint8Array(w * h);
        for (let r = sil.top; r <= sil.foot; r++) {
            for (let k = sil.starts[r]; k < sil.starts[r + 1]; k++) {
                const x0 = sil.runs[k * 2];
                const x1 = sil.runs[k * 2 + 1];
                for (let x = x0; x < x1; x++) own[(r + pad) * w + x + pad] = 1;
                // the zone: the run grown sideways, copied down
                for (let d = 0; d <= SURFACE_ZONE; d++) {
                    const row = (r + pad + d) * w;
                    for (let x = x0 - SURFACE_ZONE; x < x1 + SURFACE_ZONE; x++) zone[row + x + pad] = 1;
                }
            }
        }
        const has = (x: number, y: number): boolean => own[(y + pad) * w + x + pad] === 1;
        for (let y = sil.top - 1; y <= sil.foot + SURFACE_ZONE; y++) {
            for (let x = -SURFACE_ZONE; x < sil.width + SURFACE_ZONE; x++) {
                if (has(x, y) || zone[(y + pad) * w + x + pad] === 0) continue;
                const mx = piece.x + x;
                const my = piece.y + y;
                const a = this.at(mx, my, 3);
                if (a < 0) continue;
                // what holds a piece on furniture is another piece (solid); what holds a hanging one is the wall behind it
                const supported = hang
                    ? this.input.isWall?.(mx, my) === true && this.out[a] !== 255
                    : this.out[a] === 255;
                if (!supported) continue;
                this.out[a] = 128;
                if (has(x - 1, y) || has(x + 1, y) || has(x, y - 1) || has(x, y + 1)) {
                    if (this.out[a - 1] < SOFT) {
                        this.out[a - 1] = SOFT;
                        this.stats.surfacePixels += 1;
                    }
                }
            }
        }
    }

    private key(i: number): void {
        const input = this.input;
        const piece = input.pieces[i];
        const sil = piece.silhouette;
        if (!sil) return;
        const floor = this.options.key !== false;
        const surface = this.options.surface !== false;
        if (piece.kind === "top" && surface) this.keyOnSupport(piece, sil);
        else if (piece.kind === "hang" && surface) this.keyOnWall(piece, sil);
        else if (piece.kind === "stand" && floor) this.keyOnFloor(i, piece, sil);
    }

    /** The shape piece `i` casts from: its silhouette without what hangs in the air (thin runs, a fragment's gaps, a lamp's arc). */
    private shadowShape(i: number, sil: Silhouette): Silhouette {
        return castShape(this.ownPieces.has(i) ? lowerPart(sil, LAMP_OWN_SHADOW_ROWS) : sil);
    }

    /**
     * At night every standing piece near a lamp has the lamp's shadow as its one shadow: the lamp that lights its foot the most (or,
     * outside every pool, the nearest), in the shape and direction the lamp's own pass casts it (`lampShadowOf`). The moon's
     * shadow of it is not cast at all, so the two do not cross (the lounge's big plant had a dark patch each side of its pot, the
     * key's on the left and the lamp's on the right). Pieces no lamp reaches keep the moon's.
     */
    private pickLamps(): void {
        const input = this.input;
        const n = input.pieces.length;
        this.lampOf = new Int16Array(n).fill(-1);
        for (let p = 0; p < n; p++) {
            const piece = input.pieces[p];
            if (piece.kind !== "stand") continue;
            let best = -1;
            let bestLight = -1;
            let bestNear = Number.POSITIVE_INFINITY;
            for (let l = 0; l < input.lamps.length; l++) {
                const hit = lampShadowOf(input, piece, input.lamps[l]);
                if (!hit) continue;
                if (hit.light > bestLight || (hit.light === bestLight && hit.nearness < bestNear)) {
                    best = l;
                    bestLight = hit.light;
                    bestNear = hit.nearness;
                }
            }
            this.lampOf[p] = best;
        }
    }

    /**
     * Casts a standing piece's shadow along `shear` onto the floor and returns how many of its pixels landed on a receiver (not a
     * wall, not under another picture, inside its room) and how many it had in all. With `write` it puts them in G as the key's
     * two bands; without, it only counts.
     */
    private castOnFloor(
        piece: BakePiece,
        shape: Silhouette,
        shear: Shear,
        depth: number,
        region: number,
        write: boolean,
    ): { landed: number; total: number } {
        const input = this.input;
        const out = this.out;
        const isWall = input.isWall;
        let landed = 0;
        let total = 0;
        shearRuns(shape, piece.x, piece.y, shear, (y0, x0, x1, share) => {
            const value = share < 0.5 ? KEY_NEAR : KEY_FAR;
            for (let up = 0; up <= depth; up++) {
                const y = y0 - up;
                const base = this.at(0, y, 1);
                if (base < 0) continue;
                for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) {
                    total += 1;
                    if (!inRegion(input, region, x, y)) continue;
                    const j = base + x * CAST_CHANNELS;
                    const a = out[j + 2];
                    if (a !== 0 && a !== FLOOR_PIECE) continue; // a picture covers it, or it is a surface with a shadow of its own
                    if (isWall?.(x, y) === true) continue;
                    landed += 1;
                    if (write && out[j] < value) {
                        out[j] = value;
                        this.stats.keyPixels += 1;
                    }
                }
            }
        });
        return { landed, total };
    }

    /** A standing piece's shadow, on the floor: where the floor receives (a picture on the pixel hides it, a wall does not take it). */
    private keyOnFloor(i: number, piece: BakePiece, shape: Silhouette): void {
        const input = this.input;
        const sil = this.shadowShape(i, shape);
        const k = input.key;
        const [fx, fy] = footCentre(piece, shape);
        const region = regionAt(input, fx, fy);
        this.stats.casters += 1;
        // the light's own direction: the lamp's at night where one reaches the piece, else the key's
        const lamp = this.lampOf.length > 0 ? this.lampOf[i] : -1;
        const byLamp = lamp >= 0 ? lampShadowOf(input, piece, input.lamps[lamp]) : null;
        const first: { shear: Shear; depth: number } = byLamp ?? {
            shear: standShear(piece, shape, k.dx * k.length, k.dy * k.length, k.length, SHADOW_FLOOR_PX, SHADOW_CAP_PX),
            depth: 0,
        };
        let best = first;
        let counted = this.castOnFloor(piece, sil, first.shear, first.depth, region, false);
        if (counted.total >= LANDING_MIN_PX && counted.landed < counted.total * LANDING_MIN_SHARE) {
            // most of it fell on a wall or a picture: down the screen, then to the other side, and the best of the three is kept
            const mx = first.shear.sx;
            const my = first.shear.sy;
            const lengthy = Math.max(Math.hypot(mx, my), 0.2);
            const tries: Shear[] = [
                { ...first.shear, sx: 0, sy: lengthy },
                { ...first.shear, sx: -mx, sy: Math.max(my, 0.2) },
            ];
            for (const shear of tries) {
                const c = this.castOnFloor(piece, sil, shear, 0, region, false);
                if (c.landed > counted.landed) {
                    counted = c;
                    best = { shear, depth: 0 };
                }
                if (c.landed >= c.total * LANDING_MIN_SHARE) break;
            }
        }
        this.castOnFloor(piece, sil, best.shear, best.depth, region, true);
    }

    /** A piece on furniture: a shadow of 2 to 3 px on the pixels of its support that the static part marked. */
    private keyOnSupport(piece: BakePiece, shape: Silhouette): void {
        const k = this.input.key;
        const height = shape.foot - shape.top + 1;
        const shear: Shear = {
            sx: k.dx * k.length,
            sy: k.dy * k.length,
            m: lengthScale(height, k.length, TOP_FLOOR_PX, TOP_CAP_PX),
        };
        this.shadowOnSurface(piece, castShape(shape), shear);
    }

    private shadowOnSurface(piece: BakePiece, sil: Silhouette, shear: Shear): void {
        const out = this.out;
        shearRuns(sil, piece.x, piece.y, shear, (y, x0, x1, share) => {
            const base = this.at(0, y, 1);
            if (base < 0) return;
            const value = share < 0.5 ? KEY_NEAR : KEY_FAR;
            for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) {
                const j = base + x * CAST_CHANNELS;
                if (out[j + 2] !== 128) continue;
                if (out[j] < value) {
                    out[j] = value;
                    this.stats.surfaceShadowPixels += 1;
                }
            }
        });
    }

    /** A hanging piece: a drop shadow on the wall behind it, the silhouette moved along the key by 2 px (near) and 4 px (far). */
    private keyOnWall(piece: BakePiece, sil: Silhouette): void {
        const k = this.input.key;
        const out = this.out;
        for (const [far, px] of [
            [true, HANG_FAR_PX],
            [false, HANG_NEAR_PX],
        ] as const) {
            const ox = Math.round(k.dx * px);
            const oy = Math.max(1, Math.round(k.dy * px * 0.5));
            for (let r = sil.top; r <= sil.foot; r++) {
                const y = piece.y + r + oy;
                const base = this.at(0, y, 1);
                if (base < 0) continue;
                for (let n = sil.starts[r]; n < sil.starts[r + 1]; n++) {
                    for (
                        let x = Math.max(0, piece.x + sil.runs[n * 2] + ox);
                        x < Math.min(this.w, piece.x + sil.runs[n * 2 + 1] + ox);
                        x++
                    ) {
                        const j = base + x * CAST_CHANNELS;
                        const value = far ? KEY_FAR : KEY_NEAR;
                        if (out[j + 2] !== 128 || out[j] >= value) continue;
                        out[j] = value;
                        this.stats.surfaceShadowPixels += 1;
                    }
                }
            }
        }
    }

    /**
     * A lamp's shadows: every caster inside its pool shears away from the spot under the lamp into one mask, two bands
     * (the near half takes all of the lamp's light off the pixel, the far half `LAMP_FAR_SHARE` of it), then the mask is
     * turned into the light taken off. Many lamps add up.
     */
    private lamp(i: number): void {
        const input = this.input;
        const lamp = input.lamps[i];
        // the box the lamp's pools can reach, to size the mask
        let bx0 = Infinity;
        let by0 = Infinity;
        let bx1 = -Infinity;
        let by1 = -Infinity;
        for (const p of lamp.pools) {
            const ry = Math.abs(p.reach) * Math.max(1, p.squash) + LAMP_CAP_PX;
            const rx = Math.abs(p.reach) + LAMP_CAP_PX;
            bx0 = Math.min(bx0, Math.floor(p.x - rx));
            bx1 = Math.max(bx1, Math.ceil(p.x + rx));
            by0 = Math.min(by0, Math.floor(p.y - ry));
            by1 = Math.max(by1, Math.ceil(p.y + ry));
        }
        const bw = bx1 - bx0 + 1;
        const bh = by1 - by0 + 1;
        if (this.scratch.length < bw * bh) this.scratch = new Uint8Array(bw * bh);
        const mask = this.scratch;
        mask.fill(0, 0, bw * bh);
        const lampRegion = regionAt(input, lamp.gx, lamp.gy);
        let any = false;
        for (let p = 0; p < input.pieces.length; p++) {
            const piece = input.pieces[p];
            const sil = piece.silhouette;
            const hit = sil ? lampShadowOf(input, piece, lamp) : null;
            if (!sil || !hit) continue;
            const { shear, depth } = hit;
            shearRuns(this.shadowShape(p, sil), piece.x, piece.y, shear, (y0, x0, x1, share) => {
                const value = share < 0.5 ? 1 : 2;
                for (let up = 0; up <= depth; up++) {
                    const y = y0 - up;
                    if (y < by0 || y > by1) continue;
                    for (let x = Math.max(bx0, x0); x < Math.min(bx1 + 1, x1); x++) {
                        if (inRegion(input, lampRegion, x, y)) {
                            const at = (y - by0) * bw + (x - bx0);
                            if (mask[at] === 0 || value < mask[at]) mask[at] = value;
                            any = true;
                        }
                    }
                }
            });
        }
        if (!any) return;
        this.stats.lampsWithShadow += 1;
        const out = this.out;
        for (let y = Math.max(0, by0); y <= Math.min(this.h - 1, by1); y++) {
            for (let x = Math.max(0, bx0); x <= Math.min(this.w - 1, bx1); x++) {
                const m = mask[(y - by0) * bw + (x - bx0)];
                if (m === 0) continue;
                const j = this.at(x, y, 0);
                if (out[j + 3] === 255) continue; // under a picture: no light to take off
                const blocked = lampLight(lamp, x + 0.5, y + 0.5) * (m === 1 ? 1 : LAMP_FAR_SHARE);
                const add = Math.max(LAMP_SHADOW_MIN, Math.round(Math.min(1, blocked / BLOCKED_SCALE) * 255));
                const was = out[j];
                out[j] = Math.min(255, was + add);
                if (out[j] !== was) this.stats.lampPixels += 1;
            }
        }
    }
}

/**
 * The stand pieces a lamp's shadows are cast from, by index into `input.pieces`: inside the widest pool (the squash of
 * the floor undone) and a little beyond, in the lamp's room, not the lamp itself and not right under it. The lab prints these.
 */
export function lampCasters(input: BakeInput, lampIndex: number): number[] {
    const lamp = input.lamps[lampIndex];
    const found: number[] = [];
    // the lamp's own picture casts too (its base), but it is not what the lamp's shadows are cast from: the lab asks for the furniture
    for (let p = 0; p < input.pieces.length; p++) {
        if (p !== lamp.piece && lampShadowOf(input, input.pieces[p], lamp) !== null) found.push(p);
    }
    return found;
}

/** The whole bake at once, into `out` (cleared first): for the lab and the tests. The sliced run gives the same bytes. */
export function bakeCast(input: BakeInput, out: Uint8Array, options: BakeOptions = {}): BakeStats {
    const job = new CastBake(input, out, options);
    while (!job.step(1 << 20)) {
        // each step runs to the end; the loop is for the contract's sake
    }
    return job.stats;
}

/** The empty buffer for a map: nothing is a receiver until the first bake finishes, so nothing is shaded. */
export function newCastBuffer(width: number, height: number): Uint8Array {
    return new Uint8Array(width * height * CAST_CHANNELS);
}
