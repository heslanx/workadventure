import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PusherToFrontWebSocketMessage, type ServerToClientMessage } from "@workadventure/messages";

// The two variables that switch the caps on, as an operator would set them: this file is the one that reads them non-zero.
const MAX_MESSAGES = 100;
const MAX_BYTES = 5_000;
vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({
    CLIENT_DISCONNECTION_RETENTION_MS: 30_000,
    PUSHER_RESUME_STORE_MAX_MESSAGES: 100,
    PUSHER_RESUME_STORE_MAX_BYTES: 5_000,
}));

import {
    PusherWebSocket,
    resumeStoreOptionsFromEnvironment,
    type RawSocket,
} from "../../src/pusher/services/PusherWebSocket";

const message: ServerToClientMessage = { message: undefined };
const FRAME_BYTES = PusherToFrontWebSocketMessage.encode({ nonce: 1, message }).finish().byteLength;

/** A socket whose uWS buffer never drains: every frame after the first waits in the resume store. */
function createStuckRaw() {
    const raw = {
        send: vi.fn(() => 0),
        end: vi.fn(),
        ping: vi.fn(() => 1),
        getUserData: () => ({ userUuid: "user-1", tabId: "tab-1", connectionId: "connection-1" }),
    };
    return { raw, rawSocket: raw as unknown as RawSocket };
}

describe("PUSHER_RESUME_STORE_MAX_MESSAGES and PUSHER_RESUME_STORE_MAX_BYTES, once set", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("reach the options of a socket, each one as its own limit", () => {
        expect(resumeStoreOptionsFromEnvironment()).toEqual({
            retentionMs: 30_000,
            maxMessages: MAX_MESSAGES,
            maxBytes: MAX_BYTES,
        });
    });

    it("cap a socket made without options at the frame count, when the frames weigh less than the byte limit", () => {
        // 101 small frames are well under 5000 bytes: only the frame limit can end this.
        expect(101 * FRAME_BYTES).toBeLessThan(MAX_BYTES);
        const { raw, rawSocket } = createStuckRaw();
        const socket = new PusherWebSocket(rawSocket);

        for (let i = 0; i < MAX_MESSAGES; i++) {
            socket.send(message);
        }
        expect(raw.end).not.toHaveBeenCalled();
        expect(socket.retainedForResume().messages).toBe(MAX_MESSAGES);

        socket.send(message);

        expect(raw.end).toHaveBeenCalledTimes(1);
        expect(socket.retainedForResume()).toEqual({ messages: 0, bytes: 0 });
    });

    it("cap it at the bytes too, when the frame count is far from its limit", () => {
        const { raw, rawSocket } = createStuckRaw();
        // Fat frames: the byte limit is reached long before 100 of them.
        const fat = {
            message: { $case: "errorMessage", errorMessage: { message: "x".repeat(900) } },
        } as unknown as ServerToClientMessage;
        const socket = new PusherWebSocket(rawSocket);

        let sent = 0;
        while (raw.end.mock.calls.length === 0 && sent < MAX_MESSAGES) {
            expect(socket.retainedForResume().bytes).toBeLessThanOrEqual(MAX_BYTES);
            socket.send(fat);
            sent++;
        }

        expect(raw.end).toHaveBeenCalledTimes(1);
        expect(sent).toBeLessThan(MAX_MESSAGES);
        expect(sent).toBeLessThanOrEqual(Math.ceil(MAX_BYTES / 900) + 1);
    });
});
