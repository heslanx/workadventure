// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// PathfindingManager imports Phaser/Entity/Character, which loads phaser, and phaser throws without a window.
// Only the character body constants are read from it, so a small mock keeps this test free of the engine.
vi.mock("../../Entity/Character", () => ({
    CHARACTER_BODY_HEIGHT: 16,
    CHARACTER_BODY_OFFSET_X: 0,
    CHARACTER_BODY_OFFSET_Y: 0,
}));

import { PathTileType } from "../../../Utils/PathfindingManager";
import { isEditorPlacementTileAvailable } from "./EditorPlacement";

describe("editor placement walkable tiles", () => {
    it("allows floor, meeting room, and personal desk path costs", () => {
        const available = [PathTileType.Walkable, PathTileType.MeetingRoom, PathTileType.PersonalDesk].map(
            isEditorPlacementTileAvailable,
        );

        expect(available).toEqual([true, true, true]);
    });

    it("continues to block physical and reserved collision tiles", () => {
        const available = [PathTileType.Collider, PathTileType.Exit, PathTileType.Start, -1, 6].map(
            isEditorPlacementTileAvailable,
        );

        expect(available).toEqual([false, false, false, false, false]);
    });
});
