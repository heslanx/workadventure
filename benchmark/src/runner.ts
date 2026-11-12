import { monitorEventLoopDelay } from "node:perf_hooks";
import type { LoadConfig } from "./config";
import { RoomSession } from "./session";
import { RunStats, TimerRegistry, percentile } from "./stats";

export type StopReason = "completed" | "aborted";

const NANOSECONDS_PER_MILLISECOND = 1e6;
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
    const startedAt = new Date();
    const startedAtMs = performance.now();
    const cpuAtStart = process.cpuUsage();
    const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
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
                roomUrl: config.roomUrls[index % config.roomUrls.length],
                apiVersion: config.apiVersion,
                characterTextureId: config.characterTextureId,
                auth: config.auth,
                moveHz: config.moveHz,
                joinTimeoutMs: config.joinTimeoutSeconds * 1000,
                closeTimeoutMs: config.closeTimeoutSeconds * 1000,
            },
            stats,
            timers,
        );
        sessions.push(session);
        runTimers.push(
            timers.setTimeout(() => session.start(), (index * config.rampSeconds * 1000) / config.sessions),
        );
    }

    const earlyLeavers = Math.round(config.disconnectFraction * config.sessions);
    if (earlyLeavers > 0) {
        runTimers.push(
            timers.setTimeout(() => {
                for (const session of sessions.slice(0, earlyLeavers)) {
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

    return {
        schemaVersion: 1,
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
        rejections: stats.rejections,
        errors: stats.errors,
        closeCodes: stats.closeCodes,
        generator: {
            cpuUserMs: round(cpu.user / 1000),
            cpuSystemMs: round(cpu.system / 1000),
            cpuPercentOfOneCore: round(((cpu.user + cpu.system) / 1000 / wallMs) * 100),
            rssPeakBytes: Math.max(rssPeakBytes, rssEndBytes),
            rssEndBytes,
            eventLoopLagMs: {
                p50: round(eventLoopDelay.percentile(50) / NANOSECONDS_PER_MILLISECOND, 2),
                p95: round(eventLoopDelay.percentile(95) / NANOSECONDS_PER_MILLISECOND, 2),
                p99: round(eventLoopDelay.percentile(99) / NANOSECONDS_PER_MILLISECOND, 2),
                max: round(eventLoopDelay.max / NANOSECONDS_PER_MILLISECOND, 2),
            },
        },
        cleanup,
        reconciled:
            stats.started === stats.accepted + stats.rejected + stats.abortedBeforeJoin &&
            stats.socketsOpened === stats.socketsClosed &&
            cleanup.openSockets === 0 &&
            cleanup.activeTimers === 0,
    };
}

export type LoadSummary = Awaited<ReturnType<typeof runLoad>>;
