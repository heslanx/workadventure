import { asError } from "catch-unknown";
import { get, writable, type Readable } from "svelte/store";
import {
    FEATURES_KEY,
    parseFeatures,
    presetFeatures,
    type Feature,
    type FeatureSwitches,
    type PresetName,
} from "../domain/effectSwitches";

// This store owns the effect switches: their value, their saving in localStorage, the changes other tabs make and the
// choice kept for this visit when the storage refuses it. The settings pane writes through it and the office effects
// (Ambience/phaser/browserEffectsPort.ts) read it, so no one else touches the key or listens to the `storage` event.

/** A choice the storage refused. It is the value until a save succeeds or another tab changes the key. */
let thisVisitOnly: FeatureSwitches | undefined;
let stopHearingOtherTabs: (() => void) | undefined;

function readStored(): string | null {
    try {
        return localStorage.getItem(FEATURES_KEY);
    } catch (error: unknown) {
        console.warn(`[konclui] preferences: could not read ${FEATURES_KEY}; every effect stays on:`, asError(error));
        return null;
    }
}

function current(): FeatureSwitches {
    return thisVisitOnly ?? parseFeatures(readStored());
}

function dropThisVisitOnly(): void {
    thisVisitOnly = undefined;
    stopHearingOtherTabs?.();
    stopHearingOtherTabs = undefined;
}

function keepForThisVisit(switches: FeatureSwitches): void {
    thisVisitOnly = switches;
    if (stopHearingOtherTabs) return;
    // Nobody may be subscribed while the choice is kept, and the effects read it again in the next room: the listener
    // lives as long as the choice does, so another tab's saved value is not shadowed by it.
    const listener = (event: StorageEvent): void => {
        if (event.key === FEATURES_KEY) dropThisVisitOnly();
    };
    window.addEventListener("storage", listener);
    stopHearingOtherTabs = () => window.removeEventListener("storage", listener);
}

// The first subscriber reads again: another tab may have changed the key while nobody listened. Subscribers hear this
// tab's changes through `set`, and another tab's through the `storage` event, which the browser fires in other tabs only.
const switches = writable<FeatureSwitches>(parseFeatures(null), (set) => {
    set(current());
    const listener = (event: StorageEvent): void => {
        if (event.key === FEATURES_KEY) set(parseFeatures(event.newValue));
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
});

/** The effect switches as saved, following a change made in this tab or in another one. */
export const effectSwitchesStore: Readable<FeatureSwitches> = { subscribe: switches.subscribe };

function save(next: FeatureSwitches): void {
    try {
        localStorage.setItem(FEATURES_KEY, JSON.stringify(next));
        dropThisVisitOnly();
    } catch (error: unknown) {
        // Private browsing or a full storage: the change still applies, for this visit only.
        console.warn(`[konclui] preferences: could not save ${FEATURES_KEY}; this visit only:`, asError(error));
        keepForThisVisit(next);
    }
    switches.set(next);
}

export function setEffect(feature: Feature, on: boolean): void {
    save({ ...get(effectSwitchesStore), [feature]: on });
}

export function applyEffectsPreset(name: PresetName): void {
    save(presetFeatures(name));
}
