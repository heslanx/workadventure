// @vitest-environment jsdom
import * as Phaser from "phaser";
import type * as PhaserModule from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { CancelablePromise } from "cancelable-promise";
import type { GameScene } from "../../../../src/front/Phaser/Game/GameScene";
import { RemotePlayer } from "../../../../src/front/Phaser/Entity/RemotePlayer";
import { AvatarBuildQueue } from "../../../../src/front/Phaser/Entity/AvatarBuildQueue";
import { RemotePlayerCulling } from "../../../../src/front/Phaser/Game/RemotePlayerCulling";
import { registerCustomEmoteProvider, type CustomEmote } from "../../../../src/front/Phaser/Entity/CustomEmotes";

const { domElements } = vi.hoisted(() => ({
    // Every DOM element the characters made, in order: a real one needs the DOM container of a running game.
    domElements: [] as Array<{ node: HTMLElement; destroyed: boolean }>,
}));

// The name is a DOM element and the companion reads its texture back from the GPU: neither runs in a unit test, and
// this test builds no avatar.
vi.mock("../../../../src/front/Phaser/Components/UsernameDisplay", () => ({
    UsernameDisplay: class {
        setAvailabilityStatus() {}
        setRaisedHand() {}
        setPlayerDepth() {}
        setPlayerNameOutlineColor() {}
        setPosition() {}
        destroy() {}
    },
}));
vi.mock("../../../../src/front/Phaser/Companion/Companion", () => ({
    Companion: class {
        setTarget() {}
        destroy() {}
    },
}));

// A DOM element object that records its content and its destruction. It is a game object, so the character can hold it
// in its list as it holds the real one.
vi.mock("phaser", async (importOriginal) => {
    const actual = await importOriginal<typeof PhaserModule>();
    class FakeDomElement extends actual.GameObjects.Image {
        public readonly node: HTMLElement;
        public destroyed = false;
        constructor(scene: Phaser.Scene, x: number, y: number, node: HTMLElement) {
            super(scene, x, y, "t");
            this.node = node;
            domElements.push(this);
        }
        public destroy(fromScene?: boolean): void {
            this.destroyed = true;
            super.destroy(fromScene);
        }
    }
    return { ...actual, GameObjects: { ...actual.GameObjects, DOMElement: FakeDomElement } };
});

interface FakeTween {
    config: { targets: unknown; props: Record<string, unknown>; onComplete?: () => void };
    remove: ReturnType<typeof vi.fn>;
}

const decoding = vi.hoisted(() => ({
    started: 0,
    waiting: [] as Array<{ onload?: () => void; onerror?: () => void }>,
}));

/** Stands for the browser's image: it decodes when the test says so, and counts how many were asked for. */
class FakeImage {
    public onload?: () => void;
    public onerror?: () => void;
    set src(_value: string) {
        decoding.started++;
        decoding.waiting.push(this);
    }
}

function finishDecoding(): void {
    for (const image of decoding.waiting.splice(0)) image.onload?.();
}

function failDecoding(): void {
    for (const image of decoding.waiting.splice(0)) image.onerror?.();
}

async function flushPromises(): Promise<void> {
    for (let turn = 0; turn < 12; turn++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

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
    const tweens: FakeTween[] = [];
    const textureKeys = new Set<string>();
    const textures = {
        // Every texture of the avatars is there; only the emotes' textures come and go.
        exists: (key: string) => !key.startsWith("custom-emote-") || textureKeys.has(key),
        addImage: vi.fn((key: string) => {
            textureKeys.add(key);
        }),
    };
    const scene = {
        sys,
        events,
        textures,
        anims: { exists: () => true },
        add: { existing: () => {} },
        tweens: {
            add: vi.fn((config: FakeTween["config"]) => {
                const tween: FakeTween = { config, remove: vi.fn() };
                tweens.push(tween);
                return tween;
            }),
        },
        markDirty: vi.fn(),
        superLoad: {},
    };
    const world = {
        defaults: {},
        pendingDestroy: new Set(),
        enableBody: (object: Phaser.GameObjects.GameObject) => {
            object.body = new Phaser.Physics.Arcade.Body(world as unknown as Phaser.Physics.Arcade.World, object);
        },
    };
    Object.assign(scene, { physics: { world } });
    return { scene: scene as unknown as GameScene, tweens, textures };
}

function createPlayer(scene: GameScene, userId: number): RemotePlayer {
    // A queue nobody drains: the player exists and can play emotes, and builds no avatar.
    return new RemotePlayer(
        userId,
        `uuid-${userId}`,
        scene,
        0,
        0,
        `player ${userId}`,
        CancelablePromise.resolve(["color_1"]),
        PositionMessage_Direction.DOWN,
        false,
        null,
        undefined,
        undefined,
        undefined,
        undefined,
        new AvatarBuildQueue(),
    );
}

const ART = "data:image/png;base64,iVBORw0KGgo=";

/** A provider that knows the message "custom:<id>" as the emote <id>. */
function provider(): ReturnType<typeof registerCustomEmoteProvider> {
    return registerCustomEmoteProvider({
        resolve(message): CustomEmote | undefined {
            if (!message.startsWith("custom:")) return undefined;
            const id = message.slice("custom:".length);
            return { id, src: ART, accessibleName: (playerName) => `${playerName} reacted: ${id}` };
        },
    });
}

const drawn = () => domElements.filter((element) => !element.destroyed);

/** The camera view where the players of these tests are (they stand at 0, 0), and one that is far from them. */
const VIEW_OF_THE_PLAYERS = { x: -100, y: -100, right: 100, bottom: 100 };
const VIEW_AWAY_FROM_THE_PLAYERS = { x: 5000, y: 5000, right: 5100, bottom: 5100 };

/** Culls the player the way the scene does: the culling hides its container, then tells it. */
function cull(player: RemotePlayer): RemotePlayerCulling<RemotePlayer> {
    const culling = new RemotePlayerCulling<RemotePlayer>();
    culling.track(player);
    culling.update(VIEW_AWAY_FROM_THE_PLAYERS);
    return culling;
}

describe("Character.playEmote", () => {
    let unregister: (() => void) | undefined;

    beforeEach(() => {
        vi.stubGlobal("Image", FakeImage);
        domElements.length = 0;
        decoding.started = 0;
        decoding.waiting.length = 0;
    });

    afterEach(() => {
        unregister?.();
        unregister = undefined;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("with no custom emotes registered", () => {
        it("draws an emote as the text it is, as it always did", () => {
            const { scene } = createScene();
            const player = createPlayer(scene, 1);

            player.playEmote("👍");

            expect(drawn().map((element) => element.node.textContent)).toEqual(["👍"]);
            expect(decoding.started).toBe(0);
        });

        it("draws a message that looks like a custom emote as plain text too, which is what an upstream client shows", () => {
            const { scene } = createScene();
            const player = createPlayer(scene, 1);

            player.playEmote("custom:lv");

            expect(drawn().map((element) => element.node.textContent)).toEqual(["custom:lv"]);
        });
    });

    describe("with a provider of custom emotes", () => {
        beforeEach(() => {
            unregister = provider();
        });

        it("still draws an emoji as the text it is, and loads nothing for it", async () => {
            const { scene, textures } = createScene();
            const player = createPlayer(scene, 1);

            player.playEmote("🔥");
            await flushPromises();

            expect(drawn().map((element) => element.node.textContent)).toEqual(["🔥"]);
            expect(decoding.started).toBe(0);
            expect(textures.addImage).not.toHaveBeenCalled();
        });

        it("draws a custom emote as a picture named after the player who made it, once its art is decoded", async () => {
            const { scene } = createScene();
            const player = createPlayer(scene, 1);

            player.playEmote("custom:lv");
            await flushPromises();

            expect(drawn()).toHaveLength(0);

            finishDecoding();
            await flushPromises();

            expect(drawn()).toHaveLength(1);
            const picture = drawn()[0].node as HTMLImageElement;
            expect(picture).toBeInstanceOf(HTMLImageElement);
            expect(picture.alt).toBe("player 1 reacted: lv");
        });

        it("creates one texture for a hundred plays by two characters", async () => {
            const { scene, textures } = createScene();
            const first = createPlayer(scene, 1);
            const second = createPlayer(scene, 2);

            first.playEmote("custom:lv");
            second.playEmote("custom:lv");
            finishDecoding();
            await flushPromises();
            for (let play = 0; play < 98; play++) {
                (play % 2 === 0 ? first : second).playEmote("custom:lv");
                // eslint-disable-next-line no-await-in-loop -- one play after the other, as a room's emotes come
                await flushPromises();
            }

            expect(decoding.started).toBe(1);
            expect(textures.addImage).toHaveBeenCalledTimes(1);
            // Each play drew a picture, and a new one replaced the last: one is on screen for each character.
            expect(drawn()).toHaveLength(2);
        });

        it("draws only the emote that replaced another one while the art of the first was loading", async () => {
            const { scene } = createScene();
            const player = createPlayer(scene, 1);

            player.playEmote("custom:lv");
            player.playEmote("custom:ok");
            finishDecoding();
            await flushPromises();

            expect(drawn()).toHaveLength(1);
            expect((drawn()[0].node as HTMLImageElement).alt).toBe("player 1 reacted: ok");
        });

        it("draws only the emoji that replaced a custom emote while its art was loading", async () => {
            const { scene } = createScene();
            const player = createPlayer(scene, 1);

            player.playEmote("custom:lv");
            player.playEmote("👍");
            finishDecoding();
            await flushPromises();

            expect(drawn().map((element) => element.node.textContent)).toEqual(["👍"]);
        });

        it("removes the emote on screen and its tween when another emote replaces it", async () => {
            const { scene, tweens } = createScene();
            const player = createPlayer(scene, 1);
            player.playEmote("custom:lv");
            finishDecoding();
            await flushPromises();
            const first = drawn()[0];

            player.playEmote("👍");

            expect(first.destroyed).toBe(true);
            expect(tweens[0].remove).toHaveBeenCalledTimes(1);
            expect(drawn().map((element) => element.node.textContent)).toEqual(["👍"]);
        });

        it("draws nothing, and raises no error, when the character is destroyed before the art arrives", async () => {
            const { scene } = createScene();
            const player = createPlayer(scene, 1);
            player.playEmote("custom:lv");

            player.destroy();
            finishDecoding();
            await flushPromises();

            // An error raised when the art arrives is an unhandled rejection, which the runner reports as a failed run.
            expect(domElements).toHaveLength(0);
        });

        it("takes the emote and its running tween with it when the character is destroyed mid-emote", async () => {
            const { scene, tweens } = createScene();
            const player = createPlayer(scene, 1);
            player.playEmote("custom:lv");
            finishDecoding();
            await flushPromises();
            expect(drawn()).toHaveLength(1);

            player.destroy();

            expect(drawn()).toHaveLength(0);
            expect(tweens.at(-1)?.remove).toHaveBeenCalled();
        });

        it("draws the emoji text the message carries when the art cannot be decoded, and reports the failure", async () => {
            const report = vi.spyOn(console, "error").mockImplementation(() => {});
            const { scene, textures } = createScene();
            const player = createPlayer(scene, 1);

            player.playEmote("custom:lv");
            failDecoding();
            await flushPromises();

            expect(drawn().map((element) => element.node.textContent)).toEqual(["custom:lv"]);
            expect(textures.addImage).not.toHaveBeenCalled();
            expect(report).toHaveBeenCalledTimes(1);
        });

        it("makes a failed decode of a replaced emote report itself and draw nothing for it", async () => {
            const report = vi.spyOn(console, "error").mockImplementation(() => {});
            const { scene } = createScene();
            const player = createPlayer(scene, 1);

            player.playEmote("custom:lv");
            player.playEmote("🔥");
            failDecoding();
            await flushPromises();

            expect(drawn().map((element) => element.node.textContent)).toEqual(["🔥"]);
            expect(report).toHaveBeenCalledTimes(1);
        });
    });

    describe("on a remote player that is not drawn", () => {
        beforeEach(() => {
            unregister = provider();
        });

        // A culled player is out of the camera view, and a dot is drawn by the dot layer in its place: the renderer skips
        // the character in both, so an emote built for it is built for nobody.
        const notDrawn: Array<[string, (player: RemotePlayer) => void]> = [
            [
                "culled",
                (player) => {
                    cull(player);
                },
            ],
            ["drawn as a dot", (player) => player.setDetail("dot")],
        ];

        describe.each(notDrawn)("%s", (_state, hide) => {
            it.each(["custom:lv", "👍"])(
                "builds no picture, text, tween or texture for the emote %s",
                async (message) => {
                    const { scene, tweens, textures } = createScene();
                    const player = createPlayer(scene, 1);
                    hide(player);

                    player.playEmote(message);
                    finishDecoding();
                    await flushPromises();

                    expect(domElements).toHaveLength(0);
                    expect(tweens).toHaveLength(0);
                    expect(decoding.started).toBe(0);
                    expect(textures.addImage).not.toHaveBeenCalled();
                },
            );

            it("takes the emote on screen away, and shows no other, when it plays one", async () => {
                const { scene, tweens } = createScene();
                const player = createPlayer(scene, 1);
                player.playEmote("👍");
                const shown = drawn()[0];
                hide(player);

                player.playEmote("custom:lv");
                finishDecoding();
                await flushPromises();

                expect(shown.destroyed).toBe(true);
                expect(tweens[0].remove).toHaveBeenCalledTimes(1);
                expect(drawn()).toHaveLength(0);
            });
        });

        it("does not bring back an emote that was skipped, when the player is drawn again", async () => {
            const { scene } = createScene();
            const player = createPlayer(scene, 1);
            const culling = cull(player);

            player.playEmote("custom:lv");
            culling.update(VIEW_OF_THE_PLAYERS);
            finishDecoding();
            await flushPromises();

            expect(domElements).toHaveLength(0);
            expect(decoding.started).toBe(0);
        });

        it("draws the emotes of a player that is drawn again, so that a skipped one is a decision and not a fault", async () => {
            const { scene } = createScene();
            const player = createPlayer(scene, 1);
            const culling = cull(player);
            player.playEmote("👍");
            culling.update(VIEW_OF_THE_PLAYERS);

            player.playEmote("custom:lv");
            finishDecoding();
            await flushPromises();

            expect(drawn()).toHaveLength(1);
            expect((drawn()[0].node as HTMLImageElement).alt).toBe("player 1 reacted: lv");
        });

        it("draws nothing for an emote whose art arrives after the player left the camera view", async () => {
            const { scene } = createScene();
            const player = createPlayer(scene, 1);
            player.playEmote("custom:lv");
            expect(decoding.started).toBe(1);

            cull(player);
            finishDecoding();
            await flushPromises();

            expect(domElements).toHaveLength(0);
        });
    });

    describe("the motion of an emote", () => {
        beforeEach(() => {
            unregister = provider();
        });

        afterEach(() => {
            // jsdom has no matchMedia: removing the stub puts it back as it was.
            Reflect.deleteProperty(window, "matchMedia");
        });

        /** Plays the emote and runs its three tweens to the end, collecting what each one moves. */
        async function motionOf(message: string): Promise<string[][]> {
            const { scene, tweens } = createScene();
            createPlayer(scene, 1).playEmote(message);
            finishDecoding();
            await flushPromises();
            const moved: string[][] = [];
            for (let stage = 0; stage < 3; stage++) {
                moved.push(Object.keys(tweens[stage].config.props).sort());
                tweens[stage].config.onComplete?.();
            }
            return moved;
        }

        it("rises, pulses and floats away for a custom emote, as an emoji does", async () => {
            expect(await motionOf("custom:lv")).toEqual([
                ["alpha", "y"],
                ["scale", "y"],
                ["alpha", "y"],
            ]);
        });

        it("only fades in, holds and fades out for a custom emote when the user reduces motion", async () => {
            Object.defineProperty(window, "matchMedia", {
                configurable: true,
                value: () => ({ matches: true }),
            });

            expect(await motionOf("custom:lv")).toEqual([["alpha"], ["alpha"], ["alpha"]]);
        });
    });
});
