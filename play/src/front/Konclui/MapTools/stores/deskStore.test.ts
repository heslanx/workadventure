import { get, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESK_ACTION_ID, parseDesks } from "../domain/desk";

const items = writable(new Map<string, unknown>());
const localUser = vi.fn<() => { uuid: string } | null>(() => ({ uuid: "uuid-ana" }));

vi.mock("../../../Stores/AdditionalItemsMenuStore", () => ({ getAdditionalMenuItemStore: () => items }));
vi.mock("../../../Connection/LocalUserStore", () => ({ localUserStore: { getLocalUser: () => localUser() } }));

const { deskReachableStore, deskToolStore, localUserId, publishAtDesk, publishDesks } = await import("./deskStore");

const OWN_DESK = parseDesks(JSON.stringify({ "chair-4": { uuid: "uuid-ana", name: "Ana" } }));

describe("deskReachableStore", () => {
    beforeEach(() => {
        localUser.mockReturnValue({ uuid: "uuid-ana" });
        items.set(new Map([[DESK_ACTION_ID, {}]]));
    });

    afterEach(() => {
        publishDesks({ kind: "absent" });
        publishAtDesk(false);
        vi.restoreAllMocks();
    });

    it("is false until the scene has read the room's desks", () => {
        expect(get(deskReachableStore)).toBe(false);
    });

    it("is true when the room gives the user a desk and the office script registered its button", () => {
        publishDesks(OWN_DESK);

        expect(get(deskReachableStore)).toBe(true);
    });

    it("is false when the script's button is not registered, and true again once it is", () => {
        publishDesks(OWN_DESK);
        items.set(new Map());
        expect(get(deskReachableStore)).toBe(false);

        items.set(new Map([[DESK_ACTION_ID, {}]]));
        expect(get(deskReachableStore)).toBe(true);
    });

    it("is false for a user who holds no desk, and for one whose id is not known", () => {
        publishDesks(parseDesks({ "chair-9": { uuid: "uuid-bia" } }));
        expect(get(deskReachableStore)).toBe(false);

        publishDesks(OWN_DESK);
        localUser.mockReturnValue(null);
        // The id is read when the desks or the buttons change, so a change makes the store read it again.
        items.set(new Map([[DESK_ACTION_ID, {}]]));
        expect(get(deskReachableStore)).toBe(false);
    });

    it("follows the room when the desk is released or the room has no desks", () => {
        publishDesks(OWN_DESK);
        publishDesks(parseDesks("{}"));
        expect(get(deskReachableStore)).toBe(false);

        publishDesks(OWN_DESK);
        publishDesks({ kind: "absent" });
        expect(get(deskReachableStore)).toBe(false);
    });

    it("keeps the last good desks when a script writes a variable that is not desks, and reports it", () => {
        const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
        publishDesks(OWN_DESK);

        publishDesks(parseDesks("{not json"));

        expect(get(deskReachableStore)).toBe(true);
        expect(report).toHaveBeenCalledTimes(1);
        expect(String(report.mock.calls[0]?.[0])).toContain("could not be read");
    });
});

describe("deskToolStore", () => {
    beforeEach(() => {
        localUser.mockReturnValue({ uuid: "uuid-ana" });
        items.set(new Map([[DESK_ACTION_ID, {}]]));
    });

    afterEach(() => {
        publishDesks({ kind: "absent" });
        publishAtDesk(false);
        vi.restoreAllMocks();
    });

    it("leaves the tool out until the room gives the user a desk", () => {
        expect(get(deskToolStore)).toBe("absent");
    });

    it("offers the tool to a user who has a desk and is not sitting at it", () => {
        publishDesks(OWN_DESK);

        expect(get(deskToolStore)).toBe("ready");
    });

    it("keeps the tool, with nothing to do, once the user sits at their desk, and offers it again when they stand", () => {
        publishDesks(OWN_DESK);

        publishAtDesk(true);
        expect(get(deskToolStore)).toBe("here");

        publishAtDesk(false);
        expect(get(deskToolStore)).toBe("ready");
    });

    it("does not keep a tool for a user who sits but has no desk to go to, nor when the script's button is gone", () => {
        publishAtDesk(true);
        expect(get(deskToolStore)).toBe("absent");

        publishDesks(OWN_DESK);
        items.set(new Map());
        expect(get(deskToolStore)).toBe("absent");
    });
});

describe("localUserId", () => {
    afterEach(() => {
        localUser.mockReset();
        vi.restoreAllMocks();
    });

    it("is the id the room knows the user by", () => {
        localUser.mockReturnValue({ uuid: "uuid-ana" });

        expect(localUserId()).toBe("uuid-ana");
    });

    it("is undefined while the user is not known", () => {
        localUser.mockReturnValue(null);

        expect(localUserId()).toBeUndefined();
    });
});
