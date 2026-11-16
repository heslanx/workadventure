import type { BlurParams, FadeParams, FlyParams, ScaleParams, SlideParams, TransitionConfig } from "svelte/transition";
import * as svelteTransition from "svelte/transition";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the user asked the system to reduce motion. Read it when an animation starts, so a change of the
 * system setting applies to the next animation without a reload.
 */
export function isReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
    }
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Duration to use for a JS-driven animation: the requested one, or 0 when the user reduces motion. */
export function motionDuration(durationMs: number): number {
    return isReducedMotion() ? 0 : durationMs;
}

type TransitionFunction<Params> = (node: Element, params?: Params) => TransitionConfig;

function respectReducedMotion<Params>(transition: TransitionFunction<Params>): TransitionFunction<Params> {
    return (node, params) => {
        const config = transition(node, params);
        // Svelte skips the animation and applies the end state at once when the duration is 0.
        return isReducedMotion() ? { ...config, delay: 0, duration: 0 } : config;
    };
}

// Drop-in replacements for the svelte/transition functions of the same name. Svelte runs JS transitions with
// inline styles, which the global CSS reduced-motion rule cannot cancel, so they are made instant here instead.
export const blur = respectReducedMotion<BlurParams>(svelteTransition.blur);
export const fade = respectReducedMotion<FadeParams>(svelteTransition.fade);
export const fly = respectReducedMotion<FlyParams>(svelteTransition.fly);
export const scale = respectReducedMotion<ScaleParams>(svelteTransition.scale);
export const slide = respectReducedMotion<SlideParams>(svelteTransition.slide);
