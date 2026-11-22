import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AvailabilityStatus,
    PositionMessage_Direction,
    UserJoinedZoneMessage,
    type SubMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { ViewerBudget, type ViewerBudgetLimits } from "../../src/pusher/models/ViewerBudget";
import { UserDescriptor } from "../../src/pusher/models/Zone";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";

/*
 * The first scene of a socket (ViewerBudgetLimits.admitByDistance). A socket that starts watching a crowd is told about
 * the users in the order the zone lists them, which has nothing to do with where they stand, and the first selection
 * a second later replaced most of them: joins that were taken back. Admitting by distance tells it the nearest ones
 * once.
 */

function user(userId: number, x: number): UserDescriptor {
    return UserDescriptor.createFromUserJoinedZoneMessage(
        UserJoinedZoneMessage.fromPartial({
            userId,
            userUuid: `uuid-${userId}`,
            name: `user ${userId}`,
            characterTextures: [],
            position: { x, y: 0, direction: PositionMessage_Direction.RIGHT, moving: false },
            availabilityStatus: AvailabilityStatus.ONLINE,
            visitCardUrl: "",
            variables: {},
        }),
    );
}

function viewerThatRecords() {
    const events: string[] = [];
    const viewer = {
        emitInBatch: (subMessage: SubMessage) => {
            const message = subMessage.message;
            if (message?.$case === "userJoinedMessage") {
                events.push(`join ${message.userJoinedMessage.userId}`);
            } else if (message?.$case === "userLeftMessage") {
                events.push(`leave ${message.userLeftMessage.userId}`);
            }
        },
        isDisconnecting: () => false,
        getUserData: () => ({ viewport: { left: -100, right: 100, top: -100, bottom: 100 } }),
    } as unknown as PusherWebSocket;
    return { viewer, events };
}

/** `count` users on a line, the farthest first: the order the zone lists them is the reverse of their distance. */
function crowdFarthestFirst(count: number): UserDescriptor[] {
    return Array.from({ length: count }, (_, index) => user(index + 1, (count - index) * 10));
}

describe("the first scene of a viewer budget", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const limits: ViewerBudgetLimits = { fullRatePeers: 3, maxPeers: 6 };

    it("takes back most of the first scene a second later when it is the first users the zone lists", () => {
        const { viewer, events } = viewerThatRecords();
        const budget = new ViewerBudget(viewer, { ...limits, cooldownMs: 0 });

        crowdFarthestFirst(30).forEach((descriptor) => budget.enter(descriptor));
        expect(events).toEqual(["join 1", "join 2", "join 3", "join 4", "join 5", "join 6"]);
        vi.advanceTimersByTime(1000);

        // The 6 nearest are users 25 to 30: the first selection swaps all 6.
        expect(events.filter((event) => event.startsWith("leave"))).toHaveLength(6);
        expect(events.filter((event) => event.startsWith("join"))).toHaveLength(12);
        budget.stop();
    });

    it("tells the nearest users once, and takes nothing back, with admitByDistance", () => {
        const { viewer, events } = viewerThatRecords();
        const budget = new ViewerBudget(viewer, { ...limits, admitByDistance: true });

        crowdFarthestFirst(30).forEach((descriptor) => budget.enter(descriptor));
        // Nobody is told until the zones are done listing.
        expect(events).toEqual([]);
        vi.advanceTimersByTime(1);

        expect([...events].sort()).toEqual(["join 25", "join 26", "join 27", "join 28", "join 29", "join 30"]);
        events.length = 0;
        vi.advanceTimersByTime(10_000);
        expect(events).toEqual([]);
        budget.stop();
    });

    it("tells a viewer of a small crowd everyone, and goes back to telling it at once afterwards", () => {
        const { viewer, events } = viewerThatRecords();
        const budget = new ViewerBudget(viewer, { ...limits, admitByDistance: true });

        budget.enter(user(1, 10));
        budget.enter(user(2, 20));
        expect(events).toEqual([]);
        vi.advanceTimersByTime(1);
        expect([...events].sort()).toEqual(["join 1", "join 2"]);
        events.length = 0;

        budget.enter(user(3, 30));
        expect(events).toEqual(["join 3"]);
        budget.stop();
    });

    it("never tells of a user that left before the first selection, and does not let a move bring one in early", () => {
        const { viewer, events } = viewerThatRecords();
        const budget = new ViewerBudget(viewer, { ...limits, admitByDistance: true });
        const first = user(1, 10);
        const second = user(2, 20);

        budget.enter(first);
        budget.enter(second);
        budget.leave(1);
        budget.move(second);
        expect(events).toEqual([]);
        vi.advanceTimersByTime(1);

        expect(events).toEqual(["join 2"]);
        budget.stop();
    });

    it("runs no selection for a viewer that is stopped before the turn ends", () => {
        const { viewer, events } = viewerThatRecords();
        const budget = new ViewerBudget(viewer, { ...limits, admitByDistance: true });

        budget.enter(user(1, 10));
        budget.stop();
        vi.advanceTimersByTime(5);

        expect(events).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
});
