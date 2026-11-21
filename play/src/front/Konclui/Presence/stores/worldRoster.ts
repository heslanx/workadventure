import { derived, get, readable, writable, type Readable } from "svelte/store";
import { on } from "svelte/events";
import type { WorldSpaceReading } from "../../../ExternalModule/ClientExtensionPoints";
import type { SpaceInterface, SpaceUserExtended } from "../../../Space/SpaceInterface";
import {
    countSource,
    distinctPeople,
    modeForCount,
    modeShown,
    shouldWatchRoster,
    type PeopleMode,
} from "../domain/rosterWatch";

// The world roster, watched only while something reads it.
//
// Every client joins the world space at scene start, and subscribing the space's users is what asks the pusher for every
// person of the world and for each join, leave and update after that. So this module subscribes them only when the
// people panel is open and the world is small enough (`domain/rosterWatch.ts`), or when the user asked for everyone. The
// chat reads the people of the world too, and goes through the same rule by `users` below: nothing outside this module
// subscribes the space's own store. The count of the world comes from the headcount the back keeps in the space state,
// which reaches every member of the space whether it watches or not.

/** The people the panel lists, as the roster holds them. */
export type RosterUsers = ReadonlyMap<string, SpaceUserExtended>;

/** What the world roster is doing, for the people panel to draw. */
export interface RosterView {
    /** The people the panel lists: everyone, or the ones around the player. */
    readonly mode: PeopleMode;
    /** The world asks for the people around the player, and the user can ask for everyone instead. */
    readonly canChooseEveryone: boolean;
    /** The roster is subscribed: the pusher is sending the world's people. */
    readonly watching: boolean;
    /** The pusher has sent the whole list since the watch began. Until then the list says "loading", not "nobody". */
    readonly synced: boolean;
    /** The pusher did not send the list. */
    readonly failed: boolean;
    /** The people of the world, one per session; empty while nothing watches. */
    readonly users: RosterUsers;
    /** How many people the world holds, or 0 while that is not known. */
    readonly headcount: number;
}

export interface WorldRoster {
    /** How many people the world holds, or 0 while that is not known: what the header, the pill and the list read. */
    readonly count: Readable<number>;
    readonly view: Readable<RosterView>;
    /**
     * The people of the world for what lists them besides the panel: the chat. A subscriber asks for the list the way the
     * open panel does, so it is watched only in a world that lists everyone, and it is empty until the pusher has sent it,
     * and in a world above the limit.
     */
    readonly users: Readable<RosterUsers>;
    /** The user asks for everyone in a world above the limit. It lasts until the panel closes. */
    chooseEveryone(): void;
    /** Stops every subscription and timer, and forgets the roster. */
    destroy(): void;
}

const NO_USERS: RosterUsers = new Map();

export const UNWATCHED_VIEW: RosterView = {
    mode: "nearby",
    canChooseEveryone: false,
    watching: false,
    synced: false,
    failed: false,
    users: NO_USERS,
    headcount: 0,
};

/**
 * The world roster of `space`: the count, and the list while somebody reads it.
 *
 * `listOpen` says whether the people panel is on screen, which is what makes the list worth watching. The roster is
 * published at most once a second, with the first change at once and the others gathered, so a burst of joins is one
 * update of the list and not a thousand.
 */
export function createWorldRoster(space: SpaceInterface, listOpen: Readable<boolean>): WorldRoster {
    const countStore = writable(0);
    const viewStore = writable<RosterView>(UNWATCHED_VIEW);

    let stateSynced = false;
    let headcount: number | undefined;
    let open = false;
    let chatReads = false;
    let chosenEveryone = false;
    let mode: PeopleMode | undefined;
    let users: RosterUsers = NO_USERS;
    let rosterSynced = false;
    let failed = false;
    let stopWatching: (() => void) | undefined;
    let starting = false;
    let destroyed = false;
    let lastFlush = Number.NEGATIVE_INFINITY;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let published: RosterView = UNWATCHED_VIEW;

    function countNow(source: ReturnType<typeof countSource>): number {
        if (source === "state") return headcount ?? 0;
        // The roster counts only once its list has arrived: before that, its size is not the world's.
        if (source === "roster") return rosterSynced ? distinctPeople(users.values()) : 0;
        return 0;
    }

    function publish(rosterChanged: boolean, count: number): void {
        const view: RosterView = {
            mode: modeShown(mode ?? "nearby", chosenEveryone),
            // Asked for only once the count is known: a list that has not found out how big the world is offers nothing.
            canChooseEveryone: (mode ?? "nearby") === "nearby" && count > 0 && !chosenEveryone,
            watching: stopWatching !== undefined,
            synced: rosterSynced,
            failed,
            // Until the pusher has sent the list, what the space holds is what an earlier watch left behind.
            users: rosterSynced ? users : NO_USERS,
            headcount: count,
        };
        // The roster map is changed in place by the space, so a change of its content is not a change of the reference.
        const changed =
            rosterChanged ||
            view.mode !== published.mode ||
            view.canChooseEveryone !== published.canChooseEveryone ||
            view.watching !== published.watching ||
            view.synced !== published.synced ||
            view.failed !== published.failed ||
            view.users !== published.users ||
            view.headcount !== published.headcount;
        if (!changed) return;
        published = view;
        viewStore.set(view);
    }

    function startWatching(): void {
        const abort = new AbortController();
        rosterSynced = false;
        failed = false;
        starting = true;
        const stopUsers = space.usersStore.subscribe((next) => onRosterChanged(next));
        starting = false;
        stopWatching = () => {
            abort.abort();
            stopUsers();
        };
        // The subscription asks the pusher for the list; this resolves when the whole list has arrived.
        space
            .getUsers({ signal: abort.signal })
            .then(() => {
                if (abort.signal.aborted) return;
                rosterSynced = true;
                flush();
            })
            .catch((error: unknown) => {
                if (abort.signal.aborted) return;
                console.error("[konclui] presence: the world roster could not be loaded", error);
                failed = true;
                flush();
            });
    }

    function stopWatchingRoster(): void {
        stopWatching?.();
        stopWatching = undefined;
        // What was held belongs to a watch that stopped: it is not shown again, and the space drops it as well.
        users = NO_USERS;
        rosterSynced = false;
        failed = false;
        if (flushTimer !== undefined) {
            clearTimeout(flushTimer);
            flushTimer = undefined;
        }
    }

    /** Decides from what is known whether the roster is watched, and publishes. */
    function reconcile(rosterChanged = false): void {
        if (destroyed) return;
        const source = countSource({ synced: stateSynced, headcount });
        const count = countNow(source);
        // Only a count that is known decides the mode. The first reconcile runs on subscribe, before the state has
        // arrived: letting it set "nearby" would make the next count the second one, ruled by the hysteresis, and a world of
        // 181 to 200 people would start near-you instead of listing everyone.
        if (count > 0) mode = modeForCount(mode, count);
        const watch = shouldWatchRoster({
            panelOpen: open,
            chatReads,
            mode: mode ?? "nearby",
            chosenEveryone,
            countNeedsRoster: source === "roster",
        });
        if (watch && stopWatching === undefined) startWatching();
        else if (!watch && stopWatching !== undefined) stopWatchingRoster();
        publish(rosterChanged, count);
        countStore.set(count);
    }

    function flush(): void {
        lastFlush = Date.now();
        reconcile(true);
    }

    function onRosterChanged(next: RosterUsers): void {
        users = next;
        // Subscribing hands over the current list at once; the reconcile that subscribed publishes it.
        if (starting || destroyed) return;
        if (flushTimer !== undefined) return;
        if (Date.now() - lastFlush >= 1000) {
            flush();
            return;
        }
        // A change within a second of the last one waits for it to end; the one timer publishes the latest list.
        flushTimer = setTimeout(() => {
            flushTimer = undefined;
            flush();
        }, 1000);
    }

    const stopState = space.state.store.subscribe((state) => {
        stateSynced = space.state.isInitialized();
        headcount = state.headcount;
        reconcile();
    });
    const stopOpen = listOpen.subscribe((isOpen) => {
        open = isOpen;
        // Everyone was asked for in this opening of the panel; the next opening starts light again.
        if (!isOpen) chosenEveryone = false;
        reconcile();
    });

    // The chat reads while it has a subscriber: the first one asks for the list, the last one lets it go.
    const chatUsers = readable<RosterUsers>(NO_USERS, (set) => {
        chatReads = true;
        const stopView = viewStore.subscribe((view) => set(view.users));
        reconcile();
        return () => {
            stopView();
            chatReads = false;
            reconcile();
        };
    });

    return {
        count: { subscribe: countStore.subscribe },
        view: { subscribe: viewStore.subscribe },
        users: chatUsers,
        chooseEveryone() {
            if (chosenEveryone) return;
            chosenEveryone = true;
            reconcile();
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            stopState();
            stopOpen();
            stopWatchingRoster();
            countStore.set(0);
            viewStore.set(UNWATCHED_VIEW);
        },
    };
}

// What the panel and the scene share. There is one world space per scene, so one roster at a time.

/** Whether the people panel is on screen: the panel sets it while it is mounted. */
export const rosterListOpenStore = writable(false);

const currentRoster = writable<WorldRoster | undefined>(undefined);

/** The roster of the scene that is running, or `undefined` before it has joined the world space and after it left. */
export const worldRosterStore: Readable<WorldRoster | undefined> = { subscribe: currentRoster.subscribe };

/** What the roster is doing; `UNWATCHED_VIEW` while there is no scene. */
export const rosterViewStore: Readable<RosterView> = derived(
    currentRoster,
    (roster, set) => {
        if (roster === undefined) {
            set(UNWATCHED_VIEW);
            return undefined;
        }
        return roster.view.subscribe(set);
    },
    UNWATCHED_VIEW,
);

/**
 * What the scene gives the world space to: the roster that counts the world and lists it. It returns the count the
 * scene publishes and the people it gives the chat, and gives the roster back when `signal` aborts, as the scene is gone.
 */
export function attachWorldSpace(space: SpaceInterface, signal: AbortSignal): WorldSpaceReading {
    const roster = createWorldRoster(space, rosterListOpenStore);
    currentRoster.set(roster);
    const release = (): void => {
        roster.destroy();
        if (get(currentRoster) === roster) currentRoster.set(undefined);
    };
    if (signal.aborted) {
        release();
        return { count: readable(0), users: readable(NO_USERS) };
    }
    const stopListening = on(signal, "abort", () => {
        stopListening();
        release();
    });
    return { count: roster.count, users: roster.users };
}

/** The user asks for everyone in a world above the limit. */
export function chooseEveryone(): void {
    get(currentRoster)?.chooseEveryone();
}
