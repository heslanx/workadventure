import * as Phaser from "phaser";
import * as Sentry from "@sentry/svelte";
import { getPlayerAnimations } from "../Player/Animation";
import type { BakeBackend, BakeLease, BakeOutcome, BakeRegistryStats } from "./AvatarBakeRegistry";
import { AvatarBakeRegistry, canonicalRecipeKey } from "./AvatarBakeRegistry";

/**
 * Bakes the layers of a modular avatar (body, eyes, hair, outfit...) into one 96x128 spritesheet of 12 frames of 32x32,
 * so that the avatar is one sprite instead of one per layer. The bookkeeping (key, leases, LRU, cap) is in
 * AvatarBakeRegistry; this file is the Phaser side: the flag, the texture, and one registry per TextureManager.
 *
 * Off by default. `localStorage["avatarBake"] = "1"` before the page loads turns it on. Whatever goes wrong (flag off,
 * a layer that is not loaded or not 96x128, a failed bake, no room), the avatar keeps its layers as it always did.
 */

/** Off by default: it ships behind a flag until a browser run measures it. */
export const AVATAR_BAKE_ENABLED = false;
export const AVATAR_BAKE_STORAGE_KEY = "avatarBake";

export const AVATAR_FRAME_WIDTH = 32;
export const AVATAR_FRAME_HEIGHT = 32;
export const AVATAR_SHEET_WIDTH = AVATAR_FRAME_WIDTH * 3;
export const AVATAR_SHEET_HEIGHT = AVATAR_FRAME_HEIGHT * 4;
/** 12 frames of the walk cycle and the `__BASE` frame Phaser adds to every texture. */
const LAYER_FRAME_TOTAL = 13;

/** Whether the bake is on: the constant, unless this browser's storage says otherwise. */
export function isAvatarBakeEnabled(storage: Pick<Storage, "getItem"> | undefined = globalStorage()): boolean {
    try {
        const value = storage?.getItem(AVATAR_BAKE_STORAGE_KEY);
        if (value === "1") return true;
        if (value === "0") return false;
    } catch (error) {
        console.warn("The storage is blocked, so the avatar bake flag keeps its default", error);
    }
    return AVATAR_BAKE_ENABLED;
}

function globalStorage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

/** What the bake needs of a scene. A GameScene fits. */
export interface AvatarBakeScene {
    readonly textures: Pick<Phaser.Textures.TextureManager, "exists" | "get" | "remove" | "addSpriteSheet">;
    readonly game?: { readonly renderer?: unknown };
    readonly anims?: Pick<Phaser.Animations.AnimationManager, "remove">;
    readonly events?: Pick<Phaser.Events.EventEmitter, "on" | "off">;
}

/**
 * Creates and destroys the Phaser textures of the registry. The registry outlives the scene that made it (one per game,
 * see `caches`), so it holds what belongs to the game (the texture manager, the animations, the game) and not the scene,
 * which can be destroyed and its fields cleared while the game runs on with the scene of the next room.
 */
class PhaserBakeBackend implements BakeBackend {
    private readonly textures: AvatarBakeScene["textures"];
    private readonly anims: AvatarBakeScene["anims"];
    private readonly game: AvatarBakeScene["game"];

    constructor(scene: AvatarBakeScene) {
        this.textures = scene.textures;
        this.anims = scene.anims;
        this.game = scene.game;
    }

    public bake(key: string, layers: readonly string[], makeRoom: () => void): BakeOutcome {
        const { textures } = this;
        if (this.game?.renderer === undefined) {
            return "noRenderer";
        }
        if (textures.exists(key)) {
            return "taken";
        }
        const sources: CanvasImageSource[] = [];
        for (const layer of layers) {
            if (!textures.exists(layer)) {
                return "ineligible";
            }
            const texture = textures.get(layer);
            const image = texture.getSourceImage() as
                | { width?: number; height?: number; complete?: boolean }
                | null
                | undefined;
            if (
                texture.frameTotal !== LAYER_FRAME_TOTAL ||
                !image ||
                image.complete === false ||
                image.width !== AVATAR_SHEET_WIDTH ||
                image.height !== AVATAR_SHEET_HEIGHT
            ) {
                return "ineligible";
            }
            sources.push(image as CanvasImageSource);
        }

        // Drawn before the texture exists, so the texture is uploaded once, already complete.
        const canvas = Phaser.Display.Canvas.CanvasPool.create2D(this, AVATAR_SHEET_WIDTH, AVATAR_SHEET_HEIGHT);
        let registered = false;
        try {
            const context = canvas.getContext("2d");
            if (context === null) {
                throw new Error("No 2D context for the baked avatar");
            }
            context.imageSmoothingEnabled = false;
            for (const source of sources) {
                context.drawImage(source, 0, 0);
            }
            // Everything that could fail is done: only now does a full cache give up an idle texture.
            makeRoom();
            registered = true;
            // Phaser takes a canvas as a source although its typings only list images.
            const texture = textures.addSpriteSheet(key, canvas as unknown as HTMLImageElement, {
                frameWidth: AVATAR_FRAME_WIDTH,
                frameHeight: AVATAR_FRAME_HEIGHT,
            });
            if (!texture) {
                // The key was taken after all: the canvas was not given to a texture.
                registered = false;
                Phaser.Display.Canvas.CanvasPool.remove(canvas);
                return "taken";
            }
        } catch (error) {
            // addSpriteSheet registers the key before it cuts the frames: a throw in between leaves a texture that no
            // entry owns, and every later bake of the recipe would find its key taken.
            if (registered && textures.exists(key)) {
                textures.remove(key);
            }
            Phaser.Display.Canvas.CanvasPool.remove(canvas);
            throw error;
        }
        return "baked";
    }

    public dispose(key: string): void {
        try {
            // The animations hold frames of the texture: they go first, and are created again if the recipe is baked again.
            for (const animation of getPlayerAnimations(key)) {
                this.anims?.remove(animation.key);
            }
        } finally {
            // Whatever the animations did, the texture goes: the registry has forgotten the key, so a texture that
            // stayed would block the recipe for good.
            this.textures.remove(key);
        }
    }
}

/** A bake that went wrong is logged and, when it is an error, sent to Sentry. The registry calls it once per recipe. */
function reportBakeProblem(message: string, detail?: unknown): void {
    console.warn(message, detail);
    if (detail instanceof Error) {
        Sentry.captureException(detail, { extra: { message } });
    }
}

interface BakeCache {
    /** Undefined when the flag was off when the cache was made. */
    readonly registry: AvatarBakeRegistry | undefined;
    /** The scenes that use the cache and have not shut down. */
    readonly scenesWatched: Set<AvatarBakeScene>;
}

// A texture manager belongs to the game, and so do its textures and animations: one cache per game, whatever the scene.
const caches = new WeakMap<object, BakeCache>();

function cacheFor(scene: AvatarBakeScene): BakeCache {
    let cache = caches.get(scene.textures);
    if (cache === undefined) {
        // The flag is read here, once per game, which is why a browser turns it on before the page loads.
        cache = {
            registry: isAvatarBakeEnabled()
                ? new AvatarBakeRegistry(new PhaserBakeBackend(scene), { warn: reportBakeProblem })
                : undefined,
            scenesWatched: new Set(),
        };
        caches.set(scene.textures, cache);
    }
    return cache;
}

/**
 * A lease on the baked sheet of these layers (ordered bottom to top), whose `key` is a texture of 12 frames with the
 * names and animations of a layer. Undefined when the avatar stays on its layers, for any reason. Never throws.
 */
export function acquireAvatarBake(scene: AvatarBakeScene, layers: readonly string[]): BakeLease | undefined {
    try {
        const cache = cacheFor(scene);
        if (cache.registry === undefined) {
            return undefined;
        }
        watchShutdown(scene, cache);
        return cache.registry.acquire(layers);
    } catch (error) {
        console.warn("Could not use the avatar bake, the avatar stays on its layers", error);
        return undefined;
    }
}

// A scene that shuts down destroys its avatars, which let go of their leases. Whatever stays baked is destroyed with the
// last scene that uses the cache: the textures belong to the game, and the scene of the next room can start before the
// scene of the last one has shut down, with avatars that hold leases already.
function watchShutdown(scene: AvatarBakeScene, cache: BakeCache): void {
    if (cache.scenesWatched.has(scene) || scene.events === undefined) {
        return;
    }
    cache.scenesWatched.add(scene);
    const events = scene.events;
    const onGone = (): void => {
        events.off(Phaser.Scenes.Events.SHUTDOWN, onGone);
        events.off(Phaser.Scenes.Events.DESTROY, onGone);
        cache.scenesWatched.delete(scene);
        if (cache.scenesWatched.size === 0) {
            cache.registry?.disposeAll();
        }
    };
    events.on(Phaser.Scenes.Events.SHUTDOWN, onGone);
    events.on(Phaser.Scenes.Events.DESTROY, onGone);
}

/** The key of the baked sheet of an ordered list of layers. */
export function bakedAvatarKey(layers: readonly string[]): string {
    return canonicalRecipeKey(layers);
}

export type AvatarBakeStats = BakeRegistryStats;

const NO_BAKE_STATS: AvatarBakeStats = {
    cached: 0,
    active: 0,
    idle: 0,
    bytesDerived: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    declines: { singleLayer: 0, ineligible: 0, cap: 0, error: 0, taken: 0, noRenderer: 0, failed: 0 },
    bakeMsTotal: 0,
    bakeMsMax: 0,
    failedRecipes: 0,
};

/** What the cache of this TextureManager holds, for the telemetry of a run: `cached` baked sheets, `active` of them leased. */
export function getAvatarBakeStats(textures: object | undefined): AvatarBakeStats {
    return (textures && caches.get(textures)?.registry?.stats()) || NO_BAKE_STATS;
}
