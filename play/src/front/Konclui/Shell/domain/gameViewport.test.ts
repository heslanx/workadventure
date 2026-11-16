import { describe, expect, it } from "vitest";
import { toGameViewport } from "./gameViewport";

const bounds = { width: 800, height: 600, left: 66, top: 6 };

describe("toGameViewport", () => {
    it("publishes the first non-empty measurement", () => {
        expect(toGameViewport(bounds, undefined)).toEqual({ kind: "publish", bounds });
    });

    it.each([
        ["zero width", { ...bounds, width: 0 }],
        ["zero height", { ...bounds, height: 0 }],
    ])("keeps the published bounds for a rect with %s", (_label, rect) => {
        expect(toGameViewport(rect, bounds)).toEqual({ kind: "keep" });
        expect(toGameViewport(rect, undefined)).toEqual({ kind: "keep" });
    });

    it("keeps the published bounds when nothing changed", () => {
        expect(toGameViewport({ ...bounds }, bounds)).toEqual({ kind: "keep" });
    });

    it.each([
        ["width", { ...bounds, width: 801 }],
        ["height", { ...bounds, height: 599 }],
        ["left", { ...bounds, left: 356 }],
        ["top", { ...bounds, top: 0 }],
    ])("publishes when the %s changes", (_label, rect) => {
        expect(toGameViewport(rect, bounds)).toEqual({ kind: "publish", bounds: rect });
    });
});
