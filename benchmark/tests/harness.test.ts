import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
    ErrorScreenMessage,
    FrontToPusherWebSocketMessage,
    PusherToFrontWebSocketMessage,
    RoomConnectedMessage,
    RoomJoinedMessage,
    type ServerToClientMessage,
} from "../../libs/messages/src/ts-proto-generated/messages";
import { ConfigError, type LoadConfig, parseConfig } from "../src/config";
import { buildRoomSocketUrl, decodeServerFrame, encodeClientFrame, userMovesMessage } from "../src/protocol";
import { runLoad } from "../src/runner";
import { nextState } from "../src/session";
import { percentile } from "../src/stats";

type ServerMessage = NonNullable<ServerToClientMessage["message"]>;

function serverFrame(nonce: number, message: ServerMessage): Uint8Array {
    return PusherToFrontWebSocketMessage.encode({ nonce, message: { message } }).finish();
}

/** Speaks the pusher side of the "/ws/room" handshake over a real socket. */
async function startFakePusher(mode: "accept" | "reject") {
    const observed = {
        tokens: [] as (string | undefined)[],
        roomIds: [] as (string | null)[],
        clientMessages: [] as string[],
        closeCodes: [] as number[],
    };
    let issuedTokens = 0;
    let lastUserId = 0;
    const http: Server = createServer((request, response) => {
        if (request.method === "POST" && request.url === "/anonymLogin") {
            issuedTokens += 1;
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ authToken: `token-${issuedTokens}`, userUuid: `uuid-${issuedTokens}` }));
            return;
        }
        response.statusCode = 404;
        response.end();
    });
    const sockets = new WebSocketServer({ server: http, path: "/ws/room" });
    sockets.on("connection", (socket, request) => {
        observed.tokens.push(request.headers["sec-websocket-protocol"]);
        observed.roomIds.push(new URL(request.url ?? "", "http://fake").searchParams.get("roomId"));
        socket.on("close", (code) => observed.closeCodes.push(code));
        if (mode === "reject") {
            const error = ErrorScreenMessage.fromPartial({ type: "retry", code: "NEW_VERSION" });
            socket.send(serverFrame(1, { $case: "errorScreenMessage", errorScreenMessage: error }));
            socket.close(1000, "Error message sent");
            return;
        }
        socket.send(
            serverFrame(1, { $case: "roomConnectedMessage", roomConnectedMessage: RoomConnectedMessage.fromPartial({}) }),
        );
        socket.on("message", (data: Buffer) => {
            const message = FrontToPusherWebSocketMessage.decode(data).message?.message;
            observed.clientMessages.push(message?.$case ?? "empty");
            if (message?.$case === "joinRoomFrontMessage") {
                lastUserId += 1;
                const joined = RoomJoinedMessage.fromPartial({ currentUserId: lastUserId });
                socket.send(serverFrame(2, { $case: "roomJoinedMessage", roomJoinedMessage: joined }));
            }
        });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    return {
        url,
        observed,
        openSockets: () => sockets.clients.size,
        close: () =>
            new Promise<void>((resolve) => {
                sockets.close();
                http.close(() => resolve());
            }),
    };
}

function configFor(pusherUrl: string, overrides: Partial<LoadConfig> = {}): LoadConfig {
    return {
        ...parseConfig([], {
            WA_PUSHER_URL: pusherUrl,
            WA_ROOM_URLS: "http://play.test/_/global/maps.test/a.json,http://play.test/_/global/maps.test/b.json",
            WA_SESSIONS: "3",
            WA_RAMP_SECONDS: "0.05",
            WA_DURATION_SECONDS: "0.5",
            WA_MOVE_HZ: "20",
        }),
        ...overrides,
    };
}

describe("protocol envelope", () => {
    it("wraps a client message in the nonce envelope the pusher decodes", () => {
        const frame = FrontToPusherWebSocketMessage.decode(encodeClientFrame(7, userMovesMessage({ x: 10, y: 20 })));

        expect(frame.nonce).toBe(7);
        expect(frame.message?.message).toMatchObject({
            $case: "userMovesMessage",
            userMovesMessage: { position: { x: 10, y: 20 }, viewport: { left: -310, right: 330 } },
        });
    });

    it("reports the authoritative join with the user id the server assigned", () => {
        const joined = RoomJoinedMessage.fromPartial({ currentUserId: 42 });

        const decoded = decodeServerFrame(serverFrame(3, { $case: "roomJoinedMessage", roomJoinedMessage: joined }));

        expect(decoded).toEqual({
            nonce: 3,
            eventTypes: ["roomJoinedMessage"],
            signals: [{ kind: "roomJoined", userId: 42 }],
        });
    });

    it("counts every batched event and answers only the ping", () => {
        const decoded = decodeServerFrame(
            serverFrame(4, {
                $case: "batchMessage",
                batchMessage: {
                    event: "",
                    payload: [
                        { message: { $case: "userLeftMessage", userLeftMessage: { userId: 1 } } },
                        { message: { $case: "pingMessage", pingMessage: {} } },
                    ],
                },
            }),
        );

        expect(decoded.eventTypes).toEqual(["userLeftMessage", "pingMessage"]);
        expect(decoded.signals).toEqual([{ kind: "ping" }]);
    });

    it("reports a refused upgrade as a rejection, never as a join", () => {
        const error = ErrorScreenMessage.fromPartial({ type: "retry", code: "NEW_VERSION" });

        const decoded = decodeServerFrame(serverFrame(1, { $case: "errorScreenMessage", errorScreenMessage: error }));

        expect(decoded.signals).toEqual([{ kind: "rejected", reason: "errorScreenMessage:NEW_VERSION" }]);
    });

    it("builds the websocket URL with the query the pusher validates", () => {
        const url = new URL(
            buildRoomSocketUrl({
                wsBaseUrl: "https://play.test",
                roomUrl: "https://play.test/_/global/maps.test/a.json",
                apiVersion: "dev",
                tabId: "tab",
                connectionId: "connection",
                characterTextureId: "male1",
            }),
        );

        expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("wss://play.test/ws/room");
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
            roomId: "https://play.test/_/global/maps.test/a.json",
            version: "dev",
            chatID: "",
            roomName: "",
            cameraState: "false",
            microphoneState: "false",
            tabId: "tab",
            characterTextureIds: "male1",
        });
    });
});

describe("session state machine", () => {
    it("accepts only a connecting session and keeps a rejected one rejected", () => {
        expect(nextState("connecting", "joined")).toBe("accepted");
        expect(nextState(nextState("connecting", "rejected"), "joined")).toBe("rejected");
        expect(nextState("leaving", "joined")).toBe("leaving");
        expect(nextState(nextState("accepted", "leave"), "socketClosed")).toBe("closed");
    });
});

describe("load run", () => {
    let pusher: Awaited<ReturnType<typeof startFakePusher>> | undefined;

    afterEach(async () => {
        await pusher?.close();
        pusher = undefined;
    });

    it("counts accepted room sessions per room and leaves with every socket and timer released", async () => {
        pusher = await startFakePusher("accept");

        const summary = await runLoad(configFor(pusher.url));

        expect(summary.sessions).toMatchObject({ started: 3, accepted: 3, rejected: 0, uniqueUserIds: 3 });
        expect(summary.sockets).toMatchObject({ opened: 3, openPeak: 3, closed: 3 });
        expect(summary.rooms.map((room) => room.accepted)).toEqual([2, 1]);
        expect(summary.joinLatencyMs.count).toBe(3);
        expect(summary.sent.userMovesMessage).toBeGreaterThan(0);
        expect(summary.cleanup).toEqual({ openSockets: 0, activeTimers: 0 });
        expect(summary.reconciled).toBe(true);
        expect(pusher.observed.tokens).toEqual(["token-1", "token-2", "token-3"]);
        expect(new Set(pusher.observed.clientMessages)).toEqual(
            new Set(["joinRoomFrontMessage", "viewportMessage", "userMovesMessage"]),
        );
        await expect.poll(() => pusher?.observed.closeCodes).toEqual([1000, 1000, 1000]);
    });

    it("counts a refused connection as rejected and not as an accepted session", async () => {
        pusher = await startFakePusher("reject");

        const summary = await runLoad(configFor(pusher.url, { sessions: 2 }));

        expect(summary.sessions).toMatchObject({ started: 2, accepted: 0, rejected: 2 });
        expect(summary.rejections).toEqual({ "errorScreenMessage:NEW_VERSION": 2 });
        expect(summary.joinLatencyMs).toEqual({ count: 0, p50: null, p95: null, max: null });
        expect(summary.cleanup).toEqual({ openSockets: 0, activeTimers: 0 });
        expect(summary.reconciled).toBe(true);
    });

    it("releases everything when stopped before the ramp completes", async () => {
        pusher = await startFakePusher("accept");
        const stop = new AbortController();
        const config = configFor(pusher.url, { sessions: 20, rampSeconds: 10, durationSeconds: 30 });
        setTimeout(() => stop.abort(), 700);

        const summary = await runLoad(config, stop.signal);

        expect(summary.stopReason).toBe("aborted");
        expect(summary.sessions.started).toBeGreaterThan(0);
        expect(summary.sessions.started).toBeLessThan(20);
        expect(summary.sessions.neverStarted).toBe(20 - summary.sessions.started);
        expect(summary.cleanup).toEqual({ openSockets: 0, activeTimers: 0 });
        expect(summary.reconciled).toBe(true);
        await expect.poll(() => pusher?.openSockets()).toBe(0);
    });
});

describe("configuration", () => {
    it("lets a command-line flag override the environment", () => {
        const config = parseConfig(["--sessions=5"], {
            WA_PUSHER_URL: "http://play.test",
            WA_ROOM_URLS: "http://play.test/_/global/maps.test/a.json",
            WA_SESSIONS: "1",
        });

        expect(config.sessions).toBe(5);
        expect(config.wsUrl).toBe("http://play.test");
    });

    it("refuses to start without a room", () => {
        expect(() => parseConfig([], { WA_PUSHER_URL: "http://play.test", WA_SESSIONS: "1" })).toThrow(ConfigError);
    });
});

describe("percentile", () => {
    it("uses the nearest rank and has no value for an empty sample", () => {
        expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
        expect(percentile([40, 10, 30, 20], 0.95)).toBe(40);
        expect(percentile([], 0.95)).toBeNull();
    });
});
