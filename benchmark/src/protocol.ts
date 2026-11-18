import {
    AvailabilityStatus,
    type ClientToServerMessage,
    FilterType,
    FrontToPusherWebSocketMessage,
    PositionMessage_Direction,
    PusherToFrontWebSocketMessage,
    type ServerToClientMessage,
    type SubMessage,
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

/** The map the bots move on: the Konclui office is 86 x 56 tiles of 32 px. */
export const MAP_BOUNDS = { width: 2752, height: 1792 };

/**
 * bot: the 640 x 400 box every baseline used. browser: a 960 x 540 canvas plus the 300 px margin the client adds
 * (SERVER_VIEWPORT_MARGIN) on each side, clipped to the map. zoomout: the whole map, the camera at its minimum zoom.
 */
export const VIEWPORT_KINDS = ["bot", "browser", "zoomout"] as const;
export type ViewportKind = (typeof VIEWPORT_KINDS)[number];

const BROWSER_HALF_WIDTH = 960 / 2 + 300;
const BROWSER_HALF_HEIGHT = 540 / 2 + 300;

export function viewportAround(position: Position): Viewport {
    return {
        left: position.x - VIEWPORT_HALF_WIDTH,
        top: position.y - VIEWPORT_HALF_HEIGHT,
        right: position.x + VIEWPORT_HALF_WIDTH,
        bottom: position.y + VIEWPORT_HALF_HEIGHT,
    };
}

/** The rectangle the client reports to the pusher for a camera centred on `position`. */
export function viewportFor(kind: ViewportKind, position: Position): Viewport {
    switch (kind) {
        case "bot":
            return viewportAround(position);
        case "browser":
            return {
                left: Math.max(0, position.x - BROWSER_HALF_WIDTH),
                top: Math.max(0, position.y - BROWSER_HALF_HEIGHT),
                right: Math.min(MAP_BOUNDS.width, position.x + BROWSER_HALF_WIDTH),
                bottom: Math.min(MAP_BOUNDS.height, position.y + BROWSER_HALF_HEIGHT),
            };
        case "zoomout":
            return {
                left: 0,
                top: 0,
                right: MAP_BOUNDS.width,
                bottom: MAP_BOUNDS.height,
            };
    }
}

function positionMessage(position: Position, moving: boolean) {
    return { x: position.x, y: position.y, direction: PositionMessage_Direction.DOWN, moving };
}

export function joinRoomMessage(
    name: string,
    position: Position,
    viewport: Viewport = viewportAround(position),
): ClientMessage {
    return {
        $case: "joinRoomFrontMessage",
        joinRoomFrontMessage: {
            name,
            positionMessage: positionMessage(position, false),
            viewportMessage: viewport,
            availabilityStatus: AvailabilityStatus.ONLINE,
        },
    };
}

export function userMovesMessage(
    position: Position,
    viewport: Viewport = viewportAround(position),
    moving = true,
): ClientMessage {
    return {
        $case: "userMovesMessage",
        userMovesMessage: { position: positionMessage(position, moving), viewport },
    };
}

export function viewportMessage(position: Position, viewport: Viewport = viewportAround(position)): ClientMessage {
    return { $case: "viewportMessage", viewportMessage: viewport };
}

/** The space every client joins at scene start; its roster is the world's online list. */
export const WORLD_SPACE_NAME = "allWorldUser";
const WORLD_SPACE_PROPERTIES = ["availabilityStatus", "chatID"];

/** Exactly what GameScene sends to join the world space: a query answered with the member's space user id. */
export function joinWorldSpaceMessage(queryId: number): ClientMessage {
    return {
        $case: "queryMessage",
        queryMessage: {
            id: queryId,
            query: {
                $case: "joinSpaceQuery",
                joinSpaceQuery: {
                    spaceName: WORLD_SPACE_NAME,
                    filterType: FilterType.ALL_USERS,
                    propertiesToSync: WORLD_SPACE_PROPERTIES,
                },
            },
        },
    };
}

/** What subscribing to the space's user list sends: from then on the pusher streams every roster change. */
export function watchWorldSpaceMessage(): ClientMessage {
    return {
        $case: "addSpaceFilterMessage",
        addSpaceFilterMessage: {
            spaceFilterMessage: { spaceName: WORLD_SPACE_NAME },
        },
    };
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
    | { kind: "serverError"; message: string }
    /** The pusher answered query `id`; `error` is set when the answer is an error. */
    | { kind: "queryAnswer"; id: number; error?: string };

export interface ReceivedMove {
    userId: number;
    x: number;
    y: number;
}

/** Space messages the pusher streams to a space member or watcher; the roster cost lives in these five. */
export const SPACE_ROSTER_CASES = [
    "initSpaceUsersMessage",
    "addSpaceUserMessage",
    "removeSpaceUserMessage",
    "updateSpaceUserMessage",
    "spaceStatePatchMessage",
] as const;
export type SpaceRosterCase = (typeof SPACE_ROSTER_CASES)[number];

/** One logical event of a frame and what it cost on the wire. */
export interface AccountedMessage {
    type: string;
    /** Encoded size including the batch entry's tag and length prefix, so the parts add up to the frame. */
    bytes: number;
    /** Set for the five roster cases only. */
    spaceName?: string;
    /** Rows carried: the users of an initSpaceUsersMessage, otherwise 1. */
    records: number;
}

export interface FrameAccounting {
    messages: AccountedMessage[];
    /** Frame bytes not attributed to a message: nonce, envelope and batch headers. */
    overheadBytes: number;
}

export interface DecodedServerFrame {
    nonce: number;
    /** One entry per logical event; batched sub-messages are flattened and counted individually. */
    eventTypes: string[];
    signals: ServerSignal[];
    /** Positions of other users' moves and zone entries, used by the move probe; empty unless collected. */
    moves: ReceivedMove[];
    /** Bytes by message type; only present when requested, since it walks the frame a second time. */
    accounting?: FrameAccounting;
}

const REJECTION_CASES = new Set<ServerMessage["$case"]>([
    "errorScreenMessage",
    "tokenExpiredMessage",
    "invalidCharacterTextureMessage",
    "invalidCompanionTextureMessage",
    "worldConnectionMessage",
    "banUserMessage",
]);

export function decodeServerFrame(bytes: Uint8Array, collectMoves = false, withAccounting = false): DecodedServerFrame {
    const frame = PusherToFrontWebSocketMessage.decode(bytes);
    const message = frame.message?.message;
    if (message === undefined) {
        const accounting = withAccounting
            ? {
                  messages: [{ type: "emptyMessage", bytes: bytes.byteLength, records: 1 }],
                  overheadBytes: 0,
              }
            : undefined;
        return {
            nonce: frame.nonce,
            eventTypes: ["emptyMessage"],
            signals: [],
            moves: [],
            accounting,
        };
    }

    if (message.$case === "batchMessage") {
        const eventTypes: string[] = [];
        const signals: ServerSignal[] = [];
        const moves: ReceivedMove[] = [];
        const entryBytes = withAccounting ? batchEntryWireSizes(bytes) : [];
        const accounted: AccountedMessage[] = [];
        let attributedBytes = 0;
        for (const [position, subMessage] of message.batchMessage.payload.entries()) {
            const inner = subMessage.message;
            if (inner === undefined) {
                continue;
            }
            eventTypes.push(inner.$case);
            if (withAccounting && entryBytes[position] !== undefined) {
                attributedBytes += entryBytes[position];
                accounted.push(accountFor(inner, entryBytes[position]));
            }
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
        const accounting = withAccounting
            ? {
                  messages: accounted,
                  overheadBytes: bytes.byteLength - attributedBytes,
              }
            : undefined;
        return { nonce: frame.nonce, eventTypes, signals, moves, accounting };
    }

    // The pusher sends user moves only inside a batch; a top-level one is not part of the protocol.
    const accounting = withAccounting
        ? {
              messages: [{ type: message.$case, bytes: bytes.byteLength, records: 1 }],
              overheadBytes: 0,
          }
        : undefined;
    return {
        nonce: frame.nonce,
        eventTypes: [message.$case],
        signals: toSignals(message),
        moves: [],
        accounting,
    };
}

type SubMessageBody = NonNullable<SubMessage["message"]>;

function accountFor(inner: SubMessageBody, bytes: number): AccountedMessage {
    switch (inner.$case) {
        case "initSpaceUsersMessage":
            return {
                type: inner.$case,
                bytes,
                spaceName: inner.initSpaceUsersMessage.spaceName,
                records: inner.initSpaceUsersMessage.users.length,
            };
        case "addSpaceUserMessage":
            return {
                type: inner.$case,
                bytes,
                spaceName: inner.addSpaceUserMessage.spaceName,
                records: 1,
            };
        case "removeSpaceUserMessage":
            return {
                type: inner.$case,
                bytes,
                spaceName: inner.removeSpaceUserMessage.spaceName,
                records: 1,
            };
        case "updateSpaceUserMessage":
            return {
                type: inner.$case,
                bytes,
                spaceName: inner.updateSpaceUserMessage.spaceName,
                records: 1,
            };
        case "spaceStatePatchMessage":
            return {
                type: inner.$case,
                bytes,
                spaceName: inner.spaceStatePatchMessage.spaceName,
                records: 1,
            };
        default:
            return { type: inner.$case, bytes, records: 1 };
    }
}

/** Reads a protobuf varint at `offset`; `end` is one past its last byte. Returns undefined on a truncated varint. */
function readVarint(bytes: Uint8Array, offset: number): { value: number; end: number } | undefined {
    let value = 0;
    let multiplier = 1;
    for (let cursor = offset; cursor < bytes.length && cursor < offset + 10; cursor++) {
        value += (bytes[cursor] & 0x7f) * multiplier;
        if ((bytes[cursor] & 0x80) === 0) {
            return { value, end: cursor + 1 };
        }
        multiplier *= 128;
    }
    return undefined;
}

interface Region {
    start: number;
    end: number;
}

/**
 * Finds the first length-delimited field `fieldNumber` between start and end, skipping every other field. The decoder
 * already accepted the frame, so a malformed one simply yields undefined here.
 */
function findLengthDelimited(bytes: Uint8Array, region: Region, fieldNumber: number): Region | undefined {
    let cursor = region.start;
    while (cursor < region.end) {
        const tag = readVarint(bytes, cursor);
        if (tag === undefined) {
            return undefined;
        }
        const wireType = tag.value % 8;
        const field = Math.floor(tag.value / 8);
        cursor = tag.end;
        if (wireType === 0) {
            const skipped = readVarint(bytes, cursor);
            if (skipped === undefined) {
                return undefined;
            }
            cursor = skipped.end;
        } else if (wireType === 2) {
            const length = readVarint(bytes, cursor);
            if (length === undefined) {
                return undefined;
            }
            if (field === fieldNumber) {
                return { start: length.end, end: length.end + length.value };
            }
            cursor = length.end + length.value;
        } else if (wireType === 1) {
            cursor += 8;
        } else if (wireType === 5) {
            cursor += 4;
        } else {
            return undefined;
        }
    }
    return undefined;
}

/** Field numbers in messages.proto: PusherToFrontWebSocketMessage.message, ServerToClientMessage.batchMessage, BatchMessage.payload. */
const FRAME_MESSAGE_FIELD = 2;
const BATCH_MESSAGE_FIELD = 1;
const BATCH_PAYLOAD_FIELD = 2;

/**
 * Wire size of every entry of a batch frame, in payload order, each counting its tag and length prefix: the figures add
 * up to the frame minus its headers. Reads the lengths straight off the bytes, so it costs far less than encoding every
 * decoded sub-message again.
 */
export function batchEntryWireSizes(bytes: Uint8Array): number[] {
    const message = findLengthDelimited(bytes, { start: 0, end: bytes.length }, FRAME_MESSAGE_FIELD);
    const batch = message === undefined ? undefined : findLengthDelimited(bytes, message, BATCH_MESSAGE_FIELD);
    if (batch === undefined) {
        return [];
    }
    const sizes: number[] = [];
    let cursor = batch.start;
    while (cursor < batch.end) {
        const tag = readVarint(bytes, cursor);
        if (tag === undefined) {
            break;
        }
        const wireType = tag.value % 8;
        const field = Math.floor(tag.value / 8);
        if (wireType === 2) {
            const length = readVarint(bytes, tag.end);
            if (length === undefined) {
                break;
            }
            if (field === BATCH_PAYLOAD_FIELD) {
                sizes.push(length.end + length.value - cursor);
            }
            cursor = length.end + length.value;
        } else if (wireType === 0) {
            const skipped = readVarint(bytes, tag.end);
            if (skipped === undefined) {
                break;
            }
            cursor = skipped.end;
        } else {
            break;
        }
    }
    return sizes;
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
    if (message.$case === "answerMessage") {
        const answer = message.answerMessage.answer;
        return [
            {
                kind: "queryAnswer",
                id: message.answerMessage.id,
                error: answer?.$case === "error" ? answer.error.message : undefined,
            },
        ];
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
