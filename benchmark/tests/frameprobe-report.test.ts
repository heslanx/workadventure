import { describe, expect, it } from "vitest";
import {
    botsDurationSeconds,
    buildConditions,
    buildSchedule,
    estimateSeconds,
    runSchedule,
    sessionSeconds,
    summarizeRuns,
    type ScheduledRun,
} from "../frame-probe/matrix";
import { buildReport, renderMarkdown, REPORT_SCHEMA_VERSION, type ReportInput } from "../frame-probe/report";
import { parseBudget, parseExpectation } from "../frame-probe/verdict";
import {
    FX_OFF_BUDGET_OFF,
    FX_OFF_BUDGET_ON,
    FX_ON_BUDGET_OFF,
    FX_ON_BUDGET_ON,
    GPU,
    NO_GPU_TIMER,
    SWIFTSHADER,
    failedRun,
    okRun,
    session,
} from "./support/frameProbeFixtures";

describe("the schedule", () => {
    const conditions = buildConditions(["on", "off"], ["off", "on"]);

    it("crosses the two switches, effects first", () => {
        expect(conditions).toEqual([FX_ON_BUDGET_OFF, FX_ON_BUDGET_ON, FX_OFF_BUDGET_OFF, FX_OFF_BUDGET_ON]);
    });

    it("runs every condition once per round, each round starting one condition later", () => {
        const schedule = buildSchedule(conditions, 3);

        expect(schedule).toHaveLength(12);
        expect(schedule.map((run) => run.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        expect(schedule.slice(0, 4).map((run) => run.condition)).toEqual([
            FX_ON_BUDGET_OFF,
            FX_ON_BUDGET_ON,
            FX_OFF_BUDGET_OFF,
            FX_OFF_BUDGET_ON,
        ]);
        // Round 2 starts at the second condition, round 3 at the third
        expect(schedule[4].condition).toEqual(FX_ON_BUDGET_ON);
        expect(schedule[8].condition).toEqual(FX_OFF_BUDGET_OFF);
        expect(schedule.map((run) => run.repeat)).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
        for (const condition of conditions) {
            expect(schedule.filter((run) => run.condition === condition)).toHaveLength(3);
        }
    });

    it("never runs a condition twice in a row, so a drift in the machine does not land on one", () => {
        const schedule = buildSchedule(conditions, 3);

        for (let index = 1; index < schedule.length; index++) {
            expect(schedule[index].condition).not.toBe(schedule[index - 1].condition);
        }
    });

    it("repeats a single condition", () => {
        expect(buildSchedule([FX_ON_BUDGET_OFF], 3).map((run) => run.condition)).toEqual([
            FX_ON_BUDGET_OFF,
            FX_ON_BUDGET_OFF,
            FX_ON_BUDGET_OFF,
        ]);
    });
});

describe("how long the probe takes", () => {
    const timing = {
        settleSeconds: 5,
        recordSeconds: 25,
        zoomWindowSeconds: 2,
        zoomSettleSeconds: 2,
        wsSampleSeconds: 5,
        wholeMap: true,
    };

    it("adds the entry, the settle, each recording with its WebSocket sample and the zoom step", () => {
        // 30 entry + 5 settle + (25 + 5) default + (2 window + 3 scale polls + 2 settle + 25 + 5) whole map
        expect(sessionSeconds(timing)).toBe(102);
        expect(estimateSeconds(timing, 12)).toBe(1224);
    });

    it("leaves the zoom step out when only the default view is measured", () => {
        expect(sessionSeconds({ ...timing, wholeMap: false })).toBe(65);
    });

    it("sizes the bots' --duration-seconds to the sessions plus the 45 s before the probe starts and a 60 s margin", () => {
        // The full matrix: 1224 s of sessions, the probe starts 45 s after the bots, then a margin
        expect(botsDurationSeconds(timing, 12)).toBe(1224 + 45 + 60);
        // The shipping run alone: 3 sessions of 102 s. Sizing it to the sessions and the ramp (306 + 30) would end the
        // bots at 336 s, while the last session ends near 45 + 306 = 351 s
        expect(botsDurationSeconds(timing, 3)).toBe(411);
        expect(botsDurationSeconds(timing, 3)).toBeGreaterThan(45 + estimateSeconds(timing, 3));
    });
});

describe("running the schedule", () => {
    const schedule = buildSchedule([FX_ON_BUDGET_OFF], 3);

    it("keeps one record per session, in order, and reports each as it ends", async () => {
        const seen: number[] = [];

        const records = await runSchedule(
            schedule,
            (run) => Promise.resolve(session({ default: { "work.p95": run.index } })),
            (record) => seen.push(record.index),
        );

        expect(records.map((record) => record.status)).toEqual(["ok", "ok", "ok"]);
        expect(seen).toEqual([1, 2, 3]);
    });

    it("stops at the first failed session and keeps its message", async () => {
        const measured: number[] = [];

        const records = await runSchedule(schedule, (run: ScheduledRun) => {
            measured.push(run.index);
            return run.index === 2
                ? Promise.reject(new Error("page.waitForFunction: Timeout 90000ms exceeded"))
                : Promise.resolve(session({ default: {} }));
        });

        expect(measured).toEqual([1, 2]);
        expect(records).toHaveLength(2);
        expect(records[1]).toMatchObject({ status: "failed", error: "page.waitForFunction: Timeout 90000ms exceeded" });
    });
});

describe("the median of the runs", () => {
    const runs = (values: number[], condition = FX_ON_BUDGET_OFF) =>
        values.map((value, index) => okRun(index + 1, condition, session({ default: { "work.p95": value } })));

    it("is the median of each metric, with the lowest and highest run beside it", () => {
        const [only] = summarizeRuns(runs([8, 6, 10]));

        expect(only).toMatchObject({ view: "default", runs: 3 });
        expect(only.median["work.p95"]).toBe(8);
        expect(only.min["work.p95"]).toBe(6);
        expect(only.max["work.p95"]).toBe(10);
    });

    it("is not moved by one bad run among three", () => {
        expect(summarizeRuns(runs([8, 30, 9]))[0].median["work.p95"]).toBe(9);
    });

    it("averages the two middle runs when one run is missing a phase, and skips a metric a run lacks", () => {
        const mixed = [
            okRun(1, FX_ON_BUDGET_OFF, session({ default: { "work.p95": 5 } })),
            okRun(2, FX_ON_BUDGET_OFF, session({ default: {} })),
            okRun(3, FX_ON_BUDGET_OFF, session({ default: { "work.p95": 7 } })),
        ];

        const [only] = summarizeRuns(mixed);

        expect(only.median["work.p95"]).toBe(6);
        expect(only.min["work.p95"]).toBe(5);
        expect(only.max["work.p95"]).toBe(7);
        expect(only.median["work.p99"]).toBeNull();
    });

    it("counts only the runs that completed, keeps conditions apart, and lists the views in order", () => {
        const summaries = summarizeRuns([
            okRun(1, FX_ON_BUDGET_OFF, session({ wholeMap: { "work.p95": 20 }, default: { "work.p95": 8 } })),
            okRun(2, FX_ON_BUDGET_ON, session({ default: { "work.p95": 6 } })),
            failedRun(3, FX_ON_BUDGET_OFF, "boom"),
        ]);

        expect(summaries.map((summary) => [summary.view, summary.condition, summary.runs])).toEqual([
            ["default", FX_ON_BUDGET_OFF, 1],
            ["default", FX_ON_BUDGET_ON, 1],
            ["wholeMap", FX_ON_BUDGET_OFF, 1],
        ]);
    });
});

describe("the report", () => {
    const measured = (work95: number, rx95 = 31.2) =>
        session({
            default: {
                "work.p50": 7.4,
                "work.p95": work95,
                "step.p95": 5.2,
                "render.p95": 2.3,
                "interval.p95": 16.7,
                frames: 900,
                "longTasks.count": 0,
                "longTasks.maxMs": 0,
                "nameTags.present": 114,
                "nameTags.shown": 114,
                "ws.rxKiBps.p50": 20.5,
                "ws.rxKiBps.p95": rx95,
            },
        });
    const input = (overrides: Partial<ReportInput> = {}): ReportInput => ({
        startedAt: "2026-11-21T18:30:00.000Z",
        finishedAt: "2026-11-21T18:50:00.000Z",
        environment: { browserVersion: "Chromium 147.0", platform: "darwin", nodeVersion: "v24.18.0" },
        config: {
            url: "http://127.0.0.1:3010/~/konclui-office/office.wam",
            runs: 3,
            fx: ["on"],
            detailBudget: ["off"],
            views: ["default"],
            settleSeconds: 5,
            recordSeconds: 25,
            wheel: { delta: 800, events: 2 },
            zoomWindowSeconds: 2,
            zoomSettleSeconds: 2,
            wsSampleSeconds: 5,
            viewport: { width: 1451, height: 855 },
            rendererRequested: "gpu",
            allowSoftwareRenderer: false,
            budgets: ["work.p95=16.7@default"],
            reductions: [],
            expectations: [],
        },
        plannedRuns: 3,
        runs: [
            okRun(1, FX_ON_BUDGET_OFF, measured(8.4)),
            okRun(2, FX_ON_BUDGET_OFF, measured(8.5), 2),
            okRun(3, FX_ON_BUDGET_OFF, measured(8.6), 3),
        ],
        budgets: [parseBudget("work.p95=16.7@default")],
        reductions: [],
        expectations: [],
        ...overrides,
    });

    it("has a fixed shape: schema version, environment, runs, summaries and the verdict with its exit code", () => {
        const report = buildReport(input());

        expect(report).toMatchObject({
            schemaVersion: REPORT_SCHEMA_VERSION,
            tool: "frame-probe",
            plannedRuns: 3,
            config: { budgets: ["work.p95=16.7@default"] },
            environment: { browserVersion: "Chromium 147.0", renderers: [GPU], gpu: true },
            verdict: { status: "pass", exitCode: 0 },
        });
        expect(report.runs).toHaveLength(3);
        expect(report.summaries).toHaveLength(1);
        expect(report.summaries[0].median["work.p95"]).toBe(8.5);
    });

    it("survives a trip through JSON unchanged, so the file says what the run said", () => {
        const report = buildReport(input());

        expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    });

    it("says the run was not on a GPU when a session rendered in software", () => {
        const report = buildReport(
            input({ runs: [okRun(1, FX_ON_BUDGET_OFF, { ...measured(8), renderer: SWIFTSHADER })], plannedRuns: 1 }),
        );

        expect(report.environment).toMatchObject({ renderers: [SWIFTSHADER], gpu: false });
        expect(report.verdict).toMatchObject({ status: "invalid", exitCode: 2 });
    });

    it("renders the verdict, the checks and one table per phase", () => {
        const markdown = renderMarkdown(buildReport(input({ budgets: [parseBudget("work.p95=8@default")] })));

        expect(markdown).toContain("## Verdict: FAIL (exit code 1)");
        expect(markdown).toContain(
            "- FAIL: work.p95 in default, fx on, detail budget off: median 8.5 against at most 8",
        );
        expect(markdown).toContain("## Default zoom");
        expect(markdown).toContain(
            "| Effects | Detail budget | Runs | Work p50 ms | Work p95 ms (runs) | Step p95 ms | Render p95 ms | Interval p95 ms | GPU p95 ms | Frames | Long tasks | Longest ms | Name tags shown / in DOM | Received KiB/s p50 / p95 |",
        );
        expect(markdown).toContain(
            "| on | off | 3 | 7.4 | 8.5 (8.4 to 8.6) | 5.2 | 2.3 | 16.7 | n/a | 900 | 0 | 0 | 114 / 114 | 20.5 / 31.2 |",
        );
        expect(markdown).not.toContain("## Whole map");
    });

    it("says so when no budget was given, and lists why a run cannot be trusted", () => {
        const markdown = renderMarkdown(
            buildReport(
                input({
                    budgets: [],
                    plannedRuns: 3,
                    runs: [okRun(1, FX_ON_BUDGET_OFF, measured(8)), failedRun(2, FX_ON_BUDGET_OFF, "page crashed", 2)],
                }),
            ),
        );

        expect(markdown).toContain("## Verdict: INVALID (exit code 2)");
        expect(markdown).toContain("- run 2 (fx on, detail budget off) failed: page crashed");
        expect(markdown).toContain("No budget was given: this run only reports.");
        expect(markdown).toContain("- Run 2 (round 2, fx on, detail budget off): failed, page crashed");
    });

    it("says in the summary why there is no GPU time, with the page's reason and how many phases lacked it", () => {
        const markdown = renderMarkdown(buildReport(input()));

        expect(markdown).toContain(
            `GPU time: n/a in 3 of 3 phases (${NO_GPU_TIMER}: 3). A budget on a gpu.* metric is invalid then.`,
        );
    });

    it("shows the GPU time, and says nothing about a missing one, when every phase was timed", () => {
        const timed = session({ default: { "work.p95": 8, "gpu.p95": 4.2 } });
        const markdown = renderMarkdown(
            buildReport(input({ runs: [okRun(1, FX_ON_BUDGET_OFF, timed)], plannedRuns: 1 })),
        );

        expect(markdown).not.toContain("GPU time: n/a");
        expect(markdown).toContain("| on | off | 1 | n/a | 8 | n/a | n/a | n/a | 4.2 | 1500 |");
    });

    it("records the expectations of the run in its configuration, and judges them", () => {
        const report = buildReport(
            input({
                config: { ...input().config, expectations: ["nameTags.present=300@default"] },
                expectations: [parseExpectation("nameTags.present=300@default")],
            }),
        );

        expect(report.config.expectations).toEqual(["nameTags.present=300@default"]);
        expect(report.verdict).toMatchObject({ status: "invalid", exitCode: 2 });
        expect(renderMarkdown(report)).toContain(
            "the load the run expected is not there: nameTags.present in default, fx on, detail budget off: lowest run 114 against at least 300",
        );
    });

    it("shows the page errors of a run beside its numbers", () => {
        const noisy = { ...measured(8), pageErrors: ["TypeError: x is undefined"] };
        const markdown = renderMarkdown(
            buildReport(input({ runs: [okRun(1, FX_ON_BUDGET_OFF, noisy)], plannedRuns: 1, budgets: [] })),
        );

        expect(markdown).toContain("ok, with 1 page errors, the first: TypeError: x is undefined");
    });
});
