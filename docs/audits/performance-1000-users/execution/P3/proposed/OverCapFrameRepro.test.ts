// Review repro for PR #6688, NOT part of proposed-tests.patch: it pins a consequence of the cap policy that the
// PR description does not state. Keep or drop it once the maintainers say whether the behaviour is intended.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerToClientMessage } from "@workadventure/messages";

const frame = vi.hoisted(() => ({ byteLength: 4 }));

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
vi.mock("@workadventure/messages", () => ({
    PusherToFrontWebSocketMessage: {
        encode: () => ({ finish: () => new Uint8Array(frame.byteLength) }),
    },
}));

import { WS_CLOSE_CODE_SESSION_DESTROYED } from "../../src/common/WebSocketCloseCodes";
import { PusherWebSocket, RESUME_STORE_MAX_BYTES, type RawSocket } from "../../src/pusher/services/PusherWebSocket";

describe("PR 6688 review repro: a frame larger than the byte cap on a socket waiting for a drain", () => {
    const message: ServerToClientMessage = { message: undefined };

    beforeEach(() => {
        vi.useFakeTimers();
        frame.byteLength = 4;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function createRawSocket(sendStatus: number) {
        return {
            send: vi.fn(() => sendStatus),
            end: vi.fn(),
            ping: vi.fn(() => 1),
            getUserData: () => ({ userUuid: "user-1", tabId: "tab-1" }),
        };
    }

    it("closes with 4000 when a second over-cap frame arrives before the first one drained", () => {
        // 0 = uWS buffered the frame and still delivers it: the client is healthy, only slower than a 4 MiB burst.
        const rawSocket = createRawSocket(0);
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);
        frame.byteLength = RESUME_STORE_MAX_BYTES + 1;

        socket.send(message);
        expect(rawSocket.end).not.toHaveBeenCalled();

        socket.send(message);
        expect(rawSocket.end).toHaveBeenCalledWith(WS_CLOSE_CODE_SESSION_DESTROYED, expect.any(String));
    });

    it("closes with 4000 when one over-cap frame arrives while a single small frame waits for a drain", () => {
        const rawSocket = createRawSocket(0);
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);

        socket.send(message);
        expect(rawSocket.end).not.toHaveBeenCalled();

        frame.byteLength = RESUME_STORE_MAX_BYTES + 1;
        socket.send(message);
        expect(rawSocket.end).toHaveBeenCalledWith(WS_CLOSE_CODE_SESSION_DESTROYED, expect.any(String));
    });

    it("stays open when small frames follow one over-cap frame that is still draining", () => {
        const rawSocket = createRawSocket(0);
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);
        frame.byteLength = RESUME_STORE_MAX_BYTES + 1;
        socket.send(message);

        frame.byteLength = 4;
        for (let i = 0; i < 100; i++) {
            socket.send(message);
        }

        expect(rawSocket.end).not.toHaveBeenCalled();
    });
});
