// A piece's shape, for the shadows: the rows of its opaque pixels as runs, kept as typed arrays. A piece is measured once
// per sprite key and then shifted and sheared as often as the bake needs, so everything here is whole pixels.

/** The solid pixels of a picture (alpha of `SOLID_ALPHA` or more) as the runs of each row, [x0, x1) pairs. */
export interface Silhouette {
    readonly width: number;
    readonly height: number;
    /** The first and the lowest row with an opaque pixel: the top of the piece and its foot. */
    readonly top: number;
    readonly foot: number;
    /** Row r's runs are `runs[starts[r] * 2 .. starts[r + 1] * 2)`. */
    readonly starts: Int32Array;
    readonly runs: Int32Array;
}

/** RGBA pixels as a canvas gives them. */
export interface Rgba {
    readonly data: ArrayLike<number>;
}

/**
 * Alpha from which a pixel is the piece and not a layer drawn on it. The art is binary (0 or 255) except for the layers a
 * picture carries on purpose: a painted contact shadow (alpha 128 to 166 in the lounge's pieces) and a lamp's baked pool of
 * light (130 to 155 under the bedside tables). Read at 128, that pool was a part of the piece: the foot of the nightstand
 * moved to the pool's lowest row and its shadow floated 16 px below it (the reviewer saw a dark oval detached from the
 * table). tools/kinds.py reads the same bound (`SOLID_ALPHA`), and tools/normals.py already counts only alpha 255 as geometry.
 */
export const SOLID_ALPHA = 200;

/** The silhouette of RGBA pixels, or null when no pixel is solid. Alpha of `SOLID_ALPHA` or more is the piece. */
export function silhouetteOf({ data }: Rgba, width: number, height: number): Silhouette | null {
    const starts = new Int32Array(height + 1);
    let runs = new Int32Array(Math.max(16, height * 4));
    let count = 0;
    let top = -1;
    let foot = -1;
    for (let y = 0; y < height; y++) {
        starts[y] = count;
        let x = 0;
        const row = y * width * 4 + 3;
        while (x < width) {
            while (x < width && data[row + x * 4] < SOLID_ALPHA) x += 1;
            if (x >= width) break;
            const x0 = x;
            while (x < width && data[row + x * 4] >= SOLID_ALPHA) x += 1;
            if (count * 2 + 2 > runs.length) {
                const bigger = new Int32Array(runs.length * 2);
                bigger.set(runs);
                runs = bigger;
            }
            runs[count * 2] = x0;
            runs[count * 2 + 1] = x;
            count += 1;
        }
        if (count > starts[y]) {
            if (top < 0) top = y;
            foot = y;
        }
    }
    starts[height] = count;
    if (top < 0) return null;
    return { width, height, top, foot, starts, runs: runs.slice(0, count * 2) };
}

/**
 * The silhouette as the piece is placed: mirrored when flipped and resampled (nearest) to the size it is drawn at. The
 * same silhouette is returned when nothing changes.
 */
export function placedSilhouette(
    sil: Silhouette,
    displayWidth: number,
    displayHeight: number,
    flipX: boolean,
): Silhouette {
    const w = Math.max(1, Math.round(displayWidth));
    const h = Math.max(1, Math.round(displayHeight));
    if (w === sil.width && h === sil.height && !flipX) return sil;
    const starts = new Int32Array(h + 1);
    const out: number[] = [];
    let top = -1;
    let foot = -1;
    for (let y = 0; y < h; y++) {
        starts[y] = out.length / 2;
        const sy = Math.min(sil.height - 1, Math.floor(((y + 0.5) * sil.height) / h));
        const first = sil.starts[sy];
        const last = sil.starts[sy + 1];
        // runs of the source row, scaled and (flipped) in source order; a flipped row lists its runs right to left
        const rowRuns: [number, number][] = [];
        for (let r = first; r < last; r++) {
            let x0 = Math.round((sil.runs[r * 2] * w) / sil.width);
            let x1 = Math.round((sil.runs[r * 2 + 1] * w) / sil.width);
            if (flipX) [x0, x1] = [w - x1, w - x0];
            if (x1 > x0) rowRuns.push([x0, x1]);
        }
        rowRuns.sort((a, b) => a[0] - b[0]);
        for (const [x0, x1] of rowRuns) out.push(x0, x1);
        if (rowRuns.length > 0) {
            if (top < 0) top = y;
            foot = y;
        }
    }
    starts[h] = out.length / 2;
    return { width: w, height: h, top: Math.max(top, 0), foot: Math.max(foot, 0), starts, runs: Int32Array.from(out) };
}

/** The pixels of the foot row (the lowest row with an opaque pixel) as [x0, x1) runs: the base a contact band is under. */
export function footRuns(sil: Silhouette): [number, number][] {
    const out: [number, number][] = [];
    for (let r = sil.starts[sil.foot]; r < sil.starts[sil.foot + 1]; r++)
        out.push([sil.runs[r * 2], sil.runs[r * 2 + 1]]);
    return out;
}

/**
 * A pixel of a painted shadow: partial alpha (above 0, under `SOLID_ALPHA`) and dark, every colour channel under this.
 * A lamp's baked pool of light is partial alpha too, but warm and bright: it is not a shadow.
 */
export const PAINTED_DARK_BELOW = 128;
export const PAINTED_MIN_PX = 6;

/**
 * Whether a picture carries a painted contact shadow of its own: at least six DARK pixels with partial alpha (above 0,
 * under `SOLID_ALPHA`) in the bottom quarter of the rows its silhouette covers, or below its foot. The build lists these
 * keys for the pieces it knows (tools/kinds.py `painted_shadow`, the same rule on the same pixels); this reads the picture
 * of a piece the editor added since.
 */
export function hasPaintedShadow({ data }: Rgba, width: number, height: number, sil: Silhouette): boolean {
    const rows = sil.foot - sil.top + 1;
    const from = sil.foot - Math.max(1, Math.ceil(rows / 4)) + 1;
    let partial = 0;
    for (let y = from; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const a = data[i + 3];
            if (
                a > 0 &&
                a < SOLID_ALPHA &&
                data[i] < PAINTED_DARK_BELOW &&
                data[i + 1] < PAINTED_DARK_BELOW &&
                data[i + 2] < PAINTED_DARK_BELOW
            ) {
                partial += 1;
            }
        }
    }
    return partial >= PAINTED_MIN_PX;
}

/**
 * The runs of a silhouette with every gap of `maxGap` px or less inside a row closed: a plant's leaves, drawn apart by a pixel
 * or two, become one mass, so its shadow is one shape and not a scatter of specks (the bird of paradise at the pool room's ledge
 * threw 4 to 8 px specks, the lounge's big plant a thin tail). The foot row is left as it is: the legs of a table keep theirs.
 */
export function closeGaps(sil: Silhouette, maxGap = 3): Silhouette {
    const starts = new Int32Array(sil.height + 1);
    const runs: number[] = [];
    for (let r = 0; r < sil.height; r++) {
        starts[r] = runs.length / 2;
        const first = sil.starts[r];
        const last = sil.starts[r + 1];
        let x0 = 0;
        let x1 = 0;
        for (let k = first; k < last; k++) {
            const a = sil.runs[k * 2];
            const b = sil.runs[k * 2 + 1];
            if (k > first && a - x1 <= maxGap && r !== sil.foot) {
                x1 = b;
            } else {
                if (k > first) runs.push(x0, x1);
                x0 = a;
                x1 = b;
            }
        }
        if (last > first) runs.push(x0, x1);
    }
    starts[sil.height] = runs.length / 2;
    return { ...sil, starts, runs: Int32Array.from(runs) };
}

/**
 * The lowest `fraction` of a silhouette's rows, from the foot up, as a silhouette of its own (the rest cut away): the base and the
 * foot of the pole of a lamp, whose arc and shade hang in the air and whose light comes from them. The foot row stays the foot.
 */
export function lowerPart(sil: Silhouette, fraction: number): Silhouette {
    const rows = sil.foot - sil.top + 1;
    const keep = Math.max(1, Math.ceil(rows * fraction));
    const from = sil.foot - keep + 1;
    if (from <= sil.top) return sil;
    const starts = new Int32Array(sil.height + 1);
    const runs: number[] = [];
    for (let r = 0; r < sil.height; r++) {
        starts[r] = runs.length / 2;
        if (r < from) continue;
        for (let k = sil.starts[r]; k < sil.starts[r + 1]; k++) runs.push(sil.runs[k * 2], sil.runs[k * 2 + 1]);
    }
    starts[sil.height] = runs.length / 2;
    return { ...sil, top: from, starts, runs: Int32Array.from(runs) };
}

/** A silhouette is fragmented (leaves, a fringe) when its rows hold more than this many runs on average. */
export const FRAGMENTED_RUNS_PER_ROW = 2.4;

/**
 * The shape a shadow is cast from: the silhouette without the runs thinner than `minWidth` px above its lowest rows, and, when
 * it is fragmented (leaves), with the gaps between its runs closed. A leaf's stem, a one-pixel cord or a loose fringe throws a
 * root-like thread under the pot; a leg at the foot keeps its shadow (the lowest `keepRows` rows are untouched, and the foot row
 * never moves, so the shadow stays anchored). When half of the piece or more is thin the piece is a thin thing as a whole (a pole,
 * a cue rack) and keeps its own shape. A lattice (a frame with two posts, a rack) has two runs a row and stays a lattice.
 */
export function castShape(sil: Silhouette, minWidth = 2, keepRows = 3): Silhouette {
    let thin = 0;
    let all = 0;
    let runCount = 0;
    let rows = 0;
    for (let r = sil.top; r <= sil.foot; r++) {
        if (sil.starts[r + 1] > sil.starts[r]) rows += 1;
        for (let k = sil.starts[r]; k < sil.starts[r + 1]; k++) {
            const w = sil.runs[k * 2 + 1] - sil.runs[k * 2];
            all += w;
            runCount += 1;
            if (w < minWidth && r <= sil.foot - keepRows) thin += w;
        }
    }
    let shape = sil;
    if (thin > 0 && thin * 2 < all) {
        const starts = new Int32Array(sil.height + 1);
        const runs: number[] = [];
        for (let r = 0; r < sil.height; r++) {
            starts[r] = runs.length / 2;
            for (let k = sil.starts[r]; k < sil.starts[r + 1]; k++) {
                const w = sil.runs[k * 2 + 1] - sil.runs[k * 2];
                if (w >= minWidth || r > sil.foot - keepRows) runs.push(sil.runs[k * 2], sil.runs[k * 2 + 1]);
            }
        }
        starts[sil.height] = runs.length / 2;
        let top = sil.top;
        while (top < sil.foot && starts[top] === starts[top + 1]) top += 1;
        shape = { ...sil, top, starts, runs: Int32Array.from(runs) };
    }
    return rows > 0 && runCount / rows > FRAGMENTED_RUNS_PER_ROW ? closeGaps(shape) : shape;
}

/** How a sheared copy of a silhouette is laid out: the shadow of a piece whose top leans away by (sx, sy) per px of height. */
export interface Shear {
    /** Offset of the top of the piece per px of height, before `m`. */
    readonly sx: number;
    readonly sy: number;
    /** Scale that keeps the shadow's length between its floor and its cap. */
    readonly m: number;
}

/** The scale that keeps a shadow of `length` x height at least `lo` and at most `hi` px long (never below 1 when it fits). */
export function lengthScale(height: number, length: number, lo: number, hi: number): number {
    const natural = Math.max(1, height) * length;
    return Math.min(Math.max(1, lo / natural), hi / natural);
}

/**
 * The runs of a silhouette's shadow, to `visit(y, x0, x1, heightShare)`: row r of the piece, Z = foot - r px above the
 * foot, lands `round(sx * m * Z)` right and `round(sy * m * Z)` down from where the piece stands. Z steps in 1/q so
 * that the offsets of two rows never leave a hole. `heightShare` is Z over the piece's height. (x0, y0) is the
 * piece's top-left corner.
 */
export function shearRuns(
    sil: Silhouette,
    x0: number,
    y0: number,
    shear: Shear,
    visit: (y: number, x0: number, x1: number, heightShare: number) => void,
): void {
    const { sx, sy, m } = shear;
    const q = Math.max(1, Math.ceil(Math.max(Math.abs(sx * m), Math.abs(sy * m), 1)));
    const height = Math.max(1, sil.foot - sil.top + 1);
    for (let r = sil.top; r <= sil.foot; r++) {
        const first = sil.starts[r];
        const last = sil.starts[r + 1];
        if (first === last) continue;
        const z = sil.foot - r;
        for (let j = 0; j < q; j++) {
            const zj = z - j / q;
            if (zj < 0) break;
            const ox = Math.round(sx * m * zj);
            const oy = Math.round(sy * m * zj);
            for (let k = first; k < last; k++) {
                visit(y0 + sil.foot + oy, x0 + sil.runs[k * 2] + ox, x0 + sil.runs[k * 2 + 1] + ox, zj / height);
            }
        }
    }
}
