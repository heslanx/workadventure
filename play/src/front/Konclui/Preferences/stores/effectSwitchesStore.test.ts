// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { FEATURES_KEY, parseFeatures, presetFeatures, type FeatureSwitches } from "../domain/effectSwitches";
import { applyEffectsPreset, effectSwitchesStore, setEffect } from "./effectSwitchesStore";

const subscriptions: (() => void)[] = [];

/** A subscriber that goes with the test even when an expectation fails first: a leftover one would hide a re-read. */
function subscribe(callback: (switches: FeatureSwitches) => void = () => undefined): () => void {
    const unsubscribe = effectSwitchesStore.subscribe(callback);
    subscriptions.push(unsubscribe);
    return unsubscribe;
}

/** What another tab does: it saves the key, and the browser tells this tab. */
function anotherTabSaves(raw: string, key: string = FEATURES_KEY): void {
    localStorage.setItem(key, raw);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: raw }));
}

/** A storage that refuses every save, as in private browsing or when it is full. */
function refuseSaves(): { allowSaves(): void } {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    return { allowSaves: () => setItem.mockRestore() };
}

describe("effectSwitchesStore", () => {
    afterEach(() => {
        for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
        vi.restoreAllMocks();
        // A save that succeeds ends any choice kept for the visit, so no test leaks one into the next.
        applyEffectsPreset("complete");
        localStorage.clear();
    });

    it("saves a switch, and the subscribers see it as the storage holds it", () => {
        const seen: FeatureSwitches[] = [];
        subscribe((switches) => seen.push(switches));
        seen.length = 0;

        setEffect("clouds", false);

        expect(parseFeatures(localStorage.getItem(FEATURES_KEY)).clouds).toBe(false);
        expect(seen).toHaveLength(1);
        expect(seen[0].clouds).toBe(false);
        expect(seen[0].water).toBe(true);
        expect(get(effectSwitchesStore)).toEqual(parseFeatures(localStorage.getItem(FEATURES_KEY)));
    });

    it("sends no storage event of its own: the browser fires it in the other tabs only", () => {
        const heard = vi.fn();
        window.addEventListener("storage", heard);

        setEffect("clouds", false);

        window.removeEventListener("storage", heard);
        expect(heard).not.toHaveBeenCalled();
    });

    it("applies a preset's switches", () => {
        subscribe();

        applyEffectsPreset("lean");

        expect(get(effectSwitchesStore)).toEqual(presetFeatures("lean"));
    });

    it("reads the storage again for the first subscriber, which another tab may have changed unheard", () => {
        expect(get(effectSwitchesStore).water).toBe(true);

        localStorage.setItem(FEATURES_KEY, JSON.stringify({ water: false }));

        expect(get(effectSwitchesStore).water).toBe(false);
    });

    it("follows another tab's change while subscribed, and stops after the unsubscribe", () => {
        const seen: FeatureSwitches[] = [];
        const unsubscribe = subscribe((switches) => seen.push(switches));

        anotherTabSaves(JSON.stringify({ frost: false }));
        unsubscribe();
        const heard = seen.length;
        window.dispatchEvent(new StorageEvent("storage", { key: FEATURES_KEY, newValue: "{}" }));

        expect(seen[seen.length - 1].frost).toBe(false);
        expect(seen).toHaveLength(heard);
    });

    describe("when the storage refuses a save", () => {
        it("still applies the change to a subscriber, with a warning", () => {
            refuseSaves();
            subscribe();

            setEffect("water", false);

            expect(get(effectSwitchesStore).water).toBe(false);
            expect(console.warn).toHaveBeenCalled();
        });

        it("keeps the choice for the visit after every subscriber has gone", () => {
            refuseSaves();
            const unsubscribe = subscribe();
            setEffect("water", false);
            unsubscribe();

            let seen: FeatureSwitches | undefined;
            subscribe((switches) => (seen = switches))();

            expect(seen?.water).toBe(false);
            expect(localStorage.getItem(FEATURES_KEY)).toBeNull();
        });

        it("builds the next change on the kept choice", () => {
            refuseSaves();
            setEffect("water", false);

            setEffect("clouds", false);

            expect(get(effectSwitchesStore)).toMatchObject({ water: false, clouds: false });
        });

        it("gives way to the next save that works, which the storage then holds", () => {
            const storage = refuseSaves();
            setEffect("water", false);
            storage.allowSaves();

            setEffect("clouds", false);
            localStorage.setItem(FEATURES_KEY, JSON.stringify({ frost: false }));

            const switches = get(effectSwitchesStore);
            expect(switches.frost).toBe(false);
            expect(switches.water).toBe(true);
            expect(switches.clouds).toBe(true);
        });

        it("gives way to what another tab saves, even with no subscriber to hear it", () => {
            const storage = refuseSaves();
            setEffect("water", false);
            storage.allowSaves();

            anotherTabSaves(JSON.stringify({ clouds: false }));

            expect(get(effectSwitchesStore)).toMatchObject({ water: true, clouds: false });
        });

        it("keeps the choice when another tab saves a different key", () => {
            const storage = refuseSaves();
            setEffect("water", false);
            storage.allowSaves();

            anotherTabSaves("1", "konclui.fx.off");

            expect(get(effectSwitchesStore).water).toBe(false);
        });

        it("keeps following other tabs once a save that works has replaced the choice", () => {
            const storage = refuseSaves();
            const seen: FeatureSwitches[] = [];
            const unsubscribe = subscribe((switches) => seen.push(switches));
            setEffect("water", false);
            storage.allowSaves();
            applyEffectsPreset("complete");

            anotherTabSaves(JSON.stringify({ clouds: false }));

            expect(seen[seen.length - 1]).toMatchObject({ water: true, clouds: false });
            unsubscribe();
            expect(get(effectSwitchesStore)).toMatchObject({ water: true, clouds: false });
        });

        it("keeps following other tabs once another tab has replaced the choice", () => {
            const storage = refuseSaves();
            const seen: FeatureSwitches[] = [];
            const unsubscribe = subscribe((switches) => seen.push(switches));
            setEffect("water", false);
            storage.allowSaves();
            anotherTabSaves(JSON.stringify({ clouds: false }));

            anotherTabSaves(JSON.stringify({ frost: false }));

            expect(seen[seen.length - 1]).toMatchObject({ water: true, clouds: true, frost: false });
            unsubscribe();
            expect(get(effectSwitchesStore)).toMatchObject({ water: true, clouds: true, frost: false });
        });
    });
});
