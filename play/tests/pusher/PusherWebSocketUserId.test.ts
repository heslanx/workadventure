import { describe, expect, it, vi } from "vitest";
import {
    AvailabilityStatus,
    PositionMessage_Direction,
    UserJoinedZoneMessage,
    UserMovedMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";
import { Zone, type ZoneEventListener } from "../../src/pusher/models/Zone";

/*
 * A zone asks every socket for its user id for every event it sends. On a real socket `getUserData` is a call into
 * uWebSockets, so the id is read once. The counts below are what the fake transport saw: MEASURED here, exactly.
 */

function socketWithData(data: { userId?: number }) {
    const getUserData = vi.fn(() => ({ ...data, listenedZones: new Set<string>() }) as never);
    const raw = {
        send: vi.fn().mockReturnValue(1),
        ping: vi.fn().mockReturnValue(1),
        end: vi.fn(),
        getBufferedAmount: vi.fn().mockReturnValue(0),
        getUserData,
    } as unknown as RawSocket;
    return { socket: new PusherWebSocket(raw), getUserData };
}

describe("PusherWebSocket.userId", () => {
    it("reads the id from the transport once, however many times it is asked", () => {
        const { socket, getUserData } = socketWithData({ userId: 42 });

        for (let ask = 0; ask < 1000; ask++) {
            expect(socket.userId).toBe(42);
        }

        expect(getUserData).toHaveBeenCalledTimes(1);
    });

    it("is undefined, and asks again, until the room has given the socket an id", () => {
        const data: { userId?: number } = {};
        const getUserData = vi.fn(() => data as never);
        const socket = new PusherWebSocket({
            send: vi.fn(),
            ping: vi.fn(),
            end: vi.fn(),
            getUserData,
        } as unknown as RawSocket);

        expect(socket.userId).toBeUndefined();
        expect(socket.userId).toBeUndefined();
        data.userId = 7;

        expect(socket.userId).toBe(7);
        expect(socket.userId).toBe(7);
        expect(getUserData).toHaveBeenCalledTimes(3);
    });
});

describe("a zone sending moves to many sockets", () => {
    it("calls into the transport a few times per socket, not once per move per socket", () => {
        const sockets = Array.from({ length: 50 }, (_, index) => socketWithData({ userId: 1000 + index }));
        const listener: ZoneEventListener = {
            onUserEnters: () => undefined,
            onUserMoves: () => undefined,
            onUserLeaves: () => undefined,
            onGroupEnters: () => undefined,
            onGroupMoves: () => undefined,
            onGroupLeaves: () => undefined,
            onGroupUsersUpdated: () => undefined,
            onEmote: () => undefined,
            onError: () => undefined,
            onPlayerDetailsUpdated: () => undefined,
        };
        const zone = new Zone(listener, 0, 0);
        zone.handleUserJoinedZone(
            UserJoinedZoneMessage.fromPartial({
                userId: 1,
                userUuid: "uuid",
                name: "walker",
                characterTextures: [],
                position: { x: 0, y: 0, direction: PositionMessage_Direction.RIGHT, moving: false },
                availabilityStatus: AvailabilityStatus.ONLINE,
                visitCardUrl: "",
                variables: {},
            }),
        );
        for (const { socket } of sockets) {
            zone.startListening(socket);
        }
        sockets.forEach(({ getUserData }) => getUserData.mockClear());

        for (let step = 1; step <= 100; step++) {
            zone.handleUserMoved(
                UserMovedMessage.fromPartial({
                    userId: 1,
                    position: { x: step, y: 0, direction: PositionMessage_Direction.RIGHT, moving: true },
                }),
            );
        }

        // 100 moves to 50 sockets: 5000 deliveries, one call to the transport for each socket in all.
        const calls = sockets.reduce((sum, { getUserData }) => sum + getUserData.mock.calls.length, 0);
        expect(calls).toBe(50);
    });
});
