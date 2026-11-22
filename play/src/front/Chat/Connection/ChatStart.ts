import { Deferred } from "@workadventure/shared-utils";

/**
 * The chat connection (a Matrix client, its SDK and its crypto WASM) starts once the scene is playable and the browser
 * is idle, not while the scene is being created. It starts at once when somebody asks for the chat (the panel, the
 * people list, a direct message, a notification), and it never loads Matrix for a visitor or a room that has no Matrix
 * chat: the void connection is built at once, since it downloads nothing.
 *
 * On by default (owner decision of 2026-11-22: the chat must stop loading at scene start). No browser run has measured
 * it yet. `localStorage["chatDeferredStart"] = "0"` brings back the upstream behaviour (the connection starts when the
 * scene is created), "1" turns it on if this constant is ever false. A storage that cannot be read leaves the constant
 * in charge.
 */
export const CHAT_DEFERRED_START_ENABLED = true;
export const CHAT_DEFERRED_START_STORAGE_KEY = "chatDeferredStart";

/** The longest the idle callback waits for the browser to be idle: a game loop that never rests still starts the chat. */
export const CHAT_IDLE_TIMEOUT_MS = 3000;
/** Where `requestIdleCallback` is missing (Safari), a plain timer starts the chat. Never under one second. */
export const CHAT_TIMER_FALLBACK_MS = 1500;

let warnedBlockedStorage = false;

/** Lets a test see the blocked-storage warning again: it is said once per page load. */
export function resetChatDeferredStartStorageWarningForTests(): void {
    warnedBlockedStorage = false;
}

/** Whether the chat starts when the scene is playable: the constant, unless this browser's storage says "0" or "1". */
export function isChatDeferredStartEnabled(storage: Pick<Storage, "getItem"> | undefined = globalStorage()): boolean {
    try {
        const value = storage?.getItem(CHAT_DEFERRED_START_STORAGE_KEY);
        if (value === "1") return true;
        if (value === "0") return false;
    } catch (error) {
        if (!warnedBlockedStorage) {
            warnedBlockedStorage = true;
            console.warn("The storage is blocked, so the deferred chat start flag keeps its default", error);
        }
    }
    return CHAT_DEFERRED_START_ENABLED;
}

function globalStorage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

/** The pieces of the browser the idle start uses, so a test can stand in for them. */
export interface IdleEnvironment {
    requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
    setTimeout: (callback: () => void, delayMs: number) => number;
    clearTimeout: (handle: number) => void;
}

function browserEnvironment(): IdleEnvironment {
    return {
        requestIdleCallback: typeof requestIdleCallback === "function" ? requestIdleCallback : undefined,
        cancelIdleCallback: typeof cancelIdleCallback === "function" ? cancelIdleCallback : undefined,
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: (handle) => window.clearTimeout(handle),
    };
}

/**
 * Runs `callback` once, when the browser is idle (at the latest after `CHAT_IDLE_TIMEOUT_MS`), or after
 * `CHAT_TIMER_FALLBACK_MS` where there is no `requestIdleCallback`. Returns what cancels it.
 */
export function runWhenIdle(callback: () => void, env: IdleEnvironment = browserEnvironment()): () => void {
    let done = false;
    const run = () => {
        if (done) return;
        done = true;
        callback();
    };

    if (env.requestIdleCallback) {
        const handle = env.requestIdleCallback(run, { timeout: CHAT_IDLE_TIMEOUT_MS });
        return () => {
            done = true;
            env.cancelIdleCallback?.(handle);
        };
    }

    const handle = env.setTimeout(run, CHAT_TIMER_FALLBACK_MS);
    return () => {
        done = true;
        env.clearTimeout(handle);
    };
}

export interface ChatStartDependencies {
    /** Whether the start is deferred at all (the flag). When it is not, nothing here waits. */
    enabled: () => boolean;
    /** Whether starting the chat now would download Matrix: a Matrix server, a signed-in user, a room with the chat on. */
    matrixWouldLoad: () => boolean;
    /** Whether a connection is open or opening: there is nothing left to start. */
    hasConnection: () => boolean;
    /** Opens the connection. It reports back through `noteStarted()`, like every other way of asking for it. */
    start: () => void;
    runWhenIdle: (callback: () => void) => () => void;
}

/**
 * Decides when the chat connection starts. The connection itself belongs to `GameManager`: this holds the timing.
 *
 * - `schedule()`: the scene is playable. A connection that downloads nothing starts at once; a Matrix one starts when
 *   the browser is idle.
 * - `demand()`: somebody opened the chat or the people list. A Matrix connection that is not started yet starts now.
 * - `noteStarted()`: the connection was asked for by any caller. The idle start is no longer needed, and those who
 *   waited with `whenStartRequested()` go on.
 */
export class ChatStartCoordinator {
    private cancelIdleStart: (() => void) | undefined;
    // Settled by the first start since the scene began (or since a logout), and left settled: a void connection is not
    // memoised, so `hasConnection()` is false again once it has settled, and a caller that comes later in the same
    // scene would otherwise wait for a start that already happened and nobody would ask for again.
    private startRequested = new Deferred<void>();

    constructor(private readonly dependencies: ChatStartDependencies) {}

    public schedule(): void {
        if (!this.dependencies.enabled()) {
            this.dependencies.start();
            return;
        }
        if (this.cancelIdleStart || this.dependencies.hasConnection()) {
            return;
        }
        if (!this.dependencies.matrixWouldLoad()) {
            this.dependencies.start();
            return;
        }
        this.cancelIdleStart = this.dependencies.runWhenIdle(() => {
            this.cancelIdleStart = undefined;
            this.dependencies.start();
        });
    }

    public demand(): void {
        if (!this.dependencies.enabled() || this.dependencies.hasConnection() || !this.dependencies.matrixWouldLoad()) {
            return;
        }
        this.dependencies.start();
    }

    public noteStarted(): void {
        this.cancelIdleStart?.();
        this.cancelIdleStart = undefined;
        this.startRequested.resolve();
    }

    /**
     * A new scene begins: what it builds on the connection waits for the start of its own scene again, even when the
     * scene before it left a void connection behind (a room with the chat off).
     */
    public beginScene(): void {
        this.startRequested = new Deferred<void>();
    }

    /** The user logged out: nothing may start the chat afterwards, and the next scene waits again. */
    public reset(): void {
        this.cancelIdleStart?.();
        this.cancelIdleStart = undefined;
        this.beginScene();
    }

    /**
     * Resolves when the connection is asked for by anybody, at once when it is already open or opening, when the
     * start of this scene already happened, or when the start is not deferred. It starts nothing: the scene uses it to build
     * what depends on the connection.
     */
    public whenStartRequested(): Promise<void> {
        if (!this.dependencies.enabled() || this.dependencies.hasConnection()) {
            return Promise.resolve();
        }
        return this.startRequested.promise;
    }
}
