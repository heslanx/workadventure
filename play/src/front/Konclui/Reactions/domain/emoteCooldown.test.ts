import { describe, expect, it } from "vitest";
import { EMOTE_COOLDOWN_MS, emoteCooldownLeft } from "./emoteCooldown";

describe("emoteCooldownLeft", () => {
    it("lasts two seconds", () => {
        expect(EMOTE_COOLDOWN_MS).toBe(2000);
    });

    it.each([
        ["nothing was sent", undefined, 5000, 0],
        ["it was just sent", 1000, 1000, 2000],
        ["a quarter of it has passed", 1000, 1500, 1500],
        ["the last millisecond", 1000, 2999, 1],
        ["it ends exactly now", 1000, 3000, 0],
        ["it ended long ago", 1000, 90_000, 0],
        ["the clock moved back by a minute", 61_000, 1000, 2000],
    ])("when %s", (_case, lastSentAt, now, left) => {
        expect(emoteCooldownLeft(lastSentAt, now)).toBe(left);
    });
});
