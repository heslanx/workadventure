import { describe, expect, it } from "vitest";
import { isEditorPlacementTileAvailable } from "./EditorPlacement";

describe("editor placement walkable tiles", () => {
    it("allows floor, meeting room, and personal desk path costs", () => {
        expect([0, 4, 5].map(isEditorPlacementTileAvailable)).toEqual([true, true, true]);
    });

    it("continues to block physical and reserved collision tiles", () => {
        expect([1, 2, 3, -1, 6].map(isEditorPlacementTileAvailable)).toEqual([false, false, false, false, false]);
    });
});
