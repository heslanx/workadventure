/**
 * A token bucket that refills from the clock each time it is asked, so a socket pays for no timer.
 *
 * It holds at most `capacity` tokens, which is the burst a client may send at once, and gains `tokensPerSecond` as
 * time passes. A call to `tryConsume` takes one token if there is one.
 */
export class MoveRateLimiter {
    private tokens: number;
    private lastRefillMs: number | undefined;

    constructor(
        private readonly capacity: number,
        private readonly tokensPerSecond: number,
    ) {
        if (capacity < 1) {
            throw new Error("Capacity must be at least 1");
        }
        if (tokensPerSecond <= 0) {
            throw new Error("Tokens per second must be greater than 0");
        }
        this.tokens = capacity;
    }

    /**
     * @param nowMs - The current time in milliseconds. A value earlier than the previous one adds no token.
     * @returns Whether a token was available, and was taken.
     */
    public tryConsume(nowMs: number): boolean {
        if (this.lastRefillMs !== undefined) {
            const elapsedMs = Math.max(0, nowMs - this.lastRefillMs);
            this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs * this.tokensPerSecond) / 1000);
        }
        this.lastRefillMs = nowMs;

        if (this.tokens < 1) {
            return false;
        }
        this.tokens -= 1;
        return true;
    }
}
