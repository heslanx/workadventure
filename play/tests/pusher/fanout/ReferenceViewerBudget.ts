import type { PusherWebSocket } from "../../../src/pusher/services/PusherWebSocket";
import {
    CONFLATED_INTERVAL_MS,
    selectViewerBudget,
    type ViewerBudgetLimits,
} from "../../../src/pusher/models/ViewerBudget";
import { userLeftSubMessage, type UserDescriptor } from "../../../src/pusher/models/Zone";

/**
 * The ViewerBudget as it was at 7a37a5178, kept as the reference the optimized class is compared with (see
 * ViewerBudgetEquivalence.test.ts). It is the straightforward version: one Set or Map per fact about a peer.
 *
 * The budget of one socket. It sits between the zones and the socket: the zones tell it what they would tell the
 * socket, and it passes on at once a join while the scene has room, every move of a full-rate user, every stop and
 * every leave of a user the socket knows of. The other moves wait for the next tick, which sends the last position of
 * each user that moved and applies a new selection, with a leave for a user that drops out of the scene and a join,
 * holding its current position, for one that comes in. A socket never hears of a user it was not told joined.
 *
 * While the socket watches no more users than fullRatePeers, everything is passed on as it comes and no tick runs.
 */
export class ReferenceViewerBudget {
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
