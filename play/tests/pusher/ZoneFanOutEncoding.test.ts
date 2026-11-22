import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AvailabilityStatus,
    BatchMessage,
    GroupLeftZoneMessage,
    GroupUpdateZoneMessage,
    PlayerDetailsUpdatedMessage,
    PositionMessage_Direction,
    PusherToFrontWebSocketMessage,
    ServerToClientMessage,
    SubMessage,
    UserJoinedZoneMessage,
    UserLeftZoneMessage,
    UserMovedMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { SocketManager } from "../../src/pusher/services/SocketManager";
import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";
import { Zone } from "../../src/pusher/models/Zone";

const MOVER_ID = 7;

function toHex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("hex");
}

/** A socket that watches a zone, and the frames its uWS transport was handed. */
function watcher(userId: number) {
    const sent: Uint8Array[] = [];
    const userData = {
        userId,
        userUuid: `uuid-${userId}`,
        tabId: `tab-${userId}`,
        connectionId: `connection-${userId}`,
        listenedZones: new Set<string>(),
    };
    const raw = {
        send: vi.fn((payload: Uint8Array) => {
            sent.push(payload);
            return 1;
        }),
        ping: vi.fn().mockReturnValue(1),
        end: vi.fn(),
        getBufferedAmount: vi.fn().mockReturnValue(0),
        getUserData: vi.fn().mockReturnValue(userData),
    };
    return { socket: new PusherWebSocket(raw as unknown as RawSocket), sent, raw, userData };
}

type Watcher = ReturnType<typeof watcher>;

/** The sub-messages of a batch frame, in order. */
function subMessagesOf(frame: Uint8Array): SubMessage[] {
    const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
    if (message?.$case !== "batchMessage") {
        throw new Error(`expected a batch, got ${message?.$case}`);
    }
    return message.batchMessage.payload;
}

/** The sub-message cases of a frame, in order. */
function casesOf(frame: Uint8Array): string[] {
    return subMessagesOf(frame).map((subMessage) => subMessage.message?.$case ?? "");
}

function userJoins(userId: number, x: number, y: number): UserJoinedZoneMessage {
    return UserJoinedZoneMessage.fromPartial({
        userId,
        userUuid: `uuid-${userId}`,
        name: `user ${userId}`,
        characterTextures: [{ id: "male1", url: "resources/customisation/character_layer/male1.png" }],
        position: { x, y, direction: PositionMessage_Direction.DOWN, moving: false },
        availabilityStatus: AvailabilityStatus.ONLINE,
        visitCardUrl: "https://card.test/u",
        variables: { mood: "calm" },
        outlineColor: 0xff8800,
        hasOutline: true,
    });
}

function userMoves(userId: number, x: number, y: number, direction: PositionMessage_Direction, moving: boolean) {
    return UserMovedMessage.fromPartial({ userId, position: { x, y, direction, moving } });
}

function group(groupId: number, x: number, userIds: number[], locked = false): GroupUpdateZoneMessage {
    return GroupUpdateZoneMessage.fromPartial({
        groupId,
        position: { x, y: 100 },
        groupSize: userIds.length,
        locked,
        userIds,
    });
}

function detailsUpdate(userId: number): PlayerDetailsUpdatedMessage {
    return PlayerDetailsUpdatedMessage.fromPartial({
        userId,
        details: {
            availabilityStatus: AvailabilityStatus.BUSY,
            setVariable: { name: "mood", value: "busy", public: true },
        },
    });
}

/**
 * A zone with the real SocketManager as its listener, as the pusher has it, and two sockets that watch it.
 * The user 7 is the mover; it never watches the zone.
 */
function zoneWithTwoWatchers() {
    const zone = new Zone(new SocketManager(), 0, 0);
    const first = watcher(1);
    const second = watcher(2);
    zone.startListening(first.socket);
    zone.startListening(second.socket);
    return { zone, first, second };
}

/** What a socket that starts watching the zone now is told about the state the zone has: its sub-messages, in order. */
function toldToALateWatcher(zone: Zone) {
    const late = watcher(3);
    zone.startListening(late.socket);
    late.socket.flushBatch();
    return subMessagesOf(late.sent[0]).map(({ message }) => message);
}

/**
 * The fixed sequence of zone events the wire-format tests replay: a user joins, moves and changes its details,
 * a group is created, moved (conflated), given new users and updated again, a socket starts watching late, and
 * everything leaves. Returns the watchers; each flush closes one frame.
 */
function replayZoneEvents() {
    const { zone, first, second } = zoneWithTwoWatchers();
    const flush = (...watchers: Watcher[]) => watchers.forEach(({ socket }) => socket.flushBatch());

    // Frame 1 of the two first watchers: the user joins and moves twice.
    zone.handleUserJoinedZone(userJoins(MOVER_ID, 10, 20));
    zone.handleUserMoved(userMoves(MOVER_ID, 30, 20, PositionMessage_Direction.RIGHT, true));
    zone.handleUserMoved(userMoves(MOVER_ID, 50, 20, PositionMessage_Direction.RIGHT, true));
    flush(first, second);

    // Frame 2: messages that are not shared (details, emote) between two that are.
    zone.handlePlayerDetailsUpdated(detailsUpdate(MOVER_ID));
    zone.handleUserMoved(userMoves(MOVER_ID, 60, 20, PositionMessage_Direction.DOWN, false));
    zone.handleEmoteEvent({ actorUserId: MOVER_ID, emote: "👍" });
    zone.handleUserMoved(userMoves(MOVER_ID, 65, 20, PositionMessage_Direction.DOWN, false));
    flush(first, second);

    // Frame 3: a group that is updated twice in one batch (conflated), then given users, then updated again. The
    // second update also locks the group: a move alone is not sent at all (ZoneGroupUpdate.test.ts).
    zone.handleGroupUpdateZone(group(3, 100, [7, 8]));
    zone.handleGroupUpdateZone(group(3, 110, [7, 8], true));
    zone.handleGroupUsersUpdate({ groupId: 3, userIds: [7, 8, 9] });
    zone.handleGroupUpdateZone(group(3, 120, [7, 8, 9]));
    zone.handleGroupUpdateZone(group(4, 400, [20, 21]));
    flush(first, second);

    // A socket that starts watching now is told the current state: the user as it is after its moves and its
    // details update, and both groups.
    const late = watcher(3);
    zone.startListening(late.socket);
    flush(late);

    // Frame 4 of the first watchers, frame 2 of the late one: the user and a group leave.
    zone.handleUserLeftZone(UserLeftZoneMessage.fromPartial({ userId: MOVER_ID }));
    zone.handleGroupLeftZone(GroupLeftZoneMessage.fromPartial({ groupId: 3 }));
    flush(first, second, late);

    // The late socket stops watching: it is told the remaining group is gone.
    zone.stopListening(late.socket);
    flush(late);

    return { first, second, late };
}

/**
 * What the uWS transport was handed by replayZoneEvents, captured before the zone events were encoded once: when
 * every socket built and encoded its own messages. Literals, so that the frames cannot drift with the encoder.
 */
const FRAMES_OF_THE_FIRST_TWO_WATCHERS: string[] = [
    [
        "080112ab010aa80112850122820108071a06757365722037223a0a317265736f75726365732f637573746f6d69736174",
        "696f6e2f6368617261637465725f6c617965722f6d616c65312e706e6712056d616c65312a06080a101418023a136874",
        "7470733a2f2f636172642e746573742f754206757569642d37488090fe0750015801620c0a046d6f6f64120463616c6d",
        "120e0a0c08071208081e101418012001120e0a0c080712080832101418012001",
    ].join(""),
    [
        "080212440a42121852160807121230083a0e0a046d6f6f641204627573791801120c0a0a08071206083c10141802120a",
        "3a0808071204f09f918d120c0a0a08071206084110141802",
    ].join(""),
    [
        "080312540a521216121408031204086e10641a020802220208012a020708120ac20107080312030708091215121308031204",
        "087810641a02080322002a03070809121512130804120508900310641a02080222002a021415",
    ].join(""),
    "0804120e0a0c12042a02080712041a020803",
];
const FRAMES_OF_THE_LATE_WATCHER: string[] = [
    [
        "080112b9010ab60112850122820108071a06757365722037223a0a317265736f75726365732f637573746f6d69736174",
        "696f6e2f6368617261637465725f6c617965722f6d616c65312e706e6712056d616c65312a060841101418023a136874",
        "7470733a2f2f636172642e746573742f754206757569642d37488090fe0750015808620c0a046d6f6f64120462757379",
        "1215121308031204087810641a02080322002a03070809121512130804120508900310641a02080222002a021415",
    ].join(""),
    "0802120e0a0c12042a02080712041a020803",
    "080312080a0612041a020804",
];

/**
 * The work a zone event costs the pusher is the number of times it is encoded. Before: captured from a run of the test
 * below on the code before the change, which built and encoded the move for every socket, the counts were 200 for the
 * sub-message, the user-moved message, the batch, the server message and the frame envelope: one for each of the 200
 * watching sockets. After: the test asserts them, 1 for the sub-message, the user-moved message and the batch, and 0
 * for the server message and the envelope, as the frame is written without them.
 */
describe("encode work for one move watched by many sockets", () => {
    const WATCHERS = 200;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function crowdedZone() {
        const zone = new Zone(new SocketManager(), 0, 0);
        zone.handleUserJoinedZone(userJoins(MOVER_ID, 10, 20));
        const watchers = Array.from({ length: WATCHERS }, (_, index) => watcher(100 + index));
        for (const { socket } of watchers) {
            zone.startListening(socket);
            socket.flushBatch();
        }
        for (const { sent } of watchers) {
            sent.length = 0;
        }
        return { zone, watchers };
    }

    function encoderSpies() {
        return {
            subMessage: vi.spyOn(SubMessage, "encode"),
            userMoved: vi.spyOn(UserMovedMessage, "encode"),
            batch: vi.spyOn(BatchMessage, "encode"),
            serverToClient: vi.spyOn(ServerToClientMessage, "encode"),
            envelope: vi.spyOn(PusherToFrontWebSocketMessage, "encode"),
        };
    }

    it(`encodes a move once, not once per each of the ${WATCHERS} watching sockets`, () => {
        const { zone, watchers } = crowdedZone();
        const spies = encoderSpies();

        zone.handleUserMoved(userMoves(MOVER_ID, 30, 20, PositionMessage_Direction.RIGHT, true));
        for (const { socket } of watchers) {
            socket.flushBatch();
        }

        const calls = {
            subMessage: spies.subMessage.mock.calls.length,
            userMoved: spies.userMoved.mock.calls.length,
            batch: spies.batch.mock.calls.length,
            serverToClient: spies.serverToClient.mock.calls.length,
            envelope: spies.envelope.mock.calls.length,
        };
        const bytesPerSocket = watchers[0].sent[0].byteLength;
        console.info(
            `[zone fan-out] one move, W=${WATCHERS}: encode calls ${JSON.stringify(calls)}, ` +
                `${bytesPerSocket} B per socket, ${watchers.reduce((sum, { sent }) => sum + sent[0].byteLength, 0)} B in all`,
        );

        for (const { sent } of watchers) {
            expect(sent.map(casesOf)).toEqual([["userMovedMessage"]]);
            expect(toHex(sent[0])).toBe(toHex(watchers[0].sent[0]));
        }
        expect(calls.userMoved).toBe(1);
        expect(calls.subMessage).toBe(1);
        expect(calls.batch).toBe(1);
        expect(calls.serverToClient).toBe(0);
        expect(calls.envelope).toBe(0);
    });
});

describe("zone events on the wire", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("hands the transport byte for byte the frames it was handed when each socket encoded its own messages", () => {
        const { first, second, late } = replayZoneEvents();

        expect(first.sent.map(toHex)).toEqual(FRAMES_OF_THE_FIRST_TWO_WATCHERS);
        expect(second.sent.map(toHex)).toEqual(FRAMES_OF_THE_FIRST_TWO_WATCHERS);
        expect(late.sent.map(toHex)).toEqual(FRAMES_OF_THE_LATE_WATCHER);
    });

    it("keeps the order of the batch, the conflation of a group and the state a late watcher is told", () => {
        const { first, late } = replayZoneEvents();

        expect(first.sent.map(casesOf)).toEqual([
            ["userJoinedMessage", "userMovedMessage", "userMovedMessage"],
            ["playerDetailsUpdatedMessage", "userMovedMessage", "emoteEventMessage", "userMovedMessage"],
            ["groupUpdateMessage", "groupUsersUpdateMessage", "groupUpdateMessage", "groupUpdateMessage"],
            ["userLeftMessage", "groupDeleteMessage"],
        ]);
        expect(late.sent.map(casesOf)).toEqual([
            ["userJoinedMessage", "groupUpdateMessage", "groupUpdateMessage"],
            ["userLeftMessage", "groupDeleteMessage"],
            ["groupDeleteMessage"],
        ]);

        const [lateJoin] = subMessagesOf(late.sent[0]);
        expect(lateJoin.message).toMatchObject({
            $case: "userJoinedMessage",
            userJoinedMessage: {
                userId: MOVER_ID,
                position: { x: 65, y: 20, moving: false },
                variables: { mood: "busy" },
                availabilityStatus: AvailabilityStatus.BUSY,
            },
        });
    });

    it("numbers the frames of each socket from 1", () => {
        const { first, late } = replayZoneEvents();

        const nonces = (frames: Uint8Array[]) =>
            frames.map((frame) => PusherToFrontWebSocketMessage.decode(frame).nonce);
        expect(nonces(first.sent)).toEqual([1, 2, 3, 4]);
        expect(nonces(late.sent)).toEqual([1, 2, 3]);
    });

    it("gives each user its own messages when several users move and leave in a row", () => {
        const { zone, first } = zoneWithTwoWatchers();
        zone.handleUserJoinedZone(userJoins(7, 10, 20));
        zone.handleUserJoinedZone(userJoins(8, 100, 200));
        first.socket.flushBatch();

        zone.handleUserMoved(userMoves(7, 11, 20, PositionMessage_Direction.DOWN, true));
        zone.handleUserMoved(userMoves(8, 101, 200, PositionMessage_Direction.DOWN, true));
        zone.handleUserMoved(userMoves(7, 12, 20, PositionMessage_Direction.DOWN, true));
        zone.handleUserLeftZone(UserLeftZoneMessage.fromPartial({ userId: 7 }));
        zone.handleUserLeftZone(UserLeftZoneMessage.fromPartial({ userId: 8 }));
        first.socket.flushBatch();

        expect(subMessagesOf(first.sent[1]).map(({ message }) => message)).toMatchObject([
            { $case: "userMovedMessage", userMovedMessage: { userId: 7, position: { x: 11 } } },
            { $case: "userMovedMessage", userMovedMessage: { userId: 8, position: { x: 101 } } },
            { $case: "userMovedMessage", userMovedMessage: { userId: 7, position: { x: 12 } } },
            { $case: "userLeftMessage", userLeftMessage: { userId: 7 } },
            { $case: "userLeftMessage", userLeftMessage: { userId: 8 } },
        ]);
    });

    it("sends the variables a user joined with, then the change that follows, when a variable changes before the batch is sent", () => {
        const { zone, first } = zoneWithTwoWatchers();

        zone.handleUserJoinedZone(userJoins(MOVER_ID, 10, 20));
        zone.handlePlayerDetailsUpdated(detailsUpdate(MOVER_ID));
        first.socket.flushBatch();

        const [joined, details] = subMessagesOf(first.sent[0]);
        expect(joined.message).toMatchObject({
            $case: "userJoinedMessage",
            userJoinedMessage: { variables: { mood: "calm" } },
        });
        expect(details.message).toMatchObject({
            $case: "playerDetailsUpdatedMessage",
            playerDetailsUpdatedMessage: { details: { setVariable: { name: "mood", value: "busy" } } },
        });
    });

    // The tests below pin, one by one, the drops of a cached sub-message. In each, a watcher already sees the zone, so
    // the sub-message was built and encoded when the event reached it; the late watcher then proves it was dropped.
    it("tells a late watcher the position a user moved to, when no details changed after the join", () => {
        const { zone, first } = zoneWithTwoWatchers();
        zone.handleUserJoinedZone(userJoins(MOVER_ID, 10, 20));
        first.socket.flushBatch();

        zone.handleUserMoved(userMoves(MOVER_ID, 30, 20, PositionMessage_Direction.RIGHT, true));

        expect(toldToALateWatcher(zone)).toMatchObject([
            {
                $case: "userJoinedMessage",
                userJoinedMessage: { userId: MOVER_ID, position: { x: 30, y: 20, moving: true } },
            },
        ]);
    });

    it("tells a late watcher the variables and the availability a user has now, when it did not move after the change", () => {
        const { zone, first } = zoneWithTwoWatchers();
        zone.handleUserJoinedZone(userJoins(MOVER_ID, 10, 20));
        first.socket.flushBatch();

        zone.handlePlayerDetailsUpdated(detailsUpdate(MOVER_ID));

        expect(toldToALateWatcher(zone)).toMatchObject([
            {
                $case: "userJoinedMessage",
                userJoinedMessage: {
                    userId: MOVER_ID,
                    position: { x: 10, y: 20 },
                    variables: { mood: "busy" },
                    availabilityStatus: AvailabilityStatus.BUSY,
                },
            },
        ]);
    });

    it("tells a late watcher the position a group was moved to by the second update of it", () => {
        const { zone, first } = zoneWithTwoWatchers();
        zone.handleGroupUpdateZone(group(3, 100, [7, 8]));
        first.socket.flushBatch();

        zone.handleGroupUpdateZone(group(3, 110, [7, 8]));

        expect(toldToALateWatcher(zone)).toMatchObject([
            { $case: "groupUpdateMessage", groupUpdateMessage: { groupId: 3, position: { x: 110, y: 100 } } },
        ]);
    });

    it("tells a late watcher the users a group has now, and a watcher each change of them", () => {
        const { zone, first } = zoneWithTwoWatchers();
        zone.handleGroupUpdateZone(group(3, 100, [7, 8]));
        first.socket.flushBatch();

        zone.handleGroupUsersUpdate({ groupId: 3, userIds: [7, 8, 9] });
        first.socket.flushBatch();

        expect(toldToALateWatcher(zone)).toMatchObject([
            { $case: "groupUpdateMessage", groupUpdateMessage: { groupId: 3, userIds: [7, 8, 9] } },
        ]);

        zone.handleGroupUsersUpdate({ groupId: 3, userIds: [7, 9] });
        first.socket.flushBatch();

        expect(first.sent.map(casesOf)).toEqual([
            ["groupUpdateMessage"],
            ["groupUsersUpdateMessage"],
            ["groupUsersUpdateMessage"],
        ]);
        expect(subMessagesOf(first.sent[2])[0].message).toMatchObject({
            $case: "groupUsersUpdateMessage",
            groupUsersUpdateMessage: { groupId: 3, userIds: [7, 9] },
        });
    });

    it("replays to a reconnecting transport the very frames the first transport was handed", () => {
        const { first } = replayZoneEvents();
        const replacement = watcher(1);

        const replaced = first.socket.replaceSocket(replacement.raw as unknown as RawSocket, 1);

        expect(replaced).toBe(true);
        expect(replacement.sent.map(toHex)).toEqual(first.sent.slice(1).map(toHex));
        expect(replacement.sent.map((frame) => PusherToFrontWebSocketMessage.decode(frame).nonce)).toEqual([2, 3, 4]);
    });
});

/**
 * Root cause 1 of DL-06 (owner's mandate, 2026-11-21): a user's join was rebuilt from its Woka details and encoded again
 * for each viewer that took the user into its scene after the user moved, because every move threw the cached join
 * away. Now the descriptor keeps one encoded join and a version check re-encodes it at most once per move, however many
 * viewers are admitted after it. The count that matters is the encodes: each is a protobuf pass over the Woka layers,
 * the name, the variables and the position.
 *
 * Seen failing, by two mutations of `toUserJoinedSubMessage` (run once, put back): with the cache removed, so that every
 * admission encodes, the count for the 100 late viewers is `expected 100 to be 1`; with the cache kept but not checked
 * against the move version (a join that a move never invalidates), the second batch of viewers is told the old position
 * (`expected 1 to be 2` encodes, and the position of the first move in the second batch's joins).
 */
describe("the join of a user that moved, handed to the viewers admitted after the move", () => {
    const VIEWERS = 100;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** The encodes of a join so far: the sub-messages encoded whose case is a user joining. */
    function joinEncodes(encode: { mock: { calls: unknown[][] } }): number {
        return encode.mock.calls.filter(([message]) => (message as SubMessage).message?.$case === "userJoinedMessage")
            .length;
    }

    /** The position a viewer is told in its join of the mover. */
    function joinedPosition(late: Watcher): { x: number; y: number; moving: boolean | undefined } {
        late.socket.flushBatch();
        const joins = subMessagesOf(late.sent[0]).flatMap(({ message }) =>
            message?.$case === "userJoinedMessage" ? [message.userJoinedMessage] : [],
        );
        expect(joins).toHaveLength(1);
        const position = joins[0].position;
        return { x: position?.x ?? Number.NaN, y: position?.y ?? Number.NaN, moving: position?.moving };
    }

    /** `VIEWERS` sockets start watching the zone one after the other: one admission each. */
    function admitViewers(zone: Zone, firstId: number): Watcher[] {
        const viewers = Array.from({ length: VIEWERS }, (_, index) => watcher(firstId + index));
        for (const viewer of viewers) {
            zone.startListening(viewer.socket);
        }
        return viewers;
    }

    for (const [name, limits] of [
        ["without a budget", undefined],
        ["with a budget that admits at once", { fullRatePeers: 150, maxPeers: 400 }],
    ] as const) {
        it(`encodes the join once for ${VIEWERS} admissions after one move, and once more after the next move (${name})`, () => {
            const zone = new Zone(new SocketManager(undefined, limits), 0, 0);
            zone.handleUserJoinedZone(userJoins(MOVER_ID, 10, 20));
            const encode = vi.spyOn(SubMessage, "encode");

            // Nobody is admitted while the user walks 50 steps: nothing is encoded for a join that nobody asks for.
            for (let step = 1; step <= 50; step++) {
                zone.handleUserMoved(userMoves(MOVER_ID, 10 + step, 20, PositionMessage_Direction.RIGHT, true));
            }
            expect(encode).toHaveBeenCalledTimes(0);

            const afterFirstMove = admitViewers(zone, 100);
            expect(joinEncodes(encode)).toBe(1);

            // The 100 viewers of the zone are sent this move as well: that is one encode of a moved message, not of a join.
            zone.handleUserMoved(userMoves(MOVER_ID, 500, 90, PositionMessage_Direction.LEFT, true));
            const afterSecondMove = admitViewers(zone, 1000);
            expect(joinEncodes(encode)).toBe(2);

            // And what each was told is the position the user had when it was admitted, not the one of the cache before.
            for (const viewer of afterFirstMove) {
                expect(joinedPosition(viewer)).toEqual({ x: 60, y: 20, moving: true });
            }
            for (const viewer of afterSecondMove) {
                expect(joinedPosition(viewer)).toEqual({ x: 500, y: 90, moving: true });
            }
        });
    }

    it("encodes the join again when the details of the user change, and tells the position of that moment", () => {
        const zone = new Zone(new SocketManager(), 0, 0);
        zone.handleUserJoinedZone(userJoins(MOVER_ID, 10, 20));
        zone.handleUserMoved(userMoves(MOVER_ID, 30, 20, PositionMessage_Direction.RIGHT, true));
        const encode = vi.spyOn(SubMessage, "encode");
        admitViewers(zone, 100);
        expect(joinEncodes(encode)).toBe(1);

        zone.handlePlayerDetailsUpdated(detailsUpdate(MOVER_ID));
        const late = admitViewers(zone, 1000);

        expect(joinEncodes(encode)).toBe(2);
        const told = subMessagesOf((late[0].socket.flushBatch(), late[0].sent[0]));
        const joined = told.find(({ message }) => message?.$case === "userJoinedMessage")?.message;
        expect(joined?.$case === "userJoinedMessage" && joined.userJoinedMessage.availabilityStatus).toBe(
            AvailabilityStatus.BUSY,
        );
    });
});
