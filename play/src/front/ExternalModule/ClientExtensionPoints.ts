import { writable } from "svelte/store";
import type { ViewportBounds } from "../Stores/CoWebsiteLayout";

/**
 * Where an extension of the client hooks into it.
 *
 * Upstream code reads these ports and never imports an extension. With nothing registered, every port behaves
 * as if it did not exist.
 */

/**
 * The area of the page the game is drawn in, in window coordinates, when an extension draws the game in
 * something smaller than the window.
 *
 * `undefined` means the window: consumers fall back to the window size. When set, the bounds are the area left
 * for the game once the extension has laid out whatever it hosts around it (its chat panel, for one), so
 * consumers measure the game and the co-website divider from these bounds and do not take those panels off
 * again.
 */
export const gameViewportBounds = writable<ViewportBounds | undefined>(undefined);
