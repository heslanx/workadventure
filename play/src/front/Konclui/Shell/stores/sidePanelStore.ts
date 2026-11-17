import { derived, get, writable, type Readable } from "svelte/store";
import { chatVisibilityStore } from "../../../Stores/ChatStore";
import { navChat } from "../../../Chat/Stores/ChatStore";
import {
    isRosterAvailable,
    opensOnLeftoverUserList,
    peopleOpening,
    sidePanelView,
    type SidePanelView,
} from "../domain/sidePanel";
import { shellActiveStore, shellRoomStore } from "./shellStore";

/** The room has no people list to show; the panel says so instead. */
const rosterNoticeOpen = writable(false);

/** What the side panel shows, from the chat it borrows and the notice the shell raises. */
export const sidePanelStore: Readable<{ view: SidePanelView; rosterNoticeOpen: boolean }> = derived(
    [chatVisibilityStore, navChat, rosterNoticeOpen],
    ([chatVisible, tab, noticeOpen]) => ({
        view: sidePanelView({ chatVisible, chatShowsUserList: tab.key === "users", rosterNoticeOpen: noticeOpen }),
        rosterNoticeOpen: noticeOpen,
    }),
);

/** The people list is the chat's own user list, which a room may turn off. */
function openPeople(requestedByUser: boolean): void {
    const room = get(shellRoomStore);
    const rosterAvailable =
        room !== undefined &&
        isRosterAvailable({
            onlineListEnabled: room.isChatOnlineListEnabled,
            disconnectedListEnabled: room.isChatDisconnectedListEnabled,
        });
    const opening = peopleOpening(rosterAvailable, requestedByUser);
    if (opening === "list") {
        navChat.switchToUserList();
        chatVisibilityStore.set(true);
    } else if (opening === "notice") {
        rosterNoticeOpen.set(true);
        chatVisibilityStore.set(false);
    }
}

export function togglePeople(): void {
    if (get(sidePanelStore).view === "people") {
        rosterNoticeOpen.set(false);
        chatVisibilityStore.set(false);
    } else {
        openPeople(true);
    }
}

export function toggleChat(): void {
    if (get(sidePanelStore).view === "conversation") {
        chatVisibilityStore.set(false);
        return;
    }
    rosterNoticeOpen.set(false);
    navChat.switchToChat();
    chatVisibilityStore.set(true);
}

/** Only the state: the focus is the page's to move. */
export function closeRosterNotice(): void {
    rosterNoticeOpen.set(false);
}

/** Closes what Escape closes, the chat before the notice, and says which one it was. */
export function closeSidePanel(): "chat" | "notice" | undefined {
    if (get(chatVisibilityStore)) {
        chatVisibilityStore.set(false);
        return "chat";
    }
    if (get(rosterNoticeOpen)) {
        rosterNoticeOpen.set(false);
        return "notice";
    }
    return undefined;
}

/**
 * Starts the reactions of the panel to the chat, the shell and the room, and returns the function that stops them.
 * Call it once while the shell is drawn: what it remembers (the room it opened for, the tab it saw when the chat
 * was hidden) and the closed notice belong to that one run.
 */
export function followShell(isWideScreen: () => boolean): () => void {
    rosterNoticeOpen.set(false);

    // The chat taking the panel ends the notice, so closing the chat later does not bring the notice back.
    const stopNotice = chatVisibilityStore.subscribe((chatVisible) => {
        if (chatVisible) rosterNoticeOpen.set(false);
    });

    // Upstream opens the chat for a message without choosing a tab, and must not land on the user list the people
    // view left behind. Each switch of the tab stores a new object, so the same object means nobody chose one.
    // Only the chat and the shell re-run it: a change of the tab alone is somebody choosing.
    let tabWhenHidden: unknown;
    const stopLeftoverGuard = derived([chatVisibilityStore, shellActiveStore], (states) => states).subscribe(
        ([chatVisible, shellActive]) => {
            if (!shellActive) return;
            const tab = get(navChat);
            if (!chatVisible) {
                tabWhenHidden = tab;
            } else if (
                opensOnLeftoverUserList({
                    chatShowsUserList: tab.key === "users",
                    tabChosenSinceHidden: tab !== tabWhenHidden,
                })
            ) {
                navChat.switchToChat();
            }
        },
    );

    // A wide screen opens on the people of the room, once per room and only when the chrome is drawn.
    let roomOpenedFor: string | undefined;
    const stopRoomOpening = derived([shellRoomStore, shellActiveStore], ([room, shellActive]) =>
        shellActive ? room?.id : undefined,
    ).subscribe((roomId) => {
        if (roomId === undefined || roomId === roomOpenedFor) return;
        roomOpenedFor = roomId;
        // A notice raised in the previous room says nothing about this one.
        rosterNoticeOpen.set(false);
        // A chat that something opened before the chrome was drawn keeps the panel.
        if (isWideScreen() && !get(chatVisibilityStore)) openPeople(false);
    });

    return () => {
        stopRoomOpening();
        stopLeftoverGuard();
        stopNotice();
    };
}
