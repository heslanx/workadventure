// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import type { Room } from "../../../../src/front/Connection/Room";
import type { RemotePlayersRepository } from "../../../../src/front/Phaser/Game/RemotePlayersRepository";
import { biggestAvailableAreaStore } from "../../../../src/front/Stores/BiggestAvailableAreaStore";
import { followUsersStore } from "../../../../src/front/Stores/FollowStore";

// Whether the remote players made by the next frames have a `setCulled()` to hide their name tag.
const fakes = vi.hoisted(() => ({ nameTagHook: true }));

// A remote player that records whether it is drawn and updated, and whether its name tag is hidden. The real one needs
// a running Phaser game (see RemotePlayerCulling.test.ts for the culling on Phaser's own objects).
vi.mock("../../../../src/front/Phaser/Entity/RemotePlayer", async () => {
    const { Subject } = await import("rxjs");
    class FakeRemotePlayer {
        public readonly moved$ = new Subject<{ x: number; y: number }>();
        public readonly sprites = new Map<string, { setActive(active: boolean): void }>();
        public companion = undefined;
        public visible = true;
        public active = true;
        public nameTagHidden = false;
        public x: number;
        public y: number;
        constructor(
            public readonly userId: number,
            _userUuid: string,
            _scene: unknown,
            x: number,
            y: number,
        ) {
            this.x = x;
            this.y = y;
            if (!fakes.nameTagHook) {
                (this as { setCulled?: unknown }).setCulled = undefined;
            }
        }
        getPosition() {
            return { x: this.x, y: this.y };
        }
        updatePosition(position: { x: number; y: number }) {
            this.x = position.x;
            this.y = position.y;
            this.moved$.next(position);
        }
        setVisible(visible: boolean) {
            this.visible = visible;
        }
        setActive(active: boolean) {
            this.active = active;
        }
        setCulled(culled: boolean) {
            this.nameTagHidden = culled;
        }
        on() {}
        destroy() {}
    }
    return { RemotePlayer: FakeRemotePlayer };
});
vi.mock("../../../../src/front/Phaser/Entity/PlayerTexturesLoadingManager", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    lazyLoadPlayerCharacterTextures: vi.fn(() => Promise.resolve([])),
}));

type UserJoined = Parameters<RemotePlayersRepository["addPlayer"]>[0];
type UserMoved = Parameters<RemotePlayersRepository["movePlayer"]>[0];

interface FakePlayer {
    visible: boolean;
    active: boolean;
    nameTagHidden: boolean;
    x: number;
    moved$: { observed: boolean };
}

interface GameSceneInternals {
    CurrentPlayer: unknown;
    cameraManager: unknown;
    currentPlayerGroupId: number | undefined;
    groups: Map<number, unknown>;
    dirty: boolean;
    removeAllRemotePlayers(): void;
}

// A 960x540 camera view at the map origin: its margin is 64 px, so the rectangle that stays drawn is x from -64 to 1024
// and y from -64 to 604.
const WORLD_VIEW = { x: 0, y: 0, right: 960, bottom: 540 };
const FAR = 5_000;

function createScene(options: { renderer?: boolean } = {}) {
    const room = { key: "https://play.example/_/global/map.json", mapUrl: "https://play.example/map.json" };
    const scene = new GameScene(room as unknown as Room, "culling-scene");
    const worldView = { ...WORLD_VIEW };
    Object.assign(scene, {
        scene: { scene: { renderer: options.renderer === false ? undefined : {} } },
        cameras: { main: { worldView, preRender: vi.fn() } },
        Map: { widthInPixels: 6400, heightInPixels: 6400 },
        connection: { getUserId: () => 1 },
    });
    const internals = scene as unknown as GameSceneInternals;
    internals.CurrentPlayer = { x: 0, y: 0 };
    const repository = scene.getRemotePlayersRepository();
    const player = (userId: number) => scene.MapPlayersByKey.get(userId) as unknown as FakePlayer;
    return { scene, internals, repository, worldView, player };
}

/** Runs a frame every 100 ms from `from` to `to`: a position change takes a few frames to be played. */
function runFrames(scene: GameScene, from: number, to: number): void {
    for (let time = from; time <= to; time += 100) {
        scene.update(time, 100);
    }
}

function joined(userId: number, x: number): UserJoined {
    return {
        userId,
        userUuid: `uuid-${userId}`,
        name: `player ${userId}`,
        characterTextures: [],
        position: { x, y: 100, direction: PositionMessage_Direction.DOWN, moving: false },
        availabilityStatus: 0,
    } as unknown as UserJoined;
}

/** A move that ends where it says: a walker that keeps moving is extrapolated past its last position. */
function moved(userId: number, x: number): UserMoved {
    return { userId, position: { x, y: 100, direction: PositionMessage_Direction.RIGHT, moving: false } };
}

beforeEach(() => {
    fakes.nameTagHook = true;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(biggestAvailableAreaStore, "consumePendingRecompute").mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    followUsersStore.stopFollowing();
    vi.restoreAllMocks();
});

describe("GameScene culling of remote players (update)", () => {
    it("stops drawing and updating a remote player that joined outside the camera, and keeps one inside it", () => {
        const { scene, repository, player } = createScene();
        repository.addPlayer(joined(2, 500));
        repository.addPlayer(joined(3, FAR));

        scene.update(1_000, 16);

        expect(player(2)).toMatchObject({ visible: true, active: true });
        expect(player(3)).toMatchObject({ visible: false, active: false });
    });

    it("draws a remote player again when the camera scrolls to it", () => {
        const { scene, repository, worldView, player } = createScene();
        repository.addPlayer(joined(3, FAR));
        scene.update(1_000, 16);

        worldView.x = FAR - 400;
        worldView.right = FAR + 560;
        scene.update(1_016, 16);

        expect(player(3)).toMatchObject({ visible: true, active: true });
    });

    it("follows a remote player that walks out of the camera and back into it", () => {
        const { scene, repository, player } = createScene();
        repository.addPlayer(joined(2, 500));
        scene.update(1_000, 16);

        repository.movePlayer(moved(2, FAR));
        runFrames(scene, 1_016, 1_600);
        const afterWalkingOut = { ...player(2) };
        repository.movePlayer(moved(2, 600));
        runFrames(scene, 1_700, 2_300);

        expect(afterWalkingOut).toMatchObject({ visible: false, active: false });
        expect(player(2)).toMatchObject({ visible: true, active: true });
    });

    it("marks the scene dirty when a remote player is culled or drawn again, and not otherwise", () => {
        const { scene, repository, worldView } = createScene();
        const isDirty = () => (scene as unknown as { dirty: boolean }).dirty;
        repository.addPlayer(joined(3, FAR));

        scene.update(1_000, 16);
        const dirtyAfterCulling = isDirty();
        scene.update(1_016, 16);
        const dirtyWithNothingChanged = isDirty();
        worldView.x = FAR - 400;
        worldView.right = FAR + 560;
        scene.update(1_032, 16);

        expect(dirtyAfterCulling).toBe(true);
        expect(dirtyWithNothingChanged).toBe(false);
        expect(isDirty()).toBe(true);
    });

    it("keeps drawing the player the camera follows and the player in the current bubble, wherever they are", () => {
        const { scene, internals, repository, player } = createScene();
        for (const userId of [2, 3, 4]) {
            repository.addPlayer(joined(userId, FAR));
        }
        scene.update(1_000, 16);
        const culledAtFirst = [2, 3, 4].map((userId) => player(userId).visible);

        internals.cameraManager = { playerFollowing: scene.MapPlayersByKey.get(2) };
        internals.currentPlayerGroupId = 7;
        internals.groups.set(7, { needsStep: false, isAnimating: false, getUserIds: () => [3] });
        scene.update(1_016, 16);

        expect(culledAtFirst).toEqual([false, false, false]);
        expect(player(2)).toMatchObject({ visible: true, active: true });
        expect(player(3)).toMatchObject({ visible: true, active: true });
        expect(player(4)).toMatchObject({ visible: false, active: false });
    });

    it("keeps drawing the players of a follow, and culls them once it ends", () => {
        const { scene, repository, player } = createScene();
        repository.addPlayer(joined(2, FAR));
        followUsersStore.addFollowRequest(2);

        scene.update(1_000, 16);
        const whileFollowing = { ...player(2) };
        followUsersStore.stopFollowing();
        scene.update(1_016, 16);

        expect(whileFollowing).toMatchObject({ visible: true, active: true });
        expect(player(2)).toMatchObject({ visible: false, active: false });
    });

    it("culls nothing without a renderer, where the camera view is empty", () => {
        const { scene, repository, player } = createScene({ renderer: false });
        repository.addPlayer(joined(3, FAR));

        scene.update(1_000, 16);

        expect(player(3)).toMatchObject({ visible: true, active: true });
    });

    it("hides the name tag of a remote player that is culled, and shows it when the camera scrolls to it", () => {
        const { scene, repository, worldView, player } = createScene();
        repository.addPlayer(joined(2, 500));
        repository.addPlayer(joined(3, FAR));

        scene.update(1_000, 16);
        const tagsWhileCulled = [player(2).nameTagHidden, player(3).nameTagHidden];
        worldView.x = FAR - 400;
        worldView.right = FAR + 560;
        scene.update(1_016, 16);

        expect(tagsWhileCulled).toEqual([false, true]);
        expect(player(3).nameTagHidden).toBe(false);
    });

    it("stops watching a remote player that left, so that it is not culled or drawn again after it is gone", () => {
        const { scene, repository, worldView, player } = createScene();
        repository.addPlayer(joined(2, 500));
        scene.update(1_000, 16);
        const leaver = player(2);
        const setVisible = vi.spyOn(leaver as unknown as { setVisible: () => void }, "setVisible");

        repository.removePlayer(2);
        scene.update(1_016, 16);
        // The camera leaves the place the player stood at: a player that was still watched would be culled now.
        worldView.x = FAR;
        worldView.right = FAR + 960;
        scene.update(1_032, 16);

        expect(scene.MapPlayersByKey.has(2)).toBe(false);
        expect(leaver.moved$.observed).toBe(false);
        expect(setVisible).not.toHaveBeenCalled();
    });

    it("stops watching every remote player when they are all removed", () => {
        const { scene, internals, repository, worldView, player } = createScene();
        repository.addPlayer(joined(2, 500));
        repository.addPlayer(joined(3, FAR));
        scene.update(1_000, 16);
        const players = [player(2), player(3)];
        const setVisible = players.map((removed) =>
            vi.spyOn(removed as unknown as { setVisible: () => void }, "setVisible"),
        );

        internals.removeAllRemotePlayers();
        worldView.x = FAR - 400;
        worldView.right = FAR + 560;
        scene.update(1_016, 16);

        expect(players.map((removed) => removed.moved$.observed)).toEqual([false, false]);
        expect(setVisible.map((spy) => spy.mock.calls.length)).toEqual([0, 0]);
    });
});

/** Runs a frame every 100 ms from `from` to `to`, and returns for each whether it asked for a render. */
function dirtyFrames(scene: GameScene, from: number, to: number): boolean[] {
    const dirty: boolean[] = [];
    for (let time = from; time <= to; time += 100) {
        scene.update(time, 100);
        dirty.push((scene as unknown as GameSceneInternals).dirty);
    }
    return dirty;
}

describe("GameScene frames that a remote player's walk asks for", () => {
    it("asks for no render while a culled remote player walks and stays culled", () => {
        const { scene, repository, player } = createScene();
        repository.addPlayer(joined(3, FAR));
        scene.update(1_000, 16);
        scene.update(1_016, 16);

        repository.movePlayer(moved(3, FAR + 300));
        const dirty = dirtyFrames(scene, 1_100, 1_700);

        expect(player(3).x).toBe(FAR + 300);
        expect(dirty).toEqual(dirty.map(() => false));
    });

    it("asks for a render while a remote player in the view walks", () => {
        const { scene, repository, player } = createScene();
        repository.addPlayer(joined(2, 500));
        scene.update(1_000, 16);
        scene.update(1_016, 16);

        repository.movePlayer(moved(2, 700));
        const dirty = dirtyFrames(scene, 1_100, 1_700);

        expect(player(2).x).toBe(700);
        expect(dirty.slice(0, 3)).toEqual([true, true, true]);
    });

    it("asks for a render in the frame a culled remote player walks into the view, and not before", () => {
        const { scene, repository, player } = createScene();
        // 1100 is beyond the margin (the view ends at 960, and the margin is 64), 900 is inside the view.
        repository.addPlayer(joined(3, 1_100));
        scene.update(1_000, 16);
        scene.update(1_016, 16);

        repository.movePlayer(moved(3, 900));
        const frames: { visible: boolean; dirty: boolean }[] = [];
        for (let time = 1_100; time <= 1_700; time += 100) {
            scene.update(time, 100);
            frames.push({ visible: player(3).visible, dirty: (scene as unknown as GameSceneInternals).dirty });
        }

        const firstDrawn = frames.findIndex((frame) => frame.visible);
        expect(firstDrawn).toBeGreaterThan(0);
        expect(frames[firstDrawn].dirty).toBe(true);
        expect(frames.slice(0, firstDrawn).map((frame) => frame.dirty)).toEqual(
            frames.slice(0, firstDrawn).map(() => false),
        );
    });

    it("asks for a render while a culled remote player walks if its name tag cannot be hidden", () => {
        const { scene, repository, player } = createScene();
        fakes.nameTagHook = false;
        repository.addPlayer(joined(3, FAR));
        scene.update(1_000, 16);
        scene.update(1_016, 16);

        repository.movePlayer(moved(3, FAR + 300));
        const dirty = dirtyFrames(scene, 1_100, 1_700);

        expect(player(3).x).toBe(FAR + 300);
        expect(dirty.slice(0, 3)).toEqual([true, true, true]);
    });
});
