// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { RemotePlayer } from "../../../Phaser/Entity/RemotePlayer";
import type { Player } from "../../../Phaser/Player/Player";
import { EFFECT_TEXTURES, type EffectTexture, type EffectsManifest } from "../domain/effectsManifest";
import { parseFeatures, type FeatureSwitches } from "../domain/effectSwitches";
import { SceneEffects, isKoiSchool, type EffectsEnvironment, type EffectsHost } from "./SceneEffects";

// The effects are built on a hand-made scene (EffectsHost): it records what they add to it and what they give back.
// jsdom stands in for the page; its canvases have no 2D context, so a made one draws nothing and answers
// getImageData with one colour per picture.

const PRE_RENDER = Phaser.Scenes.Events.PRE_RENDER;

type Colour = readonly [number, number, number, number];

const CLEAR: Colour = [0, 0, 0, 0];
/** The whole map outside (red) and open water (blue 128): the lawn and the pool from anywhere. */
const OUTSIDE_WATER: Colour = [255, 0, 128, 255];
/** Glass all over (red above 100). */
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

interface ShaderConfig {
    readonly name: string;
    setupUniforms(set: (name: string, value: unknown) => void): void;
}

/** A shader, a container or an image: it knows how often it was destroyed, and a container destroys its children. */
class TestObject {
    public destroyed = 0;
    public visible = true;
    public depth = 0;
    public texture: { key: string };
    public readonly frame: { name: string | number | undefined };
    public readonly children: TestObject[] = [];

    constructor(
        private readonly scene: TestScene,
        public readonly label: string,
        key = "",
        frame?: string | number,
        public readonly config?: ShaderConfig,
    ) {
        this.texture = { key };
        this.frame = { name: frame };
    }

    setDepth(depth: number): this {
        this.depth = depth;
        return this;
    }

    setVisible(visible: boolean): this {
        this.visible = visible;
        return this;
    }

    setTexture(key: string): this {
        this.texture = { key };
        return this;
    }

    setOrigin(): this {
        return this;
    }

    setPosition(): this {
        return this;
    }

    setDisplaySize(): this {
        return this;
    }

    setScale(): this {
        return this;
    }

    setAlpha(): this {
        return this;
    }

    setTint(): this {
        return this;
    }

    setCrop(): this {
        return this;
    }

    /** As an exclusive Phaser container: the child leaves the scene's display list. */
    add(child: TestObject): this {
        this.scene.unlist(child);
        this.children.push(child);
        return this;
    }

    destroy(): void {
        this.destroyed += 1;
        this.scene.unlist(this);
        for (const child of this.children) child.destroy();
        this.children.length = 0;
    }
}

class TestLayer {
    public alpha = 1;
    public visible = true;
    public readonly layer: { name: string };

    constructor(
        name: string,
        public depth: number,
    ) {
        this.layer = { name };
    }

    setAlpha(alpha: number): this {
        this.alpha = alpha;
        return this;
    }
}

class TestScene {
    public dirty = 0;
    public tickDelay: number | undefined = 220;
    public failOn: "shader" | "container" | "image" | undefined;
    public readonly current: { player: Player | undefined } = { player: undefined };
    public readonly players = new Map<number, RemotePlayer>();
    /** The display list. */
    public readonly list: unknown[] = [];
    public readonly created: TestObject[] = [];
    public readonly textureKeys = new Set<string>();
    public readonly listeners = new Map<string, Set<() => void>>();
    public readonly offs: [string, () => void][] = [];
    public readonly filters = { list: [] as unknown[], removed: [] as [unknown, boolean][] };
    public readonly renderer = {
        renderNodes: { hasNode: () => true },
    } as unknown as Phaser.Renderer.WebGL.WebGLRenderer;
    public readonly host: EffectsHost;
    /** The frame every texture answers with (the fields of a Phaser frame the effects read). */
    public readonly frame = {
        width: 4,
        height: 4,
        cutWidth: 4,
        cutHeight: 4,
        cutX: 0,
        cutY: 0,
        source: { image: new Image() },
    };

    constructor() {
        const layers = ["decor", "doors", "luz", "lock-meeting"].map((name, i) => new TestLayer(name, i + 1));
        this.list.push(...layers);
        const camera = {
            worldView: { x: 0, y: 0, width: 300, height: 200 },
            scrollX: 0,
            scrollY: 0,
            width: 300,
            height: 200,
            zoom: 1,
            filters: {
                internal: {
                    add: (controller: unknown) => this.filters.list.push(controller),
                    remove: (controller: unknown, forceDestroy: boolean) => {
                        this.filters.removed.push([controller, forceDestroy]);
                        this.filters.list = this.filters.list.filter((c) => c !== controller);
                    },
                },
            },
        };
        const current = this.current;
        const canvas = document.createElement("canvas");
        // the page shows the camera's 300 x 200 at its own size, from its top left (jsdom measures every box as 0)
        vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
            left: 0,
            top: 0,
            width: 300,
            height: 200,
        } as DOMRect);
        this.host = {
            add: {
                shader: (config: ShaderConfig) => this.make("shader", `shader ${config.name}`, "", undefined, config),
                container: () => this.make("container", "container"),
                image: (_x: number, _y: number, key: string, frame?: string | number) =>
                    this.make("image", `image ${key}`, key, frame),
            } as unknown as EffectsHost["add"],
            textures: {
                addImage: (key: string) => this.addTexture(key),
                addCanvas: (key: string) => this.addTexture(key),
                getFrame: () => this.frame,
                exists: (key: string) => this.textureKeys.has(key),
                remove: (key: string) => this.textureKeys.delete(key),
            } as unknown as EffectsHost["textures"],
            children: { list: this.list } as unknown as EffectsHost["children"],
            events: {
                on: (event, listener) => this.listenersOf(event).add(listener),
                off: (event, listener) => {
                    this.offs.push([event, listener]);
                    return this.listenersOf(event).delete(listener);
                },
            },
            cameras: { main: camera as unknown as Phaser.Cameras.Scene2D.Camera },
            game: { canvas },
            MapPlayersByKey: this.players,
            get CurrentPlayer() {
                return current.player;
            },
            markDirty: () => {
                this.dirty += 1;
            },
            getGameMapFrontWrapper: () =>
                ({
                    phaserLayers: layers,
                    getTileAnimationRefreshDelay: () => this.tickDelay,
                    getEntitiesManager: () => ({ getEntities: () => new Map() }),
                }) as unknown as ReturnType<EffectsHost["getGameMapFrontWrapper"]>,
        };
    }

    /** A texture of the scene that is not the effects': added with the key, or null when it exists (as Phaser does). */
    addTexture(key: string) {
        if (this.textureKeys.has(key)) return null;
        this.textureKeys.add(key);
        return { key, setFilter: vi.fn(), refresh: vi.fn() };
    }

    unlist(object: unknown): void {
        const at = this.list.indexOf(object);
        if (at >= 0) this.list.splice(at, 1);
    }

    emit(event: string): void {
        for (const listener of [...this.listenersOf(event)]) listener();
    }

    /** How often each object the effects made was destroyed, by label. */
    destroyedCounts(): Record<string, number> {
        return Object.fromEntries(this.created.map((object) => [object.label, object.destroyed]));
    }

    private listenersOf(event: string): Set<() => void> {
        let listeners = this.listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(event, listeners);
        }
        return listeners;
    }

    private make(
        kind: "shader" | "container" | "image",
        label: string,
        key = "",
        frame?: string | number,
        config?: ShaderConfig,
    ): TestObject {
        if (this.failOn === kind) throw new Error(`${kind} failed`);
        const object = new TestObject(this, label, key, frame, config);
        this.list.push(object);
        this.created.push(object);
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

/** A TV the map places: its light spec is in the manifest under the name after "/entities/". */
function placedTv(): Phaser.GameObjects.Image {
    return fake(Phaser.GameObjects.Image.prototype, {
        type: "Image",
        texture: { key: "office/entities/tv.png" },
        x: 100,
        y: 100,
        depth: 5,
    });
}

/** One layer of a character, from a figure sheet's up row (a reflection turns it over). */
function figureLayer(): Phaser.GameObjects.Sprite {
    return fake(Phaser.GameObjects.Sprite.prototype, {
        visible: true,
        frame: { name: 1 },
        texture: { key: "woka" },
        originX: 0.5,
        originY: 1,
        displayHeight: 32,
        x: 0,
        y: 0,
        flipX: false,
        scaleX: 1,
        scaleY: 1,
    });
}

function character(x: number, y: number, layers: readonly object[] = []): Player {
    return { x, y, visible: true, list: layers } as unknown as Player;
}

function manifest(glassFaces: EffectsManifest["glassFaces"]): EffectsManifest {
    return {
        map: [400, 300],
        water: { rect: [100, 100, 100, 80], glint: [[255, 255, 255]], waterline: [200, 200, 200] },
        lights: { "tv.png": { kind: "tv", w: 32, h: 32, foot: [16, 30], screen: [4, 4, 28, 20] } },
        shadows: { "tv.png": null },
        rooms: [{ key: "meeting", layer: "lock-meeting", rect: [20, 20, 120, 100], floor: [30, 30, 100, 80] }],
        glassFaces,
        ink: [10, 10, 30],
    };
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

interface Setup {
    /** The fixed hour of the day. */
    readonly hour?: number;
    readonly features?: Partial<FeatureSwitches>;
    readonly glassFaces?: EffectsManifest["glassFaces"];
}

interface Built {
    readonly effects: SceneEffects;
    /** How many times the effects asked for the hour: once at the start, once for each refresh. */
    readonly hourReads: () => number;
}

function construct(scene: TestScene, { hour = 12, features = {}, glassFaces = [] }: Setup = {}): Built {
    let reads = 0;
    const environment: EffectsEnvironment = {
        reducedMotion: () => false,
        animationsOff: () => false,
        fixedHour: () => {
            reads += 1;
            return hour;
        },
        focused: () => false,
    };
    const effects = new SceneEffects({
        scene: scene.host,
        renderer: scene.renderer,
        manifest: manifest(glassFaces),
        images: pictures(),
        generation: 1,
        features: { ...parseFeatures(null), ...features },
        environment,
        time: 0,
        reveal: false,
    });
    return { effects, hourReads: () => reads };
}

function build(setup: Setup = {}, tickDelay: number | undefined = 220): Built & { scene: TestScene } {
    const scene = new TestScene();
    scene.tickDelay = tickDelay;
    return { scene, ...construct(scene, setup) };
}

/** A room with a TV the map placed, a glass face, and a figure in front of it, drawn once: the most the effects make. */
function furnishedRoom(): { scene: TestScene; effects: SceneEffects; tv: Phaser.GameObjects.Image } {
    const scene = new TestScene();
    const tv = placedTv();
    scene.addTexture("woka"); // the figure's sheet: the scene's, not the effects'
    scene.list.push(tv);
    scene.current.player = character(50, 100, [figureLayer()]);
    const { effects } = construct(scene, { glassFaces: [[0, 100, 100]] });
    scene.emit(PRE_RENDER);
    return { scene, effects, tv };
}

/** The water's tick count, as the water shader is given it on its next draw. */
function waterTicks(scene: TestScene): number {
    let ticks = -1;
    scene.created
        .find((object) => object.config?.name === "kfxWater")
        ?.config?.setupUniforms((name, value) => {
            if (name === "uTick" && typeof value === "number") ticks = value;
        });
    return ticks;
}

/** Every object the effects made was destroyed once: a failure names each one that was not. */
function expectEachDestroyedOnce(scene: TestScene): void {
    for (const object of scene.created) expect.soft(object.destroyed, object.label).toBe(1);
}

function runFrames(effects: SceneEffects, from: number, to: number, step = 16): void {
    for (let time = from; time <= to; time += step) effects.onFrame(time);
}

const contexts = new WeakMap<HTMLCanvasElement, TestContext>();
let logged: MockInstance;

beforeEach(() => {
    paint = () => CLEAR;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
        let context = contexts.get(this);
        if (!context) {
            context = new TestContext();
            contexts.set(this, context);
        }
        return context as unknown as RenderingContext;
    });
    logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

/** Destroys the effects and checks that giving everything back raised no error (the release reports one and goes on). */
function release(effects: SceneEffects): void {
    effects.destroy();
    expect(logged).not.toHaveBeenCalled();
}

describe("the effects of a scene, when they are destroyed", () => {
    it("take the camera pass off the camera's filter list", () => {
        const { scene, effects } = build();
        const [pass] = scene.filters.list;
        expect(scene.filters.list).toHaveLength(1);

        release(effects);

        expect(scene.filters.removed).toEqual([[pass, true]]);
        expect(scene.filters.list).toEqual([]);
    });

    it("stop listening to the scene's draws", () => {
        const { scene, effects } = build();
        const [listener] = [...(scene.listeners.get(PRE_RENDER) ?? [])];
        expect(scene.listeners.get(PRE_RENDER)?.size).toBe(1);

        release(effects);

        expect(scene.offs).toEqual([[PRE_RENDER, listener]]);
        expect(scene.listeners.get(PRE_RENDER)?.size).toBe(0);
    });

    it("give the koi pages back their own brightness", () => {
        const koi = document.createElement("iframe");
        koi.setAttribute("src", "/koi/index.html");
        document.body.append(koi);
        const { effects } = build({ hour: 23 });
        expect(koi.style.filter).toMatch(/^brightness\(/);

        release(effects);

        expect(koi.style.filter).toBe("");
    });

    it("show the name tags they hid in a locked room", () => {
        const label = document.createElement("div");
        label.className = "username-display";
        // a tag at (70, 52) of the world, inside the locked meeting room (20, 20, 120 x 100) that its viewer is outside
        vi.spyOn(label, "getBoundingClientRect").mockReturnValue({
            left: 60,
            width: 20,
            bottom: 40,
            top: 20,
        } as DOMRect);
        document.body.append(label);
        const { scene, effects } = build();
        scene.current.player = character(10, 10);
        scene.emit(PRE_RENDER);
        expect(label.style.visibility).toBe("hidden");

        release(effects);

        expect(label.style.visibility).toBe("");
    });

    it("destroy every object they made: the shaders, the mirror's container with its pictures, a TV's slide", () => {
        const { scene, effects } = furnishedRoom();
        expect(scene.created.map((object) => object.label).sort()).toEqual([
            "container",
            "image kfx-1-mirror-0",
            "image kfx-1-tv-slide",
            "shader kfxGlass",
            "shader kfxGround",
            "shader kfxWater",
        ]);
        expect(scene.created.every((object) => object.destroyed === 0)).toBe(true);

        release(effects);

        expectEachDestroyedOnce(scene);
    });

    it("remove every texture they added, the mirror's turned figures too, and no other", () => {
        const { scene, effects } = furnishedRoom();
        expect([...scene.textureKeys].sort()).toEqual(
            [
                "woka",
                ...EFFECT_TEXTURES.map((name) => `kfx-1-${name}`),
                "kfx-1-occ",
                "kfx-1-mirror",
                "kfx-1-mirror-0",
            ].sort(),
        );

        release(effects);

        expect([...scene.textureKeys]).toEqual(["woka"]);
    });

    it("ask for one more draw, so the map shows without them", () => {
        const { scene, effects } = build();
        const before = scene.dirty;

        release(effects);

        expect(scene.dirty).toBe(before + 1);
    });
});

describe("the effects of a scene, when they cannot be built", () => {
    it("give back what the build had made by then, and fail", () => {
        const scene = new TestScene();
        scene.failOn = "container"; // after the textures, the water and the ground

        expect(() => construct(scene)).toThrow("container failed");

        expect(scene.textureKeys.size).toBe(0);
        expect(scene.destroyedCounts()).toEqual({ "shader kfxWater": 1, "shader kfxGround": 1 });
        expect(scene.listeners.get(PRE_RENDER)?.size ?? 0).toBe(0);
        expect(scene.filters.list).toEqual([]);
        expect(logged).not.toHaveBeenCalled();
    });
});

describe("the effects of a scene, while they run", () => {
    it("destroy a TV's slide when its screen leaves the scene, and not again at the end", () => {
        const { scene, effects, tv } = furnishedRoom();
        scene.unlist(tv);

        effects.onFrame(1000);

        expect(scene.destroyedCounts()["image kfx-1-tv-slide"]).toBe(1);
        release(effects);
        expect(scene.destroyedCounts()["image kfx-1-tv-slide"]).toBe(1);
    });

    it("tick the water on the tile clock's own period, not the frames' (a 220 ms tick on 16 ms frames)", () => {
        const { scene, effects } = build({ hour: 12 }, 220);

        runFrames(effects, 16, 4400);

        // one tick for each 220 ms of the 4400: the frame after each one is late, but the next is not
        expect(waterTicks(scene)).toBe(20);
    });

    it("do not catch up on the ticks of a stalled tab", () => {
        const { scene, effects } = build({ hour: 12 }, 220);
        runFrames(effects, 16, 1008); // 4 ticks, the last at 880

        effects.onFrame(11000); // ten seconds later: one tick for them all
        runFrames(effects, 11016, 11128);

        expect(waterTicks(scene)).toBe(5);
    });

    it("keep the mirror's pictures in its container, so that they go with it", () => {
        const { scene } = furnishedRoom();
        const container = scene.created.find((object) => object.label === "container");
        const picture = scene.created.find((object) => object.label === "image kfx-1-mirror-0");

        expect(container?.children).toHaveLength(1);
        expect(container?.children[0]).toBe(picture);
        expect(scene.list).not.toContain(picture);
    });

    it("make no turned picture of a frame with no height", () => {
        const scene = new TestScene();
        scene.frame.cutHeight = 0;
        scene.current.player = character(50, 100, [figureLayer()]);
        construct(scene, { glassFaces: [[0, 100, 100]] });

        scene.emit(PRE_RENDER);

        // the mirror's atlas is the only mirror texture: no `kfx-1-mirror-0` for the figure
        expect([...scene.textureKeys].filter((key) => key.startsWith("kfx-1-mirror"))).toEqual(["kfx-1-mirror"]);
    });

    it("refresh once a second on the clock's own period", () => {
        const { effects, hourReads } = build({ hour: 12 });
        const started = hourReads();

        runFrames(effects, 16, 6000);

        // at 1008, 2000, 3008, 4000, 5008 and 6000: each a second after the last one was due
        expect(hourReads() - started).toBe(6);
    });

    it("drift the clouds by the tick's delay (a 1 s tick moves them 1 s)", () => {
        const { scene, effects } = build({ hour: 12, features: { water: false, trail: false } }, 1000);
        scene.current.player = character(10, 10); // on the lawn: the masks are outside everywhere
        const before = scene.dirty;

        for (const time of [1000, 2000, 3000, 4000, 5000]) effects.onFrame(time);

        // a second of wind is 3 px: the drawn offset changes on every tick, so every tick asks for a draw
        expect(scene.dirty - before).toBe(5);
    });
});

describe("a school of koi that a page shares", () => {
    const school = (): Record<string, unknown> => ({
        school: { snapshot: () => ({ fish: [] }) },
        scene: { origin: [10, 20], width: 300 },
        masks: { open: new Uint8Array(300) },
    });

    it("is read with a snapshot, an origin and width that are numbers, and a mask of open water that can be indexed", () => {
        expect(isKoiSchool(school())).toBe(true);
    });

    it.each([
        ["no masks", { masks: undefined }],
        ["null masks", { masks: null }],
        ["masks without open water", { masks: {} }],
        ["the open water as a plain array", { masks: { open: [0, 1, 1] } }],
    ])("is read with %s", (_name, change) => {
        expect(isKoiSchool({ ...school(), ...change })).toBe(true);
    });

    it.each([
        ["no snapshot", { school: {} }],
        ["a width that is a string", { scene: { origin: [10, 20], width: "300" } }],
        ["a width that is NaN", { scene: { origin: [10, 20], width: Number.NaN } }],
        ["no width", { scene: { origin: [10, 20] } }],
        ["an origin of one coordinate", { scene: { origin: [10], width: 300 } }],
        ["an origin that is strings", { scene: { origin: ["10", "20"], width: 300 } }],
        ["an origin with a NaN", { scene: { origin: [Number.NaN, 20], width: 300 } }],
        ["a mask that cannot be indexed", { masks: { open: 5 } }],
        ["a mask that is not an object", { masks: "open" }],
    ])("is refused with %s", (_name, change) => {
        expect(isKoiSchool({ ...school(), ...change })).toBe(false);
    });

    it.each([null, undefined, 3, "koi"])("is refused when it is %s", (value) => {
        expect(isKoiSchool(value)).toBe(false);
    });
});
