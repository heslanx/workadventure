/** What the set reads of a character: whether the scene draws it. A culled character and a dot are not drawn. */
export interface Drawable {
    readonly visible: boolean;
}

/** How often the set looks at every character again, in ms: the pace the detail budget itself recomputes at. */
export const DRAWN_REBUILD_MS = 250;

/**
 * The characters the scene draws in full, out of a crowd of which most are culled (outside the camera) or dots (past the
 * detail budget). The effects shade, mirror and trail only these: a hidden character has nothing on screen to shade.
 *
 * Looking at every character costs a read of each, so it is done every `DRAWN_REBUILD_MS`, when the crowd's size
 * changes, and on request; between two looks a frame reads only the drawn ones (the list is the same array each time,
 * and a frame still asks each member whether it is drawn, so a character hidden since the look drops out at once). A
 * character that came into view since the look joins at the next one, a quarter of a second at most.
 */
export class DrawnPeople<K, B extends Drawable> {
    private readonly list: B[] = [];
    private readonly listKeys: K[] = [];
    private readonly stamps = new Map<K, number>();
    private generation = 0;
    private size = -1;
    private builtAt = Number.NEGATIVE_INFINITY;
    /** How many times every character was looked at: a measure for tests. */
    public rebuilds = 0;

    // Written by index and cut to length once, not emptied with `length = 0` and pushed to: V8 frees the storage of an
    // array set to length 0, and the next push makes it again, a few KB at each look.
    private count = 0;

    private readonly collect = (body: B, key: K): void => {
        if (!body.visible) return;
        this.list[this.count] = body;
        this.listKeys[this.count] = key;
        this.count += 1;
        this.stamps.set(key, this.generation);
    };

    // The characters drawn at the last look and not at this one are forgotten (deleting from a Map during its own
    // forEach is allowed, and no iterator is made).
    private readonly sweep = (stamp: number, key: K): void => {
        if (stamp === this.generation) return;
        this.stamps.delete(key);
        this.left(key);
    };

    /**
     * @param crowd the scene's characters by key, read live
     * @param left called with the key of a character that was drawn at the last look and is not now: it left the view,
     * became a dot, or left the room
     * @param every ms between two looks
     */
    constructor(
        private readonly crowd: ReadonlyMap<K, B>,
        private readonly left: (key: K) => void,
        private readonly every = DRAWN_REBUILD_MS,
        private readonly visitCandidates = (collect: (body: B, key: K) => void) => crowd.forEach(collect),
    ) {}

    /** The drawn characters, as of the last look. The array is reused: do not keep it past the frame. */
    bodies(now: number): readonly B[] {
        if (this.crowd.size !== this.size || now - this.builtAt >= this.every || now < this.builtAt) this.rebuild(now);
        return this.list;
    }

    /** The keys of the characters `bodies` gave at the last call, in the same order. Reused like the list. */
    get keys(): readonly K[] {
        return this.listKeys;
    }

    /** Looks at every character on the next call to `bodies`. */
    invalidate(): void {
        this.builtAt = Number.NEGATIVE_INFINITY;
    }

    private rebuild(now: number): void {
        this.builtAt = now;
        this.size = this.crowd.size;
        this.rebuilds += 1;
        this.generation += 1;
        this.count = 0;
        this.visitCandidates(this.collect);
        if (this.list.length !== this.count) {
            this.list.length = this.count;
            this.listKeys.length = this.count;
        }
        this.stamps.forEach(this.sweep);
    }
}
