import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AvailabilityStatus,
    PositionMessage_Direction,
    PusherToFrontWebSocketMessage,
    UserJoinedZoneMessage,
    UserMovedMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
// The consumer of the budget's frames: the client's estimate of a remote user's sample interval.
vi.mock("../../src/front/Enum/EnvironmentVariable.ts", () => import("../front/mocks/frontEnvironmentVariableMock"));

import { SocketManager } from "../../src/pusher/services/SocketManager";
import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";
import { Zone } from "../../src/pusher/models/Zone";
import {
    CONFLATED_INTERVAL_MS,
    SEAT_MARGIN_PX,
    selectViewerBudget,
    type PeerPoint,
    type ViewerBudgetLimits,
} from "../../src/pusher/models/ViewerBudget";
import { RemoteSampleIntervals } from "../../src/front/Phaser/Game/RemoteSampleInterval";

function peer(userId: number, x: number, y: number): PeerPoint {
    return { userId, getPosition: () => ({ x, y }) };
}

describe("selectViewerBudget", () => {
    const origin = { x: 0, y: 0 };
    const limits = { fullRatePeers: 2, maxPeers: 4 };

    it("sends the nearest users at full rate, the next ones up to the ceiling once a second, and drops the rest", () => {
        const peers = [50, 10, 40, 30, 60, 20].map((x, index) => peer(index + 1, x, 0));

        const selection = selectViewerBudget(origin, peers, new Set(), limits);

        expect(selection.fullRate).toEqual(new Set([2, 6]));
        expect(selection.inScene).toEqual(new Set([2, 6, 4, 3]));
    });

    it("measures the distance in both axes and breaks ties by the lower user id", () => {
        const peers = [peer(9, 0, 30), peer(3, 30, 0), peer(5, 20, 20)];

        const selection = selectViewerBudget(origin, peers, new Set(), { fullRatePeers: 1, maxPeers: 2 });

        expect(selection.inScene).toEqual(new Set([5, 3]));
        expect(selection.fullRate).toEqual(new Set([5]));
    });

    it("keeps a seated user against a newcomer closer by less than the seat margin, not by more", () => {
        const seated = new Set([1]);
        const onlyOne = { fullRatePeers: 1, maxPeers: 1 };

        const nearlyAsClose = selectViewerBudget(
            origin,
            [peer(1, 100, 0), peer(2, 100 - SEAT_MARGIN_PX + 1, 0)],
            seated,
            onlyOne,
        );
        const muchCloser = selectViewerBudget(
            origin,
            [peer(1, 100, 0), peer(2, 100 - SEAT_MARGIN_PX - 1, 0)],
            seated,
            onlyOne,
        );

        expect(nearlyAsClose.inScene).toEqual(new Set([1]));
        expect(muchCloser.inScene).toEqual(new Set([2]));
    });

    it("never selects more users than the ceiling, whatever the crowd", () => {
        const crowd = Array.from({ length: 1000 }, (_, index) => peer(index, index % 37, index % 11));

        const selection = selectViewerBudget(origin, crowd, new Set(), { fullRatePeers: 150, maxPeers: 400 });

        expect(selection.inScene.size).toBe(400);
        expect(selection.fullRate.size).toBe(150);
        expect([...selection.fullRate].every((userId) => selection.inScene.has(userId))).toBe(true);
    });

    /*
     * The selection runs every RERANK_INTERVAL_MS (500 ms) per viewer over every user it watches, so its cost is paid
     * 2000 times a second at 1000 viewers. MEASURED once, 2026-11-20, performance.now() over 1000 calls on this crowd (1000
     * users, 400 seated), Node 24, Apple M1 Max, best of 3, host load not recorded: a full sort with Math.hypot took 184 ms,
     * this selection 31 ms per 1000 calls. DERIVED at one rank per viewer per 500 ms: 0.37 against 0.06 core for 1000
     * viewers. The test asserts the users, not the time: the timing depends on the host.
     */
    it("picks the same users as a full ranking of 1000", () => {
        const crowd = Array.from({ length: 1000 }, (_, index) =>
            peer(index + 1, 4 + Math.floor(index / 25) * 8, 4 + (index % 25) * 8),
        );
        const centre = { x: 164, y: 100 };
        const budget = { fullRatePeers: 150, maxPeers: 400 };
        const distance = (userId: number) => {
            const { x, y } = crowd[userId - 1].getPosition();
            return Math.sqrt((x - centre.x) ** 2 + (y - centre.y) ** 2);
        };
        const ranked = (seated: ReadonlySet<number>) =>
            crowd
                .map(({ userId }) => ({
                    userId,
                    distance: distance(userId) - (seated.has(userId) ? SEAT_MARGIN_PX : 0),
                }))
                .sort((first, second) => first.distance - second.distance || first.userId - second.userId)
                .map(({ userId }) => userId);

        const first = selectViewerBudget(centre, crowd, new Set(), budget);
        // A seated scene shifted off the centre, so the margin changes who is in.
        const seated = new Set(ranked(new Set()).slice(300, 700));
        const second = selectViewerBudget(centre, crowd, seated, budget);

        expect(first.inScene).toEqual(new Set(ranked(new Set()).slice(0, 400)));
        expect(first.fullRate).toEqual(new Set(ranked(new Set()).slice(0, 150)));
        expect(second.inScene).toEqual(new Set(ranked(seated).slice(0, 400)));
        expect(second.fullRate).toEqual(new Set(ranked(seated).slice(0, 150)));
        expect(second.inScene).not.toEqual(first.inScene);
    });
});

interface Received {
    type: string;
    userId: number;
    x?: number;
    moving?: boolean;
}

function viewerSocket(userId: number) {
    const frames: Uint8Array[] = [];
    const userData = {
        userId,
        userUuid: `uuid-${userId}`,
        tabId: `tab-${userId}`,
        connectionId: `connection-${userId}`,
        listenedZones: new Set<string>(),
        // Centred on (0, 0): the budget ranks users from there until the viewer moves.
        viewport: { left: -1000, top: -1000, right: 1000, bottom: 1000 },
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
    const socket = new PusherWebSocket(raw as unknown as RawSocket);
    /** What the socket was sent since the last call, in order. */
    const received = (): Received[] => {
        socket.flushBatch();
        const messages: Received[] = [];
        for (const frame of frames.splice(0)) {
            const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
            if (message?.$case !== "batchMessage") {
                continue;
            }
            for (const { message: subMessage } of message.batchMessage.payload) {
                if (subMessage?.$case === "userJoinedMessage") {
                    const { userId, position } = subMessage.userJoinedMessage;
                    messages.push({ type: "join", userId, x: position?.x });
                } else if (subMessage?.$case === "userMovedMessage") {
                    const { userId, position } = subMessage.userMovedMessage;
                    messages.push({ type: "move", userId, x: position?.x, moving: position?.moving });
                } else if (subMessage?.$case === "userLeftMessage") {
                    messages.push({ type: "leave", userId: subMessage.userLeftMessage.userId });
                }
            }
        }
        return messages;
    };
    return { socket, received, frames };
}

function joinAt(userId: number, x: number): UserJoinedZoneMessage {
    return UserJoinedZoneMessage.fromPartial({
        userId,
        userUuid: `uuid-${userId}`,
        name: `user ${userId}`,
        characterTextures: [],
        position: { x, y: 0, direction: PositionMessage_Direction.RIGHT, moving: false },
        availabilityStatus: AvailabilityStatus.ONLINE,
        visitCardUrl: "",
        variables: {},
    });
}

function moveTo(userId: number, x: number, moving = true): UserMovedMessage {
    return UserMovedMessage.fromPartial({
        userId,
        position: { x, y: 0, direction: PositionMessage_Direction.RIGHT, moving },
    });
}

const VIEWER = 100;

/** A zone holding users 1 to 5, at x = 100, 200, ... 500 from the viewer, and a viewer that starts watching it. */
function scene(limits: ViewerBudgetLimits | undefined) {
    const zone = new Zone(new SocketManager(undefined, limits), 0, 0);
    for (let userId = 1; userId <= 5; userId++) {
        zone.handleUserJoinedZone(joinAt(userId, userId * 100));
    }
    const viewer = viewerSocket(VIEWER);
    zone.startListening(viewer.socket);
    return { zone, viewer };
}

describe("the per-viewer budget between a zone and a socket", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const tight = { fullRatePeers: 2, maxPeers: 3, staggerTicks: false };
    // The same scene without the deadband and the cooldown: what a selection does when it is allowed to act at once.
    const plain = { ...tight, exitRatio: 1, cooldownMs: 0 };

    it("tells a viewer of no more users than the ceiling", () => {
        const { viewer } = scene(tight);

        expect(viewer.received()).toEqual([
            { type: "join", userId: 1, x: 100 },
            { type: "join", userId: 2, x: 200 },
            { type: "join", userId: 3, x: 300 },
        ]);
    });

    it("sends each move of the nearest users at once, and only the last position of the others once a second", () => {
        const { zone, viewer } = scene(tight);
        viewer.received();

        zone.handleUserMoved(moveTo(1, 110));
        zone.handleUserMoved(moveTo(3, 310));
        zone.handleUserMoved(moveTo(3, 320));
        zone.handleUserMoved(moveTo(4, 410));
        expect(viewer.received()).toEqual([{ type: "move", userId: 1, x: 110, moving: true }]);

        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);
        // User 4 is not in the scene, so the viewer hears nothing of it.
        expect(viewer.received()).toEqual([{ type: "move", userId: 3, x: 320, moving: true }]);

        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);
        expect(viewer.received()).toEqual([]);
    });

    it("never holds back a stop", () => {
        const { zone, viewer } = scene(tight);
        viewer.received();

        zone.handleUserMoved(moveTo(3, 310));
        zone.handleUserMoved(moveTo(3, 315, false));

        expect(viewer.received()).toEqual([{ type: "move", userId: 3, x: 315, moving: false }]);
        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);
        expect(viewer.received()).toEqual([]);
    });

    it("swaps a user that came closer into the scene: a leave for the farthest, a join with the current position", () => {
        // With the default ratio, cooldown and seat margin: user 5 is the nearest, so it takes the seat of user 3, which is
        // beyond the enter rank. A member leaves only after its cooldown: the swap is at the first flush after it.
        const { zone, viewer } = scene(tight);
        viewer.received();

        zone.handleUserMoved(moveTo(5, 50));
        zone.handleUserMoved(moveTo(3, 330));
        expect(viewer.received()).toEqual([]);

        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);
        expect(viewer.received().filter(({ type }) => type !== "move")).toEqual([]);

        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);
        expect(viewer.received().filter(({ type }) => type !== "move")).toEqual([
            { type: "leave", userId: 3 },
            { type: "join", userId: 5, x: 50 },
        ]);

        // User 5 then walks to the viewer and becomes the nearest by more than the width of the deadband: it takes the full
        // rate of user 2, which is now the third nearest and moves once a second.
        zone.handleUserMoved(moveTo(5, 10));
        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);
        viewer.received();
        zone.handleUserMoved(moveTo(2, 210));
        zone.handleUserMoved(moveTo(5, 40));
        expect(viewer.received()).toEqual([{ type: "move", userId: 5, x: 40, moving: true }]);
    });

    it("lets the client draw a user that joins at 1 Hz without a stop from its first move on (800 ms still before)", () => {
        // The positions are set for a seat margin of 32 px: user 5 at 250 is 50 px nearer than the farthest of the three
        // seated users, so it comes in at a margin of 32 and would not at the default of 64.
        const { zone, viewer } = scene({ ...plain, seatMarginPx: 32 });
        viewer.received();
        const intervals = new RemoteSampleIntervals();
        // As GameScene does: a join only places the user; each move is a sample, drawn over the interval observed.
        const draws: { tick: number; duration: number }[] = [];
        let joinedAt: number | undefined;
        const deliver = () => {
            const tick = Date.now();
            for (const message of viewer.received()) {
                if (message.userId !== 5) {
                    continue;
                }
                if (message.type === "join") {
                    joinedAt = tick;
                } else if (message.type === "move" && message.x !== undefined) {
                    const { duration } = intervals.observe(5, tick, {
                        x: message.x,
                        y: 0,
                        moving: message.moving === true,
                    });
                    draws.push({ tick, duration });
                }
            }
        };

        // User 5 walks on the spot, 5 positions a second, close enough to come into the scene but not to full rate.
        for (let step = 0; step < 30; step++) {
            zone.handleUserMoved(moveTo(5, step % 2 === 0 ? 250 : 254));
            vi.advanceTimersByTime(200);
            deliver();
        }

        expect(joinedAt).toBeDefined();
        const movesAfterJoin = draws.filter(({ tick }) => joinedAt !== undefined && tick > joinedAt);
        const gaps = movesAfterJoin.slice(1).map(({ tick }, index) => tick - movesAfterJoin[index].tick);
        expect(gaps.length).toBeGreaterThanOrEqual(3);
        expect(gaps.every((gap) => gap === CONFLATED_INTERVAL_MS)).toBe(true);
        const stillMs = movesAfterJoin
            .slice(1)
            .reduce(
                (still, { tick }, index) =>
                    still + Math.max(0, tick - movesAfterJoin[index].tick - movesAfterJoin[index].duration),
                0,
            );
        expect(stillMs).toBe(0);
    });

    it("ranks users from where the viewer stands once it moved, and from its viewport centre before", () => {
        const manager = new SocketManager(undefined, plain);
        const zone = new Zone(manager, 0, 0);
        for (let userId = 1; userId <= 5; userId++) {
            zone.handleUserJoinedZone(joinAt(userId, userId * 100));
        }
        const viewer = viewerSocket(VIEWER);
        zone.startListening(viewer.socket);
        viewer.received();
        Reflect.set(viewer.socket.getUserData(), "backConnection", { write: vi.fn() });

        manager.handleUserMovesMessage(viewer.socket, {
            position: { x: 500, y: 0, direction: PositionMessage_Direction.RIGHT, moving: false },
            viewport: { left: -1000, top: -1000, right: 1000, bottom: 1000 },
        });
        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);

        // Leaves first, so the viewer never knows more users than the ceiling; then the joins, in no particular order.
        const received = viewer.received();
        expect(received.slice(0, 2)).toEqual([
            { type: "leave", userId: 1 },
            { type: "leave", userId: 2 },
        ]);
        expect(received.slice(2)).toHaveLength(2);
        expect(received.slice(2)).toEqual(
            expect.arrayContaining([
                { type: "join", userId: 5, x: 500 },
                { type: "join", userId: 4, x: 400 },
            ]),
        );
    });

    it("sends the leave of a user in the scene at once, and none for a user the viewer never heard of", () => {
        const { zone, viewer } = scene(tight);
        viewer.received();

        zone.handleUserLeftZone({ userId: 4, toZone: undefined });
        zone.handleUserLeftZone({ userId: 1, toZone: undefined });

        expect(viewer.received()).toEqual([{ type: "leave", userId: 1 }]);
        // The seat it freed goes to the nearest user left out, at the next tick.
        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);
        expect(viewer.received()).toEqual([{ type: "join", userId: 5, x: 500 }]);
    });

    it("stops its tick once the viewer watches no more users than the full-rate set", () => {
        const { zone, viewer } = scene(tight);
        for (const userId of [3, 4, 5]) {
            zone.handleUserLeftZone({ userId, toZone: undefined });
        }
        viewer.received();
        const timersWhileTicking = vi.getTimerCount();

        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);

        expect(vi.getTimerCount()).toBe(timersWhileTicking - 1);
    });

    it("stops its tick once the socket closes", () => {
        const { viewer } = scene(tight);
        viewer.received();
        viewer.socket.end();
        const timersOfAClosedSocket = vi.getTimerCount();

        vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);

        expect(timersOfAClosedSocket).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("sends exactly what it sends without a budget while the viewer watches fewer users than the full-rate set", () => {
        const run = (limits: ViewerBudgetLimits | undefined) => {
            const { zone, viewer } = scene(limits);
            zone.handleUserMoved(moveTo(3, 310));
            zone.handleUserMoved(moveTo(5, 510, false));
            zone.handleUserLeftZone({ userId: 2, toZone: undefined });
            zone.handleUserJoinedZone(joinAt(6, 600));
            vi.advanceTimersByTime(CONFLATED_INTERVAL_MS);
            viewer.socket.flushBatch();
            return viewer.frames.map((frame) => Buffer.from(frame).toString("hex"));
        };

        const withoutBudget = run(undefined);
        const withBudget = run({ fullRatePeers: 150, maxPeers: 400 });

        expect(withoutBudget.length).toBeGreaterThan(0);
        expect(withBudget).toEqual(withoutBudget);
    });
});
