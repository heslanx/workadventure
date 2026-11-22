import { describe, expect, it } from "vitest";
import { parseArgs, parseViewport, UsageError, type FramesConfig } from "../frame-probe/args";
import type { FrameProbeReport } from "../frame-probe/report";
import { launchOptions, type Measurer } from "../frame-probe/browser";
import { main, type CliDependencies } from "../frame-probe/cli";
import { pairShots, shotFileName, type Shot } from "../frame-probe/compare";
import type { ScheduledRun } from "../frame-probe/matrix";
import type { SessionMeasurement } from "../frame-probe/types";
import { session } from "./support/frameProbeFixtures";

const ROOM = "http://127.0.0.1:3010/~/konclui-office/office.wam";
const MAC = { platform: "darwin" };

function frames(...args: string[]): FramesConfig {
    const config = parseArgs(["frames", ROOM, ...args], MAC);
    if (config.command !== "frames") {
        throw new Error("expected the frames command");
    }
    return config;
}

describe("the command line", () => {
    it("measures the whole matrix by default: both switches, both views, three rounds, the decision's timings", () => {
        const config = frames();

        expect(config).toMatchObject({
            url: ROOM,
            runs: 3,
            fx: ["on", "off"],
            detailBudget: ["off", "on"],
            views: ["default", "wholeMap"],
            settleSeconds: 5,
            recordSeconds: 25,
            wheelDelta: 800,
            wheelEvents: 2,
            zoomWindowSeconds: 2,
            wsSampleSeconds: 5,
            viewport: { width: 1451, height: 855 },
            budgets: [],
            reductions: [],
            expectations: [],
            dryRun: false,
            allowSoftwareRenderer: false,
            browser: { renderer: "gpu", angle: "metal", locale: "pt-BR" },
        });
    });

    it("leaves the ANGLE backend to Chromium off macOS, and obeys --angle=none", () => {
        expect(parseArgs(["frames", ROOM], { platform: "linux" })).toMatchObject({ browser: { angle: undefined } });
        expect(frames("--angle=none").browser.angle).toBeUndefined();
        expect(frames("--angle=d3d11").browser.angle).toBe("d3d11");
    });

    it("reads the options, budgets and reductions, repeated ones included", () => {
        const config = frames(
            "--runs=1",
            "--fx=on",
            "--detail-budget=on,off",
            "--views=default",
            "--budget=work.p95=16.7@default",
            "--budget=longTasks.count=0@zoom:detail=on",
            "--require-reduction=work.p50=50@wholeMap",
            "--expect-at-least=nameTags.present=300@wholeMap",
            "--allow-software-renderer",
            "--screenshots",
            "--dry-run",
        );

        expect(config).toMatchObject({
            runs: 1,
            fx: ["on"],
            detailBudget: ["on", "off"],
            views: ["default"],
            allowSoftwareRenderer: true,
            screenshots: true,
            dryRun: true,
        });
        expect(config.budgets.map((budget) => budget.raw)).toEqual([
            "work.p95=16.7@default",
            "longTasks.count=0@zoom:detail=on",
        ]);
        expect(config.budgets[1].scope).toEqual({ fx: "any", detailBudget: "on" });
        expect(config.reductions.map((reduction) => reduction.raw)).toEqual(["work.p50=50@wholeMap"]);
        expect(config.expectations.map((expectation) => expectation.raw)).toEqual(["nameTags.present=300@wholeMap"]);
    });

    it.each([
        [["frames", ROOM, "--rus=1"], /unknown option --rus/],
        [["frames", ROOM, "--runs=0"], /--runs must be a whole number of 1 or more/],
        [["frames", ROOM, "--runs=2.5"], /--runs must be a whole number/],
        [["frames", ROOM, "--runs"], /--runs needs a value/],
        [["frames", ROOM, "--fx=maybe"], /--fx takes on and\/or off/],
        [["frames", ROOM, "--budget=work.p95"], /no limit given/],
        [["frames", ROOM, "--budget=work.p96=1"], /not a metric/],
        [["frames", ROOM, "--budget=work.p95=1@default:detail=sometimes"], /not a condition/],
        [["frames", ROOM, "--expect-at-least=nameTags.present"], /no limit given/],
        [["frames", ROOM, "--expect-at-least=nameTags.present=3:fx=on"], /takes no condition/],
        [["frames", ROOM, "--renderer=cpu"], /--renderer takes gpu or swiftshader/],
        [["frames", "not-a-url"], /not an http\(s\) URL/],
        [["frames"], /needs the room URL/],
        [["frames", ROOM, "extra"], /expected one room URL/],
        [["measure", ROOM], /must be frames, compare, panel or gate1/],
        [["panel", ROOM, "--runs=3"], /unknown option --runs/],
    ])("refuses %j instead of falling back to a default", (argv, message) => {
        expect(() => parseArgs(argv, MAC)).toThrow(UsageError);
        expect(() => parseArgs(argv, MAC)).toThrow(message);
    });

    it("reads the viewports of the screenshot passes", () => {
        expect(parseViewport("375x812")).toEqual({ width: 375, height: 812 });
        expect(() => parseViewport("375")).toThrow(/WIDTHxHEIGHT/);
        expect(() => parseViewport("100x100")).toThrow(/at least 200x200/);
        expect(parseArgs(["compare", ROOM, "--reference-url=http://127.0.0.1:8090/"], MAC)).toMatchObject({
            referenceUrl: "http://127.0.0.1:8090/",
            viewports: [{ width: 1451, height: 855 }],
        });
        const panel = parseArgs(["panel", ROOM], MAC);
        expect(panel).toMatchObject({ command: "panel" });
        expect(panel.command === "panel" && panel.viewports.map((viewport) => viewport.width)).toEqual([
            1440, 1000, 768, 360,
        ]);
    });
});

describe("the browser flags", () => {
    it("asks for the full Chromium with a GPU backend, and for the headless shell on SwiftShader on request", () => {
        expect(launchOptions({ renderer: "gpu", angle: "metal", playwrightDir: undefined, locale: "pt-BR" })).toEqual({
            headless: true,
            channel: "chromium",
            args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
        });
        expect(
            launchOptions({ renderer: "gpu", angle: undefined, playwrightDir: undefined, locale: "pt-BR" }).args,
        ).toEqual(["--enable-gpu", "--ignore-gpu-blocklist"]);
        expect(
            launchOptions({ renderer: "swiftshader", angle: "metal", playwrightDir: undefined, locale: "pt-BR" }),
        ).toEqual({
            headless: true,
            args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        });
    });
});

describe("the screenshot walkthrough", () => {
    const shot = (key: string, label = ""): Shot => ({ key, label, path: `/out/${key}.png` });

    it("names a screenshot by side, width, step and label", () => {
        expect(shotFileName("native", 1451, { key: "5-settings-02", label: "Atalhos" })).toBe(
            "native-1451-5-settings-02-Atalhos.png",
        );
        expect(shotFileName("reference", 375, { key: "1-login", label: "" })).toBe("reference-375-1-login.png");
    });

    it("pairs the steps both sides took by step, not by label, and reports the steps only one side has", () => {
        const { pairs, unmatched } = pairShots(
            [shot("1-login"), shot("4-office"), shot("5-settings-00", "Perfil"), shot("5-settings-01", "Som")],
            [shot("1-login"), shot("4-office"), shot("5-settings-00", "Profile"), shot("5-settings-09", "Beta")],
        );

        expect(pairs.map((pair) => [pair.key, pair.native.label, pair.reference.label])).toEqual([
            ["1-login", "", ""],
            ["4-office", "", ""],
            ["5-settings-00", "Perfil", "Profile"],
        ]);
        expect(unmatched).toEqual([
            { side: "native", key: "5-settings-01" },
            { side: "reference", key: "5-settings-09" },
        ]);
    });
});

function readReport(files: Map<string, string>): FrameProbeReport {
    return JSON.parse(files.get("/out/frame-probe.json") ?? "null") as FrameProbeReport;
}

interface Harness {
    deps: CliDependencies;
    files: Map<string, string>;
    logs: string[];
    errors: string[];
    measured: ScheduledRun[];
    closed: () => number;
    launched: () => number;
}

function harness(measure: (run: ScheduledRun) => SessionMeasurement): Harness {
    const files = new Map<string, string>();
    const logs: string[] = [];
    const errors: string[] = [];
    const measured: ScheduledRun[] = [];
    let closed = 0;
    let launched = 0;
    const measurer: Measurer = {
        browserVersion: "Chromium 147.0",
        measure: (run) => {
            measured.push(run);
            // A throw inside the executor rejects the promise, as a failing session does
            return new Promise((resolve) => {
                resolve(measure(run));
            });
        },
        close: () => {
            closed++;
            return Promise.resolve();
        },
    };
    return {
        files,
        logs,
        errors,
        measured,
        closed: () => closed,
        launched: () => launched,
        deps: {
            environment: { platform: "darwin", nodeVersion: "v24.18.0" },
            now: () => new Date("2026-11-21T18:30:00.000Z"),
            temporaryDirectory: () => "/tmp",
            makeDirectory: () => undefined,
            writeFile: (path, content) => {
                files.set(path, content);
            },
            log: (line) => {
                logs.push(line);
            },
            error: (line) => {
                errors.push(line);
            },
            createMeasurer: () => {
                launched++;
                return Promise.resolve(measurer);
            },
            runCompare: () => Promise.resolve(0),
            runPanel: () => Promise.resolve(0),
            runGate1: () => Promise.resolve(0),
        },
    };
}

describe("the gate end to end, against a browser that returns canned sessions", () => {
    const one = [
        "--fx=on",
        "--detail-budget=off",
        "--views=default",
        "--budget=work.p95=16.7@default",
        "--out-dir=/out",
    ];
    const sessionWith = (work95: number) => session({ default: { "work.p95": work95 } });

    it("exits 0 and writes the JSON report and the Markdown summary when every budget holds", async () => {
        const { deps, files, closed } = harness(() => sessionWith(8));

        const code = await main(["frames", ROOM, ...one], deps);

        expect(code).toBe(0);
        const report = readReport(files);
        expect(report).toMatchObject({ schemaVersion: 1, verdict: { status: "pass", exitCode: 0 }, plannedRuns: 3 });
        expect(files.get("/out/frame-probe.md")).toContain("## Verdict: PASS (exit code 0)");
        expect(closed()).toBe(1);
    });

    it("exits 1 when the median of the runs is over a budget given on the command line", async () => {
        const { deps, files } = harness(() => sessionWith(18));

        const code = await main(["frames", ROOM, ...one], deps);

        expect(code).toBe(1);
        expect(readReport(files).verdict).toMatchObject({
            status: "fail",
            exitCode: 1,
        });
        expect(files.get("/out/frame-probe.md")).toContain(
            "- FAIL: work.p95 in default, fx on, detail budget off: median 18 against at most 16.7",
        );
    });

    it("judges the median, so one slow run in three does not fail it and two do", async () => {
        const slowOnce = harness((run) => sessionWith(run.index === 2 ? 30 : 9));
        const slowTwice = harness((run) => sessionWith(run.index === 1 ? 8 : 30));

        expect(await main(["frames", ROOM, ...one], slowOnce.deps)).toBe(0);
        expect(await main(["frames", ROOM, ...one], slowTwice.deps)).toBe(1);
    });

    it("passes the budgets of each view to that view: 16.7 ms at the default zoom, 33.3 ms on the whole map", async () => {
        const { deps } = harness(() => session({ default: { "work.p95": 12 }, wholeMap: { "work.p95": 30 } }));
        const both = ["--fx=on", "--detail-budget=off", "--out-dir=/out", "--runs=1"];

        const within = await main(
            ["frames", ROOM, ...both, "--budget=work.p95=16.7@default", "--budget=work.p95=33.3@wholeMap"],
            deps,
        );
        const wholeMapOver = await main(
            ["frames", ROOM, ...both, "--budget=work.p95=16.7@default", "--budget=work.p95=25@wholeMap"],
            deps,
        );

        expect(within).toBe(0);
        expect(wholeMapOver).toBe(1);
    });

    it("exits 2 at the first failed session, keeps the runs so far in the report and closes the browser", async () => {
        const { deps, files, measured, closed } = harness((run) => {
            if (run.index === 2) {
                throw new Error("page.waitForFunction: Timeout 90000ms exceeded");
            }
            return sessionWith(8);
        });

        const code = await main(["frames", ROOM, ...one], deps);

        expect(code).toBe(2);
        expect(measured.map((run) => run.index)).toEqual([1, 2]);
        const report = readReport(files);
        expect(report.runs).toHaveLength(2);
        expect(report.verdict.invalidReasons).toContain("1 of 3 planned runs did not run");
        expect(files.get("/out/frame-probe.md")).toContain("failed, page.waitForFunction: Timeout 90000ms exceeded");
        expect(closed()).toBe(1);
    });

    it("gates the detail budget: its median on must be at least the asked share below off", async () => {
        const gain = (on: number) =>
            harness((run) => session({ wholeMap: { "work.p50": run.condition.detailBudget === "on" ? on : 20 } }));
        const args = [
            "--fx=on",
            "--views=wholeMap",
            "--runs=1",
            "--out-dir=/out",
            "--require-reduction=work.p50=50@wholeMap",
        ];

        expect(await main(["frames", ROOM, ...args], gain(8).deps)).toBe(0);
        expect(await main(["frames", ROOM, ...args], gain(14).deps)).toBe(1);
    });

    it("prints the plan and how long the bots must stay up, and starts no browser, on --dry-run", async () => {
        const { deps, logs, launched } = harness(() => sessionWith(8));

        const code = await main(["frames", ROOM, "--dry-run"], deps);

        expect(code).toBe(0);
        expect(launched()).toBe(0);
        expect(logs[0]).toContain("12 sessions (4 conditions, 3 rounds), about 20.4 minutes (1224 s), 102 s each");
        expect(logs).toContain("  run 5: round 2, fx on, detail budget on");
    });

    it("prints the exact --duration-seconds to start the bots with: the sessions, the delay before the probe, a margin", async () => {
        const full = harness(() => sessionWith(8));
        const shipping = harness(() => sessionWith(8));

        await main(["frames", ROOM, "--dry-run"], full.deps);
        await main(["frames", ROOM, "--dry-run", "--fx=on", "--detail-budget=off"], shipping.deps);

        expect(full.logs[1]).toContain("Start the bots with --duration-seconds=1329:");
        expect(shipping.logs[0]).toContain(
            "3 sessions (1 conditions, 3 rounds), about 5.1 minutes (306 s), 102 s each",
        );
        expect(shipping.logs[1]).toContain("Start the bots with --duration-seconds=411:");
    });

    // The 300-bot acceptance of decision C2 (docs): with the detail budget on, the whole-map frame cost is at least half
    // below off and no long task shows; the rows with it off are the baseline, and they do have long tasks
    const c2 = (run: ScheduledRun) => {
        const detail = run.condition.detailBudget === "on";
        return session({
            default: { "work.p95": detail ? 12 : 20, "nameTags.present": 90 },
            zoom: { "longTasks.count": detail ? 0 : 3 },
            wholeMap: {
                "work.p50": detail ? 6 : 20,
                "longTasks.count": detail ? 0 : 4,
                "nameTags.present": 301,
            },
        });
    };
    const c2Args = [
        "--runs=1",
        "--out-dir=/out",
        "--budget=work.p95=16.7@default:detail=on",
        "--budget=longTasks.count=0@zoom:detail=on",
        "--budget=longTasks.count=0@wholeMap:detail=on",
        "--require-reduction=work.p50=50@wholeMap",
        "--expect-at-least=nameTags.present=300@wholeMap",
    ];

    it("exits 0 on the full four-condition matrix when only the detail-budget-on rows meet the C2 criteria", async () => {
        const { deps, files } = harness(c2);

        const code = await main(["frames", ROOM, ...c2Args], deps);

        expect(code).toBe(0);
        expect(readReport(files).verdict).toMatchObject({ status: "pass", exitCode: 0 });
        expect(readReport(files).summaries).toHaveLength(12);
    });

    it("exits 1 for the same matrix when the long-task budget is not scoped: it binds the baseline rows too", async () => {
        const { deps } = harness(c2);
        const unscoped = c2Args.map((arg) => arg.replace(":detail=on", ""));

        expect(await main(["frames", ROOM, ...unscoped], deps)).toBe(1);
    });

    it("exits 1 when a detail-budget-on row has a long task, and 2 when its gain cannot be read", async () => {
        const onRowStalls = harness((run) =>
            run.condition.detailBudget === "on" && run.condition.fx === "off"
                ? session({
                      default: { "work.p95": 12, "nameTags.present": 90 },
                      zoom: { "longTasks.count": 0 },
                      wholeMap: { "work.p50": 6, "longTasks.count": 1, "nameTags.present": 301 },
                  })
                : c2(run),
        );
        const detailOnly = harness(c2);

        expect(await main(["frames", ROOM, ...c2Args], onRowStalls.deps)).toBe(1);
        expect(await main(["frames", ROOM, ...c2Args, "--detail-budget=on"], detailOnly.deps)).toBe(2);
    });

    it("exits 2, not 0, when the crowd is missing from one session: the run measured another load", async () => {
        const { deps, files } = harness((run) =>
            run.index === 3
                ? session({ default: { "work.p95": 8, "nameTags.present": 1 }, wholeMap: { "nameTags.present": 1 } })
                : c2(run),
        );
        const fewBots = c2Args.filter((arg) => !arg.startsWith("--require-reduction") && !arg.includes("@wholeMap:"));

        const code = await main(["frames", ROOM, ...fewBots], deps);

        expect(code).toBe(2);
        expect(readReport(files).verdict.invalidReasons[0]).toContain(
            "the load the run expected is not there: nameTags.present in wholeMap, fx off, detail budget off: lowest run 1 against at least 300",
        );
    });

    it("exits 2 with the usage for a command line it cannot read, and starts nothing", async () => {
        const { deps, errors, launched } = harness(() => sessionWith(8));

        const code = await main(["frames", ROOM, "--budget=work.p95"], deps);

        expect(code).toBe(2);
        expect(errors[0]).toContain("no limit given");
        expect(errors[0]).toContain("Usage: npx tsx frame-probe/run.ts");
        expect(launched()).toBe(0);
    });

    it("exits 2 when the browser cannot be started", async () => {
        const { deps, errors } = harness(() => sessionWith(8));
        const broken: CliDependencies = {
            ...deps,
            createMeasurer: () => Promise.reject(new Error("could not load @playwright/test")),
        };

        expect(await main(["frames", ROOM, ...one], broken)).toBe(2);
        expect(errors).toEqual(["could not load @playwright/test"]);
    });
});
