import { describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/node";
import { UserJoinedZoneMessage } from "@workadventure/messages";
import { MAX_ZONES_PER_VIEWPORT, PositionDispatcher } from "../../src/pusher/models/PositionDispatcher";
import type { PusherRoom } from "../../src/pusher/models/PusherRoom";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";
import type { ZoneEventListener } from "../../src/pusher/models/Zone";

vi.mock("@sentry/node", () => ({
    captureMessage: vi.fn(),
    captureException: vi.fn(),
}));

function createSocket(userId: number) {
    const listenedZones = new Set<string>();
    const socket = {
        getUserData: () => ({ userId, listenedZones }),
    } as unknown as PusherWebSocket;

    return { socket, listenedZones };
}

function createDispatcher() {
    const pusherRoom = {
        subscribeToZone: vi.fn(),
        unsubscribeFromZone: vi.fn(),
    };
    const socketListener = {
        onUserEnters: vi.fn(),
        onUserLeaves: vi.fn(),
    };

    const dispatcher = new PositionDispatcher(
        "http://play.workadventure.localhost/@/team/world/room",
        320,
        320,
        socketListener as unknown as ZoneEventListener,
        pusherRoom as unknown as PusherRoom,
    );

    const { socket, listenedZones } = createSocket(1);

    return { dispatcher, pusherRoom, socketListener, socket, listenedZones };
}

// The back only tells the pusher about the users of a zone once the zone has a listener.
function userJoinsZone(dispatcher: PositionDispatcher, userId: number, x: number, y: number): void {
    dispatcher.handleZoneMessage({
        x,
        y,
        message: {
            $case: "userJoinedZoneMessage",
            userJoinedZoneMessage: UserJoinedZoneMessage.fromPartial({ userId, position: { x: 0, y: 0 } }),
        },
    });
}

// With 320px zones: one row, zones 0 and 1.
const ZONES_0_AND_1 = { left: 0, top: 0, right: 639, bottom: 319 };
// The same row, one zone to the right: zones 1 and 2.
const ZONES_1_AND_2 = { left: 320, top: 0, right: 959, bottom: 319 };

describe("PositionDispatcher", () => {
    it("subscribes to the zones covered by a regular viewport", () => {
        const { dispatcher, pusherRoom, socket } = createDispatcher();

        // Roughly a 1080p screen plus the margin added by the front: 8x6 zones of 320px
        dispatcher.setViewport(socket, { left: 0, top: 0, right: 2520, bottom: 1680 });

        expect(pusherRoom.subscribeToZone).toHaveBeenCalledTimes(8 * 6);
    });

    it("ignores a viewport whose coordinates are inverted", () => {
        const { dispatcher, pusherRoom, socket } = createDispatcher();

        dispatcher.setViewport(socket, { left: 1000, top: 0, right: 0, bottom: 1000 });

        expect(pusherRoom.subscribeToZone).not.toHaveBeenCalled();
    });

    it("ignores a viewport whose coordinates are not finite", () => {
        const { dispatcher, pusherRoom, socket } = createDispatcher();

        dispatcher.setViewport(socket, { left: 0, top: 0, right: Number.NaN, bottom: 1000 });

        expect(pusherRoom.subscribeToZone).not.toHaveBeenCalled();
    });

    it("crops an oversized viewport around its center instead of subscribing to a huge number of zones", () => {
        const { dispatcher, pusherRoom, socket } = createDispatcher();

        // Such a viewport covers ~9.7 million zones. Before the guard, this froze the pusher in the subscription
        // loop and made the back accumulate enough zones to break Promise.all on disconnection.
        dispatcher.setViewport(socket, { left: 0, top: 0, right: 1_000_000, bottom: 1_000_000 });

        const subscribedZoneKeys = new Set(
            pusherRoom.subscribeToZone.mock.calls.map((call) => `${call[0]},${call[1]}`),
        );

        expect(subscribedZoneKeys.size).toBeLessThanOrEqual(MAX_ZONES_PER_VIEWPORT);
        // The window is still large enough to be useful, and centered on what the player is looking at.
        expect(subscribedZoneKeys.size).toBeGreaterThan(MAX_ZONES_PER_VIEWPORT / 2);
        expect(subscribedZoneKeys.has("1562,1562")).toBe(true);
        expect(subscribedZoneKeys.has("0,0")).toBe(false);
    });

    it("crops an oversized viewport that is extremely elongated", () => {
        const { dispatcher, pusherRoom, socket } = createDispatcher();

        // A single row of 3126 zones: cropping both sides by the same ratio is not enough here, the longest
        // side has to be trimmed on its own.
        dispatcher.setViewport(socket, { left: 0, top: 0, right: 1_000_000, bottom: 0 });

        expect(pusherRoom.subscribeToZone.mock.calls.length).toBeLessThanOrEqual(MAX_ZONES_PER_VIEWPORT);
        expect(pusherRoom.subscribeToZone.mock.calls.length).toBeGreaterThan(0);
    });

    it("only reports the first oversized viewport of a room", () => {
        const { dispatcher, socket } = createDispatcher();
        const captureMessage = vi.mocked(Sentry.captureMessage);
        captureMessage.mockClear();

        dispatcher.setViewport(socket, { left: 0, top: 0, right: 1_000_000, bottom: 1_000_000 });
        dispatcher.setViewport(socket, { left: 0, top: 0, right: 2_000_000, bottom: 2_000_000 });

        expect(captureMessage).toHaveBeenCalledTimes(1);
    });

    it("does not touch the subscriptions when the same viewport is sent again", () => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();
        const viewport = { left: 0, top: 0, right: 2520, bottom: 1680 };

        dispatcher.setViewport(socket, viewport);
        dispatcher.setViewport(socket, { ...viewport });
        dispatcher.setViewport(socket, { ...viewport });

        expect(pusherRoom.subscribeToZone).toHaveBeenCalledTimes(8 * 6);
        expect(pusherRoom.unsubscribeFromZone).not.toHaveBeenCalled();
        expect(listenedZones.size).toBe(8 * 6);
    });

    it("keeps the subscriptions when the viewport moves without leaving its zones", () => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();
        dispatcher.setViewport(socket, { left: 0, top: 0, right: 2520, bottom: 1680 });
        const zonesBeforeMoving = [...listenedZones];
        pusherRoom.subscribeToZone.mockClear();

        // 30px to the right and 20px down: every edge stays in the zone it was in.
        dispatcher.setViewport(socket, { left: 30, top: 20, right: 2550, bottom: 1700 });

        expect(pusherRoom.subscribeToZone).not.toHaveBeenCalled();
        expect(pusherRoom.unsubscribeFromZone).not.toHaveBeenCalled();
        expect([...listenedZones]).toEqual(zonesBeforeMoving);
    });

    it("subscribes and unsubscribes exactly once per zone when the viewport crosses a zone boundary", () => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();
        dispatcher.setViewport(socket, ZONES_0_AND_1);
        pusherRoom.subscribeToZone.mockClear();

        dispatcher.setViewport(socket, ZONES_1_AND_2);

        expect(pusherRoom.subscribeToZone.mock.calls).toEqual([[2, 0]]);
        expect(pusherRoom.unsubscribeFromZone.mock.calls).toEqual([[0, 0]]);
        expect(listenedZones).toEqual(new Set(["1,0", "2,0"]));
    });

    it("subscribes again to a zone the viewport comes back to", () => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();
        dispatcher.setViewport(socket, ZONES_0_AND_1);
        dispatcher.setViewport(socket, ZONES_1_AND_2);
        pusherRoom.subscribeToZone.mockClear();
        pusherRoom.unsubscribeFromZone.mockClear();

        dispatcher.setViewport(socket, ZONES_0_AND_1);

        expect(pusherRoom.subscribeToZone.mock.calls).toEqual([[0, 0]]);
        expect(pusherRoom.unsubscribeFromZone.mock.calls).toEqual([[2, 0]]);
        expect(listenedZones).toEqual(new Set(["0,0", "1,0"]));
    });

    it("tells the socket once about the users of the zones its viewport enters and leaves", () => {
        const { dispatcher, socketListener, socket } = createDispatcher();
        // Another socket keeps zones 0, 1 and 2 alive, so that the back can populate them.
        const { socket: otherSocket } = createSocket(2);
        dispatcher.setViewport(otherSocket, { left: 0, top: 0, right: 959, bottom: 319 });
        userJoinsZone(dispatcher, 40, 0, 0);
        userJoinsZone(dispatcher, 42, 2, 0);
        dispatcher.setViewport(socket, ZONES_0_AND_1);
        socketListener.onUserEnters.mockClear();

        dispatcher.setViewport(socket, ZONES_1_AND_2);
        // The next two updates stay in zones 1 and 2: they must not notify anything.
        dispatcher.setViewport(socket, ZONES_1_AND_2);
        dispatcher.setViewport(socket, { left: 330, top: 10, right: 950, bottom: 300 });

        expect(socketListener.onUserEnters).toHaveBeenCalledTimes(1);
        expect(socketListener.onUserEnters).toHaveBeenCalledWith(expect.objectContaining({ userId: 42 }), socket);
        expect(socketListener.onUserLeaves.mock.calls).toEqual([[40, socket]]);
    });

    it("floors negative coordinates and includes the zones on both edges of the viewport", () => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();

        // -1px is in zone -1 and 0px in zone 0; -321px is in zone -2 and -320px in zone -1.
        dispatcher.setViewport(socket, { left: -1, top: -321, right: 0, bottom: -320 });

        expect(listenedZones).toEqual(new Set(["-1,-2", "0,-2", "-1,-1", "0,-1"]));
        expect(pusherRoom.subscribeToZone).toHaveBeenCalledTimes(4);
    });

    it("keeps the subscriptions when the viewport moves inside the same zones in negative coordinates", () => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();
        dispatcher.setViewport(socket, { left: -1, top: -321, right: 0, bottom: -320 });
        pusherRoom.subscribeToZone.mockClear();

        // The four edges now sit on the outer limits of the same four zones.
        dispatcher.setViewport(socket, { left: -320, top: -640, right: 319, bottom: -1 });

        expect(pusherRoom.subscribeToZone).not.toHaveBeenCalled();
        expect(pusherRoom.unsubscribeFromZone).not.toHaveBeenCalled();
        expect(listenedZones).toEqual(new Set(["-1,-2", "0,-2", "-1,-1", "0,-1"]));
    });

    it.each([
        ["square", { left: 0, top: 0, right: 1_000_000, bottom: 1_000_000 }],
        ["extremely elongated", { left: 0, top: 0, right: 1_000_000, bottom: 0 }],
    ])("does not touch the subscriptions when the same oversized %s viewport is sent again", (_shape, viewport) => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();
        dispatcher.setViewport(socket, viewport);
        const zonesAfterFirstViewport = [...listenedZones];
        pusherRoom.subscribeToZone.mockClear();

        dispatcher.setViewport(socket, { ...viewport });

        expect(pusherRoom.subscribeToZone).not.toHaveBeenCalled();
        expect(pusherRoom.unsubscribeFromZone).not.toHaveBeenCalled();
        expect([...listenedZones]).toEqual(zonesAfterFirstViewport);
    });

    it("moves the cropped window when an oversized viewport moves", () => {
        const { dispatcher, socket, listenedZones } = createDispatcher();
        dispatcher.setViewport(socket, { left: 0, top: 0, right: 1_000_000, bottom: 1_000_000 });

        // The same size, 10 zones to the right: the center of the crop moves from zone 1562 to zone 1572.
        dispatcher.setViewport(socket, { left: 3200, top: 0, right: 1_003_200, bottom: 1_000_000 });

        expect(listenedZones.has("1572,1562")).toBe(true);
        expect(listenedZones.size).toBeLessThanOrEqual(MAX_ZONES_PER_VIEWPORT);
        expect(listenedZones.size).toBeGreaterThan(MAX_ZONES_PER_VIEWPORT / 2);
    });

    it("keeps the current zones when an invalid viewport follows a valid one", () => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();
        dispatcher.setViewport(socket, ZONES_0_AND_1);
        pusherRoom.subscribeToZone.mockClear();

        dispatcher.setViewport(socket, { left: 0, top: 0, right: Number.POSITIVE_INFINITY, bottom: 319 });
        dispatcher.setViewport(socket, { left: 639, top: 0, right: 0, bottom: 319 });
        dispatcher.setViewport(socket, ZONES_0_AND_1);

        expect(pusherRoom.subscribeToZone).not.toHaveBeenCalled();
        expect(pusherRoom.unsubscribeFromZone).not.toHaveBeenCalled();
        expect(listenedZones).toEqual(new Set(["0,0", "1,0"]));
    });

    it("subscribes to a shared zone for its first listener only", () => {
        const { dispatcher, pusherRoom, socket } = createDispatcher();
        const { socket: otherSocket, listenedZones: otherListenedZones } = createSocket(2);

        dispatcher.setViewport(socket, ZONES_0_AND_1);
        dispatcher.setViewport(otherSocket, ZONES_0_AND_1);

        expect(pusherRoom.subscribeToZone).toHaveBeenCalledTimes(2);
        expect(otherListenedZones).toEqual(new Set(["0,0", "1,0"]));
    });

    it("keeps a shared zone subscribed until its last listener leaves", () => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();
        const { socket: otherSocket, listenedZones: otherListenedZones } = createSocket(2);
        dispatcher.setViewport(socket, ZONES_0_AND_1);
        dispatcher.setViewport(otherSocket, ZONES_0_AND_1);

        dispatcher.removeViewport(socket);

        expect(pusherRoom.unsubscribeFromZone).not.toHaveBeenCalled();
        expect(listenedZones.size).toBe(0);
        expect(otherListenedZones).toEqual(new Set(["0,0", "1,0"]));
        expect(dispatcher.isEmpty()).toBe(false);

        dispatcher.removeViewport(otherSocket);

        expect(pusherRoom.unsubscribeFromZone).toHaveBeenCalledTimes(2);
        expect(dispatcher.isEmpty()).toBe(true);
    });

    it("still tells a socket about a shared zone after another socket left it", () => {
        const { dispatcher, socketListener, socket } = createDispatcher();
        const { socket: otherSocket } = createSocket(2);
        dispatcher.setViewport(socket, ZONES_0_AND_1);
        dispatcher.setViewport(otherSocket, ZONES_0_AND_1);
        dispatcher.removeViewport(otherSocket);
        dispatcher.setViewport(socket, ZONES_0_AND_1);

        userJoinsZone(dispatcher, 40, 1, 0);

        expect(socketListener.onUserEnters.mock.calls).toEqual([[expect.objectContaining({ userId: 40 }), socket]]);
    });

    it("subscribes again when a socket sends the same viewport after its viewport was removed", () => {
        const { dispatcher, pusherRoom, socket, listenedZones } = createDispatcher();
        dispatcher.setViewport(socket, ZONES_0_AND_1);
        dispatcher.removeViewport(socket);
        pusherRoom.subscribeToZone.mockClear();

        dispatcher.setViewport(socket, ZONES_0_AND_1);

        expect(pusherRoom.subscribeToZone).toHaveBeenCalledTimes(2);
        expect(listenedZones).toEqual(new Set(["0,0", "1,0"]));
    });
});
