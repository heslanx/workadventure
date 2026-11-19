import type { Observable, Subscription } from "rxjs";

/** The smallest margin around the camera view, in world pixels: how far an avatar's name, companion and speech reach. */
const MIN_CULLING_MARGIN = 64;
/** The margin grows with the view, so that a zoomed-out view, where names are larger in world pixels, keeps its edge. */
const CULLING_MARGIN_RATIO = 0.05;

/** The camera view in world pixels, like Phaser's `camera.worldView`. */
export interface CullingView {
    readonly x: number;
    readonly y: number;
    readonly right: number;
    readonly bottom: number;
}

interface ActivityToggle {
    setActive(active: boolean): unknown;
}

/** A Phaser container with sprites: what it draws is its own visibility, what it updates is its sprites' activity. */
interface CullableObject extends ActivityToggle {
    setVisible(visible: boolean): unknown;
    readonly sprites: ReadonlyMap<string, ActivityToggle>;
}

export interface CullableAvatar extends CullableObject {
    readonly x: number;
    readonly y: number;
    readonly moved$: Observable<unknown>;
    readonly companion?: CullableObject;
    /**
     * Tells the avatar that it is culled (`true`) or drawn again (`false`), for what is not a Phaser object of its own:
     * its name tag, a DOM element that Phaser's visibility does not reach.
     *
     * Culled, the tag must be hidden and must not follow the avatar's moves, so that a move costs nothing; drawn again,
     * it must be where the avatar is. Calling it twice with the same value changes nothing. An avatar that builds its
     * tag late must remember the last call, so that the tag it builds while culled starts hidden. It is called after
     * the avatar and its companion were drawn or hidden.
     *
     * An avatar without this member keeps a tag that follows every move (see isMoveHidden()).
     */
    setCulled?(culled: boolean): void;
}

/**
 * Stops drawing and updating the remote avatars that are outside the camera view.
 *
 * A culled avatar and its companion are neither visible nor active: the renderer skips its container (and so every
 * sprite in it) and the scene no longer advances the animations of its sprites. Its position is still updated, so it
 * is where it should be when it comes back. Its name tag is a DOM element of its own, which Phaser does not hide: the
 * avatar's `setCulled()` does.
 *
 * Whether an avatar is culled is recomputed when something it depends on changed: the camera view, the avatars that
 * must stay drawn, or an avatar's own position. An avatar builds its sprites and its companion when its turn comes,
 * which can be after it was culled, and those start drawn and active. So each update also checks, for each culled
 * avatar, that it has built nothing since it was last culled, and culls what it built. Between changes an update costs
 * a few comparisons and one pass over the culled avatars.
 */
export class RemotePlayerCulling<T extends CullableAvatar = CullableAvatar> {
    private readonly tracked = new Map<T, Subscription>();
    // The culled avatars, with how much each had built when it was last culled.
    private readonly culled = new Map<T, number>();
    // The avatars that joined or moved since the last update.
    private readonly changed = new Set<T>();
    // The rectangle the last update compared the avatars with. NaN until the first update.
    private left = NaN;
    private top = NaN;
    private right = NaN;
    private bottom = NaN;
    private kept: readonly T[] = [];

    /** Starts culling an avatar. It is evaluated by the next update. */
    public track(avatar: T): void {
        this.untrack(avatar);
        this.tracked.set(
            avatar,
            avatar.moved$.subscribe(() => {
                this.changed.add(avatar);
            }),
        );
        this.changed.add(avatar);
    }

    /** Forgets an avatar that is destroyed or no longer culled. It keeps the state it has. */
    public untrack(avatar: T): void {
        this.tracked.get(avatar)?.unsubscribe();
        this.tracked.delete(avatar);
        this.culled.delete(avatar);
        this.changed.delete(avatar);
    }

    public clear(): void {
        for (const subscription of this.tracked.values()) {
            subscription.unsubscribe();
        }
        this.tracked.clear();
        this.culled.clear();
        this.changed.clear();
    }

    public isCulled(avatar: T): boolean {
        return this.culled.has(avatar);
    }

    /**
     * Culls the avatars that are outside the view, and draws again those that came back into it.
     *
     * @param view The camera view.
     * @param kept The avatars that stay drawn wherever they are: the one the camera follows, the ones in the current
     * bubble. The local player is not an avatar of this class, so it is never culled.
     * @returns Whether an avatar was culled or drawn again, i.e. whether the next frame looks different.
     */
    public update(view: CullingView, kept: readonly T[] = []): boolean {
        const margin = Math.max(
            MIN_CULLING_MARGIN,
            CULLING_MARGIN_RATIO * Math.max(view.right - view.x, view.bottom - view.y),
        );
        const left = view.x - margin;
        const top = view.y - margin;
        const right = view.right + margin;
        const bottom = view.bottom + margin;

        const keptSet = new Set(kept);
        let candidates: Iterable<T> = this.changed;
        if (
            left !== this.left ||
            top !== this.top ||
            right !== this.right ||
            bottom !== this.bottom ||
            !sameAvatars(kept, this.kept)
        ) {
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
            this.kept = kept.slice();
            candidates = this.tracked.keys();
        }
        let toggled = false;
        for (const avatar of candidates) {
            toggled = this.evaluate(avatar, keptSet) || toggled;
        }
        this.changed.clear();
        this.cullWhatCulledAvatarsBuilt();
        return toggled;
    }

    /**
     * Whether a move of this avatar leaves the frame as it was: the avatar is culled, and so is everything that follows
     * its position, its name tag included. An avatar that cannot hide its name tag (no `setCulled()`) is not: the tag
     * follows each move with a write of its own that is queued until the next render, so its moves need a frame.
     */
    public isMoveHidden(avatar: T): boolean {
        return this.culled.has(avatar) && avatar.setCulled !== undefined;
    }

    private evaluate(avatar: T, kept: ReadonlySet<T>): boolean {
        const cull = this.shouldCull(avatar, kept);
        if (cull === this.culled.has(avatar)) {
            return false;
        }
        setDrawn(avatar, !cull);
        if (cull) {
            this.culled.set(avatar, built(avatar));
        } else {
            this.culled.delete(avatar);
        }
        return true;
    }

    // What a culled avatar built meanwhile starts drawn and active. It is hidden again in the frame it was built, so it
    // is never drawn, and whether the avatar moves or the view scrolls does not matter.
    private cullWhatCulledAvatarsBuilt(): void {
        for (const [avatar, builtWhenCulled] of this.culled) {
            const builtNow = built(avatar);
            if (builtNow !== builtWhenCulled) {
                setDrawn(avatar, false);
                this.culled.set(avatar, builtNow);
            }
        }
    }

    private shouldCull(avatar: T, kept: ReadonlySet<T>): boolean {
        return (
            !kept.has(avatar) &&
            (avatar.x < this.left || avatar.x > this.right || avatar.y < this.top || avatar.y > this.bottom)
        );
    }
}

/** How much an avatar has built: a number that grows with each sprite of the avatar and with its companion. */
function built(avatar: CullableAvatar): number {
    return avatar.sprites.size + (avatar.companion === undefined ? 0 : 1 + avatar.companion.sprites.size);
}

// `setCulled()` comes last, so that an avatar drawn again can hide what its own state does not draw (a dot, see
// RemotePlayer.setDetail()).
function setDrawn(avatar: CullableAvatar, drawn: boolean): void {
    setObjectDrawn(avatar, drawn);
    if (avatar.companion !== undefined) {
        setObjectDrawn(avatar.companion, drawn);
    }
    avatar.setCulled?.(!drawn);
}

function setObjectDrawn(object: CullableObject, drawn: boolean): void {
    object.setVisible(drawn);
    object.setActive(drawn);
    for (const sprite of object.sprites.values()) {
        sprite.setActive(drawn);
    }
}

function sameAvatars<T>(avatars: readonly T[], others: readonly T[]): boolean {
    return avatars.length === others.length && avatars.every((avatar, index) => avatar === others[index]);
}
