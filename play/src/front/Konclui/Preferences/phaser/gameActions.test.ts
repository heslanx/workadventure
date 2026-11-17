/* eslint-disable @typescript-eslint/unbound-method -- expect() on vi.fn() members of module mocks */
import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { gameManager } from "../../../Phaser/Game/GameManager";
import type { GameScene } from "../../../Phaser/Game/GameScene";
import { gameSceneStore } from "../../../Stores/GameSceneStore";
import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../../../Stores/SelectCompanionStore";
import { loginSceneVisibleStore } from "../../../Stores/LoginSceneStore";
import { gameActions } from "./gameActions";

// The scene commands the dialog sends: each must leave for the same scene and set the same flags as upstream's
// profile menu, and read the running map the way upstream's settings and invite read it.

vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Phaser/Game/GameManager", () => ({ gameManager: { leaveGame: vi.fn() } }));
vi.mock("../../../Phaser/Login/LoginScene", () => ({ LoginSceneName: "LoginScene", LoginScene: class {} }));
vi.mock("../../../Phaser/Login/PwaInstallScene", () => ({
    PwaInstallSceneName: "PwaInstallScene",
    PwaInstallScene: class {},
}));
vi.mock("../../../Phaser/Login/SelectCharacterScene", () => ({
    SelectCharacterSceneName: "SelectCharacterScene",
    SelectCharacterScene: class {},
}));
vi.mock("../../../Phaser/Login/SelectCompanionScene", () => ({
    SelectCompanionSceneName: "SelectCompanionScene",
    SelectCompanionScene: class {},
}));
vi.mock("../../../Stores/GameSceneStore", async () => {
    const { writable } = await import("svelte/store");
    return { gameSceneStore: writable(undefined) };
});

/** A running map with the parts the commands read. */
function mapScene(): GameScene {
    const scene = {
        setTileAnimationsPaused: vi.fn(),
        getStartPositionNames: () => ["hall", "garden"],
        CurrentPlayer: { x: 120.7, y: 48.2 },
    };
    // Only the parts the commands use.
    return scene as unknown as GameScene;
}

describe("the game commands", () => {
    afterEach(() => {
        vi.clearAllMocks();
        gameSceneStore.set(undefined);
        loginSceneVisibleStore.set(false);
        selectCharacterSceneVisibleStore.set(false);
        selectCompanionSceneVisibleStore.set(false);
    });

    it("opens each editor as the profile menu does: its flag, its scene, its event", () => {
        gameActions.openNameEditor();
        expect(get(loginSceneVisibleStore)).toBe(true);
        expect(vi.mocked(gameManager.leaveGame).mock.calls[0][0]).toBe("LoginScene");

        gameActions.openWokaEditor();
        expect(get(selectCharacterSceneVisibleStore)).toBe(true);
        expect(vi.mocked(gameManager.leaveGame).mock.calls[1][0]).toBe("SelectCharacterScene");

        gameActions.openCompanionEditor();
        expect(get(selectCompanionSceneVisibleStore)).toBe(true);
        expect(vi.mocked(gameManager.leaveGame).mock.calls[2][0]).toBe("SelectCompanionScene");

        gameActions.openPwaInstall();
        expect(vi.mocked(gameManager.leaveGame).mock.calls[3][0]).toBe("PwaInstallScene");

        expect(vi.mocked(analyticsClient.trackAdminEvent).mock.calls.map(([event]) => event)).toEqual([
            "profile.name_edit_opened",
            "profile.woka_edit_opened",
            "profile.companion_edit_opened",
            "pwa.install_from_profile_menu_clicked",
        ]);
    });

    it("pauses the running map's animations and reads its start positions and player", () => {
        const scene = mapScene();
        gameSceneStore.set(scene);

        gameActions.pauseTileAnimations(true);

        expect(scene.setTileAnimationsPaused).toHaveBeenCalledWith(true);
        expect(gameActions.startPositionNames()).toEqual(["hall", "garden"]);
        expect(gameActions.playerPosition()).toEqual({ x: 120, y: 48 });
    });

    it("has nothing to pause or read outside a map", () => {
        expect(() => gameActions.pauseTileAnimations(true)).not.toThrow();
        expect(gameActions.startPositionNames()).toEqual([]);
        expect(gameActions.playerPosition()).toBeUndefined();
    });
});
