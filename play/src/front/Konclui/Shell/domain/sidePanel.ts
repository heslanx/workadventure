/** What the side panel of the shell shows. */
export type SidePanelView = "people" | "conversation" | "closed";

/**
 * `chatVisible` comes from the chat, which the panel shows as the conversation. `peopleOpen` and `rosterNoticeOpen`
 * are the shell's own: the people panel is drawn by the shell and borrows nothing from the chat, so opening it does not
 * make the chat visible, and a message that arrives meanwhile is signalled as one that nobody is reading.
 */
export interface SidePanelState {
    readonly chatVisible: boolean;
    readonly peopleOpen: boolean;
    /** The room has no people list and the panel says so. */
    readonly rosterNoticeOpen: boolean;
}

export function sidePanelView(state: SidePanelState): SidePanelView {
    if (state.chatVisible) return "conversation";
    return state.peopleOpen || state.rosterNoticeOpen ? "people" : "closed";
}

/** From this window width up the shell draws the rail beside the game; below it the panel is a sheet over it. */
export function isWideScreen(windowWidth: number): boolean {
    return windowWidth >= 768;
}

/** What a room configures of its people list. */
export interface RosterLists {
    readonly onlineListEnabled: boolean;
}

/**
 * The people panel lists who is online, which a room can turn off. The disconnected members the chat's user list also
 * held are not people who are here, and the panel does not list them.
 */
export function isRosterAvailable(lists: RosterLists): boolean {
    return lists.onlineListEnabled;
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
 * Upstream opens the chat for a message without choosing a tab, so a user list that nobody chose since the chat was
 * last hidden is a leftover (the user opened it, then closed the chat), and showing it would hide the conversation that
 * was just opened. A user list that was chosen is asked for the people instead: the shell shows its own panel.
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
