import { writable, type Readable } from "svelte/store";
import { isSamePresence, type PresenceReading } from "../domain/presence";

// What the scene reads of the current player's surroundings, kept for the interface. The scene extension
// (`phaser/presenceExtension.ts`) reads the Phaser characters and calls `publishPresence`; it does not write the store
// itself, so the layer that sees Phaser never owns Konclui state (`integration.ts` hands it this function).

const reading = writable<PresenceReading | undefined>(undefined);
let current: PresenceReading | undefined;

/** The latest reading; `undefined` until the scene has read once, and again as the scene shuts down. */
export const presenceStore: Readable<PresenceReading | undefined> = { subscribe: reading.subscribe };

/**
 * Publishes a reading. A reading equal to the last one is dropped, so a subscriber hears about a change and not about
 * each time the scene looked.
 */
export function publishPresence(next: PresenceReading | undefined): void {
    if (isSamePresence(current, next)) return;
    current = next;
    reading.set(next);
}
