import type { TransitionConfig } from "svelte/transition";
import { isReducedMotion } from "./reducedMotion";
import { SPRING_SURFACE, SPRING_SURFACE_MS, cubicBezier, springEasing } from "./spring";

/**
 * The transition of a surface that opens over the map and that an `{#if}` removes: write `transition:surface` on the
 * element directly under the `{#if}`, never `in:` and `out:` (a pair cannot be reversed half way) and never together
 * with `.k-enter` (the surface would arrive twice).
 *
 * It comes from where the surface comes from: the theme's per-surface `--k-enter-x`, `--k-enter-y` and
 * `--k-enter-scale` (libs/tailwind/style/konclui.css) are read from the element, so the place a surface arrives from
 * is declared once. It arrives on the surface spring and leaves on the sheet curve. Only opacity and transform move,
 * and opacity moves between 0 and the opacity the element has at rest.
 *
 * What it relies on in Svelte 5, and what the tests run:
 * - A bidirectional transition holds the element for the whole exit, with its content frozen, so a panel whose
 *   content an inner `{#if}` would remove does not slide away blank.
 * - Reopening half way keeps the same element and reverses from where it is (Svelte starts the new run at the
 *   current progress and scales its duration by the distance left). `surface` also keeps the picture continuous: the
 *   exit does not go as far as the entrance came, so the run that follows a half-played one starts from the pose the
 *   last one reached.
 * - A duration of 0 removes the element in the same flush, without an animation or an event. That is what a viewer
 *   who reduces motion gets, and what a browser without `Element.animate` gets (jsdom).
 * - The transition is local: it plays when its own block changes, not when a parent block appears, so nothing
 *   springs in at room entry while the loader fades.
 */

/** What the surface does not move: where it is when it is open. */
const REST: Pose = { x: 0, y: 0, scale: 1 };

/** Where a surface comes from when its element says nothing: 6 px below, 2 % small. The same defaults as `.k-enter`. */
export const SURFACE_ORIGIN_DEFAULT = { x: 0, y: 6, scale: 0.98 } as const;

/** The exit is 200 ms, `--k-dur-normal`, on the curve of `--k-ease-sheet`: both are tokens, and a test keeps them in step. */
export const SURFACE_EXIT_MS = 200;
export const SURFACE_SHEET_CURVE = [0.22, 1, 0.36, 1] as const;

/**
 * How far the exit goes, as a share of the entrance's travel. A surface that is dismissed has been seen: it needs the
 * direction cue that says where it goes (back to its origin), not the whole distance, and the 200 ms curve that starts
 * fast shows most of that distance in the first frames. Half keeps the cue visible on the 6 px of a menu and trims the
 * 24 px of the side panel to 12, so a closed surface clears the map sooner. Opacity does the leaving.
 */
export const SURFACE_EXIT_TRAVEL = 0.5;

const enterEasing = springEasing(SPRING_SURFACE, SPRING_SURFACE_MS);
const exitEasing = cubicBezier(...SURFACE_SHEET_CURVE);

interface Pose {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
}

export interface SurfaceParams {
    /** Pixels the surface comes from on the x axis, for a left-to-right page. Default: the element's `--k-enter-x`. */
    x?: number;
    /** Default: the element's `--k-enter-y`. */
    y?: number;
    /** How small it starts, 1 being its own size. Default: the element's `--k-enter-scale`. */
    scale?: number;
}

const mix = (from: number, to: number, share: number): number => from + (to - from) * share;

const mixPoses = (from: Pose, to: Pose, share: number): Pose => ({
    x: mix(from.x, to.x, share),
    y: mix(from.y, to.y, share),
    scale: mix(from.scale, to.scale, share),
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Four decimals: a tenth of a thousandth of a pixel is below what a screen can draw, and the text stays short. */
const round = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * A custom property that holds a plain number, with or without `px` (`-24px`, `0.98`). Anything else (a `calc()`, a
 * `rem`) is not read, and the fallback stands: the entrance variables are written in pixels.
 */
function numberOf(style: CSSStyleDeclaration, property: string, fallback: number): number {
    const match = /^(-?(?:\d+\.?\d*|\.\d+))(?:px)?$/.exec(style.getPropertyValue(property).trim());
    return match === null ? fallback : Number(match[1]);
}

/**
 * The transition. Svelte calls it when a run starts and then calls what it returns once per direction, so the
 * entrance and the exit differ while the one directive stays reversible.
 */
export function surface(
    node: Element,
    params: SurfaceParams = {},
): (options?: { direction: "in" | "out" }) => TransitionConfig {
    const style = (node.ownerDocument.defaultView ?? window).getComputedStyle(node);
    // The entrance variables are written for a page that reads left to right; a page that reads the other way has
    // its rail and its panel on the other side, so what comes from the left comes from the right.
    const side = style.direction === "rtl" ? -1 : 1;
    const origin: Pose = {
        x: (params.x ?? numberOf(style, "--k-enter-x", SURFACE_ORIGIN_DEFAULT.x)) * side,
        y: params.y ?? numberOf(style, "--k-enter-y", SURFACE_ORIGIN_DEFAULT.y),
        scale: params.scale ?? numberOf(style, "--k-enter-scale", SURFACE_ORIGIN_DEFAULT.scale),
    };
    const exitPose = mixPoses(REST, origin, SURFACE_EXIT_TRAVEL);
    const motionScale = Math.max(0, numberOf(style, "--k-motion-scale", 1));
    // A surface may rest below full opacity (a tool that cannot act now is drawn at half): the run ends at that
    // opacity, not at 1, or the surface would arrive brighter than it is and drop back when the run ends. Svelte asks
    // for a new transition only when no run is playing, so what is read here is the element's own opacity.
    const ownOpacity = Number.parseFloat(style.opacity);
    const restOpacity = Number.isFinite(ownOpacity) ? clamp01(ownOpacity) : 1;

    // The pose at progress `t` of the run that played last (1 is open, 0 is closed). It starts as the entrance's own
    // path: an entrance from nothing begins at the origin, an exit from rest begins at rest.
    let lastPose: (t: number) => Pose = (t) => mixPoses(origin, REST, t);

    return ({ direction } = { direction: "in" }) => {
        // `Element.animate` is the one thing Svelte's transition needs from the browser; a test environment without it
        // gets the end state at once, like a viewer who reduces motion. Both are read as the run starts.
        if (isReducedMotion() || typeof node.animate !== "function") return { duration: 0 };
        const entering = direction === "in";
        const duration = (entering ? SPRING_SURFACE_MS : SURFACE_EXIT_MS) * motionScale;
        if (duration === 0) return { duration: 0 };

        const end = entering ? 1 : 0;
        const destination = entering ? REST : exitPose;
        // Svelte samples `css` from the progress where this run starts (1 for an exit from rest, 0 for an entrance from
        // nothing, the point it was reversed at otherwise), so the first sample says where that is, and the pose the last
        // run had there is where this one starts. Without it a reversal would jump to the pose of the other path.
        const previous = lastPose;
        let start: { t: number; pose: Pose } | undefined;
        const pose = (t: number): Pose => {
            start ??= { t, pose: previous(t) };
            const distance = end - start.t;
            return mixPoses(start.pose, destination, distance === 0 ? 1 : (t - start.t) / distance);
        };
        lastPose = pose;

        return {
            duration,
            easing: entering ? enterEasing : exitEasing,
            // The spring may pass 1 and the surface may be sampled a rounding past either end: opacity stays in 0..1.
            css: (t) => {
                const { x, y, scale } = pose(t);
                return `opacity: ${round(clamp01(t) * restOpacity)}; transform: translate(${round(x)}px, ${round(y)}px) scale(${round(scale)})`;
            },
        };
    };
}
