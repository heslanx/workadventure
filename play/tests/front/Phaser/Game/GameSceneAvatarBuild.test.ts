// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import type { Room } from "../../../../src/front/Connection/Room";
import type { RemotePlayersRepository } from "../../../../src/front/Phaser/Game/RemotePlayersRepository";
import { biggestAvailableAreaStore } from "../../../../src/front/Stores/BiggestAvailableAreaStore";

const { builtUserIds, destroyedUserIds, captureException } = vi.hoisted(() => ({
    builtUserIds: [] as number[],
    destroyedUserIds: [] as number[],
    captureException: vi.fn(),
}));

vi.mock("@sentry/svelte", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    captureException,
}));

// A remote player that joins the scene's queue the way the real one does, with a build that only records itself. The
// real one needs a running Phaser game (see RemotePlayerBuild.test.ts for its own behaviour).
vi.mock("../../../../src/front/Phaser/Entity/RemotePlayer", async () => {
    const { NEVER } = await import("rxjs");
    class FakeRemotePlayer {
        public readonly moved$ = NEVER;
        public companion = undefined;
        public x: number;
        public y: number;
        constructor(
            public readonly userId: number,
            _userUuid: string,
            _scene: unknown,
            x: number,
            y: number,
            _name: string,
            _textures: unknown,
            _direction: unknown,
            _moving: unknown,
            _visitCardUrl: unknown,
            _companion: unknown,
            _activationRadius: unknown,
            _chatID: unknown,
            _sayMessage: unknown,
            private readonly avatarBuildQueue?: { enqueue(avatar: unknown, build: () => void): void },
        ) {
            this.x = x;
            this.y = y;
            this.avatarBuildQueue?.enqueue(this, () => builtUserIds.push(userId));
        }
        getPosition() {
            return { x: this.x, y: this.y };
        }
        updatePosition(position: { x: number; y: number }) {
            this.x = position.x;
            this.y = position.y;
        }
        on() {}
        destroy() {
            destroyedUserIds.push(this.userId);
            (this.avatarBuildQueue as unknown as { remove(avatar: unknown): void } | undefined)?.remove(this);
        }
    }
    return { RemotePlayer: FakeRemotePlayer };
});
vi.mock("../../../../src/front/Phaser/Entity/PlayerTexturesLoadingManager", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    lazyLoadPlayerCharacterTextures: vi.fn(() => Promise.resolve([])),
}));

type UserJoined = Parameters<RemotePlayersRepository["addPlayer"]>[0];
type UserMoved = Parameters<RemotePlayersRepository["movePlayer"]>[0];

interface GameSceneInternals {
    CurrentPlayer: unknown;
    playersPositionInterpolator: { playerMovements: Map<number, unknown> };
}

function createScene() {
    const room = { key: "https://play.example/_/global/map.json", mapUrl: "https://play.example/map.json" };
    const scene = new GameScene(room as unknown as Room, "avatar-build-scene");
    Object.assign(scene, {
        scene: { scene: { renderer: {} } },
        cameras: { main: { worldView: { x: 0, y: 0, right: 960, bottom: 540 }, preRender: vi.fn() } },
        Map: { widthInPixels: 6400, heightInPixels: 6400 },
        connection: { getUserId: () => 1 },
    });
    const internals = scene as unknown as GameSceneInternals;
    internals.CurrentPlayer = { x: 0, y: 0 };
    return { scene, internals, repository: scene.getRemotePlayersRepository() };
}

function joined(userId: number, x: number): UserJoined {
    return {
        userId,
        userUuid: `uuid-${userId}`,
        name: `player ${userId}`,
        characterTextures: [],
        position: { x, y: 0, direction: PositionMessage_Direction.DOWN, moving: false },
        availabilityStatus: 0,
    } as unknown as UserJoined;
}

function moved(userId: number, x: number): UserMoved {
    return { userId, position: { x, y: 0, direction: PositionMessage_Direction.RIGHT, moving: true } };
}

beforeEach(() => {
    // The scene's queue has a time budget; a frozen clock keeps a slow machine from cutting a frame short.
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(biggestAvailableAreaStore, "consumePendingRecompute").mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    builtUserIds.length = 0;
    destroyedUserIds.length = 0;
    captureException.mockClear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("GameScene avatar builds (update)", () => {
    // Player n is n * 100 px from the local player, so the ids tell the distances: they join farthest first.
    const JOIN_ORDER = [9, 3, 7, 1, 10, 5, 2, 8, 4, 6];

    it("adds every joining player to the scene at once and builds 4 per frame, the nearest first", () => {
        const { scene, repository } = createScene();
        for (const userId of JOIN_ORDER) {
            repository.addPlayer(joined(userId, userId * 100));
        }

        scene.update(1_000, 16);
        const foundAfterOneFrame = JOIN_ORDER.filter((userId) => scene.MapPlayersByKey.has(userId));
        const builtAfterOneFrame = [...builtUserIds];
        scene.update(1_016, 16);
        scene.update(1_032, 16);

        expect(foundAfterOneFrame).toEqual(JOIN_ORDER);
        expect(builtAfterOneFrame).toEqual([1, 2, 3, 4]);
        expect(builtUserIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it("does not report a drift for a player that moves while it waits to be built", () => {
        const { scene, internals, repository } = createScene();
        for (const userId of JOIN_ORDER) {
            repository.addPlayer(joined(userId, userId * 100));
        }
        scene.update(1_000, 16);

        repository.movePlayer(moved(10, 1_200));
        scene.update(1_016, 16);

        expect(builtUserIds).not.toContain(10);
        expect(internals.playersPositionInterpolator.playerMovements.has(10)).toBe(true);
        expect(console.error).not.toHaveBeenCalled();
        expect(captureException).not.toHaveBeenCalled();
    });

    it("never builds a player that leaves while it waits, and does not report it as a drift", () => {
        const { scene, repository } = createScene();
        for (const userId of JOIN_ORDER) {
            repository.addPlayer(joined(userId, userId * 100));
        }
        scene.update(1_000, 16);

        repository.removePlayer(10);
        scene.update(1_016, 16);
        scene.update(1_032, 16);
        scene.update(1_048, 16);

        expect(destroyedUserIds).toEqual([10]);
        expect(builtUserIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(scene.MapPlayersByKey.has(10)).toBe(false);
        expect(console.error).not.toHaveBeenCalled();
    });
});
