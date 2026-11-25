import type { Placement } from "@floating-ui/dom";
import type { TransitionConfig } from "svelte/transition";
import { surface } from "./surfaceTransition";

/**
 * The motion of a popup in the shared floating host (`Components/Util/FloatingUiPopupList.svelte`).
 *
 * The host holds every popup that `showFloatingUi` registers: a menu or a picker the user opened, and a tooltip that
 * follows the pointer. The first kind arrives and leaves on the surface transition; a tooltip is gone as it closes and
 * must not spring in each time the pointer crosses a reaction, so the choice is a field of the registry entry that the
 * caller sets (`motion`), read by the one directive the host carries.
 */

/** What the host reads of a registry entry to pick the popup's motion. */
export interface PopupMotionEntry {
    readonly motion: boolean;
}

/**
 * `transition:popupSurface={entry}` on the popup's wrapper. A popup that asked for motion gets `surface`, with the
 * origin the theme declares (6 px below, 2 % small: a popup stands above its trigger, which rises it from the
 * trigger). A tooltip gets a transition of no duration: Svelte removes it in the same flush, with no animation and
 * nothing held, as if the directive were not there.
 */
export function popupSurface(node: Element, entry: PopupMotionEntry): ReturnType<typeof surface> | TransitionConfig {
    return entry.motion ? surface(node) : { duration: 0 };
}

// Where a popup grows from, for a left-to-right page: the side of it that faces its trigger, and for an aligned
// placement the corner on the aligned edge. A popup above its trigger (`top`) grows from its bottom edge.
const ORIGIN: Record<Placement, string> = {
    top: "bottom center",
    "top-start": "bottom left",
    "top-end": "bottom right",
    bottom: "top center",
    "bottom-start": "top left",
    "bottom-end": "top right",
    left: "center right",
    "left-start": "top right",
    "left-end": "bottom right",
    right: "center left",
    "right-start": "top left",
    "right-end": "bottom left",
};

/**
 * The `transform-origin` of a popup that Floating UI placed at `placement` (the one it settled on, after it flipped to
 * the side that has room). `start` and `end` of a popup above or below its trigger are the page's start and end, so
 * on a page that reads right to left they trade sides; left and right are always the screen's.
 */
export function popupTransformOrigin(placement: Placement, rtl = false): string {
    const origin = ORIGIN[placement];
    const alignedAcross = (placement.startsWith("top") || placement.startsWith("bottom")) && placement.includes("-");
    if (!rtl || !alignedAcross) return origin;
    return origin.replace(/left|right/, (side) => (side === "left" ? "right" : "left"));
}
