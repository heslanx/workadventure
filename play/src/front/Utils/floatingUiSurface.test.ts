// @vitest-environment jsdom
import type { Placement } from "@floating-ui/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { popupSurface, popupTransformOrigin } from "./floatingUiSurface";
import { SURFACE_EXIT_MS } from "./surfaceTransition";
import { SPRING_SURFACE_MS } from "./spring";
import { stubWebAnimations, type WebAnimationsStub } from "./webAnimationsStub";

describe("popupTransformOrigin", () => {
    it.each<[Placement, string]>([
        ["top", "bottom center"],
        ["top-start", "bottom left"],
        ["top-end", "bottom right"],
        ["bottom", "top center"],
        ["bottom-start", "top left"],
        ["bottom-end", "top right"],
        ["left", "center right"],
        ["left-start", "top right"],
        ["left-end", "bottom right"],
        ["right", "center left"],
        ["right-start", "top left"],
        ["right-end", "bottom left"],
    ])("grows from %s: %s, the side that faces the trigger", (placement, origin) => {
        expect(popupTransformOrigin(placement)).toBe(origin);
    });

    it("trades left and right for an aligned popup above or below its trigger on a page that reads right to left", () => {
        expect(popupTransformOrigin("top-start", true)).toBe("bottom right");
        expect(popupTransformOrigin("bottom-end", true)).toBe("top left");
    });

    it("keeps a centred popup and one beside its trigger as they are, whichever way the page reads", () => {
        // Left and right are the screen's, and a centred popup has no side to trade.
        for (const placement of ["top", "bottom", "left", "right", "left-start", "right-end"] as const) {
            expect(popupTransformOrigin(placement, true)).toBe(popupTransformOrigin(placement));
        }
    });
});

describe("popupSurface", () => {
    let animations: WebAnimationsStub;
    let node: HTMLElement;

    beforeEach(() => {
        animations = stubWebAnimations();
        vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
        node = document.createElement("div");
        document.body.append(node);
    });

    afterEach(() => {
        animations.restore();
        vi.unstubAllGlobals();
        document.body.replaceChildren();
    });

    it("gives a popup that asked for motion the surface transition: the spring in, the sheet curve out", () => {
        const run = popupSurface(node, { motion: true });

        expect(typeof run).toBe("function");
        if (typeof run !== "function") return;
        expect(run({ direction: "in" }).duration).toBe(SPRING_SURFACE_MS);
        expect(run({ direction: "out" }).duration).toBe(SURFACE_EXIT_MS);
    });

    it("gives a tooltip a transition of no duration, which Svelte ends in the same flush with nothing to hold", () => {
        const run = popupSurface(node, { motion: false });

        expect(typeof run).not.toBe("function");
        expect(run).toEqual({ duration: 0 });
    });
});
