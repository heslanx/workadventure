// @vitest-environment jsdom
import * as Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";
import { PeopleMarks, registerPeopleBlend, type MarkRenderer } from "./peopleMark";

const GL = { ONE: 1, ZERO: 0, ONE_MINUS_SRC_ALPHA: 771, FUNC_ADD: 32774 };

/** A renderer that keeps its blend table as Phaser 4.2.1 does: 18 built-in modes, then the added ones. */
function renderer(): MarkRenderer & { table: { func: number[]; equation: number[] }[] } {
    const table: { func: number[]; equation: number[] }[] = Array.from({ length: 18 }, () => ({
        func: [1, 771, 1, 771],
        equation: [GL.FUNC_ADD, GL.FUNC_ADD],
    }));
    return {
        gl: GL,
        table,
        blendModes: table as unknown as MarkRenderer["blendModes"],
        // as Phaser's: pushes, and answers the index minus one
        addBlendMode: vi.fn((func: number[], equation: number) => {
            table.push({ func: [func[0], func[1], func[0], func[1]], equation: [equation, equation] });
            return table.length - 1 - 1;
        }),
        updateBlendMode: vi.fn((index: number, func: number[], equation: number) => {
            if (index > 17 && table[index]) {
                table[index].func = func.length === 2 ? [func[0], func[1], func[0], func[1]] : [...func];
                table[index].equation = [equation, equation];
            }
            return undefined;
        }),
    } as unknown as MarkRenderer & { table: { func: number[]; equation: number[] }[] };
}

function sprite(blendMode = 0): Phaser.GameObjects.Sprite {
    const s = Object.create(Phaser.GameObjects.Sprite.prototype) as Phaser.GameObjects.Sprite & { _b: number };
    s._b = blendMode;
    Object.defineProperty(s, "blendMode", { get: () => s._b, configurable: true });
    s.setBlendMode = (mode: number) => {
        s._b = mode;
        return s;
    };
    return s;
}

describe("registerPeopleBlend", () => {
    it("takes the table's length as the id, not addBlendMode's answer (the index minus one)", () => {
        const r = renderer();
        const before = r.blendModes.length;
        expect(before).toBe(18);
        const id = registerPeopleBlend(r);
        expect(id).toBe(18);
        expect(r.blendModes.length).toBe(19);
        expect(r.addBlendMode).toHaveReturnedWith(17);
    });

    // Seen growing: one entry for each room a session entered, as Phaser cannot remove a blend mode.
    it("adds the blend mode once for a renderer, however many rooms are built on it, and once for another", () => {
        const r = renderer();
        const first = registerPeopleBlend(r);
        for (let room = 0; room < 5; room++) expect(registerPeopleBlend(r)).toBe(first);
        expect(r.blendModes.length).toBe(19);
        expect(r.addBlendMode).toHaveBeenCalledTimes(1);
        const other = renderer();
        expect(registerPeopleBlend(other)).toBe(18);
        expect(other.addBlendMode).toHaveBeenCalledTimes(1);
    });

    it("reads back as ONE, ONE_MINUS_SRC_ALPHA for the colour and ZERO, ONE_MINUS_SRC_ALPHA for the alpha", () => {
        const r = renderer();
        const id = registerPeopleBlend(r);
        expect(r.table[id].func).toEqual([GL.ONE, GL.ONE_MINUS_SRC_ALPHA, GL.ZERO, GL.ONE_MINUS_SRC_ALPHA]);
        expect(r.table[id].equation).toEqual([GL.FUNC_ADD, GL.FUNC_ADD]);
    });

    it("takes the next free id when another effect registered one first", () => {
        const r = renderer();
        r.addBlendMode([1, 1], GL.FUNC_ADD);
        expect(registerPeopleBlend(r)).toBe(19);
    });
});

describe("PeopleMarks", () => {
    it("marks the NORMAL sprites of a body and leaves every other blend mode alone", () => {
        const marks = new PeopleMarks(renderer());
        const a = sprite(0);
        const add = sprite(1);
        marks.mark([a, add, { not: "a sprite" }, "text"]);
        expect(a.blendMode).toBe(marks.id);
        expect(add.blendMode).toBe(1);
        expect(marks.size).toBe(1);
    });

    it("is idempotent: marking a marked sprite again changes nothing and counts it once", () => {
        const marks = new PeopleMarks(renderer());
        const a = sprite(0);
        marks.mark([a]);
        marks.mark([a]);
        expect(a.blendMode).toBe(marks.id);
        expect(marks.size).toBe(1);
    });

    it("gives every mark back, and only its own, when it is taken off", () => {
        const marks = new PeopleMarks(renderer());
        const a = sprite(0);
        const b = sprite(0);
        marks.mark([a, b]);
        b.setBlendMode(1); // another effect took it since
        marks.unmark();
        expect(a.blendMode).toBe(0);
        expect(b.blendMode).toBe(1);
        expect(marks.size).toBe(0);
    });

    it("forgets a sprite that was destroyed with its body", () => {
        const marks = new PeopleMarks(renderer());
        const a = sprite(0) as unknown as { scene?: unknown };
        const b = sprite(0) as unknown as { scene?: unknown };
        a.scene = {};
        b.scene = undefined;
        marks.mark([a, b]);
        marks.forgetGone();
        expect(marks.size).toBe(1);
    });
});
