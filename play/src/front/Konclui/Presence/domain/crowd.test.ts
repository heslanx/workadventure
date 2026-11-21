import { describe, expect, it } from "vitest";
import { isSameCrowd, type CrowdReading } from "./crowd";

const reading = (overrides: Partial<CrowdReading> = {}): CrowdReading => ({
    roomKey: "room",
    me: { spaceUserId: "room_1", name: "Eu", place: { kind: "hall" } },
    people: [
        { spaceUserId: "room_2", uuid: "ana", name: "Ana", status: 1, place: { kind: "area", name: "Sala azul" } },
        { spaceUserId: "room_3", uuid: "bia", name: "Bia", status: undefined, place: undefined },
    ],
    ...overrides,
});

describe("isSameCrowd", () => {
    it("is true for two readings that say the same, and for two readings of nothing", () => {
        expect(isSameCrowd(reading(), reading())).toBe(true);
        expect(isSameCrowd(undefined, undefined)).toBe(true);
    });

    it("is false between a reading and nothing", () => {
        expect(isSameCrowd(reading(), undefined)).toBe(false);
        expect(isSameCrowd(undefined, reading())).toBe(false);
    });

    it("sees the player move to another place", () => {
        expect(isSameCrowd(reading(), reading({ me: { spaceUserId: "room_1", name: "Eu", place: undefined } }))).toBe(
            false,
        );
    });

    it("sees a person come, go, change order, change place or change status", () => {
        const base = reading();
        const [ana, bia] = base.people;

        expect(isSameCrowd(base, reading({ people: [ana] }))).toBe(false);
        expect(isSameCrowd(base, reading({ people: [bia, ana] }))).toBe(false);
        expect(isSameCrowd(base, reading({ people: [{ ...ana, place: { kind: "hall" } }, bia] }))).toBe(false);
        expect(isSameCrowd(base, reading({ people: [ana, { ...bia, status: 4 }] }))).toBe(false);
    });
});
