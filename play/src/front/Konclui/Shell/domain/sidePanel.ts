/** What the side panel of the shell shows. */
export type SidePanelView = "people" | "conversation" | "closed";

/**
 * `chatVisible` and `chatShowsUserList` come from the chat, which owns the people list as one of its tabs.
 * `rosterNoticeOpen` is the shell's own state: the room has no people list and the panel says so.
 */
export interface SidePanelState {
    readonly chatVisible: boolean;
    readonly chatShowsUserList: boolean;
    readonly rosterNoticeOpen: boolean;
}

export function sidePanelView(state: SidePanelState): SidePanelView {
    if (state.chatVisible) return state.chatShowsUserList ? "people" : "conversation";
    return state.rosterNoticeOpen ? "people" : "closed";
}

/** From this window width up the shell draws the rail beside the game; below it the panel is a sheet over it. */
export function isWideScreen(windowWidth: number): boolean {
    return windowWidth >= 768;
}

/** The two lists of the chat's user list, as the room configures them. */
export interface RosterLists {
    readonly onlineListEnabled: boolean;
    readonly disconnectedListEnabled: boolean;
}

/**
 * The people view is the chat's user list, which exists when the room turns on at least one of its lists. It is
 * read from the room and not from the tab the chat is on: the tab can still be the user list of the previous room.
 */
export function isRosterAvailable(lists: RosterLists): boolean {
    return lists.onlineListEnabled || lists.disconnectedListEnabled;
}

/** What opening the people view does: the list, the notice that the room has none, or nothing. */
export type PeopleOpening = "list" | "notice" | "nothing";

/**
 * A room without a people list answers the user who asks for it with a notice. Entering that room opens nothing:
 * nobody asked, and a panel that opens by itself to say a list is missing only takes room from the game.
 */
export function peopleOpening(rosterAvailable: boolean, requestedByUser: boolean): PeopleOpening {
    if (rosterAvailable) return "list";
    return requestedByUser ? "notice" : "nothing";
}

/**
 * Whether a chat that just became visible moves to the conversation.
 *
 * The people view borrows the chat's user-list tab and leaves the chat on it when the panel closes. Upstream opens
 * the chat for a message without choosing a tab, so a user list that nobody chose since the chat was last hidden is
 * a leftover, and showing it would hide the conversation that was just opened.
 */
export function opensOnLeftoverUserList(chat: {
    readonly chatShowsUserList: boolean;
    readonly tabChosenSinceHidden: boolean;
}): boolean {
    return chat.chatShowsUserList && !chat.tabChosenSinceHidden;
}

/** The buttons that open the side panel: two on the rail of a wide screen, one pill on a narrow one. */
export type PanelButton = "people" | "chat" | "mobilePeople";

/** The button that reopens `view`. */
export function panelButtonFor(view: Exclude<SidePanelView, "closed">, wideScreen: boolean): PanelButton {
    if (!wideScreen) return "mobilePeople";
    return view === "conversation" ? "chat" : "people";
}

/** What the page knows when the side panel has just closed. */
export interface PanelClose {
    /** The view the panel showed before it closed, or `closed` when this close was already handled. */
    readonly closedView: SidePanelView;
    /** Whether the focus was inside the panel when it closed. */
    readonly focusWasInPanel: boolean;
    /** Whether the close left the focus on the page itself, so that no other element took it meanwhile. */
    readonly focusIsOnPage: boolean;
    readonly wideScreen: boolean;
}

/**
 * The button that takes the focus after the panel closed, if any.
 *
 * Only a close that removed the focused element hands the focus on. While the user plays, the focus rests on the
 * page, and a button taking it there would swallow the Space and Enter keys of the game.
 */
export function focusAfterClose(close: PanelClose): PanelButton | undefined {
    if (close.closedView === "closed" || !close.focusWasInPanel || !close.focusIsOnPage) return undefined;
    return panelButtonFor(close.closedView, close.wideScreen);
}
