import { derived, get, type Readable } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { isCalendarVisibleStore } from "../../../Stores/CalendarStore";
import { mapEditorModeStore, mapExplorationModeStore } from "../../../Stores/MapEditorStore";
import { isTodoListVisibleStore } from "../../../Stores/TodoListStore";

// The map editor and the room explorer, switched on and off the way upstream's map menu does it
// (MapSubMenuContent.svelte). The tool the scene holds is its editor manager's, which the components may not reach:
// `installKonclui()` installs the Phaser implementation (`phaser/mapToolsAdapter.ts`) as this port.

export type MapTool = "editor" | "explore";

export interface MapTools {
    /** Equips a tool in the open scene's map editor, or puts the tool down with undefined. */
    equip(tool: MapTool | undefined): void;
}

let installed: MapTools | undefined;

export function installMapTools(tools: MapTools): void {
    installed = tools;
}

function tools(): MapTools | undefined {
    if (installed === undefined) console.error("[konclui] office menu: the map tools are not installed");
    return installed;
}

/** The editor is on, as a tool of its own: the explorer shares the editor's mode and does not count. */
export const mapEditorOnStore: Readable<boolean> = derived(
    [mapEditorModeStore, mapExplorationModeStore],
    ([editorMode, exploring]) => editorMode && !exploring,
);

export const mapExplorerOnStore: Readable<boolean> = { subscribe: mapExplorationModeStore.subscribe };

export function toggleMapEditor(): void {
    if (get(mapEditorOnStore)) {
        analyticsClient.trackAdminEvent("map_editor.closed");
        mapEditorModeStore.switchMode(false);
        tools()?.equip(undefined);
    } else {
        analyticsClient.trackAdminEvent("map_editor.opened");
        mapEditorModeStore.switchMode(true);
        tools()?.equip("editor");
    }
    isTodoListVisibleStore.set(false);
    isCalendarVisibleStore.set(false);
}

export function toggleMapExplorer(): void {
    if (get(mapExplorationModeStore)) {
        tools()?.equip(undefined);
        mapEditorModeStore.switchMode(false);
    } else {
        mapEditorModeStore.switchMode(true);
        tools()?.equip("explore");
    }
    analyticsClient.trackAdminEvent("map_explorer.top_button_clicked");
    isTodoListVisibleStore.set(false);
    isCalendarVisibleStore.set(false);
}
