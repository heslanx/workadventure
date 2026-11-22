import { derived } from "svelte/store";
import { errorStore } from "../Stores/ErrorStore";
import { errorScreenStore } from "../Stores/ErrorScreenStore";
import { loaderVisibleStore } from "../Stores/LoaderStore";
import { loginSceneVisibleStore } from "../Stores/LoginSceneStore";
import { enableCameraSceneVisibilityStore } from "../Stores/MediaStore";
import { mapDeletedPromptStore } from "../Stores/MapDeletedPromptStore";
import { pwaInstallSceneVisibleStore } from "../Stores/PwaInstallStore";
import { selectCharacterSceneVisibleStore } from "../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../Stores/SelectCompanionStore";
import { isStructuredCloneSupported } from "./BrowserCompatibility";
import { removeBootSplash, removeBootSplashOnFirstScreen } from "./BootSplash";

/**
 * Removes the splash of play/index.html when the app first shows one of the screens that GameOverlay.svelte
 * switches between. Call it once, after the app is mounted.
 */
export function installBootSplashRemoval(
    scheduleFrame: (callback: () => void) => unknown = (callback) => window.requestAnimationFrame(callback),
): () => void {
    if (!isStructuredCloneSupported()) {
        // App.svelte then shows only the "browser not supported" message and never starts the game: none of the
        // screens below will ever appear, and the message must not sit under a logo.
        scheduleFrame(() => {
            removeBootSplash();
        });
        return () => {};
    }
    return removeBootSplashOnFirstScreen(
        {
            loader: loaderVisibleStore,
            others: [
                loginSceneVisibleStore,
                derived(errorScreenStore, (error) => error !== undefined),
                derived(errorStore, (messages) => messages.length > 0),
                selectCharacterSceneVisibleStore,
                selectCompanionSceneVisibleStore,
                enableCameraSceneVisibilityStore,
                pwaInstallSceneVisibleStore,
                mapDeletedPromptStore,
            ],
        },
        scheduleFrame,
    );
}
