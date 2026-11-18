/**
 * How many avatars the scene builds in one frame, at most.
 *
 * A remote player is added to the scene at once, so every lookup finds it, but its sprites, name and companion are
 * built a few per frame. Entering a zone with 100 players used to create the sprites and the companions of all 100 in
 * the frame they arrived, and their names right after it, in 100 separate tasks.
 *
 * The count is a ceiling for builds that are cheap. It also bounds what the time budget cannot see: a companion reads
 * its picture back from the GPU in a promise callback, after the build that created it.
 */
export const MAX_AVATAR_BUILDS_PER_FRAME = 4;

/**
 * How long a frame keeps starting builds, in ms: a quarter of a 60 fps frame (16.7 ms). The code that built a name tag
 * in its own task said it could take up to 16 ms (not measured again here). At that cost a frame builds one avatar; when
 * builds are cheap it builds MAX_AVATAR_BUILDS_PER_FRAME. A build that starts under the budget is not interrupted, so a
 * frame can go over by the cost of one build. The value is a guess, to be calibrated on a browser with a GPU.
 */
export const AVATAR_BUILD_BUDGET_MS = 4;

interface Located {
    readonly x: number;
    readonly y: number;
}

/**
 * The avatars waiting to be built. Each frame, drain() builds the few nearest to a point (the local player), so the
 * avatars that can be seen are built first and a crowd arriving at once spreads over the next frames.
 */
export class AvatarBuildQueue {
    private readonly pending = new Map<Located, () => void>();

    /**
     * @param maxBuildsPerFrame The most avatars a drain builds.
     * @param budgetMs A drain starts no new build once it has spent this long (in ms). Infinity turns the budget off.
     * @param now The clock that measures the budget, in ms.
     */
    constructor(
        private readonly maxBuildsPerFrame = MAX_AVATAR_BUILDS_PER_FRAME,
        private readonly budgetMs = AVATAR_BUILD_BUDGET_MS,
        private readonly now: () => number = () => performance.now(),
    ) {}

    public get size(): number {
        return this.pending.size;
    }

    public enqueue(avatar: Located, build: () => void): void {
        this.pending.set(avatar, build);
    }

    /** Drops an avatar that is destroyed before its turn. */
    public remove(avatar: Located): void {
        this.pending.delete(avatar);
    }

    /**
     * Builds at most maxBuildsPerFrame avatars, the nearest to `from` first (in arrival order when `from` is not
     * given, or on a tie), and returns how many it built. It stops early when the builds have spent the budget, but
     * always builds one, so a queue of slow builds still empties.
     */
    public drain(from?: Located): number {
        if (this.pending.size === 0) {
            return 0;
        }
        const start = this.now();
        let built = 0;
        for (const avatar of this.nearest(from)) {
            const build = this.pending.get(avatar);
            if (build === undefined) {
                // A build that ran earlier in this drain removed it.
                continue;
            }
            this.pending.delete(avatar);
            build();
            built++;
            if (this.now() - start >= this.budgetMs) {
                break;
            }
        }
        return built;
    }

    private nearest(from: Located | undefined): Located[] {
        const nearest: { avatar: Located; distance: number }[] = [];
        for (const avatar of this.pending.keys()) {
            const distance = from === undefined ? 0 : (avatar.x - from.x) ** 2 + (avatar.y - from.y) ** 2;
            if (nearest.length === this.maxBuildsPerFrame && distance >= nearest[nearest.length - 1].distance) {
                continue;
            }
            let index = nearest.length;
            while (index > 0 && nearest[index - 1].distance > distance) {
                index--;
            }
            nearest.splice(index, 0, { avatar, distance });
            if (nearest.length > this.maxBuildsPerFrame) {
                nearest.pop();
            }
        }
        return nearest.map(({ avatar }) => avatar);
    }
}
