import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { savedSetting } from "./savedSetting";

/** An owner that saves a volume and keeps it between 0 and 10, as an upstream store may adjust what it is given. */
function owner(start: number) {
    const state = { saved: start, writes: 0 };
    return {
        state,
        setting: savedSetting(
            () => state.saved,
            (value: number) => {
                state.writes += 1;
                state.saved = Math.min(10, Math.max(0, value));
            },
        ),
    };
}

describe("savedSetting", () => {
    it("shows what the owner has saved", () => {
        const { setting } = owner(4);

        expect(get(setting)).toBe(4);
    });

    it("reads the owner again for a new first subscriber, as another screen may have changed the value", () => {
        const { setting, state } = owner(4);
        const unsubscribe = setting.subscribe(() => undefined);
        unsubscribe();

        state.saved = 7;

        expect(get(setting)).toBe(7);
    });

    it("writes through the owner and tells its subscribers", () => {
        const { setting, state } = owner(4);
        const seen: number[] = [];
        const unsubscribe = setting.subscribe((value) => seen.push(value));

        setting.set(6);

        expect(state.writes).toBe(1);
        expect(seen).toEqual([4, 6]);
        unsubscribe();
    });

    it("shows what was saved, not what was asked", () => {
        const { setting } = owner(4);
        const seen: number[] = [];
        const unsubscribe = setting.subscribe((value) => seen.push(value));

        setting.set(25);

        expect(seen).toEqual([4, 10]);
        unsubscribe();
    });

    it("keeps the value and lets the error through when the write fails", () => {
        const setting = savedSetting(
            () => 4,
            () => {
                throw new Error("refused");
            },
        );
        const seen: number[] = [];
        const unsubscribe = setting.subscribe((value) => seen.push(value));

        expect(() => setting.set(6)).toThrow("refused");
        expect(seen).toEqual([4]);
        unsubscribe();
    });

    it("shows what a composite write saved before it threw, and lets the error through", () => {
        const state = { first: false };
        const setting = savedSetting(
            () => state.first,
            (on: boolean) => {
                state.first = on;
                throw new Error("the second owner refused");
            },
        );
        const seen: boolean[] = [];
        const unsubscribe = setting.subscribe((value) => seen.push(value));

        expect(() => setting.set(true)).toThrow("the second owner refused");

        expect(state.first).toBe(true);
        expect(seen).toEqual([false, true]);
        unsubscribe();
    });
});
