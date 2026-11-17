// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { FEATURES_KEY, parseFeatures, presetFeatures } from "../domain/effectSwitches";
import { applyEffectsPreset, effectSwitchesStore, setEffect } from "./effectSwitchesStore";

describe("effectSwitchesStore", () => {
    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it("saves a switch and announces it to this tab with the storage event the effects hear", () => {
        const heard: (string | null)[] = [];
        const listener = (event: StorageEvent) => {
            if (event.key === FEATURES_KEY) heard.push(event.newValue);
        };
        window.addEventListener("storage", listener);
        const unsubscribe = effectSwitchesStore.subscribe(() => undefined);

        setEffect("clouds", false);

        window.removeEventListener("storage", listener);
        expect(parseFeatures(localStorage.getItem(FEATURES_KEY)).clouds).toBe(false);
        expect(heard).toHaveLength(1);
        expect(parseFeatures(heard[0]).clouds).toBe(false);
        expect(get(effectSwitchesStore).clouds).toBe(false);
        expect(get(effectSwitchesStore).water).toBe(true);
        unsubscribe();
    });

    it("applies a preset's switches", () => {
        const unsubscribe = effectSwitchesStore.subscribe(() => undefined);

        applyEffectsPreset("lean");

        expect(get(effectSwitchesStore)).toEqual(presetFeatures("lean"));
        unsubscribe();
    });

    it("still applies a change for this visit when the storage refuses it", () => {
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("quota");
        });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const unsubscribe = effectSwitchesStore.subscribe(() => undefined);

        setEffect("water", false);

        expect(get(effectSwitchesStore).water).toBe(false);
        expect(console.warn).toHaveBeenCalled();
        unsubscribe();
    });
});
