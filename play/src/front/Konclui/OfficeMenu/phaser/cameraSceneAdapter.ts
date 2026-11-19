import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { gameManager } from "../../../Phaser/Game/GameManager";
import { EnableCameraScene, EnableCameraSceneName } from "../../../Phaser/Login/EnableCameraScene";
import { enableCameraSceneVisibilityStore } from "../../../Stores/MediaStore";
import type { CameraSceneCommands } from "../stores/cameraScene";

// The same three steps as upstream's profile menu (ProfileMenuContent.svelte, openEnableCameraScene).

export const cameraSceneAdapter: CameraSceneCommands = {
    openCameraScene() {
        enableCameraSceneVisibilityStore.showEnableCameraScene();
        gameManager.leaveGame(EnableCameraSceneName, new EnableCameraScene());
        analyticsClient.trackAdminEvent("profile.camera_edit_opened");
    },
};
