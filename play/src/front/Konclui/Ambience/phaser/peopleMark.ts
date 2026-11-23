import * as Phaser from "phaser";

/** What the mark needs of the renderer: the blend table and the two calls that add and set a blend mode. */
export type MarkRenderer = Pick<
    Phaser.Renderer.WebGL.WebGLRenderer,
    "blendModes" | "addBlendMode" | "updateBlendMode"
> & {
    readonly gl: Pick<WebGLRenderingContext, "ONE" | "ZERO" | "ONE_MINUS_SRC_ALPHA" | "FUNC_ADD">;
};

/**
 * Registers the blend mode that marks a person: the colour as ever, premultiplied, but the alpha taken down by what
 * the sprite covers (`dstA * (1 - srcA)`): an opaque pixel of the body leaves alpha 0 in the colour buffer, a clear pixel
 * of its quad leaves it alone, and anything drawn after it (a prop in front) writes alpha 1 again, so the camera pass
 * finds exactly the visible pixels of the people, with the occlusion right, by reading alpha. The plan wrote the
 * alpha factors as (ZERO, ZERO), which would clear the whole quad, bodies' transparent corners included.
 *
 * The id is the table's length before the call: `addBlendMode` returns the index minus one, so its answer is not used
 * (Phaser 4.2.1: the first custom mode is 18).
 */
export function registerPeopleBlend(renderer: MarkRenderer): number {
    // Phaser has no call to remove a blend mode, so one is added for each renderer and kept: a session that enters many rooms
    // would otherwise grow the table by one entry for each entry. The renderer lives as long as the game does.
    const known = REGISTERED.get(renderer);
    if (known !== undefined) return known;
    const id = renderer.blendModes.length;
    const { gl } = renderer;
    renderer.addBlendMode([gl.ONE, gl.ONE_MINUS_SRC_ALPHA], gl.FUNC_ADD);
    renderer.updateBlendMode(id, [gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA], gl.FUNC_ADD);
    REGISTERED.set(renderer, id);
    return id;
}

const REGISTERED = new WeakMap<object, number>();

/** Phaser's NORMAL blend mode: the only one a mark replaces. */
const NORMAL = 0;

interface Blended {
    blendMode: number;
    setBlendMode(mode: number): unknown;
}

const isBlended = (child: unknown): child is Blended =>
    child instanceof Phaser.GameObjects.Sprite || child instanceof Phaser.GameObjects.Image;

/**
 * Marks the sprites of the people drawn in full, and takes the marks off. Only a sprite or image whose blend mode is
 * NORMAL is marked, and only what was marked is given back, so another effect's blend mode is never touched.
 */
export class PeopleMarks {
    readonly id: number;
    private marked: Blended[] = [];
    private count = 0;

    constructor(renderer: MarkRenderer) {
        this.id = registerPeopleBlend(renderer);
    }

    /** How many sprites carry the mark now. */
    get size(): number {
        return this.count;
    }

    /** Marks every sprite or image in a body's list that is NORMAL. Idempotent. Allocates only when the pool grows. */
    mark(list: readonly unknown[]): void {
        for (let i = 0; i < list.length; i++) {
            const child = list[i];
            if (!isBlended(child) || child.blendMode !== NORMAL) continue;
            child.setBlendMode(this.id);
            this.marked[this.count] = child;
            this.count += 1;
        }
    }

    /** Takes the mark off what is still marked: those that were drawn and have not left. */
    unmark(): void {
        for (let i = 0; i < this.count; i++) {
            const child = this.marked[i];
            if (child.blendMode === this.id) child.setBlendMode(NORMAL);
        }
        this.count = 0;
    }

    /** Drops the records of sprites that are gone (destroyed with their body) and keeps the live marks. */
    forgetGone(): void {
        let kept = 0;
        for (let i = 0; i < this.count; i++) {
            const child = this.marked[i];
            // a destroyed game object has its `scene` unset; a made object that never had one is not destroyed
            if (!("scene" in child && child.scene === undefined) && child.blendMode === this.id) {
                this.marked[kept] = child;
                kept += 1;
            }
        }
        this.count = kept;
    }
}
