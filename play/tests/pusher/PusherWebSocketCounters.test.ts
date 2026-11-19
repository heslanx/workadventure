import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "prom-client";
import { PositionMessage_Direction, PusherToFrontWebSocketMessage, SubMessage } from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";

const MESSAGES_METRIC = "workadventure_pusher_sub_messages_total";
const BYTES_METRIC = "workadventure_pusher_sub_messages_bytes_total";

function createSocket(options: { sendStatus?: number } = {}): { socket: PusherWebSocket; sentFrames: Uint8Array[] } {
    const sentFrames: Uint8Array[] = [];
    const raw = {
        send: vi.fn((payload: Uint8Array) => {
            sentFrames.push(payload);
            return options.sendStatus ?? 1;
        }),
        ping: vi.fn().mockReturnValue(1),
        end: vi.fn(),
        getBufferedAmount: vi.fn().mockReturnValue(0),
        getUserData: vi.fn().mockReturnValue({}),
    } as unknown as RawSocket;
    return { socket: new PusherWebSocket(raw), sentFrames };
}

function userMoved(userId: number, x: number): SubMessage {
    return {
        message: {
            $case: "userMovedMessage",
            userMovedMessage: {
                userId,
                position: { x, y: 10, direction: PositionMessage_Direction.DOWN, moving: true },
            },
        },
    };
}

function groupUpdate(groupId: number, x: number): SubMessage {
    return {
        message: {
            $case: "groupUpdateMessage",
            groupUpdateMessage: { groupId, position: { x, y: 10 }, groupSize: 2, locked: false, userIds: [1, 2] },
        },
    };
}

function userLeft(userId: number): SubMessage {
    return { message: { $case: "userLeftMessage", userLeftMessage: { userId } } };
}

/** A sub-message whose encoding is longer than 127 bytes, so that the length of its entry takes two bytes. */
function longGroupUpdate(groupId: number): SubMessage {
    return {
        message: {
            $case: "groupUpdateMessage",
            groupUpdateMessage: {
                groupId,
                position: { x: 1, y: 2 },
                groupSize: 60,
                locked: false,
                userIds: Array.from({ length: 60 }, (_, index) => 1000 + index),
            },
        },
    };
}

interface Traffic {
    messages: number;
    bytes: number;
}

async function counted(): Promise<Map<string, Traffic>> {
    const traffic = new Map<string, Traffic>();
    const messages = (await register.getSingleMetric(MESSAGES_METRIC)?.get())?.values ?? [];
    const bytes = (await register.getSingleMetric(BYTES_METRIC)?.get())?.values ?? [];
    for (const { value, labels } of messages) {
        traffic.set(String(labels.type), { messages: value, bytes: 0 });
    }
    for (const { value, labels } of bytes) {
        const entry = traffic.get(String(labels.type));
        if (entry) {
            entry.bytes = value;
        }
    }
    return traffic;
}

/**
 * What a client counts in the frames it is sent: each sub-message of a batch, as the bytes of its entry in the batch,
 * which are the tag of the field (1 byte), the length of the sub-message, and the sub-message.
 */
function receivedBy(frames: Uint8Array[]): Map<string, Traffic> {
    const traffic = new Map<string, Traffic>();
    for (const frame of frames) {
        const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
        if (message?.$case !== "batchMessage") {
            continue;
        }
        for (const subMessage of message.batchMessage.payload) {
            const type = subMessage.message?.$case ?? "";
            const length = SubMessage.encode(subMessage).finish().length;
            const entry = traffic.get(type) ?? { messages: 0, bytes: 0 };
            entry.messages += 1;
            entry.bytes += 1 + varintLength(length) + length;
            traffic.set(type, entry);
        }
    }
    return traffic;
}

function varintLength(value: number): number {
    let length = 1;
    for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) {
        length += 1;
    }
    return length;
}

function difference(after: Map<string, Traffic>, before: Map<string, Traffic>): Map<string, Traffic> {
    const result = new Map<string, Traffic>();
    for (const [type, now] of after) {
        const base = before.get(type) ?? { messages: 0, bytes: 0 };
        if (now.messages > base.messages) {
            result.set(type, { messages: now.messages - base.messages, bytes: now.bytes - base.bytes });
        }
    }
    return result;
}

describe("PusherWebSocket sub-message counters", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("counts the sub-messages of a sent batch by type, with the bytes the client received for each", async () => {
        const { socket, sentFrames } = createSocket();
        const before = await counted();

        socket.emitInBatch(userMoved(1, 10));
        socket.emitInBatch(userMoved(2, 20));
        socket.emitInBatch(groupUpdate(7, 100));
        socket.emitInBatch(userLeft(3));
        vi.advanceTimersByTime(100);

        const sent = difference(await counted(), before);
        expect(sent.get("userMovedMessage")?.messages).toBe(2);
        expect(sent.get("groupUpdateMessage")?.messages).toBe(1);
        expect(sent.get("userLeftMessage")?.messages).toBe(1);
        expect(sent).toEqual(receivedBy(sentFrames));
    });

    it("counts a group update that was replaced inside its batch once, as the client received it once", async () => {
        const { socket, sentFrames } = createSocket();
        const before = await counted();

        socket.emitInBatch(groupUpdate(7, 100));
        socket.emitInBatch(groupUpdate(7, 120));
        socket.emitInBatch(groupUpdate(7, 140));
        socket.flushBatch();

        const sent = difference(await counted(), before);
        expect(sent.get("groupUpdateMessage")?.messages).toBe(1);
        expect(sent).toEqual(receivedBy(sentFrames));
    });

    it("counts the bytes right when an entry is longer than 127 bytes, so its length takes two bytes", async () => {
        const { socket, sentFrames } = createSocket();
        const before = await counted();

        socket.emitInBatch(userMoved(1, 10));
        socket.emitInBatch(longGroupUpdate(7));
        socket.emitInBatch(userMoved(2, 20));
        socket.flushBatch();

        const sent = difference(await counted(), before);
        expect(receivedBy(sentFrames).get("groupUpdateMessage")?.bytes).toBeGreaterThan(127);
        expect(sent).toEqual(receivedBy(sentFrames));
    });

    it("counts the bytes right once the nonce of the frames takes more than one byte", async () => {
        const { socket, sentFrames } = createSocket();
        for (let frame = 0; frame < 200; frame++) {
            socket.emitInBatch(userLeft(frame));
            socket.flushBatch();
        }
        const before = await counted();
        sentFrames.length = 0;

        socket.emitInBatch(userMoved(1, 10));
        socket.emitInBatch(groupUpdate(7, 100));
        socket.flushBatch();

        expect(PusherToFrontWebSocketMessage.decode(sentFrames[0]).nonce).toBeGreaterThan(127);
        expect(difference(await counted(), before)).toEqual(receivedBy(sentFrames));
    });

    it("counts a frame that the transport could not take yet, which is kept and sent later, once", async () => {
        const { socket, sentFrames } = createSocket({ sendStatus: 0 });
        const before = await counted();

        socket.emitInBatch(userMoved(1, 10));
        socket.flushBatch();
        socket.handleDrain();

        expect(sentFrames.length).toBeGreaterThan(0);
        expect(difference(await counted(), before).get("userMovedMessage")?.messages).toBe(1);
    });

    it("counts nothing for a batch that is dropped because the socket is disconnecting", async () => {
        const { socket } = createSocket();
        const before = await counted();

        socket.emitInBatch(userMoved(1, 10));
        socket.startDisconnecting();
        socket.flushBatch();

        expect(difference(await counted(), before).size).toBe(0);
    });
});
