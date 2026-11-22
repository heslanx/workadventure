import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { Zone, type UserDescriptor } from "../../src/pusher/models/Zone";
import {
    RERANK_INTERVAL_MS,
    RETAIN_COOLDOWN_MS,
    RETAIN_EXIT_RATIO,
    ViewerBudget,
    type ViewerBudgetLimits,
} from "../../src/pusher/models/ViewerBudget";

/*
 * Root cause 2 of DL-06 (owner's mandate, 2026-11-21): a user that hovers around the edge of the scene was dropped and
 * taken in again on every selection, and the selection ran for each move. The budget now has
 *
 *   a. a deadband: a user enters the scene at a rank of K or nearer, and is dropped only beyond K x 1.2 (80 and 96 of the
 *      owner's example; 400 and 480 for the 150 / 400 of the pusher);
 *   b. a cooldown: a user is not dropped before RETAIN_COOLDOWN_MS (1750, in the owner's 1500 to 2000) after it joined, and
 *      is not taken in again before it after it left;
 *   c. a cadence of its own: the rank runs every RERANK_INTERVAL_MS (500, in the owner's 250 to 500), not on each move;
 *   d. nothing per move that grows with the crowd: a walking move of a user that is not at full rate for the viewer is not
 *      given to the viewer's budget at all.
 *
 * Every test is in virtual time (fake timers) and counts joins, leaves, rank passes and calls, so none depends on the
 * speed of the host. How each was seen to fail is written above it.
 */

const VIEWER = 100;
/** Ten seats, five at full rate; the exit ranks are 12 and 6 at the default ratio. */
const LIMITS: ViewerBudgetLimits = { fullRatePeers: 5, maxPeers: 10, seatMarginPx: 0, staggerTicks: false };

interface Event {
    type: "join" | "leave" | "move";
    userId: number;
    at: number;
    x?: number;
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
    /** What the socket was sent since the last call, in order, stamped with the time of the call. */
    const received = (): Event[] => {
        socket.flushBatch();
        const events: Event[] = [];
        for (const frame of frames.splice(0)) {
            const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
            if (message?.$case !== "batchMessage") {
                continue;
            }
            for (const { message: sub } of message.batchMessage.payload) {
                if (sub?.$case === "userJoinedMessage") {
                    const { userId: id, position } = sub.userJoinedMessage;
                    events.push({ type: "join", userId: id, at: Date.now(), x: position?.x });
                } else if (sub?.$case === "userMovedMessage") {
                    const { userId: id, position } = sub.userMovedMessage;
                    events.push({ type: "move", userId: id, at: Date.now(), x: position?.x });
                } else if (sub?.$case === "userLeftMessage") {
                    events.push({ type: "leave", userId: sub.userLeftMessage.userId, at: Date.now() });
                }
            }
        }
        return events;
    };
    return { socket, received };
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

/** A zone with a user at each given x (user ids 1, 2, ...), and a viewer at the origin that starts watching it. */
function sceneOf(xs: number[], limits: ViewerBudgetLimits) {
    const zone = new Zone(new SocketManager(undefined, limits), 0, 0);
    xs.forEach((x, index) => zone.handleUserJoinedZone(joinAt(index + 1, x)));
    const viewer = viewerSocket(VIEWER);
    zone.startListening(viewer.socket);
    return { zone, viewer };
}

/** x = 10, 20 ... 90: nine users at ranks 1 to 9 for a viewer at the origin. */
const NINE_NEAR = Array.from({ length: 9 }, (_, index) => (index + 1) * 10);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("the bounds of the selection are the owner's", () => {
    it("has an exit rank of 1.2 times the enter rank (80 and 96, 150 and 180, 400 and 480), a cooldown of 1500 to 2000 ms and a rank every 250 to 500 ms", () => {
        expect(RETAIN_EXIT_RATIO).toBe(1.2);
        expect(Math.ceil(80 * RETAIN_EXIT_RATIO - 1e-9)).toBe(96);
        expect(RETAIN_COOLDOWN_MS).toBeGreaterThanOrEqual(1500);
        expect(RETAIN_COOLDOWN_MS).toBeLessThanOrEqual(2000);
        expect(RERANK_INTERVAL_MS).toBeGreaterThanOrEqual(250);
        expect(RERANK_INTERVAL_MS).toBeLessThanOrEqual(500);
    });
});

describe("the deadband between entering the scene and being dropped from it", () => {
    /**
     * The ninth, tenth and eleventh nearest users: B stands at 100 and H swaps ranks with it every second, from 95 (one
     * rank nearer) to 105 (one rank farther). A bare selection puts the user at rank 11 out and the one at rank 10 in,
     * once a second, for ever. Both are inside the exit rank 12, so with the deadband nobody moves. The cooldown is turned
     * off, the seat margin is 0: the deadband alone.
     *
     * Seen failing: with RETAIN_EXIT_RATIO set to 1 (no deadband) the first test below fails with 40 joins and leaves where it expects none
     * (20 s, one trade a second), and the exit-rank test with 6 leaves where it expects 2 events.
     */
    function hoverAtTheEdge(limits: ViewerBudgetLimits, seconds: number): Event[] {
        const { zone, viewer } = sceneOf([...NINE_NEAR, 100, 105], limits);
        viewer.received();
        const events: Event[] = [];
        // Users 10 (B) and 11 (H): the first ten by arrival fill the scene, H waits outside.
        for (let second = 0; second < seconds; second++) {
            const hoverX = second % 2 === 0 ? 95 : 105;
            const otherX = second % 2 === 0 ? 100 : 100;
            zone.handleUserMoved(moveTo(11, hoverX));
            zone.handleUserMoved(moveTo(10, otherX));
            vi.advanceTimersByTime(1000);
            events.push(...viewer.received());
        }
        return events;
    }

    it("sends no join and no leave for two users that trade the ranks 10 and 11 for 20 seconds", () => {
        const events = hoverAtTheEdge({ ...LIMITS, cooldownMs: 0, admitByDistance: false }, 20);

        expect(events.filter(({ type }) => type !== "move")).toEqual([]);
    });

    it("sends a join and a leave for each trade without the deadband (exitRatio 1): the instrument sees what the deadband removes", () => {
        const events = hoverAtTheEdge({ ...LIMITS, cooldownMs: 0, exitRatio: 1, admitByDistance: false }, 20);

        expect(events.filter(({ type }) => type !== "move").length).toBeGreaterThanOrEqual(20);
    });

    it("keeps the users at the ranks 11 and 12 and drops the one at rank 13, the first beyond the exit rank (96 of 80, in 10 seats: 12)", () => {
        // Ten users at 10 ... 100 fill the scene. Three users appear at 85, 87 and 95: the old ones are now the ranks 1 to 8,
        // then 11 (x = 90) and 13 (x = 100); the newcomer at 95 is rank 12.
        const { zone, viewer } = sceneOf([...NINE_NEAR, 100], { ...LIMITS, cooldownMs: 0, admitByDistance: false });
        viewer.received();
        for (const [index, x] of [85, 87, 95].entries()) {
            zone.handleUserJoinedZone(joinAt(20 + index, x));
        }
        vi.advanceTimersByTime(2000);
        const events = viewer.received().filter(({ type }) => type !== "move");

        // User 10 (x = 100) is rank 13: out. User 9 (x = 90) is rank 11 and stays. The seat it left goes to the nearest of the
        // newcomers within the enter rank (x = 85, rank 9); the one at rank 10 is within the enter rank but not by the
        // width of the deadband, so it does not take the seat of a member at rank 11: nobody is dropped for it.
        expect(events.map(({ type, userId }) => `${type} ${userId}`)).toEqual(["leave 10", "join 20"]);
    });

    it("drops all three at ranks 11, 12 and 13 when there is no deadband", () => {
        const { zone, viewer } = sceneOf([...NINE_NEAR, 100], {
            ...LIMITS,
            cooldownMs: 0,
            exitRatio: 1,
            admitByDistance: false,
        });
        viewer.received();
        for (const [index, x] of [1, 2, 3].entries()) {
            zone.handleUserJoinedZone(joinAt(20 + index, x));
        }
        vi.advanceTimersByTime(2000);
        const events = viewer.received().filter(({ type }) => type !== "move");

        expect(events.map(({ type, userId }) => `${type} ${userId}`).sort()).toEqual([
            "join 20",
            "join 21",
            "join 22",
            "leave 10",
            "leave 8",
            "leave 9",
        ]);
    });
});

describe("the cooldown of a user in a state", () => {
    /**
     * A user Z that goes in and out of the nearest ten every second, the others where they are. Without a cooldown the
     * scene changes at the first selection that sees Z move (one to two seconds); with it, a state lasts the cooldown.
     * The deadband is off (exitRatio 1) and the seat margin is 0, so that the cooldown is alone.
     *
     * With the default cooldown Z changes state every 3000 ms (join, leave, join ... at 0, 3000, 6000 ms: the first flush
     * after the 1750 ms), 10 times in 30 s. Without one, every second: 30 times, and the shortest stay is 1000 ms.
     * Seen failing: with RETAIN_COOLDOWN_MS set to 0 the first test below fails (`expected 1000 to be greater than or
     * equal to 1750`, and the second, which compares with the default, `expected 30 to be greater than 30`).
     */
    function zWalksInAndOut(cooldownMs: number | undefined, seconds: number): Event[] {
        // Users 1 to 9 are near, user 10 stands at 200, and Z (user 11) at 500: the ten first by arrival fill the scene
        // and Z waits outside.
        const { zone, viewer } = sceneOf([...NINE_NEAR, 200, 500], {
            ...LIMITS,
            exitRatio: 1,
            cooldownMs,
            admitByDistance: false,
        });
        viewer.received();
        const events: Event[] = [];
        for (let second = 0; second < seconds; second++) {
            zone.handleUserMoved(moveTo(11, second % 2 === 0 ? 5 : 500));
            vi.advanceTimersByTime(1000);
            events.push(...viewer.received().filter(({ userId, type }) => userId === 11 && type !== "move"));
        }
        return events;
    }

    function shortestStay(events: Event[]): number {
        const gaps = events.slice(1).map((event, index) => event.at - events[index].at);
        return Math.min(...gaps);
    }

    it("keeps a user in a state for at least 1750 ms before the selection changes it", () => {
        const events = zWalksInAndOut(undefined, 30);

        expect(events.length).toBeGreaterThanOrEqual(3);
        // The literal, not the constant: a constant changed to 0 would make this pass on its own.
        expect(shortestStay(events)).toBeGreaterThanOrEqual(1750);
    });

    it("lets the state change on the next flush without a cooldown, so that the test above can fail", () => {
        const events = zWalksInAndOut(0, 30);

        expect(events.length).toBeGreaterThan(zWalksInAndOut(undefined, 30).length);
        expect(shortestStay(events)).toBeLessThan(RETAIN_COOLDOWN_MS);
    });
});

describe("a rank of its own, apart from the moves", () => {
    /**
     * Counts the selections a viewer runs: `ViewerBudget.tick`, the only place a rank is made. It must follow the clock,
     * every 500 ms, and not the moves.
     *
     * Seen failing: with RERANK_INTERVAL_MS set to 100 the count is 100 where the test expects 20 (`expected 100 to be
     * 20`). A rank per move, as the old budget did, would give the 200 walkers 1000 ranks a second: the count does not
     * follow the moves, which is the second assertion (1 and 200 walkers, the same 20) and the last test (600 moves at
     * one instant, no rank).
     */
    function ranksIn(seconds: number, walkers: number, limits: ViewerBudgetLimits = LIMITS): number {
        const crowd = Array.from({ length: 30 }, (_, index) => 10 + index * 10);
        const { zone, viewer } = sceneOf(crowd, { ...limits, admitByDistance: false });
        viewer.received();
        const tick = vi.spyOn(ViewerBudget.prototype, "tick");
        for (let slice = 0; slice < seconds * 5; slice++) {
            for (let walker = 0; walker < walkers; walker++) {
                const userId = 1 + (walker % crowd.length);
                zone.handleUserMoved(moveTo(userId, crowd[userId - 1] + (slice % 7)));
            }
            vi.advanceTimersByTime(200);
        }
        const count = tick.mock.calls.length;
        tick.mockRestore();
        // The timer of this viewer would be counted in the next run of the test.
        vi.clearAllTimers();
        return count;
    }

    it("ranks every 500 ms whether 1 or 200 users walk at 5 Hz: 20 ranks in 10 seconds", () => {
        const withOne = ranksIn(10, 1);
        const withMany = ranksIn(10, 200);

        expect(withOne).toBe(20);
        expect(withMany).toBe(20);
    });

    it("ranks at the interval it is given, not at the rate of the moves: 250 ms is 40 ranks in 10 seconds", () => {
        expect(ranksIn(10, 30, { ...LIMITS, rerankIntervalMs: 250 })).toBe(40);
    });

    it("does not run a rank for a single walking move, however many arrive at one instant", () => {
        const crowd = Array.from({ length: 30 }, (_, index) => 10 + index * 10);
        const { zone, viewer } = sceneOf(crowd, { ...LIMITS, admitByDistance: false });
        viewer.received();
        const tick = vi.spyOn(ViewerBudget.prototype, "tick");

        for (let userId = 1; userId <= 30; userId++) {
            for (let step = 1; step <= 20; step++) {
                zone.handleUserMoved(moveTo(userId, crowd[userId - 1] + step));
            }
        }

        expect(tick).not.toHaveBeenCalled();
    });
});

describe("what a walking move costs the budget of a viewer that is not at full rate for the user", () => {
    /**
     * A move that is not for a full-rate user is not handed to the viewer's budget at all (the zone reaches the full-rate
     * watchers of the user and the budgets that still have a seat), so the count of `ViewerBudget.move` calls for a
     * crowd of 400 walking is the same as for a crowd of 40: 5 for the full-rate users, 0 for the others.
     *
     * Seen failing: with the zone ignoring the bulk callback, so that it gives every move to the budget of every listener
     * as before the inverted index, the count for 40 users was 40 (`expected 40 to be +0`).
     */
    function budgetMoves(crowdSize: number): { calls: number; sent: number } {
        const crowd = Array.from({ length: crowdSize }, (_, index) => 10 + index * 10);
        const { zone, viewer } = sceneOf(crowd, { ...LIMITS, admitByDistance: false });
        viewer.received();
        const move = vi.spyOn(ViewerBudget.prototype, "move");
        for (let userId = 1; userId <= crowdSize; userId++) {
            zone.handleUserMoved(moveTo(userId, crowd[userId - 1] + 3));
        }
        const sent = viewer.received().filter(({ type }) => type === "move").length;
        const calls = move.mock.calls.length;
        move.mockRestore();
        return { calls, sent };
    }

    it("gives the budget no move of the users outside the full-rate set, whatever the size of the crowd", () => {
        const small = budgetMoves(40);
        const large = budgetMoves(400);

        // Five users are at full rate for the viewer: they are sent at once, straight from the user, and the budget of a
        // viewer whose scene is full is not asked about the other 35 or 395.
        expect(small.sent).toBe(5);
        expect(large.sent).toBe(5);
        expect(small.calls).toBe(0);
        expect(large.calls).toBe(0);
    });

    it("reads the full-rate set of a user from a Set of sockets: the user is the index, not a scan of the budgets", () => {
        const { zone } = sceneOf([...NINE_NEAR, 100], { ...LIMITS, admitByDistance: false });
        const users = (zone as unknown as { users: Map<number, UserDescriptor> }).users;

        expect(users.get(1)?.fullRateWatchers).toBeInstanceOf(Set);
        expect(users.get(1)?.fullRateWatchers?.size).toBe(1);
        // The sixth nearest is in the scene and not at full rate.
        expect(users.get(6)?.fullRateWatchers?.size ?? 0).toBe(0);
        expect(users.get(6)?.sceneWatchers?.size).toBe(1);
    });
});

/*
 * A user that comes nearer than the whole scene must get a seat, and the full rate of the nearest. Seen failing before the
 * selection let a waiting user claim a place (all with the default ratio, cooldown and seat margin, which the tests that
 * swap a nearer user in used to turn off):
 *  - scene, 10 seats: the newcomer at rank 1 pushed one member to rank 11, inside the exit rank 12, so nobody was dropped
 *    and the newcomer was never told of (`expected undefined to be defined`, no join in 4 s);
 *  - scene, 150 / 400 over 1000 static users: the same, no event in 20 s of virtual time (MEASURED by the reviewer, members 400);
 *  - full rate, 150 / 400: a member that walked from rank 300 to rank 1 was sent 10 of 50 moves in 10 s (1 Hz): the 150
 *    slots were held by the users at ranks 151 to 180.
 * The tests also fail when the claim is allowed at any rank (no claim rank): the hover tests above then see a join and a
 * leave for the users at ranks 10 and 11.
 */
describe("a user that comes nearer than the whole scene", () => {
    const NEWCOMER = 5000;

    function staticCrowd(size: number): number[] {
        return Array.from({ length: size }, (_, index) => 100 + index * 2);
    }

    /** Fills the scene of a viewer at the origin, then puts a newcomer 5 px from it and watches 4 s. */
    function newcomerAtTheViewer(limits: ViewerBudgetLimits, crowd: number, settleMs: number) {
        const { zone, viewer } = sceneOf(staticCrowd(crowd), { ...limits, admitByDistance: true, staggerTicks: false });
        vi.advanceTimersByTime(settleMs);
        viewer.received();
        zone.handleUserJoinedZone(joinAt(NEWCOMER, 5));
        const startedAt = Date.now();
        const events: Event[] = [];
        for (let elapsed = 0; elapsed < 4000; elapsed += 100) {
            vi.advanceTimersByTime(100);
            events.push(...viewer.received());
        }
        return { events, startedAt };
    }

    // The viewer is user 100, which the zone never tells of itself: the 400 nearest of the others are users 1 to 401.
    for (const [name, limits, crowd, farthest] of [
        ["10 seats over 20 static users", { fullRatePeers: 5, maxPeers: 10 }, 20, 10],
        ["150 / 400 over 1000 static users", { fullRatePeers: 150, maxPeers: 400 }, 1000, 401],
    ] as const) {
        for (const settleMs of [100, 3000]) {
            it(`tells the viewer of a newcomer nearer than every member within the cooldown and a rank interval, and drops one member (${name}, ${settleMs} ms after the scene filled)`, () => {
                const { events, startedAt } = newcomerAtTheViewer(limits, crowd, settleMs);

                const join = events.find(({ type, userId }) => type === "join" && userId === NEWCOMER);
                expect(join).toBeDefined();
                expect((join?.at ?? Infinity) - startedAt).toBeLessThanOrEqual(RETAIN_COOLDOWN_MS + RERANK_INTERVAL_MS);
                // The farthest member gave up its seat, and nobody else did.
                expect(events.filter(({ type }) => type === "leave").map(({ userId }) => userId)).toEqual([farthest]);
                expect(events.filter(({ type }) => type === "join").map(({ userId }) => userId)).toEqual([NEWCOMER]);
            });
        }
    }

    it("gives the full rate to a member that walks from rank 300 to rank 1, within the cooldown and a rank interval, when the 150 slots are held by users that are farther", () => {
        const { zone, viewer } = sceneOf(staticCrowd(1000), {
            fullRatePeers: 150,
            maxPeers: 400,
            admitByDistance: true,
            staggerTicks: false,
        });
        vi.advanceTimersByTime(5000);
        viewer.received();

        // User 300 stands at x = 698, rank 300, a member heard once a second. It walks to the viewer and then steps beside it.
        const walker = 300;
        const sentAt: number[] = [];
        const receivedAt: number[] = [];
        let positionX = 698;
        const arrivedAt = Date.now() + 200;
        for (let step = 0; step < 55; step++) {
            positionX = step === 0 ? 3 : 3 + (step % 2);
            zone.handleUserMoved(moveTo(walker, positionX));
            sentAt.push(Date.now());
            vi.advanceTimersByTime(200);
            receivedAt.push(
                ...viewer
                    .received()
                    .filter(({ type, userId }) => type === "move" && userId === walker)
                    .map(({ at }) => at),
            );
        }

        // After the cooldown and one rank interval it is heard at the rate it walks: 5 a second.
        const settledFrom = arrivedAt + RETAIN_COOLDOWN_MS + RERANK_INTERVAL_MS;
        const sent = sentAt.filter((at) => at >= settledFrom).length;
        const heard = receivedAt.filter((at) => at >= settledFrom + 200).length;
        expect(sent).toBeGreaterThanOrEqual(40);
        // Every move but the last one or two that the batch had not flushed when the window ended.
        expect(heard).toBeGreaterThanOrEqual(sent - 3);
    });
});
