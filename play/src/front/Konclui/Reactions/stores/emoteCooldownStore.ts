import { writable, type Readable } from "svelte/store";
import type { EmoteId } from "../domain/emoteCatalogue";
import { emoteCooldownLeft } from "../domain/emoteCooldown";

const coolingEmote = writable<EmoteId | undefined>(undefined);
let lastSentAt: number | undefined;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * The id of the emote sent during the cooldown that is running, or `undefined` when the next emote may go. The
 * controls read it to show that they wait, and which emote just left.
 */
export const coolingEmoteStore: Readable<EmoteId | undefined> = { subscribe: coolingEmote.subscribe };

/** How much of the cooldown is left now, in milliseconds. The decision to send reads this, not the store. */
export function emoteCooldownLeftNow(): number {
    return emoteCooldownLeft(lastSentAt, performance.now());
}

/** Starts the cooldown for the emote `id` that was just sent. A cooldown that is running starts again. */
export function startEmoteCooldown(id: EmoteId): void {
    lastSentAt = performance.now();
    coolingEmote.set(id);
    clearTimeout(releaseTimer);
    // The length of the cooldown, EMOTE_COOLDOWN_MS (a test keeps the two equal): the timer delay must be a literal.
    releaseTimer = setTimeout(() => coolingEmote.set(undefined), 2000);
}
