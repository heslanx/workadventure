import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock, MockInstance } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import type { PositionMessage } from "@workadventure/messages";
import { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import type { HasPlayerMovedInterface } from "../../../../src/front/Api/Events/HasPlayerMovedInterface";
import { iframeListener } from "../../../../src/front/Api/IframeListener";
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

const VIEWPORT = { left: 0, top: 0, right: 800, bottom: 600 };

type UserJoined = Parameters<RemotePlayersRepository["addPlayer"]>[0];
type UserMoved = Parameters<RemotePlayersRepository["movePlayer"]>[0];
type SharePosition = (
    x: number,
    y: number,
    direction: PositionMessage_Direction,
    moving: boolean,
    viewport: unknown,
) => void;

interface FakeRemotePlayer {
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
    currentTick: number;
    connection: unknown;
    hasJoinedRoom: boolean;
    CurrentPlayer: unknown;
    userInputManager: unknown;
    activatablesManager: unknown;
    gameMapFrontWrapper: unknown;
    actionableItems: Map<number, unknown>;
    getViewport(): typeof VIEWPORT;
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
    };
    return player;
}

function createScene() {
    const room = { key: "https://play.example/_/global/map.json", mapUrl: "https://play.example/map.json" };
    const scene = new GameScene(room as unknown as Room, "characterization-scene");
    const internals = scene as unknown as GameSceneInternals;
    const sharePosition = vi.fn<SharePosition>();
    internals.connection = { sharePosition, getUserId: () => 1 };
    internals.getViewport = () => VIEWPORT;
    const remotePlayers = new Map<number, FakeRemotePlayer>();
    internals.doAddPlayer = (data) => {
        const player = fakeRemotePlayer(data.userId, data.position.x, data.position.y);
        remotePlayers.set(data.userId, player);
        // The spatial index only serves conversation bubbles, which these tests leave out.
        scene.MapPlayersByKey.set(data.userId, player as unknown as RemotePlayer);
    };
    const shared = () =>
        sharePosition.mock.calls.map(([x, , direction, moving]) => ({
            x,
            direction,
            moving,
        }));
    return { scene, internals, sharePosition, shared, remotePlayers };
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
        // once more where extrapolation left it, as stopped. 2_400: no longer updated.
        expect(player?.positions.map(({ x, y, moving }) => ({ x, y, moving }))).toEqual([
            { x: 100, y: 200, moving: true },
            { x: 200, y: 200, moving: true },
            { x: 300, y: 200, moving: true },
            { x: 400, y: 200, moving: true },
            { x: 401, y: 200, moving: false },
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
