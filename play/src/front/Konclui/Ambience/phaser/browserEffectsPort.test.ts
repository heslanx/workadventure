// @vitest-environment jsdom
import * as Phaser from "phaser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { FEATURES_KEY, type FeatureSwitches } from "../../Preferences/domain/effectSwitches";
import { applyEffectsPreset, setEffect } from "../../Preferences/stores/effectSwitchesStore";
import { browserEnvironment, createBrowserEffectsPort } from "./browserEffectsPort";
import type { EffectsEnvironment } from "./SceneEffects";

// The scene effects need a WebGL renderer and the map's pictures. The port is only asked what it hands them.
const made = vi.hoisted(() => [] as { environment: EffectsEnvironment }[]);
vi.mock("./SceneEffects", () => ({
    SceneEffects: class {
        constructor(options: { environment: EffectsEnvironment }) {
            made.push(options);
        }
    },
}));

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

    describe("focused", () => {
        /** The environment the port gives the effects it creates for a scene drawn with WebGL. */
        function environmentOf(port: ReturnType<typeof createBrowserEffectsPort>): EffectsEnvironment {
            vi.stubGlobal("matchMedia", () => ({ matches: false }));
            const scene = { renderer: Object.create(Phaser.Renderer.WebGL.WebGLRenderer.prototype) } as GameScene;
            port.create(scene, { manifest: {}, images: {} } as never, {
                generation: 1,
                features: port.features(),
                time: 0,
                reveal: false,
            });
            const environment = made.at(-1)?.environment;
            if (environment === undefined) throw new Error("the port made no effects");
            return environment;
        }

        afterEach(() => {
            vi.unstubAllGlobals();
            made.length = 0;
        });

        it("asks the caller whether the user is in focus each time the effects look, so the vignette follows it", () => {
            let focused = false;
            const environment = environmentOf(createBrowserEffectsPort({ focused: () => focused }));

            expect(environment.focused()).toBe(false);
            focused = true;
            expect(environment.focused()).toBe(true);
        });

        it("never darkens the edges when nobody says the user is in focus", () => {
            expect(environmentOf(createBrowserEffectsPort()).focused()).toBe(false);
        });
    });

    describe("the QA settings in localStorage", () => {
        beforeEach(() => {
            vi.stubGlobal("matchMedia", () => ({ matches: false }));
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it("answers the fixed hour as it is in the storage at each ask, and none once it is removed or is not a number", () => {
            const environment = browserEnvironment(() => false);
            expect(environment.fixedHour()).toBeUndefined();

            localStorage.setItem("konclui.fx.hour", "21.5");
            expect(environment.fixedHour()).toBe(21.5);

            localStorage.setItem("konclui.fx.hour", "9");
            expect(environment.fixedHour()).toBe(9);

            localStorage.setItem("konclui.fx.hour", "night");
            expect(environment.fixedHour()).toBeUndefined();

            localStorage.removeItem("konclui.fx.hour");
            expect(environment.fixedHour()).toBeUndefined();
        });

        it("answers the legacy night-lit preview only for the value legacy, at each ask", () => {
            const environment = browserEnvironment(() => false);
            expect(environment.nightLit()).toBe(false);

            localStorage.setItem("konclui.fx.rim", "legacy");
            expect(environment.nightLit()).toBe(true);

            // "1" is the new shading: the legacy rim stays off
            localStorage.setItem("konclui.fx.rim", "1");
            expect(environment.nightLit()).toBe(false);

            localStorage.setItem("konclui.fx.rim", "0");
            expect(environment.nightLit()).toBe(false);
        });

        it("reads konclui.fx.rim as the shading flag: unset or 0 off, 1 auto, full and reduced forced", () => {
            const environment = browserEnvironment(() => false);
            expect(environment.shading?.()).toBe("off");
            for (const [value, flag] of [
                ["0", "off"],
                ["1", "auto"],
                ["full", "full"],
                ["reduced", "reduced"],
                ["legacy", "legacy"],
                ["garbage", "off"],
            ] as const) {
                localStorage.setItem("konclui.fx.rim", value);
                expect(environment.shading?.(), value).toBe(flag);
            }
        });

        it("reports a storage that cannot be read, and answers the defaults", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
                throw new Error("blocked");
            });
            const environment = browserEnvironment(() => false);

            expect([environment.fixedHour(), environment.nightLit()]).toEqual([undefined, false]);
            expect(warn).toHaveBeenCalledTimes(2);
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
