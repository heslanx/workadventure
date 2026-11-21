import { describe, expect, it } from "vitest";
import {
    DESK_ACTION_ID,
    SEAT_TOLERANCE_PX,
    SEAT_VARIABLE,
    deskOf,
    deskReachable,
    deskToolState,
    isSeated,
    isSeatedOnChair,
    parseDesks,
} from "./desk";

const ANA = { uuid: "uuid-ana", name: "Ana" };
const BIA = { uuid: "uuid-bia", name: "Bia" };

describe("parseDesks", () => {
    it("reads the JSON text the office script stores, owners by the id of their chair", () => {
        const reading = parseDesks(JSON.stringify({ "chair-4": ANA, "chair-9": BIA }));

        expect(reading).toEqual({ kind: "desks", desks: { "chair-4": ANA, "chair-9": BIA } });
    });

    it("reads the object itself, as a room may hand it over", () => {
        expect(parseDesks({ "chair-4": ANA })).toEqual({ kind: "desks", desks: { "chair-4": ANA } });
    });

    it("reads the empty text as no desks, as the script does", () => {
        expect(parseDesks("")).toEqual({ kind: "desks", desks: {} });
        expect(parseDesks("{}")).toEqual({ kind: "desks", desks: {} });
    });

    it("says a room without the variable is absent, which is not an error", () => {
        expect(parseDesks(undefined)).toEqual({ kind: "absent" });
    });

    it.each([
        ["text that is not JSON", "{not json"],
        ["a list", JSON.stringify([ANA])],
        ["a number", 7],
        ["null", null],
        ["an owner with no uuid", JSON.stringify({ "chair-4": { name: "Ana" } })],
        ["an owner whose uuid is not text", JSON.stringify({ "chair-4": { uuid: 12 } })],
    ])("rejects %s, and says why", (_name, value) => {
        const reading = parseDesks(value);

        expect(reading.kind).toBe("invalid");
        expect(reading.kind === "invalid" && reading.reason.length > 0).toBe(true);
    });
});

describe("deskOf", () => {
    it("finds the chair of the desk a user holds", () => {
        expect(deskOf({ "chair-4": ANA, "chair-9": BIA }, "uuid-bia")).toBe("chair-9");
    });

    it("finds nothing for a user who holds no desk", () => {
        expect(deskOf({ "chair-4": ANA }, "uuid-bia")).toBeUndefined();
        expect(deskOf({}, "uuid-ana")).toBeUndefined();
    });
});

describe("deskReachable", () => {
    const desks = { "chair-4": ANA };

    it("is true when the room gives the user a desk and the action that walks there exists", () => {
        expect(deskReachable(desks, "uuid-ana", true)).toBe(true);
    });

    it("is false for a user who holds no desk, so the tool is left out and not dead", () => {
        expect(deskReachable(desks, "uuid-bia", true)).toBe(false);
    });

    it("is false while the office script has not registered its button: the tool could not act", () => {
        expect(deskReachable(desks, "uuid-ana", false)).toBe(false);
    });

    it("is false in a room without desks, and for a user whose id is not known", () => {
        expect(deskReachable(undefined, "uuid-ana", true)).toBe(false);
        expect(deskReachable(desks, undefined, true)).toBe(false);
    });

    it("names the button of the office script, which is the coupling the tool depends on", () => {
        expect(DESK_ACTION_ID).toBe("minha-mesa");
    });
});

describe("isSeated", () => {
    it("reads the seat variable as seated while the script has set it, and standing when it is cleared", () => {
        expect(isSeated({ v: 1, direction: "up" })).toBe(true);
        expect(isSeated(null)).toBe(false);
        expect(isSeated(undefined)).toBe(false);
    });

    it("does not take a value that is not a pose for a seat", () => {
        expect(isSeated("seated")).toBe(false);
        expect(isSeated(1)).toBe(false);
        expect(isSeated(true)).toBe(false);
    });

    it("names the variable the office script publishes", () => {
        expect(SEAT_VARIABLE).toBe("officeSeat");
    });
});

describe("isSeatedOnChair", () => {
    // A chair picture one tile wide and a tile and a half tall, with its corner at (96, 96).
    const chair = { x: 96, y: 96, width: 32, height: 48 };

    it("is true for a sitter whose avatar is inside the picture of the chair", () => {
        expect(isSeatedOnChair(true, { x: 112, y: 128 }, chair)).toBe(true);
    });

    it("is false for a user who stands in the picture of the chair: the tool can still take them to it", () => {
        expect(isSeatedOnChair(false, { x: 112, y: 128 }, chair)).toBe(false);
    });

    it("is false for a sitter on another seat", () => {
        expect(isSeatedOnChair(true, { x: 300, y: 128 }, chair)).toBe(false);
        expect(isSeatedOnChair(true, { x: 112, y: 400 }, chair)).toBe(false);
    });

    it("counts the edges of the picture and the script's own tolerance as the chair, and nothing beyond", () => {
        const margin = SEAT_TOLERANCE_PX;

        expect(isSeatedOnChair(true, { x: 96 - margin, y: 96 - margin }, chair)).toBe(true);
        expect(isSeatedOnChair(true, { x: 128 + margin, y: 144 + margin }, chair)).toBe(true);
        expect(isSeatedOnChair(true, { x: 96 - margin - 1, y: 120 }, chair)).toBe(false);
        expect(isSeatedOnChair(true, { x: 120, y: 96 - margin - 1 }, chair)).toBe(false);
        expect(isSeatedOnChair(true, { x: 128 + margin + 1, y: 120 }, chair)).toBe(false);
        expect(isSeatedOnChair(true, { x: 120, y: 144 + margin + 1 }, chair)).toBe(false);
    });

    it("is false while the avatar or the chair is not known", () => {
        expect(isSeatedOnChair(true, undefined, chair)).toBe(false);
        expect(isSeatedOnChair(true, { x: 112, y: 128 }, undefined)).toBe(false);
    });

    it("is false for a position that is not a number, which is no place at all", () => {
        expect(isSeatedOnChair(true, { x: Number.NaN, y: 128 }, chair)).toBe(false);
        expect(isSeatedOnChair(true, { x: 112, y: Number.NaN }, chair)).toBe(false);
    });
});

describe("deskToolState", () => {
    it("leaves the tool out when it could not act at all, whether the user sits or not", () => {
        expect(deskToolState(false, false)).toBe("absent");
        expect(deskToolState(false, true)).toBe("absent");
    });

    it("offers the tool to a user who has a desk and is not at it", () => {
        expect(deskToolState(true, false)).toBe("ready");
    });

    it("keeps the tool, with nothing to do, for a user who already sits at their desk", () => {
        expect(deskToolState(true, true)).toBe("here");
    });
});
