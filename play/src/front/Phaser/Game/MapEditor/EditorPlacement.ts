import { PathTileType } from "../../../Utils/PathfindingManager";

/**
 * Tells whether the map editor may place an entity on a tile, given the collision grid value of that tile.
 *
 * Meeting-room and personal-desk areas are painted into the collision grid as walkable tiles with a higher
 * path cost, so they stay available for furniture. Colliders, exits, starts and any other value stay blocked.
 */
export function isEditorPlacementTileAvailable(tileIndex: number): boolean {
    return (
        tileIndex === PathTileType.Walkable ||
        tileIndex === PathTileType.MeetingRoom ||
        tileIndex === PathTileType.PersonalDesk
    );
}
