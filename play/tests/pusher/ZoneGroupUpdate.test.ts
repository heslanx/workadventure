import { describe, expect, it, vi } from "vitest";
import { GroupUpdateZoneMessage } from "@workadventure/messages";

import { Zone } from "../../src/pusher/models/Zone";
import type { GroupDescriptor, ZoneEventListener } from "../../src/pusher/models/Zone";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";

const GROUP_ID = 5;

function watcher(userId: number): PusherWebSocket {
    return { getUserData: () => ({ userId, listenedZones: new Set<string>() }) } as unknown as PusherWebSocket;
}

/** What the back says about the group. By default: 2 users, unlocked, at (100, 200). */
function groupUpdate(
    changes: Partial<{ x: number; y: number; groupSize: number; locked: boolean; userIds: number[] }> = {},
): GroupUpdateZoneMessage {
    const userIds = changes.userIds ?? [1, 2];
    return GroupUpdateZoneMessage.fromPartial({
        groupId: GROUP_ID,
        position: { x: changes.x ?? 100, y: changes.y ?? 200 },
        groupSize: changes.groupSize ?? userIds.length,
        locked: changes.locked ?? false,
        userIds,
    });
}

/**
 * A zone whose listener records what each watching socket is told about a group, as the group is when it is told: the
 * descriptor is mutable, so a test that read it later would see the latest state, not the one that was sent.
 */
function zoneWithWatchers(watcherCount: number) {
    const told: { event: "enters" | "moves"; message: ReturnType<GroupDescriptor["toGroupUpdateMessage"]> }[] = [];
    const listener = {
        onGroupEnters: vi.fn((group: GroupDescriptor) =>
            told.push({ event: "enters", message: group.toGroupUpdateMessage() }),
        ),
        onGroupMoves: vi.fn((group: GroupDescriptor) =>
            told.push({ event: "moves", message: group.toGroupUpdateMessage() }),
        ),
        onUserEnters: vi.fn(),
        onUserLeaves: vi.fn(),
    } as unknown as ZoneEventListener;
    const zone = new Zone(listener, 0, 0);
    zone.handleGroupUpdateZone(groupUpdate());
    for (let userId = 100; userId < 100 + watcherCount; userId++) {
        zone.startListening(watcher(userId));
    }
    // Starting to listen tells each watcher about the group that is already there.
    told.length = 0;
    return { zone, told, listener };
}

describe("Zone.handleGroupUpdateZone", () => {
    it("tells no watcher about a group that only moved", () => {
        const { zone, told } = zoneWithWatchers(3);

        zone.handleGroupUpdateZone(groupUpdate({ x: 130, y: 210 }));
        zone.handleGroupUpdateZone(groupUpdate({ x: 160, y: 220 }));

        expect(told).toEqual([]);
    });

    it("tells every watcher, once, about a group whose size changed", () => {
        const { zone, told } = zoneWithWatchers(3);

        zone.handleGroupUpdateZone(groupUpdate({ groupSize: 3 }));

        expect(told).toHaveLength(3);
        expect(told.every(({ event, message }) => event === "moves" && message.groupSize === 3)).toBe(true);
    });

    it("tells every watcher, once, about a group that was locked, and again when it was unlocked", () => {
        const { zone, told } = zoneWithWatchers(3);

        zone.handleGroupUpdateZone(groupUpdate({ locked: true }));
        expect(told.map(({ message }) => message.locked)).toEqual([true, true, true]);

        zone.handleGroupUpdateZone(groupUpdate({ locked: false }));
        expect(told.map(({ message }) => message.locked)).toEqual([true, true, true, false, false, false]);
    });

    it("tells every watcher about a group whose members changed while its size did not", () => {
        const { zone, told } = zoneWithWatchers(2);

        zone.handleGroupUpdateZone(groupUpdate({ userIds: [1, 3] }));

        expect(told).toHaveLength(2);
    });

    it("keeps the members a group update brings, so a later move of the group is not sent", () => {
        const { zone, told } = zoneWithWatchers(1);

        zone.handleGroupUpdateZone(groupUpdate({ userIds: [1, 3] }));
        zone.handleGroupUpdateZone(groupUpdate({ userIds: [1, 3], x: 130 }));

        expect(told).toHaveLength(1);
        expect(told[0].message.userIds).toEqual([1, 3]);
    });

    it("tells the watchers a move that comes with a change, not the moves before it", () => {
        const { zone, told } = zoneWithWatchers(1);

        zone.handleGroupUpdateZone(groupUpdate({ x: 130 }));
        zone.handleGroupUpdateZone(groupUpdate({ x: 160 }));
        zone.handleGroupUpdateZone(groupUpdate({ x: 190, locked: true }));

        expect(told).toHaveLength(1);
        expect(told[0].message).toMatchObject({ position: { x: 190, y: 200 }, locked: true });
    });

    it("gives a watcher that starts listening after silent moves the position the group has now", () => {
        const { zone, told } = zoneWithWatchers(1);
        zone.handleGroupUpdateZone(groupUpdate({ x: 130, y: 210 }));
        zone.handleGroupUpdateZone(groupUpdate({ x: 160, y: 220 }));
        told.length = 0;

        zone.startListening(watcher(200));

        expect(told).toHaveLength(1);
        expect(told[0]).toMatchObject({ event: "enters", message: { position: { x: 160, y: 220 } } });
    });
});
