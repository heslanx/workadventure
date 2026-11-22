// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// E2EHooks reaches the game through the game manager and the media stores, which pull in the whole front end.
vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: { getCurrentGameScene: () => ({}) } }));
vi.mock("../../../src/front/Stores/MediaStore", () => ({
    rawLocalVideoTrackStore: {},
    backgroundProcessedLocalVideoTrackStore: {},
}));

import { e2eHooks } from "../../../src/front/Utils/E2EHooks";
import { AVATAR_BAKE_ENABLED } from "../../../src/front/Phaser/Entity/AvatarBakeCache";
import { AVATAR_ZERO_WORK_ENABLED } from "../../../src/front/Phaser/Entity/AvatarZeroWork";
import { AVATAR_DETAIL_BUDGET_ENABLED } from "../../../src/front/Phaser/Game/AvatarDetail";
import { setAvatarFlags } from "./avatarFlags";

afterEach(() => {
    localStorage.clear();
});

// The frame probe reads the flags through this hook to say what a run measured: it must be what the three readers say.
describe("window.e2eHooks.getAvatarFlags", () => {
    it("reports the defaults of the three flags in a browser that has set none of them", () => {
        expect(e2eHooks.getAvatarFlags()).toEqual({
            avatarDetailBudget: AVATAR_DETAIL_BUDGET_ENABLED,
            avatarZeroWork: AVATAR_ZERO_WORK_ENABLED,
            avatarBake: AVATAR_BAKE_ENABLED,
        });
    });

    it('reports a flag the storage sets to "0" as off, and the others as they are', () => {
        setAvatarFlags({ avatarBake: false, avatarZeroWork: true, avatarDetailBudget: false });

        expect(e2eHooks.getAvatarFlags()).toEqual({
            avatarDetailBudget: false,
            avatarZeroWork: true,
            avatarBake: false,
        });
    });
});
