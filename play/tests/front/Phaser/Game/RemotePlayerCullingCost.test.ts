// @vitest-environment jsdom
import * as Phaser from "phaser";
import type * as PhaserModule from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelablePromise } from "cancelable-promise";
import { PositionMessage_Direction } from "@workadventure/messages";
import { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import { UsernameDomLayer } from "../../../../src/front/Phaser/Game/UsernameDomLayer";
import { AvatarBuildQueue } from "../../../../src/front/Phaser/Entity/AvatarBuildQueue";
import { RemotePlayer } from "../../../../src/front/Phaser/Entity/RemotePlayer";
import { TexturesHelper } from "../../../../src/front/Phaser/Helpers/TexturesHelper";
import type { Room } from "../../../../src/front/Connection/Room";
import type { RemotePlayersRepository } from "../../../../src/front/Phaser/Game/RemotePlayersRepository";
import { biggestAvailableAreaStore } from "../../../../src/front/Stores/BiggestAvailableAreaStore";

/**
 * What a crowd costs the scene while most of it is outside the camera: the real GameScene, RemotePlayer, name tag,
 * culling and companion, on a scene that has no renderer (so the cost is counted in what each frame asks the DOM and the
 * scene to do, not in milliseconds). The numbers are printed, so that running this file again shows them.
 *
 *     npm test -- --run tests/front/Phaser/Game/RemotePlayerCullingCost.test.ts
 */

vi.mock("../../../../src/front/Phaser/Entity/PlayerTexturesLoadingManager", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    lazyLoadPlayerCharacterTextures: vi.fn(() => CancelablePromise.resolve(["color_1", "eyes_1"])),
}));
vi.mock("../../../../src/front/Phaser/Companion/CompanionTexturesLoadingManager", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    lazyLoadPlayerCompanionTexture: vi.fn(() => CancelablePromise.resolve("cat1")),
}));

// A sprite that needs no animation manager.
vi.mock("phaser", async (importOriginal) => {
    const actual = await importOriginal<typeof PhaserModule>();
    class FakeSprite extends actual.GameObjects.Image {
        public readonly anims = { currentAnim: undefined, play: () => {} };
        public play() {
            return this;
        }
    }
    return { ...actual, GameObjects: { ...actual.GameObjects, Sprite: FakeSprite } };
});

type UserJoined = Parameters<RemotePlayersRepository["addPlayer"]>[0];
type UserMoved = Parameters<RemotePlayersRepository["movePlayer"]>[0];

interface GameSceneInternals {
    CurrentPlayer: unknown;
    avatarBuildQueue: AvatarBuildQueue;
    dirty: boolean;
}

// What to undo after a test that changed a class.
const restores: Array<() => void> = [];

const AVATARS = 1000;
// The camera of the engine plan's measurement: 1451x855, over the top-left corner of the map. Its culling margin is
// max(64, 5% of 1451) = 72.55 px, so the avatars that stay drawn are the ones from x = -72 to 1523 and y = -72 to 927.
const CAMERA = { x: 0, y: 0, right: 1451, bottom: 855 };
// 23 columns by 14 rows, 64 px apart, all inside the camera.
const IN_VIEW_COLUMNS = 23;
const IN_VIEW_ROWS = 14;
const IN_VIEW = IN_VIEW_COLUMNS * IN_VIEW_ROWS;
const FRAME_MS = 16;
// A walker shares its position about every 200 ms (see POSITION_DELAY) and the scene draws it in between.
const FRAMES_PER_MOVE = 12;
const MEASURED_FRAMES = 24;
// A walker is first drawn at a new place a few frames after its first move arrives: the scene draws it over the 200 ms.
const FRAMES_TO_START_WALKING = 3;
// How far a walker goes in one frame, in px. In 24 frames no avatar crosses the edge of the culling rectangle.
const STEP = 3;

/** The avatars: the first IN_VIEW are inside the camera, the others are far to its right. */
function positionOf(userId: number): { x: number; y: number } {
    const index = userId - 1;
    if (index < IN_VIEW) {
        return { x: 32 + 64 * (index % IN_VIEW_COLUMNS), y: 32 + 64 * Math.floor(index / IN_VIEW_COLUMNS) };
    }
    const far = index - IN_VIEW;
    return { x: 3_000 + 64 * (far % 30), y: 32 + 64 * Math.floor(far / 30) };
}

function joined(userId: number, withCompanion: boolean): UserJoined {
    return {
        userId,
        userUuid: `uuid-${userId}`,
        name: `player ${userId}`,
        characterTextures: [],
        companionTexture: withCompanion ? { id: "cat1", url: "cat1.png" } : undefined,
        position: { ...positionOf(userId), direction: PositionMessage_Direction.RIGHT, moving: false },
        availabilityStatus: 0,
    } as unknown as UserJoined;
}

function walking(userId: number, x: number): UserMoved {
    return {
        userId,
        position: { x, y: positionOf(userId).y, direction: PositionMessage_Direction.RIGHT, moving: true },
    };
}

/** The promise callbacks that follow a build (the sprites and the companion are created in them). */
async function flushPromises(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

interface Frame {
    /** The name pills whose style changed, each counted once. */
    pillsUpdated: number;
    /** The writes that changed the style of a name pill (a write of the value it already has changes nothing). */
    pillWrites: number;
    /** How many times the scene was marked dirty (a render was asked for), counting each mark. */
    dirtyMarks: number;
    /** Whether the frame ends with a render to do. */
    dirty: boolean;
}

function createCrowd(options: { withCompanions?: boolean; nameCannotBeHidden?: boolean } = {}) {
    const room = { key: "https://play.example/_/global/map.json", mapUrl: "https://play.example/map.json" };
    const scene = new GameScene(room as unknown as Room, "crowd-scene");
    const events = new Phaser.Events.EventEmitter();
    const textureFrame = {
        realWidth: 32,
        realHeight: 32,
        width: 32,
        height: 32,
        customPivot: false,
        pivotX: 0,
        pivotY: 0,
    };
    Object.assign(scene.sys, {
        events,
        updateList: { add: () => {}, remove: () => {} },
        input: { enable: () => {}, disable: () => {} },
        textures: { get: () => ({ key: "t", get: () => textureFrame }) },
        game: { renderer: undefined },
        queueDepthSort: () => {},
    });
    const world = {
        defaults: {},
        pendingDestroy: new Set(),
        enableBody: (object: Phaser.GameObjects.GameObject) => {
            object.body = new Phaser.Physics.Arcade.Body(world as unknown as Phaser.Physics.Arcade.World, object);
        },
    };
    let layerElement: HTMLElement | undefined;
    const domElement = {
        pointerEvents: "",
        setOrigin: () => domElement,
        setDepth: () => domElement,
        setVisible: () => {},
        destroy: () => {},
    };
    const worldView = { ...CAMERA };
    Object.assign(scene, {
        events,
        scene: { scene: { renderer: {} } },
        cameras: { main: { worldView, preRender: vi.fn() } },
        Map: { widthInPixels: 6400, heightInPixels: 6400 },
        connection: { getUserId: () => 0 },
        textures: { exists: () => true },
        anims: { exists: () => true, create: () => {}, generateFrameNumbers: () => [] },
        game: { events: new Phaser.Events.EventEmitter() },
        physics: { world },
        add: {
            existing: () => {},
            dom: (_x: number, _y: number, element: HTMLElement) => {
                layerElement = element;
                return domElement;
            },
        },
    });
    scene.usernameDomLayer = new UsernameDomLayer(scene);
    const internals = scene as unknown as GameSceneInternals;
    internals.CurrentPlayer = { x: 0, y: 0 };
    // Every join is built in the next frame: the build queue is measured elsewhere.
    internals.avatarBuildQueue = new AvatarBuildQueue(AVATARS, Infinity);

    // Counts how many times the scene is marked dirty, whoever does it.
    let dirty = false;
    let dirtyMarks = 0;
    Object.defineProperty(scene, "dirty", {
        get: () => dirty,
        set: (value: boolean) => {
            if (value) dirtyMarks++;
            dirty = value;
        },
    });

    // Counts the writes to the style of the name pills, each pill once per frame.
    const observer = new MutationObserver(() => {});
    const watchPills = () => {
        if (layerElement === undefined) throw new Error("The name layer was not created");
        observer.observe(layerElement, { attributes: true, attributeFilter: ["style"], subtree: true });
    };

    const repository = scene.getRemotePlayersRepository();
    const players = () => [...scene.MapPlayersByKey.values()];
    let time = 1_000;
    let framesWalked = 0;
    let walkers: readonly number[] = [];

    /** One frame the way Phaser runs it: update, then the post-update listeners, then the render. */
    async function frame(): Promise<Frame> {
        if (walkers.length > 0 && framesWalked % FRAMES_PER_MOVE === 0) {
            for (const userId of walkers) {
                repository.movePlayer(walking(userId, positionOf(userId).x + STEP * (framesWalked + FRAMES_PER_MOVE)));
            }
        }
        if (walkers.length > 0) framesWalked++;
        time += FRAME_MS;
        dirty = false;
        dirtyMarks = 0;
        observer.takeRecords();
        scene.update(time, FRAME_MS);
        scene.events.emit(Phaser.Scenes.Events.POST_UPDATE);
        const dirtyAfterUpdate = dirty;
        scene.events.emit(Phaser.Scenes.Events.RENDER);
        // Read before the next await: the observer's own callback would take the records at the next microtask.
        const records = observer
            .takeRecords()
            .filter((record) => (record.target as Element).className === "username-display");
        await flushPromises();
        return {
            pillsUpdated: new Set(records.map((record) => record.target)).size,
            pillWrites: records.length,
            dirtyMarks,
            dirty: dirtyAfterUpdate,
        };
    }

    return {
        scene,
        players,
        frame,
        worldView,
        /** Adds the avatars and builds them all, then lets the camera cull. */
        async join(withCompanions = options.withCompanions ?? false): Promise<void> {
            if (options.nameCannotBeHidden) {
                // What a remote player was before it had `setCulled()`: the culling cannot hide its name.
                const method = Object.getOwnPropertyDescriptor(RemotePlayer.prototype, "setCulled");
                Object.defineProperty(RemotePlayer.prototype, "setCulled", { value: undefined, configurable: true });
                restores.push(() => Object.defineProperty(RemotePlayer.prototype, "setCulled", { ...method }));
            }
            for (let userId = 1; userId <= AVATARS; userId++) {
                repository.addPlayer(joined(userId, withCompanions));
            }
            await frame();
            await frame();
            await frame();
            watchPills();
        },
        /** Makes the avatars with these ids walk, and runs the frames until each of them is drawn at a new place. */
        async walk(userIds: readonly number[]): Promise<void> {
            walkers = userIds;
            framesWalked = 0;
            for (let i = 0; i < FRAMES_TO_START_WALKING; i++) {
                // eslint-disable-next-line no-await-in-loop -- frames run one after the other
                await frame();
            }
        },
        async measure(): Promise<Frame[]> {
            const measured: Frame[] = [];
            for (let i = 0; i < MEASURED_FRAMES; i++) {
                // eslint-disable-next-line no-await-in-loop -- frames run one after the other
                measured.push(await frame());
            }
            return measured;
        },
    };
}

const ALL = Array.from({ length: AVATARS }, (_, index) => index + 1);
const OUT_OF_VIEW = ALL.slice(IN_VIEW);

beforeEach(() => {
    // The scene's queue has a time budget; a frozen clock keeps a slow machine from cutting a frame short.
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(biggestAvailableAreaStore, "consumePendingRecompute").mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    restores.splice(0).forEach((restore) => restore());
    vi.restoreAllMocks();
});

describe("1000 remote players, 322 of them in the camera view", () => {
    it("is set up as the measurement says: 322 of the 1000 avatars stay drawn", { timeout: 120_000 }, async () => {
        const crowd = createCrowd();

        await crowd.join();

        const drawn = crowd.players().filter((player) => player.visible);
        expect(crowd.players()).toHaveLength(AVATARS);
        expect(drawn).toHaveLength(IN_VIEW);
        expect(crowd.players().every((player) => player.sprites.size === 2)).toBe(true);
    });

    it(
        "updates only the name pills in the view, and marks the scene dirty only for them, while all 1000 walk",
        { timeout: 120_000 },
        async () => {
            const withHook = createCrowd();
            await withHook.join();
            await withHook.walk(ALL);
            const after = await withHook.measure();
            const withoutHook = createCrowd({ nameCannotBeHidden: true });
            await withoutHook.join();
            await withoutHook.walk(ALL);
            const before = await withoutHook.measure();

            // A walker is drawn at the place it already is in the frame its next move arrives, so a few frames in a
            // window update fewer pills than the rest: the frame that updates the most shows what the crowd costs.
            const busiestFrame = (frames: Frame[]) => ({
                pillsUpdated: Math.max(...frames.map((frame) => frame.pillsUpdated)),
                pillWrites: Math.max(...frames.map((frame) => frame.pillWrites)),
                dirtyMarks: Math.max(...frames.map((frame) => frame.dirtyMarks)),
            });
            console.info(
                `1000 walking avatars, ${IN_VIEW} in view, in the busiest of ${MEASURED_FRAMES} frames\n` +
                    `  before (a name that cannot be hidden): ${JSON.stringify(busiestFrame(before))}\n` +
                    `  after  (a name that is hidden):        ${JSON.stringify(busiestFrame(after))}`,
            );

            expect(busiestFrame(after).pillsUpdated).toBeGreaterThan(0);
            expect(busiestFrame(after).pillsUpdated).toBeLessThanOrEqual(IN_VIEW);
            expect(busiestFrame(after).dirtyMarks).toBeLessThanOrEqual(IN_VIEW);
            expect(busiestFrame(before).pillsUpdated).toBe(AVATARS);
            expect(busiestFrame(before).dirtyMarks).toBe(AVATARS);
        },
    );

    it(
        "asks for no render, and writes no name pill, while only the 678 avatars outside the view walk",
        { timeout: 120_000 },
        async () => {
            const crowd = createCrowd();
            await crowd.join();
            await crowd.walk(OUT_OF_VIEW);

            const frames = await crowd.measure();

            // The walkers did move: a frame that asks for nothing is not one where nothing happened.
            const [walker] = crowd.players().filter((player) => player.userId === AVATARS);
            expect(walker.x).toBeGreaterThan(positionOf(AVATARS).x);
            expect(frames.map((frame) => frame.pillWrites)).toEqual(frames.map(() => 0));
            expect(frames.map((frame) => frame.dirty)).toEqual(frames.map(() => false));
        },
    );
});

describe("50 remote players with a companion enter the scene", () => {
    const ENTERING = 50;

    it("reads no companion picture back from the GPU until a picture is looked at", async () => {
        const getSnapshot = vi.spyOn(TexturesHelper, "getSnapshot").mockResolvedValue("data:image/png;base64,cat");
        const crowd = createCrowd({ withCompanions: true });
        const enteringScene = crowd.scene;
        const repository = enteringScene.getRemotePlayersRepository();
        for (let userId = 1; userId <= ENTERING; userId++) {
            repository.addPlayer(joined(userId, true));
        }

        await crowd.frame();
        await crowd.frame();
        const readbacksWhenTheyEnter = getSnapshot.mock.calls.length;
        const companions = crowd.players().filter((player) => player.companion !== undefined);
        const shown: (string | undefined)[] = [];
        const unsubscribe = companions[0].companion?.pictureStore.subscribe((picture) => shown.push(picture));
        await flushPromises();
        unsubscribe?.();

        console.info(
            `${ENTERING} players with a companion enter: companion readbacks when they enter ` +
                `(the code before this change read one per companion, ${ENTERING}; not measured here): ` +
                `${readbacksWhenTheyEnter}; one picture looked at: ${getSnapshot.mock.calls.length - readbacksWhenTheyEnter}`,
        );
        expect(companions).toHaveLength(ENTERING);
        expect(readbacksWhenTheyEnter).toBe(0);
        expect(getSnapshot).toHaveBeenCalledTimes(1);
        expect(shown).toEqual([undefined, "data:image/png;base64,cat"]);
    });
});
