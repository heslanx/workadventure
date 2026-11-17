import * as Phaser from "phaser";
import { asError } from "catch-unknown";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { FEATURES_KEY, parseFeatures } from "../domain/effectSwitches";
import { loadEffectsData } from "./effectsLoader";
import { SceneEffects, type EffectsEnvironment } from "./SceneEffects";
import type { SceneEffectsPort } from "./sceneEffectsExtension";
import { shadersCompile } from "./shaderCheck";

// Kept in localStorage: the switches turned off (FEATURES_KEY), and for QA every effect off ("1") or a fixed hour.
const EFFECTS_OFF_KEY = "konclui.fx.off";
const FIXED_HOUR_KEY = "konclui.fx.hour";

function readSetting(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch (error: unknown) {
        console.warn(`[konclui] effects: could not read ${key}; using the default:`, asError(error));
        return null;
    }
}

function browserEnvironment(): EffectsEnvironment {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    return {
        reducedMotion: () => reduced.matches,
        animationsOff: () => localUserStore.getDisableAnimations(),
        fixedHour: () => {
            const fixed = Number.parseFloat(readSetting(FIXED_HOUR_KEY) ?? "");
            return Number.isFinite(fixed) ? fixed : undefined;
        },
        // The desk focus mode is not in the native client yet: the vignette stays off.
        focused: () => false,
    };
}

/** The effects as the browser shows them: settings from localStorage, fx/ fetched beside the map, WebGL. */
export function createBrowserEffectsPort(): SceneEffectsPort {
    return {
        supports: (scene) =>
            readSetting(EFFECTS_OFF_KEY) !== "1" &&
            scene.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer &&
            Boolean(scene.mapUrlFile) &&
            shadersCompile(),
        load: (scene) => loadEffectsData(scene.mapUrlFile),
        create(scene, { manifest, images }, start) {
            const renderer = scene.renderer;
            if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
                throw new Error("[konclui] effects need the WebGL renderer");
            }
            return new SceneEffects({
                scene,
                renderer,
                manifest,
                images,
                environment: browserEnvironment(),
                ...start,
            });
        },
        features: () => parseFeatures(readSetting(FEATURES_KEY)),
        watchFeatures(changed) {
            // another tab of the office changed them
            const listener = (event: StorageEvent): void => {
                if (event.key === FEATURES_KEY) changed(parseFeatures(event.newValue));
            };
            window.addEventListener("storage", listener);
            return () => window.removeEventListener("storage", listener);
        },
    };
}
