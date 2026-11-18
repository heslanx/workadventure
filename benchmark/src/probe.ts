import type { Position, Viewport } from "./protocol";
import { type TimeWindow, isInWindow, percentile } from "./stats";

/**
 * The ellipse returns to the same rounded point after 377 steps (three turns of 0.05 rad), so a received position can
 * match several steps. Matching walks back from the mover's latest step and takes the first hit: the most recent
 * send. A window of 376 steps holds each point at most once, so a move delayed by a full repeat period (about 75 s at
 * 5 Hz) or more is reported as unmatched instead of being matched to a later send. A pattern with a shorter period
 * passes its own look-back through `lookbackSteps`.
 */
const LOOKBACK_STEPS = 376;

/** Expected deliveries are keyed by mover index and step; steps stay below this (about 4.8 days at 5 Hz). */
const STEP_SPAN = 2 ** 21;

export interface MoveProbeOptions {
    /** Room URL of each session index; movers and observers only match within the same room. */
    roomUrlOf: readonly string[];
    /** Index of the first observer; the `observers` sessions from there observe deliveries. */
    firstObserver: number;
    observers: number;
    positionOf: (index: number, step: number) => Position;
    /** How many steps back a received position may match; the period of the movement pattern minus one. */
    lookbackSteps?: number;
    /**
     * Only moves sent inside the window count as expected or received, and only arrivals inside it count as stray.
     * Moves sent outside it are still followed, so their late arrivals are ignored rather than called unexpected.
     */
    window?: TimeWindow;
}

export interface MoveProbeSummary {
    observers: number;
    moveLatencyMs: { count: number; p50: number | null; p95: number | null; p99: number | null };
    delivery: { expected: number; received: number; ratio: number | null };
    /** Arrivals from a bot of this process that matched a step the observer did not expect, or already received. */
    outsideExpectation: number;
    /** Arrivals from a bot of this process that matched no sent step inside the lookback window. */
    unmatched: number;
}

/** received / expected; null without expectations, so an idle run cannot report a perfect ratio. */
export function deliveryRatio(received: number, expected: number): number | null {
    return expected === 0 ? null : received / expected;
}

/**
 * Observers start after the planned early leavers, so churn does not end the probe; with too few sessions left they
 * start at the last `observers` sessions instead.
 */
export function firstObserverIndex(sessions: number, earlyLeavers: number, observers: number): number {
    return Math.min(earlyLeavers, Math.max(0, sessions - observers));
}

function insideViewport(viewport: Viewport, position: Position): boolean {
    return (
        position.x >= viewport.left &&
        position.x <= viewport.right &&
        position.y >= viewport.top &&
        position.y <= viewport.bottom
    );
}

/**
 * Measures move delivery inside one generator process. Movers record when each move was sent and which observers
 * should receive it; observers count an arrival as received only when it matches one of those expected deliveries.
 * Both sides only see bots of this process, so the ratio is per process.
 */
export class MoveProbe {
    private readonly sentAt: number[][];
    private readonly viewports: (Viewport | undefined)[];
    private readonly accepted: boolean[];
    private readonly indexByUser = new Map<string, number>();
    private readonly expectedKeys: Set<number>[];
    /** Deliveries expected of moves sent outside the window; not counted, but known, so they are not "unexpected". */
    private readonly outsideWindowKeys: Set<number>[];
    private readonly lookbackSteps: number;
    private readonly firstObserver: number;
    private readonly endObserver: number;
    private readonly latenciesMs: number[] = [];
    private expected = 0;
    private received = 0;
    private outsideExpectation = 0;
    private unmatched = 0;

    public constructor(private readonly options: MoveProbeOptions) {
        const count = options.roomUrlOf.length;
        this.sentAt = Array.from({ length: count }, () => []);
        this.viewports = new Array<Viewport | undefined>(count).fill(undefined);
        this.accepted = new Array<boolean>(count).fill(false);
        this.expectedKeys = Array.from({ length: count }, () => new Set<number>());
        this.outsideWindowKeys = Array.from({ length: count }, () => new Set<number>());
        this.lookbackSteps = options.lookbackSteps ?? LOOKBACK_STEPS;
        this.firstObserver = Math.min(options.firstObserver, count);
        this.endObserver = Math.min(this.firstObserver + options.observers, count);
    }

    public isObserver(index: number): boolean {
        return index >= this.firstObserver && index < this.endObserver;
    }

    public setAccepted(index: number, accepted: boolean): void {
        this.accepted[index] = accepted;
    }

    public setViewport(index: number, viewport: Viewport): void {
        this.viewports[index] = viewport;
    }

    /** Maps the server's user id, which is per room, back to the bot index. */
    public registerUser(index: number, userId: number): void {
        this.indexByUser.set(this.userKey(index, userId), index);
    }

    /** Called when a move is sent. Records the observers that should receive it. */
    public recordSend(index: number, step: number, position: Position, sentAtMs: number): void {
        this.sentAt[index][step] = sentAtMs;
        const counted = isInWindow(this.options.window, sentAtMs);
        for (let observer = this.firstObserver; observer < this.endObserver; observer++) {
            const viewport = this.viewports[observer];
            if (
                observer !== index &&
                this.accepted[observer] &&
                this.options.roomUrlOf[observer] === this.options.roomUrlOf[index] &&
                viewport !== undefined &&
                insideViewport(viewport, position)
            ) {
                if (counted) {
                    this.expectedKeys[observer].add(index * STEP_SPAN + step);
                    this.expected += 1;
                } else {
                    this.outsideWindowKeys[observer].add(index * STEP_SPAN + step);
                }
            }
        }
    }

    /** Called for each received move. Moves from bots outside this process are ignored. */
    public recordReceive(observer: number, userId: number, position: Position, receivedAtMs: number): void {
        if (!this.isObserver(observer) || !this.accepted[observer]) {
            return;
        }
        const index = this.indexByUser.get(this.userKey(observer, userId));
        if (index === undefined) {
            return;
        }
        const arrivedInWindow = isInWindow(this.options.window, receivedAtMs);
        const step = this.findSentStep(index, position);
        if (step === undefined) {
            if (arrivedInWindow) {
                this.unmatched += 1;
            }
            return;
        }
        const key = index * STEP_SPAN + step;
        if (!this.expectedKeys[observer].delete(key)) {
            if (!this.outsideWindowKeys[observer].delete(key) && arrivedInWindow) {
                this.outsideExpectation += 1;
            }
            return;
        }
        this.received += 1;
        this.latenciesMs.push(receivedAtMs - this.sentAt[index][step]);
    }

    public summary(): MoveProbeSummary {
        return {
            observers: this.endObserver - this.firstObserver,
            moveLatencyMs: {
                count: this.latenciesMs.length,
                p50: percentile(this.latenciesMs, 0.5),
                p95: percentile(this.latenciesMs, 0.95),
                p99: percentile(this.latenciesMs, 0.99),
            },
            delivery: {
                expected: this.expected,
                received: this.received,
                ratio: deliveryRatio(this.received, this.expected),
            },
            outsideExpectation: this.outsideExpectation,
            unmatched: this.unmatched,
        };
    }

    private findSentStep(index: number, position: Position): number | undefined {
        const sent = this.sentAt[index];
        const latest = sent.length - 1;
        for (let step = latest; step >= 0 && step >= latest - this.lookbackSteps; step--) {
            if (sent[step] === undefined) {
                continue;
            }
            const expectedPosition = this.options.positionOf(index, step);
            if (expectedPosition.x === position.x && expectedPosition.y === position.y) {
                return step;
            }
        }
        return undefined;
    }

    /** User ids are per room, so the room is part of the key. */
    private userKey(index: number, userId: number): string {
        return `${this.options.roomUrlOf[index]}\u0000${userId}`;
    }
}
