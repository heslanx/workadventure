import {
    FilterType,
    type HandleRecordingWebhookRequest,
    type MeetingConnectionRestartMessage,
    type SpaceUser,
} from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import type { S3Upload } from "livekit-server-sdk";
import type { ICommunicationSpace } from "../Interfaces/ICommunicationSpace";
import type { IRecordableStrategy } from "../Interfaces/ICommunicationStrategy";
import type { EgressFile } from "../Interfaces/ICommunicationState";
import type { LiveKitService, RecordingStartInfo } from "../Services/LivekitService";

/**
 * How long a broadcast space (a megaphone) keeps its LiveKit room, and its listeners in it, after its last speaker
 * left. A speaker who stops and starts again within this delay finds the room as it was: the listeners are still
 * connected and none of them has to be sent a new invitation (1000 listeners rejoining at once is 1000 token
 * requests and 1000 simultaneous joins on the SFU).
 */
export const DEFAULT_BROADCAST_ROOM_GRACE_PERIOD_MS = 30_000;

export class LivekitCommunicationStrategy implements IRecordableStrategy {
    private usersReady: Set<string> = new Set();
    private createRoomPromise: Promise<void> | null = null;
    /** Whether `createRoomPromise` resolved: a room that failed to be created is not worth keeping. */
    private roomReady = false;
    /** Set while the room of a broadcast without speaker is being kept for the grace period. */
    private roomCloseTimer: NodeJS.Timeout | null = null;
    private cleanedUp = false;

    private streamingUsers: Map<string, SpaceUser> = new Map<string, SpaceUser>();
    private receivingUsers: Map<string, SpaceUser> = new Map<string, SpaceUser>();

    /**
     * Queue of pending operations per user to prevent race conditions
     * when users rapidly move between zones.
     */
    private pendingOperations: Map<string, Promise<void>> = new Map();

    constructor(
        private space: ICommunicationSpace,
        private livekitService: LiveKitService,
        private readonly broadcastRoomGracePeriodMs: number = DEFAULT_BROADCAST_ROOM_GRACE_PERIOD_MS,
    ) {}

    /**
     * Queues an operation for a specific user to ensure sequential execution.
     * This prevents race conditions when addUser/deleteUser are called in rapid succession.
     */
    private queueUserOperation(userId: string, operation: () => Promise<void>): Promise<void> {
        const previousOperation = this.pendingOperations.get(userId) ?? Promise.resolve();

        const newOperation = previousOperation
            .catch(() => {
                // Ignore errors from previous operations to continue the queue
            })
            .then(async () => {
                await operation();
            });

        this.pendingOperations.set(userId, newOperation);

        // Clean up the map when the operation completes
        newOperation
            .finally(() => {
                if (this.pendingOperations.get(userId) === newOperation) {
                    this.pendingOperations.delete(userId);
                }
            })
            .catch(() => {
                // Ignore cleanup errors
            });

        return newOperation;
    }

    async addUser(user: SpaceUser): Promise<void> {
        return this.queueUserOperation(user.spaceUserId, async () => {
            // Check if the user is already streaming
            if (this.streamingUsers.has(user.spaceUserId)) {
                console.warn("User already streaming in the room", user.spaceUserId);
                Sentry.captureMessage(`User already streaming in the room ${user.spaceUserId}`);
                return;
            }

            // A speaker is back before the grace period ended: the room is still there with its listeners in it
            const roomWasKept = this.cancelRoomClose();

            // Ensure the Livekit room is created (only once)
            if (!this.createRoomPromise) {
                this.createRoomPromise = this.livekitService.createRoom(this.space.getSpaceName());
            }

            const createRoomPromise = this.createRoomPromise;
            try {
                await createRoomPromise;
            } catch (error) {
                // Keep a failed creation out of the next speaker's way: nothing closes the room of a speaker who
                // never made it into it, so until the last speaker left every next one would await the same failure.
                if (this.createRoomPromise === createRoomPromise) {
                    this.createRoomPromise = null;
                }
                throw error;
            }
            // The room may have been closed while it was being created
            if (this.createRoomPromise === createRoomPromise) {
                this.roomReady = true;
            }

            // Send invitation to all receiving users if this is the first room creation
            if (!roomWasKept && this.receivingUsers.size > 0 && this.streamingUsers.size === 0) {
                for (const receivingUser of this.receivingUsers.values()) {
                    this.sendLivekitInvitationMessage(receivingUser).catch((error) => {
                        console.error(
                            `Error generating token for user ${receivingUser.spaceUserId} in Livekit:`,
                            error,
                        );
                        Sentry.captureException(error);
                    });
                }
            }
            // Register the user as streaming
            this.streamingUsers.set(user.spaceUserId, user);

            // Send invitation to the new user if not already receiving
            if (!this.receivingUsers.has(user.spaceUserId)) {
                this.sendLivekitInvitationMessage(user).catch((error) => {
                    console.error(`Error generating token for user ${user.spaceUserId} in Livekit:`, error);
                    Sentry.captureException(error);
                });
            }
        });
    }

    private sendLivekitDisconnectMessage(user: SpaceUser): void {
        try {
            this.space.dispatchPrivateEvent({
                spaceName: this.space.getSpaceName(),
                receiverUserId: user.spaceUserId,
                senderUserId: user.spaceUserId,
                spaceEvent: {
                    event: {
                        $case: "livekitDisconnectMessage",
                        livekitDisconnectMessage: {},
                    },
                },
            });
        } catch (error) {
            console.error(`Error dispatching livekitDisconnectMessage for user ${user.spaceUserId}:`, error);
            Sentry.captureException(error);
        }
    }

    deleteUser(user: SpaceUser): void {
        this.queueUserOperation(user.spaceUserId, async () => {
            const deleted = this.streamingUsers.delete(user.spaceUserId);

            if (!deleted) {
                console.warn("User to delete not found in streaming users", user.spaceUserId);
            }

            // Let's only disconnect from Livekit if the user is not watching in the room anymore
            if (!this.receivingUsers.has(user.spaceUserId)) {
                this.sendLivekitDisconnectMessage(user);
            }

            if (this.streamingUsers.size === 0) {
                try {
                    await this.space.stopRecordingByServer();
                } catch (error) {
                    console.error(`Error stopping recording for space ${this.space.getSpaceName()}:`, error);
                    Sentry.captureException(error);
                }

                // A speaker may have started while the recording was stopping
                if (this.streamingUsers.size > 0) {
                    return;
                }

                if (this.shouldKeepRoomForGracePeriod()) {
                    this.scheduleRoomClose();
                    return;
                }
                await this.closeRoom();
            }
        }).catch((error) => {
            console.error(`Error in deleteUser for ${user.spaceUserId}:`, error);
            Sentry.captureException(error);
        });
    }

    /**
     * Only an existing room of a broadcast with listeners is kept: nobody is waiting in a meeting that has no one
     * left, without listeners there is no herd to spare, and a room that failed to be created must be created again
     * by the next speaker, as it is when the room is closed at once.
     */
    private shouldKeepRoomForGracePeriod(): boolean {
        return (
            !this.cleanedUp &&
            this.roomReady &&
            this.broadcastRoomGracePeriodMs > 0 &&
            this.space.filterType !== FilterType.ALL_USERS &&
            this.receivingUsers.size > 0
        );
    }

    private scheduleRoomClose(): void {
        if (this.roomCloseTimer) {
            return;
        }
        this.roomCloseTimer = setTimeout(() => {
            this.roomCloseTimer = null;
            // No speaker came back: the broadcast is over for good
            if (this.streamingUsers.size > 0) {
                return;
            }
            this.closeRoom().catch((error) => {
                console.error(`Error closing the Livekit room of space ${this.space.getSpaceName()}:`, error);
                Sentry.captureException(error);
            });
        }, this.broadcastRoomGracePeriodMs);
        // The room is not worth keeping the process alive for
        this.roomCloseTimer.unref();
    }

    /**
     * Cancels the pending close of the room.
     * @returns whether there was one, that is whether the room was kept from a previous session
     */
    private cancelRoomClose(): boolean {
        if (!this.roomCloseTimer) {
            return false;
        }
        clearTimeout(this.roomCloseTimer);
        this.roomCloseTimer = null;
        return true;
    }

    private async closeRoom(): Promise<void> {
        this.createRoomPromise = null;
        this.roomReady = false;
        for (const receivingUser of this.receivingUsers.values()) {
            this.sendLivekitDisconnectMessage(receivingUser);
        }

        await this.livekitService.deleteRoom(this.space.getSpaceName());
    }

    updateUser(user: SpaceUser): void {}

    async initialize(
        users: ReadonlyMap<string, SpaceUser>,
        usersToNotify: ReadonlyMap<string, SpaceUser>,
    ): Promise<void> {
        for (const user of users.values()) {
            // We want to add users sequentially
            // The first user will trigger the room creation (which is async) but for other users, the
            // room will already be created, and the execution will not wait at all.
            // eslint-disable-next-line no-await-in-loop
            await this.addUser(user).catch((error) => {
                console.error(`Error adding user ${user.spaceUserId} to Livekit:`, error);
                Sentry.captureException(error);
            });
        }

        for (const user of usersToNotify.values()) {
            // We want to add users sequentially
            // The first user will trigger the room creation (which is async) but for other users, the
            // room will already be created, and the execution will not wait at all.
            // eslint-disable-next-line no-await-in-loop
            await this.addUserToNotify(user).catch((error) => {
                console.error(`Error adding user ${user.spaceUserId} to Livekit:`, error);
                Sentry.captureException(error);
            });
        }
    }

    addUserReady(userId: string): void {
        this.usersReady.add(userId);
    }

    canSwitch(): boolean {
        return this.usersReady.size === this.space.getAllUsers().length;
    }

    async addUserToNotify(user: SpaceUser): Promise<void> {
        return this.queueUserOperation(user.spaceUserId, async () => {
            if (this.receivingUsers.has(user.spaceUserId)) {
                console.warn("User already receiving in the room", user.spaceUserId);
                Sentry.captureMessage(`User already receiving in the room ${user.spaceUserId}`);
                return;
            }

            this.receivingUsers.set(user.spaceUserId, user);

            if (!this.createRoomPromise) {
                return;
            }
            await this.createRoomPromise;

            // Let's only send the invitation if the user is not already streaming in the room
            if (!this.streamingUsers.has(user.spaceUserId)) {
                await this.sendLivekitInvitationMessage(user);
            }
        });
    }

    deleteUserFromNotify(user: SpaceUser): void {
        this.queueUserOperation(user.spaceUserId, () => {
            const deleted = this.receivingUsers.delete(user.spaceUserId);
            if (!deleted) {
                console.warn("User to delete not found in receiving users", user.spaceUserId);
            }

            // Let's only disconnect from Livekit if the user is not streaming in the room anymore
            if (!this.streamingUsers.has(user.spaceUserId)) {
                this.sendLivekitDisconnectMessage(user);
            }
            return Promise.resolve();
        }).catch((error) => {
            console.error(`Error in deleteUserFromNotify for ${user.spaceUserId}:`, error);
            Sentry.captureException(error);
        });
    }

    private async sendLivekitInvitationMessage(user: SpaceUser): Promise<void> {
        const token = await this.livekitService.generateToken(this.space.getSpaceName(), user);

        this.space.dispatchPrivateEvent({
            spaceName: this.space.getSpaceName(),
            receiverUserId: user.spaceUserId,
            senderUserId: user.spaceUserId,
            spaceEvent: {
                event: {
                    $case: "livekitInvitationMessage",
                    livekitInvitationMessage: {
                        token: token,
                        serverUrl: this.livekitService.getLivekitFrontendUrl(),
                    },
                },
            },
        });
    }

    public handleMeetingConnectionRestartMessage(
        meetingConnectionRestartMessage: MeetingConnectionRestartMessage,
        senderUserId: string,
    ): void {
        const senderUser = this.space.getUser(senderUserId);
        if (!senderUser) {
            console.warn("User not found in space", senderUserId);
            return;
        }
        this.sendLivekitInvitationMessage(senderUser).catch((error) => {
            console.error(`Error generating token for user ${senderUser.spaceUserId} in Livekit:`, error);
            Sentry.captureException(error);
        });
    }

    cleanup(): void {
        // Nothing is kept past a cleanup: the room is deleted below
        this.cleanedUp = true;
        this.cancelRoomClose();
        for (const user of this.streamingUsers.values()) {
            this.deleteUser(user);
        }
        for (const user of this.receivingUsers.values()) {
            this.deleteUserFromNotify(user);
        }
        this.livekitService.deleteRoom(this.space.getSpaceName()).catch((error) => {
            console.error(error);
            Sentry.captureException(error);
        });
    }
    async startRecording(user: SpaceUser, recordingSessionId: string): Promise<RecordingStartInfo> {
        if (!this.createRoomPromise) {
            console.warn("Room not created yet");
            Sentry.captureMessage("[LivekitCommunicationStrategy] Room not created yet when starting recording");
            throw new Error("Livekit room not created yet");
        }

        await this.createRoomPromise;
        return await this.livekitService.startRecording(this.space.getSpaceName(), user, user.uuid, recordingSessionId);
    }
    async stopRecording(egressId?: string): Promise<void> {
        await this.livekitService.stopRecording(egressId);
    }

    async startTrackEgress(spaceUserId: string, trackSid: string, filepath: string, s3: S3Upload): Promise<string> {
        if (!this.createRoomPromise) {
            throw new Error("Livekit room not created yet");
        }
        await this.createRoomPromise;
        return this.livekitService.startTrackEgress(this.space.getSpaceName(), spaceUserId, trackSid, filepath, s3);
    }

    async stopEgress(egressId: string): Promise<void> {
        await this.livekitService.stopEgress(egressId);
    }

    getEgressFile(egressId: string): Promise<EgressFile | undefined> {
        return this.livekitService.getEgressFile(egressId);
    }

    async handleLivekitWebhook(
        rawBody: Buffer | Uint8Array,
        authorizationHeader: string | undefined,
        spaceName: string,
        recordingSessionId: string,
    ): Promise<HandleRecordingWebhookRequest | "ignored"> {
        return this.livekitService.handleLivekitWebhook(rawBody, authorizationHeader, spaceName, recordingSessionId);
    }
}
