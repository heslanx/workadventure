import { describe, expect, it } from "vitest";
import type { Room } from "./geometry";
import { coverage, occupancy } from "./geometry";
import { motionAllowed } from "./motion";

describe("geometry", () => {
    it("measures coverage, counts people per room and honours the motion switch", () => {
        expect(coverage([0, 0, 50, 50], [0, 0, 100, 100])).toBe(0.25);
        expect(coverage([200, 0, 50, 50], [0, 0, 100, 100])).toBe(0);
        const rooms: Room[] = [
            { key: "a", floor: [0, 0, 100, 100] },
            { key: "b", floor: [200, 0, 100, 100] },
        ];
        expect(
            occupancy(rooms, [
                { x: 10, y: 10 },
                { x: 20, y: 90 },
                { x: 250, y: 50 },
                { x: 150, y: 50 },
            ]),
        ).toEqual({ a: 2, b: 1 });
        expect(motionAllowed()).toBe(true);
        for (const key of ["reducedMotion", "saver", "simple", "animationsOff"]) {
            expect(motionAllowed({ [key]: true }), key).toBe(false);
        }
    });
});
