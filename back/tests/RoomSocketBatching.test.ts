import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubToPusherRoomMessage } from "@workadventure/messages";
import { BatchToPusherRoomMessage, JoinRoomMessage, PositionMessage_Direction } from "@workadventure/messages";
import { mapFetcher } from "@workadventure/map-editor/src/MapFetcher";
import { LocalUrlError } from "@workadventure/map-editor/src/LocalUrlError";
import type { GameRoom } from "../src/Model/GameRoom";
import { Point } from "../src/Model/Websocket/MessageUserPosition";
import type { UserSocket } from "../src/Model/User";
import type { RoomSocket } from "../src/RoomManager";
import { socketManager } from "../src/Services/SocketManager";

const ZONE_SIZE = 320;
const BATCH_INTERVAL_MS = 50;

interface Zone {
    x: number;
    y: number;
}

interface ZoneEvent {
    kind: "joined" | "moved" | "left";
    zone: Zone;
    userId: number;
    /** Position x of a joined or moved event. */
    x?: number;
    /** Destination zone of a left event. */
    toZone?: Zone;
}

interface RecordedWrite {
    at: number;
    payload: SubToPusherRoomMessage[];
}

/** A pusher's listenRoom stream: records what the back writes to it and when (on the fake clock). */
function createFakeRoomSocket() {
    const writes: RecordedWrite[] = [];
    let encodedBytes = 0;
    const socket = {
        writableEnded: false,
        destroyed: false,
        write: (batch: BatchToPusherRoomMessage): boolean => {
            encodedBytes += BatchToPusherRoomMessage.encode(batch).finish().length;
            writes.push({ at: Date.now(), payload: batch.payload });
            return true;
        },
    };
    return {
        socket: socket as unknown as RoomSocket,
        writes,
        endStream: () => {
            socket.writableEnded = true;
        },
        encodedBytes: () => encodedBytes,
    };
}

function toZoneEvents(write: RecordedWrite): ZoneEvent[] {
    const events: ZoneEvent[] = [];
    for (const sub of write.payload) {
        if (sub.message?.$case !== "zoneMessage") {
            continue;
        }
        const { x, y, message } = sub.message.zoneMessage;
        const zone = { x, y };
        switch (message?.$case) {
            case "userJoinedZoneMessage":
                events.push({
                    kind: "joined",
                    zone,
                    userId: message.userJoinedZoneMessage.userId,
                    x: message.userJoinedZoneMessage.position?.x,
                });
                break;
            case "userMovedMessage":
                events.push({
                    kind: "moved",
                    zone,
                    userId: message.userMovedMessage.userId,
                    x: message.userMovedMessage.position?.x,
                });
                break;
            case "userLeftZoneMessage":
                events.push({
                    kind: "left",
                    zone,
                    userId: message.userLeftZoneMessage.userId,
                    toZone: message.userLeftZoneMessage.toZone,
                });
                break;
        }
    }
    return events;
}

function createMockUserSocket(): UserSocket {
    return { write: vi.fn().mockReturnValue(true), end: vi.fn() } as unknown as UserSocket;
}

function createJoinRoomMessage(uuid: string, x: number, y: number): JoinRoomMessage {
    return JoinRoomMessage.fromPartial({
        userUuid: uuid,
        IPAddress: "10.0.0.2",
        name: uuid,
        positionMessage: { x, y, direction: PositionMessage_Direction.RIGHT, moving: true },
    });
}

function zoneOf(x: number, y: number): Zone {
    return { x: Math.floor(x / ZONE_SIZE), y: Math.floor(y / ZONE_SIZE) };
}

/**
 * Checks the order a pusher relies on, per user: a move is only reported in the zone the user is in, a leave is
 * followed by the join of the zone it announces, and nothing else comes in between.
 */
function findOrderViolations(events: ZoneEvent[], initialZones: Map<number, Zone>): string[] {
    const currentZone = new Map(initialZones);
    const expectedJoin = new Map<number, Zone>();
    const violations: string[] = [];
    for (const event of events) {
        const current = currentZone.get(event.userId);
        const expected = expectedJoin.get(event.userId);
        const label = `${event.kind} of user ${event.userId} in zone ${event.zone.x},${event.zone.y}`;
        if (event.kind === "joined") {
            if (expected === undefined || expected.x !== event.zone.x || expected.y !== event.zone.y) {
                violations.push(`${label}: no leave announced this zone`);
            }
            expectedJoin.delete(event.userId);
            currentZone.set(event.userId, event.zone);
            continue;
        }
        if (expected !== undefined) {
            violations.push(`${label}: arrived while the join of zone ${expected.x},${expected.y} was awaited`);
            continue;
        }
        if (current === undefined || current.x !== event.zone.x || current.y !== event.zone.y) {
            violations.push(`${label}: the user is in zone ${current?.x},${current?.y}`);
        }
        if (event.kind === "left" && event.toZone !== undefined) {
            expectedJoin.set(event.userId, event.toZone);
        }
    }
    return violations;
}

describe("Zone events written to a pusher's room stream", () => {
    const rooms: GameRoom[] = [];
    let roomCounter = 0;

    async function createRoom(): Promise<{ room: GameRoom; roomUrl: string }> {
        const roomUrl = `https://play.workadventu.re/_/global/localhost/batching-${roomCounter++}.json`;
        const room = await socketManager.getOrCreateRoom(roomUrl);
        rooms.push(room);
        return { room, roomUrl };
    }

    async function listenToZones(
        fake: ReturnType<typeof createFakeRoomSocket>,
        roomUrl: string,
        zones: Zone[],
    ): Promise<void> {
        await Promise.all(zones.map((zone) => socketManager.addZoneListener(fake.socket, roomUrl, zone.x, zone.y)));
    }

    beforeEach(() => {
        vi.spyOn(mapFetcher, "fetchMap").mockRejectedValue(new LocalUrlError("Local map"));
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    });

    afterEach(() => {
        for (const room of rooms.splice(0)) {
            room.destroy();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("writes the events of one 50 ms window as a single batch, in the order they happened", async () => {
        const { room, roomUrl } = await createRoom();
        const walker = await room.join(createMockUserSocket(), createJoinRoomMessage("walker", 10, 10));
        const fake = createFakeRoomSocket();
        await listenToZones(fake, roomUrl, [{ x: 0, y: 0 }]);
        fake.writes.length = 0;

        room.updatePosition(walker, new Point(20, 10, "right", true));
        vi.advanceTimersByTime(20);
        room.updatePosition(walker, new Point(30, 10, "right", true));
        vi.advanceTimersByTime(20);
        room.updatePosition(walker, new Point(40, 10, "right", true));
        vi.advanceTimersByTime(BATCH_INTERVAL_MS - 40 - 1);

        expect(fake.writes).toHaveLength(0);

        vi.advanceTimersByTime(1);

        expect(fake.writes).toHaveLength(1);
        expect(toZoneEvents(fake.writes[0]).map((event) => event.x)).toEqual([20, 30, 40]);
    });

    it("keeps a zone change between the moves around it", async () => {
        const { room, roomUrl } = await createRoom();
        const walker = await room.join(createMockUserSocket(), createJoinRoomMessage("walker", 300, 10));
        const fake = createFakeRoomSocket();
        await listenToZones(fake, roomUrl, [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
        ]);
        fake.writes.length = 0;

        room.updatePosition(walker, new Point(310, 10, "right", true));
        room.updatePosition(walker, new Point(330, 10, "right", true));
        room.updatePosition(walker, new Point(340, 10, "right", true));
        vi.advanceTimersByTime(BATCH_INTERVAL_MS);

        const events = fake.writes.flatMap(toZoneEvents);
        expect(events.map((event) => [event.kind, event.zone.x, event.x ?? event.toZone?.x])).toEqual([
            ["moved", 0, 310],
            ["left", 0, 1],
            ["joined", 1, 330],
            ["moved", 1, 340],
        ]);
    });

    it("writes the events waiting for a zone before the snapshot of a zone listened to right after", async () => {
        const { room, roomUrl } = await createRoom();
        const walker = await room.join(createMockUserSocket(), createJoinRoomMessage("walker", 10, 10));
        const neighbour = await room.join(createMockUserSocket(), createJoinRoomMessage("neighbour", 400, 10));
        const fake = createFakeRoomSocket();
        await listenToZones(fake, roomUrl, [{ x: 0, y: 0 }]);
        fake.writes.length = 0;

        room.updatePosition(walker, new Point(20, 10, "right", true));
        await listenToZones(fake, roomUrl, [{ x: 1, y: 0 }]);
        vi.advanceTimersByTime(BATCH_INTERVAL_MS);

        const events = fake.writes.flatMap(toZoneEvents);
        expect(events.map((event) => [event.kind, event.userId])).toEqual([
            ["moved", walker.id],
            ["joined", neighbour.id],
        ]);
    });

    it("does not write to a stream that ended while a batch was waiting", async () => {
        const { room, roomUrl } = await createRoom();
        const walker = await room.join(createMockUserSocket(), createJoinRoomMessage("walker", 10, 10));
        const fake = createFakeRoomSocket();
        await listenToZones(fake, roomUrl, [{ x: 0, y: 0 }]);
        fake.writes.length = 0;

        room.updatePosition(walker, new Point(20, 10, "right", true));
        fake.endStream();
        vi.advanceTimersByTime(BATCH_INTERVAL_MS);

        expect(fake.writes).toHaveLength(0);
    });

    it("leaves no timer behind once a batch is written", async () => {
        const { room, roomUrl } = await createRoom();
        const walker = await room.join(createMockUserSocket(), createJoinRoomMessage("walker", 10, 10));
        const fake = createFakeRoomSocket();
        await listenToZones(fake, roomUrl, [{ x: 0, y: 0 }]);
        const timersBeforeMove = vi.getTimerCount();

        room.updatePosition(walker, new Point(20, 10, "right", true));
        vi.advanceTimersByTime(BATCH_INTERVAL_MS);

        expect(vi.getTimerCount()).toBe(timersBeforeMove);
    });

    /**
     * The measurement behind the engine plan's item 2.2: how many writes the back makes to one pusher stream, and
     * how long an event waits before it is written, with 300 users each sending 5 moves per second (the browser
     * rate) and one pusher listening to every zone. It prints the numbers; rerun it with
     *   npm test -- --run tests/RoomSocketBatching.test.ts
     * and read the "[room-socket-batching]" line.
     */
    it("writes about 20 times per second, in order and without losing an event, with 300 walking users", async () => {
        const USERS = 300;
        const MOVES_PER_SECOND = 5;
        const SECONDS = 10;
        const STEP_PX = 40;
        const MOVE_PERIOD_MS = 1000 / MOVES_PER_SECOND;
        const MOVES_PER_USER = MOVES_PER_SECOND * SECONDS;

        const { room, roomUrl } = await createRoom();
        // A 20 x 15 grid with 400 px between users, all walking right at the same speed: nobody ever gets within a
        // group's reach, so every event is a move or a zone change.
        const users = await Promise.all(
            Array.from({ length: USERS }, async (_, i) => {
                const x = 100 + (i % 20) * 400;
                const y = 100 + Math.floor(i / 20) * 400;
                const user = await room.join(createMockUserSocket(), createJoinRoomMessage(`user-${i}`, x, y));
                // Browsers are not in phase: spread the first move of the users over one period.
                return { user, x, y, phaseMs: Math.floor((i * MOVE_PERIOD_MS) / USERS) };
            }),
        );
        const initialZones = new Map(users.map(({ user, x, y }) => [user.id, zoneOf(x, y)]));

        const fake = createFakeRoomSocket();
        const zones: Zone[] = [];
        for (let zoneY = 0; zoneY <= zoneOf(0, 100 + 14 * 400).y; zoneY++) {
            for (let zoneX = 0; zoneX <= zoneOf(100 + 19 * 400 + MOVES_PER_USER * STEP_PX, 0).x; zoneX++) {
                zones.push({ x: zoneX, y: zoneY });
            }
        }
        await listenToZones(fake, roomUrl, zones);
        fake.writes.length = 0;

        const sentAt = new Map<string, number>();
        let moves = 0;
        for (let ms = 0; ms < SECONDS * 1000; ms++) {
            for (const walker of users) {
                if (ms % MOVE_PERIOD_MS !== walker.phaseMs) {
                    continue;
                }
                walker.x += STEP_PX;
                sentAt.set(`${walker.user.id}:${walker.x}`, Date.now());
                room.updatePosition(walker.user, new Point(walker.x, walker.y, "right", true));
                moves++;
            }
            vi.advanceTimersByTime(1);
        }
        vi.advanceTimersByTime(BATCH_INTERVAL_MS);

        const events = fake.writes.flatMap(toZoneEvents);
        const latenciesMs: number[] = [];
        for (const write of fake.writes) {
            for (const event of toZoneEvents(write)) {
                if (event.kind !== "left") {
                    latenciesMs.push(write.at - (sentAt.get(`${event.userId}:${event.x}`) ?? Number.NaN));
                }
            }
        }
        latenciesMs.sort((a, b) => a - b);
        const percentile = (p: number) =>
            latenciesMs[Math.min(latenciesMs.length - 1, Math.floor(latenciesMs.length * p))];
        const subMessages = fake.writes.reduce((sum, write) => sum + write.payload.length, 0);
        const zoneChanges = events.filter((event) => event.kind === "left").length;
        const violations = findOrderViolations(events, initialZones);

        console.info(
            "[room-socket-batching]",
            JSON.stringify({
                users: USERS,
                movesPerSecondPerUser: MOVES_PER_SECOND,
                seconds: SECONDS,
                grpcWritesPerSecond: fake.writes.length / SECONDS,
                subMessagesPerSecond: subMessages / SECONDS,
                subMessagesPerWrite: Number((subMessages / fake.writes.length).toFixed(1)),
                latencyAddedMs: {
                    mean: Number((latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length).toFixed(1)),
                    p50: percentile(0.5),
                    p95: percentile(0.95),
                    max: latenciesMs[latenciesMs.length - 1],
                },
                encodedKbPerSecond: Number((fake.encodedBytes() / 1000 / SECONDS).toFixed(1)),
                zoneChanges,
                orderViolations: violations.length,
            }),
        );

        expect(violations).toEqual([]);
        expect(zoneChanges).toBeGreaterThan(0);
        // Every move reaches the pusher exactly once, as a move or as the join of the zone it entered.
        expect(latenciesMs).toHaveLength(moves);
        expect(latenciesMs.every((latency) => latency >= 0 && latency <= BATCH_INTERVAL_MS)).toBe(true);
        // One write per 50 ms window, whatever the number of events: unbatched this is 1,500 per second.
        expect(fake.writes.length).toBeLessThanOrEqual((SECONDS * 1000) / BATCH_INTERVAL_MS + 1);
    }, 120_000);
});
