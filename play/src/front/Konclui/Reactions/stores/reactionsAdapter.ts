import { get } from "svelte/store";
import type { CustomEmoteProvider } from "../../../Phaser/Entity/CustomEmotes";
import { LL } from "../../../../i18n/i18n-svelte";
import { resolveEmoteWire } from "../domain/emoteWire";
import { nativeReactionId } from "../domain/nativeReactions";

/**
 * What the game engine asks of the emotes of the office: whether an emote message is one of them, with its art and
 * the name of the picture drawn over a character. The engine registers it (`registerCustomEmoteProvider`); it reads
 * the language when a picture is made, so a picture made after the language changed has the new words.
 */
export const customEmoteProvider: CustomEmoteProvider = {
    resolve(emote) {
        const found = resolveEmoteWire(emote);
        if (found === undefined) return undefined;
        return {
            id: found.id,
            src: found.art,
            accessibleName: (playerName) => {
                const text = get(LL).konclui.reactions;
                return text.reacted({ player: playerName, emote: text.emote[found.id]() });
            },
        };
    },
};

/**
 * The name the reactions menu gives a favourite reaction, with its key, as the reference does ("Love · key 2"), or
 * `undefined` for a reaction the player chose, which the emoji names itself.
 */
export function describeNativeReaction(emojiName: string, key: number): string | undefined {
    const id = nativeReactionId(emojiName);
    if (id === undefined) return undefined;
    const text = get(LL).konclui.reactions;
    return text.keyed({ name: text.native[id](), key });
}
