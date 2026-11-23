import type { ShadingLevel } from "./shadingLevel";

/** Intervals above this are a hidden tab or a breakpoint, not a slow GPU. */
export const IGNORED_ABOVE_MS = 250;
export const SLOW_MS = 24;
export const SLOW_RUN = 90;
export const FAST_MS = 14;
export const FAST_RUN = 600;
export const SETTLE_MS = 30_000;
export const MAX_CHANGES = 3;

/**
 * Steps the shading down when frames run slow and back up when they run fast, from the frame intervals it is given (no
 * clock of its own: the time since the last change is the sum of the intervals counted). 90 intervals in a row above
 * 24 ms step it down one level; 600 in a row under 14 ms and at least 30 s since the last change step it up, never
 * above the level it was picked at. After three changes in a session the level is locked.
 */
export class ShadingGovernor {
    private current: ShadingLevel;
    private slow = 0;
    private fast = 0;
    private sinceChange = 0;
    private changes = 0;

    constructor(private readonly ceiling: ShadingLevel) {
        this.current = ceiling;
    }

    get level(): ShadingLevel {
        return this.current;
    }

    get locked(): boolean {
        return this.changes >= MAX_CHANGES;
    }

    /** Takes one frame interval in ms; true when the level changed. */
    push(interval: number): boolean {
        if (!(interval > 0) || interval > IGNORED_ABOVE_MS || this.locked) return false;
        this.sinceChange += interval;
        if (interval > SLOW_MS) {
            this.slow += 1;
            this.fast = 0;
        } else if (interval < FAST_MS) {
            this.fast += 1;
            this.slow = 0;
        } else {
            this.slow = 0;
            this.fast = 0;
        }
        if (this.slow >= SLOW_RUN && this.current > 0) return this.move(-1);
        if (this.fast >= FAST_RUN && this.sinceChange >= SETTLE_MS && this.current < this.ceiling) return this.move(1);
        return false;
    }

    private move(step: -1 | 1): boolean {
        this.current = (this.current + step) as ShadingLevel;
        this.slow = 0;
        this.fast = 0;
        this.sinceChange = 0;
        this.changes += 1;
        return true;
    }
}
