/**
 * A remote avatar nobody draws (out of the camera view, or a dot) does no work: no animation play, no arcade body, no
 * per-frame listener, no companion step, and a dot holds no sprites.
 *
 * On by default since the 2026-11-22 run (Chrome, Apple M1 Max, WebGL2, 999 walking synthetic players), which measured
 * it together with the detail budget and the bake: no frame interval above 16.8 ms, where the flags off gave frames of
 * 33 ms. `localStorage["avatarZeroWork"] = "0"` turns it off, "1" turns it on if this constant is ever false. A storage
 * that cannot be read leaves the constant in charge. Independent of `avatarDetailBudget` and `avatarBake`.
 */
export const AVATAR_ZERO_WORK_ENABLED = true;
export const AVATAR_ZERO_WORK_STORAGE_KEY = "avatarZeroWork";

let warnedBlockedStorage = false;

/** Lets a test see the blocked-storage warning again: it is said once per page load. */
export function resetAvatarZeroWorkStorageWarningForTests(): void {
    warnedBlockedStorage = false;
}

/** Whether the zero-work states are on: the constant, unless this browser's storage says "0" (off) or "1" (on). */
export function isAvatarZeroWorkEnabled(storage: Pick<Storage, "getItem"> | undefined = globalStorage()): boolean {
    try {
        const value = storage?.getItem(AVATAR_ZERO_WORK_STORAGE_KEY);
        if (value === "1") return true;
        if (value === "0") return false;
    } catch (error) {
        // Every remote player reads the flag: one warning is enough for a crowd of a thousand.
        if (!warnedBlockedStorage) {
            warnedBlockedStorage = true;
            console.warn("The storage is blocked, so the avatar zero-work flag keeps its default", error);
        }
    }
    return AVATAR_ZERO_WORK_ENABLED;
}

function globalStorage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}
