// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { audioManagerVisibilityStore } from "../../../Stores/AudioManagerStore";
import { currentPlayerGroupLockStateStore } from "../../../Stores/CurrentPlayerGroupStore";
import { currentPlayerLockableAreasStore } from "../../../Stores/CurrentPlayerAreaLockStore";
import LockDiscussionMenuItem from "../../../Components/ActionBar/MenuIcons/LockDiscussionMenuItem.svelte";
import MusicMenuItem from "../../../Components/ActionBar/MenuIcons/MusicMenuItem.svelte";

// The dock draws upstream's lock and music buttons. When one cannot act it must stay focusable and say why, not be a
// native disabled button with no word: these tests mount the real buttons and read what the user would.

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
vi.mock("../../../Stores/AudioManagerStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        audioManagerVisibilityStore: writable("hidden"),
        audioManagerPlayerState: writable(undefined),
        audioManagerFileStore: { unloadAudio: vi.fn() },
        audioManagerVolumeStore: {
            ...writable({ paused: false }),
            togglePause: vi.fn(),
            stopSound: vi.fn(),
        },
        audioManagerRetryPlaySubject: { next: vi.fn() },
    };
});
vi.mock("../../../Components/Tooltip/HelpTooltip.svelte", () => ({ default: () => undefined }));
vi.mock("../../../Components/AudioManager/AudioManager.svelte", () => ({ default: () => undefined }));
vi.mock("../../../Components/PopUp/LockableAreaPicker.svelte", () => ({ default: () => undefined }));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Stores/AreaPropertyVariablesStore", () => ({ setAreaPropertyLockState: vi.fn() }));
vi.mock("../../../Utils/svelte-floatingui-show", () => ({ showFloatingUi: vi.fn() }));
// A scene whose map has no lockable property on the area and a connection that carries no tag: nobody may lock it.
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => ({
            connection: { getAllTags: () => [], emitLockGroup: vi.fn() },
            getGameMapFrontWrapper: () => ({ getGameMap: () => undefined }),
        }),
    },
}));

describe("the dock's upstream buttons that can be unable to act", () => {
    const target = document.createElement("div");
    let component: ReturnType<typeof mount> | undefined;

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        audioManagerVisibilityStore.set("hidden");
        currentPlayerLockableAreasStore.set([]);
        currentPlayerGroupLockStateStore.set(undefined);
    });

    function show(item: typeof MusicMenuItem): void {
        document.body.append(target);
        component = mount(item, { target });
        flushSync();
    }

    const reasonOf = (testId: string): string | undefined =>
        target.querySelector(`[data-testid="${testId}-blocked-reason"]`)?.textContent?.trim();

    describe("the bubble lock", () => {
        const AREA = { areaId: "meeting", propertyId: "lock", lockState: false, areaName: "Meeting room" };

        it("stays focusable and gives its reason when the player may not lock the area", () => {
            currentPlayerLockableAreasStore.set([AREA]);
            show(LockDiscussionMenuItem);
            const lock = target.querySelector<HTMLButtonElement>('[data-testid="lock-button"]');

            lock?.focus();

            expect(lock?.disabled).toBe(false);
            expect(lock?.getAttribute("aria-disabled")).toBe("true");
            expect(document.activeElement).toBe(lock);
            expect(reasonOf("lock-button")).toBe("actionbar.blocked.lockNotAllowed");
            expect(lock?.getAttribute("aria-describedby")).toBe(
                target.querySelector('[data-testid="lock-button-blocked-reason"]')?.id,
            );
        });

        it("gives the same reason when the area is already locked and the player cannot open it", () => {
            currentPlayerLockableAreasStore.set([{ ...AREA, lockState: true }]);
            show(LockDiscussionMenuItem);

            expect(reasonOf("lock-button")).toBe("actionbar.blocked.lockNotAllowed");
        });

        it("has no reason, and acts, when the player locks their own bubble", () => {
            currentPlayerGroupLockStateStore.set(false);
            show(LockDiscussionMenuItem);
            const lock = target.querySelector<HTMLButtonElement>('[data-testid="lock-button"]');

            expect(lock?.hasAttribute("aria-disabled")).toBe(false);
            expect(reasonOf("lock-button")).toBeUndefined();
        });
    });

    describe("the music buttons", () => {
        const TEST_IDS = ["music-pause-button", "music-stop-button", "music-button"];

        it("each stays focusable and says the settings turned the ambient sounds off", () => {
            audioManagerVisibilityStore.set("disabledBySettings");
            show(MusicMenuItem);

            for (const testId of TEST_IDS) {
                const button = target.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
                expect(button?.disabled, testId).toBe(false);
                expect(button?.getAttribute("aria-disabled"), testId).toBe("true");
                expect(reasonOf(testId), testId).toBe("actionbar.blocked.ambientOffInSettings");
            }
        });

        it("gives no reason while the sounds are on", () => {
            audioManagerVisibilityStore.set("visible");
            show(MusicMenuItem);

            for (const testId of TEST_IDS) {
                expect(target.querySelector(`[data-testid="${testId}"]`)?.hasAttribute("aria-disabled"), testId).toBe(
                    false,
                );
                expect(reasonOf(testId), testId).toBeUndefined();
            }
        });
    });
});
