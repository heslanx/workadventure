import { derived, type Readable } from "svelte/store";
import type { Room } from "../../../Connection/Room";
import { currentRoomStore } from "../../../Stores/CurrentRoomStore";
import { gameSceneIsLoadedStore, gameSceneStore } from "../../../Stores/GameSceneStore";
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
 * The room the shell is drawn for: the room of the running scene, or the start room until a scene runs.
 *
 * Upstream sets `currentRoomStore` once, for the start room, and walking through an exit starts a new scene
 * without touching it. Every shell reader takes the room from here so that all of them follow the exit.
 */
export const shellRoomStore: Readable<Room | undefined> = derived(
    [gameSceneStore, currentRoomStore],
    ([scene, startRoom]) => scene?.room ?? startRoom,
);

/**
 * Whether the current room uses the office shell, from its configuration alone. It turns true as soon as the
 * room is known, before the scene loads, so the dock replaces the upstream action bar without the upstream bar
 * showing first.
 */
export const shellEnabledStore: Readable<boolean> = derived(
    shellRoomStore,
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
