import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";
import { isInActiveConversationStore } from "../../../Stores/StreamableCollectionStore";
import type { FocusChip } from "../domain/focus";
import { endFocus, focusActiveStore, focusChipStore, publishSeat, startFocus } from "./focusStore";

// The upstream conversation signal pulls in the whole media graph; the focus store only reads one boolean from it.
vi.mock("../../../Stores/StreamableCollectionStore", async () => {
    const { writable } = await import("svelte/store");
    return { isInActiveConversationStore: writable(false) };
});
vi.mock("../../../Stores/MediaStore", () => {
    throw new Error("focus must not import the media stores: it never writes the user's status");
});

const MINUTE = 60_000;

// The mock above is a writable, so the test can start and end a conversation.
const conversation = isInActiveConversationStore as unknown as Writable<boolean>;

describe("focus store", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    });

    afterEach(() => {
        publishSeat(false);
        conversation.set(false);
        vi.useRealTimers();
    });

    /** Subscribes until the end of the test body and returns the chips seen, in order. */
    function watchChip(): { chips: FocusChip[]; stop: () => void } {
        const chips: FocusChip[] = [];
        const stop = focusChipStore.subscribe((chip) => chips.push(chip));
        return { chips, stop };
    }

    it("does nothing without a seat: standing, the chip is hidden and a start is ignored", () => {
        startFocus();

        expect(get(focusChipStore)).toEqual({ kind: "hidden" });
        expect(get(focusActiveStore)).toBe(false);
    });

    it("offers focus when the player sits, and does not start it", () => {
        publishSeat(true);

        expect(get(focusChipStore)).toEqual({ kind: "offer" });
        expect(get(focusActiveStore)).toBe(false);
    });

    it("starts on an explicit action: the chip shows the running focus and the vignette input turns on", () => {
        publishSeat(true);

        startFocus();

        expect(get(focusChipStore)).toEqual({ kind: "active", elapsed: { kind: "now" } });
        expect(get(focusActiveStore)).toBe(true);
    });

    it("ends on an explicit action and offers the way back, while the vignette input turns off", () => {
        publishSeat(true);
        startFocus();

        endFocus();

        expect(get(focusChipStore)).toEqual({ kind: "ended" });
        expect(get(focusActiveStore)).toBe(false);
    });

    it("resumes from the ended chip with a fresh clock", () => {
        publishSeat(true);
        startFocus();
        vi.advanceTimersByTime(5 * MINUTE);
        endFocus();

        startFocus();

        expect(get(focusChipStore)).toEqual({ kind: "active", elapsed: { kind: "now" } });
    });

    it("ends the focus when the player stands up, whatever was running", () => {
        publishSeat(true);
        startFocus();

        publishSeat(false);

        expect(get(focusChipStore)).toEqual({ kind: "hidden" });
        expect(get(focusActiveStore)).toBe(false);
        publishSeat(true);
        expect(get(focusChipStore)).toEqual({ kind: "offer" });
    });

    it("gives way to a conversation and takes the place back when it ends, keeping the running time", () => {
        publishSeat(true);
        startFocus();
        vi.advanceTimersByTime(3 * MINUTE);

        conversation.set(true);
        expect(get(focusChipStore)).toEqual({ kind: "hidden" });
        expect(get(focusActiveStore)).toBe(false);

        conversation.set(false);
        expect(get(focusChipStore)).toEqual({ kind: "active", elapsed: { kind: "minutes", minutes: 3 } });
        expect(get(focusActiveStore)).toBe(true);
    });

    it("reads the running time again every 20 seconds while the chip is watched, and says minutes when one passes", () => {
        publishSeat(true);
        startFocus();
        const { chips, stop } = watchChip();

        vi.advanceTimersByTime(19_999);
        expect(chips).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(chips).toHaveLength(2);
        expect(chips.at(-1)).toEqual({ kind: "active", elapsed: { kind: "now" } });

        vi.advanceTimersByTime(40_000);
        expect(chips.at(-1)).toEqual({ kind: "active", elapsed: { kind: "minutes", minutes: 1 } });
        stop();
    });

    it("keeps no timer while nothing runs, while nobody watches, and after the focus ends", () => {
        publishSeat(true);
        const idle = watchChip();
        expect(vi.getTimerCount()).toBe(0);

        startFocus();
        expect(vi.getTimerCount()).toBe(1);

        endFocus();
        expect(vi.getTimerCount()).toBe(0);

        startFocus();
        idle.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("does not wake the watchers for a seat event that changes nothing", () => {
        publishSeat(true);
        const { chips, stop } = watchChip();

        publishSeat(true);
        endFocus();

        expect(chips).toHaveLength(1);
        stop();
    });
});
