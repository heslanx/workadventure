import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { installGameCommands, type GameCommands } from "./gameCommands";
import { mapAnimations } from "./performanceSettings";

// Upstream saves "disable animations", the dialog shows "animations": the write must save the opposite and tell the
// running map in that order, or a map that reads the saved value as it is told sees the old one.

const saved = vi.hoisted(() => ({ disableAnimations: false }));

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: {
        getDisableAnimations: () => saved.disableAnimations,
        setDisableAnimations: (value: boolean) => {
            saved.disableAnimations = value;
        },
    },
}));

describe("the map animations setting", () => {
    afterEach(() => {
        saved.disableAnimations = false;
    });

    function installMap() {
        const savedWhenTold: boolean[] = [];
        const told: boolean[] = [];
        installGameCommands({
            pauseTileAnimations: (paused: boolean) => {
                told.push(paused);
                savedWhenTold.push(saved.disableAnimations);
            },
        } as GameCommands);
        return { told, savedWhenTold };
    }

    it("shows animations on while upstream has not disabled them", () => {
        expect(get(mapAnimations)).toBe(true);

        saved.disableAnimations = true;

        expect(get(mapAnimations)).toBe(false);
    });

    it("turns the animations off in the saved setting, then in the running map", () => {
        const { told, savedWhenTold } = installMap();

        mapAnimations.set(false);

        expect(get(mapAnimations)).toBe(false);
        expect(saved.disableAnimations).toBe(true);
        expect(told).toEqual([true]);
        expect(savedWhenTold).toEqual([true]);
    });

    it("turns them back on in both", () => {
        const { told } = installMap();
        mapAnimations.set(false);

        mapAnimations.set(true);

        expect(get(mapAnimations)).toBe(true);
        expect(saved.disableAnimations).toBe(false);
        expect(told).toEqual([true, false]);
    });
});
