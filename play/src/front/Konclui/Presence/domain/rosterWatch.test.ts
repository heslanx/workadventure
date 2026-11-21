import { describe, expect, it } from "vitest";
import {
    countSource,
    distinctPeople,
    modeForCount,
    modeShown,
    shouldWatchRoster,
    type PeopleMode,
    type RosterWatchDemand,
} from "./rosterWatch";

describe("modeForCount", () => {
    it("lists everyone at the limit and near people just above it, when no mode came before", () => {
        expect(modeForCount(undefined, 200)).toBe("everyone");
        expect(modeForCount(undefined, 201)).toBe("nearby");
    });

    it("starts in nearby while the count is not known, and keeps the mode it had", () => {
        expect(modeForCount(undefined, undefined)).toBe("nearby");
        expect(modeForCount(undefined, 0)).toBe("nearby");
        expect(modeForCount("everyone", 0)).toBe("everyone");
        expect(modeForCount("nearby", undefined)).toBe("nearby");
    });

    it("leaves everyone only above 220: a world at 201 to 220 does not flip the list", () => {
        expect(modeForCount("everyone", 201)).toBe("everyone");
        expect(modeForCount("everyone", 220)).toBe("everyone");
        expect(modeForCount("everyone", 221)).toBe("nearby");
    });

    it("returns to everyone only at 180 or fewer: a world at 181 to 219 does not flip the list", () => {
        expect(modeForCount("nearby", 219)).toBe("nearby");
        expect(modeForCount("nearby", 181)).toBe("nearby");
        expect(modeForCount("nearby", 180)).toBe("everyone");
    });

    it("does not flicker while the count wanders between 181 and 220, from either mode", () => {
        const wander = [181, 205, 215, 190, 220, 185, 200, 219];
        for (const start of ["everyone", "nearby"] as const) {
            let mode: PeopleMode = start;
            for (const count of wander) {
                mode = modeForCount(mode, count);
                expect(mode).toBe(start);
            }
        }
    });
});

describe("shouldWatchRoster", () => {
    const closed: RosterWatchDemand = {
        panelOpen: false,
        chatReads: false,
        mode: "everyone",
        chosenEveryone: false,
        countNeedsRoster: false,
    };

    it("does not watch while the panel is closed, whatever the world's size", () => {
        expect(shouldWatchRoster({ ...closed, mode: "everyone" })).toBe(false);
        expect(shouldWatchRoster({ ...closed, mode: "nearby" })).toBe(false);
        expect(shouldWatchRoster({ ...closed, mode: "nearby", chosenEveryone: true })).toBe(false);
    });

    it("watches while the panel is open on a world that lists everyone", () => {
        expect(shouldWatchRoster({ ...closed, panelOpen: true, mode: "everyone" })).toBe(true);
    });

    it("does not watch while the panel is open above the limit, until the user asks for everyone", () => {
        expect(shouldWatchRoster({ ...closed, panelOpen: true, mode: "nearby" })).toBe(false);
        expect(shouldWatchRoster({ ...closed, panelOpen: true, mode: "nearby", chosenEveryone: true })).toBe(true);
    });

    it("holds the chat to the same rule as the panel: it watches a world that lists everyone, and nothing above the limit", () => {
        expect(shouldWatchRoster({ ...closed, chatReads: true, mode: "everyone" })).toBe(true);
        expect(shouldWatchRoster({ ...closed, chatReads: true, mode: "nearby" })).toBe(false);
    });

    it("watches as soon as the count is made from the roster, even with the panel closed", () => {
        expect(shouldWatchRoster({ ...closed, countNeedsRoster: true })).toBe(true);
    });
});

describe("modeShown", () => {
    it("is everyone when the user asked for it above the limit, and the count's mode otherwise", () => {
        expect(modeShown("nearby", true)).toBe("everyone");
        expect(modeShown("nearby", false)).toBe("nearby");
        expect(modeShown("everyone", false)).toBe("everyone");
    });
});

describe("countSource", () => {
    it("is unknown until the world's state has arrived, whatever the headcount says", () => {
        expect(countSource({ synced: false, headcount: undefined })).toBe("unknown");
        expect(countSource({ synced: false, headcount: 12 })).toBe("unknown");
    });

    it("takes the headcount the back sends, zero included", () => {
        expect(countSource({ synced: true, headcount: 12 })).toBe("state");
        expect(countSource({ synced: true, headcount: 0 })).toBe("state");
    });

    it("falls back to the roster when the state arrived with no headcount, as a back that does not send one", () => {
        expect(countSource({ synced: true, headcount: undefined })).toBe("roster");
    });
});

describe("distinctPeople", () => {
    it("counts an account once however many sessions it has", () => {
        expect(
            distinctPeople([
                { spaceUserId: "room_1", uuid: "ana" },
                { spaceUserId: "room_2", uuid: "ana" },
                { spaceUserId: "room_3", uuid: "bia" },
            ]),
        ).toBe(2);
    });

    it("counts a session without an account by its own id", () => {
        expect(
            distinctPeople([
                { spaceUserId: "room_1", uuid: "" },
                { spaceUserId: "room_2", uuid: "" },
                { spaceUserId: "room_3", uuid: "ana" },
            ]),
        ).toBe(3);
    });
});
