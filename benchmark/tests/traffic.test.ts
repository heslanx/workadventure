import { describe, expect, it } from "vitest";
import {
    FrontToPusherWebSocketMessage,
    RoomJoinedMessage,
    SpaceUser,
    SubMessage,
    FilterType,
} from "../../libs/messages/src/ts-proto-generated/messages";
import {
    WORLD_SPACE_NAME,
    batchEntryWireSizes,
    decodeServerFrame,
    joinWorldSpaceMessage,
    watchWorldSpaceMessage,
    encodeClientFrame,
    type FrameAccounting,
} from "../src/protocol";
import { TrafficStats, reportTypeTraffic } from "../src/stats";
import { batchFrame, serverFrame } from "./support/fakePusher";

type SubMessageBody = NonNullable<SubMessage["message"]>;

const moved: SubMessageBody = {
    $case: "userMovedMessage",
    userMovedMessage: { userId: 7, position: { x: 100, y: 200, direction: 0, moving: true } },
};

function users(count: number) {
    return Array.from({ length: count }, (_, index) =>
        SpaceUser.fromPartial({ spaceUserId: `space-user-${index}`, name: `bot-${index}` }),
    );
}

function init(spaceName: string, count: number): SubMessageBody {
    return {
        $case: "initSpaceUsersMessage",
        initSpaceUsersMessage: { spaceName, users: users(count), metadata: "", state: "" },
    };
}

/** Size of a batch entry on the wire, from the generated encoder: tag, length prefix and the entry itself. */
function entrySize(message: SubMessageBody): number {
    const length = SubMessage.encode({ message }).finish().length;
    return 1 + (length < 128 ? 1 : length < 16384 ? 2 : 3) + length;
}

function accountingOf(frame: Uint8Array): FrameAccounting {
    const accounting = decodeServerFrame(frame, false, true).accounting;
    if (accounting === undefined) {
        throw new Error("accounting was requested");
    }
    return accounting;
}

describe("frame accounting", () => {
    it("attributes every byte of a batch frame to a message type or to the frame headers", () => {
        const frame = batchFrame(9, moved, init(WORLD_SPACE_NAME, 3), moved);

        const accounting = accountingOf(frame);

        expect(accounting.messages.map((message) => message.type)).toEqual([
            "userMovedMessage",
            "initSpaceUsersMessage",
            "userMovedMessage",
        ]);
        const attributed = accounting.messages.reduce((total, message) => total + message.bytes, 0);
        expect(attributed + accounting.overheadBytes).toBe(frame.length);
        // Nonce, the envelope and the empty event string of the batch are the only bytes left over.
        expect(accounting.overheadBytes).toBeGreaterThan(0);
        expect(accounting.overheadBytes).toBeLessThan(12);
    });

    it("measures each message with the size the generated encoder gives it, including entries over 127 bytes", () => {
        // 20 users make the snapshot larger than 127 bytes, so its length prefix takes two bytes.
        const snapshot = init(WORLD_SPACE_NAME, 20);
        const frame = batchFrame(1, moved, snapshot);

        const accounting = accountingOf(frame);

        expect(accounting.messages[0].bytes).toBe(entrySize(moved));
        expect(accounting.messages[1].bytes).toBe(entrySize(snapshot));
        expect(entrySize(snapshot)).toBeGreaterThan(128);
    });

    it("lists the entry sizes of a batch in payload order", () => {
        const frame = batchFrame(1, moved, init("other", 2), moved);

        expect(batchEntryWireSizes(frame)).toEqual([entrySize(moved), entrySize(init("other", 2)), entrySize(moved)]);
    });

    it("counts a roster snapshot as one message that carries as many records as it has users", () => {
        const accounting = accountingOf(batchFrame(1, init(WORLD_SPACE_NAME, 40)));

        expect(accounting.messages).toMatchObject([
            { type: "initSpaceUsersMessage", spaceName: WORLD_SPACE_NAME, records: 40 },
        ]);
    });

    it("names the space of each roster message, so the world's share can be told from other spaces", () => {
        const accounting = accountingOf(
            batchFrame(
                1,
                { $case: "addSpaceUserMessage", addSpaceUserMessage: { spaceName: "bubble-1", user: users(1)[0] } },
                {
                    $case: "removeSpaceUserMessage",
                    removeSpaceUserMessage: { spaceName: WORLD_SPACE_NAME, spaceUserId: "a" },
                },
                {
                    $case: "updateSpaceUserMessage",
                    updateSpaceUserMessage: { spaceName: WORLD_SPACE_NAME, user: users(1)[0], updateMask: ["name"] },
                },
                {
                    $case: "spaceStatePatchMessage",
                    spaceStatePatchMessage: { spaceName: WORLD_SPACE_NAME, patch: "[]" },
                },
            ),
        );

        expect(accounting.messages.map((message) => [message.type, message.spaceName])).toEqual([
            ["addSpaceUserMessage", "bubble-1"],
            ["removeSpaceUserMessage", WORLD_SPACE_NAME],
            ["updateSpaceUserMessage", WORLD_SPACE_NAME],
            ["spaceStatePatchMessage", WORLD_SPACE_NAME],
        ]);
    });

    it("attributes a frame that is not a batch to its own type, with no header left over", () => {
        const frame = serverFrame(2, {
            $case: "roomJoinedMessage",
            roomJoinedMessage: RoomJoinedMessage.fromPartial({ currentUserId: 4 }),
        });

        expect(accountingOf(frame)).toEqual({
            messages: [{ type: "roomJoinedMessage", bytes: frame.length, records: 1 }],
            overheadBytes: 0,
        });
    });

    it("leaves accounting out unless asked, so the plain decode stays cheap", () => {
        expect(decodeServerFrame(batchFrame(1, moved)).accounting).toBeUndefined();
    });
});

describe("query answers", () => {
    it("reports the answer to a query by its id", () => {
        const frame = serverFrame(1, {
            $case: "answerMessage",
            answerMessage: { id: 12, answer: { $case: "joinSpaceAnswer", joinSpaceAnswer: { spaceUserId: "u" } } },
        });

        expect(decodeServerFrame(frame).signals).toEqual([{ kind: "queryAnswer", id: 12, error: undefined }]);
    });

    it("carries the error text of a refused query", () => {
        const frame = serverFrame(1, {
            $case: "answerMessage",
            answerMessage: { id: 3, answer: { $case: "error", error: { message: "space_full" } } },
        });

        expect(decodeServerFrame(frame).signals).toEqual([{ kind: "queryAnswer", id: 3, error: "space_full" }]);
    });
});

describe("world space client messages", () => {
    it("joins allWorldUser with every user and the properties GameScene syncs", () => {
        const frame = FrontToPusherWebSocketMessage.decode(encodeClientFrame(1, joinWorldSpaceMessage(5)));

        expect(frame.message?.message).toMatchObject({
            $case: "queryMessage",
            queryMessage: {
                id: 5,
                query: {
                    $case: "joinSpaceQuery",
                    joinSpaceQuery: {
                        spaceName: "allWorldUser",
                        filterType: FilterType.ALL_USERS,
                        propertiesToSync: ["availabilityStatus", "chatID"],
                    },
                },
            },
        });
    });

    it("subscribes to the user list with an add-filter message for the same space", () => {
        const frame = FrontToPusherWebSocketMessage.decode(encodeClientFrame(1, watchWorldSpaceMessage()));

        expect(frame.message?.message).toMatchObject({
            $case: "addSpaceFilterMessage",
            addSpaceFilterMessage: { spaceFilterMessage: { spaceName: "allWorldUser" } },
        });
    });
});

describe("traffic statistics", () => {
    const accounting = (...messages: { type: string; bytes: number; spaceName?: string; records?: number }[]) => ({
        messages: messages.map((message) => ({ records: 1, ...message })),
        overheadBytes: 4,
    });

    it("sums frames, messages, records and bytes by type", () => {
        const traffic = new TrafficStats(0, undefined);

        traffic.record(
            100,
            60,
            accounting({ type: "userMovedMessage", bytes: 25 }, { type: "userMovedMessage", bytes: 25 }),
        );
        traffic.record(
            200,
            40,
            accounting({ type: "userMovedMessage", bytes: 30 }, { type: "groupUpdateMessage", bytes: 6 }),
        );

        expect(traffic.frames).toBe(2);
        expect(traffic.bytes).toBe(100);
        expect(traffic.overheadBytes).toBe(8);
        // Frames count once per frame carrying the type: two frames had a move, though three moves arrived.
        expect(traffic.byType.get("userMovedMessage")).toEqual({ frames: 2, messages: 3, records: 3, bytes: 80 });
        expect(traffic.byType.get("groupUpdateMessage")).toEqual({ frames: 1, messages: 1, records: 1, bytes: 6 });
    });

    it("ignores frames received outside the window, edges included on the start side only", () => {
        const traffic = new TrafficStats(0, { startMs: 1000, endMs: 2000 });

        traffic.record(999, 10, accounting({ type: "userMovedMessage", bytes: 6 }));
        traffic.record(1000, 10, accounting({ type: "userMovedMessage", bytes: 6 }));
        traffic.record(1999, 10, accounting({ type: "userMovedMessage", bytes: 6 }));
        traffic.record(2000, 10, accounting({ type: "userMovedMessage", bytes: 6 }));

        expect(traffic.frames).toBe(2);
        expect(traffic.byType.get("userMovedMessage")?.messages).toBe(2);
    });

    it("counts the roster of the world space apart from the same messages of other spaces", () => {
        const traffic = new TrafficStats(0, undefined);

        traffic.record(
            10,
            90,
            accounting(
                { type: "initSpaceUsersMessage", bytes: 50, spaceName: WORLD_SPACE_NAME, records: 8 },
                { type: "addSpaceUserMessage", bytes: 20, spaceName: "bubble-1" },
                { type: "addSpaceUserMessage", bytes: 10, spaceName: WORLD_SPACE_NAME },
                { type: "userMovedMessage", bytes: 6 },
            ),
        );

        expect(traffic.world.get("initSpaceUsersMessage")).toEqual({ frames: 1, messages: 1, records: 8, bytes: 50 });
        expect(traffic.world.get("addSpaceUserMessage")).toEqual({ frames: 1, messages: 1, records: 1, bytes: 10 });
        expect(traffic.world.has("userMovedMessage")).toBe(false);
        expect(traffic.byType.get("addSpaceUserMessage")?.messages).toBe(2);
        expect(traffic.worldFrames).toBe(1);
    });

    it("finds the busiest second per type", () => {
        // The run started at 5000 ms, so 5100 and 5900 fall in second 0 and 6100 in second 1.
        const traffic = new TrafficStats(5000, undefined);

        traffic.record(5100, 0, accounting({ type: "userMovedMessage", bytes: 40 }));
        traffic.record(5900, 0, accounting({ type: "userMovedMessage", bytes: 40 }));
        traffic.record(6100, 0, accounting({ type: "userMovedMessage", bytes: 50 }));

        expect(traffic.peakBytesPerSecond("userMovedMessage")).toBe(80);
        expect(traffic.peakBytesPerSecond("pingMessage")).toBe(0);
    });

    it("turns totals into rates per second and per accepted session", () => {
        const traffic = new TrafficStats(0, undefined);
        traffic.record(10, 4000, accounting({ type: "userMovedMessage", bytes: 4000 }));

        const report = reportTypeTraffic(traffic.byType, 10, 5, (type) => traffic.peakBytesPerSecond(type));

        // 4000 bytes in 10 s is 400 B/s; 32 kbit shared by 5 sessions over 10 s is 0.64 kbit/s each.
        expect(report.userMovedMessage).toMatchObject({
            messages: 1,
            bytes: 4000,
            messagesPerSecond: 0.1,
            bytesPerSecond: 400,
            peakBytesPerSecond: 4000,
            kbitPerSecondPerSession: 0.64,
        });
    });

    it("has no rate when no time was measured, instead of dividing by zero", () => {
        const traffic = new TrafficStats(0, undefined);
        traffic.record(10, 100, accounting({ type: "userMovedMessage", bytes: 100 }));

        const report = reportTypeTraffic(traffic.byType, 0, 0, () => 0);

        expect(report.userMovedMessage).toMatchObject({
            messagesPerSecond: null,
            bytesPerSecond: null,
            kbitPerSecondPerSession: null,
        });
    });
});
