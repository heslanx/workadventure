import { mount } from "svelte";
import { get } from "svelte/store";
import {
    registerActionBar,
    registerAppFrame,
    registerMapTools,
    registerSceneExtension,
    registerWorldSpaceExtension,
    setEmbeddedChatHost,
} from "../ExternalModule/ClientExtensionPoints";
import { registerCustomEmoteProvider } from "../Phaser/Entity/CustomEmotes";
import { registerReactionsMenu } from "../ExternalModule/ReactionsMenuPort";
import Frame from "./Shell/components/Frame.svelte";
import Dock from "./Shell/components/Dock.svelte";
import { shellActiveStore, shellEnabledStore } from "./Shell/stores/shellStore";
import { createPresenceExtension } from "./Presence/phaser/presenceExtension";
import { presenceActions } from "./Presence/phaser/presenceActions";
import { crowdWanted, publishCrowd } from "./Presence/stores/crowdStore";
import { installPresenceCommands } from "./Presence/stores/presenceCommands";
import { publishPresence } from "./Presence/stores/presenceStore";
import { attachWorldSpace } from "./Presence/stores/worldRoster";
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
import { createFocusSeatExtension } from "./Focus/phaser/focusSeatExtension";
import { deskActions } from "./Focus/phaser/deskActions";
import { installDeskCommands } from "./Focus/stores/deskCommands";
import { focusActiveStore, publishSeat } from "./Focus/stores/focusStore";
import MapTools from "./MapTools/components/MapTools.svelte";
import { mapToolsActions } from "./MapTools/phaser/mapToolsActions";
import { createDeskExtension } from "./MapTools/phaser/deskExtension";
import { createTileInteractionExtension } from "./MapTools/phaser/tileInteractionExtension";
import { localUserId, publishAtDesk, publishDesks } from "./MapTools/stores/deskStore";
import { installMapToolsCommands } from "./MapTools/stores/mapToolsCommands";
import { publishWalk } from "./MapTools/stores/walkStore";
import EmoteSection from "./Reactions/components/EmoteSection.svelte";
import { customEmoteProvider, describeNativeReaction } from "./Reactions/stores/reactionsAdapter";

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
    // While the people panel is open the same walk keeps the people around the player for its rows.
    registerSceneExtension(createPresenceExtension(publishPresence, { wanted: crowdWanted, publish: publishCrowd }));
    // The world space counts the world by the headcount the back sends and lists it only while the panel is open: the
    // scene takes its count from here instead of watching every person of the world.
    registerWorldSpaceExtension({ joined: attachWorldSpace });
    // The panel's rows walk to a person through the connection, by this registry.
    installPresenceCommands(presenceActions);
    // The vignette is the one effect that follows the user's own state: it darkens the map's edges while focus runs.
    // Ambience cannot import Focus (the domain graph), so the root gives it the question.
    registerSceneExtension(
        createSceneEffectsExtension(createBrowserEffectsPort({ focused: () => get(focusActiveStore) })),
    );
    // Whether the player sits is what makes focus on offer; the extension reads it, the focus store keeps it.
    registerSceneExtension(createFocusSeatExtension(publishSeat));
    // The dialog's components reach the game through this registry, not through the Phaser layer.
    installGameCommands(gameActions);
    // The logo's menu switches the map editor and the explorer through the scene's editor manager, by the same road.
    installMapTools(mapToolsAdapter);
    // Its camera and microphone row opens the camera scene, as the profile menu's row does.
    installCameraScene(cameraSceneAdapter);
    // The dock's desk button walks to the desk through this registry, for the same reason.
    installDeskCommands(deskActions);
    // The tools above the map's zoom controls (centre on me, go to my desk, cancel a walk) fill the slot upstream's zoom
    // column leaves for them, while the office shell is on.
    registerMapTools({ component: MapTools, active: shellActiveStore });
    // The desks the room keeps, which the desk tool reads, come from one variable of the scene, and so does whether the
    // user already sits at theirs, which keeps that tool from being a press that does nothing.
    registerSceneExtension(createDeskExtension({ publishDesks, publishAtDesk, userId: localUserId }));
    // A click on the floor selects a tile and a double click walks there, in the office shell only. The tools end a walk
    // through the same extension, since it owns the walk's state.
    const tileInteraction = createTileInteractionExtension({
        active: shellActiveStore,
        publish: publishWalk,
    });
    registerSceneExtension(tileInteraction);
    installMapToolsCommands({
        ...mapToolsActions,
        cancelWalk: () => {
            tileInteraction.cancelWalk();
        },
    });
    // The pixel emotes ride the emote message the game already sends: the engine asks the provider whether a message
    // is one of them, and the reactions menu shows their grid and names its favourites through the menu's port.
    registerCustomEmoteProvider(customEmoteProvider);
    registerReactionsMenu({ section: EmoteSection, describeReaction: describeNativeReaction });
    // The preferences dialog lives beside the app, over everything: the rail opens it with `openPreferences()`.
    const preferences = document.createElement("div");
    document.body.append(preferences);
    mount(PreferencesHost, { target: preferences });
}
