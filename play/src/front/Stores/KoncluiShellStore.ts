import { derived } from "svelte/store";
import { currentRoomStore } from "./CurrentRoomStore";
import { gameSceneIsLoadedStore } from "./GameSceneStore";
import { loaderVisibleStore } from "./LoaderStore";
import { loginSceneVisibleStore } from "./LoginSceneStore";
import { selectCharacterSceneVisibleStore } from "./SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "./SelectCompanionStore";
import { enableCameraSceneVisibilityStore } from "./MediaStore";
import { pwaInstallSceneVisibleStore } from "./PwaInstallStore";
import { errorStore } from "./ErrorStore";
import { errorScreenStore } from "./ErrorScreenStore";
import { mapDeletedPromptStore } from "./MapDeletedPromptStore";
import { isKoncluiShellActive } from "./KoncluiLayout";

export const koncluiShellActiveStore = derived(
    [
        currentRoomStore,
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
    ([room, sceneLoaded, loading, login, character, companion, camera, pwa, errors, errorScreen, deleted]) =>
        isKoncluiShellActive({
            roomId: room?.id,
            sceneLoaded,
            loading,
            entryScreenVisible: login || character || companion || camera || pwa,
            errorVisible: errors.length > 0 || errorScreen !== undefined || deleted,
        }),
);
