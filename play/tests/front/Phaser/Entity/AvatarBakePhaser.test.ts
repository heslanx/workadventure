// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    acquireAvatarBake,
    bakedAvatarKey,
    getAvatarBakeStats,
} from "../../../../src/front/Phaser/Entity/AvatarBakeCache";
import { getPlayerAnimations } from "../../../../src/front/Phaser/Player/Animation";

/**
 * The bake against the real TextureManager, Texture and CanvasPool of Phaser (the other tests use a fake texture
 * manager): the frames of a baked sheet are those of a layer, and removing it frees its canvas. Only the 2D context of
 * a canvas is faked, because jsdom has none.
 */

const drawn: { canvas: HTMLCanvasElement; image: unknown }[] = [];

function sheet(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 128;
    return canvas;
}

function createWorld(layers: string[]) {
    const game = { events: new Phaser.Events.EventEmitter(), config: { antialias: false }, renderer: {} };
    const textures = new Phaser.Textures.TextureManager(game as unknown as Phaser.Game);
    for (const layer of layers) {
        // The loader cuts a layer sheet in frames of 32x32 as the bake does.
        textures.addSpriteSheet(layer, sheet() as unknown as HTMLImageElement, { frameWidth: 32, frameHeight: 32 });
    }
    const removedAnims: string[] = [];
    const scene = {
        textures,
        game,
        anims: {
            remove: (key: string) => {
                removedAnims.push(key);
                return undefined as never;
            },
        },
        events: new Phaser.Events.EventEmitter(),
    };
    return { scene, textures, removedAnims };
}

beforeEach(() => {
    drawn.length = 0;
    localStorage.setItem("avatarBake", "1");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
        return {
            imageSmoothingEnabled: true,
            drawImage: (image: unknown) => drawn.push({ canvas: this, image }),
        } as unknown as CanvasRenderingContext2D;
    } as never);
});

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe("a baked sheet in the real texture manager", () => {
    it("has the 12 frames of a layer under the same names, and the frame total the bake demands of a layer", () => {
        const world = createWorld(["body", "eyes"]);
        const lease = acquireAvatarBake(world.scene, ["body", "eyes"]);

        const baked = world.textures.get(lease?.key ?? "missing");
        const layer = world.textures.get("body");

        expect(baked.frameTotal).toBe(13);
        expect(baked.getFrameNames()).toEqual(layer.getFrameNames());
        expect(baked.getFrameNames()).toEqual(Array.from({ length: 12 }, (_, i) => String(i)));
        for (const name of baked.getFrameNames()) {
            const frame = baked.get(name);
            expect([frame.width, frame.height]).toEqual([32, 32]);
            expect([frame.cutX, frame.cutY]).toEqual([layer.get(name).cutX, layer.get(name).cutY]);
        }
        // The animations are made from the frames of the key that a sprite uses: every frame they name exists.
        for (const animation of getPlayerAnimations(lease?.key ?? "")) {
            for (const frame of animation.frames) {
                expect(baked.has(String(frame))).toBe(true);
            }
        }
    });

    it("draws the layers in order onto one canvas of the texture, and the texture is that canvas, uploaded once", () => {
        const world = createWorld(["body", "eyes", "hair"]);
        const lease = acquireAvatarBake(world.scene, ["body", "eyes", "hair"]);

        const source = world.textures.get(lease?.key ?? "missing").source[0];

        // By identity: two blank canvases are equal to a deep comparison.
        const layers = ["body", "eyes", "hair"].map((layer) => world.textures.get(layer).getSourceImage());
        expect(drawn).toHaveLength(3);
        layers.forEach((image, i) => expect(drawn[i].image).toBe(image));
        expect(new Set(drawn.map((d) => d.canvas)).size).toBe(1);
        expect(source.isCanvas).toBe(true);
        expect(source.image).toBe(drawn[0].canvas);
        expect([source.width, source.height]).toEqual([96, 128]);
    });

    it("gives the canvas back to the pool, and the key back to the manager, when an idle recipe is evicted", () => {
        const layers = Array.from({ length: 66 }, (_, i) => [`a${i}`, `b${i}`]);
        const world = createWorld(layers.flat());
        const before = Phaser.Display.Canvas.CanvasPool.total();

        for (const recipe of layers) {
            acquireAvatarBake(world.scene, recipe)?.release();
        }

        // 66 canvases were made, and the 2 oldest idle recipes were evicted with theirs.
        expect(Phaser.Display.Canvas.CanvasPool.total() - before).toBe(64);
        expect(world.textures.exists(bakedAvatarKey(layers[0]))).toBe(false);
        expect(world.textures.exists(bakedAvatarKey(layers[1]))).toBe(false);
        expect(world.textures.exists(bakedAvatarKey(layers[65]))).toBe(true);
        expect(world.removedAnims.slice(0, 8).sort()).toEqual(
            getPlayerAnimations(bakedAvatarKey(layers[0]))
                .map((a) => a.key)
                .sort(),
        );
        // The key is free: the recipe bakes again.
        expect(acquireAvatarBake(world.scene, layers[0])?.key).toBe(bakedAvatarKey(layers[0]));
    });

    it("leaves no texture behind when Phaser registers the key and then fails to cut the frames", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const world = createWorld(["body", "eyes"]);
        const before = Phaser.Display.Canvas.CanvasPool.total();
        const cut = vi
            .spyOn(Phaser.Textures.Parsers as unknown as { SpriteSheet(): void }, "SpriteSheet")
            .mockImplementationOnce(() => {
                throw new Error("cutting the frames failed");
            });
        const key = bakedAvatarKey(["body", "eyes"]);

        expect(acquireAvatarBake(world.scene, ["body", "eyes"])).toBeUndefined();

        expect(cut).toHaveBeenCalledTimes(1);
        // Phaser had registered the key and its canvas before it threw: both are gone, not left to block the recipe.
        expect(world.textures.exists(key)).toBe(false);
        expect(Phaser.Display.Canvas.CanvasPool.total()).toBe(before);
        expect(getAvatarBakeStats(world.textures).declines).toMatchObject({ error: 1, taken: 0, ineligible: 0 });
    });

    it("gives a recreated recipe a new Texture under the same key, which a consumer that keeps the old one must not trust", () => {
        const layers = Array.from({ length: 66 }, (_, i) => [`a${i}`, `b${i}`]);
        const world = createWorld(layers.flat());
        const first = acquireAvatarBake(world.scene, layers[0]);
        const oldTexture = world.textures.get(first?.key ?? "missing");
        first?.release();
        // 65 more idle recipes: the first one is evicted.
        for (const recipe of layers.slice(1)) {
            acquireAvatarBake(world.scene, recipe)?.release();
        }
        expect(world.textures.exists(bakedAvatarKey(layers[0]))).toBe(false);

        const again = acquireAvatarBake(world.scene, layers[0]);
        const newTexture = world.textures.get(again?.key ?? "missing");

        // KNOWN GAP, tracked in the Ambience lane (SceneEffects compares the key string, not the Texture): a mirror
        // image that kept `oldTexture` shows a destroyed texture under a key that exists again. Texture identity is
        // what tells them apart, and Phaser's Textures REMOVE event is how a consumer hears of the eviction.
        expect(again?.key).toBe(first?.key);
        expect(newTexture).not.toBe(oldTexture);
    });

    it("frees every canvas and texture when the last scene shuts down", () => {
        const world = createWorld(["body", "eyes", "hair"]);
        const before = Phaser.Display.Canvas.CanvasPool.total();
        const held = acquireAvatarBake(world.scene, ["body", "eyes"]);
        acquireAvatarBake(world.scene, ["body", "hair"]);
        expect(Phaser.Display.Canvas.CanvasPool.total() - before).toBe(2);

        world.scene.events.emit(Phaser.Scenes.Events.SHUTDOWN);

        expect(Phaser.Display.Canvas.CanvasPool.total()).toBe(before);
        expect(world.textures.exists(held?.key ?? "missing")).toBe(false);
        expect(getAvatarBakeStats(world.textures)).toMatchObject({ cached: 0, active: 0 });
    });
});
