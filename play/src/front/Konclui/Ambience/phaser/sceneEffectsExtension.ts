import { asError } from "catch-unknown";
import type { SceneExtension } from "../../../ExternalModule/ClientExtensionPoints";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import type { FeatureSwitches } from "../../Preferences/domain/effectSwitches";
import type { EffectsData } from "./effectsLoader";

/** The effects of one scene, as the extension drives them. */
export interface SceneEffectsHandle {
    onFrame(time: number): void;
    setFeatures(features: FeatureSwitches): void;
    destroy(): void;
}

/** How the effects of a scene start: the attach's generation, the switches, the frame time, the arrival iris. */
export interface EffectsStart {
    readonly generation: number;
    readonly features: FeatureSwitches;
    readonly time: number;
    readonly reveal: boolean;
}

/** What the extension needs from the page: the browser's in production, a fake in tests. */
export interface SceneEffectsPort {
    /** Whether the scene can show effects at all: the effects are not switched off, it draws with WebGL, and so on. */
    supports(scene: GameScene): boolean;
    /** The map folder's fx/, or undefined for a room without effects. */
    load(scene: GameScene): Promise<EffectsData | undefined>;
    create(scene: GameScene, data: EffectsData, start: EffectsStart): SceneEffectsHandle;
    /** The stored effect switches. */
    features(): FeatureSwitches;
    /** Calls `changed` when the stored switches change; returns the function that stops watching. */
    watchFeatures(changed: (features: FeatureSwitches) => void): () => void;
}

interface Attachment {
    readonly scene: GameScene;
    time: number;
    effects?: SceneEffectsHandle;
    stopWatching?: () => void;
}

/**
 * Shows the office's effects in a scene whose map folder has fx/manifest.json: it loads them once per scene on the
 * first frame, steps them with the frame time and destroys them when the scene shuts down. A room without fx/ gets
 * nothing.
 */
export function createSceneEffectsExtension(port: SceneEffectsPort): SceneExtension {
    let generation = 0;
    let revealed = false;
    let current: Attachment | undefined;

    const detach = (): void => {
        const attachment = current;
        current = undefined;
        attachment?.stopWatching?.();
        attachment?.effects?.destroy();
    };

    const attach = (scene: GameScene, time: number): void => {
        detach();
        const attachment: Attachment = { scene, time };
        current = attachment;
        if (!port.supports(scene)) return;
        const gen = ++generation;
        port.load(scene)
            .then((data) => {
                if (data === undefined || current !== attachment || !scene.sys.isActive()) return;
                const effects = port.create(scene, data, {
                    generation: gen,
                    features: port.features(),
                    time: attachment.time,
                    reveal: !revealed,
                });
                revealed = true;
                attachment.effects = effects;
                attachment.stopWatching = port.watchFeatures((features) => effects.setFeatures(features));
            })
            .catch((error: unknown) => {
                console.error("[konclui] fx disabled:", asError(error));
            });
    };

    return {
        id: "konclui.sceneEffects",
        onFrame(context) {
            if (current?.scene !== context.scene) attach(context.scene, context.time);
            if (current === undefined) return;
            current.time = context.time;
            current.effects?.onFrame(context.time);
        },
        onShutdown(scene) {
            if (current?.scene === scene) detach();
        },
    };
}
