/**
 * The lab's acceptance numbers that are plain arithmetic over pictures: no WebGL, no DOM, so the unit tests cover them.
 * Each one answers a defect the reviewers saw in a picture and measured by hand (review of 2026-11-23), so that the next
 * run of the lab fails on it instead of a person having to look:
 *  - `shiftedMismatch`: shimmer (a camera that moved by a whole screen pixel must give the picture shifted by one pixel);
 *  - `reliefAgreement`: the lit side of a prop is the lamp's side, and the relief does not only darken;
 *  - `visibleShadowCoverage`: a piece has a shadow that SHOWS beside it (not only pixels in the cast texture);
 *  - `lampSideOfPeople`: a person near a lamp is lit on the lamp's side.
 */

export interface Size {
    readonly width: number;
    readonly height: number;
}

/** A pixel counts as changed above this largest-channel delta (the lab's diff threshold). */
export const CHANGED_DELTA = 2;

export function luma(rgba: ArrayLike<number>, pixel: number): number {
    const i = pixel * 4;
    return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
}

export function maxDelta(a: ArrayLike<number>, b: ArrayLike<number>, pixel: number): number {
    const i = pixel * 4;
    return Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
}

/** Pearson's correlation of two series, or null when either has no spread or there are fewer than 3 pairs. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
    const n = Math.min(xs.length, ys.length);
    if (n < 3) return null;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < n; i++) {
        mx += xs[i];
        my += ys[i];
    }
    mx /= n;
    my /= n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
    }
    return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/**
 * How many more pixels than today's pass the shaded one may differ by in the shimmer check, as a share of the window: the legacy pass
 * has a few dozen of its own (the sun's bands are read off the screen's uv), and the shading's own multipliers turn a few of them
 * over a threshold. The defect it guards was 1,000 to 6,000 pixels.
 */
export const SHIMMER_SLACK = 0.0002;

/**
 * Shimmer: a camera that moved one screen pixel to the right must give the first picture's pixels one place to the left. This
 * counts the pixels where `moved` at x differs, by more than `CHANGED_DELTA`, from `base` at x + 1 (over every row and the
 * columns both have). 0 means the lookups are keyed in map space and nothing swims.
 */
export function shiftedMismatch(base: ArrayLike<number>, moved: ArrayLike<number>, size: Size): number {
    let count = 0;
    for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width - 1; x++) {
            const a = y * size.width + x + 1;
            const b = y * size.width + x;
            const i = a * 4;
            const j = b * 4;
            const delta = Math.max(
                Math.abs(base[i] - moved[j]),
                Math.abs(base[i + 1] - moved[j + 1]),
                Math.abs(base[i + 2] - moved[j + 2]),
            );
            if (delta > CHANGED_DELTA) count += 1;
        }
    }
    return count;
}

/** A pool of light as the lab's CPU twin reads it (the lights `uniforms.ts` packs). */
export interface PoolLike {
    readonly x: number;
    readonly y: number;
    readonly reach: number;
    readonly squash: number;
    readonly power: number;
    readonly clip: readonly number[] | null;
    readonly kind?: string;
}

/** What the lamps give the map pixel (mx, my) and which way: the shader's `La` (x right, y up, the lamp 42 px up). */
export function lampPullAt(
    pools: readonly PoolLike[],
    mx: number,
    my: number,
): { light: number; pullX: number; pullY: number } {
    let light = 0;
    let pullX = 0;
    let pullY = 0;
    const px = mx + 0.5;
    const py = my + 0.5;
    for (const pool of pools) {
        if (
            pool.clip &&
            !(
                px >= pool.clip[0] &&
                py >= pool.clip[1] &&
                px < pool.clip[0] + pool.clip[2] &&
                py < pool.clip[1] + pool.clip[3]
            )
        )
            continue;
        const d = Math.hypot(px - pool.x, (py - pool.y) / pool.squash) / Math.abs(pool.reach);
        if (d >= 1) continue;
        const f = Math.abs(pool.power) * (1 - d) ** 1.4;
        const vx = pool.x - px;
        const vy = py - pool.y;
        const length = Math.hypot(vx, vy, 42);
        light += f;
        pullX += (vx / length) * f;
        pullY += (vy / length) * f;
    }
    return { light, pullX, pullY };
}

export interface ReliefAgreement {
    /** Prop pixels in the window that a lamp lights (its pull is at least `MIN_PULL`) and whose normal leans. */
    readonly covered: number;
    /** Correlation, over those, of how much the relief brightened the pixel against how far its normal leans to the lamp. */
    readonly correlation: number | null;
    /** Of every pixel the relief changed (prop pixels in the window), the share it made as bright or brighter than before. */
    readonly lightShare: number | null;
    readonly changed: number;
    readonly minCovered: number;
    readonly minCorrelation: number;
    readonly minLightShare: number;
    /** null when too few prop pixels are lit by a lamp in this window to say. */
    readonly meets: boolean | null;
}

export const RELIEF_MIN_PULL = 0.05;
export const RELIEF_MIN_COVERED = 200;
export const RELIEF_MIN_CORRELATION = 0.2;
export const RELIEF_MIN_LIGHT_SHARE = 0.2;

/**
 * The relief's agreement with the lamps. Two things the reviewers measured by hand: the side of a prop that faces a lamp must be
 * the brighter one (lit side of a sofa darkest was the failure: the moon won inside the pool), and the relief must not only darken
 * (96 to 97% of what it changed was darker, so a prop lost 16% of its brightness at night and read as dimmer, not as lit).
 * `relief` is the relief element's picture, `off` the picture without shading, both RGBA with row 0 on top.
 */
export function reliefAgreement(input: {
    off: ArrayLike<number>;
    relief: ArrayLike<number>;
    size: Size;
    view: readonly number[];
    /** The normal map's RGBA, map-sized, row 0 on top. */
    normals: ArrayLike<number>;
    mapWidth: number;
    mapHeight: number;
    pools: readonly PoolLike[];
    isPerson: (mx: number, my: number) => boolean;
}): ReliefAgreement {
    const { off, relief, size, view, normals, mapWidth, mapHeight, pools, isPerson } = input;
    const tilts: number[] = [];
    const gains: number[] = [];
    let changed = 0;
    let lighter = 0;
    for (let sy = 0; sy < size.height; sy++) {
        for (let sx = 0; sx < size.width; sx++) {
            const mx = Math.floor(view[0] + ((sx + 0.5) / size.width) * view[2]);
            const my = Math.floor(view[1] + ((sy + 0.5) / size.height) * view[3]);
            if (mx < 0 || my < 0 || mx >= mapWidth || my >= mapHeight || isPerson(mx, my)) continue;
            const n = (my * mapWidth + mx) * 4;
            if (normals[n + 3] !== 255) continue;
            const p = sy * size.width + sx;
            const base = luma(off, p);
            if (base < 12) continue;
            const ratio = luma(relief, p) / base;
            if (maxDelta(off, relief, p) > CHANGED_DELTA) {
                changed += 1;
                if (ratio >= 1) lighter += 1;
            }
            const nx = (normals[n] / 255) * 2 - 1;
            const ny = (normals[n + 1] / 255) * 2 - 1;
            if (Math.hypot(nx, ny) < 0.05) continue; // a flat face leans to no lamp
            const pull = lampPullAt(pools, mx, my);
            const length = Math.hypot(pull.pullX, pull.pullY);
            if (length < RELIEF_MIN_PULL) continue;
            tilts.push((nx * pull.pullX + ny * pull.pullY) / length);
            gains.push(ratio);
        }
    }
    const correlation = pearson(tilts, gains);
    const lightShare = changed === 0 ? null : lighter / changed;
    const meets =
        tilts.length < RELIEF_MIN_COVERED || correlation === null
            ? null
            : correlation >= RELIEF_MIN_CORRELATION && (lightShare ?? 0) >= RELIEF_MIN_LIGHT_SHARE;
    return {
        covered: tilts.length,
        correlation,
        lightShare,
        changed,
        minCovered: RELIEF_MIN_COVERED,
        minCorrelation: RELIEF_MIN_CORRELATION,
        minLightShare: RELIEF_MIN_LIGHT_SHARE,
        meets,
    };
}

/** A placed piece as the coverage check reads it. */
export interface CoveragePiece {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly kind: string;
    /** Whether the picture pixel (px, py) of the piece, from its top-left, is solid (the piece itself). */
    readonly solid: (px: number, py: number) => boolean;
}

export interface CoverageGap {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly kind: string;
    readonly pixels: number;
    readonly reason: "none" | "dark receiver" | "wall";
}

export interface ShadowCoverage {
    readonly stand: { inWindow: number; visible: number; without: CoverageGap[] };
    readonly top: { inWindow: number; visible: number; without: CoverageGap[] };
    /** The least changed pixels that count as a shadow seen, for a standing piece and for one on furniture. */
    readonly minStand: number;
    readonly minTop: number;
}

/** A shadow of fewer than this many pixels, shown beside a piece in the picture, is not a shadow seen. */
export const COVERAGE_MIN_STAND = 8;
export const COVERAGE_MIN_TOP = 2;
/** A pixel a shadow changed counts as SEEN from this delta (of 255): 2 is the lab's noise floor, a shadow on a dark rug is a delta of 3 and nobody sees it. */
export const COVERAGE_DELTA = 6;
/** Below this luma (of 255) a floor takes no visible shadow: a multiplied-down navy is black on black. */
export const DARK_RECEIVER_LUMA = 30;

/**
 * Does every standing piece, and every piece on furniture, have a shadow that SHOWS in the window beside it? Counts the pixels
 * that a CAST shadow element changed (key and lamp alone for a standing piece, key and surface alone for one on furniture, each
 * against `off`; the contact band under every object does not count: it is 8 px under any piece) in a box round each piece, outside
 * the piece's own pixels: a shadow in the cast texture that lands on a wall, under a picture, or on a floor too dark to show
 * does not count. The earlier counter asked for 8 px of anything on a canvas of the piece's own and passed pieces whose shadow
 * was not to be seen. A piece with fewer is listed with the likeliest reason.
 */
export function visibleShadowCoverage(input: {
    off: ArrayLike<number>;
    /** The pictures of the elements that cast a shadow from a standing piece (key, lamp) and from one on furniture (key, surface). */
    standElements: readonly ArrayLike<number>[];
    topElements: readonly ArrayLike<number>[];
    size: Size;
    view: readonly number[];
    pieces: readonly CoveragePiece[];
    /** Whether map pixel (x, y) is a wall in the masks. */
    isWall: (mx: number, my: number) => boolean;
    reach: number;
}): ShadowCoverage {
    const { off, standElements, topElements, size, view, pieces, isWall, reach } = input;
    const scaleX = size.width / view[2];
    const scaleY = size.height / view[3];
    const out: ShadowCoverage = {
        stand: { inWindow: 0, visible: 0, without: [] },
        top: { inWindow: 0, visible: 0, without: [] },
        minStand: COVERAGE_MIN_STAND,
        minTop: COVERAGE_MIN_TOP,
    };
    for (const piece of pieces) {
        if (piece.kind !== "stand" && piece.kind !== "top") continue;
        // only a piece wholly inside the window can be judged: a half-seen one has half its shadow out of the picture
        const x0 = piece.x - 2;
        const y0 = piece.y - 2;
        const x1 = piece.x + piece.width + reach;
        const y1 = piece.y + piece.height + reach;
        if (x0 < view[0] || y0 < view[1] || x1 > view[0] + view[2] || y1 > view[1] + view[3]) continue;
        const bucket = piece.kind === "stand" ? out.stand : out.top;
        const elements = piece.kind === "stand" ? standElements : topElements;
        bucket.inWindow += 1;
        let changed = 0;
        let walls = 0;
        let dark = 0;
        let seen = 0;
        const sx0 = Math.max(0, Math.floor((x0 - view[0]) * scaleX));
        const sx1 = Math.min(size.width, Math.ceil((x1 - view[0]) * scaleX));
        const sy0 = Math.max(0, Math.floor((y0 - view[1]) * scaleY));
        const sy1 = Math.min(size.height, Math.ceil((y1 - view[1]) * scaleY));
        for (let sy = sy0; sy < sy1; sy++) {
            for (let sx = sx0; sx < sx1; sx++) {
                const mx = Math.floor(view[0] + ((sx + 0.5) / size.width) * view[2]);
                const my = Math.floor(view[1] + ((sy + 0.5) / size.height) * view[3]);
                if (piece.solid(mx - piece.x, my - piece.y)) continue;
                seen += 1;
                const p = sy * size.width + sx;
                if (isWall(mx, my)) walls += 1;
                if (luma(off, p) < DARK_RECEIVER_LUMA) dark += 1;
                if (elements.some((e) => maxDelta(off, e, p) > COVERAGE_DELTA)) changed += 1;
            }
        }
        const need = piece.kind === "stand" ? COVERAGE_MIN_STAND : COVERAGE_MIN_TOP;
        if (changed >= need) {
            bucket.visible += 1;
            continue;
        }
        const reason = walls > seen * 0.4 ? "wall" : dark > seen * 0.5 ? "dark receiver" : "none";
        bucket.without.push({ key: piece.key, x: piece.x, y: piece.y, kind: piece.kind, pixels: changed, reason });
    }
    return out;
}

export interface PersonLampSide {
    readonly x: number;
    readonly y: number;
    readonly nearLamp: "left" | "right" | null;
    readonly distance: number | null;
    readonly litSide: "left" | "right" | "even" | null;
    /** null when no lamp is within `LAMP_NEAR_PX`; true when the person is lit on the side that faces it. */
    readonly litTowardLamp: boolean | null;
}

/** A person within this many px of a lamp whose pool (or the rim of it) reaches their feet must be lit on the lamp's side. */
export const LAMP_NEAR_PX = 100;
/** The light at the feet from which a lamp counts: what the shaded pass takes as a lamp's pull (POST_SHADED's `lampPull > 0.02`). */
export const LAMP_NEAR_LIGHT = 0.02;

/**
 * The side of the lamp that lights the feet most, among those within `LAMP_NEAR_PX` whose pool reaches them (the lamp counts from
 * `LAMP_NEAR_LIGHT`): the pool's centre is on the floor under the lamp, and its side by x. A lamp 98 px off whose pool ends at
 * 60 lights nobody there, and the person is the moon's.
 */
export function nearestLampSide(
    pools: readonly PoolLike[],
    fx: number,
    fy: number,
): { side: "left" | "right" | null; distance: number | null } {
    let best: PoolLike | null = null;
    let bestLight = LAMP_NEAR_LIGHT;
    let bestDistance = 0;
    for (const pool of pools) {
        if (pool.kind !== "arc" && pool.kind !== "floor" && pool.kind !== "desk") continue;
        if (
            pool.clip &&
            !(
                fx >= pool.clip[0] &&
                fy >= pool.clip[1] &&
                fx < pool.clip[0] + pool.clip[2] &&
                fy < pool.clip[1] + pool.clip[3]
            )
        )
            continue;
        const distance = Math.hypot(pool.x - fx, (pool.y - fy) / pool.squash);
        const d = distance / Math.abs(pool.reach);
        const light = d < 1 ? Math.abs(pool.power) * (1 - d) ** 1.4 : 0;
        if (distance <= LAMP_NEAR_PX && light >= bestLight) {
            best = pool;
            bestLight = light;
            bestDistance = distance;
        }
    }
    if (!best) return { side: null, distance: null };
    const side = best.x < fx - 3 ? "left" : best.x > fx + 3 ? "right" : null;
    return { side, distance: Math.round(bestDistance) };
}

/** Whether a person is lit on the side of the lamp near them: null when no lamp is near (or it is right above them). */
export function litTowardLamp(near: "left" | "right" | null, lit: "left" | "right" | "even" | null): boolean | null {
    if (near === null || lit === null) return null;
    return lit === near;
}
