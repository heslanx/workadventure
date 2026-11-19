import { describe, expect, it } from "vitest";
import {
    broadcastMode,
    entryKey,
    menuGroups,
    rowAfter,
    type MenuContext,
    type MenuEntry,
    type MenuGroupId,
} from "./officeMenu";

const everything: MenuContext = {
    nameEditable: true,
    inviteActivated: true,
    mapEditorShown: true,
    exploreShown: true,
    broadcast: "live",
};

function keysOf(context: MenuContext): Record<string, string[]> {
    return Object.fromEntries(menuGroups(context).map((group) => [group.id, group.entries.map(entryKey)]));
}

describe("menuGroups", () => {
    it("lists the four statuses, the profile, the settings and the tools in the reference's order", () => {
        expect(keysOf(everything)).toEqual({
            status: ["status:online", "status:busy", "status:away", "status:doNotDisturb"],
            profile: ["action:editName", "action:avatar", "action:companion"],
            settings: ["action:cameraMicrophone", "action:settings", "action:shareLink"],
            tools: ["action:mapEditor", "action:explore", "action:broadcast"],
        });
    });

    it("leaves out the name row when an OpenID policy forces the account's name", () => {
        expect(keysOf({ ...everything, nameEditable: false }).profile).toEqual(["action:avatar", "action:companion"]);
    });

    it("leaves out the link when invitations are switched off, and keeps the other settings rows", () => {
        expect(keysOf({ ...everything, inviteActivated: false }).settings).toEqual([
            "action:cameraMicrophone",
            "action:settings",
        ]);
    });

    it.each([
        ["the map editor", { mapEditorShown: false }, ["action:explore", "action:broadcast"]],
        ["the explorer", { exploreShown: false }, ["action:mapEditor", "action:broadcast"]],
        ["the megaphone", { broadcast: undefined }, ["action:mapEditor", "action:explore"]],
    ] satisfies [string, Partial<MenuContext>, string[]][])(
        "shows the tools without %s when upstream's map menu does not",
        (_name, change, expected) => {
            expect(keysOf({ ...everything, ...change }).tools).toEqual(expected);
        },
    );

    it("drops the tools group when no tool is shown, rather than keep an empty heading", () => {
        const groups = menuGroups({ ...everything, mapEditorShown: false, exploreShown: false, broadcast: undefined });

        expect(groups.map((group) => group.id)).toEqual<MenuGroupId[]>(["status", "profile", "settings"]);
    });

    it("keeps the megaphone row for either mode", () => {
        expect(keysOf({ ...everything, broadcast: "text" }).tools).toContain("action:broadcast");
    });
});

describe("broadcastMode", () => {
    it.each([
        [{ megaphoneAllowed: true, announcementAllowed: false }, "live"],
        [{ megaphoneAllowed: true, announcementAllowed: true }, "live"],
        [{ megaphoneAllowed: false, announcementAllowed: true }, "text"],
        [{ megaphoneAllowed: false, announcementAllowed: false }, undefined],
    ] as const)("for %j opens %s", (permissions, expected) => {
        expect(broadcastMode(permissions)).toBe(expected);
    });
});

describe("entryKey", () => {
    it("tells a status from an action", () => {
        const status: MenuEntry = { kind: "status", choice: "busy" };
        const action: MenuEntry = { kind: "action", id: "settings" };

        expect([entryKey(status), entryKey(action)]).toEqual(["status:busy", "action:settings"]);
    });
});

describe("rowAfter", () => {
    it.each([
        [0, "ArrowDown", 5, 1],
        [4, "ArrowDown", 5, 0],
        [0, "ArrowUp", 5, 4],
        [3, "ArrowUp", 5, 2],
        [2, "Home", 5, 0],
        [1, "End", 5, 4],
    ])("from row %i, %s in %i rows goes to row %i", (index, key, count, expected) => {
        expect(rowAfter(index, key, count)).toBe(expected);
    });

    it.each(["ArrowLeft", "ArrowRight", "Tab", "a", "Enter"])("does not move for %s", (key) => {
        expect(rowAfter(2, key, 5)).toBeUndefined();
    });

    it("does not move in an empty menu", () => {
        expect(rowAfter(0, "ArrowDown", 0)).toBeUndefined();
    });
});
