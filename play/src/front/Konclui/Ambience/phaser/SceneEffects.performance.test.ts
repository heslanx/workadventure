// @vitest-environment jsdom
import inspector from "node:inspector";
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemotePlayer } from "../../../Phaser/Entity/RemotePlayer";
import type { Player } from "../../../Phaser/Player/Player";
import { EFFECT_TEXTURES, type EffectTexture, type EffectsManifest } from "../domain/effectsManifest";
import { DrawnPeople } from "../domain/drawnPeople";
import type * as GroundShadow from "../domain/groundShadow";
import type * as Lights from "../domain/lights";
import { parseFeatures, type FeatureSwitches } from "../../Preferences/domain/effectSwitches";
import type * as PostFilter from "./postFilter";
import { LABEL_MEASURE_MS, SceneEffects, type EffectsEnvironment, type EffectsHost } from "./SceneEffects";

// The cost of the effects per frame, measured on a hand-made scene (the SceneEffects.test.ts harness, cut down to what
// the numbers need). Every figure the tests print (`[ambience-perf]`) comes from here and is rerun with
//   npx vitest run src/front/Konclui/Ambience/phaser/SceneEffects.performance.test.ts
// The meters count operations on the made scene (texture uploads, players read, light filter runs) and the bytes V8
// allocates, from its sampling heap profiler. None is a browser, GPU or 1000-user timing.

const PRE_RENDER = Phaser.Scenes.Events.PRE_RENDER;
const FRAME_MS = 16;

// The camera pass the effects add, and its uniforms source: a draw of the scene asks it for its uniforms.
const camera = vi.hoisted(() => ({
    passes: [] as { active: boolean }[],
    posts: [] as { place(): void }[],
    sources: [] as { postUniforms(): Record<string, unknown> }[],
    /** How many times the pass was added to, and taken off, each of the camera's lists. */
    added: { internal: 0, external: 0 },
    removed: { internal: 0, external: 0 },
}));
vi.mock("./postFilter", async (importOriginal) => {
    const actual = await importOriginal<typeof PostFilter>();
    return {
        ...actual,
        addPostFilter: (...args: Parameters<typeof actual.addPostFilter>) => {
            camera.sources.push(args[2]);
            const post = actual.addPostFilter(...args);
            camera.passes.push(post.controller);
            camera.posts.push(post);
            return post;
        },
    };
});

// How often the work worked out from the placed pieces is done (each run walks every piece), and the light filter.
const lightRuns = vi.hoisted(() => ({ count: 0, rects: 0, fromPieces: 0, footprints: 0 }));
vi.mock("../domain/lights", async (importOriginal) => {
    const actual = await importOriginal<typeof Lights>();
    return {
        ...actual,
        visibleLights: (...args: Parameters<typeof actual.visibleLights>) => {
            lightRuns.count += 1;
            return actual.visibleLights(...args);
        },
        visibleRects: (...args: Parameters<typeof actual.visibleRects>) => {
            lightRuns.rects += 1;
            return actual.visibleRects(...args);
        },
        lightsFrom: (...args: Parameters<typeof actual.lightsFrom>) => {
            lightRuns.fromPieces += 1;
            return actual.lightsFrom(...args);
        },
    };
});
vi.mock("../domain/groundShadow", async (importOriginal) => {
    const actual = await importOriginal<typeof GroundShadow>();
    return {
        ...actual,
        footprints: (...args: Parameters<typeof actual.footprints>) => {
            lightRuns.footprints += 1;
            return actual.footprints(...args);
        },
    };
});

/** Outside (red), polished floor (green), open water (blue 128): every pixel of the masks. */
const ALL_MASKS: readonly [number, number, number, number] = [255, 255, 128, 255];
const GLASS_ALL_OVER: readonly [number, number, number, number] = [255, 255, 255, 255];
let paint: (source: unknown) => readonly [number, number, number, number] = () => [0, 0, 0, 0];

class MeterContext {
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

/**
 * What goes from the CPU to the GPU, in bytes of four per pixel: a texture of a picture or a canvas is uploaded whole when
 * it is added, and a canvas texture again each time it is refreshed (Phaser 4.2.1 has no sub-rectangle upload).
 */
interface UploadMeter {
    bytes: number;
    uploads: number;
    byKey: Map<string, number>;
}

class MeterObject {
    public visible = true;
    public depth = 0;
    public texture: { key: string };
    public readonly frame: { name: string | number | undefined };
    public readonly children: MeterObject[] = [];

    constructor(
        private readonly scene: MeterScene,
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

    add(child: MeterObject): this {
        this.scene.unlist(child);
        this.children.push(child);
        return this;
    }

    destroy(): void {
        this.scene.unlist(this);
        for (const child of this.children) child.destroy();
        this.children.length = 0;
    }
}

interface ShaderConfig {
    readonly name: string;
    setupUniforms(set: (name: string, value: unknown) => void): void;
}

/** The frame counter the bodies count their visits by. */
const clock = { frame: 0, visited: 0 };

/** A remote character as the effects read it: x, y, whether it is drawn, and its sprites. Reading any of them is a visit. */
class Body {
    public userId = 0;
    private seenAt = -1;
    public constructor(
        private px: number,
        private py: number,
        private drawn: boolean,
        private readonly sprites: readonly object[],
    ) {}

    private visit(): void {
        if (this.seenAt === clock.frame) return;
        this.seenAt = clock.frame;
        clock.visited += 1;
    }

    get x(): number {
        this.visit();
        return this.px;
    }

    get y(): number {
        this.visit();
        return this.py;
    }

    get visible(): boolean {
        this.visit();
        return this.drawn;
    }

    get list(): readonly object[] {
        this.visit();
        return this.sprites;
    }

    walk(dx: number): void {
        this.px += dx;
    }

    moveTo(x: number): void {
        this.px = x;
    }

    setDrawn(drawn: boolean): void {
        this.drawn = drawn;
    }
}

class MeterScene {
    public dirty = 0;
    public readonly current: { player: Player | undefined } = { player: undefined };
    public readonly players = new Map<number, RemotePlayer>();
    public fullDetailPlayers?: Set<RemotePlayer>;
    public readonly list: unknown[] = [];
    public readonly listeners = new Map<string, Set<() => void>>();
    public readonly uploads: UploadMeter = { bytes: 0, uploads: 0, byKey: new Map() };
    public readonly textureKeys = new Set<string>();
    private readonly textureObjects = new Map<string, { key: string }>();
    public readonly renderer = {
        renderNodes: { hasNode: () => true },
        width: 300,
        height: 200,
    } as unknown as Phaser.Renderer.WebGL.WebGLRenderer;
    public readonly host: EffectsHost;
    public readonly view = { x: 0, y: 0, width: 300, height: 200 };
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
        const view = this.view;
        const mainCamera = {
            worldView: view,
            scrollX: 0,
            scrollY: 0,
            width: 300,
            height: 200,
            zoom: 1,
            x: 0,
            y: 0,
            alpha: 1,
            filters: {
                internal: {
                    add: () => (camera.added.internal += 1),
                    remove: () => (camera.removed.internal += 1),
                },
                external: {
                    add: () => (camera.added.external += 1),
                    remove: () => (camera.removed.external += 1),
                },
            },
        };
        const current = this.current;
        const canvas = document.createElement("canvas");
        // a plain function, not a spy: a spy keeps a record of each call, and that is memory a frame is not to be charged
        const bounds = { left: 0, top: 0, width: 300, height: 200 } as DOMRect;
        canvas.getBoundingClientRect = () => bounds;
        const getFullDetailPlayers = () => this.fullDetailPlayers;
        // one stored object, as the scene's own: a fresh one on each call is garbage the effects are not to be charged
        const entitiesManager = { getEntities: () => this.entities };
        const wrapper = {
            phaserLayers: layers,
            getTileAnimationRefreshDelay: () => 220,
            getEntitiesManager: () => entitiesManager,
        } as unknown as ReturnType<EffectsHost["getGameMapFrontWrapper"]>;
        this.host = {
            add: {
                shader: (config: ShaderConfig) => this.make("shader", "", undefined, config),
                container: () => this.make("container", ""),
                image: (_x: number, _y: number, key: string, frame?: string | number) => this.make("image", key, frame),
            } as unknown as EffectsHost["add"],
            textures: {
                addImage: (key: string, image: HTMLImageElement) => this.addTexture(key, image),
                addCanvas: (key: string, canvas: HTMLCanvasElement) => this.addTexture(key, canvas),
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
                off: (event, listener) => this.listenersOf(event).delete(listener),
            },
            cameras: { main: mainCamera as unknown as Phaser.Cameras.Scene2D.Camera },
            game: { canvas },
            MapPlayersByKey: this.players,
            get fullDetailPlayers() {
                return getFullDetailPlayers();
            },
            get CurrentPlayer() {
                return current.player;
            },
            markDirty: () => {
                this.dirty += 1;
            },
            getGameMapFrontWrapper: () => wrapper,
        };
    }

    /** What the map's entity manager gives: nothing by default. */
    public entities = new Map();

    /** The Texture the manager holds under a key: one object for as long as the key stays, as Phaser's. */
    textureFor(key: string): { key: string } {
        let texture = this.textureObjects.get(key);
        if (!texture) {
            texture = { key };
            this.textureObjects.set(key, texture);
        }
        return texture;
    }

    addTexture(key: string, source?: { width: number; height: number }) {
        if (this.textureKeys.has(key)) return null;
        this.textureKeys.add(key);
        const size = source ? source.width * source.height * 4 : 0;
        const upload = (): void => {
            this.uploads.bytes += size;
            this.uploads.uploads += size > 0 ? 1 : 0;
            this.uploads.byKey.set(key, (this.uploads.byKey.get(key) ?? 0) + size);
        };
        upload(); // a texture is uploaded when it is added
        return {
            key,
            setFilter: vi.fn(),
            refresh: upload,
        };
    }

    unlist(object: unknown): void {
        const at = this.list.indexOf(object);
        if (at >= 0) this.list.splice(at, 1);
    }

    /**
     * A draw of the scene: the effects' pre-render step, then what the renderer asks of what shows: each visible shader's
     * uniforms, and the camera pass's when it is on (applied as the pass applies them, one by one).
     */
    draw(): void {
        this.listenersOf(PRE_RENDER).forEach(callListener);
        for (let i = 0; i < this.list.length; i++) {
            const object = this.list[i];
            if (object instanceof MeterObject && object.config && object.visible)
                object.config.setupUniforms(applyUniform);
        }
        const pass = camera.passes.at(-1);
        if (pass?.active) {
            const uniforms = camera.sources.at(-1)?.postUniforms() ?? {};
            for (const name in uniforms) applyUniform(name, uniforms[name]);
        }
    }

    resetMeters(): void {
        this.uploads.bytes = 0;
        this.uploads.uploads = 0;
        this.uploads.byKey.clear();
        this.dirty = 0;
    }

    private listenersOf(event: string): Set<() => void> {
        let listeners = this.listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(event, listeners);
        }
        return listeners;
    }

    private make(kind: string, key: string, frame?: string | number, config?: ShaderConfig): MeterObject {
        const object = new MeterObject(this, key, frame, config);
        // A TV's slide is an Image in the scene's display list, so the placed-pieces snapshot sees it as it sees a map
        // piece: made here an Image by prototype (the effects ask `instanceof` and `type`), its methods the meter's.
        const made = kind === "image" ? asImage(object) : object;
        this.list.push(made);
        return made;
    }
}

/** The TVs' slides: Images the effects add to the scene (so, not MeterObject instances: see `asImage`). */
function slides(scene: MeterScene): MeterObject[] {
    return scene.list.filter(
        (o): o is MeterObject => (o as { texture?: { key: string } }).texture?.key === "kfx-1-tv-slide",
    );
}

/** A meter object that is an Image to `instanceof` and `type`: the same fields and methods, an Image's prototype. */
function asImage(object: MeterObject): MeterObject {
    const image: MeterObject = Object.create(Phaser.GameObjects.Image.prototype);
    for (const name of Object.getOwnPropertyNames(MeterObject.prototype)) {
        if (name === "constructor") continue;
        Object.defineProperty(image, name, { value: Reflect.get(MeterObject.prototype, name), configurable: true });
    }
    Object.defineProperty(image, "type", { value: "Image", configurable: true });
    for (const [name, value] of Object.entries(object)) {
        Object.defineProperty(image, name, { value, writable: true, configurable: true, enumerable: true });
    }
    return image;
}

function fake<T extends object>(prototype: object, properties: Record<string, unknown>): T {
    const object: T = Object.create(prototype);
    for (const [name, value] of Object.entries(properties)) {
        Object.defineProperty(object, name, { value, writable: true, configurable: true, enumerable: true });
    }
    return object;
}

/** One layer of a character, from a figure sheet: the up row (frame 1) is turned over by a reflection. */
function figureLayer(texture: string, frame = 1): Phaser.GameObjects.Sprite {
    return fake(Phaser.GameObjects.Sprite.prototype, {
        visible: true,
        frame: { name: frame },
        texture: { key: texture },
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

const callListener = (listener: () => void): void => listener();

/** Where a uniform goes: nowhere, but each value is read, as the GPU upload reads it. */
let uniformsSet = 0;
function applyUniform(_name: string, value: unknown): void {
    uniformsSet += value === undefined ? 0 : 1;
}

const GLASS_FOOT = 100;

/**
 * The office .wam places 664 entities (.local/konclui/asset-build/maps/konclui-office/office.wam). The crowded scenes
 * place as many, from 40 sprites: a dozen lamps, four screens, the rest furniture with a footprint or flat on the floor.
 */
const PLACED = 664;
const SPRITES = 40;
const spriteKey = (n: number): string => `maps/konclui-office/entities/piece-${n % SPRITES}.png`;
const spriteName = (n: number): string => `entities/piece-${n % SPRITES}.png`;

function placedSprites(): Pick<EffectsManifest, "lights" | "shadows"> {
    const lights: EffectsManifest["lights"] = {};
    const shadows: EffectsManifest["shadows"] = {};
    for (let n = 0; n < SPRITES; n++) {
        const key = `piece-${n}.png`;
        if (n < 12) lights[key] = { kind: "arc", w: 32, h: 96, foot: [16, 94], head: [16, 4] };
        else if (n < 16) lights[key] = { kind: "tv", w: 32, h: 32, foot: [16, 30], screen: [4, 4, 28, 20] };
        shadows[key] = n % 5 === 4 ? null : [2, 20, 30, 32];
    }
    return { lights, shadows };
}

/** One placed map image, as the entity manager keeps it: an Image of the scene that is also an entity. */
function placedImage(n: number): Phaser.GameObjects.Image {
    // the prefab is a stored object, as the editor's: the entity gives it back, it does not make one on each call
    // (a fifth are plants: the pieces the mirror shows when they stand in front of the glass)
    const prefab = { name: spriteName(n), tags: n % 5 === 0 ? ["Plantas"] : [] };
    return fake(Phaser.GameObjects.Image.prototype, {
        type: "Image",
        visible: true,
        active: true,
        depth: 1,
        displayWidth: 16,
        displayHeight: 32,
        x: (n * 37) % 380,
        y: (n * 53) % 270,
        originX: 0.5,
        originY: 1,
        texture: { key: spriteKey(n) },
        frame: { name: 1 },
        flipX: false,
        scaleX: 1,
        scaleY: 1,
        getPrefab: () => prefab,
    });
}

/** The sizes of the map and of the pictures of its fx/ folder: a made small room, or the office's real ones. */
interface Dimensions {
    readonly map: readonly [number, number];
    readonly occluders: readonly [number, number];
    readonly water: readonly [number, number];
    readonly slide: readonly [number, number];
    readonly glassFaces: NonNullable<EffectsManifest["glassFaces"]>;
}

const SMALL_ROOM: Dimensions = {
    map: [400, 300],
    occluders: [200, 150],
    water: [100, 80],
    slide: [24, 16],
    glassFaces: [[0, 400, GLASS_FOOT]],
};

/** The office as built (.local/konclui/asset-build/maps/konclui-office/fx/manifest.json and its pictures). */
const OFFICE: Dimensions = {
    map: [2752, 1792],
    occluders: [1376, 896],
    water: [480, 1024],
    slide: [43, 23],
    glassFaces: [
        [608, 1312, 252],
        [1472, 2176, 252],
        [192, 2592, 1596],
        [608, 1312, 604],
        [1472, 2176, 604],
    ],
};

function manifest(placed = 0, size: Dimensions = SMALL_ROOM): EffectsManifest {
    return {
        map: [...size.map],
        water: { rect: [100, 100, 100, 80], glint: [[255, 255, 255]], waterline: [200, 200, 200] },
        ...(placed > 0 ? placedSprites() : { lights: {}, shadows: {} }),
        staticLights: [
            { kind: "door", at: [60, 60], r: 80, squash: 0.6 },
            { kind: "door", at: [200, 120], r: 90, squash: 0.6 },
            { kind: "fountain", at: [320, 90] },
        ],
        rooms: [{ key: "meeting", layer: "lock-meeting", rect: [20, 20, 120, 100], floor: [30, 30, 100, 80] }],
        glassFaces: size.glassFaces.map((face) => [...face]),
        ink: [10, 10, 30],
    };
}

function pictures(size: Dimensions = SMALL_ROOM): Record<EffectTexture, HTMLImageElement> {
    const sized = (width: number, height: number): HTMLImageElement => Object.assign(new Image(), { width, height });
    const images = {
        water: sized(...size.water),
        "water-data": sized(...size.water),
        glass: sized(...size.map),
        masks: sized(...size.map),
        "tv-slide": sized(...size.slide),
        occluders: sized(...size.occluders),
    };
    paint = (source) => (source === images.masks ? ALL_MASKS : source === images.glass ? GLASS_ALL_OVER : [0, 0, 0, 0]);
    return images;
}

interface Built {
    readonly scene: MeterScene;
    readonly effects: SceneEffects;
    time: number;
}

interface BuildOptions {
    /** The fixed hour, asked for on each use: a QA setting that changes while the effects run. */
    readonly hourNow?: () => number;
    /** Whether the room has the optional normal map (a picture of the map's size). */
    readonly normal?: boolean;
    readonly size?: Dimensions;
    /** What the map's entity manager holds when the effects are built (a piece at the glass at the build). */
    readonly entities?: Map<string, unknown>;
}

function build(
    hour = 22,
    features: Partial<FeatureSwitches> = {},
    placed = 0,
    { hourNow, normal = false, size = SMALL_ROOM, entities }: BuildOptions = {},
): Built {
    const scene = new MeterScene();
    placeImages(scene, placed);
    if (entities) scene.entities = entities;
    const environment: EffectsEnvironment = {
        reducedMotion: () => false,
        animationsOff: () => false,
        fixedHour: () => (hourNow ? hourNow() : hour),
        focused: () => false,
        nightLit: () => false,
    };
    const images = pictures(size);
    const effects = new SceneEffects({
        scene: scene.host,
        renderer: scene.renderer,
        manifest: manifest(placed, size),
        images,
        normal: normal ? Object.assign(new Image(), { width: size.map[0], height: size.map[1] }) : undefined,
        generation: 1,
        features: { ...parseFeatures(null), ...features },
        environment,
        time: 0,
        reveal: false,
    });
    return { scene, effects, time: 0 };
}

/** `count` map images in the scene's children and in its entity manager, as a loaded map has them. */
function placeImages(scene: MeterScene, count: number): void {
    const entities = new Map<string, Phaser.GameObjects.Image>();
    for (let n = 0; n < count; n++) {
        const image = placedImage(n);
        scene.list.push(image);
        entities.set(`entity-${n}`, image);
    }
    if (count > 0) scene.entities = entities;
}

/** One frame: the game step, then the draw. */
function frame(built: Built): void {
    clock.frame += 1;
    built.time += FRAME_MS;
    built.effects.onFrame(built.time);
    built.scene.draw();
}

/** `remotes` characters, the first `drawn` of them standing in front of the glass, the rest culled or dots (not drawn). */
function crowd(scene: MeterScene, remotes: number, drawn: number): Body[] {
    const bodies: Body[] = [];
    const detailed = (scene.fullDetailPlayers = new Set<RemotePlayer>());
    for (let i = 0; i < remotes; i++) {
        const shown = i < drawn;
        const x = shown ? 5 + ((i * 7) % 290) : 1000 + i;
        const y = shown ? 90 + ((i * 5) % 70) : 900 + i;
        const body = new Body(x, y, shown, shown ? [figureLayer(`woka-${i}`)] : []);
        body.userId = i + 1;
        if (shown) detailed.add(body as unknown as RemotePlayer);
        bodies.push(body);
        scene.players.set(i + 1, body as unknown as RemotePlayer);
    }
    return bodies;
}

/**
 * How many arrays, typed arrays, maps and sets `run` makes with `new` or `Array.from`/`Array.of`: the constructors are
 * swapped for counting ones while it goes. Literals (`[]`, `{}`) and the arrays a method makes (`map`, `slice`) are not
 * seen: the byte budgets catch those.
 */
function countConstructions(run: () => void): number {
    const names = ["Array", "Float32Array", "Float64Array", "Int32Array", "Uint8Array", "Map", "Set"] as const;
    const original = new Map<string, unknown>();
    const target = globalThis as unknown as Record<string, unknown>;
    let made = 0;
    for (const name of names) {
        const real = target[name] as new (...args: unknown[]) => unknown;
        original.set(name, real);
        target[name] = new Proxy(real, {
            construct(base, args, newTarget) {
                made += 1;
                return Reflect.construct(base, args, newTarget === target[name] ? base : newTarget);
            },
            get(base, property) {
                const value: unknown = Reflect.get(base, property, base);
                if (name === "Array" && (property === "from" || property === "of") && typeof value === "function") {
                    return (...args: unknown[]) => {
                        made += 1;
                        return Reflect.apply(value, base, args);
                    };
                }
                return value;
            },
        });
    }
    try {
        run();
    } finally {
        for (const name of names) target[name] = original.get(name);
    }
    return made;
}

/**
 * Bytes V8 allocates while `run` goes, from the sampling heap profiler, counted where the allocating call has the effects'
 * code (src/front/Konclui/Ambience, not the tests) on its stack: the effects and what they call (`fill`, `push`...). What
 * the harness allocates (the walkers' steps, the fake scene's draw) and the profiler's own session (its stopSampling reply
 * is 1 to 100 KB, by the size of the profile) are left out. The profiler samples, so a figure is within a few percent.
 */
function allocatedBytes(run: () => void): number {
    const session = new inspector.Session();
    session.connect();
    // The inspector answers a session of this thread at once, so the callback has run when `post` returns.
    const post = (method: string, params?: object): unknown => {
        const outcome: { error: Error | null; value: unknown } = { error: null, value: undefined };
        session.post(method, params, (error, value) => {
            outcome.error = error;
            outcome.value = value;
        });
        if (outcome.error) throw outcome.error;
        return outcome.value;
    };
    try {
        post("HeapProfiler.enable");
        post("HeapProfiler.startSampling", {
            samplingInterval: 32,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
        });
        run();
        const stopped = post("HeapProfiler.stopSampling") as {
            profile: { head: SamplingNode };
        };
        const by = import.meta.env.VITE_AMBIENCE_ALLOC_TOP ? new Map<string, number>() : undefined;
        const total = sum(stopped.profile.head, "outside", by);
        if (by) {
            // VITE_AMBIENCE_ALLOC_TOP=1 names the call sites that allocated the most, to find what a frame still makes
            const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
            console.info(`[ambience-perf] top allocators (bytes in all frames) ${JSON.stringify(top)}`);
        }
        return total;
    } finally {
        session.disconnect();
    }
}

interface SamplingNode {
    readonly selfSize: number;
    readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
    readonly children: readonly SamplingNode[];
}

// Whose allocation a profile node is: the effects' (their code, and what they call), or not. What jsdom does for a call
// of the effects (its proxy for a collection, say) is the DOM's, and a browser's is native: not counted, nor what it calls.
type Owner = "outside" | "effects" | "dom";

function ownerOf(url: string, parent: Owner): Owner {
    if (url.includes("/node_modules/jsdom/")) return "dom";
    if (url.includes("/Konclui/Ambience/") && !url.includes(".test.")) return "effects";
    return parent;
}

function sum(node: SamplingNode, parent: Owner, by?: Map<string, number>): number {
    const owner = ownerOf(node.callFrame.url, parent);
    let total = owner === "effects" ? node.selfSize : 0;
    if (by && owner === "effects" && node.selfSize > 0) {
        const { functionName, url, lineNumber } = node.callFrame;
        const where = `${functionName || "(anonymous)"} ${url.replace(/^.*\/src\//, "src/")}:${lineNumber + 1}`;
        by.set(where, (by.get(where) ?? 0) + node.selfSize);
    }
    for (const child of node.children) total += sum(child, owner, by);
    return total;
}

function report(label: string, figures: Record<string, number>): void {
    console.info(`[ambience-perf] ${label} ${JSON.stringify(figures)}`);
}

beforeEach(() => {
    uniformsSet = 0;
    lightRuns.count = 0;
    lightRuns.rects = 0;
    lightRuns.fromPieces = 0;
    lightRuns.footprints = 0;
    clock.frame = 0;
    clock.visited = 0;
    camera.passes.length = 0;
    camera.sources.length = 0;
    camera.posts.length = 0;
    camera.added.internal = 0;
    camera.added.external = 0;
    camera.removed.internal = 0;
    camera.removed.external = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
        const own = contexts.get(this) ?? new MeterContext();
        contexts.set(this, own);
        return own as unknown as RenderingContext;
    });
});

const contexts = new WeakMap<HTMLCanvasElement, MeterContext>();

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe("the mirror, while players walk in front of the glass", () => {
    it("uploads no texture while 50 players walk along it, and draws their reflections", () => {
        const built = build();
        const bodies = crowd(built.scene, 50, 50);
        frame(built);
        built.scene.resetMeters();

        for (let i = 0; i < 180; i++) {
            for (const body of bodies) body.walk(i % 2 === 0 ? 1 : -1);
            frame(built);
        }

        report("mirror upload, 50 walkers, 180 frames (about 3 s, two refreshes)", {
            bytes: built.scene.uploads.bytes,
            uploads: built.scene.uploads.uploads,
        });
        expect(built.scene.uploads.bytes).toBe(0);
        const mirror = built.scene.list.find((object) => object instanceof MeterObject && object.children.length > 0);
        expect(mirror, "the pictures of the walkers are drawn in the mirror's container").toBeDefined();
        expect((mirror as MeterObject).children.filter((child) => child.visible).length).toBeGreaterThan(0);
    });

    it("reuses the original sheets across animation frames without any uploads", () => {
        const built = build();
        const layers = Array.from({ length: 50 }, (_, i) => figureLayer(`woka-${i}`, 0));
        const bodies = layers.map((layer, i) => {
            const body = new Body(5 + ((i * 7) % 290), 90 + ((i * 5) % 70), true, [layer]);
            built.scene.players.set(i + 1, body as unknown as RemotePlayer);
            return body;
        });
        frame(built);
        built.scene.resetMeters();

        for (let i = 0; i < 120; i++) {
            for (const layer of layers) Object.assign(layer.frame, { name: i % 3 });
            for (const body of bodies) body.walk(i % 2 === 0 ? 1 : -1);
            frame(built);
        }

        report("turned figures, 50 walkers cycling 3 frames, 120 frames", { uploads: built.scene.uploads.uploads });
        expect(built.scene.uploads.uploads).toBe(0);
    });

    it("does upload the mirror's atlas when a piece beside the glass changes (the meter reads)", () => {
        const built = build();
        const entity = {
            visible: true,
            active: true,
            displayWidth: 16,
            displayHeight: 32,
            x: 200,
            y: 150,
            originX: 0.5,
            originY: 1,
            texture: { key: "plant" },
            frame: { name: 1 },
            flipX: false,
            scaleX: 1,
            scaleY: 1,
            getPrefab: () => ({ name: "planta", tags: ["Plantas"] }),
        };
        built.scene.entities = new Map([["plant", entity]]);
        for (let i = 0; i < 70; i++) frame(built); // past the first refresh, which paints the piece
        built.scene.resetMeters();

        entity.x = 260;
        for (let i = 0; i < 70; i++) frame(built); // the next refresh sees it moved

        const atlas = [...built.scene.uploads.byKey.entries()].find(([key]) => key === "kfx-1-mirror");
        expect(atlas?.[1], "the whole atlas, 400 x 128 px of four bytes").toBe(400 * 128 * 4);
    });
});

describe("the mirror with a crowd of 80 drawn players of 6 layers each at the glass (480 pictures, 390 of them show)", () => {
    function layeredCrowd(): { built: Built; bodies: Body[] } {
        const built = build(22);
        const bodies: Body[] = [];
        const detailed = (built.scene.fullDetailPlayers = new Set<RemotePlayer>());
        for (let i = 0; i < 80; i++) {
            const layers = Array.from({ length: 6 }, (_, k) => figureLayer(`woka-${i}-${k}`));
            const body = new Body(5 + ((i * 7) % 290), 90 + ((i * 5) % 70), true, layers);
            body.userId = i + 1;
            detailed.add(body as unknown as RemotePlayer);
            bodies.push(body);
            built.scene.players.set(i + 1, body as unknown as RemotePlayer);
        }
        for (let i = 0; i < 300; i++) frame(built);
        return { built, bodies };
    }

    function warmed(): { draw: () => void; bodies: Body[]; mirror: MeterObject } {
        const { built, bodies } = layeredCrowd();
        const draw = (): void => {
            for (let n = 0; n < 20; n++) bodies[n].walk(clock.frame % 2 === 0 ? 1 : -1);
            clock.frame += 1;
            built.scene.draw();
        };
        // warm: V8's optimizing compiler (an earlier test's swapped constructors have thrown the code away)
        for (let i = 0; i < 3000; i++) draw();
        const mirror = built.scene.list.find((o) => o instanceof MeterObject && o.children.length > 0);
        return { draw, bodies, mirror: mirror as MeterObject };
    }

    // The mirror sorts its pictures farthest first with an insertion sort in place (no array made); the sort is O(n^2),
    // so the draw time at 480 pictures is reported (Node, mocks: not asserted) and what is countable is bounded.
    it("draws 480 pictures without making an array, and reports the time of a draw", () => {
        const { draw, mirror } = warmed();
        const times: number[] = [];

        const made = countConstructions(() => {
            for (let i = 0; i < 120; i++) {
                const start = performance.now();
                draw();
                times.push(performance.now() - start);
            }
        });

        times.sort((a, b) => a - b);
        const images = mirror.children.filter((child) => child.visible).length;
        report("mirror draw with 480 pictures (Node with mocks, no GPU)", {
            images,
            p50Ms: Math.round(times[60] * 1000) / 1000,
            maxMs: Math.round(times[119] * 1000) / 1000,
        });
        // MEASURED: 390 of the 480 pictures show (the rest stand off the panes, or are out of reach of the glass): a count
        // under 300 means the mirror stopped drawing what the budgets below are for.
        expect(images, "the pictures were drawn").toBeGreaterThanOrEqual(300);
        expect(made).toBe(0);
    });

    it("allocates under 64 bytes a draw with 480 pictures in the mirror", () => {
        const { draw } = warmed();

        const bytes = allocatedBytes(() => {
            for (let i = 0; i < 240; i++) draw();
        });

        report("heap bytes per draw, 480 pictures in the mirror", { bytesPerDraw: Math.round(bytes / 240) });
        expect(bytes / 240).toBeLessThan(64);
    });
});

describe("the camera pass on the external filter list (konclui.fx.external on)", () => {
    const KEY = "konclui.fx.external";
    afterEach(() => localStorage.removeItem(KEY));

    // These tests do not claim a GPU saving, and the meters here cannot show one: the camera of this scene is a double
    // that only counts what is added to and taken off its lists. What they pin is the CPU side the flag adds to a frame
    // (the pass is placed once, then left alone) and that the pass never moves between lists on a steady scene. The
    // saved blit and framebuffer are Phaser's, and only a Gate 1 run in a browser measures them.

    it("puts the pass on the external list once, and a steady frame never moves it", () => {
        localStorage.setItem(KEY, "1");
        const built = build(22);
        expect(camera.added, "flag on: the pass is on the external list only").toEqual({ internal: 0, external: 1 });

        for (let i = 0; i < 1000; i++) frame(built);

        expect(camera.added, "no frame re-adds the pass").toEqual({ internal: 0, external: 1 });
        expect(camera.removed, "no frame takes it off").toEqual({ internal: 0, external: 0 });
    });

    it("puts the pass on the internal list only, as before, with the flag off", () => {
        localStorage.setItem(KEY, "0");
        const built = build(22);
        expect(camera.added).toEqual({ internal: 1, external: 0 });

        for (let i = 0; i < 1000; i++) frame(built);

        expect(camera.added).toEqual({ internal: 1, external: 0 });
        expect(camera.removed).toEqual({ internal: 0, external: 0 });
    });

    it("places the pass without allocating, on either list", () => {
        for (const flag of ["0", "1"]) {
            localStorage.setItem(KEY, flag);
            build(22);
            const [post] = camera.posts.slice(-1);

            const bytes = allocatedBytes(() => {
                for (let i = 0; i < 10_000; i++) post.place();
            });

            // The profiler samples, so a count of zero is the only figure that does not depend on when the GC ran.
            expect(bytes / 10_000, `flag ${flag}`).toBeLessThan(1);
        }
    });

    it("a steady frame allocates what the budgets above allow with the flag on", () => {
        localStorage.setItem(KEY, "1");
        const built = build(22);
        for (let i = 0; i < 3000; i++) frame(built);
        built.scene.resetMeters();

        const bytes = allocatedBytes(() => {
            for (let i = 0; i < 240; i++) frame(built);
        });

        report("heap bytes per frame, refresh included, camera pass on the external list", {
            external: Math.round(bytes / 240),
        });
        // MEASURED once each, in one run: 76 bytes a frame with the pass on the internal list and 182 on the external. The
        // placing allocates nothing (the test above), so the gap is the sampler's, not the list's. A comparison of the two
        // sampled figures failed by chance once, so this bound is a ceiling for a leak and compares nothing.
        expect(bytes / 240).toBeLessThan(1024);
    });
});

describe("the effects in a crowd of 1,000 remote players, 80 of them drawn", () => {
    const REMOTES = 1000;
    const DRAWN = 80;
    const FRAMES = 240; // 3.84 s: 15 looks at the crowd, 3 refreshes

    // Where the player stands: in the meeting room (its frost is not drawn for them), or out of it (it is, so the locked
    // rooms of the frame are listed too).
    const INSIDE = { x: 60, y: 60 };
    const OUTSIDE = { x: 250, y: 250 };

    function crowded(at = INSIDE): { built: Built; bodies: Body[] } {
        const built = build(22, {}, PLACED);
        built.scene.current.player = { ...at, visible: true, list: [] } as unknown as Player;
        const bodies = crowd(built.scene, REMOTES, DRAWN);
        for (let i = 0; i < 600; i++) frame(built); // warm: the pools, the first refreshes, V8's optimizing compiler
        return { built, bodies };
    }

    function walkSome(bodies: readonly Body[], step: number): void {
        for (let n = 0; n < 20; n++) bodies[n].walk(step % 2 === 0 ? 1 : -1);
    }

    it("reads the drawn players on a frame, and the 1,000 only a few times a second", () => {
        const { built, bodies } = crowded();
        const perFrame: number[] = [];

        for (let i = 0; i < FRAMES; i++) {
            walkSome(bodies, i);
            clock.visited = 0;
            frame(built);
            perFrame.push(clock.visited);
        }

        const sorted = [...perFrame].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const mean = perFrame.reduce((a, b) => a + b, 0) / perFrame.length;
        report("players visited per frame, 1000 remote of which 80 drawn", {
            frames: FRAMES,
            median,
            mean: Math.round(mean * 10) / 10,
            max: sorted[sorted.length - 1],
        });
        expect(median, "a frame between two looks reads the drawn players and nobody else").toBeLessThanOrEqual(
            DRAWN + 1,
        );
        // The one-second room occupancy census also counts distant collaborators.
        expect(mean).toBeLessThan(110);
    });

    // A draw: no game step, so no refresh or tile tick, as on the frames between two of them.
    function drawer(built: Built): (i: number) => void {
        return () => {
            clock.frame += 1;
            built.scene.draw();
        };
    }

    it.each([
        ["inside the meeting room", INSIDE],
        ["outside it, the room's frost in view", OUTSIDE],
    ])("makes no array or typed array on a draw, 664 pieces, 20 walking, the player %s", (_, at) => {
        const { built, bodies } = crowded(at);
        const draw = drawer(built);
        for (let i = 0; i < 600; i++) {
            walkSome(bodies, i);
            draw(i);
        }

        const made = countConstructions(() => {
            for (let i = 0; i < FRAMES; i++) {
                walkSome(bodies, i);
                draw(i);
            }
        });

        report("arrays, typed arrays, maps and sets made with new or Array.from, in 240 draws", { made });
        expect(made).toBe(0);
    });

    it.each([
        ["inside the meeting room", INSIDE],
        ["outside it, the room's frost in view", OUTSIDE],
    ])("allocates under 64 bytes a draw, 20 players walking, the player %s", (_, at) => {
        const { built, bodies } = crowded(at);
        const draw = drawer(built);
        for (let i = 0; i < 600; i++) {
            walkSome(bodies, i);
            draw(i);
        }

        const bytes = allocatedBytes(() => {
            for (let i = 0; i < FRAMES; i++) {
                walkSome(bodies, i);
                draw(i);
            }
        });
        const perDraw = bytes / FRAMES;

        report("heap bytes allocated per draw (frame step + uniforms), 664 pieces, 1000 remote of which 80 drawn", {
            frames: FRAMES,
            bytesPerDraw: Math.round(perDraw),
            uniformsSet,
        });
        // MEASURED by this test: about 17 B a draw with the player inside the meeting room and about 33 B outside it
        // (the frost's name-tag pass runs there). The 716 KB a draw of the code before this work was measured on that
        // code and cannot be rerun. The budget is under the size of a 16-number array (about 150 B): any one of the
        // six arrays that once came each draw (the mirror's 128 numbers among them) is over it.
        expect(perDraw).toBeLessThan(64);
    });

    it("queries the page for nothing on a draw with a room's frost and name tags in view", () => {
        const { built, bodies } = crowded(OUTSIDE);
        for (let n = 0; n < 5; n++) {
            const tag = document.createElement("div");
            tag.className = "username-display";
            document.body.append(tag);
        }
        const draw = drawer(built);
        for (let i = 0; i < 120; i++) draw(i);
        const queries = vi.fn();
        const query = document.querySelectorAll.bind(document);
        document.querySelectorAll = (selector: string) => {
            queries(selector);
            return query(selector);
        };

        try {
            for (let i = 0; i < 120; i++) {
                walkSome(bodies, i);
                draw(i);
            }
        } finally {
            document.querySelectorAll = query;
        }

        expect(queries).not.toHaveBeenCalled();
    });

    // Layout reads are a browser cost this test cannot time; it bounds their number. With a locked room in view the tags
    // are measured when something moved, at most every LABEL_MEASURE_MS: 10 passes a second over 1,000 tags is 10,000
    // reads of a tag's place a second in the worst case (a walking crowd), and one pass for a still one.
    // Seen failing with the pass on every frame (`forced` always true in labelsDue): 125,000 reads in two seconds.
    describe("with 1,000 name tags on the page and a locked room in view", () => {
        const TAGS = 1000;
        const SECONDS = 2;
        const FRAMES_IN_TWO_SECONDS = Math.round((SECONDS * 1000) / FRAME_MS);

        function withTags(): { built: Built; bodies: Body[]; reads: () => number } {
            const { built, bodies } = crowded(OUTSIDE);
            let reads = 0;
            const place = { left: 60, width: 20, bottom: 40, top: 20 } as DOMRect;
            for (let n = 0; n < TAGS; n++) {
                const tag = document.createElement("div");
                tag.className = "username-display";
                tag.getBoundingClientRect = () => {
                    reads += 1;
                    return place;
                };
                document.body.append(tag);
            }
            frame(built); // the pass the new tags force
            reads = 0;
            return { built, bodies, reads: () => reads };
        }

        it("reads at most 10 passes of the tags a second for a crowd that walks", () => {
            const { built, bodies, reads } = withTags();

            for (let i = 0; i < FRAMES_IN_TWO_SECONDS; i++) {
                walkSome(bodies, i);
                frame(built);
            }

            report("tag layout reads in 2 s, 1000 tags, a locked room in view, 20 walking", { reads: reads() });
            const passes = reads() / TAGS;
            expect(passes, "the tags are measured as the crowd moves").toBeGreaterThan(SECONDS);
            expect(passes).toBeLessThanOrEqual(SECONDS * (1000 / LABEL_MEASURE_MS) + 1);
        });

        it("reads none while nothing moves", () => {
            const { built, reads } = withTags();

            for (let i = 0; i < FRAMES_IN_TWO_SECONDS; i++) frame(built);

            expect(reads()).toBe(0);
        });
    });

    it("allocates under 400 bytes a frame, the once-a-second refresh and the tile tick included, 664 pieces on the map", () => {
        const { built, bodies } = crowded();

        const bytes = allocatedBytes(() => {
            for (let i = 0; i < FRAMES; i++) {
                walkSome(bodies, i);
                frame(built);
            }
        });
        const perFrame = bytes / FRAMES;

        report("heap bytes allocated per frame, refresh and tick included, 664 pieces, 1000 remote of which 80 drawn", {
            frames: FRAMES,
            bytesPerFrame: Math.round(perFrame),
        });
        // MEASURED by this test: 258 to 335 B a frame when it runs alone (5 runs; 369 to 688 before the look at the crowd
        // was written by index and the crowd walked with forEach), 71 to 86 B in a whole-file run, where V8 has optimized
        // more by then. What is left is boxed numbers of the refresh, the mirror's pieces and the clock's look. This is a
        // coarse fence, not a tight budget: a regression of one array a frame (about 150 B) can hide under it. The tight
        // ones are the per-draw (64 B) and per-look (64 B) tests, and the construction counter (0), which caught a
        // `length = 0` plus `push` that this one did not.
        expect(perFrame).toBeLessThan(400);
    });

    // The look at the crowd (15 a second) used to empty its two lists with `length = 0` and push to them: about 2.3 KB a
    // look, MEASURED (35,520 B over the 15 looks of this file's 240-frame test). Now written by index: seen failing
    // with `length = 0` and `push` put back, at about 2.3 KB a look.
    it("allocates under 64 bytes for a look at 1,000 players of which 80 are drawn", () => {
        const people = new Map<number, RemotePlayer>();
        for (let i = 0; i < REMOTES; i++) {
            const body = new Body(i, i, i < DRAWN, []);
            body.userId = i;
            people.set(i, body as unknown as RemotePlayer);
        }
        const drawn = new DrawnPeople(people, () => undefined, 250);
        let time = 0;
        for (let i = 0; i < 600; i++) drawn.bodies((time += 250)); // warm

        const bytes = allocatedBytes(() => {
            for (let i = 0; i < 200; i++) drawn.bodies((time += 250));
        });

        report("heap bytes per look at the crowd, 1000 players of which 80 drawn", {
            bytesPerLook: Math.round(bytes / 200),
        });
        expect(drawn.bodies(time)).toHaveLength(DRAWN);
        expect(bytes / 200).toBeLessThan(64);
    });

    it("does not read a culled player or a dot between two looks at the crowd", () => {
        const { built, bodies } = crowded();
        const hidden = bodies.slice(DRAWN);
        const reads = new Set<Body>();
        for (const body of hidden) {
            Object.defineProperty(body, "visible", {
                get: () => {
                    reads.add(body);
                    return false;
                },
            });
        }

        frame(built); // one frame, well under the 250 ms between two looks

        expect(reads.size).toBe(0);
    });
});

describe("a map of 664 pieces, over the once-a-second refresh", () => {
    const SECOND_AND_A_HALF = 94; // frames of 16 ms: one refresh, or two

    /** A plant standing within reach of the glass (80 px below its foot line, 100): the mirror shows it. */
    function plantInFrontOfGlass(): number {
        for (let n = 0; n < PLACED; n++) {
            const foot = (n * 53) % 270;
            if (n % 5 === 0 && foot > GLASS_FOOT + 10 && foot < GLASS_FOOT + 70) return n;
        }
        throw new Error("no plant in front of the glass in the test's map");
    }

    function warmMap(crowdSize = 0): { built: Built; pieces: Phaser.GameObjects.Image[] } {
        const built = build(22, {}, PLACED);
        if (crowdSize > 0) crowd(built.scene, crowdSize, crowdSize);
        for (let i = 0; i < 200; i++) frame(built); // past the first refreshes
        const pieces = built.scene.list.filter(
            (o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image,
        );
        built.scene.resetMeters();
        lightRuns.fromPieces = 0;
        lightRuns.footprints = 0;
        return { built, pieces };
    }

    it("works out the footprints and the lights of the pieces again for none of 4 refreshes while none changes", () => {
        const { built } = warmMap(50);

        for (let i = 0; i < 240; i++) frame(built); // 3.84 s: 3 or 4 refreshes

        report("work over the pieces in 240 frames, none moved", {
            footprintRuns: lightRuns.footprints,
            lightRuns: lightRuns.fromPieces,
        });
        expect(lightRuns.footprints).toBe(0);
        expect(lightRuns.fromPieces).toBe(0);
    });

    // The TV slides are Images in the scene, so the placed-pieces snapshot sees them: the first refresh after they are
    // made works the lights out once more (their own key gives no light and no footprint), and from then on none.
    // With the harness's slides plain objects, as they were, this count is 1.
    it("works the pieces out twice in four seconds with TVs on the map: at the build, and once for the slides it makes", () => {
        const built = build(22, {}, PLACED);
        expect(slides(built.scene).length, "the map's TVs have slides").toBeGreaterThan(0);

        for (let i = 0; i < 250; i++) frame(built);

        report("work over the pieces from the build to 4 s, TVs on the map", {
            footprintRuns: lightRuns.footprints,
            lightRuns: lightRuns.fromPieces,
        });
        expect(lightRuns.fromPieces).toBe(2);
        expect(lightRuns.footprints).toBe(2);
    });

    it("works them out once for a piece that moves, and draws the occlusion again for it", () => {
        const { built, pieces } = warmMap();

        pieces[10].x += 40; // a footprint that moves with it
        for (let i = 0; i < SECOND_AND_A_HALF; i++) frame(built);

        expect(lightRuns.footprints).toBe(1);
        expect(lightRuns.fromPieces).toBe(1);
        expect(built.scene.dirty, "the scene is redrawn for the new shade").toBeGreaterThan(0);
    });

    it("works out the lights, not the footprints, when a meeting starts", () => {
        const { built } = warmMap();

        crowd(built.scene, 2, 2); // two people standing in the meeting room's floor (30..130 by 30..110) on one frame
        for (const body of built.scene.players.values()) Object.assign(body, { px: 60, py: 60 });
        for (let i = 0; i < SECOND_AND_A_HALF; i++) frame(built);

        expect(lightRuns.fromPieces).toBe(1);
        expect(lightRuns.footprints).toBe(0);
    });

    it("uploads no mirror texture while nothing in front of the glass changes, and the whole atlas once when a plant moves", () => {
        const { built, pieces } = warmMap(50);
        for (let i = 0; i < 240; i++) frame(built);
        const idle = built.scene.uploads.byKey.get("kfx-1-mirror") ?? 0;

        pieces[plantInFrontOfGlass()].x += 30;
        for (let i = 0; i < SECOND_AND_A_HALF; i++) frame(built);
        const moved = built.scene.uploads.byKey.get("kfx-1-mirror") ?? 0;

        report("mirror atlas bytes uploaded: 240 idle frames, then a plant moves", { idle, moved });
        expect(idle).toBe(0);
        expect(moved, "the whole atlas, 400 x 128 px of four bytes, once").toBe(400 * 128 * 4);
    });

    // The milliseconds are reported, not asserted: this host runs at a load of 20 to 260, and a time (or a ratio of two)
    // there says nothing about the code. What bounds the cost of a frame are the counts and bytes asserted above.
    it("reports the milliseconds a frame takes in Node with mocks (none asserted), and tells the refresh frames apart", () => {
        const { built, bodies } = (() => {
            const warm = warmMap();
            return { built: warm.built, bodies: crowd(warm.built.scene, 1000, 80) };
        })();
        for (let i = 0; i < 300; i++) frame(built);
        const others: number[] = [];
        const refreshes: number[] = [];

        for (let i = 0; i < 1600; i++) {
            for (let n = 0; n < 20; n++) bodies[n].walk(i % 2 === 0 ? 1 : -1);
            // the once-a-second refresh runs on the frame whose time crosses a whole second
            const refreshing = Math.floor((built.time + FRAME_MS) / 1000) > Math.floor(built.time / 1000);
            const start = performance.now();
            frame(built);
            (refreshing ? refreshes : others).push(performance.now() - start);
        }

        const at = (times: readonly number[], q: number): number => {
            const sorted = [...times].sort((a, b) => a - b);
            return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 1000) / 1000;
        };
        report("ms per frame in Node with mocks (no GPU, no browser), 664 pieces, 1000 remote of which 80 drawn", {
            frames: others.length,
            avg: others.reduce((sum, ms) => sum + ms, 0) / others.length,
            p50: at(others, 0.5),
            p95: at(others, 0.95),
            p99: at(others, 0.99),
            max: at(others, 1),
            refreshFrames: refreshes.length,
            refreshAvg: refreshes.reduce((sum, ms) => sum + ms, 0) / refreshes.length,
            refreshP50: at(refreshes, 0.5),
            refreshP95: at(refreshes, 0.95),
            refreshP99: at(refreshes, 0.99),
            refreshMax: at(refreshes, 1),
        });
        expect(refreshes.length, "the refresh frames were told apart").toBeGreaterThan(20);
        expect(others.length, "and the ordinary frames").toBeGreaterThan(1000);
    });
});

/**
 * Every texture the effects put on the GPU, and when each can fire. The meter counts four bytes a pixel, whole, for each
 * texture added and each canvas texture refreshed. MEASURED here on mocks (no GPU, no browser): the counts and bytes the
 * effects ask Phaser to upload, not how long a GPU takes to take them.
 */
describe("every texture upload of the effects, and what makes each fire", () => {
    const SMALL = { map: 400 * 300 * 4, occ: 200 * 150 * 4, atlas: 400 * 128 * 4 };
    const WARM = 600; // frames of 16 ms: the first refreshes, V8's optimizing compiler
    const FRAMES = 480; // 7.68 s: seven refreshes, 31 looks at the crowd
    const MEETING_ROOM = { x: 60, y: 60 };

    const total = (built: Built): number => built.scene.uploads.bytes;
    const keys = (built: Built): string[] => [...built.scene.uploads.byKey.keys()];

    /** Lets the first refreshes pass, then starts counting. */
    function settle(built: Built): void {
        for (let i = 0; i < WARM; i++) frame(built);
        built.scene.resetMeters();
        lightRuns.fromPieces = 0;
        lightRuns.footprints = 0;
    }

    function tvInTheMeetingRoom(scene: MeterScene): Phaser.GameObjects.Image {
        // piece 12..15 are the test map's TVs: this one hangs at (70, 60), its screen over the room's floor
        const tv = Object.assign(placedImage(12), { x: 70, y: 60 });
        scene.list.push(tv);
        scene.entities.set("meeting-tv", tv);
        return tv;
    }

    function uNight(): unknown {
        return camera.sources.at(-1)?.postUniforms().uNight;
    }

    it("puts at the build one picture of each effect texture and two canvases, each once", () => {
        const built = build(22);

        expect(Object.fromEntries(built.scene.uploads.byKey)).toEqual({
            "kfx-1-water": 100 * 80 * 4,
            "kfx-1-water-data": 100 * 80 * 4,
            "kfx-1-glass": SMALL.map,
            "kfx-1-masks": SMALL.map,
            "kfx-1-tv-slide": 24 * 16 * 4,
            "kfx-1-occluders": SMALL.occ,
            "kfx-1-occ": SMALL.occ, // the occlusion field's canvas: blank, nothing is placed
            "kfx-1-mirror": SMALL.atlas, // the pieces' atlas, painted black before it is a texture: one upload, not two
        });
        for (const name of EFFECT_TEXTURES) expect(keys(built)).toContain(`kfx-1-${name}`);
    });

    it("puts the optional normal map on the GPU at the build only when the room has one, and no other texture", () => {
        const without = build(22);
        const withNormal = build(22, {}, 0, { normal: true });

        expect(keys(without)).not.toContain("kfx-1-normal");
        expect(withNormal.scene.uploads.byKey.get("kfx-1-normal")).toBe(SMALL.map);
        expect(total(withNormal) - total(without)).toBe(SMALL.map);
    });

    // DERIVED from .local/konclui/asset-build/maps/konclui-office/fx/: the office's pictures are 2752 x 1792 (glass,
    // masks, the optional normal), 1376 x 896 (occluders), 480 x 1024 (water, water-data), 43 x 23 (the slide), and its
    // five glass faces stand on three rows, so the atlas is 2752 x 3 x 128. MEASURED here: the meter's bytes.
    it("at the office's own sizes puts 57,479,028 B on the GPU at the build (77,205,364 with the normal map) and 0 on a frame", () => {
        const built = build(22, {}, 0, { size: OFFICE });
        const withNormal = build(22, {}, 0, { size: OFFICE, normal: true });

        expect(Object.fromEntries(built.scene.uploads.byKey)).toEqual({
            "kfx-1-water": 1_966_080,
            "kfx-1-water-data": 1_966_080,
            "kfx-1-glass": 19_726_336,
            "kfx-1-masks": 19_726_336,
            "kfx-1-tv-slide": 3_956,
            "kfx-1-occluders": 4_931_584,
            "kfx-1-occ": 4_931_584,
            "kfx-1-mirror": 4_227_072,
        });
        expect(total(built)).toBe(57_479_028);
        expect(total(withNormal)).toBe(77_205_364);
        report("bytes put on the GPU at the build, the office's sizes", {
            without: total(built),
            withNormal: total(withNormal),
        });
        built.scene.resetMeters();
        for (let i = 0; i < 120; i++) frame(built);
        expect(total(built)).toBe(0);
    });

    // A map with its pieces already placed (the real office places 664): the occlusion field is painted before it is a
    // texture, so its first upload is the finished field and the first refresh does not upload the same canvas again.
    // Seen failing with the build's paint taken out (the first refresh painting it and refreshing the texture):
    // "kfx-1-occ": 9,863,168, and the total 62,410,612 B, which was the real build's figure before this was fixed.
    it("puts the occlusion field on the GPU once at the build of a map with 664 pieces: 4,931,584 B at the office's size", () => {
        const built = build(22, {}, PLACED, { size: OFFICE });

        expect(built.scene.uploads.byKey.get("kfx-1-occ")).toBe(4_931_584);
        expect(total(built), "the same total as an empty map: nothing is uploaded twice").toBe(57_479_028);
        expect(lightRuns.footprints, "the pieces were read once at the build").toBe(1);
        built.scene.resetMeters();
        for (let i = 0; i < 120; i++) frame(built);
        expect(total(built)).toBe(0);
    });

    // A piece standing at the glass when the effects are built is in the atlas the first time it is uploaded. DERIVED
    // size at the office: 2752 x 3 rows of glass x 128 x 4 B = 4,227,072 B. Seen failing with the build's paint taken out
    // (the first refresh painting it and refreshing the texture): 8,454,144 B for the atlas.
    it("puts the mirror atlas, with the pieces at the glass in it, on the GPU once at the build: 4,227,072 B at the office's size", () => {
        const plant = {
            visible: true,
            active: true,
            displayWidth: 16,
            displayHeight: 32,
            x: 900,
            y: 282, // 30 px in front of the glass face [608, 1312] standing at 252
            originX: 0.5,
            originY: 1,
            texture: { key: "plant" },
            frame: { name: 1 },
            flipX: false,
            scaleX: 1,
            scaleY: 1,
            getPrefab: () => ({ name: "planta", tags: ["Plantas"] }),
        };
        const built = build(22, {}, 0, { size: OFFICE, entities: new Map([["plant", plant]]) });

        expect(built.scene.uploads.byKey.get("kfx-1-mirror")).toBe(4_227_072);
        built.scene.resetMeters();
        for (let i = 0; i < 120; i++) frame(built);
        expect(total(built), "the first refresh paints nothing again").toBe(0);
    });

    describe("a brand piece in front of the glass (its back is a canvas texture of its own)", () => {
        const brand = (x: number) => ({
            visible: true,
            active: true,
            displayWidth: 16,
            displayHeight: 32,
            x,
            y: GLASS_FOOT + 30,
            originX: 0.5,
            originY: 1,
            texture: { key: "brand" },
            frame: { name: 1 },
            flipX: false,
            scaleX: 1,
            scaleY: 1,
            getPrefab: () => ({ name: "marca", tags: ["Peças da marca"] }),
        });
        const BACK = 4 * 4 * 4; // the test frame is 4 x 4 px, scale 1

        it("is uploaded once at the build, with the atlas, and not again while nothing changes", () => {
            const built = build(22, {}, 0, { entities: new Map([["marca", brand(200)]]) });

            expect(built.scene.uploads.byKey.get("kfx-1-mirror-back-0"), "one small texture, once").toBe(BACK);
            expect(built.scene.uploads.byKey.get("kfx-1-mirror")).toBe(SMALL.atlas);
            built.scene.resetMeters();
            for (let i = 0; i < 240; i++) frame(built);
            expect(total(built)).toBe(0);
        });

        it("is made again, with the atlas, when the atlas is painted again: one back texture of the piece's size each time", () => {
            const entity = brand(200);
            const built = build(22);
            built.scene.entities = new Map([["marca", entity]]);
            for (let i = 0; i < 70; i++) frame(built); // the first refresh after the piece came paints it
            built.scene.resetMeters();

            entity.x = 260;
            for (let i = 0; i < 70; i++) frame(built); // the next refresh sees it moved

            report("a brand piece moves at the glass: texture bytes", Object.fromEntries(built.scene.uploads.byKey));
            expect(Object.fromEntries(built.scene.uploads.byKey)).toEqual({
                "kfx-1-mirror": SMALL.atlas,
                "kfx-1-mirror-back-0": BACK,
            });
            expect(built.scene.uploads.uploads).toBe(2);
        });
    });

    it.each([
        ["by day", 12],
        ["at night", 22],
    ])(
        "puts 0 bytes on the GPU in 480 frames of 1,000 remote players, 80 drawn, 20 walking at the glass, %s",
        (_, hour) => {
            const built = build(hour, {}, PLACED);
            built.scene.current.player = {
                x: 250,
                y: 120,
                visible: true,
                list: [figureLayer("me")],
            } as unknown as Player;
            const bodies = crowd(built.scene, 1000, 80);
            settle(built);

            for (let i = 0; i < FRAMES; i++) {
                for (let n = 0; n < 20; n++) bodies[n].walk(i % 2 === 0 ? 1 : -1);
                frame(built);
            }

            report("bytes put on the GPU in 480 frames, 664 pieces, 1000 remote of which 80 drawn", {
                bytes: total(built),
                uploads: built.scene.uploads.uploads,
            });
            expect(total(built)).toBe(0);
            expect(built.scene.uploads.uploads).toBe(0);
            const reflections = built.scene.list.find((o) => o instanceof MeterObject && o.children.length > 0);
            expect(
                (reflections as MeterObject).children.some((child) => child.visible),
                "they were reflected",
            ).toBe(true);
        },
    );

    it("puts 0 bytes on the GPU when a meeting starts and its TV turns on", () => {
        const built = build(22, {}, PLACED);
        tvInTheMeetingRoom(built.scene);
        const bodies = crowd(built.scene, 1000, 80);
        // nobody in the room: the crowd's drawn players stand in the hall below it, apart from the two who will come
        for (const body of bodies) Object.assign(body, { py: 250 });
        settle(built);
        expect(slides(built.scene).length, "the TV's slide exists, dark").toBeGreaterThan(0);
        expect(slides(built.scene).every((slide) => !slide.visible)).toBe(true);

        bodies[0].moveTo(MEETING_ROOM.x);
        bodies[1].moveTo(MEETING_ROOM.x + 10);
        Object.assign(bodies[0], { py: MEETING_ROOM.y });
        Object.assign(bodies[1], { py: MEETING_ROOM.y });
        for (let i = 0; i < 100; i++) frame(built);

        expect(
            slides(built.scene).some((slide) => slide.visible),
            "the TV turned on",
        ).toBe(true);
        expect(total(built)).toBe(0);
        expect(lightRuns.footprints, "no footprint changed").toBe(0);
    });

    it("puts 0 bytes on the GPU when night falls, and the light is drawn for it", () => {
        let hour = 12;
        const built = build(12, {}, PLACED, { hourNow: () => hour });
        crowd(built.scene, 1000, 80);
        settle(built);
        expect(uNight()).toBe(0);

        hour = 22;
        for (let i = 0; i < 100; i++) frame(built);

        expect(uNight(), "night: the lamps are lit").toBeGreaterThan(0.9);
        expect(built.scene.dirty).toBeGreaterThan(0);
        expect(total(built)).toBe(0);
    });

    it("puts 0 bytes on the GPU when a door swaps its sprite or a locked room is opened and closed", () => {
        const built = build(22, {}, PLACED);
        const door = built.scene.list.find(
            (o): o is Phaser.GameObjects.Image =>
                o instanceof Phaser.GameObjects.Image && o.texture.key === spriteKey(4),
        );
        const lock = built.scene.list.find(
            (o) =>
                typeof o === "object" &&
                o !== null &&
                (o as { layer?: { name: string } }).layer?.name === "lock-meeting",
        ) as { visible: boolean } | undefined;
        expect(door, "a piece without a footprint (the test map's pieces 4, 9, 14...)").toBeDefined();
        settle(built);

        (door as unknown as { texture: { key: string } }).texture = { key: spriteKey(9) }; // open: another sprite, no footprint
        for (let i = 0; i < 100; i++) frame(built);
        expect(lightRuns.footprints, "the swap was seen").toBe(1);
        lock!.visible = false;
        for (let i = 0; i < 100; i++) frame(built);
        lock!.visible = true;
        for (let i = 0; i < 100; i++) frame(built);

        expect(total(built)).toBe(0);
    });

    it("puts the occlusion field's whole canvas once on the GPU for a footprint that moves, 0 for another that does not", () => {
        const built = build(22, {}, PLACED);
        crowd(built.scene, 1000, 80);
        settle(built);
        const piece = built.scene.list.find(
            (o): o is Phaser.GameObjects.Image =>
                o instanceof Phaser.GameObjects.Image && o.texture.key === spriteKey(1),
        );

        piece!.x += 40; // a sprite with a footprint, away from the glass
        for (let i = 0; i < 200; i++) frame(built);

        report("bytes put on the GPU for one footprint that moves (the occlusion canvas, whole)", {
            bytes: total(built),
            uploads: built.scene.uploads.uploads,
        });
        expect(Object.fromEntries(built.scene.uploads.byKey)).toEqual({ "kfx-1-occ": SMALL.occ });
    });

    // The two canvases that can still be uploaded whole during play (Phaser 4.2.1 has no sub-rectangle upload) can only
    // be uploaded by the once-a-second refresh, never by a frame, and at most once for each refresh however often the
    // pieces change in between. Worst case, DERIVED at the office's sizes: 4,931,584 B (occlusion) + 4,227,072 B (atlas)
    // = 9,158,656 B once a second, and only while pieces keep changing. Seen failing with the occlusion painted and
    // refreshed on each frame a piece changed: 240 uploads, not 4.
    it("uploads the occlusion field at most once for each refresh, on the refresh's frame, for a piece that changes on every frame", () => {
        const built = build(22, {}, PLACED);
        settle(built);
        const piece = built.scene.list.find(
            (o): o is Phaser.GameObjects.Image =>
                o instanceof Phaser.GameObjects.Image && o.texture.key === spriteKey(1),
        ) as unknown as { texture: { key: string } };
        const uploadedOnFrames: number[] = [];
        const occ = (): number => built.scene.uploads.byKey.get("kfx-1-occ") ?? 0;

        for (let i = 0; i < 240; i++) {
            piece.texture = { key: spriteKey(i % 2 === 0 ? 4 : 1) }; // a footprint, then none, then a footprint
            const before = occ();
            const refreshing = Math.floor((built.time + FRAME_MS) / 1000) > Math.floor(built.time / 1000);
            frame(built);
            if (occ() > before) uploadedOnFrames.push(refreshing ? 1 : 0);
        }

        report("occlusion uploads in 240 frames of a piece that changes on every frame", {
            uploads: uploadedOnFrames.length,
            bytes: occ(),
        });
        expect(uploadedOnFrames.length, "it did upload").toBeGreaterThan(0);
        expect(uploadedOnFrames.length, "at most one for each of the 3 or 4 refreshes").toBeLessThanOrEqual(4);
        expect(
            uploadedOnFrames.every((on) => on === 1),
            "only on a refresh's frame",
        ).toBe(true);
        expect(occ()).toBe(uploadedOnFrames.length * SMALL.occ);
    });

    it("puts the mirror atlas's whole canvas once on the GPU for a piece at the glass that moves, and again for each switch of the reflections", () => {
        const built = build(22, {}, PLACED);
        settle(built);
        const plant = built.scene.list.find(
            (o): o is Phaser.GameObjects.Image =>
                o instanceof Phaser.GameObjects.Image && o.texture.key === spriteKey(30),
        );
        plant!.y = GLASS_FOOT + 30; // within reach of the glass: the mirror shows it
        for (let i = 0; i < 100; i++) frame(built);
        expect(built.scene.uploads.byKey.get("kfx-1-mirror"), "the piece appears in the mirror").toBe(SMALL.atlas);
        built.scene.resetMeters();

        built.effects.setFeatures({ ...parseFeatures(null), reflections: false });
        expect(built.scene.uploads.byKey.get("kfx-1-mirror"), "switched off: the atlas is emptied").toBe(SMALL.atlas);
        for (let i = 0; i < 100; i++) frame(built);
        built.effects.setFeatures({ ...parseFeatures(null), reflections: true });
        for (let i = 0; i < 100; i++) frame(built);

        expect(built.scene.uploads.byKey.get("kfx-1-mirror"), "switched off, then on: two uploads").toBe(
            2 * SMALL.atlas,
        );
    });
});

describe("the lights, with a still camera at night", () => {
    it("filters the lights again for none of 100 footsteps", () => {
        const built = build(22);
        const bodies = crowd(built.scene, 100, 100);
        for (let i = 0; i < 80; i++) frame(built); // past the first refresh, which finds a meeting in the room
        lightRuns.count = 0;
        lightRuns.rects = 0;

        for (let i = 0; i < 100; i++) {
            bodies[i % bodies.length].walk(1); // a footstep: someone moved, the scene is drawn
            frame(built);
        }

        report("light and glow filter runs per 100 footsteps, still camera", {
            lights: lightRuns.count,
            glows: lightRuns.rects,
        });
        expect(lightRuns.count).toBe(0);
        // the glow rects are cached by the camera's cell as the lights are: one run per cell, not one per footstep
        expect(lightRuns.rects).toBe(0);
    });

    it("filters again when the camera crosses a cell of the cache", () => {
        const built = build(22);
        for (let i = 0; i < 10; i++) frame(built);
        lightRuns.count = 0;

        lightRuns.rects = 0;
        built.scene.view.x += 200;
        frame(built);

        expect(lightRuns.count).toBe(1);
        expect(lightRuns.rects).toBe(1);
    });
});

describe("the effects' own switches", () => {
    it("still keep the reflections off with their switch", () => {
        const built = build(12, { reflections: false });
        const bodies = crowd(built.scene, 10, 10);
        for (const body of bodies) body.walk(1);
        frame(built);
        const mirror = built.scene.list.find((object) => object instanceof MeterObject && object.children.length > 0);
        expect(mirror === undefined || (mirror as MeterObject).visible === false).toBe(true);
    });
});
