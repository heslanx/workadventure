import { asError } from "catch-unknown";
import { get } from "svelte/store";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import type { Point, TileInteractionHost, TileMarks } from "../../../Phaser/Game/TileInteractionController";
import { mapEditorModeStore } from "../../../Stores/MapEditorStore";

/**
 * The game scene as the tile controller sees it.
 *
 * A walk goes through the same calls as upstream's right click and tap (`GameSceneUserInputHandler`): the camera frames
 * the avatar and the spot while it walks, and `GameScene.moveTo` finds the path, to the nearest free tile when the
 * destination is blocked.
 */
export function createSceneTileHost(
    scene: GameScene,
    options: { readonly isActive: () => boolean; readonly paint: (marks: TileMarks) => void },
): TileInteractionHost {
    const tiles = () => scene.getGameMapFrontWrapper().getTileDimensions();
    return {
        tileSize: tiles,
        mapSize() {
            // A map that does not say its size has no collision grid either (GameMapFrontWrapper): no tile is on it.
            const { width, height } = scene.getGameMapFrontWrapper().getMap();
            return { width: width ?? 0, height: height ?? 0 };
        },
        screenToWorld(point) {
            const world = scene.getCameraManager().getCamera().getWorldPoint(point.x, point.y);
            return { x: world.x, y: world.y };
        },
        worldToScreen(point) {
            const screen = scene.getCameraManager().getCamera().matrixCombined.transformPoint(point.x, point.y);
            return { x: screen.x, y: screen.y };
        },
        canSelect: () => options.isActive() && scene.userInputManager.isControlsEnabled && !get(mapEditorModeStore),
        canWalk: () => scene.userInputManager.isRightClickEnabled,
        walkTo(destination: Point): Promise<void> {
            const cameraManager = scene.getCameraManager();
            const walk = cameraManager.startWalkFraming(destination);
            return scene
                .moveTo(destination, true)
                .then(() => undefined)
                .catch((error: unknown) => {
                    console.error("[konclui] map tools: could not walk to the tile", asError(error));
                })
                .finally(() => cameraManager.endWalkFraming(walk));
        },
        isWalking: () => scene.CurrentPlayer.getPathAhead().length > 0,
        cancelWalk: () => scene.CurrentPlayer.finishFollowingPath(true),
        paint: options.paint,
    };
}
