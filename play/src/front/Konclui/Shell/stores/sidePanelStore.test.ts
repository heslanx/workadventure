// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";
import type { Room } from "../../../Connection/Room";
import type { GameScene } from "../../../Phaser/Game/GameScene";

// The room the game manager reports. The chat reads it to decide whether the user list exists.
const managed = vi.hoisted((): { room: Room | undefined } => ({ room: undefined }));

// These modules reach the media devices, the game manager, the chat connection and the API client.
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => ({ room: managed.room }) },
}));
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Chat/Connection/Matrix/getMatrixSecurity", () => ({ getMatrixSecurity: vi.fn() }));
vi.mock("../../../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { enableCameraSceneVisibilityStore: writable(false) };
});
vi.mock("../../../Stores/PwaInstallStore", async () => {
    const { writable } = await import("svelte/store");
    return { pwaInstallSceneVisibleStore: writable(false) };
});
vi.mock("../../../Stores/ErrorScreenStore", async () => {
    const { writable } = await import("svelte/store");
    return { errorScreenStore: writable(undefined) };
});

import { currentRoomStore } from "../../../Stores/CurrentRoomStore";
import { gameSceneIsLoadedStore, gameSceneStore } from "../../../Stores/GameSceneStore";
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
import {
    closeRosterNotice,
    closeSidePanel,
    followShell,
    showPeople,
    sidePanelStore,
    toggleChat,
    togglePeople,
} from "./sidePanelStore";

const cameraScene = enableCameraSceneVisibilityStore as unknown as Writable<boolean>;
const errorScreen = errorScreenStore as unknown as Writable<object | undefined>;

/** What the shell reads from a room, plus the two switches of the chat's user list. */
function room(id: string, hasPeopleList: boolean): Room {
    return {
        id,
        metadata: undefined,
        isChatOnlineListEnabled: hasPeopleList,
        isChatDisconnectedListEnabled: false,
    } as unknown as Room;
}

/** Runs the scene of `next`: the shell is drawn for it as soon as its scene is loaded. */
function enterRoom(next: Room): void {
    managed.room = next;
    currentRoomStore.set(next);
    gameSceneStore.set({ room: next } as unknown as GameScene);
    gameSceneIsLoadedStore.set(true);
}

let wideScreen = true;
let stopFollowing: (() => void) | undefined;

/** Starts the reactions the way the shell does, once; the test stops them if it has not. */
function follow(): () => void {
    stopFollowing = followShell(() => wideScreen);
    return stopFollowing;
}

const view = () => get(sidePanelStore).view;
const noticeOpen = () => get(sidePanelStore).rosterNoticeOpen;

beforeEach(() => {
    wideScreen = true;
    currentRoomStore.set(undefined);
    gameSceneStore.set(undefined);
    gameSceneIsLoadedStore.set(false);
    loaderVisibleStore.set(false);
    loginSceneVisibleStore.set(false);
    selectCharacterSceneVisibleStore.set(false);
    selectCompanionSceneVisibleStore.set(false);
    cameraScene.set(false);
    pwaInstallSceneVisibleStore.set(false);
    errorStore.clearClosableMessages();
    errorScreen.set(undefined);
    mapDeletedPromptStore.set(false);
    chatVisibilityStore.set(false);
    navChat.switchToChat();
    // The people panel and the notice are the module's own state: close what an earlier test left open.
    closeSidePanel();
    closeRosterNotice();
});

afterEach(() => {
    stopFollowing?.();
    stopFollowing = undefined;
});

describe("togglePeople", () => {
    it("opens the people panel in a room with a people list, and closes it when it is shown", () => {
        enterRoom(room("office", true));

        togglePeople();
        expect(view()).toBe("people");

        togglePeople();
        expect(view()).toBe("closed");
    });

    it("opens the people panel without making the chat visible or choosing its tab", () => {
        enterRoom(room("office", true));

        togglePeople();

        expect(get(chatVisibilityStore)).toBe(false);
        expect(get(navChat).key).toBe("chat");
    });

    it("moves from the conversation to the people panel, and hides the chat", () => {
        enterRoom(room("office", true));
        toggleChat();
        expect(view()).toBe("conversation");

        togglePeople();

        expect(view()).toBe("people");
        expect(get(chatVisibilityStore)).toBe(false);
    });

    it("shows the notice in a room without a people list, and closes it when it is shown", () => {
        enterRoom(room("lobby", false));

        togglePeople();
        expect(noticeOpen()).toBe(true);
        expect(view()).toBe("people");
        expect(get(chatVisibilityStore)).toBe(false);

        togglePeople();
        expect(noticeOpen()).toBe(false);
        expect(view()).toBe("closed");
    });

    it("opens nothing on entering a room without a people list, on a wide screen", () => {
        follow();
        enterRoom(room("lobby", false));

        expect(view()).toBe("closed");
        expect(noticeOpen()).toBe(false);
        expect(get(chatVisibilityStore)).toBe(false);
    });
});

describe("showPeople", () => {
    it("opens the people panel and says the list is on screen", () => {
        enterRoom(room("office", true));

        expect(showPeople()).toBe(true);
        expect(view()).toBe("people");
    });

    it("keeps the panel open when it already is, where togglePeople would close it", () => {
        enterRoom(room("office", true));
        togglePeople();

        expect(showPeople()).toBe(true);
        expect(view()).toBe("people");
    });

    it("replaces the conversation with the panel", () => {
        enterRoom(room("office", true));
        toggleChat();

        expect(showPeople()).toBe(true);
        expect(view()).toBe("people");
        expect(get(chatVisibilityStore)).toBe(false);
    });

    it("says there is no list in a room without one, which shows its notice instead", () => {
        enterRoom(room("lobby", false));

        expect(showPeople()).toBe(false);
        expect(noticeOpen()).toBe(true);
        expect(showPeople()).toBe(false);
    });
});

describe("the chat taking the panel", () => {
    it("ends the notice, and closing the chat later does not bring it back", () => {
        follow();
        enterRoom(room("lobby", false));
        togglePeople();
        expect(noticeOpen()).toBe(true);

        chatVisibilityStore.set(true);
        expect(noticeOpen()).toBe(false);
        expect(view()).toBe("conversation");

        chatVisibilityStore.set(false);
        expect(noticeOpen()).toBe(false);
        expect(view()).toBe("closed");
    });

    it("ends the people panel, and closing the chat later does not bring it back", () => {
        wideScreen = false;
        follow();
        enterRoom(room("office", true));
        togglePeople();
        expect(view()).toBe("people");

        chatVisibilityStore.set(true);
        expect(view()).toBe("conversation");

        chatVisibilityStore.set(false);
        expect(view()).toBe("closed");
    });
});

describe("a chat that upstream opens without choosing a tab", () => {
    beforeEach(() => {
        // The user list was left on screen by something that ran while the shell was covered, so nobody chose it since.
        wideScreen = false;
        follow();
        const office = room("office", true);
        managed.room = office;
        navChat.switchToUserList();
        enterRoom(office);
        expect(view()).toBe("closed");
        expect(get(navChat).key).toBe("users");
    });

    it("moves from the leftover user list to the conversation", () => {
        chatVisibilityStore.set(true);

        expect(get(navChat).key).toBe("chat");
        expect(view()).toBe("conversation");
    });

    it("is left alone while the shell is inactive", () => {
        loaderVisibleStore.set(true);
        chatVisibilityStore.set(true);

        expect(get(navChat).key).toBe("users");
        expect(get(chatVisibilityStore)).toBe(true);
    });
});

describe("a request for the chat's user list", () => {
    beforeEach(() => {
        wideScreen = false;
        follow();
        enterRoom(room("office", true));
    });

    it("opens the people panel instead of the user list of the chat, when it is chosen before the chat is shown", () => {
        navChat.switchToUserList();
        chatVisibilityStore.set(true);

        expect(view()).toBe("people");
        expect(get(chatVisibilityStore)).toBe(false);
    });

    it("opens the people panel when the chat is already shown and its own button asks for the list", () => {
        toggleChat();
        expect(view()).toBe("conversation");

        navChat.switchToUserList();

        expect(view()).toBe("people");
        expect(get(chatVisibilityStore)).toBe(false);
    });

    it("is not a request while the chat is hidden: choosing the tab alone opens nothing", () => {
        navChat.switchToUserList();

        expect(view()).toBe("closed");
        expect(get(chatVisibilityStore)).toBe(false);
    });

    it("stays on the conversation in a room without a people list, whose chat refuses the user list", () => {
        enterRoom(room("lobby", false));
        navChat.switchToUserList();
        chatVisibilityStore.set(true);

        // The chat refuses the tab in a room without lists: it stays on the conversation.
        expect(get(navChat).key).toBe("chat");
        expect(view()).toBe("conversation");
    });
});

describe("entering a room", () => {
    it("opens the people panel of the room on a wide screen, without the chat", () => {
        follow();
        enterRoom(room("office", true));

        expect(view()).toBe("people");
        expect(get(chatVisibilityStore)).toBe(false);
        expect(get(navChat).key).toBe("chat");
    });

    it("opens nothing on a narrow screen", () => {
        wideScreen = false;
        follow();
        enterRoom(room("office", true));

        expect(view()).toBe("closed");
    });

    it("opens nothing while a chat is already visible", () => {
        chatVisibilityStore.set(true);
        follow();
        enterRoom(room("office", true));

        expect(get(navChat).key).toBe("chat");
        expect(view()).toBe("conversation");
    });

    it("waits for the shell to be drawn", () => {
        const office = room("office", true);
        follow();
        managed.room = office;
        gameSceneStore.set({ room: office } as unknown as GameScene);
        expect(view()).toBe("closed");

        gameSceneIsLoadedStore.set(true);
        expect(view()).toBe("people");
    });

    it("opens once per room, and again for another room", () => {
        follow();
        const office = room("office", true);
        enterRoom(office);
        expect(view()).toBe("people");

        togglePeople();
        expect(view()).toBe("closed");

        // The chrome drawn again over the same room is not another entry.
        loaderVisibleStore.set(true);
        loaderVisibleStore.set(false);
        expect(view()).toBe("closed");

        enterRoom(room("garden", true));
        expect(view()).toBe("people");
    });

    it("clears the notice of the previous room", () => {
        follow();
        enterRoom(room("lobby", false));
        togglePeople();
        expect(noticeOpen()).toBe(true);

        enterRoom(room("hall", false));
        expect(noticeOpen()).toBe(false);
        expect(view()).toBe("closed");
    });
});

describe("followShell on a shell that is already drawn", () => {
    it("opens the people panel of the room at once on a wide screen", () => {
        enterRoom(room("office", true));

        follow();

        expect(view()).toBe("people");
        expect(get(chatVisibilityStore)).toBe(false);
    });

    it("opens nothing at once on a narrow screen", () => {
        wideScreen = false;
        enterRoom(room("office", true));

        follow();

        expect(get(chatVisibilityStore)).toBe(false);
        expect(view()).toBe("closed");
    });
});

describe("a new run of followShell", () => {
    it("starts with the notice closed, one that the earlier run raised included", () => {
        const stopEarlierRun = follow();
        enterRoom(room("lobby", false));
        togglePeople();
        expect(noticeOpen()).toBe(true);
        stopEarlierRun();
        // The chrome is covered, so the reactions to the room and the chat cannot be what closes the notice.
        loaderVisibleStore.set(true);

        follow();

        expect(noticeOpen()).toBe(false);
    });

    it("starts with the people panel closed", () => {
        const stopEarlierRun = follow();
        enterRoom(room("office", true));
        expect(view()).toBe("people");
        stopEarlierRun();
        loaderVisibleStore.set(true);

        follow();

        expect(view()).toBe("closed");
    });
});

describe("toggleChat", () => {
    it("closes a shown conversation", () => {
        enterRoom(room("office", true));
        toggleChat();
        expect(view()).toBe("conversation");

        toggleChat();
        expect(get(chatVisibilityStore)).toBe(false);
        expect(view()).toBe("closed");
    });

    it("switches to the chat tab and shows it when the panel is closed or shows the people", () => {
        enterRoom(room("office", true));
        toggleChat();
        expect(get(navChat).key).toBe("chat");
        expect(get(chatVisibilityStore)).toBe(true);

        togglePeople();
        expect(view()).toBe("people");

        toggleChat();
        expect(get(navChat).key).toBe("chat");
        expect(view()).toBe("conversation");
    });

    it("ends the notice", () => {
        enterRoom(room("lobby", false));
        togglePeople();
        expect(noticeOpen()).toBe(true);

        toggleChat();
        expect(noticeOpen()).toBe(false);
        expect(view()).toBe("conversation");
    });

    it("ends the people panel", () => {
        enterRoom(room("office", true));
        togglePeople();

        toggleChat();

        expect(view()).toBe("conversation");
        togglePeople();
        expect(view()).toBe("people");
    });
});

describe("closeSidePanel", () => {
    it("closes the chat first, then the people panel, and reports which", () => {
        enterRoom(room("office", true));
        togglePeople();
        // Without the reactions of followShell the panel stays open under a chat that opens.
        chatVisibilityStore.set(true);

        expect(closeSidePanel()).toBe("chat");
        expect(get(chatVisibilityStore)).toBe(false);
        expect(view()).toBe("people");

        expect(closeSidePanel()).toBe("people");
        expect(view()).toBe("closed");
    });

    it("closes the chat first, then the notice, and reports which", () => {
        enterRoom(room("lobby", false));
        togglePeople();
        // Without the reactions of followShell the notice stays open under a chat that opens.
        chatVisibilityStore.set(true);
        expect(noticeOpen()).toBe(true);

        expect(closeSidePanel()).toBe("chat");
        expect(get(chatVisibilityStore)).toBe(false);
        expect(noticeOpen()).toBe(true);

        expect(closeSidePanel()).toBe("notice");
        expect(noticeOpen()).toBe(false);
    });

    it("reports nothing when nothing is open", () => {
        enterRoom(room("office", true));

        expect(closeSidePanel()).toBeUndefined();
        expect(view()).toBe("closed");
    });
});

describe("the function followShell returns", () => {
    it("stops the chat from ending the notice", () => {
        enterRoom(room("lobby", false));
        const stop = follow();
        togglePeople();
        stop();

        chatVisibilityStore.set(true);
        expect(noticeOpen()).toBe(true);
    });

    it("stops the move away from the leftover user list", () => {
        wideScreen = false;
        const office = room("office", true);
        managed.room = office;
        navChat.switchToUserList();
        enterRoom(office);
        const stop = follow();
        stop();

        chatVisibilityStore.set(true);
        expect(get(navChat).key).toBe("users");
    });

    it("stops the request for the people from the chat's user list", () => {
        wideScreen = false;
        enterRoom(room("office", true));
        const stop = follow();
        stop();

        navChat.switchToUserList();
        chatVisibilityStore.set(true);

        expect(view()).toBe("conversation");
        expect(get(chatVisibilityStore)).toBe(true);
    });

    it("stops the opening on entering a room", () => {
        const stop = follow();
        stop();

        enterRoom(room("office", true));
        expect(view()).toBe("closed");
    });
});
