import { derived, type Readable } from "svelte/store";
import { describePill, type PillSummary } from "../domain/presence";
import type { NearbyPerson } from "../domain/nearbyPeople";
import { onlineCountStore } from "./onlineCountStore";
import { presenceStore } from "./presenceStore";

export interface PeoplePill {
    readonly summary: PillSummary;
    /** The avatars the pill stacks: the nearest people, nearest first. */
    readonly nearest: readonly NearbyPerson[];
}

/** What the people pill shows: the world's headcount and the current player's surroundings. */
export const peoplePillStore: Readable<PeoplePill> = derived(
    [onlineCountStore, presenceStore],
    ([online, reading]) => ({
        summary: describePill(online, reading?.nearCount),
        nearest: reading?.nearest ?? [],
    }),
);
