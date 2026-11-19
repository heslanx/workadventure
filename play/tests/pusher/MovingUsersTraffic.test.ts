import { beforeAll, describe, expect, it, vi } from "vitest";
import { register } from "prom-client";
import {
    AvailabilityStatus,
    GroupUpdateZoneMessage,
    GroupUsersUpdateMessage,
    PositionMessage_Direction,
    PusherToFrontWebSocketMessage,
    SubMessage,
    UserJoinedZoneMessage,
    UserMovedMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { SocketManager } from "../../src/pusher/services/SocketManager";
import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";
import { Zone } from "../../src/pusher/models/Zone";

/*
 * The load of the "pusher-300" run of the Konclui engine plan, in a unit harness: 300 users in one zone, each of them
 * watching it, walking in bubbles of 3. A walking client shares 5 positions a second, and every position makes the back
 * tell the pusher the new place of the user and the new centre of its bubble. The sockets are real PusherWebSockets on
 * a fake uWS transport; the frames they were sent are decoded below the way the bots of benchmark/ decode them, and
 * what the bots count is compared with what the pusher counted (workadventure_pusher_sub_messages_total and
 * workadventure_pusher_sub_messages_bytes_total).
 *
 * Measurement, rerun with:
 *   npm test -- --run tests/pusher/MovingUsersTraffic.test.ts
 * The "[moving users]" line it prints holds the numbers of the run. The BEFORE numbers below were taken by running this
 * same workload on the pusher as it was before the zone stopped telling the sockets about a bubble that only moved
 * (commit 700362b82), and do not change with the code.
 */
const USERS = 300;
const GROUP_SIZE = 3;
const GROUPS = USERS / GROUP_SIZE;
const BATCH_MS = 100;
const STEPS = 10; // 1 s of 100 ms; half of the users share a position in each step, so each shares 5 a second
const STEP_PX = 16;
const Y = 400;
// Each of the 300 users shares 5 positions a second for a second, and the bubbles change 4 times (a lock and an unlock
// of one, a user lost and a user back for another).
const BUBBLE_CHANGES = 4;
const MOVES = USERS * 5;

/** What the pusher did before a group update that only moved a bubble stopped reaching the sockets: all of them did. */
const BEFORE = {
    // The back says where a bubble is each time a user of it takes a step, and when the bubble changes.
    groupUpdatesFromBack: MOVES + BUBBLE_CHANGES,
    // The zone told each of the 300 sockets about each of them.
    groupNotifications: 451_200,
    // The group updates the sockets were sent, after a socket's batch kept one update of a bubble that moved twice in it.
    groupUpdatesOnTheWire: 300_000,
    groupUpdateBytesOnTheWire: 8_013_300,
    // Not touched by the change: each move of a user, to each of the 299 other sockets.
    userMovesOnTheWire: 448_500,
    userMoveBytesOnTheWire: 8_331_336,
};

interface Traffic {
    messages: number;
    bytes: number;
}

type TrafficByType = Map<string, Traffic>;

/** A user's socket: a real PusherWebSocket on a transport that keeps the frames, as the sockets of a pusher are. */
function userSocket(userId: number) {
    const frames: Uint8Array[] = [];
    const userData = {
        userId,
        userUuid: `uuid-${userId}`,
        tabId: `tab-${userId}`,
        connectionId: `connection-${userId}`,
        listenedZones: new Set<string>(),
    };
    const raw = {
        send: vi.fn((payload: Uint8Array) => {
            frames.push(payload);
            return 1;
        }),
        ping: vi.fn().mockReturnValue(1),
        end: vi.fn(),
        getBufferedAmount: vi.fn().mockReturnValue(0),
        getUserData: vi.fn().mockReturnValue(userData),
    };
    return { socket: new PusherWebSocket(raw as unknown as RawSocket), frames };
}

/** Bytes of the length of a message in protobuf, as the tag and the length that precede it in a batch entry. */
function lengthPrefixBytes(length: number): number {
    let size = 1; // the tag of the payload field
    let rest = length;
    do {
        size += 1;
        rest = Math.floor(rest / 128);
    } while (rest > 0);
    return size;
}

/** What a bot counts in the frames it received: each sub-message of a batch, with its entry tag and length prefix. */
function botTraffic(frames: Uint8Array[][]): TrafficByType {
    const traffic: TrafficByType = new Map();
    for (const socketFrames of frames) {
        for (const frame of socketFrames) {
            const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
            if (message?.$case !== "batchMessage") {
                continue;
            }
            for (const subMessage of message.batchMessage.payload) {
                const type = subMessage.message?.$case;
                if (type === undefined) {
                    continue;
                }
                const entry = traffic.get(type) ?? { messages: 0, bytes: 0 };
                const length = SubMessage.encode(subMessage).finish().length;
                entry.messages += 1;
                entry.bytes += lengthPrefixBytes(length) + length;
                traffic.set(type, entry);
            }
        }
    }
    return traffic;
}

async function metricByType(name: string): Promise<Map<string, number>> {
    const metric = await register.getSingleMetric(name)?.get();
    const values = new Map<string, number>();
    for (const { value, labels } of metric?.values ?? []) {
        values.set(String(labels.type), value);
    }
    return values;
}

/** What the pusher has counted so far, by type, as Prometheus scrapes it. */
async function pusherCounters(): Promise<TrafficByType> {
    const messages = await metricByType("workadventure_pusher_sub_messages_total");
    const bytes = await metricByType("workadventure_pusher_sub_messages_bytes_total");
    const traffic: TrafficByType = new Map();
    for (const [type, count] of messages) {
        traffic.set(type, { messages: count, bytes: bytes.get(type) ?? 0 });
    }
    return traffic;
}

function subtractTraffic(total: TrafficByType, base: TrafficByType): TrafficByType {
    const difference: TrafficByType = new Map();
    for (const [type, now] of total) {
        const before = base.get(type) ?? { messages: 0, bytes: 0 };
        if (now.messages > before.messages) {
            difference.set(type, { messages: now.messages - before.messages, bytes: now.bytes - before.bytes });
        }
    }
    return difference;
}

function userJoins(userId: number): UserJoinedZoneMessage {
    return UserJoinedZoneMessage.fromPartial({
        userId,
        userUuid: `uuid-${userId}`,
        name: `bot ${userId}`,
        characterTextures: [{ id: "male1", url: "resources/customisation/character_layer/male1.png" }],
        position: { x: 100 + userId * 10, y: Y, direction: PositionMessage_Direction.RIGHT, moving: false },
        availabilityStatus: AvailabilityStatus.ONLINE,
        visitCardUrl: "",
        variables: {},
    });
}

function groupOf(userId: number): number {
    return Math.floor((userId - 1) / GROUP_SIZE);
}

/** Runs the workload and returns what the zone told its sockets, what the sockets were sent, and what the pusher counted. */
async function runWorkload() {
    const manager = new SocketManager();
    // Counted by hand: a spy would keep the arguments of every one of the million calls.
    let groupNotifications = 0;
    const notifyGroupMoves = manager.onGroupMoves.bind(manager);
    manager.onGroupMoves = (group, listener) => {
        groupNotifications += 1;
        notifyGroupMoves(group, listener);
    };
    const zone = new Zone(manager, 0, 0);

    const users = Array.from({ length: USERS }, (_, index) => index + 1);
    const x = new Map(users.map((userId) => [userId, 100 + userId * 10]));
    const members = new Map<number, number[]>();
    const locked = new Map<number, boolean>();
    for (const userId of users) {
        members.set(groupOf(userId), [...(members.get(groupOf(userId)) ?? []), userId]);
        zone.handleUserJoinedZone(userJoins(userId));
    }
    const centre = (groupId: number) => {
        const ids = members.get(groupId) ?? [];
        return Math.floor(ids.reduce((sum, id) => sum + (x.get(id) ?? 0), 0) / ids.length);
    };
    const groupUpdate = (groupId: number) =>
        GroupUpdateZoneMessage.fromPartial({
            groupId,
            position: { x: centre(groupId), y: Y },
            groupSize: members.get(groupId)?.length ?? 0,
            locked: locked.get(groupId) ?? false,
            userIds: members.get(groupId) ?? [],
        });
    for (let groupId = 0; groupId < GROUPS; groupId++) {
        zone.handleGroupUpdateZone(groupUpdate(groupId));
    }

    const sockets = users.map((userId) => userSocket(userId));
    for (const { socket, frames } of sockets) {
        zone.startListening(socket);
        socket.flushBatch();
        frames.length = 0;
    }
    groupNotifications = 0;
    const countedBefore = await pusherCounters();

    let groupUpdatesFromBack = 0;
    for (let step = 0; step < STEPS; step++) {
        for (const userId of users) {
            if (userId % 2 !== step % 2) {
                continue;
            }
            x.set(userId, (x.get(userId) ?? 0) + STEP_PX);
            zone.handleUserMoved(
                UserMovedMessage.fromPartial({
                    userId,
                    position: { x: x.get(userId), y: Y, direction: PositionMessage_Direction.RIGHT, moving: true },
                }),
            );
            zone.handleGroupUpdateZone(groupUpdate(groupOf(userId)));
            groupUpdatesFromBack += 1;
        }
        // The bubbles also change now and then: one is locked, then unlocked, and one loses a user, then gets it back.
        if (step === 3 || step === 6) {
            locked.set(0, step === 3);
            zone.handleGroupUpdateZone(groupUpdate(0));
            groupUpdatesFromBack += 1;
        }
        if (step === 4 || step === 8) {
            members.set(1, step === 4 ? [4, 5] : [4, 5, 6]);
            zone.handleGroupUpdateZone(groupUpdate(1));
            zone.handleGroupUsersUpdate(GroupUsersUpdateMessage.fromPartial({ groupId: 1, userIds: members.get(1) }));
            groupUpdatesFromBack += 1;
        }
        vi.advanceTimersByTime(BATCH_MS);
    }

    const countedAfter = await pusherCounters();
    return {
        groupUpdatesFromBack,
        groupNotifications,
        bots: botTraffic(sockets.map(({ frames }) => frames)),
        counted: subtractTraffic(countedAfter, countedBefore),
    };
}

describe("300 users walking in bubbles of 3", () => {
    // The workload takes seconds, so both tests read one run of it.
    let run: Awaited<ReturnType<typeof runWorkload>>;

    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
        try {
            run = await runWorkload();
        } finally {
            vi.useRealTimers();
        }
    }, 120_000);

    it("tells the sockets about the bubbles that changed, not about every move of a bubble", () => {
        const { groupUpdatesFromBack, groupNotifications, bots } = run;
        const groupUpdatesOnTheWire = bots.get("groupUpdateMessage")?.messages ?? 0;
        const userMovesOnTheWire = bots.get("userMovedMessage")?.messages ?? 0;
        const groupUpdateBytes = bots.get("groupUpdateMessage")?.bytes ?? 0;
        const userMoveBytes = bots.get("userMovedMessage")?.bytes ?? 0;

        console.info(
            `[moving users] ${USERS} users, ${STEPS * BATCH_MS} ms: group updates from the back ${groupUpdatesFromBack}, ` +
                `zone to socket group notifications ${groupNotifications} (before ${BEFORE.groupNotifications}), ` +
                `group updates on the wire ${groupUpdatesOnTheWire} (before ${BEFORE.groupUpdatesOnTheWire}), ` +
                `user moves on the wire ${userMovesOnTheWire} (before ${BEFORE.userMovesOnTheWire}), ` +
                `bytes of group updates ${groupUpdateBytes} (before ${BEFORE.groupUpdateBytesOnTheWire}) and of user moves ${userMoveBytes} ` +
                `(before ${BEFORE.userMoveBytesOnTheWire})`,
        );

        expect(groupUpdatesFromBack).toBe(BEFORE.groupUpdatesFromBack);
        // Only the 4 changes reach the 300 sockets: a tenth of what it was is a generous bound, 1200 is what it is.
        expect(groupNotifications).toBeLessThan(BEFORE.groupNotifications / 10);
        expect(groupNotifications).toBe(BUBBLE_CHANGES * USERS);
        expect(groupUpdatesOnTheWire).toBeLessThan(BEFORE.groupUpdatesOnTheWire / 10);
        expect(groupUpdatesOnTheWire).toBe(BUBBLE_CHANGES * USERS);
        expect(groupUpdateBytes).toBeLessThan(BEFORE.groupUpdateBytesOnTheWire / 10);
        // The moves of the users, and the lists of users of the bubbles, are what they were.
        expect(userMovesOnTheWire).toBe(BEFORE.userMovesOnTheWire);
        expect(userMoveBytes).toBe(BEFORE.userMoveBytesOnTheWire);
        expect(bots.get("groupUsersUpdateMessage")?.messages).toBe(2 * USERS);
    });

    it("counts what the sockets were sent: per type, the sub-messages and their bytes match what the bots count", () => {
        const { bots, counted } = run;

        expect([...bots.keys()].sort()).toEqual(["groupUpdateMessage", "groupUsersUpdateMessage", "userMovedMessage"]);
        for (const [type, traffic] of bots) {
            expect(counted.get(type), type).toEqual(traffic);
        }
        expect(counted.size).toBe(bots.size);
    });
});
