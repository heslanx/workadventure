/**
 * When the people panel watches the world's roster.
 *
 * Watching is what costs: every client that watches is sent every join, leave and update of the world. So the headcount
 * (one number) is always on, and the roster (one row per session) is watched only while somebody reads it and the world
 * is small enough for that to be cheap.
 */

/**
 * T: up to this many people, the open panel lists everyone. Decided in `docs/konclui-migration/decisions.md` (C3) and
 * to be confirmed by the load data of the roster. It is the only number to change: the hysteresis is derived from it.
 */
export const ROSTER_WATCH_LIMIT = 200;

/**
 * The watch stops above 220 (10% over the limit) and starts again at or below 180 (10% under it), so a world that
 * hovers around the limit does not flip the list between "everyone" and "near you" with each person who joins or
 * leaves.
 */
const STOP_ABOVE = Math.round(ROSTER_WATCH_LIMIT * 1.1);
const START_AT_OR_BELOW = Math.round(ROSTER_WATCH_LIMIT * 0.9);

/** How many people the list shows from those around the player, nearest first. */
export const NEARBY_ROWS = 60;

/** How many people the list shows when it lists everyone, in alphabetical order. */
export const EVERYONE_ROWS = 200;

/** The people the list holds: everyone in the world, or the ones around the player. */
export type PeopleMode = "everyone" | "nearby";

/**
 * The mode the count asks for, given the one it had.
 *
 * - A count that is not known yet (0, or no number at all) changes nothing, and starts in "nearby": a watch that
 *   cannot be bounded is not begun.
 * - The first known count decides by the limit alone.
 * - After that, the margin applies in both directions.
 */
export function modeForCount(previous: PeopleMode | undefined, count: number | undefined): PeopleMode {
    if (count === undefined || !(count >= 1)) return previous ?? "nearby";
    if (previous === undefined) return count <= ROSTER_WATCH_LIMIT ? "everyone" : "nearby";
    if (previous === "everyone") return count > STOP_ABOVE ? "nearby" : "everyone";
    return count <= START_AT_OR_BELOW ? "everyone" : "nearby";
}

export interface RosterWatchDemand {
    /** The people panel is on screen. */
    readonly panelOpen: boolean;
    /**
     * The chat reads the people of the world: its member avatars, its mention search and the subtitle of a conversation
     * subscribe them while they are on screen. It is held to the same rule as the panel, so the chat open in a world of a
     * thousand people watches nobody.
     */
    readonly chatReads: boolean;
    /** The mode the count asks for (`modeForCount`). */
    readonly mode: PeopleMode;
    /** The user asked for everyone ("Todos") in a world above the limit. */
    readonly chosenEveryone: boolean;
    /** The count is made from the roster itself, because the back sends none: today's behaviour, always watching. */
    readonly countNeedsRoster: boolean;
}

/** Whether the roster is watched right now: it is when something reads it. */
export function shouldWatchRoster(demand: RosterWatchDemand): boolean {
    if (demand.countNeedsRoster) return true;
    return (demand.panelOpen || demand.chatReads) && modeShown(demand.mode, demand.chosenEveryone) === "everyone";
}

/** The people the open panel lists: everyone when the world is small or the user asked for it, else the ones near. */
export function modeShown(mode: PeopleMode, chosenEveryone: boolean): PeopleMode {
    return chosenEveryone ? "everyone" : mode;
}

/** How a count of people is known: from the back's headcount, from the roster, or not yet. */
export type CountSource = "state" | "roster" | "unknown";

/**
 * Where the world's count comes from. `synced` is false until the world space's state has arrived: only then does an
 * absent headcount mean the back sends none, which is when the roster has to count (an older back, or one with the
 * headcount off). Before that, nothing is known and nothing is watched.
 */
export function countSource(reading: {
    readonly synced: boolean;
    readonly headcount: number | undefined;
}): CountSource {
    if (!reading.synced) return "unknown";
    return reading.headcount === undefined ? "roster" : "state";
}

/** One session of the roster, as far as the count needs it. */
export interface CountedSession {
    readonly spaceUserId: string;
    readonly uuid: string;
}

/**
 * How many people the sessions are: distinct accounts, as the back's headcount counts them, so that the number does
 * not jump when the source changes. A session without an account counts by its own id.
 */
export function distinctPeople(sessions: Iterable<CountedSession>): number {
    const people = new Set<string>();
    for (const session of sessions) people.add(session.uuid === "" ? session.spaceUserId : session.uuid);
    return people.size;
}
