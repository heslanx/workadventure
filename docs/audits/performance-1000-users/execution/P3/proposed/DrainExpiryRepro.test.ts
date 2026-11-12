// Review repro for PR #6688, NOT part of proposed-tests.patch. It runs unchanged on the baseline and on the PR head:
// a frame that waits for a drain longer than the retention is pruned and never sent, and the socket stays open.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerToClientMessage } from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
vi.mock("@workadventure/messages", () => ({
    PusherToFrontWebSocketMessage: {
        // A fake frame starts with its nonce, so the test can read back which frames reached the transport.
        encode: ({ nonce }: { nonce: number }) => ({
            finish: () => {
                const payload = new Uint8Array(4);
                new DataView(payload.buffer).setUint32(0, nonce);
                return payload;
            },
        }),
    },
}));

import { CLIENT_DISCONNECTION_RETENTION_MS } from "../../src/pusher/enums/EnvironmentVariable";
import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";

describe("PR 6688 review repro: frames waiting for a drain longer than the retention", () => {
    const message: ServerToClientMessage = { message: undefined };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("skips the expired frame on drain and keeps the socket open", () => {
        const rawSocket = {
            // 0 = uWS buffered the frame as backpressure: later frames wait for a drain.
            send: vi.fn((_payload: Uint8Array<ArrayBuffer>, _isBinary: boolean) => 0),
            end: vi.fn(),
            ping: vi.fn(() => 1),
            getUserData: () => ({ userUuid: "user-1", tabId: "tab-1" }),
        };
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);

        socket.send(message); // nonce 1: handed to uWS
        socket.send(message); // nonce 2: waits for the drain
        vi.advanceTimersByTime(CLIENT_DISCONNECTION_RETENTION_MS);
        socket.send(message); // nonce 3: waits for the drain

        rawSocket.send.mockReturnValue(1);
        socket.handleDrain();

        const sentNonces = rawSocket.send.mock.calls.map(([payload]) => new DataView(payload.buffer).getUint32(0));
        // Nonce 2 was never handed to uWS and the client is not told: it receives 1 then 3.
        expect(sentNonces).toEqual([1, 3]);
        expect(rawSocket.end).not.toHaveBeenCalled();
    });
});
