import { AvailabilityStatus, PositionMessage_Direction } from "@workadventure/messages";
import type { UserMovedMessage } from "@workadventure/messages";
import { z } from "zod";
import type { MessageUserJoined } from "../Connection/ConnexionModels";
import type { WokaTextureDescriptionInterface } from "../Phaser/Entity/PlayerTextures";

/**
 * The synthetic crowd of window.e2eHooks.spawnSyntheticCrowd(): remote players that join and move through the repository
 * a real join and a real move go through (RemotePlayersRepository), so that the scene's culling, detail budget, build
 * queue and avatar bake all run on them. Every choice here is a pure function of the bot's index, never of a clock or
 * of Math.random, so two runs place and walk the same crowd.
 *
 * What it is not: the bots do not collide with the map (a remote player never does: its positions come from the
 * server), so some stand where a real player could not. It is a load, not a picture of an office.
 */

export const CROWD_GROUPS = ["glass", "lights", "borders", "spread"] as const;
export type CrowdGroup = (typeof CROWD_GROUPS)[number];

/** Pixels a bot walks per move: 5 moves a second (POSITION_DELAY) at 180 px/s, the ring of benchmark/src/scenario.ts. */
export const BOT_STEP_PX = 36;
/** The first bot's user id. Real ids count up from 1: this base keeps the two apart and stays an int32. */
export const SYNTHETIC_USER_ID_BASE = 1_900_000_000;

type Quad = readonly [x0: number, y0: number, x1: number, y1: number];
type Pair = readonly [x: number, y: number];

/** Where the groups are placed, in map pixels. A group with no anchor falls back to spread over the map. */
export interface CrowdMap {
    width: number;
    height: number;
    /** Glass faces: [x0, x1, foot], the foot line being where people stand against the pane. */
    glassFaces: readonly (readonly [number, number, number])[];
    /** Light centres. */
    lights: readonly Pair[];
    /** Wall segments of the rooms: the zone borders a bot walks across. */
    borders: readonly Quad[];
}

// The part of an effects manifest (fx/manifest.json, domain/effectsManifest.ts of Konclui/Ambience) the crowd reads.
// Re-declared here because an upstream file must not import Konclui; unknown keys are dropped, so it stays lenient.
// Every `rect` of the manifest is [x, y, w, h] (SceneEffects.ts reads `const [x, y, w, h] = rect`), not a corner pair.
const pair = z.tuple([z.number(), z.number()]);
const quad = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const manifestPlacement = z.object({
    glassFaces: z.array(z.tuple([z.number(), z.number(), z.number()])).optional(),
    staticLights: z.array(z.union([z.object({ rect: quad }), z.object({ at: pair })])).optional(),
    rooms: z.array(z.object({ rect: quad })).optional(),
    spaces: z.array(quad).optional(),
});

/** The crowd's anchors from a map's fx manifest, or from the map's size alone when there is no manifest. */
export function crowdMapFromManifest(manifest: unknown | undefined, size: { width: number; height: number }): CrowdMap {
    const placement = manifest === undefined ? {} : manifestPlacement.parse(manifest);
    const lights: Pair[] = [];
    for (const light of placement.staticLights ?? []) {
        if ("at" in light) {
            lights.push(light.at);
        } else {
            const [x, y, w, h] = light.rect;
            lights.push([x + w / 2, y + h / 2]);
        }
    }
    const borders: Quad[] = [];
    for (const { rect } of placement.rooms ?? []) {
        const [x, y, w, h] = rect;
        const [x0, y0, x1, y1] = [x, y, x + w, y + h];
        borders.push([x0, y0, x1, y0], [x0, y1, x1, y1], [x0, y0, x0, y1], [x1, y0, x1, y1]);
    }
    return {
        width: size.width,
        height: size.height,
        glassFaces: placement.glassFaces ?? [],
        lights,
        borders,
    };
}

/** A number in [0, 1) that depends only on the two integers (a 32-bit integer hash). */
export function unitHash(index: number, salt: number): number {
    let h = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 0x100000000;
}

/** A point travelling `distance` along a line of `length` and back, over and over: 0 to length and back to 0. */
function pingPong(distance: number, length: number): number {
    const cycle = distance % (2 * length);
    return cycle <= length ? cycle : 2 * length - cycle;
}

export interface BotPlan {
    index: number;
    userId: number;
    /** The group the bot was placed in. */
    group: CrowdGroup;
    /** The group it was meant for, when that has no anchor in the map and it was spread instead. */
    fellBackFrom?: CrowdGroup;
    /** Position at step `s`. */
    at(step: number): Pair;
}

function clampToMap(point: Pair, map: CrowdMap): Pair {
    return [
        Math.round(Math.min(Math.max(point[0], 8), map.width - 8)),
        Math.round(Math.min(Math.max(point[1], 8), map.height - 8)),
    ];
}

function glassPath(index: number, map: CrowdMap): ((step: number) => Pair) | undefined {
    if (map.glassFaces.length === 0) {
        return undefined;
    }
    const [x0, x1, foot] = map.glassFaces[Math.floor(unitHash(index, 1) * map.glassFaces.length)];
    const span = Math.max(1, x1 - x0 - 12);
    const phase = unitHash(index, 2) * 2 * span;
    // Just below the foot line, where a player stands against the pane
    const y = foot + 4 + Math.floor(unitHash(index, 3) * 12);
    return (step) => [x0 + 6 + pingPong(phase + step * BOT_STEP_PX, span), y];
}

function lightPath(index: number, map: CrowdMap): ((step: number) => Pair) | undefined {
    if (map.lights.length === 0) {
        return undefined;
    }
    const [cx, cy] = map.lights[Math.floor(unitHash(index, 4) * map.lights.length)];
    const radius = 24 + Math.floor(unitHash(index, 5) * 3) * 12;
    const phase = unitHash(index, 6) * 2 * Math.PI;
    return (step) => {
        const angle = phase + (step * BOT_STEP_PX) / radius;
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    };
}

const BORDER_REACH_PX = 48;

function borderPath(index: number, map: CrowdMap): ((step: number) => Pair) | undefined {
    if (map.borders.length === 0) {
        return undefined;
    }
    const [x0, y0, x1, y1] = map.borders[Math.floor(unitHash(index, 7) * map.borders.length)];
    const along = unitHash(index, 8);
    const length = Math.hypot(x1 - x0, y1 - y0) || 1;
    const normal: Pair = [-(y1 - y0) / length, (x1 - x0) / length];
    const px = x0 + (x1 - x0) * along;
    const py = y0 + (y1 - y0) * along;
    const phase = unitHash(index, 9) * 2 * BORDER_REACH_PX * 2;
    // Back and forth across the border: from one side of it to the other
    return (step) => {
        const offset = pingPong(phase + step * BOT_STEP_PX, 2 * BORDER_REACH_PX) - BORDER_REACH_PX;
        return [px + normal[0] * offset, py + normal[1] * offset];
    };
}

function spreadPath(index: number, map: CrowdMap): (step: number) => Pair {
    const cx = 64 + unitHash(index, 10) * Math.max(1, map.width - 128);
    const cy = 64 + unitHash(index, 11) * Math.max(1, map.height - 128);
    // A circle, so that every bot walks at the same speed: on an ellipse the speed changes with the curvature
    const radius = 60 + unitHash(index, 12) * 200;
    const phase = unitHash(index, 14) * 2 * Math.PI;
    return (step) => {
        const angle = phase + (step * BOT_STEP_PX) / radius;
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    };
}

/** The crowd: bot `i` goes to group `i mod 4` (glass, lights, borders, spread) and keeps to its path. */
export function planCrowd(count: number, map: CrowdMap): BotPlan[] {
    const plans: BotPlan[] = [];
    for (let index = 0; index < count; index++) {
        const wanted = CROWD_GROUPS[index % CROWD_GROUPS.length];
        const paths = {
            glass: glassPath(index, map),
            lights: lightPath(index, map),
            borders: borderPath(index, map),
            spread: spreadPath(index, map),
        };
        const path = paths[wanted];
        const group: CrowdGroup = path ? wanted : "spread";
        const walk = path ?? paths.spread;
        plans.push({
            index,
            userId: SYNTHETIC_USER_ID_BASE + index,
            group,
            ...(path ? {} : { fellBackFrom: wanted }),
            at: (step) => clampToMap(walk(step), map),
        });
    }
    return plans;
}

/** Which way a bot faces when it goes from one point to the next. */
export function directionOf(from: Pair, to: Pair): PositionMessage_Direction {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    if (dx === 0 && dy === 0) {
        return PositionMessage_Direction.DOWN;
    }
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx > 0 ? PositionMessage_Direction.RIGHT : PositionMessage_Direction.LEFT;
    }
    return dy > 0 ? PositionMessage_Direction.DOWN : PositionMessage_Direction.UP;
}

/** The layers of a woka, bottom to top, as the customisation screen stacks them. */
export const RECIPE_LAYERS = ["body", "eyes", "hair", "clothes", "hat", "accessory"] as const;
// The first four always, a hat on two bots in three and an accessory on one in three: 4 to 6 layers a bot
const OPTIONAL_LAYER_SHARE: Partial<Record<(typeof RECIPE_LAYERS)[number], number>> = { hat: 2 / 3, accessory: 1 / 3 };

/** The part of the page's woka list (gameManager.loadWokaData()) the recipes are taken from. */
export type WokaListLike = Record<
    string,
    { collections: { textures: readonly { id: string; url: string }[] }[] } | undefined
>;

/**
 * `count` recipes of several layers each, taken from the layers of the woka list the page already loads. A recipe of
 * one layer cannot exercise the avatar bake, so a list that gives fewer than two layers is an error, not a fallback.
 */
export function buildRecipes(wokaList: WokaListLike, count: number): WokaTextureDescriptionInterface[][] {
    const recipes: WokaTextureDescriptionInterface[][] = [];
    for (let recipe = 0; recipe < count; recipe++) {
        const layers: WokaTextureDescriptionInterface[] = [];
        RECIPE_LAYERS.forEach((layer, layerIndex) => {
            const share = OPTIONAL_LAYER_SHARE[layer];
            if (share !== undefined && unitHash(recipe, 20 + layerIndex) >= share) {
                return;
            }
            const textures = (wokaList[layer]?.collections ?? []).flatMap((collection) => collection.textures);
            if (textures.length === 0) {
                return;
            }
            const texture = textures[Math.floor(unitHash(recipe, 30 + layerIndex) * textures.length)];
            layers.push({ id: texture.id, url: texture.url });
        });
        if (layers.length < 2) {
            throw new Error(
                "The woka list has fewer than two customisation layers with textures: a one-layer avatar cannot " +
                    "exercise the avatar bake, so no crowd is spawned.",
            );
        }
        recipes.push(layers);
    }
    return recipes;
}

/** The part of RemotePlayersRepository the crowd drives: what a join, a move and a leave call. */
export interface CrowdRepository {
    addPlayer(message: MessageUserJoined): void;
    movePlayer(message: UserMovedMessage): void;
    removePlayer(userId: number): void;
}

export interface CrowdScene {
    repository: CrowdRepository;
    /** The scene's UPDATE event passes the game time in ms first. */
    events: {
        on(event: string, listener: (time: number) => void): unknown;
        off(event: string, listener: (time: number) => void): unknown;
    };
    updateEvent: string;
    /** Whether the scene has built (or queued the build of) the avatar of this user. */
    hasPlayer(userId: number): boolean;
    /** Resolves once the scene has run an update, which is when it applies what the repository buffered. */
    nextFrame(): Promise<void>;
}

export interface SyntheticCrowdReport {
    requested: number;
    /** Bots in the scene after the first frame: less than `requested` means the scene did not take them all. */
    inScene: number;
    groups: Record<CrowdGroup, number>;
    /** Groups with no anchor in the map, whose bots were spread over the map instead. */
    fallbackGroups: CrowdGroup[];
    recipes: number;
    layersPerRecipe: { min: number; max: number };
    moveIntervalMs: number;
}

// Moves are spread over this many phases of the interval, so that 1,000 bots do not all move in the same frame
const MOVE_PHASES = 10;

interface Bot {
    plan: BotPlan;
    step: number;
    pose: Pair;
    nextMoveAt: number | undefined;
}

export function createSyntheticCrowd(scene: CrowdScene, moveIntervalMs: number) {
    let bots: Bot[] = [];
    let ticking = false;

    const onUpdate = (time: number) => {
        for (const bot of bots) {
            bot.nextMoveAt ??= time + ((bot.plan.index % MOVE_PHASES) * moveIntervalMs) / MOVE_PHASES;
            if (time < bot.nextMoveAt) {
                continue;
            }
            const from = bot.pose;
            bot.step++;
            bot.pose = bot.plan.at(bot.step);
            scene.repository.movePlayer({
                userId: bot.plan.userId,
                position: {
                    x: bot.pose[0],
                    y: bot.pose[1],
                    direction: directionOf(from, bot.pose),
                    moving: true,
                },
            });
            // A frame that ran late does not make the bot send two moves: a real client sends one per interval
            bot.nextMoveAt =
                time - bot.nextMoveAt > moveIntervalMs ? time + moveIntervalMs : bot.nextMoveAt + moveIntervalMs;
        }
    };

    return {
        get size(): number {
            return bots.length;
        },
        async spawn(
            count: number,
            map: CrowdMap,
            recipes: WokaTextureDescriptionInterface[][],
        ): Promise<SyntheticCrowdReport> {
            if (bots.length > 0) {
                throw new Error("A synthetic crowd is already in the room: call clearSyntheticCrowd() first.");
            }
            if (!Number.isInteger(count) || count < 1) {
                throw new Error(`spawnSyntheticCrowd(count) needs a whole number of 1 or more (got ${String(count)}).`);
            }
            if (recipes.length === 0) {
                throw new Error("No avatar recipe to give the crowd.");
            }
            const plans = planCrowd(count, map);
            const groups: Record<CrowdGroup, number> = { glass: 0, lights: 0, borders: 0, spread: 0 };
            const fallbackGroups = new Set<CrowdGroup>();
            const joined: Bot[] = [];
            try {
                for (const plan of plans) {
                    const pose = plan.at(0);
                    scene.repository.addPlayer({
                        userId: plan.userId,
                        name: `bench-${plan.index}`,
                        characterTextures: recipes[plan.index % recipes.length],
                        position: { x: pose[0], y: pose[1], direction: PositionMessage_Direction.DOWN, moving: false },
                        availabilityStatus: AvailabilityStatus.ONLINE,
                        visitCardUrl: null,
                        companionTexture: undefined,
                        userUuid: `bench-uuid-${plan.index}`,
                        outlineColor: undefined,
                        variables: new Map(),
                    });
                    joined.push({ plan, step: 0, pose, nextMoveAt: undefined });
                    groups[plan.group]++;
                    if (plan.fellBackFrom) {
                        fallbackGroups.add(plan.fellBackFrom);
                    }
                }
            } catch (error: unknown) {
                // A half-joined crowd would leave bots nobody can clear
                for (const bot of joined) {
                    scene.repository.removePlayer(bot.plan.userId);
                }
                throw error;
            }
            bots = joined;
            scene.events.on(scene.updateEvent, onUpdate);
            ticking = true;
            await scene.nextFrame();
            const layerCounts = recipes.map((recipe) => recipe.length);
            return {
                requested: count,
                inScene: bots.filter((bot) => scene.hasPlayer(bot.plan.userId)).length,
                groups,
                fallbackGroups: [...fallbackGroups],
                recipes: recipes.length,
                layersPerRecipe: { min: Math.min(...layerCounts), max: Math.max(...layerCounts) },
                moveIntervalMs,
            };
        },
        /** Removes every bot and the listener. Resolves with how many left the scene and how many are still in it. */
        async clear(): Promise<{ removed: number; remaining: number }> {
            if (ticking) {
                scene.events.off(scene.updateEvent, onUpdate);
                ticking = false;
            }
            const leaving = bots;
            bots = [];
            for (const bot of leaving) {
                scene.repository.removePlayer(bot.plan.userId);
            }
            if (leaving.length === 0) {
                return { removed: 0, remaining: 0 };
            }
            await scene.nextFrame();
            const remaining = leaving.filter((bot) => scene.hasPlayer(bot.plan.userId)).length;
            return { removed: leaving.length - remaining, remaining };
        },
    };
}
