/** The most steps per second the game takes on a screen that refreshes faster than this. */
export const GAME_STEP_CAP_HZ = 60;

const STEP_INTERVAL_MS = 1000 / GAME_STEP_CAP_HZ;

/**
 * How much earlier than its slot a frame may arrive and still be stepped. A 60 Hz screen (or the 16 ms tick of
 * BackgroundBootPump) must never lose a step to timestamp jitter, so a frame up to this early is stepped and the slot
 * moves to it.
 */
const EARLY_TOLERANCE_MS = 1;

/**
 * Caps the game step at 60 per second without Phaser's own `fps.limit`.
 *
 * `TimeStep.stepLimitFPS` (Phaser 4.2.1, the bug of Phaser pull request 7395) hands its accumulated time to the step
 * and keeps the remainder (`this.delta %= limitRate`), so the remainder is delivered twice: a 60 limit makes a 120 Hz
 * screen run the simulation 1.2 to 1.5 times too fast, and it drops steps on a 60 Hz screen whose timestamps
 * jitter. Here a skipped frame adds its delta up instead and the next step gets exactly the sum, so the deltas the
 * game sees always add up to the real time that passed.
 *
 * Steps sit on a 60 Hz schedule. A 120 Hz screen steps every second frame, 144 Hz on a 2, 2, 3 frame pattern (60 per
 * second on average), and a screen at 60 Hz or below steps every frame.
 */
export class StepCap {
    private nextStepTime = Number.NEGATIVE_INFINITY;
    private skippedDelta = 0;

    /**
     * Returns the delta the step must be given, or undefined when this frame is skipped (its delta is kept for the next
     * step). `time` and `delta` are the ones Phaser's TimeStep passes to the step.
     */
    public admit(time: number, delta: number): number | undefined {
        if (time < this.nextStepTime - EARLY_TOLERANCE_MS) {
            this.skippedDelta += delta;
            return undefined;
        }

        // A frame far behind its slot (a stall, a wake from sleep) starts a new schedule instead of running a burst.
        this.nextStepTime =
            time - this.nextStepTime > STEP_INTERVAL_MS
                ? time + STEP_INTERVAL_MS
                : Math.min(this.nextStepTime + STEP_INTERVAL_MS, time + STEP_INTERVAL_MS);

        const total = delta + this.skippedDelta;
        this.skippedDelta = 0;
        return total;
    }
}
