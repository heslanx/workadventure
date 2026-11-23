/** What the snapshot reads of a placed image: its texture key and where it stands. */
export interface PlacedLike {
    readonly texture: { readonly key: string };
    readonly x: number;
    readonly y: number;
    /** Mirrored and the size it is drawn at: the shadows a piece casts depend on them. Optional: a piece without them is 0 and not flipped. */
    readonly flipX?: boolean;
    readonly displayWidth?: number;
    readonly displayHeight?: number;
}

/**
 * The placed images of a scene as they were when last captured: the texture key and the position of each, in order.
 * Everything the effects work out from the map's pieces (footprints, lights, screens, and the shadows they cast)
 * depends on those things only (and, for the shadows, on whether a piece is mirrored and the size it is drawn at), so `matches` tells in one pass over the scene's children, allocating nothing, whether any of that work has to
 * be done again. A map of about 660 pieces would otherwise be filtered, mapped, joined and sorted once a second to
 * find out nothing moved.
 */
export class PlacedSnapshot {
    private readonly keys: string[] = [];
    private readonly xs: number[] = [];
    private readonly ys: number[] = [];
    private readonly flips: boolean[] = [];
    private readonly widths: number[] = [];
    private readonly heights: number[] = [];
    private count = -1;

    /**
     * @param shape also track whether a piece is mirrored and the size it is drawn at, which the cast shadows depend on.
     * Off by default: a room without the shading reads only what it always read.
     */
    constructor(private readonly shape = false) {}

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
                this.ys[n] !== child.y ||
                (this.shape &&
                    (this.flips[n] !== (child.flipX ?? false) ||
                        this.widths[n] !== (child.displayWidth || 0) ||
                        this.heights[n] !== (child.displayHeight || 0)))
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
            if (this.shape) {
                this.flips[i] = image.flipX ?? false;
                this.widths[i] = image.displayWidth || 0;
                this.heights[i] = image.displayHeight || 0;
            }
        }
        this.count = placed.length;
    }
}
