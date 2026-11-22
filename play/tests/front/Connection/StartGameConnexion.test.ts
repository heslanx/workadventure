// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
    vi.restoreAllMocks();
});

// The manager is a singleton that remembers the request: each test gets its own.
async function freshConnectionManager() {
    vi.resetModules();
    return (await import("../../../src/front/Connection/ConnectionManager")).connectionManager;
}

// Loading the manager loads the connection stack: the first import is slow on a loaded machine.
const IMPORT_TIMEOUT_MS = 60_000;

describe("startGameConnexion", () => {
    it(
        "resolves the room once for everyone who asks, the early starter and GameManager.init",
        async () => {
            const connectionManager = await freshConnectionManager();
            const result = new URL("https://play.test/login");
            const init = vi.spyOn(connectionManager, "initGameConnexion").mockResolvedValue(result);

            const [early, awaited] = await Promise.all([
                connectionManager.startGameConnexion(),
                connectionManager.startGameConnexion(),
            ]);
            await connectionManager.startGameConnexion();

            expect(early).toBe(result);
            expect(awaited).toBe(result);
            expect(init).toHaveBeenCalledTimes(1);
        },
        IMPORT_TIMEOUT_MS,
    );

    it(
        "does not keep a failure: the next caller resolves the room again",
        async () => {
            const connectionManager = await freshConnectionManager();
            const result = new URL("https://play.test/login");
            const init = vi
                .spyOn(connectionManager, "initGameConnexion")
                .mockRejectedValueOnce(new Error("pusher unreachable"))
                .mockResolvedValue(result);

            await expect(connectionManager.startGameConnexion()).rejects.toThrow("pusher unreachable");
            await expect(connectionManager.startGameConnexion()).resolves.toBe(result);

            expect(init).toHaveBeenCalledTimes(2);
        },
        IMPORT_TIMEOUT_MS,
    );
});

describe("prefetchMapOf", () => {
    async function connectionManagerWithPrefetchSpy() {
        vi.resetModules();
        const { connectionManager } = await import("../../../src/front/Connection/ConnectionManager");
        const { mapPrefetch } = await import("../../../src/front/Phaser/Game/MapPrefetch");
        const start = vi.spyOn(mapPrefetch, "start").mockImplementation(() => undefined);
        const prefetchMapOf = (room: unknown) =>
            (connectionManager as unknown as { prefetchMapOf: (room: unknown) => void }).prefetchMapOf(room);
        return { start, prefetchMapOf };
    }

    it(
        "starts the map downloads of a room that is open to the visitor",
        async () => {
            const { start, prefetchMapOf } = await connectionManagerWithPrefetchSpy();

            prefetchMapOf({ authenticationMandatory: false, mapUrl: "https://maps.test/m.tmj", wamUrl: undefined });

            expect(start).toHaveBeenCalledWith({ mapUrl: "https://maps.test/m.tmj", wamUrl: undefined });
        },
        IMPORT_TIMEOUT_MS,
    );

    it(
        "downloads nothing for a visitor who is about to be sent to the login page",
        async () => {
            // Mandatory authentication, no token and no default Woka name: the room redirects, the map is never read.
            const { start, prefetchMapOf } = await connectionManagerWithPrefetchSpy();

            prefetchMapOf({
                authenticationMandatory: true,
                defaultWokaName: undefined,
                wamUrl: "https://maps.test/office.wam",
            });

            expect(start).not.toHaveBeenCalled();
        },
        IMPORT_TIMEOUT_MS,
    );

    it(
        "downloads the map of a mandatory-authentication room that has a default Woka (it does not redirect)",
        async () => {
            const { start, prefetchMapOf } = await connectionManagerWithPrefetchSpy();

            prefetchMapOf({
                authenticationMandatory: true,
                defaultWokaName: "guest",
                wamUrl: "https://maps.test/office.wam",
            });

            expect(start).toHaveBeenCalledTimes(1);
        },
        IMPORT_TIMEOUT_MS,
    );
});
