import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import { throttledStore } from "./throttledStore";

describe("throttledStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    function follow(initial: number | undefined) {
        const source = writable<number | undefined>(initial);
        const store = throttledStore(source, (a, b) => a === b);
        const seen: (number | undefined)[] = [];
        const unsubscribe = store.subscribe((value) => seen.push(value));
        return { source, seen, unsubscribe };
    }

    it("shows the first value at once", () => {
        const { seen } = follow(1);

        expect(seen).toEqual([1]);
    });

    it("shows a change at once when nothing changed for two seconds", () => {
        const { source, seen } = follow(1);
        vi.advanceTimersByTime(2000);

        source.set(2);

        expect(seen).toEqual([1, 2]);
    });

    it("holds the changes that arrive during the cool-down and shows only the latest when it ends", () => {
        const { source, seen } = follow(1);

        source.set(2);
        vi.advanceTimersByTime(500);
        source.set(3);
        vi.advanceTimersByTime(500);
        source.set(4);
        expect(seen).toEqual([1]);

        vi.advanceTimersByTime(999);
        expect(seen).toEqual([1]);
        vi.advanceTimersByTime(1);
        expect(seen).toEqual([1, 4]);
    });

    it("shows nothing when the held value is the one on screen", () => {
        const { source, seen } = follow(1);

        source.set(2);
        source.set(1);
        vi.advanceTimersByTime(2000);

        expect(seen).toEqual([1]);
    });

    it("starts a new cool-down after a held value is shown", () => {
        const { source, seen } = follow(1);
        source.set(2);
        vi.advanceTimersByTime(2000);
        expect(seen).toEqual([1, 2]);

        // The held 2 was shown just now, so the cool-down began again.
        source.set(3);
        expect(seen).toEqual([1, 2]);
        vi.advanceTimersByTime(2000);

        expect(seen).toEqual([1, 2, 3]);
    });

    it("takes a value away at once, even during the cool-down, so nothing stale stays", () => {
        const { source, seen } = follow(1);

        source.set(undefined);

        expect(seen).toEqual([1, undefined]);
    });

    it("makes a value that comes back after being taken away wait for the cool-down", () => {
        const { source, seen } = follow(1);
        source.set(undefined);

        source.set(2);
        expect(seen).toEqual([1, undefined]);
        vi.advanceTimersByTime(2000);

        expect(seen).toEqual([1, undefined, 2]);
    });

    it("drops a held value when the source is taken away before the cool-down ends", () => {
        const { source, seen } = follow(1);
        source.set(2);

        source.set(undefined);
        vi.advanceTimersByTime(2000);

        expect(seen).toEqual([1, undefined]);
    });

    it("leaves no timer behind once the last subscriber goes", () => {
        const { source, unsubscribe } = follow(1);
        source.set(2);

        unsubscribe();

        expect(vi.getTimerCount()).toBe(0);
    });

    it("does not show the value of an earlier subscription to a later one", () => {
        const source = writable<number | undefined>(5);
        const store = throttledStore(source, (a, b) => a === b);
        const first: (number | undefined)[] = [];
        store.subscribe((value) => first.push(value))();
        source.set(undefined);
        const second: (number | undefined)[] = [];

        store.subscribe((value) => second.push(value))();

        expect(second).toEqual([undefined]);
    });
});
