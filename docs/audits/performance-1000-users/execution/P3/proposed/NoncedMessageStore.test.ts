import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerToClientMessage } from "@workadventure/messages";

const frame = vi.hoisted(() => ({ byteLength: 4 }));

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
vi.mock("@workadventure/messages", () => ({
    PusherToFrontWebSocketMessage: {
        // A fake frame starts with its nonce, so a test can read back which frames reached a transport, in which order.
        encode: ({ nonce }: { nonce: number }) => ({
            finish: () => {
                const payload = new Uint8Array(frame.byteLength);
                new DataView(payload.buffer).setUint32(0, nonce);
                return payload;
            },
        }),
    },
}));

import { NoncedMessageStore } from "../../src/common/NoncedMessageStore";
import { WS_CLOSE_CODE_SESSION_DESTROYED } from "../../src/common/WebSocketCloseCodes";
import {
    PusherWebSocket,
    RESUME_STORE_MAX_BYTES,
    RESUME_STORE_MAX_MESSAGES,
    type RawSocket,
} from "../../src/pusher/services/PusherWebSocket";

const bytes = (length: number) => new Uint8Array(length);
const nonces = (messages: { nonce: number }[]) => messages.map(({ nonce }) => nonce);

describe("NoncedMessageStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("prunes expired messages, keeps fresh ones and frees their bytes", () => {
        const store = new NoncedMessageStore(1_000, Infinity, 3);
        store.add(1, bytes(1));
        store.add(2, bytes(1));
        vi.advanceTimersByTime(600);
        store.add(3, bytes(1));
        vi.advanceTimersByTime(400);

        expect(nonces(store.getAll())).toEqual([3]);
        // 1 and 2 no longer count towards the 3-byte cap.
        expect(store.add(4, bytes(2))).toBe(true);
    });

    it("keeps a message until its age reaches the retention, not one millisecond less", () => {
        const store = new NoncedMessageStore(1_000);
        store.add(1, bytes(1));

        vi.advanceTimersByTime(999);
        expect(nonces(store.getAll())).toEqual([1]);

        vi.advanceTimersByTime(1);
        expect(store.getAll()).toEqual([]);
    });

    it("returns the messages after a nonce", () => {
        const store = new NoncedMessageStore();
        for (let nonce = 1; nonce <= 5; nonce++) {
            store.add(nonce, bytes(1));
        }

        expect(nonces(store.getAfter(0))).toEqual([1, 2, 3, 4, 5]);
        expect(nonces(store.getAfter(3))).toEqual([4, 5]);
        expect(store.getAfter(5)).toEqual([]);
    });

    it("refuses a resume that needs an expired message and replays the rest in order", () => {
        const store = new NoncedMessageStore(1_000);
        store.add(1, bytes(1));
        store.add(2, bytes(1));
        vi.advanceTimersByTime(600);
        store.add(3, bytes(1));
        store.add(4, bytes(1));
        vi.advanceTimersByTime(400);

        expect(store.hasEveryNonceAfter(1)).toBe(false);
        expect(store.hasEveryNonceAfter(2)).toBe(true);
        expect(nonces(store.getAfter(2))).toEqual([3, 4]);
    });

    it("refuses a resume that needs an expired message once every message expired", () => {
        const store = new NoncedMessageStore(1_000);
        store.add(1, bytes(1));
        store.add(2, bytes(1));
        vi.advanceTimersByTime(1_000);

        expect(store.getAll()).toEqual([]);
        expect(store.hasEveryNonceAfter(1)).toBe(false);
        expect(store.hasEveryNonceAfter(2)).toBe(true);
    });

    it("drops everything past its caps and refuses a resume that needs a dropped message", () => {
        const store = new NoncedMessageStore(30_000, 2);
        expect(store.add(1, bytes(1))).toBe(true);
        expect(store.add(2, bytes(1))).toBe(true);
        expect(store.add(3, bytes(1))).toBe(false);

        expect(store.getAll()).toEqual([]);
        expect(store.hasEveryNonceAfter(2)).toBe(false);
        expect(store.hasEveryNonceAfter(3)).toBe(true);

        expect(new NoncedMessageStore(30_000, Infinity, 10).add(1, bytes(11))).toBe(false);
    });

    it("holds exactly its byte cap and starts over after an overflow", () => {
        const store = new NoncedMessageStore(30_000, Infinity, 10);
        expect(store.add(1, bytes(10))).toBe(true);
        expect(store.add(2, bytes(1))).toBe(false);
        // The dropped bytes no longer count towards the cap.
        expect(store.add(3, bytes(10))).toBe(true);

        expect(store.hasEveryNonceAfter(1)).toBe(false);
        expect(store.hasEveryNonceAfter(2)).toBe(true);
        expect(nonces(store.getAfter(2))).toEqual([3]);
    });
});

describe("PusherWebSocket resume store overflow", () => {
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
            send: vi.fn((_payload: Uint8Array<ArrayBuffer>, _isBinary: boolean) => sendStatus),
            end: vi.fn(),
            ping: vi.fn(() => 1),
            getUserData: () => ({ userUuid: "user-1", tabId: "tab-1" }),
        };
    }

    function sentNonces(rawSocket: ReturnType<typeof createRawSocket>): number[] {
        return rawSocket.send.mock.calls.map(([payload]) => new DataView(payload.buffer).getUint32(0));
    }

    it("destroys the session of a client stuck behind backpressure", () => {
        // uWS buffers the first frame, then every later one waits for a drain that never comes.
        const rawSocket = createRawSocket(0);
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);
        for (let i = 0; i < RESUME_STORE_MAX_MESSAGES; i++) {
            socket.send(message);
        }
        expect(rawSocket.end).not.toHaveBeenCalled();

        socket.send(message);

        expect(rawSocket.end).toHaveBeenCalledWith(WS_CLOSE_CODE_SESSION_DESTROYED, expect.any(String));
    });

    it("destroys the session when uWS drops the frame that overflowed the store", () => {
        const rawSocket = createRawSocket(1);
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);
        for (let i = 0; i < RESUME_STORE_MAX_MESSAGES; i++) {
            socket.send(message);
        }
        // 2 = dropped by uWS: the frame is neither on the wire nor in the store.
        rawSocket.send.mockReturnValueOnce(2);

        socket.send(message);

        expect(rawSocket.end).toHaveBeenCalledWith(WS_CLOSE_CODE_SESSION_DESTROYED, expect.any(String));
    });

    it("keeps a caught-up client connected when its store overflows", () => {
        const rawSocket = createRawSocket(1);
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);
        for (let i = 0; i <= RESUME_STORE_MAX_MESSAGES; i++) {
            socket.send(message);
        }

        expect(rawSocket.send).toHaveBeenCalledTimes(RESUME_STORE_MAX_MESSAGES + 1);
        expect(rawSocket.end).not.toHaveBeenCalled();
    });

    it("resumes a caught-up client after an overflow only if it got every dropped frame", () => {
        const rawSocket = createRawSocket(1);
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);
        // The frame with nonce RESUME_STORE_MAX_MESSAGES + 1 overflows the store; two more frames follow it.
        for (let i = 0; i < RESUME_STORE_MAX_MESSAGES + 3; i++) {
            socket.send(message);
        }
        socket.handleTransportClosed();

        const lateTransport = createRawSocket(1);
        expect(socket.replaceSocket(lateTransport as unknown as RawSocket, RESUME_STORE_MAX_MESSAGES)).toBe(false);
        expect(lateTransport.end).toHaveBeenCalledWith(1008, expect.any(String));
        expect(lateTransport.send).not.toHaveBeenCalled();

        const upToDateTransport = createRawSocket(1);
        expect(socket.replaceSocket(upToDateTransport as unknown as RawSocket, RESUME_STORE_MAX_MESSAGES + 1)).toBe(
            true,
        );
        expect(sentNonces(upToDateTransport)).toEqual([RESUME_STORE_MAX_MESSAGES + 2, RESUME_STORE_MAX_MESSAGES + 3]);
    });

    it("refuses the resume of a client whose store overflowed while its transport was down", () => {
        const rawSocket = createRawSocket(1);
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);
        socket.send(message);
        socket.handleTransportClosed();
        for (let i = 0; i <= RESUME_STORE_MAX_MESSAGES; i++) {
            socket.send(message);
        }
        // The transport is already gone: there is nothing to close.
        expect(rawSocket.end).not.toHaveBeenCalled();

        const newTransport = createRawSocket(1);
        expect(socket.replaceSocket(newTransport as unknown as RawSocket, 1)).toBe(false);
        expect(newTransport.end).toHaveBeenCalledWith(1008, expect.any(String));
        expect(newTransport.send).not.toHaveBeenCalled();
    });

    it("still delivers a single frame larger than the byte cap, without keeping it for a resume", () => {
        frame.byteLength = RESUME_STORE_MAX_BYTES + 1;
        // 0 = uWS buffered the frame as backpressure and still delivers it.
        const rawSocket = createRawSocket(0);
        const socket = new PusherWebSocket(rawSocket as unknown as RawSocket);

        socket.send(message);

        expect(sentNonces(rawSocket)).toEqual([1]);
        expect(rawSocket.end).not.toHaveBeenCalled();

        socket.handleTransportClosed();
        const newTransport = createRawSocket(1);
        expect(socket.replaceSocket(newTransport as unknown as RawSocket, 0)).toBe(false);
        expect(newTransport.end).toHaveBeenCalledWith(1008, expect.any(String));
    });
});
