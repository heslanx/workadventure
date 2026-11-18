import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    DEFAULT_THRESHOLDS,
    type MergeableSummary,
    type RunExpectation,
    type StaircaseRun,
    type MergedSummary,
    assertMergeableSummary,
    assertMergedSummary,
    headline,
    mergeSummaries,
    staircaseLines,
    summarizeStaircase,
} from "../src/merge";

const USAGE = `Usage:
  tsx scripts/merge-summaries.ts run <dir> [--out=<file>] [--headline] [--expect-processes=<P>] [--expect-sessions=<N>]
      Merges <dir>/gen-*.json (one summary per generator process) into one JSON document.
      --headline prints a one-line verdict instead of the JSON.
      --expect-processes and --expect-sessions say how many processes were started and how many bots the level has:
      a different number of summaries, or a different total of requested bots, makes the run invalid. Without them a
      process that never wrote its summary cannot be seen. load-staircase.sh always passes both.
      Exit code 0 when the run is valid, 2 when not, 1 on a usage or read error.
  tsx scripts/merge-summaries.ts staircase <dir> [--out=<file>] [--min-delivery=0.99] [--max-server-cpu=100] [--max-move-p95=<ms>] [--headline]
      Reads <dir>/rep<r>-n<level>/merged.json for every level and repeat, and reports the knee of each repeat.
`;

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, "utf8"));
}

function numericSuffix(name: string): number {
    return Number(/(\d+)\.json$/.exec(name)?.[1] ?? 0);
}

function wholeNumberFlag(args: readonly string[], name: string): number | undefined {
    const value = flag(args, name);
    if (value === undefined) {
        return undefined;
    }
    if (!/^[1-9]\d*$/.test(value)) {
        throw new Error(`--${name} must be a whole number of at least 1, got '${value}'`);
    }
    return Number(value);
}

function mergeRun(dir: string, expected: RunExpectation): MergedSummary {
    const files = readdirSync(dir)
        .filter((name) => /^gen-\d+\.json$/.test(name))
        .sort((a, b) => numericSuffix(a) - numericSuffix(b));
    const summaries: MergeableSummary[] = [];
    for (const file of files) {
        const summary = readJson(join(dir, file));
        assertMergeableSummary(summary, join(dir, file));
        summaries.push(summary);
    }
    return mergeSummaries(summaries, undefined, expected);
}

function readStaircase(dir: string): StaircaseRun[] {
    const runs: StaircaseRun[] = [];
    for (const name of readdirSync(dir)) {
        const match = /^rep(\d+)-n(\d+)$/.exec(name);
        const mergedPath = join(dir, name, "merged.json");
        if (match !== null && existsSync(mergedPath)) {
            const merged = readJson(mergedPath);
            assertMergedSummary(merged, mergedPath);
            runs.push({ repeat: Number(match[1]), level: Number(match[2]), merged });
        }
    }
    return runs;
}

function flag(args: readonly string[], name: string): string | undefined {
    const prefix = `--${name}=`;
    return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function main(argv: readonly string[]): number {
    const [command, dir, ...rest] = argv;
    if ((command !== "run" && command !== "staircase") || dir === undefined) {
        console.error(USAGE);
        return 1;
    }
    const out = flag(rest, "out");
    const onlyHeadline = rest.includes("--headline");
    let result: object;
    let text: string;
    let exitCode = 0;
    if (command === "run") {
        const merged = mergeRun(dir, {
            processes: wholeNumberFlag(rest, "expect-processes"),
            sessions: wholeNumberFlag(rest, "expect-sessions"),
        });
        result = merged;
        text = headline(merged);
        exitCode = merged.valid ? 0 : 2;
    } else {
        const maxP95 = flag(rest, "max-move-p95");
        const staircase = summarizeStaircase(readStaircase(dir), {
            minDelivery: Number(flag(rest, "min-delivery") ?? DEFAULT_THRESHOLDS.minDelivery),
            maxServerCpuPercent: Number(flag(rest, "max-server-cpu") ?? DEFAULT_THRESHOLDS.maxServerCpuPercent),
            maxMoveP95Ms: maxP95 === undefined ? DEFAULT_THRESHOLDS.maxMoveP95Ms : Number(maxP95),
        });
        result = staircase;
        text = staircaseLines(staircase).join("\n");
    }
    const json = JSON.stringify(result, null, 2);
    if (out !== undefined) {
        writeFileSync(out, `${json}\n`);
    }
    console.log(onlyHeadline ? text : json);
    return exitCode;
}

try {
    process.exitCode = main(process.argv.slice(2));
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
