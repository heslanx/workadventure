import axios from "axios";
import { wamFileMigration } from "@workadventure/map-editor/src/Migrations/WamFileMigration";

/**
 * Starts downloading the map (the WAM, then the TMJ it points at, or the TMJ alone for a plain map) as soon as the room
 * is known, instead of when the GameScene preloads, which is after the PWA check, the login screens and Phaser's own
 * scene start. Port of upstream pull request 6458, with two differences: it starts from the room answer inside
 * ConnectionManager (before the authentication calls), and a prefetch that failed or went stale is replaced by the
 * normal request.
 *
 * It is a mechanism that cannot hurt, which is why it is on by default: a scene that finds nothing to claim, a failed
 * prefetch or a prefetch older than `MAP_PREFETCH_MAX_AGE_MS` fetches exactly as it did before, and a prefetch is
 * claimed once, so a scene created again (portal, room change, reconnection) reads the map as it is then. The map
 * editor changes the WAM, so the WAM is never kept: a claimed or expired prefetch is gone.
 *
 * The prefetch itself never retries and never shows a toast: it is one plain request, and what it cannot deliver (a
 * network error, a CORS refusal, a 5xx, a body that is not a JSON object) the scene asks for as it always did. For the
 * WAM that is the retrying request of the scene; for the TMJ it is Phaser's loader, whose error screen and local http
 * fallback are kept. No browser run has measured the gain yet. `localStorage["mapPrefetch"] = "0"` turns it off, "1" turns it on if this constant is ever false.
 */
export const MAP_PREFETCH_ENABLED = true;
export const MAP_PREFETCH_STORAGE_KEY = "mapPrefetch";
/**
 * A prefetch older than this is not served: the player spent that long on a login or camera screen, and the map editor
 * may have changed the WAM since. The HTTP cache of the browser still answers the normal request for a file that allows it.
 */
export const MAP_PREFETCH_MAX_AGE_MS = 20_000;

let warnedBlockedStorage = false;

/** Lets a test see the blocked-storage warning again: it is said once per page load. */
export function resetMapPrefetchStorageWarningForTests(): void {
    warnedBlockedStorage = false;
}

/** Whether the map is prefetched: the constant, unless this browser's storage says "0" (off) or "1" (on). */
export function isMapPrefetchEnabled(storage: Pick<Storage, "getItem"> | undefined = globalStorage()): boolean {
    try {
        const value = storage?.getItem(MAP_PREFETCH_STORAGE_KEY);
        if (value === "1") return true;
        if (value === "0") return false;
    } catch (error) {
        if (!warnedBlockedStorage) {
            warnedBlockedStorage = true;
            console.warn("The storage is blocked, so the map prefetch flag keeps its default", error);
        }
    }
    return MAP_PREFETCH_ENABLED;
}

function globalStorage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

export interface MapPrefetchDependencies {
    /** Downloads a file once, without retrying, and returns its parsed body. */
    fetchFile: (absoluteUrl: string) => Promise<unknown>;
    /** The map URL a WAM body points at (migrated on a copy), or undefined when it has none. */
    mapUrlOfWam: (wamData: unknown, absoluteWamUrl: string) => string | undefined;
    now: () => number;
    enabled: () => boolean;
    baseUrl: () => string;
}

interface PrefetchEntry {
    url: string;
    startedAt: number;
    response: Promise<unknown>;
}

/** What the pusher answered about a room, as far as the map goes. The GameScene picks `mapUrl` before `wamUrl`. */
export interface PrefetchableRoom {
    mapUrl?: string;
    wamUrl?: string;
}

/** A map or a WAM is a JSON object. Axios hands a body it cannot parse back as a string. */
function isJsonObject(body: unknown): body is Record<string, unknown> {
    return typeof body === "object" && body !== null && !Array.isArray(body);
}

export class MapPrefetch {
    private wam: PrefetchEntry | undefined;
    private tmj: PrefetchEntry | undefined;

    constructor(private readonly dependencies: MapPrefetchDependencies) {}

    /** Starts the downloads for this room. Asking twice for the same files does not download them twice. */
    public start(room: PrefetchableRoom): void {
        if (!this.dependencies.enabled()) {
            return;
        }
        try {
            if (room.mapUrl) {
                this.prefetchTmj(this.absolute(room.mapUrl));
            } else if (room.wamUrl) {
                this.prefetchWam(this.absolute(room.wamUrl));
            }
        } catch (error) {
            // A URL that cannot be read: the scene meets the same URL and reports it.
            console.warn("The map prefetch could not start", error);
        }
    }

    /**
     * The WAM of this URL: the prefetch when it is there, fresh and a JSON object, `fetchNormally()` otherwise
     * (nothing to claim, a failed prefetch, a body that is not an object). The prefetch is handed over once.
     */
    public takeWam(absoluteUrl: string, fetchNormally: () => Promise<unknown>): Promise<unknown> {
        const entry = this.take("wam", absoluteUrl);
        if (!entry) {
            return fetchNormally();
        }
        return entry.response.then(
            (body) => (isJsonObject(body) ? body : fetchNormally()),
            () => fetchNormally(),
        );
    }

    /**
     * The TMJ of this URL when a fresh prefetch of it exists, and undefined when there is nothing to claim (the caller
     * loads it as it always did). The promise it returns never rejects: it resolves with the map, or with undefined
     * when the prefetch failed or its body is not a JSON object, and the caller then loads the file as it always did.
     */
    public takeTmj(absoluteUrl: string): Promise<Record<string, unknown> | undefined> | undefined {
        const entry = this.take("tmj", absoluteUrl);
        return entry?.response.then(
            (body) => (isJsonObject(body) ? body : undefined),
            () => undefined,
        );
    }

    private take(kind: "wam" | "tmj", absoluteUrl: string): PrefetchEntry | undefined {
        const entry = this[kind];
        if (entry?.url !== absoluteUrl) {
            return undefined;
        }
        this[kind] = undefined;
        if (this.dependencies.now() - entry.startedAt > MAP_PREFETCH_MAX_AGE_MS) {
            return undefined;
        }
        return entry;
    }

    private absolute(url: string): string {
        return new URL(url, this.dependencies.baseUrl()).toString();
    }

    private isFresh(entry: PrefetchEntry | undefined, url: string): boolean {
        return entry?.url === url && this.dependencies.now() - entry.startedAt <= MAP_PREFETCH_MAX_AGE_MS;
    }

    private prefetchWam(url: string): void {
        if (this.isFresh(this.wam, url)) {
            return;
        }
        const response = this.dependencies.fetchFile(url).then((wamData) => {
            // Read before anybody else has the body: the scene migrates what it gets in place, and the prefetch of the
            // TMJ only needs the URL.
            this.prefetchTmjOfWam(wamData, url);
            return wamData;
        });
        this.wam = { url, startedAt: this.dependencies.now(), response: this.unclaimedFailureIsHandled(response) };
    }

    private prefetchTmjOfWam(wamData: unknown, absoluteWamUrl: string): void {
        try {
            const mapUrl = this.dependencies.mapUrlOfWam(wamData, absoluteWamUrl);
            if (mapUrl) {
                this.prefetchTmj(mapUrl);
            }
        } catch (error) {
            // The scene migrates the same body and reports it when the WAM is invalid.
            console.warn("The map prefetch could not read the map URL of the WAM", error);
        }
    }

    private prefetchTmj(url: string): void {
        if (this.isFresh(this.tmj, url)) {
            return;
        }
        this.tmj = {
            url,
            startedAt: this.dependencies.now(),
            response: this.unclaimedFailureIsHandled(this.dependencies.fetchFile(url)),
        };
    }

    /**
     * A prefetch nobody claims (a redirect landed first, the player left) must not end as an unhandled rejection. The
     * claimer attaches its own handling to the same promise and falls back on the normal request.
     */
    private unclaimedFailureIsHandled(response: Promise<unknown>): Promise<unknown> {
        response.catch((error: unknown) => {
            console.info("The map prefetch failed, the scene will fetch the file itself", error);
        });
        return response;
    }
}

/** The prefetch the app uses: a plain axios request, so a failure comes back to the scene instead of retrying here. */
export const mapPrefetch = new MapPrefetch({
    fetchFile: (absoluteUrl) => axios.get<unknown>(absoluteUrl).then((response) => response.data),
    mapUrlOfWam: (wamData, absoluteWamUrl) => {
        const wamFile = wamFileMigration.migrate(structuredClone(wamData));
        return new URL(wamFile.mapUrl, absoluteWamUrl).toString();
    },
    now: () => performance.now(),
    enabled: () => isMapPrefetchEnabled(),
    baseUrl: () => window.location.href,
});
