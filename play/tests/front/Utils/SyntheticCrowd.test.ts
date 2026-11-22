import { PositionMessage_Direction } from "@workadventure/messages";
import type { UserMovedMessage } from "@workadventure/messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageUserJoined } from "../../../src/front/Connection/ConnexionModels";
import {
    BOT_STEP_PX,
    buildRecipes,
    createSyntheticCrowd,
    crowdMapFromManifest,
    directionOf,
    planCrowd,
    SYNTHETIC_USER_ID_BASE,
    unitHash,
    type CrowdMap,
    type WokaListLike,
} from "../../../src/front/Utils/SyntheticCrowd";
import { KONCLUI_OFFICE_FX } from "./konclui-office-fx.fixture";

afterEach(() => {
    vi.restoreAllMocks();
});

const MAP: CrowdMap = {
    width: 2752,
    height: 1792,
    glassFaces: [
        [400, 700, 500],
        [1200, 1500, 900],
    ],
    lights: [
        [1000, 600],
        [2000, 1200],
    ],
    // One vertical wall at x = 1800 and one horizontal wall at y = 300
    borders: [
        [1800, 100, 1800, 500],
        [100, 300, 600, 300],
    ],
};

const WOKA_LIST: WokaListLike = {
    body: {
        collections: [
            {
                textures: [
                    { id: "body-1", url: "u/b1" },
                    { id: "body-2", url: "u/b2" },
                ],
            },
        ],
    },
    eyes: { collections: [{ textures: [{ id: "eyes-1", url: "u/e1" }] }] },
    hair: {
        collections: [
            {
                textures: [
                    { id: "hair-1", url: "u/h1" },
                    { id: "hair-2", url: "u/h2" },
                ],
            },
        ],
    },
    clothes: { collections: [{ textures: [{ id: "clothes-1", url: "u/c1" }] }] },
    hat: { collections: [{ textures: [{ id: "hat-1", url: "u/t1" }] }] },
    accessory: { collections: [{ textures: [{ id: "acc-1", url: "u/a1" }] }] },
    woka: { collections: [{ textures: [{ id: "single", url: "u/s" }] }] },
};

describe("unitHash", () => {
    it("is a pure function of its two integers and stays in [0, 1)", () => {
        expect(unitHash(7, 3)).toBe(unitHash(7, 3));
        expect(unitHash(7, 3)).not.toBe(unitHash(8, 3));
        expect(unitHash(7, 3)).not.toBe(unitHash(7, 4));
        for (let i = 0; i < 1000; i++) {
            const value = unitHash(i, 1);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });

    it("spreads 1,000 indexes over the unit interval (each tenth gets 70 to 130)", () => {
        const tenths = new Array<number>(10).fill(0);
        for (let i = 0; i < 1000; i++) tenths[Math.floor(unitHash(i, 1) * 10)]++;

        expect(Math.min(...tenths)).toBeGreaterThan(70);
        expect(Math.max(...tenths)).toBeLessThan(130);
    });
});

describe("planCrowd", () => {
    it("gives each of the four groups a quarter of 1,000 bots, in that order", () => {
        const plans = planCrowd(1000, MAP);
        const counts = { glass: 0, lights: 0, borders: 0, spread: 0 };
        for (const plan of plans) counts[plan.group]++;

        expect(counts).toEqual({ glass: 250, lights: 250, borders: 250, spread: 250 });
        expect(plans.slice(0, 4).map((plan) => plan.group)).toEqual(["glass", "lights", "borders", "spread"]);
        expect(plans[0].userId).toBe(SYNTHETIC_USER_ID_BASE);
    });

    it("walks the same path every time, and never asks Math.random", () => {
        const random = vi.spyOn(Math, "random");
        const path = (plan: ReturnType<typeof planCrowd>[number]) => [0, 1, 2, 50, 999].map((step) => plan.at(step));

        const first = planCrowd(40, MAP).map(path);
        const second = planCrowd(40, MAP).map(path);

        expect(second).toEqual(first);
        expect(random).not.toHaveBeenCalled();
    });

    it("gives two bots of the same group different paths", () => {
        const [a, b] = [planCrowd(100, MAP)[3], planCrowd(100, MAP)[7]];

        expect(a.group).toBe(b.group);
        expect(a.at(5)).not.toEqual(b.at(5));
    });

    it("keeps every bot inside the map for 200 moves", () => {
        const xs: number[] = [];
        const ys: number[] = [];
        for (const plan of planCrowd(200, MAP)) {
            for (let step = 0; step < 200; step++) {
                const [x, y] = plan.at(step);
                xs.push(x);
                ys.push(y);
            }
        }

        expect([Math.min(...xs), Math.max(...xs)]).toEqual([expect.any(Number), expect.any(Number)]);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(MAP.width);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...ys)).toBeLessThanOrEqual(MAP.height);
    });

    it("moves a bot no further than one step (36 px, plus the rounding of both points) between two moves", () => {
        let longest = 0;
        for (const plan of planCrowd(200, MAP)) {
            for (let step = 1; step < 100; step++) {
                const [x0, y0] = plan.at(step - 1);
                const [x1, y1] = plan.at(step);
                longest = Math.max(longest, Math.hypot(x1 - x0, y1 - y0));
            }
        }

        expect(longest).toBeLessThanOrEqual(BOT_STEP_PX + 3);
        expect(longest).toBeGreaterThan(BOT_STEP_PX - 3);
    });

    it("keeps the glass group on its pane: along the face and just below its foot line", () => {
        const glass = planCrowd(400, MAP).filter((plan) => plan.group === "glass");

        expect(glass).toHaveLength(100);
        for (const plan of glass) {
            for (let step = 0; step < 60; step++) {
                const [x, y] = plan.at(step);
                const face = MAP.glassFaces.find(([x0, x1, foot]) => x >= x0 && x <= x1 && y >= foot && y <= foot + 16);
                expect(face).toBeDefined();
            }
        }
    });

    it("keeps the light group within 40 px of a light, circling it", () => {
        const group = planCrowd(400, MAP).filter((plan) => plan.group === "lights");

        for (const plan of group) {
            for (let step = 0; step < 60; step++) {
                const [x, y] = plan.at(step);
                const nearest = Math.min(...MAP.lights.map(([lx, ly]) => Math.hypot(x - lx, y - ly)));
                expect(nearest).toBeLessThanOrEqual(50);
                expect(nearest).toBeGreaterThanOrEqual(20);
            }
        }
    });

    it("walks the border group across its wall: it is seen on both sides of it", () => {
        const group = planCrowd(400, MAP).filter((plan) => plan.group === "borders");
        let crossing = 0;

        for (const plan of group) {
            // The bot belongs to the vertical wall (x = 1800, y 100..500) or to the horizontal one (y = 300)
            const [x0] = plan.at(0);
            const vertical = Math.abs(x0 - 1800) <= 49;
            const sides = new Set<number>();
            for (let step = 0; step < 80; step++) {
                const [x, y] = plan.at(step);
                sides.add(vertical ? Math.sign(x - 1800) : Math.sign(y - 300));
            }
            if (sides.has(-1) && sides.has(1)) crossing++;
        }

        expect(group).toHaveLength(100);
        expect(crossing).toBe(100);
    });

    it("spreads the last group over the map, away from any single place", () => {
        const spread = planCrowd(1000, MAP).filter((plan) => plan.group === "spread");
        const xs = spread.map((plan) => plan.at(0)[0]);
        const ys = spread.map((plan) => plan.at(0)[1]);

        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(MAP.width * 0.6);
        expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(MAP.height * 0.6);
    });

    it("spreads a group over the map when it has no anchor, and says which", () => {
        const plans = planCrowd(8, { ...MAP, glassFaces: [], lights: [] });

        expect(plans.map((plan) => plan.group)).toEqual([
            "spread",
            "spread",
            "borders",
            "spread",
            "spread",
            "spread",
            "borders",
            "spread",
        ]);
        expect(plans.filter((plan) => plan.fellBackFrom).map((plan) => plan.fellBackFrom)).toEqual([
            "glass",
            "lights",
            "glass",
            "lights",
        ]);
    });
});

describe("directionOf", () => {
    it.each([
        [[0, 0], [10, 2], PositionMessage_Direction.RIGHT],
        [[0, 0], [-10, 2], PositionMessage_Direction.LEFT],
        [[0, 0], [2, 10], PositionMessage_Direction.DOWN],
        [[0, 0], [2, -10], PositionMessage_Direction.UP],
        [[5, 5], [5, 5], PositionMessage_Direction.DOWN],
    ] as const)("faces %j to %j as %s", (from, to, expected) => {
        expect(directionOf(from, to)).toBe(expected);
    });
});

describe("crowdMapFromManifest", () => {
    it("takes glass faces, light centres and room walls from an effects manifest, and ignores the rest", () => {
        const map = crowdMapFromManifest(
            {
                map: [2752, 1792],
                glassFaces: [[10, 20, 30]],
                staticLights: [
                    { kind: "lamp", at: [100, 200] },
                    { kind: "tv", rect: [100, 60, 40, 20] },
                ],
                // [x, y, w, h], like every rect of the manifest
                rooms: [{ key: "r", layer: "l", rect: [10, 20, 100, 50], floor: [11, 21, 98, 48] }],
                lights: { anything: 1 },
            },
            { width: 2752, height: 1792 },
        );

        expect(map.glassFaces).toEqual([[10, 20, 30]]);
        expect(map.lights).toEqual([
            [100, 200],
            [120, 70],
        ]);
        expect(map.borders).toEqual([
            [10, 20, 110, 20],
            [10, 70, 110, 70],
            [10, 20, 10, 70],
            [110, 20, 110, 70],
        ]);
    });

    it("places borders on the room edges and light centres on the map for the real konclui-office manifest", () => {
        // Seen failing with the corner reading of [x, y, w, h]: room_01 [610, 256, 348, 352] gave a right edge at
        // x = 348, left of the room's own left edge, and the door rect [1340, 1600, 104, 150] a centre at (722, 875)
        const size = { width: 2752, height: 1792 };
        const map = crowdMapFromManifest(KONCLUI_OFFICE_FX, size);

        expect(map.borders).toHaveLength(KONCLUI_OFFICE_FX.rooms.length * 4);
        const edges = KONCLUI_OFFICE_FX.rooms.flatMap(({ rect: [x, y, w, h] }) => [
            [x, y, x + w, y],
            [x, y + h, x + w, y + h],
            [x, y, x, y + h],
            [x + w, y, x + w, y + h],
        ]);
        expect(map.borders).toEqual(edges);
        for (const [x0, y0, x1, y1] of map.borders) {
            // Each segment is a straight horizontal or vertical edge of some room, of positive length
            expect(x0 === x1 || y0 === y1).toBe(true);
            expect(Math.hypot(x1 - x0, y1 - y0)).toBeGreaterThan(0);
        }

        expect(map.lights).toHaveLength(KONCLUI_OFFICE_FX.staticLights.length);
        expect(map.lights).toContainEqual([1392, 1675]);
        for (const [x, y] of map.lights) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(size.width);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(size.height);
        }
    });

    it("walks the border group across the real room edges", () => {
        const map = crowdMapFromManifest(KONCLUI_OFFICE_FX, { width: 2752, height: 1792 });
        const plans = planCrowd(400, map).filter((plan) => plan.group === "borders");
        const rooms = KONCLUI_OFFICE_FX.rooms.map(({ rect: [x, y, w, h] }) => ({
            x0: x - 49,
            y0: y - 49,
            x1: x + w + 49,
            y1: y + h + 49,
        }));

        expect(plans).toHaveLength(100);
        for (const plan of plans) {
            for (let step = 0; step < 40; step++) {
                const [x, y] = plan.at(step);
                // Every position is within the border reach (48 px) of some room's rectangle
                expect(rooms.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)).toBe(true);
            }
        }
    });

    it("gives no anchor for a map without a manifest, and refuses a manifest that does not parse", () => {
        const size = { width: 100, height: 100 };

        expect(crowdMapFromManifest(undefined, size)).toEqual({
            ...size,
            glassFaces: [],
            lights: [],
            borders: [],
        });
        expect(() => crowdMapFromManifest({ glassFaces: [[1, 2]] }, size)).toThrow();
    });
});

describe("buildRecipes", () => {
    it("builds recipes of 4 to 6 layers from the woka list's layers, bottom to top, never from the single-layer woka list", () => {
        const recipes = buildRecipes(WOKA_LIST, 200);

        for (const recipe of recipes) {
            expect(recipe.length).toBeGreaterThanOrEqual(4);
            expect(recipe.length).toBeLessThanOrEqual(6);
            expect(recipe[0].id).toMatch(/^body-/);
            expect(recipe[1].id).toBe("eyes-1");
            expect(recipe.map((layer) => layer.id)).not.toContain("single");
        }
        expect(new Set(recipes.map((recipe) => recipe.length))).toEqual(new Set([4, 5, 6]));
    });

    it("is deterministic and varied", () => {
        expect(buildRecipes(WOKA_LIST, 30)).toEqual(buildRecipes(WOKA_LIST, 30));
        const keys = new Set(buildRecipes(WOKA_LIST, 30).map((recipe) => recipe.map((layer) => layer.id).join("|")));
        expect(keys.size).toBeGreaterThan(4);
    });

    it("refuses a list that could only give one layer: a single layer cannot exercise the bake", () => {
        expect(() => buildRecipes({ body: WOKA_LIST.body }, 3)).toThrow("fewer than two customisation layers");
    });
});

/** A scene stand-in: the repository the crowd drives, the UPDATE emitter and the set of avatars the scene holds. */
function fakeScene() {
    const added: MessageUserJoined[] = [];
    const moves: UserMovedMessage[] = [];
    const removed: number[] = [];
    const inScene = new Set<number>();
    const listeners = new Set<(time: number) => void>();
    let pendingFrames: (() => void)[] = [];
    const scene = {
        repository: {
            addPlayer: (message: MessageUserJoined) => {
                added.push(message);
            },
            movePlayer: (message: UserMovedMessage) => {
                moves.push(message);
            },
            removePlayer: (userId: number) => {
                removed.push(userId);
            },
        },
        events: {
            on: (_event: string, listener: (time: number) => void) => {
                listeners.add(listener);
            },
            off: (_event: string, listener: (time: number) => void) => {
                listeners.delete(listener);
            },
        },
        updateEvent: "update",
        hasPlayer: (userId: number) => inScene.has(userId),
        nextFrame: () =>
            new Promise<void>((resolve) => {
                pendingFrames.push(resolve);
            }),
    };
    /** The scene runs an update: it applies the buffered joins and leaves, then resolves the waiting frames. */
    const runFrame = () => {
        for (const message of added) inScene.add(message.userId);
        for (const userId of removed) inScene.delete(userId);
        const waiting = pendingFrames;
        pendingFrames = [];
        waiting.forEach((resolve) => resolve());
    };
    return { scene, added, moves, removed, inScene, listeners, runFrame };
}

const RECIPES = buildRecipes(WOKA_LIST, 12);

describe("synthetic crowd", () => {
    it("joins every bot through the repository with a multi-layer recipe, and reports the groups and who the scene took", async () => {
        const { scene, added, runFrame } = fakeScene();
        const crowd = createSyntheticCrowd(scene, 200);

        const spawning = crowd.spawn(999, MAP, RECIPES);
        runFrame();
        const report = await spawning;

        expect(added).toHaveLength(999);
        expect(new Set(added.map((message) => message.userId)).size).toBe(999);
        for (const message of added) {
            expect(message.characterTextures.length).toBeGreaterThanOrEqual(4);
            expect(message.userId).toBeGreaterThanOrEqual(SYNTHETIC_USER_ID_BASE);
        }
        expect(report).toMatchObject({
            requested: 999,
            inScene: 999,
            groups: { glass: 250, lights: 250, borders: 250, spread: 249 },
            fallbackGroups: [],
            recipes: 12,
            moveIntervalMs: 200,
        });
        expect(report.layersPerRecipe.min).toBeGreaterThanOrEqual(4);
    });

    it("reports a scene that took fewer bots than were joined", async () => {
        const { scene, inScene, runFrame } = fakeScene();
        const crowd = createSyntheticCrowd(scene, 200);

        const spawning = crowd.spawn(10, MAP, RECIPES);
        runFrame();
        inScene.delete(SYNTHETIC_USER_ID_BASE + 3);
        const report = await spawning;

        expect(report.inScene).toBe(9);
    });

    it("sends each bot one move per 200 ms interval, spread over frames: 5 moves a second at 60 frames a second", async () => {
        const { scene, moves, listeners, runFrame } = fakeScene();
        const crowd = createSyntheticCrowd(scene, 200);
        const spawning = crowd.spawn(100, MAP, RECIPES);
        runFrame();
        await spawning;

        // Ten seconds of 60 Hz frames on the game clock
        const frameMs = 1000 / 60;
        const perFrame: number[] = [];
        for (let frame = 0; frame < 600; frame++) {
            const before = moves.length;
            listeners.forEach((listener) => listener(100_000 + frame * frameMs));
            perFrame.push(moves.length - before);
        }

        const perBot = new Map<number, number>();
        for (const move of moves) perBot.set(move.userId, (perBot.get(move.userId) ?? 0) + 1);
        // 10 s at 5 moves a second: 50 each, give or take the phase it started at
        expect(perBot.size).toBe(100);
        expect(Math.min(...perBot.values())).toBeGreaterThanOrEqual(49);
        expect(Math.max(...perBot.values())).toBeLessThanOrEqual(50);
        // Ten phases: no frame carries the moves of more than a few phases' worth of bots
        expect(Math.max(...perFrame)).toBeLessThanOrEqual(30);
    });

    it("moves a bot along its plan, facing the way it goes", async () => {
        const { scene, moves, listeners, runFrame } = fakeScene();
        const crowd = createSyntheticCrowd(scene, 200);
        const spawning = crowd.spawn(1, MAP, RECIPES);
        runFrame();
        await spawning;

        for (let frame = 0; frame < 30; frame++) listeners.forEach((listener) => listener(frame * 50));

        const plan = planCrowd(1, MAP)[0];
        expect(moves.length).toBeGreaterThan(3);
        moves.forEach((move, index) => {
            const [x, y] = plan.at(index + 1);
            expect(move.position).toEqual({
                x,
                y,
                direction: directionOf(plan.at(index), plan.at(index + 1)),
                moving: true,
            });
        });
    });

    it("does not send a burst after a late frame: one move, not the ones it missed", async () => {
        const { scene, moves, listeners, runFrame } = fakeScene();
        const crowd = createSyntheticCrowd(scene, 200);
        const spawning = crowd.spawn(1, MAP, RECIPES);
        runFrame();
        await spawning;

        listeners.forEach((listener) => listener(0));
        listeners.forEach((listener) => listener(5000));

        expect(moves).toHaveLength(2);
    });

    it("removes every bot and the listener when cleared, and reports who is left", async () => {
        const { scene, removed, listeners, runFrame } = fakeScene();
        const crowd = createSyntheticCrowd(scene, 200);
        const spawning = crowd.spawn(50, MAP, RECIPES);
        runFrame();
        await spawning;
        expect(listeners.size).toBe(1);

        const clearing = crowd.clear();
        expect(listeners.size).toBe(0);
        runFrame();
        const result = await clearing;

        expect(removed).toHaveLength(50);
        expect(result).toEqual({ removed: 50, remaining: 0 });
        expect(crowd.size).toBe(0);
    });

    it("clears nothing, and waits for no frame, when there is no crowd", async () => {
        const { scene } = fakeScene();

        await expect(createSyntheticCrowd(scene, 200).clear()).resolves.toEqual({ removed: 0, remaining: 0 });
    });

    it("refuses a second crowd until the first is cleared, and a count that is not a whole number", async () => {
        const { scene, runFrame } = fakeScene();
        const crowd = createSyntheticCrowd(scene, 200);
        const spawning = crowd.spawn(3, MAP, RECIPES);
        runFrame();
        await spawning;

        await expect(crowd.spawn(3, MAP, RECIPES)).rejects.toThrow("clearSyntheticCrowd() first");
        await expect(createSyntheticCrowd(fakeScene().scene, 200).spawn(1.5, MAP, RECIPES)).rejects.toThrow(
            "whole number",
        );
    });

    it("takes back the bots it joined when a join throws midway, so that none is left behind", async () => {
        const { scene, removed, listeners } = fakeScene();
        let joins = 0;
        const addPlayer = scene.repository.addPlayer;
        scene.repository.addPlayer = (message) => {
            if (++joins === 6) {
                throw new Error("texture error");
            }
            addPlayer(message);
        };
        const crowd = createSyntheticCrowd(scene, 200);

        await expect(crowd.spawn(10, MAP, RECIPES)).rejects.toThrow("texture error");

        expect(removed).toHaveLength(5);
        expect(listeners.size).toBe(0);
        expect(crowd.size).toBe(0);
    });
});
