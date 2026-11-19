// @vitest-environment jsdom
import { AvailabilityStatus } from "@workadventure/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { Writable } from "svelte/store";
import { availabilityStatusStore } from "../../../../../src/front/Stores/MediaStore";
import ProfileMenuContent from "../../../../../src/front/Components/ActionBar/MenuIcons/ProfileMenuContent.svelte";

// The dock's profile menu (owner feedback 2026-11-19): one row standard, the office menu's, for every row it lists.
// Its upstream neighbours are cut at their modules: the game, the scenes, the room and the stores it reads.

vi.mock("../../../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every key reads as its own path, so a row is found by the key that names it.
    const path = (keys: string[]): unknown =>
        new Proxy(() => keys.join("."), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    const LL = readable(path([]));
    return { default: LL, LL, locale: readable("en-US") };
});
vi.mock("@sentry/svelte", () => ({ feedbackIntegration: vi.fn() }));
vi.mock("../../../../../src/front/Administration/AnalyticsClient", () => ({
    analyticsClient: { trackAdminEvent: vi.fn() },
}));
vi.mock("../../../../../src/front/Connection/ConnectionManager", () => ({
    connectionManager: { currentRoom: undefined, logout: vi.fn() },
}));
vi.mock("../../../../../src/front/Enum/EnvironmentVariable", () => ({
    ENABLE_OPENID: false,
    SENTRY_DSN_FRONT: undefined,
}));
vi.mock("../../../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: { leaveGame: vi.fn() } }));
vi.mock("../../../../../src/front/Phaser/Login/EnableCameraScene", () => ({
    EnableCameraScene: class {},
    EnableCameraSceneName: "EnableCameraScene",
}));
vi.mock("../../../../../src/front/Phaser/Login/LoginScene", () => ({
    LoginScene: class {},
    LoginSceneName: "LoginScene",
}));
vi.mock("../../../../../src/front/Phaser/Login/PwaInstallScene", () => ({
    PwaInstallScene: class {},
    PwaInstallSceneName: "PwaInstallScene",
}));
vi.mock("../../../../../src/front/Phaser/Login/SelectCharacterScene", () => ({
    SelectCharacterScene: class {},
    SelectCharacterSceneName: "SelectCharacterScene",
}));
vi.mock("../../../../../src/front/Phaser/Login/SelectCompanionScene", () => ({
    SelectCompanionScene: class {},
    SelectCompanionSceneName: "SelectCompanionScene",
}));
vi.mock("../../../../../src/front/Stores/LoginSceneStore", async () => {
    const { writable } = await import("svelte/store");
    return { loginSceneVisibleStore: writable(false) };
});
vi.mock("../../../../../src/front/Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    const { AvailabilityStatus } = await import("@workadventure/messages");
    return {
        availabilityStatusStore: writable(AvailabilityStatus.ONLINE),
        enableCameraSceneVisibilityStore: { showEnableCameraScene: vi.fn() },
    };
});
vi.mock("../../../../../src/front/Stores/MenuStore", async () => {
    const { readable, writable } = await import("svelte/store");
    return {
        openedMenuStore: { close: vi.fn() },
        rightActionBarMenuItems: readable([]),
        showMenuItem: vi.fn(),
        SubMenusInterface: { settings: "settings" },
        userIsConnected: readable(false),
        helpTextDisabledStore: writable(false),
    };
});
vi.mock("../../../../../src/front/Stores/OnboardingStore", () => ({ onboardingStore: { restart: vi.fn() } }));
vi.mock("../../../../../src/front/Stores/PwaInstallStore", async () => {
    const { writable } = await import("svelte/store");
    return { pwaInstallProfileMenuEligibleStore: writable(true) };
});
vi.mock("../../../../../src/front/Stores/SelectCharacterStore", async () => {
    const { writable } = await import("svelte/store");
    return { selectCharacterSceneVisibleStore: writable(false) };
});
vi.mock("../../../../../src/front/Stores/SelectCompanionStore", async () => {
    const { writable } = await import("svelte/store");
    return { selectCompanionSceneVisibleStore: writable(false) };
});
vi.mock("../../../../../src/front/Utils/AvailabilityStatus", () => ({
    getStatusInformation: (statuses: AvailabilityStatus[]) =>
        statuses.map((status) => ({ AvailabilityStatus: status, label: `status-${status}`, colorHex: "#68e97a" })),
    getColorHexOfStatus: () => "#68e97a",
    getStatusLabel: (status: AvailabilityStatus) => `status-${status}`,
}));
vi.mock("../../../../../src/front/Rules/StatusRules/statusChangerFunctions", () => ({
    resetAllStatusStoreExcept: vi.fn(),
}));
vi.mock("../../../../../src/front/Stores/Utils/externalSvelteComponentService", async () => {
    const { readable } = await import("svelte/store");
    return { externalSvelteComponentService: { getComponentsByZone: () => readable(new Map()) } };
});
// A map script's button with no picture, as the office map's "Applaud" is.
vi.mock("../../../../../src/front/Stores/AdditionalItemsMenuStore", async () => {
    const { readable } = await import("svelte/store");
    const scriptButton = { id: "applaud", label: "Applaud", type: "button" };
    return { getAdditionalMenuItemStore: () => readable(new Map([[scriptButton.id, scriptButton]])) };
});
vi.mock("../../../../../src/front/Api/IframeListener", () => ({
    iframeListener: { sendButtonActionBarTriggered: vi.fn() },
}));
vi.mock("../../../../../src/front/Components/Tooltip/HelpTooltip.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../../src/front/Components/ActionBar/MenuIcons/ContextualMenuItems.svelte", () => ({
    default: () => undefined,
}));

describe("the dock's profile menu", () => {
    let target: HTMLElement;
    let menu: ReturnType<typeof mount> | undefined;
    const status = availabilityStatusStore as unknown as Writable<AvailabilityStatus>;

    beforeEach(() => {
        status.set(AvailabilityStatus.ONLINE);
        target = document.createElement("div");
        document.body.appendChild(target);
        menu = mount(ProfileMenuContent, { target, props: { showContextualMenuItems: false } });
        flushSync();
    });

    afterEach(async () => {
        const mounted = menu;
        menu = undefined;
        if (mounted) await unmount(mounted);
        target.remove();
    });

    const surface = () => target.querySelector<HTMLElement>('[data-testid="profile-menu"]');
    const list = () => target.querySelector<HTMLElement>('[data-testid="profile-menu-list"]');
    const rows = () => [...target.querySelectorAll<HTMLElement>("button")];
    const rowNamed = (text: string) => {
        const found = rows().find((row) => row.textContent?.includes(text));
        if (!found) throw new Error(`no row ${text}`);
        return found;
    };

    it("has the office menu's surface: the chrome, a 6 px edge and its 264 px width", () => {
        const classes = surface()?.classList;

        expect(classes?.contains("k-chrome")).toBe(true);
        expect(classes?.contains("p-1.5")).toBe(true);
        expect(classes?.contains("w-66")).toBe(true);
        expect(classes?.contains("p-1")).toBe(false);
    });

    it("scrolls an inner list with the menu scroller, kept above the dock stack, and never the surface", () => {
        expect(list()?.classList.contains("k-scroll-y")).toBe(true);
        expect(list()?.className).toContain("var(--konclui-dock-stack-height,68px)");
        expect(surface()?.classList.contains("k-scroll-y")).toBe(false);
        expect(surface()?.querySelectorAll(".k-scroll-y")).toHaveLength(1);
    });

    it("draws every row on the menu row standard, each with its 18 px lead slot", () => {
        expect(rows().length).toBeGreaterThanOrEqual(10);
        for (const row of rows()) {
            expect(row.classList.contains("k-menu-row"), row.textContent ?? "").toBe(true);
            expect(row.firstElementChild?.classList.contains("k-menu-lead"), row.textContent ?? "").toBe(true);
            expect(row.querySelector(".k-menu-label"), row.textContent ?? "").not.toBeNull();
        }
    });

    it("keeps an empty lead on a script button with no picture, so its label lines up with the others", () => {
        const applaud = rowNamed("Applaud");

        expect(applaud.firstElementChild?.classList.contains("k-menu-lead")).toBe(true);
        expect(applaud.firstElementChild?.childElementCount).toBe(0);
    });

    it("shows a Tabler outline glyph in every action row's lead, the office menu's for name, avatar and companion", () => {
        const leadGlyphs = rows()
            .filter((row) => !row.textContent?.includes("Applaud") && !row.textContent?.includes("status-"))
            .map((row) => row.querySelector(".k-menu-lead > :is(svg, img)"));

        expect(leadGlyphs.length).toBeGreaterThanOrEqual(6);
        for (const glyph of leadGlyphs) {
            expect(glyph?.tagName.toLowerCase()).toBe("svg");
            // Sized by the lead, never by a font size, and with Tabler's own stroke.
            expect(glyph?.hasAttribute("font-size")).toBe(false);
            expect(glyph?.getAttribute("stroke-width") ?? "2").toBe("2");
        }
        expect(target.querySelector("img")).toBeNull();
        // The same glyphs as OfficeMenu.svelte: IconPencil, IconUserEdit and IconUserPlus.
        const glyphOf = (text: string) => rowNamed(text).querySelector(".k-menu-lead > svg")?.innerHTML;
        expect(glyphOf("actionbar.profil")).not.toBe(glyphOf("actionbar.woka"));
        expect(glyphOf("actionbar.woka")).not.toBe(glyphOf("actionbar.companion"));
    });

    it("shows the current status as current, with its check, and no other status checked", () => {
        const statusRows = rows().filter((row) => row.textContent?.includes("status-"));

        expect(statusRows).toHaveLength(4);
        const current = statusRows.filter((row) => row.getAttribute("aria-current") === "true");
        expect(current).toHaveLength(1);
        expect(current[0].textContent).toContain(`status-${AvailabilityStatus.ONLINE}`);
        expect(current[0].querySelector(".k-menu-mark")).not.toBeNull();
        expect(current[0].className).not.toMatch(/\b(disabled|opacity-50)\b/);
        expect(current[0].querySelector(".opacity-50")).toBeNull();
        for (const other of statusRows.filter((row) => row !== current[0])) {
            expect(other.querySelector(".k-menu-mark")).toBeNull();
        }
    });

    it("shows a status the room locks as the current one, at full ink", () => {
        status.set(AvailabilityStatus.SILENT);
        flushSync();

        const statusRows = rows().filter((row) => row.textContent?.includes("status-"));

        expect(statusRows).toHaveLength(1);
        expect(statusRows[0].textContent).toContain(`status-${AvailabilityStatus.SILENT}`);
        expect(statusRows[0].getAttribute("aria-current")).toBe("true");
        expect(statusRows[0].querySelector(".k-menu-mark")).not.toBeNull();
        expect(statusRows[0].querySelector(".opacity-50")).toBeNull();
    });

    it("puts each status dot inside the lead slot", () => {
        const dot = rowNamed(`status-${AvailabilityStatus.BUSY}`).querySelector(".k-menu-lead > span");

        expect(dot?.classList.contains("size-2.5")).toBe(true);
        expect(dot?.classList.contains("rounded-full")).toBe(true);
    });

    it("titles the groups as the office menu does, with the rule between groups and none above the first", () => {
        const titles = [...target.querySelectorAll(".k-menu-title")];

        expect(titles.map((title) => title.textContent?.trim())).toEqual([
            "actionbar.listStatusTitle.enable",
            "menu.sub.profile",
            "menu.sub.settings",
        ]);
        expect(titles.map((title) => title.previousElementSibling?.classList.contains("k-divider") ?? false)).toEqual([
            false,
            true,
            true,
        ]);
        expect(target.querySelector(".text-xxs, .uppercase")).toBeNull();
    });
});
