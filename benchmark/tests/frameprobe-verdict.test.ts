import { describe, expect, it } from "vitest";
import {
    BudgetSyntaxError,
    evaluateBudgets,
    evaluateExpectations,
    evaluateReductions,
    exitCodeOf,
    judge,
    parseBudget,
    parseExpectation,
    parseReduction,
    type JudgeInput,
} from "../frame-probe/verdict";
import {
    FX_OFF_BUDGET_OFF,
    FX_OFF_BUDGET_ON,
    FX_ON_BUDGET_OFF,
    FX_ON_BUDGET_ON,
    NO_GPU_TIMER,
    SWIFTSHADER,
    failedRun,
    metrics,
    okRun,
    session,
    summary,
} from "./support/frameProbeFixtures";

describe("budgets and reductions on the command line", () => {
    it("reads a metric, a limit and the view it applies to", () => {
        expect(parseBudget("work.p95=16.7@default")).toEqual({
            metric: "work.p95",
            limit: 16.7,
            view: "default",
            scope: { fx: "any", detailBudget: "any" },
            raw: "work.p95=16.7@default",
        });
    });

    it("applies to every view when none is named", () => {
        expect(parseBudget("longTasks.count=0")).toMatchObject({ metric: "longTasks.count", limit: 0, view: "any" });
    });

    it("rejects a metric, a limit or a view it does not know, with the grammar, instead of ignoring the budget", () => {
        expect(() => parseBudget("work.p96=1")).toThrow(BudgetSyntaxError);
        expect(() => parseBudget("work.p96=1")).toThrow(/not a metric.*<metric>=<number>\[@<view>\]/);
        expect(() => parseBudget("work.p95=fast")).toThrow(/number of 0 or more/);
        expect(() => parseBudget("work.p95=-1")).toThrow(/number of 0 or more/);
        expect(() => parseBudget("work.p95")).toThrow(/no limit given/);
        expect(() => parseBudget("work.p95=1@moon")).toThrow(/not a view/);
    });

    it("reads the conditions a budget binds after the view, in either order", () => {
        expect(parseBudget("longTasks.count=0@zoom:detail=on")).toMatchObject({
            view: "zoom",
            scope: { fx: "any", detailBudget: "on" },
        });
        expect(parseBudget("work.p95=16.7:detail=off:fx=on")).toMatchObject({
            view: "any",
            scope: { fx: "on", detailBudget: "off" },
        });
    });

    it("rejects a condition it does not know, or one given twice, instead of binding more than was meant", () => {
        expect(() => parseBudget("work.p95=1@default:detail=maybe")).toThrow(/not a condition/);
        expect(() => parseBudget("work.p95=1@default:gpu=on")).toThrow(/not a condition/);
        expect(() => parseBudget("work.p95=1@default:detail")).toThrow(/not a condition/);
        expect(() => parseBudget("work.p95=1@default:detail=on:detail=off")).toThrow(/"detail" is given twice/);
    });

    it("reads a reduction as a percentage and refuses more than 100", () => {
        expect(parseReduction("work.p50=50@wholeMap")).toMatchObject({
            metric: "work.p50",
            percent: 50,
            view: "wholeMap",
        });
        expect(() => parseReduction("work.p50=150")).toThrow(/100 at most/);
    });

    it("reads an expectation as a minimum, and takes no condition: it holds for every one", () => {
        expect(parseExpectation("nameTags.present=300@wholeMap")).toEqual({
            metric: "nameTags.present",
            min: 300,
            view: "wholeMap",
            raw: "nameTags.present=300@wholeMap",
        });
        expect(() => parseExpectation("nameTags.present=300@wholeMap:detail=on")).toThrow(/takes no condition/);
        expect(() => parseReduction("work.p50=50@wholeMap:fx=on")).toThrow(/takes no condition/);
        expect(() => parseExpectation("nameTags.people=3")).toThrow(/not a metric/);
    });
});

describe("judging a budget on the median", () => {
    const budget = parseBudget("work.p95=16.7@default");

    it("passes at the limit and fails above it", () => {
        const at = evaluateBudgets([summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 16.7 })], [budget]);
        const over = evaluateBudgets([summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 16.8 })], [budget]);

        expect(at.map((check) => check.status)).toEqual(["pass"]);
        expect(over.map((check) => check.status)).toEqual(["fail"]);
        expect(over[0]).toMatchObject({ actual: 16.8, limit: 16.7 });
        expect(over[0].label).toContain(
            "work.p95 in default, fx on, detail budget off: median 16.8 against at most 16.7",
        );
    });

    it("judges every condition of the view, each on its own", () => {
        const checks = evaluateBudgets(
            [
                summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 10 }),
                summary(FX_OFF_BUDGET_OFF, "default", { "work.p95": 20 }),
            ],
            [budget],
        );

        expect(checks.map((check) => check.status)).toEqual(["pass", "fail"]);
    });

    it("looks only at the view the budget names", () => {
        const checks = evaluateBudgets(
            [
                summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 10 }),
                summary(FX_ON_BUDGET_OFF, "wholeMap", { "work.p95": 90 }),
            ],
            [budget],
        );

        expect(checks).toHaveLength(1);
        expect(checks[0].status).toBe("pass");
    });

    it("cannot read a metric nobody measured, or a view that was not measured: that is never a pass", () => {
        const notMeasured = evaluateBudgets([summary(FX_ON_BUDGET_OFF, "default", {})], [budget]);
        const noView = evaluateBudgets(
            [summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 1 })],
            [parseBudget("work.p95=33.3@wholeMap")],
        );

        expect(notMeasured.map((check) => check.status)).toEqual(["unread"]);
        expect(noView.map((check) => check.status)).toEqual(["unread"]);
        expect(noView[0].label).toContain("nothing was measured in wholeMap");
    });
});

describe("a budget that binds only some conditions", () => {
    const rows = [
        summary(FX_ON_BUDGET_OFF, "wholeMap", { "longTasks.count": 3 }),
        summary(FX_ON_BUDGET_ON, "wholeMap", { "longTasks.count": 0 }),
        summary(FX_OFF_BUDGET_OFF, "wholeMap", { "longTasks.count": 2 }),
        summary(FX_OFF_BUDGET_ON, "wholeMap", { "longTasks.count": 0 }),
    ];

    it("judges the baseline rows only when it is not scoped, and leaves them out when it is", () => {
        const everywhere = evaluateBudgets(rows, [parseBudget("longTasks.count=0@wholeMap")]);
        const withDetail = evaluateBudgets(rows, [parseBudget("longTasks.count=0@wholeMap:detail=on")]);

        expect(everywhere.map((check) => check.status)).toEqual(["fail", "pass", "fail", "pass"]);
        expect(withDetail.map((check) => check.status)).toEqual(["pass", "pass"]);
        expect(withDetail.map((check) => check.label)).toEqual([
            "longTasks.count in wholeMap, fx on, detail budget on: median 0 against at most 0",
            "longTasks.count in wholeMap, fx off, detail budget on: median 0 against at most 0",
        ]);
    });

    it("binds one effects setting, or one cell with both conditions", () => {
        const fxOn = evaluateBudgets(rows, [parseBudget("longTasks.count=0@wholeMap:fx=on")]);
        const cell = evaluateBudgets(rows, [parseBudget("longTasks.count=0@wholeMap:fx=off:detail=off")]);

        expect(fxOn.map((check) => check.status)).toEqual(["fail", "pass"]);
        expect(cell.map((check) => check.status)).toEqual(["fail"]);
    });

    it("cannot read a scope nothing was measured in: that is never a pass", () => {
        const onlyOff = rows.filter((row) => row.condition.detailBudget === "off");

        const checks = evaluateBudgets(onlyOff, [parseBudget("longTasks.count=0@wholeMap:detail=on")]);

        expect(checks.map((check) => check.status)).toEqual(["unread"]);
        expect(checks[0].label).toBe(
            "longTasks.count=0@wholeMap:detail=on: nothing was measured in wholeMap, detail budget on",
        );
    });
});

describe("judging the gain of the detail budget", () => {
    const reduction = parseReduction("work.p50=50@wholeMap");
    const pair = (off: number, on: number, fx: "on" | "off" = "on") => [
        summary({ fx, detailBudget: "off" }, "wholeMap", { "work.p50": off }),
        summary({ fx, detailBudget: "on" }, "wholeMap", { "work.p50": on }),
    ];

    it("passes when the budget on is at least that much below it off, and fails when it is not", () => {
        const enough = evaluateReductions(pair(20, 8), [reduction]);
        const short = evaluateReductions(pair(20, 12), [reduction]);

        expect(enough[0]).toMatchObject({ status: "pass", actual: 60, limit: 50 });
        expect(short[0]).toMatchObject({ status: "fail", actual: 40 });
        expect(short[0].label).toContain("40% below off (20 to 12), at least 50% wanted");
    });

    it("judges each effects setting on its own", () => {
        const checks = evaluateReductions([...pair(20, 8, "on"), ...pair(20, 14, "off")], [reduction]);

        expect(checks.map((check) => check.status)).toEqual(["pass", "fail"]);
    });

    it("cannot read a gain when one side was not measured or the baseline is zero", () => {
        const onlyOff = evaluateReductions([pair(20, 8)[0]], [reduction]);
        const zeroBaseline = evaluateReductions(pair(0, 0), [reduction]);

        expect(onlyOff.map((check) => check.status)).toEqual(["unread"]);
        expect(zeroBaseline.map((check) => check.status)).toEqual(["unread"]);
    });
});

describe("judging the crowd the run expects", () => {
    const expectation = parseExpectation("nameTags.present=300@wholeMap");
    const crowd = (lowest: number, median = lowest) =>
        summary(FX_ON_BUDGET_OFF, "wholeMap", { "nameTags.present": median }, { min: { "nameTags.present": lowest } });

    it("passes at the minimum and fails under it", () => {
        const at = evaluateExpectations([crowd(300)], [expectation]);
        const under = evaluateExpectations([crowd(299)], [expectation]);

        expect(at.map((check) => check.status)).toEqual(["pass"]);
        expect(under.map((check) => check.status)).toEqual(["fail"]);
        expect(under[0].label).toBe(
            "nameTags.present in wholeMap, fx on, detail budget off: lowest run 299 against at least 300",
        );
    });

    it("reads the lowest run, not the median: one session that lost the crowd is enough", () => {
        const checks = evaluateExpectations([crowd(40, 301)], [expectation]);

        expect(checks.map((check) => check.status)).toEqual(["fail"]);
    });

    it("looks at the view it names, in every condition", () => {
        const checks = evaluateExpectations(
            [
                crowd(301),
                summary(FX_ON_BUDGET_ON, "wholeMap", { "nameTags.present": 12 }),
                summary(FX_ON_BUDGET_OFF, "default", { "nameTags.present": 12 }),
            ],
            [expectation],
        );

        expect(checks.map((check) => check.status)).toEqual(["pass", "fail"]);
    });

    it("cannot read a count nobody took, or a view nobody measured: that is never a pass", () => {
        const notCounted = evaluateExpectations([summary(FX_ON_BUDGET_OFF, "wholeMap", {})], [expectation]);
        const noView = evaluateExpectations([crowd(301)], [parseExpectation("nameTags.present=300@default")]);

        expect(notCounted.map((check) => check.status)).toEqual(["unread"]);
        expect(noView.map((check) => check.status)).toEqual(["unread"]);
    });
});

describe("the verdict of a whole run", () => {
    const withinBudget = session({ default: { "work.p95": 8 }, wholeMap: { "work.p95": 9 } });
    const input = (overrides: Partial<JudgeInput> = {}): JudgeInput => {
        const runs = overrides.runs ?? [okRun(1, FX_ON_BUDGET_OFF, withinBudget)];
        return {
            runs,
            summaries: [summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 8 })],
            budgets: [parseBudget("work.p95=16.7@default")],
            reductions: [],
            expectations: [],
            renderer: "gpu",
            allowSoftwareRenderer: false,
            wholeMapRequested: true,
            plannedRuns: runs.length,
            ...overrides,
        };
    };

    it("passes when every budget holds, and exits 0", () => {
        const verdict = judge(input());

        expect(verdict.status).toBe("pass");
        expect(exitCodeOf(verdict)).toBe(0);
    });

    it("passes with no budget at all: the run only reports", () => {
        const verdict = judge(input({ budgets: [] }));

        expect(verdict).toMatchObject({ status: "pass", checks: [] });
    });

    it("fails when a budget is exceeded, and exits 1", () => {
        const verdict = judge(input({ summaries: [summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 40 })] }));

        expect(verdict.status).toBe("fail");
        expect(exitCodeOf(verdict)).toBe(1);
    });

    it("is invalid, and exits 2, when a run failed, whatever the budgets say", () => {
        const verdict = judge(
            input({
                runs: [okRun(1, FX_ON_BUDGET_OFF, withinBudget), failedRun(2, FX_ON_BUDGET_ON, "page.goto: timeout")],
            }),
        );

        expect(verdict.status).toBe("invalid");
        expect(verdict.invalidReasons).toContain("run 2 (fx on, detail budget on) failed: page.goto: timeout");
        expect(exitCodeOf(verdict)).toBe(2);
    });

    it("is invalid when the probe stopped before the schedule ended", () => {
        const verdict = judge(input({ plannedRuns: 12 }));

        expect(verdict.invalidReasons).toContain("11 of 12 planned runs did not run");
    });

    it("is invalid when no run completed", () => {
        const verdict = judge(input({ runs: [failedRun(1, FX_ON_BUDGET_OFF, "boom")] }));

        expect(verdict.invalidReasons).toContain("no run completed");
    });

    it("is invalid on a software rasteriser, unless the caller asked for one", () => {
        const software = [okRun(1, FX_ON_BUDGET_OFF, session({ default: {} }, { renderer: SWIFTSHADER }))];

        expect(judge(input({ runs: software })).invalidReasons.join()).toContain("software rasteriser");
        expect(judge(input({ runs: software, allowSoftwareRenderer: true })).invalidReasons).toEqual([]);
        expect(judge(input({ runs: software, renderer: "swiftshader" })).invalidReasons).toEqual([]);
    });

    it("is invalid when a recording was cut short or recorded no frame", () => {
        const cut = {
            ...session({}),
            phases: { default: { metrics: metrics(), truncated: true, gpuNote: NO_GPU_TIMER } },
        };
        const empty = session({ default: { frames: 0 } });

        expect(judge(input({ runs: [okRun(1, FX_ON_BUDGET_OFF, cut)] })).invalidReasons.join()).toContain(
            "outgrew its buffer",
        );
        expect(judge(input({ runs: [okRun(1, FX_ON_BUDGET_OFF, empty)] })).invalidReasons.join()).toContain(
            "no frame was recorded in default",
        );
    });

    it("is invalid when the whole-map step did not zoom out, or did not run, and ignores that when it was not asked for", () => {
        const stuck = session({ default: {} }, { zoom: { defaultScale: 1, wholeMapScale: 0.98 } });
        const skipped = session({ default: {} }, { zoom: null });

        expect(judge(input({ runs: [okRun(1, FX_ON_BUDGET_OFF, stuck)] })).invalidReasons.join()).toContain(
            "the wheel did not zoom out (scale 1 before, 0.98 after)",
        );
        expect(judge(input({ runs: [okRun(1, FX_ON_BUDGET_OFF, skipped)] })).invalidReasons.join()).toContain(
            "the whole-map step did not run",
        );
        expect(
            judge(input({ runs: [okRun(1, FX_ON_BUDGET_OFF, skipped)], wholeMapRequested: false })).invalidReasons,
        ).toEqual([]);
    });

    it("is invalid when a budget could not be read", () => {
        const verdict = judge(input({ summaries: [summary(FX_ON_BUDGET_OFF, "default", {})] }));

        expect(verdict.status).toBe("invalid");
        expect(verdict.invalidReasons[0]).toContain("cannot read: work.p95 in default");
    });

    it("is invalid, not failed, when the crowd the run expected is not there, whatever the budgets say", () => {
        const verdict = judge(
            input({
                expectations: [parseExpectation("nameTags.present=100@default")],
                summaries: [summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 8, "nameTags.present": 1 })],
            }),
        );

        expect(verdict.status).toBe("invalid");
        expect(exitCodeOf(verdict)).toBe(2);
        expect(verdict.invalidReasons).toEqual([
            "the load the run expected is not there: nameTags.present in default, fx on, detail budget off: lowest run 1 against at least 100",
        ]);
    });

    it("passes when the crowd is there and every budget holds, and still fails an exceeded budget", () => {
        const expectations = [parseExpectation("nameTags.present=100@default")];
        const crowd = { "nameTags.present": 101 };

        const within = judge(
            input({ expectations, summaries: [summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 8, ...crowd })] }),
        );
        const over = judge(
            input({ expectations, summaries: [summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 40, ...crowd })] }),
        );

        expect(within.status).toBe("pass");
        expect(over.status).toBe("fail");
    });

    it("says why there is no GPU time when a gpu.* budget cannot be read", () => {
        const verdict = judge(
            input({
                budgets: [parseBudget("gpu.p95=16.7@default")],
                runs: [okRun(1, FX_ON_BUDGET_OFF, session({ default: { "work.p95": 8 } }))],
                summaries: [summary(FX_ON_BUDGET_OFF, "default", { "work.p95": 8 })],
            }),
        );

        expect(verdict.status).toBe("invalid");
        expect(verdict.invalidReasons).toEqual([
            "cannot read: gpu.p95 in default, fx on, detail budget off: not measured (no GPU time: extension-missing)",
        ]);
    });

    it("judges the reductions too", () => {
        const verdict = judge(
            input({
                budgets: [],
                reductions: [parseReduction("work.p50=50@default")],
                summaries: [
                    summary(FX_OFF_BUDGET_OFF, "default", { "work.p50": 10 }),
                    summary(FX_OFF_BUDGET_ON, "default", { "work.p50": 9 }),
                ],
            }),
        );

        expect(verdict.status).toBe("fail");
    });
});
