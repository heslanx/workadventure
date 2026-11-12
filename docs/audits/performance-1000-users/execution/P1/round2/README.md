# P1 round 2: open minor findings of `../review.md`

Status: **done** for the five minors (review findings 4 to 8), plus a regression test for major finding 1, plus
the four findings of the round 2 review (`review.md`, see "v2" below).

Current patches (apply both; each replaces any earlier version):

- `p1-round2.v2.patch` (sha256 `1e813588…1525ea`): `benchmark/README.md`, `src/runner.ts`, `src/stats.ts`,
  `tests/harness.test.ts`. It fully replaces `p1-round2.patch`, which is kept only as history.
- `p1-round2-contract.v2.patch` (sha256 `5e9194b4…0d3481`): `../HARNESS-CONTRACT.md` only, kept separate because
  that directory has another writer.

Both pass `git -C <checkout> apply --check` (exit 0). No file in the checkout changed. `benchmark/package.json`
and the lockfiles are untouched.

## v2: round 2 review findings

| Finding | Fix |
|---|---|
| r2-1 (minor) The runner's lag wiring was untested; mutant M4 (runner reports `percentile / 1e6`, `stats.ts` intact) survived | The per-room run test now asserts `generator.eventLoopLagMs.resolutionMs === 10` and `p50 < 10`. Rerun of M4 on `sbh`: the test fails, exit 1, then `runner.ts` was restored (`sha256sum -c` OK). |
| r2-2 (minor) `HARNESS-CONTRACT.md` stale: `schemaVersion: 1`, lag "about 10 ms", no `earlyLeave`; lane 7's lag in the old unit | `p1-round2-contract.v2.patch`: `schemaVersion: 2`, example lag with `resolutionMs`, new lag semantics, an `earlyLeave` example line and bullet, the scope of `reconciled`, and the rule for comparing schema 1 numbers (lane 7's p99 13.6 ms: subtract 10 ms). Lane 7's receipt itself belongs to lane 7 and is not edited. |
| r2-3 (nit) `stateAtLeave` docs named only 3 of 6 states | `benchmark/README.md` and the `runner.ts` comment now also name `rejected`, `leaving` and `closed` (already out of the room). |
| r2-4 (nit) The SIGINT test could leave the CLI running for 60 s on failure and dropped its stderr | The test now reads `child.stderr`, rethrows any failure with the CLI's stderr attached (`cause` keeps the assertion), and kills the child with `SIGKILL` in `finally` if it is still running, then awaits its exit. Its reliance on the root `tsx` stays with the deps lane (major 3). |

v2 checks (container `wa-fable-r2-20261112-p1-fix-N` on `sbh`, same image and limits as below; the sha256 of the 5
benchmark files matched between `/tmp/wa-r2/p1-fix` and the remote tree):

| # | Container | Command | Exit | Result |
|---|---|---|---|---|
| v2-1 | `-p1-fix-1` | vitest, tsc, prettier, then mutant M4 with restore | 0 / 0 / 1 / 1 | 15 passed; tsc clean; prettier flagged one wrapped `expect.poll` call in the test; M4 killed by the per-room run test; `runner.ts` restored and hash OK |
| v2-2 | `-p1-fix-2` | prettier on `tests/harness.test.ts` to stdout | 0 | formatted file copied back to the scratch repo |
| v2-3 | `-p1-fix-3` | final vitest + `tsc --noEmit` + prettier `--check` (`--no-config --print-width 120 --tab-width 4`) on `index.ts src/runner.ts src/stats.ts tests/harness.test.ts` | 0 / 0 / 0 | 15 passed in 6.70 s; no type errors; all files formatted. Receipt `receipt-5-v2-final-vitest-tsc-prettier.txt` |
| v2-4 | Mac | `git -C <checkout> apply --check` on both v2 patches | 0 / 0 | apply cleanly |
| v2-5 | `sbh` | `docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-r2-20261112-p1-fix` | 0 | 0 containers left; temporary check scripts removed |

## Round 1 of this lane (author pass, superseded by v2 where they differ)

## What changed and why

| Review finding | Change |
|---|---|
| 4. `--disconnect-fraction` skips sessions that have not started; no counter of planned leaves (`runner.ts:59`) | When the leave fires, a planned leaver that is still `idle` has its ramp start cancelled, so it never joins. Before, it started later and stayed in the room. The summary gets `earlyLeave: { planned, fired, stateAtLeave }`. `stateAtLeave` counts each planned leaver by its state when the leave fired: `accepted` left the room, `connecting` aborted its join, `idle` never started. A cancelled leaver is still counted in `sessions.neverStarted`, so `requested = started + neverStarted` holds. |
| 5. `eventLoopLagMs` includes the 10 ms sampling interval (`runner.ts:26`) | New `eventLoopLagMs(delayNs, resolutionMs)` in `stats.ts` returns the delay beyond the resolution, floored at 0. An idle generator now reads about 0 instead of about 10. The summary also reports `resolutionMs: 10`. Because existing numbers change meaning (lane 7's p99 13.6 ms is about 3.6 ms in the new unit), `schemaVersion` is now `2`. |
| 6. README recommends the broken `benchmark_multi_core.sh` | README now says to run several generator processes, each with its own `--name-prefix` and `--output`, and to add their summaries. It warns that session indexes restart at 0 in every process, so processes with the same room list follow the same paths, and says that `benchmark_multi_core.sh` predates the harness and does not do this. The script is unchanged. |
| 7. `reconciled` cannot detect a room-membership mismatch (`runner.ts:155`) | A code comment and a README paragraph state that `reconciled` checks the generator's own bookkeeping (session buckets, sockets, timers). Server-side room membership has to come from the back and pusher gauges. This is the fix the review proposed. A duplicate-user-id check was rejected: the back numbers users from 1 per `GameRoom`, and a room that empties is recreated, so ids can repeat legitimately. Such a check would invalidate good runs. |
| 8. SIGINT claim untested | New test: it spawns the real CLI (`node --import tsx index.ts`) against the fake pusher, waits for 2 accepted sessions, sends `SIGINT`, and checks exit 0, `stopReason: "aborted"`, `accepted: 2`, cleanup `{0, 0}`, `reconciled: true`, and close codes `[1000, 1000]` seen by the server. README line 67 now names that test. |
| 1 (major, already fixed in code by the coordinator) | The fake pusher now numbers users per room, like the back. The existing multi-room test therefore covers the per-room `uniqueUserIds` sum: room a gets ids 1 and 2, room b gets id 1 again, and the expected total is 3. |
| (format) | One baseline line in `harness.test.ts` (line 61) was rewrapped so the touched TS files pass prettier with the repo's `printWidth 120 / tabWidth 4`. |

## Checks (all on `sbh`, tree `~/wa-jobs/wa-fable-20261112/src-p1`, `node:24-trixie`, Node v24.22.2, vitest 4.1.7, `--network none --cpus 1 --cpu-shares 512 --memory 3g`)

Before each run, the sha256 of the 5 benchmark files matched between the scratch repo and the remote tree.

| # | Container | Command | Exit | Result |
|---|---|---|---|---|
| 1 | `…-p1-impl-1` | `vitest run tests/harness.test.ts`, then `tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --types node index.ts tests/harness.test.ts` | 0 / 0 | 15 passed (was 12). Receipt `receipt-1-vitest-tsc.txt` |
| 2 | `…-p1-impl-2` | Mutation run. M1 drops the ramp-start cancel, M2 flattens the user ids across rooms, M3 removes the `SIGINT` handler, M4 reports the raw delay. Files are restored after each mutation | 1 each | Each mutation fails exactly its target test: M1 the early leaver, M2 the per-room count, M3 the SIGINT test, M4 the event-loop lag. After restore, the hashes equal the patched files. Receipt `receipt-2-mutations.txt` |
| 3 | `…-p1-impl-3` | 3 consecutive vitest runs | 0, 0, 0 | 15 passed each time (timing-based tests stable). Also ran prettier with the default config, which is not the repo config, so it is not significant. Receipt `receipt-3-reruns-prettier-default.txt` |
| 4 | `…-p1-impl-4`, `-5` | prettier `--check` with `{printWidth:120, tabWidth:4}` (from `play/.prettierrc.json`), new files vs baseline files | 1 / 1 | The baseline already failed on `runner.ts` and `harness.test.ts`. On the new files, only baseline line 61 of the test and the pre-existing README table remained. The test line was then fixed |
| 5 | `…-p1-impl-6` | vitest + tsc + prettier `--check` on `index.ts src/runner.ts src/stats.ts tests/harness.test.ts` | 0 / 0 / 0 | 15 passed, all TS files formatted |
| 6 | `…-p1-impl-7` | Final vitest + tsc after the `schemaVersion: 2` bump | 0 / 0 | 15 passed in 6.53 s. Receipt `receipt-4-final-vitest-tsc.txt` |
| 7 | Mac | `git -C <checkout> apply --check p1-round2.patch` | 0 | Applies cleanly |
| 8 | `sbh` | `docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-r2-20261112-p1-impl` | 0 | 0 containers left |

Receipts 1 to 3 predate the test-line rewrap and the `schemaVersion` bump. Receipt 4 is the final state.

## Still open

1. `../HARNESS-CONTRACT.md` is fixed only once the coordinator applies `p1-round2-contract.v2.patch` together with
   `p1-round2.v2.patch`. This lane did not write to the P1 directory. If that file changes first, the contract
   patch may need a rebase.
2. Lane 7's receipt (`eventLoopLagMs.p99 13.6`) uses the old unit and is left unchanged because lane 7 owns it.
   The contract patch says to subtract 10 ms before comparing it with new runs.
3. `benchmark/README.md`'s flag table is not prettier-aligned. This is pre-existing and was not changed, to keep
   the diff small.
4. Major finding 3 (undeclared `tsx`, `vitest`, `@types/node`) is still owned by the deps lane.
5. Not observed live: the SIGINT path is now covered against the in-process fake pusher, not against a real stack,
   and the early-leave change has no live lane 9 run yet.
