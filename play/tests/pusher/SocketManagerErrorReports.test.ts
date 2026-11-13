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
 * Sentry cannot say where the failure happened (SM-08).
 */
describe("SocketManager error reports", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.mocked(Sentry.captureException).mockClear();
    });

    function socketWithoutBackStream(): PusherWebSocket {
        return mock<PusherWebSocket>({ getUserData: vi.fn().mockReturnValue({ roomId: ROOM }) });
    }

    it("SM-08 (pinned): sends Sentry and the log a string, without the error, when a viewport change fails", () => {
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

        const text = `An error occurred on "SET_VIEWPORT" event Error: Cannot set viewport in room ${ROOM}, connection is closing`;
        expect(vi.mocked(Sentry.captureException).mock.calls).toEqual([[text]]);
        expect(log.mock.calls).toEqual([[text]]);
    });

    it("SM-08 (pinned): sends Sentry a string when a viewport change finds no room", () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const manager = new SocketManager();

        manager.handleViewport(socketWithoutBackStream(), VIEWPORT);

        expect(vi.mocked(Sentry.captureException).mock.calls).toEqual([
            [`In SET_VIEWPORT, could not find world with id ' ${ROOM}`],
        ]);
        expect(log.mock.calls).toEqual([["In SET_VIEWPORT, could not find world with id '", ROOM, "'"]]);
    });

    it("SM-08 (pinned): a move from a socket without a back stream throws, and sends Sentry the same text as a string", () => {
        const manager = new SocketManager();
        const move = UserMovesMessage.fromPartial({ viewport: VIEWPORT });

        expect(() => manager.handleUserMovesMessage(socketWithoutBackStream(), move)).toThrow(
            "Client has no back connection",
        );

        expect(vi.mocked(Sentry.captureException).mock.calls).toEqual([["Client has no back connection"]]);
    });

    it("SM-08 (pinned): a join from a socket without a back stream rejects, and sends Sentry the same text as a string", async () => {
        const manager = new SocketManager();
        const join = JoinRoomFrontMessage.fromPartial({ positionMessage: {}, viewportMessage: VIEWPORT });

        await expect(manager.handleJoinRoom(socketWithoutBackStream(), join)).rejects.toThrow(
            "Client has no back connection",
        );

        expect(vi.mocked(Sentry.captureException).mock.calls).toEqual([["Client has no back connection"]]);
    });
});
