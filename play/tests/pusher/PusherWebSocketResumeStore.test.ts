import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PusherToFrontWebSocketMessage, type ServerToClientMessage } from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { EnvironmentVariables } from "../../src/pusher/enums/EnvironmentVariableValidator";
import { WS_CLOSE_CODE_SESSION_DESTROYED } from "../../src/common/WebSocketCloseCodes";
import { PusherWebSocket, type RawSocket, type ResumeStoreOptions } from "../../src/pusher/services/PusherWebSocket";

const message: ServerToClientMessage = { message: undefined };

/** What the frames of `message` numbered 1 to `count` weigh, nonces included (a nonce past 127 takes a byte more). */
const frameBytes = (count: number) =>
    Array.from({ length: count }, (_, index) =>
        PusherToFrontWebSocketMessage.encode({ nonce: index + 1, message }).finish(),
    ).reduce((sum, frame) => sum + frame.byteLength, 0);

/** The first 127 frames weigh the same each. */
const FRAME_BYTES = frameBytes(1);

const UNLIMITED: ResumeStoreOptions = { retentionMs: 30_000, maxMessages: 0, maxBytes: 0 };

function createRaw(sendStatus: number, connectionId = "connection-1") {
    const sent: Uint8Array[] = [];
    const raw = {
        send: vi.fn((payload: Uint8Array) => {
            sent.push(payload);
            return sendStatus;
        }),
        end: vi.fn(),
        ping: vi.fn(() => 1),
        getUserData: () => userData,
    };
    const userData = { userUuid: "user-1", tabId: "tab-1", connectionId };
    return { raw, rawSocket: raw as unknown as RawSocket, sent };
}

const sentNonces = (sent: Uint8Array[]) => sent.map((frame) => PusherToFrontWebSocketMessage.decode(frame).nonce);

describe("the resume store of a PusherWebSocket", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("has no limit unless one is given: a socket that never drains keeps every frame and is never ended", () => {
        const { raw, rawSocket } = createRaw(0);
        const socket = new PusherWebSocket(rawSocket, undefined, UNLIMITED);

        for (let i = 0; i < 5_000; i++) {
            socket.send(message);
        }

        expect(socket.retainedForResume()).toEqual({ messages: 5_000, bytes: frameBytes(5_000) });
        expect(raw.end).not.toHaveBeenCalled();
    });

    it("ends the session of a client stuck behind backpressure once it is over the frame limit, with the code that makes it join again", () => {
        // uWS buffers the first frame; every later one waits for a drain that never comes.
        const { raw, rawSocket } = createRaw(0);
        const socket = new PusherWebSocket(rawSocket, undefined, { ...UNLIMITED, maxMessages: 100 });

        for (let i = 0; i < 100; i++) {
            socket.send(message);
        }
        expect(raw.end).not.toHaveBeenCalled();
        expect(socket.retainedForResume().messages).toBe(100);

        socket.send(message);

        expect(raw.end).toHaveBeenCalledTimes(1);
        expect(raw.end).toHaveBeenCalledWith(WS_CLOSE_CODE_SESSION_DESTROYED, expect.any(String));
        expect(socket.retainedForResume()).toEqual({ messages: 0, bytes: 0 });
    });

    it("ends it over the byte limit too, at the first frame that does not fit", () => {
        const { raw, rawSocket } = createRaw(0);
        const socket = new PusherWebSocket(rawSocket, undefined, { ...UNLIMITED, maxBytes: 10 * FRAME_BYTES });

        for (let i = 0; i < 10; i++) {
            socket.send(message);
        }
        expect(raw.end).not.toHaveBeenCalled();

        socket.send(message);

        expect(raw.end).toHaveBeenCalledWith(WS_CLOSE_CODE_SESSION_DESTROYED, expect.any(String));
    });

    it("keeps a client that is reading connected when its store overflows: it only loses the replay", () => {
        const { raw, rawSocket, sent } = createRaw(1);
        const socket = new PusherWebSocket(rawSocket, undefined, { ...UNLIMITED, maxMessages: 100 });

        for (let i = 0; i < 101; i++) {
            socket.send(message);
        }

        expect(sentNonces(sent)).toEqual(Array.from({ length: 101 }, (_, index) => index + 1));
        expect(raw.end).not.toHaveBeenCalled();
    });

    it("ends the session when uWS drops a frame that the store, over its limit, no longer has to send again", () => {
        const { raw, rawSocket } = createRaw(2);
        const socket = new PusherWebSocket(rawSocket, undefined, { ...UNLIMITED, maxMessages: 1 });

        socket.send(message);
        expect(raw.end).not.toHaveBeenCalled();
        socket.send(message);

        expect(raw.end).toHaveBeenCalledWith(WS_CLOSE_CODE_SESSION_DESTROYED, expect.any(String));
    });

    it("refuses the resume of a client that missed what a limit dropped, so that it starts again instead of replaying a gap", () => {
        const first = createRaw(1);
        const socket = new PusherWebSocket(first.rawSocket, undefined, { ...UNLIMITED, maxMessages: 3 });
        socket.send(message);
        socket.handleTransportClosed();
        // The client is away: frames 2 to 5 are kept for it until the fourth goes over the limit.
        for (let i = 0; i < 4; i++) {
            socket.send(message);
        }
        // Nothing to end: the transport is gone, and the resume is refused below.
        expect(first.raw.end).not.toHaveBeenCalled();

        const second = createRaw(1);
        expect(socket.replaceSocket(second.rawSocket, 1)).toBe(false);
        expect(second.raw.end).toHaveBeenCalledWith(1008, expect.any(String));
        expect(second.sent).toEqual([]);
    });

    it("replays what a client missed when nothing went over a limit, and only that", () => {
        const first = createRaw(1);
        const socket = new PusherWebSocket(first.rawSocket, undefined, { ...UNLIMITED, maxMessages: 100 });
        socket.send(message);
        socket.send(message);
        socket.handleTransportClosed();
        socket.send(message);
        socket.send(message);

        const second = createRaw(1);
        expect(socket.replaceSocket(second.rawSocket, 2)).toBe(true);

        expect(sentNonces(second.sent)).toEqual([3, 4]);
    });

    it("takes a resume from a client that already had everything a limit dropped", () => {
        const first = createRaw(1);
        const socket = new PusherWebSocket(first.rawSocket, undefined, { ...UNLIMITED, maxMessages: 2 });
        socket.handleTransportClosed();
        socket.send(message);
        socket.send(message);
        socket.send(message); // nonce 3: over the limit, 1 to 3 dropped
        socket.send(message); // nonce 4 is kept

        const second = createRaw(1);
        expect(socket.replaceSocket(second.rawSocket, 3)).toBe(true);
        expect(sentNonces(second.sent)).toEqual([4]);
    });
});

describe("PUSHER_RESUME_STORE_MAX_BYTES and PUSHER_RESUME_STORE_MAX_MESSAGES", () => {
    it("are off unless set", () => {
        const { shape } = EnvironmentVariables;

        expect(shape.PUSHER_RESUME_STORE_MAX_BYTES.parse(undefined)).toBe(0);
        expect(shape.PUSHER_RESUME_STORE_MAX_MESSAGES.parse(undefined)).toBe(0);
        expect(shape.PUSHER_RESUME_STORE_MAX_BYTES.parse("8388608")).toBe(8_388_608);
        expect(shape.PUSHER_RESUME_STORE_MAX_MESSAGES.parse("2000")).toBe(2_000);
        expect(() => shape.PUSHER_RESUME_STORE_MAX_BYTES.parse("-1")).toThrow();
        expect(() => shape.PUSHER_RESUME_STORE_MAX_MESSAGES.parse("many")).toThrow();
    });

    it("reach a socket made without options, as the pusher makes them, and stay off with the mocked defaults", () => {
        const { rawSocket } = createRaw(0);
        const socket = new PusherWebSocket(rawSocket);

        for (let i = 0; i < 3_000; i++) {
            socket.send(message);
        }

        expect(socket.retainedForResume().messages).toBe(3_000);
    });
});
