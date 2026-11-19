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
}

/** A user a socket could hear about; a UserDescriptor is one. */
export interface PeerPoint {
    readonly userId: number;
    getPosition(): { x: number; y: number };
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
 * A user the socket already knows of keeps its place against a newcomer that is closer by less than this, so that two
 * users walking side by side at the edge of the scene do not leave and join it every second.
 */
export const SEAT_MARGIN_PX = 32;

// Scratch space for selectViewerBudget, shared by every socket: a selection runs to its end before the next starts,
// and a tick then allocates nothing in proportion to the crowd but the two sets it returns.
let distances = new Float64Array(0);
let userIds = new Float64Array(0);
let order = new Int32Array(0);

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
    let count = 0;
    for (const peer of peers) {
        reserve(count + 1);
        const position = peer.getPosition();
        const dx = position.x - origin.x;
        const dy = position.y - origin.y;
        distances[count] = Math.sqrt(dx * dx + dy * dy) - (seated.has(peer.userId) ? SEAT_MARGIN_PX : 0);
        userIds[count] = peer.userId;
        order[count] = count;
        count++;
    }

    const inSceneCount = Math.min(limits.maxPeers, count);
    const fullRateCount = Math.min(limits.fullRatePeers, inSceneCount);
    moveNearestFirst(0, count, inSceneCount);
    moveNearestFirst(0, inSceneCount, fullRateCount);

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
 * The budget of one socket. It sits between the zones and the socket: the zones tell it what they would tell the
 * socket, and it passes on at once a join while the scene has room, every move of a full-rate user, every stop and
 * every leave of a user the socket knows of. The other moves wait for the next tick, which sends the last position of
 * each user that moved and applies a new selection, with a leave for a user that drops out of the scene and a join,
 * holding its current position, for one that comes in. A socket never hears of a user it was not told joined.
 *
 * While the socket watches no more users than fullRatePeers, everything is passed on as it comes and no tick runs.
 */
export class ViewerBudget {
    private readonly peers = new Map<number, UserDescriptor>();
    private readonly inScene = new Set<number>();
    private fullRate = new Set<number>();
    private readonly pendingMoves = new Set<number>();
    private origin: { x: number; y: number } | undefined;
    private tickInterval: NodeJS.Timeout | undefined;

    constructor(
        private readonly viewer: PusherWebSocket,
        private readonly limits: ViewerBudgetLimits,
    ) {}

    /** Where the user of the socket stands; the nearest users are the nearest to it. */
    public setOrigin(x: number, y: number): void {
        this.origin = { x, y };
    }

    public enter(user: UserDescriptor): void {
        this.track(user);
        if (this.inScene.has(user.userId) || this.hasRoom()) {
            this.join(user);
        }
    }

    public move(user: UserDescriptor): void {
        this.track(user);
        const userId = user.userId;
        if (!this.inScene.has(userId)) {
            // The socket does not know this user, so a move would point at nobody: a join holds the position too.
            if (this.hasRoom()) {
                this.join(user);
            }
            return;
        }
        if (this.fullRate.has(userId) || user.getPosition().moving === false) {
            // A stop is never held back: the socket would draw the user walking until it heard it.
            this.pendingMoves.delete(userId);
            this.viewer.emitInBatch(user.toUserMovedSubMessage());
            return;
        }
        this.pendingMoves.add(userId);
    }

    public leave(userId: number): void {
        this.peers.delete(userId);
        this.fullRate.delete(userId);
        this.pendingMoves.delete(userId);
        if (this.inScene.delete(userId)) {
            this.viewer.emitInBatch(userLeftSubMessage(userId));
        }
    }

    public tick(): void {
        if (this.viewer.isDisconnecting()) {
            this.stop();
            return;
        }

        const selection = selectViewerBudget(
            this.origin ?? this.viewportCentre(),
            this.peers.values(),
            this.inScene,
            this.limits,
        );

        // Leaves first, so the socket never knows more than maxPeers users at once.
        for (const userId of this.inScene) {
            if (!selection.inScene.has(userId)) {
                // Still watched, so still tracked: it may come back in a later selection.
                this.inScene.delete(userId);
                this.pendingMoves.delete(userId);
                this.viewer.emitInBatch(userLeftSubMessage(userId));
            }
        }
        // Before the joins, so that a join knows whether the user moves at full rate.
        this.fullRate = selection.fullRate;
        for (const userId of selection.inScene) {
            const user = this.peers.get(userId);
            if (user !== undefined && !this.inScene.has(userId)) {
                this.join(user);
            }
        }

        for (const userId of this.pendingMoves) {
            const user = this.peers.get(userId);
            if (user !== undefined) {
                this.viewer.emitInBatch(user.toUserMovedSubMessage());
            }
        }
        this.pendingMoves.clear();

        if (this.peers.size <= this.limits.fullRatePeers) {
            this.stop();
        }
    }

    public stop(): void {
        clearInterval(this.tickInterval);
        this.tickInterval = undefined;
    }

    private track(user: UserDescriptor): void {
        this.peers.set(user.userId, user);
        if (this.tickInterval === undefined && this.peers.size > this.limits.fullRatePeers) {
            this.tickInterval = setInterval(() => this.tick(), CONFLATED_INTERVAL_MS);
        }
    }

    private hasRoom(): boolean {
        return this.inScene.size < this.limits.maxPeers;
    }

    private join(user: UserDescriptor): void {
        this.inScene.add(user.userId);
        this.pendingMoves.delete(user.userId);
        if (this.fullRate.size < this.limits.fullRatePeers) {
            this.fullRate.add(user.userId);
        }
        this.viewer.emitInBatch(user.toUserJoinedSubMessage());
        if (!this.fullRate.has(user.userId) && user.getPosition().moving) {
            // A client times a remote user's stream from its moves, not from its join: without this move it would
            // draw the first move a second from now in the time of a full-rate move, then hold the user still.
            this.viewer.emitInBatch(user.toUserMovedSubMessage());
        }
    }

    private viewportCentre(): { x: number; y: number } {
        const viewport = this.viewer.getUserData().viewport;
        return { x: (viewport.left + viewport.right) / 2, y: (viewport.top + viewport.bottom) / 2 };
    }
}
