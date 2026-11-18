import { derived, type Readable } from "svelte/store";
import { gameSceneStore } from "../../../Stores/GameSceneStore";

/**
 * How many people the world holds, the current user included, from the scene's own count: one integer the scene
 * already keeps, not the roster. It is 0 until the world's list has synchronised and while there is no scene; the
 * pill reads that as unknown (`describePill`), never as a count.
 *
 * It counts the whole world, not one room: the label says "online", not "in the office".
 */
export const onlineCountStore: Readable<number> = derived(
    gameSceneStore,
    (scene, set) => {
        if (scene === undefined) {
            set(0);
            return;
        }
        return scene.worldUserCounter.subscribe(set);
    },
    0,
);
