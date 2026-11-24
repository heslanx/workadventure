/**
 * What "the page is leaving" means, in one place.
 *
 * beforeunload does not mean that the page goes away: the navigation can still be cancelled (the desktop app cancels it
 * for every link it opens in the system browser) and a download link fires it in any browser. pagehide fires only when
 * the page is really left, so whatever lets go of something for good (the game socket, the reconnection of the
 * connection manager) listens to pagehide, never to beforeunload.
 *
 * pagehide also fires when the page enters the back/forward cache. Whatever it let go of is then gone, so the page
 * must not be shown again as it is: see reloadWhenRestoredFromCache.
 *
 * Every function takes the window as an argument, so that a test needs no global.
 */

/** How long a beforeunload keeps the page "leaving" when no pagehide follows it. */
export const LEAVE_HINT_DURATION_MS = 2_000;

type PageEventWindow = Pick<Window, "addEventListener" | "removeEventListener">;

type PageLeavingWindow = PageEventWindow & Pick<Window, "setTimeout" | "clearTimeout">;

export interface PageLeaving {
    /** True while the page is leaving: for good after pagehide, and for a short time after beforeunload. */
    readonly isLeaving: boolean;
    /** Removes the listeners and the pending timer. */
    stop(): void;
}

/**
 * Calls the callback when the page is really left (pagehide). Returns the function that removes the listener.
 */
export function onPageLeave(win: PageEventWindow, callback: () => void): () => void {
    win.addEventListener("pagehide", callback);
    return () => win.removeEventListener("pagehide", callback);
}

/**
 * Calls the callback when the browser shows the page again from the back/forward cache (pageshow with persisted).
 * The first display of the page is a pageshow too, but not a restored one. Returns the function that removes the
 * listener.
 */
export function onPageRestoredFromCache(win: PageEventWindow, callback: () => void): () => void {
    const onPageShow = (event: PageTransitionEvent) => {
        if (event.persisted) callback();
    };
    win.addEventListener("pageshow", onPageShow);
    return () => win.removeEventListener("pageshow", onPageShow);
}

/**
 * Reloads the page when it comes back from the back/forward cache. Its connections were closed when it left and the
 * connection manager never reconnects a page that left, so the restored page would show a world that is dead: a clean
 * new connection is the only restore, since the scene, the chat client and the video rooms are all stale as well.
 * Returns the function that removes the listener.
 */
export function reloadWhenRestoredFromCache(win: PageEventWindow & { location: Pick<Location, "reload"> }): () => void {
    return onPageRestoredFromCache(win, () => win.location.reload());
}

/**
 * Tells whether the page is leaving, early enough for what cannot wait for pagehide.
 *
 * A page can be hidden before its pagehide fires, and what the browser does when it hides the page (opening the
 * picture-in-picture window) must not happen when the tab is closing. beforeunload comes before both, so it is taken
 * as a hint that the page is leaving, but only for LEAVE_HINT_DURATION_MS: a page that really leaves is gone in a few
 * milliseconds, so a page still there after that had its navigation cancelled, or was only asked to download a file.
 * pagehide is final.
 */
export function watchPageLeaving(win: PageLeavingWindow, hintDurationMs = LEAVE_HINT_DURATION_MS): PageLeaving {
    let leftForGood = false;
    let hintTimeout: number | undefined;

    const clearHint = () => {
        if (hintTimeout === undefined) return;
        win.clearTimeout(hintTimeout);
        hintTimeout = undefined;
    };

    const onBeforeUnload = () => {
        if (leftForGood) return;
        // A second beforeunload (the first navigation was cancelled and another one started) restarts the hint.
        clearHint();
        hintTimeout = win.setTimeout(() => {
            hintTimeout = undefined;
        }, hintDurationMs);
    };

    win.addEventListener("beforeunload", onBeforeUnload);
    const stopListeningToPageLeave = onPageLeave(win, () => {
        leftForGood = true;
        clearHint();
    });

    return {
        get isLeaving() {
            return leftForGood || hintTimeout !== undefined;
        },
        stop() {
            win.removeEventListener("beforeunload", onBeforeUnload);
            stopListeningToPageLeave();
            clearHint();
        },
    };
}
