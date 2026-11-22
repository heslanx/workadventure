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
import { menuIconVisiblilityStore } from "../../../Stores/MenuStore";
import { errorStore } from "../../../Stores/ErrorStore";
import { errorScreenStore } from "../../../Stores/ErrorScreenStore";
import { mapDeletedPromptStore } from "../../../Stores/MapDeletedPromptStore";
import { isShellEnabled } from "../domain/roomMetadata";
import { isShellActive, isShellFramed, isShellSettling, type ShellFrameGate } from "../domain/shellActivation";

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

/** What the shell reads from the client's progress, in one place so that the frame and the chrome decide from the same facts. */
const shellGateStore: Readable<ShellFrameGate> = derived(
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
        menuIconVisiblilityStore,
    ],
    ([
        shellEnabled,
        sceneLoaded,
        loading,
        login,
        character,
        companion,
        camera,
        pwa,
        errors,
        errorScreen,
        deleted,
        sceneCreated,
    ]) => ({
        shellEnabled,
        sceneLoaded,
        loading,
        entryScreenVisible: login || character || companion || camera || pwa,
        errorVisible: errors.length > 0 || errorScreen !== undefined || deleted,
        // Upstream raises this flag as the game scene is created and keeps it up through the exits from map to map. It
        // drops when the game is left for an entry screen, which is a state the gate covers on its own.
        sceneCreated,
    }),
);

/** Whether the office chrome is drawn right now: an enabled room whose scene is ready and uncovered. */
export const shellActiveStore: Readable<boolean> = derived(shellGateStore, isShellActive);

/**
 * Whether the game element is laid out inside the office frame. It turns true when the game scene is created, which
 * is before the shell is revealed, and stays true while the shell is active: nothing that happens after that moves the
 * game, the side panel opening included. The default is the frame; a room that opts out never gets it.
 *
 * The move from the window into the frame happens at this flip, so the game element is not visible then
 * (`shellSettlingStore`): the entry screens are the window's, the frame cannot start before them.
 */
export const shellFramedStore: Readable<boolean> = derived(shellGateStore, isShellFramed);

/**
 * Whether the map's box is held out of sight with all it holds: the frame is laid out and the chrome is not drawn
 * yet. The box moves from the window into the frame while this is on, and it is revealed with the chrome (see
 * `isShellSettling`).
 */
export const shellSettlingStore: Readable<boolean> = derived(shellGateStore, isShellSettling);
