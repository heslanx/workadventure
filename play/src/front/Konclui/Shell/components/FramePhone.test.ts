// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import type { Writable } from "svelte/store";
import type { Room } from "../../../Connection/Room";

// The shell on a phone with its real side panel, people panel and pill. What reaches the scene, the chat and the rest of the
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
vi.mock("../../Presence/stores/peopleListStore", async () => {
    const { writable } = await import("svelte/store");
    return { peoplePanelStore: writable({}) };
});
vi.mock("../../Presence/stores/worldRoster", async () => {
    const { writable } = await import("svelte/store");
    return { rosterListOpenStore: writable(false), chooseEveryone: vi.fn() };
});
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
import { peoplePanelStore } from "../../Presence/stores/peopleListStore";
import type { PeoplePanelState } from "../../Presence/stores/peopleListStore";
import { clearWalkNotice, installPresenceCommands } from "../../Presence/stores/presenceCommands";
import { closeSidePanel, togglePeople } from "../stores/sidePanelStore";
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

const panelStore = peoplePanelStore as unknown as Writable<PeoplePanelState>;
const ROOM = "https://office.example/map";

const panelState = (elsewhere = false): PeoplePanelState => ({
    phase: "ready",
    mode: "everyone",
    count: 2,
    me: undefined,
    rows: [
        {
            key: `${ROOM}_2`,
            uuid: "account-2",
            playUri: ROOM,
            name: "Ana",
            place: undefined,
            status: 1,
            elsewhere,
            roomName: undefined,
        },
    ],
    users: new Map(),
    cutOf: undefined,
    empty: undefined,
    canChooseEveryone: false,
    searching: false,
});

describe("the people sheet on a phone: Ir ate", () => {
    const target = document.createElement("div");
    let frame: ReturnType<typeof mount> | undefined;
    let walkTo: ReturnType<typeof vi.fn<(target: { uuid: string; playUri: string }) => void>>;

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
        clearWalkNotice();
        walkTo = vi.fn<(target: { uuid: string; playUri: string }) => void>();
        installPresenceCommands({ walkTo });
        panelStore.set(panelState());
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    });

    afterEach(async () => {
        const mounted = frame;
        frame = undefined;
        if (mounted) await unmount(mounted);
        target.replaceChildren();
        clearWalkNotice();
    });

    function drawShell() {
        const room = office(true);
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

    const pill = () => {
        const button = target.querySelector<HTMLButtonElement>(".people-slot button");
        if (!button) throw new Error("no people pill");
        return button;
    };
    const row = () => {
        const button = target.querySelector<HTMLButtonElement>("[data-person-row]");
        if (!button) throw new Error("no row");
        return button;
    };
    const sheetOpen = () => target.querySelector("[data-person-row]") !== null;
    const live = () => target.querySelector("[data-walk-notice-live]");

    it("closes the sheet as the walk starts, so the walk can be seen on the map", () => {
        drawShell();
        togglePeople();
        flushSync();
        expect(sheetOpen()).toBe(true);

        row().click();
        flushSync();

        expect(walkTo).toHaveBeenCalledTimes(1);
        expect(sheetOpen()).toBe(false);
        // The card is not in the page once it has left: there is no hidden card to come back from `display: none`.
        expect(target.querySelector("aside")).toBeNull();
    });

    it("keeps announcing the walk after the sheet is gone, in a polite live region that was already on the page", () => {
        drawShell();
        const region = live();
        expect(region?.getAttribute("role")).toBe("status");
        expect(region?.getAttribute("aria-live")).toBe("polite");
        togglePeople();
        flushSync();

        row().click();
        flushSync();

        expect(sheetOpen()).toBe(false);
        expect(live()).toBe(region);
        expect(live()?.textContent).toBe('konclui.peopleList.going{"name":"Ana"}');
    });

    it("gives the focus to the pill that reopens the people panel when it was on the row that was pressed", () => {
        drawShell();
        togglePeople();
        flushSync();
        row().focus();

        row().click();
        flushSync();

        expect(document.activeElement).toBe(pill());
    });

    it("keeps the panel open on a wide screen, where the walk is seen beside it", () => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
        drawShell();
        // A wide screen opens the people of the room on entering it.
        expect(sheetOpen()).toBe(true);

        row().click();
        flushSync();

        expect(walkTo).toHaveBeenCalledTimes(1);
        expect(sheetOpen()).toBe(true);
        expect(live()?.textContent).toBe('konclui.peopleList.going{"name":"Ana"}');
    });

    it("keeps the sheet open for a person of another room, where no walk starts", () => {
        panelStore.set(panelState(true));
        drawShell();
        togglePeople();
        flushSync();

        row().click();
        flushSync();

        expect(walkTo).not.toHaveBeenCalled();
        expect(sheetOpen()).toBe(true);
    });
});
