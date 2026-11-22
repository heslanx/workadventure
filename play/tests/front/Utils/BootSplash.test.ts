// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import {
    BOOT_SPLASH_ID,
    BOOT_SPLASH_REMOVED_EVENT,
    removeBootSplash,
    removeBootSplashOnFirstScreen,
} from "../../../src/front/Utils/BootSplash";

function addSplash(): HTMLElement {
    const splash = document.createElement("div");
    splash.id = BOOT_SPLASH_ID;
    document.body.append(splash);
    return splash;
}

/** The stylesheet of index.html gives the splash a fade. jsdom computes the longhand property, not the shorthand. */
function addFadeStylesheet(duration: string): HTMLStyleElement {
    const style = document.createElement("style");
    style.textContent = `#${BOOT_SPLASH_ID} { transition-duration: ${duration}; }`;
    document.head.append(style);
    return style;
}

describe("removeBootSplash", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = '<div id="app"></div>';
    });

    it("takes the splash out of the document and tells that it did", () => {
        addSplash();

        expect(removeBootSplash()).toBe(true);

        expect(document.getElementById(BOOT_SPLASH_ID)).toBeNull();
        expect(document.getElementById("app")).not.toBeNull();
    });

    it("tells the inline script of index.html that the splash is leaving, so that it stops watching for errors", () => {
        const splash = addSplash();
        const left = vi.fn();
        splash.addEventListener(BOOT_SPLASH_REMOVED_EVENT, left);

        removeBootSplash();

        expect(left).toHaveBeenCalledTimes(1);
    });

    it("is safe to call twice and when the page never had a splash", () => {
        expect(removeBootSplash()).toBe(false);

        addSplash();
        expect(removeBootSplash()).toBe(true);
        expect(removeBootSplash()).toBe(false);
        expect(document.getElementById(BOOT_SPLASH_ID)).toBeNull();
    });

    it("removes the splash at once when it was asked to fade but the stylesheet has no transition", () => {
        addSplash();

        removeBootSplash({ fade: true });

        expect(document.getElementById(BOOT_SPLASH_ID)).toBeNull();
    });

    it("removes the splash at once when the stylesheet turns the transition off (reduced motion)", () => {
        addFadeStylesheet("0s");
        addSplash();

        removeBootSplash({ fade: true });

        expect(document.getElementById(BOOT_SPLASH_ID)).toBeNull();
    });

    it("fades the splash out and removes it when the fade has ended, not before", () => {
        addFadeStylesheet("150ms");
        const splash = addSplash();

        removeBootSplash({ fade: true });

        expect(splash.isConnected).toBe(true);
        expect(splash.classList.contains("boot-splash-leaving")).toBe(true);
        expect(splash.getAttribute("aria-hidden")).toBe("true");

        // An unrelated transition ending inside the splash does not end the fade.
        const child = document.createElement("span");
        splash.append(child);
        child.dispatchEvent(new Event("transitionend", { bubbles: true }));
        expect(splash.isConnected).toBe(true);

        splash.dispatchEvent(new Event("transitionend"));
        expect(splash.isConnected).toBe(false);
        // Calling again after the removal is still harmless.
        expect(removeBootSplash({ fade: true })).toBe(false);
    });

    it("lets a second call remove a splash that is still fading", () => {
        addFadeStylesheet("150ms");
        const splash = addSplash();

        removeBootSplash({ fade: true });
        removeBootSplash();

        expect(splash.isConnected).toBe(false);
    });

    it("removes the splash if its fade is cancelled", () => {
        addFadeStylesheet("150ms");
        const splash = addSplash();

        removeBootSplash({ fade: true });
        splash.dispatchEvent(new Event("transitioncancel"));

        expect(splash.isConnected).toBe(false);
    });
});

describe("removeBootSplashOnFirstScreen", () => {
    let frames: (() => void)[];
    const scheduleFrame = (callback: () => void) => {
        frames.push(callback);
    };
    const runFrames = () => {
        const pending = frames;
        frames = [];
        pending.forEach((callback) => callback());
    };

    beforeEach(() => {
        frames = [];
        document.head.innerHTML = "";
        document.body.innerHTML = '<div id="app"></div>';
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("keeps the splash while the app shows no screen", () => {
        const splash = addSplash();
        removeBootSplashOnFirstScreen({ loader: writable(false), others: [writable(false)] }, scheduleFrame);

        runFrames();

        expect(splash.isConnected).toBe(true);
    });

    it("removes the splash on the frame after the first screen is shown, not synchronously", () => {
        const splash = addSplash();
        const login = writable(false);
        removeBootSplashOnFirstScreen({ loader: writable(false), others: [login] }, scheduleFrame);

        login.set(true);
        // The DOM of the screen is built after the store change: the splash leaves with it, in the frame.
        expect(splash.isConnected).toBe(true);
        expect(frames).toHaveLength(1);

        runFrames();
        expect(splash.isConnected).toBe(false);
    });

    it("removes the splash when a screen is already shown at the time of the call", () => {
        const splash = addSplash();
        removeBootSplashOnFirstScreen({ loader: writable(true), others: [] }, scheduleFrame);

        runFrames();

        expect(splash.isConnected).toBe(false);
    });

    it("schedules a single removal, however many screens follow", () => {
        addSplash();
        const loader = writable(false);
        const login = writable(false);
        removeBootSplashOnFirstScreen({ loader, others: [login] }, scheduleFrame);

        loader.set(true);
        login.set(true);
        loader.set(false);
        loader.set(true);

        expect(frames).toHaveLength(1);
    });

    it("fades for the loading screen, which shows the same logo, and not for any other screen", () => {
        addFadeStylesheet("150ms");
        const splash = addSplash();
        removeBootSplashOnFirstScreen({ loader: writable(true), others: [] }, scheduleFrame);
        runFrames();
        expect(splash.isConnected).toBe(true);
        expect(splash.classList.contains("boot-splash-leaving")).toBe(true);
        splash.remove();

        const other = addSplash();
        removeBootSplashOnFirstScreen({ loader: writable(false), others: [writable(true)] }, scheduleFrame);
        runFrames();
        expect(other.isConnected).toBe(false);
    });

    it("does not schedule anything once it has been stopped", () => {
        addSplash();
        const login = writable(false);
        const stop = removeBootSplashOnFirstScreen({ loader: writable(false), others: [login] }, scheduleFrame);

        stop();
        login.set(true);

        expect(frames).toHaveLength(0);
    });
});
