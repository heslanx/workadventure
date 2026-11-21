/**
 * The least time between two emotes of one player, from the start of one to the start of the next. An emote takes
 * about 1.7 s on screen (it rises, pulses and floats away), so a player who sends one every two seconds always has
 * the last one still in view, and a player who holds a key cannot fill the room with them.
 */
export const EMOTE_COOLDOWN_MS = 2000;

/**
 * How much of the cooldown is left at `now`, in milliseconds: 0 when nothing was sent or the time has passed.
 * `lastSentAt` and `now` come from one clock. A clock that moved back cannot make the wait longer than the cooldown.
 */
export function emoteCooldownLeft(lastSentAt: number | undefined, now: number): number {
    if (lastSentAt === undefined) return 0;
    return Math.min(EMOTE_COOLDOWN_MS, Math.max(0, lastSentAt + EMOTE_COOLDOWN_MS - now));
}
