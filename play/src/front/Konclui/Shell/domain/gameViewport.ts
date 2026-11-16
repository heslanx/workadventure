import type { ViewportBounds } from "../../../Stores/CoWebsiteLayout";

/**
 * What to do with a fresh measurement of the element the game is drawn in.
 *
 * `keep` leaves the published bounds as they are. A zero-size or unchanged rect is `keep`, never `undefined`:
 * `undefined` on the port means "the window", so publishing it for a transient 0x0 rect would flip the game and
 * co-website split to the window for a frame.
 */
export type ViewportMeasurement =
    | { readonly kind: "publish"; readonly bounds: ViewportBounds }
    | { readonly kind: "keep" };

export function toGameViewport(rect: ViewportBounds, previous: ViewportBounds | undefined): ViewportMeasurement {
    if (rect.width <= 0 || rect.height <= 0) return { kind: "keep" };
    if (
        previous !== undefined &&
        previous.width === rect.width &&
        previous.height === rect.height &&
        previous.left === rect.left &&
        previous.top === rect.top
    ) {
        return { kind: "keep" };
    }
    return { kind: "publish", bounds: { width: rect.width, height: rect.height, left: rect.left, top: rect.top } };
}
