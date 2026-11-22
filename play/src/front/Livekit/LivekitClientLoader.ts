import Debug from "debug";
import type * as LivekitClient from "livekit-client";

/**
 * The single door to the livekit-client library at run time.
 *
 * livekit-client is about 125 KB of Brotli, and a visitor only needs it once a conversation grows beyond what
 * peer-to-peer carries (the back moves a bubble to LiveKit above MAX_USERS_FOR_WEBRTC, four by default), a space is
 * recorded, or a user's encoders cannot keep up. So no module may value-import it: it is imported dynamically, here,
 * and nowhere else. Type-only imports (`import type`) are erased at build time and stay static. The test
 * livekitStaysLazy.test.ts fails when a static value import comes back.
 *
 * Code that runs before the first connection awaits {@link loadLivekitClient}. Code that only runs once a room exists
 * (everything that handles a Room, a participant or a track) reads the loaded module with {@link livekitClient}.
 */

const debug = Debug("LivekitClientLoader");

/** The livekit-client module, as the loader hands it out. A type: it costs nothing at run time. */
export type LivekitClientModule = typeof LivekitClient;

/**
 * livekit-client could not be fetched (the network dropped, the chunk is gone after a new deployment, an extension
 * blocked it). The original error is the `cause`. Not cached: asking again fetches again.
 */
export class LivekitClientLoadError extends Error {
    constructor(cause: unknown) {
        super("Could not load the video conference library", { cause });
        this.name = "LivekitClientLoadError";
    }
}

export interface LivekitClientLoader {
    /** Resolves with the module, fetching it on the first call. Rejects with a {@link LivekitClientLoadError}. */
    load(): Promise<LivekitClientModule>;
    /**
     * Starts the fetch without waiting for it. A failure here is logged, not raised: nobody waits for it, and the next
     * load() tries again.
     */
    preload(): void;
    /** The module, once loaded. Throws if it is not: a caller that reaches this point owes a load() before. */
    get(): LivekitClientModule;
    isLoaded(): boolean;
}

/** Exported for the tests, which give it an importer that fails or succeeds on demand. */
export function createLivekitClientLoader(importModule: () => Promise<LivekitClientModule>): LivekitClientLoader {
    let loaded: LivekitClientModule | undefined;
    let loading: Promise<LivekitClientModule> | undefined;

    function load(): Promise<LivekitClientModule> {
        if (loaded) {
            return Promise.resolve(loaded);
        }
        // One fetch for every caller waiting on it. Dropped when it fails, so that a retry is a new fetch rather than
        // the same rejected promise for the rest of the session.
        loading ??= importModule().then(
            (module) => {
                loaded = module;
                loading = undefined;
                return module;
            },
            (error: unknown) => {
                loading = undefined;
                throw new LivekitClientLoadError(error);
            },
        );
        return loading;
    }

    return {
        load,
        preload() {
            if (loaded || loading) {
                return;
            }
            debug("Preloading livekit-client");
            load().catch((error: unknown) => {
                console.warn("Could not preload livekit-client, it will be requested again when needed", error);
            });
        },
        get() {
            if (!loaded) {
                throw new Error("livekit-client is not loaded yet: await loadLivekitClient() first");
            }
            return loaded;
        },
        isLoaded: () => loaded !== undefined,
    };
}

const livekitClientLoader = createLivekitClientLoader(() => import("livekit-client"));

export const loadLivekitClient = (): Promise<LivekitClientModule> => livekitClientLoader.load();
export const preloadLivekitClient = (): void => livekitClientLoader.preload();
export const livekitClient = (): LivekitClientModule => livekitClientLoader.get();
export const isLivekitClientLoaded = (): boolean => livekitClientLoader.isLoaded();
