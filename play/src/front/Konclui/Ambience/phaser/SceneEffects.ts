// The office's shaders in a game scene, for a room whose map folder has fx/manifest.json (hq-office fx.py):
//   water   a shader quad over the pool's open water, above the decor layer: refraction, caustics, glints, ripples
//   ground  a quad over the floor and lawn, under everything standing: soft shade at the foot of walls, furniture and
//           trees (cast away from the late sun) and under people
//   glass   a quad over the glass panes, above the doors layer: the tint, the mirror's pieces and a sheen that slides as
//           the camera moves
//   mirror  who and what stands in front of a glass face, seen from its other side (domain/mirror): the pieces painted
//           once into an atlas the glass quad draws (no draw call of its own), people as pictures right above the glass
//           quad, each cropped to the panes it crosses (one draw call while any shows)
//   post    one camera filter: locked rooms blurred into blocks from outside, avatars mirrored on the polished floor,
//           pressed grass behind walkers, cloud shadows, daylight and lamps by Brasília's hour, the focus vignette and
//           the arrival iris
//   tv      a meeting room's TV shows the K slide (and lights the room at night) while two or more people are in it
// Redraws: the engine draws only a dirty scene. Timed effects step with the tile animation clock and only while seen;
// state changes (hour, lock, meeting, focus) mark the scene dirty once; the camera already redraws whatever depends on
// it. Movement stops with "Disable map animations" and reduced motion; the water then shows the still floor it covers.
import * as Phaser from "phaser";
import type { RemotePlayer } from "../../../Phaser/Entity/RemotePlayer";
import type { Player } from "../../../Phaser/Player/Player";
import type { GameMapFrontWrapper } from "../../../Phaser/Game/GameMap/GameMapFrontWrapper";
import type { EffectTexture, EffectsManifest } from "../domain/effectsManifest";
import { EFFECT_TEXTURES } from "../domain/effectsManifest";
import type { FeatureSwitches } from "../../Preferences/domain/effectSwitches";
import { coverage, inside, occupancy, type Box, type Rect } from "../domain/geometry";
import { footprints } from "../domain/groundShadow";
import {
    EMISSIVE_TINTS,
    lightsFrom,
    specKey,
    staticLights,
    visibleLights,
    visibleRects,
    type EmissiveRect,
    type Light,
    type SpriteSpec,
} from "../domain/lights";
import {
    MIRROR_REACH,
    mirrorAlpha,
    mirrorFace,
    mirrorFoot,
    mirrorFrame,
    mirrorsPiece,
    type FrameName,
    type GlassFace,
} from "../domain/mirror";
import { CloudClock, motionAllowed, progress } from "../domain/motion";
import {
    glassPanes,
    glassRowTop,
    maskAt,
    measureFootprint,
    packMasks,
    paintBackOf,
    starSlots,
    type GlassPane,
    type MaskBits,
} from "../domain/pixelMaps";
import { GLASS, GROUND, WATER } from "../domain/shaders";
import { isPlainDay, localHour, lookAt, type Look, type Rgb } from "../domain/timeOfDay";
import { Trail } from "../domain/trail";
import { addPostFilter, type UniformValue } from "./postFilter";
import { SceneResources } from "./SceneResources";

/** What the effects read from the page and the user's settings on each use. */
export interface EffectsEnvironment {
    /** `prefers-reduced-motion: reduce`. */
    reducedMotion(): boolean;
    /** WorkAdventure's "Disable map animations". */
    animationsOff(): boolean;
    /** An hour fixed for QA, or undefined for Brasília's clock. */
    fixedHour(): number | undefined;
    /** Whether the user's desk is in focus (the vignette). */
    focused(): boolean;
}

/**
 * What the effects use of the game scene: the factories and the texture manager they build with, the display list, the
 * pre-render event, the main camera (its filter list holds the camera pass), the map and the players. The game scene is
 * one, so production passes it as it is; a test hands over a made object, to see what the effects give back.
 */
export interface EffectsHost {
    readonly add: Pick<Phaser.GameObjects.GameObjectFactory, "shader" | "container" | "image">;
    readonly textures: Pick<
        Phaser.Textures.TextureManager,
        "addImage" | "addCanvas" | "get" | "getFrame" | "exists" | "remove"
    >;
    readonly children: Pick<Phaser.GameObjects.DisplayList, "list">;
    readonly events: {
        on(event: string, listener: () => void): unknown;
        off(event: string, listener: () => void): unknown;
    };
    readonly cameras: { readonly main: Phaser.Cameras.Scene2D.Camera };
    readonly game: { readonly canvas: HTMLCanvasElement };
    readonly MapPlayersByKey: ReadonlyMap<number, RemotePlayer>;
    /** The scene creates the current player after the map: undefined until then. */
    readonly CurrentPlayer: Player | undefined;
    markDirty(): void;
    getGameMapFrontWrapper(): Pick<
        GameMapFrontWrapper,
        "phaserLayers" | "getTileAnimationRefreshDelay" | "getEntitiesManager"
    >;
}

export interface SceneEffectsOptions {
    readonly scene: EffectsHost;
    readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
    readonly manifest: EffectsManifest;
    readonly images: Readonly<Record<EffectTexture, HTMLImageElement>>;
    /** Makes the texture keys of this attach unique. */
    readonly generation: number;
    readonly features: FeatureSwitches;
    readonly environment: EffectsEnvironment;
    /** The frame time the effects start at, in ms. */
    readonly time: number;
    /** Plays the arrival iris (once per page). */
    readonly reveal: boolean;
}

type RenderableLayer = GameMapFrontWrapper["phaserLayers"][number];

type Layered = Phaser.GameObjects.GameObject & { depth: number; setDepth(value: number): unknown };

interface Person {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly me: boolean;
}

/** A picture in the mirror. */
interface MirrorPicture {
    readonly key: string;
    readonly frame: FrameName | undefined;
    readonly x: number;
    readonly y: number;
    readonly originX: number;
    readonly originY: number;
    readonly flip: boolean;
    readonly alpha: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly face: GlassFace;
    /** A brand piece, shown from its back. */
    readonly back: boolean;
    /** From the glass, so the nearer covers the farther. */
    readonly distance: number;
}

interface MirrorPiece {
    readonly face: GlassFace;
    readonly picture: MirrorPicture;
}

interface PlacedMirrorPicture {
    readonly key: string;
    readonly frame: FrameName | undefined;
    readonly left: number;
    readonly top: number;
    readonly w: number;
    readonly h: number;
    readonly alpha: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly face: GlassFace;
    readonly distance: number;
    /** A piece drawn here only on the live panes; the atlas draws it elsewhere. */
    readonly only?: ReadonlySet<GlassPane>;
}

interface FrameState {
    readonly view: Rect;
    readonly look: Look;
    readonly locks: Rect[];
    readonly mirrored: Person[];
    readonly reveal: number;
    readonly clouds: number;
    readonly me: Person | undefined;
    readonly lit: Light[];
    readonly glow: EmissiveRect[];
}

interface KoiSchool {
    readonly school: { snapshot(): { fish: readonly { x: number; y: number; depth: number }[] } };
    readonly scene: { origin: readonly [number, number]; width: number };
    readonly masks?: { open?: ArrayLike<number> };
}

const hex = (h: string): Rgb => [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
];
// The water's tones as the shader paints them (shallow -> deep): pool.WATER, more saturated, as in the dream target.
const WATER_GRADE = ["#6ee6d1", "#3ad0c0", "#14b8b0", "#08a5a2", "#05888a", "#046e73", "#02525a", "#01404b"].map(hex);
const WATER_HALF = ["#7ee6d2", "#54dbc8", "#27c4b8", "#0eaea9", "#069696", "#047b7e", "#036066", "#024952"].map(hex);
const CAUSTIC = { core: hex("#a8f8e6"), halo: hex("#4fd8c6"), white: hex("#e9fff7") };
const KOI_RING = [hex("#14c8cc"), hex("#5fe0e4")];
const TRAIL_COLOURS = { lime: hex("#96d664"), cream: hex("#f0f091") };
// A reflection is cooled a little toward the glass's blue.
const MIRROR_TINT = 0xeef4f8;
const MIRROR_TINT_RGB: Rgb = [0xee / 255, 0xf4 / 255, 0xf8 / 255];
const EMISSIVE_TINT_TABLE = new Float32Array(EMISSIVE_TINTS.flat());
const KOI_ROOM: readonly (readonly [number, number])[] = [
    [-12, 0],
    [12, 0],
    [0, -12],
    [0, 12],
    [-9, -9],
    [9, 9],
    [9, -9],
    [-9, 9],
    [-24, 0],
    [24, 0],
    [0, -24],
    [0, 24],
];
const KOI_FRAMES = 'iframe[src*="/koi/"]';
const REFRESH_MS = 1000;

function context2d(canvas: HTMLCanvasElement, willReadFrequently = false): CanvasRenderingContext2D {
    const ctx = canvas.getContext("2d", { willReadFrequently });
    if (!ctx) throw new Error("[konclui] effects: no 2D canvas context");
    return ctx;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function readPixels(image: HTMLImageElement | HTMLCanvasElement): ImageData {
    const ctx = context2d(makeCanvas(image.width, image.height), true);
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, image.width, image.height);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Whether what a koi page shares is a school the rings can read: a `snapshot()`, the scene's origin and width as
 * numbers (the rings' positions and the mask's row length come from them, and a bad one gives NaN), and, when there
 * is a mask of open water, one that can be indexed.
 */
export function isKoiSchool(value: unknown): value is KoiSchool {
    if (typeof value !== "object" || value === null) return false;
    const school: unknown = Reflect.get(value, "school");
    const scene: unknown = Reflect.get(value, "scene");
    const masks: unknown = Reflect.get(value, "masks");
    if (typeof school !== "object" || school === null || typeof Reflect.get(school, "snapshot") !== "function") {
        return false;
    }
    if (typeof scene !== "object" || scene === null || !isFiniteNumber(Reflect.get(scene, "width"))) return false;
    const origin: unknown = Reflect.get(scene, "origin");
    if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(isFiniteNumber)) return false;
    if (masks === undefined || masks === null) return true;
    if (typeof masks !== "object") return false;
    const open: unknown = Reflect.get(masks, "open");
    return open === undefined || Array.isArray(open) || ArrayBuffer.isView(open);
}

export class SceneEffects {
    readonly scene: EffectsHost;
    private readonly renderer: Phaser.Renderer.WebGL.WebGLRenderer;
    private readonly manifest: EffectsManifest;
    private readonly environment: EffectsEnvironment;
    private readonly resources: SceneResources;
    private readonly keys = new Map<string, string>();
    private readonly layers = new Map<string, RenderableLayer>();
    private readonly mapW: number;
    private readonly mapH: number;
    private readonly masks: MaskBits;
    private readonly occWalls: HTMLImageElement;
    private readonly occDraw: HTMLCanvasElement;
    private readonly occCanvas: HTMLCanvasElement;
    private readonly occTexture: Phaser.Textures.CanvasTexture;
    private occRaw: HTMLCanvasElement | undefined;
    private occSignature = "";
    private readonly stars: Float32Array;
    private readonly statics: Light[];
    private pools: Light[];
    private emissive: EmissiveRect[] = [];
    private rings: { x: number; y: number; tick: number; seed: number }[] = [];
    private hiddenLabels = new Set<HTMLElement>();
    // 32 steps 9 px apart: the trail's old length (48 x 6 px) in two thirds of the shader's vectors (plans/decor/001).
    private readonly trail = new Trail({ spacing: 9, max: 32 });
    private readonly clouds = new CloudClock();
    private waterTick = 0;
    private readonly vignette = { value: 0, from: 0, to: 0, at: 0 };
    private revealState = { at: 0, running: false };
    private readonly tvs = new Map<Phaser.GameObjects.Image, Phaser.GameObjects.Image>();
    private lightSignature = "";
    private look: Look;
    private lookKey: string;
    private features: FeatureSwitches;
    private measured: Record<string, Box | null> = {};
    private frameState: FrameState | undefined;
    private now: number;
    private lastRefresh: number;
    private lastTick: number;
    private readonly tickDelay: number | undefined;
    private animateUntil = 0;
    private animating = false;

    private readonly water: Phaser.GameObjects.Shader;
    private readonly ground: Phaser.GameObjects.Shader;
    private readonly glass: Phaser.GameObjects.Shader;
    private readonly post: Phaser.Filters.Controller;

    // the mirror
    private readonly mirror: Phaser.GameObjects.Container;
    private readonly mirrorPanes = new Map<GlassFace, GlassPane[]>();
    private readonly mirrorPool: Phaser.GameObjects.Image[] = [];
    private mirrorPieces: MirrorPiece[] = [];
    private mirrorSignature: string | undefined;
    private readonly mirrorFlips = new Map<string, string | null>();
    // the panes drawn by the container (drawMirror)
    private readonly mirrorLive = new Float32Array(32);
    private mirrorLiveN = 0;
    private readonly mirrorRows: number[];
    private readonly mirrorAtlas: HTMLCanvasElement;
    private readonly mirrorTexture: Phaser.Textures.CanvasTexture;
    private mirrorTmp: HTMLCanvasElement | undefined;
    private mirrorStatic = false;
    private mirrorShown = 0;

    private readonly onPreRender = (): void => this.frame();

    constructor(options: SceneEffectsOptions) {
        const { scene, manifest, images, generation } = options;
        this.scene = scene;
        this.renderer = options.renderer;
        this.manifest = manifest;
        this.environment = options.environment;
        this.features = options.features;
        this.now = options.time;
        this.lastRefresh = options.time;
        this.lastTick = options.time;
        this.resources = new SceneResources(scene.textures);
        const wrapper = scene.getGameMapFrontWrapper();
        for (const layer of wrapper.phaserLayers) this.layers.set(layer.layer.name, layer);
        this.tickDelay = wrapper.getTileAnimationRefreshDelay();
        [this.mapW, this.mapH] = manifest.map;
        this.look = lookAt(this.hour(), this.features);
        this.lookKey = JSON.stringify(this.look);
        // Registered first, so that a failure while building still gives back what was made so far.
        this.resources.onRelease(() => this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.onPreRender));
        this.resources.onRelease(() => this.restorePage());
        try {
            for (const name of EFFECT_TEXTURES) {
                const key = `kfx-${generation}-${name}`;
                const texture = scene.textures.addImage(key, images[name]);
                if (!texture) throw new Error(`[konclui] effects: the texture ${key} already exists`);
                this.addKey(name, key);
                texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // whole art pixels
            }
            this.masks = packMasks(readPixels(images.masks));
            // The occlusion field: the walls (occluders.png, half the map's size, at half weight) and every standing
            // object's footprint, blurred in green (red keeps them sharp), drawn on a canvas whenever something moves
            // and read by the ground quad under the sprites, banded there.
            this.occWalls = images.occluders;
            this.occDraw = makeCanvas(images.occluders.width, images.occluders.height);
            this.occCanvas = makeCanvas(images.occluders.width, images.occluders.height);
            this.occTexture = this.addCanvasTexture("occ", `kfx-${generation}-occ`, this.occCanvas);
            this.occTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
            this.stars = starSlots(readPixels(images["water-data"]));
            this.statics = staticLights(manifest.staticLights);
            this.pools = this.statics;
            this.water = this.buildWater();
            this.ground = this.buildGround();
            const mirror = this.buildMirror(images.glass, generation);
            this.mirror = mirror.container;
            this.mirrorRows = mirror.rows;
            this.mirrorAtlas = mirror.atlas;
            this.mirrorTexture = mirror.texture;
            this.paintMirror([]);
            this.glass = this.buildGlass();
            this.placeAbove(this.mirror, this.glass);
            this.post = addPostFilter(this.renderer, scene.cameras.main, {
                postUniforms: () => this.postUniforms(),
                masksTexture: () => this.texture("masks"),
            });
            const post = this.post;
            this.resources.onRelease(() => this.scene.cameras.main.filters.internal.remove(post, true));
            scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.onPreRender);
            this.refresh(true);
            if (options.reveal) this.startReveal();
        } catch (error: unknown) {
            this.resources.release();
            throw error;
        }
    }

    /** Called on each game step with the frame time: the once-a-second refresh, the tile clock and transitions. */
    onFrame(time: number): void {
        this.now = time;
        // Both clocks advance by their own period, not to the frame time, so a frame that lands late does not slow
        // them; one that is more than four periods behind (a hidden tab) starts over instead of catching up.
        if (time - this.lastRefresh >= REFRESH_MS) {
            this.lastRefresh += REFRESH_MS;
            if (time - this.lastRefresh > REFRESH_MS * 4) this.lastRefresh = time;
            this.refresh(false);
        }
        if (this.tickDelay !== undefined && time - this.lastTick >= this.tickDelay) {
            this.lastTick += this.tickDelay;
            if (time - this.lastTick > this.tickDelay * 4) this.lastTick = time;
            if (!this.environment.animationsOff() && this.tick(this.tickDelay)) this.scene.markDirty();
        }
        if (this.animating) {
            this.scene.markDirty();
            if (time >= this.animateUntil) this.animating = false;
        }
    }

    /** The effect switches changed: applied at once. */
    setFeatures(features: FeatureSwitches): void {
        this.features = features;
        this.refresh(true);
    }

    destroy(): void {
        this.resources.release();
        this.scene.markDirty();
    }

    // ------------------------------------------------------------------------------------------------ objects

    private addKey(name: string, key: string): string {
        this.keys.set(name, key);
        return this.resources.texture(key);
    }

    private addCanvasTexture(name: string, key: string, canvas: HTMLCanvasElement): Phaser.Textures.CanvasTexture {
        const texture = this.scene.textures.addCanvas(key, canvas);
        if (!texture) throw new Error(`[konclui] effects: the texture ${key} already exists`);
        this.addKey(name, key);
        return texture;
    }

    private key(name: string): string {
        const key = this.keys.get(name);
        if (key === undefined) throw new Error(`[konclui] effects: no texture named ${name}`);
        return key;
    }

    private texture(name: string): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null {
        return this.scene.textures.get(this.key(name)).get().source.glTexture;
    }

    /**
     * Puts an object right above another in the drawing order (Phaser's moveAbove only lifts what is below): the same
     * depth, then right after it in the display list, which keeps its order among equal depths.
     */
    private placeAbove<T extends Layered>(object: T, below: string | Layered): T {
        const target = typeof below === "string" ? this.layers.get(below) : below;
        object.setDepth(target ? target.depth : -2);
        const list = this.scene.children.list;
        if (target && list.includes(target)) {
            list.splice(list.indexOf(object), 1);
            list.splice(list.indexOf(target) + 1, 0, object);
        }
        return this.resources.object(object);
    }

    private buildWater(): Phaser.GameObjects.Shader {
        const { rect, glint, waterline } = this.manifest.water;
        const [x, y, w, h] = rect;
        const flat = (colours: readonly Rgb[]): number[] => colours.flat().map((v) => v / 255);
        const water = this.scene.add.shader(
            {
                name: "kfxWater",
                fragmentSource: WATER,
                setupUniforms: (set: (name: string, value: UniformValue) => void) => {
                    set("uWater", 0);
                    set("uData", 1);
                    set("uRect", [x, y, w, h]);
                    set("uTick", this.waterTick);
                    set("uSun", Math.max(this.look.sun, this.look.clouds));
                    set("uPal[0]", WATER_GRADE.flat());
                    set("uHalf[0]", WATER_HALF.flat());
                    set("uRing[0]", KOI_RING.flat());
                    set("uStars[0]", this.stars);
                    set("uGlint[0]", flat(glint));
                    set("uLine", flat([waterline]));
                    set("uCore", CAUSTIC.core);
                    set("uHalo", CAUSTIC.halo);
                    set("uWhite", CAUSTIC.white);
                    const rings = new Float32Array(64);
                    this.rings.slice(-16).forEach((r, i) => rings.set([r.x - x, r.y - y, r.tick, r.seed], i * 4));
                    set("uRings[0]", rings);
                    set("uRingN", Math.min(16, this.rings.length));
                },
            },
            x + w / 2,
            y + h / 2,
            w,
            h,
            [this.key("water"), this.key("water-data")],
        );
        return this.placeAbove(water, "decor");
    }

    private buildGround(): Phaser.GameObjects.Shader {
        const ground = this.scene.add.shader(
            {
                name: "kfxGround",
                fragmentSource: GROUND,
                setupUniforms: (set: (name: string, value: UniformValue) => void) => {
                    set("uOcc", 0);
                    set("uMasks", 1);
                    set("uMap", [this.mapW, this.mapH]);
                    set("uShadow", this.look.shadow);
                    const [people, n] = this.peopleUniform();
                    set("uPeople[0]", people);
                    set("uPeopleN", n);
                },
            },
            this.mapW / 2,
            this.mapH / 2,
            this.mapW,
            this.mapH,
            [this.key("occ"), this.key("masks")],
        );
        return this.placeAbove(ground, this.water);
    }

    /** Feet of whoever is in or near the view: [Float32Array(32) of x, y, 0, 0; count]. */
    private peopleUniform(): [Float32Array, number] {
        const view = this.view();
        const near = this.people().filter((p) =>
            inside(p.x, p.y, [view[0] - 16, view[1] - 16, view[2] + 32, view[3] + 32]),
        );
        const data = new Float32Array(32);
        near.slice(0, 8).forEach((p, i) => data.set([Math.round(p.x), Math.round(p.y) + 1, 0, 0], i * 4));
        return [data, Math.min(8, near.length)];
    }

    private buildGlass(): Phaser.GameObjects.Shader {
        const glass = this.scene.add.shader(
            {
                name: "kfxGlass",
                fragmentSource: GLASS,
                setupUniforms: (set: (name: string, value: UniformValue) => void) => {
                    const cam = this.scene.cameras.main;
                    const sheen = this.features.glass ? this.look.sheen : 0;
                    set("uGlass", 0);
                    set("uMap", [this.mapW, this.mapH]);
                    set("uCam", [Math.round(cam.scrollX), Math.round(cam.scrollY)]);
                    set("uStrength", sheen);
                    // the quad may show for the mirror alone
                    set("uTint", sheen > 0 ? this.look.glass : [0, 0, 0, 0]);
                    set("uMirror", 1);
                    set(
                        "uMirrorRows",
                        [0, 1, 2, 3].map((i) => this.mirrorRows[i] ?? -1),
                    );
                    set("uMirrorSize", [this.mirrorAtlas.width, this.mirrorAtlas.height]);
                    set("uMirrorTint", MIRROR_TINT_RGB);
                    set("uMirrorOn", this.features.reflections && this.mirrorStatic ? 1 : 0);
                    set("uMirrorLive[0]", this.mirrorLive);
                    set("uMirrorLiveN", this.mirrorLiveN);
                },
            },
            this.mapW / 2,
            this.mapH / 2,
            this.mapW,
            this.mapH,
            [this.key("glass"), this.key("mirror")],
        );
        return this.placeAbove(glass, "doors");
    }

    /**
     * The glass mirror: a container of pictures above the doors layer. A picture shows only on glass: it is cropped to
     * each pane it crosses (one image per pane), the panes measured once on fx.py glass.png, so a rail, a post, a
     * mullion or a door never carries a reflection. Crops instead of a mask filter: a filter drew the container
     * off-screen and back, 4 to 6 draw calls a frame against perf.py's budget of 30 (20/10/2026); crops add one.
     */
    private buildMirror(
        glassImage: HTMLImageElement,
        generation: number,
    ): {
        container: Phaser.GameObjects.Container;
        rows: number[];
        atlas: HTMLCanvasElement;
        texture: Phaser.Textures.CanvasTexture;
    } {
        const { width, height } = glassImage;
        const ctx = context2d(makeCanvas(width, height), true);
        ctx.drawImage(glassImage, 0, 0);
        const faces = this.manifest.glassFaces || [];
        for (const face of faces) {
            const [x0, x1] = face;
            const band = ctx.getImageData(x0, glassRowTop(face), x1 - x0, 64).data;
            const panes = glassPanes(face, band, width, height);
            if (panes) this.mirrorPanes.set(face, panes);
        }
        const container = this.placeAbove(this.scene.add.container(0, 0), "doors");
        container.setVisible(false);
        // The pieces' atlas: one 64 px band per row of glass faces (up to four), colour above, strength below; opaque,
        // so how the browser hands a canvas's alpha to WebGL never matters.
        const rows = [...new Set(faces.map(glassRowTop))].slice(0, 4);
        const atlas = makeCanvas(this.mapW, Math.max(1, rows.length) * 128);
        const texture = this.addCanvasTexture("mirror", `kfx-${generation}-mirror`, atlas);
        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        return { container, rows, atlas, texture };
    }

    /**
     * The pieces in the atlas: each seen from its other side (turned over), cropped to its face's panes, its colour in
     * its row's band and its strength (mirrorAlpha) in the band below, the farthest from the glass first (the nearer
     * covers it). Done when the pieces change, not per frame.
     */
    private paintMirror(pieces: readonly MirrorPiece[]): void {
        const ctx = context2d(this.mirrorAtlas);
        const half = this.mirrorAtlas.height / 2;
        ctx.imageSmoothingEnabled = false;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, this.mirrorAtlas.width, this.mirrorAtlas.height);
        this.mirrorTmp ??= document.createElement("canvas");
        const tmp = this.mirrorTmp;
        for (const { face, picture } of [...pieces].sort((a, b) => b.picture.distance - a.picture.distance)) {
            const { key, frame, x: cx, y: foot, flip, alpha, scaleX, scaleY, back } = picture;
            const rowTop = glassRowTop(face);
            const band = this.mirrorRows.indexOf(rowTop);
            const f = this.scene.textures.getFrame(key, frame);
            const image = f?.source?.image;
            if (band < 0 || !(image instanceof HTMLImageElement || image instanceof HTMLCanvasElement)) continue;
            const w = Math.round(f.cutWidth * scaleX);
            const h = Math.round(f.cutHeight * scaleY);
            const left = Math.round(cx - w / 2);
            const top = Math.round(foot - h) - rowTop + band * 64; // in the band's rows
            tmp.width = w;
            tmp.height = h;
            const t = context2d(tmp, back);
            t.imageSmoothingEnabled = false;
            t.save();
            if (flip) {
                // a piece shown flipped mirrors back
                t.translate(w, 0);
                t.scale(-1, 1);
            }
            t.drawImage(image, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, w, h);
            t.restore();
            if (back) backOf(t, w, h);
            const panes = this.mirrorPanes.get(face) || [];
            ctx.save();
            ctx.beginPath();
            for (const [a, b, pt, pb] of panes) ctx.rect(a, pt - rowTop + band * 64, b - a, pb - pt);
            ctx.clip();
            ctx.drawImage(tmp, left, top);
            t.globalCompositeOperation = "source-in"; // the silhouette, in the strength's grey
            const v = Math.round(alpha * 255);
            t.fillStyle = `rgb(${v},${v},${v})`;
            t.fillRect(0, 0, w, h);
            ctx.restore();
            ctx.save();
            ctx.beginPath();
            for (const [a, b, pt, pb] of panes) ctx.rect(a, pt - rowTop + band * 64 + half, b - a, pb - pt);
            ctx.clip();
            ctx.drawImage(tmp, left, top + half);
            ctx.restore();
        }
        this.mirrorTexture.refresh();
        this.mirrorStatic = pieces.length > 0;
    }

    /**
     * A frame drawn mirrored (and, for a brand piece, from its back: backOf) as a texture of its own, made once:
     * Phaser 4 crops a flipped image from the wrong side (20/10/2026, a reflection split by a mullion showed two outer
     * halves), so a mirrored picture is never flipped.
     */
    private mirroredFrame(key: string, frame: FrameName | undefined, flip: boolean, back: boolean): string | null {
        const id = `${key}|${frame}|${flip ? "f" : ""}${back ? "b" : ""}`;
        const known = this.mirrorFlips.get(id);
        if (known !== undefined) return known;
        const f = this.scene.textures.getFrame(key, frame);
        const image = f?.source?.image;
        let made: string | null = null;
        if (
            (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) &&
            f.cutWidth > 0 &&
            f.cutHeight > 0
        ) {
            const canvas = makeCanvas(f.cutWidth, f.cutHeight);
            const ctx = context2d(canvas, back);
            if (flip) {
                ctx.translate(f.cutWidth, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(image, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
            if (back) backOf(ctx, f.cutWidth, f.cutHeight);
            const n = this.mirrorFlips.size;
            const texture = this.addCanvasTexture(`mirror-${n}`, `${this.key("mirror")}-${n}`, canvas);
            texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // whole art pixels
            made = texture.key;
        }
        this.mirrorFlips.set(id, made);
        return made;
    }

    // ------------------------------------------------------------------------------------------------ state

    private motion(): boolean {
        return motionAllowed({
            reducedMotion: this.environment.reducedMotion(),
            animationsOff: this.environment.animationsOff(),
        });
    }

    private hour(): number {
        return this.environment.fixedHour() ?? localHour();
    }

    private people(): Person[] {
        const out: Person[] = [];
        const add = (id: string, p: { x: number; y: number } | undefined): void => {
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
                out.push({ id, x: p.x, y: p.y + 15, me: id === "me" });
        };
        add("me", this.currentPlayer());
        for (const [id, p] of this.scene.MapPlayersByKey) add(String(id), p);
        return out;
    }

    private currentPlayer(): Player | undefined {
        return this.scene.CurrentPlayer;
    }

    private mask(x: number, y: number): [number, number, number] {
        return maskAt(this.masks, x, y);
    }

    /** Share of the camera's view where a mask test holds, from a grid of points about 24 px apart. */
    private share(view: Rect, test: (m: [number, number, number]) => boolean): number {
        const cols = Math.max(4, Math.round(view[2] / 24));
        const rows = Math.max(4, Math.round(view[3] / 24));
        let hits = 0;
        for (let gy = 0; gy < rows; gy++) {
            for (let gx = 0; gx < cols; gx++) {
                const m = this.mask(view[0] + ((gx + 0.5) * view[2]) / cols, view[1] + ((gy + 0.5) * view[3]) / rows);
                if (test(m)) hits += 1;
            }
        }
        return hits / (cols * rows);
    }

    private outsideShare(view: Rect): number {
        return this.share(view, (m) => m[0] > 127);
    }

    /** Open water in view (masks B = 128), not just the pool's bounding box touching an edge of it. */
    private waterShare(view: Rect): number {
        return this.share(view, (m) => m[2] > 100 && m[2] < 160);
    }

    private view(): Rect {
        const v = this.scene.cameras.main.worldView;
        return [v.x, v.y, v.width, v.height];
    }

    /** Every second and on a settings change: the hour, locks, meetings and lights; marks the scene dirty on change. */
    private refresh(force: boolean): void {
        const look = lookAt(this.hour(), this.features);
        const people = this.people();
        const counts = occupancy(this.manifest.rooms, people);
        // a TV hangs on the wall face above its room's floor: the room counts from two tiles above the floor
        const meetingAt = (x: number, y: number): boolean =>
            this.manifest.rooms.some(
                (r) => counts[r.key] >= 2 && inside(x, y, [r.floor[0], r.floor[1] - 64, r.floor[2], r.floor[3] + 64]),
            );
        const placed = this.scene.children.list.filter(
            (o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image && o.type === "Image",
        );
        const lit = placed.filter((o) => this.lightSpec(o) !== undefined);
        const feet = footprints(
            placed.map((o) => ({ key: o.texture.key, x: o.x, y: o.y })),
            this.shadowSpecs(placed),
        );
        const occSignature = feet.map((r) => r.join(",")).join(";");
        if (occSignature !== this.occSignature) {
            this.drawOcclusion(feet);
            this.occSignature = occSignature;
            force = true;
        }
        const { pools, emissive } = lightsFrom(
            lit.map((o) => ({ key: o.texture.key, x: o.x, y: o.y })),
            this.manifest.lights,
            this.manifest.spaces,
            meetingAt,
        );
        const signature = pools.map((l) => `${l.kind}${Math.round(l.x)},${Math.round(l.y)}`).join(";");
        const focus = this.features.vignette && this.environment.focused();
        const lookKey = JSON.stringify(look);
        let changed = force;
        if (signature !== this.lightSignature) {
            this.pools = [...pools, ...this.statics];
            this.emissive = emissive;
            this.lightSignature = signature;
            changed = true;
        }
        if (lookKey !== this.lookKey) {
            this.look = look;
            this.lookKey = lookKey;
            changed = true;
        }
        this.updateTvs(lit, this.features.tv ? meetingAt : () => false);
        if (focus !== this.vignette.to > 0) {
            Object.assign(this.vignette, { from: this.vignette.value, to: focus ? 0.24 : 0, at: this.now });
            this.animate(this.environment.reducedMotion() ? 0 : 500);
            changed = true;
        }
        this.dimOverlays(look);
        const sun = this.layers.get("luz");
        if (sun && Math.abs(sun.alpha - look.sun) > 0.01) {
            sun.setAlpha(look.sun);
            changed = true;
        }
        const water = this.motion() && this.features.water;
        if (this.water.visible !== water) {
            this.water.setVisible(water);
            changed = true;
        }
        if (this.ground.visible !== this.features.shadows) {
            this.ground.setVisible(this.features.shadows);
            changed = true;
        }
        const pieces = this.features.reflections ? this.findMirrorPieces() : [];
        const mirrorSignature = pieces.map((p) => pictureSignature(p.picture)).join(";");
        if (mirrorSignature !== this.mirrorSignature) {
            this.mirrorPieces = pieces;
            this.mirrorSignature = mirrorSignature;
            this.paintMirror(pieces);
            changed = true;
        }
        if (changed) this.scene.markDirty();
    }

    private lightSpec(image: Phaser.GameObjects.Image): SpriteSpec | undefined {
        const key = specKey(image.texture.key);
        return key === null ? undefined : this.manifest.lights[key];
    }

    /**
     * Footprints by sprite key: the manifest's (the sprites the built map places) and, for anything the editor added
     * since, one measured here on the loaded picture (the bottom quarter of its silhouette), unless it sits in a folder
     * of flat things (rugs, wall decor, floors, walls, doors). Measured once per sprite.
     */
    private shadowSpecs(placed: readonly Phaser.GameObjects.Image[]): Record<string, Box | null> {
        const specs = this.manifest.shadows || {};
        for (const o of placed) {
            const key = specKey(o.texture.key);
            if (!key || key in specs || key in this.measured) continue;
            const source = o.texture.getSourceImage();
            this.measured[key] =
                /\/(walldecor|floors|walls|doors)\//.test(key) ||
                !(source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) ||
                !source.width ||
                !source.height
                    ? null
                    : measureFootprint(readPixels(source));
        }
        return { ...this.measured, ...specs };
    }

    /** Walls and footprints at half the map's size: red the occluders as they are, green the same blurred. */
    private drawOcclusion(feet: readonly Rect[]): void {
        const draw = context2d(this.occDraw);
        draw.globalCompositeOperation = "source-over";
        draw.filter = "none";
        draw.fillStyle = "#000";
        draw.fillRect(0, 0, this.occDraw.width, this.occDraw.height);
        draw.globalAlpha = 0.45; // walls shade the floor beside them only a little
        draw.drawImage(this.occWalls, 0, 0);
        draw.globalAlpha = 1;
        draw.fillStyle = "#fff";
        for (const [x, y, w, h] of feet) draw.fillRect(x / 2, y / 2, Math.max(1, w / 2), Math.max(1, h / 2));
        const out = context2d(this.occCanvas);
        out.globalCompositeOperation = "source-over";
        out.filter = "blur(2px)"; // an offscreen canvas, drawn when something moves: not a DOM blur
        out.drawImage(this.occDraw, 0, 0);
        out.filter = "none";
        // keep one channel of what was just drawn
        out.globalCompositeOperation = "multiply";
        out.fillStyle = "#00ff00";
        out.fillRect(0, 0, this.occCanvas.width, this.occCanvas.height);
        out.globalCompositeOperation = "lighter";
        this.occRaw ??= makeCanvas(this.occDraw.width, this.occDraw.height);
        const raw = context2d(this.occRaw);
        raw.globalCompositeOperation = "source-over";
        raw.drawImage(this.occDraw, 0, 0);
        raw.globalCompositeOperation = "multiply";
        raw.fillStyle = "#ff0000";
        raw.fillRect(0, 0, this.occRaw.width, this.occRaw.height);
        out.drawImage(this.occRaw, 0, 0);
        out.globalCompositeOperation = "source-over";
        this.occTexture.refresh();
    }

    /** The koi swim in a page above the canvas, out of the camera pass's reach: dim them with the pool at night. */
    private dimOverlays(look: Look): void {
        const level = Math.min(1, (look.inside[0] + look.inside[1] + look.inside[2]) / 3);
        const filter = level < 0.995 ? `brightness(${level.toFixed(3)})` : "";
        for (const frame of document.querySelectorAll<HTMLIFrameElement>(KOI_FRAMES)) {
            if (frame.style.filter !== filter) frame.style.filter = filter;
        }
    }

    private updateTvs(images: readonly Phaser.GameObjects.Image[], meetingAt: (x: number, y: number) => boolean): void {
        const seen = new Set<Phaser.GameObjects.Image>();
        for (const image of images) {
            const spec = this.lightSpec(image);
            if (spec?.kind !== "tv" || !spec.screen) continue;
            seen.add(image);
            const [x0, y0, x1, y1] = spec.screen;
            let slide = this.tvs.get(image);
            if (!slide) {
                slide = this.resources.object(this.scene.add.image(0, 0, this.key("tv-slide")).setOrigin(0, 0));
                this.tvs.set(image, slide);
            }
            slide
                .setPosition(image.x + x0, image.y + y0)
                .setDisplaySize(x1 - x0, y1 - y0)
                .setDepth(image.depth + 0.01);
            const on = meetingAt(image.x + (x0 + x1) / 2, image.y + y1 + 10);
            if (slide.visible !== on) {
                slide.setVisible(on);
                this.scene.markDirty();
            }
        }
        for (const [image, slide] of this.tvs) {
            if (!seen.has(image)) {
                this.resources.drop(slide);
                this.tvs.delete(image);
            }
        }
    }

    // ------------------------------------------------------------------------------------------------ time

    /** The tile animation clock, `delay` ms since the last tick: true when a timed effect seen on screen changed picture. */
    private tick(delay: number): boolean {
        if (!this.motion()) return false;
        const view = this.view();
        let redraw = false;
        if (this.water.visible && coverage(this.manifest.water.rect, view) > 0 && this.waterShare(view) > 0) {
            this.waterTick += 1;
            if (this.waterTick % 6 === 0) this.koiRings();
            redraw = true;
        }
        // Clouds drift for whoever is out on the lawn; from inside (a room's glass shows the lawn) they hold still, so
        // a still room keeps its redraw budget.
        const me = this.currentPlayer();
        const out = me !== undefined && this.mask(me.x, me.y + 15)[0] > 127;
        if (
            this.features.clouds &&
            this.look.clouds > 0 &&
            out &&
            this.outsideShare(view) > 0.25 &&
            this.clouds.advance(delay / 1000)
        ) {
            redraw = true;
        }
        if (this.features.trail && this.trail.alive(this.now) && this.outsideShare(view) > 0) redraw = true;
        return redraw;
    }

    /** Rings where koi swim: every few ticks a ring opens behind one or two koi of the overlays (same-origin pages). */
    private koiRings(): void {
        this.rings = this.rings.filter((r) => this.waterTick - r.tick < 16);
        for (const frame of document.querySelectorAll<HTMLIFrameElement>(KOI_FRAMES)) {
            const koi = koiOf(frame);
            if (!koi) continue;
            const fish = koi.school.snapshot().fish;
            const [ox, oy] = koi.scene.origin;
            const open = koi.masks?.open;
            const W = koi.scene.width;
            const openAt = (x: number, y: number): boolean => !open || open[Math.round(y) * W + Math.round(x)] > 0;
            for (const f of fish) {
                if (f.depth > 0.6) continue; // resting on the bed: no ring
                if (!KOI_ROOM.every(([dx, dy]) => openAt(f.x + dx, f.y + dy))) continue; // a ring needs open water
                this.rings.push({
                    x: Math.round(ox + f.x),
                    y: Math.round(oy + f.y),
                    tick: this.waterTick,
                    seed: Math.random() * 100,
                });
            }
        }
    }

    /** Redraws every frame for `ms` (a transition), then stops. */
    private animate(ms: number): void {
        this.animateUntil = Math.max(this.animateUntil, this.now + ms);
        this.animating = true;
    }

    private startReveal(): void {
        if (this.environment.reducedMotion() || this.environment.animationsOff() || !this.features.iris) return;
        this.revealState = { at: this.now, running: true };
        this.animate(1100);
    }

    // ------------------------------------------------------------------------------------------------ per frame

    /** Before each draw: the camera pass's state, the mirror's pictures and what shows. */
    private frame(): void {
        const now = this.now;
        const view = this.view();
        const people = this.people();
        const motion = this.motion();
        const features = this.features;
        if (motion && features.trail) {
            for (const p of people) this.trail.step(p.id, p.x, p.y, now, this.mask(p.x, p.y)[2] > 200);
            this.trail.forget(new Set(people.map((p) => p.id)));
        }
        const v = this.vignette;
        v.value = v.from + (v.to - v.from) * progress(now, v.at, this.environment.reducedMotion() ? 0 : 500);
        const look = this.look;
        const locks: Rect[] = [];
        const me = people.find((p) => p.me);
        for (const room of this.manifest.rooms) {
            const layer = this.layers.get(room.layer);
            if (!layer?.visible) continue;
            if (me && inside(me.x, me.y, room.floor)) continue; // inside, you see your own room clearly
            if (coverage(room.rect, view) > 0) locks.push(room.rect);
        }
        const near = (p: Person): boolean => inside(p.x, p.y, [view[0] - 16, view[1] - 16, view[2] + 32, view[3] + 32]);
        const mirrored = !features.reflections
            ? []
            : people.filter((p) => this.mask(p.x, p.y)[1] > 127 && near(p)).slice(0, 8);
        this.drawMirror(features.reflections ? this.mirrorPictures(view) : []);
        let reveal = -1;
        if (this.revealState.running) {
            const t = progress(now, this.revealState.at, 1000);
            reveal = t * Math.hypot(view[2], view[3]);
            if (t >= 1) this.revealState.running = false;
        }
        const outside = this.outsideShare(view) > 0;
        const clouds = outside && features.clouds ? look.clouds : 0;
        // a lamp gives light by the hour; a screen, a TV or a sign by its own (but not against daylight)
        const lit =
            look.lamps > 0
                ? visibleLights(
                      this.pools.filter((l) => !l.night || look.lamps >= 0.9),
                      view,
                      32,
                  )
                : [];
        const glow = look.lamps > 0 ? visibleRects(this.emissive, view, 24) : [];
        // who is in a locked room stays private with the frost switched off too: only the frost is an effect
        const frosted = features.frost ? locks : [];
        this.frameState = { view, look, locks: frosted, mirrored, reveal, clouds, me, lit, glow };
        this.post.active =
            !isPlainDay(look) ||
            frosted.length > 0 ||
            mirrored.length > 0 ||
            (outside && (clouds > 0 || look.sat !== 1)) ||
            v.value > 0.001 ||
            reveal >= 0 ||
            (motion && features.trail && this.trail.steps.length > 0);
        this.hideLabels(locks);
        this.glass.setVisible((features.glass && look.sheen > 0) || (features.reflections && this.mirrorStatic));
    }

    /** Who is inside a locked room stays private from outside: their name tags hide too. */
    private hideLabels(locks: readonly Rect[]): void {
        const shown = new Set<HTMLElement>();
        if (locks.length) {
            const canvas = this.scene.game.canvas.getBoundingClientRect();
            const cam = this.scene.cameras.main;
            const v = cam.worldView;
            const scale = canvas.width / cam.width;
            for (const label of document.querySelectorAll<HTMLElement>(".username-display")) {
                const r = label.getBoundingClientRect();
                const x = v.x + (r.left + r.width / 2 - canvas.left) / scale / cam.zoom;
                const y = v.y + (r.bottom + 12 - canvas.top) / scale / cam.zoom;
                if (locks.some((rect) => inside(x, y, rect))) shown.add(label);
            }
        }
        for (const label of this.hiddenLabels) if (!shown.has(label)) label.style.visibility = "";
        for (const label of shown) label.style.visibility = "hidden";
        this.hiddenLabels = shown;
    }

    /** Gives the page back what the effects changed in it: the koi pages' dimming and the hidden name tags. */
    private restorePage(): void {
        for (const frame of document.querySelectorAll<HTMLIFrameElement>(KOI_FRAMES)) frame.style.filter = "";
        for (const label of this.hiddenLabels) label.style.visibility = "";
        this.hiddenLabels = new Set();
    }

    // ------------------------------------------------------------------------------------------------ the mirror

    /** The pieces standing in front of a glass face (mirrorsPiece), each with its picture in the mirror. */
    private findMirrorPieces(): MirrorPiece[] {
        const faces = this.manifest.glassFaces || [];
        const out: MirrorPiece[] = [];
        if (!faces.length) return out;
        const entities = this.scene.getGameMapFrontWrapper().getEntitiesManager().getEntities();
        for (const [, e] of entities) {
            if (!e.visible || !e.active) continue;
            const w = e.displayWidth;
            const h = e.displayHeight;
            const cx = e.x - e.originX * w + w / 2;
            const foot = e.y - e.originY * h + h;
            const face = mirrorFace(cx, foot, faces);
            const prefab = e.getPrefab();
            if (!face || !mirrorsPiece(prefab)) continue;
            const d = foot - face[2];
            const alpha = mirrorAlpha(d);
            if (alpha <= 0) continue;
            out.push({
                face,
                picture: {
                    key: e.texture.key,
                    frame: e.frame.name,
                    x: cx,
                    y: mirrorFoot(foot, face[2]),
                    originX: 0.5,
                    originY: 1,
                    flip: e.flipX,
                    alpha,
                    scaleX: e.scaleX,
                    scaleY: e.scaleY,
                    face,
                    back: prefab.tags.includes("Peças da marca"), // the editor's tag for brand pieces
                    distance: d,
                },
            });
        }
        return out;
    }

    /**
     * The mirror's pictures this frame: everyone standing in front of a glass face in view, upright, moving up the
     * glass with distance (mirrorFoot), turned to their other side (a Woka's layers by mirrorFrame). The pieces are the
     * atlas's.
     */
    private mirrorPictures(view: Rect): MirrorPicture[] {
        const faces = (this.manifest.glassFaces || []).filter(
            ([x0, x1, foot]) =>
                x1 > view[0] &&
                x0 < view[0] + view[2] &&
                foot + MIRROR_REACH > view[1] &&
                foot - 64 < view[1] + view[3],
        );
        if (!faces.length) return [];
        const out: MirrorPicture[] = [];
        const characters = [this.currentPlayer(), ...this.scene.MapPlayersByKey.values()];
        for (const ch of characters) {
            if (!ch?.visible) continue;
            const foot = ch.y + 16;
            const face = mirrorFace(ch.x, foot, faces);
            if (!face) continue;
            const d = foot - face[2];
            const alpha = mirrorAlpha(d);
            if (alpha <= 0) continue;
            const mirrorFeet = mirrorFoot(foot, face[2]);
            for (const layer of ch.list) {
                if (!(layer instanceof Phaser.GameObjects.Sprite) || !layer.visible) continue;
                const { frame, flip } = mirrorFrame(layer.frame.name);
                const below = (1 - layer.originY) * layer.displayHeight; // from the picture's origin to its feet
                out.push({
                    key: layer.texture.key,
                    frame,
                    x: ch.x + layer.x,
                    y: mirrorFeet - below + layer.y,
                    originX: layer.originX,
                    originY: layer.originY,
                    flip: flip !== layer.flipX,
                    alpha,
                    scaleX: layer.scaleX || 1,
                    scaleY: layer.scaleY || 1,
                    face,
                    back: false,
                    distance: d,
                });
            }
        }
        return out;
    }

    /**
     * The pictures on the mirror's pooled images, one per pane each crosses, cropped to it; the container hides when
     * there is nothing to show (no draw). Whatever is nearer the glass covers in the mirror what stands behind it
     * (21/10/2026: a cat behind its owner showed in front of them), so every picture goes by its distance from the
     * glass, the farthest first. The panes a person crosses are drawn here whole: the atlas leaves them (uMirrorLive,
     * up to 8; past that a pane keeps its atlas) and the pieces crossing them join the people, in that same order.
     */
    private drawMirror(people: readonly MirrorPicture[]): void {
        const place = (pic: MirrorPicture): PlacedMirrorPicture | null => {
            const turned = pic.flip || pic.back;
            const key = turned ? this.mirroredFrame(pic.key, pic.frame, pic.flip, pic.back) : pic.key;
            const frame = turned ? undefined : pic.frame;
            const size = key === null ? null : this.scene.textures.getFrame(key, frame);
            if (!key || !size) return null;
            const w = size.width * pic.scaleX;
            const h = size.height * pic.scaleY;
            return {
                key,
                frame,
                left: Math.round(pic.x - pic.originX * w),
                top: Math.round(pic.y - pic.originY * h),
                w,
                h,
                alpha: pic.alpha,
                scaleX: pic.scaleX,
                scaleY: pic.scaleY,
                face: pic.face,
                distance: pic.distance,
            };
        };
        const crosses = (p: PlacedMirrorPicture, [a, b, pt, pb]: GlassPane): boolean =>
            Math.min(b, p.left + p.w) > Math.max(a, p.left) && Math.min(pb, p.top + p.h) > Math.max(pt, p.top);
        const shown = people.map(place).filter((p): p is PlacedMirrorPicture => p !== null);
        const live = new Set<GlassPane>();
        for (const p of shown) {
            for (const pane of this.mirrorPanes.get(p.face) || [])
                if (live.size < 8 && crosses(p, pane)) live.add(pane);
        }
        if (live.size) {
            for (const { face, picture } of this.mirrorPieces) {
                const panes = this.mirrorPanes.get(face) || [];
                if (!panes.some((pane) => live.has(pane))) continue;
                const p = place(picture);
                if (p && panes.some((pane) => live.has(pane) && crosses(p, pane))) shown.push({ ...p, only: live });
            }
        }
        shown.sort((a, b) => b.distance - a.distance); // stable: a Woka's layers keep their order
        this.mirrorLive.fill(0);
        [...live].forEach(([a, b, pt, pb], i) => this.mirrorLive.set([a, b, pt, pb], i * 4));
        this.mirrorLiveN = live.size;
        const pool = this.mirrorPool;
        let n = 0;
        for (const p of shown) {
            const { key, frame, left, top, w, h, alpha, scaleX, scaleY } = p;
            for (const pane of this.mirrorPanes.get(p.face) || []) {
                if (p.only && !p.only.has(pane)) continue; // a piece outside the live panes stays the atlas's
                const [a, b, pt, pb] = pane;
                const x0 = Math.max(a, left);
                const x1 = Math.min(b, left + w);
                const y0 = Math.max(pt, top);
                const y1 = Math.min(pb, top + h);
                if (x1 <= x0 || y1 <= y0) continue;
                let img = pool[n];
                if (!img) {
                    img = this.scene.add.image(0, 0, key, frame);
                    this.mirror.add(img);
                    pool.push(img);
                } else if (
                    img.texture.key !== key ||
                    (frame !== undefined && String(img.frame.name) !== String(frame))
                ) {
                    img.setTexture(key, frame);
                }
                img.setOrigin(0, 0)
                    .setPosition(left, top)
                    .setScale(scaleX, scaleY)
                    .setAlpha(alpha)
                    .setTint(MIRROR_TINT)
                    .setCrop((x0 - left) / scaleX, (y0 - top) / scaleY, (x1 - x0) / scaleX, (y1 - y0) / scaleY)
                    .setVisible(true);
                n += 1;
            }
        }
        for (let i = n; i < pool.length; i++) pool[i].setVisible(false);
        if (this.mirror.visible !== n > 0) this.mirror.setVisible(n > 0);
        this.mirrorShown = n;
    }

    private postUniforms(): Record<string, UniformValue> {
        const state = this.frameState;
        if (!state) return {};
        const { view, look, locks, mirrored, reveal, clouds, me, lit, glow } = state;
        // the tint index rides in the width's fraction (whole pixels)
        const em = new Float32Array(96);
        glow.forEach((g, i) => {
            const [x, y, w, h] = g.rect;
            em.set([x, y, w + g.tint / 8, h], i * 4);
        });
        const L = new Float32Array(128);
        const LC = new Float32Array(128);
        const LClip = new Float32Array(128);
        lit.forEach((l, i) => {
            L.set([l.x, l.y, l.halo ? -l.reach : l.reach, l.squash], i * 4); // a negative reach: the lamp also glows
            LC.set([...l.color, l.power * (l.self ? Math.max(look.lamps, 0.75) : look.lamps)], i * 4);
            if (l.clip) LClip.set(l.clip, i * 4);
        });
        const lock = new Float32Array(24);
        locks.slice(0, 6).forEach((r, i) => lock.set([r[0], r[1], r[2] + 2, r[3]], i * 4)); // up to the wall's stroke
        const [steps, stepN] =
            this.motion() && this.features.trail ? this.trail.uniforms(this.now) : [new Float32Array(128), 0];
        const av = new Float32Array(32);
        mirrored.forEach((p, i) => av.set([Math.round(p.x), Math.round(p.y), 10, 26], i * 4));
        const cam = this.scene.cameras.main;
        const [ox, oy] = this.clouds.offset();
        return {
            uWorld: view,
            uMap: [this.mapW, this.mapH],
            uRes: [cam.width, cam.height],
            uInside: look.inside,
            uOutside: look.outside,
            uLawn: look.lawn,
            uWall: look.wall,
            uVivid: look.vivid,
            uFacade: look.facade,
            uWarm: look.warm,
            uToe: look.toe,
            uDarks: look.darks,
            uSat: look.sat,
            uNight: look.lamps,
            "uL[0]": L,
            "uLC[0]": LC,
            "uLClip[0]": LClip,
            uLN: lit.length,
            "uEm[0]": em,
            "uEmT[0]": EMISSIVE_TINT_TABLE,
            uEmN: glow.length,
            uShafts: [look.shafts, 58, 24, 0.84],
            uCloud: [clouds, 236, ox, oy],
            "uLock[0]": lock,
            uLockN: Math.min(locks.length, 6),
            uFrost: [0.59, 0.8, 0.76],
            "uSteps[0]": steps,
            uStepN: stepN,
            uLime: TRAIL_COLOURS.lime,
            uCream: TRAIL_COLOURS.cream,
            "uAv[0]": av,
            uAvN: mirrored.length,
            uVignette: [this.vignette.value, 0.62],
            uReveal: [
                me ? Math.round(me.x) : view[0] + view[2] / 2,
                me ? Math.round(me.y) - 12 : view[1] + view[3] / 2,
                reveal,
                0,
            ],
            uInk: this.manifest.ink.map((c) => c / 255),
        };
    }
}

function pictureSignature(p: MirrorPicture): string {
    return [p.key, p.frame, p.x, p.y, p.flip, p.alpha, p.scaleX, p.scaleY, p.face.join(","), p.back, p.distance].join(
        ",",
    );
}

/** A brand piece seen from behind (paintBackOf), on a canvas. */
function backOf(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const img = ctx.getImageData(0, 0, w, h);
    paintBackOf(img.data, w, h);
    ctx.putImageData(img, 0, 0);
}

/** The koi school a same-origin koi page shares, or undefined. */
function koiOf(frame: HTMLIFrameElement): KoiSchool | undefined {
    const win = frame.contentWindow;
    if (!win) return undefined;
    let koi: unknown;
    try {
        koi = Reflect.get(win, "__koi");
    } catch (error: unknown) {
        // A koi page from another origin keeps its fish to itself: no rings, by design, not a failure.
        if (error instanceof DOMException && error.name === "SecurityError") return undefined;
        throw error;
    }
    return isKoiSchool(koi) ? koi : undefined;
}
