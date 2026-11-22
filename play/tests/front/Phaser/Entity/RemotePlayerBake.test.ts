// @vitest-environment jsdom
import * as Phaser from "phaser";
import type * as PhaserModule from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { CancelablePromise } from "cancelable-promise";
import { RemotePlayer } from "../../../../src/front/Phaser/Entity/RemotePlayer";
import {
    bakedAvatarKey,
    getAvatarBakeStats,
    isAvatarBakeEnabled,
} from "../../../../src/front/Phaser/Entity/AvatarBakeCache";
import { getPlayerAnimations } from "../../../../src/front/Phaser/Player/Animation";
import { TexturesHelper } from "../../../../src/front/Phaser/Helpers/TexturesHelper";
import type { AvatarScene } from "./avatarScene";
import { createAvatarScene } from "./avatarScene";

const { canvases, lazyLoad } = vi.hoisted(() => ({
    lazyLoad: vi.fn(),
    canvases: {
        created: [] as { width: number; height: number; draws: { id: string; x: number; y: number }[] }[],
        removed: [] as unknown[],
        smoothing: [] as boolean[],
        failDraw: false,
    },
}));

vi.mock("../../../../src/front/Phaser/Entity/PlayerTexturesLoadingManager", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    lazyLoadPlayerCharacterTextures: lazyLoad,
}));

vi.mock("../../../../src/front/Phaser/Components/UsernameDisplay", () => ({
    UsernameDisplay: class {
        setAvailabilityStatus() {}
        setRaisedHand() {}
        setPlayerDepth() {}
        setPlayerNameOutlineColor() {}
        setPosition() {}
        setHidden() {}
        destroy() {}
    },
}));

// A sprite that records the animations it is told to play, and a canvas pool that records what is drawn: a real
// canvas needs a browser.
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
    const CanvasPool = {
        create2D: (_parent: unknown, width: number, height: number) => {
            const canvas = {
                width,
                height,
                draws: [] as { id: string; x: number; y: number }[],
                getContext: () => ({
                    set imageSmoothingEnabled(value: boolean) {
                        canvases.smoothing.push(value);
                    },
                    drawImage: (image: { id: string }, x: number, y: number) => {
                        if (canvases.failDraw) throw new Error("drawImage failed");
                        canvas.draws.push({ id: image.id, x, y });
                    },
                }),
            };
            canvases.created.push(canvas);
            return canvas;
        },
        remove: (canvas: unknown) => {
            canvases.removed.push(canvas);
        },
    };
    return {
        ...actual,
        GameObjects: { ...actual.GameObjects, Sprite: FakeSprite },
        Display: { ...actual.Display, Canvas: { ...actual.Display.Canvas, CanvasPool } },
    };
});

const SIX = ["body_1", "eyes_2", "hair_3", "outfit_4", "glasses_5", "hat_6"];

function createPlayer(world: AvatarScene, layers: string[], userId = 1): RemotePlayer {
    return new RemotePlayer(
        userId,
        `uuid-${userId}`,
        world.scene,
        0,
        0,
        `player ${userId}`,
        CancelablePromise.resolve(layers),
        PositionMessage_Direction.DOWN,
        false,
        null,
        undefined,
    );
}

async function flushPromises(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

function played(player: RemotePlayer): string[] {
    return Array.from(player.sprites.values()).flatMap((sprite) => (sprite as unknown as { played: string[] }).played);
}

function clearPlayed(player: RemotePlayer): void {
    for (const sprite of player.sprites.values()) {
        (sprite as unknown as { played: string[] }).played.length = 0;
    }
}

beforeEach(() => {
    canvases.created.length = 0;
    canvases.removed.length = 0;
    canvases.smoothing.length = 0;
    canvases.failDraw = false;
    lazyLoad.mockReset();
});

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe("the avatar bake flag", () => {
    it("is off unless the storage of the browser turns it on", () => {
        expect(isAvatarBakeEnabled()).toBe(false);
        localStorage.setItem("avatarBake", "1");
        expect(isAvatarBakeEnabled()).toBe(true);
        localStorage.setItem("avatarBake", "0");
        expect(isAvatarBakeEnabled()).toBe(false);
    });
});

describe("a remote player with the bake off", () => {
    it("has one sprite per layer, each on its own texture, and bakes nothing", async () => {
        const world = createAvatarScene();
        world.addLayers(...SIX);

        const player = createPlayer(world, SIX);
        await flushPromises();
        clearPlayed(player);
        player.updatePosition({ x: 10, y: 0, direction: PositionMessage_Direction.LEFT, moving: true });

        expect([...player.sprites.keys()]).toEqual(SIX);
        expect(played(player)).toEqual(SIX.map((layer) => `${layer}-left-walk`));
        expect(canvases.created).toHaveLength(0);
        expect(world.textures.addedCanvases).toHaveLength(0);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 0, active: 0 });
    });
});

describe("a remote player with the bake on", () => {
    beforeEach(() => {
        localStorage.setItem("avatarBake", "1");
    });

    it("is one sprite on the baked sheet of its layers, which plays the animations of a layer", async () => {
        const world = createAvatarScene();
        world.addLayers(...SIX);
        const key = bakedAvatarKey(SIX);

        const player = createPlayer(world, SIX);
        await flushPromises();
        clearPlayed(player);
        player.updatePosition({ x: 10, y: 0, direction: PositionMessage_Direction.LEFT, moving: true });
        player.updatePosition({ x: 10, y: 0, direction: PositionMessage_Direction.UP, moving: false });

        expect([...player.sprites.keys()]).toEqual([key]);
        expect(played(player)).toEqual([`${key}-left-walk`, `${key}-up-idle`]);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 1, active: 1, misses: 1 });
        expect(world.textures.baked.has(key)).toBe(true);
    });

    it("draws the layers in order onto one 96x128 canvas and gives it to the texture manager once, already drawn", async () => {
        const world = createAvatarScene();
        world.addLayers(...SIX);

        createPlayer(world, SIX);
        await flushPromises();

        expect(canvases.created).toHaveLength(1);
        const [canvas] = canvases.created;
        expect([canvas.width, canvas.height]).toEqual([96, 128]);
        expect(canvas.draws.map((draw) => draw.id)).toEqual(SIX);
        expect(canvas.draws.every((draw) => draw.x === 0 && draw.y === 0)).toBe(true);
        expect(canvases.smoothing).toEqual([false]);
        // The drawing is done when the canvas becomes a texture: a texture made first would be uploaded twice.
        expect(world.textures.addedCanvases).toEqual([canvas]);
        expect(canvases.removed).toEqual([]);
    });

    it("creates the same animations as a layer: the same frames, rate and repeat", async () => {
        const layered = createAvatarScene();
        layered.addLayers(...SIX);
        localStorage.setItem("avatarBake", "0");
        createPlayer(layered, SIX);
        await flushPromises();
        localStorage.setItem("avatarBake", "1");
        const baked = createAvatarScene();
        baked.addLayers(...SIX);
        createPlayer(baked, SIX);
        await flushPromises();
        const key = bakedAvatarKey(SIX);

        const strip = (config: Record<string, unknown> | undefined, from: string) => ({
            ...config,
            key: (config?.key as string).replace(from, ""),
            frames: (config?.frames as { key: string; frame: number }[]).map((frame) => frame.frame),
        });
        const names = getPlayerAnimations("x").map((animation) => animation.key.replace("x", ""));
        expect(names).toHaveLength(8);
        for (const name of names) {
            expect(strip(baked.anims.get(`${key}${name}`), key)).toEqual(
                strip(layered.anims.get(`body_1${name}`), "body_1"),
            );
        }
        expect(baked.anims.size).toBe(8);
        expect(layered.anims.size).toBe(8 * SIX.length);
        // Both sides read the same source, so they agree by construction: the numbers themselves are pinned here, and
        // a change to Animation.ts shows on both sides at once.
        const walkDown = baked.anims.get(`${key}-down-walk`) as {
            frameRate: number;
            repeat: number;
            frames: unknown[];
        };
        const walkFrames = (direction: string) =>
            (baked.anims.get(`${key}-${direction}-walk`)?.frames as { frame: number }[]).map((f) => f.frame);
        expect([walkDown.frameRate, walkDown.repeat]).toEqual([10, -1]);
        expect(walkFrames("down")).toEqual([0, 1, 2, 1]);
        expect(walkFrames("left")).toEqual([3, 4, 5, 4]);
        expect(walkFrames("right")).toEqual([6, 7, 8, 7]);
        expect(walkFrames("up")).toEqual([9, 10, 11, 10]);
        const idleLeft = baked.anims.get(`${key}-left-idle`) as { frameRate: number; frames: { frame: number }[] };
        expect([idleLeft.frameRate, idleLeft.frames.map((f) => f.frame)]).toEqual([10, [4]]);
    });

    it("shares one bake between players with the same recipe, and keeps it idle when they leave, for the next one", async () => {
        const world = createAvatarScene();
        world.addLayers(...SIX);
        const first = createPlayer(world, SIX, 1);
        const second = createPlayer(world, SIX, 2);
        await flushPromises();

        expect(canvases.created).toHaveLength(1);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 1, active: 1, hits: 1, misses: 1 });
        first.destroy();
        second.destroy();
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 1, active: 0, idle: 1 });
        createPlayer(world, SIX, 3);
        await flushPromises();

        expect(canvases.created).toHaveLength(1);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 1, active: 1, hits: 2, misses: 1 });
    });

    it("keys the sheet by the order of the layers", async () => {
        const world = createAvatarScene();
        world.addLayers("a", "b");

        createPlayer(world, ["a", "b"], 1);
        createPlayer(world, ["b", "a"], 2);
        await flushPromises();

        expect(canvases.created.map((canvas) => canvas.draws.map((draw) => draw.id))).toEqual([
            ["a", "b"],
            ["b", "a"],
        ]);
        expect(getAvatarBakeStats(world.scene.textures).cached).toBe(2);
    });

    it("leaves a single-layer avatar on its layer", async () => {
        const world = createAvatarScene();
        world.addLayers("male1");

        const player = createPlayer(world, ["male1"]);
        await flushPromises();

        expect([...player.sprites.keys()]).toEqual(["male1"]);
        expect(canvases.created).toHaveLength(0);
    });

    it("destroys the baked texture and its animations when a scene shuts down", async () => {
        const world = createAvatarScene();
        world.addLayers(...SIX);
        const player = createPlayer(world, SIX);
        await flushPromises();
        const key = bakedAvatarKey(SIX);

        world.events.emit(Phaser.Scenes.Events.SHUTDOWN);
        player.destroy();

        expect(world.textures.baked.size).toBe(0);
        expect(world.textures.removed).toEqual([key]);
        expect(world.animsRemoved.sort()).toEqual(
            getPlayerAnimations(key)
                .map((animation) => animation.key)
                .sort(),
        );
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 0, active: 0 });
    });
});

describe("a crowd of 80 full avatars of 6 layers", () => {
    const CROWD = 80;
    const RECIPES = 20;

    async function crowd(world: AvatarScene): Promise<RemotePlayer[]> {
        // 20 recipes of 6 layers, each worn by 4 avatars (the layers of a recipe differ in the body and the hair).
        const recipes = Array.from({ length: RECIPES }, (_, r) =>
            SIX.map((layer, i) => (i % 3 === 0 ? `${layer}_${r}` : layer)),
        );
        for (const recipe of recipes) {
            world.addLayers(...recipe);
        }
        const players = Array.from({ length: CROWD }, (_, i) => createPlayer(world, recipes[i % RECIPES], i + 1));
        await flushPromises();
        players.forEach((player) => clearPlayed(player));
        players.forEach((player) =>
            player.updatePosition({ x: 10, y: 0, direction: PositionMessage_Direction.LEFT, moving: true }),
        );
        return players;
    }

    it("is 480 sprites, 480 animation plays and 480 update-list entries on layers, and 80 of each baked", async () => {
        const layered = createAvatarScene();
        const layeredPlayers = await crowd(layered);
        localStorage.setItem("avatarBake", "1");
        const baked = createAvatarScene();
        const bakedPlayers = await crowd(baked);

        const cost = (world: AvatarScene, players: RemotePlayer[]) => ({
            sprites: players.reduce((sum, player) => sum + player.sprites.size, 0),
            plays: players.reduce((sum, player) => sum + played(player).length, 0),
            updateList: world.updateList.size,
        });
        expect(cost(layered, layeredPlayers)).toEqual({ sprites: 480, plays: 480, updateList: 480 });
        expect(cost(baked, bakedPlayers)).toEqual({ sprites: 80, plays: 80, updateList: 80 });
        // 20 recipes baked once for 80 avatars, 98,304 B each (a DERIVED size: 96x128x4 for the texture, and as much for its canvas).
        expect(getAvatarBakeStats(baked.scene.textures)).toMatchObject({
            cached: RECIPES,
            active: RECIPES,
            misses: RECIPES,
            hits: CROWD - RECIPES,
            bytesDerived: RECIPES * 98_304,
        });
        expect(canvases.created).toHaveLength(RECIPES);
    });
});

describe("a remote player whose bake fails", () => {
    beforeEach(() => {
        localStorage.setItem("avatarBake", "1");
    });

    it("keeps its layers, not the default woka, and logs the failure once", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        canvases.failDraw = true;
        const world = createAvatarScene();
        world.addLayers(...SIX);

        const first = createPlayer(world, SIX, 1);
        const second = createPlayer(world, SIX, 2);
        await flushPromises();

        expect([...first.sprites.keys()]).toEqual(SIX);
        expect([...second.sprites.keys()]).toEqual(SIX);
        expect(lazyLoad).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("Could not bake");
        // The second avatar does not try the recipe that just failed: one canvas, one failure.
        expect(canvases.created).toHaveLength(1);
        expect(canvases.removed).toHaveLength(1);
        expect(world.textures.baked.size).toBe(0);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({
            cached: 0,
            declines: { error: 1, failed: 1 },
        });
    });

    it("builds the avatar from its own layers, not the default woka, when its sprite on the baked sheet cannot be built, and says so once", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const world = createAvatarScene();
        world.addLayers(...SIX, "color_22", "eyes_23");
        lazyLoad.mockResolvedValue(["color_22", "eyes_23"]);
        // Every animation of a baked sheet fails to be created, however many avatars ask: a deterministic failure.
        const create = world.scene.anims.create.bind(world.scene.anims);
        world.scene.anims.create = (config) => {
            if (config.key?.startsWith("kbake:")) throw new Error("boom");
            return create(config);
        };

        const players = [1, 2, 3].map((id) => createPlayer(world, SIX, id));
        await flushPromises();

        for (const player of players) {
            // Their own six layers, one sprite each, all in the container and in the update list.
            expect([...player.sprites.keys()]).toEqual(SIX);
            expect(player.list).toHaveLength(SIX.length);
        }
        expect(world.updateList.size).toBe(3 * SIX.length);
        expect(lazyLoad).not.toHaveBeenCalled();
        // Said once for the recipe, not once per avatar, and never silently.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("could not use its baked sheet");
        expect((warn.mock.calls[0]?.[1] as Error).message).toBe("boom");
        expect(error).not.toHaveBeenCalled();
        // The sheet of the failed build is destroyed and not tried again by the next avatars.
        expect(world.textures.baked.size).toBe(0);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({
            cached: 0,
            active: 0,
            declines: { failed: 2 },
        });
        players.forEach((player) => player.destroy());
        expect(world.updateList.size).toBe(0);
    });

    it("does not bake the default woka into the same failure: it is the recipe that failed that is left alone", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createAvatarScene();
        world.addLayers(...SIX, "color_22", "eyes_23");
        const create = world.scene.anims.create.bind(world.scene.anims);
        world.scene.anims.create = (config) => {
            if (config.key?.startsWith("kbake:")) throw new Error("boom");
            return create(config);
        };

        // The avatar has no texture of its own that exists: the default woka is what it shows, and it fails the same way.
        const woka = createPlayer(world, ["color_22", "eyes_23"], 1);
        const other = createPlayer(world, ["color_22", "eyes_23"], 2);
        await flushPromises();

        expect([...woka.sprites.keys()]).toEqual(["color_22", "eyes_23"]);
        expect([...other.sprites.keys()]).toEqual(["color_22", "eyes_23"]);
        expect(canvases.created).toHaveLength(1);
        expect(world.textures.baked.size).toBe(0);
    });

    it("recovers from a one-off failure: the next avatar of the recipe is baked again once the retry delay is over", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createAvatarScene();
        world.addLayers(...SIX);
        const create = world.scene.anims.create.bind(world.scene.anims);
        let failures = 1;
        world.scene.anims.create = (config) => {
            if (failures-- > 0) throw new Error("once");
            return create(config);
        };
        const first = createPlayer(world, SIX, 1);
        await flushPromises();
        expect([...first.sprites.keys()]).toEqual(SIX);

        vi.spyOn(performance, "now").mockReturnValue(performance.now() + 61_000);
        const second = createPlayer(world, SIX, 2);
        await flushPromises();

        expect([...second.sprites.keys()]).toEqual([bakedAvatarKey(SIX)]);
    });

    it("keeps its layers and logs when a layer is not a 96x128 sheet", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createAvatarScene();
        world.addLayers("a", "b");
        world.textures.layers.set("b", { frameTotal: 13, getSourceImage: () => ({ width: 64, height: 64, id: "b" }) });

        const player = createPlayer(world, ["a", "b"]);
        await flushPromises();

        expect([...player.sprites.keys()]).toEqual(["a", "b"]);
        expect(canvases.created).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(getAvatarBakeStats(world.scene.textures).declines.ineligible).toBe(1);
    });

    it("keeps its layers when the game has no renderer", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createAvatarScene({ renderer: false });
        world.addLayers("a", "b");

        const player = createPlayer(world, ["a", "b"]);
        await flushPromises();

        expect([...player.sprites.keys()]).toEqual(["a", "b"]);
        expect(canvases.created).toHaveLength(0);
    });
});

describe("the snapshot of a remote player", () => {
    // What the woka picture is drawn from: the sprites that the helper is asked to draw.
    function snapshotOf(player: RemotePlayer): Promise<string> {
        return (player as unknown as { getSnapshot(): Promise<string> }).getSnapshot();
    }

    function neverBuilt(world: AvatarScene): RemotePlayer {
        return new RemotePlayer(
            1,
            "uuid-1",
            world.scene,
            0,
            0,
            "player 1",
            new CancelablePromise<string[]>(() => undefined),
            PositionMessage_Direction.DOWN,
            false,
            null,
            undefined,
        );
    }

    function holding(player: RemotePlayer, state: { layerIds: string[]; spritesDropped: boolean }): void {
        Object.assign(player, state);
    }

    it("is drawn from the layers of a dot, in sprites that go with the snapshot", async () => {
        localStorage.setItem("avatarZeroWork", "1");
        const world = createAvatarScene();
        world.addLayers(...SIX);
        const player = createPlayer(world, SIX);
        await flushPromises();
        // A dot has no sprites: the snapshot builds its own from the ids it kept.
        player.setDetail("dot");
        let temporary: Phaser.GameObjects.Sprite[] = [];
        const alive: boolean[] = [];
        vi.spyOn(TexturesHelper, "getSnapshot").mockImplementation((_scene, ...sprites) => {
            temporary = sprites.map(({ sprite }) => sprite);
            // Drawn now, destroyed after: they exist while the helper works.
            alive.push(...temporary.map((sprite) => sprite.scene !== undefined));
            return Promise.resolve("data:image/png;base64,dot");
        });

        const picture = await snapshotOf(player);

        expect(picture).toBe("data:image/png;base64,dot");
        expect(player.sprites.size).toBe(0);
        expect(temporary).toHaveLength(SIX.length);
        expect(alive).toEqual(SIX.map(() => true));
        expect(temporary.map((sprite) => sprite.scene)).toEqual(SIX.map(() => undefined));
    });

    it("draws nothing for a character that has no sprites because its build failed, as it always did", async () => {
        const world = createAvatarScene();
        world.addLayers("a", "b");
        const player = neverBuilt(world);
        // It has its layers, but nothing was dropped on purpose: a failed build, not a dot.
        holding(player, { layerIds: ["a", "b"], spritesDropped: false });
        const getSnapshot = vi.spyOn(TexturesHelper, "getSnapshot").mockResolvedValue("data:image/png;base64,none");

        await snapshotOf(player);

        expect(getSnapshot).toHaveBeenCalledTimes(1);
        expect(getSnapshot.mock.calls[0]).toHaveLength(1);
    });

    it("draws the temporary layers for the same character once its sprites were dropped on purpose", async () => {
        const world = createAvatarScene();
        world.addLayers("a", "b");
        const player = neverBuilt(world);
        holding(player, { layerIds: ["a", "b"], spritesDropped: true });
        const getSnapshot = vi.spyOn(TexturesHelper, "getSnapshot").mockResolvedValue("data:image/png;base64,dot");

        await snapshotOf(player);

        expect(getSnapshot.mock.calls[0]).toHaveLength(1 + 2);
    });
});
