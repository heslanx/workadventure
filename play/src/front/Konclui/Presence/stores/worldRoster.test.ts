// @vitest-environment jsdom
import * as Phaser from "phaser";
globalThis.Phaser = Phaser;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable, type Writable } from "svelte/store";
import type { SpaceUser } from "@workadventure/messages";
import { FilterType } from "@workadventure/messages";
import { emptySpaceState } from "@workadventure/shared-utils";
import type { RoomConnection } from "../../../Connection/RoomConnection";
import { WorldUserProvider } from "../../../Chat/UserProvider/WorldUserProvider";
import { UserProviderMerger } from "../../../Chat/UserProviderMerger/UserProviderMerger";
import { Space } from "../../../Space/Space";
import {
    attachWorldSpace,
    createWorldRoster,
    rosterListOpenStore,
    rosterViewStore,
    UNWATCHED_VIEW,
    worldRosterStore,
    type WorldRoster,
} from "./worldRoster";

// The real space, the real state it keeps and the real subscription that asks the pusher for the world's people: a
// subscription of the users is an `addSpaceFilter` on the connection, which is what these tests count. Only the
// connection and the modules that reach devices are replaced.
const emitAddSpaceFilter = vi.fn();
const emitRemoveSpaceFilter = vi.fn();
const connection = {
    emitUserJoinSpace: vi.fn(),
    emitAddSpaceFilter,
    emitJoinSpace: vi.fn(),
    emitRemoveSpaceFilter,
} as unknown as RoomConnection;

// Mock the entire GameManager module
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: vi.fn(() => ({
            getRemotePlayersRepository: () => ({
                getPlayer: vi.fn(),
            }),
            roomUrl: "test-room",
        })),
    },
}));

// Mock SimplePeer
vi.mock("../../../WebRtc/SimplePeer", () => ({
    SimplePeer: vi.fn().mockImplementation(() => ({
        closeAllConnections: vi.fn(),
        destroy: vi.fn(),
    })),
}));

vi.mock("../../../Stores/ScreenSharingStore", () => {
    const requested = writable(false);
    return {
        requestedScreenSharingState: {
            subscribe: requested.subscribe,
            enableScreenSharing: () => requested.set(true),
            disableScreenSharing: () => requested.set(false),
        },
        screenSharingLocalStreamStore: writable({ type: "success" }),
        screenSharingConstraintsStore: writable({ video: false, audio: false }),
        screenSharingAvailableStore: writable(false),
        screenSharingLocalVideoBox: writable(undefined),
        screenShareQualityStore: {
            subscribe: writable("recommended").subscribe,
            setQuality: vi.fn(),
        },
        screenSharingLocalMedia: writable(undefined),
        activeScreenShareSourceStore: writable(undefined),
    };
});

vi.mock("../../../Stores/MegaphoneStore", () => {
    return {
        liveStreamingEnabledStore: writable(false),
        requestedMegaphoneStore: writable(false),
        megaphoneSpaceStore: writable(undefined),
        megaphoneCanBeUsedStore: writable(false),
    };
});

vi.mock("../../../Stores/MenuStore", () => {
    return {
        menuIconVisiblilityStore: writable(false),
        menuVisiblilityStore: writable(false),
        screenSharingActivatedStore: writable(false),
        inviteUserActivated: writable(false),
        mapEditorActivated: writable(false),
        roomListActivated: writable(false),
    };
});

vi.mock("../../../WebRtc/MediaManager", () => {
    return {
        MediaManager: vi.fn(),
        mediaManager: {
            enableMyCamera: vi.fn(),
            disableMyCamera: vi.fn(),
            enableMyMicrophone: vi.fn(),
            disableMyMicrophone: vi.fn(),
            enableProximityMeeting: vi.fn(),
            disableProximityMeeting: vi.fn(),
        },
    };
});

vi.mock("../../../Stores/MediaStore", async (importOriginal) => {
    const actual: object = await importOriginal();
    return {
        ...actual,
        isSpeakerStore: writable(false),
    };
});

vi.mock(
    "../../../Enum/EnvironmentVariable.ts",
    () => import("../../../../../tests/front/mocks/frontEnvironmentVariableMock"),
);

const signal = new AbortController().signal;

const adds = () => emitAddSpaceFilter.mock.calls.length;
const removes = () => emitRemoveSpaceFilter.mock.calls.length;

const session = (id: number, name: string, uuid = `account-${id}`): SpaceUser =>
    ({
        spaceUserId: `room_${id}`,
        name,
        uuid,
        playUri: "room",
        characterTextures: [],
        tags: [],
        availabilityStatus: 1,
    }) as unknown as SpaceUser;

/** The state the back sends right after the client joins the world space: the root, replaced. */
function sendState(space: Space, headcount?: number): void {
    const state = { ...emptySpaceState(), ...(headcount === undefined ? {} : { headcount }) };
    space.state.applyPatch(JSON.stringify([{ op: "replace", path: "", value: state }]));
}

/** A change of the headcount, as the back publishes it once the state has arrived. */
function sendHeadcount(space: Space, headcount: number): void {
    space.state.applyPatch(JSON.stringify([{ op: "add", path: "/headcount", value: headcount }]));
}

/** The pusher's answer to `addSpaceFilter`: every person of the world. */
function sendRoster(space: Space, ...sessions: SpaceUser[]): void {
    space.initUsers(sessions);
}

/**
 * Lets the work the space defers to the next tick run: it releases the extra watch that `getUsers` takes. The timer is
 * taken from `globalThis`: the architecture test of the context rejects a call of the timer with a short delay.
 */
const defer = globalThis.setTimeout;
const nextTick = () =>
    new Promise<void>((resolve) => {
        defer(resolve, 0);
    });

const names = (roster: WorldRoster) => [...get(roster.view).users.values()].map((user) => user.name);

let space: Space;
let panelOpen: Writable<boolean>;
let roster: WorldRoster;

beforeEach(async () => {
    emitAddSpaceFilter.mockClear();
    emitRemoveSpaceFilter.mockClear();
    space = await Space.create(
        "office.allWorldUser",
        FilterType.ALL_USERS,
        connection,
        ["availabilityStatus", "chatID"],
        signal,
        { metadata: new Map<string, unknown>() },
    );
    panelOpen = writable(false);
    roster = createWorldRoster(space, panelOpen);
});

afterEach(async () => {
    roster.destroy();
    await nextTick();
});

describe("the world's count", () => {
    it("is not known, and nothing is watched, until the state of the world space has arrived", () => {
        expect(get(roster.count)).toBe(0);
        expect(adds()).toBe(0);
    });

    it("is the headcount the back sends, without watching a single person", () => {
        sendState(space, 640);

        expect(get(roster.count)).toBe(640);
        expect(adds()).toBe(0);
    });

    it("follows the headcount as it changes", () => {
        sendState(space, 640);

        sendHeadcount(space, 641);

        expect(get(roster.count)).toBe(641);
    });

    it("is the headcount, not the length of the list the open panel holds", async () => {
        sendState(space, 7);
        panelOpen.set(true);
        sendRoster(space, session(1, "Ana"), session(2, "Bia"), session(3, "Caio"));
        await nextTick();

        expect(names(roster)).toEqual(["Ana", "Bia", "Caio"]);
        expect(get(roster.count)).toBe(7);
    });

    it("is zero people known as zero, not as unknown, once the back says so", () => {
        sendState(space, 0);

        expect(get(roster.count)).toBe(0);
        expect(get(roster.view).headcount).toBe(0);
    });
});

describe("watching the roster", () => {
    it("sends no addSpaceFilter while the panel is closed, at 50 people or at 500", () => {
        sendState(space, 50);
        sendHeadcount(space, 500);

        expect(adds()).toBe(0);
    });

    it("sends addSpaceFilter when the panel opens in a world of 150, and stops when it closes", async () => {
        sendState(space, 150);

        panelOpen.set(true);
        expect(adds()).toBe(1);
        expect(get(roster.view).watching).toBe(true);

        panelOpen.set(false);
        await nextTick();
        expect(removes()).toBe(1);
        expect(get(roster.view).watching).toBe(false);
    });

    it("sends no addSpaceFilter while the panel is open in a world of 500, which lists the people around instead", () => {
        sendState(space, 500);

        panelOpen.set(true);

        expect(adds()).toBe(0);
        expect(get(roster.view).mode).toBe("nearby");
        expect(get(roster.view).canChooseEveryone).toBe(true);
    });

    it("watches on demand when the user asks for everyone above the limit, and stops when the panel closes", async () => {
        sendState(space, 500);
        panelOpen.set(true);

        roster.chooseEveryone();
        expect(adds()).toBe(1);
        expect(get(roster.view).mode).toBe("everyone");
        expect(get(roster.view).canChooseEveryone).toBe(false);

        panelOpen.set(false);
        await nextTick();
        expect(removes()).toBe(1);
    });

    it("forgets the choice of everyone when the panel closes: the next opening is light again", () => {
        sendState(space, 500);
        panelOpen.set(true);
        roster.chooseEveryone();
        panelOpen.set(false);
        emitAddSpaceFilter.mockClear();

        panelOpen.set(true);

        expect(adds()).toBe(0);
        expect(get(roster.view).mode).toBe("nearby");
    });

    it("stops watching when the world grows past 220, and not before: no flicker between 181 and 220", async () => {
        sendState(space, 150);
        panelOpen.set(true);
        expect(get(roster.view).watching).toBe(true);

        for (const count of [201, 215, 220]) {
            sendHeadcount(space, count);
            expect(get(roster.view).watching).toBe(true);
        }

        sendHeadcount(space, 221);
        await nextTick();
        expect(get(roster.view).watching).toBe(false);
        expect(get(roster.view).mode).toBe("nearby");

        for (const count of [219, 205, 181]) {
            sendHeadcount(space, count);
            expect(get(roster.view).watching).toBe(false);
        }

        sendHeadcount(space, 180);
        expect(get(roster.view).watching).toBe(true);
        expect(get(roster.view).mode).toBe("everyone");
    });

    // The first reconcile runs when the roster subscribes to the space state, before the state has arrived and with no
    // count. That one must not decide the mode: the first count that is known decides it, by the limit alone, or a world of
    // 181 to 200 people would start in the near-you mode that only a world above 220 is in.
    it.each([150, 180, 181, 190, 200])(
        "lists everyone when the first count known is %i, opened before the state arrives",
        (headcount) => {
            panelOpen.set(true);
            expect(adds()).toBe(0);

            sendState(space, headcount);

            expect(adds()).toBe(1);
            expect(get(roster.view).mode).toBe("everyone");
            expect(get(roster.view).watching).toBe(true);
        },
    );

    it.each([181, 190, 200])(
        "lists everyone when the first count known is %i, opened after the state arrived",
        (headcount) => {
            sendState(space, headcount);
            expect(get(roster.view).mode).toBe("everyone");

            panelOpen.set(true);

            expect(adds()).toBe(1);
            expect(get(roster.view).canChooseEveryone).toBe(false);
        },
    );

    it.each([201, 220, 500])("lists the people around when the first count known is %i", (headcount) => {
        panelOpen.set(true);

        sendState(space, headcount);

        expect(adds()).toBe(0);
        expect(get(roster.view).mode).toBe("nearby");
        expect(get(roster.view).canChooseEveryone).toBe(true);
    });

    it("lets an empty world that then holds 190 people start in everyone, not near you", () => {
        panelOpen.set(true);
        sendState(space, 0);
        expect(adds()).toBe(0);

        sendHeadcount(space, 190);

        expect(adds()).toBe(1);
        expect(get(roster.view).mode).toBe("everyone");
    });

    it("asks the pusher once however often the panel opens and closes within a tick", async () => {
        sendState(space, 150);

        panelOpen.set(true);
        panelOpen.set(false);
        panelOpen.set(true);
        await nextTick();

        expect(adds()).toBe(1);
        expect(removes()).toBe(0);
        expect(get(roster.view).watching).toBe(true);
    });
});

describe("the list while it is watched", () => {
    it("is loading until the pusher has sent the whole list, not an empty list", async () => {
        sendState(space, 150);
        panelOpen.set(true);

        expect(get(roster.view).synced).toBe(false);

        sendRoster(space, session(1, "Ana"));
        await nextTick();
        expect(get(roster.view).synced).toBe(true);
        expect(names(roster)).toEqual(["Ana"]);
    });

    it("leaves no stale person behind: someone who left while nobody watched is gone at the next watch", async () => {
        sendState(space, 150);
        panelOpen.set(true);
        sendRoster(space, session(1, "Ana"), session(2, "Bia"));
        await nextTick();
        expect(names(roster)).toEqual(["Ana", "Bia"]);

        panelOpen.set(false);
        await nextTick();
        expect(get(roster.view).users.size).toBe(0);

        panelOpen.set(true);
        expect(get(roster.view).users.size).toBe(0);
        sendRoster(space, session(1, "Ana"));
        await nextTick();
        expect(names(roster)).toEqual(["Ana"]);
    });

    it("gathers a burst of 100 joins into two updates, the first at once and the rest a second later", async () => {
        vi.useFakeTimers();
        try {
            sendState(space, 150);
            panelOpen.set(true);
            sendRoster(space);
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(1000);
            const updates: number[] = [];
            const stop = roster.view.subscribe((view) => updates.push(view.users.size));
            updates.length = 0;

            for (let id = 1; id <= 100; id++) space.addUser(session(id, `Pessoa ${id}`));
            // The first join is shown at once; the 99 that follow wait for the second to end.
            expect(updates).toEqual([1]);

            await vi.advanceTimersByTimeAsync(1000);
            expect(updates).toEqual([1, 100]);
            stop();
        } finally {
            vi.useRealTimers();
        }
    });
});

// The chat reads the world's people too: its member avatars, its mention search and the subtitle of a conversation
// subscribe `usersByRoomStore` of the merger, and the merger's world provider is built on a store of the world's users.
// Built on the space's own store, the first of those readers would watch every person of the world, at any headcount,
// whatever the panel does. The scene builds the provider on the roster's `users` instead, so the chat is held to the same
// rule as the panel.
describe("the chat reading the world's people", () => {
    const chatUsers = (merger: UserProviderMerger) =>
        [...get(merger.usersByRoomStore).values()].flatMap((room) => room.users.map((user) => user.username));

    /** What the scene builds for the chat: the world provider on the roster's users, merged as the chat reads them. */
    const chatOf = (world: WorldRoster) => new UserProviderMerger([new WorldUserProvider({ usersStore: world.users })]);

    it("is what the space's own store does, so that the counts below can tell a watch from none", () => {
        sendState(space, 500);
        const merger = new UserProviderMerger([new WorldUserProvider(space)]);

        const stop = merger.usersByRoomStore.subscribe(() => undefined);

        expect(adds()).toBe(1);
        stop();
    });

    it("sends no addSpaceFilter in a world of 500 while the chat reads, with the panel closed", () => {
        sendState(space, 500);
        const stop = chatOf(roster).usersByRoomStore.subscribe(() => undefined);

        expect(adds()).toBe(0);
        expect(get(roster.view).watching).toBe(false);
        stop();
    });

    it("sends no addSpaceFilter above 220 however long the chat reads, and none just for opening the panel", () => {
        sendState(space, 150);
        sendHeadcount(space, 640);
        const stop = chatOf(roster).usersByRoomStore.subscribe(() => undefined);
        panelOpen.set(true);
        panelOpen.set(false);

        expect(adds()).toBe(0);
        stop();
    });

    it("asks for the people in a world of 150 while the chat reads, and gives them to it", async () => {
        sendState(space, 150);
        const merger = chatOf(roster);

        const stop = merger.usersByRoomStore.subscribe(() => undefined);
        expect(adds()).toBe(1);
        sendRoster(space, session(1, "Ana"), session(2, "Bia"));
        await nextTick();

        expect(chatUsers(merger)).toEqual(["Ana", "Bia"]);
        stop();
    });

    it("lets go of the people when the chat stops reading, and does not watch before it reads", async () => {
        sendState(space, 150);
        const merger = chatOf(roster);
        expect(adds()).toBe(0);

        const stop = merger.usersByRoomStore.subscribe(() => undefined);
        stop();
        await nextTick();

        expect(removes()).toBe(1);
        expect(get(roster.view).watching).toBe(false);
    });

    it("keeps the people while the chat reads and the panel closes, and stops when the chat does", async () => {
        sendState(space, 150);
        const stop = chatOf(roster).usersByRoomStore.subscribe(() => undefined);
        panelOpen.set(true);

        panelOpen.set(false);
        await nextTick();
        expect(removes()).toBe(0);
        expect(get(roster.view).watching).toBe(true);

        stop();
        await nextTick();
        expect(removes()).toBe(1);
    });

    it("hears of the people the roster publishes, once a second at most, as the panel does", async () => {
        vi.useFakeTimers();
        try {
            sendState(space, 150);
            const merger = chatOf(roster);
            const sizes: number[] = [];
            const stop = merger.usersByRoomStore.subscribe((byRoom) =>
                sizes.push([...byRoom.values()].reduce((total, room) => total + room.users.length, 0)),
            );
            sendRoster(space);
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(1000);
            sizes.length = 0;

            for (let id = 1; id <= 50; id++) space.addUser(session(id, `Pessoa ${id}`));
            await vi.advanceTimersByTimeAsync(1000);

            expect(sizes.at(-1)).toBe(50);
            expect(sizes.length).toBeLessThanOrEqual(3);
            stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it("gives the chat nothing once the roster is released", () => {
        sendState(space, 150);
        const merger = chatOf(roster);
        const stop = merger.usersByRoomStore.subscribe(() => undefined);

        roster.destroy();

        expect(chatUsers(merger)).toEqual([]);
        stop();
    });
});

describe("a back that sends no headcount", () => {
    it("counts the world from the roster, as upstream does: the roster is watched from the start", async () => {
        sendState(space);

        expect(adds()).toBe(1);
        expect(get(roster.count)).toBe(0);

        sendRoster(space, session(1, "Ana", "ana"), session(2, "Ana", "ana"), session(3, "Bia", "bia"));
        await nextTick();

        expect(get(roster.count)).toBe(2);
    });

    it("keeps watching with the panel closed, because the count needs the roster", () => {
        sendState(space);
        panelOpen.set(true);
        panelOpen.set(false);

        expect(get(roster.view).watching).toBe(true);
    });

    it("stops watching once the back does send a headcount", async () => {
        sendState(space);
        expect(get(roster.view).watching).toBe(true);

        sendHeadcount(space, 12);
        await nextTick();

        expect(get(roster.view).watching).toBe(false);
        expect(get(roster.count)).toBe(12);
    });
});

describe("releasing the roster", () => {
    it("stops watching and forgets the count when it is destroyed", async () => {
        sendState(space, 150);
        panelOpen.set(true);

        roster.destroy();
        await nextTick();

        expect(removes()).toBe(1);
        expect(get(roster.count)).toBe(0);
        expect(get(roster.view)).toEqual(UNWATCHED_VIEW);
    });
});

describe("the roster of the scene that runs", () => {
    beforeEach(() => {
        rosterListOpenStore.set(false);
    });

    it("is attached with the world space, gives the scene its count, and is released when the scene is gone", () => {
        const scene = new AbortController();
        sendState(space, 42);

        const { count } = attachWorldSpace(space, scene.signal);

        expect(get(count)).toBe(42);
        expect(get(worldRosterStore)).toBeDefined();
        expect(adds()).toBe(0);

        scene.abort();
        expect(get(worldRosterStore)).toBeUndefined();
        expect(get(rosterViewStore)).toEqual(UNWATCHED_VIEW);
    });

    it("watches while the panel store says the panel is open", () => {
        const scene = new AbortController();
        sendState(space, 42);
        attachWorldSpace(space, scene.signal);

        rosterListOpenStore.set(true);

        expect(adds()).toBe(1);
        expect(get(rosterViewStore).watching).toBe(true);
        scene.abort();
    });

    it("gives the scene the people for the chat, held to the same rule, and takes them back when the scene is gone", () => {
        const scene = new AbortController();
        sendState(space, 640);
        const { users } = attachWorldSpace(space, scene.signal);

        const stop = users.subscribe(() => undefined);
        expect(adds()).toBe(0);

        scene.abort();
        stop();
        expect(get(users).size).toBe(0);
        expect(get(worldRosterStore)).toBeUndefined();
    });

    it("gives back an empty count and keeps nothing when the scene is already gone", () => {
        const scene = new AbortController();
        scene.abort();

        const { count, users } = attachWorldSpace(space, scene.signal);

        expect(get(count)).toBe(0);
        expect(get(users).size).toBe(0);
        expect(get(worldRosterStore)).toBeUndefined();
    });
});
