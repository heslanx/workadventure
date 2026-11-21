import { matchesName } from "./peopleSearch";
import type { Place } from "./place";
import { EVERYONE_ROWS, NEARBY_ROWS, type PeopleMode } from "./rosterWatch";

/** One session of the world's roster. A session is a row: an account in two tabs is two rows. */
export interface RosterPerson {
    /** The key of the row. Never the display name: two people can share one. */
    readonly spaceUserId: string;
    /** The account of the session, which the server finds the person by when the player walks to them. */
    readonly uuid: string;
    readonly name: string;
    /** The room the session is in, as the page's address. */
    readonly playUri: string;
    readonly roomName: string | undefined;
}

/** A character the scene holds: someone in the area of interest, whose place and distance the scene knows. */
export interface NearbyRow {
    readonly spaceUserId: string;
    readonly uuid: string;
    readonly name: string;
    /** The status the scene last heard of, or `undefined` when it holds none. */
    readonly status: number | undefined;
    readonly place: Place | undefined;
}

/** What a row of the list says about a person. */
export interface PersonRow {
    readonly key: string;
    /** The account the server finds the person by, and the room it looks in: what walking to them asks for. */
    readonly uuid: string;
    readonly playUri: string;
    readonly name: string;
    /** Where the person stands, only for someone in the area of interest: the roster holds no coordinates. */
    readonly place: Place | undefined;
    /** The status the scene heard of; a person who is on the roster has a live one the row follows instead. */
    readonly status: number | undefined;
    /** In another room of the world: the player cannot walk there from this map. */
    readonly elsewhere: boolean;
    readonly roomName: string | undefined;
}

export interface PeopleListInput {
    readonly mode: PeopleMode;
    /** The key of the room the player is in. A session whose `playUri` differs is in another room. */
    readonly roomKey: string;
    /** The player's own session, left out of the rows (it has its own row). `undefined` until the scene says it. */
    readonly mySpaceUserId: string | undefined;
    /** The roster; it is empty when nothing is watching. Only the "everyone" mode reads it. */
    readonly roster: Iterable<RosterPerson>;
    /** The characters around the player, nearest first. */
    readonly nearby: readonly NearbyRow[];
    readonly query: string;
}

export interface PeopleList {
    readonly rows: readonly PersonRow[];
    /** How many people the mode holds, the player not included, before the query and the limit. */
    readonly held: number;
    /** How many of them match the query: more than `rows.length` when the limit cut the list. */
    readonly matching: number;
}

function byName(a: PersonRow, b: PersonRow): number {
    // The key breaks a tie so that two people with one name keep a fixed order, and a row never jumps between renders.
    return a.name.localeCompare(b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

function nearbyRow(person: NearbyRow, roomKey: string): PersonRow {
    return {
        key: person.spaceUserId,
        uuid: person.uuid,
        playUri: roomKey,
        name: person.name,
        place: person.place,
        status: person.status,
        elsewhere: false,
        roomName: undefined,
    };
}

/**
 * The people the list shows, from the one source its mode reads.
 *
 * - "nearby": the characters around the player, nearest first, the first `NEARBY_ROWS` of them.
 * - "everyone": the roster, those around the player first (nearest first) and the others by name, the first
 *   `EVERYONE_ROWS` of them. A person who is both on the roster and around the player takes the place the scene knows.
 *
 * The query is applied before the window, so a search reaches people the window would have cut.
 */
export function listPeople(input: PeopleListInput): PeopleList {
    const around = input.nearby.filter((person) => person.spaceUserId !== input.mySpaceUserId);

    if (input.mode === "nearby") {
        const matching = around.filter((person) => matchesName(person.name, input.query));
        return {
            rows: matching.slice(0, NEARBY_ROWS).map((person) => nearbyRow(person, input.roomKey)),
            held: around.length,
            matching: matching.length,
        };
    }

    const aroundIndex = new Map(around.map((person, index) => [person.spaceUserId, index]));
    const known = new Map(around.map((person) => [person.spaceUserId, person]));
    const near: { index: number; row: PersonRow }[] = [];
    const others: PersonRow[] = [];
    let held = 0;
    let matching = 0;
    for (const person of input.roster) {
        if (person.spaceUserId === input.mySpaceUserId) continue;
        held++;
        if (!matchesName(person.name, input.query)) continue;
        matching++;
        const seen = known.get(person.spaceUserId);
        const row: PersonRow = {
            key: person.spaceUserId,
            uuid: person.uuid,
            playUri: person.playUri,
            name: person.name,
            place: seen?.place,
            status: seen?.status,
            elsewhere: person.playUri !== input.roomKey,
            roomName: person.roomName,
        };
        const index = aroundIndex.get(person.spaceUserId);
        if (index === undefined) others.push(row);
        else near.push({ index, row });
    }
    near.sort((a, b) => a.index - b.index);
    others.sort(byName);
    return {
        rows: [...near.map(({ row }) => row), ...others].slice(0, EVERYONE_ROWS),
        held,
        matching,
    };
}

/** Why the list has no row to show, when it has none. */
export type EmptyReason = "alone" | "nobodyNearby" | "noMatch" | "nobodyNearbyMatches";

/**
 * What the empty list says. Nobody matching a query is told apart from nobody being there, and a world that holds
 * people beyond the ones around the player is not "alone".
 *
 * A search in the near-you mode reaches only the people around the player, so its "no match" is about them and not about
 * the office: the person may be online elsewhere, and the text points to the choice of everyone.
 */
export function emptyReason(input: {
    readonly mode: PeopleMode;
    readonly held: number;
    readonly shown: number;
    readonly query: string;
    /** The count says the player is the only person in the world. */
    readonly worldAlone: boolean;
}): EmptyReason | undefined {
    if (input.shown > 0) return undefined;
    if (input.query.trim() !== "" && input.held > 0) return input.mode === "nearby" ? "nobodyNearbyMatches" : "noMatch";
    if (input.mode === "nearby" && !input.worldAlone) return "nobodyNearby";
    return "alone";
}
