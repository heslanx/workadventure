import { afterEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import * as Sentry from "@sentry/node";
import { JoinRoomFrontMessage, UserMovesMessage } from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
vi.mock("@sentry/node", async (importOriginal) => ({
    ...(await importOriginal<typeof Sentry>()),
    captureException: vi.fn(),
}));

import { SocketManager } from "../../src/pusher/services/SocketManager";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";
import type { PusherRoom } from "../../src/pusher/models/PusherRoom";

const ROOM = "https://play.test/@/org/world/room";
const VIEWPORT = { left: 0, top: 0, right: 319, bottom: 319 };

/**
 * What Sentry and the log receive when a room method of the manager fails. A string has no stack and no cause, so
 * Sentry could not say where the failure happened (SM-08): each failure is reported once, as an Error.
 */
describe("SocketManager error reports", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.mocked(Sentry.captureException).mockClear();
    });

    function socketWithoutBackStream(): PusherWebSocket {
        return mock<PusherWebSocket>({ getUserData: vi.fn().mockReturnValue({ roomId: ROOM }) });
    }

    it("SM-08 (fixed): sends Sentry and the log one Error that names the room and keeps the cause, when a viewport change fails", () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const manager = new SocketManager();
        const failure = new Error(`Cannot set viewport in room ${ROOM}, connection is closing`);
        const closingRoom = mock<PusherRoom>({
            setViewport: () => {
                throw failure;
            },
        });
        manager.getRooms().set(ROOM, closingRoom);

        manager.handleViewport(socketWithoutBackStream(), VIEWPORT);

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [[reported]] = vi.mocked(Sentry.captureException).mock.calls;
        expect(reported).toBeInstanceOf(Error);
        expect(reported).toMatchObject({ message: `Failed to set the viewport of room ${ROOM}`, cause: failure });
        expect(log.mock.calls).toEqual([[reported]]);
    });

    it("SM-08 (fixed): sends Sentry and the log one Error that names the room, when a viewport change finds no room", () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const manager = new SocketManager();

        manager.handleViewport(socketWithoutBackStream(), VIEWPORT);

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        const [[reported]] = vi.mocked(Sentry.captureException).mock.calls;
        expect(reported).toBeInstanceOf(Error);
        expect(reported).toHaveProperty("message", `Cannot set the viewport: room ${ROOM} is not open on this pusher`);
        expect(log.mock.calls).toEqual([[reported]]);
    });

    // The thrown Error is the report: IoSocketController's message handler sends what it catches to Sentry.
    it("SM-08 (fixed): a move from a socket without a back stream throws, and sends Sentry no second report", () => {
        const manager = new SocketManager();
        const move = UserMovesMessage.fromPartial({ viewport: VIEWPORT });

        expect(() => manager.handleUserMovesMessage(socketWithoutBackStream(), move)).toThrow(
            "Client has no back connection",
        );

        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it("SM-08 (fixed): a join from a socket without a back stream rejects, and sends Sentry no second report", async () => {
        const manager = new SocketManager();
        const join = JoinRoomFrontMessage.fromPartial({ positionMessage: {}, viewportMessage: VIEWPORT });

        await expect(manager.handleJoinRoom(socketWithoutBackStream(), join)).rejects.toThrow(
            "Client has no back connection",
        );

        expect(Sentry.captureException).not.toHaveBeenCalled();
    });
});
