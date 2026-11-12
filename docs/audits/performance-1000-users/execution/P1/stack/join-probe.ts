// Readiness probe for the wa-fable stack: two anonymous clients join the same room through the pusher.
// Proves the authoritative path: anonymLogin -> /ws/room upgrade -> joinRoomFrontMessage -> back owns the room ->
// roomJoinedMessage, and that the back fans the second client's arrival out to the first one.
// Prints message case names and timings only. Never prints tokens.
//
// Run inside a throwaway container on wa-fable-net (see STACK.md):
//   cd /usr/src/app/play && TSX_TSCONFIG_PATH=tsconfig-pusher.json ../node_modules/.bin/tsx /probe/join-probe.ts
import { randomUUID } from "node:crypto";
import {
    FrontToPusherWebSocketMessage,
    PusherToFrontWebSocketMessage,
} from "/usr/src/app/libs/messages/src/ts-proto-generated/messages";

const HTTP_BASE = process.env.PUSHER_HTTP ?? "http://wa-fable-stack-play:3000";
const WS_BASE = process.env.PUSHER_WS ?? "ws://wa-fable-stack-play:3001";
const ROOM_URL = process.env.ROOM_URL ?? `${HTTP_BASE}/_/global/wa-fable-stack-maps/starter/map.json`;
const API_VERSION = process.env.API_VERSION ?? "dev";
const TIMEOUT_MS = 20_000;

interface Client {
    name: string;
    socket: WebSocket;
    userId: number;
    cases: string[];
    subCases: string[];
}

async function join(name: string, x: number): Promise<Client> {
    const t0 = performance.now();
    const loginResponse = await fetch(`${HTTP_BASE}/anonymLogin`, { method: "POST" });
    const login = (await loginResponse.json()) as { authToken: string; userUuid: string };
    const tLogin = performance.now();
    console.log(
        `${name} anonymLogin status=${loginResponse.status} ms=${(tLogin - t0).toFixed(1)} tokenLength=${login.authToken.length}`,
    );

    const url = new URL("/ws/room", WS_BASE);
    url.searchParams.set("roomId", ROOM_URL);
    url.searchParams.set("version", API_VERSION);
    url.searchParams.set("chatID", "");
    url.searchParams.set("roomName", "wa-fable-probe");
    url.searchParams.set("cameraState", "false");
    url.searchParams.set("microphoneState", "false");
    url.searchParams.set("tabId", randomUUID());
    url.searchParams.set("connectionId", randomUUID());

    const client: Client = { name, socket: new WebSocket(url, [login.authToken]), userId: -1, cases: [], subCases: [] };
    client.socket.binaryType = "arraybuffer";

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${name}: no roomJoinedMessage within ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
        client.socket.addEventListener("open", () => {
            console.log(`${name} ws open ms=${(performance.now() - tLogin).toFixed(1)}`);
            client.socket.send(
                // Every frame is wrapped in a transport envelope carrying a strictly increasing nonce (first = 1).
                FrontToPusherWebSocketMessage.encode({
                    nonce: 1,
                    message: {
                        message: {
                            $case: "joinRoomFrontMessage",
                            joinRoomFrontMessage: {
                                positionMessage: { x, y: 400, direction: 2, moving: false },
                                viewportMessage: { left: 0, top: 0, right: 1600, bottom: 1200 },
                                name,
                                availabilityStatus: 1,
                            },
                        },
                    },
                }).finish(),
            );
        });
        client.socket.addEventListener("message", (event) => {
            const frame = PusherToFrontWebSocketMessage.decode(new Uint8Array(event.data as ArrayBuffer));
            const decoded = frame.message;
            if (!decoded) {
                return;
            }
            const messageCase = decoded.message?.$case ?? "undefined";
            client.cases.push(messageCase);
            if (decoded.message?.$case === "batchMessage") {
                for (const sub of decoded.message.batchMessage.payload) {
                    client.subCases.push(sub.message?.$case ?? "undefined");
                }
            }
            if (decoded.message?.$case === "roomJoinedMessage") {
                client.userId = decoded.message.roomJoinedMessage.currentUserId;
                console.log(
                    `${name} roomJoinedMessage currentUserId=${client.userId} msSinceLogin=${(performance.now() - tLogin).toFixed(1)}`,
                );
                clearTimeout(timer);
                resolve();
            }
            if (decoded.message?.$case === "errorMessage" || decoded.message?.$case === "errorScreenMessage") {
                clearTimeout(timer);
                reject(new Error(`${name}: server sent ${messageCase}: ${JSON.stringify(decoded.message)}`));
            }
        });
        client.socket.addEventListener("close", (event) => {
            clearTimeout(timer);
            reject(new Error(`${name}: socket closed before join, code=${event.code} reason=${event.reason}`));
        });
        client.socket.addEventListener("error", () => {
            clearTimeout(timer);
            reject(new Error(`${name}: socket error before join`));
        });
    });
    return client;
}

async function main(): Promise<void> {
    console.log(`room=${ROOM_URL}`);
    const a = await join("probeA", 400);
    const b = await join("probeB", 432);

    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !a.subCases.includes("userJoinedMessage")) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.log(`probeA top-level cases: ${[...new Set(a.cases)].join(",")}`);
    console.log(`probeA batch sub-cases: ${[...new Set(a.subCases)].join(",")}`);
    console.log(`probeB top-level cases: ${[...new Set(b.cases)].join(",")}`);
    console.log(`probeB batch sub-cases: ${[...new Set(b.subCases)].join(",")}`);

    const sawPeer = a.subCases.includes("userJoinedMessage");
    a.socket.close();
    b.socket.close();
    if (a.userId < 0 || b.userId < 0 || a.userId === b.userId) {
        throw new Error("join did not yield two distinct user ids");
    }
    if (!sawPeer) {
        throw new Error("probeA never received userJoinedMessage for probeB");
    }
    console.log("PROBE_OK two clients joined; back fanned out userJoinedMessage");
}

main().then(
    () => process.exit(0),
    (error: unknown) => {
        console.error("PROBE_FAILED", error instanceof Error ? error.message : error);
        process.exit(1);
    },
);
