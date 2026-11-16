import type { Component, Snippet } from "svelte";
import { derived, writable, type Readable } from "svelte/store";
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

/**
 * A component that wraps the whole app: it receives the app as `children` and decides what surrounds it.
 *
 * Every frame must give its children the full window (`100dvh` by `100dvw`), because the app below it is sized
 * relative to its parent and the page root has no height of its own.
 */
export type AppFrameComponent = Component<{ children: Snippet }>;

let appFrame: AppFrameComponent | undefined;

/**
 * Registers the frame that wraps the app. The app reads it once, when it first renders, so register before the
 * app is mounted. A later registration replaces the earlier one.
 */
export function registerAppFrame(frame: AppFrameComponent): void {
    appFrame = frame;
}

/** The registered frame, or `undefined` when the app is not framed. */
export function getAppFrame(): AppFrameComponent | undefined {
    return appFrame;
}

/** A component that takes the place of the default action bar while `active` is true. */
export interface ActionBarOverride {
    readonly component: Component;
    readonly active: Readable<boolean>;
}

const registeredActionBar = writable<ActionBarOverride | undefined>(undefined);

/** Registers the action bar override. A later registration replaces the earlier one. */
export function registerActionBar(override: ActionBarOverride): void {
    registeredActionBar.set(override);
}

/**
 * The component that replaces the default action bar right now: the registered override while its `active`
 * store is true, `undefined` otherwise, including when nothing is registered.
 *
 * It is flattened here, so a consumer subscribes to one store. A template cannot read the `active` store of a
 * registered override through `$`, because the override is a value held inside another store.
 */
export const activeActionBar: Readable<Component | undefined> = derived<
    typeof registeredActionBar,
    Component | undefined
>(
    registeredActionBar,
    (override, set) => {
        if (override === undefined) {
            set(undefined);
            return;
        }
        return override.active.subscribe((active) => set(active ? override.component : undefined));
    },
    undefined,
);
