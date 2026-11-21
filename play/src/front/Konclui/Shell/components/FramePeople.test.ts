// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { get, writable, type Writable } from "svelte/store";
import type { Room } from "../../../Connection/Room";
import type { SpaceInterface } from "../../../Space/SpaceInterface";

// The shell with its real side panel, people panel and stores. What reaches the scene, the chat and the rest of the
// page is replaced: the game manager and the chat sidebar, the office menu and the two chips over the map.
const managed = vi.hoisted((): { room: Room | undefined } => ({ room: undefined }));

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => ({ room: managed.room }) },
}));
vi.mock("../../../Phaser/Game/GameScene", () => ({}));
vi.mock("../../../Chat/Connection/Matrix/getMatrixSecurity", () => ({ getMatrixSecurity: vi.fn() }));
vi.mock("../../../Stores/PwaInstallStore", async () => {
    const { writable } = await import("svelte/store");
    return { pwaInstallSceneVisibleStore: writable(false) };
});
vi.mock("../../../Stores/ErrorScreenStore", async () => {
    const { writable } = await import("svelte/store");
    return { errorScreenStore: writable(undefined) };
});
vi.mock("../../../Chat/ChatSidebar.svelte", () => ({ default: () => undefined }));
vi.mock("../../OfficeMenu/components/OfficeMenu.svelte", () => ({ default: () => undefined }));
vi.mock("../../Presence/components/PeoplePill.svelte", () => ({ default: () => undefined }));
vi.mock("../../Presence/components/PlaceChip.svelte", () => ({ default: () => undefined }));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const path = (keys: string[]): unknown =>
        new Proxy((values?: unknown) => keys.join(".") + (values === undefined ? "" : JSON.stringify(values)), {
            get: (_target, key) => (typeof key === "string" ? path([...keys, key]) : undefined),
        });
    const LL = readable(path([]));
    return { LL, default: LL, locale: readable("en-US") };
});

import { currentRoomStore } from "../../../Stores/CurrentRoomStore";
import { gameSceneIsLoadedStore } from "../../../Stores/GameSceneStore";
import { loaderVisibleStore } from "../../../Stores/LoaderStore";
import { loginSceneVisibleStore } from "../../../Stores/LoginSceneStore";
import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../../../Stores/SelectCompanionStore";
import { enableCameraSceneVisibilityStore } from "../../../Stores/MediaStore";
import { pwaInstallSceneVisibleStore } from "../../../Stores/PwaInstallStore";
import { errorStore } from "../../../Stores/ErrorStore";
import { errorScreenStore } from "../../../Stores/ErrorScreenStore";
import { mapDeletedPromptStore } from "../../../Stores/MapDeletedPromptStore";
import { chatVisibilityStore } from "../../../Stores/ChatStore";
import { navChat } from "../../../Chat/Stores/ChatStore";
import { closePreferences, openPreferences } from "../../Preferences/stores/preferencesStore";
import { clearSearchFocusRequest, setPeopleQuery } from "../../Presence/stores/peopleSearchStore";
import { publishCrowd } from "../../Presence/stores/crowdStore";
import { attachWorldSpace, rosterListOpenStore } from "../../Presence/stores/worldRoster";
import { closeSidePanel } from "../stores/sidePanelStore";
import Frame from "./Frame.svelte";

const errorScreen = errorScreenStore as unknown as Writable<object | undefined>;

class NoResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", NoResizeObserver);

function office(hasPeopleList: boolean): Room {
    return {
        id: "office",
        metadata: undefined,
        isChatOnlineListEnabled: hasPeopleList,
        isChatDisconnectedListEnabled: false,
    } as unknown as Room;
}

describe("the shell's people panel", () => {
    const target = document.createElement("div");
    let frame: ReturnType<typeof mount> | undefined;

    beforeEach(() => {
        currentRoomStore.set(undefined);
        gameSceneIsLoadedStore.set(false);
        loaderVisibleStore.set(false);
        loginSceneVisibleStore.set(false);
        selectCharacterSceneVisibleStore.set(false);
        selectCompanionSceneVisibleStore.set(false);
        enableCameraSceneVisibilityStore.hideEnableCameraScene();
        pwaInstallSceneVisibleStore.set(false);
        errorStore.clearClosableMessages();
        errorScreen.set(undefined);
        mapDeletedPromptStore.set(false);
        chatVisibilityStore.set(false);
        navChat.switchToChat();
        closeSidePanel();
        closePreferences();
        setPeopleQuery("");
        clearSearchFocusRequest();
        // A phone-sized window, so that entering the room leaves the panel closed and each test opens it itself.
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    });

    afterEach(async () => {
        const mounted = frame;
        frame = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        closePreferences();
    });

    function drawShell(room: Room = office(true)) {
        managed.room = room;
        currentRoomStore.set(room);
        gameSceneIsLoadedStore.set(true);
        document.body.append(target);
        frame = mount(Frame, {
            target,
            props: { children: createRawSnippet(() => ({ render: () => "<div></div>" })) },
        });
        flushSync();
    }

    const searchButton = () => {
        const button = target.querySelector<HTMLButtonElement>(
            'nav.rail button[aria-label="konclui.peopleList.searchLabel"]',
        );
        if (!button) throw new Error("no search button in the rail");
        return button;
    };
    const peopleButton = () => {
        const button = target.querySelector<HTMLButtonElement>('nav.rail button[aria-label="konclui.people"]');
        if (!button) throw new Error("no people button in the rail");
        return button;
    };
    /** The window is wide when the panel closes, as the rail's people button is the one that takes the focus then. */
    const widenWindow = () => Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    const searchField = () => target.querySelector<HTMLInputElement>('input[type="search"]');
    const panelOpen = () => searchField() !== null;
    const press = (element: Element, init: KeyboardEventInit) => {
        const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
        element.dispatchEvent(event);
        flushSync();
        return event;
    };

    describe("the rail's search button", () => {
        it("opens the people panel and puts the focus in its search field", () => {
            drawShell();
            expect(panelOpen()).toBe(false);

            searchButton().click();
            flushSync();

            expect(panelOpen()).toBe(true);
            expect(document.activeElement).toBe(searchField());
        });

        it("focuses and selects the field again when the panel is already open, instead of closing it", () => {
            drawShell();
            searchButton().click();
            flushSync();
            const field = searchField();
            if (!field) throw new Error("no field");
            field.value = "ana";
            field.blur();

            searchButton().click();
            flushSync();

            expect(panelOpen()).toBe(true);
            expect(document.activeElement).toBe(field);
            expect(field.selectionEnd).toBe(3);
        });

        it("says the room has no people list, and takes the focus nowhere, in a room without one", () => {
            drawShell(office(false));

            searchButton().click();
            flushSync();

            expect(panelOpen()).toBe(false);
            expect(target.querySelector('[role="status"]')?.textContent).toBe("konclui.rosterUnavailable");
            expect(target.contains(document.activeElement) && document.activeElement !== searchButton()).toBe(false);
        });
    });

    describe("Ctrl+K", () => {
        it("opens the people panel from the page and focuses the field, and the browser does not get the key", () => {
            drawShell();
            document.body.focus();

            const event = press(document.body, { key: "k", ctrlKey: true });

            expect(event.defaultPrevented).toBe(true);
            expect(panelOpen()).toBe(true);
            expect(document.activeElement).toBe(searchField());
        });

        it("works with ⌘ on a Mac, and in either case of the letter", () => {
            drawShell();

            press(document.body, { key: "K", metaKey: true });

            expect(document.activeElement).toBe(searchField());
        });

        it("selects what the field holds when the field already has the focus", () => {
            drawShell();
            press(document.body, { key: "k", ctrlKey: true });
            const field = searchField();
            if (!field) throw new Error("no field");
            field.value = "ana";
            field.setSelectionRange(3, 3);

            const event = press(field, { key: "k", ctrlKey: true });

            expect(event.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(field);
            expect(field.selectionStart).toBe(0);
            expect(field.selectionEnd).toBe(3);
        });

        it("leaves Ctrl+Shift+K and a plain K to the page", () => {
            drawShell();

            const shifted = press(document.body, { key: "K", ctrlKey: true, shiftKey: true });
            const plain = press(document.body, { key: "k" });

            expect(shifted.defaultPrevented).toBe(false);
            expect(plain.defaultPrevented).toBe(false);
            expect(panelOpen()).toBe(false);
        });

        it("leaves the key alone behind the preferences dialog, which is modal", () => {
            drawShell();
            openPreferences();

            const event = press(document.body, { key: "k", ctrlKey: true });

            expect(event.defaultPrevented).toBe(false);
            expect(panelOpen()).toBe(false);
        });

        it("leaves the key alone while the shell is not drawn", () => {
            drawShell();
            loaderVisibleStore.set(true);
            flushSync();

            const event = press(document.body, { key: "k", ctrlKey: true });

            expect(event.defaultPrevented).toBe(false);
        });
    });

    describe("closing the panel", () => {
        it("gives the focus back to the people button of the rail when Escape closes it from the field", () => {
            drawShell();
            searchButton().click();
            flushSync();
            expect(document.activeElement).toBe(searchField());
            widenWindow();

            press(searchField() as HTMLInputElement, { key: "Escape" });

            expect(panelOpen()).toBe(false);
            expect(document.activeElement).toBe(peopleButton());
        });

        it("clears the text first with Escape, and closes the panel only with the next one", () => {
            drawShell();
            searchButton().click();
            flushSync();
            setPeopleQuery("ana");
            flushSync();

            press(searchField() as HTMLInputElement, { key: "Escape" });
            expect(panelOpen()).toBe(true);
            expect((searchField() as HTMLInputElement).value).toBe("");

            press(searchField() as HTMLInputElement, { key: "Escape" });
            expect(panelOpen()).toBe(false);
        });

        it("gives the focus back to the people button of the rail when the collapse button closes it", () => {
            drawShell();
            searchButton().click();
            flushSync();
            const collapse = target.querySelector<HTMLButtonElement>(".people-panel header button");
            if (!collapse) throw new Error("no collapse button");
            collapse.focus();
            widenWindow();

            collapse.click();
            flushSync();

            expect(panelOpen()).toBe(false);
            expect(document.activeElement).toBe(peopleButton());
        });

        it("does not take the focus when the panel closes while the user plays", () => {
            drawShell();
            searchButton().click();
            flushSync();
            (document.activeElement as HTMLElement).blur();

            closeSidePanel();
            flushSync();

            expect(panelOpen()).toBe(false);
            expect(document.activeElement).toBe(document.body);
        });
    });

    describe("asking for everyone in a big world", () => {
        // A world space that holds 500 people and never answers the list: the roster starts in the near-you mode, and
        // pressing the entry for everyone starts a watch that stays loading.
        const bigWorld = (): SpaceInterface =>
            ({
                state: { store: writable({ headcount: 500 }), isInitialized: () => true },
                usersStore: writable(new Map()),
                getUsers: () =>
                    new Promise<never>(() => {
                        // The pusher never answers: the list stays loading.
                    }),
            }) as unknown as SpaceInterface;

        afterEach(() => {
            publishCrowd(undefined);
        });

        it("keeps the keys of the panel working: the focus stays in it, and Escape still closes it", () => {
            const scene = new AbortController();
            attachWorldSpace(bigWorld(), scene.signal);
            try {
                publishCrowd({
                    roomKey: "office",
                    me: { spaceUserId: "office_1", name: "Eu", place: undefined },
                    people: [],
                });
                drawShell();
                searchButton().click();
                flushSync();
                const entry = target.querySelector<HTMLButtonElement>("button.everyone");
                if (!entry) throw new Error("no entry for everyone");
                entry.focus();

                entry.click();
                flushSync();

                expect(target.querySelector("button.everyone")).toBeNull();
                const focused = document.activeElement;
                expect(focused).not.toBe(document.body);
                expect(target.querySelector(".people-panel")?.contains(focused)).toBe(true);

                press(focused as Element, { key: "Escape" });

                expect(panelOpen()).toBe(false);
            } finally {
                scene.abort();
            }
        });
    });

    describe("the roster's reader", () => {
        it("is the open panel: the world roster is asked for only while it is drawn", () => {
            drawShell();
            expect(get(rosterListOpenStore)).toBe(false);

            searchButton().click();
            flushSync();
            expect(get(rosterListOpenStore)).toBe(true);

            peopleButton().click();
            flushSync();
            expect(get(rosterListOpenStore)).toBe(false);
        });
    });
});
