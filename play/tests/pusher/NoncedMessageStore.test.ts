import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoncedMessageStore } from "../../src/common/NoncedMessageStore";

const bytes = (length: number) => new Uint8Array(length);
const nonces = (messages: { nonce: number }[]) => messages.map(({ nonce }) => nonce);

describe("NoncedMessageStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("prunes the messages past their age, keeps the fresh ones, and counts only what it keeps", () => {
        const store = new NoncedMessageStore(1_000);
        store.add(1, bytes(10));
        store.add(2, bytes(20));
        vi.advanceTimersByTime(600);
        store.add(3, bytes(40));
        vi.advanceTimersByTime(400);

        expect(nonces(store.getAll())).toEqual([3]);
        expect(store.size).toBe(1);
        expect(store.byteSize).toBe(40);
    });

    it("prunes a long run of expired messages in one go and leaves the rest in order", () => {
        const store = new NoncedMessageStore(1_000);
        for (let nonce = 1; nonce <= 5_000; nonce++) {
            store.add(nonce, bytes(1));
        }
        vi.advanceTimersByTime(500);
        store.add(5_001, bytes(1));
        store.add(5_002, bytes(1));
        vi.advanceTimersByTime(600);

        expect(nonces(store.getAll())).toEqual([5_001, 5_002]);
        expect(store.byteSize).toBe(2);
    });

    it("returns the messages after a nonce, in order, and none when the peer is up to date", () => {
        const store = new NoncedMessageStore();
        for (let nonce = 1; nonce <= 5; nonce++) {
            store.add(nonce, bytes(1));
        }

        expect(nonces(store.getAfter(0))).toEqual([1, 2, 3, 4, 5]);
        expect(nonces(store.getAfter(3))).toEqual([4, 5]);
        expect(store.getAfter(5)).toEqual([]);
        expect(store.getAfter(99)).toEqual([]);
    });

    it("answers getAfter from the end: it does not read the messages before the nonce it is given", () => {
        const store = new NoncedMessageStore();
        const reads: number[] = [];
        for (let nonce = 1; nonce <= 1_000; nonce++) {
            store.add(nonce, bytes(1));
        }
        // A counting window over the stored nonces: the store reads `nonce` of each message it looks at.
        const messages = (store as unknown as { messages: { nonce: number }[] }).messages;
        for (const message of messages) {
            let value = message.nonce;
            Object.defineProperty(message, "nonce", {
                get: () => {
                    reads.push(value);
                    return value;
                },
                set: (next: number) => {
                    value = next;
                },
            });
        }

        expect(nonces(store.getAfter(995))).toEqual([996, 997, 998, 999, 1_000]);
        // The five wanted ones, the one that stops the walk, and the five returned: not the 995 before.
        expect(reads.length).toBeLessThan(20);
    });

    it("is not capped by default: a lot of messages and bytes are kept", () => {
        const store = new NoncedMessageStore();
        for (let nonce = 1; nonce <= 10_000; nonce++) {
            expect(store.add(nonce, bytes(1_000))).toBe(true);
        }

        expect(store.size).toBe(10_000);
        expect(store.hasEveryNonceAfter(0)).toBe(true);
    });

    it("treats a limit of 0 as no limit", () => {
        const store = new NoncedMessageStore(30_000, { maxMessages: 0, maxBytes: 0 });
        for (let nonce = 1; nonce <= 100; nonce++) {
            expect(store.add(nonce, bytes(1_000))).toBe(true);
        }
        expect(store.size).toBe(100);
    });

    it("drops everything over the message limit, the message just added included, and says so", () => {
        const store = new NoncedMessageStore(30_000, { maxMessages: 2 });
        expect(store.add(1, bytes(1))).toBe(true);
        expect(store.add(2, bytes(1))).toBe(true);
        expect(store.add(3, bytes(1))).toBe(false);

        expect(store.getAll()).toEqual([]);
        expect(store.size).toBe(0);
        expect(store.byteSize).toBe(0);
    });

    it("drops everything over the byte limit, and frees bytes as messages expire", () => {
        const capped = new NoncedMessageStore(1_000, { maxBytes: 10 });
        expect(capped.add(1, bytes(6))).toBe(true);
        expect(capped.add(2, bytes(4))).toBe(true);
        expect(capped.add(3, bytes(1))).toBe(false);
        expect(capped.size).toBe(0);

        const ageing = new NoncedMessageStore(1_000, { maxBytes: 10 });
        ageing.add(1, bytes(6));
        ageing.add(2, bytes(4));
        vi.advanceTimersByTime(1_001);
        // The 10 bytes expired: they no longer count towards the limit.
        expect(ageing.add(3, bytes(9))).toBe(true);
        expect(new NoncedMessageStore(1_000, { maxBytes: 10 }).add(1, bytes(11))).toBe(false);
    });

    it("refuses a resume that needs a message a limit dropped, and takes one that does not", () => {
        const store = new NoncedMessageStore(30_000, { maxMessages: 3 });
        for (let nonce = 1; nonce <= 4; nonce++) {
            store.add(nonce, bytes(1));
        }
        // Empty after the overflow at 4. A peer that has 2 is missing 3 and 4: replaying nothing would leave a gap.
        expect(store.hasEveryNonceAfter(2)).toBe(false);
        expect(store.hasEveryNonceAfter(3)).toBe(false);
        expect(store.hasEveryNonceAfter(4)).toBe(true);

        // And once messages are kept again, the oldest of them must follow what the peer has.
        store.add(5, bytes(1));
        store.add(6, bytes(1));
        expect(store.hasEveryNonceAfter(2)).toBe(false);
        expect(store.hasEveryNonceAfter(4)).toBe(true);
        expect(nonces(store.getAfter(4))).toEqual([5, 6]);
    });

    it("keeps accepting a resume of an empty store when only age emptied it, while the store has no limit", () => {
        const store = new NoncedMessageStore(1_000);
        store.add(1, bytes(1));
        store.add(2, bytes(1));
        vi.advanceTimersByTime(1_001);

        expect(store.hasEveryNonceAfter(0)).toBe(true);
    });

    it("refuses a resume that missed messages age removed, when the store has a limit: they are gone, not never sent", () => {
        const store = new NoncedMessageStore(1_000, { maxMessages: 10 });
        for (let nonce = 11; nonce <= 20; nonce++) {
            store.add(nonce, bytes(1));
        }
        vi.advanceTimersByTime(1_001);

        expect(store.getAll()).toEqual([]);
        expect(store.hasEveryNonceAfter(10)).toBe(false);
        expect(store.hasEveryNonceAfter(19)).toBe(false);
        // A peer that has everything that was ever added still resumes.
        expect(store.hasEveryNonceAfter(20)).toBe(true);
    });

    it("refuses it after an overflow whose later messages also aged out, for a peer that missed the later ones", () => {
        const store = new NoncedMessageStore(1_000, { maxMessages: 2 });
        store.add(1, bytes(1));
        store.add(2, bytes(1));
        store.add(3, bytes(1)); // overflow: 1 to 3 dropped
        store.add(4, bytes(1));
        store.add(5, bytes(1));
        vi.advanceTimersByTime(1_001); // 4 and 5 age out

        // Past the overflow (3) but short of 5: it missed 4 and 5, which are gone.
        expect(store.hasEveryNonceAfter(4)).toBe(false);
        expect(store.hasEveryNonceAfter(5)).toBe(true);
    });
});
