import { isSameNearby, type Nearby } from "./nearbyPeople";
import { isSamePlace, type Place } from "./place";

/** What the scene tells the interface about the current player's surroundings, from one reading. */
export interface PresenceReading extends Nearby {
    /** Where the current player stands. `undefined` when the map names no place. */
    readonly place: Place | undefined;
}

export function isSamePresence(a: PresenceReading | undefined, b: PresenceReading | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return isSameNearby(a, b) && isSamePlace(a.place, b.place);
}

/**
 * What the people pill says. `online` is how many people the world holds, the current user included; it is 0 until
 * the world's list has synchronised, and the pill must not show that as a count: a false zero is worse than no number.
 */
export type PillSummary =
    | { readonly kind: "unknown" }
    | { readonly kind: "alone" }
    /** `nearCount` is `undefined` until the scene has read its surroundings once. */
    | { readonly kind: "others"; readonly online: number; readonly nearCount: number | undefined };

export function describePill(online: number, nearCount: number | undefined): PillSummary {
    if (!(online >= 1)) return { kind: "unknown" };
    if (online === 1) return { kind: "alone" };
    return { kind: "others", online, nearCount };
}
