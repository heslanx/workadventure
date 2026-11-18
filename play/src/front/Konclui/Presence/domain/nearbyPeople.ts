/** How far, in map pixels, someone counts as near: eight tiles of 32 px, the reference office's rule. */
export const NEAR_RADIUS_PX = 8 * 32;

/** How many of the nearest people the pill shows as avatars. */
export const NEAREST_SHOWN = 4;

export interface Point {
    readonly x: number;
    readonly y: number;
}

/** A character in the scene. `id` is the player's id in the room, never the display name: two people can share one. */
export interface NearbyCandidate extends Point {
    readonly id: number;
    readonly name: string;
}

export interface NearbyPerson {
    readonly id: number;
    readonly name: string;
}

export interface Nearby {
    /** The nearest people, nearest first, whatever their distance. */
    readonly nearest: readonly NearbyPerson[];
    /** Everyone within the radius, also beyond the nearest ones. */
    readonly nearCount: number;
}

interface Ranked {
    readonly person: NearbyPerson;
    readonly squaredDistance: number;
}

/** Whether `a` comes before `b`: closer first, the lower id first among equals, so the order never depends on a name. */
function isCloser(a: Ranked, b: Ranked): boolean {
    return (
        a.squaredDistance < b.squaredDistance || (a.squaredDistance === b.squaredDistance && a.person.id < b.person.id)
    );
}

/**
 * The people nearest to `me` and how many are within `radius` (inclusive), in one pass and without sorting the whole
 * crowd: it keeps only the `limit` nearest. The candidates are the characters the scene holds, which are the ones in
 * the area of interest, not the room's roster.
 */
export function nearestPeople(
    me: Point,
    candidates: Iterable<NearbyCandidate>,
    { limit = NEAREST_SHOWN, radius = NEAR_RADIUS_PX }: { limit?: number; radius?: number } = {},
): Nearby {
    const radiusSquared = radius * radius;
    const kept: Ranked[] = [];
    let nearCount = 0;
    for (const candidate of candidates) {
        const dx = candidate.x - me.x;
        const dy = candidate.y - me.y;
        const squaredDistance = dx * dx + dy * dy;
        if (squaredDistance <= radiusSquared) nearCount++;
        if (limit <= 0) continue;
        const ranked: Ranked = { person: { id: candidate.id, name: candidate.name }, squaredDistance };
        if (kept.length === limit && !isCloser(ranked, kept[limit - 1])) continue;
        let position = kept.length === limit ? limit - 1 : kept.length;
        while (position > 0 && isCloser(ranked, kept[position - 1])) {
            kept[position] = kept[position - 1];
            position--;
        }
        kept[position] = ranked;
    }
    return { nearest: kept.map(({ person }) => person), nearCount };
}

/** Whether two snapshots show the same people in the same order and the same count. */
export function isSameNearby(a: Nearby, b: Nearby): boolean {
    return (
        a.nearCount === b.nearCount &&
        a.nearest.length === b.nearest.length &&
        a.nearest.every((person, index) => person.id === b.nearest[index].id && person.name === b.nearest[index].name)
    );
}
