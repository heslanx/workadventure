// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";
import { Subject } from "rxjs";
import type { Room } from "../../../Connection/Room";

// What the shell does to the chat decides when a message counts as seen and how it is signalled, so this test drives the
// real chat room, the real notification policy and the real stores, and the shell through its own functions. Only the
// game manager, the game scene module and the Matrix security are replaced: they reach the scene and the network.
const managed = vi.hoisted((): { room: Room | undefined } => ({ room: undefined }));
const playSound = vi.hoisted(() => vi.fn());

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: () => ({ room: managed.room, playSound }) },
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

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
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
import { chatNotificationStore } from "../../../Stores/ProximityNotificationStore";
import { navChat } from "../../../Chat/Stores/ChatStore";
import { selectedRoomStore } from "../../../Chat/Stores/SelectRoomStore";
import { ProximityChatRoom } from "../../../Chat/Connection/Proximity/ProximityChatRoom";
import { closeSidePanel, followShell, sidePanelStore, toggleChat, togglePeople } from "./sidePanelStore";

// The browser's notifications are not there in the test, and the chat asks them whether they are allowed.
vi.stubGlobal("Notification", { permission: "denied" });

const errorScreen = errorScreenStore as unknown as Writable<object | undefined>;

function createRoom(id: string): ProximityChatRoom {
    return new ProximityChatRoom(
        id,
        id,
        "default",
        "recipient",
        { leaveSpace: vi.fn().mockResolvedValue(undefined) } as never,
        { newChatMessageWritingStatusStream: new Subject() },
        { getPlayers: () => new Map() } as never,
        {
            playBubbleInSound: vi.fn(),
            playBubbleOutSound: vi.fn(),
            playMeetingInSound: vi.fn(),
            playMeetingOutSound: vi.fn(),
        },
        undefined,
        [],
    );
}

/** A file that somebody sends to the room: whether the room counts it as seen depends on the chat being open on it. */
function receiveFile(room: ProximityChatRoom): void {
    Reflect.get(room, "addIncomingFileOffer").call(room, {
        transferId: "transfer-1",
        fileName: "menu.txt",
        mimeType: "text/plain",
        size: 5,
        characterTextures: [],
        name: "Sender",
        senderSpaceUserId: "sender",
    });
}

/** A text message from somebody else: the sound of the notification plan follows the chat being open on its room. */
function receiveText(room: ProximityChatRoom): void {
    Reflect.get(room, "addNewMessage").call(room, "Lunch at noon?", "sender", [], "Sender");
}

function enterOffice(): void {
    const office = {
        id: "office",
        metadata: undefined,
        isChatOnlineListEnabled: true,
        isChatDisconnectedListEnabled: false,
    } as unknown as Room;
    managed.room = office;
    currentRoomStore.set(office);
    gameSceneIsLoadedStore.set(true);
}

let stopFollowing: (() => void) | undefined;

beforeEach(() => {
    loadLocale("en-US");
    setLocale("en-US");
    playSound.mockClear();
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
    selectedRoomStore.set(undefined);
    chatNotificationStore.clearAll();
    enterOffice();
    stopFollowing = followShell(() => false);
});

afterEach(() => {
    stopFollowing?.();
    stopFollowing = undefined;
    closeSidePanel();
    closeSidePanel();
});

describe("a file that arrives while the side panel is open", () => {
    it("is seen when the panel shows the conversation of its room: not counted, no notification", () => {
        const room = createRoom("lunch");
        selectedRoomStore.set(room);
        toggleChat();
        expect(get(sidePanelStore).view).toBe("conversation");

        receiveFile(room);

        expect(get(room.unreadMessagesCount)).toBe(0);
        expect(get(chatNotificationStore)).toHaveLength(0);
    });

    it("is not seen when the panel shows the conversation of another room: counted and notified", () => {
        const lunch = createRoom("lunch");
        selectedRoomStore.set(createRoom("standup"));
        toggleChat();

        receiveFile(lunch);

        expect(get(lunch.unreadMessagesCount)).toBe(1);
        expect(get(chatNotificationStore)).toHaveLength(1);
    });

    it("is not seen when the panel is closed: counted and notified", () => {
        const room = createRoom("lunch");

        receiveFile(room);

        expect(get(room.unreadMessagesCount)).toBe(1);
        expect(get(chatNotificationStore)).toHaveLength(1);
    });

    it("is not seen when the panel shows the people, even with the room selected in the chat: counted and notified", () => {
        const room = createRoom("lunch");
        selectedRoomStore.set(room);
        togglePeople();
        expect(get(sidePanelStore).view).toBe("people");

        receiveFile(room);

        expect(get(room.unreadMessagesCount)).toBe(1);
        expect(get(chatNotificationStore)).toHaveLength(1);
    });
});

describe("a text message that arrives while the side panel is open", () => {
    it("makes no sound when the panel shows the conversation of its room", () => {
        const room = createRoom("lunch");
        selectedRoomStore.set(room);
        toggleChat();

        receiveText(room);

        expect(playSound).not.toHaveBeenCalled();
    });

    it("sounds when the panel is closed", () => {
        receiveText(createRoom("lunch"));

        expect(playSound).toHaveBeenCalledWith("new-message");
    });

    it("sounds as it does with the panel closed when the panel shows the people", () => {
        const room = createRoom("lunch");
        selectedRoomStore.set(room);
        togglePeople();

        receiveText(room);

        expect(playSound).toHaveBeenCalledWith("new-message");
    });
});
