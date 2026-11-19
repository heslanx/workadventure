import { afterEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { register } from "prom-client";
import { PositionMessage_Direction, UserMovesMessage } from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { SocketManager } from "../../src/pusher/services/SocketManager";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";

const VIEWPORT = { left: 0, top: 0, right: 319, bottom: 319 };
const MOVING_SOCKETS_METRIC = "workadventure_pusher_moving_sockets";

function userMoves(moving: boolean): UserMovesMessage {
    return UserMovesMessage.fromPartial({
        position: { x: 10, y: 100, direction: PositionMessage_Direction.RIGHT, moving },
        viewport: VIEWPORT,
    });
}

async function movingSockets(): Promise<number> {
    const metric = await register.getSingleMetric(MOVING_SOCKETS_METRIC)?.get();
    return metric?.values[0]?.value ?? 0;
}

/**
 * workadventure_pusher_moving_sockets is the number of sockets whose last move had moving=true. How many of the users
 * of a room are walking, and not standing, is what tells how much of the position traffic is real.
 */
describe("SocketManager moving sockets gauge", () => {
    afterEach(() => vi.restoreAllMocks());

    function setup() {
        const manager = new SocketManager();
        vi.spyOn(manager, "handleViewport").mockImplementation(() => undefined);
        const addSocket = () =>
            mock<PusherWebSocket>({
                getUserData: vi.fn().mockReturnValue({
                    roomId: "https://play.test/@/org/world/room",
                    userUuid: "user",
                    spaces: new Set<string>(),
                    currentChatRoomArea: [],
                    backConnection: { write: vi.fn(), end: vi.fn() },
                }),
                isDisconnecting: vi.fn().mockReturnValue(false),
            });
        return { manager, addSocket };
    }

    it("counts a socket once however many moves it sent, and stops counting it at its stop", async () => {
        const { manager, addSocket } = setup();
        const socket = addSocket();
        const idle = await movingSockets();

        manager.handleUserMovesMessage(socket, userMoves(true));
        manager.handleUserMovesMessage(socket, userMoves(true));
        expect(await movingSockets()).toBe(idle + 1);

        manager.handleUserMovesMessage(socket, userMoves(false));
        expect(await movingSockets()).toBe(idle);
    });

    it("does not count a socket whose first move is a stop, nor take one off for a second stop", async () => {
        const { manager, addSocket } = setup();
        const socket = addSocket();
        const idle = await movingSockets();

        manager.handleUserMovesMessage(socket, userMoves(false));
        manager.handleUserMovesMessage(socket, userMoves(false));

        expect(await movingSockets()).toBe(idle);
    });

    it("counts each socket on its own", async () => {
        const { manager, addSocket } = setup();
        const walking = addSocket();
        const standing = addSocket();
        const idle = await movingSockets();

        manager.handleUserMovesMessage(walking, userMoves(true));
        manager.handleUserMovesMessage(standing, userMoves(true));
        manager.handleUserMovesMessage(standing, userMoves(false));

        expect(await movingSockets()).toBe(idle + 1);
    });

    it("stops counting a socket that disconnects while walking, even if it is cleaned up twice", async () => {
        const { manager, addSocket } = setup();
        const socket = addSocket();
        const other = addSocket();
        const idle = await movingSockets();
        manager.handleUserMovesMessage(socket, userMoves(true));
        manager.handleUserMovesMessage(other, userMoves(true));

        manager.cleanupSocket(socket);
        manager.cleanupSocket(socket);

        expect(await movingSockets()).toBe(idle + 1);
    });
});
