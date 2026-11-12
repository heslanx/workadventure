// Builds ledger.tsv (one row per run) and table.tsv (median and min..max per variant, N, rooms) from a copy of bench-out.
// usage: node summarize.mjs <bench-out dir> <output dir>
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [outDir, dest] = process.argv.slice(2);

function kv(text) {
    return Object.fromEntries(
        text
            .split(/\s+/)
            .filter((token) => token.includes("="))
            .map((token) => [token.slice(0, token.indexOf("=")), token.slice(token.indexOf("=") + 1)]),
    );
}

function readRun(run) {
    const dir = join(outDir, run);
    const host = existsSync(join(dir, "host.txt")) ? kv(readFileSync(join(dir, "host.txt"), "utf8")) : {};
    const summary = existsSync(join(dir, "summary.json")) ? JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) : undefined;
    const cg = {};
    if (existsSync(join(dir, "cgroup.tsv"))) {
        for (const line of readFileSync(join(dir, "cgroup.tsv"), "utf8").trim().split("\n")) {
            const [tag, container, at, usage, throttled, tx, rx] = line.split("\t");
            (cg[container] ??= {})[tag] = { at: Number(at), usage: Number(usage), throttled: Number(throttled), tx: Number(tx), rx: Number(rx) };
        }
    }
    const metrics = {};
    if (existsSync(join(dir, "metrics.tsv"))) {
        for (const line of readFileSync(join(dir, "metrics.tsv"), "utf8").trim().split("\n")) {
            const [tag, service, rest] = line.split("\t");
            if (!rest) continue;
            const [name, value] = rest.split(" ");
            (metrics[service] ??= {})[`${tag}:${name}`] = Number(value);
        }
    }
    const match = /^(.+)-n(\d+)-r(\d+)-(\d+)(-prof)?$/.exec(run);
    if (!match) return undefined;
    const [, variant, n, rooms, rep, prof] = match;
    const sessions = Number(n);
    const window = (c) => {
        const s = cg[c]?.steadyStart;
        const e = cg[c]?.steadyEnd;
        if (!s || !e) return undefined;
        return { seconds: e.at - s.at, cpuSeconds: (e.usage - s.usage) / 1e6, throttled: e.throttled - s.throttled, tx: e.tx - s.tx, rx: e.rx - s.rx };
    };
    const play = window("play");
    const back = window("back");
    const gen = window("gen");
    const perSessionMinute = (w) => (w ? (w.cpuSeconds / (sessions * (w.seconds / 60))).toFixed(4) : "");
    const s = summary;
    const sessionSeconds = s ? sessions * (s.wallSeconds - s.config.rampSeconds / 2) : undefined;
    const lag = (svc) => {
        const v = metrics[svc]?.["steadyEnd:nodejs_eventloop_lag_p99_seconds"];
        return v === undefined ? "" : (v * 1000).toFixed(1);
    };
    const errors = s ? Object.keys(s.errors).length + Object.keys(s.rejections).length : "";
    const restarted = ["play.log", "back.log"].some(
        (log) => existsSync(join(dir, log)) && readFileSync(join(dir, log), "utf8").includes("Restarting..."),
    );
    const correct =
        s &&
        !restarted &&
        s.reconciled === true &&
        s.sessions.accepted === sessions &&
        Object.keys(s.errors).length === 0 &&
        s.sessions.unexpectedCloses === 0;
    return {
        run,
        startedAt: host.startedAt ?? "",
        variant,
        sessions,
        rooms: Number(rooms),
        rep: Number(rep),
        mode: prof ? "profile" : "measure",
        loadavg1: host.loadavg1 ?? "",
        nonTaskRunning: host.nonTaskRunning ?? "",
        correct: s ? String(correct) : "no-summary",
        accepted: s?.sessions.accepted ?? "",
        reconciled: s?.reconciled ?? "",
        errorKinds: errors,
        unexpectedCloses: s?.sessions.unexpectedCloses ?? "",
        serverRestarted: restarted,
        pusherCpuSPerSessionMin: perSessionMinute(play),
        backCpuSPerSessionMin: perSessionMinute(back),
        pusherCoresUsed: play ? (play.cpuSeconds / play.seconds).toFixed(3) : "",
        backCoresUsed: back ? (back.cpuSeconds / back.seconds).toFixed(3) : "",
        pusherThrottledPeriods: play?.throttled ?? "",
        backThrottledPeriods: back?.throttled ?? "",
        joinP50Ms: s?.joinLatencyMs.p50 ?? "",
        joinP95Ms: s?.joinLatencyMs.p95 ?? "",
        joinMaxMs: s?.joinLatencyMs.max ?? "",
        recvBytesPerSessionS: s ? (s.received.bytes / sessionSeconds).toFixed(0) : "",
        pusherTxBytesPerSessionSWindow: play ? (play.tx / (sessions * play.seconds)).toFixed(0) : "",
        userMovedRecvPerSessionS: s ? ((s.received.eventsByType.userMovedMessage ?? 0) / sessionSeconds).toFixed(1) : "",
        movesSent: s?.sent.userMovesMessage ?? "",
        pusherLagP99Ms: lag("play"),
        backLagP99Ms: lag("back"),
        genCoresUsedWindow: gen ? (gen.cpuSeconds / gen.seconds).toFixed(3) : "",
        genCpuPctOfOneCoreRun: s?.generator.cpuPercentOfOneCore ?? "",
        genLagP99Ms: s?.generator.eventLoopLagMs.p99 ?? "",
        wallSeconds: s?.wallSeconds ?? "",
        stopReason: s?.stopReason ?? "",
    };
}

const rows = readdirSync(outDir)
    .filter((name) => existsSync(join(outDir, name, "host.txt")))
    .map(readRun)
    .filter(Boolean)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
const columns = Object.keys(rows[0]);
writeFileSync(join(dest, "ledger.tsv"), [columns.join("\t"), ...rows.map((r) => columns.map((c) => r[c]).join("\t"))].join("\n") + "\n");

const metricsForTable = [
    "pusherCpuSPerSessionMin",
    "backCpuSPerSessionMin",
    "pusherCoresUsed",
    "backCoresUsed",
    "joinP95Ms",
    "recvBytesPerSessionS",
    "pusherTxBytesPerSessionSWindow",
    "userMovedRecvPerSessionS",
    "pusherLagP99Ms",
    "backLagP99Ms",
    "genCoresUsedWindow",
    "genLagP99Ms",
];
const groups = new Map();
for (const row of rows.filter((r) => r.mode === "measure")) {
    const key = `${row.variant}\t${row.sessions}\t${row.rooms}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
}
const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));
const tableRows = [["variant", "sessions", "rooms", "runs", "allCorrect", ...metricsForTable].join("\t")];
for (const [key, group] of groups) {
    const cells = metricsForTable.map((m) => {
        const values = group
            .map((r) => r[m])
            .filter((v) => v !== "" && v !== undefined)
            .map(Number)
            .filter((v) => Number.isFinite(v));
        if (values.length === 0) return "";
        return `${fmt(median(values))} [${fmt(Math.min(...values))}..${fmt(Math.max(...values))}]`;
    });
    tableRows.push([key, group.length, group.every((r) => r.correct === "true"), ...cells].join("\t"));
}
writeFileSync(join(dest, "table.tsv"), tableRows.join("\n") + "\n");
console.log(tableRows.join("\n"));

const variants = {
    base: ["master `ddbe245a8`", "baseline"],
    v1: ["`a589e9fdf` zone-reconciliation shortcut", "lower pusher CPU per moving session"],
    v2: ["V1 + quota-aware back CPU tracker (`cpu-quota-aware.v2.patch`), back 0.65 CPU", "overheat triggers movement shedding at N=500"],
    v3: ["V1 + `v3-coalesce-group-updates.patch`", "fewer group updates to encode per batch lowers pusher CPU and lag"],
};
const md = [
    "| Variant | Hypothesis | Command | N x rooms | Runs | Pusher CPU-s / session-min | Back CPU-s / session-min | Pusher cores (cap 0.65) | Join p95 ms | Received B / session-s | Pusher lag p99 ms | Back lag p99 ms | Generator cores (cap 1.2) | Correct? |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
];
const cell = (group, m) => {
    const values = group.map((r) => r[m]).filter((v) => v !== "" && v !== undefined).map(Number).filter(Number.isFinite);
    return values.length === 0 ? "" : `${fmt(median(values))} [${fmt(Math.min(...values))}..${fmt(Math.max(...values))}]`;
};
for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const [variant, sessions, rooms] = key.split("\t");
    const [what, hypothesis] = variants[variant] ?? [variant, ""];
    const correct = `${group.filter((r) => r.correct === "true").length}/${group.length}`;
    md.push(
        `| ${variant}: ${what} | ${hypothesis} | \`run-one.sh ${variant} ${sessions} ${rooms} <rep>\` | ${sessions} x ${rooms} | ${group.length} | ${cell(group, "pusherCpuSPerSessionMin")} | ${cell(group, "backCpuSPerSessionMin")} | ${cell(group, "pusherCoresUsed")} | ${cell(group, "joinP95Ms")} | ${cell(group, "recvBytesPerSessionS")} | ${cell(group, "pusherLagP99Ms")} | ${cell(group, "backLagP99Ms")} | ${cell(group, "genCoresUsedWindow")} | ${correct} |`,
    );
}
writeFileSync(join(dest, "variant-table.md"), md.join("\n") + "\n");
