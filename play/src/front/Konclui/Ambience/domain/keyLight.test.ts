import { describe, expect, it } from "vitest";
import { KEY_DIRECTIONS, keyLightAt, newKeyLight } from "./keyLight";

const at = (hour: number) => {
    const out = newKeyLight();
    const id = keyLightAt(hour, out);
    return { ...out, id };
};

describe("keyLightAt", () => {
    it("falls lower-left in the afternoon and golden hour, as look.shadow does, and lower-right in the morning", () => {
        expect(at(17.4).dx).toBeLessThan(0);
        expect(at(15.5).dx).toBeLessThan(0);
        expect(at(7.5).dx).toBeGreaterThan(0);
        expect(at(13).dx).toBe(0);
        for (const hour of [7.5, 13, 17.4]) expect(at(hour).dy).toBeGreaterThan(0);
    });

    it("gives the table's values at its keyframes", () => {
        const noon = at(13);
        expect(noon.dirIndex).toBe(2);
        expect(noon.length).toBeCloseTo(0.28);
        expect(noon.strength).toBeCloseTo(0.6);
        expect(noon.weight).toBe(1);
        expect(noon.nightMix).toBe(0);
        const night = at(22);
        expect(night.nightMix).toBe(1);
        expect(night.strength).toBeCloseTo(0.45);
        expect(night.weight).toBeCloseTo(0.35);
        expect(night.dirIndex).toBe(0);
    });

    it("snaps the direction to five slopes, so an edge is a clean pixel line", () => {
        const slopes = new Set<number>();
        for (let h = 0; h < 24; h += 0.05) {
            const { dx, dy } = at(h);
            slopes.add(Math.round((dx / dy) * 1000) / 1000);
            expect(Math.hypot(dx, dy)).toBeCloseTo(1);
        }
        expect([...slopes].sort((a, b) => a - b)).toEqual([-1, -0.5, 0, 0.5, 1]);
        expect(KEY_DIRECTIONS).toHaveLength(5);
    });

    it("keeps the sunset's direction through dusk and night, so nothing turns when the lamps come on", () => {
        const sunset = at(17.4).dirIndex;
        for (const hour of [17.4, 18.3, 19.3, 20.3, 22, 24, 1, 5]) expect(at(hour).dirIndex).toBe(sunset);
    });

    it("changes state about a dozen times a day, so the bake does not run every minute", () => {
        let changes = 0;
        let last = at(0).id;
        for (let minute = 1; minute <= 24 * 60; minute++) {
            const id = at(minute / 60).id;
            if (id !== last) changes += 1;
            last = id;
        }
        expect(changes).toBeGreaterThanOrEqual(8);
        expect(changes).toBeLessThanOrEqual(30);
    });

    // the bake of a piece near a lamp casts along the lamp from half the night on (shadeBake NIGHT_LAMPS_FROM): its state must change there
    it("changes state where the night passes its half, even when the direction and the length do not", () => {
        let crossing: number | undefined;
        for (let minute = 18 * 60; minute < 20 * 60; minute++) {
            const before = at(minute / 60);
            const after = at((minute + 1) / 60);
            if (before.nightMix < 0.5 && after.nightMix >= 0.5) crossing = minute;
        }
        expect(crossing).toBeDefined();
        const before = at((crossing as number) / 60);
        const after = at(((crossing as number) + 1) / 60);
        expect(after.id).not.toBe(before.id);
        // the day and the deep night are in states of their own
        expect(at(13).id).toBeLessThan(1024);
        expect(at(23).id).toBeGreaterThanOrEqual(1024);
    });

    it("moves through the keyframes without a jump in strength, and the state id is the same for the same hour", () => {
        let previous = at(0).strength;
        for (let minute = 1; minute <= 24 * 60; minute++) {
            const now = at(minute / 60).strength;
            expect(Math.abs(now - previous)).toBeLessThan(0.02);
            previous = now;
        }
        expect(at(13.3).id).toBe(at(13.3).id);
        expect(at(37)).toEqual(at(13));
    });

    it("quantizes the length to steps of 0.04", () => {
        for (let h = 0; h < 24; h += 0.1) {
            const steps = at(h).length / 0.04;
            expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
        }
    });
});
