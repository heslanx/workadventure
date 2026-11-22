/**
 * How many times, and how far apart, a failed fetch of livekit-client is retried before the user is asked to reload.
 *
 * The retry goes through the back (a new invitation, hence a new LiveKitRoom, which loads the library again), so one
 * counter has to live across rooms: it is module state, like the loader's. Without a bound, a page older than the
 * deployment (the hashed chunk is gone, every fetch is a 404) would send a Sentry event, an analytics event and a
 * request to the back every few seconds until the user reloads.
 *
 * No import, so that the tests (and the room) can use the real policy while mocking what reports it.
 */

/** The delay before each retry, in order: the first failure is retried after the first delay, and so on. */
export const LIVEKIT_LOAD_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000];

export interface LivekitClientLoadFailureDecision {
    /** 1 for the first failure of a streak (no success in between). */
    readonly attempt: number;
    /** Wait this long, then ask the back for a new invitation. Undefined: stop retrying, ask the user to reload. */
    readonly retryAfterMs: number | undefined;
}

export interface LivekitClientLoadRetryPolicy {
    /** Counts one more failed load and says what to do about it. */
    recordFailure(): LivekitClientLoadFailureDecision;
    /** The library arrived: the next failure starts a new streak. */
    recordSuccess(): void;
}

/** Exported for the tests, which give it their own delays. */
export function createLivekitClientLoadRetryPolicy(delaysMs: readonly number[]): LivekitClientLoadRetryPolicy {
    let failures = 0;
    return {
        recordFailure() {
            failures++;
            return { attempt: failures, retryAfterMs: delaysMs[failures - 1] };
        },
        recordSuccess() {
            failures = 0;
        },
    };
}

export const livekitClientLoadRetryPolicy = createLivekitClientLoadRetryPolicy(LIVEKIT_LOAD_RETRY_DELAYS_MS);
