import { type FrameAccounting, SPACE_ROSTER_CASES, WORLD_SPACE_NAME } from "./protocol";

export type Counter = Record<string, number>;

/** A span of the run, in performance.now() milliseconds, end excluded. */
export interface TimeWindow {
    startMs: number;
    endMs: number;
}

export function isInWindow(window: TimeWindow | undefined, nowMs: number): boolean {
    return window === undefined || (nowMs >= window.startMs && nowMs < window.endMs);
}

export function increment(counter: Counter, key: string): void {
    counter[key] = (counter[key] ?? 0) + 1;
}

/** Nearest-rank percentile; null when there is no sample, so an empty run cannot report a latency of 0. */
export function percentile(samples: readonly number[], fraction: number): number | null {
    if (samples.length === 0) {
        return null;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil(fraction * sorted.length));
    return sorted[rank - 1];
}

/**
 * monitorEventLoopDelay times a timer that is due every `resolutionMs`, so an idle loop reads about the resolution.
 * The lag is what exceeds it; a timer that fired early is no lag.
 */
export function eventLoopLagMs(delayNanoseconds: number, resolutionMs: number): number {
    return Math.max(0, delayNanoseconds / 1e6 - resolutionMs);
}

/** Tracks every timer the harness owns, so a stop can prove none is left behind. */
export class TimerRegistry {
    private readonly timeouts = new Set<NodeJS.Timeout>();
    private readonly intervals = new Set<NodeJS.Timeout>();

    public get activeCount(): number {
        return this.timeouts.size + this.intervals.size;
    }

    public setTimeout(callback: () => void, delayMs: number): NodeJS.Timeout {
        const handle = setTimeout(() => {
            this.timeouts.delete(handle);
            callback();
        }, delayMs);
        this.timeouts.add(handle);
        return handle;
    }

    public setInterval(callback: () => void, delayMs: number): NodeJS.Timeout {
        const handle = setInterval(callback, delayMs);
        this.intervals.add(handle);
        return handle;
    }

    public clear(handle: NodeJS.Timeout | undefined): void {
        if (handle === undefined) {
            return;
        }
        clearTimeout(handle);
        clearInterval(handle);
        this.timeouts.delete(handle);
        this.intervals.delete(handle);
    }
}

export interface TypeTraffic {
    /** Frames that carried at least one message of this type. */
    frames: number;
    messages: number;
    /** Rows carried: the users of a roster snapshot count one each. */
    records: number;
    bytes: number;
}

function emptyTraffic(): TypeTraffic {
    return { frames: 0, messages: 0, records: 0, bytes: 0 };
}

const ROSTER_CASES = new Set<string>(SPACE_ROSTER_CASES);

/** The per-second bucket that holds the world space's share of a roster message type. */
export function worldSecondKey(type: string): string {
    return `world:${type}`;
}

/**
 * What the server sent, by message type: every type under `byType`, and the roster messages of the world space again
 * under `world`. Only frames received inside the window count; without a window, all of them.
 */
export class TrafficStats {
    public frames = 0;
    public bytes = 0;
    public overheadBytes = 0;
    public readonly byType = new Map<string, TypeTraffic>();
    public readonly world = new Map<string, TypeTraffic>();
    /** Frames that carried at least one roster message of the world space. */
    public worldFrames = 0;
    /** Bytes received in each wall-clock second of the run, by type, to find the busiest second. */
    private readonly perSecond = new Map<number, Map<string, number>>();

    public constructor(
        private readonly originMs: number,
        private readonly window: TimeWindow | undefined,
    ) {}

    public record(nowMs: number, frameBytes: number, accounting: FrameAccounting): void {
        if (!isInWindow(this.window, nowMs)) {
            return;
        }
        this.frames += 1;
        this.bytes += frameBytes;
        this.overheadBytes += accounting.overheadBytes;
        const second = Math.floor((nowMs - this.originMs) / 1000);
        let secondBytes = this.perSecond.get(second);
        if (secondBytes === undefined) {
            secondBytes = new Map<string, number>();
            this.perSecond.set(second, secondBytes);
        }
        const typesInFrame = new Set<string>();
        const worldTypesInFrame = new Set<string>();
        for (const message of accounting.messages) {
            const traffic = this.trafficOf(this.byType, message.type);
            traffic.messages += 1;
            traffic.records += message.records;
            traffic.bytes += message.bytes;
            secondBytes.set(message.type, (secondBytes.get(message.type) ?? 0) + message.bytes);
            if (!typesInFrame.has(message.type)) {
                typesInFrame.add(message.type);
                traffic.frames += 1;
            }
            if (ROSTER_CASES.has(message.type) && message.spaceName === WORLD_SPACE_NAME) {
                const world = this.trafficOf(this.world, message.type);
                world.messages += 1;
                world.records += message.records;
                world.bytes += message.bytes;
                const worldKey = worldSecondKey(message.type);
                secondBytes.set(worldKey, (secondBytes.get(worldKey) ?? 0) + message.bytes);
                if (!worldTypesInFrame.has(message.type)) {
                    worldTypesInFrame.add(message.type);
                    world.frames += 1;
                }
            }
        }
        if (worldTypesInFrame.size > 0) {
            this.worldFrames += 1;
        }
    }

    /** The most bytes of `type` received in one second of the window; 0 when there were none. */
    public peakBytesPerSecond(type: string): number {
        let peak = 0;
        for (const secondBytes of this.perSecond.values()) {
            peak = Math.max(peak, secondBytes.get(type) ?? 0);
        }
        return peak;
    }

    private trafficOf(map: Map<string, TypeTraffic>, type: string): TypeTraffic {
        let traffic = map.get(type);
        if (traffic === undefined) {
            traffic = emptyTraffic();
            map.set(type, traffic);
        }
        return traffic;
    }
}

export interface TypeTrafficReport extends TypeTraffic {
    messagesPerSecond: number | null;
    bytesPerSecond: number | null;
    /** The busiest single second of the window. */
    peakBytesPerSecond: number;
    /** Received bandwidth per accepted session; null without a measured span or sessions. */
    kbitPerSecondPerSession: number | null;
}

function perSecond(total: number, seconds: number): number | null {
    return seconds > 0 ? Number((total / seconds).toFixed(2)) : null;
}

/** Rates per type over `measuredSeconds`, and per accepted session for the bandwidth. */
export function reportTypeTraffic(
    traffic: ReadonlyMap<string, TypeTraffic>,
    measuredSeconds: number,
    sessions: number,
    peakBytesPerSecond: (type: string) => number,
): Record<string, TypeTrafficReport> {
    const report: Record<string, TypeTrafficReport> = {};
    for (const [type, entry] of [...traffic.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        report[type] = {
            ...entry,
            messagesPerSecond: perSecond(entry.messages, measuredSeconds),
            bytesPerSecond: perSecond(entry.bytes, measuredSeconds),
            peakBytesPerSecond: peakBytesPerSecond(type),
            kbitPerSecondPerSession:
                sessions > 0 ? perSecond((entry.bytes * 8) / 1000 / sessions, measuredSeconds) : null,
        };
    }
    return report;
}

export function perSecondOf(total: number, seconds: number): number | null {
    return perSecond(total, seconds);
}

export interface RoomStats {
    started: number;
    accepted: number;
    rejected: number;
    userIds: Set<number>;
}

/** Plain counters shared by every session of one run. Accepted room sessions and open sockets are separate. */
export class RunStats {
    public readonly traffic: TrafficStats;
    public started = 0;
    public accepted = 0;
    public rejected = 0;
    public abortedBeforeJoin = 0;
    public unexpectedCloses = 0;
    public socketsOpened = 0;
    public socketsOpen = 0;
    public socketsOpenPeak = 0;
    public socketsClosed = 0;
    /** Frames and bytes inside the steady window (the whole run without one). */
    public receivedFrames = 0;
    public receivedBytes = 0;
    public receivedFramesTotal = 0;
    public receivedBytesTotal = 0;
    public readonly joinLatenciesMs: number[] = [];
    public worldSpaceJoined = 0;
    public worldSpaceWatching = 0;
    public readonly worldSpaceJoinLatenciesMs: number[] = [];
    public readonly worldSpaceJoinErrors: Counter = {};
    public readonly sent: Counter = {};
    public readonly received: Counter = {};
    public readonly rejections: Counter = {};
    public readonly errors: Counter = {};
    public readonly closeCodes: Counter = {};
    public readonly rooms = new Map<string, RoomStats>();

    /** `window` limits the traffic counters to the steady phase; `originMs` is when the run started. */
    public constructor(
        originMs = performance.now(),
        public readonly window: TimeWindow | undefined = undefined,
    ) {
        this.traffic = new TrafficStats(originMs, window);
    }

    public room(roomUrl: string): RoomStats {
        let room = this.rooms.get(roomUrl);
        if (room === undefined) {
            room = { started: 0, accepted: 0, rejected: 0, userIds: new Set() };
            this.rooms.set(roomUrl, room);
        }
        return room;
    }

    public socketOpened(): void {
        this.socketsOpened += 1;
        this.socketsOpen += 1;
        this.socketsOpenPeak = Math.max(this.socketsOpenPeak, this.socketsOpen);
    }

    /** A handshake that never opened still reports a close code, but it never counted as an open socket. */
    public socketClosed(code: number, wasOpen: boolean): void {
        if (wasOpen) {
            this.socketsOpen -= 1;
            this.socketsClosed += 1;
        }
        increment(this.closeCodes, String(code));
    }
}
