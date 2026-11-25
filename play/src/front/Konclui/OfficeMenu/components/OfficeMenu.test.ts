// @vitest-environment jsdom
import { AvailabilityStatus } from "@workadventure/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get, type Writable } from "svelte/store";
import { resetAllStatusStoreExcept } from "../../../Rules/StatusRules/statusChangerFunctions";
import { availabilityStatusStore } from "../../../Stores/MediaStore";
import { inviteUserActivated, mapEditorMenuVisibleStore, mapManagerActivated } from "../../../Stores/MenuStore";
import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
import { megaphoneCanBeUsedStore } from "../../../Stores/MegaphoneStore";
import { userIsAdminStore } from "../../../Stores/GameStore";
import { showModalGlobalComminucationVisibilityStore } from "../../../Stores/ModalStore";
import { installGameCommands, type GameCommands } from "../../Preferences/stores/gameCommands";
import { nameIsEditable } from "../../Preferences/stores/generalSettings";
import { closePreferences, preferencesStore } from "../../Preferences/stores/preferencesStore";
import { installCameraScene } from "../stores/cameraScene";
import { installMapTools } from "../stores/mapTools";
import { closeOfficeMenu, openOfficeMenu, toggleOfficeMenu } from "../stores/officeMenuStore";
import { stubWebAnimations, type WebAnimationsStub } from "../../../Utils/webAnimationsStub";
import OfficeMenu from "./OfficeMenu.svelte";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    // Every key reads as its own path, so a test finds a text by the key that names it. The words themselves are
    // checked against the real locales in officeMenuTexts.test.ts.
    const path = (keys: string[]): unknown =>
        new Proxy(() => keys.join("."), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    return { LL: readable(path([])), locale: readable("en-US") };
});
vi.mock("../../../Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        mapEditorMenuVisibleStore: writable(false),
        mapManagerActivated: writable(false),
        inviteUserActivated: writable(true),
    };
});
vi.mock("../../../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    const { AvailabilityStatus } = await import("@workadventure/messages");
    return { availabilityStatusStore: writable(AvailabilityStatus.ONLINE) };
});
vi.mock("../../../Stores/MegaphoneStore", async () => {
    const { writable } = await import("svelte/store");
    return { megaphoneCanBeUsedStore: writable(false) };
});
vi.mock("../../../Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return { chatVisibilityStore: writable(false) };
});
vi.mock("../../../Stores/InvitePreferencesStore", async () => {
    const { writable } = await import("svelte/store");
    return { invitePreferencesStore: writable({ entryPoint: "", walkAutomatically: false, showZoneSelect: false }) };
});
vi.mock("../../../Rules/StatusRules/statusChangerFunctions", () => ({ resetAllStatusStoreExcept: vi.fn() }));
vi.mock("../../../Utils/AvailabilityStatus", () => ({ getColorHexOfStatus: () => "#68e97a" }));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../Preferences/stores/generalSettings", () => ({ nameIsEditable: vi.fn(), reportLinkCopied: vi.fn() }));

const clipboard = { writeText: vi.fn<(text: string) => Promise<void>>() };

describe("the office menu", () => {
    const target = document.createElement("div");
    let menu: ReturnType<typeof mount> | undefined;
    let logo: HTMLButtonElement;
    const commands = {
        openNameEditor: vi.fn(),
        openWokaEditor: vi.fn(),
        openCompanionEditor: vi.fn(),
        openPwaInstall: vi.fn(),
        pauseTileAnimations: vi.fn(),
        startPositionNames: vi.fn(() => [] as string[]),
        playerPosition: vi.fn(() => undefined),
    } satisfies GameCommands;
    const equip = vi.fn();
    const openCameraScene = vi.fn();

    // The mocked upstream stores are plain writables: the test moves them the way upstream's own rules would.
    const store = <T>(real: unknown) => real as Writable<T>;

    beforeEach(() => {
        vi.stubGlobal("navigator", { clipboard });
        clipboard.writeText.mockReset().mockResolvedValue(undefined);
        vi.mocked(nameIsEditable).mockReturnValue(true);
        vi.mocked(resetAllStatusStoreExcept).mockClear();
        for (const command of Object.values(commands)) command.mockClear();
        equip.mockClear();
        openCameraScene.mockClear();
        installGameCommands(commands);
        installMapTools({ equip });
        installCameraScene({ openCameraScene });
        store<AvailabilityStatus>(availabilityStatusStore).set(AvailabilityStatus.ONLINE);
        store<boolean>(mapEditorMenuVisibleStore).set(false);
        store<boolean>(mapManagerActivated).set(false);
        store<boolean>(megaphoneCanBeUsedStore).set(false);
        userIsAdminStore.set(false);
        store<boolean>(inviteUserActivated).set(true);
        showModalGlobalComminucationVisibilityStore.set(false);
        logo = document.createElement("button");
        document.body.append(logo, target);
        menu = mount(OfficeMenu, { target });
    });

    afterEach(async () => {
        closeOfficeMenu({ returnFocus: false });
        closePreferences();
        mapEditorModeStore.switchMode(false);
        const mounted = menu;
        menu = undefined;
        if (mounted) await unmount(mounted);
        document.body.replaceChildren();
        target.replaceChildren();
    });

    const open = () => {
        logo.focus();
        toggleOfficeMenu(logo);
        flushSync();
    };
    const panel = () => target.querySelector<HTMLElement>('[data-testid="office-menu"]');
    const rows = () => [...target.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    const row = (name: string) => {
        const found = target.querySelector<HTMLElement>(`[data-testid="office-menu-${name}"]`);
        if (!found) throw new Error(`no row ${name}`);
        return found;
    };
    const rowTexts = () => rows().map((element) => element.textContent?.trim());
    const press = (element: Element, key: string, init: KeyboardEventInit = {}) => {
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
        flushSync();
    };
    const click = (element: HTMLElement) => {
        element.click();
        flushSync();
    };

    describe("what it is", () => {
        it("is not there until the logo opens it", () => {
            flushSync();

            expect(panel()).toBeNull();
        });

        it("opens as a labelled menu of groups of menu items, with the status rows as radios", () => {
            open();

            const menuElement = target.querySelector('[role="menu"]');
            expect(menuElement?.getAttribute("aria-label")).toBe("konclui.officeMenu");
            expect(
                [...target.querySelectorAll('[role="group"]')].map((group) => group.getAttribute("aria-label")),
            ).toEqual(["konclui.menu.statusGroup", "konclui.menu.profileGroup", "konclui.menu.settingsGroup"]);
            expect(rows().map((element) => element.getAttribute("role"))).toEqual([
                "menuitemradio",
                "menuitemradio",
                "menuitemradio",
                "menuitemradio",
                "menuitem",
                "menuitem",
                "menuitem",
                "menuitem",
                "menuitem",
                "menuitem",
            ]);
            expect(rowTexts().slice(0, 4)).toEqual([
                "konclui.menu.online",
                "konclui.menu.busy",
                "konclui.menu.away",
                "konclui.menu.doNotDisturb",
            ]);
        });

        it("holds the game's keys while the focus is inside, so an arrow moves the row and not the player", () => {
            open();

            expect(panel()?.classList.contains("block-user-action")).toBe(true);
        });

        it("scrolls the list of rows with the menu scroller, not the panel, whose rim the edge fade would fade", () => {
            open();

            expect(target.querySelector('[role="menu"]')?.classList.contains("k-scroll-y")).toBe(true);
            expect(panel()?.classList.contains("k-scroll-y")).toBe(false);
            expect(panel()?.querySelectorAll(".k-scroll-y")).toHaveLength(1);
        });

        it("draws every icon in an 18 px box set by its size, never by a font size the plugin scales by 1.2", () => {
            store<boolean>(mapEditorMenuVisibleStore).set(true);
            mapEditorModeStore.switchMode(true);
            open();

            const icons = [...(panel()?.querySelectorAll("svg") ?? [])];
            // Six action glyphs, the status mark and the switched-on editor's mark.
            expect(icons.length).toBeGreaterThanOrEqual(8);
            for (const icon of icons) {
                expect(icon.hasAttribute("font-size")).toBe(false);
                expect([icon.getAttribute("width"), icon.getAttribute("height")]).toEqual(["18", "18"]);
            }
        });
    });

    describe("the rows that follow upstream's conditions", () => {
        it("hides the name row when an OpenID policy forces the account's name", () => {
            vi.mocked(nameIsEditable).mockReturnValue(false);

            open();

            expect(target.querySelector('[data-testid="office-menu-editName"]')).toBeNull();
            expect(target.querySelector('[data-testid="office-menu-avatar"]')).not.toBeNull();
        });

        it("offers the link only while invitations are on, and follows a change at once", () => {
            open();
            expect(target.querySelector('[data-testid="office-menu-shareLink"]')).not.toBeNull();

            store<boolean>(inviteUserActivated).set(false);
            flushSync();

            expect(target.querySelector('[data-testid="office-menu-shareLink"]')).toBeNull();
            expect(target.querySelector('[data-testid="office-menu-settings"]')).not.toBeNull();
        });

        it("shows no tools group while the map has no editor, no explorer and the user has no megaphone", () => {
            open();

            expect(target.querySelector('[data-testid="office-menu-mapEditor"]')).toBeNull();
            expect(target.querySelector('[data-testid="office-menu-explore"]')).toBeNull();
            expect(target.querySelector('[data-testid="office-menu-broadcast"]')).toBeNull();
            expect(target.textContent).not.toContain("konclui.menu.toolsGroup");
        });

        it("shows the map editor and the explorer where upstream's map menu shows them, and follows a change at once", () => {
            open();

            store<boolean>(mapEditorMenuVisibleStore).set(true);
            store<boolean>(mapManagerActivated).set(true);
            flushSync();
            expect(row("mapEditor").textContent).toContain("konclui.menu.mapEditor");
            expect(row("explore").textContent).toContain("konclui.menu.explore");

            store<boolean>(mapEditorMenuVisibleStore).set(false);
            flushSync();
            expect(target.querySelector('[data-testid="office-menu-mapEditor"]')).toBeNull();
            expect(row("explore")).toBeTruthy();
        });

        it("shows the megaphone row to those who may use the megaphone, and to administrators", () => {
            open();
            store<boolean>(megaphoneCanBeUsedStore).set(true);
            flushSync();
            expect(row("broadcast").textContent).toContain("konclui.menu.broadcast");

            store<boolean>(megaphoneCanBeUsedStore).set(false);
            flushSync();
            expect(target.querySelector('[data-testid="office-menu-broadcast"]')).toBeNull();

            userIsAdminStore.set(true);
            flushSync();
            expect(row("broadcast")).toBeTruthy();
        });
    });

    describe("your status", () => {
        it("marks the status upstream shows", () => {
            store<AvailabilityStatus>(availabilityStatusStore).set(AvailabilityStatus.DO_NOT_DISTURB);

            open();

            expect(
                rows()
                    .slice(0, 4)
                    .map((element) => element.getAttribute("aria-checked")),
            ).toEqual(["false", "false", "false", "true"]);
        });

        it("writes the choice with the setter upstream's status list uses, and shows the new mark as the status follows", () => {
            open();

            click(row("status-busy"));

            expect(resetAllStatusStoreExcept).toHaveBeenCalledExactlyOnceWith(AvailabilityStatus.BUSY);
            store<AvailabilityStatus>(availabilityStatusStore).set(AvailabilityStatus.BUSY);
            flushSync();
            expect(row("status-busy").getAttribute("aria-checked")).toBe("true");
            expect(row("status-online").getAttribute("aria-checked")).toBe("false");
            expect(panel()).not.toBeNull();
        });

        it("clears the request when you choose available again", () => {
            store<AvailabilityStatus>(availabilityStatusStore).set(AvailabilityStatus.BUSY);
            open();

            click(row("status-online"));

            expect(resetAllStatusStoreExcept).toHaveBeenCalledExactlyOnceWith(null);
        });

        it("keeps the rows focusable but inert, with the reason in view, while a call decides the status", () => {
            store<AvailabilityStatus>(availabilityStatusStore).set(AvailabilityStatus.LIVEKIT);
            open();

            const busy = row("status-busy");
            click(busy);

            expect(busy.getAttribute("aria-disabled")).toBe("true");
            expect(busy.hasAttribute("disabled")).toBe(false);
            expect(resetAllStatusStoreExcept).not.toHaveBeenCalled();
            const reason = target.querySelector(`#${busy.getAttribute("aria-describedby")}`);
            expect(reason?.textContent).toBe("konclui.menu.statusLocked");
            busy.focus();
            expect(document.activeElement).toBe(busy);
        });

        it("shows no reason, and no inert row, when nothing decides the status", () => {
            open();

            expect(target.textContent).not.toContain("konclui.menu.statusLocked");
            expect(row("status-busy").getAttribute("aria-disabled")).toBe("false");
        });
    });

    describe("the keyboard", () => {
        it("puts the focus on the first row when it opens, and only that row in the tab order", () => {
            open();

            expect(document.activeElement).toBe(rows()[0]);
            expect(rows().map((element) => element.tabIndex)).toEqual([
                0,
                ...rows()
                    .slice(1)
                    .map(() => -1),
            ]);
        });

        it("moves between the rows with the arrow keys, wrapping at the ends, and keeps the focused row in the tab order", () => {
            open();

            press(rows()[0], "ArrowDown");
            expect(document.activeElement).toBe(rows()[1]);
            expect(rows()[1].tabIndex).toBe(0);
            expect(rows()[0].tabIndex).toBe(-1);

            press(rows()[1], "ArrowUp");
            press(rows()[0], "ArrowUp");
            expect(document.activeElement).toBe(rows()[rows().length - 1]);

            press(rows()[rows().length - 1], "ArrowDown");
            expect(document.activeElement).toBe(rows()[0]);
        });

        it("jumps to the first and last rows with Home and End", () => {
            open();

            press(rows()[0], "End");
            expect(document.activeElement).toBe(rows()[rows().length - 1]);

            press(rows()[rows().length - 1], "Home");
            expect(document.activeElement).toBe(rows()[0]);
        });

        it("does not move the page's scroll or the game for the keys it takes", () => {
            open();
            const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });

            rows()[0].dispatchEvent(event);

            expect(event.defaultPrevented).toBe(true);
        });

        it("closes on Esc and gives the focus back to the logo", () => {
            open();
            press(rows()[2], "ArrowDown");

            press(rows()[3], "Escape");

            expect(panel()).toBeNull();
            expect(document.activeElement).toBe(logo);
        });

        it("closes on Esc when the focus is on the page, as after a press on the panel's own background", () => {
            open();
            (document.activeElement as HTMLElement).blur();

            press(document.body, "Escape");

            expect(panel()).toBeNull();
            expect(document.activeElement).toBe(logo);
        });

        it("closes on Tab, with the focus on the logo so Tab goes on from there", () => {
            open();

            press(rows()[0], "Tab");

            expect(panel()).toBeNull();
            expect(document.activeElement).toBe(logo);
        });

        it("activates the row that holds the focus", () => {
            open();
            press(rows()[0], "ArrowDown");

            // A real browser turns Enter on a button into a click: jsdom does it for a click only.
            click(document.activeElement as HTMLElement);

            expect(resetAllStatusStoreExcept).toHaveBeenCalledExactlyOnceWith(AvailabilityStatus.BUSY);
        });
    });

    describe("a press outside", () => {
        const pressDown = (element: Element) => {
            element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            flushSync();
        };

        it("closes the menu and leaves the focus where the press put it", () => {
            const elsewhere = document.createElement("button");
            document.body.append(elsewhere);
            open();
            elsewhere.focus();

            pressDown(elsewhere);

            expect(panel()).toBeNull();
            expect(document.activeElement).toBe(elsewhere);
        });

        it("keeps it open for a press inside the panel", () => {
            open();

            pressDown(row("status-busy"));

            expect(panel()).not.toBeNull();
        });

        it("leaves a press on the logo to the logo, so its own press closes the menu and does not reopen it", () => {
            open();

            pressDown(logo);
            expect(panel()).not.toBeNull();

            toggleOfficeMenu(logo);
            flushSync();
            expect(panel()).toBeNull();
        });
    });

    describe("the rows that leave the menu", () => {
        it("opens the preferences on the general section and returns to the logo when they close", () => {
            open();

            click(row("settings"));

            expect(panel()).toBeNull();
            expect(get(preferencesStore)).toEqual({ open: true, pane: "general" });
            closePreferences();
            expect(document.activeElement).toBe(logo);
        });

        it.each([
            ["editName", "openNameEditor"],
            ["avatar", "openWokaEditor"],
            ["companion", "openCompanionEditor"],
        ] as const)("opens the %s editor through the scene command and closes", (name, command) => {
            open();

            click(row(name));

            expect(commands[command]).toHaveBeenCalledOnce();
            expect(panel()).toBeNull();
        });

        it("opens the camera and microphone screen through the scene command, and closes", () => {
            open();

            click(row("cameraMicrophone"));

            expect(openCameraScene).toHaveBeenCalledOnce();
            expect(panel()).toBeNull();
        });

        it("switches the map editor on with its tool when its row is pressed", () => {
            store<boolean>(mapEditorMenuVisibleStore).set(true);
            open();

            click(row("mapEditor"));

            expect(get(mapEditorModeStore)).toBe(true);
            expect(equip).toHaveBeenCalledExactlyOnceWith("editor");
            expect(panel()).toBeNull();
        });

        it("marks the editor and the explorer rows as toggles that say whether they are on", () => {
            store<boolean>(mapEditorMenuVisibleStore).set(true);
            store<boolean>(mapManagerActivated).set(true);
            mapEditorModeStore.switchMode(true);
            open();

            expect(row("mapEditor").getAttribute("role")).toBe("menuitemcheckbox");
            expect(row("mapEditor").getAttribute("aria-checked")).toBe("true");
            expect(row("explore").getAttribute("aria-checked")).toBe("false");
            mapEditorModeStore.switchMode(false);
        });

        it("opens the live sheet from the megaphone row for the megaphone's users", () => {
            store<boolean>(megaphoneCanBeUsedStore).set(true);
            open();

            click(row("broadcast"));

            expect(get(showModalGlobalComminucationVisibilityStore)).toBe("live");
            expect(panel()).toBeNull();
        });

        it("opens the announcement composer from the megaphone row for an administrator without the megaphone", () => {
            userIsAdminStore.set(true);
            open();

            click(row("broadcast"));

            expect(get(showModalGlobalComminucationVisibilityStore)).toBe("text");
        });
    });

    describe("share link", () => {
        const status = () => target.querySelector('[role="status"]');

        it("copies the office link, says so within the menu and keeps the menu open", async () => {
            vi.useFakeTimers();
            try {
                open();
                expect(status()?.textContent).toBe("");

                click(row("shareLink"));
                await vi.advanceTimersByTimeAsync(0);
                flushSync();

                expect(clipboard.writeText).toHaveBeenCalledOnce();
                expect(status()?.textContent).toBe("konclui.menu.linkCopied");
                expect(panel()).not.toBeNull();

                // After 5 s the line shuts; its words stay in it for the length of that (see the motion block).
                await vi.advanceTimersByTimeAsync(5000);
                flushSync();
                expect(status()?.classList.contains("is-open")).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it("says why when the browser refuses, and reports the error", async () => {
            const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
            clipboard.writeText.mockRejectedValue(new Error("denied"));
            open();

            click(row("shareLink"));
            await vi.waitFor(() => expect(status()?.textContent).toBe("konclui.menu.linkCopyFailed"));

            expect(error).toHaveBeenCalledOnce();
            expect(panel()).not.toBeNull();
            error.mockRestore();
        });
    });

    describe("its entrance, its exit and its rows' motion", () => {
        // jsdom has no Web Animations, and the menu's transition then ends at once. This lends it ones that wait.
        let animations: WebAnimationsStub;

        beforeEach(() => {
            animations = stubWebAnimations();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: hover)", media: query }));
        });

        afterEach(() => {
            animations.restore();
            vi.unstubAllGlobals();
        });

        const moving = () => animations.moving();
        const settle = () => animations.settle();
        const finishMoving = () => animations.finishMoving();
        const openAndSettle = async () => {
            open();
            await settle();
            await finishMoving();
            // What the next step starts is all the test then counts.
            animations.restore();
            animations = stubWebAnimations();
        };

        it("arrives by the surface transition, not by the entrance class, from the logo", async () => {
            open();
            await settle();

            expect(panel()?.classList.contains("k-enter")).toBe(false);
            expect(moving().map((animation) => animation.options.duration)).toEqual([290]);
        });

        it("stays in the page for the length of its exit, out of reach, with the focus already on the logo", async () => {
            await openAndSettle();

            press(rows()[2], "Escape");
            await settle();

            expect(panel()).not.toBeNull();
            expect(panel()?.inert).toBe(true);
            expect(document.activeElement).toBe(logo);
            expect(moving().map((animation) => animation.options.duration)).toEqual([200]);
            await finishMoving();
            expect(panel()).toBeNull();
            expect(document.activeElement).toBe(logo);
        });

        it("leaves for a press elsewhere without taking the focus from where the press put it", async () => {
            const elsewhere = document.createElement("button");
            document.body.append(elsewhere);
            await openAndSettle();
            elsewhere.focus();

            elsewhere.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            flushSync();
            await settle();

            expect(panel()).not.toBeNull();
            expect(document.activeElement).toBe(elsewhere);
            await finishMoving();
            expect(panel()).toBeNull();
            expect(document.activeElement).toBe(elsewhere);
        });

        it("keeps its keys while it leaves: a key pressed in the exit does nothing to the closed menu", async () => {
            await openAndSettle();
            closeOfficeMenu({ returnFocus: true });
            flushSync();
            await settle();
            const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });

            rows()[0].dispatchEvent(event);

            expect(event.defaultPrevented).toBe(false);
        });

        it("is the same panel when it is opened again during its exit, and takes the focus on its first row", async () => {
            await openAndSettle();
            const before = panel();
            toggleOfficeMenu(logo);
            flushSync();
            await settle();
            expect(document.activeElement).toBe(logo);

            toggleOfficeMenu(logo);
            flushSync();
            await settle();

            expect(panel()).toBe(before);
            expect(document.activeElement).toBe(rows()[0]);
            expect(rows().map((element) => element.tabIndex)).toEqual([
                0,
                ...rows()
                    .slice(1)
                    .map(() => -1),
            ]);
        });

        it("leaves at once, in the same flush, for a viewer who reduces motion", async () => {
            await openAndSettle();
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));

            closeOfficeMenu({ returnFocus: true });
            flushSync();

            expect(panel()).toBeNull();
            expect(moving()).toHaveLength(0);
        });

        it("has one pill under its rows, which carry the press", async () => {
            open();
            await settle();

            const list = target.querySelector('[role="menu"]');
            expect(list?.classList.contains("k-glide")).toBe(true);
            expect(list?.classList.contains("k-glide-on")).toBe(true);
            expect(list?.querySelectorAll(".k-glide-pill")).toHaveLength(1);
            expect(list?.querySelector(".k-glide-pill")?.getAttribute("aria-hidden")).toBe("true");
            expect(rows().every((element) => element.classList.contains("k-press"))).toBe(true);
            // The pill is not a menu item: the arrow keys and the roving tab index count rows only.
            expect(rows()).toHaveLength(10);
        });

        it("has no pill where there is no hover, and the rows keep their own", async () => {
            vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
            open();
            await settle();

            expect(target.querySelector(".k-glide-pill")).toBeNull();
            expect(target.querySelector('[role="menu"]')?.classList.contains("k-glide-on")).toBe(false);
        });

        it("grows the notice's line in as a disclosure, and shuts it when the notice goes", async () => {
            vi.useFakeTimers();
            try {
                open();
                const slot = () => target.querySelector(".feedback-slot");
                expect(slot()?.classList.contains("k-disclosure")).toBe(true);
                expect(slot()?.classList.contains("is-open")).toBe(false);

                click(row("shareLink"));
                await vi.advanceTimersByTimeAsync(0);
                flushSync();
                expect(slot()?.classList.contains("is-open")).toBe(true);
                expect(slot()?.getAttribute("role")).toBe("status");
                expect(slot()?.querySelector(".k-disclosure-body .feedback")?.textContent).toBe(
                    "konclui.menu.linkCopied",
                );

                await vi.advanceTimersByTimeAsync(5000);
                flushSync();
                expect(slot()?.classList.contains("is-open")).toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });

        it("keeps the notice's words in the line while it shuts, so the line is seen to leave", async () => {
            vi.useFakeTimers();
            try {
                open();
                click(row("shareLink"));
                await vi.advanceTimersByTimeAsync(0);
                flushSync();
                const slot = () => target.querySelector(".feedback-slot");
                const words = () => slot()?.querySelector(".feedback")?.textContent;
                expect(words()).toBe("konclui.menu.linkCopied");

                await vi.advanceTimersByTimeAsync(5000);
                flushSync();

                expect(slot()?.classList.contains("is-open")).toBe(false);
                expect(words()).toBe("konclui.menu.linkCopied");
            } finally {
                vi.useRealTimers();
            }
        });

        it("keeps the failure's words, and its colour, in the line while it shuts", async () => {
            clipboard.writeText.mockRejectedValue(new Error("denied"));
            const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
            vi.useFakeTimers();
            try {
                open();
                click(row("shareLink"));
                await vi.advanceTimersByTimeAsync(0);
                flushSync();
                const line = () => target.querySelector(".feedback");
                expect(line()?.classList.contains("failed")).toBe(true);

                await vi.advanceTimersByTimeAsync(5000);
                flushSync();

                expect(target.querySelector(".feedback-slot")?.classList.contains("is-open")).toBe(false);
                expect(line()?.textContent).toBe("konclui.menu.linkCopyFailed");
                expect(line()?.classList.contains("failed")).toBe(true);
            } finally {
                vi.useRealTimers();
                error.mockRestore();
            }
        });

        it("keeps the notice's words while the menu leaves, and loses them when it is opened again", async () => {
            open();
            click(row("shareLink"));
            await vi.waitFor(() =>
                expect(target.querySelector(".feedback")?.textContent).toBe("konclui.menu.linkCopied"),
            );
            await settle();
            await finishMoving();

            closeOfficeMenu({ returnFocus: true });
            flushSync();
            await settle();

            // The panel is held for the exit, and what it said stays in it as it leaves.
            expect(panel()).not.toBeNull();
            expect(target.querySelector(".feedback")?.textContent).toBe("konclui.menu.linkCopied");

            toggleOfficeMenu(logo);
            flushSync();
            await settle();

            expect(target.querySelector(".feedback")?.textContent).toBe("");
        });
    });

    it("forgets the notice when it closes, and opens again without it", async () => {
        open();
        click(row("shareLink"));
        await vi.waitFor(() =>
            expect(target.querySelector('[role="status"]')?.textContent).toBe("konclui.menu.linkCopied"),
        );

        closeOfficeMenu({ returnFocus: true });
        flushSync();
        openOfficeMenu(logo);
        flushSync();

        expect(target.querySelector('[role="status"]')?.textContent).toBe("");
    });
});
