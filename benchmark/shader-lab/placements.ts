/**
 * What the built map places, from office.wam and its entity collections: every piece's picture key (as the effects name
 * it, the path under "entities/"), its top-left corner and its depth offset. Pure: the page fetches the JSON and calls it.
 */

export interface Placement {
    /** The path under entities/, the manifest's key: "escritorio-moderno/sprites/mo-153.png". */
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly name: string;
    readonly depthOffset: number;
    readonly tags: readonly string[];
}

interface WamEntity {
    readonly x: number;
    readonly y: number;
    readonly name?: string;
    readonly prefabRef?: { readonly collectionName: string; readonly id: string };
}

export interface Wam {
    readonly entities: Readonly<Record<string, WamEntity>>;
    readonly entityCollections: readonly { readonly url: string }[];
}

interface CollectionPrefab {
    readonly id: string;
    readonly name?: string;
    readonly tags?: readonly string[];
    readonly imagePath: string;
    readonly depthOffset?: number;
}

export interface Collection {
    readonly collectionName: string;
    readonly collection: readonly CollectionPrefab[];
}

/** "entities/mobilia/collection.json" -> "mobilia". */
export function folderOf(collectionUrl: string): string {
    const match = /^(?:\.\/)?entities\/([^/]+)\//.exec(collectionUrl);
    if (!match) throw new Error(`a collection url is expected under entities/<folder>/, got "${collectionUrl}"`);
    return match[1];
}

/**
 * `collections` are the parsed collection.json files in the same order as `wam.entityCollections`. An entity whose
 * prefab is unknown is skipped and counted: the lab says so rather than drawing a hole silently.
 */
export function placementsOf(
    wam: Wam,
    collections: readonly Collection[],
): { placements: Placement[]; unknown: number } {
    const byPrefab = new Map<string, { key: string; prefab: CollectionPrefab }>();
    wam.entityCollections.forEach((entry, index) => {
        const folder = folderOf(entry.url);
        for (const prefab of collections[index].collection) {
            byPrefab.set(`${collections[index].collectionName}\u0000${prefab.id}`, {
                key: `${folder}/${prefab.imagePath}`,
                prefab,
            });
        }
    });
    const placements: Placement[] = [];
    let unknown = 0;
    for (const entity of Object.values(wam.entities)) {
        const ref = entity.prefabRef;
        const found = ref === undefined ? undefined : byPrefab.get(`${ref.collectionName}\u0000${ref.id}`);
        if (!found) {
            unknown += 1;
            continue;
        }
        placements.push({
            key: found.key,
            x: entity.x,
            y: entity.y,
            name: entity.name ?? found.prefab.name ?? "",
            depthOffset: found.prefab.depthOffset ?? 0,
            tags: found.prefab.tags ?? [],
        });
    }
    return { placements, unknown };
}

/**
 * The painter's order of the composed fallback: by the foot line (bottom of the picture) plus the prefab's depth offset,
 * as the game sorts entities. `heights` gives each picture's height once decoded.
 */
export function paintOrder(placements: readonly Placement[], heights: ReadonlyMap<string, number>): Placement[] {
    return [...placements].sort(
        (a, b) =>
            a.y + (heights.get(a.key) ?? 0) + a.depthOffset - (b.y + (heights.get(b.key) ?? 0) + b.depthOffset) ||
            a.x - b.x,
    );
}
