import { gameManager } from "../../../Phaser/Game/GameManager";
import { EditorToolName } from "../../../Phaser/Game/MapEditor/MapEditorModeManager";
import type { MapTool, MapTools } from "../stores/mapTools";

// The scene's map editor manager equips the tool, as upstream's map menu asks it (MapSubMenuContent.svelte).

const TOOLS: Readonly<Record<MapTool, EditorToolName>> = {
    editor: EditorToolName.EntityEditor,
    explore: EditorToolName.ExploreTheRoom,
};

export const mapToolsAdapter: MapTools = {
    equip(tool) {
        gameManager
            .getCurrentGameScene()
            .getMapEditorModeManager()
            ?.equipTool(tool === undefined ? undefined : TOOLS[tool]);
    },
};
