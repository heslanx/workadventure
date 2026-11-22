// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readable } from "svelte/store";

// A stand-in for @workadventure/simple-peer 12.3.0 that keeps the behaviour the guard is about: destroy() flags the
// peer as destroying, and one timer later nulls the connection and flags it destroyed; from then on the deferred
// offer and answer dereference the nulled connection and the public methods throw ERR_DESTROYED.
const fakes = vi.hoisted(() => {
    // The front reads window.env while it is imported
    (window as unknown as { env: unknown }).env = new Proxy({}, { get: () => undefined });
    // No analytics endpoint: the quality reports stay off
    (window as unknown as { capabilities: unknown }).capabilities = {};
    const calls: string[] = [];
    return { calls };
});

vi.mock("@workadventure/simple-peer", async () => {
    const { EventEmitter } = await import("node:events");
    class FakePeer extends EventEmitter {
        public destroyed = false;
        public _destroying = false;
        public _connected = false;
        public initiator: boolean;
        public _pc: Record<string, unknown> | null = {
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            getStats: () => Promise.resolve(new Map()),
            getSenders: () => [],
        };
        public receiveCodecs: unknown;

        constructor(options: { initiator?: boolean }) {
            super();
            this.initiator = options.initiator ?? false;
        }

        private assertAlive(method: string): void {
            fakes.calls.push(method);
            if (this.destroyed) {
                throw new Error(`cannot ${method} after peer is destroyed`);
            }
        }

        _createOffer(): void {
            fakes.calls.push("_createOffer");
            // Throws a TypeError once _pc is null, as 12.3.0 does
            (this._pc as { getStats: () => void }).getStats();
        }
        _createAnswer(): void {
            fakes.calls.push("_createAnswer");
            (this._pc as { getStats: () => void }).getStats();
        }
        negotiate(): void {
            this.assertAlive("negotiate");
            setTimeout(() => this._createOffer(), 0);
        }
        signal(_data: unknown): void {
            this.assertAlive("signal");
        }
        send(_chunk: unknown): void {
            this.assertAlive("send");
        }
        write(_chunk: unknown): void {
            this.assertAlive("write");
        }
        addTrack(): void {
            this.assertAlive("addTrack");
        }
        addStream(): void {
            this.assertAlive("addStream");
        }
        replaceTrack(): void {
            this.assertAlive("replaceTrack");
        }
        removeTrack(): void {
            this.assertAlive("removeTrack");
        }
        removeStream(): void {
            this.assertAlive("removeStream");
        }
        getStats(cb: (err: Error | null, reports?: unknown[]) => void): void {
            fakes.calls.push("getStats");
            // Throws a TypeError once _pc is null, as 12.3.0 does
            (this._pc as { getStats: () => void }).getStats();
            cb(null, []);
        }
        end(): void {
            // The writable side of the real peer
        }
        destroy(_error?: Error): void {
            if (this.destroyed || this._destroying) {
                return;
            }
            this._destroying = true;
            setTimeout(() => {
                this._pc = null;
                this.destroyed = true;
                this.emit("close");
            }, 0);
        }
    }
    return { default: FakePeer, Peer: FakePeer };
});

vi.mock("../Utils/E2EHooks", () => ({
    incrementWebRtcConnectionsCount: vi.fn(),
    decrementWebRtcConnectionsCount: vi.fn(),
}));
// The stores below pull in the whole front (the Phaser scenes, the chat); the peer only reads their value
vi.mock("../Stores/MediaStore", async () => ({ videoQualityStore: (await import("svelte/store")).writable("high") }));
vi.mock("../Stores/ScreenSharingStore", async () => ({
    screenShareQualityStore: (await import("svelte/store")).writable("high"),
}));
vi.mock("../Stores/PeerStore", async () => ({
    volumeProximityDiscussionStore: (await import("svelte/store")).writable(1),
}));
vi.mock("../Stores/BandwidthConstrainedPreferenceStore", async () => ({
    bandwidthConstrainedPreferenceStore: (await import("svelte/store")).writable("balanced"),
}));
vi.mock("../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));

const { RemotePeer } = await import("./RemotePeer");

type Space = ConstructorParameters<typeof RemotePeer>[2];

function createPeer(): InstanceType<typeof RemotePeer> {
    const space = {
        getSpaceUserBySpaceUserId: () => undefined,
        isStreamingVideoStore: readable(false),
        emitPrivateMessage: vi.fn(),
        emitVideoQualityReport: vi.fn(),
        getName: () => "space",
        mySpaceUserId: "me",
    } as unknown as Space;
    return new RemotePeer(
        { userId: 1 } as never,
        true,
        space,
        [],
        false,
        readable(undefined),
        "video",
        "remote-user",
        readable(new Set<string>()),
        vi.fn(),
        "connection-id",
        1,
    );
}

/** Destroys the peer and lets simple-peer finish the job (one timer), as it does in the browser. */
async function destroyPeer(peer: InstanceType<typeof RemotePeer>): Promise<void> {
    peer.destroy();
    await vi.advanceTimersByTimeAsync(1);
    expect(peer.destroyed).toBe(true);
}

describe("RemotePeer after destroy (simple-peer 12.3.0 throws, the guard keeps it quiet)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        fakes.calls.length = 0;
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("lets the offer timer of negotiate() fire on a peer destroyed in between", async () => {
        const peer = createPeer();
        peer.negotiate();
        // Browsers can clamp timers so that destroy() finishes before the offer timer: fire the offer afterwards
        await destroyPeer(peer);
        fakes.calls.length = 0;
        expect(() => peer._createOffer()).not.toThrow();
        expect(() => peer._createAnswer()).not.toThrow();
        expect(fakes.calls).not.toContain("_createOffer");
        expect(fakes.calls).not.toContain("_createAnswer");
    });

    it("ignores negotiate, signal and send on a destroyed peer", async () => {
        const peer = createPeer();
        await destroyPeer(peer);
        fakes.calls.length = 0;

        expect(() => peer.negotiate()).not.toThrow();
        expect(() => peer.signal({ type: "renegotiate", renegotiate: true })).not.toThrow();
        expect(() => peer.send("hello")).not.toThrow();
        expect(fakes.calls).toEqual([]);
    });

    it("ignores the track methods on a destroyed peer", async () => {
        const peer = createPeer();
        await destroyPeer(peer);
        fakes.calls.length = 0;
        const track = {} as MediaStreamTrack;
        const stream = {} as MediaStream;

        expect(() => peer.addTrack(track, stream)).not.toThrow();
        expect(() => peer.addStream(stream)).not.toThrow();
        expect(() => peer.replaceTrack(track, track, stream)).not.toThrow();
        expect(() => peer.removeTrack(track, stream)).not.toThrow();
        expect(() => peer.removeStream(stream)).not.toThrow();
        expect(fakes.calls).toEqual([]);
    });

    it("answers a direct getStats call on a destroyed peer with an error instead of throwing", async () => {
        const peer = createPeer();
        await destroyPeer(peer);
        fakes.calls.length = 0;

        const callback = vi.fn();
        expect(() => peer.getStats(callback)).not.toThrow();

        expect(fakes.calls).not.toContain("getStats");
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    // Regression check, independent of the guard: the webrtcStats poll reads _pc itself (WebRtcStatsFactory) and
    // already stops on a destroyed peer, so it passes with or without the getStats override.
    it("keeps the webrtcStats poll quiet after destroy (already safe without the guard)", async () => {
        const peer = createPeer();
        const stats = vi.fn();
        const unsubscribe = peer.webrtcStats.subscribe(stats);
        await destroyPeer(peer);
        fakes.calls.length = 0;

        await vi.advanceTimersByTimeAsync(5_000);
        unsubscribe();

        expect(fakes.calls).not.toContain("getStats");
        expect(stats.mock.calls.at(-1)?.[0]).toBeUndefined();
    });

    it("also drops the calls made while destroy() is under way", () => {
        const peer = createPeer();
        peer.destroy();
        // simple-peer is _destroying but not destroyed yet: its _createOffer would still run on a closing connection
        expect(peer.destroyed).toBe(false);
        peer._createOffer();
        peer._createAnswer();
        peer.negotiate();
        expect(fakes.calls).toEqual([]);
    });

    it("still reaches simple-peer while the peer is alive", () => {
        const peer = createPeer();
        peer.negotiate();
        peer.signal({ type: "renegotiate", renegotiate: true });
        peer.send("hello");
        expect(fakes.calls).toEqual(["negotiate", "signal", "send"]);
        peer.destroy();
    });
});
