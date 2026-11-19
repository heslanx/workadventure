import { get } from "svelte/store";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import type { DeskCommands } from "../stores/deskCommands";

// The way upstream's profile menu walks to the desk (MapSubMenuContent.svelte, goToPersonalDesk): the scene's own
// `walkToPersonalDesk`, which also answers the cases it cannot serve with its own warning. It walks to the middle of
// the personal area and does not sit.

async function walkToDesk(): Promise<void> {
    const scene = get(gameSceneStore);
    if (scene === undefined) {
        throw new Error("[konclui] focus: there is no game scene to walk to the desk in");
    }
    await scene.walkToPersonalDesk();
}

export const deskActions: DeskCommands = { walkToDesk };
