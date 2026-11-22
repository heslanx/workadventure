import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";
import type { Room } from "../../../Connection/Room";
import type { GameScene } from "../../../Phaser/Game/GameScene";

// These modules reach the media devices, the game manager and the API client. The shell reads one store of each.
vi.mock("../../../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { enableCameraSceneVisibilityStore: writable(false) };
});
vi.mock("../../../Stores/MenuStore", async () => {
    const { writable } = await import("svelte/store");
    return { menuIconVisiblilityStore: writable(false) };
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
import { menuIconVisiblilityStore } from "../../../Stores/MenuStore";
import { pwaInstallSceneVisibleStore } from "../../../Stores/PwaInstallStore";
import { errorStore } from "../../../Stores/ErrorStore";
import { errorScreenStore } from "../../../Stores/ErrorScreenStore";
import { mapDeletedPromptStore } from "../../../Stores/MapDeletedPromptStore";
import {
    shellActiveStore,
    shellEnabledStore,
    shellFramedStore,
    shellRoomStore,
    shellSettlingStore,
} from "./shellStore";

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
    menuIconVisiblilityStore.set(false);
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

describe("shellFramedStore", () => {
    const sceneCreated = menuIconVisiblilityStore;

    it("is off before a scene exists, whatever the room says: the entry screens come first", () => {
        expect(get(shellFramedStore)).toBe(false);
        currentRoomStore.set(room("start"));
        expect(get(shellFramedStore)).toBe(false);
    });

    it("turns on when the scene is created, while the shell is still not drawn", () => {
        currentRoomStore.set(room("start"));

        sceneCreated.set(true);

        expect(get(shellFramedStore)).toBe(true);
        expect(get(shellActiveStore)).toBe(false);
    });

    it("stays on as the shell is drawn, and through the loader and the empty scene of the next map", () => {
        currentRoomStore.set(room("start"));
        sceneCreated.set(true);
        const seen: boolean[] = [];
        const stop = shellFramedStore.subscribe((framed) => seen.push(framed));

        gameSceneStore.set(sceneOf(room("start")));
        gameSceneIsLoadedStore.set(true);
        loaderVisibleStore.set(true);
        gameSceneIsLoadedStore.set(false);
        gameSceneStore.set(undefined);
        loaderVisibleStore.set(false);
        gameSceneStore.set(sceneOf(room("next")));
        gameSceneIsLoadedStore.set(true);
        stop();

        expect(seen).toEqual([true]);
    });

    it.each<[string, () => void]>([
        ["the login screen is shown", () => loginSceneVisibleStore.set(true)],
        ["the character screen is shown", () => selectCharacterSceneVisibleStore.set(true)],
        ["the companion screen is shown", () => selectCompanionSceneVisibleStore.set(true)],
        ["the camera screen is shown", () => cameraScene.set(true)],
        ["the install screen is shown", () => pwaInstallSceneVisibleStore.set(true)],
        ["an error message is shown", () => errorStore.addErrorMessage("The connection was lost")],
        ["the error screen is shown", () => errorScreen.set({ type: "error" })],
        ["the map was deleted", () => mapDeletedPromptStore.set(true)],
    ])("turns off while %s, which fills the window", (_reason, cover) => {
        currentRoomStore.set(room("start"));
        sceneCreated.set(true);
        gameSceneIsLoadedStore.set(true);

        cover();

        expect(get(shellFramedStore)).toBe(false);
    });

    it("never turns on for a room whose metadata opts out", () => {
        currentRoomStore.set(room("start", optedOut));

        sceneCreated.set(true);
        gameSceneIsLoadedStore.set(true);

        expect(get(shellFramedStore)).toBe(false);
    });

    it("turns on with the metadata the room already has when its scene is created, and for no other metadata", () => {
        currentRoomStore.set(room("start", { konclui: { shell: "no" } }));

        sceneCreated.set(true);

        expect(get(shellFramedStore)).toBe(true);
    });
});

describe("shellSettlingStore", () => {
    const sceneCreated = menuIconVisiblilityStore;

    it("is off before a scene exists and for a room that opts out", () => {
        currentRoomStore.set(room("start"));
        expect(get(shellSettlingStore)).toBe(false);

        currentRoomStore.set(room("plain", optedOut));
        sceneCreated.set(true);
        expect(get(shellSettlingStore)).toBe(false);
    });

    it("is on from the moment the frame is laid out, for a room that does not opt out, until the shell is drawn", () => {
        currentRoomStore.set(room("start", undefined));
        const seen: boolean[] = [];
        const stop = shellSettlingStore.subscribe((settling) => seen.push(settling));

        sceneCreated.set(true);
        expect(get(shellFramedStore)).toBe(true);
        gameSceneStore.set(sceneOf(room("start")));
        gameSceneIsLoadedStore.set(true);
        stop();

        expect(seen).toEqual([false, true, false]);
    });

    it("holds the game again behind the loader of the next map, which keeps the frame, and releases it with the chrome", () => {
        currentRoomStore.set(room("start"));
        sceneCreated.set(true);
        gameSceneStore.set(sceneOf(room("start")));
        gameSceneIsLoadedStore.set(true);

        loaderVisibleStore.set(true);
        gameSceneIsLoadedStore.set(false);
        gameSceneStore.set(undefined);
        expect(get(shellFramedStore)).toBe(true);
        expect(get(shellSettlingStore)).toBe(true);

        loaderVisibleStore.set(false);
        gameSceneStore.set(sceneOf(room("next")));
        gameSceneIsLoadedStore.set(true);
        expect(get(shellSettlingStore)).toBe(false);
    });

    it("is off while an entry screen takes the window, because the game is not in the frame then", () => {
        currentRoomStore.set(room("start"));
        sceneCreated.set(true);

        loginSceneVisibleStore.set(true);

        expect(get(shellSettlingStore)).toBe(false);
    });
});

// A limit, pinned so that it is a decision and not an accident. The frame follows the room of the running scene, and
// between two maps the scene is gone, so the room is the start room: the next map's room is only named when its scene
// joins. From a start map that opts out into a default map the frame therefore turns on with the join, after the game
// element was laid out over the window, and that one shift is not held back.
describe("the frame between two maps", () => {
    it("takes the start room's opt-out into the next map until that map's scene joins", () => {
        currentRoomStore.set(room("plain", optedOut));
        sceneCreatedAfterExit();

        expect(get(shellFramedStore)).toBe(false);
        expect(get(shellSettlingStore)).toBe(false);

        gameSceneStore.set(sceneOf(room("office")));
        expect(get(shellFramedStore)).toBe(true);
    });

    function sceneCreatedAfterExit(): void {
        menuIconVisiblilityStore.set(true);
        loaderVisibleStore.set(true);
        gameSceneStore.set(undefined);
    }
});
