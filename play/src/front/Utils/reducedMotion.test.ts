// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { blur, fade, fly, isReducedMotion, motionDuration, scale, slide } from "./reducedMotion";

function stubReducedMotion(reduce: boolean): void {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: reduce && query === "(prefers-reduced-motion: reduce)",
        media: query,
    }));
}

describe("reducedMotion", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("reports no preference when the browser has no matchMedia", () => {
        vi.stubGlobal("matchMedia", undefined);

        expect(isReducedMotion()).toBe(false);
        expect(motionDuration(500)).toBe(500);
    });

    it("keeps the requested durations when the user does not reduce motion", () => {
        stubReducedMotion(false);
        const node = document.createElement("div");

        expect(motionDuration(500)).toBe(500);
        expect(fly(node, { y: 20, duration: 300, delay: 50 })).toMatchObject({ duration: 300, delay: 50 });
        expect(fade(node, { duration: 200 }).duration).toBe(200);
    });

    it("makes every transition instant when the user reduces motion", () => {
        stubReducedMotion(true);
        const node = document.createElement("div");

        expect(motionDuration(500)).toBe(0);
        for (const transition of [blur, fade, fly, scale, slide]) {
            expect(transition(node, { duration: 300, delay: 50 })).toMatchObject({ duration: 0, delay: 0 });
        }
        // The end state is still applied, so the element shows at full opacity.
        expect(fade(node).css?.(1, 0)).toContain("opacity: 1");
    });
});
