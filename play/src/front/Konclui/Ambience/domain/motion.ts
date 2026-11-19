export interface StillnessRequests {
    readonly reducedMotion?: boolean;
    readonly saver?: boolean;
    readonly simple?: boolean;
    readonly animationsOff?: boolean;
}

/** Time-driven effects move only when nothing asks for stillness. */
export function motionAllowed({
    reducedMotion = false,
    saver = false,
    simple = false,
    animationsOff = false,
}: StillnessRequests = {}): boolean {
    return !(reducedMotion || saver || simple || animationsOff);
}

/**
 * 0..1 eased progress of a transition that started at `start` and lasts `ms`. A transition of no length is over as it
 * starts, including at the very moment it started (a plain division would give NaN there, which a shader reads as
 * garbage).
 */
export function progress(now: number, start: number, ms: number): number {
    if (ms <= 0) return 1;
    const t = Math.max(0, Math.min(1, (now - start) / ms));
    return t * t * (3 - 2 * t);
}

/** Cloud shadows drift with the wind while someone looks at the lawn; the offset moves in whole pixels. */
export class CloudClock {
    private seconds = 0;

    constructor(private readonly wind: readonly [x: number, y: number] = [3, 1.1]) {}

    offset(): [x: number, y: number] {
        return [Math.floor(this.seconds * this.wind[0]), Math.floor(this.seconds * this.wind[1])];
    }

    /** Advance dt seconds; true when the drawn offset changed. */
    advance(dt: number): boolean {
        const before = this.offset().join();
        this.seconds += dt;
        return this.offset().join() !== before;
    }
}
