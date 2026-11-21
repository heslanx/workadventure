// @vitest-environment jsdom
import * as Phaser from "phaser";
globalThis.Phaser = Phaser;

import { describe, expect, it, vi } from "vitest";
import type { SpaceUser } from "@workadventure/messages";
import { FilterType } from "@workadventure/messages";
import { get, writable } from "svelte/store";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { Space } from "../Space";

const roomConnection = {
    emitUserJoinSpace: vi.fn(),
    emitAddSpaceFilter: vi.fn(),
    emitJoinSpace: vi.fn(),
    emitRemoveSpaceFilter: vi.fn(),
} as unknown as RoomConnection;

// Mock the entire GameManager module
vi.mock("../../Phaser/Game/GameManager", () => ({
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
vi.mock("../../WebRtc/SimplePeer", () => ({
    SimplePeer: vi.fn().mockImplementation(() => ({
        closeAllConnections: vi.fn(),
        destroy: vi.fn(),
    })),
}));

vi.mock("../../Stores/ScreenSharingStore", () => {
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
    };
});

vi.mock("../../Stores/MegaphoneStore", () => {
    return {
        liveStreamingEnabledStore: writable(false),
        requestedMegaphoneStore: writable(false),
        megaphoneSpaceStore: writable(undefined),
        megaphoneCanBeUsedStore: writable(false),
    };
});

vi.mock("../../Stores/MenuStore", () => {
    return {
        menuIconVisiblilityStore: writable(false),
        menuVisiblilityStore: writable(false),
        screenSharingActivatedStore: writable(false),
        inviteUserActivated: writable(false),
        mapEditorActivated: writable(false),
        roomListActivated: writable(false),
    };
});

vi.mock("../../WebRtc/MediaManager", () => {
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

vi.mock("../../Stores/MediaStore", async (importOriginal) => {
    const actual: object = await importOriginal();
    return {
        ...actual,
        isSpeakerStore: writable(false),
    };
});

vi.mock(
    "../../Enum/EnvironmentVariable.ts",
    () => import("../../../../tests/front/mocks/frontEnvironmentVariableMock"),
);

const signal = new AbortController().signal;

const user = (id: number, name: string, extra: Partial<SpaceUser> = {}): SpaceUser =>
    ({ spaceUserId: `room_${id}`, name, characterTextures: [], tags: [], ...extra }) as unknown as SpaceUser;

async function createSpace(propertiesToSync: string[]): Promise<Space> {
    return Space.create("world", FilterType.ALL_USERS, roomConnection, propertiesToSync, signal, {
        metadata: new Map<string, unknown>(),
    });
}

/** The people the space lists while somebody watches it, as the users store holds them. */
function watchedNames(space: Space): string[] {
    return [...get(space.usersStore).values()].map((member) => member.name);
}

describe("the users of a space nobody watches", () => {
    it("are replaced by the list the pusher sends when somebody watches again: a person who left meanwhile is gone", async () => {
        const space = await createSpace(["availabilityStatus", "chatID"]);
        const stopWatching = space.usersStore.subscribe(() => undefined);
        space.initUsers([user(1, "Ana"), user(2, "Bia")]);
        expect(watchedNames(space)).toEqual(["Ana", "Bia"]);

        stopWatching();
        // Nobody watches: the pusher sends nothing, so Bia leaving is not heard of.
        const watchingAgain = space.usersStore.subscribe(() => undefined);
        space.initUsers([user(1, "Ana")]);

        expect(watchedNames(space)).toEqual(["Ana"]);
        watchingAgain();
    });

    it("take the status the list holds when somebody watches again, not the one they had", async () => {
        const space = await createSpace(["availabilityStatus", "chatID"]);
        const stopWatching = space.usersStore.subscribe(() => undefined);
        space.initUsers([user(1, "Ana", { availabilityStatus: 1 })]);
        stopWatching();

        const watchingAgain = space.usersStore.subscribe(() => undefined);
        space.initUsers([user(1, "Ana", { availabilityStatus: 4 })]);

        expect(get(space.usersStore).get("room_1")?.availabilityStatus).toBe(4);
        watchingAgain();
    });

    it("stay readable until the list comes, for the code that looks a user up without watching", async () => {
        const space = await createSpace(["availabilityStatus", "chatID"]);
        const stopWatching = space.usersStore.subscribe(() => undefined);
        space.initUsers([user(1, "Ana")]);

        stopWatching();

        expect(space.getSpaceUserBySpaceUserId("room_1")?.name).toBe("Ana");
    });

    it("are kept, when the list arrives again, while another watcher keeps the space watched", async () => {
        const space = await createSpace(["availabilityStatus", "chatID"]);
        const first = space.usersStore.subscribe(() => undefined);
        const second = space.usersStore.subscribe(() => undefined);
        space.initUsers([user(1, "Ana")]);
        const ana = space.getSpaceUserBySpaceUserId("room_1");

        first();
        space.initUsers([user(1, "Ana"), user(2, "Bia")]);

        expect(space.getSpaceUserBySpaceUserId("room_1")).toBe(ana);
        expect(watchedNames(space)).toEqual(["Ana", "Bia"]);
        second();
    });
});
