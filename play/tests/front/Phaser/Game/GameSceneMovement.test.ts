// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock, MockInstance } from "vitest";
import { NEVER } from "rxjs";
import type { Subject } from "rxjs";
import { PositionMessage_Direction } from "@workadventure/messages";
import type { PositionMessage } from "@workadventure/messages";
import type { Movable, SpatialMap } from "@workadventure/shared-utils";
import { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import type { HasPlayerMovedInterface } from "../../../../src/front/Api/Events/HasPlayerMovedInterface";
import { registerSceneExtension } from "../../../../src/front/ExternalModule/ClientExtensionPoints";
import type { SceneFrameContext } from "../../../../src/front/ExternalModule/ClientExtensionPoints";
import { iframeListener } from "../../../../src/front/Api/IframeListener";
import { gameManager } from "../../../../src/front/Phaser/Game/GameManager";
import type { Room } from "../../../../src/front/Connection/Room";
import type { RemotePlayer } from "../../../../src/front/Phaser/Entity/RemotePlayer";
import type { RemotePlayersRepository } from "../../../../src/front/Phaser/Game/RemotePlayersRepository";
import { hasMovedEventName } from "../../../../src/front/Phaser/Player/Player";
import { biggestAvailableAreaStore } from "../../../../src/front/Stores/BiggestAvailableAreaStore";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/svelte", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    captureException,
}));

// Characterization tests: they pin what GameScene does today, quirks included (see docs/TECH-DEBT.md).
// GameScene is too heavy to boot in a unit test, so each test builds it with its real constructor (real field
// initializers, real repository and interpolator) and overrides only what would need a running Phaser game.

// A 960x540 camera view on a map much larger than the screen, so that the camera scrolls with the player.
const WORLD_VIEW = { x: 100, y: 50, right: 1060, bottom: 590 };
const MAP_SIZE = 6400;
// What the scene knows of the camera view, and what the server must watch: that view plus 300 px, cut at the map edge.
const RAW_VIEWPORT = { left: 100, top: 50, right: 1060, bottom: 590 };
const SERVER_VIEWPORT = { left: 0, top: 0, right: 1360, bottom: 890 };

type UserJoined = Parameters<RemotePlayersRepository["addPlayer"]>[0];
type UserMoved = Parameters<RemotePlayersRepository["movePlayer"]>[0];
type SharePosition = (
    x: number,
    y: number,
    direction: PositionMessage_Direction,
    moving: boolean,
    viewport: unknown,
) => void;

interface FakeRemotePlayer extends Movable {
    userId: number;
    x: number;
    y: number;
    companion: undefined;
    positions: HasPlayerMovedInterface[];
    updatePosition(position: HasPlayerMovedInterface): void;
    destroy: Mock<() => void>;
}

// The private members a test reaches: an instance property replaces a method, as a testing subclass would.
interface GameSceneInternals {
    // Public on the scene, where it takes RemotePlayer values. Through here a test sets a fake player.
    MapPlayersByKey: Map<number, unknown>;
    currentTick: number;
    connection: unknown;
    hasJoinedRoom: boolean;
    CurrentPlayer: unknown;
    playerVariablesManager: unknown;
    sharedVariablesManager: unknown;
    userInputManager: unknown;
    activatablesManager: unknown;
    gameMapFrontWrapper: unknown;
    actionableItems: Map<number, unknown>;
    remotePlayersSpatialIndex: SpatialMap<number, Movable>;
    playerName: string;
    joinRoom(): Promise<void>;
    _sendViewportToServer(): void;
    doAddPlayer(data: { userId: number; position: PositionMessage }): void;
    pushPlayerPosition(event: HasPlayerMovedInterface): void;
    handleCurrentPlayerHasMovedEvent(event: HasPlayerMovedInterface): void;
    removeAllRemotePlayers(): void;
}

function fakeRemotePlayer(userId: number, x: number, y: number): FakeRemotePlayer {
    const player: FakeRemotePlayer = {
        userId,
        x,
        y,
        companion: undefined,
        positions: [],
        updatePosition(position) {
            player.positions.push(position);
            player.x = position.x;
            player.y = position.y;
        },
        destroy: vi.fn(),
        getPosition: () => ({ x: player.x, y: player.y }),
        // No test reads the index by position, so the fake never announces a move.
        moved$: NEVER,
    };
    return player;
}

function createScene() {
    const room = { key: "https://play.example/_/global/map.json", mapUrl: "https://play.example/map.json" };
    const scene = new GameScene(room as unknown as Room, "characterization-scene");
    const internals = scene as unknown as GameSceneInternals;
    const sharePosition = vi.fn<SharePosition>();
    const setViewport = vi.fn<(viewport: unknown) => void>();
    internals.connection = { sharePosition, setViewport, closeConnection: vi.fn(), getUserId: () => 1 };
    // The scene's own viewport code reads the renderer, the main camera and the map size.
    const worldView = { ...WORLD_VIEW };
    const preRender = vi.fn();
    Object.assign(scene, {
        scene: { scene: { renderer: {} } },
        cameras: { main: { worldView, preRender } },
        Map: { widthInPixels: MAP_SIZE, heightInPixels: MAP_SIZE },
    });
    const remotePlayers = new Map<number, FakeRemotePlayer>();
    internals.doAddPlayer = (data) => {
        const player = fakeRemotePlayer(data.userId, data.position.x, data.position.y);
        remotePlayers.set(data.userId, player);
        // The stub keeps MapPlayersByKey and the spatial index in step, as the real doAddPlayer does.
        scene.MapPlayersByKey.set(data.userId, player as unknown as RemotePlayer);
        internals.remotePlayersSpatialIndex.set(data.userId, player);
    };
    const shared = () =>
        sharePosition.mock.calls.map(([x, , direction, moving]) => ({
            x,
            direction,
            moving,
        }));
    return {
        scene,
        internals,
        sharePosition,
        setViewport,
        worldView,
        preRender,
        shared,
        remotePlayers,
    };
}

function move(x: number, direction: PositionMessage_Direction, moving = true): HasPlayerMovedInterface {
    return { x, y: 100, direction, moving };
}

/**
 * Joins the room with a local player that walks right 10 px on each frame while `walking` is set. Like Player.moveUser,
 * its moveUser emits the move synchronously inside update(), and the scene listens to it first, as connect() does.
 */
function joinWithLocalPlayer(internals: GameSceneInternals) {
    const localPlayer = Object.assign(new Phaser.Events.EventEmitter(), {
        x: 0,
        y: 100,
        walking: false,
        moveUser() {
            if (localPlayer.walking) {
                localPlayer.x += 10;
                localPlayer.emit(hasMovedEventName, move(localPlayer.x, PositionMessage_Direction.RIGHT));
            }
        },
    });
    localPlayer.on(hasMovedEventName, (event: HasPlayerMovedInterface) =>
        internals.handleCurrentPlayerHasMovedEvent(event),
    );
    internals.CurrentPlayer = localPlayer;
    internals.hasJoinedRoom = true;
    internals.userInputManager = { getEventListForGameTick: () => ({ get: () => false }) };
    internals.activatablesManager = {
        updateActivatableObjectsDistances: vi.fn(),
        deduceSelectedActivatableObjectByDistance: vi.fn(),
    };
    internals.gameMapFrontWrapper = { setPosition: vi.fn(), getActivatableEntities: () => [] };
    return localPlayer;
}

function joined(userId: number, x: number, y: number): UserJoined {
    return {
        userId,
        position: { x, y, direction: PositionMessage_Direction.DOWN, moving: false },
    } as unknown as UserJoined;
}

function moved(userId: number, x: number, y: number): UserMoved {
    return {
        userId,
        position: { x, y, direction: PositionMessage_Direction.RIGHT, moving: true },
    };
}

type DriftReport = [message: string, state: Record<string, number | undefined>];

/** Each drift report goes to the console and to Sentry with the same message and state. */
function expectDriftReports(reports: DriftReport[]): void {
    expect(vi.mocked(console.error).mock.calls).toEqual(reports);
    expect(captureException.mock.calls).toEqual(
        reports.map(([message, state]) => [new Error(message), { extra: state }]),
    );
}

let hasPlayerMoved: MockInstance<typeof iframeListener.hasPlayerMoved>;

beforeEach(() => {
    vi.spyOn(biggestAvailableAreaStore, "consumePendingRecompute").mockReturnValue(false);
    hasPlayerMoved = vi.spyOn(iframeListener, "hasPlayerMoved").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    captureException.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("GameScene position sharing (pushPlayerPosition)", () => {
    it("shares a turn and a stop at once, and a straight walk at most once per POSITION_DELAY", () => {
        const { internals, shared } = createScene();
        const send = (tick: number, event: HasPlayerMovedInterface) => {
            internals.currentTick = tick;
            internals.pushPlayerPosition(event);
        };
        send(10_000, move(1, PositionMessage_Direction.LEFT));
        send(10_050, move(2, PositionMessage_Direction.LEFT));
        send(10_199, move(3, PositionMessage_Direction.LEFT));
        send(10_200, move(4, PositionMessage_Direction.LEFT));
        send(10_210, move(5, PositionMessage_Direction.UP));
        send(10_220, move(6, PositionMessage_Direction.UP, false));
        const stop = move(7, PositionMessage_Direction.UP, false);
        send(10_230, stop);
        send(10_240, stop);

        expect(shared()).toEqual([
            { x: 1, direction: PositionMessage_Direction.LEFT, moving: true },
            { x: 4, direction: PositionMessage_Direction.LEFT, moving: true },
            { x: 5, direction: PositionMessage_Direction.UP, moving: true },
            { x: 6, direction: PositionMessage_Direction.UP, moving: false },
            { x: 7, direction: PositionMessage_Direction.UP, moving: false },
        ]);
        // Map scripts see exactly the shared events.
        expect(hasPlayerMoved).toHaveBeenCalledTimes(5);
    });

    // GS-01 (fixed): a first walk heading DOWN, the placeholder's direction, used to stay unshared until the player
    // turned or stopped, because "currentTick - lastSentTick" was NaN before the first send.
    it("GS-01: shares a first walk heading DOWN like any other walk", () => {
        const { internals, shared } = createScene();
        for (let tick = 10_000; tick <= 10_600; tick += 100) {
            internals.currentTick = tick;
            internals.pushPlayerPosition(move(tick - 10_000, PositionMessage_Direction.DOWN));
        }
        expect(shared()).toEqual([
            { x: 0, direction: PositionMessage_Direction.DOWN, moving: true },
            { x: 200, direction: PositionMessage_Direction.DOWN, moving: true },
            { x: 400, direction: PositionMessage_Direction.DOWN, moving: true },
            { x: 600, direction: PositionMessage_Direction.DOWN, moving: true },
        ]);

        internals.currentTick = 10_700;
        internals.pushPlayerPosition(move(700, PositionMessage_Direction.DOWN, false));
        expect(shared()).toHaveLength(5);
        expect(shared()[4]).toEqual({ x: 700, direction: PositionMessage_Direction.DOWN, moving: false });
    });
});

// The pusher keeps the last rectangle it received, from a move or from a viewport message. While the camera scrolled, a
// move that carried the raw camera view and a viewport message that carried the view plus a margin made it drop and
// re-add the zones of the ring between the two, up to 5 times per second.
describe("GameScene server viewport (the rectangle the pusher watches)", () => {
    it("shares the viewport message's rectangle in every move, not the raw camera view", () => {
        const { internals, sharePosition } = createScene();
        internals.currentTick = 10_000;
        internals.pushPlayerPosition(move(1, PositionMessage_Direction.LEFT));
        internals.currentTick = 10_010;
        internals.pushPlayerPosition(move(2, PositionMessage_Direction.UP));
        internals.currentTick = 10_020;
        internals.pushPlayerPosition(move(3, PositionMessage_Direction.UP, false));

        expect(sharePosition.mock.calls.map(([, , , , viewport]) => viewport)).toEqual([
            SERVER_VIEWPORT,
            SERVER_VIEWPORT,
            SERVER_VIEWPORT,
        ]);
    });

    it("falls back to the camera view when the widened rectangle has no area", () => {
        const { internals, sharePosition } = createScene();
        Object.assign(internals, { Map: { widthInPixels: 0, heightInPixels: 0 } });

        internals.currentTick = 10_000;
        internals.pushPlayerPosition(move(1, PositionMessage_Direction.LEFT));

        expect(sharePosition.mock.calls.map(([, , , , viewport]) => viewport)).toEqual([RAW_VIEWPORT]);
    });

    it("sends a viewport message only for a rectangle that the last message, a move included, did not carry", () => {
        const { internals, setViewport, worldView } = createScene();
        const scroll = (pixels: number) => {
            worldView.x += pixels;
            worldView.right += pixels;
        };
        internals.currentTick = 10_000;
        internals.pushPlayerPosition(move(1, PositionMessage_Direction.LEFT));
        internals._sendViewportToServer();
        // The camera scrolls and the move comes first: it carries the new rectangle, so the viewport message has nothing
        // left to say.
        scroll(400);
        internals.currentTick = 10_200;
        internals.pushPlayerPosition(move(2, PositionMessage_Direction.LEFT));
        internals._sendViewportToServer();

        expect(setViewport).not.toHaveBeenCalled();

        scroll(400);
        internals._sendViewportToServer();

        expect(setViewport.mock.calls).toEqual([[{ left: 600, top: 0, right: 2160, bottom: 890 }]]);
    });

    it("sends the same rectangle when joining the room, after bringing the camera up to date", () => {
        const { internals, preRender, setViewport } = createScene();
        const emitJoinRoom = vi.fn();
        Object.assign(internals.connection as object, {
            emitJoinRoom,
            roomJoinedPromise: new Promise<never>(() => {}),
        });
        vi.spyOn(gameManager, "currentStartedRoom", "get").mockReturnValue({} as Room);
        internals.CurrentPlayer = { x: 300, y: 400 };
        internals.playerName = "Alice";

        // The join waits for a room that never answers: the scene is only observed up to the message it sends.
        expect(internals.joinRoom()).toBeInstanceOf(Promise);

        expect(emitJoinRoom).toHaveBeenCalledTimes(1);
        expect(emitJoinRoom.mock.calls[0][2]).toEqual(SERVER_VIEWPORT);
        expect(preRender).toHaveBeenCalledTimes(1);
        // The join carried the rectangle: a viewport message for the same camera is redundant.
        internals._sendViewportToServer();
        expect(setViewport).not.toHaveBeenCalled();
    });
});

describe("GameScene remote players, once per frame (update)", () => {
    it("draws a received move from the drawn position over POSITION_DELAY, extrapolates briefly, then stops", () => {
        const { scene, remotePlayers } = createScene();
        scene.getRemotePlayersRepository().addPlayer(joined(7, 100, 200));
        scene.update(1_000, 16);
        scene.getRemotePlayersRepository().movePlayer(moved(7, 300, 200));
        for (const tick of [2_000, 2_100, 2_200, 2_300, 2_301, 2_400]) {
            scene.update(tick, 16);
        }

        const player = remotePlayers.get(7);
        // 2_000 to 2_200: interpolation. 2_300: extrapolated 100 px past the received position. 2_301: outdated, drawn
        // once more at the end of the extrapolation window, as stopped. 2_400: no longer updated.
        expect(player?.positions.map(({ x, y, moving }) => ({ x, y, moving }))).toEqual([
            { x: 100, y: 200, moving: true },
            { x: 200, y: 200, moving: true },
            { x: 300, y: 200, moving: true },
            { x: 400, y: 200, moving: true },
            { x: 400, y: 200, moving: false },
        ]);
    });

    it("updates every remote player in flight once per frame", () => {
        const { scene, remotePlayers } = createScene();
        const repository = scene.getRemotePlayersRepository();
        for (let userId = 1; userId <= 50; userId++) {
            repository.addPlayer(joined(userId, userId * 10, 0));
        }
        scene.update(1_000, 16);
        for (let userId = 1; userId <= 50; userId++) {
            repository.movePlayer(moved(userId, userId * 10 + 100, 0));
        }
        scene.update(2_000, 16);
        scene.update(2_016, 16);

        const updates = [...remotePlayers.values()].map((player) => player.positions.length);
        // Two frames, two updates for each of the 50 players: per-frame work grows with the number of moving players.
        expect(updates).toHaveLength(50);
        expect(new Set(updates)).toEqual(new Set([2]));
    });

    it("removes a leaving player from the scene and stops drawing its move in the same frame", () => {
        const { scene, remotePlayers } = createScene();
        const repository = scene.getRemotePlayersRepository();
        repository.addPlayer(joined(7, 100, 200));
        scene.update(1_000, 16);
        repository.movePlayer(moved(7, 300, 200));
        scene.update(2_000, 16);
        repository.removePlayer(7);
        scene.update(2_100, 16);
        scene.update(2_200, 16);

        expect(scene.MapPlayersByKey.has(7)).toBe(false);
        expect(remotePlayers.get(7)?.positions).toHaveLength(1);
        expect(remotePlayers.get(7)?.destroy).toHaveBeenCalledTimes(1);
    });

    // GS-11 (fixed): a moving player that the scene's map lost but the interpolator still held threw in the frame:
    // the players after it were not drawn, and its move stayed until it was outdated, so a new avatar with its id
    // followed it.
    it("GS-11: drops and reports the move of a player the scene lost, and draws the next players", () => {
        const { scene, internals, remotePlayers } = createScene();
        const repository = scene.getRemotePlayersRepository();
        repository.addPlayer(joined(7, 100, 200));
        repository.addPlayer(joined(8, 100, 400));
        scene.update(1_000, 16);
        repository.movePlayer(moved(7, 300, 200));
        repository.movePlayer(moved(8, 300, 400));
        scene.update(2_000, 16);
        scene.MapPlayersByKey.delete(7);

        expect(() => scene.update(2_100, 16)).not.toThrow();
        const back = fakeRemotePlayer(7, 500, 500);
        internals.MapPlayersByKey.set(7, back);
        scene.update(2_150, 16);

        expect(remotePlayers.get(8)?.positions.map(({ x }) => x)).toEqual([100, 200, 250]);
        expect(back.positions).toEqual([]);
        const sizes = { repositoryPlayers: 2, scenePlayers: 1, spatialIndexPlayers: 2, interpolatedPlayers: 2 };
        expectDriftReports([
            ["The scene and the repository have a different number of remote players", { userId: undefined, ...sizes }],
            ["Cannot draw an interpolated remote player that is not in the scene", { userId: 7, ...sizes }],
        ]);
    });

    // GS-02 (fixed): removeAllRemotePlayers used to keep the interpolations of the players it removed. The next frame
    // threw from update(), and a throw there ends Phaser's requestAnimationFrame loop: the canvas stopped for good.
    it("GS-02: keeps drawing frames when the players are removed while one is still moving", () => {
        const { scene, internals, remotePlayers } = createScene();
        const repository = scene.getRemotePlayersRepository();
        repository.addPlayer(joined(7, 100, 200));
        scene.update(1_000, 16);
        repository.movePlayer(moved(7, 300, 200));
        scene.update(2_000, 16);
        internals.removeAllRemotePlayers();

        expect(() => scene.update(2_100, 16)).not.toThrow();
        expect(remotePlayers.get(7)?.positions).toHaveLength(1);

        // Later frames keep drawing: a player who joins after the removal is drawn on a frame of its own.
        repository.addPlayer(joined(8, 300, 400));
        scene.update(2_200, 16);
        repository.movePlayer(moved(8, 500, 400));
        scene.update(2_300, 16);
        expect(remotePlayers.get(8)?.positions).toHaveLength(1);
        // The test removes the players behind the repository's back, so the count mismatch is expected. An
        // interpolation left for player 7 would be reported as a second drift.
        const sizes = { repositoryPlayers: 1, scenePlayers: 0, spatialIndexPlayers: 0, interpolatedPlayers: 0 };
        expectDriftReports([
            ["The scene and the repository have a different number of remote players", { userId: undefined, ...sizes }],
        ]);
    });
});

describe("GameScene extensions, once per frame (update)", () => {
    const unregisterAll: Array<() => void> = [];

    afterEach(() => {
        for (const unregister of unregisterAll.splice(0)) unregister();
    });

    it("calls each registered extension once per frame, after the changes of the remote players are applied", () => {
        const { scene } = createScene();
        const frames: Array<{ scene: unknown; time: number; delta: number; remoteIds: number[] }> = [];
        unregisterAll.push(
            registerSceneExtension({
                id: "test",
                onFrame: (context) =>
                    frames.push({
                        scene: context.scene,
                        time: context.time,
                        delta: context.delta,
                        remoteIds: [...context.remoteCharacters.keys()],
                    }),
            }),
        );
        scene.getRemotePlayersRepository().addPlayer(joined(7, 100, 200));

        scene.update(1_000, 16);
        scene.update(1_016, 17);

        expect(frames).toHaveLength(2);
        expect(frames[0].scene).toBe(scene);
        expect(frames.map(({ time, delta, remoteIds }) => ({ time, delta, remoteIds }))).toEqual([
            { time: 1_000, delta: 16, remoteIds: [7] },
            { time: 1_016, delta: 17, remoteIds: [7] },
        ]);
    });

    it("tells the extension about the page, the remote players and the variables of the current player", () => {
        const { scene, internals } = createScene();
        internals.playerVariablesManager = { variables: new Map([["officeSeat", { v: 1, direction: "down" }]]) };
        const contexts: SceneFrameContext[] = [];
        unregisterAll.push(registerSceneExtension({ id: "test", onFrame: (context) => contexts.push(context) }));
        scene.getRemotePlayersRepository().addPlayer(joined(7, 100, 200));

        scene.update(1_000, 16);

        const [context] = contexts;
        expect(context.baseUrl).toBe(window.location.href);
        expect(context.currentPlayer).toBeUndefined();
        expect([...context.remotePlayers.keys()]).toEqual([7]);
        expect(context.getPlayerVariable("officeSeat")).toEqual({ v: 1, direction: "down" });
        expect(context.getPlayerVariable("missing")).toBeUndefined();
    });

    it("tells the extension the variables the whole room shares, and nothing before the scene has them", () => {
        const { scene, internals } = createScene();
        const contexts: SceneFrameContext[] = [];
        unregisterAll.push(registerSceneExtension({ id: "test", onFrame: (context) => contexts.push(context) }));
        scene.update(1_000, 16);
        const beforeTheRoomHasThem = contexts[0].getRoomVariable?.("mesas");
        internals.sharedVariablesManager = { variables: new Map([["mesas", '{"chair-4":{"uuid":"uuid-ana"}}']]) };
        scene.update(1_016, 16);

        expect(beforeTheRoomHasThem).toBeUndefined();
        expect(contexts[1].getRoomVariable?.("mesas")).toBe('{"chair-4":{"uuid":"uuid-ana"}}');
        expect(contexts[1].getRoomVariable?.("missing")).toBeUndefined();
    });

    it("hands the extension the current player once the scene has one", () => {
        const { scene, internals } = createScene();
        const localPlayer = joinWithLocalPlayer(internals);
        const contexts: SceneFrameContext[] = [];
        unregisterAll.push(registerSceneExtension({ id: "test", onFrame: (context) => contexts.push(context) }));

        scene.update(1_000, 16);

        expect(contexts).toHaveLength(1);
        expect(contexts[0].currentPlayer).toBe(localPlayer);
    });

    it("tells each extension when the scene shuts down, and calls none on a frame after that", () => {
        const { scene } = createScene();
        // The scene's cleanup also resets page-wide state: the listener of the map scripts is shared with other tests.
        vi.spyOn(iframeListener, "cleanup").mockImplementation(() => {});
        const onFrame = vi.fn();
        const onShutdown = vi.fn();
        unregisterAll.push(registerSceneExtension({ id: "test", onFrame, onShutdown }));
        scene.update(1_000, 16);

        scene.cleanupClosingScene();
        // An ejected user keeps a scene that still updates.
        scene.update(1_016, 16);

        expect(onShutdown.mock.calls).toEqual([[scene]]);
        expect(onFrame).toHaveBeenCalledTimes(1);
    });

    it("keeps the frame going when an extension throws, and reports it", () => {
        const { scene, remotePlayers } = createScene();
        const failure = new Error("extension failed");
        unregisterAll.push(
            registerSceneExtension({
                id: "faulty",
                onFrame: () => {
                    throw failure;
                },
            }),
        );
        scene.getRemotePlayersRepository().addPlayer(joined(7, 100, 200));
        scene.update(1_000, 16);
        scene.getRemotePlayersRepository().movePlayer(moved(7, 300, 200));

        expect(() => scene.update(2_000, 16)).not.toThrow();

        expect(remotePlayers.get(7)?.positions).toHaveLength(1);
        expect(captureException).toHaveBeenCalledWith(failure, {
            extra: { extensionId: "faulty", failuresSinceLastReport: 1 },
        });
    });
});

describe("GameScene local move (handleCurrentPlayerHasMovedEvent)", () => {
    it("measures the distance to every remote player, actionable item and entity on each move event", () => {
        const { scene, internals, shared } = createScene();
        const updateActivatableObjectsDistances = vi.fn<(objects: unknown[]) => void>();
        internals.activatablesManager = {
            updateActivatableObjectsDistances,
            deduceSelectedActivatableObjectByDistance: vi.fn(),
        };
        const setPosition = vi.fn();
        const entity = { name: "entity" };
        const item = { name: "item" };
        internals.gameMapFrontWrapper = { setPosition, getActivatableEntities: () => [entity] };
        internals.actionableItems.set(1, item);
        for (let userId = 1; userId <= 3; userId++) {
            scene.MapPlayersByKey.set(userId, fakeRemotePlayer(userId, 0, 0) as unknown as RemotePlayer);
        }
        internals.currentTick = 10_000;
        internals.handleCurrentPlayerHasMovedEvent(move(5, PositionMessage_Direction.LEFT));
        internals.currentTick = 10_016;
        internals.handleCurrentPlayerHasMovedEvent(move(6, PositionMessage_Direction.LEFT));

        // Every move event lists all remote players again: the cost grows with the room, not with the neighbours.
        const measured = updateActivatableObjectsDistances.mock.calls.map(([objects]) => objects);
        expect(measured.map((objects) => objects.length)).toEqual([5, 5]);
        for (const objects of measured) {
            expect(objects).toContain(item);
        }
        expect(setPosition.mock.calls).toEqual([
            [5, 100],
            [6, 100],
        ]);
        expect(shared()).toEqual([{ x: 5, direction: PositionMessage_Direction.LEFT, moving: true }]);
    });
});

describe("GameScene extension-module move callbacks (onPlayerMovementEnded)", () => {
    const failureMessage = (failuresSinceLastReport: number) =>
        `An onPlayerMovementEnded callback failed (failures since the last report: ${failuresSinceLastReport})`;
    // The local player of joinWithLocalPlayer walks 10 px per frame.
    const isFirstWalkingFrame = (event: HasPlayerMovedInterface) => event.x === 10;

    // GS-10 (fixed): the callbacks run inline in the local player's move event, inside update(). A callback that threw
    // ended the frame on every walking frame: the next callbacks, the move listeners after the scene's (entity audio,
    // the camera, the say bubbles) and the remote players all missed it, and only the frame-loop guard reported it.
    it("GS-10: reports a throwing callback and still runs the next callback and draws the remote players", () => {
        const { scene, internals, shared, remotePlayers } = createScene();
        const localPlayer = joinWithLocalPlayer(internals);
        const laterMoveListener = vi.fn();
        localPlayer.on(hasMovedEventName, laterMoveListener);
        const callbackError = new Error("extension module bug");
        const nextCallback = vi.fn();
        scene.onPlayerMovementEnded(() => {
            throw callbackError;
        });
        scene.onPlayerMovementEnded(nextCallback);
        const repository = scene.getRemotePlayersRepository();
        repository.addPlayer(joined(7, 100, 200));
        scene.update(1_000, 16);
        repository.movePlayer(moved(7, 300, 200));

        localPlayer.walking = true;
        expect(() => scene.update(2_000, 16)).not.toThrow();
        expect(() => scene.update(2_200, 16)).not.toThrow();

        expect(nextCallback.mock.calls).toEqual([
            [move(10, PositionMessage_Direction.RIGHT)],
            [move(20, PositionMessage_Direction.RIGHT)],
        ]);
        expect(laterMoveListener).toHaveBeenCalledTimes(2);
        expect(shared()).toEqual([
            { x: 10, direction: PositionMessage_Direction.RIGHT, moving: true },
            { x: 20, direction: PositionMessage_Direction.RIGHT, moving: true },
        ]);
        expect(remotePlayers.get(7)?.positions.map(({ x }) => x)).toEqual([100, 300]);
        // The failure of the second frame comes 200 ms after the report of the first one, so it is only counted.
        expect(vi.mocked(console.error).mock.calls).toEqual([[failureMessage(1), callbackError]]);
        expect(captureException.mock.calls).toEqual([[callbackError, { extra: { failuresSinceLastReport: 1 } }]]);
    });

    // The message embeds the position, so every failure is a different error.
    it("GS-10: reports a callback that keeps failing once per 10 s of frame time, with its failure count", () => {
        const { scene, internals } = createScene();
        const localPlayer = joinWithLocalPlayer(internals);
        const failingCallback = vi.fn((event: HasPlayerMovedInterface) => {
            throw new Error(`No zone at ${event.x}`);
        });
        const nextCallback = vi.fn();
        scene.onPlayerMovementEnded(failingCallback);
        scene.onPlayerMovementEnded(nextCallback);

        localPlayer.walking = true;
        for (const frameTime of [2_000, 2_016, 2_032, 11_999, 12_000, 12_016, 22_000]) {
            expect(() => scene.update(frameTime, 16)).not.toThrow();
        }

        expect(failingCallback).toHaveBeenCalledTimes(7);
        expect(nextCallback).toHaveBeenCalledTimes(7);
        // The first failure, at 2 000, is reported at once. The failure at 11 999 is 1 ms short of the interval. The
        // reports at 12 000 and 22 000 carry the error of their own frame and count the failures since the last report.
        const reports = [
            { error: new Error("No zone at 10"), failuresSinceLastReport: 1 },
            { error: new Error("No zone at 50"), failuresSinceLastReport: 4 },
            { error: new Error("No zone at 70"), failuresSinceLastReport: 2 },
        ];
        expect(vi.mocked(console.error).mock.calls).toEqual(
            reports.map(({ error, failuresSinceLastReport }) => [failureMessage(failuresSinceLastReport), error]),
        );
        expect(captureException.mock.calls).toEqual(
            reports.map(({ error, failuresSinceLastReport }) => [error, { extra: { failuresSinceLastReport } }]),
        );
    });

    it("GS-10: limits each callback on its own", () => {
        const { scene, internals } = createScene();
        const localPlayer = joinWithLocalPlayer(internals);
        const firstError = new Error("bug of a module");
        const otherError = new Error("bug of another module");
        scene.onPlayerMovementEnded(() => {
            throw firstError;
        });
        scene.onPlayerMovementEnded((event) => {
            if (!isFirstWalkingFrame(event)) {
                throw otherError;
            }
        });

        localPlayer.walking = true;
        for (const frameTime of [2_000, 2_016, 2_032, 12_000, 12_016]) {
            expect(() => scene.update(frameTime, 16)).not.toThrow();
        }

        // The second callback's first failure, at 2 016, is reported 16 ms after the first callback's report. At
        // 12 000 the first callback's interval is over and the second one's, which started at 2 016, is not.
        expect(vi.mocked(console.error).mock.calls).toEqual([
            [failureMessage(1), firstError],
            [failureMessage(1), otherError],
            [failureMessage(3), firstError],
            [failureMessage(3), otherError],
        ]);
        expect(captureException.mock.calls).toEqual([
            [firstError, { extra: { failuresSinceLastReport: 1 } }],
            [otherError, { extra: { failuresSinceLastReport: 1 } }],
            [firstError, { extra: { failuresSinceLastReport: 3 } }],
            [otherError, { extra: { failuresSinceLastReport: 3 } }],
        ]);
    });

    it("GS-10: reports a callback's later error after the interval", () => {
        const { scene, internals } = createScene();
        const localPlayer = joinWithLocalPlayer(internals);
        const firstError = new Error("first bug of a module");
        const laterError = new Error("later bug of the same module");
        scene.onPlayerMovementEnded((event) => {
            throw isFirstWalkingFrame(event) ? firstError : laterError;
        });

        localPlayer.walking = true;
        for (const frameTime of [2_000, 2_016, 12_000]) {
            expect(() => scene.update(frameTime, 16)).not.toThrow();
        }

        // The later error first comes at 2 016, inside the interval, where it is only counted.
        expect(vi.mocked(console.error).mock.calls).toEqual([
            [failureMessage(1), firstError],
            [failureMessage(2), laterError],
        ]);
        expect(captureException.mock.calls).toEqual([
            [firstError, { extra: { failuresSinceLastReport: 1 } }],
            [laterError, { extra: { failuresSinceLastReport: 2 } }],
        ]);
    });

    // GS-10 (fixed): a move also comes outside update(), as when Player.teleportTo emits it for WA.player.teleport.
    // The callback's error used to leave that emit, and the teleport's query rejected. Such a move can come before
    // the scene's first frame, when the scene has no frame time yet.
    it("GS-10: limits a callback that fails on moves before the scene's first frame", () => {
        const { scene, internals } = createScene();
        const localPlayer = joinWithLocalPlayer(internals);
        const callbackError = new Error("extension module bug");
        scene.onPlayerMovementEnded(() => {
            throw callbackError;
        });
        const laterMoveListener = vi.fn();
        localPlayer.on(hasMovedEventName, laterMoveListener);
        const teleport = (x: number) =>
            localPlayer.emit(hasMovedEventName, move(x, PositionMessage_Direction.DOWN, false));

        expect(() => teleport(40)).not.toThrow();
        expect(() => teleport(80)).not.toThrow();
        localPlayer.walking = true;
        scene.update(2_000, 16);
        scene.update(10_000, 16);

        expect(laterMoveListener).toHaveBeenCalledTimes(4);
        // Both teleports count as frame time 0. The second one's failure and the failure of the frame at 2 000 are
        // inside the interval, so they are only counted, and the report at 10 000 states them with its own.
        expect(vi.mocked(console.error).mock.calls).toEqual([
            [failureMessage(1), callbackError],
            [failureMessage(3), callbackError],
        ]);
        expect(captureException.mock.calls).toEqual([
            [callbackError, { extra: { failuresSinceLastReport: 1 } }],
            [callbackError, { extra: { failuresSinceLastReport: 3 } }],
        ]);
    });
});

describe("GameScene remote-player drift", () => {
    // GS-12 (fixed): the scene's remote players drift from the repository's when one of them misses an update, as in
    // GS-02. Each drift used to be logged its own way: the count mismatch and the duplicate add dumped whole
    // collections, the move and the removal gave only the id. Sentry received none of those logs.
    it("GS-12: reports a move and the removal of a player the scene lost, and the count mismatch, once each", () => {
        const { scene } = createScene();
        const repository = scene.getRemotePlayersRepository();
        repository.addPlayer(joined(7, 100, 200));
        scene.update(1_000, 16);
        scene.MapPlayersByKey.delete(7);
        repository.movePlayer(moved(7, 300, 200));
        scene.update(2_000, 16);
        repository.movePlayer(moved(7, 400, 200));
        scene.update(2_100, 16);
        repository.removePlayer(7);
        scene.update(2_200, 16);

        // Only MapPlayersByKey lost player 7. The spatial index holds it until the removal, which reports first.
        const sizes = { spatialIndexPlayers: 1, interpolatedPlayers: 0 };
        expectDriftReports([
            [
                "Cannot move a remote player that is not in the scene",
                { userId: 7, repositoryPlayers: 1, scenePlayers: 0, ...sizes },
            ],
            [
                "The scene and the repository have a different number of remote players",
                { userId: undefined, repositoryPlayers: 1, scenePlayers: 0, ...sizes },
            ],
            [
                "Cannot remove a remote player that is not in the scene",
                { userId: 7, repositoryPlayers: 0, scenePlayers: 0, ...sizes },
            ],
        ]);
    });

    it("GS-12: reports an add for a player the scene already has", () => {
        const { scene, internals } = createScene();
        // The real doAddPlayer: it looks for the player before it builds a sprite.
        Reflect.deleteProperty(internals, "doAddPlayer");
        const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
        internals.MapPlayersByKey.set(8, fakeRemotePlayer(8, 0, 0));
        scene.getRemotePlayersRepository().addPlayer(joined(8, 0, 0));
        scene.update(1_000, 16);

        expect(consoleWarn).not.toHaveBeenCalled();
        expectDriftReports([
            [
                "Cannot add a remote player that is already in the scene",
                { userId: 8, repositoryPlayers: 1, scenePlayers: 1, spatialIndexPlayers: 0, interpolatedPlayers: 0 },
            ],
        ]);
    });

    // Players join and leave for as long as the scene lives, so each message reports ten players at most. The limit
    // is per message: a flood of one drift does not hide another kind.
    it("GS-12: reports the first ten players of one drift, and still reports another drift", () => {
        const { scene } = createScene();
        const repository = scene.getRemotePlayersRepository();
        for (let userId = 1; userId <= 11; userId++) {
            repository.addPlayer(joined(userId, userId * 10, 0));
        }
        scene.update(1_000, 16);
        scene.MapPlayersByKey.clear();
        for (let userId = 1; userId <= 11; userId++) {
            repository.movePlayer(moved(userId, userId * 10 + 100, 0));
        }
        scene.update(2_000, 16);
        repository.removePlayer(11);
        scene.update(2_100, 16);

        const sizes = { scenePlayers: 0, spatialIndexPlayers: 11, interpolatedPlayers: 0 };
        expectDriftReports([
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
                (userId): DriftReport => [
                    "Cannot move a remote player that is not in the scene",
                    { userId, repositoryPlayers: 11, ...sizes },
                ],
            ),
            [
                "The scene and the repository have a different number of remote players",
                { userId: undefined, repositoryPlayers: 11, ...sizes },
            ],
            ["Cannot remove a remote player that is not in the scene", { userId: 11, repositoryPlayers: 10, ...sizes }],
        ]);
    });
});

describe("GameScene thin walls (script-driven tile and layer changes)", () => {
    // Thin walls are derived from the visible layers' `wallEdges` tile property, so the scene rebuilds them whenever a
    // script changes what is visible or which tiles carry the property. A rebuild that is skipped leaves the player
    // walking through a wall that a script just raised, or blocked by one that was removed.
    interface ScriptStreams {
        _showLayerStream: Subject<{ name: string }>;
        _hideLayerStream: Subject<{ name: string }>;
        _setTilesStream: Subject<Array<{ tile: string | number | null; x: number; y: number; layer: string }>>;
        answerers: Record<string, unknown>;
        openMessagePortAnswerers: Record<string, unknown>;
    }
    const streams = iframeListener as unknown as ScriptStreams;
    let teardown: Array<() => void> = [];

    afterEach(() => {
        for (const undo of teardown) undo();
        teardown = [];
    });

    // Runs the scene's real script wiring (listenToIframeEvents) against a map wrapper reduced to the two calls it
    // makes, then undoes what that wiring registered on the shared iframeListener.
    function createSceneListeningToScripts(putTile: (x: number) => boolean) {
        const { scene, internals } = createScene();
        const rebuildThinWalls = vi.fn();
        const setLayerVisibility = vi.fn();
        const scripted = internals as unknown as {
            gameMapFrontWrapper: unknown;
            rebuildThinWalls: () => void;
            iframeSubscriptionList: Array<{ unsubscribe(): void }>;
            listenToIframeEvents(): void;
        };
        scripted.rebuildThinWalls = rebuildThinWalls;
        scripted.gameMapFrontWrapper = {
            putTile: vi.fn((_tile: unknown, x: number) => putTile(x)),
            setLayerVisibility,
        };
        const answerersBefore = new Set(Object.keys(streams.answerers));
        const portAnswerersBefore = new Set(Object.keys(streams.openMessagePortAnswerers));
        teardown.push(() => {
            for (const subscription of scripted.iframeSubscriptionList) subscription.unsubscribe();
            for (const key of Object.keys(streams.answerers)) {
                if (!answerersBefore.has(key)) Reflect.deleteProperty(streams.answerers, key);
            }
            for (const key of Object.keys(streams.openMessagePortAnswerers)) {
                if (!portAnswerersBefore.has(key)) Reflect.deleteProperty(streams.openMessagePortAnswerers, key);
            }
        });
        scripted.listenToIframeEvents();
        const markDirty = vi.spyOn(scene, "markDirty").mockImplementation(() => {});
        return { markDirty, rebuildThinWalls, setLayerVisibility };
    }

    it("builds the thin-wall helper layer for the player and the path restrictions from the visible wall edges", () => {
        const { internals } = createScene();
        const wallTile = { x: 1, y: 0, index: 7, properties: { wallEdges: "e" }, setCollision: vi.fn() };
        const helperTile = { setCollision: vi.fn() };
        const helperLayer = {
            putTileAt: vi.fn(() => helperTile),
            setVisible: vi.fn().mockReturnThis(),
            setDepth: vi.fn().mockReturnThis(),
            destroy: vi.fn(),
        };
        const collider = { destroy: vi.fn() };
        const terrains = [{ name: "terrain" }];
        const currentPlayer = { name: "local player" };
        const createBlankLayer = vi.fn(() => helperLayer);
        const addCollider = vi.fn(() => collider);
        const setDirectionalCondition = vi.fn();
        const clearDirectionalConditions = vi.fn();
        Object.assign(internals, {
            Terrains: terrains,
            CurrentPlayer: currentPlayer,
            physics: { add: { collider: addCollider } },
            pathfindingManager: { setDirectionalCondition, clearDirectionalConditions },
            gameMapFrontWrapper: {
                phaserLayers: [
                    { visible: true, layer: { name: "walls", width: 3, height: 1, data: [[null, wallTile, null]] } },
                ],
                phaserMap: { width: 3, height: 1, createBlankLayer },
                getCollisionTileIndex: () => 42,
            },
        });

        (internals as unknown as { rebuildThinWalls(): void }).rebuildThinWalls();

        expect(createBlankLayer).toHaveBeenCalledWith(expect.stringMatching(/^__/), terrains);
        expect(helperLayer.putTileAt).toHaveBeenCalledWith(42, 1, 0, false);
        expect(addCollider).toHaveBeenCalledWith(currentPlayer, helperLayer);
        const blockedFromTheWall = setDirectionalCondition.mock.calls.find(([x]) => x === 1);
        expect(blockedFromTheWall?.[2]).not.toContain("RIGHT");
        const blockedFromTheOtherSide = setDirectionalCondition.mock.calls.find(([x]) => x === 2);
        expect(blockedFromTheOtherSide?.[2]).not.toContain("LEFT");
    });

    it("rebuilds the thin walls whenever it recreates the player's collisions", () => {
        const { internals } = createScene();
        const rebuildThinWalls = vi.fn();
        Object.assign(internals, { rebuildThinWalls, gameMapFrontWrapper: { phaserLayers: [] } });

        (internals as unknown as { createCollisionWithPlayer(): void }).createCollisionWithPlayer();

        expect(rebuildThinWalls).toHaveBeenCalledTimes(1);
    });

    it("rebuilds once after a batch of tiles in which only an earlier tile changed the wall edges", () => {
        const { markDirty, rebuildThinWalls } = createSceneListeningToScripts((x) => x === 0);

        streams._setTilesStream.next([
            { tile: "wall", x: 0, y: 0, layer: "walls" },
            { tile: "floor", x: 1, y: 0, layer: "walls" },
        ]);

        expect(rebuildThinWalls).toHaveBeenCalledTimes(1);
        expect(markDirty).toHaveBeenCalled();
    });

    it("does not rebuild after tiles that leave the wall edges as they were, but still repaints", () => {
        const { markDirty, rebuildThinWalls } = createSceneListeningToScripts(() => false);

        streams._setTilesStream.next([{ tile: "floor", x: 1, y: 0, layer: "floor" }]);

        expect(rebuildThinWalls).not.toHaveBeenCalled();
        expect(markDirty).toHaveBeenCalled();
    });

    it("rebuilds after a script shows or hides a layer", () => {
        const { rebuildThinWalls, setLayerVisibility } = createSceneListeningToScripts(() => false);

        streams._showLayerStream.next({ name: "walls" });
        expect(setLayerVisibility).toHaveBeenLastCalledWith("walls", true);
        expect(rebuildThinWalls).toHaveBeenCalledTimes(1);

        streams._hideLayerStream.next({ name: "walls" });
        expect(setLayerVisibility).toHaveBeenLastCalledWith("walls", false);
        expect(rebuildThinWalls).toHaveBeenCalledTimes(2);
    });
});
