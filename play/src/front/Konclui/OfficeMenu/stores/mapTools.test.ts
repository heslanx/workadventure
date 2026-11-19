import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { isCalendarVisibleStore } from "../../../Stores/CalendarStore";
import { mapEditorModeStore, mapExplorationModeStore } from "../../../Stores/MapEditorStore";
import { isTodoListVisibleStore } from "../../../Stores/TodoListStore";
import { installMapTools, mapEditorOnStore, toggleMapEditor, toggleMapExplorer, type MapTools } from "./mapTools";

const trackAdminEvent = vi.hoisted(() => vi.fn());
vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent } }));

describe("the map tools", () => {
    const equip = vi.fn<MapTools["equip"]>();

    beforeEach(() => {
        equip.mockClear();
        trackAdminEvent.mockClear();
        mapEditorModeStore.switchMode(false);
        mapExplorationModeStore.set(false);
        isTodoListVisibleStore.set(true);
        isCalendarVisibleStore.set(true);
        installMapTools({ equip });
    });

    it("switches the map editor on with its entity tool, and closes the todo list and the calendar", () => {
        toggleMapEditor();

        expect(get(mapEditorModeStore)).toBe(true);
        expect(get(mapEditorOnStore)).toBe(true);
        expect(equip).toHaveBeenCalledExactlyOnceWith("editor");
        expect(trackAdminEvent).toHaveBeenCalledWith("map_editor.opened");
        expect([get(isTodoListVisibleStore), get(isCalendarVisibleStore)]).toEqual([false, false]);
    });

    it("switches the map editor off and puts the tool down", () => {
        mapEditorModeStore.switchMode(true);

        toggleMapEditor();

        expect(get(mapEditorModeStore)).toBe(false);
        expect(equip).toHaveBeenCalledExactlyOnceWith(undefined);
        expect(trackAdminEvent).toHaveBeenCalledWith("map_editor.closed");
    });

    it("takes the editor from the explorer, which shares the editor's mode, instead of closing the mode", () => {
        mapEditorModeStore.switchMode(true);
        mapExplorationModeStore.set(true);
        expect(get(mapEditorOnStore)).toBe(false);

        toggleMapEditor();

        expect(get(mapEditorModeStore)).toBe(true);
        expect(equip).toHaveBeenCalledExactlyOnceWith("editor");
    });

    it("switches the explorer on with its tool", () => {
        toggleMapExplorer();

        expect(get(mapEditorModeStore)).toBe(true);
        expect(equip).toHaveBeenCalledExactlyOnceWith("explore");
        expect(trackAdminEvent).toHaveBeenCalledWith("map_explorer.top_button_clicked");
        expect([get(isTodoListVisibleStore), get(isCalendarVisibleStore)]).toEqual([false, false]);
    });

    it("switches the explorer off and puts the tool down", () => {
        mapEditorModeStore.switchMode(true);
        mapExplorationModeStore.set(true);

        toggleMapExplorer();

        expect(get(mapEditorModeStore)).toBe(false);
        expect(equip).toHaveBeenCalledExactlyOnceWith(undefined);
    });
});
