// @vitest-environment jsdom
import * as Phaser from "phaser";
import { describe, expect, it, vi } from "vitest";
import { PlacedSnapshot } from "../domain/placedSnapshot";
import { newPersonShadow } from "../domain/personShadow";
import { PeopleStamps, stampFrameRects, type StampFactory, type StampSprite } from "./peopleShadow";
import { isPlacedImage } from "./SceneEffects";

class FakeStamp implements StampSprite {
    visible = true;
    x = 0;
    y = 0;
    depth = 0;
    alpha = 1;
    frame: string;
    destroyed = false;
    readonly setFrame = vi.fn((f: string) => (this.frame = f));
    constructor(frame: string) {
        this.frame = frame;
    }
    setVisible(v: boolean): this {
        this.visible = v;
        return this;
    }
    destroy(): void {
        this.destroyed = true;
    }
}

function stamps() {
    const made: FakeStamp[] = [];
    const factory: StampFactory = {
        sprite: (_x, _y, _t, frame) => {
            const s = new FakeStamp(frame);
            made.push(s);
            return s;
        },
    };
    return { made, stamps: new PeopleStamps(factory, "kfx-stamps") };
}

const person = (x: number, y: number, shadow: ReturnType<typeof newPersonShadow>) => ({ x, y, shadow });
const shadow = (direction: number, lengthClass: number, alpha: number) => ({
    ...newPersonShadow(),
    direction,
    lengthClass,
    alpha,
    picked: true,
});

describe("PeopleStamps", () => {
    it("puts one stamp under each person, just below the body, on whole pixels", () => {
        const { stamps: s, made } = stamps();
        s.place(0, person(100.4, 200.6, shadow(6, 3, 0.62)), { depth: 50 });
        s.place(1, person(10, 20, shadow(0, 1, 0.45)), { depth: 7 });
        expect(made).toHaveLength(2);
        expect([made[0].x, made[0].y]).toEqual([100, 201]);
        expect(made[0].depth).toBeCloseTo(49.99);
        expect(made[0].alpha).toBe(0.62);
        expect(made[0].frame).toBe("d6-3");
        expect(s.shown).toBe(2);
    });

    it("reuses its sprites frame after frame and sets a frame only when it changes", () => {
        const { stamps: s, made } = stamps();
        for (let f = 0; f < 5; f++) s.place(0, person(f, 0, shadow(2, 1, 0.5)), { depth: 1 });
        expect(made).toHaveLength(1);
        expect(made[0].setFrame).not.toHaveBeenCalled();
        s.place(0, person(5, 0, shadow(3, 1, 0.5)), { depth: 1 });
        expect(made[0].setFrame).toHaveBeenCalledWith("d3-1");
    });

    it("parks the stamps of people who are gone and shows them again for the next arrival", () => {
        const { stamps: s, made } = stamps();
        for (let i = 0; i < 3; i++) s.place(i, person(i, i, shadow(0, 0, 0.5)), { depth: 1 });
        s.hideFrom(1);
        expect(made.map((m) => m.visible)).toEqual([true, false, false]);
        expect(s.shown).toBe(1);
        s.place(1, person(5, 5, shadow(0, 0, 0.5)), { depth: 1 });
        expect(made[1].visible).toBe(true);
        expect(s.size).toBe(3);
    });

    it("destroys its sprites", () => {
        const { stamps: s, made } = stamps();
        s.place(0, person(0, 0, shadow(0, 0, 0.5)), { depth: 1 });
        s.destroy();
        expect(made[0].destroyed).toBe(true);
        expect(s.size).toBe(0);
    });

    it("lists the 64 frames of the atlas, 40 px apart", () => {
        const rects = stampFrameRects(16, 4);
        expect(rects).toHaveLength(64);
        expect(rects.find((r) => r.name === "d3-2")).toEqual({ name: "d3-2", x: 120, y: 80 });
    });
});

describe("a stamp among the scene's children", () => {
    // Seen failing with an Image used for the stamp: it moved every frame, the placed-pieces snapshot changed every
    // second, and the lights, footprints and the cast bake were all worked out again.
    it("is a Sprite, so moving it never reads as a piece of the map that moved", () => {
        const piece = Object.create(Phaser.GameObjects.Image.prototype) as Phaser.GameObjects.Image;
        Object.assign(piece, { type: "Image", texture: { key: "maps/entities/a.png" }, x: 10, y: 20 });
        // a real Image reads its size from its frame; this one has none
        Object.defineProperties(piece, { displayWidth: { value: 32 }, displayHeight: { value: 32 } });
        const stamp = Object.create(Phaser.GameObjects.Sprite.prototype) as Phaser.GameObjects.Sprite;
        Object.assign(stamp, { type: "Sprite", texture: { key: "kfx-stamps" }, x: 1, y: 1 });
        const children: unknown[] = [piece, stamp];
        const snapshot = new PlacedSnapshot();
        snapshot.capture(children.filter(isPlacedImage));
        expect(isPlacedImage(stamp)).toBe(false);
        stamp.x = 77;
        stamp.y = 88;
        expect(snapshot.matches(children, isPlacedImage)).toBe(true);
        // and an Image that moves does read as a change: the snapshot still sees pieces
        piece.x = 11;
        expect(snapshot.matches(children, isPlacedImage)).toBe(false);
    });
});
