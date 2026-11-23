import * as Phaser from "phaser";
import { asError } from "catch-unknown";
import { get } from "svelte/store";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { effectSwitchesStore } from "../../Preferences/stores/effectSwitchesStore";
import { parseShadingFlag } from "../domain/shadingLevel";
import { loadEffectsData } from "./effectsLoader";
import { SceneEffects, type EffectsEnvironment } from "./SceneEffects";
import type { SceneEffectsPort } from "./sceneEffectsExtension";
import { shadedPostCompiles, shadersCompile } from "./shaderCheck";

// Kept in localStorage, for QA: every effect off ("1"), a fixed hour, and the shading (konclui.fx.rim). The switches are
// the Preferences store's. The effects poll the hour (and the animation settings) every QA_POLL_MS, so a change shows
// within a second, with no reload: a bench goes from day to night 0.85 in one session by setting konclui.fx.hour.
// konclui.fx.rim is read once, when the page loads: unset or "0" nothing changes; "1" the cast shadows and the light on
// the props and people at the level the machine allows; "full" or "reduced" force a level; "legacy" is the old night-lit
// preview (the people's rim and the props' bevel at night). The normal map is fetched once, when the map loads, and only
// when the flag is not off then.
const EFFECTS_OFF_KEY = "konclui.fx.off";
const FIXED_HOUR_KEY = "konclui.fx.hour";
const NIGHT_LIT_KEY = "konclui.fx.rim";

function readSetting(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch (error: unknown) {
        console.warn(`[konclui] effects: could not read ${key}; using the default:`, asError(error));
        return null;
    }
}

/** The page as the effects read it: the hour and the preview from localStorage on each ask, never cached here. */
export function browserEnvironment(focused: () => boolean): EffectsEnvironment {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    return {
        reducedMotion: () => reduced.matches,
        animationsOff: () => localUserStore.getDisableAnimations(),
        fixedHour: () => {
            const fixed = Number.parseFloat(readSetting(FIXED_HOUR_KEY) ?? "");
            return Number.isFinite(fixed) ? fixed : undefined;
        },
        focused,
        nightLit: () => parseShadingFlag(readSetting(NIGHT_LIT_KEY)) === "legacy",
        shading: () => parseShadingFlag(readSetting(NIGHT_LIT_KEY)),
        shadedPostCompiles,
        gpu: gpuFacts,
    };
}

let gpu: { readonly renderer: string; readonly maxFragmentUniformVectors: number } | undefined;

/** The unmasked renderer string and the fragment uniform limit, read once from a scratch context. */
function gpuFacts(): { readonly renderer: string; readonly maxFragmentUniformVectors: number } {
    if (gpu) return gpu;
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return (gpu = { renderer: "", maxFragmentUniformVectors: 0 });
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    gpu = {
        renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "",
        maxFragmentUniformVectors: Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)),
    };
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return gpu;
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
        load: (scene) =>
            loadEffectsData(scene.mapUrlFile, { normal: parseShadingFlag(readSetting(NIGHT_LIT_KEY)) !== "off" }),
        create(scene, { manifest, images, normal }, start) {
            const renderer = scene.renderer;
            if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
                throw new Error("[konclui] effects need the WebGL renderer");
            }
            return new SceneEffects({
                scene,
                renderer,
                manifest,
                images,
                normal,
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
