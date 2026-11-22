// @vitest-environment jsdom
import * as Phaser from "phaser";
import * as Sentry from "@sentry/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    acquireAvatarBake,
    bakedAvatarKey,
    getAvatarBakeStats,
    isAvatarBakeEnabled,
} from "../../../../src/front/Phaser/Entity/AvatarBakeCache";
import { getPlayerAnimations } from "../../../../src/front/Phaser/Player/Animation";
import { createAvatarScene } from "./avatarScene";

interface FakeCanvas {
    width: number;
    height: number;
    drawn: string[];
    smoothing: boolean[];
}

const canvases: FakeCanvas[] = [];
const removedCanvases: unknown[] = [];
let failDraw = false;

beforeEach(() => {
    canvases.length = 0;
    removedCanvases.length = 0;
    failDraw = false;
    vi.spyOn(Phaser.Display.Canvas.CanvasPool, "create2D").mockImplementation(((
        _parent: unknown,
        width: number,
        height: number,
    ) => {
        const canvas: FakeCanvas = { width, height, drawn: [], smoothing: [] };
        canvases.push(canvas);
        return {
            width,
            height,
            getContext: () => ({
                set imageSmoothingEnabled(value: boolean) {
                    canvas.smoothing.push(value);
                },
                drawImage: (image: { id: string }) => {
                    if (failDraw) throw new Error("drawImage failed");
                    canvas.drawn.push(image.id);
                },
            }),
        };
    }) as unknown as typeof Phaser.Display.Canvas.CanvasPool.create2D);
    vi.spyOn(Phaser.Display.Canvas.CanvasPool, "remove").mockImplementation((canvas: unknown) => {
        removedCanvases.push(canvas);
    });
    localStorage.setItem("avatarBake", "1");
});

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe("the flag", () => {
    it("is read once for a game: turning it on later changes nothing for that game", () => {
        localStorage.removeItem("avatarBake");
        const world = createAvatarScene();
        world.addLayers("a", "b");

        expect(acquireAvatarBake(world.scene, ["a", "b"])).toBeUndefined();
        localStorage.setItem("avatarBake", "1");

        expect(acquireAvatarBake(world.scene, ["a", "b"])).toBeUndefined();
        expect(isAvatarBakeEnabled()).toBe(true);
        expect(canvases).toHaveLength(0);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 0, active: 0 });
    });

    it("reads a blocked storage as the default, with a warning", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const enabled = isAvatarBakeEnabled({
            getItem: () => {
                throw new Error("blocked");
            },
        });

        expect(enabled).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe("the baked sheet", () => {
    it("is the layers drawn in order, 1:1 and without smoothing, then one texture of 12 frames", () => {
        const world = createAvatarScene();
        world.addLayers("body", "eyes", "hair");

        const lease = acquireAvatarBake(world.scene, ["body", "eyes", "hair"]);

        expect(lease?.key).toBe(bakedAvatarKey(["body", "eyes", "hair"]));
        expect(canvases).toHaveLength(1);
        expect(canvases[0]).toMatchObject({
            width: 96,
            height: 128,
            drawn: ["body", "eyes", "hair"],
            smoothing: [false],
        });
        expect(world.textures.addedCanvases).toHaveLength(1);
        expect(world.textures.baked.get(lease?.key ?? "")?.frameTotal).toBe(13);
    });

    it("is refused as taken, before any canvas is made, when the key is already a texture the registry does not know", () => {
        const world = createAvatarScene();
        world.addLayers("a", "b");
        world.textures.baked.set(bakedAvatarKey(["a", "b"]), {
            frameTotal: 13,
            getSourceImage: () => ({ width: 96, height: 128, id: "taken" }),
            canvas: undefined,
        });
        // Not known to the registry: somebody else made it.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const lease = acquireAvatarBake(world.scene, ["a", "b"]);

        expect(lease).toBeUndefined();
        expect(canvases).toHaveLength(0);
        expect(getAvatarBakeStats(world.scene.textures).declines).toMatchObject({ taken: 1, ineligible: 0 });
        expect(warn.mock.calls[0]?.[0]).toContain("already taken");
    });

    it("gives the canvas back, and counts taken, when the manager says the key is taken after the canvas was drawn", () => {
        const world = createAvatarScene();
        world.addLayers("a", "b");
        world.textures.addSpriteSheet = () => null;
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        expect(acquireAvatarBake(world.scene, ["a", "b"])).toBeUndefined();

        expect(removedCanvases).toHaveLength(1);
        expect(getAvatarBakeStats(world.scene.textures).declines).toMatchObject({ taken: 1, ineligible: 0 });
    });

    it("removes the texture the manager registered before it threw, so the recipe can be baked again", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createAvatarScene();
        world.addLayers("a", "b");
        const create = world.textures.addSpriteSheet;
        let failures = 1;
        // As Phaser does: the key is registered, then cutting the frames throws.
        world.textures.addSpriteSheet = (key, canvas) => {
            if (failures-- > 0) {
                create(key, canvas);
                throw new Error("cutting the frames failed");
            }
            return create(key, canvas);
        };

        expect(acquireAvatarBake(world.scene, ["a", "b"])).toBeUndefined();

        expect(world.textures.baked.size).toBe(0);
        expect(removedCanvases).toHaveLength(1);
        expect(getAvatarBakeStats(world.scene.textures).declines).toMatchObject({ error: 1, taken: 0 });
        expect(warn.mock.calls[0]?.[0]).toContain("Could not bake");
        // Not a "taken" key for good: once the retry delay is over the recipe bakes.
        vi.spyOn(performance, "now").mockReturnValue(performance.now() + 61_000);
        expect(acquireAvatarBake(world.scene, ["a", "b"])?.key).toBe(bakedAvatarKey(["a", "b"]));
    });

    it("is refused as having no renderer, with a message that does not blame the layers", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createAvatarScene({ renderer: false });
        world.addLayers("a", "b");

        expect(acquireAvatarBake(world.scene, ["a", "b"])).toBeUndefined();

        expect(getAvatarBakeStats(world.scene.textures).declines).toMatchObject({ noRenderer: 1, ineligible: 0 });
        expect(String(warn.mock.calls[0]?.[0])).toContain("renderer");
        expect(String(warn.mock.calls[0]?.[0])).not.toContain("96x128");
    });

    it("sends a failed bake to Sentry once per recipe, with the error", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const capture = vi.spyOn(Sentry, "captureException").mockImplementation(() => "id");
        failDraw = true;
        const world = createAvatarScene();
        world.addLayers("a", "b");

        acquireAvatarBake(world.scene, ["a", "b"]);
        acquireAvatarBake(world.scene, ["a", "b"]);

        expect(capture).toHaveBeenCalledTimes(1);
        expect((capture.mock.calls[0]?.[0] as Error).message).toBe("drawImage failed");
    });

    it("is refused when a layer is not loaded, has other than 13 frames, or is not 96x128", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createAvatarScene();
        world.addLayers("ok", "short", "odd");
        world.textures.layers.set("short", {
            frameTotal: 4,
            getSourceImage: () => ({ width: 96, height: 128, id: "s" }),
        });
        world.textures.layers.set("odd", {
            frameTotal: 13,
            getSourceImage: () => ({ width: 95, height: 128, id: "o" }),
        });

        expect(acquireAvatarBake(world.scene, ["ok", "missing"])).toBeUndefined();
        expect(acquireAvatarBake(world.scene, ["ok", "short"])).toBeUndefined();
        expect(acquireAvatarBake(world.scene, ["ok", "odd"])).toBeUndefined();

        expect(canvases).toHaveLength(0);
        expect(getAvatarBakeStats(world.scene.textures).declines.ineligible).toBe(3);
    });

    it("gives its canvas back and logs when drawing fails", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        failDraw = true;
        const world = createAvatarScene();
        world.addLayers("a", "b");

        expect(acquireAvatarBake(world.scene, ["a", "b"])).toBeUndefined();

        expect(removedCanvases).toHaveLength(1);
        expect(world.textures.baked.size).toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe("eviction", () => {
    it("destroys the 8 animations of the recipe, then its texture, when an idle recipe goes", () => {
        const world = createAvatarScene();
        // 66 recipes, all let go of: the cache keeps the 64 most recent.
        const recipes = Array.from({ length: 66 }, (_, i) => [`a${i}`, `b${i}`]);
        recipes.forEach((recipe) => world.addLayers(...recipe));

        recipes.forEach((recipe) => acquireAvatarBake(world.scene, recipe)?.release());

        const gone = bakedAvatarKey(recipes[0]);
        expect(world.textures.removed).toEqual([gone, bakedAvatarKey(recipes[1])]);
        expect(world.animsRemoved.slice(0, 8).sort()).toEqual(
            getPlayerAnimations(gone)
                .map((a) => a.key)
                .sort(),
        );
        expect(world.textures.baked.size).toBe(64);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 64, idle: 64, evictions: 2 });
    });

    it("destroys the texture even when an animation cannot be removed, so the key is free again", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createAvatarScene();
        world.addLayers("a", "b");
        world.scene.anims.remove = () => {
            throw new Error("no such animation");
        };

        acquireAvatarBake(world.scene, ["a", "b"])?.discard(new Error("no sprite"));

        expect(world.textures.removed).toEqual([bakedAvatarKey(["a", "b"])]);
        expect(world.textures.baked.size).toBe(0);
    });

    it("keeps its idle textures when a bake at the cap fails while drawing", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createAvatarScene();
        const recipes = Array.from({ length: 193 }, (_, i) => [`a${i}`, `b${i}`]);
        recipes.forEach((recipe) => world.addLayers(...recipe));
        const leases = recipes.slice(0, 192).map((recipe) => acquireAvatarBake(world.scene, recipe));
        leases[0]?.release();
        failDraw = true;

        expect(acquireAvatarBake(world.scene, recipes[192])).toBeUndefined();

        expect(world.textures.removed).toEqual([]);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 192, idle: 1, evictions: 0 });
        failDraw = false;
        // Once it can draw, the idle texture is what makes room, and the cap held while it did.
        vi.spyOn(performance, "now").mockReturnValue(performance.now() + 61_000);
        expect(acquireAvatarBake(world.scene, recipes[192])).toBeDefined();
        expect(world.textures.baked.size).toBe(192);
        expect(world.textures.removed).toEqual([bakedAvatarKey(recipes[0])]);
    });

    it("never holds more than 192 recipes: with all of them leased, the 193rd stays on its layers", () => {
        const world = createAvatarScene();
        const recipes = Array.from({ length: 193 }, (_, i) => [`a${i}`, `b${i}`]);
        recipes.forEach((recipe) => world.addLayers(...recipe));

        const leases = recipes.map((recipe) => acquireAvatarBake(world.scene, recipe));

        expect(leases.filter((lease) => lease !== undefined)).toHaveLength(192);
        expect(leases[192]).toBeUndefined();
        expect(world.textures.baked.size).toBe(192);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({
            cached: 192,
            bytesDerived: 192 * 98_304,
            declines: { cap: 1 },
        });
    });
});

describe("the scenes of a game", () => {
    function sceneOf(world: ReturnType<typeof createAvatarScene>) {
        return {
            textures: world.scene.textures,
            game: world.scene.game,
            anims: world.scene.anims,
            events: new Phaser.Events.EventEmitter(),
        };
    }

    it("keep the baked sheets until the last of them shuts down", () => {
        const world = createAvatarScene();
        world.addLayers("a", "b", "c");
        const first = sceneOf(world);
        const second = sceneOf(world);
        const held = acquireAvatarBake(first, ["a", "b"]);
        acquireAvatarBake(second, ["b", "c"]);

        // The next room starts before the last one has shut down, and its avatars hold their sheets.
        first.events.emit(Phaser.Scenes.Events.SHUTDOWN);
        expect(world.textures.baked.size).toBe(2);
        held?.release();
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 2, active: 1 });

        second.events.emit(Phaser.Scenes.Events.SHUTDOWN);
        expect(world.textures.baked.size).toBe(0);
        expect(getAvatarBakeStats(world.scene.textures)).toMatchObject({ cached: 0, active: 0 });
        // Nothing listens any more: a scene that is destroyed after its shutdown does not dispose twice.
        expect(second.events.listenerCount(Phaser.Scenes.Events.DESTROY)).toBe(0);
        expect(second.events.listenerCount(Phaser.Scenes.Events.SHUTDOWN)).toBe(0);
    });

    it("bake for the next scene with the handles of the game, whatever became of the scene that made the cache", () => {
        const world = createAvatarScene();
        world.addLayers("a", "b", "c");
        const first = sceneOf(world);
        acquireAvatarBake(first, ["a", "b"])?.release();
        // A destroyed scene has its fields cleared.
        Object.assign(first, { textures: null, game: null, anims: null });
        const second = sceneOf(world);

        const lease = acquireAvatarBake(second, ["b", "c"]);
        // Evicting what the first scene baked goes through the handles it kept.
        Array.from({ length: 70 }, (_, i) => [`a${i}`, `b${i}`]).forEach((recipe) => {
            world.addLayers(...recipe);
            acquireAvatarBake(second, recipe)?.release();
        });

        expect(lease?.key).toBe(bakedAvatarKey(["b", "c"]));
        expect(world.textures.baked.has(bakedAvatarKey(["b", "c"]))).toBe(true);
        expect(world.textures.removed).toContain(bakedAvatarKey(["a", "b"]));
        expect(getAvatarBakeStats(world.scene.textures).declines.error).toBe(0);
    });
});

describe("getAvatarBakeStats", () => {
    it("reports nothing for a game without a cache", () => {
        expect(getAvatarBakeStats(undefined)).toMatchObject({ cached: 0, active: 0 });
        expect(getAvatarBakeStats({})).toMatchObject({ cached: 0, active: 0 });
    });
});
