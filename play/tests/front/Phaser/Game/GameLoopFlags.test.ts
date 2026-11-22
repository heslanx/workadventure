import { afterEach, describe, expect, it, vi } from "vitest";
import {
    GAME_NO_STENCIL_ENABLED,
    GAME_NO_STENCIL_STORAGE_KEY,
    GAME_RENDER_SKIP_COVERED_ENABLED,
    GAME_RENDER_SKIP_COVERED_STORAGE_KEY,
    GAME_STEP_CAP_ENABLED,
    GAME_STEP_CAP_STORAGE_KEY,
    isGameNoStencilEnabled,
    isGameRenderSkipCoveredEnabled,
    isGameStepCapEnabled,
    resetGameLoopFlagWarningsForTests,
} from "../../../../src/front/Phaser/Game/GameLoopFlags";

const FLAGS = [
    {
        name: "gameStepCap",
        key: GAME_STEP_CAP_STORAGE_KEY,
        defaultValue: GAME_STEP_CAP_ENABLED,
        expectedDefault: true,
        read: isGameStepCapEnabled,
    },
    {
        name: "gameRenderSkipCovered",
        key: GAME_RENDER_SKIP_COVERED_STORAGE_KEY,
        defaultValue: GAME_RENDER_SKIP_COVERED_ENABLED,
        expectedDefault: false,
        read: isGameRenderSkipCoveredEnabled,
    },
    {
        name: "gameNoStencil",
        key: GAME_NO_STENCIL_STORAGE_KEY,
        defaultValue: GAME_NO_STENCIL_ENABLED,
        expectedDefault: false,
        read: isGameNoStencilEnabled,
    },
];

function storageWith(entries: Record<string, string>): Pick<Storage, "getItem"> {
    return { getItem: (key) => entries[key] ?? null };
}

describe.each(FLAGS)("the $name flag", ({ name, key, defaultValue, expectedDefault, read }) => {
    afterEach(() => {
        vi.restoreAllMocks();
        resetGameLoopFlagWarningsForTests();
    });

    it("is stored under its own key, with its own default", () => {
        expect(key).toBe(name);
        expect(defaultValue).toBe(expectedDefault);
    });

    it("keeps the default when the storage says nothing, or something else than 0 and 1", () => {
        expect(read(storageWith({}))).toBe(defaultValue);
        expect(read(storageWith({ [key]: "true" }))).toBe(defaultValue);
        expect(read(storageWith({ [key]: "" }))).toBe(defaultValue);
        expect(read(undefined)).toBe(defaultValue);
    });

    it('is turned on by "1" and off by "0", whatever the default', () => {
        expect(read(storageWith({ [key]: "1" }))).toBe(true);
        expect(read(storageWith({ [key]: "0" }))).toBe(false);
    });

    it("ignores the key of the other flags", () => {
        const others = FLAGS.filter((flag) => flag.key !== key).map((flag) => [flag.key, "1"]);

        expect(read(storageWith(Object.fromEntries(others)))).toBe(defaultValue);
    });

    it("keeps the default, and says so once, when the storage cannot be read", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const blocked = {
            getItem: () => {
                throw new DOMException("denied", "SecurityError");
            },
        };

        expect(read(blocked)).toBe(defaultValue);
        expect(read(blocked)).toBe(defaultValue);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(key), expect.any(DOMException));
    });
});
