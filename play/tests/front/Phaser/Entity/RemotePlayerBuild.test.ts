// @vitest-environment jsdom
import * as Phaser from "phaser";
import type * as PhaserModule from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { CancelablePromise } from "cancelable-promise";
import type { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import { RemotePlayer } from "../../../../src/front/Phaser/Entity/RemotePlayer";
import { AvatarBuildQueue } from "../../../../src/front/Phaser/Entity/AvatarBuildQueue";

const { names, companions, lazyLoad } = vi.hoisted(() => ({
    // The textures of the fallback woka, which are loaded when the ones asked for cannot be shown.
    lazyLoad: vi.fn(),
    // `onCreate` lets a test make a name cost time on its own clock.
    names: { created: 0, failNext: false, onCreate: undefined as (() => void) | undefined },
    companions: { created: 0 },
}));

vi.mock("../../../../src/front/Phaser/Entity/PlayerTexturesLoadingManager", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    lazyLoadPlayerCharacterTextures: lazyLoad,
}));

// The name is a DOM element and the companion reads its texture back from the GPU: neither runs in a unit test.
vi.mock("../../../../src/front/Phaser/Components/UsernameDisplay", () => ({
    UsernameDisplay: class {
        constructor() {
            if (names.failNext) {
                names.failNext = false;
                throw new Error("name failed");
            }
            names.created++;
            names.onCreate?.();
        }
        setAvailabilityStatus() {}
        setRaisedHand() {}
        setPlayerDepth() {}
        setPlayerNameOutlineColor() {}
        setPosition() {}
        destroy() {}
    },
}));
vi.mock("../../../../src/front/Phaser/Companion/Companion", () => ({
    Companion: class {
        constructor() {
            companions.created++;
        }
        setTarget() {}
        destroy() {}
    },
}));

// A sprite that records the animations it is told to play: a real one needs the animation manager of a running game.
vi.mock("phaser", async (importOriginal) => {
    const actual = await importOriginal<typeof PhaserModule>();
    class FakeSprite extends actual.GameObjects.Image {
        public readonly played: string[] = [];
        public readonly anims = {
            currentAnim: undefined,
            play: (key: string) => {
                this.played.push(key);
            },
        };
        public play(key: string) {
            this.played.push(key);
            return this;
        }
    }
    return { ...actual, GameObjects: { ...actual.GameObjects, Sprite: FakeSprite } };
});

const TEXTURES = ["color_1", "eyes_1"];

function createScene(): GameScene {
    const events = new Phaser.Events.EventEmitter();
    const frame = { realWidth: 32, realHeight: 32, width: 32, height: 32, customPivot: false, pivotX: 0, pivotY: 0 };
    const sys = {
        events,
        queueDepthSort: () => {},
        textures: { get: () => ({ key: "t", get: () => frame }) },
        updateList: { add: () => {}, remove: () => {} },
        input: { enable: () => {}, disable: () => {} },
        game: { renderer: undefined },
        renderer: undefined,
    };
    const scene = {
        sys,
        events,
        textures: { exists: () => true },
        anims: { exists: () => true },
        add: { existing: () => {} },
        markDirty: vi.fn(),
        superLoad: {},
    };
    const world = {
        defaults: {},
        pendingDestroy: new Set(),
        enableBody: (object: Phaser.GameObjects.GameObject) => {
            object.body = new Phaser.Physics.Arcade.Body(world as unknown as Phaser.Physics.Arcade.World, object);
        },
    };
    Object.assign(scene, { physics: { world } });
    return scene as unknown as GameScene;
}

function createPlayer(
    scene: GameScene,
    userId: number,
    x: number,
    queue: AvatarBuildQueue | undefined,
    options: {
        withCompanion?: boolean;
        direction?: PositionMessage_Direction;
        textures?: CancelablePromise<string[]>;
    } = {},
): RemotePlayer {
    return new RemotePlayer(
        userId,
        `uuid-${userId}`,
        scene,
        x,
        0,
        `player ${userId}`,
        options.textures ?? CancelablePromise.resolve(TEXTURES),
        options.direction ?? PositionMessage_Direction.DOWN,
        false,
        null,
        options.withCompanion ? CancelablePromise.resolve("cat1") : undefined,
        undefined,
        undefined,
        undefined,
        queue,
    );
}

/** The sprite and name creations that follow a build run in promise callbacks. */
async function flushPromises(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

function spriteKeys(player: RemotePlayer): string[] {
    return Array.from(player.sprites.values()).flatMap((sprite) => (sprite as unknown as { played: string[] }).played);
}

describe("RemotePlayer with an avatar build queue", () => {
    beforeEach(() => {
        names.created = 0;
        names.failNext = false;
        names.onCreate = undefined;
        companions.created = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("creates no sprite, name or companion before the queue gets to the player", async () => {
        const queue = new AvatarBuildQueue();
        const player = createPlayer(createScene(), 1, 10, queue, { withCompanion: true });

        await flushPromises();

        expect(player.sprites.size).toBe(0);
        expect(names.created).toBe(0);
        expect(companions.created).toBe(0);
        expect(queue.size).toBe(1);
    });

    it("creates the sprites, the name and the companion when the queue gets to the player", async () => {
        const queue = new AvatarBuildQueue();
        const player = createPlayer(createScene(), 1, 10, queue, { withCompanion: true });
        await flushPromises();

        queue.drain();
        await flushPromises();

        expect(Array.from(player.sprites.keys())).toEqual(TEXTURES);
        expect(names.created).toBe(1);
        expect(companions.created).toBe(1);
        expect(player.companion).toBeDefined();
        expect(queue.size).toBe(0);
    });

    it("creates the sprites in the build itself, so a time budget on the build covers them", async () => {
        const queue = new AvatarBuildQueue();
        const player = createPlayer(createScene(), 1, 10, queue, { withCompanion: true });
        await flushPromises();

        queue.drain();

        // No promise callback has run since the drain: everything was created inside it.
        expect(player.sprites.size).toBe(TEXTURES.length);
        expect(names.created).toBe(1);
        expect(companions.created).toBe(1);
    });

    it("keeps its position and accepts moves while it waits", () => {
        const queue = new AvatarBuildQueue();
        const player = createPlayer(createScene(), 1, 10, queue);

        player.updatePosition({ x: 300, y: 40, direction: PositionMessage_Direction.RIGHT, moving: true });

        expect(player.getPosition()).toEqual({ x: 300, y: 40 });
    });

    it("shows the last pose it was given while it waited, not the pose it joined with", async () => {
        const queue = new AvatarBuildQueue();
        const player = createPlayer(createScene(), 1, 10, queue, { direction: PositionMessage_Direction.DOWN });
        await flushPromises();

        player.updatePosition({ x: 10, y: 0, direction: PositionMessage_Direction.LEFT, moving: false });
        queue.drain();
        await flushPromises();

        expect(spriteKeys(player)).toEqual(["color_1-left-idle", "eyes_1-left-idle"]);
    });

    it("is never built when it is destroyed before its turn", async () => {
        const queue = new AvatarBuildQueue();
        const player = createPlayer(createScene(), 1, 10, queue, { withCompanion: true });
        await flushPromises();

        player.destroy();
        const built = queue.drain();
        await flushPromises();

        expect(built).toBe(0);
        expect(queue.size).toBe(0);
        expect(names.created).toBe(0);
        expect(companions.created).toBe(0);
    });

    it("still shows its sprites when its name cannot be created", async () => {
        const queue = new AvatarBuildQueue();
        const player = createPlayer(createScene(), 1, 10, queue);
        await flushPromises();
        vi.spyOn(console, "error").mockImplementation(() => {});
        names.failNext = true;

        queue.drain();
        await flushPromises();

        expect(player.sprites.size).toBe(TEXTURES.length);
    });

    it("is built at once without a queue, as the local player is", async () => {
        const player = createPlayer(createScene(), 1, 10, undefined, { withCompanion: true });

        await flushPromises();

        expect(player.sprites.size).toBe(TEXTURES.length);
        expect(names.created).toBe(1);
        expect(companions.created).toBe(1);
    });
});

describe("RemotePlayer whose textures cannot be shown", () => {
    beforeEach(() => {
        names.created = 0;
        names.onCreate = undefined;
        names.failNext = false;
        companions.created = 0;
        lazyLoad.mockReset();
    });

    /** The chain that loads the textures ends in a rejection when even the fallback fails: nobody awaits it. */
    function ignoreFailedTextureChain(player: RemotePlayer): void {
        (player as unknown as { texturePromise: Promise<unknown> }).texturePromise.catch(() => undefined);
    }

    it("shows the fallback woka and builds the name and the companion only once", async () => {
        lazyLoad.mockResolvedValue(["color_22", "eyes_23"]);
        const queue = new AvatarBuildQueue();
        // Textures that were loaded but are empty, so that showing them fails after the build turn was taken.
        const player = createPlayer(createScene(), 1, 10, queue, {
            withCompanion: true,
            textures: CancelablePromise.resolve([]),
        });
        await flushPromises();

        queue.drain();
        await flushPromises();

        expect(Array.from(player.sprites.keys())).toEqual(["color_22", "eyes_23"]);
        expect(names.created).toBe(1);
        expect(companions.created).toBe(1);
        expect(queue.size).toBe(0);
    });

    it("waits for its turn before showing the fallback woka, when the textures failed to load", async () => {
        lazyLoad.mockResolvedValue(["color_22", "eyes_23"]);
        const queue = new AvatarBuildQueue();
        const player = createPlayer(createScene(), 1, 10, queue, {
            textures: CancelablePromise.reject(new Error("texture not found")),
        });
        await flushPromises();
        expect(player.sprites.size).toBe(0);
        expect(names.created).toBe(0);

        queue.drain();
        await flushPromises();

        expect(Array.from(player.sprites.keys())).toEqual(["color_22", "eyes_23"]);
        expect(names.created).toBe(1);
    });

    it("still builds the name and the companion when not even the fallback woka loads", async () => {
        lazyLoad.mockRejectedValue(new Error("fallback not found"));
        const queue = new AvatarBuildQueue();
        const player = createPlayer(createScene(), 1, 10, queue, {
            withCompanion: true,
            textures: CancelablePromise.reject(new Error("texture not found")),
        });
        ignoreFailedTextureChain(player);
        await flushPromises();

        queue.drain();
        await flushPromises();

        expect(player.sprites.size).toBe(0);
        expect(names.created).toBe(1);
        expect(companions.created).toBe(1);
        await expect(player.getTextureLoadedPromise()).rejects.toThrow("fallback not found");
    });
});

describe("entering a zone with 100 remote players", () => {
    const PLAYERS = 100;
    const LOCAL_PLAYER = { x: 0, y: 0 };

    beforeEach(() => {
        names.created = 0;
        companions.created = 0;
    });

    /** What a frame created, counted from the objects themselves. */
    interface Frame {
        avatars: number;
        sprites: number;
        names: number;
        companions: number;
    }

    interface Burst {
        /** The frame that adds the players. */
        join: Frame;
        /** The frames that follow, until every avatar is built. */
        builds: Frame[];
        players: RemotePlayer[];
    }

    /**
     * Runs the frames the way GameScene does: the players are added in the first one, and the avatars that are ready
     * to be built join the queue right after it. Each later frame drains the queue; a frame includes the promise
     * callbacks that run after the build. The queue has no time budget here, so that the counts do not depend on how
     * fast the machine is.
     */
    async function enterZone(maxBuildsPerFrame: number): Promise<Burst> {
        const scene = createScene();
        const queue = new AvatarBuildQueue(maxBuildsPerFrame, Infinity);
        const burst: Burst = { join: { avatars: 0, sprites: 0, names: 0, companions: 0 }, builds: [], players: [] };
        const spritesCreated = () => burst.players.reduce((total, player) => total + player.sprites.size, 0);
        const frame = async (avatars: () => number): Promise<Frame> => {
            const before = { sprites: spritesCreated(), names: names.created, companions: companions.created };
            const built = avatars();
            await flushPromises();
            return {
                avatars: built,
                sprites: spritesCreated() - before.sprites,
                names: names.created - before.names,
                companions: companions.created - before.companions,
            };
        };

        burst.join = await frame(() => {
            for (let userId = 1; userId <= PLAYERS; userId++) {
                // Player 1 is the nearest to the local player, player 100 the farthest.
                burst.players.push(createPlayer(scene, userId, userId * 10, queue, { withCompanion: true }));
            }
            return 0;
        });
        while (queue.size > 0) {
            // eslint-disable-next-line no-await-in-loop -- frames run one after the other
            burst.builds.push(await frame(() => queue.drain(LOCAL_PLAYER)));
        }
        return burst;
    }

    it("builds nothing in the frame that adds the players, and 4 avatars in each frame after it", async () => {
        const { join, builds, players } = await enterZone(4);

        expect(join).toEqual({ avatars: 0, sprites: 0, names: 0, companions: 0 });
        expect(builds).toHaveLength(25);
        // Each avatar has 2 sprites, a name and a companion.
        expect(builds).toEqual(Array(25).fill({ avatars: 4, sprites: 8, names: 4, companions: 4 }));
        expect(players.every((player) => player.sprites.size === TEXTURES.length)).toBe(true);
        expect(names.created).toBe(PLAYERS);
        expect(companions.created).toBe(PLAYERS);
    });

    it("would build all 100 avatars in one frame without the cap", async () => {
        // The cap is what spreads the builds: the same burst with an infinite cap shows the frame it prevents.
        const { builds } = await enterZone(Infinity);

        expect(builds).toEqual([{ avatars: PLAYERS, sprites: 2 * PLAYERS, names: PLAYERS, companions: PLAYERS }]);
    });

    it("builds the players nearest to the local player first", async () => {
        const scene = createScene();
        const queue = new AvatarBuildQueue(4, Infinity);
        // Joined in the reverse of their distance to the local player.
        const players = [50, 40, 30, 20, 10].map((x, index) => createPlayer(scene, index + 1, x, queue));
        await flushPromises();

        queue.drain(LOCAL_PLAYER);
        await flushPromises();

        expect(players.map((player) => player.sprites.size > 0)).toEqual([false, true, true, true, true]);
    });

    it("builds fewer avatars in a frame when each build is slow, and still builds them all", async () => {
        // A name that takes 3 ms on the test's clock: with a budget of 4 ms the second build starts, the third does not.
        let time = 0;
        names.onCreate = () => {
            time += 3;
        };
        const scene = createScene();
        const queue = new AvatarBuildQueue(10, 4, () => time);
        const players = [1, 2, 3, 4, 5].map((userId) => createPlayer(scene, userId, userId * 10, queue));
        await flushPromises();

        const built = [queue.drain(LOCAL_PLAYER), queue.drain(LOCAL_PLAYER), queue.drain(LOCAL_PLAYER)];
        await flushPromises();

        expect(built).toEqual([2, 2, 1]);
        expect(players.every((player) => player.sprites.size === TEXTURES.length)).toBe(true);
    });
});
