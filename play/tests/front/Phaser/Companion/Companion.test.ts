// @vitest-environment jsdom
import * as Phaser from "phaser";
import type * as PhaserModule from "phaser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelablePromise } from "cancelable-promise";
import { Companion } from "../../../../src/front/Phaser/Companion/Companion";
import { TexturesHelper } from "../../../../src/front/Phaser/Helpers/TexturesHelper";

// A sprite that needs no animation manager.
vi.mock("phaser", async (importOriginal) => {
    const actual = await importOriginal<typeof PhaserModule>();
    class FakeSprite extends actual.GameObjects.Image {
        public play() {
            return this;
        }
    }
    return { ...actual, GameObjects: { ...actual.GameObjects, Sprite: FakeSprite } };
});

const PICTURE = "data:image/png;base64,cat";

function createScene(): Phaser.Scene {
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
        },
        events,
        physics: { world },
        add: { existing: () => {} },
        anims: { exists: () => true, create: () => {}, generateFrameNumbers: () => [] },
    } as unknown as Phaser.Scene;
}

/** The promise callbacks that follow the load of the texture and the read of the picture. */
async function flushPromises(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop -- each turn lets the callbacks queued by the previous one run
        await Promise.resolve();
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("the picture of a companion", () => {
    it("is read back from the GPU when it is first looked at, once, and kept for the next time", async () => {
        const readBack = vi.spyOn(TexturesHelper, "getSnapshot").mockResolvedValue(PICTURE);
        const companion = new Companion(createScene(), 0, 0, CancelablePromise.resolve("cat1"));
        await flushPromises();
        const readBacksBeforeLookedAt = readBack.mock.calls.length;

        const firstLook: (string | undefined)[] = [];
        companion.pictureStore.subscribe((picture) => firstLook.push(picture))();
        await flushPromises();
        const secondLook: (string | undefined)[] = [];
        companion.pictureStore.subscribe((picture) => secondLook.push(picture))();
        await flushPromises();

        expect(readBacksBeforeLookedAt).toBe(0);
        expect(readBack).toHaveBeenCalledTimes(1);
        expect(firstLook).toEqual([undefined]);
        // The subscription of the first look ended at once, before the picture was read: it was kept for the second.
        expect(secondLook[secondLook.length - 1]).toBe(PICTURE);
    });

    it("reaches whoever looked at it before its texture was loaded", async () => {
        const readBack = vi.spyOn(TexturesHelper, "getSnapshot").mockResolvedValue(PICTURE);
        let loaded!: (texture: string) => void;
        const companion = new Companion(
            createScene(),
            0,
            0,
            new CancelablePromise<string>((resolve) => {
                loaded = resolve;
            }),
        );
        const seen: (string | undefined)[] = [];
        const unsubscribe = companion.pictureStore.subscribe((picture) => seen.push(picture));
        await flushPromises();
        const readBacksWhileLoading = readBack.mock.calls.length;

        loaded("cat1");
        await flushPromises();
        unsubscribe();

        expect(readBacksWhileLoading).toBe(0);
        expect(readBack).toHaveBeenCalledTimes(1);
        expect(seen).toEqual([undefined, PICTURE]);
    });

    it("stays empty, and reads nothing back, when the texture cannot be loaded", async () => {
        const readBack = vi.spyOn(TexturesHelper, "getSnapshot").mockResolvedValue(PICTURE);
        const companion = new Companion(createScene(), 0, 0, CancelablePromise.reject(new Error("no texture")));
        const seen: (string | undefined)[] = [];

        const unsubscribe = companion.pictureStore.subscribe((picture) => seen.push(picture));
        await flushPromises();
        unsubscribe();

        expect(seen).toEqual([undefined]);
        expect(readBack).not.toHaveBeenCalled();
    });
});
