import {
    AvailabilityStatus,
    type ClientToServerMessage,
    FrontToPusherWebSocketMessage,
    PositionMessage_Direction,
    PusherToFrontWebSocketMessage,
    type ServerToClientMessage,
} from "../../libs/messages/src/ts-proto-generated/messages";

export type ClientMessage = NonNullable<ClientToServerMessage["message"]>;
export type ServerMessage = NonNullable<ServerToClientMessage["message"]>;

export interface Position {
    x: number;
    y: number;
}

export interface RoomSocketParams {
    wsBaseUrl: string;
    roomUrl: string;
    apiVersion: string;
    tabId: string;
    connectionId: string;
    characterTextureId: string;
}

/**
 * Mirrors the query string the browser sends (RoomConnection + WorkAdventureWebSocket) and that the pusher
 * validates before upgrading "/ws/room".
 */
export function buildRoomSocketUrl(params: RoomSocketParams): string {
    const url = new URL("ws/room", withTrailingSlash(params.wsBaseUrl));
    url.protocol = url.protocol.replace("http", "ws");
    const query = url.searchParams;
    query.set("roomId", params.roomUrl);
    query.append("characterTextureIds", params.characterTextureId);
    query.set("version", params.apiVersion);
    query.set("chatID", "");
    query.set("roomName", "");
    query.set("cameraState", "false");
    query.set("microphoneState", "false");
    query.set("tabId", params.tabId);
    query.set("screenSharingState", "false");
    query.set("connectionId", params.connectionId);
    return url.toString();
}

export function withTrailingSlash(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
}

export function encodeClientFrame(nonce: number, message: ClientMessage): Uint8Array {
    return FrontToPusherWebSocketMessage.encode({ nonce, message: { message } }).finish();
}

const VIEWPORT_HALF_WIDTH = 320;
const VIEWPORT_HALF_HEIGHT = 200;

export interface Viewport {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export function viewportAround(position: Position): Viewport {
    return {
        left: position.x - VIEWPORT_HALF_WIDTH,
        top: position.y - VIEWPORT_HALF_HEIGHT,
        right: position.x + VIEWPORT_HALF_WIDTH,
        bottom: position.y + VIEWPORT_HALF_HEIGHT,
    };
}

function positionMessage(position: Position, moving: boolean) {
    return { x: position.x, y: position.y, direction: PositionMessage_Direction.DOWN, moving };
}

export function joinRoomMessage(name: string, position: Position): ClientMessage {
    return {
        $case: "joinRoomFrontMessage",
        joinRoomFrontMessage: {
            name,
            positionMessage: positionMessage(position, false),
            viewportMessage: viewportAround(position),
            availabilityStatus: AvailabilityStatus.ONLINE,
        },
    };
}

export function userMovesMessage(position: Position): ClientMessage {
    return {
        $case: "userMovesMessage",
        userMovesMessage: { position: positionMessage(position, true), viewport: viewportAround(position) },
    };
}

export function viewportMessage(position: Position): ClientMessage {
    return { $case: "viewportMessage", viewportMessage: viewportAround(position) };
}

export function pongMessage(): ClientMessage {
    return { $case: "pingMessage", pingMessage: {} };
}

/**
 * What one server frame means for a session. "rejected" is the single error message the pusher sends on a
 * refused upgrade before closing; it must never be confused with an accepted room session.
 */
export type ServerSignal =
    | { kind: "roomConnected" }
    | { kind: "roomJoined"; userId: number }
    | { kind: "rejected"; reason: string }
    | { kind: "ping" }
    | { kind: "serverError"; message: string };

export interface ReceivedMove {
    userId: number;
    x: number;
    y: number;
}

export interface DecodedServerFrame {
    nonce: number;
    /** One entry per logical event; batched sub-messages are flattened and counted individually. */
    eventTypes: string[];
    signals: ServerSignal[];
    /** Positions of other users' moves and zone entries, used by the move probe; empty unless collected. */
    moves: ReceivedMove[];
}

const REJECTION_CASES = new Set<ServerMessage["$case"]>([
    "errorScreenMessage",
    "tokenExpiredMessage",
    "invalidCharacterTextureMessage",
    "invalidCompanionTextureMessage",
    "worldConnectionMessage",
    "banUserMessage",
]);

export function decodeServerFrame(bytes: Uint8Array, collectMoves = false): DecodedServerFrame {
    const frame = PusherToFrontWebSocketMessage.decode(bytes);
    const message = frame.message?.message;
    if (message === undefined) {
        return { nonce: frame.nonce, eventTypes: ["emptyMessage"], signals: [], moves: [] };
    }

    if (message.$case === "batchMessage") {
        const eventTypes: string[] = [];
        const signals: ServerSignal[] = [];
        const moves: ReceivedMove[] = [];
        for (const subMessage of message.batchMessage.payload) {
            const inner = subMessage.message;
            if (inner === undefined) {
                continue;
            }
            eventTypes.push(inner.$case);
            if (inner.$case === "pingMessage") {
                signals.push({ kind: "ping" });
            } else if (inner.$case === "errorMessage") {
                signals.push({ kind: "serverError", message: inner.errorMessage.message });
            } else if (collectMoves && inner.$case === "userMovedMessage") {
                pushMove(moves, inner.userMovedMessage);
            } else if (collectMoves && inner.$case === "userJoinedMessage") {
                // A mover that crosses from an unwatched zone into a watched one arrives as a join, not as a move.
                pushMove(moves, inner.userJoinedMessage);
            }
        }
        return { nonce: frame.nonce, eventTypes, signals, moves };
    }

    // The pusher sends user moves only inside a batch; a top-level one is not part of the protocol.
    return { nonce: frame.nonce, eventTypes: [message.$case], signals: toSignals(message), moves: [] };
}

function pushMove(moves: ReceivedMove[], moved: { userId: number; position: Position | undefined }): void {
    if (moved.position !== undefined) {
        moves.push({ userId: moved.userId, x: moved.position.x, y: moved.position.y });
    }
}

function toSignals(message: ServerMessage): ServerSignal[] {
    if (message.$case === "roomConnectedMessage") {
        return [{ kind: "roomConnected" }];
    }
    if (message.$case === "roomJoinedMessage") {
        return [{ kind: "roomJoined", userId: message.roomJoinedMessage.currentUserId }];
    }
    if (message.$case === "errorMessage") {
        return [{ kind: "serverError", message: message.errorMessage.message }];
    }
    if (message.$case === "errorScreenMessage") {
        const code = message.errorScreenMessage.code ?? message.errorScreenMessage.type;
        return [{ kind: "rejected", reason: `errorScreenMessage:${code}` }];
    }
    if (REJECTION_CASES.has(message.$case)) {
        return [{ kind: "rejected", reason: message.$case }];
    }
    return [];
}
