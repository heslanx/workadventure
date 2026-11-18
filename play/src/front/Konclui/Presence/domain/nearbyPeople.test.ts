import { describe, expect, it } from "vitest";
import { isSameNearby, NEAR_RADIUS_PX, nearestPeople, type NearbyCandidate } from "./nearbyPeople";

const me = { x: 700, y: 1000 };

/** A person `distance` pixels to the right of `me`. */
function at(id: number, distance: number, name = `Person ${id}`): NearbyCandidate {
    return { id, name, x: me.x + distance, y: me.y };
}

describe("nearestPeople", () => {
    it("puts the nearest first, whatever the order they come in", () => {
        const { nearest } = nearestPeople(me, [at(1, 300), at(2, 40), at(3, 120)]);

        expect(nearest.map((person) => person.id)).toEqual([2, 3, 1]);
    });

    it("counts someone exactly eight tiles away as near and one pixel further as not", () => {
        const { nearCount } = nearestPeople(me, [at(1, NEAR_RADIUS_PX), at(2, NEAR_RADIUS_PX + 1)]);

        expect(nearCount).toBe(1);
    });

    it("measures the distance on both axes", () => {
        // 200 px right and 200 px down is 282 px away: outside the 256 px radius although each axis is inside it.
        const diagonal: NearbyCandidate = { id: 1, name: "Diagonal", x: me.x + 200, y: me.y + 200 };

        expect(nearestPeople(me, [diagonal]).nearCount).toBe(0);
    });

    it("keeps only the nearest four of a crowd and still counts every near person", () => {
        // 1000 people spread at 1 px steps: the first 256 are inside the radius, in a shuffled order.
        const crowd = Array.from({ length: 1000 }, (_, index) => at(index + 1, ((index * 389) % 1000) + 1));

        const { nearest, nearCount } = nearestPeople(me, crowd);

        expect(nearest.map((person) => person.id)).toEqual(
            [1, 2, 3, 4].map((distance) => crowd.find((person) => person.x - me.x === distance)?.id),
        );
        expect(nearCount).toBe(NEAR_RADIUS_PX);
    });

    it("shows the nearest people even when none is within the radius", () => {
        const { nearest, nearCount } = nearestPeople(me, [at(1, 900), at(2, 600)]);

        expect(nearest.map((person) => person.id)).toEqual([2, 1]);
        expect(nearCount).toBe(0);
    });

    it("breaks a tie by the lower id, never by the name", () => {
        const { nearest } = nearestPeople(me, [at(9, 50, "Alice"), at(3, 50, "Zed"), at(5, 50, "Bob")], { limit: 2 });

        expect(nearest.map((person) => person.id)).toEqual([3, 5]);
    });

    it("tells two people with the same name apart by their ids", () => {
        const { nearest } = nearestPeople(me, [at(1, 10, "Ana"), at(2, 20, "Ana")]);

        expect(nearest.map((person) => person.id)).toEqual([1, 2]);
    });

    it("answers an empty room with nobody", () => {
        expect(nearestPeople(me, [])).toEqual({ nearest: [], nearCount: 0 });
    });

    it("keeps no one when the limit is zero but still counts", () => {
        expect(nearestPeople(me, [at(1, 10)], { limit: 0 })).toEqual({ nearest: [], nearCount: 1 });
    });
});

describe("isSameNearby", () => {
    const base = { nearest: [{ id: 1, name: "Ana" }], nearCount: 3 };

    it("is true for the same people in the same order with the same count", () => {
        expect(isSameNearby(base, { nearest: [{ id: 1, name: "Ana" }], nearCount: 3 })).toBe(true);
    });

    it.each([
        ["a count", { nearest: base.nearest, nearCount: 4 }],
        ["a person", { nearest: [{ id: 2, name: "Ana" }], nearCount: 3 }],
        ["a name", { nearest: [{ id: 1, name: "Ana B" }], nearCount: 3 }],
        ["a length", { nearest: [], nearCount: 3 }],
    ])("is false when %s differs", (_what, other) => {
        expect(isSameNearby(base, other)).toBe(false);
    });
});
