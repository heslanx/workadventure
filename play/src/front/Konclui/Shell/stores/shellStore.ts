import { derived, type Readable } from "svelte/store";
import { currentRoomStore } from "../../../Stores/CurrentRoomStore";
import { gameSceneIsLoadedStore } from "../../../Stores/GameSceneStore";
import { loaderVisibleStore } from "../../../Stores/LoaderStore";
import { loginSceneVisibleStore } from "../../../Stores/LoginSceneStore";
import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../../../Stores/SelectCompanionStore";
import { enableCameraSceneVisibilityStore } from "../../../Stores/MediaStore";
import { pwaInstallSceneVisibleStore } from "../../../Stores/PwaInstallStore";
import { errorStore } from "../../../Stores/ErrorStore";
import { errorScreenStore } from "../../../Stores/ErrorScreenStore";
import { mapDeletedPromptStore } from "../../../Stores/MapDeletedPromptStore";
import { isShellEnabled } from "../domain/roomMetadata";
import { isShellActive } from "../domain/shellActivation";

/**
 * Whether the current room uses the office shell, from its configuration alone. It turns true as soon as the
 * room is known, before the scene loads, so the dock replaces the upstream action bar without the upstream bar
 * showing first.
 */
export const shellEnabledStore: Readable<boolean> = derived(
    currentRoomStore,
    (room) => room !== undefined && isShellEnabled(room.metadata),
);

/** Whether the office chrome is drawn right now: an enabled room whose scene is ready and uncovered. */
export const shellActiveStore: Readable<boolean> = derived(
    [
        shellEnabledStore,
        gameSceneIsLoadedStore,
        loaderVisibleStore,
        loginSceneVisibleStore,
        selectCharacterSceneVisibleStore,
        selectCompanionSceneVisibleStore,
        enableCameraSceneVisibilityStore,
        pwaInstallSceneVisibleStore,
        errorStore,
        errorScreenStore,
        mapDeletedPromptStore,
    ],
    ([shellEnabled, sceneLoaded, loading, login, character, companion, camera, pwa, errors, errorScreen, deleted]) =>
        isShellActive({
            shellEnabled,
            sceneLoaded,
            loading,
            entryScreenVisible: login || character || companion || camera || pwa,
            errorVisible: errors.length > 0 || errorScreen !== undefined || deleted,
        }),
);
