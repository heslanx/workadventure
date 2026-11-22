// @vitest-environment jsdom
import * as Phaser from "phaser";
import type * as PhaserModule from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelablePromise } from "cancelable-promise";
import { PositionMessage_Direction } from "@workadventure/messages";
import { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import { UsernameDomLayer } from "../../../../src/front/Phaser/Game/UsernameDomLayer";
import { AvatarBuildQueue } from "../../../../src/front/Phaser/Entity/AvatarBuildQueue";
import { AVATAR_DETAIL_BUDGET, NAME_TAGS_MIN_ZOOM_MODIFIER } from "../../../../src/front/Phaser/Game/AvatarDetail";
import { WaScaleManagerEvent } from "../../../../src/front/Phaser/Services/WaScaleManager";
import type { Room } from "../../../../src/front/Connection/Room";
import type { RemotePlayersRepository } from "../../../../src/front/Phaser/Game/RemotePlayersRepository";
import { biggestAvailableAreaStore } from "../../../../src/front/Stores/BiggestAvailableAreaStore";

/**
 * What 1000 remote avatars cost at whole-map zoom, with the detail budget off and on: the real GameScene, RemotePlayer,
 * name tags, culling and dot layer, on a scene without a renderer. The cost is counted in what is drawn and what each
 * frame asks the scene and the DOM to do, not in milliseconds. The counts are the assertions, so a run shows them:
 *
 *     PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest run tests/front/Phaser/Game/AvatarDetailCost.test.ts
 */

vi.mock("../../../../src/front/Phaser/Entity/PlayerTexturesLoadingManager", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    lazyLoadPlayerCharacterTextures: vi.fn(() => CancelablePromise.resolve(["color_1", "eyes_1"])),
}));
vi.mock("../../../../src/front/Phaser/Companion/CompanionTexturesLoadingManager", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    lazyLoadPlayerCompanionTexture: vi.fn(() => CancelablePromise.resolve("cat1")),
}));

const { animationPlays } = vi.hoisted(() => ({ animationPlays: { count: 0 } }));

// A sprite that needs no animation manager, and counts the animations it is told to play.
vi.mock("phaser", async (importOriginal) => {
    const actual = await importOriginal<typeof PhaserModule>();
    class FakeSprite extends actual.GameObjects.Image {
        public readonly anims = {
            currentAnim: undefined,
            play: () => {
                animationPlays.count++;
            },
        };
        public play() {
            animationPlays.count++;
            return this;
        }
    }
    return { ...actual, GameObjects: { ...actual.GameObjects, Sprite: FakeSprite } };
});

type UserJoined = Parameters<RemotePlayersRepository["addPlayer"]>[0];
type UserMoved = Parameters<RemotePlayersRepository["movePlayer"]>[0];

interface GameSceneInternals {
    CurrentPlayer: unknown;
    avatarBuildQueue: AvatarBuildQueue;
    createAvatarDotLayer(): void;
}

const AVATARS = 1000;
// 40 columns by 25 rows, 64 px apart: a 2560x1600 map, all of it in the camera, as at whole-map zoom.
const COLUMNS = 40;
const MAP = { width: 64 * COLUMNS, height: 64 * (AVATARS / COLUMNS) };
const WHOLE_MAP = { x: 0, y: 0, right: MAP.width, bottom: MAP.height };
// A zoom modifier of a whole-map view, below the one under which names are hidden.
const WHOLE_MAP_ZOOM_MODIFIER = 0.3;
const FRAME_MS = 16;
const FRAMES_PER_MOVE = 12;
const MEASURED_FRAMES = 24;
const STEP = 3;

function positionOf(userId: number): { x: number; y: number } {
    const index = userId - 1;
    return { x: 32 + 64 * (index % COLUMNS), y: 32 + 64 * Math.floor(index / COLUMNS) };
}

function joined(userId: number, withCompanion: boolean): UserJoined {
    return {
        userId,
        userUuid: `uuid-${userId}`,
        name: `player ${userId}`,
        characterTextures: [],
        companionTexture: withCompanion ? { id: "cat1", url: "cat1.png" } : undefined,
        position: { ...positionOf(userId), direction: PositionMessage_Direction.RIGHT, moving: false },
        availabilityStatus: 0,
    } as unknown as UserJoined;
}

function walking(userId: number, x: number): UserMoved {
    return {
        userId,
        position: { x, y: positionOf(userId).y, direction: PositionMessage_Direction.RIGHT, moving: true },
    };
}

async function flushPromises(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

/** A Blitter bob that notes that it was moved: the cost of a dot is its move, not how many axes it was written on. */
class CountingBob {
    public visible = true;
    public destroyed = false;
    private position: { x: number; y: number };
    constructor(
        x: number,
        y: number,
        private readonly moved: Set<CountingBob>,
    ) {
        this.position = { x, y };
    }
    get x() {
        return this.position.x;
    }
    set x(value: number) {
        this.moved.add(this);
        this.position.x = value;
    }
    get y() {
        return this.position.y;
    }
    set y(value: number) {
        this.moved.add(this);
        this.position.y = value;
    }
    setVisible(visible: boolean) {
        this.visible = visible;
        return this;
    }
    destroy() {
        this.destroyed = true;
    }
}

/** What the scene draws, after the crowd settled. */
interface Drawn {
    /** Remote avatars drawn in full (their container is visible). */
    fullAvatars: number;
    /** Sprites the scene updates each frame (active), avatars and companions. */
    activeSprites: number;
    /** Name tags the browser lays out and paints: shown, in a shown layer. */
    nameTagsShown: number;
    /** Dots drawn by the Blitter. */
    dots: number;
}

/** What a frame asks for while all 1000 walk: the busiest of the measured frames. */
interface FrameWork {
    /** Writes that changed the style of a name tag. */
    nameTagWrites: number;
    /** Containers and sprites the renderer walks: each full avatar and its sprites. */
    objectsRendered: number;
    /** Dots whose position changed. */
    dotsMoved: number;
    /** Animations the avatars' sprites are told to play. */
    animationPlays: number;
}

function createCrowd(options: { budget: boolean; withCompanions?: boolean }) {
    const room = { key: "https://play.example/_/global/map.json", mapUrl: "https://play.example/map.json" };
    const scene = new GameScene(room as unknown as Room, "whole-map-scene");
    const events = new Phaser.Events.EventEmitter();
    const textureFrame = {
        realWidth: 32,
        realHeight: 32,
        width: 32,
        height: 32,
        customPivot: false,
        pivotX: 0,
        pivotY: 0,
    };
    Object.assign(scene.sys, {
        events,
        updateList: { add: () => {}, remove: () => {} },
        input: { enable: () => {}, disable: () => {} },
        textures: { get: () => ({ key: "t", get: () => textureFrame }) },
        game: { renderer: undefined },
        queueDepthSort: () => {},
    });
    const world = {
        defaults: {},
        pendingDestroy: new Set(),
        enableBody: (object: Phaser.GameObjects.GameObject) => {
            object.body = new Phaser.Physics.Arcade.Body(world as unknown as Phaser.Physics.Arcade.World, object);
        },
    };
    let layerElement: HTMLElement | undefined;
    const domElement = {
        pointerEvents: "",
        setOrigin: () => domElement,
        setDepth: () => domElement,
        setVisible: () => {},
        destroy: () => {},
    };
    const bobs: CountingBob[] = [];
    const dotsMoved = new Set<CountingBob>();
    const blitter = {
        create: (x: number, y: number) => {
            const bob = new CountingBob(x, y, dotsMoved);
            bobs.push(bob);
            return bob;
        },
        setDepth: () => blitter,
        destroy: () => {},
    };
    const worldView = { ...WHOLE_MAP };
    Object.assign(scene, {
        events,
        scene: { scene: { renderer: {} } },
        cameras: { main: { worldView, zoom: 0.3, preRender: vi.fn() } },
        Map: { widthInPixels: MAP.width, heightInPixels: MAP.height },
        connection: { getUserId: () => 0 },
        textures: { exists: () => true },
        anims: { exists: () => true, create: () => {}, generateFrameNumbers: () => [] },
        game: { events: new Phaser.Events.EventEmitter() },
        input: new Phaser.Events.EventEmitter(),
        physics: { world },
        add: {
            existing: () => {},
            blitter: () => blitter,
            dom: (_x: number, _y: number, element: HTMLElement) => {
                layerElement = element;
                return domElement;
            },
        },
    });
    const internals = scene as unknown as GameSceneInternals;
    // What GameScene.create() does with the budget on or off.
    scene.usernameDomLayer = new UsernameDomLayer(scene, options.budget ? NAME_TAGS_MIN_ZOOM_MODIFIER : undefined);
    if (options.budget) {
        internals.createAvatarDotLayer();
    }
    internals.CurrentPlayer = { x: MAP.width / 2, y: MAP.height / 2 };
    internals.avatarBuildQueue = new AvatarBuildQueue(AVATARS, Infinity);

    const observer = new MutationObserver(() => {});
    const repository = scene.getRemotePlayersRepository();
    const players = () => [...scene.MapPlayersByKey.values()];
    let time = 1_000;
    let framesWalked = 0;
    let walking_ = false;

    async function frame(): Promise<{ nameTagWrites: number; dotsMoved: number; animationPlays: number }> {
        animationPlays.count = 0;
        if (walking_ && framesWalked % FRAMES_PER_MOVE === 0) {
            for (let userId = 1; userId <= AVATARS; userId++) {
                repository.movePlayer(walking(userId, positionOf(userId).x + STEP * (framesWalked + FRAMES_PER_MOVE)));
            }
        }
        if (walking_) framesWalked++;
        time += FRAME_MS;
        observer.takeRecords();
        dotsMoved.clear();
        scene.update(time, FRAME_MS);
        scene.events.emit(Phaser.Scenes.Events.POST_UPDATE);
        scene.events.emit(Phaser.Scenes.Events.RENDER);
        const records = observer
            .takeRecords()
            .filter((record) => (record.target as Element).className === "username-display");
        const work = {
            nameTagWrites: records.length,
            dotsMoved: dotsMoved.size,
            animationPlays: animationPlays.count,
        };
        await flushPromises();
        return work;
    }

    function drawn(): Drawn {
        const sprites = players().flatMap((player) => [
            ...player.sprites.values(),
            ...(player.companion?.sprites.values() ?? []),
        ]);
        const layerShown = layerElement?.style.display !== "none";
        const tags = [...(layerElement?.querySelectorAll<HTMLElement>(".username-display") ?? [])];
        return {
            fullAvatars: players().filter((player) => player.visible).length,
            activeSprites: sprites.filter((sprite) => sprite.active).length,
            nameTagsShown: layerShown ? tags.filter((tag) => tag.style.display !== "none").length : 0,
            dots: bobs.filter((bob) => !bob.destroyed && bob.visible).length,
        };
    }

    return {
        scene,
        players,
        frame,
        drawn,
        worldView,
        bobs,
        /** All 1000 join and are built, then the camera zooms out to the whole map and the zoom settles. */
        async joinAtWholeMap(): Promise<void> {
            for (let userId = 1; userId <= AVATARS; userId++) {
                repository.addPlayer(joined(userId, options.withCompanions ?? false));
            }
            await frame();
            await frame();
            await frame();
            scene.game.events.emit(WaScaleManagerEvent.ZoomChanged, WHOLE_MAP_ZOOM_MODIFIER);
            // Past the zoom settle delay and the periodic recompute.
            for (let i = 0; i < 20; i++) {
                // eslint-disable-next-line no-await-in-loop -- frames run one after the other
                await frame();
            }
            if (layerElement === undefined) throw new Error("The name layer was not created");
            observer.observe(layerElement, { attributes: true, attributeFilter: ["style"], subtree: true });
        },
        /** All 1000 walk; returns the busiest of the measured frames. */
        async walkAndMeasure(): Promise<FrameWork> {
            walking_ = true;
            const frames: FrameWork[] = [];
            for (let i = 0; i < 3 + MEASURED_FRAMES; i++) {
                // eslint-disable-next-line no-await-in-loop -- frames run one after the other
                const work = await frame();
                if (i >= 3) {
                    const full = players().filter((player) => player.visible);
                    const objectsRendered = full.reduce((sum, player) => sum + 1 + player.sprites.size, 0);
                    frames.push({ ...work, objectsRendered });
                }
            }
            return {
                nameTagWrites: Math.max(...frames.map((work) => work.nameTagWrites)),
                objectsRendered: Math.max(...frames.map((work) => work.objectsRendered)),
                dotsMoved: Math.max(...frames.map((work) => work.dotsMoved)),
                animationPlays: Math.max(...frames.map((work) => work.animationPlays)),
            };
        },
    };
}

beforeEach(() => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(biggestAvailableAreaStore, "consumePendingRecompute").mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("1000 remote players at whole-map zoom", () => {
    it(
        "budget off: 1000 full avatars, 2000 active sprites, 1000 name tags; walking, 1000 tag writes, 3000 objects and 2000 animation plays per frame",
        { timeout: 120_000 },
        async () => {
            const crowd = createCrowd({ budget: false });
            await crowd.joinAtWholeMap();

            const drawn = crowd.drawn();
            const work = await crowd.walkAndMeasure();

            expect(drawn).toEqual({ fullAvatars: 1000, activeSprites: 2000, nameTagsShown: 1000, dots: 0 });
            expect(work).toEqual({ nameTagWrites: 1000, objectsRendered: 3000, dotsMoved: 0, animationPlays: 2000 });
        },
    );

    it(
        "budget on: 80 full avatars, 160 active sprites, 0 name tags, 920 dots; walking, 80 tag writes in a hidden layer, 240 objects, 920 dots moved and 164 animation plays per frame",
        { timeout: 120_000 },
        async () => {
            const crowd = createCrowd({ budget: true });
            await crowd.joinAtWholeMap();

            const drawn = crowd.drawn();
            const work = await crowd.walkAndMeasure();

            expect(drawn).toEqual({
                fullAvatars: AVATAR_DETAIL_BUDGET,
                activeSprites: 2 * AVATAR_DETAIL_BUDGET,
                nameTagsShown: 0,
                dots: AVATARS - AVATAR_DETAIL_BUDGET,
            });
            // The tags of the full avatars still follow their moves: one transform write each, 80 in the busiest frame.
            // An avatar that changes detail takes its tag out of the layer or puts it back, which is not a style write,
            // and a tag out of the layer is not placed, so a swap moves the write from one tag to the other.
            // All of it inside the hidden layer, which the browser neither lays out nor paints.
            // Only the full avatars' sprites play their walk (2 x 80), plus the replay of an avatar drawn in full again:
            // a dot remembers its pose and plays nothing.
            // Every dot moves, as everyone walks: the count is of dots moved, not of coordinate writes (a walk along one
            // axis writes one per dot, a diagonal one two), and no browser run has measured what a write costs.
            expect(work).toEqual({ nameTagWrites: 80, objectsRendered: 240, dotsMoved: 920, animationPlays: 164 });
        },
    );

    it("tells the scene effects which avatars are full, only with the budget on and once it has chosen", async () => {
        const off = createCrowd({ budget: false });
        await off.joinAtWholeMap();
        const crowd = createCrowd({ budget: true });
        const beforeTheFirstFrame = crowd.scene.fullDetailPlayers;
        await crowd.joinAtWholeMap();

        expect(off.scene.fullDetailPlayers).toBeUndefined();
        expect(beforeTheFirstFrame).toBeUndefined();
        const full = crowd.players().filter((player) => player.visible);
        expect(full).toHaveLength(AVATAR_DETAIL_BUDGET);
        expect(new Set(crowd.scene.fullDetailPlayers)).toEqual(new Set(full));
    });

    it("keeps the full avatars nearest the player", { timeout: 120_000 }, async () => {
        const crowd = createCrowd({ budget: true });
        await crowd.joinAtWholeMap();

        const distance = (player: { x: number; y: number }) =>
            Math.hypot(player.x - MAP.width / 2, player.y - MAP.height / 2);
        const full = crowd.players().filter((player) => player.visible);
        const dots = crowd.players().filter((player) => !player.visible);

        expect(Math.max(...full.map(distance))).toBeLessThanOrEqual(Math.min(...dots.map(distance)));
    });

    it(
        "keeps a culled dot culled, and a dot brought back into the view a dot, companion included",
        { timeout: 120_000 },
        async () => {
            const crowd = createCrowd({ budget: true, withCompanions: true });
            await crowd.joinAtWholeMap();

            // The camera moves far from everyone for one frame, then back to the whole map.
            Object.assign(crowd.worldView, { x: 10_000, y: 10_000, right: 11_000, bottom: 11_000 });
            await crowd.frame();
            const awayDrawn = crowd.drawn();
            Object.assign(crowd.worldView, WHOLE_MAP);
            await crowd.frame();

            const dots = crowd.players().filter((player) => !player.visible);
            expect(awayDrawn).toEqual({ fullAvatars: 0, activeSprites: 0, nameTagsShown: 0, dots: 0 });
            expect(dots).toHaveLength(AVATARS - AVATAR_DETAIL_BUDGET);
            expect(dots.every((player) => player.companion?.visible === false)).toBe(true);
            expect(crowd.drawn()).toEqual({
                fullAvatars: AVATAR_DETAIL_BUDGET,
                activeSprites: 3 * AVATAR_DETAIL_BUDGET,
                nameTagsShown: 0,
                dots: AVATARS - AVATAR_DETAIL_BUDGET,
            });
        },
    );
});
