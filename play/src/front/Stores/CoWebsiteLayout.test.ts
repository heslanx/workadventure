import { describe, expect, it } from "vitest";
import { coWebsiteRatioAtPointer, splitGameViewport } from "./CoWebsiteLayout";

describe("game viewport split", () => {
    it("gives the whole measured area to the game when no co-website is open", () => {
        expect(
            splitGameViewport(
                { width: 1072, height: 788 },
                {
                    visible: false,
                    fullscreen: false,
                    ratio: 0.5,
                    vertical: false,
                },
            ).game,
        ).toEqual({ width: 1072, height: 788 });
    });

    it("shares the available area with a landscape co-website", () => {
        expect(
            splitGameViewport(
                { width: 704, height: 788 },
                {
                    visible: true,
                    fullscreen: false,
                    ratio: 0.25,
                    vertical: false,
                },
            ),
        ).toEqual({ game: { width: 528, height: 788 }, website: { width: 176, height: 788 } });
    });

    it("shares the available height with a portrait co-website", () => {
        expect(
            splitGameViewport(
                { width: 360, height: 800 },
                {
                    visible: true,
                    fullscreen: false,
                    ratio: 0.5,
                    vertical: true,
                },
            ),
        ).toEqual({ game: { width: 360, height: 400 }, website: { width: 360, height: 400 } });
    });

    it("keeps the co-website geometry while hiding the game in fullscreen", () => {
        expect(
            splitGameViewport(
                { width: 704, height: 788 },
                {
                    visible: true,
                    fullscreen: true,
                    ratio: 0.5,
                    vertical: false,
                },
            ),
        ).toEqual({ game: { width: 0, height: 0 }, website: { width: 352, height: 788 } });
    });
});

describe("co-website divider coordinates", () => {
    const bounds = { left: 362, top: 6, width: 1072, height: 788 };

    it("preserves the midpoint inside an offset area", () => {
        expect(coWebsiteRatioAtPointer(bounds, { x: 898, y: 400 }, false, false)).toBe(0.5);
        expect(coWebsiteRatioAtPointer(bounds, { x: 898, y: 400 }, false, true)).toBe(0.5);
        expect(coWebsiteRatioAtPointer(bounds, { x: 898, y: 400 }, true, false)).toBe(0.5);
    });

    it("clamps dragging outside the area while preserving the resize handle", () => {
        expect(coWebsiteRatioAtPointer(bounds, { x: 1500, y: 900 }, false, false)).toBe(8 / 1072);
        expect(coWebsiteRatioAtPointer(bounds, { x: 0, y: 0 }, false, false)).toBe(1);
        expect(coWebsiteRatioAtPointer(bounds, { x: 0, y: 0 }, false, true)).toBe(8 / 1072);
        expect(coWebsiteRatioAtPointer(bounds, { x: 0, y: 0 }, true, false)).toBe(8 / 788);
    });

    it("reads the pointer as a window coordinate when the area is the whole window", () => {
        const windowBounds = { left: 0, top: 0, width: 1000, height: 800 };

        // Left-to-right: the panel is on the right, so a pointer at x=300 leaves it 700 of 1000.
        expect(coWebsiteRatioAtPointer(windowBounds, { x: 300, y: 0 }, false, false)).toBe(0.7);
        // Right-to-left: the panel is on the left, so the same pointer leaves it 300 of 1000.
        expect(coWebsiteRatioAtPointer(windowBounds, { x: 300, y: 0 }, false, true)).toBe(0.3);
        // Portrait: the panel is on top, so a pointer at y=200 leaves it 200 of 800.
        expect(coWebsiteRatioAtPointer(windowBounds, { x: 0, y: 200 }, true, false)).toBe(0.25);
        // The bar stays reachable: dragging past the far edge stops 8 px short of it.
        expect(coWebsiteRatioAtPointer(windowBounds, { x: 1000, y: 0 }, false, false)).toBe(8 / 1000);
        expect(coWebsiteRatioAtPointer(windowBounds, { x: 4, y: 0 }, false, true)).toBe(8 / 1000);
        expect(coWebsiteRatioAtPointer(windowBounds, { x: 0, y: 3 }, true, false)).toBe(8 / 800);
    });

    it("never reports a panel larger than the area, even when the area is narrower than the resize bar", () => {
        const tiny = { left: 0, top: 0, width: 4, height: 4 };

        expect(coWebsiteRatioAtPointer(tiny, { x: 0, y: 0 }, false, false)).toBe(1);
        expect(coWebsiteRatioAtPointer(tiny, { x: 0, y: 0 }, false, true)).toBe(1);
        expect(coWebsiteRatioAtPointer(tiny, { x: 0, y: 0 }, true, false)).toBe(1);
    });
});
