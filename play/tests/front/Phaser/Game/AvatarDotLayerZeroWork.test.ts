// @vitest-environment jsdom
import type * as PhaserModule from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { CancelablePromise } from "cancelable-promise";
import { RemotePlayer } from "../../../../src/front/Phaser/Entity/RemotePlayer";
import { AvatarBuildQueue } from "../../../../src/front/Phaser/Entity/AvatarBuildQueue";
import { AvatarDotLayer, type DotBob } from "../../../../src/front/Phaser/Game/AvatarDotLayer";
import { DETAIL_RECOMPUTE_INTERVAL_MS } from "../../../../src/front/Phaser/Game/AvatarDetail";
import { createAvatarScene } from "../Entity/avatarScene";

/**
 * The dot layer with the real RemotePlayer, with the zero-work flag on: a dot holds no sprites, and an avatar made full
 * again gets them back in a turn of the build queue, some frames later. Something must be drawn at every frame between.
 */

vi.mock("../../../../src/front/Phaser/Components/UsernameDisplay", () => ({
    UsernameDisplay: class {
        setAvailabilityStatus() {}
        setRaisedHand() {}
        setPlayerDepth() {}
        setPlayerNameOutlineColor() {}
        setPosition() {}
        setHidden() {}
        destroy() {}
    },
}));

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

const LAYERS = ["body_1", "eyes_2", "hair_3"];
const BUDGET = 3;
const PLAYERS = 8;

class Bob implements DotBob {
    public visible = true;
    public destroyed = false;
    constructor(
        public x: number,
        public y: number,
    ) {}
    setVisible(visible: boolean) {
        this.visible = visible;
    }
    destroy() {
        this.destroyed = true;
    }
}

async function flushPromises(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

async function createCrowd(buildsPerFrame: number) {
    const world = createAvatarScene();
    world.addLayers(...LAYERS);
    const queue = new AvatarBuildQueue(buildsPerFrame, Infinity);
    const players = Array.from(
        { length: PLAYERS },
        (_, index) =>
            new RemotePlayer(
                index + 1,
                `uuid-${index + 1}`,
                world.scene,
                (index + 1) * 10,
                0,
                `player ${index + 1}`,
                CancelablePromise.resolve(LAYERS),
                PositionMessage_Direction.DOWN,
                false,
                null,
                undefined,
                undefined,
                undefined,
                undefined,
                queue,
            ),
    );
    await flushPromises();
    while (queue.size > 0) queue.drain();
    const origin = { x: 1000, y: 0 };
    // The dots the layer made, one per avatar that became a dot.
    const created: Bob[] = [];
    const layer = new AvatarDotLayer<RemotePlayer>(
        {
            avatars: () => players,
            isCulled: (player) => player.isCulled(),
            pinned: () => [],
            origin: () => origin,
            pointer: () => undefined,
        },
        {
            create: (x, y) => {
                const bob = new Bob(x, y);
                created.push(bob);
                return bob;
            },
            destroy: () => {},
        },
        BUDGET,
    );
    return { queue, players, origin, layer, created };
}

beforeEach(() => {
    localStorage.setItem("avatarZeroWork", "1");
});

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe("AvatarDotLayer with RemotePlayer and the zero-work flag on", () => {
    it("draws every promoted avatar as a dot or with its sprites at every frame, as the queue gives the sprites back", async () => {
        const { queue, players, origin, layer, created } = await createCrowd(1);
        layer.update(0);
        // The avatars far from the player are dots, and hold no sprites.
        expect(players.map((player) => player.getDetail())).toEqual([
            "dot",
            "dot",
            "dot",
            "dot",
            "dot",
            "full",
            "full",
            "full",
        ]);
        expect(players.slice(0, 5).every((player) => player.sprites.size === 0)).toBe(true);

        // The player crosses the map: the first three are promoted at once, and the build queue builds one a frame.
        origin.x = 0;
        const undrawn: string[] = [];
        const check = (frame: number) => {
            for (const player of players) {
                // A dot stands where its avatar does: avatar n at x = 10 n.
                const dot = created.find((bob) => !bob.destroyed && bob.x === Math.round(player.x) - 8);
                const drawn = player.sprites.size > 0 || dot?.visible === true;
                if (!drawn) undrawn.push(`player ${player.userId} at frame ${frame}`);
            }
        };
        for (let frame = 0; frame <= 5; frame++) {
            queue.drain();
            layer.update(DETAIL_RECOMPUTE_INTERVAL_MS + 16 * frame);
            check(frame);
        }

        expect(undrawn).toEqual([]);
        expect(players.slice(0, BUDGET).map((player) => player.sprites.size)).toEqual([3, 3, 3]);
        expect(players.slice(0, BUDGET).map((player) => player.getDetail())).toEqual(["full", "full", "full"]);
        expect(layer.dotCount).toBe(PLAYERS - BUDGET);
        expect(created.filter((bob) => !bob.destroyed && bob.visible)).toHaveLength(PLAYERS - BUDGET);
    });

    it("keeps the dot of a promoted avatar until its sprites are back, even when the queue is a frame behind", async () => {
        const { queue, players, origin, layer } = await createCrowd(1);
        layer.update(0);
        origin.x = 0;

        layer.update(DETAIL_RECOMPUTE_INTERVAL_MS);

        // Right after the promotion, before any turn of the queue: no sprites yet, so the dots are still there.
        expect(players.slice(0, BUDGET).map((player) => player.sprites.size)).toEqual([0, 0, 0]);
        expect(layer.dotCount).toBe(PLAYERS);
        expect(queue.size).toBe(BUDGET);
    });
});
