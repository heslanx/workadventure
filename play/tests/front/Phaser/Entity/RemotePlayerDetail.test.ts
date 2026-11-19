// @vitest-environment jsdom
import * as Phaser from "phaser";
import type * as PhaserModule from "phaser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { CancelablePromise } from "cancelable-promise";
import type { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import { RemotePlayer } from "../../../../src/front/Phaser/Entity/RemotePlayer";

// The name is a DOM element: it does not run in a unit test.
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

// A sprite that records the animations it is told to play: a real one needs the animation manager of a running game.
vi.mock("phaser", async (importOriginal) => {
    const actual = await importOriginal<typeof PhaserModule>();
    class FakeSprite extends actual.GameObjects.Image {
        public readonly played: string[] = [];
        public readonly anims = {
            currentAnim: undefined,
            play: (key: string) => {
                this.played.push(key);
            },
        };
        public play(key: string) {
            this.played.push(key);
            return this;
        }
    }
    return { ...actual, GameObjects: { ...actual.GameObjects, Sprite: FakeSprite } };
});

const TEXTURES = ["color_1", "eyes_1"];
// Longer than the 128 ms between two steps of a companion.
const STEP_MS = 200;

function createScene(): GameScene {
    const events = new Phaser.Events.EventEmitter();
    const frame = { realWidth: 32, realHeight: 32, width: 32, height: 32, customPivot: false, pivotX: 0, pivotY: 0 };
    const world = {
        defaults: {},
        pendingDestroy: new Set(),
        enableBody: (object: Phaser.GameObjects.GameObject) => {
            object.body = new Phaser.Physics.Arcade.Body(world as unknown as Phaser.Physics.Arcade.World, object);
        },
    };
    return {
        sys: {
            events,
            queueDepthSort: () => {},
            textures: { get: () => ({ key: "t", get: () => frame }) },
            updateList: { add: () => {}, remove: () => {} },
            input: { enable: () => {}, disable: () => {} },
            game: { renderer: undefined },
            renderer: undefined,
        },
        events,
        textures: { exists: () => true },
        anims: { exists: () => true, create: () => {}, generateFrameNumbers: () => [] },
        add: { existing: () => {} },
        markDirty: vi.fn(),
        superLoad: {},
        physics: { world },
    } as unknown as GameScene;
}

function createPlayer(scene: GameScene, companionTexture?: CancelablePromise<string>): RemotePlayer {
    return new RemotePlayer(
        1,
        "uuid-1",
        scene,
        0,
        0,
        "player 1",
        CancelablePromise.resolve(TEXTURES),
        PositionMessage_Direction.DOWN,
        false,
        null,
        companionTexture,
    );
}

/** The sprite and companion creations that follow a texture load run in promise callbacks. */
async function flushPromises(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

function played(sprites: Map<string, Phaser.GameObjects.Sprite> | undefined): string[] {
    return Array.from(sprites?.values() ?? []).flatMap((sprite) => (sprite as unknown as { played: string[] }).played);
}

function clearPlayed(sprites: Map<string, Phaser.GameObjects.Sprite> | undefined): void {
    for (const sprite of sprites?.values() ?? []) {
        (sprite as unknown as { played: string[] }).played.length = 0;
    }
}

function walkTo(player: RemotePlayer, x: number, direction: PositionMessage_Direction): void {
    player.updatePosition({ x, y: 0, direction, moving: true });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("a remote player drawn as a dot", () => {
    it("plays no animation when it moves, and plays its last pose when it is drawn in full again", async () => {
        const player = createPlayer(createScene());
        await flushPromises();
        clearPlayed(player.sprites);

        player.setDetail("dot");
        walkTo(player, 10, PositionMessage_Direction.RIGHT);
        walkTo(player, 20, PositionMessage_Direction.UP);
        walkTo(player, 30, PositionMessage_Direction.LEFT);
        const playedAsDot = played(player.sprites);
        player.setDetail("full");

        expect(playedAsDot).toEqual([]);
        expect(played(player.sprites)).toEqual(["color_1-left-walk", "eyes_1-left-walk"]);
    });

    it("stops its companion, even one whose texture loads after the player became a dot, and starts it again next to the player when drawn in full", async () => {
        const scene = createScene();
        let loadCompanion: (texture: string) => void = () => {};
        const player = createPlayer(
            scene,
            new CancelablePromise<string>((resolve) => {
                loadCompanion = resolve;
            }),
        );
        await flushPromises();
        const companion = player.companion!;

        player.setDetail("dot");
        loadCompanion("cat1");
        await flushPromises();
        walkTo(player, 300, PositionMessage_Direction.LEFT);
        for (let i = 0; i < 3; i++) {
            scene.events.emit(Phaser.Scenes.Events.UPDATE, 0, STEP_MS);
        }
        const asDot = {
            spritesActive: Array.from(companion.sprites.values()).map((sprite) => sprite.active),
            played: played(companion.sprites),
            velocityX: (companion.body as Phaser.Physics.Arcade.Body).velocity.x,
            x: companion.x,
        };

        player.setDetail("full");
        const drawnAgain = { x: companion.x, played: played(companion.sprites) };
        // The player walks away: the companion follows it again.
        walkTo(player, 600, PositionMessage_Direction.RIGHT);
        scene.events.emit(Phaser.Scenes.Events.UPDATE, 0, STEP_MS);

        expect(asDot).toEqual({ spritesActive: [false], played: [], velocityX: 0, x: 14 });
        // Next to the player, as a companion starts, in the player's pose.
        expect(drawnAgain).toEqual({ x: 314, played: ["cat1-left-idle"] });
        expect(companion.sprites.get("cat1")?.active).toBe(true);
        expect((companion.body as Phaser.Physics.Arcade.Body).velocity.x).toBeGreaterThan(0);
        expect(played(companion.sprites)).toEqual(["cat1-left-idle", "cat1-right-walk"]);
    });
});
