import type * as Phaser from "phaser";
import { STAMP_SIZE, stampFrameName, type PersonShadow } from "../domain/personShadow";

/**
 * The few things a stamp sprite is asked: Phaser's Sprite has all of them. Its place, depth and alpha are written as
 * fields, and only when they changed: a call with a number argument makes a heap number for each, for every person on
 * every draw.
 */
export interface StampSprite {
    x: number;
    y: number;
    depth: number;
    alpha: number;
    readonly visible: boolean;
    setFrame(frame: string): unknown;
    setVisible(visible: boolean): unknown;
    destroy(): void;
}

export interface StampFactory {
    sprite(x: number, y: number, texture: string, frame: string): StampSprite;
}

/** What a stamp is placed from: the person's feet and the shadow picked for them. */
export interface StampPerson {
    readonly x: number;
    readonly y: number;
    readonly shadow: PersonShadow;
}

/**
 * The stamps under the people drawn in full: pooled sprites, one for each person, at the feet, just below the body
 * (`depth - 0.01`), their frame and alpha from the person's `PersonShadow`. They are Sprites, never Images: the effects
 * track the map's placed pieces as Images, and a stamp that moves every frame must not look like a piece that moved
 * (domain/placedSnapshot). A stamp is never put in the person's own list, so it carries no mark.
 */
export class PeopleStamps {
    private readonly pool: StampSprite[] = [];
    private readonly frames: string[] = [];
    // what each stamp was last given (x, y, depth, alpha), compared on a draw instead of reading the sprite back
    private last = new Float64Array(4 * 64);
    private used = 0;

    constructor(
        private readonly factory: StampFactory,
        private readonly texture: string,
    ) {}

    /** How many stamps are shown now. */
    get shown(): number {
        return this.used;
    }

    /** How many sprites the pool holds, shown or parked. */
    get size(): number {
        return this.pool.length;
    }

    /** Puts person number `i`'s stamp under their feet; `i` counts from 0 to the number of people this frame. */
    place(i: number, person: StampPerson, body: { readonly depth?: number }): void {
        const shadow = person.shadow;
        const frame = stampFrameName(shadow.direction, shadow.lengthClass);
        // whole pixels, and the frame is centred on the feet
        // `(v + 0.5) | 0` rounds a position on the map and makes no number: Math.round makes one while the code is still cold
        const x = (person.x + 0.5) | 0;
        const y = (person.y + 0.5) | 0;
        let sprite = this.pool[i];
        if (!sprite) {
            sprite = this.factory.sprite(x, y, this.texture, frame);
            this.pool[i] = sprite;
            this.frames[i] = frame;
            if (this.last.length < (i + 1) * 4) {
                const bigger = new Float64Array(Math.max(this.last.length * 2, (i + 1) * 4));
                bigger.set(this.last);
                this.last = bigger;
            }
            this.last.fill(Number.NaN, i * 4, i * 4 + 4); // nothing was given yet: the first draw writes all four
        }
        if (this.frames[i] !== frame) {
            sprite.setFrame(frame);
            this.frames[i] = frame;
        }
        const last = this.last;
        const at = i * 4;
        if (last[at] !== x) {
            sprite.x = x;
            last[at] = x;
        }
        if (last[at + 1] !== y) {
            sprite.y = y;
            last[at + 1] = y;
        }
        const depth = (body.depth ?? 0) - 0.01;
        if (last[at + 2] !== depth) {
            sprite.depth = depth;
            last[at + 2] = depth;
        }
        const alpha = shadow.alpha;
        if (last[at + 3] !== alpha) {
            sprite.alpha = alpha;
            last[at + 3] = alpha;
        }
        if (!sprite.visible) sprite.setVisible(true);
        if (i >= this.used) this.used = i + 1;
    }

    /** Parks the stamps from `count` on: nobody stands there this frame. */
    hideFrom(count: number): void {
        for (let i = count; i < this.pool.length; i++) {
            if (this.pool[i].visible) this.pool[i].setVisible(false);
        }
        if (this.used > count) this.used = count;
    }

    destroy(): void {
        for (const sprite of this.pool) sprite.destroy();
        this.pool.length = 0;
        this.frames.length = 0;
        this.used = 0;
    }
}

/** The stamp frames to add to an atlas texture: name and where in the picture. */
export function stampFrameRects(directions: number, classes: number): { name: string; x: number; y: number }[] {
    const out: { name: string; x: number; y: number }[] = [];
    for (let c = 0; c < classes; c++) {
        for (let d = 0; d < directions; d++)
            out.push({ name: stampFrameName(d, c), x: d * STAMP_SIZE, y: c * STAMP_SIZE });
    }
    return out;
}

/** The scene's factory as a stamp factory: a Phaser Sprite centred on its frame. */
export function spriteFactory(add: Pick<Phaser.GameObjects.GameObjectFactory, "sprite">): StampFactory {
    return {
        sprite: (x, y, texture, frame) => add.sprite(x, y, texture, frame).setOrigin(0.5, 0.5),
    };
}
