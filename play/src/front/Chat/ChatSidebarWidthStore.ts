import { derived, writable } from "svelte/store";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { windowSize } from "../Stores/CoWebsiteStore";
import { localUserStore } from "../Connection/LocalUserStore";
import { mapEditorSideBarWidthStore } from "../Components/MapEditor/MapEditorSideBarWidthStore";
import { mapEditorModeStore } from "../Stores/MapEditorStore";
import { sidePanelWidthStore } from "../Stores/SidePanelStore";
import { gameViewportBounds } from "../ExternalModule/ClientExtensionPoints";
import { CHAT_SIDEBAR_MAX_WIDTH, CHAT_SIDEBAR_MIN_WIDTH } from "./ChatSidebarWidth";
import { clampRoomListWidth, ROOM_LIST_DEFAULT_WIDTH } from "./Components/RoomListLayout";

// A full-screen width stored before the cap existed comes back capped.
export const chatSidebarWidthStore = writable(
    Math.min(CHAT_SIDEBAR_MAX_WIDTH, Math.max(CHAT_SIDEBAR_MIN_WIDTH, localUserStore.getChatSideBarWidth())),
);

// Not unsubscribing is ok, this is a singleton.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
chatSidebarWidthStore.subscribe((value) => {
    localUserStore.setChatSideBarWidth(value);
});

// The room list beside the conversation, in the two-column layout.
export const roomListWidthStore = writable(
    clampRoomListWidth(localUserStore.getChatRoomListWidth() ?? ROOM_LIST_DEFAULT_WIDTH),
);

// Not unsubscribing is ok, this is a singleton.
//eslint-disable-next-line svelte/no-ignored-unsubscribe
roomListWidthStore.subscribe((value) => {
    localUserStore.setChatRoomListWidth(value);
});

// The agenda / tasks panel alone always leaves enough room (it only takes room from md up): it counts with the
// chat or the map editor.
export const hideActionBarStoreBecauseOfChatBar = derived(
    [
        chatVisibilityStore,
        chatSidebarWidthStore,
        windowSize,
        mapEditorSideBarWidthStore,
        mapEditorModeStore,
        sidePanelWidthStore,
        gameViewportBounds,
    ],
    ([
        $chatVisibilityStore,
        $chatSidebarWidthStore,
        $windowSize,
        $mapEditorWidthStore,
        $mapEditorModeStore,
        $sidePanelWidthStore,
        $gameViewportBounds,
    ]) => {
        if (!$chatVisibilityStore && !$mapEditorModeStore) {
            return false;
        }
        return (
            // A measured viewport already leaves out the chat its extension hosts, so the chat only counts
            // against the window.
            ($gameViewportBounds?.width ?? $windowSize.width) -
                ($chatVisibilityStore && !$gameViewportBounds ? $chatSidebarWidthStore : 0) -
                ($mapEditorModeStore ? $mapEditorWidthStore : 0) -
                $sidePanelWidthStore <
            285
        );
    },
);
