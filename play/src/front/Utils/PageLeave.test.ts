// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    LEAVE_HINT_DURATION_MS,
    onPageLeave,
    onPageRestoredFromCache,
    reloadWhenRestoredFromCache,
    watchPageLeaving,
} from "./PageLeave";

// A window of its own for each test: the listeners of one test never see the events of the next.
function createWindow() {
    return Object.assign(new EventTarget(), {
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
        location: { reload: vi.fn() },
    });
}

const pageShow = (persisted: boolean) => new PageTransitionEvent("pageshow", { persisted });

describe("PageLeave", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("onPageLeave", () => {
        it("calls back on pagehide, not on beforeunload", () => {
            const win = createWindow();
            const callback = vi.fn();
            onPageLeave(win, callback);

            // A cancelled navigation, or a download: the page stays.
            win.dispatchEvent(new Event("beforeunload"));
            expect(callback).not.toHaveBeenCalled();

            win.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
            expect(callback).toHaveBeenCalledOnce();
        });

        it("stops calling back once removed", () => {
            const win = createWindow();
            const callback = vi.fn();
            const stop = onPageLeave(win, callback);

            stop();
            win.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));

            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe("onPageRestoredFromCache", () => {
        it("calls back when the page is shown again from the back/forward cache only", () => {
            const win = createWindow();
            const callback = vi.fn();
            onPageRestoredFromCache(win, callback);

            // The first display of the page.
            win.dispatchEvent(pageShow(false));
            expect(callback).not.toHaveBeenCalled();

            win.dispatchEvent(pageShow(true));
            expect(callback).toHaveBeenCalledOnce();
        });

        it("stops calling back once removed", () => {
            const win = createWindow();
            const callback = vi.fn();
            const stop = onPageRestoredFromCache(win, callback);

            stop();
            win.dispatchEvent(pageShow(true));

            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe("reloadWhenRestoredFromCache", () => {
        it("reloads the page once when it comes back from the back/forward cache, not on its first display", () => {
            const win = createWindow();
            reloadWhenRestoredFromCache(win);

            win.dispatchEvent(pageShow(false));
            expect(win.location.reload).not.toHaveBeenCalled();

            win.dispatchEvent(pageShow(true));
            expect(win.location.reload).toHaveBeenCalledOnce();
        });
    });

    describe("watchPageLeaving", () => {
        it("is not leaving until the page says so", () => {
            const win = createWindow();
            const pageLeaving = watchPageLeaving(win);

            expect(pageLeaving.isLeaving).toBe(false);

            pageLeaving.stop();
        });

        it("takes beforeunload as a hint that expires: a cancelled navigation does not leave the page leaving", () => {
            const win = createWindow();
            const pageLeaving = watchPageLeaving(win);

            win.dispatchEvent(new Event("beforeunload"));
            expect(pageLeaving.isLeaving).toBe(true);

            vi.advanceTimersByTime(LEAVE_HINT_DURATION_MS - 1);
            expect(pageLeaving.isLeaving).toBe(true);

            vi.advanceTimersByTime(1);
            expect(pageLeaving.isLeaving).toBe(false);

            pageLeaving.stop();
        });

        it("restarts the hint on a second beforeunload", () => {
            const win = createWindow();
            const pageLeaving = watchPageLeaving(win);

            win.dispatchEvent(new Event("beforeunload"));
            vi.advanceTimersByTime(LEAVE_HINT_DURATION_MS - 1);
            win.dispatchEvent(new Event("beforeunload"));
            vi.advanceTimersByTime(LEAVE_HINT_DURATION_MS - 1);

            expect(pageLeaving.isLeaving).toBe(true);

            vi.advanceTimersByTime(1);
            expect(pageLeaving.isLeaving).toBe(false);

            pageLeaving.stop();
        });

        it("is leaving for good after pagehide, with or without a beforeunload before it", () => {
            const withoutHint = createWindow();
            const left = watchPageLeaving(withoutHint);
            withoutHint.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
            vi.advanceTimersByTime(10 * LEAVE_HINT_DURATION_MS);
            expect(left.isLeaving).toBe(true);

            const withHint = createWindow();
            const leftAfterHint = watchPageLeaving(withHint);
            withHint.dispatchEvent(new Event("beforeunload"));
            withHint.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
            vi.advanceTimersByTime(10 * LEAVE_HINT_DURATION_MS);
            expect(leftAfterHint.isLeaving).toBe(true);

            left.stop();
            leftAfterHint.stop();
        });

        it("does not start a hint once the page left for good", () => {
            const win = createWindow();
            const pageLeaving = watchPageLeaving(win);

            win.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
            win.dispatchEvent(new Event("beforeunload"));

            expect(vi.getTimerCount()).toBe(0);
            expect(pageLeaving.isLeaving).toBe(true);

            pageLeaving.stop();
        });

        it("stops listening and drops the pending hint when stopped", () => {
            const win = createWindow();
            const pageLeaving = watchPageLeaving(win);

            win.dispatchEvent(new Event("beforeunload"));
            pageLeaving.stop();
            expect(vi.getTimerCount()).toBe(0);

            win.dispatchEvent(new Event("beforeunload"));
            win.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));

            expect(vi.getTimerCount()).toBe(0);
            expect(pageLeaving.isLeaving).toBe(false);
        });
    });
});
