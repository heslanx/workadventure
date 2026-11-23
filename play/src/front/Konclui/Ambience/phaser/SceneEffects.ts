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
//           (on the camera's internal filter list; with localStorage "konclui.fx.external" = "1", read at the build, on the
//           external list while the camera fills the canvas, where Phaser draws the last filter straight to it: off
//           until a Gate 1 run measures it, see postFilter.ts)
//   tv      a meeting room's TV shows the K slide (and lights the room at night) while two or more people are in it
//   shading (localStorage "konclui.fx.rim" = "1", "full" or "reduced"; off by default, and with it off nothing below exists)
//           a second camera pass, POST_SHADED, with a cast texture baked on the CPU from the map's pieces (domain/shadeBake,
//           phaser/shading: the key light's shadow, the lamps' shadows, a contact band under each object, for a rug no
//           relief), the props lit on one side by relief on their normals, the people marked (phaser/peopleMark: their
//           sprites leave alpha 0 in the colour buffer) so the pass lights their own pixels, and a stamp under each person
//           (phaser/peopleShadow). The level (domain/shadingLevel, shadingGovernor) falls from full to reduced to off by
//           the GPU, the zoom and the frame times; the Shadows switch off, or a pass that does not compile, leave the legacy pass.
// A draw makes no array and under 64 bytes of heap (asserted, SceneEffects.performance.test.ts), except where a locked
// room is in view with name tags on the page: hideLabels then reads each tag's place from the page (a DOMRect each, at
// most every LABEL_MEASURE_MS, and only when a camera, a crowd or a tag moved), a cost in a browser nobody has measured.
// The uniforms are written into scratch arrays made once, the mirror's pictures are pooled records, what a footstep
// would recompute (the lights that reach the view, the share of the view outdoors) is cached by the camera's cell, and
// the shading, mirroring and trail read only the characters the scene draws in full (domain/drawnPeople), not the
// culled ones and the dots of a crowd. Nothing is uploaded to the GPU while people walk: their reflections are the
// images of the mirror's container, drawn by the GPU. The effects' canvas textures, and when each is uploaded (each
// whole: Phaser 4.2.1 has no sub-rectangle upload), are in the "every texture upload" tests of the performance test:
//   occ       the occlusion field (occluders size, 4 B a pixel): at the build, once, painted before it is a texture; again
//             when a piece's footprint changes (a door swaps its sprite, a piece is moved), found at the next refresh
//   mirror    the atlas of still pieces at the glass (map width x 128 per row of glass): at the build, once, with the
//             pieces already there; again when a piece in front of the glass changes, or the reflections are switched
//   -back-N   one small canvas texture for each brand piece in the atlas (the piece's size, 4 B a pixel): made when the
//             atlas is painted, dropped and made again at the next paint of it
// and the pictures added at the build (water, water-data, glass, masks, tv-slide, occluders, and the optional normal
// map), once each. A walking crowd, a meeting, the night falling and a TV turning on upload nothing.
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
import { DRAWN_REBUILD_MS, DrawnPeople } from "../domain/drawnPeople";
import { CellValue, countInRooms, coverage, inside, type Box, type Rect } from "../domain/geometry";
import { footprints } from "../domain/groundShadow";
import {
    EMISSIVE_TINTS,
    lightsFrom,
    specKey,
    staticLights,
    touchesView,
    ViewCache,
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
    mirrorFlips,
    mirrorFoot,
    mirroredFrameName,
    mirrorsPiece,
    type FrameName,
    type GlassFace,
} from "../domain/mirror";
import { CloudClock, motionAllowed, progress } from "../domain/motion";
import {
    glassPanes,
    glassRowTop,
    maskByteAt,
    measureFootprint,
    packMasks,
    paintBackOf,
    starSlots,
    type GlassPane,
    type MaskBits,
} from "../domain/pixelMaps";
import { GLASS, GROUND, WATER } from "../domain/shaders";
import {
    newPersonShadow,
    personShadowFrames,
    STAMP_ATLAS_HEIGHT,
    STAMP_ATLAS_WIDTH,
    STAMP_CLASSES,
    STAMP_DIRECTIONS,
    STAMP_SIZE,
    type PersonShadow,
} from "../domain/personShadow";
import { ShadingGovernor } from "../domain/shadingGovernor";
import { pickShadingLevel, shadingWanted, type ShadingFlag, type ShadingLevel } from "../domain/shadingLevel";
import { lightUniformsInto } from "../domain/lightUniforms";
import { isPlainDay, localHour, lookAt, type Look, type Rgb } from "../domain/timeOfDay";
import { PlacedSnapshot } from "../domain/placedSnapshot";
import { Trail, type WalkerId } from "../domain/trail";
import { addPostFilter, type PostFilter, type UniformValue } from "./postFilter";
import { PeopleStamps, spriteFactory, stampFrameRects } from "./peopleShadow";
import { Shading, type ShadeBody } from "./shading";
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
    /** QA preview: rim light on the people and bevels on the props at night (domain/shaders, `@night-lit`). Off by default. */
    nightLit(): boolean;
    /**
     * `konclui.fx.rim`: how the room is shaded (cast shadows and light on the props and people). Read once, when the
     * effects are built. Absent: "off", and the effects are what they were before the shading existed.
     */
    shading?(): ShadingFlag;
    /** Whether the camera pass with the shading compiles on this GPU. Absent: it does. */
    shadedPostCompiles?(): boolean;
    /** The GPU's facts for the quality level: the unmasked renderer and the fragment shader's uniform limit. */
    gpu?(): { readonly renderer: string; readonly maxFragmentUniformVectors: number };
}

/**
 * What the effects use of the game scene: the factories and the texture manager they build with, the display list, the
 * pre-render event, the main camera (its filter list holds the camera pass), the map and the players. The game scene is
 * one, so production passes it as it is; a test hands over a made object, to see what the effects give back.
 */
export interface EffectsHost {
    readonly add: Pick<Phaser.GameObjects.GameObjectFactory, "shader" | "container" | "image"> &
        Partial<Pick<Phaser.GameObjects.GameObjectFactory, "sprite">>;
    readonly textures: Pick<
        Phaser.Textures.TextureManager,
        "addImage" | "addCanvas" | "get" | "getFrame" | "exists" | "remove"
    > & {
        // The game's texture manager outlives the scene: the effects listen to it for the removal of a texture they
        // show (an evicted baked avatar) and stop at their release.
        on(event: string, listener: (key: string) => void): unknown;
        off(event: string, listener: (key: string) => void): unknown;
    };
    readonly children: Pick<Phaser.GameObjects.DisplayList, "list">;
    readonly events: {
        on(event: string, listener: () => void): unknown;
        off(event: string, listener: () => void): unknown;
    };
    readonly cameras: { readonly main: Phaser.Cameras.Scene2D.Camera };
    readonly game: { readonly canvas: HTMLCanvasElement };
    readonly MapPlayersByKey: ReadonlyMap<number, RemotePlayer>;
    readonly fullDetailPlayers?: ReadonlySet<RemotePlayer>;
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
    /** Optional 2.5D silhouette-aware normal map (`fx/normal.png`). */
    readonly normal?: HTMLImageElement;
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

/** Whoever is drawn: the player or a remote character, at their feet. Records are pooled and rewritten each frame. */
interface Person {
    id: WalkerId;
    x: number;
    y: number;
    me: boolean;
    // the masks under the feet, read again only when they moved
    maskX: number;
    maskY: number;
    /** Bit 4 of the masks: the lawn, where walkers press the grass. */
    onLawn: boolean;
    polished: boolean;
    /** The stamp under the person: its direction and length, kept between frames. */
    readonly shadow: PersonShadow;
}

/** What the effects read of a character: its feet, whether it is drawn, and its sprites. */
interface Body {
    readonly x: number;
    readonly y: number;
    readonly visible: boolean;
    readonly list: readonly unknown[];
    /** Its depth in the scene: the stamp under it is drawn just below. */
    readonly depth?: number;
}

/** A picture in the mirror. The records of the people's pictures are pooled, so the fields are written in place. */
interface MirrorPicture {
    key: string;
    frame: FrameName | undefined;
    x: number;
    y: number;
    originX: number;
    originY: number;
    flip: boolean;
    alpha: number;
    scaleX: number;
    scaleY: number;
    face: GlassFace;
    /** A brand piece, shown from its back. */
    back: boolean;
    /** From the glass, so the nearer covers the farther. */
    distance: number;
}

interface MirrorPiece {
    readonly face: GlassFace;
    readonly picture: MirrorPicture;
}

/** A pooled piece, written in place. */
interface MirrorPieceSlot {
    face: GlassFace;
    picture: MirrorPicture;
}

type MapEntity =
    ReturnType<ReturnType<GameMapFrontWrapper["getEntitiesManager"]>["getEntities"]> extends Map<string, infer E>
        ? E
        : never;

/** A picture put on the glass: pooled, written in place by `place`. */
interface PlacedMirrorPicture {
    flip: boolean;
    key: string;
    frame: FrameName | undefined;
    left: number;
    top: number;
    w: number;
    h: number;
    alpha: number;
    scaleX: number;
    scaleY: number;
    face: GlassFace;
    distance: number;
    /** A piece drawn here only on the live panes; the atlas draws it elsewhere. */
    onlyLive: boolean;
}

/** What the camera pass reads on a draw, written by `frame` and kept (one object, rewritten each frame). */
interface FrameState {
    ready: boolean;
    view: Rect;
    look: Look;
    lockCount: number;
    mirroredCount: number;
    reveal: number;
    clouds: number;
    me: Person | undefined;
    lit: readonly Light[];
    glowCount: number;
}

/** The most the shader takes of each: people mirrored on the floor and shaded on the ground, locked rooms, glow rects. */
const MAX_MIRRORED = 8;
/** The people ranked for the shader's eight: one already in them stays until it is past this many by distance. */
const PEOPLE_KEPT = 10;
const MAX_LOCKS = 6;
const MAX_GLOW = 24;
/** Panes the mirror draws whole while someone crosses them. */
const MAX_LIVE_PANES = 8;
/** Candidates the glow cache keeps: the exact view then cuts them to `MAX_GLOW`. */
const GLOW_CANDIDATES = 64;
/** The grid, in px, the camera's place is cut to for what depends on the view alone (the cache, the outdoor share). */
const VIEW_CELL = 16;
const SHARE_CELL = 8;
const NO_FACE: GlassFace = [0, 0, 0];
const NO_PANES: readonly GlassPane[] = [];
const NO_LIGHTS: readonly Light[] = [];
const NO_UNIFORMS: Record<string, UniformValue> = {};
const NO_FEET: readonly Rect[] = [];
const NO_MEETING = (): boolean => false;

/** A map piece in the scene's children: an Image (what the entity manager places), not a layer or an effect's own. */
export const isPlacedImage = (child: unknown): child is Phaser.GameObjects.Image =>
    child instanceof Phaser.GameObjects.Image && child.type === "Image";
const ZERO_TINT = [0, 0, 0, 0];

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
const WATER_GRADE_FLAT = WATER_GRADE.flat();
const WATER_HALF_FLAT = WATER_HALF.flat();
const KOI_RING_FLAT = KOI_RING.flat();
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
/**
 * The QA settings (the fixed hour, the night-lit preview) are read again this often, so that a change made from the
 * console, in this tab, shows in under a second and not at the refresh a second away: the page gives no event for a
 * change of its own localStorage. A read of two keys, four times a second.
 */
export const QA_POLL_MS = 250;
/** The name tags are measured again, for a camera or a crowd that moved, at most this often (ms). */
export const LABEL_MEASURE_MS = 100;

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
    // undefined while the build paints the field into its canvas, before it is a texture (see the constructor)
    private occTexture: Phaser.Textures.CanvasTexture | undefined;
    private occRaw: HTMLCanvasElement | undefined;
    private occSignature = "";
    private readonly placedSnapshot: PlacedSnapshot;
    // the pieces were read at the build, before the first refresh: its lights and screens are still to be worked out
    private piecesUnseen = false;
    // the placed images that give a light, as of the last change to the placed images
    private litPieces: Phaser.GameObjects.Image[] = [];
    // the meetings the lights, and the screens of the TVs, were last worked out for
    private lightsMeetingMask = 0;
    private tvsMeetingMask = 0;
    private readonly stars: Float32Array;
    private readonly statics: Light[];
    private pools: Light[];
    private emissive: EmissiveRect[] = [];
    private rings: { x: number; y: number; tick: number; seed: number }[] = [];
    // The name tags hidden behind the frost, and the ones to hide this frame: two arrays swapped, with the count of each.
    // (A Set would be cleared and filled on each frame, and a cleared Set makes a new table.)
    private hiddenTags: (HTMLElement | undefined)[] = [];
    private hiddenCount = 0;
    // what the name tags were last measured for: the locked rooms in view, how many tags, the crowd's feet, the camera
    private labelsAt = Number.NEGATIVE_INFINITY;
    private labelLocks = -1;
    private labelTags = -1;
    private labelCrowd = 0;
    private readonly labelView: [number, number, number, number] = [Number.NaN, 0, 0, 0];
    private shownTags: (HTMLElement | undefined)[] = [];
    // every name tag of the page: live, so each frame reads it by index and makes no list of them
    private readonly nameTags = document.getElementsByClassName("username-display");
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
    // `isPlainDay(look)`, worked out when the look changes, not on each frame
    private plainDay: boolean;
    private features: FeatureSwitches;
    private measured: Record<string, Box | null> = {};
    private readonly state: FrameState;
    // `motion()` as of the last frame, for the uniforms of the draw that follows it
    private motionNow = false;
    private now: number;
    private lastRefresh: number;
    private lastQaPoll: number;
    // the fixed hour as the environment last gave it (undefined: Brasília's clock), for the poll of the QA settings
    private fixedHourSeen: number | undefined;
    private lastTick: number;
    private readonly tickDelay: number | undefined;
    private animateUntil = 0;
    private animating = false;

    private readonly water: Phaser.GameObjects.Shader;
    private readonly ground: Phaser.GameObjects.Shader;
    private readonly glass: Phaser.GameObjects.Shader;
    private readonly post: Phaser.Filters.Controller;
    private readonly postFilter: PostFilter;

    // who is drawn: the player and the remote characters the scene draws in full, read each frame
    private readonly drawn: DrawnPeople<number, RemotePlayer>;
    private readonly crowd: Person[] = [];
    private crowdCount = 0;
    private readonly viewRect: [x: number, y: number, w: number, h: number] = [0, 0, 0, 0];
    private readonly mirroredList: Person[] = [];
    private readonly lockList: Rect[] = [];
    private readonly glowList: EmissiveRect[] = [];
    private readonly roomCounts: Int32Array;
    private meetingMask = 0;

    // what a footstep must not recompute: the lights that reach the view, the share of the view outdoors
    private lightsRev = 0;
    private nightOn = false;
    private readonly litCache: ViewCache<Light>;
    private readonly glowCache: ViewCache<EmissiveRect>;
    private readonly outdoors = new CellValue(SHARE_CELL, (view) => this.share(view, 1));
    private readonly wetness = new CellValue(SHARE_CELL, (view) => this.share(view, 8));

    // the camera pass's uniforms, written in place on each draw (Phaser applies them before the next draw)
    private readonly postRecord: Record<string, UniformValue>;
    private readonly normalsOn: number;
    private readonly emissiveData = new Float32Array(MAX_GLOW * 4);
    private readonly lightData = new Float32Array(128);
    private readonly lightColorData = new Float32Array(128);
    private readonly lightClipData = new Float32Array(128);
    private readonly lockData = new Float32Array(MAX_LOCKS * 4);
    private readonly stepData: Float32Array;
    private readonly avatarData = new Float32Array(MAX_MIRRORED * 4);
    private readonly peopleData = new Float32Array(MAX_MIRRORED * 4);
    // the ten drawn people nearest the view's centre: their places in `crowd` and their squared distances from it
    private readonly peopleTop = new Int32Array(PEOPLE_KEPT);
    private readonly peopleRank = new Float64Array(PEOPLE_KEPT);
    // who is in `peopleData` (two arrays swapped, so that a frame knows the last frame's eight and makes nothing)
    private peopleIds: WalkerId[] = [];
    private peopleIdsNext: WalkerId[] = [];
    private peopleCount = 0;
    // a hash of where the drawn people stand, written by `gather`: it changes when one of them moves
    private crowdHash = 0;
    private rimOn = 0;
    // the shading (konclui.fx.rim = 1, full, reduced): made only when the flag asks for it, so a room without it has none
    // of it: no texture, no blend mode, no stamps, no node, and the uniform record it always had
    private readonly shading: Shading | undefined;
    private readonly governor: ShadingGovernor | undefined;
    private readonly shadingFlag: ShadingFlag;
    private lastFrameTime = Number.NaN;
    private readonly crowdBodies: Body[] = [];
    private lastRebuilds = -1;
    private lastFeet: readonly Rect[] = [];
    private readonly peopleFrame: {
        count: number;
        people: readonly Person[];
        bodies: readonly ShadeBody[];
        rebuilt: boolean;
        pools: readonly Light[];
        lamps: number;
        centre: [number, number];
    };
    private readonly resolution = [0, 0];
    private readonly shafts = [0, 58, 24, 0.84];
    private readonly cloud = [0, 236, 0, 0];
    private readonly cloudOffset = [0, 0];
    private readonly vignetteUniform = [0, 0.62];
    private readonly revealUniform = [0, 0, 0, 0];
    private readonly inkUniform: number[];
    private readonly mapSize: number[];
    private readonly glassCam = [0, 0];
    private readonly glassRows: number[] = [];
    private readonly glassSize: number[] = [0, 0];
    private readonly waterRings = new Float32Array(64);

    // the mirror
    private readonly mirror: Phaser.GameObjects.Container;
    private readonly mirrorPanes = new Map<GlassFace, GlassPane[]>();
    private readonly mirrorPool: Phaser.GameObjects.Image[] = [];
    private mirrorPieces: MirrorPiece[] = [];
    // the pieces found in front of the glass at the last refresh, pooled: compared with `mirrorPieces`
    private readonly candidates: MirrorPieceSlot[] = [];
    private candidateCount = 0;
    // Only static brand pieces need a separate texture for their painted back.
    private readonly pieceBacks = new Map<MirrorPicture, string>();
    // each frame's pictures and where they land on the glass, pooled
    private readonly viewFaces: GlassFace[] = [];
    private readonly pictures: MirrorPicture[] = [];
    private pictureCount = 0;
    private readonly placed: PlacedMirrorPicture[] = [];
    private readonly livePanes: GlassPane[] = [];
    private liveCount = 0;
    // the panes drawn by the container (drawMirror)
    private readonly mirrorLive = new Float32Array(32);
    private mirrorLiveN = 0;
    private readonly mirrorRows: number[];
    private readonly mirrorAtlas: HTMLCanvasElement;
    private mirrorKey = "";
    private readonly mirrorTexture: Phaser.Textures.CanvasTexture;
    private mirrorTmp: HTMLCanvasElement | undefined;
    private mirrorStatic = false;
    private mirrorShown = 0;

    private readonly onPreRender = (): void => this.frame();

    constructor(options: SceneEffectsOptions) {
        const { scene, manifest, images, normal, generation } = options;
        this.scene = scene;
        this.renderer = options.renderer;
        this.manifest = manifest;
        this.environment = options.environment;
        this.features = options.features;
        this.now = options.time;
        this.lastRefresh = options.time;
        this.lastQaPoll = options.time;
        this.lastTick = options.time;
        this.resources = new SceneResources(scene.textures);
        this.drawn = new DrawnPeople(
            scene.MapPlayersByKey,
            (id) => this.trail.release(id),
            DRAWN_REBUILD_MS,
            (visit) => {
                const detailed = scene.fullDetailPlayers;
                if (detailed) {
                    // forEach, not for...of: a for...of over the set makes a result object for each of its 80 members
                    detailed.forEach((body) => visit(body, body.userId));
                } else {
                    scene.MapPlayersByKey.forEach(visit);
                }
            },
        );
        this.roomCounts = new Int32Array(manifest.rooms.length);
        this.stepData = new Float32Array(this.trail.max * 4);
        this.inkUniform = manifest.ink.map((c) => c / 255);
        this.mapSize = [manifest.map[0], manifest.map[1]];
        this.litCache = new ViewCache(VIEW_CELL, (area) =>
            visibleLights(
                this.pools.filter((l) => !l.night || this.nightOn),
                area,
                32,
            ),
        );
        this.glowCache = new ViewCache(VIEW_CELL, (area) => visibleRects(this.emissive, area, GLOW_CANDIDATES));
        const wrapper = scene.getGameMapFrontWrapper();
        for (const layer of wrapper.phaserLayers) this.layers.set(layer.layer.name, layer);
        this.tickDelay = wrapper.getTileAnimationRefreshDelay();
        [this.mapW, this.mapH] = manifest.map;
        this.look = lookAt(this.hour(), this.features);
        this.lookKey = JSON.stringify(this.look);
        this.plainDay = isPlainDay(this.look);
        this.state = {
            ready: false,
            view: this.viewRect,
            look: this.look,
            lockCount: 0,
            mirroredCount: 0,
            reveal: -1,
            clouds: 0,
            me: undefined,
            lit: NO_LIGHTS,
            glowCount: 0,
        };
        this.normalsOn = normal ? 1 : 0;
        this.rimOn = this.environment.nightLit() ? 1 : 0;
        // The shading needs its own program to compile; when it does not the room keeps the legacy pass, with a warning.
        const flag = this.environment.shading?.() ?? "off";
        const shaded = shadingWanted(flag) && (this.environment.shadedPostCompiles?.() ?? true);
        this.shadingFlag = shaded ? flag : "off";
        const picked = this.pickLevel();
        this.governor = shaded ? new ShadingGovernor(picked) : undefined;
        this.placedSnapshot = new PlacedSnapshot(shaded);
        this.peopleFrame = {
            count: 0,
            people: this.crowd,
            bodies: this.crowdBodies,
            rebuilt: false,
            pools: NO_LIGHTS,
            lamps: 0,
            centre: [0, 0],
        };
        this.postRecord = this.postUniformRecord();
        // Registered first, so that a failure while building still gives back what was made so far.
        this.resources.onRelease(() => this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.onPreRender));
        this.resources.onRelease(() => this.restorePage());
        scene.textures.on(Phaser.Textures.Events.REMOVE, this.onTextureRemoved);
        this.resources.onRelease(() => this.scene.textures.off(Phaser.Textures.Events.REMOVE, this.onTextureRemoved));
        try {
            for (const name of EFFECT_TEXTURES) {
                const key = `kfx-${generation}-${name}`;
                const texture = scene.textures.addImage(key, images[name]);
                if (!texture) throw new Error(`[konclui] effects: the texture ${key} already exists`);
                this.addKey(name, key);
                texture.setFilter(Phaser.Textures.FilterMode.NEAREST); // whole art pixels
            }
            if (normal) {
                const normalKey = `kfx-${generation}-normal`;
                const normalTex = scene.textures.addImage(normalKey, normal);
                if (!normalTex) throw new Error(`[konclui] effects: the texture ${normalKey} already exists`);
                this.addKey("normal", normalKey);
                normalTex.setFilter(Phaser.Textures.FilterMode.NEAREST);
            }
            this.masks = packMasks(readPixels(images.masks));
            // The occlusion field: the walls (occluders.png, half the map's size, at half weight) and every standing
            // object's footprint, blurred in green (red keeps them sharp), drawn on a canvas whenever something moves
            // and read by the ground quad under the sprites, banded there.
            this.occWalls = images.occluders;
            this.occDraw = makeCanvas(images.occluders.width, images.occluders.height);
            this.occCanvas = makeCanvas(images.occluders.width, images.occluders.height);
            // The pieces already on the map are read and their footprints drawn into the canvas before it is made a
            // texture: the first upload is the finished field, not a blank one and then this (the second upload of the
            // same canvas was 4,931,584 B at the office's size). The first refresh then has lights and screens to make.
            this.shading = this.shadingFlag === "off" ? undefined : this.buildShading(generation);
            const shading = this.shading;
            if (shading) this.resources.onRelease(() => shading.destroy());
            this.readPieces(true);
            this.piecesUnseen = true;
            const occTexture = this.addCanvasTexture("occ", `kfx-${generation}-occ`, this.occCanvas);
            occTexture.setFilter(Phaser.Textures.FilterMode.LINEAR);
            this.occTexture = occTexture;
            this.stars = starSlots(readPixels(images["water-data"]));
            this.statics = staticLights(manifest.staticLights);
            this.pools = this.statics;
            this.water = this.buildWater();
            this.ground = this.buildGround();
            const mirror = this.buildMirror(images.glass);
            this.mirror = mirror.container;
            this.mirrorRows = mirror.rows;
            for (let i = 0; i < 4; i++) this.glassRows.push(this.mirrorRows[i] ?? -1);
            this.mirrorAtlas = mirror.atlas;
            this.glassSize[0] = mirror.atlas.width;
            this.glassSize[1] = mirror.atlas.height;
            this.mirrorKey = `kfx-${generation}-mirror`;
            // The pieces standing at the glass now are painted into the atlas before it is made a texture, as the
            // occlusion field is: one upload of the finished atlas, not a black one and then this.
            this.mirrorPieces = this.snapshotCandidates(this.features.reflections ? this.findMirrorPieces() : 0);
            if (this.mirrorPieces.length > 0) this.paintAtlas(this.mirrorPieces);
            this.mirrorTexture = this.addCanvasTexture("mirror", this.mirrorKey, mirror.atlas);
            this.mirrorTexture.setFilter(Phaser.Textures.FilterMode.NEAREST);
            this.glass = this.buildGlass();
            this.placeAbove(this.mirror, this.glass);
            this.postFilter = addPostFilter(
                this.renderer,
                scene.cameras.main,
                {
                    postUniforms: () => this.postUniforms(),
                    masksTexture: () => this.texture("masks"),
                    normalsTexture: () => (this.normalsOn > 0 ? this.texture("normal") : null),
                    castTexture: () => this.shading?.glTexture ?? null,
                },
                undefined,
                this.shading !== undefined,
            );
            this.post = this.postFilter.controller;
            const postFilter = this.postFilter;
            this.resources.onRelease(() => postFilter.remove());
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
        if (this.governor && Number.isFinite(this.lastFrameTime) && this.governor.push(time - this.lastFrameTime)) {
            this.applyShadingLevel();
        }
        this.lastFrameTime = time;
        // Both clocks advance by their own period, not to the frame time, so a frame that lands late does not slow
        // them; one that is more than four periods behind (a hidden tab) starts over instead of catching up.
        if (time - this.lastRefresh >= REFRESH_MS) {
            this.lastRefresh += REFRESH_MS;
            if (time - this.lastRefresh > REFRESH_MS * 4) this.lastRefresh = time;
            this.lastQaPoll = time;
            this.refresh(false);
        } else if (time - this.lastQaPoll >= QA_POLL_MS) {
            this.lastQaPoll = time;
            if (this.qaSettingsChanged()) this.refresh(false);
        }
        if (this.tickDelay !== undefined && time - this.lastTick >= this.tickDelay) {
            this.lastTick += this.tickDelay;
            if (time - this.lastTick > this.tickDelay * 4) this.lastTick = time;
            if (!this.stillness.animationsOff && this.tick(this.tickDelay)) this.scene.markDirty();
        }
        if (this.animating) {
            this.scene.markDirty();
            if (time >= this.animateUntil) this.animating = false;
        }
    }

    /**
     * Whether a setting the page can change under the effects is not what the last refresh used: the fixed hour, the
     * night-lit preview, "Disable map animations", reduced motion. These are the only reads of the page that are not once
     * a second: four a second at most, and none on a frame.
     */
    private qaSettingsChanged(): boolean {
        return (
            this.environment.fixedHour() !== this.fixedHourSeen ||
            (this.environment.nightLit() ? 1 : 0) !== this.rimOn ||
            this.environment.reducedMotion() !== this.stillness.reducedMotion ||
            this.environment.animationsOff() !== this.stillness.animationsOff
        );
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
        // fixed for the room: made once, not on each draw
        const waterRect = [x, y, w, h];
        const glintUniform = flat(glint);
        const lineUniform = flat([waterline]);
        const water = this.scene.add.shader(
            {
                name: "kfxWater",
                fragmentSource: WATER,
                setupUniforms: (set: (name: string, value: UniformValue) => void) => {
                    set("uWater", 0);
                    set("uData", 1);
                    set("uRect", waterRect);
                    set("uTick", this.waterTick);
                    set("uSun", Math.max(this.look.sun, this.look.clouds));
                    set("uPal[0]", WATER_GRADE_FLAT);
                    set("uHalf[0]", WATER_HALF_FLAT);
                    set("uRing[0]", KOI_RING_FLAT);
                    set("uStars[0]", this.stars);
                    set("uGlint[0]", glintUniform);
                    set("uLine", lineUniform);
                    set("uCore", CAUSTIC.core);
                    set("uHalo", CAUSTIC.halo);
                    set("uWhite", CAUSTIC.white);
                    const rings = this.waterRings;
                    rings.fill(0);
                    const first = Math.max(0, this.rings.length - 16);
                    for (let i = first; i < this.rings.length; i++) {
                        const r = this.rings[i];
                        const o = (i - first) * 4;
                        rings[o] = r.x - x;
                        rings[o + 1] = r.y - y;
                        rings[o + 2] = r.tick;
                        rings[o + 3] = r.seed;
                    }
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
                    set("uMap", this.mapSize);
                    set("uShadow", this.look.shadow);
                    set("uPeople[0]", this.peopleData);
                    // with the shading on, the people's shadows are the stamps': none here, or they would be doubled
                    set("uPeopleN", this.shadingOn() ? 0 : this.peopleCount);
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

    /**
     * Feet of whoever is drawn in or near the view, for the ground's shade and the night's rim light: at most eight (the
     * shader takes eight), into `peopleData`. The eight nearest the view's centre, with a margin: someone already in the
     * eight keeps the place until they are past the tenth by distance, so a person near the cut does not flicker in and
     * out as the camera or the crowd moves by a pixel. The ten nearest are kept in place in `peopleTop` (squared
     * distances in `peopleRank`) and nothing is made.
     */
    private placePeopleUniform(view: Rect): void {
        const data = this.peopleData;
        const rank = this.peopleRank;
        const top = this.peopleTop;
        data.fill(0);
        const cx = view[0] + view[2] / 2;
        const cy = view[1] + view[3] / 2;
        let found = 0;
        for (let i = 0; i < this.crowdCount; i++) {
            const p = this.crowd[i];
            if (!nearView(p.x, p.y, view)) continue;
            const dx = p.x - cx;
            const dy = p.y - cy;
            const d = dx * dx + dy * dy;
            if (found === PEOPLE_KEPT && d >= rank[PEOPLE_KEPT - 1]) continue;
            let at = found < PEOPLE_KEPT ? found : PEOPLE_KEPT - 1;
            while (at > 0 && rank[at - 1] > d) {
                rank[at] = rank[at - 1];
                top[at] = top[at - 1];
                at -= 1;
            }
            rank[at] = d;
            top[at] = i;
            if (found < PEOPLE_KEPT) found += 1;
        }
        // those of the last frame's eight that are still among the ten first, then the nearest of the others
        const before = this.peopleIds;
        const beforeCount = this.peopleCount;
        const after = this.peopleIdsNext;
        let n = 0;
        for (let pass = 0; pass < 2; pass++) {
            for (let t = 0; t < found && n < MAX_MIRRORED; t++) {
                const p = this.crowd[top[t]];
                let was = false;
                for (let k = 0; k < beforeCount; k++) {
                    if (before[k] === p.id) {
                        was = true;
                        break;
                    }
                }
                if (was !== (pass === 0)) continue;
                data[n * 4] = Math.round(p.x);
                data[n * 4 + 1] = Math.round(p.y) + 1;
                after[n] = p.id;
                n += 1;
            }
        }
        this.peopleIds = after;
        this.peopleIdsNext = before;
        this.peopleCount = n;
    }

    private buildGlass(): Phaser.GameObjects.Shader {
        const glass = this.scene.add.shader(
            {
                name: "kfxGlass",
                fragmentSource: GLASS,
                setupUniforms: (set: (name: string, value: UniformValue) => void) => {
                    const cam = this.scene.cameras.main;
                    const sheen = this.features.glass ? this.look.sheen : 0;
                    this.glassCam[0] = Math.round(cam.scrollX);
                    this.glassCam[1] = Math.round(cam.scrollY);
                    set("uGlass", 0);
                    set("uMap", this.mapSize);
                    set("uCam", this.glassCam);
                    set("uStrength", sheen);
                    // the quad may show for the mirror alone
                    set("uTint", sheen > 0 ? this.look.glass : ZERO_TINT);
                    set("uMirror", 1);
                    set("uMirrorRows", this.glassRows);
                    set("uMirrorSize", this.glassSize);
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
    private buildMirror(glassImage: HTMLImageElement): {
        container: Phaser.GameObjects.Container;
        rows: number[];
        atlas: HTMLCanvasElement;
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
        // black before it is made a texture: the first upload is the opaque one, not a blank one and then this
        const blank = context2d(atlas);
        blank.fillStyle = "#000";
        blank.fillRect(0, 0, atlas.width, atlas.height);
        return { container, rows, atlas };
    }

    /**
     * The pieces in the atlas: each seen from its other side (turned over), cropped to its face's panes, its colour in
     * its row's band and its strength (mirrorAlpha) in the band below, the farthest from the glass first (the nearer
     * covers it). Done when the pieces change, not per frame.
     */
    private paintMirror(pieces: readonly MirrorPiece[]): void {
        this.paintAtlas(pieces);
        this.mirrorTexture.refresh();
    }

    /** `paintMirror` without the upload: the atlas canvas and the brand pieces' back textures. */
    private paintAtlas(pieces: readonly MirrorPiece[]): void {
        for (const key of this.pieceBacks.values()) {
            for (const image of this.mirrorPool) {
                if (image.texture.key === key) this.parkMirrorImage(image);
            }
            this.resources.dropTexture(key);
        }
        this.pieceBacks.clear();
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
            if (back) {
                backOf(t, w, h);
                const canvas = makeCanvas(w, h);
                context2d(canvas).drawImage(tmp, 0, 0);
                const key = `${this.mirrorKey}-back-${this.pieceBacks.size}`;
                const texture = this.scene.textures.addCanvas(key, canvas);
                if (!texture) throw new Error(`[konclui] effects: duplicate piece texture ${key}`);
                this.resources.texture(key);
                texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
                this.pieceBacks.set(picture, key);
            }
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
        this.mirrorStatic = pieces.length > 0;
    }

    // ------------------------------------------------------------------------------------------------ state

    // What asks for stillness, as of the last refresh or QA poll. `motion()` runs on every frame, and the user's
    // "Disable map animations" is a localStorage read: it is read at the refresh and the poll, never on a frame.
    private readonly stillness = { reducedMotion: false, animationsOff: false };

    private readStillness(): void {
        this.stillness.reducedMotion = this.environment.reducedMotion();
        this.stillness.animationsOff = this.environment.animationsOff();
    }

    private motion(): boolean {
        return motionAllowed(this.stillness);
    }

    private hour(): number {
        const fixed = this.environment.fixedHour();
        this.fixedHourSeen = fixed;
        return fixed ?? localHour();
    }

    /**
     * The player and the remote characters the scene draws in full, at their feet, into the pooled `crowd`. A culled
     * character and a dot have nothing to shade or mirror and are not read: see DrawnPeople.
     */
    private gather(): void {
        let n = 0;
        this.crowdHash = 0;
        const me = this.currentPlayer();
        if (me) n = this.putPerson(n, "me", me, true);
        const bodies = this.drawn.bodies(this.now);
        const keys = this.drawn.keys;
        for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
            if (body.visible) n = this.putPerson(n, keys[i], body, false);
        }
        this.crowdCount = n;
    }

    private putPerson(n: number, id: WalkerId, body: Body, me: boolean): number {
        const x = body.x;
        const y = body.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return n;
        const person =
            this.crowd[n] ??
            (this.crowd[n] = {
                id,
                x: 0,
                y: 0,
                me,
                maskX: Number.NaN,
                maskY: Number.NaN,
                onLawn: false,
                polished: false,
                shadow: newPersonShadow(),
            });
        // another person at this place: their stamp starts from their own light, not the last one's
        if (person.id !== id) person.shadow.picked = false;
        this.crowdBodies[n] = body;
        person.id = id;
        person.x = x;
        person.y = y + 15;
        person.me = me;
        this.crowdHash = Math.imul(Math.imul(this.crowdHash ^ Math.round(x), 16777619) ^ Math.round(y), 16777619);
        return n + 1;
    }

    /** Whether the masks under a person's feet say water and polished floor: read again only in another 2 x 2 px cell. */
    private readMasks(p: Person): void {
        const cellX = Math.floor(p.x / 2);
        const cellY = Math.floor(p.y / 2);
        if (p.maskX === cellX && p.maskY === cellY) return;
        p.maskX = cellX;
        p.maskY = cellY;
        const b = maskByteAt(this.masks, p.x, p.y);
        p.onLawn = (b & 4) !== 0;
        p.polished = (b & (2 | 32)) !== 0;
    }

    /** Counts everyone, drawn or not, in each room, into `roomCounts`, and the rooms with a meeting into a bitmask. */
    private countRooms(): void {
        const counts = this.roomCounts;
        counts.fill(0);
        const rooms = this.manifest.rooms;
        const count = (body: Body): void => {
            if (Number.isFinite(body.x) && Number.isFinite(body.y)) countInRooms(counts, rooms, body.x, body.y + 15);
        };
        const me = this.currentPlayer();
        if (me) count(me);
        this.scene.MapPlayersByKey.forEach(count);
        let mask = 0;
        for (let i = 0; i < counts.length; i++) if (counts[i] >= 2) mask |= 1 << i;
        if (mask !== this.meetingMask) {
            this.meetingMask = mask;
            this.lightsRev += 1;
        }
    }

    /** Whether the room a point stands in holds a meeting: from the room counts of the last refresh. */
    private readonly meetingAt = (x: number, y: number): boolean => {
        const rooms = this.manifest.rooms;
        for (let i = 0; i < rooms.length; i++) {
            const r = rooms[i];
            // a TV hangs on the wall face above its room's floor: the room counts from two tiles above the floor
            if (this.roomCounts[i] >= 2 && inside(x, y, [r.floor[0], r.floor[1] - 64, r.floor[2], r.floor[3] + 64]))
                return true;
        }
        return false;
    };

    private currentPlayer(): Player | undefined {
        return this.scene.CurrentPlayer;
    }

    /** Share of the camera's view where a mask bit holds, from a grid of points about 24 px apart. */
    private share(view: Rect, bit: number): number {
        const cols = Math.max(4, Math.round(view[2] / 24));
        const rows = Math.max(4, Math.round(view[3] / 24));
        let hits = 0;
        for (let gy = 0; gy < rows; gy++) {
            for (let gx = 0; gx < cols; gx++) {
                const b = maskByteAt(
                    this.masks,
                    view[0] + ((gx + 0.5) * view[2]) / cols,
                    view[1] + ((gy + 0.5) * view[3]) / rows,
                );
                if ((b & bit) !== 0) hits += 1;
            }
        }
        return hits / (cols * rows);
    }

    /** Share of the view outdoors: kept while the view stays in one `SHARE_CELL` px cell (and size), as the masks are fixed. */
    private outsideShare(view: Rect): number {
        return this.outdoors.get(view);
    }

    /** Open water in view (masks B = 128), not just the pool's bounding box touching an edge of it. */
    private waterShare(view: Rect): number {
        return this.wetness.get(view);
    }

    /** The camera's view, written into one array: the same one every call. */
    private view(): Rect {
        const v = this.scene.cameras.main.worldView;
        const view = this.viewRect;
        view[0] = v.x;
        view[1] = v.y;
        view[2] = v.width;
        view[3] = v.height;
        return view;
    }

    /** Every second and on a settings change: the hour, locks, meetings and lights; marks the scene dirty on change. */
    private refresh(force: boolean): void {
        this.readStillness();
        const hour = this.hour();
        const look = lookAt(hour, this.features);
        // everyone counts for a room, the culled and the dots too: a TV lights for two people in its room whether or
        // not they are drawn (once a second, not on each frame)
        this.countRooms();
        const meetingAt = this.meetingAt;
        this.trail.forgetUnless(this.isKnownWalker);
        // What the map's pieces give (footprints, lights, screens) is worked out again only when a piece was added,
        // removed, moved or retextured, or a meeting started or ended: not every second to find out nothing changed.
        const snapshotChanged = !this.placedSnapshot.matches(this.scene.children.list, isPlacedImage);
        const piecesChanged = snapshotChanged || this.piecesUnseen;
        this.piecesUnseen = false;
        if (snapshotChanged && this.readPieces()) force = true;
        const lit = this.litPieces;
        let changed = force;
        if (piecesChanged || this.meetingMask !== this.lightsMeetingMask) {
            this.lightsMeetingMask = this.meetingMask;
            const { pools, emissive } = lightsFrom(
                lit.map((o) => ({ key: o.texture.key, x: o.x, y: o.y })),
                this.manifest.lights,
                this.manifest.spaces,
                meetingAt,
            );
            const signature = pools.map((l) => `${l.kind}${Math.round(l.x)},${Math.round(l.y)}`).join(";");
            if (signature !== this.lightSignature) {
                this.pools = [...pools, ...this.statics];
                this.emissive = emissive;
                this.lightSignature = signature;
                this.lightsRev += 1;
                changed = true;
            }
        }
        const rim = this.environment.nightLit() ? 1 : 0;
        if (rim !== this.rimOn) {
            this.rimOn = rim;
            changed = true;
        }
        const focus = this.features.vignette && this.environment.focused();
        const lookKey = JSON.stringify(look);
        if (this.shading) {
            // the key's state (direction and length) moves a dozen times a day: only then is the key's channel baked again
            this.shading.setHour(hour);
            if (this.applyShadingLevel()) changed = true;
        }
        if (lookKey !== this.lookKey) {
            this.look = look;
            this.lookKey = lookKey;
            this.plainDay = isPlainDay(look);
            changed = true;
        }
        // `force` covers the TV switch: only `setFeatures` changes the switches, and it refreshes with `force`
        if (force || piecesChanged || this.meetingMask !== this.tvsMeetingMask) {
            this.tvsMeetingMask = this.meetingMask;
            this.updateTvs(lit, this.features.tv ? meetingAt : NO_MEETING);
        }
        if (focus !== this.vignette.to > 0) {
            Object.assign(this.vignette, { from: this.vignette.value, to: focus ? 0.24 : 0, at: this.now });
            this.animate(this.stillness.reducedMotion ? 0 : 500);
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
        // The mirror is painted again only when a piece in front of the glass differs from the one painted.
        const found = this.features.reflections ? this.findMirrorPieces() : 0;
        if (!this.candidatesAreMirrored(found)) {
            const pieces = this.snapshotCandidates(found);
            this.mirrorPieces = pieces;
            this.paintMirror(pieces);
            changed = true;
        }
        if (changed) this.scene.markDirty();
    }

    /**
     * Reads the placed images again: which give a light, and where the floor is blocked. True when the blocked floor
     * changed and the occlusion was drawn again.
     */
    private readPieces(settled = false): boolean {
        const placed = this.scene.children.list.filter(isPlacedImage);
        this.placedSnapshot.capture(placed);
        this.litPieces = placed.filter((o) => this.lightSpec(o) !== undefined);
        const feet = footprints(
            placed.map((o) => ({ key: o.texture.key, x: o.x, y: o.y })),
            this.shadowSpecs(placed),
        );
        this.shading?.setPieces(placed, this.now, settled);
        this.lastFeet = feet;
        // with the shading on the ground quad keeps the walls' band and drops the footprints: the cast shadows are theirs
        const shown = this.shadingOn() ? NO_FEET : feet;
        const occSignature = `${shown === NO_FEET ? "s|" : ""}${feet.map((r) => r.join(",")).join(";")}`;
        if (occSignature === this.occSignature) return false;
        this.drawOcclusion(shown);
        this.occSignature = occSignature;
        return true;
    }

    /** Whether the shading is drawing now: the flag asked for it and the level is above 0. */
    private shadingOn(): boolean {
        return this.shading !== undefined && this.shading.level > 0;
    }

    /**
     * The level the machine and the view allow: the flag, the GPU, the zoom and the picture's size (domain/shadingLevel).
     * The switches and the governor come after.
     */
    private pickLevel(): ShadingLevel {
        if (!shadingWanted(this.shadingFlag)) return 0; // a room without the shading reads nothing from the GPU
        const gpu = this.environment.gpu?.() ?? { renderer: "", maxFragmentUniformVectors: 1024 };
        return pickShadingLevel(this.shadingFlag, {
            renderer: gpu.renderer,
            maxFragmentUniformVectors: gpu.maxFragmentUniformVectors,
            zoom: this.scene.cameras.main.zoom,
            viewPixels: this.renderer.width * this.renderer.height,
        });
    }

    /** The level in force: 0 with the shadows switch off, else the lower of the governor's and the one picked now. */
    private appliedLevel(): ShadingLevel {
        if (!this.governor || !this.features.shadows) return 0;
        return Math.min(this.governor.level, this.pickLevel()) as ShadingLevel;
    }

    /** Puts the level in force; true when it changed. The ground's footprints come back or go with it. */
    private applyShadingLevel(): boolean {
        const shading = this.shading;
        if (!shading) return false;
        const level = this.appliedLevel();
        if (level === shading.level) return false;
        const was = shading.level > 0;
        shading.setLevel(level);
        if (was !== level > 0) {
            this.occSignature = "";
            this.readPieces();
        }
        this.scene.markDirty();
        return true;
    }

    /** The shading's parts: the cast texture and its bake, the marks, and the stamps under the people. */
    private buildShading(generation: number): Shading {
        const stamps = this.buildStamps(generation);
        const masks = this.masks;
        return new Shading({
            renderer: this.renderer,
            manifest: this.manifest,
            level: this.appliedLevel(),
            isWall: (x, y) => (maskByteAt(masks, x, y) & 16) !== 0,
            readPixels: (source) =>
                source instanceof HTMLImageElement || source instanceof HTMLCanvasElement
                    ? source.width > 0 && source.height > 0
                        ? readPixels(source)
                        : undefined
                    : undefined,
            stamps,
        });
    }

    /** The people's stamp atlas as a texture, and the pool of sprites that draw it: none where the scene has no sprites. */
    private buildStamps(generation: number): PeopleStamps | undefined {
        const add = this.scene.add;
        if (!add.sprite) return undefined;
        const canvas = makeCanvas(STAMP_ATLAS_WIDTH, STAMP_ATLAS_HEIGHT);
        const ctx = context2d(canvas);
        const image = ctx.createImageData(STAMP_ATLAS_WIDTH, STAMP_ATLAS_HEIGHT);
        image.data.set(personShadowFrames());
        ctx.putImageData(image, 0, 0);
        const key = `kfx-${generation}-stamps`;
        const texture = this.addCanvasTexture("stamps", key, canvas);
        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        for (const { name, x, y } of stampFrameRects(STAMP_DIRECTIONS, STAMP_CLASSES)) {
            texture.add(name, 0, x, y, STAMP_SIZE, STAMP_SIZE);
        }
        const stamps = new PeopleStamps(spriteFactory({ sprite: add.sprite.bind(add) }), key);
        return stamps;
    }

    private readonly isKnownWalker = (id: WalkerId): boolean =>
        id === "me" || (typeof id === "number" && this.scene.MapPlayersByKey.has(id));

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
        this.occTexture?.refresh();
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
        const out = me !== undefined && (maskByteAt(this.masks, me.x, me.y + 15) & 1) !== 0;
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
        if (this.stillness.reducedMotion || this.stillness.animationsOff || !this.features.iris) return;
        this.revealState = { at: this.now, running: true };
        this.animate(1100);
    }

    // ------------------------------------------------------------------------------------------------ per frame

    /** Before each draw: the camera pass's state, the mirror's pictures and what shows. Allocates nothing. */
    private frame(): void {
        this.postFilter.place();
        const now = this.now;
        const view = this.view();
        this.gather();
        const crowd = this.crowd;
        const crowdCount = this.crowdCount;
        const motion = this.motion();
        this.motionNow = motion;
        const features = this.features;
        if (motion && features.trail) {
            for (let i = 0; i < crowdCount; i++) {
                const p = crowd[i];
                this.readMasks(p);
                this.trail.step(p.id, p.x, p.y, now, p.onLawn);
            }
        }
        const v = this.vignette;
        v.value = v.from + (v.to - v.from) * progress(now, v.at, this.stillness.reducedMotion ? 0 : 500);
        const look = this.look;
        // Counted, not `length = 0`: that frees the array's storage, and the next push allocates it again.
        const locks = this.lockList;
        let lockN = 0;
        let lockMask = 0;
        const me = crowdCount > 0 && crowd[0].me ? crowd[0] : undefined;
        const rooms = this.manifest.rooms;
        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            const layer = this.layers.get(room.layer);
            if (!layer?.visible) continue;
            if (me && inside(me.x, me.y, room.floor)) continue; // inside, you see your own room clearly
            if (coverage(room.rect, view) > 0) {
                locks[lockN++] = room.rect;
                lockMask |= 1 << i;
            }
        }
        const mirrored = this.mirroredList;
        let mirroredN = 0;
        if (features.reflections) {
            for (let i = 0; i < crowdCount && mirroredN < MAX_MIRRORED; i++) {
                const p = crowd[i];
                this.readMasks(p);
                if (p.polished && nearView(p.x, p.y, view)) mirrored[mirroredN++] = p;
            }
        }
        this.placePeopleUniform(view);
        this.drawMirror(features.reflections ? this.collectMirrorPictures(view) : 0);
        let reveal = -1;
        if (this.revealState.running) {
            const t = progress(now, this.revealState.at, 1000);
            reveal = t * Math.hypot(view[2], view[3]);
            if (t >= 1) this.revealState.running = false;
        }
        const outside = this.outsideShare(view) > 0;
        const clouds = outside && features.clouds ? look.clouds : 0;
        // a lamp gives light by the hour; a screen, a TV or a sign by its own (but not against daylight). What reaches
        // the view is kept for the camera's cell: a footstep does not filter, score and sort the lights again.
        const night = look.lamps >= 0.9;
        if (night !== this.nightOn) {
            this.nightOn = night;
            this.lightsRev += 1;
        }
        const lit = look.lamps > 0 ? this.litCache.get(view, this.lightsRev) : NO_LIGHTS;
        let glowCount = 0;
        if (look.lamps > 0) {
            const candidates = this.glowCache.get(view, this.lightsRev);
            for (let i = 0; i < candidates.length && glowCount < MAX_GLOW; i++) {
                if (touchesView(candidates[i].rect, view)) this.glowList[glowCount++] = candidates[i];
            }
        }
        // who is in a locked room stays private with the frost switched off too: only the frost is an effect
        const lockCount = features.frost ? lockN : 0;
        const state = this.state;
        state.ready = true;
        state.look = look;
        state.lockCount = lockCount;
        state.mirroredCount = mirroredN;
        state.reveal = reveal;
        state.clouds = clouds;
        state.me = me;
        state.lit = lit;
        state.glowCount = glowCount;
        this.dressPeople(view, look.lamps, lit);
        this.post.active =
            this.shadingOn() ||
            !this.plainDay ||
            lockCount > 0 ||
            mirroredN > 0 ||
            (outside && (clouds > 0 || look.sat !== 1)) ||
            v.value > 0.001 ||
            reveal >= 0 ||
            (motion && features.trail && this.trail.steps.length > 0);
        this.hideLabels(locks, lockN, lockMask);
        this.glass.setVisible((features.glass && look.sheen > 0) || (features.reflections && this.mirrorStatic));
    }

    /** The shading's frame: some of the bake, the marks on the drawn people and the stamps under them. Allocates nothing. */
    private dressPeople(view: Rect, lamps: number, lit: readonly Light[]): void {
        const shading = this.shading;
        if (!shading) return;
        const frame = this.peopleFrame;
        frame.count = this.crowdCount;
        frame.rebuilt = this.drawn.rebuilds !== this.lastRebuilds;
        this.lastRebuilds = this.drawn.rebuilds;
        frame.pools = lit;
        frame.lamps = lamps;
        frame.centre[0] = view[0] + view[2] / 2;
        frame.centre[1] = view[1] + view[3] / 2;
        shading.frame(this.now, frame);
    }

    /**
     * Who is inside a locked room stays private from outside: their name tags hide too. A tag's place is read from the
     * page (a layout read for each tag), so it is read when something that moves a tag changed, not on each frame: at
     * once when a locked room comes into view or leaves it or when tags are added or dropped, and at most every
     * `LABEL_MEASURE_MS` for a camera or a crowd that moved (a tag that walks into a locked room shows for up to that
     * long, six frames at 60 Hz). While nothing moves, a frame reads nothing.
     */
    private hideLabels(locks: readonly Rect[], lockN: number, lockMask: number): void {
        if (lockN === 0 && this.hiddenCount === 0) {
            this.labelLocks = -1; // the next locked room in view is measured at once
            return; // nothing to hide, nothing to give back
        }
        const tags = this.nameTags;
        // with no locked room in view or no tag, what was measured is gone: the next tags in a room are measured at once
        if (lockN === 0 || tags.length === 0) this.labelLocks = -1;
        else if (!this.labelsDue(lockMask, tags.length)) return;
        const shown = this.shownTags;
        let shownCount = 0;
        if (lockN > 0 && tags.length > 0) {
            const canvas = this.scene.game.canvas.getBoundingClientRect();
            const cam = this.scene.cameras.main;
            const v = cam.worldView;
            const scale = canvas.width / cam.width;
            for (let t = 0; t < tags.length; t++) {
                const label = tags[t] as HTMLElement;
                const r = label.getBoundingClientRect();
                const x = v.x + (r.left + r.width / 2 - canvas.left) / scale / cam.zoom;
                const y = v.y + (r.bottom + 12 - canvas.top) / scale / cam.zoom;
                for (let i = 0; i < lockN; i++) {
                    if (inside(x, y, locks[i])) {
                        shown[shownCount++] = label;
                        break;
                    }
                }
            }
        }
        const hidden = this.hiddenTags;
        for (let i = 0; i < this.hiddenCount; i++) {
            const label = hidden[i];
            if (label && !shown.includes(label)) label.style.visibility = "";
            hidden[i] = undefined; // the array is the next frame's to fill: it keeps no tag the page has dropped
        }
        for (let i = 0; i < shownCount; i++) {
            const label = shown[i];
            if (label) label.style.visibility = "hidden";
        }
        this.shownTags = hidden;
        this.hiddenTags = shown;
        this.hiddenCount = shownCount;
    }

    /** Whether the name tags are to be measured now (see `hideLabels`); when they are, notes what they are measured for. */
    private labelsDue(lockMask: number, tagCount: number): boolean {
        const view = this.viewRect;
        const known = this.labelView;
        const forced = lockMask !== this.labelLocks || tagCount !== this.labelTags;
        if (!forced) {
            const moved =
                this.crowdHash !== this.labelCrowd ||
                view[0] !== known[0] ||
                view[1] !== known[1] ||
                view[2] !== known[2] ||
                view[3] !== known[3];
            if (!moved) return false;
            const since = this.now - this.labelsAt;
            if (since >= 0 && since < LABEL_MEASURE_MS) return false;
        }
        this.labelLocks = lockMask;
        this.labelTags = tagCount;
        this.labelCrowd = this.crowdHash;
        this.labelsAt = this.now;
        known[0] = view[0];
        known[1] = view[1];
        known[2] = view[2];
        known[3] = view[3];
        return true;
    }

    /** Gives the page back what the effects changed in it: the koi pages' dimming and the hidden name tags. */
    private restorePage(): void {
        for (const frame of document.querySelectorAll<HTMLIFrameElement>(KOI_FRAMES)) frame.style.filter = "";
        for (let i = 0; i < this.hiddenCount; i++) {
            const label = this.hiddenTags[i];
            if (label) label.style.visibility = "";
            this.hiddenTags[i] = undefined;
        }
        this.hiddenCount = 0;
    }

    // ------------------------------------------------------------------------------------------------ the mirror

    /**
     * Finds the pieces standing in front of a glass face (mirrorsPiece), each with its picture in the mirror, into the
     * pooled `candidates`; how many. Walks the entities with `forEach`, which makes no entry or iterator for each of the
     * map's several hundred.
     */
    private findMirrorPieces(): number {
        this.candidateCount = 0;
        const faces = this.manifest.glassFaces;
        if (!faces?.length) return 0;
        this.scene.getGameMapFrontWrapper().getEntitiesManager().getEntities().forEach(this.scanPiece);
        return this.candidateCount;
    }

    private readonly scanPiece = (e: MapEntity): void => {
        if (!e.visible || !e.active) return;
        const faces = this.manifest.glassFaces;
        if (!faces) return;
        const w = e.displayWidth;
        const h = e.displayHeight;
        const cx = e.x - e.originX * w + w / 2;
        const foot = e.y - e.originY * h + h;
        const face = mirrorFace(cx, foot, faces);
        if (!face) return;
        const prefab = e.getPrefab();
        if (!mirrorsPiece(prefab)) return;
        const d = foot - face[2];
        const alpha = mirrorAlpha(d);
        if (alpha <= 0) return;
        const slot = this.candidates[this.candidateCount] ?? (this.candidates[this.candidateCount] = newPiece());
        this.candidateCount += 1;
        const picture = slot.picture;
        slot.face = face;
        picture.key = e.texture.key;
        picture.frame = e.frame.name;
        picture.x = cx;
        picture.y = mirrorFoot(foot, face[2]);
        picture.originX = 0.5;
        picture.originY = 1;
        picture.flip = e.flipX;
        picture.alpha = alpha;
        picture.scaleX = e.scaleX;
        picture.scaleY = e.scaleY;
        picture.face = face;
        picture.back = prefab.tags.includes("Peças da marca"); // the editor's tag for brand pieces
        picture.distance = d;
    };

    /** The first `count` candidates, copied: what the atlas is painted with, and later compared to. */
    private snapshotCandidates(count: number): MirrorPiece[] {
        const pieces: MirrorPiece[] = [];
        for (let i = 0; i < count; i++) {
            const { face, picture } = this.candidates[i];
            pieces.push({ face, picture: { ...picture } });
        }
        return pieces;
    }

    /** Whether the first `count` candidates are the pieces the mirror was last painted with, picture for picture. */
    private candidatesAreMirrored(count: number): boolean {
        const painted = this.mirrorPieces;
        if (painted.length !== count) return false;
        for (let i = 0; i < count; i++) {
            const a = painted[i].picture;
            const b = this.candidates[i].picture;
            if (
                a.key !== b.key ||
                a.frame !== b.frame ||
                a.x !== b.x ||
                a.y !== b.y ||
                a.flip !== b.flip ||
                a.alpha !== b.alpha ||
                a.scaleX !== b.scaleX ||
                a.scaleY !== b.scaleY ||
                a.face !== b.face ||
                a.back !== b.back ||
                a.distance !== b.distance
            )
                return false;
        }
        return true;
    }

    /**
     * The mirror's pictures this frame: everyone drawn standing in front of a glass face in view, upright, moving up
     * the glass with distance (mirrorFoot), turned to their other side (a Woka's layers by mirrorFrame). The pieces are
     * the atlas's. Written into the pooled `pictures`; the count of them.
     */
    private collectMirrorPictures(view: Rect): number {
        const faces = this.manifest.glassFaces;
        const near = this.viewFaces;
        let nearN = 0;
        if (faces) {
            for (let i = 0; i < faces.length; i++) {
                const face = faces[i];
                if (
                    face[1] > view[0] &&
                    face[0] < view[0] + view[2] &&
                    face[2] + MIRROR_REACH > view[1] &&
                    face[2] - 64 < view[1] + view[3]
                )
                    near[nearN++] = face;
            }
        }
        this.pictureCount = 0;
        if (nearN === 0) return 0;
        this.addPictures(this.currentPlayer(), near, nearN);
        const bodies = this.drawn.bodies(this.now);
        for (let i = 0; i < bodies.length; i++) this.addPictures(bodies[i], near, nearN);
        return this.pictureCount;
    }

    private addPictures(
        ch: Pick<Player, "x" | "y" | "visible" | "list"> | undefined,
        faces: readonly GlassFace[],
        faceCount: number,
    ): void {
        if (!ch?.visible) return;
        const foot = ch.y + 16;
        const face = mirrorFace(ch.x, foot, faces, undefined, faceCount);
        if (!face) return;
        const d = foot - face[2];
        const alpha = mirrorAlpha(d);
        if (alpha <= 0) return;
        const mirrorFeet = mirrorFoot(foot, face[2]);
        const layers = ch.list;
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            if (!(layer instanceof Phaser.GameObjects.Sprite) || !layer.visible) continue;
            const name = layer.frame.name;
            const below = (1 - layer.originY) * layer.displayHeight; // from the picture's origin to its feet
            const picture = this.pictures[this.pictureCount] ?? (this.pictures[this.pictureCount] = newPicture());
            picture.key = layer.texture.key;
            picture.frame = mirroredFrameName(name);
            picture.x = ch.x + layer.x;
            picture.y = mirrorFeet - below + layer.y;
            picture.originX = layer.originX;
            picture.originY = layer.originY;
            picture.flip = mirrorFlips(name) !== layer.flipX;
            picture.alpha = alpha;
            picture.scaleX = layer.scaleX || 1;
            picture.scaleY = layer.scaleY || 1;
            picture.face = face;
            picture.back = false;
            picture.distance = d;
            this.pictureCount += 1;
        }
    }

    /**
     * Puts a picture on the glass into `out`: where its image lands, whole. False when its image is not there.
     */
    private place(pic: MirrorPicture, out: PlacedMirrorPicture, onlyLive: boolean): boolean {
        const back = pic.back ? this.pieceBacks.get(pic) : undefined;
        const key = back ?? pic.key;
        const frame = back ? undefined : pic.frame;
        const size = this.scene.textures.getFrame(key, frame);
        if (!size || size.width <= 0 || size.height <= 0) return false;
        const scaleX = back ? 1 : pic.scaleX;
        const scaleY = back ? 1 : pic.scaleY;
        const w = size.width * scaleX;
        const h = size.height * scaleY;
        out.flip = !back && pic.flip;
        out.key = key;
        out.frame = frame;
        out.left = Math.round(pic.x - pic.originX * w);
        out.top = Math.round(pic.y - pic.originY * h);
        out.w = w;
        out.h = h;
        out.alpha = pic.alpha;
        out.scaleX = scaleX;
        out.scaleY = scaleY;
        out.face = pic.face;
        out.distance = pic.distance;
        out.onlyLive = onlyLive;
        return true;
    }

    private placedAt(index: number): PlacedMirrorPicture {
        return (
            this.placed[index] ??
            (this.placed[index] = {
                flip: false,
                key: "",
                frame: undefined,
                left: 0,
                top: 0,
                w: 0,
                h: 0,
                alpha: 0,
                scaleX: 1,
                scaleY: 1,
                face: NO_FACE,
                distance: 0,
                onlyLive: false,
            })
        );
    }

    private isLive(pane: GlassPane): boolean {
        for (let i = 0; i < this.liveCount; i++) if (this.livePanes[i] === pane) return true;
        return false;
    }

    private crossesLive(p: PlacedMirrorPicture, panes: readonly GlassPane[]): boolean {
        for (let i = 0; i < panes.length; i++) if (this.isLive(panes[i]) && crosses(p, panes[i])) return true;
        return false;
    }

    /**
     * The pictures on the mirror's pooled images, one per pane each crosses, cropped to it; the container hides when
     * there is nothing to show (no draw). Whatever is nearer the glass covers in the mirror what stands behind it
     * (21/10/2026: a cat behind its owner showed in front of them), so every picture goes by its distance from the
     * glass, the farthest first. The panes a person crosses are drawn here whole: the atlas leaves them (uMirrorLive,
     * up to 8; past that a pane keeps its atlas) and the pieces crossing them join the people, in that same order.
     * `count` pictures of people are in `pictures`; the pieces are the atlas's.
     */
    private drawMirror(count: number): void {
        const placed = this.placed;
        let shown = 0;
        for (let i = 0; i < count; i++) {
            if (this.place(this.pictures[i], this.placedAt(shown), false)) shown += 1;
        }
        this.liveCount = 0;
        for (let i = 0; i < shown; i++) {
            const p = placed[i];
            const panes = this.mirrorPanes.get(p.face) ?? NO_PANES;
            for (let k = 0; k < panes.length; k++) {
                const pane = panes[k];
                if (this.liveCount < MAX_LIVE_PANES && crosses(p, pane) && !this.isLive(pane)) {
                    this.livePanes[this.liveCount] = pane;
                    this.liveCount += 1;
                }
            }
        }
        if (this.liveCount > 0) {
            for (let i = 0; i < this.mirrorPieces.length; i++) {
                const { face, picture } = this.mirrorPieces[i];
                const panes = this.mirrorPanes.get(face) ?? NO_PANES;
                if (!this.anyLive(panes)) continue;
                if (this.place(picture, this.placedAt(shown), true) && this.crossesLive(placed[shown], panes))
                    shown += 1;
            }
        }
        // the farthest from the glass first; stable, so a Woka's layers keep their order
        for (let i = 1; i < shown; i++) {
            const current = placed[i];
            let j = i - 1;
            while (j >= 0 && placed[j].distance < current.distance) {
                placed[j + 1] = placed[j];
                j -= 1;
            }
            placed[j + 1] = current;
        }
        this.mirrorLive.fill(0);
        for (let i = 0; i < this.liveCount; i++) {
            const pane = this.livePanes[i];
            this.mirrorLive[i * 4] = pane[0];
            this.mirrorLive[i * 4 + 1] = pane[1];
            this.mirrorLive[i * 4 + 2] = pane[2];
            this.mirrorLive[i * 4 + 3] = pane[3];
        }
        this.mirrorLiveN = this.liveCount;
        const pool = this.mirrorPool;
        let n = 0;
        for (let i = 0; i < shown; i++) {
            const p = placed[i];
            const { key, frame, left, top, w, h, alpha, scaleX, scaleY } = p;
            const panes = this.mirrorPanes.get(p.face) ?? NO_PANES;
            for (let k = 0; k < panes.length; k++) {
                const pane = panes[k];
                if (p.onlyLive && !this.isLive(pane)) continue; // a piece outside the live panes stays the atlas's
                const x0 = Math.max(pane[0], left);
                const x1 = Math.min(pane[1], left + w);
                const y0 = Math.max(pane[2], top);
                const y1 = Math.min(pane[3], top + h);
                if (x1 <= x0 || y1 <= y0) continue;
                let img = pool[n];
                if (!img) {
                    img = this.scene.add.image(0, 0, key, frame);
                    this.mirror.add(img);
                    pool.push(img);
                } else if (
                    img.texture.key !== key ||
                    !this.holdsLiveTexture(img) ||
                    (frame !== undefined && !sameFrame(img.frame.name, frame))
                ) {
                    img.setTexture(key, frame);
                }
                img.setOrigin(0, 0)
                    .setPosition(p.flip ? left + w : left, top)
                    .setScale(p.flip ? -scaleX : scaleX, scaleY)
                    .setAlpha(alpha)
                    .setTint(MIRROR_TINT)
                    .setCrop(
                        (p.flip ? left + w - x1 : x0 - left) / scaleX,
                        (y0 - top) / scaleY,
                        (x1 - x0) / scaleX,
                        (y1 - y0) / scaleY,
                    )
                    .setVisible(true);
                n += 1;
            }
        }
        for (let i = n; i < pool.length; i++) pool[i].setVisible(false);
        if (this.mirror.visible !== n > 0) this.mirror.setVisible(n > 0);
        this.mirrorShown = n;
    }

    /**
     * Whether a pooled image holds the Texture the texture manager has under its key now. A key can come back as
     * another Texture: a baked avatar's sheet is destroyed when its recipe is evicted and baked again as a new object
     * under the same key (AvatarBakeRegistry), so the key string says nothing about the Texture, and an image that kept
     * the old one would draw a destroyed texture. A destroyed Texture is never the one the manager holds, so this covers it.
     */
    private holdsLiveTexture(image: Phaser.GameObjects.Image): boolean {
        return this.scene.textures.get(image.texture.key) === image.texture;
    }

    /** Parks an image on a texture of the effects' own and hides it, so that it holds no texture that is going. */
    private parkMirrorImage(image: Phaser.GameObjects.Image): void {
        image.setVisible(false).setTexture(this.key("tv-slide"));
    }

    /**
     * A texture left the scene's manager (Textures REMOVE, after its destruction): a pooled image that still holds it
     * is parked now. The next `drawMirror` would re-point it, but a removal can land between two of them, and a pooled
     * image that is shown must never hold a destroyed Texture at a draw.
     */
    private readonly onTextureRemoved = (key: string): void => {
        const pool = this.mirrorPool;
        for (let i = 0; i < pool.length; i++) {
            const image = pool[i];
            if (image.texture.key === key && !this.holdsLiveTexture(image)) this.parkMirrorImage(image);
        }
    };

    private anyLive(panes: readonly GlassPane[]): boolean {
        for (let i = 0; i < panes.length; i++) if (this.isLive(panes[i])) return true;
        return false;
    }

    /** The camera pass's uniforms, all of them, with the arrays `postUniforms` rewrites on each draw. */
    private postUniformRecord(): Record<string, UniformValue> {
        return {
            uWorld: this.viewRect,
            uMap: this.mapSize,
            uRes: this.resolution,
            uInside: this.look.inside,
            uOutside: this.look.outside,
            uLawn: this.look.lawn,
            uWall: this.look.wall,
            uVivid: this.look.vivid,
            uFacade: this.look.facade,
            uWarm: this.look.warm,
            uToe: this.look.toe,
            uDarks: this.look.darks,
            uSat: this.look.sat,
            uNight: this.look.lamps,
            "uL[0]": this.lightData,
            "uLC[0]": this.lightColorData,
            "uLClip[0]": this.lightClipData,
            uLN: 0,
            "uEm[0]": this.emissiveData,
            "uEmT[0]": EMISSIVE_TINT_TABLE,
            uEmN: 0,
            uShafts: this.shafts,
            uCloud: this.cloud,
            "uLock[0]": this.lockData,
            uLockN: 0,
            uFrost: FROST,
            "uSteps[0]": this.stepData,
            uStepN: 0,
            uLime: TRAIL_COLOURS.lime,
            uCream: TRAIL_COLOURS.cream,
            "uAv[0]": this.avatarData,
            uAvN: 0,
            "uPeople[0]": this.peopleData,
            uPeopleN: 0,
            uNormalsOn: this.normalsOn,
            uRimOn: this.rimOn,
            uVignette: this.vignetteUniform,
            uReveal: this.revealUniform,
            uInk: this.inkUniform,
            // the shading's three, only in a room that has it: the record of a room without keeps its old keys
            ...(this.shading
                ? {
                      uShade: this.shading.uniforms.shade,
                      uKey: this.shading.uniforms.key,
                      uKeyShade: this.shading.uniforms.keyShade,
                      "uCrowd[0]": this.shading.crowd,
                  }
                : {}),
        };
    }

    /**
     * What the camera pass is given on a draw. One record and its arrays are rewritten in place (the pass applies them
     * before the next draw), so a draw allocates nothing here.
     */
    private postUniforms(): Record<string, UniformValue> {
        const state = this.state;
        if (!state.ready) return NO_UNIFORMS;
        const { view, look, reveal, clouds, me, lit } = state;
        const u = this.postRecord;
        // the tint index rides in the width's fraction (whole pixels)
        const em = this.emissiveData;
        em.fill(0);
        for (let i = 0; i < state.glowCount; i++) {
            const g = this.glowList[i];
            em[i * 4] = g.rect[0];
            em[i * 4 + 1] = g.rect[1];
            em[i * 4 + 2] = g.rect[2] + g.tint / 8;
            em[i * 4 + 3] = g.rect[3];
        }
        lightUniformsInto(lit, look, this.lightData, this.lightColorData, this.lightClipData);
        const lock = this.lockData;
        lock.fill(0);
        const lockCount = Math.min(state.lockCount, MAX_LOCKS);
        for (let i = 0; i < lockCount; i++) {
            const r = this.lockList[i]; // up to the wall's stroke
            lock[i * 4] = r[0];
            lock[i * 4 + 1] = r[1];
            lock[i * 4 + 2] = r[2] + 2;
            lock[i * 4 + 3] = r[3];
        }
        const trailOn = this.motionNow && this.features.trail;
        const stepN = trailOn ? this.trail.uniformsInto(this.stepData, this.now) : 0;
        if (!trailOn) this.stepData.fill(0);
        const av = this.avatarData;
        av.fill(0);
        for (let i = 0; i < state.mirroredCount; i++) {
            const p = this.mirroredList[i];
            av[i * 4] = Math.round(p.x);
            av[i * 4 + 1] = Math.round(p.y);
            av[i * 4 + 2] = 10;
            av[i * 4 + 3] = 26;
        }
        const cam = this.scene.cameras.main;
        this.resolution[0] = cam.width;
        this.resolution[1] = cam.height;
        this.clouds.offsetInto(this.cloudOffset);
        this.shafts[0] = look.shafts;
        this.cloud[0] = clouds;
        this.cloud[2] = this.cloudOffset[0];
        this.cloud[3] = this.cloudOffset[1];
        this.vignetteUniform[0] = this.vignette.value;
        this.revealUniform[0] = me ? Math.round(me.x) : view[0] + view[2] / 2;
        this.revealUniform[1] = me ? Math.round(me.y) - 12 : view[1] + view[3] / 2;
        this.revealUniform[2] = reveal;
        u.uInside = look.inside;
        u.uOutside = look.outside;
        u.uLawn = look.lawn;
        u.uWall = look.wall;
        u.uVivid = look.vivid;
        u.uFacade = look.facade;
        u.uWarm = look.warm;
        u.uToe = look.toe;
        u.uDarks = look.darks;
        u.uSat = look.sat;
        u.uNight = look.lamps;
        u.uLN = lit.length;
        u.uEmN = state.glowCount;
        u.uLockN = lockCount;
        u.uStepN = stepN;
        u.uAvN = state.mirroredCount;
        u.uPeopleN = this.peopleCount;
        u.uRimOn = this.rimOn;
        if (this.shading) this.shading.uniformsInto(u);
        return u;
    }
}

const FROST = [0.59, 0.8, 0.76];

function nearView(x: number, y: number, view: Rect): boolean {
    return x >= view[0] - 16 && y >= view[1] - 16 && x < view[0] + view[2] + 16 && y < view[1] + view[3] + 16;
}

function newPiece(): MirrorPieceSlot {
    return { face: NO_FACE, picture: newPicture() };
}

function newPicture(): MirrorPicture {
    return {
        key: "",
        frame: undefined,
        x: 0,
        y: 0,
        originX: 0,
        originY: 0,
        flip: false,
        alpha: 0,
        scaleX: 1,
        scaleY: 1,
        face: NO_FACE,
        back: false,
        distance: 0,
    };
}

/** Whether two frame names are the same frame; a number and its string are (the string is made only then). */
function sameFrame(a: FrameName | undefined, b: FrameName): boolean {
    return a === b || String(a) === String(b);
}

function crosses(p: PlacedMirrorPicture, pane: GlassPane): boolean {
    return (
        Math.min(pane[1], p.left + p.w) > Math.max(pane[0], p.left) &&
        Math.min(pane[3], p.top + p.h) > Math.max(pane[2], p.top)
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
