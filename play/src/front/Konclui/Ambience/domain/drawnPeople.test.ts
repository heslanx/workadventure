import { describe, expect, it, vi } from "vitest";
import { DRAWN_REBUILD_MS, DrawnPeople } from "./drawnPeople";

interface Body {
    visible: boolean;
    reads: number;
}

/** A character whose `visible` counts how often it is read. */
function body(visible: boolean): Body {
    let reads = 0;
    let shown = visible;
    return {
        get visible() {
            reads += 1;
            return shown;
        },
        set visible(value: boolean) {
            shown = value;
        },
        get reads() {
            return reads;
        },
    };
}

/** A crowd of `size` characters, the first `drawn` of them drawn. */
function crowd(size: number, drawn: number): Map<number, Body> {
    return new Map(Array.from({ length: size }, (_, i) => [i, body(i < drawn)]));
}

describe("the characters the scene draws", () => {
    it("are the visible ones of the crowd, with their keys", () => {
        const people = crowd(10, 3);
        const set = new DrawnPeople(people, () => undefined);

        expect(set.bodies(0)).toEqual([people.get(0), people.get(1), people.get(2)]);
        expect(set.keys).toEqual([0, 1, 2]);
    });

    it("look at the 1,000 once for the frames of a quarter of a second, not on each", () => {
        const people = crowd(1000, 80);
        const set = new DrawnPeople(people, () => undefined);

        for (let time = 0; time < DRAWN_REBUILD_MS; time += 16) set.bodies(time);

        expect(set.rebuilds).toBe(1);
        const hiddenReads = [...people.values()].slice(80).reduce((total, b) => total + b.reads, 0);
        expect(hiddenReads, "each hidden character was read once, at the look").toBe(920);
    });

    it("look again after a quarter of a second, and when the crowd's size changes", () => {
        const people = crowd(5, 2);
        const set = new DrawnPeople(people, () => undefined);
        set.bodies(0);

        set.bodies(DRAWN_REBUILD_MS - 1);
        expect(set.rebuilds).toBe(1);
        set.bodies(DRAWN_REBUILD_MS);
        expect(set.rebuilds).toBe(2);
        people.set(99, body(true));
        expect(set.bodies(DRAWN_REBUILD_MS + 1), "a join is seen at once").toHaveLength(3);
        expect(set.rebuilds).toBe(3);
    });

    it("take a character the scene begins to draw between two looks in at the next one, a quarter of a second at most", () => {
        const people = crowd(5, 2);
        const set = new DrawnPeople(people, () => undefined);
        set.bodies(0);

        const promoted = people.get(4);
        if (!promoted) throw new Error("no fifth character");
        promoted.visible = true; // a dot promoted to full detail, at 16 ms
        expect(set.bodies(16), "not at once: the look is 250 ms away").toHaveLength(2);
        expect(set.bodies(DRAWN_REBUILD_MS - 1)).toHaveLength(2);

        expect(set.bodies(DRAWN_REBUILD_MS), "at the next look").toHaveLength(3);
    });

    it("look again when asked, and when the clock goes back", () => {
        const set = new DrawnPeople(crowd(3, 1), () => undefined);
        set.bodies(1000);

        set.invalidate();
        set.bodies(1001);
        expect(set.rebuilds).toBe(2);
        set.bodies(5);
        expect(set.rebuilds, "a clock that restarted").toBe(3);
    });

    it("name the character that was drawn at the last look and is not now, once", () => {
        const people = crowd(4, 4);
        const left = vi.fn();
        const set = new DrawnPeople(people, left);
        set.bodies(0);

        people.get(2)!.visible = false; // culled
        people.get(3)!.visible = false; // a dot
        set.bodies(DRAWN_REBUILD_MS);
        set.bodies(DRAWN_REBUILD_MS * 2);

        expect(left.mock.calls).toEqual([[2], [3]]);
        expect(set.keys).toEqual([0, 1]);
    });

    it("name a character that left the room", () => {
        const people = crowd(3, 3);
        const left = vi.fn();
        const set = new DrawnPeople(people, left);
        set.bodies(0);

        people.delete(1);
        set.bodies(1);

        expect(left).toHaveBeenCalledExactlyOnceWith(1);
    });

    it("hand out the same array each time, so a frame makes none", () => {
        const set = new DrawnPeople(crowd(3, 2), () => undefined);

        expect(set.bodies(0)).toBe(set.bodies(300));
    });
});
