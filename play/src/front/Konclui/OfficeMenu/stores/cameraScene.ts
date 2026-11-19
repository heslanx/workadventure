// The camera and microphone screen, opened the way upstream's profile menu opens it (ProfileMenuContent.svelte,
// "Edit cam / mic"): a scene of its own with the preview and the "Save settings" button, not the dock's device
// popover. The scene is Phaser's, which the components may not reach: `installKonclui()` installs the Phaser
// implementation (`phaser/cameraSceneAdapter.ts`) as this port.

export interface CameraSceneCommands {
    /** Leaves the office for the camera and microphone screen. */
    openCameraScene(): void;
}

let installed: CameraSceneCommands | undefined;

export function installCameraScene(commands: CameraSceneCommands): void {
    installed = commands;
}

export function openCameraScene(): void {
    if (installed === undefined) {
        console.error("[konclui] office menu: the camera scene command is not installed");
        return;
    }
    installed.openCameraScene();
}
