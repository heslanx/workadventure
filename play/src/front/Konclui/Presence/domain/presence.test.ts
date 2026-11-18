import { describe, expect, it } from "vitest";
import { describePill, isSamePresence, type PresenceReading } from "./presence";

describe("describePill", () => {
    it.each([0, -1, Number.NaN])("is unknown, not a count, when the world reports %s", (online) => {
        expect(describePill(online, 4)).toEqual({ kind: "unknown" });
    });

    it("is alone when the current user is the only one online", () => {
        expect(describePill(1, 0)).toEqual({ kind: "alone" });
    });

    it("carries the headcount and the near count when there are others", () => {
        expect(describePill(12, 3)).toEqual({ kind: "others", online: 12, nearCount: 3 });
    });

    it("has no near count until the scene has read its surroundings", () => {
        expect(describePill(12, undefined)).toEqual({ kind: "others", online: 12, nearCount: undefined });
    });
});

describe("isSamePresence", () => {
    const reading: PresenceReading = {
        nearest: [{ id: 1, name: "Ana" }],
        nearCount: 1,
        place: { kind: "area", name: "Sala 01" },
    };

    it("is true for a reading with the same people, count and place", () => {
        expect(isSamePresence(reading, { ...reading, nearest: [{ id: 1, name: "Ana" }] })).toBe(true);
    });

    it("is false when only the place changes", () => {
        expect(isSamePresence(reading, { ...reading, place: { kind: "hall" } })).toBe(false);
    });

    it("is false when only the near count changes", () => {
        expect(isSamePresence(reading, { ...reading, nearCount: 2 })).toBe(false);
    });

    it("tells a reading from none", () => {
        expect(isSamePresence(undefined, undefined)).toBe(true);
        expect(isSamePresence(reading, undefined)).toBe(false);
    });
});
