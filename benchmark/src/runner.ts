import { monitorEventLoopDelay } from "node:perf_hooks";
import type { LoadConfig } from "./config";
import { MoveProbe, firstObserverIndex } from "./probe";
import { RoomSession, positionAt } from "./session";
import { type Counter, RunStats, TimerRegistry, eventLoopLagMs, increment, percentile } from "./stats";

export type StopReason = "completed" | "aborted";

const EVENT_LOOP_RESOLUTION_MS = 10;
const RSS_SAMPLE_INTERVAL_MS = 1000;

function round(value: number | null, digits = 1): number | null {
    return value === null ? null : Number(value.toFixed(digits));
}

/**
 * Runs one load scenario and resolves with its summary once every owned socket and timer is released.
 * Aborting the signal stops the run early, including in the middle of the ramp.
 */
export async function runLoad(config: LoadConfig, signal?: AbortSignal) {
    const stats = new RunStats();
    const timers = new TimerRegistry();
    const sessions: RoomSession[] = [];
    const roomUrlOf = Array.from(
        { length: config.sessions },
        (_, index) => config.roomUrls[index % config.roomUrls.length],
    );
    const earlyLeavers = Math.round(config.disconnectFraction * config.sessions);
    const probe = new MoveProbe({
        roomUrlOf,
        firstObserver: firstObserverIndex(config.sessions, earlyLeavers, config.probeObservers),
        observers: config.probeObservers,
        positionOf: positionAt,
    });
    const rampStarts: NodeJS.Timeout[] = [];
    const startedAt = new Date();
    const startedAtMs = performance.now();
    const cpuAtStart = process.cpuUsage();
    const eventLoopDelay = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
    eventLoopDelay.enable();
    let rssPeakBytes = process.memoryUsage.rss();
    const runTimers = [
        timers.setInterval(() => {
            rssPeakBytes = Math.max(rssPeakBytes, process.memoryUsage.rss());
        }, RSS_SAMPLE_INTERVAL_MS),
    ];

    for (let index = 0; index < config.sessions; index++) {
        const session = new RoomSession(
            {
                index,
                name: `${config.namePrefix}-${index}`,
                pusherUrl: config.pusherUrl,
                wsUrl: config.wsUrl,
                roomUrl: roomUrlOf[index],
                apiVersion: config.apiVersion,
                characterTextureId: config.characterTextureId,
                auth: config.auth,
                moveHz: config.moveHz,
                joinTimeoutMs: config.joinTimeoutSeconds * 1000,
                closeTimeoutMs: config.closeTimeoutSeconds * 1000,
            },
            stats,
            timers,
            probe,
        );
        sessions.push(session);
        rampStarts.push(
            timers.setTimeout(() => session.start(), (index * config.rampSeconds * 1000) / config.sessions),
        );
    }
    runTimers.push(...rampStarts);

    // State of each planned leaver when the leave fires: "accepted" left the room, "connecting" aborted its join,
    // "idle" had not started yet and never starts; "rejected", "leaving" and "closed" were already out of the room.
    // Every planned leaver is out of the room from then on.
    const earlyLeaveStates: Counter = {};
    let earlyLeaveFired = false;
    if (earlyLeavers > 0) {
        runTimers.push(
            timers.setTimeout(() => {
                earlyLeaveFired = true;
                for (const [index, session] of sessions.slice(0, earlyLeavers).entries()) {
                    increment(earlyLeaveStates, session.state);
                    timers.clear(rampStarts[index]);
                    session.leave();
                }
            }, config.disconnectAtSeconds * 1000),
        );
    }

    const stopReason = await new Promise<StopReason>((resolve) => {
        if (signal?.aborted) {
            resolve("aborted");
            return;
        }
        signal?.addEventListener("abort", () => resolve("aborted"), { once: true });
        runTimers.push(timers.setTimeout(() => resolve("completed"), config.durationSeconds * 1000));
    });

    const acceptedAtStop = stats.accepted;
    const openSocketsAtStop = stats.socketsOpen;
    // Pending ramp starts go first, so no session starts while the others close. Each session releases its own
    // timers in leave(); the registry must then be empty without a blanket clear, which is what cleanup reports.
    for (const timer of runTimers) {
        timers.clear(timer);
    }
    for (const session of sessions) {
        session.leave();
    }
    await Promise.all(sessions.filter((session) => session.state !== "idle").map((session) => session.closed));

    eventLoopDelay.disable();
    const cpu = process.cpuUsage(cpuAtStart);
    const wallMs = performance.now() - startedAtMs;
    const rssEndBytes = process.memoryUsage.rss();
    // The back numbers users per room, so the same id in two rooms is two users.
    const uniqueUserIds = [...stats.rooms.values()].reduce((total, room) => total + room.userIds.size, 0);
    const neverStarted = config.sessions - stats.started;
    const cleanup = { openSockets: stats.socketsOpen, activeTimers: timers.activeCount };
    const moves = probe.summary();

    return {
        schemaVersion: 3,
        notice: "Headless protocol bots: this certifies neither client rendering nor audio/video performance.",
        startedAt: startedAt.toISOString(),
        wallSeconds: round(wallMs / 1000, 3),
        stopReason,
        config: { ...config, output: config.output ?? null },
        sessions: {
            requested: config.sessions,
            started: stats.started,
            neverStarted,
            accepted: stats.accepted,
            acceptedAtStop,
            rejected: stats.rejected,
            abortedBeforeJoin: stats.abortedBeforeJoin,
            unexpectedCloses: stats.unexpectedCloses,
            uniqueUserIds,
        },
        earlyLeave: { planned: earlyLeavers, fired: earlyLeaveFired, stateAtLeave: earlyLeaveStates },
        sockets: {
            opened: stats.socketsOpened,
            openPeak: stats.socketsOpenPeak,
            openAtStop: openSocketsAtStop,
            closed: stats.socketsClosed,
        },
        joinLatencyMs: {
            count: stats.joinLatenciesMs.length,
            p50: round(percentile(stats.joinLatenciesMs, 0.5)),
            p95: round(percentile(stats.joinLatenciesMs, 0.95)),
            max: round(percentile(stats.joinLatenciesMs, 1)),
        },
        rooms: [...stats.rooms.entries()].map(([roomUrl, room]) => ({
            roomUrl,
            started: room.started,
            accepted: room.accepted,
            rejected: room.rejected,
            uniqueUserIds: room.userIds.size,
        })),
        sent: stats.sent,
        received: { frames: stats.receivedFrames, bytes: stats.receivedBytes, eventsByType: stats.received },
        // Only observers record this, and only bots of this process are matched: compare per generator process.
        moveProbe: {
            observers: moves.observers,
            moveLatencyMs: {
                count: moves.moveLatencyMs.count,
                p50: round(moves.moveLatencyMs.p50),
                p95: round(moves.moveLatencyMs.p95),
                p99: round(moves.moveLatencyMs.p99),
            },
            delivery: {
                expected: moves.delivery.expected,
                received: moves.delivery.received,
                ratio: round(moves.delivery.ratio, 4),
            },
            outsideExpectation: moves.outsideExpectation,
            unmatched: moves.unmatched,
        },
        rejections: stats.rejections,
        errors: stats.errors,
        closeCodes: stats.closeCodes,
        generator: {
            cpuUserMs: round(cpu.user / 1000),
            cpuSystemMs: round(cpu.system / 1000),
            cpuPercentOfOneCore: round(((cpu.user + cpu.system) / 1000 / wallMs) * 100),
            rssPeakBytes: Math.max(rssPeakBytes, rssEndBytes),
            rssEndBytes,
            // Delay beyond the sampling interval, which the raw histogram includes.
            eventLoopLagMs: {
                resolutionMs: EVENT_LOOP_RESOLUTION_MS,
                p50: round(eventLoopLagMs(eventLoopDelay.percentile(50), EVENT_LOOP_RESOLUTION_MS), 2),
                p95: round(eventLoopLagMs(eventLoopDelay.percentile(95), EVENT_LOOP_RESOLUTION_MS), 2),
                p99: round(eventLoopLagMs(eventLoopDelay.percentile(99), EVENT_LOOP_RESOLUTION_MS), 2),
                max: round(eventLoopLagMs(eventLoopDelay.max, EVENT_LOOP_RESOLUTION_MS), 2),
            },
        },
        cleanup,
        // Client-side bookkeeping only: session buckets, sockets and timers. It cannot see the server's room
        // membership, which comes from the back/pusher gauges.
        reconciled:
            stats.started === stats.accepted + stats.rejected + stats.abortedBeforeJoin &&
            stats.socketsOpened === stats.socketsClosed &&
            cleanup.openSockets === 0 &&
            cleanup.activeTimers === 0,
    };
}

export type LoadSummary = Awaited<ReturnType<typeof runLoad>>;
