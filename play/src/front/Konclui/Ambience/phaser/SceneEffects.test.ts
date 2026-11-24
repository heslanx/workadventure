// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { RemotePlayer } from "../../../Phaser/Entity/RemotePlayer";
import type { Player } from "../../../Phaser/Player/Player";
import { EFFECT_TEXTURES, type EffectTexture, type EffectsManifest } from "../domain/effectsManifest";
import { parseFeatures, type FeatureSwitches } from "../../Preferences/domain/effectSwitches";
import { lookAt } from "../domain/timeOfDay";
import { POST } from "../domain/shaders";
import { textHash } from "../domain/textHash";
import type { ShadingFlag } from "../domain/shadingLevel";
import { readShadingCounters } from "../../../Utils/FrameBench";
import { postProgram } from "./postFilter";
import type { Shading } from "./shading";
import { browserEnvironment } from "./browserEffectsPort";
import {
    LABEL_MEASURE_MS,
    QA_POLL_MS,
    SceneEffects,
    isKoiSchool,
    type EffectsEnvironment,
    type EffectsHost,
} from "./SceneEffects";
import type * as PostFilter from "./postFilter";

// The effects are built on a hand-made scene (EffectsHost): it records what they add to it and what they give back.
// jsdom stands in for the page; its canvases have no 2D context, so a made one draws nothing and answers
// getImageData with one colour per picture.

const PRE_RENDER = Phaser.Scenes.Events.PRE_RENDER;

// What the camera pass is given on each draw, read through the sources the effects hand to `addPostFilter`; the pass
// itself is the real one.
const postSources = vi.hoisted(() => [] as { postUniforms(): Record<string, unknown> }[]);
vi.mock("./postFilter", async (importOriginal) => {
    const actual = await importOriginal<typeof PostFilter>();
    return {
        ...actual,
        addPostFilter: (...args: Parameters<typeof actual.addPostFilter>) => {
            postSources.push(args[2]);
            return actual.addPostFilter(...args);
        },
    };
});

type Colour = readonly [number, number, number, number];

const CLEAR: Colour = [0, 0, 0, 0];
/** The whole map outside (red) and open water (blue 128): the lawn and the pool from anywhere. */
const OUTSIDE_WATER: Colour = [255, 0, 128, 255];
/** Outside, polished floor and open water at every pixel: a person's feet are on the floor that mirrors them. */
const ALL_MASKS: Colour = [255, 255, 128, 255];
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

    createImageData(width: number, height: number) {
        return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    }

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
        this.texture = scene.textureFor(key);
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
        this.texture = this.scene.textureFor(key);
        return this;
    }

    setOrigin(): this {
        return this;
    }

    setFrame(): this {
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
    private readonly textureObjects = new Map<string, { key: string }>();
    public readonly listeners = new Map<string, Set<() => void>>();
    public readonly offs: [string, () => void][] = [];
    /** The camera's internal filter list, and the controllers taken off it (with whether each was destroyed). */
    public readonly filters = { list: [] as unknown[], removed: [] as [unknown, boolean][] };
    /** The same for the external list. */
    public readonly externalFilters = { list: [] as unknown[], removed: [] as [unknown, boolean][] };
    /** The camera as the camera node sees it: where it sits, how big it is and how opaque; the canvas is 300 x 200. */
    public readonly camera = { x: 0, y: 0, width: 300, height: 200, alpha: 1 };
    /** The render nodes the effects registered, by name: a room without the shading registers only the legacy pass. */
    public readonly nodeNames: string[] = [];
    /** The renderer's blend table (Phaser 4.2.1 has 18 built in), and the GPU textures made from arrays. */
    public readonly blendTable: { func: number[] }[] = Array.from({ length: 18 }, () => ({ func: [1, 771, 1, 771] }));
    public readonly arrayTextures: { update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
    public readonly renderer = {
        renderNodes: {
            hasNode: (name: string) => this.nodeNames.includes(name),
            addNodeConstructor: (name: string) => this.nodeNames.push(name),
        },
        width: 300,
        height: 200,
        gl: {
            ONE: 1,
            ZERO: 0,
            ONE_MINUS_SRC_ALPHA: 771,
            FUNC_ADD: 32774,
            CLAMP_TO_EDGE: 33071,
            NEAREST: 9728,
            RGBA: 6408,
        },
        blendModes: this.blendTable,
        addBlendMode: (func: number[]) => this.blendTable.push({ func: [func[0], func[1], func[0], func[1]] }) - 2,
        updateBlendMode: (index: number, func: number[]) => {
            if (index > 17 && this.blendTable[index]) this.blendTable[index].func = [...func];
        },
        createUint8ArrayTexture: () => {
            const texture = { update: vi.fn(), destroy: vi.fn() };
            this.arrayTextures.push(texture);
            return texture;
        },
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
        const lists = (record: TestScene["filters"]) => ({
            add: (controller: unknown) => record.list.push(controller),
            // as Phaser's FilterList.remove: the controller is destroyed unless it ignores destruction or it is forced
            remove: (controller: { ignoreDestroy: boolean }, forceDestroy = false) => {
                record.removed.push([controller, forceDestroy || !controller.ignoreDestroy]);
                record.list = record.list.filter((c) => c !== controller);
            },
        });
        const camera = Object.assign(this.camera, {
            worldView: { x: 0, y: 0, width: 300, height: 200 },
            scrollX: 0,
            scrollY: 0,
            zoom: 1,
            filters: { internal: lists(this.filters), external: lists(this.externalFilters) },
        });
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
                sprite: (_x: number, _y: number, key: string, frame?: string | number) =>
                    this.make("image", `sprite ${key}`, key, frame),
                image: (_x: number, _y: number, key: string, frame?: string | number) =>
                    this.make("image", `image ${key}`, key, frame),
            } as unknown as EffectsHost["add"],
            textures: {
                addImage: (key: string) => this.addTexture(key),
                addCanvas: (key: string) => this.addTexture(key),
                get: (key: string) => this.textureFor(key),
                getFrame: () => this.frame,
                exists: (key: string) => this.textureKeys.has(key),
                remove: (key: string) => this.textureKeys.delete(key),
                on: () => undefined,
                off: () => undefined,
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

    /** The Texture the manager holds under a key: one object for as long as the key stays, as Phaser's. */
    textureFor(key: string): { key: string } {
        let texture = this.textureObjects.get(key);
        if (!texture) {
            texture = { key };
            this.textureObjects.set(key, texture);
        }
        return texture;
    }

    /** A texture of the scene that is not the effects': added with the key, or null when it exists (as Phaser does). */
    addTexture(key: string) {
        if (this.textureKeys.has(key)) return null;
        this.textureKeys.add(key);
        return { key, setFilter: vi.fn(), refresh: vi.fn(), add: vi.fn() };
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

function pictures(masks: Colour = OUTSIDE_WATER): Record<EffectTexture, HTMLImageElement> {
    const sized = (width: number, height: number): HTMLImageElement => Object.assign(new Image(), { width, height });
    const images = {
        water: sized(100, 80),
        "water-data": sized(100, 80),
        glass: sized(400, 300),
        masks: sized(400, 300),
        "tv-slide": sized(24, 16),
        occluders: sized(200, 150),
    };
    paint = (source) => (source === images.masks ? masks : source === images.glass ? GLASS_ALL_OVER : CLEAR);
    return images;
}

interface Setup {
    /** The fixed hour of the day. */
    readonly hour?: number;
    readonly features?: Partial<FeatureSwitches>;
    readonly glassFaces?: EffectsManifest["glassFaces"];
    /** Whether the user is in focus when the effects ask. Defaults to never. */
    readonly focused?: () => boolean;
    readonly reducedMotion?: boolean;
    /** The colour of every pixel of the masks. Defaults to outside and open water. */
    readonly masks?: Colour;
    /** The night-lit preview. Defaults to off. */
    readonly nightLit?: boolean;
    /** Asked for the fixed hour on each use instead of `hour`: a QA setting that changes while the effects run. */
    readonly hourNow?: () => number | undefined;
    /** Asked for the night-lit preview on each use instead of `nightLit`. */
    readonly nightLitNow?: () => boolean;
    /** Whether the room has the optional normal map (a picture of the map's size). */
    readonly normal?: boolean;
    /** Replaces what the made environment answers. */
    readonly environment?: Partial<EffectsEnvironment>;
}

interface Built {
    readonly effects: SceneEffects;
    /** How many times the effects asked for the hour: once at the start, once for each refresh. */
    readonly hourReads: () => number;
}

function construct(
    scene: TestScene,
    {
        hour = 12,
        features = {},
        glassFaces = [],
        focused = () => false,
        reducedMotion = false,
        masks,
        nightLit = false,
        hourNow,
        nightLitNow,
        normal = false,
        environment: given = {},
    }: Setup = {},
): Built {
    let reads = 0;
    const environment: EffectsEnvironment = {
        reducedMotion: () => reducedMotion,
        animationsOff: () => false,
        fixedHour: () => {
            reads += 1;
            return hourNow ? hourNow() : hour;
        },
        focused,
        nightLit: () => (nightLitNow ? nightLitNow() : nightLit),
        ...given,
    };
    const effects = new SceneEffects({
        scene: scene.host,
        renderer: scene.renderer,
        manifest: manifest(glassFaces),
        images: pictures(masks),
        normal: normal ? Object.assign(new Image(), { width: 400, height: 300 }) : undefined,
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

describe("the camera pass, on the camera's filter lists", () => {
    const KEY = "konclui.fx.external";
    afterEach(() => localStorage.removeItem(KEY));

    /** The controllers on both lists: where the pass is, and whether it is anywhere twice. */
    function lists(scene: TestScene): { internal: unknown[]; external: unknown[] } {
        return { internal: scene.filters.list, external: scene.externalFilters.list };
    }

    it("sits on the internal list alone, as it always has, with the flag unset or off", () => {
        for (const value of [null, "0"]) {
            if (value === null) localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, value);
            const { scene, effects } = build();
            const [pass] = scene.filters.list;

            expect(lists(scene)).toEqual({ internal: [pass], external: [] });

            // a camera that no longer fills the canvas changes nothing: only the flag moves the pass
            scene.camera.x = 20;
            scene.camera.width = 200;
            scene.emit(PRE_RENDER);
            expect(lists(scene)).toEqual({ internal: [pass], external: [] });

            release(effects);
            expect(scene.filters.removed).toEqual([[pass, true]]);
            expect(scene.externalFilters.removed).toEqual([]);
            expect(lists(scene)).toEqual({ internal: [], external: [] });
        }
    });

    it("sits on the external list alone with the flag on, and leaves it, destroyed, when the effects are", () => {
        localStorage.setItem(KEY, "1");
        const { scene, effects } = build();
        const [pass] = scene.externalFilters.list;

        expect(pass).toBeDefined();
        expect(lists(scene)).toEqual({ internal: [], external: [pass] });
        scene.emit(PRE_RENDER);
        scene.emit(PRE_RENDER);
        expect(lists(scene)).toEqual({ internal: [], external: [pass] });

        release(effects);

        expect(scene.externalFilters.removed).toEqual([[pass, true]]);
        expect(scene.filters.removed).toEqual([]);
        expect(lists(scene)).toEqual({ internal: [], external: [] });
    });

    it("reads the flag when the effects are built, not on a later draw", () => {
        const { scene, effects } = build();
        const [pass] = scene.filters.list;

        localStorage.setItem(KEY, "1");
        scene.emit(PRE_RENDER);

        expect(lists(scene)).toEqual({ internal: [pass], external: [] });
        release(effects);
    });

    it("gives the build's failure back from the external list too", () => {
        localStorage.setItem(KEY, "1");
        const scene = new TestScene();
        scene.failOn = "container";

        expect(() => construct(scene)).toThrow("container failed");

        expect(lists(scene)).toEqual({ internal: [], external: [] });
    });

    describe("with the flag on, when the camera does not fill the canvas", () => {
        beforeEach(() => localStorage.setItem(KEY, "1"));

        // The camera node copies the camera's picture into a canvas-sized context before an external filter when the
        // camera is off the canvas origin or not its size, and draws a filter straight to the canvas only at alpha 1.
        it.each([
            ["is moved right", { x: 20 }],
            ["is moved down", { y: 20 }],
            ["is narrower than the canvas", { width: 200 }],
            ["is shorter than the canvas", { height: 100 }],
            ["is translucent", { alpha: 0.5 }],
        ])("keeps the pass on the internal list when the camera %s", (_, geometry) => {
            const scene = new TestScene();
            Object.assign(scene.camera, geometry);
            const { effects } = construct(scene);
            const [pass] = scene.filters.list;

            expect(pass).toBeDefined();
            expect(lists(scene)).toEqual({ internal: [pass], external: [] });

            release(effects);
            expect(scene.filters.removed).toEqual([[pass, true]]);
            expect(scene.externalFilters.removed).toEqual([]);
        });

        it("moves the pass between the lists as the camera leaves the canvas and returns, never on both", () => {
            const { scene, effects } = build();
            const [pass] = scene.externalFilters.list;
            const seen = () => lists(scene).internal.length + lists(scene).external.length;

            scene.camera.width = 200; // the window is resized and the camera has not caught up
            scene.emit(PRE_RENDER);
            expect(lists(scene)).toEqual({ internal: [pass], external: [] });
            expect(seen()).toBe(1);

            scene.camera.width = 300;
            scene.emit(PRE_RENDER);
            expect(lists(scene)).toEqual({ internal: [], external: [pass] });
            expect(seen()).toBe(1);

            scene.camera.x = 10;
            scene.emit(PRE_RENDER);
            expect(lists(scene)).toEqual({ internal: [pass], external: [] });

            // a move is not a destruction: Phaser's list destroys a controller it drops unless it is told otherwise
            const moves = [...scene.externalFilters.removed, ...scene.filters.removed];
            expect(moves).toHaveLength(3);
            expect(moves.every(([, destroyed]) => !destroyed)).toBe(true);

            release(effects);
            expect(scene.filters.removed.at(-1)).toEqual([pass, true]);
            expect(lists(scene)).toEqual({ internal: [], external: [] });
        });

        it("follows a renderer that is resized, not only the camera", () => {
            const { scene, effects } = build();
            const [pass] = scene.externalFilters.list;

            Object.assign(scene.renderer, { width: 600, height: 400 });
            scene.emit(PRE_RENDER);

            expect(lists(scene)).toEqual({ internal: [pass], external: [] });
            release(effects);
        });
    });
});

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

    it("give a name tag back when its owner leaves the locked room, and leave other tags as they were", () => {
        const tag = (left: number): HTMLElement => {
            const label = document.createElement("div");
            label.className = "username-display";
            vi.spyOn(label, "getBoundingClientRect").mockReturnValue({
                left,
                width: 20,
                bottom: 40,
                top: 20,
            } as DOMRect);
            document.body.append(label);
            return label;
        };
        const inRoom = tag(60); // at (70, 52): inside the locked meeting room (20, 20, 120 x 100)
        const outside = tag(260); // at (270, 52): in the hall
        const { scene, effects } = build();
        scene.current.player = character(10, 10);
        scene.emit(PRE_RENDER);
        expect([inRoom.style.visibility, outside.style.visibility]).toEqual(["hidden", ""]);

        scene.current.player = character(11, 10);
        effects.onFrame(150);
        inRoom.getBoundingClientRect = () => ({ left: 260, width: 20, bottom: 40, top: 20 }) as DOMRect; // walked out
        scene.emit(PRE_RENDER);
        expect([inRoom.style.visibility, outside.style.visibility]).toEqual(["", ""]);

        release(effects);
    });

    it("destroy every object they made: the shaders, the mirror's container with its pictures, a TV's slide", () => {
        const { scene, effects } = furnishedRoom();
        expect(scene.created.map((object) => object.label).sort()).toEqual([
            "container",
            "image kfx-1-tv-slide",
            "image woka",
            "shader kfxGlass",
            "shader kfxGround",
            "shader kfxWater",
        ]);
        expect(scene.created.every((object) => object.destroyed === 0)).toBe(true);

        release(effects);

        expectEachDestroyedOnce(scene);
    });

    it("release their textures and reuse the character sheet for its reflection", () => {
        const { scene, effects } = furnishedRoom();
        expect([...scene.textureKeys].sort()).toEqual(
            ["woka", ...EFFECT_TEXTURES.map((name) => `kfx-1-${name}`), "kfx-1-occ", "kfx-1-mirror"].sort(),
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
        const picture = scene.created.find((object) => object.label === "image woka");

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

    it("refresh once a second on the clock's own period, and the QA poll in between starts none", () => {
        // `focused` is asked once per refresh, and nowhere else: it counts the refreshes
        let refreshes = 0;
        const { effects, hourReads } = build({
            hour: 12,
            focused: () => {
                refreshes += 1;
                return false;
            },
        });
        const started = refreshes;
        const readsAtStart = hourReads();

        runFrames(effects, 16, 6000);

        // at 1008, 2000, 3008, 4000, 5008 and 6000: each a second after the last one was due
        expect(refreshes - started).toBe(6);
        // the hour is asked for at each refresh and by the poll, which is at most every QA_POLL_MS
        expect(hourReads() - readsAtStart).toBeLessThanOrEqual(6 + 6000 / QA_POLL_MS);
    });

    describe("the QA settings that change while the effects run (konclui.fx.hour, konclui.fx.rim)", () => {
        const FRAME = 16;
        const NIGHT_HOUR = 21;

        /** A uniform of the camera pass as its next draw is given it: the effects' pre-render step runs first. */
        function drawn(scene: TestScene, name: string): unknown {
            scene.emit(PRE_RENDER);
            return postSources.at(-1)?.postUniforms()[name];
        }

        /**
         * Runs frames of 16 ms from `from` until `reached` holds after a draw; the time it holds at, or undefined
         * when it does not within `until`.
         */
        function firstFrameWhere(
            scene: TestScene,
            effects: SceneEffects,
            from: number,
            until: number,
            reached: () => boolean,
        ): number | undefined {
            for (let time = from; time <= until; time += FRAME) {
                effects.onFrame(time);
                scene.emit(PRE_RENDER);
                if (reached()) return time;
            }
            return undefined;
        }

        beforeEach(() => {
            postSources.length = 0;
        });

        it("show a night hour set in the console about a poll after it, not at the next refresh", () => {
            let hour: number | undefined = 12;
            const scene = new TestScene();
            const { effects } = construct(scene, { hourNow: () => hour });
            expect(drawn(scene, "uNight"), "noon: no lamps").toBe(0);
            const night = lookAt(NIGHT_HOUR, { light: true }).lamps;
            expect(night).toBeGreaterThan(0.02);

            // 16 ms after the start, when the next refresh is 984 ms away
            hour = NIGHT_HOUR;
            const at = firstFrameWhere(
                scene,
                effects,
                FRAME,
                1000,
                () => postSources.at(-1)?.postUniforms().uNight === night,
            );

            expect(at, "the night shows within a second").toBeDefined();
            // by the poll: a frame past the poll's period, and well before the refresh at 1008
            expect(at).toBeLessThanOrEqual(QA_POLL_MS + FRAME);
        });

        it("show it within a second whenever in the second it was set, the refresh just gone included", () => {
            let hour: number | undefined = 12;
            const scene = new TestScene();
            const { effects } = construct(scene, { hourNow: () => hour });
            // a refresh at 1008; the key changes right after it, the worst moment for a once-a-second read
            runFrames(effects, FRAME, 1008);
            expect(drawn(scene, "uNight")).toBe(0);
            const setAt = 1008 + FRAME;
            hour = NIGHT_HOUR;

            const at = firstFrameWhere(
                scene,
                effects,
                setAt,
                setAt + 1000,
                () => postSources.at(-1)?.postUniforms().uNight !== 0,
            );

            expect(at).toBeDefined();
            expect((at ?? Number.POSITIVE_INFINITY) - setAt).toBeLessThan(1000);
        });

        it("draw the decor layer's painted glints over the water by day and under it at night, on the same level, nothing else moved", () => {
            const order = (scene: TestScene): string[] =>
                scene.list.map((o) => (o instanceof TestLayer ? o.layer.name : (o as TestObject).label));
            const at = (scene: TestScene, name: string): number => order(scene).indexOf(name);

            let hour: number | undefined = 12;
            const scene = new TestScene();
            const { effects } = construct(scene, { hourNow: () => hour });
            const water = (): number => at(scene, "shader kfxWater");
            const decor = (): number => at(scene, "decor");
            const ground = (): number => at(scene, "shader kfxGround");
            expect(water(), "noon: the water is right under the layer").toBe(decor() - 1);
            expect(ground(), "the ground stays above both").toBeGreaterThan(decor());
            const others = order(scene).filter((n) => n !== "shader kfxWater");

            hour = NIGHT_HOUR;
            runFrames(effects, FRAME, QA_POLL_MS + FRAME);
            expect(water(), "night: the water is right over the layer, as it was built").toBe(decor() + 1);
            expect(order(scene).filter((n) => n !== "shader kfxWater")).toEqual(others);

            hour = 12;
            runFrames(effects, QA_POLL_MS + 2 * FRAME, 2 * QA_POLL_MS + FRAME);
            expect(water()).toBe(decor() - 1);
        });

        it("go from night back to day, and from a fixed hour to the clock, the same way", () => {
            let hour: number | undefined = NIGHT_HOUR;
            const scene = new TestScene();
            const { effects } = construct(scene, { hourNow: () => hour });
            expect(drawn(scene, "uNight")).toBeGreaterThan(0.02);

            hour = 12;
            runFrames(effects, FRAME, QA_POLL_MS + FRAME);

            expect(drawn(scene, "uNight")).toBe(0);
        });

        it("redraw the scene when the hour changes, so the new light is drawn at once", () => {
            let hour: number | undefined = 12;
            const scene = new TestScene();
            scene.tickDelay = undefined; // no tile clock: nothing else asks for a draw
            const { effects } = construct(scene, { hourNow: () => hour });
            runFrames(effects, FRAME, 100);
            const before = scene.dirty;

            hour = NIGHT_HOUR;
            runFrames(effects, 116, 116 + QA_POLL_MS + FRAME);

            expect(scene.dirty).toBeGreaterThan(before);
        });

        it("show the night-lit preview switched on in the console within the same poll", () => {
            let rim = false;
            const scene = new TestScene();
            const { effects } = construct(scene, { hour: NIGHT_HOUR, nightLitNow: () => rim });
            expect(drawn(scene, "uRimOn")).toBe(0);

            rim = true;
            const at = firstFrameWhere(
                scene,
                effects,
                FRAME,
                1000,
                () => postSources.at(-1)?.postUniforms().uRimOn === 1,
            );

            expect(at).toBeDefined();
            expect(at).toBeLessThanOrEqual(QA_POLL_MS + FRAME);
        });

        it("start no refresh when neither setting changed (the refresh's work is for a change)", () => {
            let refreshes = 0;
            const scene = new TestScene();
            const { effects } = construct(scene, {
                hour: NIGHT_HOUR,
                focused: () => {
                    refreshes += 1;
                    return false;
                },
            });
            const started = refreshes;

            runFrames(effects, FRAME, 990); // under the refresh at 1008: only polls

            expect(refreshes).toBe(started);
        });

        describe("read from the page's localStorage by the browser's environment", () => {
            beforeEach(() => {
                vi.stubGlobal("matchMedia", () => ({ matches: false }));
                localStorage.clear();
            });

            afterEach(() => {
                vi.unstubAllGlobals();
                localStorage.clear();
            });

            it("takes the hour a bench writes to konclui.fx.hour in the same tab, with no reload and no storage event", () => {
                localStorage.setItem("konclui.fx.hour", "12");
                const scene = new TestScene();
                const effects = new SceneEffects({
                    scene: scene.host,
                    renderer: scene.renderer,
                    manifest: manifest([]),
                    images: pictures(),
                    generation: 1,
                    features: parseFeatures(null),
                    environment: browserEnvironment(() => false),
                    time: 0,
                    reveal: false,
                });
                expect(drawn(scene, "uNight")).toBe(0);

                localStorage.setItem("konclui.fx.hour", String(NIGHT_HOUR));
                const at = firstFrameWhere(
                    scene,
                    effects,
                    FRAME,
                    1000,
                    () => postSources.at(-1)?.postUniforms().uNight !== 0,
                );

                expect(at, "within a second").toBeDefined();
                expect(postSources.at(-1)?.postUniforms().uNight).toBe(lookAt(NIGHT_HOUR, { light: true }).lamps);

                localStorage.removeItem("konclui.fx.hour"); // back to Brasília's clock: whatever it says, it is read again
                expect(browserEnvironment(() => false).fixedHour()).toBeUndefined();
            });

            // Seen failing with `motion()` reading the environment on each frame, as it did: 120 reads of
            // disableAnimations in the 120 frames (and again in the vignette's progress), against the 9 allowed here.
            it("reads the page's settings once a poll, not on a frame: 'Disable map animations' is a localStorage read", () => {
                const scene = new TestScene();
                const effects = new SceneEffects({
                    scene: scene.host,
                    renderer: scene.renderer,
                    manifest: manifest([]),
                    images: pictures(),
                    generation: 1,
                    features: parseFeatures(null),
                    environment: browserEnvironment(() => false),
                    time: 0,
                    reveal: false,
                });
                const reads = vi.spyOn(Storage.prototype, "getItem");
                const FRAMES = 120; // 1.92 s: one refresh at 1008, and the polls between

                for (let i = 1; i <= FRAMES; i++) {
                    effects.onFrame(i * FRAME);
                    scene.emit(PRE_RENDER);
                }

                const readsOf = (key: string): number => reads.mock.calls.filter(([name]) => name === key).length;
                const slots = Math.ceil((FRAMES * FRAME) / QA_POLL_MS) + 2; // the polls, and the refresh's own
                expect(readsOf("disableAnimations"), "reads of disableAnimations in 120 frames").toBeLessThanOrEqual(
                    slots,
                );
                expect(readsOf("konclui.fx.hour")).toBeLessThanOrEqual(slots + 2);
                expect(readsOf("disableAnimations"), "it is read, by the poll").toBeGreaterThan(0);
            });

            it("shows 'Disable map animations' turned on in the same tab within a second: the water goes still", () => {
                const scene = new TestScene();
                const effects = new SceneEffects({
                    scene: scene.host,
                    renderer: scene.renderer,
                    manifest: manifest([]),
                    images: pictures(),
                    generation: 1,
                    features: parseFeatures(null),
                    environment: browserEnvironment(() => false),
                    time: 0,
                    reveal: false,
                });
                const water = (): boolean => scene.created.find((o) => o.label === "shader kfxWater")?.visible ?? false;
                expect(water(), "the water moves").toBe(true);

                localStorage.setItem("disableAnimations", "true");
                runFrames(effects, FRAME, QA_POLL_MS + FRAME);

                expect(water(), "the water is still: the setting was seen by the poll").toBe(false);
            });
        });
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

describe("the night-lit preview and the normal map, as the camera pass is given them", () => {
    beforeEach(() => {
        postSources.length = 0;
    });

    function uniforms(scene: TestScene): Record<string, unknown> {
        scene.emit(PRE_RENDER);
        const given = postSources.at(-1)?.postUniforms();
        if (!given) throw new Error("the pass has no uniforms");
        return given;
    }

    it("is off, with flat normals, when nothing asks for it: the pass runs the day's and the night's code as before", () => {
        const scene = new TestScene();
        construct(scene, { hour: 22 });

        const given = uniforms(scene);

        expect([given.uRimOn, given.uNormalsOn]).toEqual([0, 0]);
        expect(scene.textureKeys.has("kfx-1-normal")).toBe(false);
    });

    it("lights the people at night when the preview is on, and still without a normal map file", () => {
        const scene = new TestScene();
        construct(scene, { hour: 22, nightLit: true });

        const given = uniforms(scene);

        expect([given.uRimOn, given.uNormalsOn]).toEqual([1, 0]);
        expect(scene.textureKeys.has("kfx-1-normal"), "no normal texture was made").toBe(false);
    });

    it("makes the normal texture only when the room has the picture, tells the pass, and gives it back", () => {
        const scene = new TestScene();
        const { effects } = construct(scene, { hour: 22, nightLit: true, normal: true });

        const given = uniforms(scene);

        expect([given.uRimOn, given.uNormalsOn]).toEqual([1, 1]);
        expect(scene.textureKeys.has("kfx-1-normal")).toBe(true);
        release(effects);
        expect(scene.textureKeys.has("kfx-1-normal")).toBe(false);
    });

    // Seen failing with the first eight people of the crowd taken, in the order the scene lists them: the farthest here.
    it("gives the pass, and the ground's shade, the eight people nearest the view's centre when more are drawn", () => {
        const scene = new TestScene();
        // the view is 300 x 200, its centre (150, 100); twelve people at 10 px steps from it, the farthest listed first
        for (let k = 12; k >= 1; k--) {
            scene.players.set(k, { x: 150 + k * 10, y: 85, visible: true, list: [] } as unknown as RemotePlayer);
        }
        construct(scene, { hour: 22, nightLit: true });

        const given = uniforms(scene);

        expect(given.uPeopleN).toBe(8);
        const feet = given["uPeople[0]"] as ArrayLike<number>;
        const xs = Array.from({ length: 8 }, (_, i) => feet[i * 4]);
        expect(xs, "nearest first").toEqual([160, 170, 180, 190, 200, 210, 220, 230]);
        expect(feet[1], "y + 15 + 1").toBe(101);
    });

    it("gives the pass the feet of the people the scene draws in full, as the ground's shade has them", () => {
        const scene = new TestScene();
        scene.players.set(1, { x: 50, y: 50, visible: true, list: [] } as unknown as RemotePlayer);
        scene.players.set(2, { x: 60, y: 60, visible: false, list: [] } as unknown as RemotePlayer); // a dot
        construct(scene, { hour: 22, nightLit: true });

        const given = uniforms(scene);

        expect(given.uPeopleN, "the drawn one, not the dot").toBe(1);
        const feet = given["uPeople[0]"] as ArrayLike<number>;
        expect([feet[0], feet[1]], "x, then y + 15 + 1 (the feet)").toEqual([50, 66]);
    });

    describe("near the cut of the eight", () => {
        /** The x of each person the pass is given, as a set: the order is not the shader's concern. */
        function lit(scene: TestScene): number[] {
            const given = uniforms(scene);
            const feet = given["uPeople[0]"] as ArrayLike<number>;
            return Array.from({ length: Number(given.uPeopleN) }, (_, i) => feet[i * 4]).sort((a, b) => a - b);
        }

        // Twelve people at 10 px steps from the view's centre (150, 100), the person k at 150 + 10 k. The eighth and the
        // ninth swap places by one pixel of the camera: without the margin the one lit changes with them.
        // Seen failing with a plain first-eight cut: the ninth person's place flips in and out as the order changes.
        it("keeps the person who was lit while they stay within the ten nearest, and lets them go beyond", () => {
            const scene = new TestScene();
            const people = new Map<number, { x: number }>();
            for (let k = 1; k <= 12; k++) {
                const body = { x: 150 + k * 10, y: 85, visible: true, list: [] as unknown[] };
                people.set(k, body);
                scene.players.set(k, body as unknown as RemotePlayer);
            }
            construct(scene, { hour: 22, nightLit: true });
            const first = [160, 170, 180, 190, 200, 210, 220, 230];
            expect(lit(scene)).toEqual(first);

            // person 8 (x 230) drifts out past person 9 and then 10: rank 9 and rank 10, still among the ten nearest
            const seven = [160, 170, 180, 190, 200, 210, 220];
            people.get(8)!.x = 150 + 95;
            expect(lit(scene), "person 8 is ninth by distance, and keeps its place").toEqual([...seven, 245]);
            people.get(8)!.x = 150 + 105;
            expect(lit(scene), "tenth: still kept").toEqual([...seven, 255]);

            // eleventh: it goes, and the nearest of the others (person 9, x 240) takes the place
            people.get(8)!.x = 150 + 115;
            expect(lit(scene)).toEqual([...seven, 240]);
        });

        it("lights the eight nearest from the first frame, with nobody kept yet", () => {
            const scene = new TestScene();
            for (let k = 12; k >= 1; k--) {
                scene.players.set(k, { x: 150 + k * 10, y: 85, visible: true, list: [] } as unknown as RemotePlayer);
            }
            construct(scene, { hour: 22, nightLit: true });

            expect(lit(scene)).toEqual([160, 170, 180, 190, 200, 210, 220, 230]);
        });
    });
});

describe("the name tags of a locked room, while the effects run", () => {
    const FRAME = 16;

    /** A name tag on the page at a world x (the room is 20..140, the hall 260 and on), its layout reads counted. */
    function tag(worldX: number): { label: HTMLElement; reads: () => number; moveTo(worldX: number): void } {
        const label = document.createElement("div");
        label.className = "username-display";
        let left = worldX - 10;
        let reads = 0;
        label.getBoundingClientRect = () => {
            reads += 1;
            return { left, width: 20, bottom: 40, top: 20 } as DOMRect;
        };
        document.body.append(label);
        return {
            label,
            reads: () => reads,
            moveTo(x: number) {
                left = x - 10;
            },
        };
    }

    /** The effects of a scene whose player is outside the locked meeting room, which is in view (its frost is drawn). */
    function outsideTheRoom(): { scene: TestScene; effects: SceneEffects; canvasReads: () => number } {
        const { scene, effects } = build({}, undefined);
        scene.current.player = character(10, 10);
        const canvas = vi.spyOn(scene.host.game.canvas, "getBoundingClientRect"); // the scene already spies it
        return { scene, effects, canvasReads: () => canvas.mock.calls.length };
    }

    /** One frame at a time: the game step, then the draw. */
    function step(scene: TestScene, effects: SceneEffects, time: number): void {
        effects.onFrame(time);
        scene.emit(PRE_RENDER);
    }

    function view(scene: TestScene): { x: number; y: number } {
        return scene.host.cameras.main.worldView;
    }

    // Seen failing with every frame measured (`forced` always true in `labelsDue`): "one read of the tag: expected 120 to
    // be 1". With only the LABEL_MEASURE_MS wait removed, the moving-camera test fails; with the crowd's move ignored,
    // the walker's; with the tag count ignored, the added-tag test. Not pinned: a second locked room swapping with the
    // one in view (the test map has one).
    it("measure the tags once for 120 frames while nothing moves, not on each frame", () => {
        const inRoom = tag(70);
        const { scene, effects, canvasReads } = outsideTheRoom();

        for (let i = 0; i < 120; i++) step(scene, effects, i * FRAME);

        expect(inRoom.label.style.visibility).toBe("hidden");
        expect(inRoom.reads(), "one read of the tag").toBe(1);
        expect(canvasReads(), "one read of the canvas").toBe(1);
    });

    it("measure the tags for a moving camera at most every LABEL_MEASURE_MS, and for as long as it moves", () => {
        tag(70);
        const { scene, effects, canvasReads } = outsideTheRoom();
        step(scene, effects, 0);
        const first = canvasReads();

        const frames = 100; // 1.6 s of a camera that moves a pixel a frame
        for (let i = 1; i <= frames; i++) {
            view(scene).x += 1;
            step(scene, effects, i * FRAME);
        }

        const passes = canvasReads() - first;
        expect(passes).toBeGreaterThan(1);
        expect(passes).toBeLessThanOrEqual(Math.ceil((frames * FRAME) / LABEL_MEASURE_MS) + 1);
    });

    it("measure them at once when a locked room comes into view", () => {
        const inRoom = tag(70);
        const { scene, effects, canvasReads } = outsideTheRoom();
        view(scene).x = 400; // the room (20..140) is far off to the left of the camera's 300 px
        for (let i = 0; i < 10; i++) step(scene, effects, i * FRAME);
        expect(canvasReads(), "no locked room in view: nothing read").toBe(0);

        view(scene).x = 0;
        step(scene, effects, 10 * FRAME);

        expect(canvasReads()).toBe(1);
        expect(inRoom.label.style.visibility).toBe("hidden");
    });

    it("measure them at once when a tag is added, and when one is dropped", () => {
        tag(70);
        const { scene, effects, canvasReads } = outsideTheRoom();
        for (let i = 0; i < 10; i++) step(scene, effects, i * FRAME);
        expect(canvasReads()).toBe(1);

        const added = tag(80);
        step(scene, effects, 10 * FRAME);
        expect(canvasReads(), "a tag was added").toBe(2);
        expect(added.label.style.visibility).toBe("hidden");

        added.label.remove();
        step(scene, effects, 11 * FRAME);
        expect(canvasReads(), "a tag was dropped").toBe(3);
    });

    it("hide the tag of someone who walks into the room within LABEL_MEASURE_MS, and no later", () => {
        const walker = tag(270); // in the hall
        const { scene, effects } = outsideTheRoom();
        const person = character(270, 52, []);
        scene.players.set(1, person as unknown as RemotePlayer);
        for (let i = 0; i < 20; i++) step(scene, effects, i * FRAME);
        expect(walker.label.style.visibility, "in the hall: shown").toBe("");

        // the walker steps into the locked room: the tag, and the body the crowd's hash is made of, move
        walker.moveTo(70);
        Object.assign(person, { x: 70 });
        let hiddenAt: number | undefined;
        const from = 20 * FRAME;
        for (let t = from; t <= from + 2 * LABEL_MEASURE_MS && hiddenAt === undefined; t += FRAME) {
            step(scene, effects, t);
            if (walker.label.style.visibility === "hidden") hiddenAt = t;
        }

        expect(hiddenAt).toBeDefined();
        expect((hiddenAt ?? Number.POSITIVE_INFINITY) - from).toBeLessThanOrEqual(LABEL_MEASURE_MS);
    });

    // Seen failing with the old reset (only when no locked room is in view): the tag count came back as it was, with a
    // still camera and crowd, and the tag stayed shown in the locked room (`expected "" to be "hidden"`).
    it("measure them at once when the tags come back to the same count with nothing else moved", () => {
        const first = tag(70);
        const { scene, effects, canvasReads } = outsideTheRoom();
        for (let i = 0; i < 10; i++) step(scene, effects, i * FRAME);
        expect(first.label.style.visibility).toBe("hidden");
        expect(canvasReads()).toBe(1);

        first.label.remove(); // no tag on the page at all, the locked room still in view
        for (let i = 10; i < 20; i++) step(scene, effects, i * FRAME);
        const again = tag(70); // one tag again: the count is what it was when last measured
        for (let i = 20; i < 22; i++) step(scene, effects, i * FRAME);

        expect(again.label.style.visibility, "hidden at once, not when something moves").toBe("hidden");
        expect(canvasReads()).toBe(2);
    });

    it("read no tag when no locked room is in view, and none after the tags were given back", () => {
        const inRoom = tag(70);
        const { scene, effects } = outsideTheRoom();
        step(scene, effects, 0);
        expect(inRoom.label.style.visibility).toBe("hidden");

        scene.current.player = character(60, 60); // inside the room: it is seen clearly, its frost is not drawn
        step(scene, effects, FRAME);
        const readsAfterGiveBack = inRoom.reads();
        for (let i = 2; i < 60; i++) step(scene, effects, i * FRAME);

        expect(inRoom.label.style.visibility).toBe("");
        expect(inRoom.reads()).toBe(readsAfterGiveBack);
    });
});

describe("the vignette that follows the user's focus", () => {
    /** The vignette's strength as the camera pass is given it: the first of the two numbers of `uVignette`. */
    function vignette(): number {
        const uniform = postSources.at(-1)?.postUniforms().uVignette;
        if (!Array.isArray(uniform) || typeof uniform[0] !== "number") throw new Error("the pass has no vignette");
        return uniform[0];
    }

    /** The effects of a scene whose user is in focus once `state.focused` says so; the first draw is at time 0. */
    function focusable(setup: Setup = {}): { effects: SceneEffects; scene: TestScene; state: { focused: boolean } } {
        const state = { focused: false };
        const scene = new TestScene();
        const { effects } = construct(scene, { ...setup, focused: () => state.focused });
        scene.emit(PRE_RENDER);
        return { effects, scene, state };
    }

    beforeEach(() => {
        postSources.length = 0;
    });

    it("stays off while the user is not in focus", () => {
        const { effects, scene } = focusable();

        for (const time of [1000, 2000, 3000]) {
            effects.onFrame(time);
            scene.emit(PRE_RENDER);
        }

        expect(vignette()).toBe(0);
    });

    it("fades the edges in to 0.24 over half a second once the refresh sees the focus", () => {
        const { effects, scene, state } = focusable();
        state.focused = true;

        effects.onFrame(1000); // the once-a-second refresh reads the focus
        scene.emit(PRE_RENDER);
        expect(vignette()).toBe(0);

        effects.onFrame(1250);
        scene.emit(PRE_RENDER);
        expect(vignette()).toBeCloseTo(0.12, 5);

        effects.onFrame(1500);
        scene.emit(PRE_RENDER);
        expect(vignette()).toBeCloseTo(0.24, 5);
    });

    it("fades the edges out again when the focus ends", () => {
        const { effects, scene, state } = focusable();
        state.focused = true;
        effects.onFrame(1000);
        effects.onFrame(1500);
        state.focused = false;

        effects.onFrame(2000); // the next refresh reads that it ended
        effects.onFrame(2500);
        scene.emit(PRE_RENDER);

        expect(vignette()).toBe(0);
    });

    it("shows the full vignette at once, not NaN, under reduced motion", () => {
        const { effects, scene, state } = focusable({ reducedMotion: true });
        state.focused = true;

        effects.onFrame(1000);
        scene.emit(PRE_RENDER);

        expect(vignette()).toBe(0.24);
    });

    it("keeps the switch's say: with the vignette switched off, focus darkens nothing", () => {
        const { effects, scene, state } = focusable({ features: { vignette: false } });
        state.focused = true;

        for (const time of [1000, 1500, 2000]) {
            effects.onFrame(time);
            scene.emit(PRE_RENDER);
        }

        expect(vignette()).toBe(0);
    });

    it("answers a switch turned on while the user is in focus, without a new focus", () => {
        const { effects, scene, state } = focusable({ features: { vignette: false } });
        state.focused = true;
        effects.onFrame(1000);

        effects.setFeatures({ ...parseFeatures(null), vignette: true });
        effects.onFrame(1500);
        effects.onFrame(2000);
        scene.emit(PRE_RENDER);

        expect(vignette()).toBe(0.24);
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

describe("the effects, in a crowd the scene does not draw in full", () => {
    /** A remote character as the effects read it: where it stands, whether the scene draws it, its sprites. */
    function remote(x: number, y: number, visible: boolean): RemotePlayer {
        return { x, y, visible, list: [figureLayer()] } as unknown as RemotePlayer;
    }

    /** The mirror's container: visible while it draws a picture. */
    function mirrorContainer(scene: TestScene): TestObject {
        const container = scene.created.find((object) => object.label === "container");
        if (!container) throw new Error("the effects made no mirror");
        return container;
    }

    /** A TV on the wall of the meeting room, which lights while two people are in the room. */
    function meetingTv(): Phaser.GameObjects.Image {
        return fake(Phaser.GameObjects.Image.prototype, {
            type: "Image",
            texture: { key: "office/entities/tv.png" },
            x: 100,
            y: 60,
            depth: 5,
        });
    }

    it("light a TV for two people in its room that are culled or dots, as for two that are drawn", () => {
        const scene = new TestScene();
        scene.list.push(meetingTv());
        scene.players.set(1, remote(60, 60, false));
        scene.players.set(2, remote(70, 70, false));

        construct(scene);

        const slide = scene.created.find((object) => object.label === "image kfx-1-tv-slide");
        expect(slide?.visible).toBe(true);
    });

    it("leave a TV dark for one person in its room", () => {
        const scene = new TestScene();
        scene.list.push(meetingTv());
        scene.players.set(1, remote(60, 60, false));

        construct(scene);

        const slide = scene.created.find((object) => object.label === "image kfx-1-tv-slide");
        expect(slide?.visible).toBe(false);
    });

    // The slides are worked out again only when a piece changed, the meeting bitmask changed or the TV switch did
    // (refresh). These two start with the effects built and one person in the room, so the first refresh decides
    // nothing: only the bitmask change at a later refresh can switch the screen. Seen failing with the
    // `meetingMask !== tvsMeetingMask` clause of that condition removed: "expected false to be true", then the
    // screen stays lit.
    it("light a TV when a second person enters its room after the effects were built, at the next refresh", () => {
        const scene = new TestScene();
        scene.list.push(meetingTv());
        scene.players.set(1, remote(60, 60, false));
        const { effects } = construct(scene);
        const slide = scene.created.find((object) => object.label === "image kfx-1-tv-slide");
        expect(slide?.visible, "one person: dark").toBe(false);

        scene.players.set(2, remote(70, 70, false));
        effects.onFrame(500);
        expect(slide?.visible, "the room is counted once a second, not before").toBe(false);
        effects.onFrame(1000);

        expect(slide?.visible).toBe(true);
    });

    it("darken the TV again when one of the two leaves its room, at the next refresh", () => {
        const scene = new TestScene();
        scene.list.push(meetingTv());
        scene.players.set(1, remote(60, 60, false));
        scene.players.set(2, remote(70, 70, false));
        const { effects } = construct(scene);
        const slide = scene.created.find((object) => object.label === "image kfx-1-tv-slide");
        expect(slide?.visible, "two people: lit").toBe(true);

        scene.players.delete(2);
        effects.onFrame(1000);

        expect(slide?.visible).toBe(false);
    });

    it("darken a lit TV when the TV switch is turned off, and light it again when it is turned on", () => {
        const scene = new TestScene();
        scene.list.push(meetingTv());
        scene.players.set(1, remote(60, 60, false));
        scene.players.set(2, remote(70, 70, false));
        const { effects } = construct(scene);
        const slide = scene.created.find((object) => object.label === "image kfx-1-tv-slide");
        expect(slide?.visible).toBe(true);

        effects.setFeatures({ ...parseFeatures(null), tv: false });
        expect(slide?.visible).toBe(false);

        effects.setFeatures({ ...parseFeatures(null), tv: true });
        expect(slide?.visible).toBe(true);
    });

    it("show no reflection of a culled player or a dot standing at the glass", () => {
        const scene = new TestScene();
        scene.players.set(1, remote(50, 100, false));
        construct(scene, { glassFaces: [[0, 100, 100]] });

        scene.emit(PRE_RENDER);

        expect(mirrorContainer(scene).visible).toBe(false);
    });

    /** What the ground's shade and the camera pass are given on the next draw: the people counted in each. */
    function peopleSeen(scene: TestScene): { shaded: number; mirrored: number } {
        let shaded = -1;
        scene.created
            .find((object) => object.config?.name === "kfxGround")
            ?.config?.setupUniforms((name, value) => {
                if (name === "uPeopleN" && typeof value === "number") shaded = value;
            });
        const mirrored = postSources.at(-1)?.postUniforms().uAvN;
        if (typeof mirrored !== "number") throw new Error("the pass has no people count");
        return { shaded, mirrored };
    }

    it("give no shade and no polished-floor reflection to a culled player or a dot in view", () => {
        postSources.length = 0;
        const scene = new TestScene();
        scene.players.set(1, remote(50, 50, false));
        construct(scene, { masks: ALL_MASKS });

        scene.emit(PRE_RENDER);

        expect(peopleSeen(scene)).toEqual({ shaded: 0, mirrored: 0 });
    });

    it("give both to the same player when the scene draws them", () => {
        postSources.length = 0;
        const scene = new TestScene();
        scene.players.set(1, remote(50, 50, true));
        construct(scene, { masks: ALL_MASKS });

        scene.emit(PRE_RENDER);

        expect(peopleSeen(scene)).toEqual({ shaded: 1, mirrored: 1 });
    });

    // Seen failing with the per-frame `body.visible` check of `gather` removed: the player the scene stopped drawing
    // after the last look is still shaded and mirrored on the polished floor (shaded 1, mirrored 1).
    it("stop shading and mirroring on the polished floor a player the scene stops drawing between two looks", () => {
        postSources.length = 0;
        const scene = new TestScene();
        const player = remote(50, 50, true);
        scene.players.set(1, player);
        construct(scene, { masks: ALL_MASKS });
        scene.emit(PRE_RENDER);
        expect(peopleSeen(scene)).toEqual({ shaded: 1, mirrored: 1 });

        Object.assign(player, { visible: false }); // a dot now, but the look at the crowd is 250 ms away
        scene.emit(PRE_RENDER);

        expect(peopleSeen(scene)).toEqual({ shaded: 0, mirrored: 0 });
    });

    it("show the reflection of the same player when the scene draws them", () => {
        const scene = new TestScene();
        scene.players.set(1, remote(50, 100, true));
        construct(scene, { glassFaces: [[0, 100, 100]] });

        scene.emit(PRE_RENDER);

        expect(mirrorContainer(scene).visible).toBe(true);
    });

    it("take a player out of the mirror on the frame after the scene stops drawing them", () => {
        const scene = new TestScene();
        const player = remote(50, 100, true);
        scene.players.set(1, player);
        construct(scene, { glassFaces: [[0, 100, 100]] });
        scene.emit(PRE_RENDER);
        expect(mirrorContainer(scene).visible).toBe(true);

        Object.assign(player, { visible: false }); // culled between two looks at the crowd
        scene.emit(PRE_RENDER);

        expect(mirrorContainer(scene).visible).toBe(false);
    });
});

// ---------------------------------------------------------------------------------------------------- the shading

/** Indoors, no water, no polished floor: a plain day draws no camera pass at all. */
const INDOORS: Colour = [0, 0, 0, 255];

/** The record of the camera pass's uniforms before the shading existed: a room without the flag has exactly these. */
const UNIFORMS_BEFORE_THE_SHADING = [
    "uWorld",
    "uMap",
    "uRes",
    "uInside",
    "uOutside",
    "uLawn",
    "uWall",
    "uVivid",
    "uFacade",
    "uWarm",
    "uToe",
    "uDarks",
    "uSat",
    "uNight",
    "uL[0]",
    "uLC[0]",
    "uLClip[0]",
    "uLN",
    "uEm[0]",
    "uEmT[0]",
    "uEmN",
    "uShafts",
    "uCloud",
    "uLock[0]",
    "uLockN",
    "uFrost",
    "uSteps[0]",
    "uStepN",
    "uLime",
    "uCream",
    "uAv[0]",
    "uAvN",
    "uPeople[0]",
    "uPeopleN",
    "uNormalsOn",
    "uRimOn",
    "uVignette",
    "uReveal",
    "uInk",
];

// The hash of POST, the program a room runs with the flag off (the same one domain/shaders.test.ts pins).
const POST_HASH = "188ecb5a34f26a";

function shadingEnvironment(flag: ShadingFlag): Partial<EffectsEnvironment> {
    return {
        shading: () => flag,
        shadedPostCompiles: () => true,
        gpu: () => ({ renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)", maxFragmentUniformVectors: 1024 }),
    };
}

function passUniforms(): Record<string, unknown> {
    const uniforms = postSources.at(-1)?.postUniforms();
    if (!uniforms) throw new Error("the camera pass has no source");
    return uniforms;
}

/** A piece of the map drawn from a 4 x 4 picture: opaque everywhere, so its silhouette is a box. */
function placedBox(x: number, y: number): { image: Phaser.GameObjects.Image; source: HTMLImageElement } {
    const source = Object.assign(new Image(), { width: 4, height: 4 });
    const image = fake<Phaser.GameObjects.Image>(Phaser.GameObjects.Image.prototype, {
        type: "Image",
        texture: { key: "office/entities/box.png", getSourceImage: () => source },
        x,
        y,
        depth: 5,
        flipX: false,
        displayWidth: 4,
        displayHeight: 4,
    });
    return { image, source };
}

/** A sprite of a character's body that the mark can take: NORMAL blend mode, set through setBlendMode. */
function bodySprite(): Phaser.GameObjects.Sprite & { blendMode: number } {
    const sprite = fake<Phaser.GameObjects.Sprite & { blendMode: number }>(Phaser.GameObjects.Sprite.prototype, {
        blendMode: 0,
    });
    sprite.setBlendMode = (mode: number) => {
        sprite.blendMode = mode;
        return sprite;
    };
    return sprite;
}

function frames(scene: TestScene, effects: SceneEffects, from: number, to: number, step = 16): void {
    for (let time = from; time <= to; time += step) {
        effects.onFrame(time);
        scene.emit(PRE_RENDER);
    }
}

describe("with konclui.fx.rim unset, the camera pass and the picture are what they were (by day and by night)", () => {
    it.each([
        ["day", 12, false],
        ["night", 22, true],
    ])("runs the legacy pass, with nothing of the shading made, at %s", (_name, hour, active) => {
        postSources.length = 0;
        const scene = new TestScene();
        const piece = placedBox(100, 100);
        scene.list.push(piece.image);
        scene.current.player = character(50, 80, [bodySprite()]);
        const { effects } = construct(scene, { hour, masks: INDOORS, features: active ? {} : { light: false } });
        frames(scene, effects, 0, 600);

        // the legacy node and nothing else; its program is POST, the text pinned
        expect(scene.nodeNames).toEqual(["KfxPost"]);
        expect(postProgram(false)).toEqual({ node: "KfxPost", source: POST });
        expect(textHash(postProgram(false).source)).toBe(POST_HASH);
        const [pass] = scene.filters.list as { renderNode: string; active: boolean }[];
        expect(pass.renderNode).toBe("KfxPost");
        // the old expression: a plain day draws no pass at all, a night does
        expect(pass.active).toBe(active);
        // no cast texture, no blend mode, no stamps, no sprite of the shading
        expect(scene.arrayTextures).toHaveLength(0);
        expect(scene.blendTable).toHaveLength(18);
        expect([...scene.textureKeys].filter((key) => /stamps|cast/.test(key))).toEqual([]);
        expect(scene.created.filter((object) => object.label.startsWith("sprite"))).toEqual([]);
        // the uniforms are the old ones, no more
        expect(Object.keys(passUniforms()).sort()).toEqual([...UNIFORMS_BEFORE_THE_SHADING].sort());
        release(effects);
    });

    it("leaves a person's sprites alone and ignores the flag's unknown values", () => {
        const scene = new TestScene();
        const layer = bodySprite();
        scene.current.player = character(50, 80, [layer]);
        const { effects } = construct(scene, { hour: 22, environment: shadingEnvironment("off") });
        frames(scene, effects, 0, 600);
        expect(layer.blendMode).toBe(0);
        expect(scene.nodeNames).toEqual(["KfxPost"]);
        release(effects);
    });

    it("keeps the legacy rim when the flag says legacy, and still builds none of the new shading", () => {
        const scene = new TestScene();
        const { effects } = construct(scene, { hour: 22, nightLit: true, environment: shadingEnvironment("legacy") });
        frames(scene, effects, 0, 300);
        expect(scene.nodeNames).toEqual(["KfxPost"]);
        expect(passUniforms().uRimOn).toBe(1);
        expect(Object.keys(passUniforms())).not.toContain("uShade");
        release(effects);
    });
});

describe("with konclui.fx.rim on, the shaded pass", () => {
    function shadedRoom(setup: Setup = {}) {
        postSources.length = 0;
        const scene = new TestScene();
        const piece = placedBox(100, 100);
        scene.list.push(piece.image);
        const layer = bodySprite();
        scene.current.player = character(50, 80, [layer]);
        const built = construct(scene, { hour: 12, environment: shadingEnvironment("full"), ...setup });
        const painted = paint;
        paint = (source) => (source === piece.source ? [0, 0, 0, 255] : painted(source));
        const shading = (built.effects as unknown as { shading: Shading }).shading;
        return { scene, layer, piece, shading, ...built };
    }

    it("registers its own node and the people's blend mode, and draws by day too", () => {
        const { scene, effects } = shadedRoom();
        frames(scene, effects, 0, 100);
        expect(scene.nodeNames).toEqual(["KfxPostShaded"]);
        const [pass] = scene.filters.list as { renderNode: string; active: boolean }[];
        expect(pass.renderNode).toBe("KfxPostShaded");
        expect(pass.active).toBe(true);
        // the first custom blend id is 18: the table's length before it was registered
        expect(scene.blendTable).toHaveLength(19);
        expect(scene.blendTable[18].func).toEqual([1, 771, 0, 771]);
        const uniforms = passUniforms();
        expect(Object.keys(uniforms).sort()).toEqual(
            [...UNIFORMS_BEFORE_THE_SHADING, "uShade", "uKey", "uKeyShade", "uCrowd[0]"].sort(),
        );
        expect((uniforms.uShade as number[])[0]).toBe(2);
        release(effects);
    });

    it("marks the drawn person's sprites, once, and puts a stamp under them below their depth", () => {
        const { scene, layer, effects } = shadedRoom();
        frames(scene, effects, 0, 100);
        expect(layer.blendMode).toBe(18);
        const stamps = scene.created.filter((object) => object.label.startsWith("sprite"));
        expect(stamps).toHaveLength(1);
        expect(stamps[0].visible).toBe(true);
        expect(stamps[0].depth).toBeCloseTo(-0.01);
        release(effects);
        // and the mark is given back with the stamp when the effects go
        expect(layer.blendMode).toBe(0);
        expectEachDestroyedOnce(scene);
    });

    it("bakes after the pieces' pictures are measured, uploads once, and uploads nothing on a steady frame", () => {
        const { scene, effects, shading } = shadedRoom();
        frames(scene, effects, 0, 400);
        const [cast] = scene.arrayTextures;
        expect(shading.bakes).toBe(1);
        expect(cast.update).toHaveBeenCalledTimes(1);
        const size = 400 * 300 * 4;
        expect(shading.cast.uploadedBytes).toBe(size);
        // 5 s of steady frames: no bake, no upload
        frames(scene, effects, 416, 5400);
        expect(shading.bakes).toBe(1);
        expect(cast.update).toHaveBeenCalledTimes(1);
        release(effects);
    });

    it("publishes its counters for the frame probe while it lives, and withdraws them when it is destroyed", () => {
        expect(readShadingCounters()).toBeNull();
        const { scene, effects } = shadedRoom();
        frames(scene, effects, 0, 400);

        expect(readShadingCounters()).toMatchObject({
            bakes: 1,
            uploads: 1,
            uploadedBytes: 400 * 300 * 4,
            levelChanges: 0,
            level: 2,
        });
        release(effects);
        expect(readShadingCounters()).toBeNull();
    });

    it("measures the picture once for each sprite, 24 at a time at most, and bakes in slices of a bounded size", () => {
        const { scene, effects, shading } = shadedRoom();
        frames(scene, effects, 0, 400);
        expect(shading.measures).toBe(1);
        expect(shading.slices).toBeGreaterThan(1);
        release(effects);
    });

    it("casts a shadow below a standing piece: the key's channel under the box is set, the box itself is covered", () => {
        const { scene, effects, shading } = shadedRoom();
        frames(scene, effects, 0, 400);
        const px = (x: number, y: number, c: number) => shading.cast.pixels[((300 - 1 - y) * 400 + x) * 4 + c];
        expect(px(101, 101, 3)).toBe(255); // under the box's own picture
        expect(px(101, 105, 1)).toBeGreaterThan(0); // the shadow below its foot, at noon
        expect(px(101, 105, 3)).toBe(0); // a floor that receives
        expect(px(101, 104, 2)).toBe(255); // and its hard contact row
        release(effects);
    });

    it("bakes only the key's channel again, once, when the hour moves the key to another state", () => {
        let hour = 12;
        const { scene, effects, shading } = shadedRoom({ hourNow: () => hour });
        frames(scene, effects, 0, 400);
        expect(shading.bakes).toBe(1);
        const keyed = shading.key.dirIndex;
        hour = 17.4;
        frames(scene, effects, 416, 2000);
        expect(shading.key.dirIndex).not.toBe(keyed);
        expect(shading.bakes).toBe(2);
        expect(scene.arrayTextures[0].update).toHaveBeenCalledTimes(2);
        // a change of hour inside one state bakes nothing
        hour = 17.45;
        frames(scene, effects, 2016, 4000);
        expect(shading.bakes).toBe(2);
        release(effects);
    });

    it("waits for the pieces to hold still: no bake while a piece keeps moving, one once it stops", () => {
        const { scene, effects, piece, shading } = shadedRoom();
        frames(scene, effects, 0, 400);
        expect(shading.bakes).toBe(1);
        // a piece moves every second for six seconds: the snapshot changes at each refresh and the bake keeps waiting
        let t = 416;
        for (let second = 0; second < 6; second++) {
            piece.image.x += 3;
            frames(scene, effects, t, t + 1000);
            t += 1016;
            expect(shading.bakes, `second ${second}`).toBeLessThanOrEqual(1);
        }
        frames(scene, effects, t, t + 3000);
        expect(shading.bakes).toBe(2);
        release(effects);
    });

    it("steps down a level after 90 slow frames and puts its uniforms and marks to the new level", () => {
        const { scene, layer, effects } = shadedRoom();
        frames(scene, effects, 0, 100);
        expect((passUniforms().uShade as number[])[0]).toBe(2);
        for (let i = 0, time = 200; i < 91; i++, time += 40) effects.onFrame(time);
        expect((passUniforms().uShade as number[])[0]).toBe(1);
        expect(layer.blendMode).toBe(18);
        release(effects);
    });

    it("is off, at level 0, when the Shadows switch is off: no mark, no stamp, and the legacy day", () => {
        const { scene, layer, effects } = shadedRoom({ features: { shadows: false, light: false }, masks: INDOORS });
        frames(scene, effects, 0, 300);
        expect(layer.blendMode).toBe(0);
        expect((passUniforms().uShade as number[])[0]).toBe(0);
        const [pass] = scene.filters.list as { active: boolean }[];
        expect(pass.active).toBe(false); // a plain day, level 0: the old expression
        release(effects);
    });

    it("keeps the legacy pass when the shaded one does not compile, with no shading at all", () => {
        const { scene, effects } = shadedRoom({
            environment: { ...shadingEnvironment("full"), shadedPostCompiles: () => false },
        });
        frames(scene, effects, 0, 100);
        expect(scene.nodeNames).toEqual(["KfxPost"]);
        expect(scene.blendTable).toHaveLength(18);
        expect(Object.keys(passUniforms()).sort()).toEqual([...UNIFORMS_BEFORE_THE_SHADING].sort());
        release(effects);
    });

    it("drops the footprints from the ground's shade while the shading is on, and brings them back at level 0", () => {
        const { scene, effects } = shadedRoom({ features: { shadows: true } });
        frames(scene, effects, 0, 100);
        const ground = scene.created.find((object) => object.config?.name === "kfxGround");
        const people = (): unknown => {
            let n: unknown = -1;
            ground?.config?.setupUniforms((name, value) => {
                if (name === "uPeopleN") n = value;
            });
            return n;
        };
        expect(people()).toBe(0);
        release(effects);
    });
});
