import type { WebSocket } from "uWebSockets.js";
import {
    FrontToPusherWebSocketMessage,
    PusherToFrontWebSocketMessage,
    type ServerToClientMessage,
    type ClientToServerMessage,
    type SubMessage,
} from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import { CLIENT_DISCONNECTION_RETENTION_MS } from "../enums/EnvironmentVariable";
import { NoncedMessageStore } from "../../common/NoncedMessageStore";
import type { SocketData } from "../models/Websocket/SocketData";
import type { ViewerBudget } from "../models/ViewerBudget";
import { encodeBatchFrame } from "./BatchFrame";
import { gaugeManager } from "./GaugeManager";

export type RawSocket = WebSocket<SocketData>;

/**
 * When a socket's batch is written. A move waits for its batch to close, so the interval is the most a move can wait
 * here and 1000 / intervalMs is the most frames a second a socket is written (each is a syscall).
 */
export interface BatchTiming {
    /** The batch closes this long after its first message. 100 in production (PUSHER_BATCH_INTERVAL_MS). */
    readonly intervalMs: number;
    /**
     * When above 0, a batch closes after this long instead when it holds a stop or a leave, or when it opens on a
     * socket that was not written to for a whole interval (a small batch, nothing behind it). 0 turns it off.
     */
    readonly earlyFlushMs: number;
}

export const DEFAULT_BATCH_TIMING: BatchTiming = { intervalMs: 100, earlyFlushMs: 0 };

export class PusherWebSocket {
    private static readonly KEEP_ALIVE_INTERVAL_MS = 25_000;

    /**
     * The per-viewer budget of this socket, when the pusher runs one (PUSHER_VIEWER_BUDGET_ENABLED). It is a field here
     * and not an entry of a WeakMap in the SocketManager because it is read for each zone event the socket is sent:
     * a million times a second at 1000 users that see each other.
     */
    public viewerBudget: ViewerBudget | undefined;

    private socket: RawSocket;
    private _isDisconnecting = false;
    private _isPermanentlyDisconnected = false;
    private keepAliveInterval: NodeJS.Timeout | undefined;
    private batchTimeout: NodeJS.Timeout | undefined;
    /** When the pending batch is due, and when the last one was written; only kept while earlyFlushMs is above 0. */
    private batchDueAt = 0;
    private lastFlushAt = 0;
    private pingBackpressured = false;
    private batchedMessages: SubMessage[] = [];
    /**
     * Group id to the index, in batchedMessages, of a groupUpdateMessage that no later message of the batch is about.
     * A newer update for that group replaces it in place: a batch is applied by the client at once, so the
     * superseded state is never seen, and every message in between concerns other users or groups.
     */
    private batchedGroupUpdateIndexes = new Map<number, number>();
    private nextOutgoingNonce = 1;
    private lastSentNonce = 0;
    private waitingForDrain = false;
    private lastReceivedNonce = 0;
    private transportAvailable = true;
    private readonly outgoingMessagesStore = new NoncedMessageStore<Uint8Array<ArrayBuffer>>(
        CLIENT_DISCONNECTION_RETENTION_MS,
    );

    private readonly timing: BatchTiming;

    public constructor(socket: RawSocket, timing: BatchTiming = DEFAULT_BATCH_TIMING) {
        // An early flush later than the interval would only add latency to the first batch of a quiet socket.
        this.timing = timing.earlyFlushMs > timing.intervalMs ? { ...timing, earlyFlushMs: timing.intervalMs } : timing;
        this.socket = socket;
        this.startKeepAlive();
    }

    public getUserData(): SocketData {
        return this.socket.getUserData();
    }

    private cachedUserId: number | undefined;

    /**
     * The id of the user of this socket in its room, once it has one. A zone asks it of every socket for every event it
     * sends, to keep a user from being told of itself: a million times a second in a crowd of 1000 that all see each
     * other, and `getUserData` is a call into uWebSockets each time. The id never changes once the room gave it, so it
     * is read once.
     */
    public get userId(): number | undefined {
        if (this.cachedUserId === undefined) {
            const userId = this.socket.getUserData().userId;
            if (typeof userId === "number") {
                this.cachedUserId = userId;
            }
            return userId;
        }
        return this.cachedUserId;
    }

    public send(message: ServerToClientMessage): ReturnType<RawSocket["send"]> {
        return this.sendFrame((nonce) => PusherToFrontWebSocketMessage.encode({ nonce, message }).finish());
    }

    public handleDrain(): void {
        if (!this.transportAvailable) {
            return;
        }
        this.waitingForDrain = false;
        for (const { nonce, payload } of this.outgoingMessagesStore.getAfter(this.lastSentNonce)) {
            if (this.sendStoredPayload(nonce, payload) !== 1) {
                return;
            }
        }

        if (this.pingBackpressured && this.socket.ping() === 1) {
            this.pingBackpressured = false;
        }
    }

    public emitInBatch(payload: SubMessage): void {
        const message = payload.message;
        if (message?.$case === "groupUpdateMessage") {
            const groupId = message.groupUpdateMessage.groupId;
            const index = this.batchedGroupUpdateIndexes.get(groupId);
            if (index !== undefined) {
                this.batchedMessages[index] = payload;
                return;
            }
            this.batchedGroupUpdateIndexes.set(groupId, this.batchedMessages.length);
        } else if (message?.$case === "groupDeleteMessage") {
            this.batchedGroupUpdateIndexes.delete(message.groupDeleteMessage.groupId);
        } else if (message?.$case === "groupUsersUpdateMessage") {
            this.batchedGroupUpdateIndexes.delete(message.groupUsersUpdateMessage.groupId);
        }
        this.batchedMessages.push(payload);

        if (this.timing.earlyFlushMs > 0) {
            this.scheduleFlushEarly(payload);
            return;
        }
        if (this.batchTimeout) {
            return;
        }

        this.batchTimeout = setTimeout(() => this.flushBatch(), this.timing.intervalMs);
    }

    /**
     * emitInBatch with PUSHER_BATCH_EARLY_FLUSH_MS on: a stop, a leave, or a first message after quiet, goes sooner.
     *
     * Two frames of a socket are never closer than half an interval (`earlyFlushMinGapMs`), so a socket gets at most
     * twice the frames of one without the early flush. Without that floor, every stop or leave pulls the batch of a
     * socket that is written to all the time forward to earlyFlushMs: with 1000 moves a second into one socket, an
     * interval of 100 and an early flush of 5, evenly spaced stops made it 30 frames a second at 30 stops a second and
     * 100 at 100 (MEASURED on a virtual clock, PusherWebSocketTiming.test.ts), against 10 without the early flush. Each
     * frame is a syscall, and 10 frames a second per socket is the baseline of the pusher CPU budget.
     */
    private scheduleFlushEarly(payload: SubMessage): void {
        const now = Date.now();
        const { intervalMs, earlyFlushMs } = this.timing;
        if (this.batchTimeout === undefined) {
            // A socket not written to for a whole interval has nothing queued behind this batch: it is small, so send it.
            const delay = now - this.lastFlushAt >= intervalMs ? earlyFlushMs : intervalMs;
            this.batchDueAt = now + delay;
            this.batchTimeout = setTimeout(() => this.flushBatch(), delay);
            return;
        }
        if (!isUrgent(payload)) {
            return;
        }
        const dueAt = Math.max(now + earlyFlushMs, this.lastFlushAt + earlyFlushMinGapMs(this.timing));
        if (dueAt >= this.batchDueAt) {
            return;
        }
        clearTimeout(this.batchTimeout);
        this.batchDueAt = dueAt;
        this.batchTimeout = setTimeout(() => this.flushBatch(), dueAt - now);
    }

    /**
     * Sends the pending batch now. Use it before a message that must not overtake what was batched before it
     * (e.g. the answer to a space state query, which must arrive after the patch it caused).
     */
    public flushBatch(): void {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = undefined;
        }
        if (this.isDisconnecting()) {
            this.resetBatch();
            return;
        }
        if (this.batchedMessages.length === 0) {
            return;
        }
        if (this.timing.earlyFlushMs > 0) {
            this.lastFlushAt = Date.now();
        }

        const batch = this.batchedMessages;
        this.sendFrame((nonce) => {
            const frame = encodeBatchFrame(nonce, batch, entryBytesScratch);
            countSubMessages(batch, entryBytesScratch);
            return frame;
        });
        this.resetBatch();
    }

    public decodeIncomingMessage(payload: ArrayBuffer | ArrayBufferView): ClientToServerMessage | undefined {
        const bytes =
            payload instanceof ArrayBuffer
                ? new Uint8Array(payload)
                : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
        const frame = FrontToPusherWebSocketMessage.decode(bytes);
        if (!frame.message) {
            throw new Error("Invalid websocket payload: missing client message");
        }
        if (frame.nonce <= this.lastReceivedNonce) {
            return undefined;
        }
        this.lastReceivedNonce = frame.nonce;
        return frame.message;
    }

    public ping(...args: Parameters<RawSocket["ping"]>): ReturnType<RawSocket["ping"]> {
        return this.socket.ping(...args);
    }

    public end(...args: Parameters<RawSocket["end"]>): void {
        if (this._isDisconnecting) {
            console.trace("end already called on websocket");
            return;
        }
        this._isDisconnecting = true;
        this.stopKeepAlive();
        this.stopBatching();

        if (this.transportAvailable) {
            // TODO: send last batched messages?
            return this.socket.end(...args);
        }
    }

    public getBufferedAmount(): number {
        return this.socket.getBufferedAmount();
    }

    public isDisconnecting(): boolean {
        return this._isDisconnecting;
    }

    /**
     * Marks this logical connection as gone for good: the transport closed and no reconnect retry
     * will replace it (either a normal client close, or the reconnection retention window expired).
     */
    public markPermanentlyDisconnected(): void {
        this._isPermanentlyDisconnected = true;
    }

    /**
     * Returns true once the connection can no longer be revived by a reconnecting transport
     * (see replaceSocket). Useful to tell an expected teardown apart from an unexpected drop.
     */
    public isPermanentlyDisconnected(): boolean {
        return this._isPermanentlyDisconnected;
    }

    public startDisconnecting(): boolean {
        if (this._isDisconnecting) {
            return false;
        }

        this._isDisconnecting = true;
        this.stopKeepAlive();
        this.stopBatching();
        return true;
    }

    public isCurrentTransport(rawSocket: RawSocket): boolean {
        return this.socket === rawSocket;
    }

    public handleTransportClosed(): void {
        this.transportAvailable = false;
        this.stopKeepAlive();
    }

    public replaceSocket(newSocket: RawSocket, clientLastReceivedNonce: number): boolean {
        const socketData = this.socket.getUserData();
        console.info(
            `Replacing WebSocket transport for user ${socketData.userUuid} on tab ${socketData.tabId} (lastReceivedNonce=${clientLastReceivedNonce})`,
        );

        if (!this.outgoingMessagesStore.hasEveryNonceAfter(clientLastReceivedNonce)) {
            console.warn(
                `Cannot replace WebSocket transport for user ${socketData.userUuid} on tab ${
                    socketData.tabId
                }: server is missing messages to replay (lastReceivedNonce=${clientLastReceivedNonce}, oldestStoredNonce=${
                    this.outgoingMessagesStore.getAll()[0]?.nonce
                })`,
            );
            Sentry.captureMessage(
                `Cannot replace WebSocket transport for user ${socketData.userUuid} on tab ${
                    socketData.tabId
                }: server is missing messages to replay (lastReceivedNonce=${clientLastReceivedNonce}, oldestStoredNonce=${
                    this.outgoingMessagesStore.getAll()[0]?.nonce
                })`,
                {
                    tags: {
                        userUuid: socketData.userUuid,
                        tabId: socketData.tabId,
                    },
                },
            );
            newSocket.end(1008, "Cannot replace socket: server is missing messages to replay");
            return false;
        }

        const previousSocket = this.socket;
        const previousSocketData = previousSocket.getUserData();
        const newSocketData = newSocket.getUserData();

        if (previousSocketData.userUuid !== newSocketData.userUuid) {
            console.warn(
                `Cannot replace WebSocket transport: user UUID mismatch (previous=${previousSocketData.userUuid}, new=${newSocketData.userUuid})`,
            );
            Sentry.captureMessage(
                `Cannot replace WebSocket transport: user UUID mismatch (previous=${previousSocketData.userUuid}, new=${newSocketData.userUuid})`,
                {
                    tags: {
                        previousUserUuid: previousSocketData.userUuid,
                        newUserUuid: newSocketData.userUuid,
                    },
                },
            );
            newSocket.end(1008, "Cannot replace socket: user UUID mismatch");
            return false;
        }

        if (previousSocketData.connectionId !== newSocketData.connectionId) {
            console.warn(
                `Cannot replace WebSocket transport for user ${socketData.userUuid} on tab ${socketData.tabId}: connection id mismatch (previous=${previousSocketData.connectionId}, new=${newSocketData.connectionId})`,
            );
            newSocket.end(1008, "Cannot replace socket: connection id mismatch");
            return false;
        }

        // Keep logical connection state (room/back stream/subscriptions) while swapping only the transport.
        Object.assign(newSocketData, previousSocketData);

        this.socket = newSocket;
        this.transportAvailable = true;
        this.lastSentNonce = clientLastReceivedNonce;

        this.startKeepAlive();
        this.handleDrain();

        // Close the old transport only after rebinding so the logical connection keeps running.
        try {
            previousSocket.end(1008, "Replaced by a reconnected socket");
        } catch {
            // Ignore errors when closing the previous socket, as it might have already been closed by the client.
        }

        return true;
    }

    private startKeepAlive(): void {
        if (this.keepAliveInterval) {
            return;
        }

        // Keep the pusher WebSocket active across proxies/load balancers; app-level ping can be delayed by browsers.
        this.keepAliveInterval = setInterval(() => {
            if (this.isDisconnecting() || this.pingBackpressured) {
                return;
            }

            if (this.socket.ping() !== 1) {
                this.pingBackpressured = true;
            }
        }, PusherWebSocket.KEEP_ALIVE_INTERVAL_MS);
    }

    private stopKeepAlive(): void {
        if (!this.keepAliveInterval) {
            return;
        }

        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = undefined;
    }

    private stopBatching(): void {
        if (!this.batchTimeout) {
            this.resetBatch();
            return;
        }

        clearTimeout(this.batchTimeout);
        this.batchTimeout = undefined;
        this.resetBatch();
    }

    private resetBatch(): void {
        this.batchedMessages = [];
        if (this.batchedGroupUpdateIndexes.size > 0) {
            this.batchedGroupUpdateIndexes.clear();
        }
    }

    /** Numbers the frame `encode` makes, keeps it for a reconnection to replay, and sends it unless the socket is behind. */
    private sendFrame(encode: (nonce: number) => Uint8Array<ArrayBuffer>): ReturnType<RawSocket["send"]> {
        const nonce = this.nextOutgoingNonce;
        const payloadWithNonce = encode(nonce);
        this.nextOutgoingNonce += 1;
        this.outgoingMessagesStore.add(nonce, payloadWithNonce);

        if (!this.transportAvailable || this.waitingForDrain || nonce > this.lastSentNonce + 1) {
            return 0;
        }

        return this.sendStoredPayload(nonce, payloadWithNonce);
    }

    private sendStoredPayload(nonce: number, payload: Uint8Array<ArrayBuffer>): ReturnType<RawSocket["send"]> {
        if (!this.transportAvailable) {
            return 0;
        }

        const sendStatus = this.socket.send(payload, true);
        // uWS send: 1 = written, 0 = buffered as backpressure (uWS still delivers it, in order), 2 = dropped
        // because maxBackpressure was reached. Only a dropped message may be sent again on drain: resending
        // a buffered one delivers it twice to the client.
        if (sendStatus !== 2) {
            this.lastSentNonce = nonce;
        }
        if (sendStatus !== 1) {
            // Stop feeding uWS until it drains, otherwise we pile up past maxBackpressure and get dropped.
            this.waitingForDrain = true;
        }
        return sendStatus;
    }
}

/** The least time between two frames of a socket when the early flush is on: half an interval, so at most 2x the frames. */
function earlyFlushMinGapMs({ intervalMs, earlyFlushMs }: BatchTiming): number {
    return Math.max(earlyFlushMs, Math.ceil(intervalMs / 2));
}

/** A sub-message the client should not wait a whole interval for: the user it draws walking has stopped or left. */
function isUrgent(subMessage: SubMessage): boolean {
    const message = subMessage.message;
    if (message?.$case === "userMovedMessage") {
        return message.userMovedMessage.position?.moving === false;
    }
    return message?.$case === "userLeftMessage";
}

// The size of each sub-message of the frame being built; one copy serves every socket (see encodeBatchFrame).
const entryBytesScratch: number[] = [];

/**
 * Adds the sub-messages of a batch to the counters of the pusher, by type, with the bytes each took in its frame: its
 * entry, tag and length prefix included, which is what a client sees of it. A run of the same type is added at once.
 */
function countSubMessages(batch: readonly SubMessage[], entryBytes: readonly number[]): void {
    let runType: string | undefined;
    let runMessages = 0;
    let runBytes = 0;
    for (let index = 0; index < batch.length; index++) {
        const type = batch[index].message?.$case;
        if (type !== runType) {
            if (runType !== undefined) {
                gaugeManager.addSubMessages(runType, runMessages, runBytes);
            }
            runType = type;
            runMessages = 0;
            runBytes = 0;
        }
        if (type !== undefined) {
            runMessages += 1;
            runBytes += entryBytes[index];
        }
    }
    if (runType !== undefined) {
        gaugeManager.addSubMessages(runType, runMessages, runBytes);
    }
}
