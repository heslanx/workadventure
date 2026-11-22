/**
 * The switches of the game loop and of the render settings. Each one is a localStorage key read once ("1" on, "0" off,
 * anything else keeps the default), with one default constant of its own. A storage that cannot be read leaves the
 * default in charge and never throws.
 *
 * - `gameStepCap`: the game steps at most 60 times per second on a screen that refreshes faster. On by default
 *   (decision of 2026-11-22), `localStorage["gameStepCap"] = "0"` turns it off.
 * - `gameRenderSkipCovered`: no render while the map is fully covered. Off until a real run measures it.
 * - `gameNoStencil`: no stencil buffer on the game's framebuffers, and no depth buffer on the context we create for
 *   `?phaserMode=webgl2`. Off until a real run measures it. Read before the game is created.
 */
export const GAME_STEP_CAP_ENABLED = true;
export const GAME_STEP_CAP_STORAGE_KEY = "gameStepCap";

export const GAME_RENDER_SKIP_COVERED_ENABLED = false;
export const GAME_RENDER_SKIP_COVERED_STORAGE_KEY = "gameRenderSkipCovered";

export const GAME_NO_STENCIL_ENABLED = false;
export const GAME_NO_STENCIL_STORAGE_KEY = "gameNoStencil";

const warnedKeys = new Set<string>();

/** Lets a test see the blocked-storage warning again: it is said once per key and page load. */
export function resetGameLoopFlagWarningsForTests(): void {
    warnedKeys.clear();
}

export function isGameStepCapEnabled(storage: Pick<Storage, "getItem"> | undefined = globalStorage()): boolean {
    return readFlag(GAME_STEP_CAP_STORAGE_KEY, GAME_STEP_CAP_ENABLED, storage);
}

export function isGameRenderSkipCoveredEnabled(
    storage: Pick<Storage, "getItem"> | undefined = globalStorage(),
): boolean {
    return readFlag(GAME_RENDER_SKIP_COVERED_STORAGE_KEY, GAME_RENDER_SKIP_COVERED_ENABLED, storage);
}

export function isGameNoStencilEnabled(storage: Pick<Storage, "getItem"> | undefined = globalStorage()): boolean {
    return readFlag(GAME_NO_STENCIL_STORAGE_KEY, GAME_NO_STENCIL_ENABLED, storage);
}

function readFlag(key: string, fallback: boolean, storage: Pick<Storage, "getItem"> | undefined): boolean {
    try {
        const value = storage?.getItem(key);
        if (value === "1") return true;
        if (value === "0") return false;
    } catch (error) {
        if (!warnedKeys.has(key)) {
            warnedKeys.add(key);
            console.warn(`The storage is blocked, so the "${key}" flag keeps its default`, error);
        }
    }
    return fallback;
}

function globalStorage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}
