import * as Phaser from "phaser";
import { asError } from "catch-unknown";
import { get } from "svelte/store";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { effectSwitchesStore } from "../../Preferences/stores/effectSwitchesStore";
import { loadEffectsData } from "./effectsLoader";
import { SceneEffects, type EffectsEnvironment } from "./SceneEffects";
import type { SceneEffectsPort } from "./sceneEffectsExtension";
import { shadersCompile } from "./shaderCheck";

// Kept in localStorage, for QA: every effect off ("1") or a fixed hour. The switches are the Preferences store's.
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

function browserEnvironment(focused: () => boolean): EffectsEnvironment {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    return {
        reducedMotion: () => reduced.matches,
        animationsOff: () => localUserStore.getDisableAnimations(),
        fixedHour: () => {
            const fixed = Number.parseFloat(readSetting(FIXED_HOUR_KEY) ?? "");
            return Number.isFinite(fixed) ? fixed : undefined;
        },
        focused,
    };
}

export interface BrowserEffectsOptions {
    /**
     * Whether the user is in focus right now, which darkens the map's edges (the vignette). The effects ask once a
     * second, and only act on it while the vignette switch is on. Defaults to never.
     */
    readonly focused?: () => boolean;
}

/** The effects as the browser shows them: switches from the Preferences store, fx/ fetched beside the map, WebGL. */
export function createBrowserEffectsPort({ focused = () => false }: BrowserEffectsOptions = {}): SceneEffectsPort {
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
                environment: browserEnvironment(focused),
                ...start,
            });
        },
        features: () => get(effectSwitchesStore),
        watchFeatures(changed) {
            // A store calls back once as it is subscribed, with the value the effects were just made with: the
            // extension passes setFeatures here, which would force a refresh, so only the changes after it count.
            let subscribed = false;
            const unsubscribe = effectSwitchesStore.subscribe((features) => {
                if (subscribed) changed(features);
            });
            subscribed = true;
            return unsubscribe;
        },
    };
}
