import { describe, expect, it } from "vitest";
import { daylight, isPlainDay, localHour, lookAt } from "./timeOfDay";

describe("timeOfDay", () => {
    it("reads the clock in Brasília time", () => {
        expect(localHour(new Date("2026-10-20T04:30:00Z"))).toBe(1.5); // UTC-3
        expect(localHour(new Date("2026-10-20T15:00:00Z"))).toBe(12);
    });

    it("gives a plain day at noon, a lit office in a navy garden at night, warmth at golden hour", () => {
        const noon = daylight(12);
        expect(isPlainDay(noon)).toBe(true);
        expect(noon.sun).toBe(1);
        expect(noon.sat, "the garden is a little more vivid by day").toBeGreaterThan(1);
        const night = daylight(1.5);
        expect(night.lamps).toBe(1);
        expect(night.sun).toBe(0);
        expect(isPlainDay(night)).toBe(false);
        expect(Math.min(...night.inside), "the office stays readable").toBeGreaterThanOrEqual(0.5);
        expect(night.lawn[2] > night.lawn[1] && night.lawn[1] > night.lawn[0], "the lawn goes navy").toBe(true);
        expect(night.toe).toBeGreaterThan(1);
        const golden = daylight(17.4);
        expect(golden.inside[0] > golden.inside[1] && golden.inside[1] > golden.inside[2], "golden hour is warm").toBe(
            true,
        );
        expect(golden.shafts).toBe(1);
        const dusk = daylight(18.8);
        expect(dusk.lamps).toBeGreaterThan(golden.lamps);
        expect(dusk.lamps).toBeLessThanOrEqual(1);
        expect(daylight(24)).toStrictEqual(daylight(0));
        for (let h = 0; h < 24; h += 0.25) {
            // no jumps between keyframes
            const a = daylight(h);
            const b = daylight(h + 0.25);
            expect(Math.abs(a.outside[0] - b.outside[0]), `jump at ${h}`).toBeLessThan(0.2);
        }
    });

    it("keeps the art as drawn with the light switched off", () => {
        const drawn = lookAt(21, { light: false });
        expect(isPlainDay(drawn)).toBe(true);
        expect(drawn.sat).toBe(1);
        expect(drawn.lamps).toBe(0);
        expect(lookAt(21, { light: true })).toStrictEqual(daylight(21));
    });
});
