import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type {
    BatchToPusherRoomMessage,
    ServerToClientMessage,
    SpaceAnswerMessage,
    SubToPusherRoomMessage,
} from "@workadventure/messages";
import {
    FilterType,
    JoinRoomFrontMessage,
    PositionMessage_Direction,
    RoomJoinedMessage,
    UserJoinedZoneMessage,
    UserMovedMessage,
    UserMovesMessage,
} from "@workadventure/messages";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { SocketManager } from "../../src/pusher/services/SocketManager";
import { apiClientRepository } from "../../src/pusher/services/ApiClientRepository";
import { analyticsTimedEventTracker } from "../../src/pusher/services/AnalyticsTimedEventTracker";
import { analyticsEventsQueue } from "../../src/pusher/services/AnalyticsEventsQueue";
import { matrixProvider } from "../../src/pusher/services/MatrixProvider";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";
import type { SpaceConnectionInterface } from "../../src/pusher/models/SpaceConnection";
import type { SpaceForSpaceConnectionInterface } from "../../src/pusher/models/Space";
import { WS_CLOSE_CODE_SESSION_DESTROYED } from "../../src/common/WebSocketCloseCodes";

const ROOM = "https://play.test/@/org/world/room";
const WORLD = "https://play.test/@/org/world";

// Zones are 320 px wide. Viewports in pixels.
const ZONE_0 = { left: 0, top: 0, right: 319, bottom: 319 };
const ZONES_0_AND_1 = { left: 0, top: 0, right: 639, bottom: 319 };
const ZONES_1_AND_2 = { left: 320, top: 0, right: 959, bottom: 319 };
const FAR_ZONE = { left: 3200, top: 3200, right: 3519, bottom: 3519 };

type BatchedMessage = Parameters<PusherWebSocket["emitInBatch"]>[0];
type BackClient = Awaited<ReturnType<typeof apiClientRepository.getClient>>;

class FakeStream extends EventEmitter {
    public readonly written: unknown[] = [];
    public readonly write = vi.fn((message: unknown) => {
        this.written.push(message);
        return true;
    });
    // Like a gRPC stream, which is a Node stream, it reports that end() was called.
    public writableEnded = false;
    public readonly end = vi.fn(() => {
        this.writableEnded = true;
    });
    public readonly cancel = vi.fn();
    public closed = false;
}

function fakeBack() {
    const userStreams: FakeStream[] = [];
    const roomStreams: FakeStream[] = [];
    const client = {
        connectToRoom: () => {
            const stream = new FakeStream();
            userStreams.push(stream);
            return stream;
        },
        listenRoom: () => {
            const stream = new FakeStream();
            roomStreams.push(stream);
            return stream;
        },
        getChannel: () => ({ getTarget: () => "back.test:50051" }),
    };
    vi.spyOn(apiClientRepository, "getClient").mockResolvedValue(client as unknown as BackClient);
    return { userStreams, roomStreams };
}

function fakeSocket(
    name: string,
    overrides: {
        viewport?: typeof ZONE_0;
        tags?: string[];
        chatID?: string;
        currentChatRoomArea?: string[];
        tabId?: string;
    } = {},
) {
    let disconnecting = false;
    let permanentlyDisconnected = false;
    const sent: ServerToClientMessage[] = [];
    const batched: BatchedMessage[] = [];
    const ended: [number | undefined, string | undefined][] = [];
    const userData = {
        roomId: ROOM,
        world: WORLD,
        userUuid: `uuid-${name}`,
        name,
        tabId: overrides.tabId ?? `tab-${name}`,
        tags: overrides.tags ?? [],
        canEdit: false,
        isLogged: false,
        characterTextures: [],
        viewport: overrides.viewport ?? ZONE_0,
        joinedRoom: false,
        spaceUserId: `${ROOM}_${name}`,
        spaces: new Set<string>(),
        joinSpacesPromise: new Map<string, Promise<void>>(),
        listenedZones: new Set<string>(),
        chatID: overrides.chatID,
        currentChatRoomArea: overrides.currentChatRoomArea ?? [],
        lastActivityAtMs: Date.now(),
    };
    const socket = {
        getUserData: () => userData,
        send: (message: ServerToClientMessage) => {
            sent.push(message);
        },
        emitInBatch: (message: BatchedMessage) => {
            batched.push(message);
        },
        isDisconnecting: () => disconnecting,
        isPermanentlyDisconnected: () => permanentlyDisconnected,
        markPermanentlyDisconnected: () => {
            permanentlyDisconnected = true;
        },
        end: (code?: number, reason?: string) => {
            disconnecting = true;
            ended.push([code, reason]);
        },
    } as unknown as PusherWebSocket;
    return { socket, sent, batched, ended };
}

type FakeSocket = ReturnType<typeof fakeSocket>;

function roomJoined(currentUserId: number): ServerToClientMessage {
    return {
        message: {
            $case: "roomJoinedMessage",
            roomJoinedMessage: RoomJoinedMessage.fromPartial({ currentUserId }),
        },
    };
}

function subscribe(x: number, y: number) {
    return { message: { $case: "subscribeZoneMessage", subscribeZoneMessage: { x, y } } };
}

function unsubscribe(x: number, y: number) {
    return { message: { $case: "unsubscribeZoneMessage", unsubscribeZoneMessage: { x, y } } };
}

function batch(...payload: SubToPusherRoomMessage["message"][]): BatchToPusherRoomMessage {
    return { payload: payload.map((message) => ({ message })) };
}

function userJoinsZone(userId: number): SubToPusherRoomMessage["message"] {
    return {
        $case: "zoneMessage",
        zoneMessage: {
            x: 0,
            y: 0,
            message: {
                $case: "userJoinedZoneMessage",
                userJoinedZoneMessage: UserJoinedZoneMessage.fromPartial({
                    userId,
                    name: `user ${userId}`,
                    position: { x: 10, y: 10, direction: PositionMessage_Direction.DOWN, moving: false },
                }),
            },
        },
    };
}

function userMovesInZone(userId: number): SubToPusherRoomMessage["message"] {
    return {
        $case: "zoneMessage",
        zoneMessage: {
            x: 0,
            y: 0,
            message: {
                $case: "userMovedMessage",
                userMovedMessage: UserMovedMessage.fromPartial({
                    userId,
                    position: { x: 20, y: 10, direction: PositionMessage_Direction.RIGHT, moving: true },
                }),
            },
        },
    };
}

function cases(socket: FakeSocket): string[] {
    return socket.batched.map(({ message }) => message?.$case ?? "");
}

// What PusherRoomSocketController's close handler does when the browser closes the socket for good (codes 1000
// and 1001): unlike a close the pusher starts, nothing calls end(), so isDisconnecting() stays false.
function closeByBrowser(manager: SocketManager, socket: FakeSocket): void {
    socket.socket.markPermanentlyDisconnected();
    manager.cleanupSocket(socket.socket);
}

/**
 * The pusher's per-socket hub, driven only through what the back and the browser send. The back is two kinds of
 * fake gRPC streams: one per user (connectToRoom) and one per room (listenRoom). Real PusherRoom, PositionDispatcher
 * and Zone instances do the fan-out, so the assertions read what reaches the sockets and the back.
 */
describe("SocketManager room traffic", () => {
    beforeEach(() => {
        vi.spyOn(analyticsTimedEventTracker, "open").mockImplementation(() => false);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    async function connect(manager: SocketManager, back: ReturnType<typeof fakeBack>, socket: FakeSocket) {
        await manager.handleConnectToRoom(socket.socket);
        const userStream = back.userStreams.at(-1);
        if (!userStream) throw new Error("no user stream was opened");
        return userStream;
    }

    async function connectAndJoin(
        manager: SocketManager,
        back: ReturnType<typeof fakeBack>,
        socket: FakeSocket,
        currentUserId: number,
    ) {
        const userStream = await connect(manager, back, socket);
        userStream.emit("data", roomJoined(currentUserId));
        return userStream;
    }

    it("opens a back stream per socket and one room stream, and relays the back's messages once the user joined", async () => {
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice", { viewport: ZONES_0_AND_1 });

        const userStream = await connect(manager, back, alice);

        expect(userStream.written).toEqual([
            {
                message: {
                    $case: "connectToRoomMessage",
                    connectToRoomMessage: { roomId: ROOM, tag: [], canEdit: false, lastCommandId: "" },
                },
            },
        ]);
        expect(back.roomStreams).toHaveLength(1);
        const [roomStream] = back.roomStreams;
        expect(roomStream.written).toEqual([
            { message: { $case: "initRoomMessage", initRoomMessage: { roomId: ROOM } } },
        ]);
        expect(manager.getRooms().has(ROOM)).toBe(true);

        userStream.emit("data", { message: undefined });
        userStream.emit("data", roomJoined(42));

        expect(alice.sent).toEqual([roomJoined(42)]);
        // The viewport stored at join time is listened to as soon as the back confirms the join.
        expect(roomStream.written.slice(1)).toEqual([subscribe(0, 0), subscribe(1, 0)]);

        const bob = fakeSocket("bob");
        const bobStream = await connect(manager, back, bob);

        expect(back.userStreams).toHaveLength(2);
        expect(bobStream).not.toBe(userStream);
        expect(bobStream.written).toEqual(userStream.written.slice(0, 1));
        expect(back.roomStreams).toHaveLength(1);

        bobStream.emit("data", roomJoined(43));

        expect(bob.sent).toEqual([roomJoined(43)]);
        expect(alice.sent).toEqual([roomJoined(42)]);
    });

    it("closes the socket with the back's reason when its back stream ends, and relays nothing afterwards", async () => {
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice");
        const userStream = await connectAndJoin(manager, back, alice, 1);
        const [roomStream] = back.roomStreams;

        userStream.emit("data", {
            message: {
                $case: "backConnectionCloseReasonMessage",
                backConnectionCloseReasonMessage: { reason: "Room deleted" },
            },
        });
        userStream.emit("end");
        userStream.emit("data", roomJoined(1));

        expect(alice.sent).toEqual([roomJoined(1)]);
        expect(alice.ended).toEqual([[WS_CLOSE_CODE_SESSION_DESTROYED, "Back lost: Room deleted"]]);
        expect(userStream.end).toHaveBeenCalledTimes(1);
        expect(roomStream.written.slice(1)).toEqual([subscribe(0, 0), unsubscribe(0, 0)]);
        expect(roomStream.cancel).toHaveBeenCalledTimes(1);
        expect(manager.getRooms().has(ROOM)).toBe(false);
    });

    it("closes the socket once when its back stream fails, and relays nothing afterwards", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice");
        const userStream = await connectAndJoin(manager, back, alice, 1);
        const [roomStream] = back.roomStreams;

        userStream.emit("error", new Error("14 UNAVAILABLE: back.test:50051"));
        userStream.emit("data", roomJoined(1));
        userStream.emit("error", new Error("14 UNAVAILABLE: back.test:50051"));

        expect(alice.sent).toEqual([roomJoined(1)]);
        expect(alice.ended).toEqual([[WS_CLOSE_CODE_SESSION_DESTROYED, "Error while connecting to back server"]]);
        expect(userStream.end).toHaveBeenCalledTimes(1);
        expect(roomStream.written.slice(1)).toEqual([subscribe(0, 0), unsubscribe(0, 0)]);
        expect(roomStream.cancel).toHaveBeenCalledTimes(1);
        expect(manager.getRooms().has(ROOM)).toBe(false);
    });

    it("forwards each move to the user's back stream, then moves the zone subscriptions with the viewport", async () => {
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice", { viewport: ZONES_0_AND_1 });
        const userStream = await connectAndJoin(manager, back, alice, 1);
        const [roomStream] = back.roomStreams;
        const move = UserMovesMessage.fromPartial({
            position: { x: 400, y: 100, direction: PositionMessage_Direction.RIGHT, moving: true },
            viewport: ZONES_1_AND_2,
        });

        manager.handleUserMovesMessage(alice.socket, move);
        manager.handleUserMovesMessage(alice.socket, move);

        expect(userStream.written.slice(1)).toEqual([
            { message: { $case: "userMovesMessage", userMovesMessage: move } },
            { message: { $case: "userMovesMessage", userMovesMessage: move } },
        ]);
        expect(roomStream.written.slice(1)).toEqual([
            subscribe(0, 0),
            subscribe(1, 0),
            subscribe(2, 0),
            unsubscribe(0, 0),
        ]);
    });

    it("SM-01 (pinned): forwards a move without a viewport to the back, then throws and keeps the old zones", async () => {
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice");
        const userStream = await connectAndJoin(manager, back, alice, 1);
        const [roomStream] = back.roomStreams;
        const move = UserMovesMessage.fromPartial({
            position: { x: 400, y: 100, direction: PositionMessage_Direction.RIGHT, moving: true },
        });

        expect(() => manager.handleUserMovesMessage(alice.socket, move)).toThrow(
            "Missing viewport in UserMovesMessage",
        );

        expect(userStream.written.slice(1)).toEqual([
            { message: { $case: "userMovesMessage", userMovesMessage: move } },
        ]);
        expect(roomStream.written.slice(1)).toEqual([subscribe(0, 0)]);
    });

    it("sends a zone event to each socket watching the zone, except the user it is about", async () => {
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice");
        const bob = fakeSocket("bob");
        const carol = fakeSocket("carol", { viewport: FAR_ZONE });
        await connectAndJoin(manager, back, alice, 1);
        await connectAndJoin(manager, back, bob, 2);
        await connectAndJoin(manager, back, carol, 3);
        const [roomStream] = back.roomStreams;

        roomStream.emit("data", batch(userJoinsZone(1), userMovesInZone(1)));

        expect(back.roomStreams).toHaveLength(1);
        expect(roomStream.written.slice(1)).toEqual([subscribe(0, 0), subscribe(10, 10)]);
        expect(cases(bob)).toEqual(["userJoinedMessage", "userMovedMessage"]);
        expect(bob.batched[0]).toMatchObject({ message: { userJoinedMessage: { userId: 1, name: "user 1" } } });
        expect(bob.batched[1]).toMatchObject({
            message: { userMovedMessage: { userId: 1, position: { x: 20, moving: true } } },
        });
        expect(cases(alice)).toEqual([]);
        expect(cases(carol)).toEqual([]);
    });

    it("sends a room variable to every socket in the room that may read it", async () => {
        const back = fakeBack();
        const manager = new SocketManager();
        const admin = fakeSocket("admin", { tags: ["admin"] });
        const guest = fakeSocket("guest");
        await connect(manager, back, admin);
        await connect(manager, back, guest);
        const [roomStream] = back.roomStreams;

        roomStream.emit(
            "data",
            batch(
                { $case: "variableMessage", variableMessage: { name: "public", value: "1", readableBy: "" } },
                { $case: "variableMessage", variableMessage: { name: "secret", value: "2", readableBy: "admin" } },
            ),
        );

        const names = (socket: FakeSocket) =>
            socket.batched.map(({ message }) =>
                message?.$case === "variableMessage" ? message.variableMessage.name : "",
            );
        expect(names(admin)).toEqual(["public", "secret"]);
        expect(names(guest)).toEqual(["public"]);
    });

    it("keeps a room and its shared zone while a socket stays, and closes the room with its last socket", async () => {
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice", { viewport: ZONES_0_AND_1 });
        const bob = fakeSocket("bob");
        const aliceStream = await connectAndJoin(manager, back, alice, 1);
        const bobStream = await connectAndJoin(manager, back, bob, 2);
        const [roomStream] = back.roomStreams;

        manager.cleanupSocket(alice.socket);

        expect(roomStream.written.slice(1)).toEqual([subscribe(0, 0), subscribe(1, 0), unsubscribe(1, 0)]);
        expect(aliceStream.end).toHaveBeenCalledTimes(1);
        expect(roomStream.cancel).not.toHaveBeenCalled();
        expect(manager.getRooms().has(ROOM)).toBe(true);

        manager.cleanupSocket(bob.socket);

        expect(roomStream.written.slice(4)).toEqual([unsubscribe(0, 0)]);
        expect(bobStream.end).toHaveBeenCalledTimes(1);
        expect(roomStream.cancel).toHaveBeenCalledTimes(1);
        expect(manager.getRooms().has(ROOM)).toBe(false);
    });

    // SM-03: the close handler cleans the socket up without end(), so isDisconnecting() stays false and the back
    // stream's end cleans it up again. The second run repeats one call: it ends the back stream again.
    it("SM-03 (pinned): a socket the browser closed is cleaned up again when its back stream ends, and ends that stream twice", async () => {
        const kick = vi.spyOn(matrixProvider, "kickUserFromRoom").mockResolvedValue(undefined);
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice", { chatID: "@alice:chat.test", currentChatRoomArea: ["!area:chat.test"] });
        const bob = fakeSocket("bob");
        const aliceStream = await connectAndJoin(manager, back, alice, 1);
        await connectAndJoin(manager, back, bob, 2);
        const [roomStream] = back.roomStreams;

        closeByBrowser(manager, alice);
        aliceStream.emit("end");

        expect(aliceStream.end).toHaveBeenCalledTimes(2);
        expect(alice.ended).toEqual([
            [WS_CLOSE_CODE_SESSION_DESTROYED, "Back lost: No close reason received from back server."],
        ]);
        expect(kick.mock.calls).toEqual([["@alice:chat.test", "!area:chat.test"]]);
        // Bob still watches the zone and holds the room.
        expect(roomStream.written.slice(1)).toEqual([subscribe(0, 0)]);
        expect(roomStream.cancel).not.toHaveBeenCalled();
        expect(manager.getRooms().has(ROOM)).toBe(true);
    });

    // The other order: the pusher closes the socket first, then the close handler cleans it up when the transport
    // closes. Here cleanupSocket's isDisconnecting() guard skips the second run.
    it("ends the back stream of a socket the pusher closed once, although the close handler cleans it up again", async () => {
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice");
        const aliceStream = await connectAndJoin(manager, back, alice, 1);

        aliceStream.emit("end");
        manager.cleanupSocket(alice.socket);

        expect(aliceStream.end).toHaveBeenCalledTimes(1);
        expect(alice.ended).toEqual([
            [WS_CLOSE_CODE_SESSION_DESTROYED, "Back lost: No close reason received from back server."],
        ]);
    });

    it("removes a socket the browser closed from its space once, although its back stream's end cleans it up again", async () => {
        const back = fakeBack();
        type SpaceStream = Awaited<ReturnType<SpaceConnectionInterface["getSpaceStreamToBackPromise"]>>;
        const stream = mock<SpaceStream>({ closed: false });
        let connectedSpace: SpaceForSpaceConnectionInterface | undefined;
        const written = () => stream.write.mock.calls.map(([{ message }]) => message);
        const writtenCases = () =>
            written().map((message) =>
                message?.$case === "spaceQueryMessage" ? message.spaceQueryMessage.query?.$case : message?.$case,
            );
        const answerLastQuery = (answer: NonNullable<SpaceAnswerMessage["answer"]>) => {
            const query = written()
                .map((message) => (message?.$case === "spaceQueryMessage" ? message.spaceQueryMessage : undefined))
                .filter((spaceQueryMessage) => spaceQueryMessage !== undefined)
                .at(-1);
            if (!query) throw new Error("the pusher wrote no query to the space back");
            connectedSpace?.dispatcher.handleMessage({
                message: {
                    $case: "spaceAnswerMessage",
                    spaceAnswerMessage: { id: query.id, spaceName: connectedSpace.name, answer },
                },
            });
        };
        const manager = new SocketManager({
            getSpaceStreamToBackPromise: (space) => {
                connectedSpace = space;
                return Promise.resolve(stream);
            },
            removeSpace: () => undefined,
        });
        const alice = fakeSocket("alice");
        const aliceStream = await connectAndJoin(manager, back, alice, 1);
        const joins = manager.handleJoinSpace(alice.socket, "world.meeting", "meeting", FilterType.ALL_USERS, [], {
            signal: new AbortController().signal,
        });
        await vi.waitFor(() => expect(writtenCases()).toEqual(["addSpaceUserQuery"]));
        answerLastQuery({
            $case: "addSpaceUserAnswer",
            addSpaceUserAnswer: { spaceName: "world.meeting", spaceUserId: `${ROOM}_1` },
        });
        await joins;

        closeByBrowser(manager, alice);
        await vi.waitFor(() => expect(writtenCases()).toContain("removeSpaceUserQuery"));
        // The second cleanup runs while the space back has not answered the first one's removal.
        aliceStream.emit("end");
        answerLastQuery({
            $case: "removeSpaceUserAnswer",
            removeSpaceUserAnswer: { spaceName: "world.meeting", spaceUserId: `${ROOM}_1` },
        });
        await vi.waitFor(() => expect([...alice.socket.getUserData().spaces]).toEqual([]));

        // The last message is the emptied space leaving the back.
        expect(writtenCases()).toEqual([
            "addSpaceUserQuery",
            "deleteSpaceUserToNotifyMessage",
            "removeSpaceUserQuery",
            "leaveSpaceMessage",
        ]);
    });

    // SM-02: the back answers a join that was in flight when the pusher closed the socket. A socket that left its
    // room takes no zone, so nothing keeps the room open after its last socket.
    it("SM-02 (fixed): a join the back confirms after the socket closed takes no zone, and the room closes with its last socket", async () => {
        const back = fakeBack();
        const manager = new SocketManager();
        const alice = fakeSocket("alice", { viewport: FAR_ZONE });
        const bob = fakeSocket("bob");
        const aliceStream = await connect(manager, back, alice);
        await connectAndJoin(manager, back, bob, 2);
        const [roomStream] = back.roomStreams;

        manager.cleanupSocket(alice.socket);
        alice.socket.end(1008, "Room no longer exists");
        aliceStream.emit("data", roomJoined(1));
        manager.cleanupSocket(bob.socket);

        expect(alice.sent).toEqual([]);
        expect(roomStream.written.slice(1)).toEqual([subscribe(0, 0), unsubscribe(0, 0)]);
        expect(roomStream.cancel).toHaveBeenCalledTimes(1);
        expect(manager.getRooms().has(ROOM)).toBe(false);
    });

    /**
     * A connection session is two analytics rows: "user.connected" when the back confirms the join and
     * "user.disconnected" when the socket is cleaned up. The real tracker runs here; the rows are read from its queue.
     */
    describe("connection session", () => {
        let sessionRows: [string, unknown][];

        beforeEach(() => {
            // The outer beforeEach stubs open(); spying again returns that stub, which is then removed.
            vi.spyOn(analyticsTimedEventTracker, "open").mockRestore();
            sessionRows = [];
            vi.spyOn(analyticsEventsQueue, "enqueueEvent").mockImplementation((event) => {
                const connectionId: unknown =
                    "connectionId" in event.properties ? event.properties.connectionId : undefined;
                sessionRows.push([event.eventName, connectionId]);
            });
        });

        // The tracker is a module singleton: a session that a failed test left open would show up in the next one.
        afterEach(() => {
            analyticsTimedEventTracker.closeAll();
        });

        it("opens a session when the back confirms the join, and closes it when the socket is cleaned up", async () => {
            const back = fakeBack();
            const manager = new SocketManager();
            const alice = fakeSocket("alice");

            await connectAndJoin(manager, back, alice, 1);

            expect(sessionRows).toEqual([["user.connected", "tab-alice"]]);

            manager.cleanupSocket(alice.socket);

            expect(sessionRows).toEqual([
                ["user.connected", "tab-alice"],
                ["user.disconnected", "tab-alice"],
            ]);
            expect(analyticsTimedEventTracker.closeAll()).toBe(0);
        });

        it("reports one disconnection for a socket the browser closed, although its back stream's end cleans it up again", async () => {
            const back = fakeBack();
            const manager = new SocketManager();
            const alice = fakeSocket("alice");
            const aliceStream = await connectAndJoin(manager, back, alice, 1);

            closeByBrowser(manager, alice);
            aliceStream.emit("end");

            expect(sessionRows).toEqual([
                ["user.connected", "tab-alice"],
                ["user.disconnected", "tab-alice"],
            ]);
        });

        // The tracker keys sessions by tabId, which the tab's next socket shares.
        it("SM-03 (pinned): the old socket's second cleanup ends the next socket's session", async () => {
            const back = fakeBack();
            const manager = new SocketManager();
            const closedSocket = fakeSocket("alice", { tabId: "tab-1" });
            const nextSocket = fakeSocket("alice", { tabId: "tab-1" });
            const closedStream = await connectAndJoin(manager, back, closedSocket, 1);
            closeByBrowser(manager, closedSocket);
            await connectAndJoin(manager, back, nextSocket, 2);

            closedStream.emit("end");

            expect(sessionRows).toEqual([
                ["user.connected", "tab-1"],
                ["user.disconnected", "tab-1"],
                ["user.connected", "tab-1"],
                ["user.disconnected", "tab-1"],
            ]);
        });

        it("keeps the next socket's session closed when that socket is cleaned up", async () => {
            const back = fakeBack();
            const manager = new SocketManager();
            const closedSocket = fakeSocket("alice", { tabId: "tab-1" });
            const nextSocket = fakeSocket("alice", { tabId: "tab-1" });
            const closedStream = await connectAndJoin(manager, back, closedSocket, 1);
            closeByBrowser(manager, closedSocket);
            await connectAndJoin(manager, back, nextSocket, 2);

            closedStream.emit("end");
            manager.cleanupSocket(nextSocket.socket);

            expect(sessionRows).toEqual([
                ["user.connected", "tab-1"],
                ["user.disconnected", "tab-1"],
                ["user.connected", "tab-1"],
                ["user.disconnected", "tab-1"],
            ]);
        });

        // The browser can open an interval before it joins the room: the controller hands every analytics report
        // to the tracker without a join check.
        it("closes an interval the browser opened on a socket that never joined, when the socket is cleaned up", async () => {
            const back = fakeBack();
            const manager = new SocketManager();
            const alice = fakeSocket("alice");
            await connect(manager, back, alice);
            analyticsTimedEventTracker.open("cowebsite-1", "cowebsite.closed", {}, alice.socket.getUserData());

            manager.cleanupSocket(alice.socket);

            expect(sessionRows).toEqual([
                ["cowebsite.opened", undefined],
                ["cowebsite.closed", undefined],
            ]);
            expect(analyticsTimedEventTracker.closeAll()).toBe(0);
        });

        // A failed join closes the session itself, then cleans the socket up.
        it("reports one disconnection when the join fails after the back confirmed it", async () => {
            vi.spyOn(console, "error").mockImplementation(() => undefined);
            const back = fakeBack();
            const manager = new SocketManager();
            const alice = fakeSocket("alice");
            const aliceStream = await connectAndJoin(manager, back, alice, 1);
            aliceStream.write.mockImplementationOnce(() => {
                throw new Error("back is down");
            });

            await manager.handleJoinRoom(
                alice.socket,
                JoinRoomFrontMessage.fromPartial({ positionMessage: {}, viewportMessage: ZONE_0 }),
            );

            expect(sessionRows).toEqual([
                ["user.connected", "tab-alice"],
                ["user.disconnected", "tab-alice"],
            ]);
            expect(aliceStream.end).toHaveBeenCalledTimes(2);
            expect(alice.ended).toEqual([[WS_CLOSE_CODE_SESSION_DESTROYED, "Error while connecting to back server"]]);
        });

        // SM-02, remainder: the cleanup already closed the socket's intervals, so nothing would close a session
        // that a late join opened before the pusher stops, when server.ts closes every interval.
        it("SM-02 (fixed): a join the back confirms after the pusher closed the socket opens no session", async () => {
            const back = fakeBack();
            const manager = new SocketManager();
            const alice = fakeSocket("alice");
            const bob = fakeSocket("bob");
            const aliceStream = await connect(manager, back, alice);
            await connect(manager, back, bob);

            manager.cleanupSocket(alice.socket);
            alice.socket.end(1008, "Room no longer exists");
            aliceStream.emit("data", roomJoined(1));
            aliceStream.emit("end");

            expect(sessionRows).toEqual([]);
            expect(analyticsTimedEventTracker.closeAll()).toBe(0);
        });

        // SM-02, remainder: here the second cleanup (SM-03), run when the back stream ends, would close a late
        // session, and its two rows would report a connection for a user who had already left.
        it("SM-02 (fixed): a join the back confirms after the browser closed the socket opens no session", async () => {
            const back = fakeBack();
            const manager = new SocketManager();
            const alice = fakeSocket("alice");
            const bob = fakeSocket("bob");
            const aliceStream = await connect(manager, back, alice);
            await connect(manager, back, bob);

            closeByBrowser(manager, alice);
            aliceStream.emit("data", roomJoined(1));
            aliceStream.emit("end");

            expect(sessionRows).toEqual([]);
            expect(analyticsTimedEventTracker.closeAll()).toBe(0);
        });
    });

    it("creates one space per name, shares it between sockets, and sends each join to the space back", async () => {
        const spaceStream = new FakeStream();
        type SpaceStream = Awaited<ReturnType<SpaceConnectionInterface["getSpaceStreamToBackPromise"]>>;
        let connectedSpace: SpaceForSpaceConnectionInterface | undefined;
        const getSpaceStreamToBackPromise = vi.fn((space: SpaceForSpaceConnectionInterface) => {
            connectedSpace = space;
            return Promise.resolve(spaceStream as unknown as SpaceStream);
        });
        const manager = new SocketManager({
            getSpaceStreamToBackPromise,
            removeSpace: vi.fn(),
        });
        const alice = fakeSocket("alice");
        const bob = fakeSocket("bob");
        const carol = fakeSocket("carol");
        const signal = new AbortController().signal;
        const answerLastQuery = (spaceUserId: string) => {
            const query = spaceStream.written.at(-1) as { message: { spaceQueryMessage: { id: number } } };
            connectedSpace?.dispatcher.handleMessage({
                message: {
                    $case: "spaceAnswerMessage",
                    spaceAnswerMessage: {
                        id: query.message.spaceQueryMessage.id,
                        spaceName: "world.meeting",
                        answer: {
                            $case: "addSpaceUserAnswer",
                            addSpaceUserAnswer: { spaceName: "world.meeting", spaceUserId },
                        },
                    },
                },
            });
        };

        const aliceJoins = manager.handleJoinSpace(alice.socket, "world.meeting", "meeting", FilterType.ALL_USERS, [], {
            signal,
        });
        await vi.waitFor(() => expect(spaceStream.write).toHaveBeenCalledTimes(1));
        answerLastQuery(`${ROOM}_alice`);
        await aliceJoins;

        const bobJoins = manager.handleJoinSpace(bob.socket, "world.meeting", "meeting", FilterType.ALL_USERS, [], {
            signal,
        });
        await vi.waitFor(() => expect(spaceStream.write).toHaveBeenCalledTimes(2));
        answerLastQuery(`${ROOM}_bob`);
        await bobJoins;

        await expect(
            manager.handleJoinSpace(carol.socket, "world.meeting", "meeting", FilterType.LIVE_STREAMING_USERS, [], {
                signal,
            }),
        ).rejects.toThrow("Error: Space filter type mismatch");

        expect(getSpaceStreamToBackPromise).toHaveBeenCalledTimes(1);
        expect(
            spaceStream.written.map((written) => {
                const { spaceQueryMessage } = (
                    written as {
                        message: {
                            spaceQueryMessage: {
                                spaceName: string;
                                query: { $case: string; addSpaceUserQuery: { user: { spaceUserId: string } } };
                            };
                        };
                    }
                ).message;
                return [
                    spaceQueryMessage.spaceName,
                    spaceQueryMessage.query.$case,
                    spaceQueryMessage.query.addSpaceUserQuery.user.spaceUserId,
                ];
            }),
        ).toEqual([
            ["world.meeting", "addSpaceUserQuery", `${ROOM}_alice`],
            ["world.meeting", "addSpaceUserQuery", `${ROOM}_bob`],
        ]);
        expect([...alice.socket.getUserData().spaces]).toEqual(["world.meeting"]);
        expect([...carol.socket.getUserData().spaces]).toEqual([]);
    });
});
