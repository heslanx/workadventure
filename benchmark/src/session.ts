import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
    type ClientMessage,
    type ViewportKind,
    buildRoomSocketUrl,
    decodeServerFrame,
    encodeClientFrame,
    joinRoomMessage,
    joinWorldSpaceMessage,
    pongMessage,
    userMovesMessage,
    viewportFor,
    viewportMessage,
    watchWorldSpaceMessage,
    withTrailingSlash,
} from "./protocol";
import type { MoveProbe } from "./probe";
import type { MotionPlan } from "./scenario";
import { type RunStats, type TimerRegistry, increment, isInWindow } from "./stats";

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
    /** Index inside this process: the probe and the ramp use it. */
    index: number;
    /** Index across every process of the run (index + --index-offset): paths and roles use it. */
    pathIndex: number;
    name: string;
    pusherUrl: string;
    wsUrl: string;
    roomUrl: string;
    apiVersion: string;
    characterTextureId: string;
    auth: "anonymous" | "none";
    moveHz: number;
    motion: MotionPlan;
    viewport: ViewportKind;
    /** False for a bot that only stands where it joined: it sends no move at all. */
    walker: boolean;
    /** Joins the world space after the room join, as the client does at scene start. */
    joinWorldSpace: boolean;
    /** Subscribes to the world space's user list once joined. */
    watchWorldSpace: boolean;
    joinTimeoutMs: number;
    closeTimeoutMs: number;
}

const CLOSE_CODE_NORMAL = 1000;

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
    private pauseTicks = 0;
    private nextQueryId = 1;
    private worldQueryId: number | undefined;
    private worldJoinStartedAt = 0;
    private worldSpaceJoined = false;
    private peers = 0;
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
        private readonly probe: MoveProbe,
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
        this.probe.setAccepted(this.options.index, false);
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

    /** Users this bot currently knows of: those that joined its watched zones minus those that left them. */
    public get knownPeers(): number {
        return Math.max(0, this.peers);
    }

    private handleFrame(data: Buffer): void {
        const receivedAt = performance.now();
        this.stats.receivedFramesTotal += 1;
        this.stats.receivedBytesTotal += data.byteLength;
        let frame;
        try {
            frame = decodeServerFrame(data, this.probe.isObserver(this.options.index), true);
        } catch {
            increment(this.stats.errors, "undecodable_server_frame");
            return;
        }
        const counted = isInWindow(this.stats.window, receivedAt);
        if (counted) {
            this.stats.receivedFrames += 1;
            this.stats.receivedBytes += data.byteLength;
        }
        if (frame.accounting !== undefined) {
            this.stats.traffic.record(receivedAt, data.byteLength, frame.accounting);
        }
        for (const eventType of frame.eventTypes) {
            if (counted) {
                increment(this.stats.received, eventType);
            }
            if (eventType === "userJoinedMessage") {
                this.peers += 1;
            } else if (eventType === "userLeftMessage") {
                this.peers -= 1;
            }
        }
        for (const move of frame.moves) {
            this.probe.recordReceive(this.options.index, move.userId, move, receivedAt);
        }
        for (const signal of frame.signals) {
            switch (signal.kind) {
                case "roomConnected": {
                    const joinPosition = this.options.motion.positionAt(this.options.pathIndex, 0);
                    this.send(
                        joinRoomMessage(
                            this.options.name,
                            joinPosition,
                            viewportFor(this.options.viewport, joinPosition),
                        ),
                    );
                    break;
                }
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
                case "queryAnswer":
                    this.handleQueryAnswer(signal.id, signal.error);
                    break;
            }
        }
    }

    private joinWorldSpace(): void {
        const queryId = this.nextQueryId;
        this.nextQueryId += 1;
        this.worldQueryId = queryId;
        this.worldJoinStartedAt = performance.now();
        this.send(joinWorldSpaceMessage(queryId));
    }

    private handleQueryAnswer(queryId: number, error: string | undefined): void {
        if (queryId !== this.worldQueryId || this.worldSpaceJoined) {
            return;
        }
        this.worldQueryId = undefined;
        if (error !== undefined) {
            increment(this.stats.worldSpaceJoinErrors, error);
            return;
        }
        this.worldSpaceJoined = true;
        this.stats.worldSpaceJoined += 1;
        this.stats.worldSpaceJoinLatenciesMs.push(performance.now() - this.worldJoinStartedAt);
        if (this.options.watchWorldSpace && this.send(watchWorldSpaceMessage())) {
            this.stats.worldSpaceWatching += 1;
        }
    }

    private accept(userId: number): void {
        if (this.state !== "connecting") {
            return;
        }
        this.state = nextState(this.state, "joined");
        this.userId = userId;
        this.probe.registerUser(this.options.index, userId);
        this.probe.setAccepted(this.options.index, true);
        this.timers.clear(this.joinTimer);
        this.joinTimer = undefined;
        this.stats.accepted += 1;
        this.stats.joinLatenciesMs.push(performance.now() - this.connectStartedAt);
        const room = this.stats.room(this.options.roomUrl);
        room.accepted += 1;
        room.userIds.add(userId);

        const { motion, pathIndex, viewport: viewportKind } = this.options;
        const joinPosition = motion.positionAt(pathIndex, 0);
        const joinViewport = viewportFor(viewportKind, joinPosition);
        this.send(viewportMessage(joinPosition, joinViewport));
        this.probe.setViewport(this.options.index, joinViewport);
        if (this.options.joinWorldSpace) {
            this.joinWorldSpace();
        }
        if (this.options.walker && this.options.moveHz > 0) {
            this.moveTimer = this.timers.setInterval(() => {
                if (this.pauseTicks > 0) {
                    this.pauseTicks -= 1;
                    return;
                }
                this.step += 1;
                const position = motion.positionAt(pathIndex, this.step);
                const viewport = viewportFor(viewportKind, position);
                const sentAt = performance.now();
                if (this.send(userMovesMessage(position, viewport, motion.movingAt(pathIndex, this.step)))) {
                    this.probe.setViewport(this.options.index, viewport);
                    this.probe.recordSend(this.options.index, this.step, position, sentAt);
                }
                this.pauseTicks = motion.pauseTicksAfter(pathIndex, this.step);
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

    /** Returns false when the socket is not open, so nothing was sent. */
    private send(message: ClientMessage): boolean {
        if (this.socket?.readyState !== WebSocket.OPEN) {
            return false;
        }
        this.socket.send(encodeClientFrame(this.nextNonce, message));
        this.nextNonce += 1;
        increment(this.stats.sent, message.$case);
        return true;
    }

    private clearActivityTimers(): void {
        this.timers.clear(this.joinTimer);
        this.timers.clear(this.moveTimer);
        this.joinTimer = undefined;
        this.moveTimer = undefined;
    }

    private finish(): void {
        this.probe.setAccepted(this.options.index, false);
        this.clearActivityTimers();
        this.timers.clear(this.closeTimer);
        this.closeTimer = undefined;
        this.state = nextState(this.state, "socketClosed");
        this.resolveClosed();
    }
}
