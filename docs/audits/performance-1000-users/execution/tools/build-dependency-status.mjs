#!/usr/bin/env node
// Builds the row-level dependency status ledger from the frozen target inventory.
// Usage: node build-dependency-status.mjs [--check] [--inventory <csv>] [--overrides <json>] [--out <dir>]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const audit = resolve(here, "../..");
const { values: args } = parseArgs({
    options: {
        check: { type: "boolean", default: false },
        inventory: { type: "string", default: join(audit, "inventory/dependency-upgrade-targets.csv") },
        overrides: { type: "string", default: join(here, "status-overrides.json") },
        out: { type: "string", default: resolve(here, "..") },
    },
});

const STATUSES = [
    "updated",
    "already_current",
    "blocked_with_reason",
    "replaced_with_contract_proof",
    "internal_rebuilt",
    "in_progress",
    "pending",
];
const OPEN = new Set(["in_progress", "pending"]);
const IDENTITY = ["manifest", "kind", "name"];
// Only these dispositions name latest_observed as the row's candidate. The others (deprecated, coupled
// migration, Node 24 types, native TypeScript) leave the candidate open, so equal versions close nothing.
const CANDIDATE_IS_LATEST = /^(candidate_requires_|observed_latest_)/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const errors = [];
function finishIfErrors() {
    if (errors.length === 0) return;
    for (const message of errors) console.error(`ERROR: ${message}`);
    process.exit(1);
}

function parseCsv(text) {
    const rows = [[""]];
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const row = rows.at(-1);
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') row[row.length - 1] += text[i++];
            else if (char === '"') quoted = false;
            else row[row.length - 1] += char;
        } else if (char === '"') quoted = true;
        else if (char === ",") row.push("");
        else if (char === "\n") rows.push([""]);
        else if (char !== "\r") row[row.length - 1] += char;
    }
    return rows.filter((row) => row.length > 1 || row[0] !== "");
}
const csvCell = (value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const toCsv = (rows) => rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
const rowKey = (row) => IDENTITY.map((column) => row[column]).join("#");

// Inputs.
const [header, ...records] = parseCsv(readFileSync(args.inventory, "utf8"));
const rows = records.map((cells) => Object.fromEntries(header.map((column, i) => [column, cells[i] ?? ""])));
const totals = JSON.parse(readFileSync(join(audit, "inventory/inventory.json"), "utf8"));
const snapshot = JSON.parse(readFileSync(join(audit, "evidence/dependency-registry-snapshot.json"), "utf8"));
const snapshotUtc = new Date(snapshot.checked_at_utc).toISOString().replace(/\.\d+Z$/, "Z");
const overrides = JSON.parse(readFileSync(args.overrides, "utf8")).overrides ?? [];

// Denominator: the ledger must cover exactly the inventory's direct declarations.
const names = new Set(rows.map((row) => row.name));
if (rows.length !== totals.direct_declarations)
    errors.push(`inventory has ${rows.length} rows, inventory.json declares ${totals.direct_declarations}`);
if (names.size !== totals.unique_direct_names)
    errors.push(`inventory has ${names.size} distinct names, inventory.json declares ${totals.unique_direct_names}`);
if (new Set(rows.map(rowKey)).size !== rows.length) errors.push("row key manifest#kind#name is not unique");
if (records.some((cells) => cells.length !== header.length)) errors.push("inventory has rows with a wrong cell count");

overrides.forEach((entry, i) => {
    const label = `override #${i + 1} (${entry.key ?? entry.name ?? "no selector"})`;
    if (Boolean(entry.key) === Boolean(entry.name)) errors.push(`${label}: set exactly one of key or name`);
    if (entry.key && entry.manifest) errors.push(`${label}: manifest is only valid with name`);
    if (!STATUSES.includes(entry.status)) errors.push(`${label}: status "${entry.status}" is not allowed`);
    if (typeof entry.evidence !== "string" || entry.evidence.trim() === "") errors.push(`${label}: evidence is required`);
    if (!UTC.test(entry.updated_utc ?? "")) errors.push(`${label}: updated_utc must look like 2026-11-12T00:10:00Z`);
});
finishIfErrors();

const precedence = (entry) => (entry.key ? 3 : entry.manifest ? 2 : 1);
const selects = (entry, row) =>
    entry.key ? entry.key === rowKey(row) : entry.name === row.name && (!entry.manifest || entry.manifest === row.manifest);
const matched = new Set();

function automaticStatus(row) {
    const lockedText = row.locked_versions_across_graphs;
    const locked = lockedText.split("|").map((version) => version.trim()).filter(Boolean);
    const latest = row.latest_observed;
    const compared = `requested_version ${row.requested_version}, locked_versions_across_graphs (${lockedText}), latest_observed (${latest})`;
    // Proof is every locked version, never requested_version: benchmark declares ts-node-dev ^2.0.0
    // (the candidate) while its own lockfile still resolves 1.0.0.
    if (latest && locked.length > 0 && locked.every((version) => version === latest)) {
        const equal = `every version in locked_versions_across_graphs (${lockedText}) equals latest_observed (${latest}); requested_version ${row.requested_version}`;
        if (CANDIDATE_IS_LATEST.test(row.disposition)) return ["already_current", "locked_equals_candidate", `auto: ${equal}`];
        return ["pending", "candidate_open_by_disposition", `auto: ${equal}, but disposition ${row.disposition} leaves the candidate open; close with an override`];
    }
    if (row.source === "local workspace manifest")
        return ["pending", "internal_workspace", "auto: internal workspace package; requires rebuild-and-consumer validation before internal_rebuilt"];
    if (locked.includes(latest))
        return ["pending", "candidate_locked_in_some_graphs", `auto: ${compared}; the inventory does not say which locked version this manifest resolves`];
    return ["pending", "not_started", `auto: ${compared}`];
}

for (const row of rows) {
    const candidates = overrides.filter((entry) => selects(entry, row));
    candidates.forEach((entry) => matched.add(entry));
    const top = Math.max(...candidates.map(precedence));
    const winners = candidates.filter((entry) => precedence(entry) === top);
    if (winners.length > 1) errors.push(`${rowKey(row)}: ${winners.length} overrides of equal precedence`);
    [row.status, row.rule, row.status_evidence, row.status_updated_utc] = winners.length
        ? [winners[0].status, "override", winners[0].evidence, winners[0].updated_utc]
        : [...automaticStatus(row), snapshotUtc];
}
overrides.forEach((entry, i) => {
    if (!matched.has(entry)) errors.push(`override #${i + 1} (${entry.key ?? entry.name}) matched no inventory row`);
});
finishIfErrors();

// Outputs.
const added = ["status", "status_evidence", "status_updated_utc"];
const csv = toCsv([[...header, ...added], ...rows.map((row) => [...header, ...added].map((column) => row[column]))]);

const count = (items, keyOf) => items.reduce((acc, item) => acc.set(keyOf(item), (acc.get(keyOf(item)) ?? 0) + 1), new Map());
const table = (head, body) =>
    [head, head.map(() => "---"), ...body].map((cells) => `| ${cells.join(" | ")} |`).join("\n");
const perStatus = count(rows, (row) => row.status);
const perQueue = count(rows, (row) => `${row.queue} ${row.status}`);
const perRule = count(rows, (row) => `${row.rule} -> ${row.status}`);
const notPending = rows.filter((row) => row.status !== "pending");
const resolved = rows.filter((row) => !OPEN.has(row.status)).length;
const summary = `# Dependency status ledger summary

Generated by \`execution/tools/build-dependency-status.mjs\`. Do not edit by hand; edit \`status-overrides.json\` and re-run.

- Denominator: ${rows.length} declaration rows, ${names.size} distinct names (equal to \`inventory/inventory.json\`).
- Resolved rows (any status except pending and in_progress): ${resolved} of ${rows.length}. Open rows: ${rows.length - resolved}.
- Overrides applied: ${overrides.length}. Automatic rows are dated with the registry snapshot time, ${snapshotUtc}.
- \`already_current\` compares inventory columns as observed in that snapshot, not a fresh registry query. No row is ever marked \`updated\` automatically.

## Rows per status

${table(["status", "rows"], STATUSES.map((status) => [status, perStatus.get(status) ?? 0]))}

## Rows per queue and status

${table(
    ["queue", ...STATUSES, "total"],
    [...new Set(rows.map((row) => row.queue))].sort().map((queue) => {
        const cells = STATUSES.map((status) => perQueue.get(`${queue} ${status}`) ?? 0);
        return [queue, ...cells, cells.reduce((sum, cell) => sum + cell, 0)];
    })
)}

## Rows per derivation rule

${table(["rule -> status", "rows"], [...perRule].sort())}

## Rows that are not pending (${notPending.length})

${table(
    ["queue", "manifest", "kind", "name", "status", "evidence"],
    notPending.map((row) => [row.queue, row.manifest, row.kind, row.name, row.status, row.status_evidence.replaceAll("|", "\\|")])
)}
`;

const csvPath = join(args.out, "dependency-status.csv");
const summaryPath = join(args.out, "dependency-status-summary.md");
if (!args.check) {
    writeFileSync(csvPath, csv);
    writeFileSync(summaryPath, summary);
    console.log(summary);
    console.log(`Wrote ${csvPath} and ${summaryPath}`);
} else {
    const onDisk = parseCsv(readFileSync(csvPath, "utf8")).slice(1);
    const statusColumn = header.length;
    if (onDisk.length !== totals.direct_declarations)
        errors.push(`${csvPath} has ${onDisk.length} rows, expected ${totals.direct_declarations}`);
    const invalid = onDisk.filter((cells) => !STATUSES.includes(cells[statusColumn]));
    if (invalid.length) errors.push(`${csvPath} has ${invalid.length} rows with a status that is not allowed`);
    if (readFileSync(csvPath, "utf8") !== csv) errors.push(`${csvPath} is stale or hand-edited; re-run without --check`);
    if (readFileSync(summaryPath, "utf8") !== summary) errors.push(`${summaryPath} is stale or hand-edited; re-run without --check`);
    finishIfErrors();
    console.log(`check OK: ${onDisk.length} rows, ${names.size} names, ${overrides.length} overrides all matched, statuses valid, files up to date`);
}
