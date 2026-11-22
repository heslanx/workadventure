import type { PusherWebSocket } from "../services/PusherWebSocket";
import { userLeftSubMessage, type UserDescriptor } from "./Zone";

/**
 * How many of the users a socket watches it is told about, and how often. In a dense crowd the zones a viewport covers
 * can hold most of the room, and each walking user sends 5 positions a second to each of them.
 */
export interface ViewerBudgetLimits {
    /** The nearest users, whose every move is sent. */
    fullRatePeers: number;
    /** The most users a socket knows of. A farther one gets no join until it is among the nearest. */
    maxPeers: number;
    /**
     * Admit the first scene by distance. A socket that starts watching a crowd is told about the first `maxPeers` users
     * the zones list, in the order they joined, and a second later the first selection swaps about 60% of them for the
     * ones that are nearer: 400 joins, then 240 leaves and 240 joins, 80 avatars built and dropped a frame, for one
     * connection. With this on, the users are only noted until the end of the event loop turn that told of them, and
     * the first selection, which runs then, joins the nearest ones: 400 joins and nothing taken back. Off by default,
     * because it delays the first join of a socket by one turn.
     */
    admitByDistance?: boolean;
    /**
     * How much closer than it is a user the socket already knows of is ranked, in pixels, so that it keeps its seat
     * against a newcomer that is nearer by less than this. SEAT_MARGIN_PX when not given.
     */
    seatMarginPx?: number;
    /**
     * The deadband of the selection: a user enters the scene at a rank of `maxPeers` or nearer, and a user already in it
     * is kept until its rank is beyond `maxPeers` x this ratio (the same for the full-rate set and `fullRatePeers`).
     * RETAIN_EXIT_RATIO when not given, which is the 80 and 96 of the owner's mandate (a ratio of 1.2). 1 turns it off.
     * The exit rank controls eviction. The hard capacity stays at `maxPeers`, the count the scene is
     * filled to.
     */
    exitRatio?: number;
    /**
     * The least time a user spends in a state before the selection changes it: a user that joined the scene is not
     * dropped, and a user that was dropped is not taken in again, before this many milliseconds, and the same for
     * the full-rate set. RETAIN_COOLDOWN_MS when not given. 0 turns it off.
     */
    cooldownMs?: number;
    /** How often the selection runs, in milliseconds: RERANK_INTERVAL_MS when not given. */
    rerankIntervalMs?: number;
    /**
     * Start the rank timer of a socket at a different instant inside the interval for each socket, so that the ranks of
     * 1000 viewers are not one stall of the event loop. On unless false; the tests that compare two classes by instant
     * turn it off.
     */
    staggerTicks?: boolean;
}

/** A user a socket could hear about; a UserDescriptor is one. */
export interface PeerPoint {
    readonly userId: number;
    getPosition(): { x: number; y: number };
    /** Whether the socket already knows of the user; when a peer says, the `seated` set is not asked. */
    readonly seated?: boolean;
}

export interface BudgetSelection {
    /** The users whose every move is sent. */
    fullRate: Set<number>;
    /** The users the socket knows of: the full-rate ones, then the ones it hears about once a second. */
    inScene: Set<number>;
}

/** How often the moves of a user outside the full-rate set are sent: its last position, once per interval. */
export const CONFLATED_INTERVAL_MS = 1000;

/**
 * How often a budget re-ranks the users it watches, apart from the 5 Hz of the moves: 500 ms, the top of the 250 to 500
 * of the owner's mandate. The moves themselves are not ranked, they are sent to the sockets that are at full rate for
 * their user (O(1) a socket, `fullRate` on the peer and `fullRateWatchers` on the user) or kept for the conflated flush,
 * which stays at CONFLATED_INTERVAL_MS: every second tick of the rank timer.
 *
 * Why not shorter (MEASURED, FanOutBench.test.ts, a walking crowd of 1000): a rank is the cost of the budget, and it
 * runs once per viewer per interval, so halving the interval doubles it. And nothing is gained by it: a user is kept
 * RETAIN_COOLDOWN_MS in any state, so the state of the scene cannot change faster than that.
 */
export const RERANK_INTERVAL_MS = 500;

/**
 * The deadband: a user enters the scene at a rank of K or nearer and leaves it only beyond K x this ratio, so that
 * 80 and 96 for the owner's 80 of the avatars drawn in full, and 150 and 180, 400 and 480 here. A user that hovers
 * around rank K stays on the side it was on, instead of leaving and joining on every selection.
 */
export const RETAIN_EXIT_RATIO = 1.2;

/**
 * The least time a user stays in the state a selection put it in (in the scene or out of it, at full rate or not):
 * 1750 ms, the middle of the 1500 to 2000 of the owner's mandate. Four selections at RERANK_INTERVAL_MS, so a decision
 * is taken on a rank that was stable for that long, not on the position of one step.
 */
export const RETAIN_COOLDOWN_MS = 1750;

/**
 * A user the socket already knows of keeps its place against a newcomer that is closer by less than this, so that users
 * that move a little at the edge of the scene do not leave and join it every second.
 *
 * Why 64 and not 32 (MEASURED, FanOutBench.test.ts "walking crowd" and PUSHER_FANOUT=1, N=1000, budget 150/400, 5 steps
 * a second, 8 s window, no real crossing so every join and leave is synthetic): the contenders for the last seat are
 * users that walk, and two of them can move toward and away from each other. A bench walker steps in a 21 px square, up
 * to 29.7 px along any direction, so two of them differ by up to 59.4 px from one second to the next. With a margin of
 * 32 that is 32.0 joins and leaves a second with 5% of the users walking and 195.8 with 20% (the earlier "55 a second"
 * was the first-selection churn, a different source, fixed by admitByDistance); with 0, 3333 and 11261; with 48, 64 and
 * 96, none. 64 is the least round figure above the worst case of that walk, so it holds for steps up to 32 px in a
 * second a user, not for a user that walks across the scene: that one really leaves and joins it, once.
 * The price: a seated user stays in the scene while a user up to 64 px closer than it is left out, in the ring of the
 * scene that is already the farthest from the viewer.
 */
export const SEAT_MARGIN_PX = 64;

// Scratch space for selectViewerBudget, shared by every socket: a selection runs to its end before the next starts,
// and a tick then allocates nothing in proportion to the crowd but the two sets it returns.
let distances = new Float64Array(0);
let userIds = new Float64Array(0);
let order = new Int32Array(0);
// The peer of each slot, so that the selection reads the peers it chose off an array and not out of a Map.
const slotPeers: PeerPoint[] = [];
// The slots of the users that wait for a seat, and of the members that could give theirs up: a few at a time, apart
// from the first admission, and only put in order when they contend.
const waiting: number[] = [];
const evictable: number[] = [];

function reserve(size: number): void {
    if (distances.length >= size) {
        return;
    }
    const capacity = Math.max(size, distances.length * 2);
    // The peers counted so far are kept: the iterable is read once.
    const kept = { distances, userIds, order };
    distances = new Float64Array(capacity);
    userIds = new Float64Array(capacity);
    order = new Int32Array(capacity);
    distances.set(kept.distances);
    userIds.set(kept.userIds);
    order.set(kept.order);
}

function isNearer(first: number, second: number): boolean {
    return (
        distances[first] < distances[second] ||
        (distances[first] === distances[second] && userIds[first] < userIds[second])
    );
}

function compareDistance(first: number, second: number): number {
    return isNearer(first, second) ? -1 : isNearer(second, first) ? 1 : 0;
}

function compareDistanceFarthestFirst(first: number, second: number): number {
    return compareDistance(second, first);
}

/**
 * Moves the `count` nearest peers of order[from, to) to order[from, from + count), in no particular order. This is a
 * selection (Hoare), linear on average: a viewer needs to know which users are the nearest, not their ranking.
 */
function moveNearestFirst(from: number, to: number, count: number): void {
    const last = from + count - 1;
    let left = from;
    let right = to - 1;
    while (left < right && last >= left && last < right) {
        const pivot = order[(left + right) >> 1];
        let i = left;
        let j = right;
        while (i <= j) {
            while (isNearer(order[i], pivot)) {
                i++;
            }
            while (isNearer(pivot, order[j])) {
                j--;
            }
            if (i <= j) {
                const swapped = order[i];
                order[i] = order[j];
                order[j] = swapped;
                i++;
                j--;
            }
        }
        if (last <= j) {
            right = j;
        } else if (last >= i) {
            left = i;
        } else {
            return;
        }
    }
}

/**
 * Ranks the peers by distance to `origin` into the scratch arrays and returns how many there are. A peer that is
 * seated, by its own flag or by `seated`, is ranked `seatMarginPx` closer than it is.
 */
function rank(
    origin: { x: number; y: number },
    peers: Iterable<PeerPoint>,
    seated: ReadonlySet<number>,
    seatMarginPx: number,
): number {
    let count = 0;
    for (const peer of peers) {
        reserve(count + 1);
        const position = peer.getPosition();
        const dx = position.x - origin.x;
        const dy = position.y - origin.y;
        const isSeated = peer.seated ?? seated.has(peer.userId);
        distances[count] = Math.sqrt(dx * dx + dy * dy) - (isSeated ? seatMarginPx : 0);
        userIds[count] = peer.userId;
        order[count] = count;
        slotPeers[count] = peer;
        count++;
    }
    return count;
}

/** Moves the nearest users to the front of `order`: the scene first, and the full-rate ones first among those. */
function selectNearest(count: number, limits: ViewerBudgetLimits): { inSceneCount: number; fullRateCount: number } {
    const inSceneCount = Math.min(limits.maxPeers, count);
    const fullRateCount = Math.min(limits.fullRatePeers, inSceneCount);
    moveNearestFirst(0, count, inSceneCount);
    moveNearestFirst(0, inSceneCount, fullRateCount);
    return { inSceneCount, fullRateCount };
}

const NOBODY_SEATED: ReadonlySet<number> = new Set();

/**
 * The users a socket hears about, by distance to `origin`: the `fullRatePeers` nearest at the rate they move, the next
 * ones up to `maxPeers` once a second, the others not at all. A user in `seated` is ranked SEAT_MARGIN_PX closer than
 * it is. Ties go to the lower user id. The sets are in no particular order.
 */
export function selectViewerBudget(
    origin: { x: number; y: number },
    peers: Iterable<PeerPoint>,
    seated: ReadonlySet<number>,
    limits: ViewerBudgetLimits,
): BudgetSelection {
    const count = rank(origin, peers, seated, limits.seatMarginPx ?? SEAT_MARGIN_PX);
    const { inSceneCount, fullRateCount } = selectNearest(count, limits);

    slotPeers.length = 0;
    const fullRate = new Set<number>();
    const inScene = new Set<number>();
    for (let index = 0; index < inSceneCount; index++) {
        const userId = userIds[order[index]];
        inScene.add(userId);
        if (index < fullRateCount) {
            fullRate.add(userId);
        }
    }
    return { fullRate, inScene };
}

/**
 * What a budget keeps about one user it watches: the user, and where it stands in the scene of the socket. One of these
 * per user per socket is a million at 1000 users, so it holds seven fields and no more.
 */
class Peer implements PeerPoint {
    /** In the scene of the socket: the socket was told it joined, and is told what it does. */
    public inScene = false;
    /** Its every move is sent. Only a user in the scene, or one the next selection is about to put there. */
    public fullRate = false;
    /**
     * The `moveVersion` of the user when the socket was last sent its position; a different one means a move is waiting
     * for the next flush. -1 means the descriptor was replaced and the socket has not been sent the new one.
     */
    public sentVersion = 0;
    /**
     * `tick * 8 + band` for the tick that last ranked it, the band being the BAND_* of the nearest threshold it is within
     * (6 the full-rate claim rank ... 1 the exit rank of the scene). A stamp of an older tick means beyond all of them.
     * One number for the nested thresholds.
     */
    public stamp = 0;
    /** When it last joined or left the scene, in ms since its budget was made; NEVER before it did. */
    public changedAt = NEVER;
    /** When it last came to the full-rate set or left it. */
    public fullRateChangedAt = NEVER;

    constructor(public user: UserDescriptor) {}

    public get userId(): number {
        return this.user.userId;
    }

    public get seated(): boolean {
        return this.inScene;
    }

    public getPosition(): { x: number; y: number } {
        return this.user.getPosition();
    }
}

// The nested thresholds of a rank, farthest first, as the `band` of a stamp.
const BAND_SCENE_EXIT = 1;
const BAND_SCENE_ENTER = 2;
const BAND_SCENE_CLAIM = 3;
const BAND_FULL_EXIT = 4;
const BAND_FULL_ENTER = 5;
const BAND_FULL_CLAIM = 6;

/** No change yet: far enough back that any cooldown has passed, and a small integer, so a peer's fields stay small. */
const NEVER = -(2 ** 30);

/** The count a user is kept to once it is in: `enter` x the ratio, never fewer than `enter`. */
function exitCount(enter: number, ratio: number): number {
    return Math.max(enter, Math.ceil(enter * ratio - 1e-9));
}

/** Where the rank timers of the budgets start inside one interval: spread by the golden ratio, so no two line up. */
let nextPhase = 0;
function nextTickOffsetMs(intervalMs: number): number {
    nextPhase = (nextPhase + 0.6180339887498949) % 1;
    return 1 + Math.floor(nextPhase * Math.max(1, intervalMs - 1));
}

/**
 * The budgets that have users to place: room in the scene and users outside it. Such a budget takes a user into the
 * scene from the first move that user makes, so it has to hear every move, which only a full scene lets it skip. The
 * SocketManager owns one set for all its budgets.
 */
export type AttentiveBudgets = Set<ViewerBudget>;

/**
 * The budget of one socket. It sits between the zones and the socket: the zones tell it what they would tell the
 * socket, and it passes on at once a join while the scene has room, every move of a full-rate user, every stop and
 * every leave of a user the socket knows of. The other moves wait for the next flush, which sends the last position of
 * each user that moved. A rank, every RERANK_INTERVAL_MS, applies a new selection, with a leave for a user that drops
 * out of the scene and a join, holding its current position, for one that comes in. A socket never hears of a user it
 * was not told joined.
 *
 * While the socket watches no more users than fullRatePeers, everything is passed on as it comes and no rank runs.
 *
 * THE SELECTION (the owner's mandate, 2026-11-21, root cause 2 of DL-06):
 *  - a deadband: a user enters at a rank of `maxPeers` or nearer, and is dropped only when its rank is beyond
 *    `maxPeers` x RETAIN_EXIT_RATIO (400 and 480; the same for `fullRatePeers`, 150 and 180). The scene is never
 *    larger than the exit count. A user that hovers around rank 400 stays on the side it is on.
 *  - a cooldown of RETAIN_COOLDOWN_MS in a state: a user that joined is not dropped, and one that was dropped is not taken
 *    in again, before it has passed (the same for the full-rate set). That holds against the rank too: a user ranked
 *    nearer than 400 that left 1 second ago waits for the other 750 ms.
 *  - seats for the nearer: a user that waits within the enter rank takes a free seat, the nearest first, and when none is
 *    free the seat of the farthest member beyond the enter rank whose cooldown has passed, if it is nearer than the claim
 *    rank (the enter rank less the width of the deadband: 320 of 400), so that users at the ranks 399 and 401 do not trade a
 *    seat, which is a join and a leave on the wire. The same for the full-rate slots, with a claim rank of 120 (150 less the
 *    deadband of 30): a member nearer than that takes the slot of one beyond the 150, and a member at 1 Hz between the ranks 121
 *    and 150 waits for a free slot. MEASURED on the dense walking crowd, with a claim at any rank within the 150 the share of
 *    the moves of the nearest 150 that reached an observer was 0.88, against 0.93 with the claim rank and 0.94 with no claim
 *    at all: trading at the edge of a crowd whose ranks shuffle only moves the users that are at 1 Hz. Without it a newcomer at rank 1 of a full scene was never told of
 *    (the 400 seats were all within the exit rank, so nobody was dropped) and a walker that came to rank 1 stayed at 1 Hz
 *    (the slots were held by users at ranks 151 to 180): ViewerBudgetRetention.test.ts, "a user that comes nearer than the
 *    whole scene".
 *  - its own cadence: the rank runs every RERANK_INTERVAL_MS (500 ms) on its own timer, and the 5 Hz of the moves does not
 *    run it. The timers of the sockets are staggered, so the ranks of 1000 viewers are not one stall.
 *  - O(1) on the hot path, no sort: a move reads `peer.fullRate`, or the zone reads `fullRateWatchers` and does not
 *    visit the socket at all. A rank is a selection (Hoare, linear on average), not a sort, and it stamps the users it
 *    chose into their `stamp`, so that the decisions after it read one field each.
 *
 * Why it is built the way it is (docs/PERFORMANCE.md, action 22). Every walking move reaches every socket that watches
 * its zone. At 1000 users that all see each other, with 200 of them walking 5 steps a second, that is a million events
 * a second, and the first version of this class did the bookkeeping for each: a lookup in a Map of 1000 peers, a record
 * to read, a Set to write. With a thousand such Maps and records, each event cost a cache miss or three: 573 ms of CPU
 * per second against 113 ms for the pusher without a budget (fan-out bench, tests/pusher/FanOutBench.test.ts). So the
 * work follows the user, not the socket. A user keeps the set of sockets it is at full rate for (`fullRateWatchers`)
 * and the zone sends its move to those alone (about 150 of 1000). The other sockets are not visited: a user that moved
 * has a new `moveVersion`, and at its flush a socket sends the position of each user whose version it has not sent yet.
 * Same frames, 5 times fewer events, and no memory touched for the sockets that only hear it once a second.
 *
 * A stop took the slow path until 2026-11-21: it has to reach every socket that knows of the user, and the zone handed it
 * to all 1000 listeners, 2 stops a walker a second x 1000 walkers x 1000 sockets = 2M calls into a budget a second, each a
 * Map lookup in a table of 1000 peers. That was the walk-stop workload of the CI pool, and with it the budget on cost
 * 2.1, 1.56 and 2.48 times the CPU of the budget off at N=1000 (pairs of 3 interleaved rounds, host at load 35 to 48, so
 * INVALID by judgeRun; counts exact). Now the user keeps a second set, `sceneWatchers` (the sockets that have it in their
 * scene, about 400 of 1000, `fullRateWatchers` is a subset), and the zone gives a stop to those directly. The flush of a
 * budget does not repeat it: `directStopVersion` says the stop of that version reached every socket in the scene.
 * MEASURED after (FanOutBench.test.ts with PUSHER_FANOUT=1, N=1000, 5 interleaved rounds that alternate which arm runs first,
 * 2026-11-22, host at load 5 to 6 on 10 cores, windows 50 / 100 ms; CPU is the JS of the pusher in the bench, without the
 * native send, the intake or gRPC, and is for the ratio, not for a core count):
 *   - walkers that stop twice a second (walk-stop, the workload of the CI pool): CPU budget off 426 ms/s, on 310, on / off 0.74
 *     (pairs 0.49 to 0.78; the on arm's spread of 1.48x makes judgeRun call the row INVALID);
 *   - walkers that never stop: off 436, on 205, on / off 0.47 (pairs 0.45 to 0.76; INVALID, spread 1.65x);
 *   - only 20% of the users walking, 2 stops a second: off 98, on 152, on / off 1.53 (pairs 1.43 to 1.82). The budget costs MORE
 *     CPU in a sparse room: a selection ranks every peer of the socket every RERANK_INTERVAL_MS, whether anybody moved or not,
 *     and skipping it cannot help, since in a room with 200 walkers someone has moved in every interval. The same at N=300 with
 *     everybody walking: 1.25 (walk-stop, VALID) and 1.15 (no stops). So the flag belongs to dense rooms where most users move,
 *     and is off by default;
 *   - the calls and the bytes are counts and exact (FanOutBench.test.ts, "Gate 2"): at 1000 walkers, calls a second 10.00M
 *     against 3.07M (walk) and 3.43M (walk-stop), bytes 89.8 against 18.1 MB/s and 85.8 against 23.2 MB/s. The calls are
 *     emits, zone calls, ranked peers and frames per simulated second, not over the 2 s window of the bench.
 * There is no claim of parity here: with the budget on a dense room costs 0.5 to 0.75 of the CPU of the budget off, a sparse one
 * about 1.5 times as much.
 *
 * What the budget costs and what it saves is in tests/pusher/FanOutBench.test.ts ("Gate 2"), in operations and bytes,
 * which do not depend on the host, and in CPU, which does: read the header of that file before quoting a number.
 *
 * The deadband and the seat margin, what each does (MEASURED, FanOutBench.test.ts, 1000 walkers going round a circle of 40
 * px in 8 s, so that the crowd really crosses the edge of every scene, 6 s window, join+leave a second for all sockets):
 * the bare selection 108328 (2026-11-22; 108394 on the first run), the deadband and the cooldown without the seat margin 65385 (first run, not
 * repeated), all three 8.3 (6 before the selection let a waiting user claim a seat). At this density
 * (1000 users on 280 x 280 px) the 80 ranks between 400 and 480 are 10 px of distance, so the deadband alone cannot hold
 * a crowd that moves tens of pixels; the 64 px seat margin of the first wave (SEAT_MARGIN_PX) is what does, and the owner's
 * ratio of 1.2 and cooldown of 1750 ms are what keep a user at a rank from changing sides on every selection (the hover test
 * in ViewerBudgetRetention.test.ts). Both are kept: the owner's bounds, and the constant wave A measured on top of them.
 *
 * Its latency is higher by design. A user outside the nearest `fullRatePeers` is heard once a second, and the pusher hop
 * of the bench says what that costs the move delivery p95 of the owner's 50 ms: it is the conflated users that miss it.
 * The multi-second move latency and the 2.19 s event-loop lag of the CI pool seen with the old class (action 22,
 * DL-06) were not diagnosed: the bench is on a virtual clock and cannot show queueing. DERIVED, the old class used
 * 570 ms/s at HEAD, 57% of a core in the bench (and 93% on the CI pool, the review's figure, not reproducible here), so
 * the event loop saturated and queued; that explains the lag, it does not prove it. DL-06 stays open until the load host
 * measures the event-loop lag with the budget on.
 */
export class ViewerBudget {
    private readonly peers = new Map<number, Peer>();
    /** The peers in the scene: what a rank walks, so that a rank over a crowd of 1000 visits about 400 for its leaves. */
    private readonly members = new Set<Peer>();
    private fullRateCount = 0;
    private tickCount = 0;
    /** The peers a rank put at full rate, which are owed the last position they moved to: they were not sent it. */
    private readonly promoted: Peer[] = [];
    private ranking = false;
    private origin: { x: number; y: number } | undefined;
    private tickTimer: NodeJS.Timeout | undefined;
    /** Ranks since the conflated moves were last sent; they go out every CONFLATED_INTERVAL_MS / the rank interval ranks. */
    private ranksSinceFlush = 0;
    private admissionTimeout: NodeJS.Timeout | undefined;
    /** With admitByDistance: whether the first selection ran, which is when users start to be told of one at a time. */
    private admitted: boolean;
    private attentive = false;

    private readonly sceneEnter: number;
    private readonly sceneExit: number;
    private readonly fullRateEnter: number;
    private readonly fullRateExit: number;
    private readonly cooldownMs: number;
    private readonly rerankIntervalMs: number;
    private readonly flushEvery: number;
    private readonly seatMarginPx: number;
    /** The clock of the peers' `changedAt`: ms since this budget was made, so that they stay small integers. */
    private readonly epoch = Date.now();

    constructor(
        public readonly viewer: PusherWebSocket,
        private readonly limits: ViewerBudgetLimits,
        private readonly attentiveBudgets?: AttentiveBudgets,
    ) {
        this.admitted = limits.admitByDistance !== true;
        const ratio = Math.max(1, limits.exitRatio ?? RETAIN_EXIT_RATIO);
        this.sceneEnter = limits.maxPeers;
        this.sceneExit = exitCount(limits.maxPeers, ratio);
        this.fullRateEnter = Math.min(limits.fullRatePeers, limits.maxPeers);
        // The four thresholds are nested, which is what lets a peer carry them in one number.
        this.fullRateExit = Math.min(exitCount(this.fullRateEnter, ratio), this.sceneEnter);
        this.cooldownMs = Math.max(0, limits.cooldownMs ?? RETAIN_COOLDOWN_MS);
        this.rerankIntervalMs = Math.max(1, limits.rerankIntervalMs ?? RERANK_INTERVAL_MS);
        this.flushEvery = Math.max(1, Math.round(CONFLATED_INTERVAL_MS / this.rerankIntervalMs));
        this.seatMarginPx = limits.seatMarginPx ?? SEAT_MARGIN_PX;
    }

    /** Where the user of the socket stands; the nearest users are the nearest to it. */
    public setOrigin(x: number, y: number): void {
        if (this.origin === undefined) {
            this.origin = { x, y };
            return;
        }
        this.origin.x = x;
        this.origin.y = y;
    }

    public enter(user: UserDescriptor): void {
        const peer = this.track(user);
        if (this.awaitingAdmission()) {
            return;
        }
        if (peer.inScene || (this.hasRoom() && this.isCooledDown(peer.changedAt))) {
            this.join(peer, this.now(), this.fullRateCount < this.fullRateEnter);
        }
        this.updateAttention();
    }

    public move(user: UserDescriptor): void {
        const peer = this.track(user);
        if (!peer.inScene) {
            // The socket does not know this user, so a move would point at nobody: a join holds the position too. A user
            // that was dropped a moment ago waits out its cooldown, for the next rank to take it in.
            if (this.hasRoom() && !this.awaitingAdmission() && this.isCooledDown(peer.changedAt)) {
                this.join(peer, this.now(), this.fullRateCount < this.fullRateEnter);
                this.updateAttention();
            }
            return;
        }
        if (peer.fullRate || user.getPosition().moving === false) {
            // A stop is never held back: the socket would draw the user walking until it heard it.
            peer.sentVersion = user.moveVersion;
            this.viewer.emitInBatch(user.toUserMovedSubMessage());
        }
        // Otherwise the position waits for the flush, which finds the version of the user ahead of the one sent.
    }

    public leave(userId: number): void {
        const peer = this.peers.get(userId);
        if (peer === undefined) {
            return;
        }
        this.peers.delete(userId);
        this.setFullRate(peer, false, this.now());
        if (peer.inScene) {
            peer.inScene = false;
            this.members.delete(peer);
            peer.user.sceneWatchers?.delete(this.viewer);
            this.viewer.emitInBatch(userLeftSubMessage(userId));
        }
        this.updateAttention();
    }

    /**
     * Ranks the users and applies the selection, and sends the last position of every user that moved when `flush` is
     * set (the timer sets it every CONFLATED_INTERVAL_MS; a call without an argument is a flush too).
     */
    public tick(flush = true): void {
        if (this.viewer.isDisconnecting()) {
            this.dispose();
            return;
        }
        this.admitted = true;
        const origin = this.origin ?? this.viewportCentre();
        this.ranking = true;
        const now = this.now();
        const tick = ++this.tickCount;

        const count = rank(origin, this.peers.values(), NOBODY_SEATED, this.seatMarginPx);
        // Six nested thresholds, each selection working inside the one before it: the exit rank of the scene, its enter
        // rank, its claim rank, the exit rank of the full-rate set, its enter rank, its claim rank. A claim rank is as far
        // inside the enter rank as the exit rank is outside it: a user that is nearer than that may take the place of
        // one that is beyond the enter rank, and one that is not may not, so that two users at ranks 399 and 401 do not
        // trade a place that nobody gave up.
        const sceneExitK = Math.min(this.sceneExit, count);
        const sceneEnterK = Math.min(this.sceneEnter, sceneExitK);
        const fullExitK = Math.min(this.fullRateExit, sceneEnterK);
        const sceneClaimK = Math.max(fullExitK, sceneEnterK - (sceneExitK - sceneEnterK));
        const fullEnterK = Math.min(this.fullRateEnter, fullExitK);
        const fullClaimK = Math.max(0, fullEnterK - (fullExitK - fullEnterK));
        moveNearestFirst(0, count, sceneExitK);
        moveNearestFirst(0, sceneExitK, sceneEnterK);
        moveNearestFirst(0, sceneEnterK, sceneClaimK);
        moveNearestFirst(0, sceneClaimK, fullExitK);
        moveNearestFirst(0, fullExitK, fullEnterK);
        moveNearestFirst(0, fullEnterK, fullClaimK);
        const base = tick * 8;
        for (let index = 0; index < sceneExitK; index++) {
            const band =
                index < fullClaimK
                    ? BAND_FULL_CLAIM
                    : index < fullEnterK
                      ? BAND_FULL_ENTER
                      : index < fullExitK
                        ? BAND_FULL_EXIT
                        : index < sceneClaimK
                          ? BAND_SCENE_CLAIM
                          : index < sceneEnterK
                            ? BAND_SCENE_ENTER
                            : BAND_SCENE_EXIT;
            (slotPeers[order[index]] as Peer).stamp = base + band;
        }

        // Leaves, and the end of the full-rate time of the users that are out of its rank. Leaves first, so the socket
        // never knows more than the exit count at once. A user that is within the exit rank, or that joined or came to
        // full rate less than a cooldown ago, stays; both are read off the peer.
        for (const peer of this.members) {
            const band = peer.stamp - base;
            if (band < 1 && flush && this.isCooledDown(peer.changedAt, now)) {
                // Apply scene departures on the conflated clock. A temporarily empty
                // seat would otherwise admit a walking peer between its 1 Hz samples.
                this.drop(peer, now);
                continue;
            }
            if (peer.fullRate && band < BAND_FULL_EXIT && this.isCooledDown(peer.fullRateChangedAt, now)) {
                this.setFullRate(peer, false, now);
            }
        }

        // Joins, of the users within the enter rank that have been out for a cooldown. A user joins at the rate it will
        // be sent at, so that its join knows whether it moves at full rate.
        this.admitNearest(sceneEnterK, sceneExitK, base, flush, now);
        // The members that come to full rate: within its enter rank, and out of it for a cooldown.
        this.promoteNearest(fullEnterK, fullExitK, base, now);

        // The last position of each user that moved since it was sent. A user that stayed at full rate was sent every
        // move as it came, and a user that just came to it may have moved while it was not.
        if (flush) {
            this.ranksSinceFlush = 0;
            for (const peer of this.members) {
                if (!peer.fullRate) this.sendIfMoved(peer);
            }
        }
        for (const peer of this.promoted) {
            if (peer.fullRate) {
                this.sendIfMoved(peer);
            }
        }
        this.promoted.length = 0;
        this.ranking = false;
        slotPeers.fill(undefined as never, 0, count);

        this.updateAttention();
        if (this.hasNothingToRank()) {
            this.stopTimers();
        }
    }

    /**
     * Puts the users that wait within the enter rank into the scene: first into the seats that are free, the nearest
     * first when there are more of them than seats, then, for each one still waiting, into the seat of the farthest member
     * of the band between the enter rank and the exit rank. Without the second step a newcomer ranked 1 in a full scene
     * would push a member to rank 401, inside the exit rank, and nobody would be dropped and no seat would open: the
     * nearest user would never be told of (MEASURED before, 20 s of virtual time over 1000 static users at 150 / 400, a
     * user that appears 5 px from the viewer: no event). The deadband still holds: only a member that ranks beyond
     * the enter rank is given up, and it ranks the seat margin closer than it is, so the newcomer is nearer than it by
     * more than SEAT_MARGIN_PX. A member is given up only after its cooldown, as ever.
     */
    private admitNearest(sceneEnterK: number, sceneExitK: number, base: number, flush: boolean, now: number): void {
        waiting.length = 0;
        for (let index = 0; index < sceneEnterK; index++) {
            const slot = order[index];
            const peer = slotPeers[slot] as Peer;
            if (!peer.inScene && this.isCooledDown(peer.changedAt, now)) {
                waiting.push(slot);
            }
        }
        if (waiting.length === 0) {
            return;
        }
        const seats = Math.max(0, this.sceneEnter - this.members.size);
        // Only a crowd that contends for the seats is put in order.
        if (waiting.length > seats) {
            waiting.sort(compareDistance);
        }
        const candidates = waiting.length;
        let admitted = 0;
        let next = 0;
        for (; next < candidates && admitted < seats; next++) {
            const peer = slotPeers[waiting[next]] as Peer;
            const full = this.wouldBeFullRate(peer, base, now, 0);
            // Start a walking 1 Hz stream on its flush boundary. A half-interval between the join sample and its next
            // move misleads the interpolator.
            if (full || flush || !peer.user.getPosition().moving) {
                this.join(peer, now, full);
                admitted++;
            }
        }
        if (next >= candidates) {
            return;
        }
        // The farthest members of the band between the enter rank and the exit rank, that have been in for a cooldown.
        evictable.length = 0;
        for (let index = sceneEnterK; index < sceneExitK; index++) {
            const slot = order[index];
            const member = slotPeers[slot] as Peer;
            if (member.inScene && this.isCooledDown(member.changedAt, now)) {
                evictable.push(slot);
            }
        }
        if (evictable.length === 0) {
            return;
        }
        evictable.sort(compareDistanceFarthestFirst);
        let victim = 0;
        for (; next < candidates && victim < evictable.length; next++) {
            const peer = slotPeers[waiting[next]] as Peer;
            if (peer.stamp - base < BAND_SCENE_CLAIM) {
                // Sorted, so the rest are farther still: inside the enter rank, but not by the width of the deadband.
                break;
            }
            const member = slotPeers[evictable[victim]] as Peer;
            const full = this.wouldBeFullRate(peer, base, now, member.fullRate ? 1 : 0);
            if (full || flush || !peer.user.getPosition().moving) {
                this.drop(member, now);
                this.join(peer, now, full);
                victim++;
            }
        }
    }

    /** Whether a user that joins now is at full rate: within the full-rate enter rank, and a slot is free or about to be. */
    private wouldBeFullRate(peer: Peer, base: number, now: number, slotsFreed: number): boolean {
        return (
            peer.stamp - base >= BAND_FULL_ENTER &&
            this.fullRateCount - slotsFreed < this.fullRateEnter &&
            this.isCooledDown(peer.fullRateChangedAt, now)
        );
    }

    /**
     * Puts the members within the full-rate enter rank that are not at full rate there: into the free slots (the nearest
     * first when there are more of them), then into the slot of the farthest full-rate member of the band between the
     * enter rank and the exit rank, that has been there for a cooldown. Without the second step a walker that comes to
     * rank 1 stays at 1 Hz while ranks 151 to 180 hold the 150 slots (MEASURED before: a member at rank 300 that walked
     * beside the viewer was sent 10 of 50 moves in 10 s).
     */
    private promoteNearest(fullEnterK: number, fullExitK: number, base: number, now: number): void {
        waiting.length = 0;
        for (let index = 0; index < fullEnterK; index++) {
            const slot = order[index];
            const peer = slotPeers[slot] as Peer;
            if (peer.inScene && !peer.fullRate && this.isCooledDown(peer.fullRateChangedAt, now)) {
                waiting.push(slot);
            }
        }
        if (waiting.length === 0) {
            return;
        }
        const free = Math.max(0, this.fullRateEnter - this.fullRateCount);
        if (waiting.length > free) {
            waiting.sort(compareDistance);
        }
        let next = 0;
        for (; next < waiting.length && next < free; next++) {
            this.setFullRate(slotPeers[waiting[next]] as Peer, true, now);
        }
        if (next >= waiting.length) {
            return;
        }
        evictable.length = 0;
        for (let index = fullEnterK; index < fullExitK; index++) {
            const slot = order[index];
            const member = slotPeers[slot] as Peer;
            if (member.fullRate && this.isCooledDown(member.fullRateChangedAt, now)) {
                evictable.push(slot);
            }
        }
        evictable.sort(compareDistanceFarthestFirst);
        for (let victim = 0; next < waiting.length && victim < evictable.length; next++, victim++) {
            const entrant = slotPeers[waiting[next]] as Peer;
            if (entrant.stamp - base < BAND_FULL_CLAIM) {
                // Sorted, so the rest are farther still: inside the enter rank, but not by the width of the deadband.
                break;
            }
            this.setFullRate(slotPeers[evictable[victim]] as Peer, false, now);
            this.setFullRate(entrant, true, now);
        }
    }

    /** Stops the timers. What the budget set in the zones stays: it is the zones, not the timers, that deliver. */
    public stop(): void {
        this.stopTimers();
    }

    /**
     * Ends the budget of a socket that is gone: the timers stop, the budget is no longer attentive, and the socket is
     * removed from the `fullRateWatchers` of every user, so that no move is sent to it again and nothing keeps it alive.
     */
    public dispose(): void {
        this.stopTimers();
        const now = this.now();
        for (const peer of this.peers.values()) {
            this.setFullRate(peer, false, now);
            peer.user.sceneWatchers?.delete(this.viewer);
        }
        this.attentiveBudgets?.delete(this);
        this.attentive = false;
    }

    private stopTimers(): void {
        clearTimeout(this.tickTimer);
        this.tickTimer = undefined;
        clearTimeout(this.admissionTimeout);
        this.admissionTimeout = undefined;
    }

    /**
     * With admitByDistance, whether the first selection has yet to run: nobody is told of until it does. The first call
     * schedules it for the end of this turn, when the zones are done listing the users they hold.
     */
    private awaitingAdmission(): boolean {
        if (this.admitted) {
            return false;
        }
        this.admissionTimeout ??= setTimeout(() => {
            this.admissionTimeout = undefined;
            this.tick();
        }, 0);
        return true;
    }

    private track(user: UserDescriptor): Peer {
        let peer = this.peers.get(user.userId);
        if (peer === undefined) {
            peer = new Peer(user);
            this.peers.set(user.userId, peer);
        } else if (peer.user !== user) {
            // The user crossed into another zone this socket watches, which has its own descriptor of it.
            if (peer.fullRate) {
                peer.user.fullRateWatchers?.delete(this.viewer);
                (user.fullRateWatchers ??= new Set()).add(this.viewer);
            }
            if (peer.inScene) {
                peer.user.sceneWatchers?.delete(this.viewer);
                (user.sceneWatchers ??= new Set()).add(this.viewer);
            }
            peer.user = user;
            // This socket has not been sent the new descriptor. A user at full rate is sent now, by move(); one that
            // is not waits for the flush; for a stop, move() sends it now too.
            peer.sentVersion = -1;
        }
        if (this.tickTimer === undefined && this.peers.size > this.limits.fullRatePeers) {
            this.armTimer(
                this.limits.staggerTicks === false ? this.rerankIntervalMs : nextTickOffsetMs(this.rerankIntervalMs),
            );
        }
        return peer;
    }

    /** The timer of the ranks. Each rank re-arms it, so a socket has one timer; the first is staggered by `delayMs`. */
    private armTimer(delayMs: number): void {
        this.tickTimer = setTimeout(() => {
            this.tickTimer = undefined;
            this.ranksSinceFlush++;
            this.tick(this.ranksSinceFlush >= this.flushEvery);
            if (this.tickTimer === undefined && !this.hasNothingToRank() && !this.viewer.isDisconnecting()) {
                this.armTimer(this.rerankIntervalMs);
            }
        }, delayMs);
    }

    /**
     * Whether there is nothing a rank would do: the users watched are no more than the full-rate set, and every one of
     * them is in the scene and at full rate. A user that is not at full rate yet, held by its cooldown, is not nothing.
     */
    private hasNothingToRank(): boolean {
        return this.peers.size <= this.limits.fullRatePeers && this.fullRateCount === this.peers.size;
    }

    private hasRoom(): boolean {
        return this.members.size < this.sceneEnter;
    }

    private now(): number {
        return Date.now() - this.epoch;
    }

    /** Whether a cooldown has passed since `changedAt`. */
    private isCooledDown(changedAt: number, now: number = this.now()): boolean {
        return now - changedAt >= this.cooldownMs;
    }

    private sendIfMoved(peer: Peer): void {
        const user = peer.user;
        if (peer.sentVersion !== user.moveVersion) {
            // A stop that went straight to every socket in the scene reached this one too: a peer in the scene is in
            // the descriptor's sceneWatchers from the moment it joined, or from the moment its descriptor was replaced
            // (sentVersion -1), and both come before any stop of the descriptor. One that joins after the stop has the
            // position in its join, and sentVersion equal to the version, so it does not get here.
            const reachedByStop = user.directStopVersion === user.moveVersion;
            peer.sentVersion = user.moveVersion;
            if (!reachedByStop) {
                this.viewer.emitInBatch(user.toUserMovedSubMessage());
            }
        }
    }

    private setFullRate(peer: Peer, fullRate: boolean, now: number): void {
        if (peer.fullRate === fullRate) {
            return;
        }
        peer.fullRate = fullRate;
        peer.fullRateChangedAt = now;
        if (fullRate) {
            if (this.ranking) {
                this.promoted.push(peer);
            }
            this.fullRateCount++;
            (peer.user.fullRateWatchers ??= new Set()).add(this.viewer);
        } else {
            this.fullRateCount--;
            peer.user.fullRateWatchers?.delete(this.viewer);
            // What the socket was sent while the user was at full rate is the latest it has.
            peer.sentVersion = peer.user.moveVersion;
        }
    }

    private drop(peer: Peer, now: number): void {
        this.setFullRate(peer, false, now);
        peer.inScene = false;
        peer.changedAt = now;
        this.members.delete(peer);
        peer.user.sceneWatchers?.delete(this.viewer);
        this.viewer.emitInBatch(userLeftSubMessage(peer.userId));
    }

    private join(peer: Peer, now: number, fullRate: boolean): void {
        if (!peer.inScene) {
            peer.inScene = true;
            peer.changedAt = now;
            this.members.add(peer);
            (peer.user.sceneWatchers ??= new Set()).add(this.viewer);
        }
        if (fullRate) {
            this.setFullRate(peer, true, now);
        }
        const user = peer.user;
        peer.sentVersion = user.moveVersion;
        this.viewer.emitInBatch(user.toUserJoinedSubMessage());
        if (!peer.fullRate && user.getPosition().moving) {
            // A client times a remote user's stream from its moves, not from its join: without this move it would
            // draw the first move a second from now in the time of a full-rate move, then hold the user still.
            this.viewer.emitInBatch(user.toUserMovedSubMessage());
        }
    }

    /** Whether the zones must keep telling this budget every move: it has room, and users to put in it. */
    private updateAttention(): void {
        const attentive = this.members.size < this.sceneEnter && this.peers.size > this.members.size;
        if (attentive === this.attentive || this.attentiveBudgets === undefined) {
            return;
        }
        this.attentive = attentive;
        if (attentive) {
            this.attentiveBudgets.add(this);
        } else {
            this.attentiveBudgets.delete(this);
        }
    }

    private viewportCentre(): { x: number; y: number } {
        const viewport = this.viewer.getUserData().viewport;
        return { x: (viewport.left + viewport.right) / 2, y: (viewport.top + viewport.bottom) / 2 };
    }
}
