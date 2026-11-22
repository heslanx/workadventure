/** What the snapshot reads of a placed image: its texture key and where it stands. */
export interface PlacedLike {
    readonly texture: { readonly key: string };
    readonly x: number;
    readonly y: number;
}

/**
 * The placed images of a scene as they were when last captured: the texture key and the position of each, in order.
 * Everything the effects work out from the map's pieces (footprints, lights, screens) depends on those three things
 * only, so `matches` tells in one pass over the scene's children, allocating nothing, whether any of that work has to
 * be done again. A map of about 660 pieces would otherwise be filtered, mapped, joined and sorted once a second to
 * find out nothing moved.
 */
export class PlacedSnapshot {
    private readonly keys: string[] = [];
    private readonly xs: number[] = [];
    private readonly ys: number[] = [];
    private count = -1;

    /** Whether the placed ones among `children` (by `isPlaced`) are the ones captured: same count, keys, positions. */
    matches<T extends PlacedLike>(children: readonly unknown[], isPlaced: (child: unknown) => child is T): boolean {
        let n = 0;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!isPlaced(child)) continue;
            if (
                n >= this.count ||
                this.keys[n] !== child.texture.key ||
                this.xs[n] !== child.x ||
                this.ys[n] !== child.y
            )
                return false;
            n += 1;
        }
        return n === this.count;
    }

    /** Remembers `placed`, in order. Allocates only when there are more of them than ever before. */
    capture(placed: readonly PlacedLike[]): void {
        for (let i = 0; i < placed.length; i++) {
            const image = placed[i];
            this.keys[i] = image.texture.key;
            this.xs[i] = image.x;
            this.ys[i] = image.y;
        }
        this.count = placed.length;
    }
}
