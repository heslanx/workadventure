import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceUser } from "@workadventure/messages";
// The states and CommunicationManager import each other: load them in the order the back does, from the manager.
import "../src/Model/CommunicationManager";
import { WebRTCState } from "../src/Model/States/WebRTCState";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";

interface Dispatch {
    receiverUserId: string;
    spaceEvent: { event: { $case: string } };
}

function createUser(spaceUserId: string): SpaceUser {
    return SpaceUser.fromPartial({ spaceUserId, uuid: `uuid-${spaceUserId}`, name: spaceUserId });
}

function createSpace(dispatchPrivateEvent: ReturnType<typeof vi.fn>, usersInSpace: SpaceUser[]): ICommunicationSpace {
    return {
        getAllUsers: () => usersInSpace,
        dispatchPrivateEvent,
        dispatchPublicEvent: vi.fn(),
        getSpaceName: () => "test-space",
        getUser: (spaceUserId: string) => usersInSpace.find((user) => user.spaceUserId === spaceUserId),
    } as unknown as ICommunicationSpace;
}

/** The cases each user received, in order. */
function receivedBy(dispatchPrivateEvent: ReturnType<typeof vi.fn>, spaceUserId: string): string[] {
    return dispatchPrivateEvent.mock.calls
        .map((call) => call[0] as Dispatch)
        .filter((event) => event.receiverUserId === spaceUserId)
        .map((event) => event.spaceEvent.event.$case);
}

function setup() {
    const dispatchPrivateEvent = vi.fn();
    const alice = createUser("alice");
    const bob = createUser("bob");
    const users = new Map<string, SpaceUser>();
    const usersToNotify = new Map<string, SpaceUser>();
    const state = new WebRTCState(createSpace(dispatchPrivateEvent, [alice, bob]), users, usersToNotify);
    return { dispatchPrivateEvent, alice, bob, users, usersToNotify, state };
}

describe("WebRTCState", () => {
    it("tells a peer the strategy before its WebRTC start, when both entered the registries before either was handled", async () => {
        // What a join burst looks like after the transition lock: both users already sit in both registries
        // (the manager fills them before waiting), then the handlers run one after the other.
        const { dispatchPrivateEvent, alice, bob, users, usersToNotify, state } = setup();
        await state.init();
        for (const user of [alice, bob]) {
            users.set(user.spaceUserId, user);
            usersToNotify.set(user.spaceUserId, user);
        }

        await state.handleUserAdded(alice);
        await state.handleUserToNotifyAdded(alice);
        await state.handleUserAdded(bob);
        await state.handleUserToNotifyAdded(bob);

        for (const user of [alice, bob]) {
            const received = receivedBy(dispatchPrivateEvent, user.spaceUserId);
            expect(received[0]).toBe("switchMessage");
            expect(received.filter((c) => c === "switchMessage")).toHaveLength(1);
            expect(received).toContain("webRtcStartMessage");
        }
    });

    it("tells the strategy once to a user entering the registries one at a time", async () => {
        const { dispatchPrivateEvent, alice, users, usersToNotify, state } = setup();
        await state.init();

        users.set(alice.spaceUserId, alice);
        await state.handleUserAdded(alice);
        usersToNotify.set(alice.spaceUserId, alice);
        await state.handleUserToNotifyAdded(alice);

        expect(receivedBy(dispatchPrivateEvent, "alice")).toEqual(["switchMessage"]);
    });

    it("tells a user again after they left both registries and came back", async () => {
        const { dispatchPrivateEvent, alice, users, state } = setup();
        await state.init();
        users.set(alice.spaceUserId, alice);
        await state.handleUserAdded(alice);

        users.delete(alice.spaceUserId);
        await state.handleUserDeleted(alice);
        users.set(alice.spaceUserId, alice);
        await state.handleUserAdded(alice);

        expect(receivedBy(dispatchPrivateEvent, "alice")).toEqual(["switchMessage", "switchMessage"]);
    });

    it("does not tell again the users the previous state switched over", async () => {
        // A transition: the old state's switchState() told everyone in the registries, then the new state's init()
        const { dispatchPrivateEvent, alice, bob, users, usersToNotify, state } = setup();
        users.set(alice.spaceUserId, alice);
        usersToNotify.set(alice.spaceUserId, alice);
        await state.init();

        users.set(bob.spaceUserId, bob);
        await state.handleUserAdded(bob);

        expect(receivedBy(dispatchPrivateEvent, "alice")).not.toContain("switchMessage");
        expect(receivedBy(dispatchPrivateEvent, "bob")).toEqual(["switchMessage"]);
    });
});

describe("WebRTCState peer cap", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    /** One speaker and ten watchers, paired when the state starts. */
    async function startsToTheSpeaker(
        newState: (
            space: ICommunicationSpace,
            users: ReadonlyMap<string, SpaceUser>,
            usersToNotify: ReadonlyMap<string, SpaceUser>,
        ) => { init(): Promise<void> },
    ): Promise<number> {
        const dispatchPrivateEvent = vi.fn();
        const speaker = createUser("speaker");
        const watchers = Array.from({ length: 10 }, (_, index) => createUser(`watcher-${index + 1}`));
        const usersToNotify = new Map([speaker, ...watchers].map((user) => [user.spaceUserId, user]));
        const users = new Map([[speaker.spaceUserId, speaker]]);

        await newState(createSpace(dispatchPrivateEvent, [speaker, ...watchers]), users, usersToNotify).init();

        return receivedBy(dispatchPrivateEvent, "speaker").filter((event) => event === "webRtcStartMessage").length;
    }

    it("holds the speaker to the peers it was given", async () => {
        const peers = await startsToTheSpeaker(
            (space, users, usersToNotify) => new WebRTCState(space, users, usersToNotify, 3),
        );

        expect(peers).toBe(3);
    });

    it("holds the speaker to MAX_P2P_PEERS when no cap is given, as a state created on a switch back from LiveKit is", async () => {
        vi.stubEnv("MAX_P2P_PEERS", "3");
        vi.resetModules();
        // Same load order as the back: the manager first
        await import("../src/Model/CommunicationManager");
        const { WebRTCState: CappedByEnvironment } = await import("../src/Model/States/WebRTCState");

        const peers = await startsToTheSpeaker(
            (space, users, usersToNotify) => new CappedByEnvironment(space, users, usersToNotify),
        );

        expect(peers).toBe(3);
    });

    it("pairs the speaker with every watcher when there is no cap", async () => {
        const peers = await startsToTheSpeaker(
            (space, users, usersToNotify) => new WebRTCState(space, users, usersToNotify),
        );

        expect(peers).toBe(10);
    });
});
