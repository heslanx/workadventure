import { POSITION_DELAY, WOKA_SPEED } from "../../Enum/EnvironmentVariable";

/**
 * Remote positions arrive once per POSITION_DELAY while a player walks, and the receiver draws each one over the next
 * POSITION_DELAY. A server that thins the stream (far avatars at 1 Hz, a capped move rate) would leave such an avatar
 * still for most of every interval. The receiver therefore follows the interval it observes per remote player.
 */

// A smoothed interval at or below this keeps today's draw duration, so walkers at 5 Hz or faster look exactly as before.
export const SLOW_SAMPLE_INTERVAL_MS = 300;
// The longest draw duration. A slower stream is drawn over this and the avatar waits for the next sample.
export const MAX_DRAW_DURATION_MS = 1500;
// A gap longer than this is a pause (culling, packet loss), not an update interval.
export const MAX_SAMPLE_GAP_MS = 3000;
// Weight of the newest gap in the smoothed interval when the gap is shorter than the estimate.
const INTERVAL_FALL_SMOOTHING = 0.3;
// Fastest walk is the speed-up key at 2.5 times WOKA_SPEED, moving WOKA_SPEED * 20 pixels per second.
const MAX_WALK_SPEED_PX_PER_MS = (WOKA_SPEED * 20 * 2.5) / 1000;
// Slack over the fastest walk before a jump counts as a teleport.
const TELEPORT_SLACK = 1.5;

/** What the receiver remembers about the last sample of one remote player. */
export interface SampleIntervalState {
    tick: number;
    x: number;
    y: number;
    moving: boolean;
    /** Smoothed gap between samples in ms. Undefined until two samples of one walk have been seen. */
    interval: number | undefined;
}

export interface Sample {
    x: number;
    y: number;
    moving: boolean;
}

export interface DrawPlan {
    /** Time to draw the avatar from where it is now to the new sample. */
    duration: number;
    /** The new sample is a jump no walk can make in the observed interval: place the avatar there at once. */
    snap: boolean;
}

/**
 * Folds one observed gap into the smoothed interval. A longer gap is taken at once: a draw shorter than the real
 * interval leaves the avatar still until the next sample, while a draw that is too long only slows it down. This is
 * what lets a stream that drops from 5 Hz to 1 Hz stop being stop-and-go from its second slow sample on. A shorter gap
 * is smoothed, so one early sample does not shorten the draw.
 */
export function nextInterval(previous: number | undefined, gap: number): number {
    if (previous === undefined || gap >= previous) {
        return gap;
    }
    return previous + INTERVAL_FALL_SMOOTHING * (gap - previous);
}

/** The draw duration for a smoothed interval. Undefined or fast intervals keep POSITION_DELAY. */
export function drawDurationFor(interval: number | undefined): number {
    if (interval === undefined || interval <= SLOW_SAMPLE_INTERVAL_MS) {
        return POSITION_DELAY;
    }
    return Math.min(interval, MAX_DRAW_DURATION_MS);
}

/** Tracks the sample interval of each remote player and turns every new sample into a draw plan. */
export class RemoteSampleIntervals {
    private readonly states = new Map<number, SampleIntervalState>();

    public observe(userId: number, tick: number, sample: Sample): DrawPlan {
        const previous = this.states.get(userId);
        const gap = previous === undefined ? undefined : tick - previous.tick;
        // After a stop or a pause the gap says nothing about the stream: start again from POSITION_DELAY.
        const continuesWalk =
            previous !== undefined && previous.moving && gap !== undefined && gap <= MAX_SAMPLE_GAP_MS;
        const interval = continuesWalk && gap !== undefined ? nextInterval(previous.interval, gap) : undefined;
        this.states.set(userId, { tick, x: sample.x, y: sample.y, moving: sample.moving, interval });

        const duration = drawDurationFor(interval);
        if (!continuesWalk || gap === undefined || duration === POSITION_DELAY) {
            return { duration, snap: false };
        }
        const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y);
        return { duration, snap: distance > MAX_WALK_SPEED_PX_PER_MS * gap * TELEPORT_SLACK };
    }

    public forget(userId: number): void {
        this.states.delete(userId);
    }
}
