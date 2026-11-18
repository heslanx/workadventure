import { describe, expect, it } from "vitest";
import {
    type MergeableSummary,
    type MergedSummary,
    DEFAULT_LIMITS,
    assertMergeableSummary,
    mergeSummaries,
    median,
    summarizeStaircase,
} from "../src/merge";
import { type LoadConfig, parseConfig } from "../src/config";
import { runLoad } from "../src/runner";
import { startFakePusher } from "./support/fakePusher";
import { summary } from "./support/summaryFixture";

describe("merging generator processes", () => {
    it("adds the counters of every process", () => {
        const merged = mergeSummaries([
            summary(),
            summary((draft) => {
                draft.scenario.firstPathIndex = 250;
                draft.scenario.lastPathIndex = 499;
            }),
        ]);

        expect(merged.processes).toBe(2);
        expect(merged.sessions).toEqual({ requested: 500, accepted: 500, rejected: 0, unexpectedCloses: 0 });
        expect(merged.closeCodes).toEqual({ "1000": 500 });
        expect(merged.walkers).toBe(100);
        expect(merged.worldSpace).toMatchObject({
            membersJoined: 500,
            watchersSubscribed: 500,
            records: 10_000,
            bytes: 40_000,
        });
    });

    it("pools delivery as total received over total expected, not as an average of ratios", () => {
        // 100/100 and 0/900 average to 0.5 as ratios, but the pooled delivery is 100 of 1000.
        const merged = mergeSummaries([
            summary((draft) => {
                draft.moveProbe.delivery = { expected: 100, received: 100 };
            }),
            summary((draft) => {
                draft.moveProbe.delivery = { expected: 900, received: 0 };
            }),
        ]);

        expect(merged.delivery).toEqual({ expected: 1000, received: 100, pooledRatio: 0.1 });
    });

    it("reports the worst percentile of the processes, since percentiles cannot be added", () => {
        const merged = mergeSummaries([
            summary(),
            summary((draft) => {
                draft.moveProbe.moveLatencyMs = { p50: 55, p95: 90, p99: 400 };
            }),
        ]);

        expect(merged.moveLatencyMs).toEqual({ worstP50: 55, worstP95: 110, worstP99: 400 });
        expect(merged.joinLatencyP95WorstMs).toBe(400);
    });

    it("sums the bytes per second of each process over its own window, by type", () => {
        // 100 kB over 100 s is 1000 B/s; the second process measured 50 s: 40 kB over 50 s is 800 B/s.
        const merged = mergeSummaries([
            summary(),
            summary((draft) => {
                draft.traffic.measuredSeconds = 50;
                draft.traffic.bytes = 40_000;
            }),
        ]);

        expect(merged.traffic.bytes).toBe(140_000);
        expect(merged.traffic.bytesPerSecond).toBe(1800);
        expect(merged.traffic.byType.userMovedMessage).toMatchObject({
            messages: 6000,
            bytes: 160_000,
            bytesPerSecond: 1600,
            peakBytesPerSecondOfOneProcess: 1500,
        });
        // 1800 B/s = 14.4 kbit/s shared by 500 sessions.
        expect(merged.traffic.kbitPerSecondPerSession).toBe(0.03);
    });

    it("takes the known peers as a share of everybody that was accepted", () => {
        const merged = mergeSummaries([
            summary((draft) => {
                draft.knownPeers = { sessions: 250, p50: 100, p95: 120, max: 130 };
            }),
            summary((draft) => {
                draft.knownPeers = { sessions: 250, p50: 200, p95: 260, max: 300 };
            }),
        ]);

        // Mean of the medians is 150 of the other 499 bots.
        expect(merged.knownPeers).toMatchObject({
            meanOfMedians: 150,
            shareOfPopulation: 0.3006,
            p95Worst: 260,
            max: 300,
        });
    });

    it("keeps the metrics report of the process that scraped the URL", () => {
        const report = {
            url: "http://pusher/metrics",
            samples: 3,
            errors: {},
            firstSampleAtSeconds: 60,
            lastSampleAtSeconds: 160,
            wallSeconds: 100,
            cpuSeconds: 120,
            cpuPercentOfOneCore: 120,
            rssPeakBytes: 5,
            eventLoopLagP99MaxSeconds: 0.2,
            series: {},
            truncatedSeries: 0,
        };

        const merged = mergeSummaries([
            summary((draft) => {
                draft.metrics = [report];
            }),
            summary(),
        ]);

        expect(merged.metrics).toEqual([report]);
        expect(merged.serverCpuPercentOfOneCore).toBe(120);
    });
});

describe("validity of a merged run", () => {
    it("accepts a healthy set of processes", () => {
        expect(mergeSummaries([summary(), summary()])).toMatchObject({ valid: true, invalidReasons: [] });
    });

    it.each([
        [
            "a process short of its sessions",
            (draft: MergeableSummary) => {
                draft.sessions.accepted = 249;
            },
            "249 of 250 sessions accepted",
        ],
        [
            "a rejected session",
            (draft: MergeableSummary) => {
                draft.sessions.rejected = 1;
            },
            "1 sessions rejected",
        ],
        [
            "a socket the server closed",
            (draft: MergeableSummary) => {
                draft.sessions.unexpectedCloses = 2;
            },
            "closed by the server",
        ],
        [
            "a 1006 close",
            (draft: MergeableSummary) => {
                draft.closeCodes = { "1000": 238, "1006": 12 };
            },
            "close codes 1006",
        ],
        [
            "an unreconciled ledger",
            (draft: MergeableSummary) => {
                draft.reconciled = false;
            },
            "do not reconcile",
        ],
        [
            "a process cut short by an abort",
            (draft: MergeableSummary) => {
                draft.stopReason = "aborted";
            },
            "stopped early (aborted)",
        ],
        [
            "a window measured for 60 of its 100 seconds",
            (draft: MergeableSummary) => {
                draft.window.measuredSeconds = 60;
            },
            "measured 60 s of the 100 s",
        ],
        [
            "a whole run measured for 100 of its 240 seconds, with no window",
            (draft: MergeableSummary) => {
                draft.window = { enabled: false, seconds: 0, measuredSeconds: 100 };
            },
            "measured 100 s of the 240 s",
        ],
        [
            "a window that measured nothing",
            (draft: MergeableSummary) => {
                draft.window.measuredSeconds = null;
            },
            "measured 0 s of the 100 s",
        ],
        [
            "a generator at 70% of a core",
            (draft: MergeableSummary) => {
                draft.generator.cpuPercentOfOneCore = 70;
            },
            "generator-bound, 70%",
        ],
        [
            "a generator with 12 ms lag",
            (draft: MergeableSummary) => {
                draft.generator.eventLoopLagMs.p99 = 12;
            },
            "event-loop lag p99 12 ms",
        ],
    ])("rejects %s", (_name, tweak, reason) => {
        const merged = mergeSummaries([summary(), summary(tweak)]);

        expect(merged.valid).toBe(false);
        expect(merged.invalidReasons).toHaveLength(1);
        expect(merged.invalidReasons[0]).toContain("process 1");
        expect(merged.invalidReasons[0]).toContain(reason);
    });

    it("allows the window to come up a couple of seconds short, and no more", () => {
        const measured = (seconds: number) =>
            mergeSummaries([
                summary((draft) => {
                    draft.window.measuredSeconds = seconds;
                }),
            ]).valid;

        expect(measured(98)).toBe(true);
        expect(measured(97.9)).toBe(false);
        expect(DEFAULT_LIMITS.maxWindowShortfallSeconds).toBe(2);
    });

    it("is not valid with nothing to merge", () => {
        expect(mergeSummaries([])).toMatchObject({ valid: false, processes: 0 });
    });
});

describe("a run that is not the one the launcher started", () => {
    /** Four processes of 250 bots each: the level-1000 run of the staircase. */
    const fourProcesses = () =>
        [0, 1, 2, 3].map((index) =>
            summary((draft) => {
                draft.scenario.firstPathIndex = index * 250;
                draft.scenario.lastPathIndex = index * 250 + 249;
            }),
        );

    it("accepts every process when the launcher's expectation is met", () => {
        const merged = mergeSummaries(fourProcesses(), DEFAULT_LIMITS, { processes: 4, sessions: 1000 });

        expect(merged).toMatchObject({ valid: true, invalidReasons: [] });
    });

    it("rejects a missing process, which the surviving summaries cannot show", () => {
        // Three of the four generators died before writing: 250 bots, every one accepted, nothing wrong inside the file.
        const merged = mergeSummaries([summary()], DEFAULT_LIMITS, { processes: 4, sessions: 1000 });

        expect(merged.valid).toBe(false);
        expect(merged.invalidReasons).toEqual([
            expect.stringContaining("1 generator summaries found, 4 expected"),
            "the processes asked for 250 bots in all, the level has 1000",
        ]);
    });

    it("rejects a leftover summary from an earlier attempt", () => {
        const merged = mergeSummaries([...fourProcesses(), summary()], DEFAULT_LIMITS, { processes: 4 });

        expect(merged.valid).toBe(false);
        expect(merged.invalidReasons).toEqual([expect.stringContaining("5 generator summaries found, 4 expected")]);
    });

    it("rejects processes that share out another number of bots than the level has", () => {
        const merged = mergeSummaries(fourProcesses(), DEFAULT_LIMITS, { processes: 4, sessions: 1200 });

        expect(merged.invalidReasons).toEqual(["the processes asked for 1000 bots in all, the level has 1200"]);
    });

    it("checks nothing it was not told to expect", () => {
        expect(mergeSummaries([summary()]).valid).toBe(true);
        expect(mergeSummaries([summary()], DEFAULT_LIMITS, {}).valid).toBe(true);
    });
});

describe("reading a summary file", () => {
    it("refuses a summary from a generator that predates the steady-window report", () => {
        expect(() => assertMergeableSummary({ schemaVersion: 3, sessions: {} }, "gen-0.json")).toThrow(
            "gen-0.json: schemaVersion 3 predates",
        );
    });

    it("refuses a summary that does not say why the run stopped", () => {
        const { stopReason: _stopReason, ...withoutStopReason } = summary();

        expect(() => assertMergeableSummary(withoutStopReason, "gen-0.json")).toThrow(/missing stopReason/);
    });

    it("names the blocks a summary lacks", () => {
        expect(() => assertMergeableSummary({ schemaVersion: 4, sessions: {} }, "gen-0.json")).toThrow(
            /missing .*traffic.*worldSpace/,
        );
    });

    it("merges the summary a real run writes", async () => {
        // The generator's own output must satisfy the merge's shape, or the staircase fails after the first level.
        const pusher = await startFakePusher("accept");
        try {
            const config: LoadConfig = {
                ...parseConfig([], {
                    WA_PUSHER_URL: pusher.url,
                    WA_ROOM_URLS: "http://play.test/_/global/maps.test/a.json",
                    WA_SESSIONS: "3",
                    WA_RAMP_SECONDS: "0.05",
                    WA_DURATION_SECONDS: "1.5",
                    WA_MOVE_HZ: "20",
                }),
            };
            const real = JSON.parse(JSON.stringify(await runLoad(config))) as unknown;

            assertMergeableSummary(real, "real run");
            const merged = mergeSummaries([real, real]);

            expect(merged.sessions.accepted).toBe(6);
            // The fake pusher shares this process's event loop, so a "generator-bound" verdict is fair here; nothing
            // else may be wrong with the run.
            expect(merged.invalidReasons.filter((reason) => !reason.includes("generator-bound"))).toEqual([]);
        } finally {
            await pusher.close();
        }
    });

    it("flags a real run that was aborted before its duration", async () => {
        // The merge must read the generator's own stopReason and measured window, not a fixture's.
        const pusher = await startFakePusher("accept");
        try {
            const config: LoadConfig = parseConfig([], {
                WA_PUSHER_URL: pusher.url,
                WA_ROOM_URLS: "http://play.test/_/global/maps.test/a.json",
                WA_SESSIONS: "2",
                WA_RAMP_SECONDS: "0.05",
                WA_DURATION_SECONDS: "6",
                WA_MOVE_HZ: "20",
            });
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 400);
            const real = JSON.parse(JSON.stringify(await runLoad(config, controller.signal))) as unknown;

            assertMergeableSummary(real, "aborted run");
            const merged = mergeSummaries([real]);

            expect(real.stopReason).toBe("aborted");
            expect(merged.valid).toBe(false);
            expect(merged.invalidReasons).toEqual(
                expect.arrayContaining([
                    expect.stringContaining("stopped early (aborted)"),
                    expect.stringContaining("of the 6 s it was meant to cover"),
                ]),
            );
        } finally {
            await pusher.close();
        }
    });
});

describe("staircase", () => {
    function level(accepted: number, overrides: Partial<MergedSummary> = {}): MergedSummary {
        const merged = mergeSummaries([
            summary((draft) => {
                draft.sessions.requested = accepted;
                draft.sessions.accepted = accepted;
            }),
        ]);
        return { ...merged, ...overrides };
    }

    it("finds the first level of each repeat that stops holding", () => {
        const runs = [
            { repeat: 1, level: 300, merged: level(300) },
            { repeat: 1, level: 500, merged: level(500, { serverCpuPercentOfOneCore: 105 }) },
            { repeat: 1, level: 700, merged: level(700, { serverCpuPercentOfOneCore: 130 }) },
            { repeat: 2, level: 300, merged: level(300) },
            { repeat: 2, level: 500, merged: level(500) },
            {
                repeat: 2,
                level: 700,
                merged: level(700, { delivery: { expected: 1000, received: 900, pooledRatio: 0.9 } }),
            },
        ];

        const staircase = summarizeStaircase(runs);

        expect(staircase.kneeByRepeat).toEqual([
            { repeat: 1, level: 500, failures: ["server at 105% of one core"] },
            { repeat: 2, level: 700, failures: ["delivery 0.9 below 0.99"] },
        ]);
    });

    it("reports no knee when every level holds, and judges latency only when asked to", () => {
        const runs = [
            { repeat: 1, level: 300, merged: level(300) },
            { repeat: 1, level: 1000, merged: level(1000) },
        ];

        expect(summarizeStaircase(runs).kneeByRepeat).toEqual([{ repeat: 1, level: null, failures: [] }]);
        expect(
            summarizeStaircase(runs, { minDelivery: 0.99, maxServerCpuPercent: 100, maxMoveP95Ms: 100 })
                .kneeByRepeat[0],
        ).toMatchObject({ level: 300, failures: ["move latency p95 110 ms above 100 ms"] });
    });

    it("counts an invalid run as a failed level", () => {
        const invalid = mergeSummaries([
            summary((draft) => {
                draft.sessions.requested = 300;
                draft.sessions.accepted = 100;
            }),
        ]);

        const staircase = summarizeStaircase([{ repeat: 1, level: 300, merged: invalid }]);

        expect(staircase.kneeByRepeat[0]).toEqual({ repeat: 1, level: 300, failures: ["run not valid"] });
    });

    it("does not read a level as held when processes are missing from its merged run", () => {
        // Level 1000 with one of four summaries: the launcher's expectation turns it invalid, and the knee lands on it.
        const cut = mergeSummaries([summary()], DEFAULT_LIMITS, { processes: 4, sessions: 1000 });

        const staircase = summarizeStaircase([
            { repeat: 1, level: 300, merged: level(300) },
            { repeat: 1, level: 1000, merged: cut },
        ]);

        expect(staircase.kneeByRepeat).toEqual([
            { repeat: 1, level: 1000, failures: ["run not valid", "250 bots requested, the level has 1000"] },
        ]);
    });

    it("counts a level as failed when its merged run requested another number of bots, even if it looks valid", () => {
        // A merged.json written without the expectation is valid on its own; the level it sits under says otherwise.
        const staircase = summarizeStaircase([{ repeat: 1, level: 1000, merged: level(750) }]);

        expect(staircase.rows[0].valid).toBe(true);
        expect(staircase.kneeByRepeat).toEqual([
            { repeat: 1, level: 1000, failures: ["750 bots requested, the level has 1000"] },
        ]);
    });

    it("takes the median of the valid runs of each level", () => {
        const runs = [3, 1, 2].map((repeat) => ({
            repeat,
            level: 500,
            merged: level(500, {
                delivery: { expected: 100, received: 100, pooledRatio: [0.97, 0.99, 1][repeat - 1] },
            }),
        }));

        expect(summarizeStaircase(runs).medianByLevel).toEqual([
            { level: 500, validRuns: 3, deliveryPooled: 0.99, moveP95WorstMs: 110, serverCpuPercent: null },
        ]);
    });
});

describe("median", () => {
    it("takes the middle value, the mean of the two middle ones for an even count, and ignores nulls", () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([1, 2, 3, 10])).toBe(2.5);
        expect(median([null, 7, null])).toBe(7);
        expect(median([])).toBeNull();
    });
});
