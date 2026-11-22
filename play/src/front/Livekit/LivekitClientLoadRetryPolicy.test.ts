import { describe, expect, it } from "vitest";
import { LIVEKIT_LOAD_RETRY_DELAYS_MS, createLivekitClientLoadRetryPolicy } from "./LivekitClientLoadRetryPolicy";

describe("LivekitClientLoadRetryPolicy", () => {
    it("retries after growing delays, then stops for good while the failures keep coming", () => {
        const policy = createLivekitClientLoadRetryPolicy([1000, 4000]);

        const decisions = [1, 2, 3, 4, 5].map(() => policy.recordFailure());

        expect(decisions).toEqual([
            { attempt: 1, retryAfterMs: 1000 },
            { attempt: 2, retryAfterMs: 4000 },
            { attempt: 3, retryAfterMs: undefined },
            { attempt: 4, retryAfterMs: undefined },
            { attempt: 5, retryAfterMs: undefined },
        ]);
    });

    it("starts a new streak once the library has arrived", () => {
        const policy = createLivekitClientLoadRetryPolicy([1000, 4000]);
        policy.recordFailure();
        policy.recordFailure();

        policy.recordSuccess();

        expect(policy.recordFailure()).toEqual({ attempt: 1, retryAfterMs: 1000 });
    });

    it("has delays that grow, and a bound that is finite", () => {
        expect(LIVEKIT_LOAD_RETRY_DELAYS_MS.length).toBeGreaterThan(0);
        expect(LIVEKIT_LOAD_RETRY_DELAYS_MS).toEqual([...LIVEKIT_LOAD_RETRY_DELAYS_MS].sort((a, b) => a - b));
    });
});
