// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    CHAT_DEFERRED_START_ENABLED,
    CHAT_IDLE_TIMEOUT_MS,
    CHAT_TIMER_FALLBACK_MS,
    ChatStartCoordinator,
    isChatDeferredStartEnabled,
    resetChatDeferredStartStorageWarningForTests,
    runWhenIdle,
    type IdleEnvironment,
} from "../../../../src/front/Chat/Connection/ChatStart";

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe("the deferred chat start flag", () => {
    it('is off only when the storage of the browser says "0"', () => {
        expect(isChatDeferredStartEnabled()).toBe(CHAT_DEFERRED_START_ENABLED);
        localStorage.setItem("chatDeferredStart", "0");
        expect(isChatDeferredStartEnabled()).toBe(false);
        localStorage.setItem("chatDeferredStart", "1");
        expect(isChatDeferredStartEnabled()).toBe(true);
    });

    // Owner decision of 2026-11-22. Holding it back is a change of the constant and of this test.
    it("ships on", () => {
        expect(CHAT_DEFERRED_START_ENABLED).toBe(true);
    });

    it.each(["true", "", "off"])("leaves the default for the value %j", (value) => {
        localStorage.setItem("chatDeferredStart", value);

        expect(isChatDeferredStartEnabled()).toBe(CHAT_DEFERRED_START_ENABLED);
    });

    it("keeps the default, without throwing, when the storage cannot be read, and says so once", () => {
        resetChatDeferredStartStorageWarningForTests();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const blocked = {
            getItem: () => {
                throw new Error("blocked");
            },
        };

        const reads = [isChatDeferredStartEnabled(blocked), isChatDeferredStartEnabled(blocked)];

        expect(reads).toEqual([CHAT_DEFERRED_START_ENABLED, CHAT_DEFERRED_START_ENABLED]);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

function fakeEnvironment(withIdleCallback: boolean) {
    const idle: { callback: () => void; timeout: number; cancelled: boolean }[] = [];
    const timers: { callback: () => void; delayMs: number; cleared: boolean }[] = [];
    const env: IdleEnvironment = {
        requestIdleCallback: withIdleCallback
            ? (callback, options) => {
                  idle.push({ callback, timeout: options.timeout, cancelled: false });
                  return idle.length - 1;
              }
            : undefined,
        cancelIdleCallback: (handle) => {
            idle[handle].cancelled = true;
        },
        setTimeout: (callback, delayMs) => {
            timers.push({ callback, delayMs, cleared: false });
            return timers.length - 1;
        },
        clearTimeout: (handle) => {
            timers[handle].cleared = true;
        },
    };
    return { env, idle, timers };
}

describe("runWhenIdle", () => {
    it("waits for an idle period, with a timeout so that a busy game loop still starts it", () => {
        const { env, idle, timers } = fakeEnvironment(true);
        const callback = vi.fn();

        runWhenIdle(callback, env);

        expect(callback).not.toHaveBeenCalled();
        expect(idle).toHaveLength(1);
        expect(idle[0].timeout).toBe(CHAT_IDLE_TIMEOUT_MS);
        expect(timers).toHaveLength(0);

        idle[0].callback();
        idle[0].callback();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it("falls back on a plain timer of at least one second where requestIdleCallback is missing", () => {
        const { env, timers } = fakeEnvironment(false);
        const callback = vi.fn();

        runWhenIdle(callback, env);

        expect(timers).toHaveLength(1);
        expect(timers[0].delayMs).toBeGreaterThanOrEqual(1000);
        expect(timers[0].delayMs).toBe(CHAT_TIMER_FALLBACK_MS);
        expect(callback).not.toHaveBeenCalled();
        timers[0].callback();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it("never runs once cancelled, whichever way it was armed", () => {
        for (const withIdleCallback of [true, false]) {
            const { env, idle, timers } = fakeEnvironment(withIdleCallback);
            const callback = vi.fn();

            const cancel = runWhenIdle(callback, env);
            cancel();
            // A browser that fires the callback it was told to forget.
            [...idle, ...timers].forEach((entry) => entry.callback());

            expect(callback).not.toHaveBeenCalled();
        }
    });
});

function coordinator(
    state: { enabled?: boolean; matrixWouldLoad?: boolean; hasConnection?: boolean } = {},
    environment = fakeEnvironment(true),
) {
    const flags = { enabled: true, matrixWouldLoad: true, hasConnection: false, ...state };
    const start = vi.fn();
    const subject = new ChatStartCoordinator({
        enabled: () => flags.enabled,
        matrixWouldLoad: () => flags.matrixWouldLoad,
        hasConnection: () => flags.hasConnection,
        start,
        runWhenIdle: (callback) => runWhenIdle(callback, environment.env),
    });
    return { subject, start, flags, environment };
}

describe("the chat start", () => {
    it("does not open a Matrix connection when the scene asks to schedule it, only when the browser is idle", () => {
        const { subject, start, environment } = coordinator();

        subject.schedule();

        expect(start).not.toHaveBeenCalled();
        expect(environment.idle).toHaveLength(1);

        environment.idle[0].callback();

        expect(start).toHaveBeenCalledTimes(1);
    });

    it("opens a connection that downloads nothing at once: a visitor, a room with the chat off, no Matrix server", () => {
        const { subject, start, environment } = coordinator({ matrixWouldLoad: false });

        subject.schedule();

        expect(start).toHaveBeenCalledTimes(1);
        expect(environment.idle).toHaveLength(0);
    });

    it("schedules once, however many scenes ask while the start is waiting", () => {
        const { subject, environment } = coordinator();

        subject.schedule();
        subject.schedule();

        expect(environment.idle).toHaveLength(1);
    });

    it("schedules nothing when a connection is open or opening", () => {
        const { subject, start, environment } = coordinator({ hasConnection: true });

        subject.schedule();

        expect(start).not.toHaveBeenCalled();
        expect(environment.idle).toHaveLength(0);
    });

    it("starts at once when the chat is opened first, and the idle start that was waiting never fires again", () => {
        const { subject, start, environment } = coordinator();
        subject.schedule();

        subject.demand();
        // The start reports back, as GameManager.getChatConnection() does for every caller.
        subject.noteStarted();
        environment.idle[0].callback();

        expect(start).toHaveBeenCalledTimes(1);
    });

    it("starts nothing on demand where Matrix would not load, or when a connection exists", () => {
        const noMatrix = coordinator({ matrixWouldLoad: false });
        noMatrix.subject.demand();
        const connected = coordinator({ hasConnection: true });
        connected.subject.demand();

        expect(noMatrix.start).not.toHaveBeenCalled();
        expect(connected.start).not.toHaveBeenCalled();
    });

    it("starts nothing on demand when the start is not deferred: the scene already did", () => {
        const { subject, start } = coordinator({ enabled: false });

        subject.demand();

        expect(start).not.toHaveBeenCalled();
    });

    it("starts at once, as upstream did, when the flag is off", () => {
        const { subject, start, environment } = coordinator({ enabled: false });

        subject.schedule();

        expect(start).toHaveBeenCalledTimes(1);
        expect(environment.idle).toHaveLength(0);
    });

    describe("what the scene builds on the connection", () => {
        it("waits until the connection is asked for, and starts nothing itself", async () => {
            const { subject, start } = coordinator();
            const released = vi.fn();

            const waiting = subject.whenStartRequested().then(released);
            await Promise.resolve();
            expect(released).not.toHaveBeenCalled();
            expect(start).not.toHaveBeenCalled();

            subject.noteStarted();
            await waiting;

            expect(released).toHaveBeenCalledTimes(1);
        });

        it("goes on at once when the connection is open or opening, or the start is not deferred", async () => {
            await coordinator({ hasConnection: true }).subject.whenStartRequested();
            await coordinator({ enabled: false }).subject.whenStartRequested();
        });

        it("goes on at once for a caller that comes after a void connection has settled, in the same scene", async () => {
            // A room with the chat off: the void connection starts at once, settles within microtasks and is not
            // memoised, so `hasConnection()` is false again. Space.create() and the world join ask later.
            const { subject } = coordinator({ matrixWouldLoad: false, hasConnection: false });
            subject.beginScene();
            subject.schedule();
            subject.noteStarted();
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 50);
            });
            const released = vi.fn();

            subject.whenStartRequested().then(released, released);
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 10);
            });

            expect(released).toHaveBeenCalledTimes(1);
        });

        it("waits again for a scene that begins after a start that left no connection (a room with the chat off)", async () => {
            const { subject } = coordinator();
            subject.noteStarted();
            subject.beginScene();
            const released = vi.fn();

            const waiting = subject.whenStartRequested().then(released);
            await Promise.resolve();
            expect(released).not.toHaveBeenCalled();

            subject.noteStarted();
            await waiting;
            expect(released).toHaveBeenCalledTimes(1);
        });

        it("waits again after a logout, and the idle start that was waiting never fires", async () => {
            const { subject, start, environment } = coordinator();
            subject.schedule();
            subject.noteStarted();
            subject.schedule();
            subject.reset();
            const released = vi.fn();

            subject.whenStartRequested().then(released, released);
            await Promise.resolve();
            environment.idle.forEach((entry) => entry.callback());

            expect(released).not.toHaveBeenCalled();
            expect(start).toHaveBeenCalledTimes(0);
        });
    });
});
