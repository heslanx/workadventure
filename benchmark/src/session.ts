import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
    type ClientMessage,
    type Position,
    buildRoomSocketUrl,
    decodeServerFrame,
    encodeClientFrame,
    joinRoomMessage,
    pongMessage,
    userMovesMessage,
    viewportMessage,
    withTrailingSlash,
} from "./protocol";
import { type RunStats, type TimerRegistry, increment } from "./stats";

export type SessionState = "idle" | "connecting" | "accepted" | "rejected" | "leaving" | "closed";
export type SessionEvent = "start" | "joined" | "rejected" | "leave" | "socketClosed";

/**
 * connecting -> accepted (authoritative RoomJoinedMessage) | rejected (error message, error or close before
 * the join) -> leaving -> closed. An event that is not valid in the current state leaves it unchanged.
 */
export function nextState(state: SessionState, event: SessionEvent): SessionState {
    switch (event) {
        case "start":
            return state === "idle" ? "connecting" : state;
        case "joined":
            return state === "connecting" ? "accepted" : state;
        case "rejected":
            return state === "connecting" ? "rejected" : state;
        case "leave":
            return state === "connecting" || state === "accepted" || state === "rejected" ? "leaving" : state;
        case "socketClosed":
            return state === "idle" ? state : "closed";
    }
}

export interface SessionOptions {
    index: number;
    name: string;
    pusherUrl: string;
    wsUrl: string;
    roomUrl: string;
    apiVersion: string;
    characterTextureId: string;
    auth: "anonymous" | "none";
    moveHz: number;
    joinTimeoutMs: number;
    closeTimeoutMs: number;
}

const CLOSE_CODE_NORMAL = 1000;
const MOVE_AREA = { centerX: 1056, centerY: 745, radiusX: 736, radiusY: 545 };
const GOLDEN_ANGLE = 2.399963229728653;
const ANGLE_STEP = 0.05;

/** Deterministic position on an ellipse: the same session index and step always give the same point. */
export function positionAt(index: number, step: number): Position {
    const angle = index * GOLDEN_ANGLE + step * ANGLE_STEP;
    return {
        x: Math.round(MOVE_AREA.centerX + MOVE_AREA.radiusX * Math.sin(angle)),
        y: Math.round(MOVE_AREA.centerY + MOVE_AREA.radiusY * Math.cos(angle)),
    };
}

export async function fetchAnonymousToken(pusherUrl: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch(new URL("anonymLogin", withTrailingSlash(pusherUrl)), { method: "POST", signal });
    if (!response.ok) {
        throw new Error(`anonymLogin_http_${response.status}`);
    }
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("authToken" in body) || typeof body.authToken !== "string") {
        throw new Error("anonymLogin_invalid_body");
    }
    return body.authToken;
}

export class RoomSession {
    public state: SessionState = "idle";
    public userId: number | undefined;

    private socket: WebSocket | undefined;
    private socketWasOpen = false;
    private nextNonce = 1;
    private step = 0;
    private connectStartedAt = 0;
    private joinTimer: NodeJS.Timeout | undefined;
    private moveTimer: NodeJS.Timeout | undefined;
    private closeTimer: NodeJS.Timeout | undefined;
    private readonly tokenRequest = new AbortController();
    private resolveClosed: () => void = () => {};
    /** Resolves once the session owns no socket and no timer any more. */
    public readonly closed = new Promise<void>((resolve) => {
        this.resolveClosed = resolve;
    });

    public constructor(
        private readonly options: SessionOptions,
        private readonly stats: RunStats,
        private readonly timers: TimerRegistry,
    ) {}

    public start(): void {
        if (this.state !== "idle") {
            return;
        }
        this.state = nextState(this.state, "start");
        this.stats.started += 1;
        this.stats.room(this.options.roomUrl).started += 1;
        this.connectStartedAt = performance.now();
        this.joinTimer = this.timers.setTimeout(() => {
            this.reject("join_timeout");
            this.leave();
        }, this.options.joinTimeoutMs);

        if (this.options.auth === "none") {
            this.openSocket(undefined);
            return;
        }
        fetchAnonymousToken(this.options.pusherUrl, this.tokenRequest.signal).then(
            (token) => this.openSocket(token),
            (error: unknown) => {
                this.reject(error instanceof Error ? error.message : "anonymLogin_failed");
                this.finish();
            },
        );
    }

    /** Idempotent. Before the join it aborts the attempt; after it, it leaves the room with a normal close. */
    public leave(): void {
        if (this.state === "connecting") {
            this.stats.abortedBeforeJoin += 1;
        }
        if (this.state === "leaving" || this.state === "closed" || this.state === "idle") {
            return;
        }
        this.state = nextState(this.state, "leave");
        this.clearActivityTimers();
        const socket = this.socket;
        if (socket === undefined) {
            this.tokenRequest.abort();
            this.finish();
            return;
        }
        this.closeTimer = this.timers.setTimeout(() => socket.terminate(), this.options.closeTimeoutMs);
        socket.close(CLOSE_CODE_NORMAL, "Room connection closed");
    }

    private openSocket(token: string | undefined): void {
        if (this.state !== "connecting") {
            return;
        }
        const url = buildRoomSocketUrl({
            wsBaseUrl: this.options.wsUrl,
            roomUrl: this.options.roomUrl,
            apiVersion: this.options.apiVersion,
            tabId: randomUUID(),
            connectionId: randomUUID(),
            characterTextureId: this.options.characterTextureId,
        });
        // The pusher reads the JWT from the websocket subprotocol header, exactly as the browser sends it.
        const socket = new WebSocket(url, token === undefined ? [] : [token], { perMessageDeflate: false });
        socket.binaryType = "nodebuffer";
        this.socket = socket;

        socket.on("open", () => {
            this.socketWasOpen = true;
            this.stats.socketOpened();
        });
        socket.on("message", (data: Buffer) => this.handleFrame(data));
        socket.on("error", (error: Error) => {
            if (this.state === "leaving") {
                // Closing a socket that is still handshaking makes ws report an error; that one is ours.
                return;
            }
            increment(this.stats.errors, error.message);
            this.reject(`socket_error:${error.message}`);
        });
        socket.on("close", (code: number) => {
            this.stats.socketClosed(code, this.socketWasOpen);
            if (this.state === "accepted") {
                this.stats.unexpectedCloses += 1;
            }
            this.reject(`closed_before_join:${code}`);
            this.finish();
        });
    }

    private handleFrame(data: Buffer): void {
        this.stats.receivedFrames += 1;
        this.stats.receivedBytes += data.byteLength;
        let frame;
        try {
            frame = decodeServerFrame(data);
        } catch {
            increment(this.stats.errors, "undecodable_server_frame");
            return;
        }
        for (const eventType of frame.eventTypes) {
            increment(this.stats.received, eventType);
        }
        for (const signal of frame.signals) {
            switch (signal.kind) {
                case "roomConnected":
                    this.send(joinRoomMessage(this.options.name, positionAt(this.options.index, 0)));
                    break;
                case "roomJoined":
                    this.accept(signal.userId);
                    break;
                case "rejected":
                    this.reject(signal.reason);
                    break;
                case "ping":
                    this.send(pongMessage());
                    break;
                case "serverError":
                    increment(this.stats.errors, `server:${signal.message}`);
                    break;
            }
        }
    }

    private accept(userId: number): void {
        if (this.state !== "connecting") {
            return;
        }
        this.state = nextState(this.state, "joined");
        this.userId = userId;
        this.timers.clear(this.joinTimer);
        this.joinTimer = undefined;
        this.stats.accepted += 1;
        this.stats.joinLatenciesMs.push(performance.now() - this.connectStartedAt);
        const room = this.stats.room(this.options.roomUrl);
        room.accepted += 1;
        room.userIds.add(userId);

        this.send(viewportMessage(positionAt(this.options.index, 0)));
        if (this.options.moveHz > 0) {
            this.moveTimer = this.timers.setInterval(() => {
                this.step += 1;
                this.send(userMovesMessage(positionAt(this.options.index, this.step)));
            }, 1000 / this.options.moveHz);
        }
    }

    private reject(reason: string): void {
        if (this.state !== "connecting") {
            return;
        }
        this.state = nextState(this.state, "rejected");
        this.stats.rejected += 1;
        this.stats.room(this.options.roomUrl).rejected += 1;
        increment(this.stats.rejections, reason);
    }

    private send(message: ClientMessage): void {
        if (this.socket?.readyState !== WebSocket.OPEN) {
            return;
        }
        this.socket.send(encodeClientFrame(this.nextNonce, message));
        this.nextNonce += 1;
        increment(this.stats.sent, message.$case);
    }

    private clearActivityTimers(): void {
        this.timers.clear(this.joinTimer);
        this.timers.clear(this.moveTimer);
        this.joinTimer = undefined;
        this.moveTimer = undefined;
    }

    private finish(): void {
        this.clearActivityTimers();
        this.timers.clear(this.closeTimer);
        this.closeTimer = undefined;
        this.state = nextState(this.state, "socketClosed");
        this.resolveClosed();
    }
}
