import { get } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { gameManager } from "../../../Phaser/Game/GameManager";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import type { Player } from "../../../Phaser/Player/Player";
import { LoginScene, LoginSceneName } from "../../../Phaser/Login/LoginScene";
import { PwaInstallScene, PwaInstallSceneName } from "../../../Phaser/Login/PwaInstallScene";
import { SelectCharacterScene, SelectCharacterSceneName } from "../../../Phaser/Login/SelectCharacterScene";
import { SelectCompanionScene, SelectCompanionSceneName } from "../../../Phaser/Login/SelectCompanionScene";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import { loginSceneVisibleStore } from "../../../Stores/LoginSceneStore";
import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../../../Stores/SelectCompanionStore";
import type { GameCommands, MapPosition } from "../stores/gameCommands";

// What the dialog asks of the game, the way upstream's profile menu and settings ask it (ProfileMenuContent.svelte,
// SettingsSubMenu.svelte, GuestSubMenu.svelte): the editors are scenes of their own, so opening one leaves the office.
// `installKonclui()` installs them as the dialog's game commands (stores/gameCommands.ts).

export function openNameEditor(): void {
    loginSceneVisibleStore.set(true);
    gameManager.leaveGame(LoginSceneName, new LoginScene());
    analyticsClient.trackAdminEvent("profile.name_edit_opened");
}

export function openWokaEditor(): void {
    selectCharacterSceneVisibleStore.set(true);
    gameManager.leaveGame(SelectCharacterSceneName, new SelectCharacterScene());
    analyticsClient.trackAdminEvent("profile.woka_edit_opened");
}

export function openCompanionEditor(): void {
    selectCompanionSceneVisibleStore.set(true);
    gameManager.leaveGame(SelectCompanionSceneName, new SelectCompanionScene());
    analyticsClient.trackAdminEvent("profile.companion_edit_opened");
}

export function openPwaInstall(): void {
    analyticsClient.trackAdminEvent("pwa.install_from_profile_menu_clicked");
    gameManager.leaveGame(PwaInstallSceneName, new PwaInstallScene());
}

/** The map's scene; undefined outside a map (a login screen), where there is nothing to pause or to invite to. */
function currentScene(): GameScene | undefined {
    return get(gameSceneStore);
}

/** Pauses or resumes the map's tile animations now; a later map reads the saved setting itself. */
export function pauseTileAnimations(paused: boolean): void {
    currentScene()?.setTileAnimationsPaused(paused);
}

/** The map's start positions, for the invite's entry point; empty outside a map. */
export function startPositionNames(): string[] {
    return currentScene()?.getStartPositionNames() ?? [];
}

/** Where the player stands, in map pixels, for an invite that walks the guest there. */
export function playerPosition(): MapPosition | undefined {
    // The scene creates its player once the map is loaded.
    const player: Player | undefined = currentScene()?.CurrentPlayer;
    return player === undefined ? undefined : { x: Math.floor(player.x), y: Math.floor(player.y) };
}

export const gameActions: GameCommands = {
    openNameEditor,
    openWokaEditor,
    openCompanionEditor,
    openPwaInstall,
    pauseTileAnimations,
    startPositionNames,
    playerPosition,
};
