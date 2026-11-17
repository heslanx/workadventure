import { asError } from "catch-unknown";
import { get, readable } from "svelte/store";
import {
    FEATURES_KEY,
    parseFeatures,
    presetFeatures,
    type Feature,
    type FeatureSwitches,
    type PresetName,
} from "../domain/effectSwitches";

// The office effects read their switches from localStorage and hear a change through the window's `storage` event
// (Ambience/phaser/browserEffectsPort.ts). The browser fires that event in the other tabs only, so a change made here
// is announced to this tab with the same event: the effects follow it without importing Preferences or the reverse.

function readStored(): string | null {
    try {
        return localStorage.getItem(FEATURES_KEY);
    } catch (error: unknown) {
        console.warn(`[konclui] preferences: could not read ${FEATURES_KEY}; every effect stays on:`, asError(error));
        return null;
    }
}

/** The effect switches as stored, following a change made in this tab or in another one. */
export const effectSwitchesStore = readable<FeatureSwitches>(parseFeatures(readStored()), (set) => {
    set(parseFeatures(readStored()));
    const listener = (event: StorageEvent): void => {
        if (event.key === FEATURES_KEY) set(parseFeatures(event.newValue));
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
});

function store(switches: FeatureSwitches): void {
    const value = JSON.stringify(switches);
    try {
        localStorage.setItem(FEATURES_KEY, value);
    } catch (error: unknown) {
        // Private browsing or a full storage: the change still applies, for this visit only.
        console.warn(`[konclui] preferences: could not save ${FEATURES_KEY}; this visit only:`, asError(error));
    }
    window.dispatchEvent(new StorageEvent("storage", { key: FEATURES_KEY, newValue: value }));
}

export function setEffect(feature: Feature, on: boolean): void {
    store({ ...get(effectSwitchesStore), [feature]: on });
}

export function applyEffectsPreset(name: PresetName): void {
    store(presetFeatures(name));
}
