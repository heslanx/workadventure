import { describe, expect, it } from "vitest";
import type { Room } from "./geometry";
import { CellValue, countInRooms, coverage, type Rect } from "./geometry";
import { motionAllowed } from "./motion";

describe("geometry", () => {
    it("measures coverage, counts people per room and honours the motion switch", () => {
        expect(coverage([0, 0, 50, 50], [0, 0, 100, 100])).toBe(0.25);
        expect(coverage([200, 0, 50, 50], [0, 0, 100, 100])).toBe(0);
        const rooms: Room[] = [
            { key: "a", floor: [0, 0, 100, 100] },
            { key: "b", floor: [200, 0, 100, 100] },
        ];
        const counts = new Int32Array(rooms.length);
        for (const [x, y] of [
            [10, 10],
            [20, 90],
            [250, 50],
            [150, 50],
        ])
            countInRooms(counts, rooms, x, y);
        expect([...counts]).toEqual([2, 1]);
        expect(motionAllowed()).toBe(true);
        for (const key of ["reducedMotion", "saver", "simple", "animationsOff"]) {
            expect(motionAllowed({ [key]: true }), key).toBe(false);
        }
    });
});

describe("CellValue", () => {
    const view = (x: number, y = 0, w = 300, h = 200): Rect => [x, y, w, h];

    it("works the number out once while the view stays in one cell, and again in the next", () => {
        const value = new CellValue(8, (v) => v[0]);

        expect(value.get(view(0))).toBe(0);
        expect(value.get(view(7.9)), "the same cell: the number of its first view").toBe(0);
        expect(value.get(view(8))).toBe(8);
        expect(value.runs).toBe(2);
    });

    it("works it out again when the view's size changes, as a zoom does", () => {
        const value = new CellValue(8, (v) => v[2]);

        expect(value.get(view(0, 0, 300))).toBe(300);
        expect(value.get(view(0, 0, 320))).toBe(320);
        expect(value.get(view(0, 0, 320.4)), "the size is rounded to whole px").toBe(320);
        expect(value.runs).toBe(2);
    });
});
