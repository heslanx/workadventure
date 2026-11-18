import { describe, expect, it } from "vitest";
import { MoveRateLimiter } from "../../src/pusher/services/MoveRateLimiter";

describe("MoveRateLimiter", () => {
    it("lets a full burst through at once, then refuses", () => {
        const limiter = new MoveRateLimiter(3, 10);

        const results = [0, 0, 0, 0].map((nowMs) => limiter.tryConsume(nowMs));

        expect(results).toEqual([true, true, true, false]);
    });

    it("gains one token every 100 ms at 10 a second", () => {
        const limiter = new MoveRateLimiter(1, 10);
        limiter.tryConsume(0);

        expect([limiter.tryConsume(99), limiter.tryConsume(100)]).toEqual([false, true]);
    });

    it("never holds more than its capacity, however long the pause", () => {
        const limiter = new MoveRateLimiter(2, 10);
        limiter.tryConsume(0);

        const results = [60_000, 60_000, 60_000].map((nowMs) => limiter.tryConsume(nowMs));

        expect(results).toEqual([true, true, false]);
    });

    it("adds no token when the clock goes back, and counts from the new time afterwards", () => {
        const limiter = new MoveRateLimiter(1, 10);
        limiter.tryConsume(10_000);

        expect(limiter.tryConsume(5_000)).toBe(false);
        expect(limiter.tryConsume(5_100)).toBe(true);
    });

    it.each([
        { capacity: 0, tokensPerSecond: 10 },
        { capacity: 1, tokensPerSecond: 0 },
    ])("refuses a bucket that could never let a move through: $capacity, $tokensPerSecond", (args) => {
        expect(() => new MoveRateLimiter(args.capacity, args.tokensPerSecond)).toThrow();
    });
});
