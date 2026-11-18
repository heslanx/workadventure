import type { MergeableSummary } from "../../src/merge";

export type Tweak = (draft: MergeableSummary) => void;

/** A healthy process: every session accepted, a closed ledger, a generator far from its limit. */
export function summary(tweak: Tweak = () => {}): MergeableSummary {
    const draft: MergeableSummary = {
        schemaVersion: 4,
        stopReason: "completed",
        config: { durationSeconds: 240 },
        sessions: { requested: 250, accepted: 250, rejected: 0, unexpectedCloses: 0 },
        joinLatencyMs: { p95: 400 },
        received: { frames: 1000, bytes: 100_000 },
        moveProbe: {
            delivery: { expected: 1000, received: 990 },
            moveLatencyMs: { p50: 40, p95: 110, p99: 150 },
            outsideExpectation: 5,
            unmatched: 1,
        },
        closeCodes: { "1000": 250 },
        errors: {},
        generator: { cpuPercentOfOneCore: 40, eventLoopLagMs: { p99: 2 } },
        reconciled: true,
        window: { enabled: true, seconds: 100, measuredSeconds: 100 },
        scenario: { firstPathIndex: 0, lastPathIndex: 249, walkers: 50 },
        traffic: {
            measuredSeconds: 100,
            bytes: 100_000,
            overheadBytes: 400,
            byType: {
                userMovedMessage: {
                    frames: 800,
                    messages: 3000,
                    records: 3000,
                    bytes: 80_000,
                    bytesPerSecond: 800,
                    peakBytesPerSecond: 1500,
                },
            },
        },
        worldSpace: {
            membersJoined: 250,
            watchersSubscribed: 250,
            frames: 100,
            records: 5000,
            bytes: 20_000,
            joinLatencyMs: { p95: 90 },
            byType: {
                addSpaceUserMessage: {
                    frames: 100,
                    messages: 100,
                    records: 100,
                    bytes: 20_000,
                    bytesPerSecond: 200,
                    peakBytesPerSecond: 900,
                },
            },
        },
        knownPeers: { sessions: 250, p50: 60, p95: 80, max: 90 },
        metrics: [],
    };
    tweak(draft);
    return draft;
}
