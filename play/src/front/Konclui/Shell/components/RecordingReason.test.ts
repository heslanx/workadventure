// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { readable } from "svelte/store";
import RecordingMenuItem from "../../../Components/ActionBar/MenuIcons/RecordingMenuItem.svelte";
import type { RecordingMenuState } from "../../../Components/ActionBar/MenuIcons/RecordingMenuUtils";

// The dock draws upstream's recording button. When it cannot act it must stay focusable and say why, not be a native
// disabled button with no word: this test mounts the real button and reads what the user would.

const room = vi.hoisted(() => {
    const recording: { buttonState: string; disabledReason: string | null } = {
        buttonState: "enabled",
        disabledReason: null,
    };
    return { recording, isLogged: true };
});

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { default: readable(path([])), LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../../../Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        helpTextDisabledStore: writable(false),
        openedMenuStore: writable(undefined),
        activeSecondaryZoneActionBarStore: writable(undefined),
    };
});
vi.mock("../../../Components/Tooltip/HelpTooltip.svelte", () => ({ default: () => undefined }));
vi.mock("../../../Components/PopUp/Recording/RecordingSpacePicker.svelte", () => ({ default: () => undefined }));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Utils/svelte-floatingui-show", () => ({ showFloatingUi: vi.fn() }));
vi.mock("../../../Stores/NotificationStore", () => ({ notificationPlayingStore: { playNotification: vi.fn() } }));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { isLogged: () => room.isLogged } }));
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        currentStartedRoom: {
            get recording() {
                return room.recording;
            },
        },
    },
}));

const TEST_ID = "recordingButton-start";

function menuState(overrides: Partial<RecordingMenuState> = {}): RecordingMenuState {
    return {
        actionMode: "start",
        actionableRows: [],
        buttonState: "disabled",
        currentRows: [],
        directRow: undefined,
        hasActionableStart: false,
        hasOtherRecording: false,
        hasOwnRecording: false,
        hasPendingRequest: false,
        shouldDisplayButton: true,
        ...overrides,
    };
}

describe("the dock's recording button when it cannot act", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        room.recording = { buttonState: "enabled", disabledReason: null };
        room.isLogged = true;
    });

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
    });

    function show(state: RecordingMenuState): void {
        document.body.append(target);
        component = mount(RecordingMenuItem, { target, props: { recordingMenuState: readable(state) } });
        flushSync();
    }

    const button = (): HTMLButtonElement | null => target.querySelector(`[data-testid="${TEST_ID}"]`);
    const reason = (): string | undefined =>
        target.querySelector(`[data-testid="${TEST_ID}-blocked-reason"]`)?.textContent?.trim();

    it("tells a visitor to sign in", () => {
        room.isLogged = false;
        show(menuState());

        expect(button()?.disabled).toBe(false);
        expect(button()?.getAttribute("aria-disabled")).toBe("true");
        expect(reason()).toBe("actionbar.blocked.recordingNeedLogin");
    });

    it("tells the user to wait while a recording starts or stops", () => {
        show(menuState({ hasPendingRequest: true }));

        expect(reason()).toBe("actionbar.blocked.recordingBusy");
    });

    it("says that only the person recording can stop it", () => {
        show(menuState({ hasOtherRecording: true }));

        expect(reason()).toBe("actionbar.blocked.recordingByOther");
    });

    it("gives the map's own reason when the map turned recording off", () => {
        room.recording = { buttonState: "disabled", disabledReason: "Recording requires a premium subscription." };
        show(menuState());

        expect(reason()).toBe("Recording requires a premium subscription.");
    });

    it("says recording is off here, and who to ask, when the map gives no reason", () => {
        room.recording = { buttonState: "disabled", disabledReason: null };
        show(menuState());

        expect(reason()).toBe("actionbar.blocked.recordingOffHere");
    });

    it("has no reason, and acts, when the user can start a recording", () => {
        show(menuState({ buttonState: "normal", hasActionableStart: true }));

        expect(button()?.hasAttribute("aria-disabled")).toBe(false);
        expect(reason()).toBeUndefined();
    });
});
