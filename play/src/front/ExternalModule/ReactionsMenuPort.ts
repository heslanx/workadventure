import type { Component } from "svelte";
import { writable, type Readable } from "svelte/store";

/**
 * Where an extension adds to the reactions menu (`Components/ActionBar/EmojiSubMenu.svelte`).
 *
 * It is a port like those of `ClientExtensionPoints.ts` and is read the same way: upstream reads it and never imports
 * an extension, and with nothing registered the menu is the one it has always been. It sits in a file of its own
 * while `ClientExtensionPoints.ts` is being changed by other work; that file can re-export it.
 */
export interface ReactionsMenuExtension {
    /** Drawn inside the menu, under the favourite reactions and above the speech bubbles. It takes no props. */
    readonly section: Component;
    /**
     * The name of the favourite reaction `emojiName` on key `key`, which the menu sets as the tooltip and as the
     * accessible name of its button. `undefined` leaves the button as it is: the emoji names itself.
     */
    describeReaction(emojiName: string, key: number): string | undefined;
}

const registered = writable<ReactionsMenuExtension | undefined>(undefined);

/** Registers the extension of the reactions menu. A later registration replaces the earlier one. */
export function registerReactionsMenu(extension: ReactionsMenuExtension): void {
    registered.set(extension);
}

/** The registered extension, or `undefined` while nothing is registered, which leaves the menu unchanged. */
export const reactionsMenuExtension: Readable<ReactionsMenuExtension | undefined> = { subscribe: registered.subscribe };
