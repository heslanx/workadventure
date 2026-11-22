// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireAvatarBake, getAvatarBakeStats } from "../../../Phaser/Entity/AvatarBakeCache";
import type { Player } from "../../../Phaser/Player/Player";
import type { EffectTexture, EffectsManifest } from "../domain/effectsManifest";
import { parseFeatures } from "../../Preferences/domain/effectSwitches";
import { SceneEffects, type EffectsEnvironment, type EffectsHost } from "./SceneEffects";

// The glass mirror of the scene effects against the real Phaser TextureManager, Texture and Frame, and the real avatar
// bake (one canvas sheet per recipe, evicted when idle and baked again as a NEW Texture under the same key). The rest
// of the scene is made by hand: what the mirror draws goes to recording images that hold textures as Phaser's do
// (`setTexture(key)` takes the manager's Texture for the key at that time). jsdom has no 2D context: a made one draws
// nothing and answers getImageData with one colour per picture.

const PRE_RENDER = Phaser.Scenes.Events.PRE_RENDER;
const REMOVE = Phaser.Textures.Events.REMOVE;

type Colour = readonly [number, number, number, number];
const CLEAR: Colour = [0, 0, 0, 0];
const OUTSIDE_WATER: Colour = [255, 0, 128, 255];
const GLASS_ALL_OVER: Colour = [255, 255, 255, 255];
let paint: (source: unknown) => Colour = () => CLEAR;

class TestContext {
    public drawn: unknown;
    public globalAlpha = 1;
    public globalCompositeOperation = "source-over";
    public filter = "none";
    public fillStyle = "";
    public imageSmoothingEnabled = true;
    public readonly fillRect = vi.fn();
    public readonly save = vi.fn();
    public readonly restore = vi.fn();
    public readonly beginPath = vi.fn();
    public readonly rect = vi.fn();
    public readonly clip = vi.fn();
    public readonly translate = vi.fn();
    public readonly scale = vi.fn();
    public readonly putImageData = vi.fn();

    drawImage(source: unknown): void {
        this.drawn = source;
    }

    getImageData(_x: number, _y: number, width: number, height: number) {
        const [r, g, b, a] = paint(this.drawn);
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < data.length; i += 4) {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
            data[i + 3] = a;
        }
        return { width, height, data };
    }
}

const contexts = new WeakMap<HTMLCanvasElement, TestContext>();

interface ShaderConfig {
    readonly name: string;
}

/** What a mirror picture was drawn with, in the numbers that say where and how it shows on the glass. */
interface Drawing {
    readonly frame: string | number;
    readonly x: number;
    readonly y: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly alpha: number;
    readonly crop: readonly number[];
}

/** A shader, a container or an image. An image holds a real Texture and Frame, taken from the manager as Phaser does. */
class TestObject {
    public visible = true;
    public depth = 0;
    public texture: Phaser.Textures.Texture;
    public frame: Phaser.Textures.Frame;
    public readonly children: TestObject[] = [];
    public x = 0;
    public y = 0;
    public scaleX = 1;
    public scaleY = 1;
    public alpha = 1;
    public cropRect: readonly number[] = [];

    constructor(
        private readonly world: World,
        public readonly kind: "shader" | "container" | "image",
        key = "",
        frame?: string | number,
    ) {
        // only an image holds a texture; the shaders and the container are made with an empty key
        this.texture = kind === "image" ? world.textures.get(key) : (undefined as never);
        this.frame = kind === "image" ? this.texture.get(frame) : (undefined as never);
    }

    setTexture(key: string, frame?: string | number): this {
        this.texture = this.world.textures.get(key);
        this.frame = this.texture.get(frame);
        return this;
    }

    setDepth(depth: number): this {
        this.depth = depth;
        return this;
    }

    setVisible(visible: boolean): this {
        this.visible = visible;
        return this;
    }

    setOrigin(): this {
        return this;
    }

    setDisplaySize(): this {
        return this;
    }

    setTint(): this {
        return this;
    }

    setPosition(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
    }

    setScale(x: number, y: number): this {
        this.scaleX = x;
        this.scaleY = y;
        return this;
    }

    setAlpha(alpha: number): this {
        this.alpha = alpha;
        return this;
    }

    setCrop(...rect: number[]): this {
        this.cropRect = rect;
        return this;
    }

    add(child: TestObject): this {
        this.world.unlist(child);
        this.children.push(child);
        return this;
    }

    destroy(): void {
        this.world.unlist(this);
        for (const child of this.children) child.destroy();
        this.children.length = 0;
    }

    drawing(): Drawing {
        return {
            frame: this.frame.name,
            x: this.x,
            y: this.y,
            scaleX: this.scaleX,
            scaleY: this.scaleY,
            alpha: this.alpha,
            crop: this.cropRect,
        };
    }
}

/** A texture the effects add for themselves: the manager of the scene is the real one only for the avatars' textures. */
interface EffectTextureFake {
    key: string;
    setFilter(): void;
    refresh(): void;
    get(): { source: { glTexture: null } };
}

const EFFECT_FRAME = {
    width: 4,
    height: 4,
    cutWidth: 4,
    cutHeight: 4,
    cutX: 0,
    cutY: 0,
    source: { image: new Image() },
};

function sheetCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 128;
    return canvas;
}

/** The scene's texture manager is the real one; a texture the effects add is a plain record kept beside it. */
class World {
    public readonly game = { events: new Phaser.Events.EventEmitter(), config: { antialias: false }, renderer: {} };
    public readonly real = new Phaser.Textures.TextureManager(this.game as unknown as Phaser.Game);
    public readonly effectTextures = new Map<string, EffectTextureFake>();
    public readonly list: unknown[] = [];
    public readonly images: TestObject[] = [];
    public readonly sceneEvents = new Phaser.Events.EventEmitter();
    public readonly listeners = new Map<string, Set<() => void>>();
    public readonly current: { player: Player | undefined } = { player: undefined };
    public readonly host: EffectsHost;
    /** The real manager and the effects' own textures behind one door, as the game scene's `textures`. */
    public readonly textures: EffectsHost["textures"];

    constructor() {
        const effectFake = (key: string): EffectTextureFake | null => {
            if (this.effectTextures.has(key) || this.real.exists(key)) return null;
            const texture: EffectTextureFake = {
                key,
                setFilter: () => undefined,
                refresh: () => undefined,
                get: () => ({ source: { glTexture: null } }),
            };
            this.effectTextures.set(key, texture);
            return texture;
        };
        this.textures = {
            addImage: (key: string) => effectFake(key),
            addCanvas: (key: string) => effectFake(key),
            get: (key: string) => this.effectTextures.get(key) ?? this.real.get(key),
            getFrame: (key: string, frame?: string | number) =>
                this.effectTextures.has(key) ? EFFECT_FRAME : this.real.getFrame(key, frame),
            exists: (key: string) => this.effectTextures.has(key) || this.real.exists(key),
            remove: (key: string) => (this.effectTextures.delete(key) ? this : this.real.remove(key)),
            on: (event: string, listener: (key: string) => void) => this.real.on(event, listener),
            off: (event: string, listener: (key: string) => void) => this.real.off(event, listener),
        } as unknown as EffectsHost["textures"];
        const layers = ["decor", "doors", "luz", "lock-meeting"].map((name, i) => ({
            layer: { name },
            depth: i + 1,
            alpha: 1,
            visible: true,
            setAlpha(alpha: number) {
                this.alpha = alpha;
                return this;
            },
        }));
        this.list.push(...layers);
        const camera = {
            worldView: { x: 0, y: 0, width: 300, height: 200 },
            scrollX: 0,
            scrollY: 0,
            width: 300,
            height: 200,
            zoom: 1,
            filters: { internal: { add: () => undefined, remove: () => undefined } },
        };
        const canvas = document.createElement("canvas");
        vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
            left: 0,
            top: 0,
            width: 300,
            height: 200,
        } as DOMRect);
        const current = this.current;
        this.host = {
            add: {
                shader: (config: ShaderConfig) => this.make("shader", config.name),
                container: () => this.make("container"),
                image: (_x: number, _y: number, key: string, frame?: string | number) => this.make("image", key, frame),
            } as unknown as EffectsHost["add"],
            textures: this.textures,
            children: { list: this.list } as unknown as EffectsHost["children"],
            events: {
                on: (event, listener) => this.listenersOf(event).add(listener),
                off: (event, listener) => this.listenersOf(event).delete(listener),
            },
            cameras: { main: camera as unknown as Phaser.Cameras.Scene2D.Camera },
            game: { canvas },
            MapPlayersByKey: new Map(),
            get CurrentPlayer() {
                return current.player;
            },
            markDirty: () => undefined,
            getGameMapFrontWrapper: () =>
                ({
                    phaserLayers: layers,
                    getTileAnimationRefreshDelay: () => undefined,
                    getEntitiesManager: () => ({ getEntities: () => new Map() }),
                }) as unknown as ReturnType<EffectsHost["getGameMapFrontWrapper"]>,
        };
    }

    /** What the bake takes of a scene (AvatarBakeScene): the real texture manager, the game, the scene's events. */
    get bakeScene() {
        return {
            textures: this.real,
            game: this.game,
            anims: { remove: () => undefined as never },
            events: this.sceneEvents,
        };
    }

    addLayerSheets(...keys: string[]): void {
        for (const key of keys) {
            this.real.addSpriteSheet(key, sheetCanvas() as unknown as HTMLImageElement, {
                frameWidth: 32,
                frameHeight: 32,
            });
        }
    }

    unlist(object: unknown): void {
        const at = this.list.indexOf(object);
        if (at >= 0) this.list.splice(at, 1);
    }

    emit(event: string): void {
        for (const listener of [...this.listenersOf(event)]) listener();
    }

    /** The pooled images of the mirror, in the order they were made. */
    pool(): readonly TestObject[] {
        return this.images;
    }

    private listenersOf(event: string): Set<() => void> {
        let listeners = this.listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(event, listeners);
        }
        return listeners;
    }

    private make(kind: "shader" | "container" | "image", key = "", frame?: string | number): TestObject {
        const object = new TestObject(this, kind, key, frame);
        this.list.push(object);
        if (kind === "image") this.images.push(object);
        return object;
    }
}

/** An object of a Phaser class that was not built by it: the effects ask `instanceof`, then read the fields given. */
function fake<T extends object>(prototype: object, properties: Record<string, unknown>): T {
    const object: T = Object.create(prototype);
    for (const [name, value] of Object.entries(properties)) {
        Object.defineProperty(object, name, { value, writable: true, configurable: true, enumerable: true });
    }
    return object;
}

/** A sprite of an avatar as the scene makes it: a real Texture and Frame of the manager, at the avatar's origin. */
function spriteOf(world: World, key: string, frame: number, flipX = false): Phaser.GameObjects.Sprite {
    const texture = world.real.get(key);
    return fake(Phaser.GameObjects.Sprite.prototype, {
        visible: true,
        frame: texture.get(frame),
        texture,
        originX: 0.5,
        originY: 0.5,
        displayHeight: 32,
        x: 0,
        y: 0,
        flipX,
        scaleX: 1,
        scaleY: 1,
    });
}

function avatar(x: number, y: number, sprites: readonly object[]): Player {
    return { x, y, visible: true, list: sprites } as unknown as Player;
}

function manifest(): EffectsManifest {
    return {
        map: [400, 300],
        water: { rect: [100, 100, 100, 80], glint: [[255, 255, 255]], waterline: [200, 200, 200] },
        lights: {},
        shadows: {},
        rooms: [],
        glassFaces: [[0, 100, 100]],
        ink: [10, 10, 30],
    } as unknown as EffectsManifest;
}

function pictures(): Record<EffectTexture, HTMLImageElement> {
    const sized = (width: number, height: number): HTMLImageElement => Object.assign(new Image(), { width, height });
    const images = {
        water: sized(100, 80),
        "water-data": sized(100, 80),
        glass: sized(400, 300),
        masks: sized(400, 300),
        "tv-slide": sized(24, 16),
        occluders: sized(200, 150),
    };
    paint = (source) => (source === images.masks ? OUTSIDE_WATER : source === images.glass ? GLASS_ALL_OVER : CLEAR);
    return images;
}

function construct(world: World): SceneEffects {
    const environment: EffectsEnvironment = {
        reducedMotion: () => false,
        animationsOff: () => false,
        fixedHour: () => 12,
        focused: () => false,
        nightLit: () => false,
    };
    return new SceneEffects({
        scene: world.host,
        renderer: { renderNodes: { hasNode: () => true } } as unknown as Phaser.Renderer.WebGL.WebGLRenderer,
        manifest: manifest(),
        images: pictures(),
        generation: 1,
        features: parseFeatures(null),
        environment,
        time: 0,
        reveal: false,
    });
}

/** Recipes the bake keeps idle at most (AvatarBakeRegistry DEFAULT_MAX_IDLE_BAKED_RECIPES): one more evicts the oldest. */
const IDLE_RECIPES = 64;

/** A recipe of two layers whose sheets are loaded: [body, hair]. */
function recipe(world: World, i: number): string[] {
    const layers = [`body${i}`, `hair${i}`];
    world.addLayerSheets(...layers);
    return layers;
}

/** Bakes and lets go of enough other recipes that the oldest idle one, the sheet `key`, is evicted from the cache. */
function evict(world: World, key: string): void {
    for (let i = 0; i <= IDLE_RECIPES + 1 && world.real.exists(key); i++) {
        acquireAvatarBake(world.bakeScene, recipe(world, 1000 + i))?.release();
    }
    expect(world.real.exists(key)).toBe(false);
}

/** The images the mirror shows now. */
const shown = (world: World): TestObject[] => world.pool().filter((image) => image.visible);

beforeEach(() => {
    localStorage.setItem("avatarBake", "1");
    paint = () => CLEAR;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
        let context = contexts.get(this);
        if (!context) {
            context = new TestContext();
            contexts.set(this, context);
        }
        return context as unknown as RenderingContext;
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe("the glass mirror when remote avatars use baked textures", () => {
    it("shows a baked avatar on the live Texture of its key after the recipe was evicted and baked again", () => {
        const world = new World();
        const layers = recipe(world, 0);
        const first = acquireAvatarBake(world.bakeScene, layers);
        const oldTexture = world.real.get(first?.key ?? "missing");
        world.current.player = avatar(50, 100, [spriteOf(world, first?.key ?? "missing", 1)]);
        const effects = construct(world);
        world.emit(PRE_RENDER);
        expect(shown(world).map((image) => image.texture)).toEqual([oldTexture]);

        // The avatar turns into a dot and back: its sprite goes with its lease, the idle sheet is evicted, and the
        // recipe is baked again as another Texture under the same key.
        world.current.player = avatar(50, 100, []);
        first?.release();
        evict(world, first?.key ?? "missing");
        world.emit(PRE_RENDER);
        const again = acquireAvatarBake(world.bakeScene, layers);
        const newTexture = world.real.get(again?.key ?? "missing");
        expect(again?.key).toBe(first?.key);
        expect(newTexture).not.toBe(oldTexture);
        world.current.player = avatar(50, 100, [spriteOf(world, again?.key ?? "missing", 1)]);
        world.emit(PRE_RENDER);

        const images = shown(world);
        expect(images).not.toHaveLength(0);
        for (const image of images) {
            expect(image.texture).toBe(newTexture);
            expect(image.frame.texture).toBe(newTexture);
        }
        effects.destroy();
    });

    it("re-points an image that is shown when its Texture is replaced between two draws, with no removal event", () => {
        const world = new World();
        const layers = recipe(world, 0);
        const lease = acquireAvatarBake(world.bakeScene, layers);
        const key = lease?.key ?? "missing";
        world.current.player = avatar(50, 100, [spriteOf(world, key, 1)]);
        const effects = construct(world);
        world.emit(PRE_RENDER);
        const [image] = shown(world);
        expect(image.texture).toBe(world.real.get(key));

        // The sheet is destroyed and made again while the avatar still stands there (a restore of its sprites). It is
        // destroyed without the manager's REMOVE event, so only the Texture the image holds can tell it is not the one
        // the manager has for the key.
        const oldTexture = world.real.get(key);
        oldTexture.destroy();
        expect(world.real.exists(key)).toBe(false);
        world.real.addSpriteSheet(key, sheetCanvas() as unknown as HTMLImageElement, {
            frameWidth: 32,
            frameHeight: 32,
        });
        const newTexture = world.real.get(key);
        expect(newTexture).not.toBe(oldTexture);
        world.current.player = avatar(50, 100, [spriteOf(world, key, 1)]);
        world.emit(PRE_RENDER);

        // The same pooled image, now on the new Texture: no new image was made for it.
        expect(shown(world)).toContain(image);
        expect(image.texture).toBe(newTexture);
        expect(image.frame.texture).toBe(newTexture);
        effects.destroy();
    });

    it("parks a pooled image that holds a texture the moment it is removed, so none holds a destroyed Texture", () => {
        const world = new World();
        const lease = acquireAvatarBake(world.bakeScene, recipe(world, 0));
        const key = lease?.key ?? "missing";
        world.current.player = avatar(50, 100, [spriteOf(world, key, 1)]);
        const effects = construct(world);
        world.emit(PRE_RENDER);
        const [image] = shown(world);
        const held = image.texture;
        expect(held).toBe(world.real.get(key));

        // The avatar leaves the glass: its image is hidden, still holding the sheet. Then the sheet is destroyed.
        world.current.player = avatar(50, 100, []);
        world.emit(PRE_RENDER);
        expect(image.visible).toBe(false);
        lease?.release();
        world.real.remove(key);

        expect(held.manager).toBeNull();
        expect(image.texture).not.toBe(held);
        expect(image.texture.manager).not.toBeNull();
        effects.destroy();
    });

    it("listens to the removal of textures only while the effects live", () => {
        const world = new World();
        const before = world.real.listenerCount(REMOVE);

        const effects = construct(world);
        expect(world.real.listenerCount(REMOVE)).toBe(before + 1);
        effects.destroy();

        expect(world.real.listenerCount(REMOVE)).toBe(before);
    });

    it("keeps its pool and listeners at one avatar's size when 300 recipes come to the glass and leave", () => {
        const world = new World();
        const effects = construct(world);
        const listeners = world.real.listenerCount(REMOVE);
        let poolAfterFirst = -1;

        for (let i = 0; i < 300; i++) {
            const lease = acquireAvatarBake(world.bakeScene, recipe(world, i));
            expect(lease).toBeDefined();
            const key = lease?.key ?? "missing";
            world.current.player = avatar(50, 100, [spriteOf(world, key, 1)]);
            world.emit(PRE_RENDER);
            expect(shown(world)).not.toHaveLength(0);
            // the avatar leaves; its lease goes with its sprites
            world.current.player = avatar(50, 100, []);
            world.emit(PRE_RENDER);
            lease?.release();
            if (i === 0) poolAfterFirst = world.pool().length;
        }

        // One avatar has one sprite, so the pool is what that avatar needs and does not grow with the recipes.
        expect(poolAfterFirst).toBeGreaterThan(0);
        expect(world.pool()).toHaveLength(poolAfterFirst);
        expect(world.real.listenerCount(REMOVE)).toBe(listeners);
        // Of the 300 sheets the bake kept the idle limit, and the mirror holds a live Texture of one of them at most.
        expect(getAvatarBakeStats(world.real).cached).toBe(IDLE_RECIPES);
        for (const image of world.pool()) expect(world.textures.get(image.texture.key)).toBe(image.texture);

        // The scene shuts down and the bake destroys every sheet it still has: no image keeps one.
        world.sceneEvents.emit(Phaser.Scenes.Events.SHUTDOWN);
        expect(getAvatarBakeStats(world.real).cached).toBe(0);
        for (const image of world.pool()) expect(image.texture.manager).not.toBeNull();
        effects.destroy();
    });

    describe("next to an avatar of layers", () => {
        // Each row of the sheet: down 1, left 4, right 7, up 10 (a frame of the walk cycle each).
        it.each([
            ["down", 1, false],
            ["left", 4, false],
            ["right", 7, false],
            ["up", 10, false],
            ["a turned sprite", 4, true],
        ])("gives the same mirror picture for a baked sprite as for each layer: %s", (_name, frame, flipX) => {
            const world = new World();
            const layers = recipe(world, 0);
            const lease = acquireAvatarBake(world.bakeScene, layers);
            const bakedKey = lease?.key ?? "missing";

            const drawingsOf = (sprites: readonly object[]): Drawing[] => {
                const scene = new World();
                scene.addLayerSheets(...layers);
                // the sprites are of the first world's textures: read the same names from this one's own
                const own = sprites.map((sprite) => {
                    const source = sprite as Phaser.GameObjects.Sprite;
                    const key = source.texture.key;
                    if (key !== bakedKey) return spriteOf(scene, key, Number(source.frame.name), source.flipX);
                    const bake = acquireAvatarBake(scene.bakeScene, layers);
                    return spriteOf(scene, bake?.key ?? "missing", Number(source.frame.name), source.flipX);
                });
                scene.current.player = avatar(50, 100, own);
                const effects = construct(scene);
                scene.emit(PRE_RENDER);
                const drawings = shown(scene).map((image) => image.drawing());
                effects.destroy();
                return drawings;
            };

            const layered = drawingsOf(layers.map((key) => spriteOf(world, key, frame, flipX)));
            const baked = drawingsOf([spriteOf(world, bakedKey, frame, flipX)]);

            // the layers share one picture's place, size and strength: the layered avatar shows it once per layer
            expect(baked).not.toHaveLength(0);
            expect(layered).toHaveLength(baked.length * layers.length);
            for (const drawing of layered) expect(baked).toContainEqual(drawing);
            for (const drawing of baked)
                expect(layered.filter((d) => JSON.stringify(d) === JSON.stringify(drawing))).toHaveLength(
                    layers.length,
                );
        });
    });
});
