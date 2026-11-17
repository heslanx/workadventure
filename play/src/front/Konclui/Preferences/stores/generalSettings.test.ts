// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/unbound-method -- expect() on vi.fn() members of module mocks */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { keepFullscreenOff } from "./generalSettings";

// Full screen is saved, and upstream asks for it again at the next scene: once the page left it another way, the
// saved choice must follow, or the switch shows off while the next scene goes full screen.

const saved = vi.hoisted(() => ({ fullscreen: true }));

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: {
        getFullscreen: vi.fn(() => saved.fullscreen),
        setFullscreen: vi.fn(),
    },
}));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Connection/ConnectionManager", () => ({ connectionManager: {} }));
vi.mock("../../../Stores/InvitePreferencesStore", () => ({ invitePreferencesStore: {}, setInviteEntryPoint: vi.fn() }));
vi.mock("../../../Stores/MenuStore", () => ({
    handleOpenMenuEvent: vi.fn(),
    menuVisiblilityStore: {},
    showMenuItem: vi.fn(),
    subMenusStore: {},
}));
vi.mock("../../../Stores/OnboardingStore", () => ({ onboardingStore: {} }));
vi.mock("../../../Utils/locales", () => ({ setCurrentLocale: vi.fn() }));

describe("full screen left another way", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("saves full screen off when it was saved on", () => {
        saved.fullscreen = true;

        keepFullscreenOff();

        expect(localUserStore.setFullscreen).toHaveBeenCalledWith(false);
    });

    it("writes nothing when full screen was already saved off", () => {
        saved.fullscreen = false;

        keepFullscreenOff();

        expect(localUserStore.setFullscreen).not.toHaveBeenCalled();
    });
});
