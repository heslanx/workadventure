// Run on the host: node --test docs/audits/performance-1000-users/execution/tools/
// Every case writes to a temp directory; the real ledger is never touched.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "build-dependency-status.mjs");
const inventory = resolve(here, "../../inventory/dependency-upgrade-targets.csv");
const dataLines = (file) => readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(1);
const tempDirs = [];
const tempDir = () => tempDirs[tempDirs.push(mkdtempSync(join(tmpdir(), "wa-ledger-test-"))) - 1];
after(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function run(overrides, extraArgs = []) {
    const out = tempDir();
    const overridesPath = join(out, "overrides.json");
    writeFileSync(overridesPath, JSON.stringify({ overrides }));
    const args = [script, "--out", out, "--overrides", overridesPath, ...extraArgs];
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    const ledger = () => dataLines(join(out, "dependency-status.csv"));
    const check = () => spawnSync(process.execPath, [...args, "--check"], { encoding: "utf8" });
    return { ...result, out, ledger, check };
}
const override = (fields) => ({ status: "updated", evidence: "receipt.txt", updated_utc: "2026-11-12T00:00:00Z", ...fields });

test("covers every inventory row and keeps the original columns unchanged", () => {
    const built = run([]);
    assert.equal(built.status, 0, built.stderr);
    const source = dataLines(inventory);
    const ledger = built.ledger();
    assert.equal(ledger.length, source.length);
    ledger.forEach((line, i) => assert.ok(line.startsWith(`${source[i]},`), `row ${i + 1} changed`));
    assert.match(built.stdout, /419 declaration rows, 217 distinct names/);
    assert.equal(built.check().status, 0);
});

test("never derives a status other than already_current or pending", () => {
    const statuses = new Set(run([]).ledger().map((line) => line.match(/,(\w+),(?:"[^"]*"|[^,]*),[^,]*$/)[1]));
    assert.deepEqual([...statuses].sort(), ["already_current", "pending"]);
});

test("a declared range at the candidate stays pending when another locked version exists", () => {
    // benchmark declares ts-node-dev ^2.0.0 (the candidate) while benchmark/package-lock.json resolves 1.0.0.
    const row = run([]).ledger().find((line) => line.startsWith("benchmark/package.json,dependencies,ts-node-dev,^2.0.0,"));
    assert.match(row, /,2\.0\.0,D\d\d,[^,]*,[^,]*,pending,/);
});

test("a row override beats a family override, and the family covers the other manifests", () => {
    const built = run([
        override({ name: "typescript", status: "in_progress", evidence: "family receipt" }),
        override({ key: "play/package.json#devDependencies#typescript", evidence: "row receipt" }),
    ]);
    assert.equal(built.status, 0, built.stderr);
    const typescript = built.ledger().filter((line) => line.split(",")[2] === "typescript");
    assert.equal(typescript.length, 15);
    assert.equal(typescript.filter((line) => line.endsWith(",in_progress,family receipt,2026-11-12T00:00:00Z")).length, 14);
    const play = typescript.filter((line) => line.startsWith("play/package.json,"));
    assert.ok(play[0].endsWith(",updated,row receipt,2026-11-12T00:00:00Z"));
});

test("an override that matches no row fails the build", () => {
    const built = run([override({ name: "not-a-declared-dependency" })]);
    assert.notEqual(built.status, 0);
    assert.match(built.stderr, /matched no inventory row/);
});

test("an override with a status outside the allowed set fails the build", () => {
    const built = run([override({ name: "typescript", status: "done" })]);
    assert.notEqual(built.status, 0);
    assert.match(built.stderr, /status "done" is not allowed/);
});

test("an override without evidence fails the build", () => {
    const built = run([override({ name: "typescript", evidence: "" })]);
    assert.notEqual(built.status, 0);
    assert.match(built.stderr, /evidence is required/);
});

test("an inventory with a different row count fails the build", () => {
    const truncated = join(tempDir(), "truncated.csv");
    writeFileSync(truncated, readFileSync(inventory, "utf8").split("\n").slice(0, 400).join("\n"));
    const built = run([], ["--inventory", truncated]);
    assert.notEqual(built.status, 0);
    assert.match(built.stderr, /inventory\.json declares 419/);
});

test("--check rejects a ledger edited by hand", () => {
    const built = run([]);
    const file = join(built.out, "dependency-status.csv");
    writeFileSync(file, readFileSync(file, "utf8").replace(",pending,", ",updated,"));
    const checked = built.check();
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /stale or hand-edited/);
});
