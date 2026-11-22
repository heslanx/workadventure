import inspector from "node:inspector";
import os from "node:os";
import nodeProcess from "node:process";
import { register } from "prom-client";
import {
    AvailabilityStatus,
    PositionMessage_Direction,
    PusherToFrontWebSocketMessage,
    type UserJoinedZoneMessage,
    type ZoneMessage,
} from "@workadventure/messages";
import { PositionDispatcher } from "../../../src/pusher/models/PositionDispatcher";
import type { PusherRoom } from "../../../src/pusher/models/PusherRoom";
import { ViewerBudget, type ViewerBudgetLimits } from "../../../src/pusher/models/ViewerBudget";
import { clientEventsEmitter } from "../../../src/pusher/services/ClientEventsEmitter";
import { PusherWebSocket, type BatchTiming, type RawSocket } from "../../../src/pusher/services/PusherWebSocket";
import { SocketManager } from "../../../src/pusher/services/SocketManager";

/* eslint-disable no-await-in-loop -- a bench measures one scenario at a time: runs must not overlap. */
/*
 * H5 of the engine plan: the fan-out of the pusher, in one event loop, on a virtual clock.
 *
 * N real PusherWebSockets on a fake uWS transport watch one dense room (all of them in mutual view, in one zone). A
 * fraction of them walk and share `movesPerSecond` positions each. The moves reach the PositionDispatcher the way the
 * back sends them: in bursts, one per back batch window. Everything between the dispatcher and the transport is the
 * production code: PositionDispatcher, Zone, SocketManager's zone callbacks, the optional ViewerBudget, the per-socket
 * batch timer, BatchFrame, the NoncedMessageStore. What it leaves out: the uWS write (native, charged in the profile of
 * the real pusher as `send`), the intake of a client move (once per move, not once per recipient) and the back.
 *
 * What a number from this bench is worth. Time is virtual (setTimeout, setInterval and Date.now are replaced for the
 * duration of a run, so a run never waits and never depends on when the OS schedules it), and the cost is the CPU time
 * of the process (user + system, `nodeProcess.cpuUsage`), not the wall time. That makes the counts exact on any host
 * (frames, deliveries, joins and leaves, the virtual latencies) but NOT the CPU: a busy host inflates it, by up to 1.5x
 * between two rounds and 2.4x between the repeats of one scenario at a load average of 100 to 265 on 10 cores (MEASURED
 * by the review of 2026-11-21), and only a quiet host (load per core below 1) gave repeats within 10% of each other.
 * So:
 *  - the CPU is valid on a quiet host only; `judgeRun` prints INVALID when the load average per core is above 1 or when
 *    the slowest repeat of a scenario is more than 1.3 times the fastest;
 *  - the signal is the RATIO between two arms (budget off against on, one window against another) measured in
 *    interleaved repeats, `runInterleaved`, which sees the same host load, and the median of the ratios of the pairs;
 *    an absolute CPU figure is for the same host and the same hour only;
 *  - the virtual clock is charged to the measurement (its heap push and pop were about 5% of the budget-off profile:
 *    advanceTo 3.8%, setTimeout 1.2%). Real Node timers cost differently, so the sign of that bias is unknown, and it
 *    is the same in both arms;
 *  - everything native is left out: the uWS `send`, the intake and gRPC decode, the backpressure
 *    (`getBufferedAmount` is always 0). The herd figures below add the native `send` as a DERIVED number
 *    (`nativeSendMicrosPerFrame`), never as a measured one.
 *
 * The flush herd. Every socket of a dense room gets the same burst from the back, so the batch timers of all of them
 * are due at the same instant, and the last of 1000 sockets is written after the 999 before it. `herds` is the CPU of
 * each group of timers due at the same instant (JS only, MEASURED), and `sendToWriteWithServiceMs` is the latency of
 * the observers with the position of their frame in its herd added: the frame i of F is late by i / F of the herd's
 * service time, JS measured plus the native send DERIVED. Queueing between herds is not modelled: `flushBusyCores`
 * says how much of a core the flushes alone take, and above about 0.5 the herds queue behind each other.
 */

export interface FanOutScenario {
    /** Sockets, one user each, all watching the same zone. */
    sockets: number;
    /** Share of the users that walk, 0 to 1. */
    movingFraction: number;
    /** Positions each walker shares per second. */
    movesPerSecond: number;
    /** The per-viewer budget of the pusher; undefined is the pusher with the budget off. */
    budget?: ViewerBudgetLimits;
    /** Simulated seconds before the window, for the joins to flush and the timers to fall into step. */
    warmUpSeconds?: number;
    /** Simulated seconds that are measured. */
    windowSeconds?: number;
    /** The batch window of the back: the moves it holds are delivered together at its end. 50 in production. */
    backBatchMs?: number;
    /** The pusher's batch interval (PUSHER_BATCH_INTERVAL_MS). 100 in production. */
    batchIntervalMs?: number;
    /** The pusher's early flush (PUSHER_BATCH_EARLY_FLUSH_MS). 0, off, in production. */
    earlyFlushMs?: number;
    /**
     * Stops per walker per second, among its `movesPerSecond` moves (a move with moving: false). 0 in the first
     * versions of this bench, which made it blind to everything a stop does: the early flush, and the per-listener
     * path a stop takes under the budget.
     */
    stopsPerWalkerPerSecond?: number;
    /** The cost, in microseconds, of the native uWS send of one frame. DERIVED, not measured here: see herds. */
    nativeSendMicrosPerFrame?: number;
    /** Sockets whose frames are decoded after the run to measure the latency the pusher adds. */
    observers?: number;
    /** Takes a CPU profile of the window and returns its summary in the result. */
    profile?: boolean;
    /**
     * Counts the calls the pusher makes in the window (see `FanOutResult.operations`). Off by default: a counter wrapped
     * around a function of the hot path costs CPU, so the CPU arms of the report run without it.
     */
    countOperations?: boolean;
    /**
     * Each walker goes round a circle of this radius, in pixels, instead of stepping in place: the users of a dense room
     * then really cross the edge of each viewer's scene, all the time. 0, the default, is the 21 px step in place. A move
     * of a walker on a circle is not one of the 64 positions the latency decoder knows, so the latency is not measured.
     */
    wanderPx?: number;
    /** Seconds a walker takes to go once round its circle. */
    wanderPeriodSeconds?: number;
    /**
     * How many of the users nearest to an observer, by distance between their homes, count as "nearest" in
     * `nearestSendToWriteMs` and `nearestDeliveredShare`. The `fullRatePeers` of the budget when not given (every user with
     * the budget off).
     */
    nearestRanks?: number;
}

/** What the pusher did in the window, counted call by call: they do not depend on the speed of the host. */
export interface OperationCounts {
    /** Sub-messages put into the batch of a socket (`emitInBatch`): a delivery each. */
    emits: number;
    /** Times a zone event was handed to one socket: `onUserMoves` of the SocketManager, and `ViewerBudget.move`. */
    listenerCalls: number;
    /** Selections run (`ViewerBudget.tick`), and the peers they ranked: a selection ranks every peer its socket watches. */
    ranks: number;
    rankedPeers: number;
    /** Frames written to the sockets. */
    frames: number;
    /** emits + listenerCalls + rankedPeers + frames: the calls into the pusher's per-socket code. */
    total: number;
    /** Simulated seconds of the window. Every count above is a total over the window: divide by this for "a second". */
    windowSeconds: number;
    /** The same counts divided by `windowSeconds`. */
    perSecond: {
        emits: number;
        listenerCalls: number;
        ranks: number;
        rankedPeers: number;
        frames: number;
        total: number;
    };
}

export interface LatencySummary {
    count: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
}

export interface FanOutResult {
    scenario: Required<Omit<FanOutScenario, "budget">> & { budget: ViewerBudgetLimits | undefined };
    /** CPU milliseconds (user + system) the process spent per simulated second of the window. */
    cpuMsPerSimSecond: number;
    /** CPU nanoseconds per delivered sub-message (a move, a join or a leave, counted once per recipient socket). */
    cpuNsPerDelivery: number;
    /** Sub-messages sent to sockets per simulated second, by type. */
    deliveriesPerSecond: { moves: number; joins: number; leaves: number; total: number };
    /** Frame bytes written to the sockets per simulated second. */
    bytesPerSecond: number;
    /** Frames written to the sockets per simulated second (one per socket per batch tick that had something). */
    framesPerSecond: number;
    /** Live timers at the end of the window, per socket: the keep-alive, the pending batch flush, any budget tick. */
    timersPerSocket: number;
    /** Milliseconds from a move reaching the dispatcher to the frame that carries it being written. Observers only. */
    pusherHopMs: LatencySummary;
    /** Milliseconds from the walker sending a move to the frame that carries it being written, including the back window. */
    sendToWriteMs: LatencySummary;
    /**
     * The flush herds: groups of timers due at the same instant that wrote at least a tenth of the sockets. `jsMs` is
     * the CPU of a herd, MEASURED, `derivedTotalMs` adds the native send of each frame, DERIVED.
     */
    herds: {
        perSecond: number;
        jsMs: LatencySummary;
        derivedTotalMs: LatencySummary;
        /**
         * The group of timers due at the same instant that took the most JS CPU in the window, among all of them: how
         * many timers ran in it and how many frames they wrote. Many more timers than frames is a herd of budget
         * ticks, which write nothing themselves.
         */
        longest: { jsMs: number; timers: number; frames: number };
    };
    /** DERIVED: cores taken by the flushes alone (JS measured plus native send derived), over every group of timers. */
    flushBusyCores: number;
    /** DERIVED: sendToWriteMs with the wait for the frames of the same herd that were written first. */
    sendToWriteWithServiceMs: LatencySummary;
    /**
     * DERIVED from counts alone, so it does not depend on the host: sendToWriteMs with only the native part of that
     * wait, (place in the herd + 1) frames of `nativeSendMicrosPerFrame` each. The JS of the herd comes on top of it,
     * so this is a floor of sendToWriteWithServiceMs, whatever the speed of the machine that ran the bench.
     */
    sendToWriteWithNativeMs: LatencySummary;
    /** DERIVED from counts alone: cores the native send of every frame written takes, `framesPerSecond` x its cost. */
    flushNativeCores: number;
    /** Only with `countOperations`. */
    operations: OperationCounts | undefined;
    /**
     * sendToWriteMs split by RANK, not by what the observer was sent: the moves of the walkers among the `fullRatePeers`
     * users nearest to the observer by distance (all of them with the budget off), which are the live movement the client
     * draws, and the moves of the walkers farther than that, which the budget sends once a second by design. A user the
     * budget leaves at 1 Hz although it is among the nearest is therefore counted where it belongs, in the first set.
     */
    nearestSendToWriteMs: LatencySummary;
    farSendToWriteMs: LatencySummary;
    /**
     * Of the moves that the nearest walkers sent in the window, the share that reached the observers: 1 when every one of
     * them was delivered. With the budget on, a nearest user that was left at 1 Hz shows here as about 0.2 for it.
     */
    nearestDeliveredShare: number;
    /** Stops (moves with moving: false) in the frames of the observers during the window, all observers together. */
    observedStops: number;
    /** Joins and leaves per second sent during the window, which has no real crossing: all of them are synthetic. */
    syntheticJoinLeavePerSecond: number;
    /** What each socket was told while the room filled and settled, before the window: joins and leaves a socket. */
    admissionPerSocket: { joins: number; leaves: number };
    /** The top self-time functions of the window, when the scenario asked for a profile. */
    profileTop?: string[];
}

// ------------------------------------------------------------------------------------------------------------------
// Virtual clock

interface TimerEntry {
    due: number;
    sequence: number;
    callback: () => void;
    intervalMs: number | undefined;
    cancelled: boolean;
}

/** The timers due at one instant: how many ran, how many frames they wrote, the CPU they took (JS only). */
interface TimerGroup {
    timers: number;
    frames: number;
    jsCpuMs: number;
}

/** A min-heap of timers on a clock that only moves when the harness says so. */
class VirtualClock {
    public now = 1_700_000_000_000;
    /** While true, the groups of timers due at the same instant are timed. Off in the warm-up. */
    public recordGroups = false;
    public readonly groups: TimerGroup[] = [];
    private currentGroup: TimerGroup | undefined;
    private heap: TimerEntry[] = [];
    private sequence = 0;
    private pending = 0;

    public schedule(callback: () => void, delayMs: number, intervalMs?: number): TimerEntry {
        const entry: TimerEntry = {
            due: this.now + Math.max(1, delayMs),
            sequence: this.sequence++,
            callback,
            intervalMs,
            cancelled: false,
        };
        this.push(entry);
        this.pending += 1;
        return entry;
    }

    public cancel(handle: unknown): void {
        const entry = handle as TimerEntry | undefined;
        if (entry === undefined || entry.cancelled) {
            return;
        }
        entry.cancelled = true;
        this.pending -= 1;
    }

    /** Live timers: those not cancelled and not yet fired (an interval stays live). */
    public get liveTimers(): number {
        return this.pending;
    }

    /** The due time of the next live timer; undefined without one. */
    public peek(): number | undefined {
        while (this.heap.length > 0 && this.heap[0].cancelled) {
            this.pop();
        }
        return this.heap.length === 0 ? undefined : this.heap[0].due;
    }

    public startRecording(): void {
        this.groups.length = 0;
        this.recordGroups = true;
    }

    public stopRecording(): void {
        this.recordGroups = false;
    }

    /**
     * A socket wrote a frame. Returns the group of timers it was written in and its place there, or undefined outside
     * the timers (a frame written by the dispatcher itself).
     */
    public noteFrame(): { group: number; position: number } | undefined {
        const group = this.currentGroup;
        if (group === undefined) {
            return undefined;
        }
        return { group: this.groups.length - 1, position: group.frames++ };
    }

    /** Runs the timers due at or before `time`, in order, and leaves the clock at `time`. */
    public advanceTo(time: number): void {
        let groupDue = -1;
        let groupStart: NodeJS.CpuUsage | undefined;
        const closeGroup = () => {
            if (this.currentGroup !== undefined && groupStart !== undefined) {
                const spent = nodeProcess.cpuUsage(groupStart);
                this.currentGroup.jsCpuMs = (spent.user + spent.system) / 1000;
            }
            this.currentGroup = undefined;
        };
        for (;;) {
            const due = this.peek();
            if (due === undefined || due > time) {
                break;
            }
            if (this.recordGroups && due !== groupDue) {
                closeGroup();
                groupDue = due;
                this.currentGroup = { timers: 0, frames: 0, jsCpuMs: 0 };
                this.groups.push(this.currentGroup);
                groupStart = nodeProcess.cpuUsage();
            }
            if (this.currentGroup !== undefined) {
                this.currentGroup.timers += 1;
            }
            const entry = this.pop();
            this.now = due;
            if (entry.intervalMs === undefined) {
                entry.cancelled = true;
                this.pending -= 1;
                entry.callback();
            } else {
                entry.due = due + entry.intervalMs;
                entry.sequence = this.sequence++;
                this.push(entry);
                entry.callback();
            }
        }
        closeGroup();
        this.now = Math.max(this.now, time);
    }

    private less(a: TimerEntry, b: TimerEntry): boolean {
        return a.due < b.due || (a.due === b.due && a.sequence < b.sequence);
    }

    private push(entry: TimerEntry): void {
        const heap = this.heap;
        let index = heap.length;
        heap.push(entry);
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (!this.less(heap[index], heap[parent])) {
                break;
            }
            [heap[index], heap[parent]] = [heap[parent], heap[index]];
            index = parent;
        }
    }

    private pop(): TimerEntry {
        const heap = this.heap;
        const top = heap[0];
        const last = heap.pop() as TimerEntry;
        if (heap.length > 0) {
            heap[0] = last;
            let index = 0;
            for (;;) {
                const left = index * 2 + 1;
                const right = left + 1;
                let smallest = index;
                if (left < heap.length && this.less(heap[left], heap[smallest])) {
                    smallest = left;
                }
                if (right < heap.length && this.less(heap[right], heap[smallest])) {
                    smallest = right;
                }
                if (smallest === index) {
                    break;
                }
                [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
                index = smallest;
            }
        }
        return top;
    }
}

/** Replaces the timer functions and Date.now for the duration of `body`; always restores them. */
async function withVirtualClock<T>(clock: VirtualClock, body: () => Promise<T>): Promise<T> {
    const real = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
        dateNow: Date.now,
    };
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.setTimeout = (callback: () => void, delayMs?: number) => clock.schedule(callback, delayMs ?? 0);
    globals.setInterval = (callback: () => void, delayMs?: number) =>
        clock.schedule(callback, delayMs ?? 0, Math.max(1, delayMs ?? 0));
    globals.clearTimeout = (handle: unknown) => clock.cancel(handle);
    globals.clearInterval = (handle: unknown) => clock.cancel(handle);
    Date.now = () => clock.now;
    try {
        return await body();
    } finally {
        globals.setTimeout = real.setTimeout;
        globals.clearTimeout = real.clearTimeout;
        globals.setInterval = real.setInterval;
        globals.clearInterval = real.clearInterval;
        // eslint-disable-next-line require-atomic-updates -- restoring what was saved before the run, nothing else touches it
        Date.now = real.dateNow;
    }
}

// ------------------------------------------------------------------------------------------------------------------
// The room

/** Positions a walker takes: 64 distinct points in a 21 px square, so a received position names the step that sent it. */
const WIGGLE_STEPS = 64;

function wiggle(step: number): { dx: number; dy: number } {
    const slot = step % WIGGLE_STEPS;
    return { dx: (slot % 8) * 3, dy: (slot >> 3) * 3 };
}

/** A walker on a circle: where user `userId` is `atMs` into the run, the phase of each user its own. */
function circle(userId: number, atMs: number, radiusPx: number, periodSeconds: number): { dx: number; dy: number } {
    const angle = (2 * Math.PI * atMs) / (periodSeconds * 1000) + userId * 2.399963229728653;
    return { dx: Math.round(radiusPx * Math.cos(angle)), dy: Math.round(radiusPx * Math.sin(angle)) };
}

/** The slot a received position stands for, given the home of its user; -1 if it is none of the wiggle positions. */
function slotOf(home: { x: number; y: number }, x: number, y: number): number {
    const dx = x - home.x;
    const dy = y - home.y;
    if (dx < 0 || dy < 0 || dx % 3 !== 0 || dy % 3 !== 0 || dx > 21 || dy > 21) {
        return -1;
    }
    return (dy / 3) * 8 + dx / 3;
}

interface Layout {
    homes: { x: number; y: number }[];
}

/** The users stand on a grid inside the zone at (0, 0): 320 px wide, so that every viewer sees all of them. */
function denseLayout(sockets: number): Layout {
    const columns = Math.ceil(Math.sqrt(sockets));
    const spacing = Math.max(1, Math.floor(280 / columns));
    const homes = Array.from({ length: sockets }, (_, index) => ({
        x: 8 + (index % columns) * spacing,
        y: 8 + Math.floor(index / columns) * spacing,
    }));
    return { homes };
}

interface Sink {
    userId: number;
    socket: PusherWebSocket;
    frames: number;
    bytes: number;
    /** For observers: when the frame was written, the frame and where it stood in its herd, decoded after the run. */
    kept: { time: number; frame: Uint8Array; group: number; position: number }[] | undefined;
}

function makeSink(
    userId: number,
    home: { x: number; y: number },
    clock: VirtualClock,
    keep: boolean,
    timing: BatchTiming,
): Sink {
    const userData = {
        userId,
        userUuid: `uuid-${userId}`,
        tabId: `tab-${userId}`,
        connectionId: `connection-${userId}`,
        listenedZones: new Set<string>(),
        viewport: { left: home.x - 480, right: home.x + 480, top: home.y - 270, bottom: home.y + 270 },
    };
    const sink = { userId, frames: 0, bytes: 0, kept: keep ? [] : undefined } as Sink;
    const raw = {
        send: (payload: Uint8Array) => {
            sink.frames += 1;
            sink.bytes += payload.length;
            const place = clock.noteFrame();
            sink.kept?.push({
                time: clock.now,
                frame: payload,
                group: place?.group ?? -1,
                position: place?.position ?? 0,
            });
            return 1;
        },
        ping: () => 1,
        end: () => undefined,
        getBufferedAmount: () => 0,
        getUserData: () => userData,
    };
    sink.socket = new PusherWebSocket(raw as unknown as RawSocket, timing);
    return sink;
}

function joinedZoneMessage(userId: number, home: { x: number; y: number }): ZoneMessage {
    const joined: UserJoinedZoneMessage = {
        userId,
        userUuid: `uuid-${userId}`,
        name: `bot ${userId}`,
        characterTextures: [],
        position: { x: home.x, y: home.y, direction: PositionMessage_Direction.RIGHT, moving: false },
        availabilityStatus: AvailabilityStatus.ONLINE,
        visitCardUrl: "",
        variables: {},
        outlineColor: 0,
        hasOutline: false,
        fromZone: undefined,
        companionTexture: undefined,
        chatID: undefined,
        sayMessage: undefined,
    };
    return { x: 0, y: 0, message: { $case: "userJoinedZoneMessage", userJoinedZoneMessage: joined } };
}

function movedZoneMessage(userId: number, x: number, y: number, moving: boolean): ZoneMessage {
    return {
        x: 0,
        y: 0,
        message: {
            $case: "userMovedMessage",
            userMovedMessage: {
                userId,
                position: { x, y, direction: PositionMessage_Direction.RIGHT, moving },
            },
        },
    };
}

/**
 * Wraps the calls of the pusher's per-socket code in counters, for the window of a run, and returns what puts them back.
 * The wrappers add a few nanoseconds to each call, which is why a run that counts does not report its CPU.
 */
function countOperations(
    counters: Omit<OperationCounts, "frames" | "total" | "windowSeconds" | "perSecond">,
): () => void {
    const restores: (() => void)[] = [];
    const wrap = (prototype: object, name: string, before: (self: unknown) => void): void => {
        const holder = prototype as Record<string, (this: unknown, ...args: unknown[]) => unknown>;
        const original = holder[name];
        holder[name] = function (this: unknown, ...args: unknown[]) {
            before(this);
            return original.apply(this, args);
        };
        restores.push(() => {
            holder[name] = original;
        });
    };
    wrap(PusherWebSocket.prototype, "emitInBatch", () => {
        counters.emits += 1;
    });
    wrap(SocketManager.prototype, "onUserMoves", () => {
        counters.listenerCalls += 1;
    });
    wrap(ViewerBudget.prototype, "move", () => {
        counters.listenerCalls += 1;
    });
    wrap(ViewerBudget.prototype, "tick", (budget) => {
        counters.ranks += 1;
        counters.rankedPeers += (budget as { peers: Map<number, unknown> }).peers.size;
    });
    return () => restores.forEach((restore) => restore());
}

async function counted(name: string): Promise<Map<string, number>> {
    const metric = await register.getSingleMetric(name)?.get();
    return new Map((metric?.values ?? []).map(({ value, labels }) => [String(labels.type), value]));
}

function percentile(sorted: number[], fraction: number): number {
    if (sorted.length === 0) {
        return Number.NaN;
    }
    return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function summarize(values: number[]): LatencySummary {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        count: sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.length === 0 ? Number.NaN : sorted[sorted.length - 1],
    };
}

// ------------------------------------------------------------------------------------------------------------------
// Profile

interface ProfileNode {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
    children?: number[];
}

interface CpuProfile {
    nodes: ProfileNode[];
    samples: number[];
    timeDeltas: number[];
}

function shortName(node: ProfileNode): string {
    const { functionName, url, lineNumber } = node.callFrame;
    const file = url.split("/").slice(-2).join("/");
    return `${functionName === "" ? "(anonymous)" : functionName} ${file}:${lineNumber + 1}`;
}

/** Self time per function as a share of the busy samples, largest first. */
export function summarizeProfile(profile: CpuProfile, top = 14): string[] {
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const self = new Map<string, number>();
    let busy = 0;
    profile.samples.forEach((id, index) => {
        const node = byId.get(id);
        if (node === undefined) {
            return;
        }
        const name = node.callFrame.functionName;
        if (name === "(idle)" || name === "(program)" || name === "(root)" || node.callFrame.url === "node:inspector") {
            return;
        }
        const delta = profile.timeDeltas[index] ?? 0;
        busy += delta;
        const key = shortName(node);
        self.set(key, (self.get(key) ?? 0) + delta);
    });
    return [...self.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, top)
        .map(([name, time]) => `${((100 * time) / busy).toFixed(1)}% ${name}`);
}

async function startProfile(): Promise<{ stop: () => Promise<CpuProfile> }> {
    const session = new inspector.Session();
    session.connect();
    const post = (method: string, params?: object) =>
        new Promise<unknown>((resolve, reject) => {
            session.post(method, params ?? {}, (error: Error | null, result?: unknown) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            });
        });
    await post("Profiler.enable");
    await post("Profiler.setSamplingInterval", { interval: 200 });
    await post("Profiler.start");
    return {
        stop: async () => {
            const result = (await post("Profiler.stop")) as { profile: CpuProfile };
            session.disconnect();
            return result.profile;
        },
    };
}

// ------------------------------------------------------------------------------------------------------------------
// A run

export async function runFanOut(scenario: FanOutScenario): Promise<FanOutResult> {
    const config = {
        sockets: scenario.sockets,
        movingFraction: scenario.movingFraction,
        movesPerSecond: scenario.movesPerSecond,
        budget: scenario.budget,
        warmUpSeconds: scenario.warmUpSeconds ?? 3,
        windowSeconds: scenario.windowSeconds ?? 4,
        backBatchMs: scenario.backBatchMs ?? 50,
        batchIntervalMs: scenario.batchIntervalMs ?? 100,
        earlyFlushMs: scenario.earlyFlushMs ?? 0,
        stopsPerWalkerPerSecond: scenario.stopsPerWalkerPerSecond ?? 0,
        nativeSendMicrosPerFrame: scenario.nativeSendMicrosPerFrame ?? 21,
        observers: Math.min(scenario.observers ?? 6, scenario.sockets),
        profile: scenario.profile ?? false,
        countOperations: scenario.countOperations ?? false,
        wanderPx: scenario.wanderPx ?? 0,
        wanderPeriodSeconds: scenario.wanderPeriodSeconds ?? 8,
        nearestRanks: scenario.nearestRanks ?? scenario.budget?.fullRatePeers ?? scenario.sockets,
    };
    const clock = new VirtualClock();
    return withVirtualClock(clock, async () => {
        const layout = denseLayout(config.sockets);
        // Every SocketManager listens to the emitter, and a bench builds one per run.
        clientEventsEmitter.setMaxListeners(0);
        const socketManager = new SocketManager(undefined, config.budget);
        const room = {
            subscribeToZone: () => undefined,
            unsubscribeFromZone: () => undefined,
        } as unknown as PusherRoom;
        const dispatcher = new PositionDispatcher("bench-room", 320, 320, socketManager, room);

        // Users are 1..N. Walkers are spread evenly through the list, observers sit between them and do not walk.
        const walkerCount = Math.round(config.sockets * config.movingFraction);
        const isWalker = new Array<boolean>(config.sockets).fill(false);
        for (let index = 0; index < walkerCount; index++) {
            isWalker[Math.floor((index * config.sockets) / walkerCount)] = true;
        }
        const observerIndexes: number[] = [];
        const stationary = layout.homes.map((_, index) => index).filter((index) => !isWalker[index]);
        // Observers can receive and send in the same run. Sample walking sockets
        // too when there are fewer stationary sockets than requested observers.
        const candidates = stationary.length >= config.observers ? stationary : layout.homes.map((_, index) => index);
        for (let i = 0; i < config.observers; i++) {
            observerIndexes.push(candidates[Math.floor((i * candidates.length) / config.observers)]);
        }
        const observerSet = new Set(observerIndexes);

        const messagesAtStart = await counted("workadventure_pusher_sub_messages_total");
        const sinks = layout.homes.map((home, index) =>
            makeSink(index + 1, home, clock, observerSet.has(index), {
                intervalMs: config.batchIntervalMs,
                earlyFlushMs: config.earlyFlushMs,
            }),
        );
        for (const sink of sinks) {
            dispatcher.setViewport(sink.socket, sink.socket.getUserData().viewport);
        }
        for (const [index, home] of layout.homes.entries()) {
            dispatcher.handleZoneMessage(joinedZoneMessage(index + 1, home));
        }

        // The schedule of the back: for every batch end, the moves it delivers. Built before anything is measured.
        const totalMs = (config.warmUpSeconds + config.windowSeconds) * 1000;
        const periodMs = 1000 / config.movesPerSecond;
        const burstCount = Math.ceil(totalMs / config.backBatchMs);
        const bursts: ZoneMessage[][] = Array.from({ length: burstCount + 1 }, () => []);
        // Per walker, per step slot: when it sent the move, and when the dispatcher received it.
        const sentAt = new Map<number, Float64Array>();
        const receivedAt = new Map<number, Float64Array>();
        const startMs = clock.now;
        let phaseIndex = 0;
        const phases = new Map<number, number>();
        for (const [index, home] of layout.homes.entries()) {
            if (!isWalker[index]) {
                continue;
            }
            const userId = index + 1;
            const phase = (phaseIndex++ * periodMs) / Math.max(1, walkerCount);
            phases.set(userId, phase);
            const sent = new Float64Array(WIGGLE_STEPS);
            const received = new Float64Array(WIGGLE_STEPS);
            sentAt.set(userId, sent);
            receivedAt.set(userId, received);
            for (let step = 0; ; step++) {
                const at = Math.round(phase + step * periodMs);
                if (at >= totalMs) {
                    break;
                }
                const burst = Math.ceil(at / config.backBatchMs);
                const { dx, dy } =
                    config.wanderPx > 0
                        ? circle(userId, at, config.wanderPx, config.wanderPeriodSeconds)
                        : wiggle(step);
                // Stops evenly spread among the moves: step n is one when it crosses a multiple of moves / stops.
                const isStop =
                    config.stopsPerWalkerPerSecond > 0 &&
                    Math.floor(((step + 1) * config.stopsPerWalkerPerSecond) / config.movesPerSecond) !==
                        Math.floor((step * config.stopsPerWalkerPerSecond) / config.movesPerSecond);
                bursts[burst].push(movedZoneMessage(userId, home.x + dx, home.y + dy, !isStop));
                // The last write wins a slot; a slot is reused after 64 steps, far beyond any latency measured here.
                if (at >= config.warmUpSeconds * 1000) {
                    sent[step % WIGGLE_STEPS] = startMs + at;
                    received[step % WIGGLE_STEPS] = startMs + burst * config.backBatchMs;
                }
            }
        }

        // Where a user stands at `at` ms into the run: its home, plus the offset of the last step it sent by then.
        const positionAt = (userId: number, at: number): { x: number; y: number } => {
            const home = layout.homes[userId - 1];
            const phase = phases.get(userId);
            if (phase === undefined || at < phase) {
                return home;
            }
            const step = Math.floor((at - phase) / periodMs);
            const sentAtMs = Math.round(phase + step * periodMs);
            const { dx, dy } =
                config.wanderPx > 0
                    ? circle(userId, sentAtMs, config.wanderPx, config.wanderPeriodSeconds)
                    : wiggle(step);
            return { x: home.x + dx, y: home.y + dy };
        };

        const run = (fromBurst: number, toBurst: number): void => {
            for (let burst = fromBurst; burst <= toBurst; burst++) {
                const burstTime = startMs + burst * config.backBatchMs;
                clock.advanceTo(burstTime);
                for (const message of bursts[burst]) {
                    dispatcher.handleZoneMessage(message);
                }
            }
        };

        const warmUpBursts = Math.floor((config.warmUpSeconds * 1000) / config.backBatchMs);
        const windowBursts = Math.floor((config.windowSeconds * 1000) / config.backBatchMs);
        // Warm-up: the joins flush, the timers fall into step, the code is compiled.
        run(0, warmUpBursts - 1);
        for (const sink of sinks) {
            sink.frames = 0;
            sink.bytes = 0;
            sink.kept?.splice(0);
        }
        const messagesBefore = await counted("workadventure_pusher_sub_messages_total");
        const admissionPerSocket = {
            joins:
                ((messagesBefore.get("userJoinedMessage") ?? 0) - (messagesAtStart.get("userJoinedMessage") ?? 0)) /
                config.sockets,
            leaves:
                ((messagesBefore.get("userLeftMessage") ?? 0) - (messagesAtStart.get("userLeftMessage") ?? 0)) /
                config.sockets,
        };

        const counters = { emits: 0, listenerCalls: 0, ranks: 0, rankedPeers: 0 };
        const stopCounting = config.countOperations ? countOperations(counters) : undefined;
        const profiler = config.profile ? await startProfile() : undefined;
        clock.startRecording();
        const cpuBefore = nodeProcess.cpuUsage();
        run(warmUpBursts, warmUpBursts + windowBursts - 1);
        // Land the batches still waiting: the window ends on a back burst, a batch timer may be pending.
        clock.advanceTo(startMs + (warmUpBursts + windowBursts) * config.backBatchMs - 1);
        const cpuAfter = nodeProcess.cpuUsage(cpuBefore);
        clock.stopRecording();
        stopCounting?.();
        const profile = profiler === undefined ? undefined : await profiler.stop();
        const liveTimers = clock.liveTimers;

        const messagesAfter = await counted("workadventure_pusher_sub_messages_total");
        const delta = (type: string) => (messagesAfter.get(type) ?? 0) - (messagesBefore.get(type) ?? 0);
        const windowSeconds = (windowBursts * config.backBatchMs) / 1000;
        const moves = delta("userMovedMessage");
        const joins = delta("userJoinedMessage");
        const leaves = delta("userLeftMessage");
        const total = moves + joins + leaves;
        const cpuMs = (cpuAfter.user + cpuAfter.system) / 1000;

        // The herds: the service time of a group of timers is its measured JS CPU plus the derived native send.
        const nativeMs = config.nativeSendMicrosPerFrame / 1000;
        const serviceMs = (group: TimerGroup) => group.jsCpuMs + group.frames * nativeMs;
        const herdGroups = clock.groups.filter((group) => group.frames >= Math.max(2, config.sockets / 10));
        const flushBusyMs = clock.groups.reduce((sum, group) => sum + (group.frames > 0 ? serviceMs(group) : 0), 0);

        // Latency, from the frames of the observers; decoding is outside the measured section.
        const pusherHop: number[] = [];
        const sendToWrite: number[] = [];
        const sendToWriteWithService: number[] = [];
        const sendToWriteWithNative: number[] = [];
        const nearestLatency: number[] = [];
        const farLatency: number[] = [];
        let nearestDelivered = 0;
        let nearestExpected = 0;
        let observedStops = 0;
        for (const index of observerIndexes) {
            const sink = sinks[index];
            const observed: { userId: number; slot: number; latency: number; sent: number }[] = [];
            for (const { time, frame, group, position: place } of sink.kept ?? []) {
                const message = PusherToFrontWebSocketMessage.decode(frame).message?.message;
                if (message?.$case !== "batchMessage") {
                    continue;
                }
                for (const sub of message.batchMessage.payload) {
                    if (sub.message?.$case !== "userMovedMessage") {
                        continue;
                    }
                    const { userId, position } = sub.message.userMovedMessage;
                    const home = layout.homes[userId - 1];
                    if (position === undefined || home === undefined || !isWalker[userId - 1]) {
                        continue;
                    }
                    if (position.moving === false) {
                        observedStops += 1;
                    }
                    const slot = slotOf(home, position.x, position.y);
                    if (slot < 0) {
                        continue;
                    }
                    const received = receivedAt.get(userId)?.[slot] ?? 0;
                    const sent = sentAt.get(userId)?.[slot] ?? 0;
                    if (received === 0 || time < received) {
                        continue; // a move of the warm-up, or a slot not set in the window
                    }
                    pusherHop.push(time - received);
                    sendToWrite.push(time - sent);
                    observed.push({ userId, slot, latency: time - sent, sent });
                    const herd = group >= 0 ? clock.groups[group] : undefined;
                    const wait =
                        herd === undefined || herd.frames === 0 ? 0 : ((place + 1) / herd.frames) * serviceMs(herd);
                    sendToWriteWithService.push(time - sent + wait);
                    sendToWriteWithNative.push(time - sent + (herd === undefined ? 0 : (place + 1) * nativeMs));
                }
            }
            // Whether a user is among the `nearestRanks` users nearest to the observer, by where everybody stood when the move
            // was sent (all of them with the budget off), whatever the budget did with it. By rank at that instant and not by
            // the home of the user: the walkers of a dense room step further than the distance between two ranks, so the
            // nearest 150 of a second ago are not the nearest 150 now, and the budget ranks by position. A user that the
            // budget left at 1 Hz although it is among the nearest then counts as nearest, where it belongs.
            const nearestAt = new Map<number, Set<number>>();
            const isNearest = (userId: number, sentMs: number): boolean => {
                const bucket = Math.floor((sentMs - startMs) / periodMs);
                let nearest = nearestAt.get(bucket);
                if (nearest === undefined) {
                    const at = bucket * periodMs;
                    const me = positionAt(index + 1, at);
                    const ranked = layout.homes
                        .map((_, otherIndex) => {
                            const other = positionAt(otherIndex + 1, at);
                            return { userId: otherIndex + 1, distance: Math.hypot(other.x - me.x, other.y - me.y) };
                        })
                        .filter((other) => other.userId !== index + 1)
                        .sort((x, y) => x.distance - y.distance || x.userId - y.userId);
                    nearest = new Set(ranked.slice(0, config.nearestRanks).map((other) => other.userId));
                    nearestAt.set(bucket, nearest);
                }
                return nearest.has(userId);
            };
            const deliveredSlots = new Map<number, Set<number>>();
            for (const { userId, slot, latency, sent } of observed) {
                (isNearest(userId, sent) ? nearestLatency : farLatency).push(latency);
                const slots = deliveredSlots.get(userId);
                if (slots === undefined) {
                    deliveredSlots.set(userId, new Set([slot]));
                } else {
                    slots.add(slot);
                }
            }
            // Of every move a walker sent in the window while it was among the nearest, how many reached this observer.
            for (const [userId, sentTimes] of sentAt) {
                for (const [slot, sent] of sentTimes.entries()) {
                    if (sent === 0 || userId === index + 1 || !isNearest(userId, sent)) {
                        continue;
                    }
                    nearestExpected += 1;
                    nearestDelivered += deliveredSlots.get(userId)?.has(slot) === true ? 1 : 0;
                }
            }
        }

        const frames = sinks.reduce((sum, sink) => sum + sink.frames, 0);
        const bytes = sinks.reduce((sum, sink) => sum + sink.bytes, 0);
        for (const sink of sinks) {
            sink.socket.end();
        }

        return {
            scenario: config,
            cpuMsPerSimSecond: cpuMs / windowSeconds,
            cpuNsPerDelivery: total === 0 ? Number.NaN : (cpuMs * 1e6) / total,
            deliveriesPerSecond: {
                moves: moves / windowSeconds,
                joins: joins / windowSeconds,
                leaves: leaves / windowSeconds,
                total: total / windowSeconds,
            },
            bytesPerSecond: bytes / windowSeconds,
            framesPerSecond: frames / windowSeconds,
            timersPerSocket: liveTimers / config.sockets,
            pusherHopMs: summarize(pusherHop),
            sendToWriteMs: summarize(sendToWrite),
            sendToWriteWithServiceMs: summarize(sendToWriteWithService),
            sendToWriteWithNativeMs: summarize(sendToWriteWithNative),
            nearestSendToWriteMs: summarize(nearestLatency),
            farSendToWriteMs: summarize(farLatency),
            // A walker on a circle sends positions the decoder cannot name, so nothing is measured for it.
            nearestDeliveredShare:
                nearestExpected === 0 || config.wanderPx > 0 ? Number.NaN : nearestDelivered / nearestExpected,
            operations: config.countOperations ? operationCounts(counters, frames, windowSeconds) : undefined,
            flushNativeCores: (frames * nativeMs) / 1000 / windowSeconds,
            herds: {
                perSecond: herdGroups.length / windowSeconds,
                jsMs: summarize(herdGroups.map((group) => group.jsCpuMs)),
                derivedTotalMs: summarize(herdGroups.map(serviceMs)),
                longest: clock.groups.reduce(
                    (longest, group) =>
                        group.jsCpuMs > longest.jsMs
                            ? { jsMs: group.jsCpuMs, timers: group.timers, frames: group.frames }
                            : longest,
                    { jsMs: 0, timers: 0, frames: 0 },
                ),
            },
            flushBusyCores: flushBusyMs / 1000 / windowSeconds,
            observedStops,
            syntheticJoinLeavePerSecond: (joins + leaves) / windowSeconds,
            admissionPerSocket,
            profileTop: profile === undefined ? undefined : summarizeProfile(profile),
        };
    });
}

function operationCounts(
    counters: Omit<OperationCounts, "frames" | "total" | "windowSeconds" | "perSecond">,
    frames: number,
    windowSeconds: number,
): OperationCounts {
    const total = counters.emits + counters.listenerCalls + counters.rankedPeers + frames;
    return {
        ...counters,
        frames,
        total,
        windowSeconds,
        perSecond: {
            emits: counters.emits / windowSeconds,
            listenerCalls: counters.listenerCalls / windowSeconds,
            ranks: counters.ranks / windowSeconds,
            rankedPeers: counters.rankedPeers / windowSeconds,
            frames: frames / windowSeconds,
            total: total / windowSeconds,
        },
    };
}

function medianRun(runs: FanOutResult[]): FanOutResult {
    const sorted = [...runs].sort((x, y) => x.cpuMsPerSimSecond - y.cpuMsPerSimSecond);
    return sorted[Math.floor(sorted.length / 2)];
}

/** The scenario repeated `repeats` times: the run with the median CPU, and the spread of the CPU over all of them. */
export async function runRepeated(
    scenario: FanOutScenario,
    repeats: number,
): Promise<{ median: FanOutResult; cpuMsPerSimSecond: number[] }> {
    const results: FanOutResult[] = [];
    for (let index = 0; index < repeats; index++) {
        results.push(await runFanOut({ ...scenario, profile: false }));
    }
    return {
        median: medianRun(results),
        cpuMsPerSimSecond: results.map((r) => r.cpuMsPerSimSecond).sort((a, b) => a - b),
    };
}

export interface InterleavedArm {
    /** Complete observations in execution order, paired by index with the other arm. */
    repeats: FanOutResult[];
    /** The run with the median CPU of this arm. */
    median: FanOutResult;
    /** The place of each repeat within its round: 0 for the arm that ran first. Alternates, so the order is counterbalanced. */
    turns: number[];
    /** The CPU of each repeat, in the order they ran (the same order as in the other arms), ms per simulated second. */
    cpuMsPerSimSecond: number[];
    /**
     * The CPU of each repeat over the CPU of the same repeat of the first arm. A repeat of every arm runs, one after
     * the other, before the next round begins, so a pair saw the same host load; the median of the ratios is the
     * figure to quote, not the ratio of the medians. 1 for the first arm.
     */
    ratioToFirst: number[];
    medianRatioToFirst: number;
}

/**
 * Runs the scenarios `repeats` times, one repeat of each in turn: arm 0, arm 1; then arm 1, arm 0; and so on. A drift in
 * the load of the host moves every arm together and cancels in the ratio of a pair, and the alternating order cancels
 * what the arm before leaves behind.
 */
export async function runInterleaved(scenarios: FanOutScenario[], repeats: number): Promise<InterleavedArm[]> {
    const runs: FanOutResult[][] = scenarios.map(() => []);
    const turns: number[][] = scenarios.map(() => []);
    for (let round = 0; round < repeats; round++) {
        // Counterbalanced: odd rounds run the arms in the opposite order, so that a first-in-round effect (JIT, caches,
        // the garbage left by the arm before) falls on each arm as often as on the other.
        const order = scenarios.map((_, arm) => arm);
        if (round % 2 === 1) {
            order.reverse();
        }
        for (const [turn, arm] of order.entries()) {
            runs[arm].push(await runFanOut({ ...scenarios[arm], profile: false }));
            turns[arm].push(turn);
        }
    }
    return runs.map((armRuns, arm) => {
        const ratioToFirst = armRuns.map((run, round) => run.cpuMsPerSimSecond / runs[0][round].cpuMsPerSimSecond);
        const sortedRatios = [...ratioToFirst].sort((a, b) => a - b);
        return {
            repeats: armRuns,
            median: medianRun(armRuns),
            cpuMsPerSimSecond: armRuns.map((run) => run.cpuMsPerSimSecond),
            turns: turns[arm],
            ratioToFirst,
            medianRatioToFirst: sortedRatios[Math.floor(sortedRatios.length / 2)],
        };
    });
}

/** The CPU of a bench is quoted only when the host was quiet: below this load per core, and below this spread. */
export const MAX_LOAD_PER_CORE = 1;
export const MAX_SPREAD = 1.3;

/**
 * Whether the CPU figures of a scenario can be trusted: the 1-minute load average per core must not exceed
 * MAX_LOAD_PER_CORE, and the slowest repeat must be within MAX_SPREAD of the fastest. The counts (frames, joins,
 * leaves, virtual latencies) do not depend on it.
 */
export function judgeRun(
    cpuMsPerSimSecond: number[],
    loadAverage1: number = os.loadavg()[0],
    cores: number = os.cpus().length,
): { valid: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const load = loadAverage1 / Math.max(1, cores);
    if (load > MAX_LOAD_PER_CORE) {
        reasons.push(`load ${loadAverage1.toFixed(0)} on ${cores} cores`);
    }
    const spread = Math.max(...cpuMsPerSimSecond) / Math.min(...cpuMsPerSimSecond);
    if (spread > MAX_SPREAD) {
        reasons.push(`spread ${spread.toFixed(2)}x`);
    }
    return { valid: reasons.length === 0, reasons };
}

/** One line per result, for a log: what the scenario was and what it cost. */
export function formatResult(result: FanOutResult, spread?: number[]): string {
    const { scenario } = result;
    const fixed = (value: number, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : "n/a");
    const cpu =
        spread === undefined
            ? fixed(result.cpuMsPerSimSecond)
            : `${fixed(result.cpuMsPerSimSecond)} [${spread.map((value) => fixed(value, 0)).join(" ")}]`;
    const validity = spread === undefined ? undefined : judgeRun(spread);
    return [
        `N=${scenario.sockets}`,
        `back=${scenario.backBatchMs}ms pusher=${scenario.batchIntervalMs}ms${scenario.earlyFlushMs > 0 ? `/early ${scenario.earlyFlushMs}ms` : ""}`,
        `walk=${Math.round(scenario.movingFraction * 100)}%@${scenario.movesPerSecond}Hz${scenario.stopsPerWalkerPerSecond > 0 ? ` stops=${scenario.stopsPerWalkerPerSecond}/s` : ""}`,
        scenario.budget === undefined
            ? "budget=off"
            : `budget=${scenario.budget.fullRatePeers}/${scenario.budget.maxPeers}`,
        `cpu=${cpu} ms/s${validity === undefined ? "" : validity.valid ? " VALID" : ` INVALID(${validity.reasons.join(", ")})`}`,
        `${fixed(result.cpuNsPerDelivery, 0)} ns/delivery`,
        `deliv=${fixed(result.deliveriesPerSecond.total, 0)}/s (moves ${fixed(result.deliveriesPerSecond.moves, 0)})`,
        `bytes=${fixed(result.bytesPerSecond / 1000, 0)} kB/s`,
        `frames=${fixed(result.framesPerSecond, 0)}/s (${fixed(result.bytesPerSecond / Math.max(1, result.framesPerSecond), 0)} B each)`,
        `timers/socket=${fixed(result.timersPerSocket, 2)}`,
        `hop p50/p95/p99/max=${fixed(result.pusherHopMs.p50, 0)}/${fixed(result.pusherHopMs.p95, 0)}/${fixed(result.pusherHopMs.p99, 0)}/${fixed(result.pusherHopMs.max, 0)} ms`,
        `herd js p50/p95/max=${fixed(result.herds.jsMs.p50, 1)}/${fixed(result.herds.jsMs.p95, 1)}/${fixed(result.herds.jsMs.max, 1)} ms x${fixed(result.herds.perSecond, 1)}/s, longest group ${fixed(result.herds.longest.jsMs, 1)} ms for ${result.herds.longest.timers} timers and ${result.herds.longest.frames} frames`,
        `flush-busy=${fixed(result.flushBusyCores, 2)} cores (DERIVED, native send ${scenario.nativeSendMicrosPerFrame} us/frame)`,
        `send-to-write+service p95/max=${fixed(result.sendToWriteWithServiceMs.p95, 0)}/${fixed(result.sendToWriteWithServiceMs.max, 0)} ms (DERIVED)`,
        `join+leave=${fixed(result.syntheticJoinLeavePerSecond, 1)}/s`,
        `admission/socket=${fixed(result.admissionPerSocket.joins, 0)}j+${fixed(result.admissionPerSocket.leaves, 0)}l`,
    ].join("  ");
}
