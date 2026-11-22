// @vitest-environment jsdom
import * as Phaser from "phaser";
import type * as PhaserModule from "phaser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { CancelablePromise } from "cancelable-promise";
import type { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import { RemotePlayer } from "../../../../src/front/Phaser/Entity/RemotePlayer";
import { AvatarBuildQueue } from "../../../../src/front/Phaser/Entity/AvatarBuildQueue";
import { RemotePlayerCulling } from "../../../../src/front/Phaser/Game/RemotePlayerCulling";

// A sprite that needs no animation manager.
vi.mock("phaser", async (importOriginal) => {
    const actual = await importOriginal<typeof PhaserModule>();
    class FakeSprite extends actual.GameObjects.Image {
        public readonly anims = { currentAnim: undefined, play: () => {} };
        public play() {
            return this;
        }
    }
    return { ...actual, GameObjects: { ...actual.GameObjects, Sprite: FakeSprite } };
});

const TEXTURES = ["color_1", "eyes_1"];
// The name is drawn this far above the player's position (see playerNameY in Character), and the player's depth is its
// position plus 16.
const NAME_OFFSET_Y = -18;
const DEPTH_OFFSET_Y = 16;

/** A scene with a real name layer element, a real event emitter and the minimum Phaser asks of one. */
function createScene() {
    const events = new Phaser.Events.EventEmitter();
    const frame = { realWidth: 32, realHeight: 32, width: 32, height: 32, customPivot: false, pivotX: 0, pivotY: 0 };
    const sys = {
        events,
        queueDepthSort: () => {},
        textures: { get: () => ({ key: "t", get: () => frame }) },
        updateList: { add: () => {}, remove: () => {} },
        input: { enable: () => {}, disable: () => {} },
        game: { renderer: undefined },
        renderer: undefined,
    };
    const layerElement = document.createElement("div");
    const scene = {
        sys,
        events,
        textures: { exists: () => true },
        anims: { exists: () => true },
        add: { existing: () => {} },
        markDirty: vi.fn(),
        superLoad: {},
        usernameDomLayer: { addUsername: (element: HTMLElement) => layerElement.appendChild(element) },
    };
    const world = {
        defaults: {},
        pendingDestroy: new Set(),
        enableBody: (object: Phaser.GameObjects.GameObject) => {
            object.body = new Phaser.Physics.Arcade.Body(world as unknown as Phaser.Physics.Arcade.World, object);
        },
    };
    Object.assign(scene, { physics: { world } });
    /** What Phaser does after a frame's update and in its render. */
    const render = () => {
        events.emit(Phaser.Scenes.Events.POST_UPDATE);
        events.emit(Phaser.Scenes.Events.RENDER);
    };
    return { scene: scene as unknown as GameScene, events, layerElement, render };
}

function createPlayer(scene: GameScene, x: number, y: number, queue?: AvatarBuildQueue): RemotePlayer {
    return new RemotePlayer(
        1,
        "uuid-1",
        scene,
        x,
        y,
        "player 1",
        CancelablePromise.resolve(TEXTURES),
        PositionMessage_Direction.DOWN,
        false,
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        queue,
    );
}

/** The sprite and name creations that follow a build run in promise callbacks. */
async function flushPromises(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

function move(player: RemotePlayer, x: number, y: number): void {
    player.updatePosition({ x, y, direction: PositionMessage_Direction.RIGHT, moving: true });
}

/**
 * Counts the writes that change the style of the name of the player, from now on. Read it before awaiting anything: the
 * observer's own callback takes the records at the next microtask.
 */
function watchStyleWrites(layerElement: HTMLElement): () => number {
    const observer = new MutationObserver(() => {});
    observer.observe(layerElement, { attributes: true, attributeFilter: ["style"], subtree: true });
    return () => observer.takeRecords().length;
}

function nameOf(layerElement: HTMLElement): HTMLElement {
    const name = layerElement.querySelector<HTMLElement>(".username-display");
    if (name === null) {
        throw new Error("The player has no name");
    }
    return name;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the name of a remote player that is culled", () => {
    it("detaches its tag when culled and restores the same tag", async () => {
        const { scene, layerElement } = createScene();
        const player = createPlayer(scene, 10, 20);
        await flushPromises();
        const tag = nameOf(layerElement);
        player.setCulled(true);
        expect(layerElement.contains(tag)).toBe(false);
        const writes = watchStyleWrites(tag);
        player.setCulled(true);
        expect(writes()).toBe(0);
        player.setCulled(false);
        expect(nameOf(layerElement)).toBe(tag);
        expect(nameOf(layerElement).style.display).toBe("");
    });

    it("is not written to while the player moves, and is where the player is when the player is drawn again", async () => {
        const { scene, layerElement, render } = createScene();
        const player = createPlayer(scene, 10, 20);
        await flushPromises();
        const tag = nameOf(layerElement);
        player.setCulled(true);
        const writes = watchStyleWrites(tag);

        for (const x of [100, 200, 300]) {
            move(player, x, 80);
            render();
        }
        const writesWhileMoving = writes();
        player.setCulled(false);
        render();

        const name = nameOf(layerElement);
        expect(writesWhileMoving).toBe(0);
        expect(name.style.display).toBe("");
        expect(name.style.transform).toContain(`translate3d(300px, ${80 + NAME_OFFSET_Y}px, 0)`);
        expect(name.style.zIndex).toBe(`${80 + DEPTH_OFFSET_Y}`);
    });

    it("queues no render listener while the player moves, as a culled move marks no frame to draw", async () => {
        const { scene, events } = createScene();
        const player = createPlayer(scene, 10, 20);
        await flushPromises();
        player.setCulled(true);
        const listenersWhenCulled = events.listenerCount(Phaser.Scenes.Events.RENDER);

        // No RENDER in between: the game skips the render of a scene that is not dirty, so nothing drains the listeners.
        for (const x of [100, 200, 300]) {
            move(player, x, 80);
            events.emit(Phaser.Scenes.Events.POST_UPDATE);
        }

        expect(events.listenerCount(Phaser.Scenes.Events.RENDER)).toBe(listenersWhenCulled);
    });

    it("queues a render listener for a move while the player is not culled", async () => {
        const { scene, events } = createScene();
        const player = createPlayer(scene, 10, 20);
        await flushPromises();
        const listenersBefore = events.listenerCount(Phaser.Scenes.Events.RENDER);

        move(player, 100, 80);
        events.emit(Phaser.Scenes.Events.POST_UPDATE);

        // Without this, the culled case above would pass even if the name never queued anything.
        expect(events.listenerCount(Phaser.Scenes.Events.RENDER)).toBeGreaterThan(listenersBefore);
    });

    it("is written to by every move while the player is not culled", async () => {
        const { scene, layerElement, render } = createScene();
        const player = createPlayer(scene, 10, 20);
        await flushPromises();
        const writes = watchStyleWrites(layerElement);

        for (const x of [100, 200, 300]) {
            move(player, x, 80);
            render();
        }

        // Each move changes where the name is, so each one writes to it: without this, the 0 above would prove nothing.
        expect(writes()).toBeGreaterThanOrEqual(3);
    });

    it("is hidden from the start when the player is built after it was culled", async () => {
        const { scene, layerElement, render } = createScene();
        const queue = new AvatarBuildQueue();
        const player = createPlayer(scene, 10, 20, queue);
        await flushPromises();
        player.setCulled(true);
        const namesBeforeTheBuild = layerElement.children.length;

        queue.drain();
        await flushPromises();
        const writes = watchStyleWrites(layerElement);
        move(player, 500, 80);
        render();

        expect(namesBeforeTheBuild).toBe(0);
        expect(layerElement.querySelector(".username-display")).toBeNull();
        expect(writes()).toBe(0);
    });
});

describe("a remote player that is culled by RemotePlayerCulling", () => {
    it("tells the culling that its moves leave the frame as it was, until it is drawn again", async () => {
        const { scene } = createScene();
        const player = createPlayer(scene, 10, 20);
        await flushPromises();
        const culling = new RemotePlayerCulling<RemotePlayer>();
        culling.track(player);

        culling.update({ x: 2_000, y: 2_000, right: 2_960, bottom: 2_540 });
        const hiddenWhileFarFromTheView = culling.isMoveHidden(player);
        culling.update({ x: 0, y: 0, right: 960, bottom: 540 });

        expect(hiddenWhileFarFromTheView).toBe(true);
        expect(culling.isMoveHidden(player)).toBe(false);
    });

    it("hides its name while it is outside the view and shows it again when the view comes back", async () => {
        const { scene, layerElement } = createScene();
        const player = createPlayer(scene, 10, 20);
        await flushPromises();
        const culling = new RemotePlayerCulling<RemotePlayer>();
        culling.track(player);

        culling.update({ x: 2_000, y: 2_000, right: 2_960, bottom: 2_540 });
        const tagOutsideTheView = layerElement.querySelector(".username-display");
        culling.update({ x: 0, y: 0, right: 960, bottom: 540 });

        expect(tagOutsideTheView).toBeNull();
        expect(nameOf(layerElement).style.display).toBe("");
    });
});
