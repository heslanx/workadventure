import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PusherToFrontWebSocketMessage } from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { PositionDispatcher } from "../../src/pusher/models/PositionDispatcher";
import type { ViewerBudgetLimits } from "../../src/pusher/models/ViewerBudget";
import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";
import { SocketManager } from "../../src/pusher/services/SocketManager";
import { runFanOut } from "./fanout/FanOutBench";
import { SimulatedBack } from "./fanout/SimulatedBack";

/*
 * No synthetic join or leave: a socket is told a user joined when the user comes into what the socket watches, and that
 * it left when it goes out, and for nothing else. The viewport flap of the first load runs (a walker's tight and wide
 * rectangles alternating, 270 to 295 joins and as many leaves per walker second, docs/PERFORMANCE.md) was fixed on
 * 2026-11-17 in the client (63986e480, 25685a03f): these tests pin the pusher's side of it, on the real path from the
 * back's zone messages through PositionDispatcher and SocketManager to the frames of a socket.
 *
 * A "real crossing" is counted from the geometry alone, by these tests, and compared with what the socket was sent.
 *
 * How these tests were seen failing: with PositionDispatcher.reconcileZones unsubscribing and subscribing every zone
 * of each new rectangle instead of only the ones that changed, the pan and the zoom tests fail with
 * the whole view told again at every step; with Zone.notifyUserEnter sending onUserEnters for every border crossing (the
 * isListeningZone test removed), the two walker tests fail with a join and a leave per border instead of one of each at
 * the edges of the view. (PositionDispatcher.setViewport's early return for an unchanged rectangle is not what these
 * tests pin: without it reconcileZones finds nothing to change, so it only saves the work.)
 * The promote and demote test failed, at its first assertion that does not hold, with promotion made to emit a join
 * ("expected 20 to be +0": one join a promotion), and with the full-rate set not revised after the first selection ("at
 * once: expected [ 192 ] to deeply equal [ 134 ]" at cycle 10, when the roles flip). Its first version (a fixed viewer
 * and walkers stepping 1 px) promoted nothing after admission: MEASURED with a spy on setFullRate, 20 promotions during
 * the admission and 0 promotions and 0 demotions in the 20 seconds that were meant to prove it, so that "0 joins and 0
 * leaves" held whatever promotion did. The walking crowd test failed with SEAT_MARGIN_PX at 32 (195.8 a second).
 */

const ZONE = 320;

interface Told {
    joins: number[];
    leaves: number[];
    moves: number;
    /** The user of each move, in the order they were sent. */
    moved: number[];
}

function observerSocket(userId: number) {
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
    const told = (): Told => {
        socket.flushBatch();
        const result: Told = { joins: [], leaves: [], moves: 0, moved: [] };
        for (const frame of frames.splice(0)) {
            const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
            if (message?.$case !== "batchMessage") {
                continue;
            }
            for (const { message: sub } of message.batchMessage.payload) {
                if (sub?.$case === "userJoinedMessage") {
                    result.joins.push(sub.userJoinedMessage.userId);
                } else if (sub?.$case === "userLeftMessage") {
                    result.leaves.push(sub.userLeftMessage.userId);
                } else if (sub?.$case === "userMovedMessage") {
                    result.moves += 1;
                    result.moved.push(sub.userMovedMessage.userId);
                }
            }
        }
        return result;
    };
    return { socket, userData, told };
}

function pusher(budget?: ViewerBudgetLimits) {
    const back = new SimulatedBack(ZONE);
    const created: { dispatcher?: PositionDispatcher } = {};
    const room = back.roomFor(() => created.dispatcher as PositionDispatcher);
    const dispatcher = new PositionDispatcher("room", ZONE, ZONE, new SocketManager(undefined, budget), room);
    created.dispatcher = dispatcher;
    back.attach(dispatcher);
    return { back, dispatcher };
}

type Rectangle = { left: number; top: number; right: number; bottom: number };

function zonesOf(rectangle: Rectangle): { i0: number; i1: number; j0: number; j1: number } {
    return {
        i0: Math.floor(rectangle.left / ZONE),
        i1: Math.floor(rectangle.right / ZONE),
        j0: Math.floor(rectangle.top / ZONE),
        j1: Math.floor(rectangle.bottom / ZONE),
    };
}

function watches(rectangle: Rectangle, x: number, y: number): boolean {
    const { i0, i1, j0, j1 } = zonesOf(rectangle);
    const i = Math.floor(x / ZONE);
    const j = Math.floor(y / ZONE);
    return i >= i0 && i <= i1 && j >= j0 && j <= j1;
}

describe("a walker that crosses zone borders", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("is one join when it enters what a socket watches and one leave when it goes out, whatever the borders in between", () => {
        const { back, dispatcher } = pusher();
        const observer = observerSocket(1);
        // Zones 1 to 4 of the row at y 0: x from 320 to 1599.
        const view: Rectangle = { left: 330, right: 1590, top: 10, bottom: 300 };
        observer.userData.viewport = view;
        dispatcher.setViewport(observer.socket, view);

        // A walker crosses the whole row, from zone 0 to zone 5: 5 borders, 3 of them inside what the socket watches.
        back.join(7, 20, 100);
        observer.told();
        let inViewSteps = 0;
        for (let x = 20; x <= 1900; x += 16) {
            back.move(7, x, 100, true);
            inViewSteps += watches(view, x, 100) ? 1 : 0;
        }
        back.move(7, 1900, 100, false);
        const told = observer.told();

        expect(told.joins).toEqual([7]);
        expect(told.leaves).toEqual([7]);
        // The first step in view is the join, which carries the position; every later one is a move, the last of
        // them the step before the one that leaves.
        expect(told.moves).toBe(inViewSteps - 1);
    });

    it("is no join and no leave for a walker that goes back and forth across one border the socket watches on both sides", () => {
        const { back, dispatcher } = pusher();
        const observer = observerSocket(1);
        const view: Rectangle = { left: 0, right: 639, top: 0, bottom: 319 };
        observer.userData.viewport = view;
        dispatcher.setViewport(observer.socket, view);
        back.join(7, 310, 100);
        observer.told();

        // 200 steps over the border between zones 0 and 1, 10 px each side of it.
        for (let step = 0; step < 200; step++) {
            back.move(7, step % 2 === 0 ? 330 : 310, 100, true);
        }
        const told = observer.told();

        expect(told.joins).toEqual([]);
        expect(told.leaves).toEqual([]);
        expect(told.moves).toBe(200);
    });

    it("is one join and one leave per real entry and exit for a walker that goes in and out of the view 10 times", () => {
        const { back, dispatcher } = pusher();
        const observer = observerSocket(1);
        const view: Rectangle = { left: 330, right: 650, top: 10, bottom: 300 };
        observer.userData.viewport = view;
        dispatcher.setViewport(observer.socket, view);
        back.join(7, 100, 100);
        observer.told();

        for (let round = 0; round < 10; round++) {
            back.move(7, 400, 100, true); // into zone 1
            back.move(7, 100, 100, true); // out, into zone 0
        }
        const told = observer.told();

        expect(told.joins).toHaveLength(10);
        expect(told.leaves).toHaveLength(10);
    });
});

describe("a viewer that pans or zooms", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** 400 users standing still on a 5120 px square (16 x 16 zones). */
    function crowd(back: SimulatedBack): { x: number; y: number }[] {
        const places = Array.from({ length: 400 }, (_, index) => ({
            x: 40 + (index % 20) * 250,
            y: 40 + Math.floor(index / 20) * 250,
        }));
        places.forEach((place, index) => back.join(index + 1, place.x, place.y));
        return places;
    }

    it("is told of a user once on the way in and once on the way out of a pan across the map, and of nobody twice", () => {
        const { back, dispatcher } = pusher();
        const places = crowd(back);
        const observer = observerSocket(1000);
        const at = (offset: number): Rectangle => ({ left: offset, right: offset + 960, top: 1000, bottom: 2540 });

        observer.userData.viewport = at(0);
        dispatcher.setViewport(observer.socket, at(0));
        const initial = observer.told();
        const joins = [...initial.joins];
        const leaves: number[] = [];

        // 2 px a frame for 2000 frames: 4000 px, the viewport sends a new rectangle each time the camera moves.
        for (let offset = 2; offset <= 4000; offset += 2) {
            observer.userData.viewport = at(offset);
            dispatcher.setViewport(observer.socket, at(offset));
            const told = observer.told();
            joins.push(...told.joins);
            leaves.push(...told.leaves);
        }

        const first = at(0);
        const last = at(4000);
        const everWatched = (index: number) => {
            for (let offset = 0; offset <= 4000; offset += 2) {
                if (watches(at(offset), places[index].x, places[index].y)) {
                    return true;
                }
            }
            return false;
        };
        const expectedJoins = places.filter((_, index) => everWatched(index)).length;
        const expectedLeaves = places.filter(
            (place, index) => everWatched(index) && !watches(last, place.x, place.y),
        ).length;

        expect(joins).toHaveLength(expectedJoins);
        expect(new Set(joins).size).toBe(joins.length);
        expect(leaves).toHaveLength(expectedLeaves);
        expect(new Set(leaves).size).toBe(leaves.length);
        // The pan starts and ends with users in view.
        expect(initial.joins.length).toBe(places.filter((place) => watches(first, place.x, place.y)).length);
        expect(expectedJoins).toBeGreaterThan(100);
    });

    it("sends nothing for a viewport that moves inside the zones it already watches, or is sent again unchanged", () => {
        const { back, dispatcher } = pusher();
        crowd(back);
        const observer = observerSocket(1000);
        const start: Rectangle = { left: 1000, right: 1960, top: 1000, bottom: 1540 };
        observer.userData.viewport = start;
        dispatcher.setViewport(observer.socket, start);
        observer.told();

        // The same zones: 1000..1960 is zones 3 to 6, 1000..1540 zones 3 to 4. Pan by 100 px stays inside them.
        for (let step = 0; step < 300; step++) {
            const shift = (step % 20) * 5;
            const rectangle = { ...start, left: 1000 + shift, right: 1960 + shift };
            observer.userData.viewport = rectangle;
            dispatcher.setViewport(observer.socket, rectangle);
        }
        const told = observer.told();

        expect(told).toEqual({ joins: [], leaves: [], moves: 0, moved: [] });
    });

    it("is told of the ring of users between two zoom levels when it zooms out, and of the same ones when it zooms in, and of nobody else, on each of 10 round trips", () => {
        const { back, dispatcher } = pusher();
        const places = crowd(back);
        const observer = observerSocket(1000);
        const zoomedIn: Rectangle = { left: 1500, right: 2460, top: 1500, bottom: 2040 };
        const zoomedOut: Rectangle = { left: 700, right: 3260, top: 900, bottom: 2640 };
        observer.userData.viewport = zoomedIn;
        dispatcher.setViewport(observer.socket, zoomedIn);
        observer.told();

        const ring = places
            .map((place, index) => ({ id: index + 1, ...place }))
            .filter((place) => watches(zoomedOut, place.x, place.y) && !watches(zoomedIn, place.x, place.y))
            .map((place) => place.id)
            .sort((a, b) => a - b);

        for (let trip = 0; trip < 10; trip++) {
            dispatcher.setViewport(observer.socket, zoomedOut);
            const out = observer.told();
            dispatcher.setViewport(observer.socket, zoomedIn);
            const back_ = observer.told();

            expect(
                [...out.joins].sort((a, b) => a - b),
                `trip ${trip}`,
            ).toEqual(ring);
            expect(out.leaves).toEqual([]);
            expect(
                [...back_.leaves].sort((a, b) => a - b),
                `trip ${trip}`,
            ).toEqual(ring);
            expect(back_.joins).toEqual([]);
        }
        expect(ring.length).toBeGreaterThan(20);
    });
});

describe("the per-viewer budget", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const limits: ViewerBudgetLimits = { fullRatePeers: 20, maxPeers: 60, admitByDistance: true };

    function room(users: number) {
        const { back, dispatcher } = pusher(limits);
        const places = Array.from({ length: users }, (_, index) => ({
            x: 8 + (index % 20) * 14,
            y: 8 + Math.floor(index / 20) * 14,
        }));
        places.forEach((place, index) => back.join(index + 1, place.x, place.y));
        const observer = observerSocket(1000);
        const view: Rectangle = { left: 0, right: 319, top: 0, bottom: 319 };
        observer.userData.viewport = view;
        dispatcher.setViewport(observer.socket, view);
        return { back, dispatcher, observer, places };
    }

    it("promotes the users that come near the viewer and demotes the ones that go away, 20 times, with no join and no leave", () => {
        const { back, observer, places } = room(200);
        vi.advanceTimersByTime(1);
        expect(observer.told().joins).toHaveLength(60);

        // The users by distance to the centre of the viewport, the origin of the budget before the viewer moves.
        const origin = { x: 159.5, y: 159.5 };
        const byDistance = places
            .map((place, index) => ({ id: index + 1, ...place, d: Math.hypot(place.x - origin.x, place.y - origin.y) }))
            .sort((first, second) => first.d - second.d);
        // Ranks 0..9 are at full rate (the limit is 20); ranks 30..39 are in the scene (60) and heard once a second.
        const pairs = Array.from({ length: 10 }, (_, rank) => ({
            inner: byDistance[rank],
            ring: byDistance[30 + rank],
        }));
        expect(byDistance[19].d).toBeLessThan(byDistance[20].d);

        let joinsAndLeaves = 0;
        for (let cycle = 0; cycle < 20; cycle++) {
            // The two users of a pair trade places. The first time round the user that stands near is at full rate and
            // the one that stands far is not; the second time round they trade back, and by then the one that came near
            // has been promoted and the other demoted, so the roles are the other way: they flip every cycle.
            const { inner, ring } = pairs[cycle % 10];
            const near = cycle < 10 ? { id: inner.id, from: inner, to: ring } : { id: ring.id, from: inner, to: ring };
            const far = cycle < 10 ? { id: ring.id, from: ring, to: inner } : { id: inner.id, from: ring, to: inner };
            back.move(near.id, near.to.x, near.to.y, true);
            back.move(far.id, far.to.x, far.to.y, true);

            // At full rate a move reaches the viewer at once; heard once a second, it waits for the next tick. That a
            // different user is heard at once each cycle is the proof that the full-rate set changed, twice a cycle.
            const atOnce = observer.told();
            expect(atOnce.moved, `cycle ${cycle}: at once`).toEqual([near.id]);
            vi.advanceTimersByTime(1000);
            const atTick = observer.told();
            expect(atTick.moved, `cycle ${cycle}: at the tick`).toEqual([far.id]);
            joinsAndLeaves += atOnce.joins.length + atOnce.leaves.length + atTick.joins.length + atTick.leaves.length;
        }

        // 20 promotions and 20 demotions, and nobody was told that anyone joined or left.
        expect(joinsAndLeaves).toBe(0);
    });

    it("keeps two users that trade places at the edge of the scene by less than the seat margin where they are", () => {
        const { back, dispatcher } = pusher({ fullRatePeers: 5, maxPeers: 60, admitByDistance: true });
        // The viewer looks at the middle of zone (0, 0): (160, 160). 59 users stand around that point, and A and B
        // contend for the 60th seat from 100 px away, 6 px apart in distance: well inside the 32 px seat margin.
        for (let index = 0; index < 59; index++) {
            back.join(index + 1, 160 + (index % 8) * 4, 160 + Math.floor(index / 8) * 4);
        }
        back.join(100, 260, 160); // A
        back.join(101, 266, 160); // B
        const observer = observerSocket(1000);
        const view: Rectangle = { left: 0, right: 319, top: 0, bottom: 319 };
        observer.userData.viewport = view;
        dispatcher.setViewport(observer.socket, view);
        vi.advanceTimersByTime(1);
        const admitted = observer.told();
        expect(admitted.joins).toHaveLength(60);
        expect(admitted.joins).toContain(100);
        expect(admitted.joins).not.toContain(101);

        let joinsAndLeaves = 0;
        for (let second = 0; second < 20; second++) {
            // B comes 6 px nearer than A, then A 6 px nearer than B, each second.
            back.move(second % 2 === 0 ? 101 : 100, 254, 160, true);
            back.move(second % 2 === 0 ? 100 : 101, 266, 160, true);
            vi.advanceTimersByTime(1000);
            const told = observer.told();
            joinsAndLeaves += told.joins.length + told.leaves.length;
        }

        expect(joinsAndLeaves).toBe(0);
    });

    it("sends no join and no leave in 30 seconds to a viewer whose crowd stands still, ties in distance included", () => {
        const { observer } = room(200);
        vi.advanceTimersByTime(1);
        observer.told();

        vi.advanceTimersByTime(30_000);

        expect(observer.told()).toEqual({ joins: [], leaves: [], moves: 0, moved: [] });
    });
});

describe("the per-viewer budget on a crowd that walks", () => {
    // 1000 users in one dense zone, a share of them stepping up to 30 px five times a second, and no real crossing in
    // sight: the users are always in view of each other and the scene is the 400 nearest, so every join and every leave
    // a socket is sent is synthetic. The bench runs on its own virtual clock (FanOutBench.ts), so the count is exact.
    const crowd = { sockets: 1000, movesPerSecond: 5, warmUpSeconds: 3, windowSeconds: 8, observers: 2 };
    const limits: ViewerBudgetLimits = { fullRatePeers: 150, maxPeers: 400, admitByDistance: true };

    it.each([0.05, 0.2])(
        "sends no join and no leave in 8 seconds when %s of it walks, at the default seat margin",
        async (share) => {
            const result = await runFanOut({ ...crowd, movingFraction: share, budget: limits });

            expect(result.deliveriesPerSecond.moves).toBeGreaterThan(0);
            expect(result.syntheticJoinLeavePerSecond).toBe(0);
        },
        120_000,
    );

    it("would send about 200 a second at the old margin of 32 px with 20% walking: the two walkers that contend for the last seat differ by up to 60 px", async () => {
        const narrow = await runFanOut({
            ...crowd,
            movingFraction: 0.2,
            budget: {
                ...limits,
                exitRatio: 1,
                cooldownMs: 0,
                rerankIntervalMs: 1000,
                staggerTicks: false,
                seatMarginPx: 32,
            },
        });
        const none = await runFanOut({
            ...crowd,
            movingFraction: 0.2,
            budget: {
                ...limits,
                exitRatio: 1,
                cooldownMs: 0,
                rerankIntervalMs: 1000,
                staggerTicks: false,
                seatMarginPx: 0,
            },
        });

        // MEASURED, N=1000, 5 Hz, 8 s: 195.8 a second at 32 px (97.9 joins and as many leaves), 11261 with no margin.
        expect(narrow.syntheticJoinLeavePerSecond).toBeGreaterThan(100);
        expect(none.syntheticJoinLeavePerSecond).toBeGreaterThan(narrow.syntheticJoinLeavePerSecond * 10);
    }, 120_000);
});
