import { describe, expect, it } from "vitest";
import {
    AVATAR_DETAIL_BUDGET,
    AVATAR_DETAIL_STORAGE_KEY,
    chooseFullDetail,
    type DetailCandidate,
    isAvatarDetailBudgetEnabled,
} from "../../../../src/front/Phaser/Game/AvatarDetail";

/** Avatars 1 to `count`, avatar n at distance n from the player. */
function crowd(count: number, overrides: Partial<Record<number, Partial<DetailCandidate<number>>>> = {}) {
    return Array.from({ length: count }, (_, index) => {
        const key = index + 1;
        return { key, distanceSq: key * key, inView: true, pinned: false, ...overrides[key] };
    });
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const sorted = (keys: Iterable<number>) => [...keys].sort((a, b) => a - b);

describe("chooseFullDetail", () => {
    it("keeps every avatar full while the view holds no more than the budget", () => {
        const candidates = crowd(AVATAR_DETAIL_BUDGET + 40, {
            // 40 avatars outside the view: the view holds exactly the budget.
            ...Object.fromEntries(range(1, 40).map((key) => [key, { inView: false }])),
        });

        const full = chooseFullDetail(candidates, new Set());

        expect(full.size).toBe(AVATAR_DETAIL_BUDGET);
        expect(sorted(full)).toEqual(range(41, AVATAR_DETAIL_BUDGET + 40));
    });

    it("keeps the budget's nearest avatars full and makes the others dots", () => {
        const full = chooseFullDetail(crowd(1000), new Set());

        expect(sorted(full)).toEqual(range(1, AVATAR_DETAIL_BUDGET));
    });

    it("keeps a pinned avatar full however far, and it takes one place of the budget", () => {
        const full = chooseFullDetail(crowd(1000, { 1000: { pinned: true } }), new Set());

        expect(full.size).toBe(AVATAR_DETAIL_BUDGET);
        expect(full.has(1000)).toBe(true);
        expect(full.has(AVATAR_DETAIL_BUDGET)).toBe(false);
    });

    it("keeps every pinned avatar full even when they are more than the budget", () => {
        const pinned = Object.fromEntries(range(901, 1000).map((key) => [key, { pinned: true }]));

        const full = chooseFullDetail(crowd(1000, pinned), new Set());

        expect(sorted(full)).toEqual(range(901, 1000));
    });

    it("gives the places the view leaves to the nearest avatars outside it", () => {
        // 10 avatars in the view, far away; the 990 others are outside it and nearer.
        const candidates = crowd(1000).map((candidate) => ({ ...candidate, inView: candidate.key > 990 }));

        const full = chooseFullDetail(candidates, new Set(), 20);

        expect(sorted(full)).toEqual([...range(1, 10), ...range(991, 1000)]);
    });

    // 1 to 80 were full. The farthest of them, 80, ranks as if it were at 80 / 1.25 = 64.
    const previous = new Set(range(1, AVATAR_DETAIL_BUDGET));

    it("does not swap a full avatar for a dot that is only a little closer", () => {
        const candidates = crowd(1000, { 120: { distanceSq: 70 * 70 } });

        const full = chooseFullDetail(candidates, previous);

        expect(sorted(full)).toEqual(range(1, AVATAR_DETAIL_BUDGET));
    });

    it("swaps the farthest full avatar for a dot that is clearly closer", () => {
        const candidates = crowd(1000, { 120: { distanceSq: 60 * 60 } });

        const full = chooseFullDetail(candidates, previous);

        expect(sorted(full)).toEqual([...range(1, AVATAR_DETAIL_BUDGET - 1), 120]);
    });
});

describe("isAvatarDetailBudgetEnabled", () => {
    const storage = (value: string | null) => ({
        getItem: (key: string) => (key === AVATAR_DETAIL_STORAGE_KEY ? value : null),
    });

    it("is off by default", () => {
        expect(isAvatarDetailBudgetEnabled(storage(null))).toBe(false);
        expect(isAvatarDetailBudgetEnabled(undefined)).toBe(false);
    });

    it("follows the storage override", () => {
        expect(isAvatarDetailBudgetEnabled(storage("1"))).toBe(true);
        expect(isAvatarDetailBudgetEnabled(storage("0"))).toBe(false);
    });

    it("falls back to the default when the storage throws", () => {
        const blocked = {
            getItem: () => {
                throw new Error("SecurityError");
            },
        };

        expect(isAvatarDetailBudgetEnabled(blocked)).toBe(false);
    });
});
