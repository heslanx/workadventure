import type { Box } from "./geometry";
import type { GlassFace } from "./mirror";

/** RGBA pixels, four bytes per pixel, row by row: what a canvas's getImageData returns. */
export interface Pixels {
    readonly width: number;
    readonly height: number;
    readonly data: ArrayLike<number>;
}

const STAR_ROOM: readonly (readonly [number, number])[] = [
    [-12, 0],
    [12, 0],
    [0, -12],
    [0, 12],
    [-9, -9],
    [9, 9],
    [9, -9],
    [-9, 9],
];

/**
 * Five places for sun stars: calm open water at least 30 px deep with 12 px of it all round (no pad clips a star), far
 * apart, the same every visit (a fixed scan). [x, y, phase, 0] per star in the pool region's pixels; phases staggered
 * so three or four shine at once.
 */
export function starSlots({ width, height, data }: Pixels): Float32Array {
    const out = new Float32Array(20);
    const picked: [number, number][] = [];
    const calmAt = (px: number, py: number): boolean => {
        const j = (py * width + px) * 4;
        return px >= 0 && py >= 0 && px < width && py < height && data[j + 3] > 127 && (data[j + 2] & 1) === 1;
    };
    for (let n = 0; n < 4000 && picked.length < 5; n++) {
        const x = Math.floor(((n * 0.618034) % 1) * width);
        const y = Math.floor(((n * 0.414214 + 0.5) % 1) * height);
        const i = (y * width + x) * 4;
        const calm = calmAt(x, y) && data[i + 1] >= 30 && STAR_ROOM.every(([dx, dy]) => calmAt(x + dx, y + dy));
        if (calm && picked.every(([px, py]) => Math.hypot(px - x, py - y) > 90)) picked.push([x, y]);
    }
    picked.forEach(([x, y], k) => out.set([x, y, k * 3, 0], k * 4));
    return out;
}

/** The map masks packed for lookups, one byte per 2 x 2 px. */
export interface MaskBits {
    readonly width: number;
    readonly height: number;
    readonly bits: Uint8Array;
}

/**
 * The masks for lookups, one byte per 2 x 2 px (bits: 1 outside, 2 polished, 4 lawn, 8 water, 16 wall, 32 facade
 * glass): about 1.2 MB instead of the 20 MB of the full picture's pixels.
 */
export function packMasks({ width, height, data }: Pixels): MaskBits {
    const w = Math.ceil(width / 2);
    const h = Math.ceil(height / 2);
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * 2 * width + x * 2) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            bits[y * w + x] =
                (r > 191 ? 1 : 0) |
                (g > 191 ? 2 : 0) |
                (b > 191 ? 4 : 0) |
                (b > 64 && b <= 191 ? 8 : 0) |
                (r > 64 && r <= 191 ? 16 : 0) |
                (g > 64 && g <= 191 ? 32 : 0);
        }
    }
    return { width: w, height: h, bits };
}

/** Raw packed mask byte at a world point (bits: 1 outside, 2 polished, 4 lawn, 8 water, 16 wall, 32 facade). */
export function maskByteAt({ width, height, bits }: MaskBits, x: number, y: number): number {
    const mx = Math.floor(x / 2);
    const my = Math.floor(y / 2);
    if (mx < 0 || my < 0 || mx >= width || my >= height) return 0;
    return bits[my * width + mx];
}

/** The masks at a world point as [R, G, B]: outside or wall, polished floor or facade, lawn or water. */
export function maskAt(masks: MaskBits, x: number, y: number): [r: number, g: number, b: number] {
    const b = maskByteAt(masks, x, y);
    if (b === 0) return [0, 0, 0];
    return [b & 1 ? 255 : b & 16 ? 96 : 0, b & 2 ? 255 : b & 32 ? 128 : 0, b & 4 ? 255 : b & 8 ? 128 : 0];
}

/** fx.py footprint(): [x0, y0, x1, y1] of the bottom quarter of a sprite's silhouette, or null. */
export function measureFootprint({ width, height, data }: Pixels): Box | null {
    if (!width || !height) return null;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 127) {
                x0 = Math.min(x0, x);
                x1 = Math.max(x1, x);
                y0 = Math.min(y0, y);
                y1 = Math.max(y1, y);
            }
        }
    }
    if (x1 < 0) return null;
    const w = x1 + 1 - x0;
    const h = y1 + 1 - y0;
    if (h < 6 || w < 4) return null;
    return [
        Math.round(x0 + w * 0.12),
        Math.round(y1 + 1 - Math.max(4, h * 0.22)),
        Math.round(x1 + 1 - w * 0.12),
        y1 + 1,
    ];
}

/**
 * A brand piece seen from behind, for the mirror: below its top quarter (a totem's cap), every pixel that is not the
 * body's colour (the logo, its lettering) takes the body's colour, the most frequent there. Changes `data` in place.
 */
export function paintBackOf(data: Uint8ClampedArray, width: number, height: number): void {
    const from = Math.floor(height / 4);
    const counts = new Map<number, number>();
    for (let i = from * width * 4; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(c, (counts.get(c) || 0) + 1);
    }
    if (!counts.size) return;
    const body = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const [r, g, b] = [(body >> 16) & 255, (body >> 8) & 255, body & 255];
    for (let i = from * width * 4; i < data.length; i += 4) {
        if (data[i + 3] < 128 || Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) <= 60) {
            continue;
        }
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
    }
}

/** A pane of glass in world px: left, right, top, bottom. */
export type GlassPane = readonly [x0: number, x1: number, top: number, bottom: number];

/** A face is 64 px tall from its row's top edge, 60 px above its foot line. */
export const glassRowTop = (face: GlassFace): number => face[2] - 60;

/**
 * The panes of a glass face, from its 64 px band of the glass mask (`band`, as wide as the face, red > 100 is glass):
 * the rows that are mostly glass, then runs of glass columns across them (at least 6 px), then runs of glass rows down
 * each (at least 2 px), so the film stays on top. Null when the band has no
 * glass row or the face's corner lies outside the mask (`maskWidth` x `maskHeight`).
 */
export function glassPanes(
    face: GlassFace,
    band: ArrayLike<number>,
    maskWidth: number,
    maskHeight: number,
): GlassPane[] | null {
    const [x0, x1] = face;
    const width = x1 - x0;
    const top = glassRowTop(face);
    const at = (x: number, y: number): boolean => band[(y * width + x) * 4] > 100;
    const rows: number[] = [];
    for (let y = 0; y < 64; y++) {
        let n = 0;
        for (let x = 0; x < width; x++) if (at(x, y)) n += 1;
        if (n > width * 0.25) rows.push(y);
    }
    if (!rows.length || !(x0 >= 0 && top >= 0 && x0 < maskWidth && top < maskHeight)) return null;
    const y0 = rows[0];
    const y1 = rows[rows.length - 1] + 1;
    const columns: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
        let n = 0;
        if (x < width) for (let y = y0; y < y1; y++) if (at(x, y)) n += 1;
        const glass = x < width && n > (y1 - y0) * 0.5;
        if (glass && start < 0) start = x;
        if (!glass && start >= 0) {
            if (x - start >= 6) columns.push([start, x]);
            start = -1;
        }
    }
    const panes: GlassPane[] = [];
    for (const [a, b] of columns) {
        let from = -1;
        for (let y = y0; y <= y1; y++) {
            let n = 0;
            if (y < y1) for (let x = a; x < b; x++) if (at(x, y)) n += 1;
            const glass = y < y1 && n > (b - a) * 0.5;
            if (glass && from < 0) from = y;
            if (!glass && from >= 0) {
                if (y - from >= 2) panes.push([x0 + a, x0 + b, top + from, top + y]);
                from = -1;
            }
        }
    }
    return panes;
}

/** Builds a sprite normal field from its opaque silhouette and Sobel luminance gradients. */
export function spriteNormals({ width, height, data }: Pixels, strength = 1): Uint8ClampedArray {
    const stride = width + 2;
    const bevel = new Uint8Array(stride * (height + 2));
    const luminance = new Float32Array(bevel.length);
    const out = new Uint8ClampedArray(width * height * 4);
    // Capped Manhattan distance to the silhouette. The zero border includes sheet edges.
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const k = (y + 1) * stride + x + 1;
            if (data[i + 3] !== 255) continue;
            bevel[k] = Math.min(3, 1 + Math.min(bevel[k - 1], bevel[k - stride]));
            luminance[k] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
        }
    }
    for (let y = height; y > 0; y--) {
        for (let x = width; x > 0; x--) {
            const k = y * stride + x;
            bevel[k] = Math.min(bevel[k], 1 + Math.min(bevel[k + 1], bevel[k + stride]));
        }
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const k = (y + 1) * stride + x + 1;
            out[i] = out[i + 1] = 128;
            out[i + 2] = 255;
            if (!bevel[k]) continue;
            let nx = 0;
            let ny = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const j = k + dy * stride + dx;
                    const h = bevel[j] + (bevel[j] ? luminance[j] : luminance[k]);
                    nx -= dx * (dy === 0 ? 2 : 1) * h;
                    ny += dy * (dx === 0 ? 2 : 1) * h;
                }
            }
            nx *= strength / 8;
            ny *= strength / 8;
            const scale = 127.5 / Math.hypot(nx, ny, 1);
            out[i] = Math.round(127.5 + nx * scale);
            out[i + 1] = Math.round(127.5 + ny * scale);
            out[i + 2] = Math.round(127.5 + scale);
            out[i + 3] = 255;
        }
    }
    return out;
}
