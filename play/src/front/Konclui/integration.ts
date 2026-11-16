import {
    registerActionBar,
    registerAppFrame,
    registerSceneExtension,
    setEmbeddedChatHost,
} from "../ExternalModule/ClientExtensionPoints";
import Frame from "./Shell/components/Frame.svelte";
import Dock from "./Shell/components/Dock.svelte";
import { shellActiveStore, shellEnabledStore } from "./Shell/stores/shellStore";
import { createSeatedPoseExtension } from "./Workplace/phaser/seatedPoseExtension";

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
}
