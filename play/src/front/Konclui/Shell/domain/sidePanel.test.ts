import { describe, expect, it } from "vitest";
import {
    focusAfterClose,
    isRosterAvailable,
    isWideScreen,
    opensOnLeftoverUserList,
    panelButtonFor,
    peopleOpening,
    sidePanelView,
    type PanelClose,
} from "./sidePanel";

describe("sidePanelView", () => {
    const closed = { chatVisible: false, peopleOpen: false, rosterNoticeOpen: false };

    it("is closed while the chat is hidden and neither the people panel nor the notice is open", () => {
        expect(sidePanelView(closed)).toBe("closed");
    });

    it("shows people while the people panel is open, whatever the chat was left on", () => {
        expect(sidePanelView({ ...closed, peopleOpen: true })).toBe("people");
    });

    it("shows the conversation while the chat is visible", () => {
        expect(sidePanelView({ ...closed, chatVisible: true })).toBe("conversation");
    });

    it("shows people while the notice that the room has no people list is open", () => {
        expect(sidePanelView({ ...closed, rosterNoticeOpen: true })).toBe("people");
    });

    it("lets the visible chat win over a people panel or a notice left open", () => {
        expect(sidePanelView({ chatVisible: true, peopleOpen: true, rosterNoticeOpen: false })).toBe("conversation");
        expect(sidePanelView({ chatVisible: true, peopleOpen: false, rosterNoticeOpen: true })).toBe("conversation");
    });
});

describe("isWideScreen", () => {
    it("starts at 768 px, where the rail replaces the sheet", () => {
        expect(isWideScreen(767)).toBe(false);
        expect(isWideScreen(768)).toBe(true);
    });
});

describe("isRosterAvailable", () => {
    it("follows the room's online list: the panel lists who is online", () => {
        expect(isRosterAvailable({ onlineListEnabled: true })).toBe(true);
        expect(isRosterAvailable({ onlineListEnabled: false })).toBe(false);
    });
});

describe("peopleOpening", () => {
    it("opens the list of a room that has one, asked for or not", () => {
        expect(peopleOpening(true, true)).toBe("list");
        expect(peopleOpening(true, false)).toBe("list");
    });

    it("answers the user with the notice in a room without a list", () => {
        expect(peopleOpening(false, true)).toBe("notice");
    });

    it("opens nothing on entering a room without a list", () => {
        expect(peopleOpening(false, false)).toBe("nothing");
    });
});

describe("opensOnLeftoverUserList", () => {
    it("moves a chat opened on a user list nobody chose to the conversation", () => {
        expect(opensOnLeftoverUserList({ chatShowsUserList: true, tabChosenSinceHidden: false })).toBe(true);
    });

    it("keeps the user list that was chosen before the chat was shown", () => {
        expect(opensOnLeftoverUserList({ chatShowsUserList: true, tabChosenSinceHidden: true })).toBe(false);
    });

    it("leaves a chat that is on any other tab alone", () => {
        expect(opensOnLeftoverUserList({ chatShowsUserList: false, tabChosenSinceHidden: false })).toBe(false);
    });
});

describe("panelButtonFor", () => {
    it("is the rail button of the view on a wide screen", () => {
        expect(panelButtonFor("people", true)).toBe("people");
        expect(panelButtonFor("conversation", true)).toBe("chat");
    });

    it("is the people pill on a narrow screen, which has no rail", () => {
        expect(panelButtonFor("people", false)).toBe("mobilePeople");
        expect(panelButtonFor("conversation", false)).toBe("mobilePeople");
    });
});

describe("focusAfterClose", () => {
    const closedFromInside: PanelClose = {
        closedView: "conversation",
        focusWasInPanel: true,
        focusIsOnPage: true,
        wideScreen: true,
    };

    it("hands the focus to the button of the view that closed", () => {
        expect(focusAfterClose(closedFromInside)).toBe("chat");
        expect(focusAfterClose({ ...closedFromInside, closedView: "people" })).toBe("people");
        expect(focusAfterClose({ ...closedFromInside, wideScreen: false })).toBe("mobilePeople");
    });

    it("leaves the focus on the page when the panel closed while the user was playing", () => {
        expect(focusAfterClose({ ...closedFromInside, focusWasInPanel: false })).toBeUndefined();
    });

    it("leaves the focus with an element that took it during the close", () => {
        expect(focusAfterClose({ ...closedFromInside, focusIsOnPage: false })).toBeUndefined();
    });

    it("does nothing once the close was handled", () => {
        expect(focusAfterClose({ ...closedFromInside, closedView: "closed" })).toBeUndefined();
    });
});
