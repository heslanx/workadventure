/** How many tones an avatar takes its fill from. The component maps each index to a colour. */
export const AVATAR_TONE_COUNT = 6;

/** The first one or two words of a name, one character each, in capitals; `?` for a name with no letters. */
export function initialsOf(name: string): string {
    const initials = name
        .split(/\s+/)
        .filter((word) => word !== "")
        .slice(0, 2)
        // `Array.from` walks code points, so a name that starts with an emoji is not cut in the middle of it.
        .map((word) => Array.from(word)[0])
        .join("")
        .toUpperCase();
    return initials === "" ? "?" : initials;
}

/**
 * The tone of a name, the same for everyone who sees it and the same as the reference theme's, so a person keeps the
 * colour they had. The hash is the reference's: 31 * sum + the first UTF-16 unit of each code point, from 7.
 */
export function toneOf(name: string): number {
    let hash = 7;
    for (const character of name) {
        hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
    }
    return hash % AVATAR_TONE_COUNT;
}
