import { describe, expect, it } from "vitest";
import { sidePanelView } from "./sidePanel";

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
