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
