import type * as Phaser from "phaser";
import type { AvatarDetailLevel } from "./AvatarDetail";
import {
    AVATAR_DETAIL_BUDGET,
    chooseFullDetail,
    DETAIL_RECOMPUTE_INTERVAL_MS,
    type DetailCandidate,
} from "./AvatarDetail";
import { DEPTH_OVERLAY_INDEX } from "./DepthIndexes";

export const AVATAR_DOT_TEXTURE = "avatar-detail-dot";
// A dot is half an avatar wide, centred where the avatar stands.
const DOT_SIZE = 16;
const DOT_RADIUS = DOT_SIZE / 2;
const DOT_COLORS = [0xfff4db, 0xffbaa4, 0xf7d76d, 0xadce93, 0x83d6ce, 0x91bde7, 0xc1ace9, 0xf0abcd];
const DOT_OUTLINE_COLOR = 0x1b2a41;
/** How close the pointer must be to a dot, in screen pixels, to draw that avatar in full. */
export const AVATAR_DOT_HOVER_RADIUS = 12;
// Above every avatar and under the map's overlay layers, like the avatars themselves.
const DEPTH_AVATAR_DOTS = DEPTH_OVERLAY_INDEX - 1;

/** A Phaser Blitter bob: what the layer needs of it. */
export interface DotBob {
    x: number;
    y: number;
    readonly visible: boolean;
    setVisible(visible: boolean): unknown;
    destroy(): void;
}

/** A Phaser Blitter: one game object, one draw, for every dot. */
export interface DotBlitter {
    create(x: number, y: number, frame?: number): DotBob;
    destroy(): void;
}

export interface DetailAvatar {
    readonly x: number;
    readonly y: number;
    /** Picks the colour of its dot, among DOT_COLORS. */
    readonly userId?: number;
    /**
     * The sprites it draws itself with. An avatar whose sprites were dropped (see RemotePlayer.setDetail()) builds them
     * again some frames after it is asked to be full: its dot stays until it has some. Left out, the avatar is drawn the
     * moment it is asked to be full.
     */
    readonly sprites?: { readonly size: number };
    /** Draws the avatar in full, or hides it (sprites, name, companion) for its dot. See RemotePlayer.setDetail(). */
    setDetail(detail: AvatarDetailLevel): void;
}

/** What the layer reads from the scene at each recompute. */
export interface AvatarDetailSource<T> {
    avatars(): Iterable<T>;
    /** Culled avatars are not in the view; a culled avatar stays culled whatever its detail, and its dot is hidden. */
    isCulled(avatar: T): boolean;
    /** The avatars that stay full whatever the budget: followed, following, in the player's bubble. */
    pinned(): readonly T[];
    /** Where the local player is, or undefined before it exists. */
    origin(): { readonly x: number; readonly y: number } | undefined;
    /**
     * Where the pointer is now, in world pixels, with how close to an avatar it must be to hover it; undefined when it
     * is not over the game. Read at each recompute, so a pointer that does not move still hovers what comes under it.
     */
    pointer(): { readonly x: number; readonly y: number; readonly radius: number } | undefined;
}

/**
 * Applies the detail budget (chooseFullDetail()) to the remote avatars and draws the ones over it as dots of one
 * Blitter: no sprite, no animation, no name tag, one draw for them all.
 *
 * The budget is recomputed on the first update after a join or a leave (requestRecompute()), DETAIL_ZOOM_SETTLE_MS
 * after the zoom last changed (requestRecompute(DETAIL_ZOOM_SETTLE_MS)), when the pointer comes onto another avatar or
 * leaves the hovered one (pointerMoved()), and every DETAIL_RECOMPUTE_INTERVAL_MS. The avatar under the pointer, read
 * again at each recompute, is always drawn in full. Between recomputes, an update moves the visible dots with
 * their avatars and hides the dots of culled avatars.
 *
 * An avatar that becomes full while its sprites are dropped (RemotePlayer, with the zero-work flag) gets them back some
 * frames later, in a turn of the build queue: its dot stays, and keeps following it, until then, so that something is
 * drawn at every frame.
 */
export class AvatarDotLayer<T extends DetailAvatar> {
    private readonly dots = new Map<T, DotBob>();
    // The avatars that were asked to be full while they wear a dot, until their sprites are back.
    private readonly promoting = new Set<T>();
    private full = new Set<T>();
    private computed = false;
    private hovered: T | undefined;
    private lastTime = 0;
    private nextRecomputeAt = -Infinity;
    private settleAt: number | undefined;
    private recomputeRequested = true;

    constructor(
        private readonly source: AvatarDetailSource<T>,
        private readonly blitter: DotBlitter,
        private readonly budget: number = AVATAR_DETAIL_BUDGET,
    ) {}

    /**
     * The avatars the budget keeps full, or undefined until the first recompute has run (before it, every avatar is
     * drawn in full and none is in the set). It is not the list of what is drawn: it holds the full avatars that are
     * culled, and those whose sprites are not back yet. A reader keeps to the avatars it draws.
     */
    public get fullDetailPlayers(): ReadonlySet<T> | undefined {
        return this.computed ? this.full : undefined;
    }

    public get dotCount(): number {
        return this.dots.size;
    }

    /**
     * Recomputes at the next update, or, with a delay, at the first update `delayMs` after the last such call: a zoom
     * asks at each step, and the budget follows once it has settled.
     */
    public requestRecompute(delayMs = 0): void {
        if (delayMs <= 0) {
            this.recomputeRequested = true;
            return;
        }
        this.settleAt = this.lastTime + delayMs;
    }

    /**
     * The pointer moved (see AvatarDetailSource.pointer()): the avatar under it, a dot or drawn in full, stays or is
     * drawn in full, and a recompute follows at the next update if that avatar changed.
     */
    public pointerMoved(): void {
        if (this.updateHovered(this.source.avatars())) {
            this.recomputeRequested = true;
        }
    }

    /**
     * The avatar in view nearest the pointer, within its radius; the one already hovered while the pointer stays within
     * the radius of it.
     * @returns Whether the hovered avatar changed.
     */
    private updateHovered(avatars: Iterable<T>): boolean {
        const pointer = this.source.pointer();
        let hovered: T | undefined;
        if (pointer !== undefined) {
            const radiusSq = pointer.radius * pointer.radius;
            const current = this.hovered;
            if (
                current !== undefined &&
                !this.source.isCulled(current) &&
                distanceSq(current, pointer.x, pointer.y) <= radiusSq
            ) {
                hovered = current;
            } else {
                let nearest = radiusSq;
                for (const avatar of avatars) {
                    const distance = distanceSq(avatar, pointer.x, pointer.y);
                    if (distance <= nearest && !this.source.isCulled(avatar)) {
                        nearest = distance;
                        hovered = avatar;
                    }
                }
            }
        }
        const changed = hovered !== this.hovered;
        this.hovered = hovered;
        return changed;
    }

    /** Forgets an avatar that left the scene. */
    public forget(avatar: T): void {
        this.dots.get(avatar)?.destroy();
        this.dots.delete(avatar);
        this.promoting.delete(avatar);
        this.full.delete(avatar);
        if (this.hovered === avatar) {
            this.hovered = undefined;
        }
        this.recomputeRequested = true;
    }

    /** @returns Whether the frame looks different: an avatar changed detail, or a dot moved, appeared or disappeared. */
    public update(time: number): boolean {
        this.lastTime = time;
        let changed = false;
        if (
            this.recomputeRequested ||
            time >= this.nextRecomputeAt ||
            (this.settleAt !== undefined && time >= this.settleAt)
        ) {
            this.recomputeRequested = false;
            this.settleAt = undefined;
            this.nextRecomputeAt = time + DETAIL_RECOMPUTE_INTERVAL_MS;
            changed = this.recompute();
        }
        return this.syncDots() || changed;
    }

    public destroy(): void {
        this.dots.clear();
        this.promoting.clear();
        this.full.clear();
        this.computed = false;
        this.hovered = undefined;
        this.blitter.destroy();
    }

    private recompute(): boolean {
        const origin = this.source.origin();
        if (origin === undefined) {
            return false;
        }
        const avatars = [...this.source.avatars()];
        this.updateHovered(avatars);
        const pinned = new Set(this.source.pinned());
        if (this.hovered !== undefined) {
            pinned.add(this.hovered);
        }
        const candidates: DetailCandidate<T>[] = [];
        for (const avatar of avatars) {
            candidates.push({
                key: avatar,
                distanceSq: distanceSq(avatar, origin.x, origin.y),
                inView: !this.source.isCulled(avatar),
                pinned: pinned.has(avatar),
            });
        }
        const full = chooseFullDetail(candidates, this.full, this.budget);
        let changed = false;
        for (const { key: avatar, inView } of candidates) {
            const dot = this.dots.get(avatar);
            if (full.has(avatar)) {
                if (dot !== undefined && !this.promoting.has(avatar)) {
                    avatar.setDetail("full");
                    if (hasSprites(avatar)) {
                        dot.destroy();
                        this.dots.delete(avatar);
                    } else {
                        // Its sprites come back in a turn of the build queue: until then the dot is all that is drawn.
                        this.promoting.add(avatar);
                    }
                    changed ||= inView;
                }
            } else if (dot === undefined) {
                // Shown by syncDots(), which also knows whether the avatar is culled.
                const created = this.blitter.create(
                    Math.round(avatar.x) - DOT_RADIUS,
                    Math.round(avatar.y) - DOT_RADIUS,
                    (avatar.userId ?? 0) & 7,
                );
                created.setVisible(false);
                this.dots.set(avatar, created);
                avatar.setDetail("dot");
                changed ||= inView;
            } else if (this.promoting.delete(avatar)) {
                // Asked to be a dot again before its sprites came back: the dot never left.
                avatar.setDetail("dot");
                changed ||= inView;
            }
        }
        this.full = full;
        this.computed = true;
        return changed;
    }

    private dotsChanged = false;
    private readonly syncDot = (dot: DotBob, avatar: T): void => {
        const shown = !this.source.isCulled(avatar);
        if (dot.visible !== shown) {
            dot.setVisible(shown);
            this.dotsChanged = true;
        }
        if (!shown) return;
        const x = Math.round(avatar.x) - DOT_RADIUS;
        const y = Math.round(avatar.y) - DOT_RADIUS;
        if (dot.x !== x) {
            dot.x = x;
            this.dotsChanged = true;
        }
        if (dot.y !== y) {
            dot.y = y;
            this.dotsChanged = true;
        }
    };

    private readonly finishPromotion = (avatar: T): void => {
        if (!hasSprites(avatar)) {
            return;
        }
        this.promoting.delete(avatar);
        const dot = this.dots.get(avatar);
        if (dot !== undefined) {
            this.dotsChanged ||= dot.visible;
            dot.destroy();
            this.dots.delete(avatar);
        }
    };

    private syncDots(): boolean {
        this.dotsChanged = false;
        this.promoting.forEach(this.finishPromotion);
        this.dots.forEach(this.syncDot);
        return this.dotsChanged;
    }
}

function hasSprites(avatar: DetailAvatar): boolean {
    return avatar.sprites === undefined || avatar.sprites.size > 0;
}

/** The Blitter that draws the dots of a scene, with its texture made once per game. */
export function createAvatarDotBlitter(scene: Phaser.Scene): Phaser.GameObjects.Blitter {
    if (!scene.textures.exists(AVATAR_DOT_TEXTURE)) {
        const atlas = scene.textures.createCanvas(AVATAR_DOT_TEXTURE, DOT_SIZE * DOT_COLORS.length, DOT_SIZE);
        if (!atlas) throw new Error("Could not create avatar dot atlas");
        const context = atlas.getContext();
        for (let frame = 0; frame < DOT_COLORS.length; frame++) {
            const offset = frame * DOT_SIZE;
            const fill = "#" + DOT_COLORS[frame].toString(16).padStart(6, "0");
            const outline = "#" + DOT_OUTLINE_COLOR.toString(16).padStart(6, "0");
            for (let y = 0; y < DOT_SIZE; y++) {
                for (let x = 0; x < DOT_SIZE; x++) {
                    const radiusSq = (x + 0.5 - DOT_RADIUS) ** 2 + (y + 0.5 - DOT_RADIUS) ** 2;
                    if (radiusSq > DOT_RADIUS ** 2) continue;
                    context.fillStyle = radiusSq <= (DOT_RADIUS - 2) ** 2 ? fill : outline;
                    context.fillRect(offset + x, y, 1, 1);
                }
            }
            atlas.add(frame, 0, offset, 0, DOT_SIZE, DOT_SIZE);
        }
        atlas.refresh();
    }
    return scene.add.blitter(0, 0, AVATAR_DOT_TEXTURE).setDepth(DEPTH_AVATAR_DOTS);
}

function distanceSq(avatar: DetailAvatar, x: number, y: number): number {
    const dx = avatar.x - x;
    const dy = avatar.y - y;
    return dx * dx + dy * dy;
}
