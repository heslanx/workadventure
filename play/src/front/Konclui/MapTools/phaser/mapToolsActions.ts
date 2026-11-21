import { get } from "svelte/store";
import { iframeListener } from "../../../Api/IframeListener";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import { DESK_ACTION_ID } from "../domain/desk";

/** What the map tools do to the game, apart from ending a walk, which the tile extension owns. */
export const mapToolsActions = {
    /** The same call as upstream's "show my location": the view returns to the avatar and follows it again. */
    centerOnPlayer: (): void => {
        const scene = get(gameSceneStore);
        if (scene === undefined) {
            throw new Error("[konclui] map tools: there is no game scene to centre the view in");
        }
        scene.getCameraManager().resumePlayerFollow();
    },
    /**
     * Presses the office script's own "my desk" button, which walks the user to their chair. The tool only shows while
     * that button is registered (`deskReachable`), so the trigger always has a listener.
     */
    goToDesk: (): void => {
        iframeListener.sendButtonActionBarTriggered(DESK_ACTION_ID);
    },
};
