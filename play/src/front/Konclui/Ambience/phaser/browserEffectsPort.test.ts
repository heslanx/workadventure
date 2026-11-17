// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURES_KEY, type FeatureSwitches } from "../../Preferences/domain/effectSwitches";
import { applyEffectsPreset, setEffect } from "../../Preferences/stores/effectSwitchesStore";
import { createBrowserEffectsPort } from "./browserEffectsPort";

// The port reads the effect switches from the Preferences store, which owns them. These tests change them the way the
// settings and another tab do, and look at what the scene effects are given.

const watches: (() => void)[] = [];

/** Watches the switches until the test is over, even when an expectation fails first. */
function watch(changed: (features: FeatureSwitches) => void): () => void {
    const stop = createBrowserEffectsPort().watchFeatures(changed);
    watches.push(stop);
    return stop;
}

function refuseSaves(): void {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("browserEffectsPort", () => {
    afterEach(() => {
        for (const stop of watches.splice(0)) stop();
        vi.restoreAllMocks();
        // A save that succeeds ends any choice kept for the visit, so no test leaks one into the next.
        applyEffectsPreset("complete");
        localStorage.clear();
    });

    describe("features", () => {
        it("answers the saved switches, every one on when none was saved", () => {
            expect(createBrowserEffectsPort().features().water).toBe(true);

            localStorage.setItem(FEATURES_KEY, JSON.stringify({ water: false }));

            expect(createBrowserEffectsPort().features().water).toBe(false);
        });

        it("answers the choice kept for this visit when the storage refused it, at the next scene", () => {
            refuseSaves();
            setEffect("water", false);

            expect(localStorage.getItem(FEATURES_KEY)).toBeNull();
            expect(createBrowserEffectsPort().features().water).toBe(false);
        });
    });

    describe("watchFeatures", () => {
        it("does not call back as it starts watching, only when a switch changes after", () => {
            const changed = vi.fn();

            watch(changed);

            expect(changed).not.toHaveBeenCalled();
            setEffect("clouds", false);
            expect(changed).toHaveBeenCalledTimes(1);
        });

        it("hands over the switches of a change made in this tab", () => {
            const seen: FeatureSwitches[] = [];
            watch((features) => seen.push(features));

            setEffect("clouds", false);
            applyEffectsPreset("lean");

            expect(seen).toHaveLength(2);
            expect(seen[0].clouds).toBe(false);
            expect(seen[0].water).toBe(true);
            expect(Object.values(seen[1]).every((on) => !on)).toBe(true);
        });

        it("calls back for a change made in this tab that the storage refused", () => {
            refuseSaves();
            const changed = vi.fn();
            watch(changed);

            setEffect("water", false);

            expect(changed).toHaveBeenCalledTimes(1);
            expect(changed.mock.calls[0][0].water).toBe(false);
        });

        it("calls back for another tab's change to the switches, and for no other key", () => {
            const changed = vi.fn();
            watch(changed);

            window.dispatchEvent(new StorageEvent("storage", { key: "konclui.fx.off", newValue: "1" }));
            expect(changed).not.toHaveBeenCalled();

            window.dispatchEvent(
                new StorageEvent("storage", { key: FEATURES_KEY, newValue: JSON.stringify({ frost: false }) }),
            );

            expect(changed).toHaveBeenCalledTimes(1);
            expect(changed.mock.calls[0][0].frost).toBe(false);
        });

        it("stops calling back once the watch is stopped", () => {
            const changed = vi.fn();
            const stop = watch(changed);
            stop();

            setEffect("clouds", false);
            window.dispatchEvent(new StorageEvent("storage", { key: FEATURES_KEY, newValue: "{}" }));

            expect(changed).not.toHaveBeenCalled();
        });
    });
});
