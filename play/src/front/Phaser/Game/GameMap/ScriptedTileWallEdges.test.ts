import { describe, expect, it } from "vitest";
import { updateScriptedTileWallEdges } from "./ScriptedTileWallEdges";

describe("scripted tile wall edges", () => {
    it("replaces inherited wall edges without changing unrelated tile properties", () => {
        const tile = { index: 8, properties: { wallEdges: "ew", label: "desk", collides: false } };
        expect(updateScriptedTileWallEdges(tile, [{ name: "wallEdges", value: "ns" }], "ew")).toBe(true);
        expect(tile.properties).toEqual({ wallEdges: "ns", label: "desk", collides: false });
    });

    it.each(["removed", "plain", "invalid"])("clears stale edges for a %s tile", (kind) => {
        const tile = { index: kind === "removed" ? -1 : 8, properties: { wallEdges: "ew" } };
        const properties = kind === "invalid" ? [{ name: "wallEdges", value: 17 }] : [];
        expect(updateScriptedTileWallEdges(tile, properties, "ew")).toBe(true);
        expect(tile.properties).toEqual({});
    });

    it("clears edges when a Tiled property omits its optional value", () => {
        const tile = { index: 8, properties: { wallEdges: "e" } };
        expect(updateScriptedTileWallEdges(tile, [{ name: "wallEdges" }], "e")).toBe(true);
        expect(tile.properties).toEqual({});
    });

    it("adds authoritative edges when inserting into an empty cell", () => {
        const tile = { index: 8, properties: {} };
        expect(updateScriptedTileWallEdges(tile, [{ name: "wallEdges", value: "e" }], undefined)).toBe(true);
        expect(tile.properties).toEqual({ wallEdges: "e" });
    });

    it("does not request wall rebuilds for unrelated animation frame updates", () => {
        const tile = { index: 9, properties: { doorFrame: 2 } };
        expect(updateScriptedTileWallEdges(tile, [], undefined)).toBe(false);
        expect(tile.properties).toEqual({ doorFrame: 2 });
    });

    it("does not request wall rebuilds when a replacement keeps the same edges", () => {
        const tile = { index: 9, properties: { wallEdges: "e" } };
        expect(updateScriptedTileWallEdges(tile, [{ name: "wallEdges", value: "e" }], "e")).toBe(false);
    });
});
