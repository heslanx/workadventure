import { derived, type Readable } from "svelte/store";
import { availabilityStatusStore } from "../../../Stores/MediaStore";
import type { CrowdReading } from "../domain/crowd";
import { emptyReason, listPeople, type EmptyReason, type PersonRow, type RosterPerson } from "../domain/peopleList";
import type { Place } from "../domain/place";
import type { PeopleMode } from "../domain/rosterWatch";
import { crowdStore } from "./crowdStore";
import { peopleQueryStore } from "./peopleSearchStore";
import { rosterViewStore, type RosterUsers } from "./worldRoster";

/** The player's own row: first in the list, never a person to walk to. */
export interface MeRow {
    readonly name: string;
    readonly place: Place | undefined;
    /** The player's own availability status. */
    readonly status: number;
}

/** What the people panel draws. */
export interface PeoplePanelState {
    /** What there is to show: the list is on its way, did not come, or is here. */
    readonly phase: "loading" | "unavailable" | "ready";
    readonly mode: PeopleMode;
    /** How many people the world holds, or 0 while that is not known. Never the length of the list. */
    readonly count: number;
    /** `undefined` until the scene has read the player once. */
    readonly me: MeRow | undefined;
    readonly rows: readonly PersonRow[];
    /** The roster by session, for the live status of a row: empty unless the list is everyone. */
    readonly users: RosterUsers;
    /** How many people match the search when the window cut the list, so the panel says it shows the first of them. */
    readonly cutOf: number | undefined;
    readonly empty: EmptyReason | undefined;
    readonly canChooseEveryone: boolean;
    /** The search has text: the panel's wording follows it. */
    readonly searching: boolean;
}

/** The roster as the pure list reads it, one session at a time and without building an array. */
function* sessionsOf(users: RosterUsers): Generator<RosterPerson> {
    for (const user of users.values()) {
        yield {
            spaceUserId: user.spaceUserId,
            uuid: user.uuid,
            name: user.name,
            playUri: user.playUri,
            roomName: user.roomName,
        };
    }
}

/** What the panel draws, from the roster, the people around the player, the search and the player's own status. */
export const peoplePanelStore: Readable<PeoplePanelState> = derived(
    [rosterViewStore, crowdStore, peopleQueryStore, availabilityStatusStore],
    ([view, crowd, query, myStatus]): PeoplePanelState => {
        const reading: CrowdReading | undefined = crowd;
        const list = listPeople({
            mode: view.mode,
            roomKey: reading?.roomKey ?? "",
            mySpaceUserId: reading?.me.spaceUserId,
            roster: sessionsOf(view.users),
            nearby: reading?.people ?? [],
            query,
        });
        const phase =
            view.mode === "everyone"
                ? view.failed
                    ? "unavailable"
                    : view.synced
                      ? "ready"
                      : "loading"
                : reading === undefined
                  ? "loading"
                  : "ready";
        return {
            phase,
            mode: view.mode,
            count: view.headcount,
            me:
                reading === undefined
                    ? undefined
                    : { name: reading.me.name, place: reading.me.place, status: myStatus },
            rows: list.rows,
            users: view.users,
            cutOf: list.matching > list.rows.length ? list.matching : undefined,
            empty:
                phase === "ready"
                    ? emptyReason({
                          mode: view.mode,
                          held: list.held,
                          shown: list.rows.length,
                          query,
                          worldAlone: view.headcount === 1,
                      })
                    : undefined,
            canChooseEveryone: view.canChooseEveryone,
            searching: query.trim() !== "",
        };
    },
);
