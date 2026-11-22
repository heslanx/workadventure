import { derived } from "svelte/store";
import type { Readable } from "svelte/store";

/** The id of the splash that play/index.html paints before any JavaScript has run. */
export const BOOT_SPLASH_ID = "boot-splash";
const LEAVING_CLASS = "boot-splash-leaving";
/**
 * Fired on the splash when it starts to leave. The inline script of play/index.html, which watches for a failed start
 * of the app, listens to it to stop watching.
 */
export const BOOT_SPLASH_REMOVED_EVENT = "boot-splash-removed";

export interface RemoveBootSplashOptions {
    /**
     * Let the splash fade out instead of vanishing. Use it when the screen that replaces it shows the same logo at
     * the same place and fades in itself, so that the logo never blinks. The stylesheet sets the duration: with no
     * transition (reduced motion, or no stylesheet) the splash is removed at once.
     */
    fade?: boolean;
    document?: Document;
}

/**
 * Removes the boot splash from the document, not only hides it: a hidden node would stay in the DOM for the whole
 * session. Safe to call when the splash is already gone or was never in the page (it returns false then).
 */
export function removeBootSplash({ fade = false, document: doc = document }: RemoveBootSplashOptions = {}): boolean {
    const splash = doc.getElementById(BOOT_SPLASH_ID);
    if (!splash) {
        return false;
    }
    splash.setAttribute("aria-hidden", "true");
    splash.dispatchEvent(new Event(BOOT_SPLASH_REMOVED_EVENT));

    const view = doc.defaultView;
    // A duration list reads "0.15s, 0s": the first entry is the one of the opacity transition.
    const duration = fade && view ? Number.parseFloat(view.getComputedStyle(splash).transitionDuration) : 0;
    if (!(duration > 0)) {
        splash.remove();
        return true;
    }
    if (splash.classList.contains(LEAVING_CLASS)) {
        return true;
    }
    const finish = () => {
        splash.removeEventListener("transitionend", onEnd);
        splash.removeEventListener("transitioncancel", finish);
        splash.remove();
    };
    const onEnd = (event: Event) => {
        if (event.target === splash) {
            finish();
        }
    };
    splash.addEventListener("transitionend", onEnd);
    splash.addEventListener("transitioncancel", finish);
    splash.classList.add(LEAVING_CLASS);
    return true;
}

export interface BootScreens {
    /** The loading screen: it shows the same logo as the splash, at the same place. */
    loader: Readable<boolean>;
    /** Every other screen the app can show first (entry, error, character choice...). */
    others: Readable<boolean>[];
}

/**
 * Removes the boot splash on the frame in which the app shows its first screen: the DOM that the store change
 * produces is in place before the frame is drawn, so the splash and the screen swap without a gap or an overlap.
 * No timer is involved. Returns a function that stops watching.
 */
export function removeBootSplashOnFirstScreen(
    screens: BootScreens,
    scheduleFrame: (callback: () => void) => unknown = (callback) => window.requestAnimationFrame(callback),
): () => void {
    const first = derived([screens.loader, ...screens.others], ([loader, ...others]) => {
        if (loader) {
            return "loader";
        }
        return others.some(Boolean) ? "other" : undefined;
    });

    let fired = false;
    let subscribing = true;
    const unsubscribe = first.subscribe((kind) => {
        if (fired || kind === undefined) {
            return;
        }
        fired = true;
        scheduleFrame(() => {
            removeBootSplash({ fade: kind === "loader" });
        });
        // While subscribing, `unsubscribe` does not exist yet: the check below takes over.
        if (!subscribing) {
            unsubscribe();
        }
    });
    subscribing = false;
    if (fired) {
        unsubscribe();
    }
    return unsubscribe;
}
