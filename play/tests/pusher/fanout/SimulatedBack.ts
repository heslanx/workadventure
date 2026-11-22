import {
    AvailabilityStatus,
    PositionMessage_Direction,
    UserJoinedZoneMessage,
    UserLeftZoneMessage,
    UserMovedMessage,
    type ZoneMessage,
} from "@workadventure/messages";
import type { PositionDispatcher } from "../../../src/pusher/models/PositionDispatcher";
import type { PusherRoom } from "../../../src/pusher/models/PusherRoom";

/**
 * The part of the back that talks to a pusher about zones, as far as the pusher can tell. The back keeps the position
 * of every user and sends a zone's events to the pusher once the pusher subscribed to that zone:
 *  - a user that joins is announced to its zone;
 *  - a user that moves inside its zone is a `userMovedMessage` to that zone;
 *  - a user that crosses into another zone is a `userJoinedZoneMessage` to the new zone (with `fromZone`) and a
 *    `userLeftZoneMessage` to the old one (with `toZone`), which is how a socket that watches both is told nothing new;
 *  - when the pusher subscribes to a zone, the back first sends it every user the zone holds.
 * One SimulatedBack drives several dispatchers with the same events, to compare what they send.
 */
export class SimulatedBack {
    private readonly users = new Map<number, { x: number; y: number; moving: boolean }>();
    private readonly dispatchers: PositionDispatcher[] = [];

    public constructor(private readonly zoneSize = 320) {}

    /** The stand-in for the PusherRoom of a dispatcher: it answers a zone subscription with the users of the zone. */
    public roomFor(getDispatcher: () => PositionDispatcher): PusherRoom {
        return {
            subscribeToZone: (i: number, j: number) => {
                for (const [userId, user] of this.users) {
                    if (this.zoneOf(user.x) === i && this.zoneOf(user.y) === j) {
                        getDispatcher().handleZoneMessage(this.joined(userId, user, undefined));
                    }
                }
            },
            unsubscribeFromZone: () => undefined,
        } as unknown as PusherRoom;
    }

    public attach(dispatcher: PositionDispatcher): void {
        this.dispatchers.push(dispatcher);
    }

    public zoneOf(coordinate: number): number {
        return Math.floor(coordinate / this.zoneSize);
    }

    public join(userId: number, x: number, y: number): void {
        const user = { x, y, moving: false };
        this.users.set(userId, user);
        this.send(this.joined(userId, user, undefined));
    }

    public leave(userId: number): void {
        const user = this.users.get(userId);
        if (user === undefined) {
            return;
        }
        this.users.delete(userId);
        this.send(this.left(userId, user, undefined));
    }

    public move(userId: number, x: number, y: number, moving: boolean): void {
        const user = this.users.get(userId);
        if (user === undefined) {
            return;
        }
        const previous = { ...user };
        user.x = x;
        user.y = y;
        user.moving = moving;
        const crossed = this.zoneOf(previous.x) !== this.zoneOf(x) || this.zoneOf(previous.y) !== this.zoneOf(y);
        if (!crossed) {
            this.send({
                x: this.zoneOf(x),
                y: this.zoneOf(y),
                message: {
                    $case: "userMovedMessage",
                    userMovedMessage: UserMovedMessage.fromPartial({
                        userId,
                        position: { x, y, direction: PositionMessage_Direction.RIGHT, moving },
                    }),
                },
            });
            return;
        }
        this.send(this.joined(userId, user, { x: this.zoneOf(previous.x), y: this.zoneOf(previous.y) }));
        this.send(this.left(userId, previous, { x: this.zoneOf(x), y: this.zoneOf(y) }));
    }

    private send(message: ZoneMessage): void {
        for (const dispatcher of this.dispatchers) {
            dispatcher.handleZoneMessage(message);
        }
    }

    private joined(
        userId: number,
        user: { x: number; y: number; moving: boolean },
        fromZone: { x: number; y: number } | undefined,
    ): ZoneMessage {
        return {
            x: this.zoneOf(user.x),
            y: this.zoneOf(user.y),
            message: {
                $case: "userJoinedZoneMessage",
                userJoinedZoneMessage: UserJoinedZoneMessage.fromPartial({
                    userId,
                    userUuid: `uuid-${userId}`,
                    name: `user ${userId}`,
                    characterTextures: [],
                    position: { x: user.x, y: user.y, direction: PositionMessage_Direction.RIGHT, moving: user.moving },
                    availabilityStatus: AvailabilityStatus.ONLINE,
                    visitCardUrl: "",
                    variables: {},
                    fromZone,
                }),
            },
        };
    }

    private left(
        userId: number,
        user: { x: number; y: number },
        toZone: { x: number; y: number } | undefined,
    ): ZoneMessage {
        return {
            x: this.zoneOf(user.x),
            y: this.zoneOf(user.y),
            message: {
                $case: "userLeftZoneMessage",
                userLeftZoneMessage: UserLeftZoneMessage.fromPartial({ userId, toZone }),
            },
        };
    }
}
