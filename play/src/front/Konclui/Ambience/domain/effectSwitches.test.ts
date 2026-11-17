import { describe, expect, it } from "vitest";
import { FEATURES, parseFeatures, presetFeatures, presetOf } from "./effectSwitches";
import { daylight, isPlainDay, lookAt } from "./timeOfDay";

describe("effect switches", () => {
    it("keeps every one on unless stored off, recognises presets, and keeps the art as drawn with the light off", () => {
        expect(parseFeatures(null)).toEqual(Object.fromEntries(FEATURES.map((f) => [f, true])));
        expect(parseFeatures("{not json").light).toBe(true);
        expect(parseFeatures('{"trail": false}').trail).toBe(false);
        expect(presetOf(parseFeatures(null))).toBe("complete");
        expect(presetOf(presetFeatures("lean"))).toBe("lean");
        expect(presetOf(presetFeatures("balanced"))).toBe("balanced");
        expect(presetOf({ ...presetFeatures("lean"), light: true })).toBe("custom");
        expect(FEATURES.every((f) => presetFeatures("complete")[f])).toBe(true);
        expect(presetFeatures("nonsense").water).toBe(true);
        const drawn = lookAt(21, { light: false });
        expect(isPlainDay(drawn)).toBe(true);
        expect(drawn.sat).toBe(1);
        expect(drawn.lamps).toBe(0);
        expect(lookAt(21, { light: true })).toStrictEqual(daylight(21));
    });
});
