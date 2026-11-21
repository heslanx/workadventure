import { get } from "svelte/store";
import { emoteMenuStore, emoteStore } from "../../../Stores/EmoteStore";
import { enableUserInputsStore } from "../../../Stores/UserInputStore";
import { findCatalogueEmote } from "../domain/emoteCatalogue";
import { encodeEmoteWire } from "../domain/emoteWire";
import { emoteCooldownLeftNow, startEmoteCooldown } from "./emoteCooldownStore";

/** What became of a request to send an emote: it left, or the reason it did not. */
export type SendEmoteResult = "sent" | "editing" | "blocked" | "cooling";

/**
 * Sends the emote `id` of the catalogue the way WorkAdventure sends any emote: it puts the emoji in the emote store,
 * where the scene plays it over the player and sends it to the room. The emoji is the wire value of the emote
 * (`emoteWire.ts`), so the message is the one the server already relays, and a client that does not know the emote
 * draws a speech balloon.
 *
 * The scene ignores an emote while the player's keys belong to something else, and the reactions can be edited in the
 * same menu: both are refused here, with their reason, so the caller never shows an emote that did not go. Another
 * emote within the cooldown is refused too. Nothing is sent for a refused request.
 */
export function sendCustomEmote(id: string): SendEmoteResult {
    const emote = findCatalogueEmote(id);
    if (emote === undefined) {
        throw new Error(`There is no emote "${id}" in the catalogue`);
    }
    if (get(emoteMenuStore)) return "editing";
    if (!get(enableUserInputsStore)) return "blocked";
    if (emoteCooldownLeftNow() > 0) return "cooling";
    emoteStore.set({ emoji: encodeEmoteWire(emote.id), name: emote.id });
    startEmoteCooldown(emote.id);
    return "sent";
}
