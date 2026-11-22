import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AvailabilityStatus,
    PositionMessage_Direction,
    PusherToFrontWebSocketMessage,
    UserJoinedZoneMessage,
    UserMovedMessage,
    type SubMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { ViewerBudget, type ViewerBudgetLimits } from "../../src/pusher/models/ViewerBudget";
import { UserDescriptor, type ZoneEventListener } from "../../src/pusher/models/Zone";
import { PositionDispatcher } from "../../src/pusher/models/PositionDispatcher";
import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";
import { SocketManager } from "../../src/pusher/services/SocketManager";
import { SimulatedBack } from "./fanout/SimulatedBack";
import { ReferenceViewerBudget } from "./fanout/ReferenceViewerBudget";

/*
 * The ViewerBudget was rewritten to cost one lookup per zone event instead of four (docs/PERFORMANCE.md, action 22).
 * A rewrite that is a pure cost cut must send the same thing, so this test drives the previous implementation
 * (ReferenceViewerBudget, the class as it was at 7a37a5178) and the current one with the same random events and
 * demands the same sub-messages in the same order after every single event.
 *
 * How this test was seen failing: with the tick of ViewerBudget emitting its pending moves before its leaves (swapping
 * two blocks of ViewerBudget.tick), and with join() forgetting `if (!peer.inScene)` (a user entered twice then counted
 * twice, so the scene closed to newcomers early), the comparison fails at the first diverging event.
 */

function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function descriptor(userId: number, x: number, y: number): UserDescriptor {
    return UserDescriptor.createFromUserJoinedZoneMessage(
        UserJoinedZoneMessage.fromPartial({
            userId,
            userUuid: `uuid-${userId}`,
            name: `user ${userId}`,
            characterTextures: [],
            position: { x, y, direction: PositionMessage_Direction.RIGHT, moving: false },
            availabilityStatus: AvailabilityStatus.ONLINE,
            visitCardUrl: "",
            variables: {},
        }),
    );
}

function step(user: UserDescriptor, x: number, y: number, moving: boolean): void {
    user.update(
        UserMovedMessage.fromPartial({
            userId: user.userId,
            position: { x, y, direction: PositionMessage_Direction.RIGHT, moving },
        }),
    );
}

/** A viewer that records, in order, what the budget handed to emitInBatch. */
function recordingViewer() {
    const log: string[] = [];
    const viewer = {
        emitInBatch: (subMessage: SubMessage) => {
            const message = subMessage.message;
            if (message?.$case === "userJoinedMessage") {
                const { userId, position } = message.userJoinedMessage;
                log.push(`join ${userId} ${position?.x},${position?.y}`);
            } else if (message?.$case === "userMovedMessage") {
                const { userId, position } = message.userMovedMessage;
                log.push(`move ${userId} ${position?.x},${position?.y} ${position?.moving}`);
            } else if (message?.$case === "userLeftMessage") {
                log.push(`leave ${message.userLeftMessage.userId}`);
            }
        },
        isDisconnecting: () => false,
        getUserData: () => ({ viewport: { left: 0, right: 960, top: 0, bottom: 540 } }),
    };
    return { viewer: viewer as unknown as PusherWebSocket, log };
}

/**
 * What a tick sent, in a canonical order. A tick sends leaves, then joins, then the last position of the users that
 * moved; the reference orders the leaves by when the users joined the scene and the moves by when each started to
 * wait, the current version orders both by how it tracks the users. They are about different users, which a client
 * applies all the same, so the content of a tick is compared as a multiset. Every other event is compared in order.
 */
function sortedForTick(log: string[], isTick: boolean): string[] {
    return isTick ? [...log].sort() : log;
}

/**
 * The reference is the budget before the deadband, the cooldown and the rank timer of 500 ms: it ranks once a second
 * and keeps nobody for any time. The current class is compared with it with those three turned off (a ratio of 1, no
 * cooldown, a rank every 1000 ms from the first move), which is the same policy. What they add is tested in
 * ViewerBudget.test.ts and JoinLeaveStorms.test.ts, not here.
 */
const SAME_POLICY: Partial<ViewerBudgetLimits> = {
    exitRatio: 1,
    cooldownMs: 0,
    rerankIntervalMs: 1000,
    staggerTicks: false,
};

function drive(limits: ViewerBudgetLimits, seed: number, events: number): { compared: number; ticks: number } {
    const random = mulberry32(seed);
    const reference = recordingViewer();
    const current = recordingViewer();
    const referenceBudget = new ReferenceViewerBudget(reference.viewer, limits);
    const currentBudget = new ViewerBudget(current.viewer, { ...limits, ...SAME_POLICY });

    const USERS = 80;
    const users = new Map<number, UserDescriptor>();
    let compared = 0;
    let ticks = 0;
    const assertSame = (what: string, isTick: boolean) => {
        expect(sortedForTick(current.log, isTick), what).toEqual(sortedForTick(reference.log, isTick));
        compared += current.log.length;
        current.log.length = 0;
        reference.log.length = 0;
    };

    for (let event = 0; event < events; event++) {
        const userId = 1 + Math.floor(random() * USERS);
        const roll = random();
        const known = users.get(userId);
        let what: string;
        if (known === undefined || roll < 0.03) {
            // A user enters, or enters again from another zone with a new descriptor: the first is a join, the second
            // is what a zone says when a user crosses into it.
            const fresh = descriptor(userId, Math.floor(random() * 400), Math.floor(random() * 400));
            users.set(userId, fresh);
            what = `enter ${userId}`;
            referenceBudget.enter(fresh);
            currentBudget.enter(fresh);
        } else if (roll < 0.06) {
            users.delete(userId);
            what = `leave ${userId}`;
            referenceBudget.leave(userId);
            currentBudget.leave(userId);
        } else if (roll < 0.09) {
            const x = Math.floor(random() * 400);
            const y = Math.floor(random() * 400);
            what = `origin ${x},${y}`;
            referenceBudget.setOrigin(x, y);
            currentBudget.setOrigin(x, y);
        } else if (roll < 0.12) {
            // The same user, seen through the descriptor of another zone: a move that carries a new descriptor.
            const crossed = descriptor(userId, known.getPosition().x, known.getPosition().y);
            users.set(userId, crossed);
            what = `cross ${userId}`;
            referenceBudget.move(crossed);
            currentBudget.move(crossed);
        } else if (roll < 0.9) {
            step(known, Math.floor(random() * 400), Math.floor(random() * 400), random() > 0.15);
            what = `move ${userId}`;
            referenceBudget.move(known);
            currentBudget.move(known);
        } else {
            what = "tick";
            ticks++;
            referenceBudget.tick();
            currentBudget.tick();
        }
        assertSame(`event ${event}: ${what}`, what === "tick");
    }
    referenceBudget.stop();
    currentBudget.stop();
    return { compared, ticks };
}

describe("ViewerBudget against the straightforward version it replaces", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        { fullRatePeers: 10, maxPeers: 25 },
        { fullRatePeers: 3, maxPeers: 5 },
        { fullRatePeers: 30, maxPeers: 30 },
        { fullRatePeers: 150, maxPeers: 400 },
    ])(
        "sends the same sub-messages in the same order after every event: %j",
        (limits) => {
            let totalCompared = 0;
            let totalTicks = 0;
            for (const seed of [1, 2, 3, 4, 5]) {
                const { compared, ticks } = drive(limits, seed, 4000);
                totalCompared += compared;
                totalTicks += ticks;
            }
            // The comparison is only worth something if the scenario sent a lot and the tick ran.
            expect(totalCompared).toBeGreaterThan(2000);
            expect(totalTicks).toBeGreaterThan(1000);
        },
        60_000,
    );
});

/*
 * The same comparison through the whole path: a SimulatedBack drives two PositionDispatchers with the same zone events
 * (users that walk, cross zone borders, stop and leave, and sockets that watch the zones around them). One dispatcher
 * hands its events to a SocketManager with the budget on, which reaches the sockets that hear every move through the
 * users (onUserMovesBulk). The other hands them, one socket at a time, to a ReferenceViewerBudget per socket.
 * After every 100 ms step, each socket of one must have been sent what the same socket of the other was sent.
 */

/** What the reference version sends: each event of the zone through the ReferenceViewerBudget of the socket. */
class ReferenceListener implements ZoneEventListener {
    private readonly budgets = new WeakMap<PusherWebSocket, ReferenceViewerBudget>();
    public readonly all: ReferenceViewerBudget[] = [];

    public constructor(private readonly limits: ViewerBudgetLimits) {}

    private budget(listener: PusherWebSocket): ReferenceViewerBudget {
        let budget = this.budgets.get(listener);
        if (budget === undefined) {
            budget = new ReferenceViewerBudget(listener, this.limits);
            this.budgets.set(listener, budget);
            this.all.push(budget);
        }
        return budget;
    }

    onUserEnters(user: UserDescriptor, listener: PusherWebSocket): void {
        this.budget(listener).enter(user);
    }
    onUserMoves(user: UserDescriptor, listener: PusherWebSocket): void {
        this.budget(listener).move(user);
    }
    onUserLeaves(userId: number, listener: PusherWebSocket): void {
        this.budget(listener).leave(userId);
    }
    onGroupEnters(): void {}
    onGroupMoves(): void {}
    onGroupLeaves(): void {}
    onGroupUsersUpdated(): void {}
    onEmote(): void {}
    onError(): void {}
    onPlayerDetailsUpdated(): void {}
}

function userSocket(userId: number) {
    const frames: Uint8Array[] = [];
    const userData = {
        userId,
        userUuid: `uuid-${userId}`,
        tabId: `tab-${userId}`,
        connectionId: `connection-${userId}`,
        listenedZones: new Set<string>(),
        viewport: { left: 0, right: 0, top: 0, bottom: 0 },
    };
    const raw = {
        send: (payload: Uint8Array) => {
            frames.push(payload);
            return 1;
        },
        ping: () => 1,
        end: () => undefined,
        getBufferedAmount: () => 0,
        getUserData: () => userData,
    };
    const socket = new PusherWebSocket(raw as unknown as RawSocket);
    /** What the socket was sent since the last call, one line per sub-message, sorted. */
    const received = (): string[] => {
        socket.flushBatch();
        const lines: string[] = [];
        for (const frame of frames.splice(0)) {
            const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
            if (message?.$case !== "batchMessage") {
                continue;
            }
            for (const { message: sub } of message.batchMessage.payload) {
                if (sub?.$case === "userJoinedMessage") {
                    const { userId: id, position } = sub.userJoinedMessage;
                    lines.push(`join ${id} ${position?.x},${position?.y},${position?.moving}`);
                } else if (sub?.$case === "userMovedMessage") {
                    const { userId: id, position } = sub.userMovedMessage;
                    lines.push(`move ${id} ${position?.x},${position?.y},${position?.moving}`);
                } else if (sub?.$case === "userLeftMessage") {
                    lines.push(`leave ${sub.userLeftMessage.userId}`);
                }
            }
        }
        return lines.sort();
    };
    return { socket, userData, received };
}

function walkCrowd(limits: ViewerBudgetLimits, seed: number, steps: number): { delivered: number; ticksSeen: number } {
    const random = mulberry32(seed);
    const back = new SimulatedBack(320);
    const USERS = 70;
    const AREA = 640; // 2 x 2 zones: users cross borders all the time

    const roomsAndDispatchers = ["current", "reference"].map((name) => {
        const listener: ZoneEventListener =
            name === "current"
                ? new SocketManager(undefined, { ...limits, ...SAME_POLICY })
                : new ReferenceListener(limits);
        const created: { dispatcher?: PositionDispatcher } = {};
        const room = back.roomFor(() => created.dispatcher as PositionDispatcher);
        const dispatcher = new PositionDispatcher(`room-${name}`, 320, 320, listener, room);
        created.dispatcher = dispatcher;
        back.attach(dispatcher);
        const sockets = Array.from({ length: USERS }, (_, index) => userSocket(index + 1));
        return { name, listener, dispatcher, sockets };
    });
    const [current, reference] = roomsAndDispatchers;

    const places = Array.from({ length: USERS }, () => ({
        x: Math.floor(random() * AREA),
        y: Math.floor(random() * AREA),
        walking: random() < 0.5,
    }));
    const present = new Array<boolean>(USERS).fill(true);
    const setViewports = () => {
        for (const side of roomsAndDispatchers) {
            side.sockets.forEach((sock, index) => {
                if (!present[index]) {
                    return;
                }
                const { x, y } = places[index];
                // A 320 x 320 window around the user: one to four zones.
                const viewport = { left: x - 160, right: x + 160, top: y - 160, bottom: y + 160 };
                sock.userData.viewport = viewport;
                side.dispatcher.setViewport(sock.socket, viewport);
            });
        }
    };
    places.forEach((place, index) => back.join(index + 1, place.x, place.y));
    setViewports();

    let delivered = 0;
    let ticksSeen = 0;
    for (let step = 0; step < steps; step++) {
        for (let index = 0; index < USERS; index++) {
            const roll = random();
            const userId = index + 1;
            if (!present[index]) {
                if (roll < 0.05) {
                    present[index] = true;
                    back.join(userId, places[index].x, places[index].y);
                }
                continue;
            }
            if (roll < 0.01) {
                present[index] = false;
                back.leave(userId);
                for (const side of roomsAndDispatchers) {
                    side.dispatcher.removeViewport(side.sockets[index].socket);
                }
                continue;
            }
            const place = places[index];
            if (place.walking) {
                place.x = Math.max(0, Math.min(AREA - 1, place.x + Math.floor(random() * 41) - 20));
                place.y = Math.max(0, Math.min(AREA - 1, place.y + Math.floor(random() * 41) - 20));
                // A walker stops now and then, and starts again.
                const stops = random() < 0.08;
                back.move(userId, place.x, place.y, !stops);
                if (stops) {
                    place.walking = random() < 0.5;
                }
            } else if (random() < 0.03) {
                place.walking = true;
            }
        }
        setViewports();
        vi.advanceTimersByTime(100);
        for (let index = 0; index < USERS; index++) {
            const fromCurrent = current.sockets[index].received();
            const fromReference = reference.sockets[index].received();
            expect(fromCurrent, `step ${step}, socket ${index + 1}`).toEqual(fromReference);
            delivered += fromCurrent.length;
        }
        if (step % 10 === 9) {
            ticksSeen += 1;
        }
    }
    for (const side of roomsAndDispatchers) {
        side.sockets.forEach((sock) => sock.socket.end());
    }
    if (reference.listener instanceof ReferenceListener) {
        reference.listener.all.forEach((budget) => budget.stop());
    }
    return { delivered, ticksSeen };
}

describe("a SocketManager with the budget on against one ReferenceViewerBudget per socket, through zones", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        { fullRatePeers: 4, maxPeers: 9 },
        { fullRatePeers: 12, maxPeers: 30 },
        { fullRatePeers: 70, maxPeers: 70 },
    ])(
        "sends each socket the same joins, moves and leaves, border crossings included: %j",
        (limits) => {
            let delivered = 0;
            for (const seed of [11, 12, 13]) {
                delivered += walkCrowd(limits, seed, 120).delivered;
            }
            // Worth something only if a lot was sent.
            expect(delivered).toBeGreaterThan(5000);
        },
        120_000,
    );
});
