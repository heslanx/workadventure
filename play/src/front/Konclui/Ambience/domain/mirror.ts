// Who and what stands in front of a glass face shows in it as a picture, not as the screen's pixels (owner,
// 20/10/2026: the reflection must face the viewer, must not be cut at the sides, and may show whatever else stands
// close). Every glass face of the map is seen from the south, so it is a mirror on a north wall: it shows a figure from
// its other side (down and up swap) and swaps nothing east and west, so a piece drawn from the front only (a plant, a
// totem) keeps its side, and only a figure turned to its front flips.

/** How far in front of a glass face (px from its foot line) a person, a pet or a piece shows in it. */
export const MIRROR_REACH = 80;

/** A glass face: its left and right edges and its foot line, in world px. */
export type GlassFace = readonly [x0: number, x1: number, foot: number];

export type FrameName = string | number;

/**
 * A frame of a WorkAdventure sheet (3 x 4: down, left, right, up) as the mirror shows it. Down and up swap and the
 * picture turns over (a figure seen from its other side), left and right stay; anything that is not a frame of such a
 * sheet stays as it is.
 */
export function mirrorFrame(frame: FrameName): { frame: FrameName; flip: boolean } {
    const n = Number(frame);
    if (!Number.isInteger(n) || n < 0 || n > 11) return { frame, flip: false };
    const row = Math.floor(n / 3);
    const col = n % 3;
    if (row === 0) return { frame: 9 + col, flip: true };
    if (row === 3) return { frame: col, flip: true };
    return { frame: n, flip: false };
}

/** The glass face whose foot line a point stands in front of, within reach (the nearest), or null. */
export function mirrorFace(
    x: number,
    foot: number,
    faces: readonly GlassFace[],
    reach = MIRROR_REACH,
): GlassFace | null {
    let best: GlassFace | null = null;
    for (const face of faces) {
        const d = foot - face[2];
        if (x >= face[0] && x < face[1] && d > 0 && d <= reach && (!best || d < foot - best[2])) best = face;
    }
    return best;
}

/**
 * Where a reflection's feet stand: as far up the glass from its foot line as they stand in front of it. Close to the
 * glass the feet touch the bottom of the pane; farther away the reflection rises, and the pane's top crops the head and
 * body until only the feet remain before it fades out.
 */
export const mirrorFoot = (foot: number, faceFoot: number): number => 2 * faceFoot - foot;

/**
 * A reflection's opacity at a distance from the glass: 0.56 against the glass, a Hermite ease down to 0 at reach.
 * People, pets and pieces share it so their reflections fade together.
 */
export const mirrorAlpha = (d: number, reach = MIRROR_REACH): number => {
    if (d <= 0 || d >= reach) return 0;
    const u = d / reach;
    const s = 0.56 * (1 - u * u * (3 - 2 * u));
    return Math.round(s * 1000) / 1000;
};

// The editor's own Portuguese tag names: plants, outdoors and garden, brand pieces, lamps, chairs and benches, sofas
// and armchairs, storage.
const MIRROR_TAGS =
    /^(plantas|exterior e jardim|peças da marca|luminárias|cadeiras e bancos|sofás e poltronas|armazenamento)$/i;

// Words in the editor's Portuguese piece names for what sits on furniture, lies flat (rug, floor) or hangs on a wall
// (wall, door, window, picture, panel, neon, sign).
const NOT_STANDING = /sobre móvel|tapete|piso|parede|porta|janela|quadro|painel|neon|letreiro/i;

export interface MirrorPrefab {
    readonly name?: string;
    readonly tags?: readonly string[];
}

/**
 * Whether a placed piece shows in the glass: what stands on the floor (plants, the garden, the brand's totems, lamps,
 * seats, shelves), not what sits on a desk (it would float without the desk), lies flat or hangs on a wall.
 */
export function mirrorsPiece(prefab: MirrorPrefab = {}): boolean {
    const name = prefab.name || "";
    if (NOT_STANDING.test(name)) return false;
    return (prefab.tags || []).some((t) => MIRROR_TAGS.test(t));
}
