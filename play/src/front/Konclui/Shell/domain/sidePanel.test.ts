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
    it("is closed while the chat is hidden and no notice is open", () => {
        expect(sidePanelView({ chatVisible: false, chatShowsUserList: false, rosterNoticeOpen: false })).toBe("closed");
    });

    it("shows people while the chat is on its user list", () => {
        expect(sidePanelView({ chatVisible: true, chatShowsUserList: true, rosterNoticeOpen: false })).toBe("people");
    });

    it("shows the conversation while the chat is on any other tab", () => {
        expect(sidePanelView({ chatVisible: true, chatShowsUserList: false, rosterNoticeOpen: false })).toBe(
            "conversation",
        );
    });

    it("shows people while the notice that the room has no people list is open", () => {
        expect(sidePanelView({ chatVisible: false, chatShowsUserList: false, rosterNoticeOpen: true })).toBe("people");
    });

    it("stays closed when the chat was left on its user list and then hidden", () => {
        expect(sidePanelView({ chatVisible: false, chatShowsUserList: true, rosterNoticeOpen: false })).toBe("closed");
    });

    it("lets the visible chat win over a notice left open", () => {
        expect(sidePanelView({ chatVisible: true, chatShowsUserList: false, rosterNoticeOpen: true })).toBe(
            "conversation",
        );
    });
});

describe("isWideScreen", () => {
    it("starts at 768 px, where the rail replaces the sheet", () => {
        expect(isWideScreen(767)).toBe(false);
        expect(isWideScreen(768)).toBe(true);
    });
});

describe("isRosterAvailable", () => {
    it.each([
        { onlineListEnabled: true, disconnectedListEnabled: true, available: true },
        { onlineListEnabled: true, disconnectedListEnabled: false, available: true },
        { onlineListEnabled: false, disconnectedListEnabled: true, available: true },
        { onlineListEnabled: false, disconnectedListEnabled: false, available: false },
    ])(
        "is $available with online $onlineListEnabled and disconnected $disconnectedListEnabled",
        ({ available, ...lists }) => {
            expect(isRosterAvailable(lists)).toBe(available);
        },
    );
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
