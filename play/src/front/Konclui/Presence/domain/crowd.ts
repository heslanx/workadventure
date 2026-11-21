import type { NearbyRow } from "./peopleList";
import { isSamePlace, type Place } from "./place";

/** What the scene tells the people panel about the player and the people around them, from one reading. */
export interface CrowdReading {
    /** The key of the room the scene is for, which tells a session of this room from one of another. */
    readonly roomKey: string;
    readonly me: {
        /** The player's own session, so that the list can leave it out of the rows it counts. */
        readonly spaceUserId: string | undefined;
        readonly name: string;
        /** `undefined` when the map names no place. */
        readonly place: Place | undefined;
    };
    /** The people around the player, nearest first, as many as the list can show. */
    readonly people: readonly NearbyRow[];
}

/** Whether two readings say the same thing, so a subscriber hears about a change and not about each time the scene looked. */
export function isSameCrowd(a: CrowdReading | undefined, b: CrowdReading | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return (
        a.roomKey === b.roomKey &&
        a.me.spaceUserId === b.me.spaceUserId &&
        a.me.name === b.me.name &&
        isSamePlace(a.me.place, b.me.place) &&
        a.people.length === b.people.length &&
        a.people.every((person, index) => {
            const other = b.people[index];
            return (
                person.spaceUserId === other.spaceUserId &&
                person.name === other.name &&
                person.status === other.status &&
                isSamePlace(person.place, other.place)
            );
        })
    );
}
