import { beforeAll, describe, expect, it, vi } from "vitest";
import { register } from "prom-client";
import {
    AvailabilityStatus,
    PositionMessage_Direction,
    PusherToFrontWebSocketMessage,
    UserJoinedZoneMessage,
    UserMovedMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { SocketManager } from "../../src/pusher/services/SocketManager";
import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";
import { Zone } from "../../src/pusher/models/Zone";
import type { ViewerBudgetLimits } from "../../src/pusher/models/ViewerBudget";

/*
 * Deliveries per second to one viewer among 1000 dense movers, without and with the per-viewer budget (DEC C1, slice 3;
 * engine plan 2.4). 1000 users stand on a 40 x 25 grid, 8 px apart, all in one zone; the viewer is one of them, in the
 * middle, and watches the zone. Every other user walks on the spot, 4 px right then 4 px left, sharing 5 positions a
 * second. The deliveries are what the pusher counted (workadventure_pusher_sub_messages_total, by type), checked
 * against the frames the viewer's socket was sent.
 *
 * Rerun with:
 *   npm test -- --run tests/pusher/ViewerBudgetTraffic.test.ts
 * The numbers are exact (fake clock); the test names hold them.
 */
const COLUMNS = 40;
const ROWS = 25;
const USERS = COLUMNS * ROWS;
const SPACING_PX = 8;
const VIEWER = 20 * ROWS + 13; // column 20, row 12: the middle of the crowd
const BATCH_MS = 100;
const WARM_UP_STEPS = 20; // 2 s for the scene to settle before the window opens
const WINDOW_STEPS = 100; // 10 s counted
const BUDGET: ViewerBudgetLimits = { fullRatePeers: 150, maxPeers: 400 };

interface Window {
    movesPerSecond: number;
    moveBytesPerSecond: number;
    joinsAndLeavesPerSecond: number;
}

function home(userId: number): { x: number; y: number } {
    const index = userId - 1;
    return { x: 4 + Math.floor(index / ROWS) * SPACING_PX, y: 4 + (index % ROWS) * SPACING_PX };
}

function viewerSocket() {
    const frames: Uint8Array[] = [];
    const userData = {
        userId: VIEWER,
        userUuid: `uuid-${VIEWER}`,
        tabId: `tab-${VIEWER}`,
        connectionId: `connection-${VIEWER}`,
        listenedZones: new Set<string>(),
        // Centred on the viewer, as a camera that follows it.
        viewport: {
            left: home(VIEWER).x - 480,
            right: home(VIEWER).x + 480,
            top: home(VIEWER).y - 270,
            bottom: home(VIEWER).y + 270,
        },
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

async function countedByType(name: string): Promise<Map<string, number>> {
    const metric = await register.getSingleMetric(name)?.get();
    return new Map((metric?.values ?? []).map(({ value, labels }) => [String(labels.type), value]));
}

async function counted(): Promise<{ messages: Map<string, number>; bytes: Map<string, number> }> {
    return {
        messages: await countedByType("workadventure_pusher_sub_messages_total"),
        bytes: await countedByType("workadventure_pusher_sub_messages_bytes_total"),
    };
}

function delta(after: Map<string, number>, before: Map<string, number>, type: string): number {
    return (after.get(type) ?? 0) - (before.get(type) ?? 0);
}

/** What the viewer's client would hold after applying the frames: the users it knows and where it draws them. */
class ClientScene {
    public readonly positions = new Map<number, { x: number; y: number; moving: boolean }>();
    public largestScene = 0;
    public movesOfUnknownUsers = 0;

    public apply(frames: Uint8Array[]): void {
        for (const frame of frames) {
            const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
            if (message?.$case !== "batchMessage") {
                continue;
            }
            for (const { message: subMessage } of message.batchMessage.payload) {
                if (subMessage?.$case === "userJoinedMessage") {
                    const { userId, position } = subMessage.userJoinedMessage;
                    this.positions.set(userId, { x: position?.x ?? 0, y: position?.y ?? 0, moving: false });
                } else if (subMessage?.$case === "userMovedMessage") {
                    const { userId, position } = subMessage.userMovedMessage;
                    if (!this.positions.has(userId)) {
                        this.movesOfUnknownUsers += 1;
                    }
                    this.positions.set(userId, {
                        x: position?.x ?? 0,
                        y: position?.y ?? 0,
                        moving: position?.moving ?? false,
                    });
                } else if (subMessage?.$case === "userLeftMessage") {
                    this.positions.delete(subMessage.userLeftMessage.userId);
                }
            }
            this.largestScene = Math.max(this.largestScene, this.positions.size);
        }
    }
}

async function runCrowd(budget: ViewerBudgetLimits | undefined) {
    const zone = new Zone(new SocketManager(undefined, budget), 0, 0);
    const users = Array.from({ length: USERS }, (_, index) => index + 1);
    const x = new Map(users.map((userId) => [userId, home(userId).x]));
    for (const userId of users) {
        zone.handleUserJoinedZone(
            UserJoinedZoneMessage.fromPartial({
                userId,
                userUuid: `uuid-${userId}`,
                name: `bot ${userId}`,
                characterTextures: [],
                position: { ...home(userId), direction: PositionMessage_Direction.RIGHT, moving: false },
                availabilityStatus: AvailabilityStatus.ONLINE,
                visitCardUrl: "",
                variables: {},
            }),
        );
    }
    const viewer = viewerSocket();
    const client = new ClientScene();
    zone.startListening(viewer.socket);

    const move = (userId: number, moving: boolean) => {
        zone.handleUserMoved(
            UserMovedMessage.fromPartial({
                userId,
                position: { x: x.get(userId), y: home(userId).y, direction: PositionMessage_Direction.RIGHT, moving },
            }),
        );
    };
    const step = (index: number) => {
        for (const userId of users) {
            // Half of the users share a position each 100 ms: 5 a second each.
            if (userId === VIEWER || userId % 2 !== index % 2) {
                continue;
            }
            x.set(userId, (x.get(userId) ?? 0) + (Math.floor(index / 2) % 2 === 0 ? 4 : -4));
            move(userId, true);
        }
        vi.advanceTimersByTime(BATCH_MS);
        client.apply(viewer.frames.splice(0));
    };

    for (let index = 0; index < WARM_UP_STEPS; index++) {
        step(index);
    }
    const before = await counted();
    for (let index = WARM_UP_STEPS; index < WARM_UP_STEPS + WINDOW_STEPS; index++) {
        step(index);
    }
    const after = await counted();
    const seconds = (WINDOW_STEPS * BATCH_MS) / 1000;
    const window: Window = {
        movesPerSecond: delta(after.messages, before.messages, "userMovedMessage") / seconds,
        moveBytesPerSecond: delta(after.bytes, before.bytes, "userMovedMessage") / seconds,
        joinsAndLeavesPerSecond:
            (delta(after.messages, before.messages, "userJoinedMessage") +
                delta(after.messages, before.messages, "userLeftMessage")) /
            seconds,
    };

    // Everyone stops where they are; a tick later the client must draw each user it knows where it really is.
    for (const userId of users) {
        if (userId !== VIEWER) {
            move(userId, false);
        }
    }
    vi.advanceTimersByTime(1000);
    viewer.socket.flushBatch();
    client.apply(viewer.frames.splice(0));
    const misplaced = [...client.positions].filter(
        ([userId, drawn]) => drawn.moving || drawn.x !== x.get(userId) || drawn.y !== home(userId).y,
    ).length;

    viewer.socket.end();
    return { window, client, misplaced };
}

describe("one viewer among 1000 dense movers", () => {
    let off: Awaited<ReturnType<typeof runCrowd>>;
    let on: Awaited<ReturnType<typeof runCrowd>>;

    beforeAll(async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
        try {
            off = await runCrowd(undefined);
            on = await runCrowd(BUDGET);
        } finally {
            vi.useRealTimers();
        }
    }, 120_000);

    it("budget off: 4995 moves (89.1 kB) a second reach the viewer, 999 users in its scene", () => {
        expect(off.window).toEqual({ movesPerSecond: 4995, moveBytesPerSecond: 89_137.5, joinsAndLeavesPerSecond: 0 });
        expect(off.client.largestScene).toBe(USERS - 1);
        expect(off.misplaced).toBe(0);
    });

    it("budget on (150 / 400): 1000 moves (18.0 kB) a second reach the viewer, 400 users in its scene, no churn", () => {
        expect(on.window).toEqual({ movesPerSecond: 1000, moveBytesPerSecond: 18_005.5, joinsAndLeavesPerSecond: 0 });
        expect(on.window.movesPerSecond).toBeLessThanOrEqual(
            BUDGET.fullRatePeers * 5 + (BUDGET.maxPeers - BUDGET.fullRatePeers),
        );
        expect(on.client.largestScene).toBe(BUDGET.maxPeers);
    });

    it("budget on: every user the viewer knows of is drawn where it stopped, and no move points at a stranger", () => {
        expect(on.client.positions.size).toBe(BUDGET.maxPeers);
        expect(on.misplaced).toBe(0);
        expect(on.client.movesOfUnknownUsers).toBe(0);
        expect(off.client.movesOfUnknownUsers).toBe(0);
    });
});
