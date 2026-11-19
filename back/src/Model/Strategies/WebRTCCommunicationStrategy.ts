import type { SpaceUser, MeetingConnectionRestartMessage } from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import { v4 as uuidv4 } from "uuid";
import type { ICommunicationStrategy } from "../Interfaces/ICommunicationStrategy";
import type { ICommunicationSpace } from "../Interfaces/ICommunicationSpace";

class ConnectionManager {
    private connections: Map<string, Map<string, string>> = new Map();

    addConnection(user1Id: string, user2Id: string, connectionId: string): void {
        this.getOrCreateUserConnections(user1Id).set(user2Id, connectionId);
    }

    removeConnection(user1Id: string, user2Id: string): void {
        this.connections.get(user1Id)?.delete(user2Id);
    }

    hasConnection(user1Id: string, user2Id: string): boolean {
        return this.connections.get(user1Id)?.has(user2Id) ?? false;
    }

    getConnectionId(user1Id: string, user2Id: string): string | undefined {
        return this.connections.get(user1Id)?.get(user2Id);
    }

    removeUser(userId: string): void {
        this.connections.delete(userId);
    }

    removeUserToNotify(userId: string): void {
        for (const connections of this.connections.values()) {
            connections.delete(userId);
        }
    }

    getAllConnections(): Array<[string, string]> {
        const result: Array<[string, string]> = [];
        for (const [userId, connections] of this.connections) {
            for (const connectedId of connections.keys()) {
                result.push([userId, connectedId]);
            }
        }
        return result;
    }

    getConnections(userId: string): Set<string> {
        return new Set(this.connections.get(userId)?.keys());
    }

    countConnections(userId: string): number {
        return this.connections.get(userId)?.size ?? 0;
    }

    private getOrCreateUserConnections(userId: string): Map<string, string> {
        if (!this.connections.has(userId)) {
            this.connections.set(userId, new Map());
        }
        return this.connections.get(userId)!;
    }

    clear(): void {
        this.connections.clear();
    }
}

export class WebRTCCommunicationStrategy implements ICommunicationStrategy {
    /** Whether a refused pair was already reported for this strategy (one report per space and state, not one per pair). */
    private peerCapReported = false;

    /**
     * @param maxPeers - The most peers one user holds at once. Unlimited when undefined, as upstream.
     */
    constructor(
        private readonly _space: ICommunicationSpace,
        private users: ReadonlyMap<string, SpaceUser>,
        private usersToNotify: ReadonlyMap<string, SpaceUser>,
        private readonly maxPeers?: number,
        private readonly _connections: ConnectionManager = new ConnectionManager(),
    ) {}
    addUserReady(userId: string): void {}
    canSwitch(): boolean {
        return true;
    }

    public addUser(newUser: SpaceUser): Promise<void> {
        // When someone enters the space, we don't need to try establishing the connection. We must wait for the user to watch
        // the space for that.

        if (!this.usersToNotify.has(newUser.spaceUserId)) {
            return Promise.resolve();
        }

        for (const existingUser of this.usersToNotify.values()) {
            if (existingUser.spaceUserId === newUser.spaceUserId) {
                continue;
            }
            try {
                this.tryEstablish(newUser, existingUser);
            } catch (error) {
                console.error(
                    "An error occurred while adding a new user to WebRTC discussion",
                    newUser,
                    existingUser,
                    error,
                );
                Sentry.captureException(error);
            }
        }

        return Promise.resolve();
    }

    public deleteUser(user: SpaceUser): void {
        if (!this.usersToNotify.has(user.spaceUserId)) {
            this.shutdownAllConnections(user);
        }

        for (const userToNotify of this.usersToNotify.values()) {
            if (!this.users.has(userToNotify.spaceUserId)) {
                this.shutdownConnection(user.spaceUserId, userToNotify.spaceUserId);
            }
        }

        this.cleanupUserMessages(user.spaceUserId);
    }

    private shutdownAllConnections(user: SpaceUser): void {
        const connections = this._connections.getConnections(user.spaceUserId);
        connections.forEach((connection) => {
            if (this._connections.hasConnection(connection, user.spaceUserId)) {
                this.shutdownConnection(user.spaceUserId, connection);
            }
        });
    }

    public async addUserToNotify(user: SpaceUser): Promise<void> {
        for (const userInFilter of this.users.values()) {
            if (userInFilter.spaceUserId === user.spaceUserId) {
                continue;
            }
            try {
                this.tryEstablish(user, userInFilter);
            } catch (error) {
                console.error(
                    "An error occurred while adding a user to notify in WebRTCCommunicationStrategy",
                    user,
                    userInFilter,
                    error,
                );
                Sentry.captureException(error);
            }
        }

        return Promise.resolve();
    }
    public deleteUserFromNotify(user: SpaceUser): void {
        for (const userInFilter of this.users.values()) {
            if (userInFilter.spaceUserId === user.spaceUserId) {
                continue;
            }
            this.shutdownConnection(user.spaceUserId, userInFilter.spaceUserId);
        }

        this.cleanupUserToNotifyMessages(user.spaceUserId);
    }

    public updateUser(user: SpaceUser): void {
        // TODO: remove the handleUserMediaUpdate function after testing
        //this.handleUserMediaUpdate(user);
    }
    private shutdownConnection(user: string, otherUser: string): void {
        try {
            this.sendWebRTCDisconnect(user, otherUser);
        } catch (error) {
            console.error(
                "An error occurred while sending a disconnect in WebRTCCommunicationStrategy shutdownConnection 1",
                user,
                otherUser,
                error,
            );
            Sentry.captureException(error);
        }
        try {
            this.sendWebRTCDisconnect(otherUser, user);
        } catch (error) {
            console.error(
                "An error occurred while sending a disconnect in WebRTCCommunicationStrategy shutdownConnection 2",
                otherUser,
                user,
                error,
            );
            Sentry.captureException(error);
        }
    }

    /**
     * Whether two users may be paired: they have no connection yet, and neither holds `maxPeers` peers already.
     *
     * The cap fails closed: a refused pair is not retried when a slot frees, and with several speakers a watcher
     * past the cap gets no stream. That is the point of it: a space that cannot move to LiveKit never becomes a
     * mesh of hundreds of peer connections in the speaker's tab.
     */
    private canPair(user1: SpaceUser, user2: SpaceUser): boolean {
        if (this.hasExistingConnection(user1.spaceUserId, user2.spaceUserId)) {
            return false;
        }
        if (this.maxPeers === undefined) {
            return true;
        }
        if (
            this._connections.countConnections(user1.spaceUserId) < this.maxPeers &&
            this._connections.countConnections(user2.spaceUserId) < this.maxPeers
        ) {
            return true;
        }
        this.reportRefusedPair(user1, user2);
        return false;
    }

    /** Reports the first refused pair only: a crowd past the cap would otherwise log once per watcher. */
    private reportRefusedPair(user1: SpaceUser, user2: SpaceUser): void {
        if (this.peerCapReported) {
            return;
        }
        this.peerCapReported = true;
        const spaceName = this._space.getSpaceName();
        console.warn(
            `MAX_P2P_PEERS (${this.maxPeers}) reached in space ${spaceName}: no WebRTC connection between ${user1.spaceUserId} and ${user2.spaceUserId}. Other refused pairs of this space are not logged.`,
        );
        Sentry.captureMessage("WebRTC peer cap reached: a pair was refused", {
            level: "warning",
            extra: { spaceName, maxPeers: this.maxPeers },
        });
    }

    /**
     * Opens a connection between two users unless `canPair` refuses the pair. This is the only way a new pair is
     * opened, so the peer cap holds for every caller without each one having to check it.
     */
    private tryEstablish(user1: SpaceUser, user2: SpaceUser): void {
        if (!this.canPair(user1, user2)) {
            return;
        }
        const connectionId = uuidv4();
        this.sendWebRTCStart(user1.spaceUserId, user2.spaceUserId, true, connectionId);
        this.sendWebRTCStart(user2.spaceUserId, user1.spaceUserId, false, connectionId);
    }

    private cleanupUserMessages(userId: string): void {
        this._connections.removeUser(userId);
    }

    private cleanupUserToNotifyMessages(userId: string): void {
        this._connections.removeUserToNotify(userId);
    }

    private hasExistingConnection(userId1: string, userId2: string): boolean {
        return this._connections.hasConnection(userId1, userId2);
    }

    private sendWebRTCStart(senderId: string, receiverId: string, isInitiator: boolean, connectionId: string): void {
        this._connections.addConnection(senderId, receiverId, connectionId);

        this._space.dispatchPrivateEvent({
            spaceName: this._space.getSpaceName(),
            receiverUserId: receiverId,
            senderUserId: senderId,
            spaceEvent: {
                event: {
                    $case: "webRtcStartMessage",
                    webRtcStartMessage: {
                        userId: senderId,
                        initiator: isInitiator,
                        connectionId: connectionId,
                    },
                },
            },
        });
    }

    private sendWebRTCDisconnect(senderId: string, receiverId: string): void {
        if (!this._connections.hasConnection(senderId, receiverId)) {
            // Nothing to tear down: don't notify the receiver of a connection that does not exist.
            return;
        }
        this._connections.removeConnection(senderId, receiverId);
        if (!this._space.getUser(senderId)) {
            // The sender already left the space (its removal is what triggered this teardown).
            // dispatchPrivateEvent would throw because it needs the sender, and the receiver is
            // already told to drop the peer by the removeSpaceUserMessage broadcast.
            return;
        }
        this._space.dispatchPrivateEvent({
            spaceName: this._space.getSpaceName(),
            receiverUserId: receiverId,
            senderUserId: senderId,
            spaceEvent: {
                event: {
                    $case: "webRtcDisconnectMessage",
                    webRtcDisconnectMessage: {
                        userId: senderId,
                    },
                },
            },
        });
    }

    initialize(users: ReadonlyMap<string, SpaceUser>, usersToNotify: ReadonlyMap<string, SpaceUser>): Promise<void> {
        users.forEach((user1) => {
            usersToNotify.forEach((user2) => {
                if (user1.spaceUserId === user2.spaceUserId) {
                    return;
                }
                try {
                    this.tryEstablish(user1, user2);
                } catch (error) {
                    console.error(
                        "An error occurred while initializing WebRTCCommunicationStrategy",
                        user1,
                        user2,
                        error,
                    );
                    Sentry.captureException(error);
                }
            });
        });
        return Promise.resolve();
    }

    public handleMeetingConnectionRestartMessage(
        meetingConnectionRestartMessage: MeetingConnectionRestartMessage,
        senderUserId: string,
    ) {
        const receiverId = meetingConnectionRestartMessage.userId;
        if (!receiverId) {
            console.warn("No receiverId found for meetingConnectionRestartMessage ", meetingConnectionRestartMessage);
            return;
        }

        // A connection is tracked in both directions with the same id, but a partial cleanup may
        // leave only one direction, so look both ways to recover the currently tracked id.
        const existingConnectionId =
            this._connections.getConnectionId(senderUserId, receiverId) ??
            this._connections.getConnectionId(receiverId, senderUserId);

        if (existingConnectionId === undefined) {
            this.recoverLostConnection(senderUserId, receiverId);
            return;
        }

        // Ignore stale restart requests that reference a connection we have already replaced.
        if (
            meetingConnectionRestartMessage.connectionId !== undefined &&
            meetingConnectionRestartMessage.connectionId !== existingConnectionId
        ) {
            return;
        }

        const connectionId = uuidv4();
        this.sendWebRTCStart(receiverId, senderUserId, true, connectionId);
        this.sendWebRTCStart(senderUserId, receiverId, false, connectionId);
    }

    /**
     * The tracking was lost (partial cleanup) but the front still expects a connection between these two users:
     * silently ignoring would leave them without media until one reloads.
     */
    private recoverLostConnection(senderUserId: string, receiverId: string): void {
        const sender = this.lookupUser(senderUserId);
        const receiver = this.lookupUser(receiverId);
        if (!sender || !receiver) {
            console.warn("No existing connection found for meetingConnectionRestartMessage ", senderUserId, receiverId);
            Sentry.captureMessage(
                `No existing connection found for meetingConnectionRestartMessage from ${senderUserId} to ${receiverId}`,
            );
            return;
        }
        // A client message must not open a pair the peer cap refused: tryEstablish checks it.
        this.tryEstablish(receiver, sender);
    }

    private lookupUser(userId: string): SpaceUser | undefined {
        return this.users.get(userId) ?? this.usersToNotify.get(userId);
    }

    cleanup(): void {
        for (const [senderId, receiverId] of this._connections.getAllConnections()) {
            this._space.dispatchPrivateEvent({
                spaceName: this._space.getSpaceName(),
                receiverUserId: receiverId,
                senderUserId: senderId,
                spaceEvent: {
                    event: {
                        $case: "webRtcDisconnectMessage",
                        webRtcDisconnectMessage: {
                            userId: senderId,
                        },
                    },
                },
            });
        }
        this._connections.clear();
    }
}
