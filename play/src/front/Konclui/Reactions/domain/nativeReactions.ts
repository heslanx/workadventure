/**
 * The six reactions of the reactions menu as it comes (keys 1 to 6), which the reference gives a name each. The key
 * of the table is the CLDR name WorkAdventure stores with the emoji (`Stores/EmoteStore.ts`, and the emoji picker
 * when the player picks another), not the emoji itself, so a reaction keeps its name whatever skin the picker adds.
 */
const nativeReactionIds = {
    "thumbs up": "like",
    "red heart": "love",
    "face with tears of joy": "haha",
    "clapping hands": "applause",
    "smiling face with heart-eyes": "adore",
    "folded hands": "thanks",
} as const;

export type NativeReactionId = (typeof nativeReactionIds)[keyof typeof nativeReactionIds];

/** The id of the named reaction an emoji name stands for, or `undefined` for a reaction the player chose. */
export function nativeReactionId(emojiName: string): NativeReactionId | undefined {
    return Object.hasOwn(nativeReactionIds, emojiName)
        ? nativeReactionIds[emojiName as keyof typeof nativeReactionIds]
        : undefined;
}
