// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type * as PageLeave from "../../../src/front/Utils/PageLeave";
import { reloadWhenRestoredFromCache } from "../../../src/front/Utils/PageLeave";

// jsdom cannot reload a page: what a restored page does is tested with the helper (PageLeave.test.ts), here the
// manager only has to ask for it.
vi.mock("../../../src/front/Utils/PageLeave", async (importOriginal) => ({
    ...(await importOriginal<typeof PageLeave>()),
    reloadWhenRestoredFromCache: vi.fn(() => () => undefined),
}));

// Loading the manager loads the connection stack: the first import is slow on a loaded machine.
const IMPORT_TIMEOUT_MS = 60_000;

// The reconnection of a connection that dropped is private to the manager.
interface ReconnectingManager {
    readonly unloading: boolean;
    reconnectingTimeout: number | null;
}

const pageHide = () => new PageTransitionEvent("pagehide", { persisted: false });

// The manager is a singleton that listens to the window for as long as the page lives, and a page leaves only once:
// the tests follow the life of one page, and the last one leaves it for good.
describe("ConnectionManager page leave", () => {
    let connectionManager: ReconnectingManager;

    beforeAll(async () => {
        const module = await import("../../../src/front/Connection/ConnectionManager");
        connectionManager = module.connectionManager as unknown as ReconnectingManager;
    }, IMPORT_TIMEOUT_MS);

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("keeps connecting when a navigation is cancelled after beforeunload", () => {
        vi.useFakeTimers();
        const reconnect = vi.fn();
        connectionManager.reconnectingTimeout = window.setTimeout(reconnect, 1_000);

        // The desktop app opening a link in the system browser, or a download link: beforeunload, then no pagehide.
        window.dispatchEvent(new Event("beforeunload"));
        vi.advanceTimersByTime(1_000);

        expect(connectionManager.unloading).toBe(false);
        expect(reconnect).toHaveBeenCalledOnce();
    });

    it("has the page reloaded when the browser restores it from the back/forward cache", () => {
        const calls = vi.mocked(reloadWhenRestoredFromCache).mock.calls;

        expect(calls).toHaveLength(1);
        // Compared by identity: a failure message would print the whole window.
        expect(calls[0][0] === window).toBe(true);
    });

    it("stops reconnecting for good when the page is hidden", () => {
        vi.useFakeTimers();
        const reconnect = vi.fn();
        connectionManager.reconnectingTimeout = window.setTimeout(reconnect, 1_000);

        window.dispatchEvent(pageHide());
        vi.advanceTimersByTime(1_000);

        expect(connectionManager.unloading).toBe(true);
        expect(reconnect).not.toHaveBeenCalled();
    });
});
