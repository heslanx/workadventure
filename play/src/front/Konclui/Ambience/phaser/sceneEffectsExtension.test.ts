import { afterEach, describe, expect, it, vi } from "vitest";
import type { SceneFrameContext } from "../../../ExternalModule/ClientExtensionPoints";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { parseFeatures, presetFeatures } from "../domain/effectSwitches";
import type { FeatureSwitches } from "../domain/effectSwitches";
import type { EffectsData } from "./effectsLoader";
import {
    createSceneEffectsExtension,
    type EffectsStart,
    type SceneEffectsHandle,
    type SceneEffectsPort,
} from "./sceneEffectsExtension";

class TestEffects implements SceneEffectsHandle {
    public frames: number[] = [];
    public features: FeatureSwitches[] = [];
    public destroyed = 0;

    constructor(public readonly start: EffectsStart) {}

    onFrame(time: number): void {
        this.frames.push(time);
    }

    setFeatures(features: FeatureSwitches): void {
        this.features.push(features);
    }

    destroy(): void {
        this.destroyed += 1;
    }
}

const fxData = { manifest: {}, images: {} } as unknown as EffectsData;

class TestPort implements SceneEffectsPort {
    public supported = true;
    public loads: ((data: EffectsData | undefined) => void)[] = [];
    public created: TestEffects[] = [];
    public watching = 0;
    public createError: Error | undefined;
    private changed: ((features: FeatureSwitches) => void) | undefined;

    supports(): boolean {
        return this.supported;
    }

    load(): Promise<EffectsData | undefined> {
        return new Promise((resolve) => {
            this.loads.push(resolve);
        });
    }

    create(_scene: GameScene, _data: EffectsData, start: EffectsStart): SceneEffectsHandle {
        if (this.createError) throw this.createError;
        const effects = new TestEffects(start);
        this.created.push(effects);
        return effects;
    }

    features(): FeatureSwitches {
        return parseFeatures(null);
    }

    watchFeatures(changed: (features: FeatureSwitches) => void): () => void {
        this.watching += 1;
        this.changed = changed;
        return () => {
            this.watching -= 1;
            this.changed = undefined;
        };
    }

    storeFeatures(features: FeatureSwitches): void {
        this.changed?.(features);
    }
}

function testScene(active = true): GameScene {
    return { sys: { isActive: () => active } } as unknown as GameScene;
}

function frame(scene: GameScene, time: number): SceneFrameContext {
    return {
        scene,
        time,
        delta: 16,
        baseUrl: "http://localhost:8090/~/konclui-office/office.wam",
        currentPlayer: undefined,
        remoteCharacters: new Map(),
        remotePlayers: new Map(),
        getPlayerVariable: () => undefined,
    };
}

/** Lets the load's continuation run: every microtask queued so far settles before a macrotask starts. */
function settle(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("scene effects extension", () => {
    it("creates nothing for a room whose map folder has no fx/manifest.json", async () => {
        const port = new TestPort();
        const extension = createSceneEffectsExtension(port);
        const scene = testScene();

        extension.onFrame?.(frame(scene, 100));
        port.loads[0](undefined);
        await settle();
        extension.onFrame?.(frame(scene, 116));

        expect(port.created).toEqual([]);
        expect(port.watching).toBe(0);
    });

    it("does not even look for fx/ in a scene that cannot show effects", () => {
        const port = new TestPort();
        port.supported = false;
        const extension = createSceneEffectsExtension(port);

        extension.onFrame?.(frame(testScene(), 100));

        expect(port.loads).toHaveLength(0);
    });

    it("loads the effects once per scene and steps them with the frame time", async () => {
        const port = new TestPort();
        const extension = createSceneEffectsExtension(port);
        const scene = testScene();

        extension.onFrame?.(frame(scene, 100));
        extension.onFrame?.(frame(scene, 116));
        port.loads[0](fxData);
        await settle();
        extension.onFrame?.(frame(scene, 132));
        extension.onFrame?.(frame(scene, 148));

        expect(port.loads).toHaveLength(1);
        expect(port.created).toHaveLength(1);
        expect(port.created[0].start).toEqual({
            generation: 1,
            features: parseFeatures(null),
            time: 116,
            reveal: true,
        });
        expect(port.created[0].frames).toEqual([132, 148]);
    });

    it("destroys what it created when the scene shuts down, and stops watching the switches", async () => {
        const port = new TestPort();
        const extension = createSceneEffectsExtension(port);
        const scene = testScene();
        extension.onFrame?.(frame(scene, 100));
        port.loads[0](fxData);
        await settle();

        extension.onShutdown?.(scene);

        expect(port.created[0].destroyed).toBe(1);
        expect(port.watching).toBe(0);
    });

    it("creates nothing when the scene shuts down while fx/ is still loading", async () => {
        const port = new TestPort();
        const extension = createSceneEffectsExtension(port);
        const scene = testScene();
        extension.onFrame?.(frame(scene, 100));

        extension.onShutdown?.(scene);
        port.loads[0](fxData);
        await settle();

        expect(port.created).toEqual([]);
    });

    it("replaces the effects of the previous scene and plays the arrival iris once per page", async () => {
        const port = new TestPort();
        const extension = createSceneEffectsExtension(port);
        const first = testScene();
        const second = testScene();
        extension.onFrame?.(frame(first, 100));
        port.loads[0](fxData);
        await settle();

        extension.onFrame?.(frame(second, 200));
        port.loads[1](fxData);
        await settle();

        expect(port.created[0].destroyed).toBe(1);
        expect(port.created[1].start.generation).toBe(2);
        expect(port.created[1].start.reveal).toBe(false);
        expect(port.watching).toBe(1);
    });

    it("applies switches changed in another tab", async () => {
        const port = new TestPort();
        const extension = createSceneEffectsExtension(port);
        extension.onFrame?.(frame(testScene(), 100));
        port.loads[0](fxData);
        await settle();

        port.storeFeatures(presetFeatures("lean"));

        expect(port.created[0].features).toEqual([presetFeatures("lean")]);
    });

    it("reports effects that fail to build and leaves the room without them", async () => {
        const port = new TestPort();
        port.createError = new Error("no WebGL");
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const extension = createSceneEffectsExtension(port);
        const scene = testScene();

        extension.onFrame?.(frame(scene, 100));
        port.loads[0](fxData);
        await settle();
        extension.onFrame?.(frame(scene, 116));

        expect(error).toHaveBeenCalledWith("[konclui] fx disabled:", port.createError);
        expect(port.watching).toBe(0);
    });
});
