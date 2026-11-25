import { derived, get, writable, type Readable } from "svelte/store";
import { chatVisibilityStore } from "../../../Stores/ChatStore";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import { navChat } from "../../../Chat/Stores/ChatStore";
import {
    isRosterAvailable,
    opensOnLeftoverUserList,
    peopleOpening,
    sidePanelView,
    type SidePanelView,
} from "../domain/sidePanel";
import { shellActiveStore, shellFramedStore, shellRoomStore } from "./shellStore";

/** The people panel is open: the shell draws it itself, and the chat is not involved. */
const peopleOpen = writable(false);

/** The room has no people list to show; the panel says so instead. */
const rosterNoticeOpen = writable(false);

/** What the side panel shows, from the chat it holds as the conversation and the people panel the shell raises. */
export const sidePanelStore: Readable<{ view: SidePanelView; rosterNoticeOpen: boolean }> = derived(
    [chatVisibilityStore, peopleOpen, rosterNoticeOpen],
    ([chatVisible, people, noticeOpen]) => ({
        view: sidePanelView({ chatVisible, peopleOpen: people, rosterNoticeOpen: noticeOpen }),
        rosterNoticeOpen: noticeOpen,
    }),
);

/**
 * Opens the people panel, or the notice that the room has no people list. The panel takes the place of the
 * conversation, so the chat is hidden: a message that arrives now is signalled as one nobody is reading.
 */
function openPeople(requestedByUser: boolean): void {
    const room = get(shellRoomStore);
    const rosterAvailable =
        room !== undefined && isRosterAvailable({ onlineListEnabled: room.isChatOnlineListEnabled });
    const opening = peopleOpening(rosterAvailable, requestedByUser);
    if (opening === "nothing") return;
    chatVisibilityStore.set(false);
    peopleOpen.set(opening === "list");
    rosterNoticeOpen.set(opening === "notice");
}

export function togglePeople(): void {
    if (get(sidePanelStore).view === "people") {
        peopleOpen.set(false);
        rosterNoticeOpen.set(false);
    } else {
        openPeople(true);
    }
}

/**
 * Opens the people panel and keeps it open: what the search button and the shortcut ask for. It says whether the list
 * is on screen, which is not so in a room that has none: the notice says that instead, and there is no field to focus.
 */
export function showPeople(): boolean {
    if (get(sidePanelStore).view === "people") return !get(rosterNoticeOpen);
    openPeople(true);
    return get(peopleOpen);
}

export function toggleChat(): void {
    if (get(sidePanelStore).view === "conversation") {
        chatVisibilityStore.set(false);
        return;
    }
    peopleOpen.set(false);
    rosterNoticeOpen.set(false);
    navChat.switchToChat();
    chatVisibilityStore.set(true);
}

/** Only the state: the focus is the page's to move. */
export function closeRosterNotice(): void {
    rosterNoticeOpen.set(false);
}

/** Closes what Escape closes, the chat before the people panel and the notice, and says which one it was. */
export function closeSidePanel(): "chat" | "people" | "notice" | undefined {
    if (get(chatVisibilityStore)) {
        chatVisibilityStore.set(false);
        return "chat";
    }
    if (get(peopleOpen)) {
        peopleOpen.set(false);
        return "people";
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
 * was hidden) and the closed panel belong to that one run.
 */
export function followShell(isWideScreen: () => boolean): () => void {
    rosterNoticeOpen.set(false);
    peopleOpen.set(false);

    // The chat taking the panel ends the people panel and the notice, so closing the chat later brings neither back.
    const stopNotice = chatVisibilityStore.subscribe((chatVisible) => {
        if (!chatVisible) return;
        rosterNoticeOpen.set(false);
        peopleOpen.set(false);
    });

    // Upstream opens the chat for a message without choosing a tab, and must not land on a user list that was left
    // behind. Each switch of the tab stores a new object, so the same object means nobody chose one. A user list that
    // was chosen (the chat's own button, the participants entry of the action bar) is a request for the people: the shell
    // has a panel of its own for them, so the chat steps aside for it. Only the chat and the shell re-run this: a change
    // of the tab alone is somebody choosing.
    let tabWhenHidden: unknown;
    const stopLeftoverGuard = derived([chatVisibilityStore, shellActiveStore], (states) => states).subscribe(
        ([chatVisible, shellActive]) => {
            if (!shellActive) return;
            const tab = get(navChat);
            if (!chatVisible) {
                tabWhenHidden = tab;
            } else if (tab.key === "users") {
                if (opensOnLeftoverUserList({ chatShowsUserList: true, tabChosenSinceHidden: tab !== tabWhenHidden })) {
                    navChat.switchToChat();
                } else {
                    openPeople(true);
                }
            }
        },
    );

    // The same request made while the chat is already visible: its own button to the user list.
    const stopTabRequest = navChat.subscribe((tab) => {
        if (tab.key === "users" && get(shellActiveStore) && get(chatVisibilityStore)) openPeople(true);
    });

    // A wide screen opens on the people of the room, once per room, as the frame is laid out and not as the chrome is
    // drawn: the panel floats over the map, which does not move for it, but the HUD stands beside it and the camera
    // glides the avatar clear of it, and doing that a moment after the map took its place would be a second movement
    // on entry. The room is known by then, and so is whether it has a people list.
    // Between two maps no scene runs and the room falls back to the start room, which is not the room being entered: the
    // frame holds through that gap, and the next scene is what names the room.
    let roomOpenedFor: string | undefined;
    const stopRoomOpening = derived([shellRoomStore, shellFramedStore, gameSceneStore], ([room, framed, scene]) =>
        framed && (scene !== undefined || roomOpenedFor === undefined) ? room?.id : undefined,
    ).subscribe((roomId) => {
        if (roomId === undefined || roomId === roomOpenedFor) return;
        roomOpenedFor = roomId;
        // A notice raised in the previous room says nothing about this one.
        rosterNoticeOpen.set(false);
        // A chat that something opened before the frame was laid out keeps the panel.
        if (isWideScreen() && !get(chatVisibilityStore)) openPeople(false);
    });

    return () => {
        stopRoomOpening();
        stopTabRequest();
        stopLeftoverGuard();
        stopNotice();
    };
}
