// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
vi.mock("../../src/front/Enum/EnvironmentVariable.ts", () => import("../front/mocks/frontEnvironmentVariableMock"));
vi.mock("../../src/front/Administration/AnalyticsClient", () => ({
    analyticsClient: { trackAdminEvent: vi.fn() },
}));

import type { ConnectingSocketData } from "../../src/pusher/models/Websocket/SocketData";
import { PusherRoomSocketController } from "../../src/pusher/services/PusherRoomSocketController";
import { WorkAdventureWebSocket } from "../../src/front/Connection/WorkAdventureWebSocket";

/**
 * Measures what a pusher restart costs the pusher, with the real client reconnection code (WorkAdventureWebSocket)
 * talking to the real PusherRoomSocketController through an in-memory network.
 *
 * The client side of the application is modelled by one rule, the one RoomConnection and GameScene follow: when the
 * socket gives up (onclose), the scene is rebuilt and a brand new connection is opened.
 *
 * Rerun it to read the numbers (`--reporter=default` shows the console output of a passing test). Measured with
 * the seeded generator below, 200 clients, pusher down 3 s, on the code before and after the change:
 *
 *                                      before          after
 *   authenticated upgrades per client  2.00            1.00
 *   handshakes per client              2.00            2.00 (the refused one is not authenticated)
 *   page rebuilds, peak per 100 ms     18              13
 *   page rebuilds, p50 / p95 / max     5178/6236/6787  6152/7673/8328 ms after the crash
 *
 * A lone client (pusher back at once): back in 0.5 to 1.0 s before, in 0.5 to 3.0 s after.
 */

type ServerHandlers = {
    upgrade: (res: unknown, req: unknown, context: unknown) => void;
    open: (ws: unknown) => void;
};

const PROTOCOL = "jwt-token";

/** A browser WebSocket whose handshake is answered by the in-memory pusher, if there is one. */
class BrowserSocket extends EventTarget {
    public readyState: number = WebSocket.CONNECTING;
    public binaryType = "blob";
    public send = vi.fn();

    constructor(
        public readonly url: string,
        public readonly protocols: string[] | undefined,
        network: Network,
    ) {
        super();
        network.handshake(this);
    }

    public close(): void {
        this.readyState = WebSocket.CLOSED;
    }

    public opened(): void {
        if (this.readyState !== WebSocket.CONNECTING) {
            return;
        }
        this.readyState = WebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
    }

    public closedBy(code: number, reason: string): void {
        if (this.readyState === WebSocket.CLOSED) {
            return;
        }
        this.readyState = WebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: code !== 1006 }));
    }
}

/** The uWebSockets side of one transport, reduced to what PusherRoomSocketController uses. */
class ServerSocket {
    public readonly send = vi.fn().mockReturnValue(1);
    public readonly ping = vi.fn();
    public readonly getBufferedAmount = vi.fn().mockReturnValue(0);

    constructor(
        private readonly data: unknown,
        private readonly browser: BrowserSocket,
    ) {}

    public getUserData(): unknown {
        return this.data;
    }

    public end(code: number, reason: string): void {
        // The browser sees the transport open before it sees the pusher close it.
        setTimeout(() => this.browser.closedBy(code, reason), 0);
    }
}

/** A pusher process: a controller with nothing retained, counting how many upgrades reached authentication. */
class SimulatedPusher {
    public authenticatedUpgrades = 0;
    public handshakes = 0;
    private handlers!: ServerHandlers;
    private readonly transports = new Set<BrowserSocket>();

    constructor() {
        const app = {
            ws: (_path: string, handlers: unknown) => {
                this.handlers = handlers as ServerHandlers;
            },
        };
        const controller = new PusherRoomSocketController(app as never);
        controller.ws("/ws/room", {
            queryValidator: z.object({
                roomId: z.string(),
                tabId: z.string(),
                connectionId: z.string().optional(),
            }),
            upgrade: ({ query, request, upgrade }) => {
                // Standing for the JWT check, the admin lookup and the rest of the authentication.
                this.authenticatedUpgrades += 1;
                upgrade({
                    rejected: false,
                    token: request.token,
                    roomId: query.roomId,
                    userUuid: `user-of-${query.tabId}`,
                    tabId: query.tabId,
                    connectionId: query.connectionId,
                } as unknown as ConnectingSocketData);
            },
            open: vi.fn(),
            rejectedOpen: vi.fn(),
            reconnect: vi.fn(),
            message: vi.fn(),
            close: vi.fn(),
        });
    }

    public handshake(browser: BrowserSocket): void {
        this.handshakes += 1;
        this.transports.add(browser);
        const query = new URL(browser.url).search.slice(1);
        const request = {
            getQuery: () => query,
            getHeader: (name: string) => (name === "sec-websocket-protocol" ? (browser.protocols?.[0] ?? "") : ""),
            getMethod: () => "get",
            getUrl: () => "/ws/room",
        };
        const response = {
            onAborted: () => {},
            cork: (callback: () => void) => callback(),
            upgrade: (data: unknown) => {
                setTimeout(() => browser.opened(), 0);
                const ws = new ServerSocket(data, browser);
                this.handlers.open(ws);
            },
        };
        this.handlers.upgrade(response, request, {});
    }

    /** The process dies: every transport it holds is lost without a close frame. */
    public crash(): void {
        for (const transport of this.transports) {
            transport.closedBy(1006, "");
        }
        this.transports.clear();
    }
}

class Network {
    private pusher: SimulatedPusher | undefined = new SimulatedPusher();

    /** The pusher process dies and nothing listens until startPusher. */
    public crashPusher(): void {
        this.pusher?.crash();
        this.pusher = undefined;
    }

    /** A new pusher process, with nothing retained, starts listening. */
    public startPusher(): SimulatedPusher {
        this.pusher = new SimulatedPusher();
        return this.pusher;
    }

    public handshake(browser: BrowserSocket): void {
        const pusher = this.pusher;
        if (pusher === undefined) {
            // Nobody listens: the handshake fails.
            setTimeout(() => {
                browser.dispatchEvent(new Event("error"));
                browser.closedBy(1006, "");
            }, 1);
            return;
        }
        // The factory has not returned yet, so the answer must not be synchronous.
        setTimeout(() => pusher.handshake(browser), 0);
    }
}

/** A page: it holds one connection and rebuilds it from scratch when the socket gives up. */
class Page {
    public socket!: WorkAdventureWebSocket;
    public rebuiltAtMs: number | undefined;
    public connectedAfterRebuildAtMs: number | undefined;

    constructor(
        private readonly index: number,
        private readonly clock: () => number,
    ) {
        this.connect();
    }

    private connect(): void {
        const socket = new WorkAdventureWebSocket(`ws://pusher/ws/room?roomId=room&tabId=tab-${this.index}`, [
            PROTOCOL,
        ]);
        this.socket = socket;
        socket.onopen = () => {
            if (this.rebuiltAtMs !== undefined && this.connectedAfterRebuildAtMs === undefined) {
                this.connectedAfterRebuildAtMs = this.clock();
            }
        };
        socket.onclose = () => {
            this.rebuiltAtMs = this.clock();
            this.connect();
        };
    }
}

type RestartMeasure = {
    clients: number;
    authenticatedUpgradesPerClient: number;
    handshakesPerClient: number;
    rebuildsSettled: number;
    rebuildP50Ms: number;
    rebuildP95Ms: number;
    rebuildMaxMs: number;
    peakRebuildsPer100Ms: number;
    lastClientBackMs: number;
};

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

/** mulberry32: a small seeded generator, so the population run is the same on every machine. */
function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Connects `clients` pages, kills the pusher, brings a fresh one back after `downMs` and runs until every page is
 * connected again on the new pusher. Returns what the new pusher saw.
 */
async function measurePusherRestart(clients: number, downMs: number): Promise<RestartMeasure> {
    const network = new Network();
    WorkAdventureWebSocket.setWebsocketFactory(
        (url, protocols) => new BrowserSocket(url, protocols, network) as unknown as WebSocket,
    );

    // Page times are measured from the instant the pusher dies.
    const crashedAt = { ms: 0 };
    const pages = Array.from({ length: clients }, (_, index) => new Page(index, () => Date.now() - crashedAt.ms));
    await vi.advanceTimersByTimeAsync(100);
    expect(pages.every((page) => page.socket.isOpen())).toBe(true);

    crashedAt.ms = Date.now();
    network.crashPusher();
    await vi.advanceTimersByTimeAsync(downMs);
    const restarted = network.startPusher();

    // Timers fire at their own instant inside a tick, so the tick only bounds how late the end of the run is noticed.
    for (let elapsedMs = 0; elapsedMs < 60_000; elapsedMs += 50) {
        if (pages.every((page) => page.connectedAfterRebuildAtMs !== undefined && page.socket.isOpen())) {
            break;
        }
        // Each tick has to run before the next one is decided on: the pages react to the previous one.
        // eslint-disable-next-line no-await-in-loop
        await vi.advanceTimersByTimeAsync(50);
    }

    const rebuilds = pages
        .map((page) => page.rebuiltAtMs)
        .filter((at): at is number => at !== undefined)
        .sort((a, b) => a - b);
    const perBucket = new Map<number, number>();
    for (const at of rebuilds) {
        perBucket.set(Math.floor(at / 100), (perBucket.get(Math.floor(at / 100)) ?? 0) + 1);
    }
    const backAt = pages.map((page) => page.connectedAfterRebuildAtMs ?? Number.POSITIVE_INFINITY);

    for (const page of pages) {
        page.socket.close();
    }

    return {
        clients,
        authenticatedUpgradesPerClient: restarted.authenticatedUpgrades / clients,
        handshakesPerClient: restarted.handshakes / clients,
        rebuildsSettled: rebuilds.length,
        rebuildP50Ms: percentile(rebuilds, 0.5),
        rebuildP95Ms: percentile(rebuilds, 0.95),
        rebuildMaxMs: rebuilds[rebuilds.length - 1],
        peakRebuildsPer100Ms: Math.max(...perBucket.values()),
        lastClientBackMs: Math.max(...backAt),
    };
}

describe("a pusher restart seen by the clients that lost it", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        WorkAdventureWebSocket.setRandomSource(null);
        WorkAdventureWebSocket.setWebsocketFactory(null);
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("authenticates one upgrade per client, the fresh connection, and none for the stale resume", async () => {
        WorkAdventureWebSocket.setRandomSource(seededRandom(1));

        const measure = await measurePusherRestart(200, 3_000);

        // Printed so the two numbers of the engine plan (item 5.3) can be read off a rerun.
        console.info("pusher restart, 200 clients, pusher down 3 s", JSON.stringify(measure));
        expect(measure.rebuildsSettled).toBe(200);
        expect(measure.authenticatedUpgradesPerClient).toBe(1);
    }, 30_000);

    it("brings a lone client back within 5 s of the fastest it could possibly come back", async () => {
        WorkAdventureWebSocket.setRandomSource(() => 0);
        const fastest = await measurePusherRestart(1, 0);

        WorkAdventureWebSocket.setRandomSource(() => 0.999);
        const slowest = await measurePusherRestart(1, 0);

        console.info("lone client back after a restart", JSON.stringify({ fastest, slowest }));
        expect(slowest.lastClientBackMs - fastest.lastClientBackMs).toBeLessThanOrEqual(5_000);
    });
});
