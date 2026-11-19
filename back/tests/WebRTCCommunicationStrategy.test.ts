import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MeetingConnectionRestartMessage, SpaceUser } from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import { WebRTCCommunicationStrategy } from "../src/Model/Strategies/WebRTCCommunicationStrategy";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";

vi.mock("@sentry/node", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

interface WebRtcStartDispatch {
    receiverUserId: string;
    senderUserId: string;
    spaceEvent: {
        event: {
            $case: string;
            webRtcStartMessage?: { userId: string; initiator: boolean; connectionId: string };
        };
    };
}

function createUser(spaceUserId: string): SpaceUser {
    return SpaceUser.fromPartial({
        spaceUserId,
        uuid: `uuid-${spaceUserId}`,
        name: spaceUserId,
    });
}

function createSpace(dispatchPrivateEvent = vi.fn(), usersInSpace: SpaceUser[] = []): ICommunicationSpace {
    return {
        getAllUsers: () => usersInSpace,
        getUsersInFilter: () => [],
        getUsersToNotify: () => [],
        getRecordingState: () => ({ isRecording: false }),
        dispatchPrivateEvent,
        dispatchPublicEvent: vi.fn(),
        getSpaceName: () => "test-space",
        getPropertiesToSync: () => [],
        updateState: vi.fn(),
        stopRecordingByServer: vi.fn().mockResolvedValue(undefined),
        getUser: (spaceUserId: string) => usersInSpace.find((user) => user.spaceUserId === spaceUserId),
    } as unknown as ICommunicationSpace;
}

function webRtcDisconnectDispatches(dispatchPrivateEvent: ReturnType<typeof vi.fn>): WebRtcStartDispatch[] {
    return dispatchPrivateEvent.mock.calls
        .map((call) => call[0] as WebRtcStartDispatch)
        .filter((event) => event.spaceEvent.event.$case === "webRtcDisconnectMessage");
}

function webRtcStartDispatches(dispatchPrivateEvent: ReturnType<typeof vi.fn>): WebRtcStartDispatch[] {
    return dispatchPrivateEvent.mock.calls
        .map((call) => call[0] as WebRtcStartDispatch)
        .filter((event) => event.spaceEvent.event.$case === "webRtcStartMessage");
}

/**
 * Establishes a single WebRTC connection between user-a and user-b and returns the strategy,
 * the dispatch mock (cleared) and the real connectionId the strategy generated for that connection.
 */
async function setupStrategyWithConnection() {
    const dispatchPrivateEvent = vi.fn();
    const userA = createUser("user-a");
    const userB = createUser("user-b");
    const usersInSpace = [userA, userB];
    const space = createSpace(dispatchPrivateEvent, usersInSpace);
    const users = new Map([
        [userA.spaceUserId, userA],
        [userB.spaceUserId, userB],
    ]);

    const strategy = new WebRTCCommunicationStrategy(space, users, users);
    await strategy.initialize(users, users);

    const starts = webRtcStartDispatches(dispatchPrivateEvent);
    const connectionId = starts[0]?.spaceEvent.event.webRtcStartMessage?.connectionId;
    if (!connectionId) {
        throw new Error("Test setup failed: no WebRTC connection was established");
    }

    dispatchPrivateEvent.mockClear();

    return { strategy, dispatchPrivateEvent, connectionId, userA, userB, usersInSpace };
}

describe("WebRTCCommunicationStrategy.handleMeetingConnectionRestartMessage", () => {
    it("establishes exactly one bidirectional connection on initialize", async () => {
        const { connectionId } = await setupStrategyWithConnection();
        expect(connectionId).toBeTruthy();
    });

    it("regenerates a fresh connection when the restart references the current connection", async () => {
        const { strategy, dispatchPrivateEvent, connectionId } = await setupStrategyWithConnection();

        strategy.handleMeetingConnectionRestartMessage(
            MeetingConnectionRestartMessage.fromPartial({ userId: "user-b", connectionId }),
            "user-a",
        );

        const starts = webRtcStartDispatches(dispatchPrivateEvent);
        expect(starts).toHaveLength(2);

        const newIds = starts.map((start) => start.spaceEvent.event.webRtcStartMessage?.connectionId);
        // Both starts share a single new id, different from the superseded one.
        expect(new Set(newIds).size).toBe(1);
        expect(newIds[0]).not.toBe(connectionId);

        // One peer is the initiator, the other is not.
        const initiators = starts.map((start) => start.spaceEvent.event.webRtcStartMessage?.initiator);
        expect(initiators).toContain(true);
        expect(initiators).toContain(false);
    });

    it("ignores a stale restart that references a superseded connection", async () => {
        const { strategy, dispatchPrivateEvent } = await setupStrategyWithConnection();

        strategy.handleMeetingConnectionRestartMessage(
            MeetingConnectionRestartMessage.fromPartial({ userId: "user-b", connectionId: "stale-connection-id" }),
            "user-a",
        );

        expect(dispatchPrivateEvent).not.toHaveBeenCalled();
    });

    it("regenerates when the restart omits the connectionId (backward compatibility)", async () => {
        const { strategy, dispatchPrivateEvent } = await setupStrategyWithConnection();

        strategy.handleMeetingConnectionRestartMessage(
            MeetingConnectionRestartMessage.fromPartial({ userId: "user-b" }),
            "user-a",
        );

        expect(webRtcStartDispatches(dispatchPrivateEvent)).toHaveLength(2);
    });

    it("ignores a restart when no connection exists between the peers", () => {
        const dispatchPrivateEvent = vi.fn();
        const space = createSpace(dispatchPrivateEvent);
        const strategy = new WebRTCCommunicationStrategy(space, new Map(), new Map());

        strategy.handleMeetingConnectionRestartMessage(
            MeetingConnectionRestartMessage.fromPartial({ userId: "user-b", connectionId: "any-connection-id" }),
            "user-a",
        );

        expect(dispatchPrivateEvent).not.toHaveBeenCalled();
    });

    it("establishes a fresh connection when the tracking was lost but both users are in the space", () => {
        const dispatchPrivateEvent = vi.fn();
        const userA = createUser("user-a");
        const userB = createUser("user-b");
        const users = new Map([
            [userA.spaceUserId, userA],
            [userB.spaceUserId, userB],
        ]);
        const strategy = new WebRTCCommunicationStrategy(
            createSpace(dispatchPrivateEvent, [userA, userB]),
            users,
            users,
        );

        strategy.handleMeetingConnectionRestartMessage(
            MeetingConnectionRestartMessage.fromPartial({ userId: "user-b" }),
            "user-a",
        );

        const starts = webRtcStartDispatches(dispatchPrivateEvent);
        expect(starts.map((start) => start.receiverUserId).sort()).toEqual(["user-a", "user-b"]);
        expect(starts[0]?.spaceEvent.event.webRtcStartMessage?.connectionId).toBe(
            starts[1]?.spaceEvent.event.webRtcStartMessage?.connectionId,
        );
    });

    it("ignores a restart without a target userId", async () => {
        const { strategy, dispatchPrivateEvent } = await setupStrategyWithConnection();

        strategy.handleMeetingConnectionRestartMessage(MeetingConnectionRestartMessage.fromPartial({}), "user-a");

        expect(dispatchPrivateEvent).not.toHaveBeenCalled();
    });
});

describe("WebRTCCommunicationStrategy disconnect teardown", () => {
    it("sends one disconnect per direction of a tracked connection, and nothing on a repeated teardown", async () => {
        const { strategy, dispatchPrivateEvent, userA } = await setupStrategyWithConnection();

        strategy.deleteUserFromNotify(userA);

        const disconnects = webRtcDisconnectDispatches(dispatchPrivateEvent);
        expect(disconnects.map((event) => [event.senderUserId, event.receiverUserId])).toEqual([
            ["user-a", "user-b"],
            ["user-b", "user-a"],
        ]);

        dispatchPrivateEvent.mockClear();
        // A duplicate delete-to-notify (e.g. an explicit leave overlapping with the socket close) has nothing
        // left to tear down: it must not spam the remaining peers with disconnects.
        strategy.deleteUserFromNotify(userA);
        expect(dispatchPrivateEvent).not.toHaveBeenCalled();
    });

    it("does not dispatch on behalf of a sender that already left the space", async () => {
        const { strategy, dispatchPrivateEvent, userA, usersInSpace } = await setupStrategyWithConnection();
        // user-a was removed from the space before its delete-to-notify arrived (Sentry BACK-2B).
        usersInSpace.splice(usersInSpace.indexOf(userA), 1);

        expect(() => strategy.deleteUserFromNotify(userA)).not.toThrow();

        const disconnects = webRtcDisconnectDispatches(dispatchPrivateEvent);
        // Only the direction whose sender is still in the space is dispatched.
        expect(disconnects.map((event) => [event.senderUserId, event.receiverUserId])).toEqual([["user-b", "user-a"]]);
    });
});

/** How many WebRTC starts each user was sent: one per peer connection that user has to open. */
function startsReceivedByUser(dispatchPrivateEvent: ReturnType<typeof vi.fn>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const start of webRtcStartDispatches(dispatchPrivateEvent)) {
        counts.set(start.receiverUserId, (counts.get(start.receiverUserId) ?? 0) + 1);
    }
    return counts;
}

/** Speakers are members of the filter; everyone present watches the space, the speakers included. */
function createCrowd(speakerCount: number, watcherCount: number, maxPeers?: number) {
    const dispatchPrivateEvent = vi.fn();
    const speakers = Array.from({ length: speakerCount }, (_, index) => createUser(`speaker-${index + 1}`));
    const watchers = Array.from({ length: watcherCount }, (_, index) => createUser(`watcher-${index + 1}`));
    const usersInSpace = [...speakers, ...watchers];
    const users = new Map(speakers.map((user) => [user.spaceUserId, user]));
    const usersToNotify = new Map(usersInSpace.map((user) => [user.spaceUserId, user]));
    const strategy = new WebRTCCommunicationStrategy(
        createSpace(dispatchPrivateEvent, usersInSpace),
        users,
        usersToNotify,
        maxPeers,
    );
    return { strategy, dispatchPrivateEvent, speakers, watchers, users, usersToNotify };
}

type Crowd = ReturnType<typeof createCrowd>;

/** The ways a crowd and its speaker come to be paired. */
const pairings: Array<[string, (crowd: Crowd) => Promise<void>]> = [
    [
        "the space is initialized with everyone in it",
        (crowd) => crowd.strategy.initialize(crowd.users, crowd.usersToNotify),
    ],
    [
        "the speaker starts with the crowd already watching",
        async (crowd) => {
            await Promise.all(crowd.speakers.map((speaker) => crowd.strategy.addUser(speaker)));
        },
    ],
    [
        "the watchers arrive one by one",
        async (crowd) => {
            await Promise.all(crowd.watchers.map((watcher) => crowd.strategy.addUserToNotify(watcher)));
        },
    ],
];

/** A bubble: every member is both in the filter and watching. */
function createBubble(size: number, maxPeers?: number) {
    const dispatchPrivateEvent = vi.fn();
    const members = Array.from({ length: size }, (_, index) => createUser(`member-${index + 1}`));
    const usersInSpace = [...members];
    const users = new Map(members.map((user) => [user.spaceUserId, user]));
    const usersToNotify = new Map(members.map((user) => [user.spaceUserId, user]));
    const strategy = new WebRTCCommunicationStrategy(
        createSpace(dispatchPrivateEvent, usersInSpace),
        users,
        usersToNotify,
        maxPeers,
    );
    /** What the back does when someone enters the bubble: the registries first, then the strategy for both roles. */
    const join = async (user: SpaceUser) => {
        usersInSpace.push(user);
        users.set(user.spaceUserId, user);
        usersToNotify.set(user.spaceUserId, user);
        await strategy.addUser(user);
        await strategy.addUserToNotify(user);
    };
    /** What the back does when someone leaves the bubble: out of the filter first, then out of the watchers. */
    const leave = (user: SpaceUser) => {
        users.delete(user.spaceUserId);
        strategy.deleteUser(user);
        usersToNotify.delete(user.spaceUserId);
        strategy.deleteUserFromNotify(user);
        usersInSpace.splice(usersInSpace.indexOf(user), 1);
    };
    return { strategy, dispatchPrivateEvent, members, users, usersToNotify, join, leave };
}

describe("WebRTCCommunicationStrategy peer cap", () => {
    beforeEach(() => {
        vi.mocked(Sentry.captureMessage).mockClear();
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("one speaker and 999 watchers", () => {
        it.each(pairings)(
            "sends 1,998 starts and opens 999 peer connections in the speaker's tab without a cap when %s",
            async (_, pair) => {
                const crowd = createCrowd(1, 999);

                await pair(crowd);

                expect(webRtcStartDispatches(crowd.dispatchPrivateEvent)).toHaveLength(1_998);
                expect(startsReceivedByUser(crowd.dispatchPrivateEvent).get("speaker-1")).toBe(999);
            },
        );

        it.each(pairings)(
            "sends 6 starts and opens 3 peer connections in the speaker's tab with a cap of 3 when %s",
            async (_, pair) => {
                const crowd = createCrowd(1, 999, 3);

                await pair(crowd);

                expect(webRtcStartDispatches(crowd.dispatchPrivateEvent)).toHaveLength(6);
                expect(startsReceivedByUser(crowd.dispatchPrivateEvent).get("speaker-1")).toBe(3);
            },
        );

        it("sends every watcher at most one start, so no watcher holds more than the speaker", async () => {
            const crowd = createCrowd(1, 999, 3);

            await crowd.strategy.initialize(crowd.users, crowd.usersToNotify);

            const watcherStarts = [...startsReceivedByUser(crowd.dispatchPrivateEvent)].filter(([userId]) =>
                userId.startsWith("watcher-"),
            );
            expect(watcherStarts).toHaveLength(3);
            expect(watcherStarts.every(([, count]) => count === 1)).toBe(true);
        });

        it("reports the refused pairs once, not once per watcher", async () => {
            const crowd = createCrowd(1, 999, 3);

            await crowd.strategy.initialize(crowd.users, crowd.usersToNotify);

            expect(console.warn).toHaveBeenCalledTimes(1);
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("MAX_P2P_PEERS (3)"));
            expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        });
    });

    describe("a restart message", () => {
        it("does not open a pair the cap refused, so the speaker keeps 3 peers", async () => {
            const crowd = createCrowd(1, 10, 3);
            await crowd.strategy.initialize(crowd.users, crowd.usersToNotify);
            const startsBefore = webRtcStartDispatches(crowd.dispatchPrivateEvent).length;

            // watcher-1..3 hold the speaker's slots: the others were refused and have no connection
            for (const watcher of crowd.watchers.slice(3)) {
                crowd.strategy.handleMeetingConnectionRestartMessage(
                    MeetingConnectionRestartMessage.fromPartial({ userId: "speaker-1" }),
                    watcher.spaceUserId,
                );
            }

            expect(webRtcStartDispatches(crowd.dispatchPrivateEvent)).toHaveLength(startsBefore);
            expect(startsReceivedByUser(crowd.dispatchPrivateEvent).get("speaker-1")).toBe(3);
        });

        it("still recovers a lost pair that is within the cap", () => {
            const crowd = createCrowd(1, 2, 3);

            crowd.strategy.handleMeetingConnectionRestartMessage(
                MeetingConnectionRestartMessage.fromPartial({ userId: "speaker-1" }),
                "watcher-1",
            );

            expect(startsReceivedByUser(crowd.dispatchPrivateEvent).get("speaker-1")).toBe(1);
            expect(startsReceivedByUser(crowd.dispatchPrivateEvent).get("watcher-1")).toBe(1);
        });
    });

    describe("a bubble", () => {
        it("still pairs all 4 members with a cap of 3", async () => {
            const { strategy, dispatchPrivateEvent, users, usersToNotify } = createBubble(4, 3);

            await strategy.initialize(users, usersToNotify);

            // 6 pairs, 2 starts each: every member holds 3 peers, which is the cap and not past it
            expect(webRtcStartDispatches(dispatchPrivateEvent)).toHaveLength(12);
            expect([...startsReceivedByUser(dispatchPrivateEvent).values()]).toEqual([3, 3, 3, 3]);
            expect(Sentry.captureMessage).not.toHaveBeenCalled();
        });

        it("sends no start to a 5th member who joins a full bubble", async () => {
            const { strategy, dispatchPrivateEvent, users, usersToNotify, join } = createBubble(4, 3);
            await strategy.initialize(users, usersToNotify);
            dispatchPrivateEvent.mockClear();

            await join(createUser("member-5"));

            expect(webRtcStartDispatches(dispatchPrivateEvent)).toHaveLength(0);
            expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
        });

        it("pairs a newcomer with the members once a member left and freed a slot", async () => {
            const { strategy, dispatchPrivateEvent, members, users, usersToNotify, join, leave } = createBubble(4, 3);
            await strategy.initialize(users, usersToNotify);
            leave(members[3]);
            dispatchPrivateEvent.mockClear();

            await join(createUser("member-5"));

            // member-1..3 hold 2 peers each, so each takes the newcomer
            expect(webRtcStartDispatches(dispatchPrivateEvent)).toHaveLength(6);
            expect(startsReceivedByUser(dispatchPrivateEvent).get("member-5")).toBe(3);
        });

        it("known limit: does not retry a refused pair when a slot frees", async () => {
            const { strategy, dispatchPrivateEvent, members, users, usersToNotify, join, leave } = createBubble(4, 3);
            await strategy.initialize(users, usersToNotify);
            await join(createUser("member-5"));
            dispatchPrivateEvent.mockClear();

            leave(members[3]);

            expect(webRtcStartDispatches(dispatchPrivateEvent)).toHaveLength(0);
            expect(startsReceivedByUser(dispatchPrivateEvent).has("member-5")).toBe(false);
        });

        it("sends 12 starts for a bubble of 4 without a cap", async () => {
            const { strategy, dispatchPrivateEvent, users, usersToNotify } = createBubble(4);

            await strategy.initialize(users, usersToNotify);

            expect(webRtcStartDispatches(dispatchPrivateEvent)).toHaveLength(12);
            expect(Sentry.captureMessage).not.toHaveBeenCalled();
        });
    });

    it("known limit: a watcher past the cap of every speaker gets no stream", async () => {
        // Two speakers: each takes the 3 first peers it meets, and the speakers pair with each other first
        const crowd = createCrowd(2, 4, 3);

        await crowd.strategy.initialize(crowd.users, crowd.usersToNotify);

        const received = startsReceivedByUser(crowd.dispatchPrivateEvent);
        expect(received.get("watcher-1")).toBe(2);
        expect(received.get("watcher-2")).toBe(2);
        expect(received.has("watcher-3")).toBe(false);
        expect(received.has("watcher-4")).toBe(false);
    });
});
