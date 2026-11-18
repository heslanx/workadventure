import {
    FrontToPusherWebSocketMessage,
    PusherToFrontWebSocketMessage,
    type ClientToServerMessage,
    type ServerToClientMessage,
} from "@workadventure/messages";
import { BehaviorSubject } from "rxjs";
import * as Sentry from "@sentry/svelte";
import { v4 as uuidv4 } from "uuid";
import { NoncedMessageStore } from "../../common/NoncedMessageStore";
import { WS_CLOSE_CODE_SESSION_DESTROYED } from "../../common/WebSocketCloseCodes";
import { CLIENT_DISCONNECTION_RETENTION_MS } from "../Enum/EnvironmentVariable";
import { analyticsClient } from "../Administration/AnalyticsClient";

type WebSocketFactory = (url: string, protocols?: string[]) => WebSocket;

export class WorkAdventureWebSocket {
    private static readonly RECONNECT_BASE_DELAY_MS = 500;
    private static readonly RECONNECT_MAX_DELAY_MS = 5_000;
    // Spreads the resume attempts of many clients that lost the same pusher, so they do not all reconnect in the same
    // instant. Capped so a lone reconnect is never delayed by more than a few seconds.
    private static readonly RECONNECT_MAX_JITTER_MS = 3_000;
    // Spreads the page rebuilds of many clients whose resume was refused (the pusher restarted), so they do not all
    // open a new connection and rebuild their scene at once. With the jitter above, a lone client is at most 5 s slower.
    private static readonly RESUME_REFUSED_MAX_SPREAD_MS = 2_000;
    private static websocketFactory: WebSocketFactory | null = null;
    private static randomSource: () => number = Math.random;

    public static setWebsocketFactory(websocketFactory: WebSocketFactory | null): void {
        WorkAdventureWebSocket.websocketFactory = websocketFactory;
    }

    public static setRandomSource(randomSource: (() => number) | null): void {
        WorkAdventureWebSocket.randomSource = randomSource ?? Math.random;
    }

    public onopen: ((this: WorkAdventureWebSocket, ev: Event) => void) | null = null;
    public onclose: ((this: WorkAdventureWebSocket, ev: CloseEvent) => void) | null = null;
    public onerror: ((this: WorkAdventureWebSocket, ev: Event) => void) | null = null;
    public onmessage: ((this: WorkAdventureWebSocket, ev: MessageEvent<ServerToClientMessage>) => void) | null = null;

    private readonly _reconnectingStream = new BehaviorSubject<boolean>(false);
    public readonly reconnectingStream = this._reconnectingStream.asObservable();

    private readonly url: URL;
    private readonly protocols: string[] | undefined;
    // Identifies this logical connection to the pusher. Successive RoomConnections of one page share the tab id,
    // so the pusher needs this to make sure a resumed transport lands on the session it left and not on a newer one.
    private readonly connectionId = uuidv4();
    private manuallyClosed = false;
    private reconnectAttempted = false;
    private reconnectAttempt = 0;
    private reconnectStartedAt: number | undefined;
    private reconnectionTimeout: ReturnType<typeof setTimeout> | undefined;
    // True while the current transport is a resume attempt that has not received a frame yet: if it closes now, the
    // resume was refused or never landed, and the page is about to rebuild its connection from scratch.
    private resumeUnconfirmed = false;
    private delayedClose: { timeout: ReturnType<typeof setTimeout>; deliver: () => void } | undefined;
    private nextOutgoingNonce = 1;
    private lastReceivedNonce = 0;
    private duplicateNonceReported = false;
    private readonly outgoingMessagesStore = new NoncedMessageStore<Uint8Array<ArrayBuffer>>(
        CLIENT_DISCONNECTION_RETENTION_MS,
    );

    private socket: WebSocket;

    public constructor(url: string | URL, protocols?: string[]) {
        this.url = new URL(url);
        this.protocols = protocols;
        this.socket = this.createSocket();
    }

    public isOpen(): boolean {
        return this.socket.readyState === WebSocket.OPEN;
    }

    public send(message: ClientToServerMessage): void {
        if (this.manuallyClosed) {
            return;
        }

        const nonce = this.nextOutgoingNonce;
        const payloadWithNonce = FrontToPusherWebSocketMessage.encode({
            nonce,
            message,
        }).finish();
        this.nextOutgoingNonce += 1;
        this.outgoingMessagesStore.add(nonce, payloadWithNonce);

        if (this.socket.readyState !== WebSocket.OPEN) {
            return;
        }
        this.socket.send(payloadWithNonce);
    }

    /**
     * Skips the wait before the next reconnection attempt (or before giving up on a refused resume), for a person
     * who pressed "Try again now". Does nothing unless a wait is under way (connected, connecting, or closed for good).
     */
    public reconnectNow(): void {
        if (this.delayedClose) {
            this.delayedClose.deliver();
            return;
        }
        if (this.manuallyClosed || this.reconnectionTimeout === undefined) {
            return;
        }
        this.clearReconnectionTimeout();
        this.socket = this.createSocket();
        analyticsClient.trackAdminEvent("websocket.reconnecting");
    }

    public getLastReceivedNonce(): number {
        return this.lastReceivedNonce;
    }

    public close(code?: number, reason?: string): void {
        this.manuallyClosed = true;
        this.detachSocketListeners(this.socket);
        this.clearReconnectionTimeout();
        this.clearDelayedClose();
        this._reconnectingStream.next(false);
        this._reconnectingStream.complete();
        this.socket.close(code, reason);
    }

    public closeForPageUnload = (): void => {
        this.manuallyClosed = true;
        this.clearReconnectionTimeout();
        this.clearDelayedClose();
        if (this.socket.readyState === WebSocket.CLOSED) {
            return;
        }
        this.socket.close(1000, "Page unloading");
    };

    private handleOpenEvent = (): void => {
        const isReconnection = this.reconnectAttempted;
        this.clearReconnectionTimeout();
        this.reconnectAttempted = false;
        this.reconnectAttempt = 0;
        this.reconnectStartedAt = undefined;
        if (isReconnection) {
            for (const { payload } of this.outgoingMessagesStore.getAll()) {
                this.socket.send(payload);
            }
            this._reconnectingStream.next(false);
            analyticsClient.trackAdminEvent("websocket.reconnected");
        }
        const event = new Event("open");
        this.onopen?.call(this, event);
    };

    private handleCloseEvent = (event: CloseEvent): void => {
        this.clearReconnectionTimeout();
        this.detachSocketListeners(this.socket);

        if (!this.manuallyClosed && this.shouldReconnect(event)) {
            this.reconnectAttempted = true;
            this.reconnectAttempt += 1;
            this.reconnectStartedAt ??= Date.now();
            this._reconnectingStream.next(true);
            this.scheduleReconnectAttempt();
            return;
        }

        const closeEvent = new CloseEvent("close", {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
        });
        if (!this.manuallyClosed && this.resumeUnconfirmed && event.code !== 1000) {
            this.closeAfterSpread(closeEvent);
            return;
        }
        this.deliverClose(closeEvent);
    };

    private deliverClose(closeEvent: CloseEvent): void {
        this._reconnectingStream.next(false);
        this.onclose?.call(this, closeEvent);
        this._reconnectingStream.complete();
    }

    /**
     * Tells the page that the connection is gone after a random wait, so that the clients of a restarted pusher do not
     * all rebuild their scene in the same instant. The page stays "reconnecting" meanwhile.
     */
    private closeAfterSpread(closeEvent: CloseEvent): void {
        this.clearDelayedClose();
        this._reconnectingStream.next(true);
        const deliver = (): void => {
            this.clearDelayedClose();
            this.deliverClose(closeEvent);
        };
        const spreadMs = WorkAdventureWebSocket.randomSource() * WorkAdventureWebSocket.RESUME_REFUSED_MAX_SPREAD_MS;
        this.delayedClose = { timeout: setTimeout(deliver, spreadMs), deliver };
    }

    private clearDelayedClose(): void {
        if (!this.delayedClose) {
            return;
        }

        clearTimeout(this.delayedClose.timeout);
        this.delayedClose = undefined;
    }

    private handleErrorEvent = (event: Event): void => {
        this.onerror?.call(this, event);
    };

    private handleMessageEvent = (event: MessageEvent): void => {
        const bytes =
            event.data instanceof ArrayBuffer
                ? new Uint8Array(event.data)
                : new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);

        let frame;
        try {
            frame = PusherToFrontWebSocketMessage.decode(bytes);
        } catch (e) {
            console.error(e);
            this.close(1003, "Invalid message format");
            return;
        }
        this.resumeUnconfirmed = false;

        // The pusher must never send us the same nonce twice: it only replays frames the client reported
        // as missing. A duplicate means the server-side bookkeeping is broken, and replaying a frame to
        // the application layer corrupts state (double query answers, ghost users...). Drop it, loudly.
        if (frame.nonce <= this.lastReceivedNonce) {
            const message = `Received a duplicate message from the pusher (nonce ${frame.nonce}, last received nonce ${this.lastReceivedNonce}). Ignoring it.`;
            console.warn(message);
            if (!this.duplicateNonceReported) {
                // Duplicates come in bursts (one per drain event), so only report the first one of this connection.
                this.duplicateNonceReported = true;
                Sentry.captureMessage(message);
            }
            return;
        }

        this.lastReceivedNonce = frame.nonce;
        const messageEvent = new MessageEvent<ServerToClientMessage>("message", {
            data: frame.message,
            origin: event.origin,
            lastEventId: event.lastEventId,
            ports: [...event.ports],
            source: event.source,
        });

        this.onmessage?.call(this, messageEvent);
    };

    private createSocket(): WebSocket {
        const socketUrl = new URL(this.url.toString());
        socketUrl.searchParams.set("connectionId", this.connectionId);
        if (this.reconnectAttempted) {
            socketUrl.searchParams.set("lastReceivedNonce", this.lastReceivedNonce.toString());
        }

        const socket = WorkAdventureWebSocket.websocketFactory
            ? WorkAdventureWebSocket.websocketFactory(socketUrl.toString(), this.protocols)
            : new WebSocket(socketUrl, this.protocols);
        socket.binaryType = "arraybuffer";

        this.resumeUnconfirmed = this.reconnectAttempted;
        this.bindSocketListeners(socket);
        return socket;
    }

    private shouldReconnect(event: CloseEvent): boolean {
        // Do not reconnect if handshake/auth was refused, or if the pusher destroyed the session: a resume could only
        // land on a session that is not ours (another connection of the same tab). The caller reconnects from scratch.
        if (event.code === 1000 || event.code === 1008 || event.code === WS_CLOSE_CODE_SESSION_DESTROYED) {
            return false;
        }
        if (this.reconnectStartedAt !== undefined) {
            const elapsedMs = Date.now() - this.reconnectStartedAt;
            if (elapsedMs >= CLIENT_DISCONNECTION_RETENTION_MS) {
                return false;
            }
        }
        return true;
    }

    private bindSocketListeners(socket: WebSocket): void {
        socket.addEventListener("open", this.handleOpenEvent);
        socket.addEventListener("close", this.handleCloseEvent);
        socket.addEventListener("error", this.handleErrorEvent);
        socket.addEventListener("message", this.handleMessageEvent);

        window.addEventListener("beforeunload", this.closeForPageUnload);
        window.addEventListener("pagehide", this.closeForPageUnload);
    }

    private detachSocketListeners(socket: WebSocket): void {
        socket.removeEventListener("open", this.handleOpenEvent);
        socket.removeEventListener("close", this.handleCloseEvent);
        socket.removeEventListener("error", this.handleErrorEvent);
        socket.removeEventListener("message", this.handleMessageEvent);

        window.removeEventListener("beforeunload", this.closeForPageUnload);
        window.removeEventListener("pagehide", this.closeForPageUnload);
    }

    private scheduleReconnectAttempt(): void {
        this.clearReconnectionTimeout();
        this.reconnectionTimeout = setTimeout(() => {
            if (this.manuallyClosed) {
                return;
            }

            this.socket = this.createSocket();
            analyticsClient.trackAdminEvent("websocket.reconnecting");
        }, this.getReconnectDelayMs());
    }

    private getReconnectDelayMs(): number {
        const baseDelayMs = Math.min(
            WorkAdventureWebSocket.RECONNECT_MAX_DELAY_MS,
            WorkAdventureWebSocket.RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, this.reconnectAttempt - 1),
        );
        // Jitter adds 0 to 100% of the base delay, and never more than RECONNECT_MAX_JITTER_MS.
        const jitterCapMs = Math.min(baseDelayMs, WorkAdventureWebSocket.RECONNECT_MAX_JITTER_MS);
        return baseDelayMs + WorkAdventureWebSocket.randomSource() * jitterCapMs;
    }

    private clearReconnectionTimeout(): void {
        if (!this.reconnectionTimeout) {
            return;
        }

        clearTimeout(this.reconnectionTimeout);
        this.reconnectionTimeout = undefined;
    }
}
