/**
 * Off by default: `localStorage["avatarZeroWork"] = "1"` turns on that a remote avatar nobody draws (out of the camera
 * view, or a dot) does no work: no animation play, no arcade body, no per-frame listener, no companion step, and a dot
 * holds no sprites. It ships behind a flag until a browser run measures it.
 */
export const AVATAR_ZERO_WORK_ENABLED = false;
export const AVATAR_ZERO_WORK_STORAGE_KEY = "avatarZeroWork";

/** Whether the zero-work states are on: the constant, unless this browser's storage says otherwise. */
export function isAvatarZeroWorkEnabled(storage: Pick<Storage, "getItem"> | undefined = globalStorage()): boolean {
    try {
        const value = storage?.getItem(AVATAR_ZERO_WORK_STORAGE_KEY);
        if (value === "1") return true;
        if (value === "0") return false;
    } catch (error) {
        console.warn("The storage is blocked, so the avatar zero-work flag keeps its default", error);
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
