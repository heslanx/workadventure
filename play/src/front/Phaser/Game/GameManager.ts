import type { Readable, Unsubscriber } from "svelte/store";
import { get, readonly, writable } from "svelte/store";
import * as Sentry from "@sentry/svelte";
import * as Phaser from "phaser";
import { Deferred } from "@workadventure/shared-utils";
import { asError } from "catch-unknown";
import { TimeoutError } from "@workadventure/shared-utils/src/Abort/TimeoutError";
import { connectionManager } from "../../Connection/ConnectionManager";
import { localUserStore } from "../../Connection/LocalUserStore";
import type { Room } from "../../Connection/Room";
import { showHelpCameraSettings } from "../../Stores/HelpSettingsStore";
import {
    availabilityStatusStore,
    requestedCameraDeviceIdStore,
    requestedCameraState,
    requestedMicrophoneDeviceIdStore,
    requestedMicrophoneState,
} from "../../Stores/MediaStore";
import { menuIconVisiblilityStore, userIsConnected } from "../../Stores/MenuStore";
import { EnableCameraSceneName } from "../Login/EnableCameraScene";
import { LoginSceneName } from "../Login/LoginScene";
import { PwaInstallSceneName } from "../Login/PwaInstallScene";
import { SelectCharacterSceneName } from "../Login/SelectCharacterScene";
import { EmptySceneName } from "../Login/EmptyScene";
import { gameSceneIsLoadedStore, gameSceneStore } from "../../Stores/GameSceneStore";
import { currentRoomStore } from "../../Stores/CurrentRoomStore";
import { myCameraStore } from "../../Stores/MyMediaStore";
import { SelectCompanionSceneName } from "../Login/SelectCompanionScene";
import { errorScreenStore } from "../../Stores/ErrorScreenStore";
import { pwaInstallProfileMenuEligibleStore, pwaInstallSceneVisibleStore } from "../../Stores/PwaInstallStore";
import { hasCapability } from "../../Connection/Capabilities";
import type { ChatConnectionInterface } from "../../Chat/Connection/ChatConnection";
import { MATRIX_PUBLIC_URI } from "../../Enum/EnvironmentVariable";
import { VoidChatConnection } from "../../Chat/Connection/VoidChatConnection";
import { chatVisibilityStore, loginTokenErrorStore, isMatrixChatEnabledStore } from "../../Stores/ChatStore";
import { initializeChatVisibilitySubscription } from "../../Chat/Stores/ChatStore";
import { ChatStartCoordinator, isChatDeferredStartEnabled, runWhenIdle } from "../../Chat/Connection/ChatStart";
import {
    chatConnectionFailureStore,
    type ChatConnectionAttemptStatus,
} from "../../Chat/Stores/ChatConnectionFailureStore";
import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
import type { WokaData } from "../../Components/Woka/WokaTypes";
import { generateRandomName } from "../../Utils/RandomNameGenerator";
import { shouldShowPwaInstallSceneAsync } from "../../Utils/PwaInstallEligibility";
import { raceTimeout } from "../../Utils/PromiseUtils";
import { GameScene } from "./GameScene";

import ScenePlugin = Phaser.Scenes.ScenePlugin;

/**
 * This class should be responsible for any scene starting/stopping
 */
export class GameManager {
    private playerName: string | null;
    private characterTextureIds: string[] | null;
    private companionTextureId: string | null;
    private startRoom: Room | undefined;
    private _startRoomPromise: Deferred<Room> = new Deferred();
    private currentGameSceneName: string | null = null;
    // Note: this scenePlugin is the scenePlugin of the EntryScene. We should always provide a key in methods called on this scenePlugin.
    private scenePlugin!: ScenePlugin;
    private visitCardUrl: string | null = null;
    private matrixServerUrl: string | undefined = undefined;
    private chatConnectionPromise: Promise<ChatConnectionInterface> | undefined;
    private pendingChatConnectionPromise: Promise<ChatConnectionInterface> | undefined;
    // Set when the last openChatConnection() fell back on a void connection because the Matrix code did not download.
    private matrixChatLoadFailed = false;
    private matrixLoginTokenExchange: Promise<void> | undefined;
    private readonly _chatConnectionStore = writable<ChatConnectionInterface | undefined>(undefined);
    /**
     * The chat connection, once there is one. The map does not wait for it, and for a logged-in user it only
     * exists once the Matrix code is downloaded: any UI mounted with the map must go through this store.
     */
    public readonly chatConnectionStore: Readable<ChatConnectionInterface | undefined> = readonly(
        this._chatConnectionStore,
    );
    private chatVisibilitySubscription: Unsubscriber | undefined;
    // Opening the chat or the people list asks for the connection at once (see ChatStartCoordinator).
    private chatDemandSubscription: Unsubscriber | undefined;
    private readonly chatStart = new ChatStartCoordinator({
        enabled: () => isChatDeferredStartEnabled(),
        matrixWouldLoad: () => this.matrixChatWouldLoad(),
        hasConnection: () =>
            this.chatConnectionPromise !== undefined || this.pendingChatConnectionPromise !== undefined,
        start: () => this.startChatConnection(),
        runWhenIdle,
    });
    private chatConnectionStatusSubscription: Unsubscriber | undefined;
    // "idle": nothing asked for the connection yet (the deferred start, see ChatStart.ts). The chat buttons accept a
    // click in this state, which is the demand that starts it.
    private readonly _chatConnectionAttemptStore = writable<ChatConnectionAttemptStatus>("idle");
    /**
     * Whether opening the chat connection is under way, failed, or being retried. Until a connection object exists,
     * this is the only thing the chat panel and the action bar can show.
     */
    public readonly chatConnectionAttemptStore: Readable<ChatConnectionAttemptStatus> = readonly(
        this._chatConnectionAttemptStore,
    );

    constructor() {
        this.playerName = localUserStore.getName();
        this.characterTextureIds = localUserStore.getCharacterTextures();
        this.companionTextureId = localUserStore.getCompanionTextureId();
        this.chatVisibilitySubscription = initializeChatVisibilitySubscription();
        this.subscribeToChatDemand();
    }

    /** Opening the chat panel (the chat, the people list, the shortcut) asks for the connection at once. */
    private subscribeToChatDemand(): void {
        this.chatDemandSubscription ??= chatVisibilityStore.subscribe((isOpen) => {
            if (isOpen) this.chatStart.demand();
        });
    }

    public async init(scenePlugin: ScenePlugin): Promise<string> {
        this.scenePlugin = scenePlugin;
        // Awaits the connection App.svelte may have started already: it is requested once.
        const result = await connectionManager.startGameConnexion();
        if (result instanceof URL) {
            window.location.assign(result.toString());
            // window.location.assign is not immediate and Javascript keeps running after.
            // so we need to redirect to an empty Phaser scene, waiting for the redirection to take place
            return EmptySceneName;
        }
        if (result.nextScene === "errorScene") {
            if (result.error instanceof Error) {
                errorScreenStore.setException(result.error);
            } else {
                errorScreenStore.setErrorFromApi(result.error);
            }
            return EmptySceneName;
        }
        let nextScene = result.nextScene;
        this.startRoom = result.room;
        currentRoomStore.set(result.room);
        this._startRoomPromise.resolve(result.room);
        this.loadMap(this.startRoom);

        const preferredAudioInputDeviceId = localUserStore.getPreferredAudioInputDevice();
        const preferredVideoInputDeviceId = localUserStore.getPreferredVideoInputDevice();

        if (!this.playerName) {
            // Handle woka name based on provideDefaultWokaName setting
            const provideDefaultWokaName = this.startRoom.provideDefaultWokaName;

            if (provideDefaultWokaName === "random") {
                // Use a random fun name based on current locale
                this.playerName = generateRandomName();
                localUserStore.setName(this.playerName);
            } else if (provideDefaultWokaName === "fix" && this.startRoom.defaultWokaName) {
                // Use the fixed name as-is
                this.playerName = this.startRoom.defaultWokaName;
                localUserStore.setName(this.playerName);
            } else if (provideDefaultWokaName === "fix-plus-random-numbers" && this.startRoom.defaultWokaName) {
                // Use the fixed name with random numbers appended
                const randomNumber = Math.floor(Math.random() * 1000)
                    .toString()
                    .padStart(3, "0");
                this.playerName = `${this.startRoom.defaultWokaName}-${randomNumber}`;
                localUserStore.setName(this.playerName);
            }
        }

        // Handle woka texture based on provideDefaultWokaTexture setting
        if (!this.characterTextureIds || this.characterTextureIds.length === 0) {
            if (this.startRoom.provideDefaultWokaTexture === "random") {
                const wokaData = await this.loadWokaData();
                const randomIndexCollections = Math.floor(Math.random() * wokaData.woka.collections.length);
                const randomIndexTextures = Math.floor(
                    Math.random() * wokaData.woka.collections[randomIndexCollections].textures.length,
                );
                const defaultWokaTextureId =
                    wokaData.woka.collections[randomIndexCollections].textures[randomIndexTextures].id;
                this.characterTextureIds = [defaultWokaTextureId];
                localUserStore.setCharacterTextures(this.characterTextureIds);
                nextScene = "gameScene";
            } else if (this.startRoom.provideDefaultWokaTexture === "fix" && this.startRoom.defaultWokaTexture) {
                // Use the fixed texture from DEFAULT_WOKA_TEXTURE
                this.characterTextureIds = [this.startRoom.defaultWokaTexture];
                localUserStore.setCharacterTextures(this.characterTextureIds);
                nextScene = "gameScene";
            }
        }

        // Skip camera page if configured
        if (this.startRoom.skipCameraPage) {
            requestedMicrophoneState.disableMicrophone();
            requestedCameraState.disableWebcam();

            if (preferredAudioInputDeviceId && preferredAudioInputDeviceId !== "") {
                requestedMicrophoneDeviceIdStore.set(preferredAudioInputDeviceId);
            }
            if (preferredVideoInputDeviceId && preferredVideoInputDeviceId !== "") {
                requestedCameraDeviceIdStore.set(preferredVideoInputDeviceId);
            }
        }

        Sentry.setUser({
            id: localUserStore.getLocalUser()?.uuid ?? undefined,
            email: localUserStore.getLocalUser()?.email ?? undefined,
            username: this.playerName ?? undefined,
        });

        //If player name was not set show login scene with player name
        //If Room si not public and Auth was not set, show login scene to authenticate user (OpenID - SSO - Anonymous)
        let shouldShowPwaInstall = false;
        pwaInstallProfileMenuEligibleStore.set(shouldShowPwaInstall);

        const pwaInstallEligibilityPromise = shouldShowPwaInstallSceneAsync({
            bypassPwa: this.startRoom.bypassPwa,
        })
            .then((isEligible) => {
                pwaInstallProfileMenuEligibleStore.set(isEligible);
                return isEligible;
            })
            .catch((error) => {
                console.error("Error while checking if PWA install should be shown", error);
                Sentry.captureException(error);
                return false;
            });

        try {
            shouldShowPwaInstall = await raceTimeout(pwaInstallEligibilityPromise, 1500);
        } catch (error) {
            if (!(error instanceof TimeoutError)) {
                console.error("Error while checking if PWA install should be shown", error);
                Sentry.captureException(error);
            }
        }

        if (this.playerName && localUserStore.getAuthToken() && shouldShowPwaInstall) {
            return PwaInstallSceneName;
        } else if (!this.playerName || (this.startRoom.authenticationMandatory && !localUserStore.getAuthToken())) {
            return LoginSceneName;
        } else if (nextScene === "selectCharacterScene") {
            return SelectCharacterSceneName;
        } else if (nextScene === "selectCompanionScene") {
            return SelectCompanionSceneName;
        } else if (
            (preferredVideoInputDeviceId === undefined || preferredAudioInputDeviceId === undefined) &&
            !this.startRoom.skipCameraPage
        ) {
            return EnableCameraSceneName;
        } else {
            if (preferredVideoInputDeviceId !== "") {
                requestedCameraDeviceIdStore.set(preferredVideoInputDeviceId);
            }

            if (preferredAudioInputDeviceId !== "") {
                requestedMicrophoneDeviceIdStore.set(preferredAudioInputDeviceId);
            }
            this.activeMenuSceneAndHelpCameraSettings();
            //TODO fix to return href with # saved in localstorage
            return this.startRoom.key;
        }
    }

    /**
     * Leave the Web App install scene (Phaser + Svelte) and enter the map or restore the game scene after the menu flow.
     */
    public completePwaInstall(): void {
        pwaInstallSceneVisibleStore.set(false);
        if (this.scenePlugin.isActive(PwaInstallSceneName)) {
            this.scenePlugin.stop(PwaInstallSceneName);
        }
        this.goToStartingMap();
    }

    public setPlayerName(name: string): void {
        this.playerName = name;
        localUserStore.notifyPlayerDisplayNameChanged(name);
        Sentry.setUser({
            id: localUserStore.getLocalUser()?.uuid ?? undefined,
            email: localUserStore.getLocalUser()?.email ?? undefined,
            username: name,
        });
    }

    public setVisitCardUrl(visitCardUrl: string): void {
        this.visitCardUrl = visitCardUrl;
    }

    public setCharacterTextureIds(textureIds: string[]): void {
        this.characterTextureIds = textureIds;
        // Only save the textures if the user is not logged in
        // If the user is logged in, the textures will be fetched from the server. No need to save them locally.
        if (!localUserStore.isLogged() || !hasCapability("api/save-textures")) {
            localUserStore.setCharacterTextures(textureIds);
        }
    }

    getPlayerName(): string | null {
        return this.playerName;
    }

    get myVisitCardUrl(): string | null {
        return this.visitCardUrl;
    }

    getCharacterTextureIds(): string[] | null {
        return this.characterTextureIds;
    }

    setCompanionTextureId(textureId: string | null): void {
        this.companionTextureId = textureId;
    }

    getCompanionTextureId(): string | null {
        return this.companionTextureId;
    }

    public loadMap(room: Room) {
        const roomID = room.key;

        const gameIndex = this.scenePlugin.getIndex(roomID);
        if (gameIndex === -1) {
            const game: Phaser.Scene = new GameScene(room);
            this.scenePlugin.add(roomID, game, false);
        }
    }

    public goToStartingMap(): void {
        console.info("starting " + (this.currentGameSceneName || this.currentStartedRoom.key));
        this.scenePlugin.start(this.currentGameSceneName || this.currentStartedRoom.key);
        this.activeMenuSceneAndHelpCameraSettings();
    }

    /**
     * @private
     * @return void
     */
    private activeMenuSceneAndHelpCameraSettings(): void {
        if (!get(myCameraStore)) {
            return;
        }

        if (
            !localUserStore.getHelpCameraSettingsShown() &&
            (!get(requestedMicrophoneState) || !get(requestedCameraState))
        ) {
            showHelpCameraSettings();
            localUserStore.setHelpCameraSettingsShown();
        }
    }

    public gameSceneIsCreated(scene: GameScene) {
        this.currentGameSceneName = scene.scene.key;
        menuIconVisiblilityStore.set(true);
    }

    /**
     * Temporary leave a gameScene to go back to the loginScene for example.
     * This will close the socket connections and stop the gameScene, but won't remove it.
     */
    leaveGame(targetSceneName: string, sceneClass: Phaser.Scene): void {
        this.closeGameScene();
        if (!this.scenePlugin.get(targetSceneName)) {
            this.scenePlugin.add(targetSceneName, sceneClass, false);
        }
        this.scenePlugin.run(targetSceneName);
    }

    closeGameScene(): void {
        gameSceneIsLoadedStore.set(false);
        const gameScene = this.scenePlugin.get(this.currentGameSceneName ?? "default");

        if (!(gameScene instanceof GameScene)) {
            throw new Error("Not the Game Scene");
        }

        gameScene.cleanupClosingScene();
        gameScene.createSuccessorGameScene(false, false);
        menuIconVisiblilityStore.set(false);
    }

    /**
     * follow up to leaveGame()
     */
    goToNextScene(currentSceneName: "LoginScene" | "SelectCharacterScene" | "SelectCompanionScene") {
        if (this.currentGameSceneName) {
            // If there is a current game scene (it means we left this game scene to configure settings or so), then we restart it
            this.scenePlugin.start(this.currentGameSceneName);
            menuIconVisiblilityStore.set(true);
        } else {
            // If we are currently in the LoginScene and if we don't have a character selected, we go to SelectCharacterScene
            if (
                currentSceneName === LoginSceneName &&
                (!this.characterTextureIds || this.characterTextureIds.length === 0)
            ) {
                this.scenePlugin.run(SelectCharacterSceneName);
                return;
            }
            if (
                (currentSceneName === SelectCompanionSceneName ||
                    currentSceneName === LoginSceneName ||
                    currentSceneName === SelectCharacterSceneName) &&
                !this.currentStartedRoom.skipCameraPage
            ) {
                this.scenePlugin.run(EnableCameraSceneName);
                return;
            }
            this.scenePlugin.run(this.currentStartedRoom.key);
        }
    }

    /**
     * Tries to stop the current scene.
     * @param fallbackSceneName
     */
    tryToStopScene(fallbackSceneName: string) {
        this.scenePlugin.stop(fallbackSceneName);
    }

    public getCurrentGameScene(): GameScene {
        const gameScene = this.scenePlugin.get(
            this.currentGameSceneName == undefined ? "default" : this.currentGameSceneName,
        );
        if (!(gameScene instanceof GameScene)) {
            throw new GameSceneNotFoundError("Not the Game Scene");
        }
        return gameScene;
    }

    public get currentStartedRoom(): Room {
        if (this.startRoom === undefined) {
            throw new Error("startRoom not yet initialized");
        }
        return this.startRoom;
    }

    /** Returns the current room, or undefined if no room has been started yet. */
    public get currentStartedRoomOrNull(): Room | undefined {
        return this.startRoom;
    }

    public get currentStartedRoomPromise(): Promise<Room> {
        return this._startRoomPromise.promise;
    }

    public setMatrixServerUrl(matrixServerUrl: string | undefined) {
        this.matrixServerUrl = matrixServerUrl;
    }

    public getMatrixServerUrl(): string | undefined {
        return this.matrixServerUrl;
    }

    /**
     * Whether the room the player is currently in allows the chat.
     *
     * `gameSceneStore` holds the running scene only once it finished loading. During the very first load the
     * scene is still starting up - it is the one asking for the chat connection - so we fall back on the
     * start room, which is precisely the room that scene is loading.
     */
    private async isChatEnabledOnCurrentRoom(): Promise<boolean> {
        const room = get(gameSceneStore)?.room ?? (await this.currentStartedRoomPromise);
        return room.isChatEnabled;
    }

    /**
     * A Matrix session belongs to the user, not to the caller, so at most one may ever be opened: two
     * clients in the same tab would fight over the same IndexedDB databases, which matrix-js-sdk warns
     * leads to data corruption and decryption failures.
     *
     * Several callers ask for the connection while a scene starts up - the loading sequence and the world
     * space join, at least - and deciding whether to open one has to await the room. The in-flight promise
     * is therefore memoised synchronously: were the memoisation to happen only after that await, every
     * caller arriving in the meantime would start a client of its own.
     *
     * A void connection is deliberately not memoised, so that a room where the chat is disabled does not
     * settle the question for the rest of the session.
     */
    public getChatConnection(): Promise<ChatConnectionInterface> {
        // Whoever asks, the idle start is no longer needed and the scene may build what waits for the connection.
        this.chatStart.noteStarted();
        const alreadyRequested = this.chatConnectionPromise ?? this.pendingChatConnectionPromise;
        if (alreadyRequested) {
            return alreadyRequested;
        }

        // A void connection is opened again on every call: once there is one, that is not a new attempt to show.
        const previousAttempt = get(this._chatConnectionAttemptStore);
        if (previousAttempt !== "ready") {
            this._chatConnectionAttemptStore.set(previousAttempt === "failed" ? "retrying" : "connecting");
        }
        this.pendingChatConnectionPromise = this.openChatConnection()
            .then(
                (chatConnection) => {
                    // The void stand-in keeps the proximity chat working, but the Matrix chat is missing: the panel
                    // says so and offers Retry, which downloads the code again (a void connection is not memoised).
                    if (this.matrixChatLoadFailed) {
                        this._chatConnectionAttemptStore.set("failed");
                        chatConnectionFailureStore.recordFailure();
                        return chatConnection;
                    }
                    this._chatConnectionAttemptStore.set("ready");
                    // A Matrix connection reports its recovery when it syncs (see openChatConnection()); a void one
                    // has nothing left to wait for.
                    if (!get(isMatrixChatEnabledStore)) {
                        chatConnectionFailureStore.recordRecovery();
                    }
                    return chatConnection;
                },
                (error: unknown) => {
                    // Each caller logs and reports the rejection; this only makes it visible in the chat panel.
                    this._chatConnectionAttemptStore.set("failed");
                    chatConnectionFailureStore.recordFailure();
                    throw error;
                },
            )
            .finally(() => {
                this.pendingChatConnectionPromise = undefined;
            });

        return this.pendingChatConnectionPromise;
    }

    /**
     * The scene is playable: opens the chat connection when the browser is idle (at once when it would download
     * nothing: no Matrix server, a visitor, or a room with the chat off). Does nothing once a connection is open or
     * opening. The scene calls this after its first playable frame, never while it is being created.
     */
    public startChatConnectionWhenIdle(): void {
        // A logout removed the subscription: the next scene puts it back.
        this.subscribeToChatDemand();
        this.chatStart.schedule();
    }

    /**
     * A GameScene begins (its create()): what it builds on the connection waits for the start of this scene, not for
     * one that happened in the scene before it.
     */
    public beginChatStartWait(): void {
        this.chatStart.beginScene();
    }

    /**
     * Something needs the chat soon (the player stepped into a chat room area): starts the connection now instead of
     * when the browser is idle. Does nothing for a room or a visitor that has no Matrix chat, and once it is started.
     */
    public requestChatConnection(): void {
        this.chatStart.demand();
    }

    /**
     * Like getChatConnection(), for the code that builds on the connection while the scene starts: it waits until the
     * connection is asked for (idle start, or somebody opening the chat) and never starts it itself.
     */
    public async awaitChatConnection(): Promise<ChatConnectionInterface> {
        await this.chatStart.whenStartRequested();
        return this.chatConnectionPromise ?? this.pendingChatConnectionPromise ?? this.getChatConnection();
    }

    private startChatConnection(): void {
        this.getChatConnection().catch((e: unknown) => {
            const error = asError(e);
            console.error("Opening the chat connection failed", error);
            Sentry.captureException(error);
        });
    }

    /** Whether opening the chat now downloads Matrix: what the void connection never does. */
    private matrixChatWouldLoad(): boolean {
        const room = get(gameSceneStore)?.room ?? this.startRoom;
        return (
            Boolean(this.getMatrixServerUrl() ?? MATRIX_PUBLIC_URI) &&
            get(userIsConnected) &&
            room?.isChatEnabled !== false
        );
    }

    /** Runs the same connection path again, for the Retry button of the chat panel. */
    public retryChatConnection(): void {
        this.getChatConnection().catch((e: unknown) => {
            const error = asError(e);
            console.error("Retrying the chat connection failed", error);
            Sentry.captureException(error);
        });
    }

    /**
     * Spends the Matrix login token this page landed with, as soon as the homeserver is known (right after /me).
     *
     * The token lives two minutes, and the chat only opens once the game scene starts, after the Woka and camera
     * screens - or never, on a room where the chat is disabled. openChatConnection() waits for this, so the two never
     * race on a single-use token. Exchanging only creates a device: nothing here may ever call /logout.
     */
    public exchangeMatrixLoginToken(loginToken: string): void {
        const matrixServerUrl = this.getMatrixServerUrl() ?? MATRIX_PUBLIC_URI;
        if (!matrixServerUrl) {
            return;
        }
        // A login token means a logged-in user, whose chat loads Matrix anyway: this only starts the download sooner.
        this.matrixLoginTokenExchange = import("../../Chat/Connection/Matrix/MatrixClientWrapper")
            .then(({ MatrixClientWrapper }) =>
                new MatrixClientWrapper(matrixServerUrl, localUserStore).exchangeLoginToken(loginToken),
            )
            .catch((e: unknown) => {
                // The token is gone either way. initMatrixClient() then uses the session this browser already
                // holds, if this user opened it (exchangeLoginToken() drops another user's), or fails with
                // MissingMatrixCredentialsError, which shows the "reconnect" prompt.
                console.error("Unable to exchange the Matrix login token", e);
                Sentry.captureException(e);
            });
    }

    private async openChatConnection(): Promise<ChatConnectionInterface> {
        const matrixServerUrl = this.getMatrixServerUrl() ?? MATRIX_PUBLIC_URI;
        this.matrixChatLoadFailed = false;

        // The chat setting is checked *before* the client is built, on purpose. Opening a Matrix session on a
        // room where the chat is disabled used to mean a full connection and initial sync, immediately
        // followed by destroy() - which is a real /logout. The homeserver then revoked the access token that
        // is still stored locally, so every later room with the chat enabled restored that dead token and got
        // nothing but M_UNKNOWN_TOKEN. Not opening the session at all leaves nothing to tear down.
        if (!matrixServerUrl || !get(userIsConnected) || !(await this.isChatEnabledOnCurrentRoom())) {
            return this.useVoidChatConnection();
        }

        // matrix-js-sdk is a large chunk: only the users who actually get a Matrix chat download it. Anonymous
        // users never do, so it stays out of the bundle everybody loads on startup.
        let matrixModules;
        try {
            matrixModules = await Promise.all([
                import("../../Chat/Connection/Matrix/MatrixClientWrapper"),
                import("../../Chat/Connection/Matrix/MatrixChatConnection"),
            ]);
        } catch (e) {
            // A network error, or a chunk removed by a newer deployment. The world works without the chat, and
            // a void connection is not memoised, so the next call tries again. getChatConnection() marks the
            // attempt failed, so the chat panel shows it.
            console.error("Could not load the Matrix chat", e);
            Sentry.captureException(e);
            this.matrixChatLoadFailed = true;
            return this.useVoidChatConnection();
        }
        const [{ MatrixClientWrapper, MissingMatrixCredentialsError }, { MatrixChatConnection }] = matrixModules;

        const matrixClientWrapper = new MatrixClientWrapper(matrixServerUrl, localUserStore);
        const matrixClientPromise = Promise.resolve(this.matrixLoginTokenExchange).then(() =>
            matrixClientWrapper.initMatrixClient(),
        );

        matrixClientPromise.catch((e) => {
            // Only a new OpenID login can mint the Matrix login token this browser is missing, so show the
            // "reconnect" prompt instead of a bare error banner.
            if (e instanceof MissingMatrixCredentialsError) {
                loginTokenErrorStore.set(true);
            }
        });

        const matrixChatConnection = new MatrixChatConnection(matrixClientPromise, availabilityStatusStore);
        this._chatConnectionStore.set(matrixChatConnection);

        this.chatConnectionPromise = matrixChatConnection.init().then(() => matrixChatConnection);
        isMatrixChatEnabledStore.set(true);
        this.chatConnectionStatusSubscription?.();
        this.chatConnectionStatusSubscription = matrixChatConnection.connectionStatus.subscribe((status) => {
            if (status === "ON_ERROR") {
                chatConnectionFailureStore.recordFailure();
            } else if (status === "ONLINE") {
                chatConnectionFailureStore.recordRecovery();
            }
        });

        return this.chatConnectionPromise;
    }

    private useVoidChatConnection(): ChatConnectionInterface {
        // No matrix connection? Let's fill the gap with a "void" object
        const voidChatConnection = new VoidChatConnection();
        this._chatConnectionStore.set(voidChatConnection);
        isMatrixChatEnabledStore.set(false);
        return voidChatConnection;
    }

    /**
     * Throws until the connection exists, which the map does not wait for: code that can run as soon as the map
     * shows uses getChatConnection() or chatConnectionStore instead.
     */
    get chatConnection(): ChatConnectionInterface {
        const chatConnection = get(this._chatConnectionStore);
        if (!chatConnection) {
            throw new Error("_chatConnection not yet initialized");
        }
        return chatConnection;
    }

    /**
     * Performs all cleanup actions specific to someone logging out.
     * Currently, this logs out from the Matrix client.
     */
    public async logout(): Promise<void> {
        // The chat connection may not exist yet (the deferred start): the cleanup below still has to run, and nothing
        // may open it afterwards.
        this.chatStart.reset();
        const chatConnection = get(this._chatConnectionStore);

        try {
            chatConnection?.clearListener();
            await chatConnection?.destroy();
        } catch (e) {
            // destroy() ends up calling POST /logout, which fails with a 401 when the Matrix session is
            // already dead - exactly when the local cleanup below matters most. It must therefore run in
            // every case: leaving the Matrix user id behind makes MatrixClientWrapper skip its
            // clearStores() branch on the next login, restoring the broken session (stale sync token and
            // crypto store) instead of starting over.
            console.error("Chat connection not closed properly : ", e);
            Sentry.captureException(e);
        } finally {
            if (this.chatVisibilitySubscription) {
                this.chatVisibilitySubscription();
            }
            this.chatDemandSubscription?.();
            this.chatDemandSubscription = undefined;
            this.chatConnectionStatusSubscription?.();
            this.chatConnectionStatusSubscription = undefined;
            chatConnectionFailureStore.dismiss();
            this._chatConnectionAttemptStore.set("idle");
            this.clearChatDataFromLocalStorage();
            this._chatConnectionStore.set(undefined);
            this.chatConnectionPromise = undefined;
            this.pendingChatConnectionPromise = undefined;
        }
    }

    private clearChatDataFromLocalStorage(): void {
        localUserStore.clearMatrixSession();
    }

    public async loadWokaData(): Promise<WokaData> {
        const roomUrl = gameManager.currentStartedRoom.href;
        const response = await fetch(`${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}`, {
            headers: {
                Authorization: localUserStore.getAuthToken() || "",
            },
            credentials: "include",
        });

        if (!response.ok) {
            throw new Error("Failed to load Woka data");
        }

        const data = await response.json();
        return data;
    }
}

export const gameManager = new GameManager();

export class GameSceneNotFoundError extends Error {
    constructor(message: string) {
        super(message);
    }
}
