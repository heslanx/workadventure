/**
 * Pure geometry of the game canvas and the co-website panel.
 *
 * Nothing here reads the window or a store: the caller measures the area and passes it in, so the same
 * maths serves the whole window and any smaller area the game is drawn in.
 */

export interface ViewportSize {
    width: number;
    height: number;
}

export interface ViewportBounds extends ViewportSize {
    left: number;
    top: number;
}

/**
 * Width of the co-website resize bar, in pixels. The panel can never be dragged narrower than the bar.
 */
const RESIZE_BAR_SIZE = 8;

/**
 * Share of the area taken by the co-website panel when the resize bar is dragged to `pointer`.
 *
 * The panel sits at the right of the area, at its left in right-to-left mode, and at its top in portrait mode.
 * The result is clamped so that the panel is never thinner than the resize bar and never larger than the area.
 */
export function coWebsiteRatioAtPointer(
    bounds: ViewportBounds,
    pointer: { x: number; y: number },
    vertical: boolean,
    rtl: boolean,
): number {
    const extent = vertical ? bounds.height : bounds.width;
    const position = vertical ? pointer.y - bounds.top : pointer.x - bounds.left;
    const websiteSize = vertical || rtl ? position : extent - position;
    return Math.min(extent, Math.max(Math.min(RESIZE_BAR_SIZE, extent), websiteSize)) / extent;
}

/**
 * Splits `available` between the game canvas and the co-website panel.
 *
 * With no co-website the game owns the whole area. A fullscreen co-website hides the game but keeps the
 * panel at its ratio, so leaving fullscreen restores the same split.
 */
export function splitGameViewport(
    available: ViewportSize,
    website: { visible: boolean; fullscreen: boolean; ratio: number; vertical: boolean },
): { game: ViewportSize; website: ViewportSize } {
    if (!website.visible) {
        return { game: available, website: { width: 0, height: 0 } };
    }
    if (website.vertical) {
        return {
            game: website.fullscreen
                ? { width: 0, height: 0 }
                : { width: available.width, height: available.height * (1 - website.ratio) },
            website: { width: available.width, height: available.height * website.ratio },
        };
    }
    return {
        game: website.fullscreen
            ? { width: 0, height: 0 }
            : { width: available.width * (1 - website.ratio), height: available.height },
        website: { width: available.width * website.ratio, height: available.height },
    };
}
