import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startFakePusher } from "./support/fakePusher";
import { summary } from "./support/summaryFixture";

const SCRIPT = fileURLToPath(new URL("../scripts/load-staircase.sh", import.meta.url));
const MERGE_SCRIPT = fileURLToPath(new URL("../scripts/merge-summaries.ts", import.meta.url));
const BENCHMARK_DIR = fileURLToPath(new URL("..", import.meta.url));
const PUSHER_FLAGS = ["--pusher-url=http://127.0.0.1:3010", "--room-urls=http://127.0.0.1:3010/r"];

interface ScriptResult {
    code: number;
    stdout: string;
    stderr: string;
}

function runScript(args: string[], timeoutMs = 30_000): Promise<ScriptResult> {
    return new Promise((resolve) => {
        execFile("bash", [SCRIPT, ...args], { timeout: timeoutMs }, (error, stdout, stderr) => {
            const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
            resolve({ code, stdout, stderr });
        });
    });
}

function runMerge(args: string[]): Promise<ScriptResult> {
    return new Promise((resolve) => {
        execFile(
            "npx",
            ["--no-install", "tsx", MERGE_SCRIPT, ...args],
            { cwd: BENCHMARK_DIR, timeout: 60_000 },
            (error, stdout, stderr) => {
                const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
                resolve({ code, stdout, stderr });
            },
        );
    });
}

describe("load-staircase.sh plan", () => {
    it("shares the bots of a level over the processes and gives each its own index range", async () => {
        // 10 bots over 4 processes: the first two take one extra, and each range starts where the last one ended.
        const { code, stdout } = await runScript([
            "--dry-run",
            "--levels=10",
            "--processes=4",
            "--duration-seconds=100",
            "--ramp-seconds=20",
            "--steady-window=30",
            "--",
            ...PUSHER_FLAGS,
        ]);

        expect(code).toBe(0);
        expect(stdout).toContain("rep1 n10 process 0: sessions=3 index-offset=0 start=+0s duration=100s");
        expect(stdout).toContain("rep1 n10 process 1: sessions=3 index-offset=3 start=+4s duration=96s");
        expect(stdout).toContain("rep1 n10 process 2: sessions=2 index-offset=6 start=+8s duration=92s");
        expect(stdout).toContain("rep1 n10 process 3: sessions=2 index-offset=8 start=+12s duration=88s");
    });

    it("tells the merge how many processes it started and how many bots the level has", async () => {
        // Without the expectation a generator that dies before writing its summary leaves a smaller, valid run.
        const { stdout } = await runScript(["--dry-run", "--levels=10,2", "--processes=4", "--", ...PUSHER_FLAGS]);

        const merges = stdout.split("\n").filter((line) => line.includes("merge-summaries.ts run"));
        expect(merges).toHaveLength(2);
        expect(merges[0]).toContain("--expect-processes=4 --expect-sessions=10");
        // Two bots only start two processes, and the merge must expect two.
        expect(merges[1]).toContain("--expect-processes=2 --expect-sessions=2");
    });

    it("never starts more processes than there are bots", async () => {
        const { stdout } = await runScript(["--dry-run", "--levels=2", "--processes=4", "--", ...PUSHER_FLAGS]);

        expect(stdout.match(/process \d+:/g)).toHaveLength(2);
    });

    it("runs the levels in order and repeats the whole staircase, so repeats interleave", async () => {
        const { stdout } = await runScript([
            "--dry-run",
            "--levels=300,500",
            "--repeat=2",
            "--processes=1",
            "--",
            ...PUSHER_FLAGS,
        ]);

        const runs = stdout.match(/^== run .*$/gm);
        expect(runs).toEqual([
            "== run 1 of 4: repeat 1, 300 bots over up to 1 processes ==",
            "== run 2 of 4: repeat 1, 500 bots over up to 1 processes ==",
            "== run 3 of 4: repeat 2, 300 bots over up to 1 processes ==",
            "== run 4 of 4: repeat 2, 500 bots over up to 1 processes ==",
        ]);
    });

    it("hands the generator flags to every process and the metrics URLs to the first one only", async () => {
        const { stdout } = await runScript([
            "--dry-run",
            "--levels=4",
            "--processes=2",
            "--metrics-urls=http://127.0.0.1:9100/metrics",
            "--",
            ...PUSHER_FLAGS,
            "--viewport=browser",
            "--world-space=0.3",
        ]);

        const commands = stdout.split("\n").filter((line) => line.includes("npm start"));
        expect(commands).toHaveLength(2);
        for (const command of commands) {
            expect(command).toContain("--viewport=browser --world-space=0.3");
            expect(command).toContain("--steady-window=120");
        }
        expect(commands[0]).toContain("--metrics-urls=http://127.0.0.1:9100/metrics");
        expect(commands[1]).not.toContain("--metrics-urls");
    });

    it("keeps the minimum of accepted sessions the user asked for, and defaults it to the process's own count", async () => {
        const defaulted = await runScript(["--dry-run", "--levels=4", "--processes=2", "--", ...PUSHER_FLAGS]);
        const chosen = await runScript([
            "--dry-run",
            "--levels=4",
            "--processes=2",
            "--",
            ...PUSHER_FLAGS,
            "--min-accepted=1",
        ]);

        expect(defaulted.stdout).toContain("--min-accepted=2");
        expect(chosen.stdout).not.toContain("--min-accepted=2");
        expect(chosen.stdout).toContain("--min-accepted=1");
    });

    it.each([
        ["--sessions=5", "'--sessions' is set by this script"],
        ["--index-offset=5", "'--index-offset' is set by this script"],
        ["--steady-window=5", "'--steady-window' is set by this script"],
        ["--output=x.json", "'--output' is set by this script"],
    ])("refuses %s among the generator flags", async (flag, message) => {
        const { code, stderr } = await runScript(["--dry-run", "--levels=4", "--", ...PUSHER_FLAGS, flag]);

        expect(code).toBe(1);
        expect(stderr).toContain(message);
    });

    it("refuses a steady window that would start before the last process finished ramping", async () => {
        // 60 s ramp + 12 s of stagger + 120 s window need 192 s; 180 s does not hold them.
        const { code, stderr } = await runScript(["--dry-run", "--duration-seconds=180", "--", ...PUSHER_FLAGS]);

        expect(code).toBe(1);
        expect(stderr).toContain("the steady window (120s) does not fit");
    });

    it("refuses anything that is not a whole number of seconds", async () => {
        const { code, stderr } = await runScript(["--dry-run", "--stagger-seconds=2.5", "--", ...PUSHER_FLAGS]);

        expect(code).toBe(1);
        expect(stderr).toContain("--stagger-seconds must be a whole number");
    });
});

describe("load-staircase.sh run", () => {
    let pusher: Awaited<ReturnType<typeof startFakePusher>> | undefined;
    let outDir: string | undefined;

    afterEach(async () => {
        await pusher?.close();
        pusher = undefined;
        if (outDir !== undefined) {
            rmSync(outDir, { recursive: true, force: true });
            outDir = undefined;
        }
    });

    it("runs staggered generator processes on their own bots and merges one JSON per process", async () => {
        // Two real generator processes against the fake pusher: process 0 takes bots 0 and 1, process 1 takes bot 2.
        // Without --index-offset both would create bot-0 and bot-1.
        pusher = await startFakePusher("accept");
        outDir = mkdtempSync(join(tmpdir(), "load-staircase-"));

        const { code, stdout } = await runScript(
            [
                "--levels=3",
                "--processes=2",
                "--stagger-seconds=1",
                "--ramp-seconds=1",
                "--duration-seconds=8",
                "--steady-window=3",
                `--out-dir=${outDir}`,
                "--",
                `--pusher-url=${pusher.url}`,
                "--room-urls=http://play.test/_/global/maps.test/a.json",
                "--move-hz=5",
            ],
            90_000,
        );

        // 0 when the run is valid, 2 when it is judged invalid (a loaded test machine can make a generator lag).
        expect([0, 2]).toContain(code);
        expect([...pusher.observed.names].sort()).toEqual(["bot-0", "bot-1", "bot-2"]);
        const runDir = join(outDir, "rep1-n3");
        expect(readdirSync(runDir).filter((name) => /^gen-\d\.json$/.test(name))).toEqual(["gen-0.json", "gen-1.json"]);
        const merged = JSON.parse(readFileSync(join(runDir, "merged.json"), "utf8")) as {
            processes: number;
            sessions: { accepted: number; requested: number };
            perProcess: { pathRange: number[] }[];
        };
        expect(merged.processes).toBe(2);
        expect(merged.sessions).toMatchObject({ requested: 3, accepted: 3 });
        expect(merged.perProcess.map((process) => process.pathRange)).toEqual([
            [0, 1],
            [2, 2],
        ]);
        expect(existsSync(join(outDir, "staircase.json"))).toBe(true);
        expect(stdout).toContain("== staircase ==");
    }, 120_000);

    it("hands the merge an expectation that a healthy run meets, with every process's window in full", async () => {
        // Guards against false alarms: the staggered processes stop together, so each still measures the whole window.
        pusher = await startFakePusher("accept");
        outDir = mkdtempSync(join(tmpdir(), "load-staircase-"));

        await runScript(
            [
                "--levels=3",
                "--processes=2",
                "--stagger-seconds=1",
                "--ramp-seconds=1",
                "--duration-seconds=8",
                "--steady-window=3",
                `--out-dir=${outDir}`,
                "--",
                `--pusher-url=${pusher.url}`,
                "--room-urls=http://play.test/_/global/maps.test/a.json",
                "--move-hz=5",
            ],
            90_000,
        );

        const merged = JSON.parse(readFileSync(join(outDir, "rep1-n3", "merged.json"), "utf8")) as {
            invalidReasons: string[];
        };
        // A loaded machine may still call a generator lag-bound; the expectation and the window must hold.
        expect(
            merged.invalidReasons.filter((reason) =>
                /generator summaries found|asked for|measured .* s of/.test(reason),
            ),
        ).toEqual([]);
    }, 120_000);
});

describe("merge-summaries.ts run", () => {
    let dir: string | undefined;

    afterEach(() => {
        if (dir !== undefined) {
            rmSync(dir, { recursive: true, force: true });
            dir = undefined;
        }
    });

    /** The directory of a level-1000 run in which only process 0 of 4 left a summary. */
    function levelWithOneSummaryOfFour(): string {
        dir = mkdtempSync(join(tmpdir(), "merge-summaries-"));
        writeFileSync(join(dir, "gen-0.json"), JSON.stringify(summary()));
        return dir;
    }

    it("exits 2 and says why when the launcher's expected processes and bots are not all there", async () => {
        const { code, stdout } = await runMerge([
            "run",
            levelWithOneSummaryOfFour(),
            "--expect-processes=4",
            "--expect-sessions=1000",
        ]);

        expect(code).toBe(2);
        const merged = JSON.parse(stdout) as { valid: boolean; invalidReasons: string[] };
        expect(merged.valid).toBe(false);
        expect(merged.invalidReasons).toEqual([
            expect.stringContaining("1 generator summaries found, 4 expected"),
            "the processes asked for 250 bots in all, the level has 1000",
        ]);
    }, 90_000);

    it("accepts the same directory when no expectation is given, which is why the launcher always gives one", async () => {
        const { code } = await runMerge(["run", levelWithOneSummaryOfFour(), "--headline"]);

        expect(code).toBe(0);
    }, 90_000);

    it("refuses an expectation that is not a whole number", async () => {
        const { code, stderr } = await runMerge(["run", levelWithOneSummaryOfFour(), "--expect-processes=four"]);

        expect(code).toBe(1);
        expect(stderr).toContain("--expect-processes must be a whole number of at least 1, got 'four'");
    }, 90_000);
});
