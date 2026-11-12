# Execution status ledger

Window 2026-11-11 23:24:30 to 2026-11-12 01:24:30 UTC. Baseline `ddbe245a8`. Final update 01:08 UTC. A slice is verified only when its unit, live and perf gates all have receipts. No slice reached that in this window, so none is upstream-ready as a verified PR.

## Slices

| ID | What | Code state in the checkout | Unit gate | Live gate | Perf gate | Independent review | Evidence |
|---|---|---|---|---|---|---|---|
| P1 | Headless room load generator (`benchmark/`) | changed: `index.ts`, `src/*.ts`, `tests/harness.test.ts`, `README.md`, `package.json` scripts; runner fix at 01:02 | 12 tests and `tsc --noEmit` pass on sbh and knc trees with checksum-identical files (exit 0) | lanes 2, 4, 5, 6, 7 pass against the isolated stack; lane 3 partial (headless observer only); lanes 1 (live), 8, 9, 10 not run | 100-session checkpoint: 100 accepted, 0 errors, join p50 18.6 / p95 308.7 / max 987.1 ms, generator 6.3% of a core; one capped shared host, dev mode, no capacity claim | PASS_WITH_NITS; one major fixed (multi-room id count), one reworded (lane 3), one open (undeclared `tsx`, `vitest`, `@types/node` need a root lockfile change) | `P1/` |
| P2 | Svelte 5.55.9 to 5.57.3 | applied: 3 manifests plus root lockfile (sha256 `867162bd…c8d140`); checkout `node_modules` not reinstalled, run `npm ci` once in the integration environment | base and head on sbh: svelte-check, typecheck, 343 focused tests, builds, pretty-check exit 0; head whole `play` suite 1605 passed, 10 skipped, exit 0; `npm run lint` not run | PENDING (browser lanes 1-10) | bundle size neutral (+0.02% total); no memory claim | not reviewed independently | `P2/README.md` |
| P3 | Evidence for upstream PR #6688 (head `04634ad`) | none | differential trace 3 x 200,000 operations, 0 mismatches except the intended empty-store change; PR-head tests ran on knc | PENDING | micro-measurement only | n/a (this is the review) | `P3/review.md`, `pr-descriptions/P3-contribution.md` |
| P4 | Skip unchanged effective-zone reconciliation | changed: `PositionDispatcher.ts` (early return, per-socket WeakMap, reconciliation moved to `reconcileZones()`), test file (+13 tests) | 21 tests pass on HEAD code and on the change; a mutant without the `removeViewport` invalidation fails 1 test; typecheck, eslint, prettier exit 0 | PENDING (lanes 1-10, 1,000 moving users) | micro-benchmark, 5 runs: walk 0.27x and crowd-walk (1,000 sockets) 0.28x of base time, bytes per update 7491 to 2032; all-miss path inside noise after the extraction; +3.8% bytes on all-miss updates; knc shared with other work during runs | PASS_WITH_NITS; two surviving mutants (bottom-right-only resize, partial subscribe failure) need two more tests | `P4/` |
| P5 | Map autosave lifecycle | changed: `MapsManager.ts`, new `src/tests/MapsManagerAutosave.test.ts` | trunk 7 of 11 fail (reproduced), head 11 of 11 pass; MapStorageServer tests, typecheck, eslint, prettier exit 0; reviewer re-ran them | PENDING (no real disk or S3 run) | healthy path 2 to 1 writes per edit; 13 edits over 60 s 6 to 5 writes | PASS_WITH_NITS, no blocker or major | `P5/` |
| D01a / P6 | TypeScript 6 line, native 7.0.2 pilot | none in the checkout; patches `D01/d01a-ts6-compat.patch`, `P6/p6-native-pilot.patch`, lockfiles in `/tmp/wa-fable-staging/D01/` | resolution proven on a knc snapshot: `tsc` 7.0.2, `tsc6` and `require('typescript')` 6.0.3 from root, back and map-storage | n/a | measurements in `P6/c-bench.jsonl` and `D01/*.jsonl` (CI typecheck time, capped shared VPS) | none | `D01/README.md`, `P6/README.md` |

## Research and inventory

| Item | State | Evidence |
|---|---|---|
| Dependency ledger, 419 rows, 217 names | `--check` exit 0. updated 3, already_current 110, blocked_with_reason 16, in_progress 15, pending 275 | `dependency-status.csv`, `dependency-status-summary.md`, `tools/status-overrides.json` |
| D14 images, 44 + 7 declarations | 51 rows with targets and classification; nothing pulled, scanned or run, no SBOM | `D14/image-targets.csv`, `D14/README.md` |
| Compatibility decisions | Phaser 4.2.1: the GPU patch applies 29 of 29 hunks. `@types/node`: move to 24.x. Nine deprecated packages: decisions recorded. Zod 4: blocked by `@anatine/zod-openapi` peer `^3.20.0` | `research/version-decisions.md` |
| Upstream duplicate recheck | written | `research/upstream-duplicates.md` |
| Client interpolation and chat DOM candidates | not resumed after the quota interruption; the eight-user W4 stream measured chat DOM growth instead | `client/bench/` |
| Baseline integrity, 14 imported files | 14 of 14 match the import manifest (re-run at 01:05) | `tools/verify-baseline-integrity.mjs` |

## Interruptions and limits

- At about 00:26 UTC every running lane agent stopped with "You've reached your Fable limit". The user switched to Opus 5.5 and asked to continue. A finish round from 00:35 UTC continued each lane from its on-disk artifacts.
- The MacBook ran at load 600 to 900 with swap at 93% to 97%. No real-browser measurement was possible. `wa-fable-local` was removed at 00:38 UTC and all checks moved to knc and sbh.
- At 00:38 UTC knc ran at load 6.6 on 4 cores, shared by `wa-fable-tsbase`, `wa-fable-p4-bench` and two unrelated `helix-wf-*` containers. Production containers were idle and task containers ran at half CPU priority. P4 and D01 timings from that period are valid only as same-run ratios.
- Generator and server shared one 4-core VPS that also runs production. Nothing above 100 sessions was measured. No 1,000-user capacity is claimed.
