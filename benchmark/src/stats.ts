export type Counter = Record<string, number>;

export function increment(counter: Counter, key: string, by = 1): void {
    counter[key] = (counter[key] ?? 0) + by;
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

    public clearAll(): void {
        for (const handle of [...this.timeouts, ...this.intervals]) {
            this.clear(handle);
        }
    }
}

export interface RoomStats {
    started: number;
    accepted: number;
    rejected: number;
    userIds: Set<number>;
}

/** Plain counters shared by every session of one run. Accepted room sessions and open sockets are separate. */
export class RunStats {
    public started = 0;
    public accepted = 0;
    public rejected = 0;
    public abortedBeforeJoin = 0;
    public unexpectedCloses = 0;
    public socketsOpened = 0;
    public socketsOpen = 0;
    public socketsOpenPeak = 0;
    public socketsClosed = 0;
    public receivedFrames = 0;
    public receivedBytes = 0;
    public readonly joinLatenciesMs: number[] = [];
    public readonly sent: Counter = {};
    public readonly received: Counter = {};
    public readonly rejections: Counter = {};
    public readonly errors: Counter = {};
    public readonly closeCodes: Counter = {};
    public readonly rooms = new Map<string, RoomStats>();

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
