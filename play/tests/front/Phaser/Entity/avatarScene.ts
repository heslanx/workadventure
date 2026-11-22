import * as Phaser from "phaser";
import type { GameScene } from "../../../../src/front/Phaser/Game/GameScene";

/** A layer sheet as the loader makes it: 96x128 cut into 12 frames of 32x32, plus the `__BASE` frame. */
export interface FakeLayerSheet {
    readonly frameTotal: number;
    getSourceImage(): { width: number; height: number; id: string };
}

class FakeTextures {
    public readonly layers = new Map<string, FakeLayerSheet>();
    /** The baked sheets that exist now. */
    public readonly baked = new Map<string, FakeLayerSheet & { canvas: unknown }>();
    public readonly removed: string[] = [];
    public readonly addedCanvases: unknown[] = [];

    exists = (key: string): boolean => this.layers.has(key) || this.baked.has(key);

    get = (key: string): FakeLayerSheet => {
        const texture = this.layers.get(key) ?? this.baked.get(key);
        if (!texture) throw new Error(`no texture ${key}`);
        return texture;
    };

    addSpriteSheet = (key: string, canvas: unknown): FakeLayerSheet | null => {
        if (this.exists(key)) return null;
        const sheet = { frameTotal: 13, getSourceImage: () => ({ width: 96, height: 128, id: key }), canvas };
        this.baked.set(key, sheet);
        this.addedCanvases.push(canvas);
        return sheet;
    };

    remove = (key: string): void => {
        this.baked.delete(key);
        this.removed.push(key);
    };
}

/**
 * A scene with what a Character and a RemotePlayer use, and probes on what they leave behind: the bodies in the arcade
 * world, the entries of the update list, the listeners of the scene, the animations created.
 */
export function createAvatarScene(options: { renderer?: boolean } = {}) {
    const events = new Phaser.Events.EventEmitter();
    const frame = {
        realWidth: 32,
        realHeight: 32,
        width: 32,
        height: 32,
        customPivot: false,
        pivotX: 0,
        pivotY: 0,
        setCropUVs: () => {},
    };
    const bodies = new Set<Phaser.Physics.Arcade.Body>();
    const updateList = new Set<unknown>();
    const anims = new Map<string, Record<string, unknown>>();
    const animsRemoved: string[] = [];
    const textures = new FakeTextures();
    const counts = { enableBody: 0, disableBody: 0 };
    // Arcade removes a destroyed body from the simulation at the end of the step; here it is at once.
    class PendingDestroy extends Set<Phaser.Physics.Arcade.Body> {
        add(body: Phaser.Physics.Arcade.Body): this {
            bodies.delete(body);
            return super.add(body);
        }
    }
    const world = {
        defaults: {},
        pendingDestroy: new PendingDestroy(),
        enableBody: (object: Phaser.GameObjects.GameObject) => {
            counts.enableBody++;
            if (!object.body) {
                object.body = new Phaser.Physics.Arcade.Body(world as unknown as Phaser.Physics.Arcade.World, object);
            }
            bodies.add(object.body as Phaser.Physics.Arcade.Body);
            (object.body as Phaser.Physics.Arcade.Body).enable = true;
        },
        disableBody: (body: Phaser.Physics.Arcade.Body) => {
            counts.disableBody++;
            bodies.delete(body);
            body.enable = false;
        },
    };
    const scene = {
        sys: {
            events,
            queueDepthSort: () => {},
            textures: { get: () => ({ key: "t", get: () => frame }) },
            updateList: { add: (o: unknown) => updateList.add(o), remove: (o: unknown) => updateList.delete(o) },
            input: { enable: () => {}, disable: () => {} },
            game: { renderer: undefined },
            renderer: undefined,
        },
        game: { renderer: options.renderer === false ? undefined : {} },
        events,
        textures,
        anims: {
            exists: (key: string) => anims.has(key),
            create: (config: { key: string }) => anims.set(config.key, config),
            remove: (key: string) => {
                anims.delete(key);
                animsRemoved.push(key);
            },
            generateFrameNumbers: (model: string, { frames }: { frames: number[] }) =>
                frames.map((frame) => ({ key: model, frame })),
        },
        add: { existing: () => {} },
        markDirty: () => {},
        superLoad: {},
        physics: { world },
    } as unknown as GameScene;
    return {
        scene,
        textures,
        events,
        bodies,
        updateList,
        anims,
        animsRemoved,
        counts,
        /** Registers layer sheets that a recipe can be made of. */
        addLayers(...ids: string[]): void {
            for (const id of ids) {
                textures.layers.set(id, {
                    frameTotal: 13,
                    getSourceImage: () => ({ width: 96, height: 128, id }),
                });
            }
        },
    };
}

export type AvatarScene = ReturnType<typeof createAvatarScene>;
