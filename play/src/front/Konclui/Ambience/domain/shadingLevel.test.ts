import { describe, expect, it } from "vitest";
import { parseShadingFlag, pickShadingLevel, type ShadingFacts } from "./shadingLevel";

const FINE: ShadingFacts = {
    renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)",
    maxFragmentUniformVectors: 1024,
    zoom: 1,
    viewPixels: 1920 * 1080,
};

describe("parseShadingFlag", () => {
    it.each([
        [null, "off"],
        ["", "off"],
        ["0", "off"],
        ["yes", "off"],
        ["1", "auto"],
        ["full", "full"],
        ["reduced", "reduced"],
        ["legacy", "legacy"],
    ])("reads %s as %s", (value, flag) => {
        expect(parseShadingFlag(value)).toBe(flag);
    });
});

describe("pickShadingLevel", () => {
    it("runs nothing unless the flag asks for the new shading: off and the legacy rim are level 0", () => {
        expect(pickShadingLevel("off", FINE)).toBe(0);
        expect(pickShadingLevel("legacy", FINE)).toBe(0);
    });

    it("starts at full on a good GPU and a normal view", () => {
        expect(pickShadingLevel("auto", FINE)).toBe(2);
    });

    it.each([
        ["SwiftShader", { renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))" }],
        ["llvmpipe", { renderer: "llvmpipe (LLVM 15.0.7, 256 bits)" }],
        ["Mali", { renderer: "Mali-G52 MC2" }],
        ["an old Adreno", { renderer: "Adreno (TM) 306" }],
        ["PowerVR", { renderer: "PowerVR Rogue GE8320" }],
        ["a 2012 Intel", { renderer: "ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0)" }],
        ["few uniform vectors", { maxFragmentUniformVectors: 220 }],
        ["a zoomed-out camera", { zoom: 0.5 }],
        ["a view over 2.5 Mpx", { viewPixels: 2560 * 1440 }],
    ])("falls to reduced on %s", (_name, change) => {
        expect(pickShadingLevel("auto", { ...FINE, ...change })).toBe(1);
    });

    it("keeps full on a modern integrated GPU and at the edges of each limit", () => {
        expect(pickShadingLevel("auto", { ...FINE, renderer: "ANGLE (Intel, Intel(R) UHD Graphics 770)" })).toBe(2);
        expect(pickShadingLevel("auto", { ...FINE, maxFragmentUniformVectors: 221 })).toBe(2);
        expect(pickShadingLevel("auto", { ...FINE, zoom: 0.6 })).toBe(2);
        expect(pickShadingLevel("auto", { ...FINE, viewPixels: 2_500_000 })).toBe(2);
    });

    it("lets a forced flag win over the facts", () => {
        const weak = { ...FINE, renderer: "llvmpipe", zoom: 0.3 };
        expect(pickShadingLevel("full", weak)).toBe(2);
        expect(pickShadingLevel("reduced", FINE)).toBe(1);
    });
});
