// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/front/Enum/EnvironmentVariable.ts", () => import("../mocks/frontEnvironmentVariableMock"));
vi.mock("../../../src/front/Administration/AnalyticsClient", () => ({
    analyticsClient: { trackAdminEvent: vi.fn() },
}));

import { PusherToFrontWebSocketMessage } from "@workadventure/messages";
import { WorkAdventureWebSocket } from "../../../src/front/Connection/WorkAdventureWebSocket";

class FakeWebSocket extends EventTarget {
    public static instances: FakeWebSocket[] = [];
    public readyState: number = WebSocket.CONNECTING;
    public binaryType = "blob";
    public send = vi.fn();
    public close = vi.fn();

    constructor(public readonly url: string) {
        super();
        FakeWebSocket.instances.push(this);
    }

    public serverOpens(): void {
        this.readyState = WebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
    }

    public serverSendsFrame(nonce: number): void {
        const data = PusherToFrontWebSocketMessage.encode({ nonce, message: { message: undefined } }).finish();
        this.dispatchEvent(new MessageEvent("message", { data }));
    }

    public serverCloses(code: number): void {
        this.readyState = WebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close", { code, reason: "", wasClean: true }));
    }
}

// Closes the newest transport and returns how many ms pass until the resume transport is created.
function measureResumeDelayMs(): number {
    const countBefore = FakeWebSocket.instances.length;
    FakeWebSocket.instances[countBefore - 1].serverCloses(1006);
    let elapsedMs = 0;
    while (FakeWebSocket.instances.length === countBefore) {
        vi.advanceTimersByTime(1);
        elapsedMs += 1;
        if (elapsedMs > 10_000) {
            throw new Error("No resume attempt was scheduled");
        }
    }
    return elapsedMs;
}

describe("WorkAdventureWebSocket resume jitter", () => {
    let sockets: WorkAdventureWebSocket[] = [];

    beforeEach(() => {
        vi.useFakeTimers();
        FakeWebSocket.instances = [];
        sockets = [];
        WorkAdventureWebSocket.setWebsocketFactory((url) => new FakeWebSocket(url) as unknown as WebSocket);
    });

    afterEach(() => {
        // Detaches the window listeners of whichever fake transport is current.
        for (const socket of sockets) {
            socket.close();
        }
        WorkAdventureWebSocket.setRandomSource(null);
        WorkAdventureWebSocket.setWebsocketFactory(null);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("keeps the un-jittered delay when the random source returns 0", () => {
        WorkAdventureWebSocket.setRandomSource(() => 0);
        sockets.push(new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab"));

        // First resume: 500 ms base delay. Second resume: 1000 ms base delay.
        expect(measureResumeDelayMs()).toBe(500);
        expect(measureResumeDelayMs()).toBe(1_000);
    });

    it("adds jitter that stays within the cap when the random source returns almost 1", () => {
        WorkAdventureWebSocket.setRandomSource(() => 0.999);
        sockets.push(new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab"));

        // Base 500 ms plus up to 100% of it: strictly more than 500 ms, at most 1000 ms.
        const delayMs = measureResumeDelayMs();
        expect(delayMs).toBeGreaterThan(500);
        expect(delayMs).toBeLessThanOrEqual(1_000);
    });

    it("caps the jitter at 3 seconds once the base delay reaches its maximum", () => {
        let nextRandom = 0;
        WorkAdventureWebSocket.setRandomSource(() => nextRandom);
        sockets.push(new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab"));

        // Attempts 1 to 4 have bases 500, 1000, 2000, 4000 ms. Attempt 5 has base 5000 ms (the maximum).
        const baseDelaysMs = [1, 2, 3, 4].map(() => measureResumeDelayMs());
        expect(baseDelaysMs).toEqual([500, 1_000, 2_000, 4_000]);
        nextRandom = 0.999;

        // Uncapped, 0.999 would give 5000 + 4995 = 9995 ms. The cap of 3000 ms gives about 7997 ms.
        const delayMs = measureResumeDelayMs();
        expect(delayMs).toBeGreaterThan(7_900);
        expect(delayMs).toBeLessThanOrEqual(8_000);
    });

    it("does not resume two sockets that lost the pusher at the same instant at the same time", () => {
        const randomValues = [0.2, 0.8];
        WorkAdventureWebSocket.setRandomSource(() => randomValues.shift() ?? 0);
        sockets.push(new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab-a"));
        sockets.push(new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab-b"));
        const [transportA, transportB] = FakeWebSocket.instances;

        // Both lose the pusher at the same instant: A waits 500 + 0.2 * 500 = 600 ms, B waits 500 + 0.8 * 500 = 900 ms.
        transportA.serverCloses(1006);
        transportB.serverCloses(1006);

        vi.advanceTimersByTime(600);
        expect(FakeWebSocket.instances).toHaveLength(3);
        expect(FakeWebSocket.instances[2].url).toContain(
            new URL(transportA.url).searchParams.get("connectionId") as string,
        );

        vi.advanceTimersByTime(299);
        expect(FakeWebSocket.instances).toHaveLength(3);

        vi.advanceTimersByTime(1);
        expect(FakeWebSocket.instances).toHaveLength(4);
        expect(FakeWebSocket.instances[3].url).toContain(
            new URL(transportB.url).searchParams.get("connectionId") as string,
        );
    });
});

describe("WorkAdventureWebSocket refused resume", () => {
    let socket: WorkAdventureWebSocket | undefined;

    // The first draw is the resume jitter (0 keeps the resume at its 500 ms base delay), the next ones the spread.
    function drawRandom(...values: number[]): void {
        WorkAdventureWebSocket.setRandomSource(() => values.shift() ?? 0);
    }

    function latestTransport(): FakeWebSocket {
        return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    }

    // The transport is lost, the resume transport connects, then the pusher closes it with the given code.
    function loseTransportThenCloseResumeWith(code: number): void {
        latestTransport().serverCloses(1006);
        vi.advanceTimersByTime(500);
        latestTransport().serverOpens();
        latestTransport().serverCloses(code);
    }

    beforeEach(() => {
        vi.useFakeTimers();
        FakeWebSocket.instances = [];
        WorkAdventureWebSocket.setWebsocketFactory((url) => new FakeWebSocket(url) as unknown as WebSocket);
    });

    afterEach(() => {
        socket?.close();
        socket = undefined;
        WorkAdventureWebSocket.setRandomSource(null);
        WorkAdventureWebSocket.setWebsocketFactory(null);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("tells the page the connection is gone after a random share of 2 seconds", () => {
        drawRandom(0, 0.5);
        socket = new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab");
        const onclose = vi.fn();
        socket.onclose = onclose;

        loseTransportThenCloseResumeWith(1008);

        expect(onclose).not.toHaveBeenCalled();
        vi.advanceTimersByTime(999);
        expect(onclose).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onclose).toHaveBeenCalledOnce();
        expect(onclose.mock.calls[0][0].code).toBe(1008);
    });

    it("tells the page within 2 seconds at the latest", () => {
        drawRandom(0, 0.999);
        socket = new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab");
        const onclose = vi.fn();
        socket.onclose = onclose;

        loseTransportThenCloseResumeWith(1008);
        vi.advanceTimersByTime(2_000);

        expect(onclose).toHaveBeenCalledOnce();
    });

    it("keeps the page reconnecting until it tells the page the connection is gone", () => {
        drawRandom(0, 0.5);
        socket = new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab");
        const reconnecting: boolean[] = [];
        const subscription = socket.reconnectingStream.subscribe((value) => reconnecting.push(value));

        loseTransportThenCloseResumeWith(1008);
        expect(reconnecting[reconnecting.length - 1]).toBe(true);

        vi.advanceTimersByTime(1_000);
        expect(reconnecting[reconnecting.length - 1]).toBe(false);
        subscription.unsubscribe();
    });

    it("tells the page at once when a first connection is refused", () => {
        drawRandom(0.5);
        socket = new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab");
        const onclose = vi.fn();
        socket.onclose = onclose;

        latestTransport().serverCloses(1008);

        expect(onclose).toHaveBeenCalledOnce();
    });

    it("tells the page at once when a resumed transport that already got frames is closed", () => {
        drawRandom(0, 0.5);
        socket = new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab");
        const onclose = vi.fn();
        socket.onclose = onclose;

        latestTransport().serverCloses(1006);
        vi.advanceTimersByTime(500);
        latestTransport().serverOpens();
        latestTransport().serverSendsFrame(1);
        latestTransport().serverCloses(1008);

        expect(onclose).toHaveBeenCalledOnce();
    });

    it("tells the page at once when a person asks to try again now", () => {
        drawRandom(0, 0.5);
        socket = new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab");
        const onclose = vi.fn();
        socket.onclose = onclose;
        loseTransportThenCloseResumeWith(1008);

        socket.reconnectNow();

        expect(onclose).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(2_000);
        expect(onclose).toHaveBeenCalledOnce();
    });

    it("tells the page nothing once the page closed the socket itself", () => {
        drawRandom(0, 0.5);
        socket = new WorkAdventureWebSocket("ws://pusher/ws/room?tabId=tab");
        const onclose = vi.fn();
        socket.onclose = onclose;
        loseTransportThenCloseResumeWith(1008);

        socket.close();
        vi.advanceTimersByTime(2_000);

        expect(onclose).not.toHaveBeenCalled();
    });
});
