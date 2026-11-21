import type { Point } from "./nearbyPeople";

/**
 * How far below a character's position its feet are, in map pixels. WorkAdventure tests the areas a player is in at
 * this offset (`GameMapAreas.areasPositionOffsetY`), so the place agrees with the area the engine fires for.
 */
export const FEET_OFFSET_Y = 16;

/** The part of a map area that names a place. Structural, so the map editor's `AreaData` fits. */
export interface AreaLike {
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly properties?: readonly { readonly type: string }[];
}

/**
 * Where someone stands. An area keeps the name the map gave it; the others are named by the interface, which
 * translates them.
 */
export type Place =
    | { readonly kind: "area"; readonly name: string }
    | { readonly kind: "entrance" }
    | { readonly kind: "hall" }
    | { readonly kind: "outside" };

function isStartArea(area: AreaLike): boolean {
    return area.properties?.some((property) => property.type === "start") === true;
}

// The edges are inclusive, as WorkAdventure's own area test is.
function holds(rectangle: Omit<AreaLike, "name" | "properties">, point: Point): boolean {
    return (
        point.x >= rectangle.x &&
        point.x <= rectangle.x + rectangle.width &&
        point.y >= rectangle.y &&
        point.y <= rectangle.y + rectangle.height
    );
}

/**
 * The place at `point`, a position in map pixels at the character's feet.
 *
 * - The smallest named area holding the point, so a booth wins over the wing around it. The area with a `start`
 *   property and no name is the entrance.
 * - Else the hall, when the point is inside the box around the named rooms (the entrance is no room).
 * - Else outside.
 *
 * It is `undefined` when the map names nothing the person could be told apart by. A map without named areas has no
 * hall to speak of: naming every such map "Hall", as the reference does, would be wrong in most rooms.
 *
 * One pass over `areas` and no allocation: it runs on a timer of the scene, for every area of the map.
 */
export function placeAt(areas: Iterable<AreaLike>, point: Point): Place | undefined {
    let smallest: { readonly name: string; readonly size: number } | undefined;
    let hasRooms = false;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (const area of areas) {
        const name = area.name.trim();
        const isEntrance = isStartArea(area);
        if (name === "" && !isEntrance) continue;
        if (!isEntrance) {
            hasRooms = true;
            left = Math.min(left, area.x);
            top = Math.min(top, area.y);
            right = Math.max(right, area.x + area.width);
            bottom = Math.max(bottom, area.y + area.height);
        }
        if (!holds(area, point)) continue;
        const size = area.width * area.height;
        // Equal sizes go to the earlier name, so the answer does not depend on the order the map lists its areas in.
        if (smallest === undefined || size < smallest.size || (size === smallest.size && name < smallest.name)) {
            smallest = { name, size };
        }
    }

    if (smallest !== undefined) {
        return smallest.name === "" ? { kind: "entrance" } : { kind: "area", name: smallest.name };
    }
    if (!hasRooms) return undefined;
    return holds({ x: left, y: top, width: right - left, height: bottom - top }, point)
        ? { kind: "hall" }
        : { kind: "outside" };
}

export function isSamePlace(a: Place | undefined, b: Place | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    if (a.kind !== b.kind) return false;
    return a.kind === "area" && b.kind === "area" ? a.name === b.name : true;
}

/** The names the interface gives to the places the map does not name. */
export interface PlaceNames {
    readonly entrance: string;
    readonly hall: string;
    readonly outside: string;
}

/** What a place is called: the name the map gave an area, and the interface's own word for the other places. */
export function placeName(place: Place, names: PlaceNames): string {
    switch (place.kind) {
        case "area":
            return place.name;
        case "entrance":
            return names.entrance;
        case "hall":
            return names.hall;
        case "outside":
            return names.outside;
        default: {
            const unreachable: never = place;
            throw new Error(`Unhandled place: ${JSON.stringify(unreachable)}`);
        }
    }
}
