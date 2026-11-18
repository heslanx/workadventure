import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
    ErrorScreenMessage,
    FrontToPusherWebSocketMessage,
    PusherToFrontWebSocketMessage,
    RoomConnectedMessage,
    RoomJoinedMessage,
    type ServerToClientMessage,
    type SubMessage,
    SpaceUser,
    UserJoinedMessage,
} from "../../../libs/messages/src/ts-proto-generated/messages";

export type ServerMessage = NonNullable<ServerToClientMessage["message"]>;
type SubMessageBody = NonNullable<SubMessage["message"]>;

export const WORLD_SPACE = "allWorldUser";

export function serverFrame(nonce: number, message: ServerMessage): Uint8Array {
    return PusherToFrontWebSocketMessage.encode({ nonce, message: { message } }).finish();
}

export function batchFrame(nonce: number, ...payload: SubMessageBody[]): Uint8Array {
    return serverFrame(nonce, {
        $case: "batchMessage",
        batchMessage: { event: "", payload: payload.map((message) => ({ message })) },
    });
}

function userJoined(userId: number): SubMessageBody {
    return { $case: "userJoinedMessage", userJoinedMessage: UserJoinedMessage.fromPartial({ userId }) };
}

export interface ObservedMove {
    /** performance.now() when the fake pusher received the move. */
    at: number;
    x: number;
    y: number;
    moving: boolean;
    viewportWidth: number;
    viewportHeight: number;
}

/**
 * Speaks the pusher side of the "/ws/room" handshake over a real socket, and just enough of the space protocol to
 * show what a world-space member and a watcher receive: a state patch for every member, a snapshot and live changes
 * for a watcher.
 */
export async function startFakePusher(mode: "accept" | "reject", options: { announceJoins?: boolean } = {}) {
    const observed = {
        tokens: [] as (string | undefined)[],
        roomIds: [] as (string | null)[],
        clientMessages: [] as string[],
        closeCodes: [] as number[],
        names: [] as string[],
        /** Moves received, per user name. */
        movesByName: new Map<string, ObservedMove[]>(),
        spaceJoins: 0,
        spaceFilters: 0,
    };
    let issuedTokens = 0;
    // Like the back, every room numbers its users from 1.
    const lastUserIdByRoom = new Map<string | null, number>();
    const membersByRoom = new Map<string | null, Map<WebSocket, number>>();
    const worldMembers = new Map<WebSocket, SpaceUser>();
    const worldWatchers = new Set<WebSocket>();
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
    const sendTo = (socket: WebSocket, frame: Uint8Array) => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(frame);
        }
    };
    sockets.on("connection", (socket, request) => {
        observed.tokens.push(request.headers["sec-websocket-protocol"]);
        const roomId = new URL(request.url ?? "", "http://fake").searchParams.get("roomId");
        observed.roomIds.push(roomId);
        socket.on("close", (code) => observed.closeCodes.push(code));
        if (mode === "reject") {
            const error = ErrorScreenMessage.fromPartial({ type: "retry", code: "NEW_VERSION" });
            socket.send(serverFrame(1, { $case: "errorScreenMessage", errorScreenMessage: error }));
            socket.close(1000, "Error message sent");
            return;
        }
        socket.send(
            serverFrame(1, {
                $case: "roomConnectedMessage",
                roomConnectedMessage: RoomConnectedMessage.fromPartial({}),
            }),
        );
        const members = membersByRoom.get(roomId) ?? new Map<WebSocket, number>();
        membersByRoom.set(roomId, members);
        let name = "";
        socket.on("close", () => {
            const leftUserId = members.get(socket);
            members.delete(socket);
            if (options.announceJoins === true && leftUserId !== undefined) {
                for (const other of members.keys()) {
                    sendTo(other, batchFrame(9, { $case: "userLeftMessage", userLeftMessage: { userId: leftUserId } }));
                }
            }
            worldWatchers.delete(socket);
            const leaver = worldMembers.get(socket);
            if (leaver !== undefined) {
                worldMembers.delete(socket);
                for (const watcher of worldWatchers) {
                    sendTo(
                        watcher,
                        batchFrame(5, {
                            $case: "removeSpaceUserMessage",
                            removeSpaceUserMessage: { spaceName: WORLD_SPACE, spaceUserId: leaver.spaceUserId },
                        }),
                    );
                }
            }
        });
        socket.on("message", (data: Buffer) => {
            const message = FrontToPusherWebSocketMessage.decode(data).message?.message;
            observed.clientMessages.push(message?.$case ?? "empty");
            if (message?.$case === "joinRoomFrontMessage") {
                name = message.joinRoomFrontMessage.name;
                observed.names.push(name);
                const userId = (lastUserIdByRoom.get(roomId) ?? 0) + 1;
                lastUserIdByRoom.set(roomId, userId);
                members.set(socket, userId);
                const joined = RoomJoinedMessage.fromPartial({ currentUserId: userId });
                socket.send(serverFrame(2, { $case: "roomJoinedMessage", roomJoinedMessage: joined }));
                if (options.announceJoins === true) {
                    // Like the pusher, tell the newcomer who is around and everyone else that it arrived. The
                    // messages carry no position, so they never count as a move arrival in the probe.
                    for (const [other, otherId] of members) {
                        if (other !== socket) {
                            sendTo(socket, batchFrame(8, userJoined(otherId)));
                            sendTo(other, batchFrame(8, userJoined(userId)));
                        }
                    }
                }
            } else if (message?.$case === "userMovesMessage") {
                // Like the pusher, relay a move to every other user of the room inside a batch.
                const userId = members.get(socket);
                const position = message.userMovesMessage.position;
                const viewport = message.userMovesMessage.viewport;
                if (userId === undefined || position === undefined) {
                    return;
                }
                const seen = observed.movesByName.get(name) ?? [];
                seen.push({
                    at: performance.now(),
                    x: position.x,
                    y: position.y,
                    moving: position.moving,
                    viewportWidth: viewport === undefined ? 0 : viewport.right - viewport.left,
                    viewportHeight: viewport === undefined ? 0 : viewport.bottom - viewport.top,
                });
                observed.movesByName.set(name, seen);
                const moved = batchFrame(3, { $case: "userMovedMessage", userMovedMessage: { userId, position } });
                for (const other of members.keys()) {
                    if (other !== socket) {
                        sendTo(other, moved);
                    }
                }
            } else if (
                message?.$case === "queryMessage" &&
                message.queryMessage.query?.$case === "joinSpaceQuery" &&
                message.queryMessage.query.joinSpaceQuery.spaceName === WORLD_SPACE
            ) {
                observed.spaceJoins += 1;
                const spaceUser = SpaceUser.fromPartial({ spaceUserId: `space-user-${observed.spaceJoins}`, name });
                worldMembers.set(socket, spaceUser);
                socket.send(
                    serverFrame(4, {
                        $case: "answerMessage",
                        answerMessage: {
                            id: message.queryMessage.id,
                            answer: {
                                $case: "joinSpaceAnswer",
                                joinSpaceAnswer: { spaceUserId: spaceUser.spaceUserId },
                            },
                        },
                    }),
                );
                // A member gets the space state without asking; only a watcher gets the users.
                sendTo(
                    socket,
                    batchFrame(6, {
                        $case: "spaceStatePatchMessage",
                        spaceStatePatchMessage: { spaceName: WORLD_SPACE, patch: "[]" },
                    }),
                );
                for (const watcher of worldWatchers) {
                    sendTo(
                        watcher,
                        batchFrame(5, {
                            $case: "addSpaceUserMessage",
                            addSpaceUserMessage: { spaceName: WORLD_SPACE, user: spaceUser },
                        }),
                    );
                }
            } else if (message?.$case === "addSpaceFilterMessage") {
                observed.spaceFilters += 1;
                worldWatchers.add(socket);
                sendTo(
                    socket,
                    batchFrame(7, {
                        $case: "initSpaceUsersMessage",
                        initSpaceUsersMessage: {
                            spaceName: WORLD_SPACE,
                            users: [...worldMembers.values()],
                            metadata: "",
                            state: "",
                        },
                    }),
                );
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
