import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMOTE_COOLDOWN_MS } from "../domain/emoteCooldown";

describe("the emote cooldown", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function loadStore() {
        return await import("./emoteCooldownStore");
    }

    it("lets an emote go before any was sent", async () => {
        const { coolingEmoteStore, emoteCooldownLeftNow } = await loadStore();

        expect(get(coolingEmoteStore)).toBeUndefined();
        expect(emoteCooldownLeftNow()).toBe(0);
    });

    it("holds the emote that left for the whole cooldown, and frees the next one at its end", async () => {
        const { coolingEmoteStore, emoteCooldownLeftNow, startEmoteCooldown } = await loadStore();

        startEmoteCooldown("lv");

        expect(get(coolingEmoteStore)).toBe("lv");
        expect(emoteCooldownLeftNow()).toBe(EMOTE_COOLDOWN_MS);

        vi.advanceTimersByTime(EMOTE_COOLDOWN_MS - 1);
        expect(get(coolingEmoteStore)).toBe("lv");
        expect(emoteCooldownLeftNow()).toBe(1);

        vi.advanceTimersByTime(1);
        expect(get(coolingEmoteStore)).toBeUndefined();
        expect(emoteCooldownLeftNow()).toBe(0);
    });

    it("tells the controls the moment it starts and the moment it ends, and no other time", async () => {
        const { coolingEmoteStore, startEmoteCooldown } = await loadStore();
        const seen: Array<string | undefined> = [];
        const unsubscribe = coolingEmoteStore.subscribe((id) => seen.push(id));

        startEmoteCooldown("ok");
        vi.advanceTimersByTime(EMOTE_COOLDOWN_MS * 3);
        unsubscribe();

        expect(seen).toEqual([undefined, "ok", undefined]);
    });

    it("starts again from the last emote, so an earlier timer does not free it early", async () => {
        const { coolingEmoteStore, emoteCooldownLeftNow, startEmoteCooldown } = await loadStore();
        startEmoteCooldown("lv");
        vi.advanceTimersByTime(1500);

        startEmoteCooldown("ok");
        vi.advanceTimersByTime(1000);

        expect(get(coolingEmoteStore)).toBe("ok");
        expect(emoteCooldownLeftNow()).toBe(1000);

        vi.advanceTimersByTime(1000);
        expect(get(coolingEmoteStore)).toBeUndefined();
    });
});
