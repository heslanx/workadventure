import { writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { LIVEKIT_PRELOAD_USER_COUNT, watchSpaceSizeForLivekitPreload } from "./LivekitPreload";

function usersOf(count: number): Map<string, unknown> {
    return new Map(Array.from({ length: count }, (_, index) => [`user-${index}`, {}]));
}

describe("watchSpaceSizeForLivekitPreload", () => {
    it("waits for the third user, and starts the fetch once however many more come", () => {
        const preload = vi.fn();
        const usersStore = writable(usersOf(1));
        const stop = watchSpaceSizeForLivekitPreload(usersStore, preload);

        usersStore.set(usersOf(LIVEKIT_PRELOAD_USER_COUNT - 1));
        expect(preload).not.toHaveBeenCalled();

        usersStore.set(usersOf(LIVEKIT_PRELOAD_USER_COUNT));
        usersStore.set(usersOf(LIVEKIT_PRELOAD_USER_COUNT + 2));
        usersStore.set(usersOf(1));
        usersStore.set(usersOf(LIVEKIT_PRELOAD_USER_COUNT));

        expect(LIVEKIT_PRELOAD_USER_COUNT).toBe(3);
        expect(preload).toHaveBeenCalledOnce();
        stop();
    });

    it("starts the fetch at once for a space that already holds three users", () => {
        const preload = vi.fn();

        const stop = watchSpaceSizeForLivekitPreload(writable(usersOf(3)), preload);

        expect(preload).toHaveBeenCalledOnce();
        stop();
    });

    it("stops watching when asked", () => {
        const preload = vi.fn();
        const usersStore = writable(usersOf(1));
        const stop = watchSpaceSizeForLivekitPreload(usersStore, preload);

        stop();
        usersStore.set(usersOf(5));

        expect(preload).not.toHaveBeenCalled();
    });
});
