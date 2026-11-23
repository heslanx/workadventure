import { describe, expect, it } from "vitest";
import { keyLightAt, newKeyLight } from "./keyLight";
import { CONTACT_STRENGTH, PERSON_LIGHT, newShadeUniforms, shadeUniformsInto } from "./shadeUniforms";

describe("shadeUniformsInto", () => {
    const key = newKeyLight();
    keyLightAt(17.4, key);

    it("writes the level, the strengths and the key into the arrays it was given, and makes none", () => {
        const out = newShadeUniforms();
        const arrays = [out.shade, out.key, out.keyShade];
        shadeUniformsInto(out, key, 2);
        expect(out.shade).toEqual([2, CONTACT_STRENGTH, key.strength, PERSON_LIGHT]);
        expect(out.key[0]).toBe(key.dx);
        expect(out.key[1]).toBe(key.dy);
        expect(out.key[3]).toBe(key.weight);
        expect(out.key[2]).toBeGreaterThanOrEqual(1);
        expect(out.key[2]).toBeLessThanOrEqual(1.6);
        expect([out.shade, out.key, out.keyShade]).toEqual(arrays);
        expect(out.shade).toBe(arrays[0]);
        expect(out.keyShade).toBe(arrays[2]);
    });

    it("turns the person light off at level 1 and everything off at level 0", () => {
        const out = newShadeUniforms();
        shadeUniformsInto(out, key, 1);
        expect(out.shade).toEqual([1, CONTACT_STRENGTH, key.strength, 0]);
        shadeUniformsInto(out, key, 0);
        expect(out.shade).toEqual([0, 0, 0, 0]);
    });

    it("mixes the shade colour from day's to night's by the key's night mix", () => {
        const out = newShadeUniforms();
        const day = newKeyLight();
        keyLightAt(13, day);
        shadeUniformsInto(out, day, 2);
        expect(out.keyShade).toEqual([0.5, 0.58, 0.8]);
        const night = newKeyLight();
        keyLightAt(23, night);
        shadeUniformsInto(out, night, 2);
        expect(out.keyShade[0]).toBeCloseTo(0.36);
        expect(out.keyShade[2]).toBeCloseTo(0.66);
    });
});
