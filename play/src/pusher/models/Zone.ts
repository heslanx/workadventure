import * as Sentry from "@sentry/node";
import type {
    CharacterTextureMessage,
    CompanionTextureMessage,
    EmoteEventMessage,
    ErrorMessage,
    GroupUpdateMessage,
    GroupUpdateZoneMessage,
    GroupUsersUpdateMessage,
    PlayerDetailsUpdatedMessage,
    PointMessage,
    PositionMessage,
    SayMessage,
    SetPlayerDetailsMessage,
    SubMessage,
    UserJoinedMessage,
    UserJoinedZoneMessage,
    UserMovedMessage,
    UserLeftZoneMessage,
    GroupLeftZoneMessage,
} from "@workadventure/messages";
import { AvailabilityStatus } from "@workadventure/messages";
import type { PusherWebSocket } from "../services/PusherWebSocket";
import { encodeOnce } from "../services/BatchFrame";

export interface ZoneEventListener {
    onUserEnters(user: UserDescriptor, listener: PusherWebSocket): void;
    onUserMoves(user: UserDescriptor, listener: PusherWebSocket): void;
    onUserLeaves(userId: number, listener: PusherWebSocket): void;
    /**
     * Optional: takes a move of a user (a step, or the stop that ends the walk) for all the sockets of the zone at once,
     * instead of one onUserMoves call per socket. A listener that implements it must give each socket the same as
     * onUserMoves would, and must not send the user its own move.
     */
    readonly onUserMovesBulk?: (user: UserDescriptor, listeners: ReadonlySet<PusherWebSocket>) => void;
    onGroupEnters(group: GroupDescriptor, listener: PusherWebSocket): void;
    onGroupMoves(group: GroupDescriptor, listener: PusherWebSocket): void;
    onGroupLeaves(groupId: number, listener: PusherWebSocket): void;
    onGroupUsersUpdated(group: GroupDescriptor, listener: PusherWebSocket): void;
    onEmote(emoteMessage: EmoteEventMessage, listener: PusherWebSocket): void;
    onError(errorMessage: ErrorMessage, listener: PusherWebSocket): void;
    onPlayerDetailsUpdated(playerDetailsUpdatedMessage: PlayerDetailsUpdatedMessage, listener: PusherWebSocket): void;
}

/*
 * A zone event reaches every socket that watches the zone, so the sub-message a descriptor sends for it is built and
 * encoded once and handed to all of them (see encodeOnce). A descriptor keeps it until the state it is made of changes.
 */
export class UserDescriptor {
    private userJoinedSubMessage: SubMessage | undefined;
    private joinedAtMoveVersion = -1;
    private userMovedSubMessage: SubMessage | undefined;
    /** Counts the moves this descriptor took, so that a socket can tell whether it has sent the latest. */
    public moveVersion = 0;
    /**
     * The sockets that are sent every move of this user as it comes, when the pusher gives each socket a budget
     * (ViewerBudget keeps this set). The zone then reaches these sockets directly and does not visit the others.
     */
    public fullRateWatchers: Set<PusherWebSocket> | undefined;
    /**
     * The sockets whose budget has this user in its scene, at any rate (ViewerBudget keeps this set; the full-rate
     * watchers are a subset). A stop is sent to every socket that knows of the user, so the zone reaches these directly
     * and does not visit the others, which a stop means nothing to.
     */
    public sceneWatchers: Set<PusherWebSocket> | undefined;
    /**
     * The `moveVersion` of the last stop that was sent straight to the `sceneWatchers`, -1 before one. A socket that was
     * in the scene then has that position, so the flush of its budget has nothing more to send for that version.
     */
    public directStopVersion = -1;

    private readonly joinedMessage: UserJoinedMessage;
    private readonly movedMessage: UserMovedMessage;

    private constructor(
        public readonly userId: number,
        private userUuid: string,
        private name: string,
        private characterTextures: CharacterTextureMessage[],
        private readonly position: PositionMessage,
        private availabilityStatus: AvailabilityStatus,
        private visitCardUrl: string | null,
        private variables: { [key: string]: string },
        private companionTexture?: CompanionTextureMessage,
        private outlineColor?: number,
        private chatID?: string,
        private sayMessage?: SayMessage,
    ) {
        if (!Number.isInteger(this.userId)) {
            throw new Error("UserDescriptor.userId is not an integer: " + this.userId);
        }
        this.position = { ...position };
        this.joinedMessage = {
            userId: this.userId,
            name: this.name,
            characterTextures: this.characterTextures,
            position: this.position,
            availabilityStatus: this.availabilityStatus,
            visitCardUrl: this.visitCardUrl ?? "",
            companionTexture: this.companionTexture,
            userUuid: this.userUuid,
            outlineColor: this.outlineColor ?? 0,
            hasOutline: this.outlineColor !== undefined,
            variables: this.variables,
            chatID: this.chatID,
            sayMessage: this.sayMessage,
        };
        this.movedMessage = {
            userId: this.userId,
            position: this.position,
        };
    }

    public static createFromUserJoinedZoneMessage(message: UserJoinedZoneMessage): UserDescriptor {
        const position = message.position;
        if (position === undefined) {
            throw new Error("Missing position");
        }
        return new UserDescriptor(
            message.userId,
            message.userUuid,
            message.name,
            message.characterTextures,
            position,
            message.availabilityStatus,
            message.visitCardUrl,
            message.variables,
            message.companionTexture,
            message.hasOutline ? message.outlineColor : undefined,
            message.chatID,
            message.sayMessage,
        );
    }

    public update(userMovedMessage: UserMovedMessage): void {
        const position = userMovedMessage.position;
        if (position === undefined) {
            throw new Error("Missing position");
        }
        this.position.x = position.x;
        this.position.y = position.y;
        this.position.direction = position.direction;
        this.position.moving = position.moving;
        this.moveVersion++;
        this.userMovedSubMessage = undefined;
    }

    public updateDetails(playerDetails: SetPlayerDetailsMessage): void {
        if (playerDetails.removeOutlineColor) {
            this.outlineColor = undefined;
        } else {
            const outlineColor = playerDetails.outlineColor;
            if (outlineColor !== undefined) {
                this.outlineColor = outlineColor;
            }
        }
        const availabilityStatus = playerDetails.availabilityStatus;
        if (availabilityStatus !== AvailabilityStatus.UNCHANGED) {
            this.availabilityStatus = availabilityStatus;
        }
        const setVariable = playerDetails.setVariable;
        if (setVariable) {
            this.variables[setVariable.name] = setVariable.value;
        }
        const sayMessage = playerDetails.sayMessage;
        if (sayMessage) {
            if (!sayMessage.message) {
                this.sayMessage = undefined;
            } else {
                this.sayMessage = sayMessage;
            }
        }
        if (playerDetails.chatID !== undefined) {
            this.chatID = playerDetails.chatID;
        }
        this.joinedMessage.availabilityStatus = this.availabilityStatus;
        this.joinedMessage.outlineColor = this.outlineColor ?? 0;
        this.joinedMessage.hasOutline = this.outlineColor !== undefined;
        this.joinedMessage.sayMessage = this.sayMessage;
        this.joinedMessage.chatID = this.chatID;
        this.userJoinedSubMessage = undefined;
    }

    public toUserJoinedMessage(): UserJoinedMessage {
        return this.joinedMessage;
    }

    public getPosition(): PositionMessage {
        return this.position;
    }

    public toUserMovedMessage(): UserMovedMessage {
        return this.movedMessage;
    }

    public toUserJoinedSubMessage(): SubMessage {
        // One immutable wire snapshot for all viewers promoted at this position.
        // A queued batch can still hold the previous snapshot until its flush.
        if (!this.userJoinedSubMessage || this.joinedAtMoveVersion !== this.moveVersion) {
            this.userJoinedSubMessage = encodeOnce({
                message: { $case: "userJoinedMessage", userJoinedMessage: this.joinedMessage },
            });
            this.joinedAtMoveVersion = this.moveVersion;
        }
        return this.userJoinedSubMessage;
    }

    public toUserMovedSubMessage(): SubMessage {
        this.userMovedSubMessage ??= encodeOnce({
            message: { $case: "userMovedMessage", userMovedMessage: this.toUserMovedMessage() },
        });
        return this.userMovedSubMessage;
    }
}

export class GroupDescriptor {
    private groupUpdateSubMessage: SubMessage | undefined;
    private groupUsersUpdateSubMessage: SubMessage | undefined;

    private constructor(
        public readonly groupId: number,
        private groupSize: number | undefined,
        private position: PointMessage,
        private locked: boolean | undefined,
        private _userIds: number[],
    ) {}

    public static createFromGroupUpdateZoneMessage(message: GroupUpdateZoneMessage): GroupDescriptor {
        const position = message.position;
        if (position === undefined) {
            throw new Error("Missing position");
        }
        return new GroupDescriptor(message.groupId, message.groupSize, position, message.locked, message.userIds);
    }

    /** Whether the size, the lock or the members of `next` differ from this descriptor's: more than the position. */
    public differsBeyondPosition(next: GroupDescriptor): boolean {
        return (
            this.groupSize !== next.groupSize || this.locked !== next.locked || !sameIds(this._userIds, next._userIds)
        );
    }

    /** Takes the size, position, lock and members of `next`. */
    public update(next: GroupDescriptor): void {
        this.groupSize = next.groupSize;
        this.position = next.position;
        this.locked = next.locked;
        if (!sameIds(this._userIds, next._userIds)) {
            // Kept, or every later move would compare against the old members and be sent as a change.
            this._userIds = next._userIds;
            this.groupUsersUpdateSubMessage = undefined;
        }
        this.groupUpdateSubMessage = undefined;
    }

    public updateUsers(userIds: number[]): void {
        this._userIds = userIds;
        this.groupUpdateSubMessage = undefined;
        this.groupUsersUpdateSubMessage = undefined;
    }

    public toGroupUpdateMessage(): GroupUpdateMessage {
        if (!Number.isInteger(this.groupId)) {
            throw new Error("GroupDescriptor.groupId is not an integer: " + this.groupId);
        }
        return {
            groupId: this.groupId,
            groupSize: this.groupSize,
            position: this.position,
            locked: this.locked,
            userIds: this._userIds,
        };
    }

    public toGroupUpdateSubMessage(): SubMessage {
        this.groupUpdateSubMessage ??= encodeOnce({
            message: { $case: "groupUpdateMessage", groupUpdateMessage: this.toGroupUpdateMessage() },
        });
        return this.groupUpdateSubMessage;
    }

    public toGroupUsersUpdateSubMessage(): SubMessage {
        this.groupUsersUpdateSubMessage ??= encodeOnce({
            message: {
                $case: "groupUsersUpdateMessage",
                groupUsersUpdateMessage: { groupId: this.groupId, userIds: this._userIds },
            },
        });
        return this.groupUsersUpdateSubMessage;
    }

    public get userIds(): number[] {
        return this._userIds;
    }
}

/**
 * The sub-messages that say a user or a group is gone depend on its id alone. A zone sends one to each of its
 * sockets in a row, so it is enough to remember the last one.
 */
function rememberLast<K, V>(build: (key: K) => V): (key: K) => V {
    let last: { key: K; value: V } | undefined;
    return (key) => {
        if (last === undefined || last.key !== key) {
            last = { key, value: build(key) };
        }
        return last.value;
    };
}

export const userLeftSubMessage = rememberLast((userId: number) =>
    encodeOnce({ message: { $case: "userLeftMessage", userLeftMessage: { userId } } }),
);

export const groupDeleteSubMessage = rememberLast((groupId: number) =>
    encodeOnce({ message: { $case: "groupDeleteMessage", groupDeleteMessage: { groupId } } }),
);

function sameIds(first: readonly number[], second: readonly number[]): boolean {
    return first.length === second.length && first.every((id, index) => id === second[index]);
}

/** The user id of a socket: cached by a PusherWebSocket, read from its data for any other object a zone is given. */
function userIdOf(listener: PusherWebSocket): number | undefined {
    return listener.userId ?? listener.getUserData().userId;
}

interface ZoneDescriptor {
    x: number;
    y: number;
}

export class Zone {
    private users: Map<number, UserDescriptor> = new Map<number, UserDescriptor>();
    private groups: Map<number, GroupDescriptor> = new Map<number, GroupDescriptor>();
    private listeners: Set<PusherWebSocket> = new Set<PusherWebSocket>();

    constructor(
        private socketListener: ZoneEventListener,
        public readonly x: number,
        public readonly y: number,
    ) {}

    // Public handler methods called by PositionDispatcher when messages are received from back

    public handleUserJoinedZone(message: UserJoinedZoneMessage): void {
        const userDescriptor = UserDescriptor.createFromUserJoinedZoneMessage(message);
        this.users.set(message.userId, userDescriptor);

        const fromZone = message.fromZone;
        this.notifyUserEnter(userDescriptor, fromZone);
    }

    public handleGroupUpdateZone(message: GroupUpdateZoneMessage): void {
        const groupDescriptor = GroupDescriptor.createFromGroupUpdateZoneMessage(message);

        // Do we have it already?
        const groupId = message.groupId;
        const oldGroupDescriptor = this.groups.get(groupId);
        if (oldGroupDescriptor !== undefined) {
            // The back sends one of these each time a user of the group takes a step, only to say where the group is
            // now. A client draws a bubble around its users, so it has no use for that; the position is kept, for a
            // socket that starts watching the zone later, and the sockets are told only what they can show.
            const visibleChange = oldGroupDescriptor.differsBeyondPosition(groupDescriptor);
            oldGroupDescriptor.update(groupDescriptor);
            if (visibleChange) {
                this.notifyGroupMove(groupDescriptor);
            }
        } else {
            this.groups.set(groupId, groupDescriptor);
            const fromZone = message.fromZone;
            this.notifyGroupEnter(groupDescriptor, fromZone);
        }
    }

    public handleGroupUsersUpdate(message: GroupUsersUpdateMessage): void {
        const groupId = message.groupId;
        const oldGroupDescriptor = this.groups.get(groupId);

        if (oldGroupDescriptor !== undefined) {
            oldGroupDescriptor.updateUsers(message.userIds);
            this.notifyGroupUsersUpdated(oldGroupDescriptor);
        } else {
            console.warn("Could not find group with id " + groupId + " to update users.");
        }
    }

    public handleUserLeftZone(message: UserLeftZoneMessage): void {
        this.users.delete(message.userId);
        this.notifyUserLeft(message.userId, message.toZone);
    }

    public handleGroupLeftZone(message: GroupLeftZoneMessage): void {
        const groupId = message.groupId;
        this.groups.delete(groupId);
        this.notifyGroupLeft(groupId, message.toZone);
    }

    public handleUserMoved(message: UserMovedMessage): void {
        const userId = message.userId;
        const userDescriptor = this.users.get(userId);

        if (userDescriptor === undefined) {
            console.error('Unexpected move message received for unknown user "' + userId + '"');
            Sentry.captureException(new Error('Unexpected move message received for unknown user "' + userId + '"'));
            return;
        }

        userDescriptor.update(message);
        this.notifyUserMove(userDescriptor);
    }

    public handleEmoteEvent(message: EmoteEventMessage): void {
        this.notifyEmote(message);
    }

    public handlePlayerDetailsUpdated(message: PlayerDetailsUpdatedMessage): void {
        const userId = message.userId;
        const userDescriptor = this.users.get(userId);

        if (userDescriptor === undefined) {
            console.error('Unexpected details message received for unknown user "' + userId + '"');
            Sentry.captureException(new Error('Unexpected details message received for unknown user "' + userId + '"'));
            return;
        }

        const details = message.details;
        if (details === undefined) {
            console.error('Unexpected details message without details received for user "' + userId + '"');
            Sentry.captureException(
                new Error('Unexpected details message without details received for user "' + userId + '"'),
            );
            return;
        }

        userDescriptor.updateDetails(details);
        this.notifyPlayerDetailsUpdated(message);
    }

    public hasListeners(): boolean {
        return this.listeners.size !== 0;
    }

    /**
     * Notify listeners of this zone that this user entered
     */
    private notifyUserEnter(user: UserDescriptor, oldZone: ZoneDescriptor | undefined): void {
        for (const listener of this.listeners) {
            if (userIdOf(listener) === user.userId) {
                continue;
            }
            if (oldZone === undefined || !this.isListeningZone(listener, oldZone.x, oldZone.y)) {
                this.socketListener.onUserEnters(user, listener);
            } else {
                this.socketListener.onUserMoves(user, listener);
            }
        }
    }

    /**
     * Notify listeners of this zone that this group entered
     */
    private notifyGroupEnter(group: GroupDescriptor, oldZone: ZoneDescriptor | undefined): void {
        for (const listener of this.listeners) {
            if (oldZone === undefined || !this.isListeningZone(listener, oldZone.x, oldZone.y)) {
                this.socketListener.onGroupEnters(group, listener);
            } else {
                this.socketListener.onGroupMoves(group, listener);
            }
        }
    }

    /**
     * Notify listeners of this zone that this user left
     */
    private notifyUserLeft(userId: number, newZone: ZoneDescriptor | undefined): void {
        for (const listener of this.listeners) {
            if (userIdOf(listener) === userId) {
                continue;
            }
            if (newZone === undefined || !this.isListeningZone(listener, newZone.x, newZone.y)) {
                this.socketListener.onUserLeaves(userId, listener);
            } else {
                // Do not send a signal. The move event will be triggered when joining the new room.
            }
        }
    }

    private notifyEmote(emoteMessage: EmoteEventMessage): void {
        for (const listener of this.listeners) {
            if (userIdOf(listener) === emoteMessage.actorUserId) {
                continue;
            }
            this.socketListener.onEmote(emoteMessage, listener);
        }
    }

    private notifyGroupUsersUpdated(groupDescriptor: GroupDescriptor): void {
        for (const listener of this.listeners) {
            this.socketListener.onGroupUsersUpdated(groupDescriptor, listener);
        }
    }

    private notifyPlayerDetailsUpdated(playerDetailsUpdatedMessage: PlayerDetailsUpdatedMessage): void {
        for (const listener of this.listeners) {
            if (userIdOf(listener) === playerDetailsUpdatedMessage.userId) {
                continue;
            }
            this.socketListener.onPlayerDetailsUpdated(playerDetailsUpdatedMessage, listener);
        }
    }

    private notifyError(errorMessage: ErrorMessage): void {
        for (const listener of this.listeners) {
            this.socketListener.onError(errorMessage, listener);
        }
    }

    /**
     * Notify listeners of this zone that this group left
     */
    private notifyGroupLeft(groupId: number, newZone: ZoneDescriptor | undefined): void {
        for (const listener of this.listeners) {
            if (newZone === undefined || !this.isListeningZone(listener, newZone.x, newZone.y)) {
                this.socketListener.onGroupLeaves(groupId, listener);
            } else {
                // Do not send a signal. The move event will be triggered when joining the new room.
            }
        }
    }

    private isListeningZone(socket: PusherWebSocket, x: number, y: number): boolean {
        const zoneKey = `${x},${y}`;
        return socket.getUserData().listenedZones.has(zoneKey);
    }

    private notifyGroupMove(groupDescriptor: GroupDescriptor): void {
        for (const listener of this.listeners) {
            this.socketListener.onGroupMoves(groupDescriptor, listener);
        }
    }

    private notifyUserMove(userDescriptor: UserDescriptor): void {
        if (this.socketListener.onUserMovesBulk !== undefined) {
            this.socketListener.onUserMovesBulk(userDescriptor, this.listeners);
            return;
        }
        for (const listener of this.listeners) {
            if (userIdOf(listener) === userDescriptor.userId) {
                continue;
            }
            this.socketListener.onUserMoves(userDescriptor, listener);
        }
    }

    public startListening(listener: PusherWebSocket): void {
        const userData = listener.getUserData();
        for (const [userId, user] of this.users.entries()) {
            if (userId !== userData.userId) {
                this.socketListener.onUserEnters(user, listener);
            }
        }

        for (const group of this.groups.values()) {
            this.socketListener.onGroupEnters(group, listener);
        }

        this.listeners.add(listener);
        userData.listenedZones.add(`${this.x},${this.y}`);
    }

    public stopListening(listener: PusherWebSocket): void {
        const userData = listener.getUserData();
        for (const userId of this.users.keys()) {
            if (userId !== userData.userId) {
                this.socketListener.onUserLeaves(userId, listener);
            }
        }

        for (const groupId of this.groups.keys()) {
            this.socketListener.onGroupLeaves(groupId, listener);
        }

        this.listeners.delete(listener);
        userData.listenedZones.delete(`${this.x},${this.y}`);
    }
}
