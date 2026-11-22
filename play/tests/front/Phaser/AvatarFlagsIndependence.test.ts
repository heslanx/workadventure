// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { AVATAR_BAKE_ENABLED, isAvatarBakeEnabled } from "../../../src/front/Phaser/Entity/AvatarBakeCache";
import { AVATAR_ZERO_WORK_ENABLED, isAvatarZeroWorkEnabled } from "../../../src/front/Phaser/Entity/AvatarZeroWork";
import { AVATAR_DETAIL_BUDGET_ENABLED, isAvatarDetailBudgetEnabled } from "../../../src/front/Phaser/Game/AvatarDetail";
import { setAvatarFlags } from "./avatarFlags";

afterEach(() => {
    localStorage.clear();
});

// The three flags are read by three readers (GameScene for the budget, RemotePlayer for the zero-work states, the bake
// cache for the bake) and the shipping build runs them together: any of them off with the others on is a supported state.
describe("the avatar flags", () => {
    const states = [
        { avatarDetailBudget: true, avatarZeroWork: true, avatarBake: true },
        { avatarDetailBudget: false, avatarZeroWork: true, avatarBake: true },
        { avatarDetailBudget: true, avatarZeroWork: false, avatarBake: true },
        { avatarDetailBudget: true, avatarZeroWork: true, avatarBake: false },
        { avatarDetailBudget: false, avatarZeroWork: false, avatarBake: false },
    ];

    it.each(states)("are read one by one in the state %j", (state) => {
        setAvatarFlags(state);

        expect({
            avatarDetailBudget: isAvatarDetailBudgetEnabled(),
            avatarZeroWork: isAvatarZeroWorkEnabled(),
            avatarBake: isAvatarBakeEnabled(),
        }).toEqual(state);
    });

    // The defaults are the three constants, so that holding one of them back is that one line and its own "ships on" test.
    it("are at their constants in a browser that has set none of them", () => {
        expect({
            avatarDetailBudget: isAvatarDetailBudgetEnabled(),
            avatarZeroWork: isAvatarZeroWorkEnabled(),
            avatarBake: isAvatarBakeEnabled(),
        }).toEqual({
            avatarDetailBudget: AVATAR_DETAIL_BUDGET_ENABLED,
            avatarZeroWork: AVATAR_ZERO_WORK_ENABLED,
            avatarBake: AVATAR_BAKE_ENABLED,
        });
    });

    it("are not read from each other's key", () => {
        localStorage.setItem("avatarBake", "0");

        expect(isAvatarDetailBudgetEnabled()).toBe(AVATAR_DETAIL_BUDGET_ENABLED);
        expect(isAvatarZeroWorkEnabled()).toBe(AVATAR_ZERO_WORK_ENABLED);
    });
});
