import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";
import type { Room } from "../../../Connection/Room";
import type { GameScene } from "../../../Phaser/Game/GameScene";

// These modules reach the media devices, the game manager and the API client. The shell reads one store of each.
vi.mock("../../../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { enableCameraSceneVisibilityStore: writable(false) };
});
vi.mock("../../../Stores/PwaInstallStore", async () => {
    const { writable } = await import("svelte/store");
    return { pwaInstallSceneVisibleStore: writable(false) };
});
vi.mock("../../../Stores/ErrorScreenStore", async () => {
    const { writable } = await import("svelte/store");
    return { errorScreenStore: writable(undefined) };
});

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
import { shellActiveStore, shellEnabledStore, shellRoomStore } from "./shellStore";

const cameraScene = enableCameraSceneVisibilityStore as unknown as Writable<boolean>;
const errorScreen = errorScreenStore as unknown as Writable<object | undefined>;

/** The two things the shell reads from a room: its identity and its free-form metadata. */
function room(id: string, metadata: unknown = undefined): Room {
    return { id, metadata } as unknown as Room;
}

function sceneOf(sceneRoom: Room): GameScene {
    return { room: sceneRoom } as unknown as GameScene;
}

const optedOut = { konclui: { shell: false } };

beforeEach(() => {
    currentRoomStore.set(undefined);
    gameSceneStore.set(undefined);
    gameSceneIsLoadedStore.set(false);
    loaderVisibleStore.set(false);
    loginSceneVisibleStore.set(false);
    selectCharacterSceneVisibleStore.set(false);
    selectCompanionSceneVisibleStore.set(false);
    cameraScene.set(false);
    pwaInstallSceneVisibleStore.set(false);
    errorStore.clearClosableMessages();
    errorScreen.set(undefined);
    mapDeletedPromptStore.set(false);
});

describe("shellRoomStore", () => {
    it("is the start room until a scene runs", () => {
        expect(get(shellRoomStore)).toBeUndefined();
        const start = room("start");
        currentRoomStore.set(start);
        expect(get(shellRoomStore)).toBe(start);
    });

    it("follows the running scene through an exit, which leaves the start room store untouched", () => {
        const start = room("start");
        const next = room("next");
        currentRoomStore.set(start);
        gameSceneStore.set(sceneOf(start));
        expect(get(shellRoomStore)).toBe(start);

        gameSceneStore.set(sceneOf(next));
        expect(get(shellRoomStore)).toBe(next);
    });
});

describe("shellEnabledStore", () => {
    it("is off while no room is known", () => {
        expect(get(shellEnabledStore)).toBe(false);
    });

    it("is off for a room whose metadata opts out of the shell", () => {
        currentRoomStore.set(room("start", optedOut));
        expect(get(shellEnabledStore)).toBe(false);
    });

    it("is on for a room with any other metadata", () => {
        currentRoomStore.set(room("start", { konclui: { theme: "dark" } }));
        expect(get(shellEnabledStore)).toBe(true);
    });

    it("turns off on walking from a default room into one that opts out, and back on the way out", () => {
        const defaultRoom = room("default");
        currentRoomStore.set(defaultRoom);
        gameSceneStore.set(sceneOf(defaultRoom));
        expect(get(shellEnabledStore)).toBe(true);

        gameSceneStore.set(sceneOf(room("plain", optedOut)));
        expect(get(shellEnabledStore)).toBe(false);

        gameSceneStore.set(sceneOf(defaultRoom));
        expect(get(shellEnabledStore)).toBe(true);
    });
});

describe("shellActiveStore", () => {
    beforeEach(() => {
        const start = room("start");
        currentRoomStore.set(start);
        gameSceneStore.set(sceneOf(start));
        gameSceneIsLoadedStore.set(true);
    });

    it("is on for an enabled room whose scene is loaded and uncovered", () => {
        expect(get(shellActiveStore)).toBe(true);
    });

    it.each<[string, () => void]>([
        ["the room opts out", () => gameSceneStore.set(sceneOf(room("plain", optedOut)))],
        ["the scene is not loaded", () => gameSceneIsLoadedStore.set(false)],
        ["the loader is shown", () => loaderVisibleStore.set(true)],
        ["the login screen is shown", () => loginSceneVisibleStore.set(true)],
        ["the character screen is shown", () => selectCharacterSceneVisibleStore.set(true)],
        ["the companion screen is shown", () => selectCompanionSceneVisibleStore.set(true)],
        ["the camera screen is shown", () => cameraScene.set(true)],
        ["the install screen is shown", () => pwaInstallSceneVisibleStore.set(true)],
        ["an error message is shown", () => errorStore.addErrorMessage("The connection was lost")],
        ["the error screen is shown", () => errorScreen.set({ type: "error" })],
        ["the map was deleted", () => mapDeletedPromptStore.set(true)],
    ])("is off while %s", (_reason, cover) => {
        cover();
        expect(get(shellActiveStore)).toBe(false);
    });
});
