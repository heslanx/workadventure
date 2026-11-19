import { mount } from "svelte";
import {
    registerActionBar,
    registerAppFrame,
    registerSceneExtension,
    setEmbeddedChatHost,
} from "../ExternalModule/ClientExtensionPoints";
import Frame from "./Shell/components/Frame.svelte";
import Dock from "./Shell/components/Dock.svelte";
import { shellActiveStore, shellEnabledStore } from "./Shell/stores/shellStore";
import { createPresenceExtension } from "./Presence/phaser/presenceExtension";
import { publishPresence } from "./Presence/stores/presenceStore";
import { createSeatedPoseExtension } from "./Workplace/phaser/seatedPoseExtension";
import { createBrowserEffectsPort } from "./Ambience/phaser/browserEffectsPort";
import { createSceneEffectsExtension } from "./Ambience/phaser/sceneEffectsExtension";
import PreferencesHost from "./Preferences/components/PreferencesHost.svelte";
import { gameActions } from "./Preferences/phaser/gameActions";
import { installGameCommands } from "./Preferences/stores/gameCommands";
import { cameraSceneAdapter } from "./OfficeMenu/phaser/cameraSceneAdapter";
import { mapToolsAdapter } from "./OfficeMenu/phaser/mapToolsAdapter";
import { installCameraScene } from "./OfficeMenu/stores/cameraScene";
import { installMapTools } from "./OfficeMenu/stores/mapTools";

let installed = false;

/**
 * Plugs Konclui into the client through its extension points. Call it once before the app is mounted, because
 * the app reads its frame when it first renders. Later calls do nothing.
 */
export function installKonclui(): void {
    if (installed) return;
    installed = true;
    registerAppFrame(Frame);
    registerActionBar({ component: Dock, active: shellEnabledStore });
    setEmbeddedChatHost(shellActiveStore);
    registerSceneExtension(createSeatedPoseExtension());
    // One extension reads the player's surroundings for the people pill and the place chip; it hands what it reads to
    // the store, so the Phaser layer writes no Konclui state.
    registerSceneExtension(createPresenceExtension(publishPresence));
    registerSceneExtension(createSceneEffectsExtension(createBrowserEffectsPort()));
    // The dialog's components reach the game through this registry, not through the Phaser layer.
    installGameCommands(gameActions);
    // The logo's menu switches the map editor and the explorer through the scene's editor manager, by the same road.
    installMapTools(mapToolsAdapter);
    // Its camera and microphone row opens the camera scene, as the profile menu's row does.
    installCameraScene(cameraSceneAdapter);
    // The preferences dialog lives beside the app, over everything: the rail opens it with `openPreferences()`.
    const preferences = document.createElement("div");
    document.body.append(preferences);
    mount(PreferencesHost, { target: preferences });
}
