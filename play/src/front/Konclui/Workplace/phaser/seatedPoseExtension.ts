import type { SceneExtension } from "../../../ExternalModule/ClientExtensionPoints";
import { SeatedPoseController } from "./SeatedPoseController";

/**
 * Draws the seated pose of every character on each frame and gives it back when the scene shuts down.
 *
 * It maps what the scene shows an extension to the input of `SeatedPoseController`: the current player's seat is
 * their own `officeSeat` variable, and the seat of each remote player is the one they published.
 */
export function createSeatedPoseExtension(): SceneExtension {
    const controller = new SeatedPoseController();
    return {
        id: "konclui.seatedPose",
        onFrame(context) {
            if (context.currentPlayer === undefined) return;
            controller.update({
                scene: context.scene,
                baseUrl: context.baseUrl,
                currentPlayer: context.currentPlayer,
                currentSeat: context.getPlayerVariable("officeSeat"),
                remoteCharacters: context.remoteCharacters,
                remotePlayers: context.remotePlayers,
            });
        },
        onShutdown(scene) {
            controller.reset(scene);
        },
    };
}
