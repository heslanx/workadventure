import * as Sentry from "@sentry/svelte";
import { asError } from "catch-unknown";
import type { Component, Snippet } from "svelte";
import { derived, writable, type Readable } from "svelte/store";
import type { MessageUserJoined } from "../Connection/ConnexionModels";
import type { RemotePlayer } from "../Phaser/Entity/RemotePlayer";
import type { GameScene } from "../Phaser/Game/GameScene";
import type { Player } from "../Phaser/Player/Player";
import type { ViewportBounds } from "../Stores/CoWebsiteLayout";

/**
 * Where an extension of the client hooks into it.
 *
 * Upstream code reads these ports and never imports an extension. With nothing registered, every port behaves
 * as if it did not exist.
 */

/**
 * The area of the page the game is drawn in, in window coordinates, when an extension draws the game in
 * something smaller than the window.
 *
 * `undefined` means the window: consumers fall back to the window size. When set, the bounds are the area left
 * for the game once the extension has laid out whatever it hosts around it (its chat panel, for one), so
 * consumers measure the game and the co-website divider from these bounds and do not take those panels off
 * again.
 */
export const gameViewportBounds = writable<ViewportBounds | undefined>(undefined);

/**
 * A component that wraps the whole app: it receives the app as `children` and decides what surrounds it.
 *
 * Every frame must give its children the full window (`100dvh` by `100dvw`), because the app below it is sized
 * relative to its parent and the page root has no height of its own.
 */
export type AppFrameComponent = Component<{ children: Snippet }>;

let appFrame: AppFrameComponent | undefined;

/**
 * Registers the frame that wraps the app. The app reads it once, when it first renders, so register before the
 * app is mounted. A later registration replaces the earlier one.
 */
export function registerAppFrame(frame: AppFrameComponent): void {
    appFrame = frame;
}

/** The registered frame, or `undefined` when the app is not framed. */
export function getAppFrame(): AppFrameComponent | undefined {
    return appFrame;
}

/** A component that takes the place of the default action bar while `active` is true. */
export interface ActionBarOverride {
    readonly component: Component;
    readonly active: Readable<boolean>;
}

const registeredActionBar = writable<ActionBarOverride | undefined>(undefined);

/** Registers the action bar override. A later registration replaces the earlier one. */
export function registerActionBar(override: ActionBarOverride): void {
    registeredActionBar.set(override);
}

/**
 * The component that replaces the default action bar right now: the registered override while its `active`
 * store is true, `undefined` otherwise, including when nothing is registered.
 *
 * It is flattened here, so a consumer subscribes to one store. A template cannot read the `active` store of a
 * registered override through `$`, because the override is a value held inside another store.
 */
export const activeActionBar: Readable<Component | undefined> = derived<
    typeof registeredActionBar,
    Component | undefined
>(
    registeredActionBar,
    (override, set) => {
        if (override === undefined) {
            set(undefined);
            return;
        }
        return override.active.subscribe((active) => set(active ? override.component : undefined));
    },
    undefined,
);

const registeredEmbeddedChatHost = writable<Readable<boolean> | undefined>(undefined);

/**
 * Declares that an extension hosts the chat sidebar inside a panel of its own while `active` is true. A later
 * call replaces the earlier one.
 */
export function setEmbeddedChatHost(active: Readable<boolean>): void {
    registeredEmbeddedChatHost.set(active);
}

/**
 * Whether an extension hosts the chat right now: `false` until one is registered and whenever its `active`
 * store is false.
 *
 * While it is true, the app mounts no chat sidebar of its own and does not take the chat width off the game
 * area again, because the host has already laid the chat out. It is flattened here for the same reason as
 * `activeActionBar`: a template cannot read through a store held inside another store.
 */
export const embeddedChatHost: Readable<boolean> = derived<typeof registeredEmbeddedChatHost, boolean>(
    registeredEmbeddedChatHost,
    (active, set) => {
        if (active === undefined) {
            set(false);
            return;
        }
        return active.subscribe(set);
    },
    false,
);

/** What the scene shows an extension on each frame. */
export interface SceneFrameContext {
    readonly scene: GameScene;
    /** The time of this frame and the time since the previous one, both in milliseconds. */
    readonly time: number;
    readonly delta: number;
    /** The address of the page, which the relative URLs of map data resolve against. */
    readonly baseUrl: string;
    /** `undefined` until the scene has created the current player. */
    readonly currentPlayer: Player | undefined;
    /** The characters of the other players, by user id. */
    readonly remoteCharacters: ReadonlyMap<number, RemotePlayer>;
    /** What the scene knows of the other players, by user id: the variables they published, for one. */
    readonly remotePlayers: ReadonlyMap<number, MessageUserJoined>;
    /** A variable of the current player, `undefined` when it is not set. */
    getPlayerVariable(key: string): unknown;
}

/** Code that follows the game scene: it is called on each frame and told when the scene shuts down. */
export interface SceneExtension {
    /** Names the extension in error reports. */
    readonly id: string;
    /** Called once per frame, after the scene has applied the changes the other players made. */
    onFrame?(context: SceneFrameContext): void;
    /** Called when the scene shuts down, before it releases its own resources. Give back what the extension drew. */
    onShutdown?(scene: GameScene): void;
}

// The least frame time between two reports of one extension failing on a frame. It mirrors the frame guard's
// FRAME_ERROR_REPORT_INTERVAL_MS in Game.ts: an extension that fails on a frame fails again on the next one.
const SCENE_EXTENSION_FAILURE_REPORT_INTERVAL_MS = 10_000;

interface FrameFailures {
    lastReportTime: number;
    sinceLastReport: number;
}

// Replaced, never changed in place, so that a loop over it is not disturbed when an extension registers or
// unregisters from inside a call.
let sceneExtensions: readonly SceneExtension[] = [];
const frameFailures = new Map<SceneExtension, FrameFailures>();

/**
 * Registers an extension of the game scene. Extensions are called in the order they were registered, and the
 * scene calls the ones registered at the start of a call. One that registers or unregisters during a frame or a
 * shutdown takes effect from the next one.
 *
 * Returns the function that unregisters it, which does nothing when called again.
 */
export function registerSceneExtension(extension: SceneExtension): () => void {
    sceneExtensions = [...sceneExtensions, extension];
    let registered = true;
    return () => {
        if (!registered) return;
        registered = false;
        const index = sceneExtensions.indexOf(extension);
        sceneExtensions = sceneExtensions.filter((_, position) => position !== index);
        if (!sceneExtensions.includes(extension)) {
            frameFailures.delete(extension);
        }
    };
}

/** The registered extensions of the game scene, in registration order. */
export function getSceneExtensions(): readonly SceneExtension[] {
    return sceneExtensions;
}

/**
 * Calls `onFrame` of every registered extension. The game scene calls it once per frame.
 *
 * An extension that throws is reported and the next one still runs, so a faulty extension cannot stop the frame.
 */
export function runSceneFrame(context: SceneFrameContext): void {
    for (const extension of sceneExtensions) {
        try {
            extension.onFrame?.(context);
        } catch (error: unknown) {
            reportFrameFailure(extension, error, context.time);
        }
    }
}

/**
 * Calls `onShutdown` of every registered extension. The game scene calls it when it shuts down.
 *
 * An extension that throws is reported and the next one still runs, so that each can give back what it drew.
 */
export function notifySceneShutdown(scene: GameScene): void {
    for (const extension of sceneExtensions) {
        try {
            extension.onShutdown?.(scene);
        } catch (error: unknown) {
            const cause = asError(error);
            console.error(`The scene extension "${extension.id}" failed on shutdown`, cause);
            Sentry.captureException(cause, { extra: { extensionId: extension.id } });
        }
    }
}

function reportFrameFailure(extension: SceneExtension, error: unknown, time: number): void {
    let failures = frameFailures.get(extension);
    if (failures === undefined) {
        failures = { lastReportTime: Number.NEGATIVE_INFINITY, sinceLastReport: 0 };
        frameFailures.set(extension, failures);
    }
    failures.sinceLastReport++;
    if (time - failures.lastReportTime < SCENE_EXTENSION_FAILURE_REPORT_INTERVAL_MS) {
        return;
    }
    const cause = asError(error);
    console.error(
        `The scene extension "${extension.id}" failed on a frame (failures since the last report: ${failures.sinceLastReport})`,
        cause,
    );
    Sentry.captureException(cause, {
        extra: { extensionId: extension.id, failuresSinceLastReport: failures.sinceLastReport },
    });
    failures.lastReportTime = time;
    failures.sinceLastReport = 0;
}
