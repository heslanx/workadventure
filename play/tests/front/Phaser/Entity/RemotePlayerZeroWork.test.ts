// @vitest-environment jsdom
import * as Phaser from "phaser";
import type * as PhaserModule from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { CancelablePromise } from "cancelable-promise";
import { RemotePlayer } from "../../../../src/front/Phaser/Entity/RemotePlayer";
import { AvatarBuildQueue } from "../../../../src/front/Phaser/Entity/AvatarBuildQueue";
import { RemotePlayerCulling } from "../../../../src/front/Phaser/Game/RemotePlayerCulling";
import { SeatedPoseController } from "../../../../src/front/Konclui/Workplace/phaser/SeatedPoseController";
import { getAvatarBakeStats } from "../../../../src/front/Phaser/Entity/AvatarBakeCache";
import { isAvatarZeroWorkEnabled } from "../../../../src/front/Phaser/Entity/AvatarZeroWork";
import type { AvatarScene } from "./avatarScene";
import { createAvatarScene } from "./avatarScene";

const { plays, canvases, names, updates } = vi.hoisted(() => ({
    plays: { count: 0 },
    canvases: { created: 0 },
    // The name tags built, and the positions they were given.
    names: { built: 0, placed: 0 },
    // The preUpdate calls of the sprites that the update list ran.
    updates: { count: 0 },
}));

vi.mock("../../../../src/front/Phaser/Components/UsernameDisplay", () => ({
    UsernameDisplay: class {
        constructor() {
            names.built++;
        }
        setAvailabilityStatus() {}
        setRaisedHand() {}
        setPlayerDepth() {}
        setPlayerNameOutlineColor() {}
        setPosition() {
            names.placed++;
        }
        setHidden() {}
        destroy() {}
    },
}));

vi.mock("phaser", async (importOriginal) => {
    const actual = await importOriginal<typeof PhaserModule>();
    class FakeSprite extends actual.GameObjects.Image {
        public readonly played: string[] = [];
        public readonly anims = {
            currentAnim: undefined,
            play: (key: string) => {
                plays.count++;
                this.played.push(key);
            },
        };
        public preUpdate() {
            updates.count++;
        }
        public play(key: string) {
            plays.count++;
            this.played.push(key);
            return this;
        }
    }
    const CanvasPool = {
        create2D: (_parent: unknown, width: number, height: number) => {
            canvases.created++;
            return { width, height, getContext: () => ({ imageSmoothingEnabled: true, drawImage: () => {} }) };
        },
        remove: () => {},
    };
    return {
        ...actual,
        GameObjects: { ...actual.GameObjects, Sprite: FakeSprite },
        Display: { ...actual.Display, Canvas: { ...actual.Display.Canvas, CanvasPool } },
    };
});

const LAYERS = ["body_1", "eyes_2", "hair_3"];
const STEP_MS = 200;

function createPlayer(
    world: AvatarScene,
    userId: number,
    options: { layers?: string[]; queue?: AvatarBuildQueue; companion?: CancelablePromise<string> } = {},
): RemotePlayer {
    return new RemotePlayer(
        userId,
        `uuid-${userId}`,
        world.scene,
        userId * 10,
        0,
        `player ${userId}`,
        CancelablePromise.resolve(options.layers ?? LAYERS),
        PositionMessage_Direction.DOWN,
        false,
        null,
        options.companion,
        undefined,
        undefined,
        undefined,
        options.queue,
    );
}

async function flushPromises(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

/** Whether the woka picture of the player can be made: the build resolved the promise that its snapshot waits for. */
async function pictureResolved(player: RemotePlayer): Promise<boolean> {
    const deferred = (player as unknown as { textureLoadedDeferred: { promise: Promise<void> } }).textureLoadedDeferred;
    const pending = Symbol("pending");
    return (await Promise.race([deferred.promise, Promise.resolve(pending)])) !== pending;
}

function walk(player: RemotePlayer, x: number, direction = PositionMessage_Direction.RIGHT): void {
    player.updatePosition({ x, y: 0, direction, moving: true });
}

/** What the scene does each frame for the avatars: the sprites it advances, the bodies it steps, the listeners it calls. */
function frameWork(world: AvatarScene) {
    return {
        spriteUpdates: [...world.updateList].filter((sprite) => (sprite as Phaser.GameObjects.GameObject).active)
            .length,
        bodies: [...world.bodies].filter((body) => body.enable).length,
        postUpdateListeners: world.events.listenerCount(Phaser.Scenes.Events.POST_UPDATE),
        updateListeners: world.events.listenerCount(Phaser.Scenes.Events.UPDATE),
    };
}

/**
 * Runs one frame of what the avatars have registered, as Phaser does it: the update list pre-updates the sprites that are
 * active (UpdateList.sceneUpdate), and the POST_UPDATE listeners run (the sync of the name with the body). Returns what
 * those calls came to, as counts.
 */
function runFrame(world: AvatarScene): { spritePreUpdates: number; namePlacements: number } {
    updates.count = 0;
    names.placed = 0;
    for (const sprite of [...world.updateList] as (Phaser.GameObjects.GameObject & { preUpdate(): void })[]) {
        if (sprite.active) {
            sprite.preUpdate();
        }
    }
    world.events.emit(Phaser.Scenes.Events.POST_UPDATE);
    return { spritePreUpdates: updates.count, namePlacements: names.placed };
}

/** Culls through the real RemotePlayerCulling: the camera view is a 100x100 square at the origin. */
function culling(...players: RemotePlayer[]): RemotePlayerCulling<RemotePlayer> {
    const culler = new RemotePlayerCulling<RemotePlayer>();
    for (const player of players) {
        culler.track(player);
    }
    culler.update({ x: 0, y: 0, right: 100, bottom: 100 });
    return culler;
}

beforeEach(() => {
    plays.count = 0;
    canvases.created = 0;
    names.built = 0;
    names.placed = 0;
    updates.count = 0;
});

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe("the avatar zero-work flag", () => {
    it("is off unless the storage of the browser turns it on", () => {
        expect(isAvatarZeroWorkEnabled()).toBe(false);
        localStorage.setItem("avatarZeroWork", "1");
        expect(isAvatarZeroWorkEnabled()).toBe(true);
        localStorage.setItem("avatarZeroWork", "0");
        expect(isAvatarZeroWorkEnabled()).toBe(false);
    });
});

describe("with the zero-work flag off, a remote player is as it was", () => {
    it("still plays the moves of a culled player, keeps its body and its listener, and keeps the sprites of a dot", async () => {
        const world = createAvatarScene();
        world.addLayers(...LAYERS);
        const culled = createPlayer(world, 1);
        const dot = createPlayer(world, 2);
        await flushPromises();
        culling(culled, dot);
        culled.setCulled(true);
        dot.setDetail("dot");
        plays.count = 0;

        walk(culled, 500);
        walk(dot, 600);

        expect(plays.count).toBe(LAYERS.length);
        expect(dot.sprites.size).toBe(LAYERS.length);
        expect(world.bodies.size).toBe(2);
        expect(world.events.listenerCount(Phaser.Scenes.Events.POST_UPDATE)).toBe(2);
        expect(world.counts.disableBody).toBe(0);
    });
});

describe("with the zero-work flag on", () => {
    beforeEach(() => {
        localStorage.setItem("avatarZeroWork", "1");
    });

    describe("a culled remote player", () => {
        it("plays no animation, steps no body and runs no per-frame code, and plays its last pose when drawn again", async () => {
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const player = createPlayer(world, 1);
            await flushPromises();
            const culler = culling(player);
            const drawn = frameWork(world);

            // Out of the view: RemotePlayerCulling hides it and tells it.
            player.updatePosition({ x: 900, y: 900, direction: PositionMessage_Direction.DOWN, moving: false });
            culler.update({ x: 0, y: 0, right: 100, bottom: 100 });
            plays.count = 0;
            walk(player, 910, PositionMessage_Direction.LEFT);
            walk(player, 920, PositionMessage_Direction.UP);
            walk(player, 930, PositionMessage_Direction.LEFT);

            expect(player.isCulled()).toBe(true);
            expect(plays.count).toBe(0);
            expect(drawn).toEqual({ spriteUpdates: 3, bodies: 1, postUpdateListeners: 1, updateListeners: 0 });
            expect(frameWork(world)).toEqual({
                spriteUpdates: 0,
                bodies: 0,
                postUpdateListeners: 0,
                updateListeners: 0,
            });

            // Back in the view.
            player.updatePosition({ x: 50, y: 50, direction: PositionMessage_Direction.LEFT, moving: true });
            plays.count = 0;
            culler.update({ x: 0, y: 0, right: 100, bottom: 100 });

            expect(player.isCulled()).toBe(false);
            expect(plays.count).toBe(LAYERS.length);
            expect(
                Array.from(player.sprites.values()).map((sprite) =>
                    (sprite as unknown as { played: string[] }).played.at(-1),
                ),
            ).toEqual(["body_1-left-walk", "eyes_2-left-walk", "hair_3-left-walk"]);
            expect(frameWork(world)).toEqual(drawn);
        });

        it("stops its companion, whose own body and listener go too, and starts it again when drawn", async () => {
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const player = createPlayer(world, 1, { companion: CancelablePromise.resolve("cat1") });
            await flushPromises();
            const culler = culling(player);
            const drawn = frameWork(world);

            player.updatePosition({ x: 900, y: 900, direction: PositionMessage_Direction.DOWN, moving: false });
            culler.update({ x: 0, y: 0, right: 100, bottom: 100 });
            world.events.emit(Phaser.Scenes.Events.UPDATE, 0, STEP_MS);

            expect(drawn).toMatchObject({ bodies: 2, updateListeners: 1 });
            expect(frameWork(world)).toEqual({
                spriteUpdates: 0,
                bodies: 0,
                postUpdateListeners: 0,
                updateListeners: 0,
            });

            player.updatePosition({ x: 50, y: 50, direction: PositionMessage_Direction.DOWN, moving: false });
            culler.update({ x: 0, y: 0, right: 100, bottom: 100 });

            expect(frameWork(world)).toEqual({ ...drawn, spriteUpdates: drawn.spriteUpdates });
        });
    });

    describe("a remote player drawn as a dot", () => {
        it("holds no sprites, no body and no listener, plays nothing, and keeps its lease on nothing", async () => {
            localStorage.setItem("avatarBake", "1");
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const player = createPlayer(world, 1);
            await flushPromises();
            expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ active: 1 });
            plays.count = 0;

            player.setDetail("dot");
            walk(player, 500);
            walk(player, 510, PositionMessage_Direction.UP);

            expect(player.sprites.size).toBe(0);
            expect(plays.count).toBe(0);
            expect(frameWork(world)).toEqual({
                spriteUpdates: 0,
                bodies: 0,
                postUpdateListeners: 0,
                updateListeners: 0,
            });
            expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 1, active: 0, idle: 1 });
            expect(player.getDetail()).toBe("dot");
        });

        it("is built as a dot without sprites when it is a dot before its turn, and gets them when promoted", async () => {
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue();
            const player = createPlayer(world, 1, { queue });
            player.setDetail("dot");
            await flushPromises();
            queue.drain();

            expect(player.sprites.size).toBe(0);

            player.setDetail("full");
            await flushPromises();
            expect(player.sprites.size).toBe(0);
            queue.drain();

            expect(player.sprites.size).toBe(LAYERS.length);
        });

        it("comes back to full through the build queue, a few a frame, in its last pose", async () => {
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue(4, Infinity);
            const players = Array.from({ length: 10 }, (_, i) => createPlayer(world, i + 1, { queue }));
            await flushPromises();
            queue.drain();
            queue.drain();
            queue.drain();
            expect(queue.size).toBe(0);
            for (const player of players) {
                player.setDetail("dot");
            }
            walk(players[0], 300, PositionMessage_Direction.LEFT);
            expect(players.every((player) => player.sprites.size === 0)).toBe(true);
            plays.count = 0;

            for (const player of players) {
                player.setDetail("full");
            }
            const afterPromotion = players.filter((player) => player.sprites.size > 0).length;
            const queued = queue.size;
            const built = [queue.drain(), queue.drain(), queue.drain()];

            expect([afterPromotion, queued]).toEqual([0, 10]);
            expect(built).toEqual([4, 4, 2]);
            expect(players.every((player) => player.sprites.size === LAYERS.length)).toBe(true);
            expect(players.every((player) => player.getDetail() === "full")).toBe(true);
            expect(
                Array.from(players[0].sprites.values()).map((s) => (s as unknown as { played: string[] }).played),
            ).toEqual(LAYERS.map((layer) => [`${layer}-left-walk`]));
            expect(frameWork(world)).toEqual({
                spriteUpdates: 10 * LAYERS.length,
                bodies: 10,
                postUpdateListeners: 10,
                updateListeners: 0,
            });
        });

        it("asks the queue for nothing when it is a dot again before its turn", async () => {
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue();
            const player = createPlayer(world, 1, { queue });
            await flushPromises();
            queue.drain();
            player.setDetail("dot");

            player.setDetail("full");
            expect(queue.size).toBe(1);
            player.setDetail("dot");

            expect(queue.size).toBe(0);
            expect(player.sprites.size).toBe(0);
        });

        it("does not throw out of the build queue when its sprites cannot be built again, reports it, and tries again by itself", async () => {
            const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue();
            const player = createPlayer(world, 1, { queue });
            await flushPromises();
            queue.drain();
            player.setDetail("dot");
            const layer = world.textures.layers.get("eyes_2");
            world.textures.layers.delete("eyes_2");

            player.setDetail("full");
            expect(() => queue.drain()).not.toThrow();

            expect(player.sprites.size).toBe(0);
            expect(error).toHaveBeenCalledTimes(1);
            expect(world.updateList.size).toBe(0);
            // It asked for another turn on its own: the layer is back, and nobody has to demote and promote it.
            expect(queue.size).toBe(1);
            world.textures.layers.set("eyes_2", layer as never);
            queue.drain();
            expect(player.sprites.size).toBe(LAYERS.length);
            expect(queue.size).toBe(0);
        });

        it("gives up after three failed turns, says so, and builds on the next promotion", async () => {
            const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue();
            const player = createPlayer(world, 1, { queue });
            await flushPromises();
            queue.drain();
            player.setDetail("dot");
            const layer = world.textures.layers.get("eyes_2");
            world.textures.layers.delete("eyes_2");
            player.setDetail("full");

            const sizes = Array.from({ length: 6 }, () => {
                queue.drain();
                return queue.size;
            });

            // 3 failures are reported by the restore, and the fourth line says it gave up: it never loops.
            expect(sizes).toEqual([1, 1, 0, 0, 0, 0]);
            expect(error).toHaveBeenCalledTimes(4);
            expect(String(error.mock.calls[3]?.[0])).toContain("Gave up");
            expect(player.sprites.size).toBe(0);
            world.textures.layers.set("eyes_2", layer as never);
            player.setDetail("dot");
            player.setDetail("full");
            queue.drain();
            expect(player.sprites.size).toBe(LAYERS.length);
        });

        it("still gets its first build, with its sprites, name and picture, when it is a dot and a full again before its turn", async () => {
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue();
            const player = createPlayer(world, 1, { queue, companion: CancelablePromise.resolve("cat1") });
            await flushPromises();
            // The one slot of the queue holds the first build.
            expect(queue.size).toBe(1);

            player.setDetail("dot");
            player.setDetail("full");

            expect(queue.size).toBe(1);
            expect(names.built).toBe(0);
            queue.drain();
            expect(player.sprites.size).toBe(LAYERS.length);
            expect(names.built).toBe(1);
            expect(player.companion).toBeDefined();
            expect(await pictureResolved(player)).toBe(true);
            expect(queue.size).toBe(0);
        });

        it("still gets its first build, as a dot with no sprites but with its name, companion and picture, when it is demoted and never promoted", async () => {
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue();
            const player = createPlayer(world, 1, { queue, companion: CancelablePromise.resolve("cat1") });
            await flushPromises();

            player.setDetail("dot");
            expect(queue.size).toBe(1);
            queue.drain();

            expect(player.sprites.size).toBe(0);
            expect(names.built).toBe(1);
            expect(player.companion).toBeDefined();
            expect(await pictureResolved(player)).toBe(true);
            expect(runFrame(world)).toEqual({ spritePreUpdates: 0, namePlacements: 0 });
            // And its first sprites do come with the promotion.
            player.setDetail("full");
            queue.drain();
            expect(player.sprites.size).toBe(LAYERS.length);
        });

        it("does not leave sprites that are built while it is culled active in the update list", async () => {
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue();
            const player = createPlayer(world, 1, { queue });
            await flushPromises();
            player.setCulled(true);

            queue.drain();

            expect(player.sprites.size).toBe(LAYERS.length);
            expect(runFrame(world)).toEqual({ spritePreUpdates: 0, namePlacements: 0 });
            player.setCulled(false);
            expect(runFrame(world).spritePreUpdates).toBe(LAYERS.length);
        });

        it("keeps a seated pose from throwing when it becomes a dot and is promoted again, and crops its new sprites", async () => {
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue();
            const player = createPlayer(world, 1, { queue });
            await flushPromises();
            queue.drain();
            const seat = { v: 1, direction: "up" };
            const controller = new SeatedPoseController();
            const seatedScene = {
                markDirty: () => {},
                anims: { exists: () => true },
                add: { image: () => ({ setOrigin: () => ({}), setDepth: () => ({}), destroy: () => {} }) },
                textures: { exists: () => true },
                load: { image: () => {}, once: () => {}, on: () => {}, off: () => {}, start: () => {} },
            };
            const seated = (character = player) =>
                controller.update({
                    scene: seatedScene as never,
                    baseUrl: "https://example.test/",
                    currentPlayer: { depth: 0, sprites: new Map() },
                    currentSeat: undefined,
                    remoteCharacters: new Map([[1, character as never]]),
                    remotePlayers: new Map([[1, { variables: new Map([["officeSeat", seat]]) }]]),
                });
            seated();
            const cropped = (sprites: Iterable<unknown>) =>
                [...sprites].map((s) => (s as { isCropped: boolean }).isCropped);
            expect(cropped(player.sprites.values())).toEqual([true, true, true]);
            const old = [...player.sprites.values()];

            player.setDetail("dot");
            expect(() => seated()).not.toThrow();
            player.setDetail("full");
            queue.drain();
            expect(() => seated()).not.toThrow();

            expect(player.sprites.size).toBe(LAYERS.length);
            expect([...player.sprites.values()].some((sprite) => old.includes(sprite))).toBe(false);
            expect(cropped(player.sprites.values())).toEqual([true, true, true]);
        });

        it("bakes once for a hundred promotions and demotions of the same avatar", async () => {
            localStorage.setItem("avatarBake", "1");
            const world = createAvatarScene();
            world.addLayers(...LAYERS);
            const queue = new AvatarBuildQueue();
            const player = createPlayer(world, 1, { queue });
            await flushPromises();
            queue.drain();

            for (let i = 0; i < 100; i++) {
                player.setDetail("dot");
                player.setDetail("full");
                queue.drain();
            }

            expect(canvases.created).toBe(1);
            expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ misses: 1, active: 1 });
            expect(player.sprites.size).toBe(1);
        });
    });

    describe("a crowd of a thousand", () => {
        const CROWD = 1000;
        const FULL = 80;

        async function crowd(world: AvatarScene): Promise<RemotePlayer[]> {
            world.addLayers(...LAYERS);
            const players = Array.from({ length: CROWD }, (_, i) => createPlayer(world, i + 1));
            await flushPromises();
            return players;
        }

        function arrange(players: RemotePlayer[]): void {
            // The first 80 stay full in the view. The next 460 are full but far from the view: culled. The last 460
            // are in the view as dots.
            const culler = new RemotePlayerCulling<RemotePlayer>();
            players.forEach((player, i) => {
                if (i >= FULL && i < FULL + 460) {
                    player.updatePosition({
                        x: 5000 + i,
                        y: 5000,
                        direction: PositionMessage_Direction.DOWN,
                        moving: false,
                    });
                } else {
                    player.updatePosition({
                        x: 10 + (i % 80),
                        y: 10,
                        direction: PositionMessage_Direction.DOWN,
                        moving: false,
                    });
                }
                culler.track(player);
            });
            culler.update({ x: 0, y: 0, right: 100, bottom: 100 });
            players.slice(FULL + 460).forEach((player) => player.setDetail("dot"));
        }

        it("does the per-frame work of the 80 drawn players only, for 920 that are culled or dots", async () => {
            const world = createAvatarScene();
            const players = await crowd(world);
            const before = frameWork(world);

            arrange(players);
            plays.count = 0;
            players.forEach((player, i) => walk(player, 20 + (i % 50), PositionMessage_Direction.LEFT));

            expect(players.filter((player) => player.isCulled())).toHaveLength(460);
            expect(players.filter((player) => player.getDetail() === "dot")).toHaveLength(460);
            expect(before).toEqual({
                spriteUpdates: CROWD * LAYERS.length,
                bodies: CROWD,
                postUpdateListeners: CROWD,
                updateListeners: 0,
            });
            // Counts, not time. These are registrations: what a frame would run.
            expect(frameWork(world)).toEqual({
                spriteUpdates: FULL * LAYERS.length,
                bodies: FULL,
                postUpdateListeners: FULL,
                updateListeners: 0,
            });
            // The 920 played nothing for a thousand moves. The 80 that are drawn played their layers.
            expect(plays.count).toBe(FULL * LAYERS.length);
            expect(players.slice(FULL + 460).every((player) => player.sprites.size === 0)).toBe(true);
            // The culled avatars stay in the update list as inactive entries (the loop still steps over them: that
            // is 1,380 entries in the list for 240 that do work), which is why the next test runs the frame.
            expect([...world.updateList]).toHaveLength(CROWD * LAYERS.length - 460 * LAYERS.length);
        });

        it("runs a frame that pre-updates the sprites and places the names of the 80 drawn players only", async () => {
            const world = createAvatarScene();
            const players = await crowd(world);
            expect(runFrame(world)).toEqual({ spritePreUpdates: CROWD * LAYERS.length, namePlacements: CROWD });

            arrange(players);

            // The calls the update list and the POST_UPDATE listeners make for one frame, counted (not their time).
            expect(runFrame(world)).toEqual({ spritePreUpdates: FULL * LAYERS.length, namePlacements: FULL });
        });
    });
});

describe("a thousand players joining and leaving", () => {
    it("leave no body, no listener, no sprite and no baked texture behind", async () => {
        localStorage.setItem("avatarZeroWork", "1");
        localStorage.setItem("avatarBake", "1");
        const world = createAvatarScene();
        // 300 recipes: more than the cap of 192, so the bake declines some and the cap holds.
        const recipes = Array.from({ length: 300 }, (_, i) => [`body_${i}`, `eyes_${i}`, `hair_${i % 7}`]);
        for (const recipe of recipes) {
            world.addLayers(...recipe);
        }
        const peak = { baked: 0, active: 0 };
        // The most textures that ever existed at once, seen at the moment each one is created, not after a batch.
        const add = world.textures.addSpriteSheet;
        world.textures.addSpriteSheet = (key, canvas) => {
            const texture = add(key, canvas);
            peak.baked = Math.max(peak.baked, world.textures.baked.size);
            return texture;
        };
        const players: RemotePlayer[] = [];

        for (let wave = 0; wave < 10; wave++) {
            for (let i = 0; i < 100; i++) {
                const id = wave * 100 + i + 1;
                players.push(createPlayer(world, id, { layers: recipes[id % recipes.length] }));
            }
            // eslint-disable-next-line no-await-in-loop -- each wave is built before the next one joins
            await flushPromises();
            peak.active = Math.max(peak.active, getAvatarBakeStats(world.scene.textures).active);
            // Half of them become dots: they let go of their recipe.
            players.slice(-100, -50).forEach((player) => player.setDetail("dot"));
        }
        const stats = getAvatarBakeStats(world.scene.textures);
        for (const player of players) {
            player.destroy();
        }
        const afterLeaving = getAvatarBakeStats(world.scene.textures);

        expect(peak.baked).toBeGreaterThan(64);
        expect(peak.baked).toBeLessThanOrEqual(192);
        expect(stats.declines.cap).toBeGreaterThan(0);
        expect(afterLeaving.active).toBe(0);
        expect(afterLeaving.cached).toBeLessThanOrEqual(64);
        expect(world.textures.baked.size).toBe(afterLeaving.cached);
        expect(world.bodies.size).toBe(0);
        expect(world.updateList.size).toBe(0);
        expect(world.events.listenerCount(Phaser.Scenes.Events.POST_UPDATE)).toBe(0);

        world.events.emit(Phaser.Scenes.Events.SHUTDOWN);

        expect(world.textures.baked.size).toBe(0);
        expect([...world.anims.keys()].filter((key) => key.startsWith("kbake:"))).toEqual([]);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 0, active: 0 });
    });
});
