# Dependency status ledger tools

`build-dependency-status.mjs` derives the row-level status ledger for the 419 direct dependency declarations. It is plain Node with no dependencies and runs on the macOS host.

## Usage

Run from the repository root:

```sh
# Rebuild the ledger and print the summary
node docs/audits/performance-1000-users/execution/tools/build-dependency-status.mjs

# Verify the ledger on disk without writing (exit 1 on any problem)
node docs/audits/performance-1000-users/execution/tools/build-dependency-status.mjs --check

# Behaviour tests; they write only to temp directories
node --test docs/audits/performance-1000-users/execution/tools/
```

Optional flags `--inventory <csv>`, `--overrides <json>` and `--out <dir>` redirect inputs and outputs; the tests use them.

| Path | Role |
| --- | --- |
| `inventory/dependency-upgrade-targets.csv` | Input. Frozen 419-row target inventory. |
| `inventory/inventory.json` | Input. Expected denominator (`direct_declarations`, `unique_direct_names`). |
| `evidence/dependency-registry-snapshot.json` | Input. `checked_at_utc` dates the automatic rows. |
| `execution/tools/status-overrides.json` | Input. Manual status decisions. |
| `execution/dependency-status.csv` | Output. The nine inventory columns unchanged, plus `status`, `status_evidence`, `status_updated_utc`. |
| `execution/dependency-status-summary.md` | Output. Denominator, rows per status, rows per queue and status, rows per rule, every row that is not pending. |

Both outputs are deterministic: the same inventory and overrides produce the same bytes, so `--check` detects a stale or hand-edited ledger.

## Status rules, in order

1. **Override.** An entry in `status-overrides.json` wins. Row key: `<manifest>#<kind>#<name>`, for example `play/package.json#devDependencies#typescript`. A `name` entry covers every manifest that declares the dependency; add `manifest` to narrow it. `key` beats `name` + `manifest`, which beats `name`.
2. **`already_current`.** Every version in `locked_versions_across_graphs` equals `latest_observed`, and the row's `disposition` names the latest release as its candidate (`candidate_requires_*` or `observed_latest_*`). The evidence cell quotes the compared columns.
3. **`pending`, internal workspace.** `source` is `local workspace manifest`. The row needs rebuild-and-consumer validation before an override may set `internal_rebuilt`.
4. **`pending`.** Everything else. The evidence cell quotes the versions that differ.

The script never derives `updated`, `blocked_with_reason`, `replaced_with_contract_proof`, `internal_rebuilt` or `in_progress`; those come only from overrides, and every override must carry `evidence` and `updated_utc`.

The build exits 1 and writes nothing when the row count or the distinct-name count differs from `inventory.json`, when an override has a status outside the allowed set, lacks evidence or a timestamp, matches no row, or ties with another override on the same row.

## Two deliberate limits on `already_current`

- **Version-equal rows with an open candidate stay pending (14 rows).** Seven deprecated-package rows and seven coupled-migration rows (`@anatine/zod-openapi`, `zod-to-json-schema`) already lock `latest_observed`, but their disposition asks for a replacement or migration decision. They are reported under the rule `candidate_open_by_disposition`. Close each with an override once the decision has evidence.
- **`requested_version` is not accepted as proof (36 rows).** These rows lock the candidate in some graphs only. `benchmark/package.json` declares `ts-node-dev ^2.0.0`, the candidate, while `benchmark/package-lock.json` still resolves 1.0.0. They are reported under the rule `candidate_locked_in_some_graphs`. `receipts-lock-crosscheck.txt` lists the 21 of them whose own lock graph already resolves the candidate and the 15 that are behind.

## Result of the run on 2026-11-11

| Measure | Value |
| --- | --- |
| Declaration rows | 419 |
| Distinct names | 217 |
| `already_current` | 109 |
| `pending` | 310 (232 not started, 36 candidate locked in some graphs, 28 internal workspace, 14 candidate open by disposition) |
| Any other status | 0 |
| Overrides | 0 |

Commands and exit codes are in `receipts.txt`.

## What remains

- The coordinator adds overrides as lanes land (TypeScript, Svelte) and re-runs the build, then `--check`.
- The 21 rows listed as closable in `receipts-lock-crosscheck.txt` need a decision: add row overrides citing that file, or leave them pending until the lockfiles are refreshed.
- `already_current` reflects the registry snapshot of 2026-11-11T23:11:00Z. A new registry query needs a new inventory before the ledger can reflect it.
