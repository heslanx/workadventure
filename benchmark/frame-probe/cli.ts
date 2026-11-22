import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    parseArgs,
    UsageError,
    USAGE,
    type CompareConfig,
    type FramesConfig,
    type Gate1Config,
    type PanelConfig,
    type ParseEnvironment,
} from "./args";
import type { Measurer } from "./browser";
import {
    botsDurationSeconds,
    BOTS_MARGIN_SECONDS,
    buildConditions,
    buildSchedule,
    estimateSeconds,
    PROBE_START_DELAY_SECONDS,
    runSchedule,
    sessionSeconds,
    type SessionTiming,
} from "./matrix";
import { buildReport, renderMarkdown, type ReportConfig } from "./report";

export interface CliDependencies {
    readonly environment: ParseEnvironment & { readonly nodeVersion: string };
    readonly now: () => Date;
    readonly temporaryDirectory: () => string;
    readonly makeDirectory: (path: string) => void;
    readonly writeFile: (path: string, content: string) => void;
    readonly log: (line: string) => void;
    readonly error: (line: string) => void;
    /** The browser side. Loaded on demand, so planning and the pure parts never need Playwright. */
    readonly createMeasurer: (config: FramesConfig, screenshotDir: string | undefined) => Promise<Measurer>;
    readonly runCompare: (config: CompareConfig, outDir: string, log: (line: string) => void) => Promise<number>;
    readonly runPanel: (config: PanelConfig, outDir: string, log: (line: string) => void) => Promise<number>;
    readonly runGate1: (config: Gate1Config, outDir: string, log: (line: string) => void) => Promise<number>;
}

export function defaultDependencies(): CliDependencies {
    return {
        environment: { platform: process.platform, nodeVersion: process.version },
        now: () => new Date(),
        temporaryDirectory: tmpdir,
        makeDirectory: (path) => mkdirSync(path, { recursive: true }),
        writeFile: (path, content) => writeFileSync(path, content),
        log: (line) => console.log(line),
        error: (line) => console.error(line),
        createMeasurer: async (config, screenshotDir) => {
            const { createBrowserMeasurer } = await import("./browser");
            return createBrowserMeasurer(config, { screenshotDir, log: (line) => console.log(line) });
        },
        runCompare: async (config, outDir, log) => (await import("./compare")).runCompare(config, outDir, log),
        runPanel: async (config, outDir, log) => (await import("./panel")).runPanel(config, outDir, log),
        runGate1: async (config, outDir, log) => (await import("./gate1Browser")).runGate1(config, outDir, log),
    };
}

function timingOf(config: FramesConfig): SessionTiming {
    return {
        settleSeconds: config.settleSeconds,
        recordSeconds: config.recordSeconds,
        zoomWindowSeconds: config.zoomWindowSeconds,
        zoomSettleSeconds: config.zoomSettleSeconds,
        wsSampleSeconds: config.wsSampleSeconds,
        wholeMap: config.views.includes("wholeMap"),
    };
}

function reportConfigOf(config: FramesConfig): ReportConfig {
    return {
        url: config.url,
        runs: config.runs,
        fx: config.fx,
        detailBudget: config.detailBudget,
        views: config.views,
        settleSeconds: config.settleSeconds,
        recordSeconds: config.recordSeconds,
        wheel: { delta: config.wheelDelta, events: config.wheelEvents },
        zoomWindowSeconds: config.zoomWindowSeconds,
        zoomSettleSeconds: config.zoomSettleSeconds,
        wsSampleSeconds: config.wsSampleSeconds,
        viewport: config.viewport,
        rendererRequested: config.browser.renderer,
        allowSoftwareRenderer: config.allowSoftwareRenderer,
        budgets: config.budgets.map((budget) => budget.raw),
        reductions: config.reductions.map((reduction) => reduction.raw),
        expectations: config.expectations.map((expectation) => expectation.raw),
    };
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, "-");
}

function minutes(seconds: number): string {
    return `${(seconds / 60).toFixed(1)} minutes (${Math.round(seconds)} s)`;
}

async function runFrames(config: FramesConfig, deps: CliDependencies): Promise<number> {
    const conditions = buildConditions(config.fx, config.detailBudget);
    const schedule = buildSchedule(conditions, config.runs);
    const timing = timingOf(config);
    deps.log(
        `${schedule.length} sessions (${conditions.length} conditions, ${config.runs} rounds), about ` +
            `${minutes(estimateSeconds(timing, schedule.length))}, ${Math.round(sessionSeconds(timing))} s each.`,
    );
    deps.log(
        `Start the bots with --duration-seconds=${botsDurationSeconds(timing, schedule.length)}: the sessions, ` +
            `${PROBE_START_DELAY_SECONDS} s before this probe starts (their ramp and the switch of terminals) and a margin ` +
            `of ${BOTS_MARGIN_SECONDS} s. A crowd that leaves before the last session ends lowers every number.`,
    );
    if (config.dryRun) {
        for (const run of schedule) {
            deps.log(
                `  run ${run.index}: round ${run.repeat}, fx ${run.condition.fx}, detail budget ${run.condition.detailBudget}`,
            );
        }
        return 0;
    }

    const startedAt = deps.now();
    const outDir = config.outDir ?? join(deps.temporaryDirectory(), `frame-probe-${stamp(startedAt)}`);
    const screenshotDir = config.screenshots ? join(outDir, "shots") : undefined;
    deps.makeDirectory(outDir);
    if (screenshotDir !== undefined) {
        deps.makeDirectory(screenshotDir);
    }

    const measurer = await deps.createMeasurer(config, screenshotDir);
    let runs;
    try {
        runs = await runSchedule(
            schedule,
            (run) => measurer.measure(run),
            (record) =>
                deps.log(
                    `run ${record.index}/${schedule.length} (round ${record.repeat}, fx ${record.condition.fx}, detail budget ` +
                        `${record.condition.detailBudget}): ${record.status === "ok" ? "ok" : `failed, ${record.error}`}`,
                ),
        );
    } finally {
        await measurer.close();
    }

    const report = buildReport({
        startedAt: startedAt.toISOString(),
        finishedAt: deps.now().toISOString(),
        environment: {
            browserVersion: measurer.browserVersion,
            platform: deps.environment.platform,
            nodeVersion: deps.environment.nodeVersion,
        },
        config: reportConfigOf(config),
        plannedRuns: schedule.length,
        runs,
        budgets: config.budgets,
        reductions: config.reductions,
        expectations: config.expectations,
    });
    const markdown = renderMarkdown(report);
    deps.writeFile(join(outDir, "frame-probe.json"), `${JSON.stringify(report, null, 2)}\n`);
    deps.writeFile(join(outDir, "frame-probe.md"), markdown);
    deps.log(markdown);
    deps.log(`report: ${join(outDir, "frame-probe.json")}\nsummary: ${join(outDir, "frame-probe.md")}`);
    return report.verdict.exitCode;
}

/** Runs the command line. Returns the exit code; throws only for a bug, never for a bad argument or a failed run. */
export async function main(argv: readonly string[], deps: CliDependencies = defaultDependencies()): Promise<number> {
    if (argv[0] === "--help" || argv[0] === "-h") {
        deps.log(USAGE);
        return 0;
    }
    let config;
    try {
        config = parseArgs(argv, deps.environment);
    } catch (error: unknown) {
        if (error instanceof UsageError) {
            deps.error(`${error.message}\n\n${USAGE}`);
            return 2;
        }
        throw error;
    }

    try {
        if (config.command === "frames") {
            return await runFrames(config, deps);
        }
        const outDir =
            config.outDir ?? join(deps.temporaryDirectory(), `frame-probe-${config.command}-${stamp(deps.now())}`);
        deps.makeDirectory(outDir);
        if (config.command === "compare") {
            return await deps.runCompare(config, outDir, deps.log);
        }
        return config.command === "gate1"
            ? await deps.runGate1(config, outDir, deps.log)
            : await deps.runPanel(config, outDir, deps.log);
    } catch (error: unknown) {
        deps.error(error instanceof Error ? error.message : String(error));
        return 2;
    }
}
