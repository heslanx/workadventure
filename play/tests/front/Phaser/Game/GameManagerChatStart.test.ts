// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import { Deferred } from "@workadventure/shared-utils";

// The scene classes pull Phaser and the whole game in: GameManager only names them.
vi.mock("../../../../src/front/Phaser/Game/GameScene", () => ({ GameScene: class {} }));
vi.mock("../../../../src/front/Phaser/Login/EnableCameraScene", () => ({ EnableCameraSceneName: "EnableCameraScene" }));
vi.mock("../../../../src/front/Phaser/Login/LoginScene", () => ({ LoginSceneName: "LoginScene" }));
vi.mock("../../../../src/front/Phaser/Login/PwaInstallScene", () => ({ PwaInstallSceneName: "PwaInstallScene" }));
vi.mock("../../../../src/front/Phaser/Login/SelectCharacterScene", () => ({
    SelectCharacterSceneName: "SelectCharacterScene",
}));
vi.mock("../../../../src/front/Phaser/Login/SelectCompanionScene", () => ({
    SelectCompanionSceneName: "SelectCompanionScene",
}));
vi.mock("../../../../src/front/Phaser/Login/EmptyScene", () => ({ EmptySceneName: "EmptyScene" }));
vi.mock("../../../../src/front/Connection/ConnectionManager", () => ({ connectionManager: {} }));
vi.mock("../../../../src/front/Enum/EnvironmentVariable", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    MATRIX_PUBLIC_URI: "https://matrix.test",
}));
vi.mock("@sentry/svelte", () => ({ setUser: vi.fn(), captureException: vi.fn() }));

const matrixConnection = { kind: "matrix", init: vi.fn(() => Promise.resolve()) };
vi.mock("../../../../src/front/Chat/Connection/Matrix/MatrixClientWrapper", () => ({
    MatrixClientWrapper: class {
        initMatrixClient() {
            return Promise.resolve({});
        }
    },
    MissingMatrixCredentialsError: class extends Error {},
}));
const matrixConnectionCreated = vi.fn();
vi.mock("../../../../src/front/Chat/Connection/Matrix/MatrixChatConnection", () => ({
    MatrixChatConnection: class {
        connectionStatus = writable("CONNECTING");
        init = matrixConnection.init;
        clearListener() {}
        destroy() {
            return Promise.resolve();
        }
        constructor() {
            matrixConnectionCreated();
        }
    },
}));

import { gameManager } from "../../../../src/front/Phaser/Game/GameManager";
import { userIsConnected } from "../../../../src/front/Stores/MenuStore";
import { chatVisibilityStore, chatZoneLiveStore } from "../../../../src/front/Stores/ChatStore";
import { localUserStore } from "../../../../src/front/Connection/LocalUserStore";
import { CHAT_DEFERRED_START_STORAGE_KEY } from "../../../../src/front/Chat/Connection/ChatStart";

// The room the scene is loading: GameManager reads it from `startRoom` until the scene is in `gameSceneStore`.
function enterRoom(isChatEnabled: boolean) {
    const room = { isChatEnabled, key: "room" };
    const manager = gameManager as unknown as { startRoom: unknown; _startRoomPromise: Deferred<unknown> };
    manager.startRoom = room;
    // A fresh deferred per room: a started room resolves it once for good.
    manager._startRoomPromise = new Deferred();
    manager._startRoomPromise.resolve(room);
}

/** Lets the dynamic import of the Matrix chunk and the connection promises settle. */
const settle = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
    });

let idleCallbacks: (() => void)[] = [];

beforeEach(() => {
    idleCallbacks = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => idleCallbacks.push(callback));
    vi.stubGlobal("cancelIdleCallback", () => undefined);
    userIsConnected.set(true);
    matrixConnectionCreated.mockClear();
});

afterEach(async () => {
    chatVisibilityStore.set(false);
    chatZoneLiveStore.set(false);
    localStorage.clear();
    vi.restoreAllMocks();
    await gameManager.logout();
    vi.unstubAllGlobals();
});

describe("GameManager and the start of the chat connection", () => {
    it("opens no Matrix client while the scene starts, waits for it, and opens it when the browser is idle", async () => {
        enterRoom(true);
        const built = vi.fn();

        // What the scene does while it is created: it builds on the connection without asking for it.
        gameManager.awaitChatConnection().then(built, built);
        await settle();
        expect(matrixConnectionCreated).not.toHaveBeenCalled();
        expect(built).not.toHaveBeenCalled();
        expect(get(gameManager.chatConnectionStore)).toBeUndefined();
        // Nothing asked for it: the chat buttons accept a click in this state, and the click starts it.
        expect(get(gameManager.chatConnectionAttemptStore)).toBe("idle");

        // The scene is playable.
        gameManager.startChatConnectionWhenIdle();
        await settle();
        expect(matrixConnectionCreated).not.toHaveBeenCalled();

        idleCallbacks[0]();
        await settle();

        expect(matrixConnectionCreated).toHaveBeenCalledTimes(1);
        expect(built).toHaveBeenCalledTimes(1);
        expect(get(gameManager.chatConnectionAttemptStore)).toBe("ready");
    });

    it("opens it at once when the user opens the chat first", async () => {
        enterRoom(true);
        gameManager.startChatConnectionWhenIdle();

        chatVisibilityStore.set(true);
        await settle();

        expect(matrixConnectionCreated).toHaveBeenCalledTimes(1);
        // The idle start that was waiting does not open a second client.
        idleCallbacks.forEach((callback) => callback());
        await settle();
        expect(matrixConnectionCreated).toHaveBeenCalledTimes(1);
    });

    it("opens it at once when something asks for it soon, as the player stepping into a chat room area does", async () => {
        enterRoom(true);
        gameManager.startChatConnectionWhenIdle();

        gameManager.requestChatConnection();
        await settle();

        expect(matrixConnectionCreated).toHaveBeenCalledTimes(1);
        idleCallbacks.forEach((callback) => callback());
        await settle();
        expect(matrixConnectionCreated).toHaveBeenCalledTimes(1);
    });

    it("lets a caller that comes after a void connection settled, in the same scene, go on", async () => {
        // A room with the chat off: the void connection opens at once and is not memoised, so a later caller (the world
        // join, Space.create()) must not wait for a start that already happened.
        enterRoom(false);
        gameManager.beginChatStartWait();
        gameManager.startChatConnectionWhenIdle();
        await settle();
        const late = vi.fn();

        gameManager.awaitChatConnection().then(late, late);
        await settle();

        expect(late).toHaveBeenCalledTimes(1);
        expect(late.mock.calls[0][0]).toBeDefined();
    });

    it("makes the next scene wait for its own start, even after a void connection in the scene before", async () => {
        enterRoom(false);
        gameManager.beginChatStartWait();
        gameManager.startChatConnectionWhenIdle();
        await settle();
        enterRoom(true);
        gameManager.beginChatStartWait();
        const built = vi.fn();

        gameManager.awaitChatConnection().then(built, built);
        await settle();

        expect(built).not.toHaveBeenCalled();
        expect(matrixConnectionCreated).not.toHaveBeenCalled();
    });

    it("keeps the loading state, not a failure, while the chat has not started", () => {
        enterRoom(true);
        gameManager.startChatConnectionWhenIdle();

        expect(get(gameManager.chatConnectionAttemptStore)).toBe("idle");
    });

    it("opens no client after a logout that came before the idle start, and still clears the Matrix session", async () => {
        enterRoom(true);
        const clearMatrixSession = vi.spyOn(localUserStore, "clearMatrixSession");
        gameManager.startChatConnectionWhenIdle();

        await gameManager.logout();
        idleCallbacks.forEach((callback) => callback());
        chatVisibilityStore.set(true);
        await settle();

        expect(clearMatrixSession).toHaveBeenCalled();
        expect(matrixConnectionCreated).not.toHaveBeenCalled();
    });

    it("puts the demand on the chat panel back for the scene that follows a logout", async () => {
        enterRoom(true);
        await gameManager.logout();
        gameManager.startChatConnectionWhenIdle();

        chatVisibilityStore.set(true);
        await settle();

        expect(matrixConnectionCreated).toHaveBeenCalledTimes(1);
    });

    it("never loads Matrix for a room with the chat off, and opens its void connection at once", async () => {
        enterRoom(false);
        const built = vi.fn();
        gameManager.awaitChatConnection().then(built, built);

        gameManager.startChatConnectionWhenIdle();
        chatVisibilityStore.set(true);
        await settle();

        expect(matrixConnectionCreated).not.toHaveBeenCalled();
        expect(idleCallbacks).toHaveLength(0);
        expect(built).toHaveBeenCalledTimes(1);
        expect(get(gameManager.chatConnectionStore)).toBeDefined();
        expect(get(gameManager.chatConnectionAttemptStore)).toBe("ready");
    });

    it("never loads Matrix for a visitor who is not signed in", async () => {
        userIsConnected.set(false);
        enterRoom(true);

        gameManager.startChatConnectionWhenIdle();
        await settle();

        expect(matrixConnectionCreated).not.toHaveBeenCalled();
        expect(get(gameManager.chatConnectionAttemptStore)).toBe("ready");
    });

    it("starts when the scene is created, as upstream did, with the flag off", async () => {
        localStorage.setItem(CHAT_DEFERRED_START_STORAGE_KEY, "0");
        enterRoom(true);

        await gameManager.awaitChatConnection();

        expect(matrixConnectionCreated).toHaveBeenCalledTimes(1);
    });

    it("lets a caller that asks for the connection itself (a direct message, a notification) open it", async () => {
        enterRoom(true);
        gameManager.startChatConnectionWhenIdle();

        await gameManager.getChatConnection();

        expect(matrixConnectionCreated).toHaveBeenCalledTimes(1);
        idleCallbacks.forEach((callback) => callback());
        await settle();
        expect(matrixConnectionCreated).toHaveBeenCalledTimes(1);
    });
});
