# P1 round 2 review: `p1-round2.patch`

Verdict: PASS_WITH_NITS. All five open minors from `../review.md` are fixed. No blocker and no major. Two
minors and two nits remain, listed below.

Reviewer: independent reviewer, not the author. Date: 2026-11-12, 01:36-01:50 UTC. Host: `sbh`.

## Scope

- Patch: `p1-round2.patch`. It touches `benchmark/README.md`, `benchmark/src/runner.ts`, `benchmark/src/stats.ts`
  and `benchmark/tests/harness.test.ts`. It does not touch `benchmark/package.json` or any lockfile.
- Lane brief items: 4 (disconnectFraction), 5 (event-loop lag), 6 (multi-core script), 7 (reconciled scope),
  8 (SIGINT untested). The author also fixed the fake pusher's per-room ids, which adds a regression test for
  major 1.

## Checks run

1. `git -C <checkout> apply --check p1-round2.patch`: exit 0. The checkout was not modified.
2. Remote tree identity: I applied the patch to a scratch copy of the checkout files (`/tmp/wa-r2/p1-review`).
   The sha256 of `README.md`, `src/runner.ts`, `src/stats.ts`, `tests/harness.test.ts`, `src/session.ts` and
   `index.ts` match `sbh:~/wa-jobs/wa-fable-20261112/src-p1/benchmark/` exactly. So the remote tree is the
   checkout plus this patch.
3. Container `wa-fable-r2-20261112-p1-review-1` (node:24-trixie, Node v24.22.2, `--network none`, 1 CPU, 3 GB):
   `vitest run tests/harness.test.ts` (vitest 4.1.7) passed 15/15 with exit 0 in 6.50 s. The new tests took
   1507 ms (early leaver) and 1099 ms (SIGINT).
4. In the same container, `tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext
   --moduleResolution bundler --types node index.ts tests/harness.test.ts` exited 0.
5. Container `wa-fable-r2-20261112-p1-review-2` ran mutants in the remote tree. A trap restored the files after
   each mutant, and `sha256sum -c` reported OK for `index.ts`, `src/runner.ts` and `src/stats.ts` at the end.

| Mutant | Target | Result |
|---|---|---|
| M1: delete `timers.clear(rampStarts[index])` | early-leaver test | killed (1 failed test) |
| M2: delete `process.once("SIGINT", onSignal)` | SIGINT CLI test | killed (1 failed test) |
| M3: `eventLoopLagMs` returns the raw delay | lag unit test | killed (1 failed test) |
| M4: runner reports `percentile / 1e6` again; `stats.ts` intact | none | **survived** (finding 1) |
| M5: flatten user ids across rooms | two-room test (major 1 regression) | killed (1 failed test) |

## Brief items

| Item | Status | Evidence |
|---|---|---|
| 4 disconnectFraction counts never-started sessions | fixed | `runner.ts:70-73` clears the ramp start of each planned leaver. Clearing an already fired timeout is a no-op (`TimerRegistry.clear` deletes from both sets). `earlyLeave` is reported. M1 killed. |
| 5 lag includes the 10 ms resolution | fixed | `stats.ts` `eventLoopLagMs` subtracts the resolution and floors at 0. Node's ELD histogram records the full interval between ticks, so subtracting the resolution is correct, and percentiles commute with the monotone shift. `schemaVersion: 2` and `resolutionMs` are reported. M3 killed. |
| 6 README recommends `benchmark_multi_core.sh` | fixed | README now gives multi-process guidance. The claims match the code: the script starts four `yarn run start`, and `positionAt(index, step)` makes paths depend only on the index. |
| 7 `reconciled` cannot see room membership | fixed (doc, as the finding asked) | README paragraph and `runner.ts:168-169` comment. |
| 8 SIGINT untested | fixed | The new CLI test spawns `node --import tsx index.ts`, sends SIGINT and asserts exit 0, `stopReason: "aborted"`, cleanup, `reconciled` and close codes. M2 killed: without the handler, node dies by signal and the exit code is `null`. |

## Findings

### 1. minor: the runner's use of the corrected lag is not tested

- File: `benchmark/src/runner.ts:159-165`.
- The unit test pins `eventLoopLagMs`. No test reads `summary.generator.eventLoopLagMs`. Mutant M4 restores
  the old `percentile / 1e6` in the runner and passes all 15 tests, so the summary can regress to the
  "about 10 ms when idle" unit without a failing check.
- Fix: in an existing run test, assert `summary.generator.eventLoopLagMs.resolutionMs === 10` and
  `p50 < 10`. An idle fake-pusher run reads about 0, which leaves a wide margin against noise.

### 2. minor: `HARNESS-CONTRACT.md` contradicts the patched code

- File: `docs/audits/performance-1000-users/execution/P1/HARNESS-CONTRACT.md` (lines 75, 101 and 111 per the
  author).
- The contract still says `schemaVersion` 1 and the "about 10 ms" lag meaning, and it has no `earlyLeave`.
  After the patch, consumers following the contract read the lag wrongly. The author reported this as open
  because another writer owns the directory. It must be updated when the patch is applied, together with the
  lane 7 lag receipt (p99 13.6 ms in the old unit, about 3.6 ms in the new one).

### 3. nit: the README lists only three `stateAtLeave` states

- Files: `benchmark/README.md:26-27`, `benchmark/src/runner.ts:62-63,71`.
- `stateAtLeave` counts `session.state`, which can also be `rejected`, `leaving` or `closed` (for example, a
  planned leaver that was refused, or whose socket closed unexpectedly before `disconnectAt`). The README and
  the code comment give only `accepted`, `connecting` and `idle`, so a lane 9 reader may assume those three
  add up to `planned`.
- Fix: say "for example" or list every state.

### 4. nit: the SIGINT test leaves its child running when it fails early

- File: `benchmark/tests/harness.test.ts:264-297`.
- If the poll times out, for example because tsx fails to resolve or the CLI crashes, the test throws before
  `child.kill`. A child that is still alive then runs for its `--duration-seconds=60` after the test. Its
  stderr is never read, so the failure shows only "expected 2". The test also needs `tsx` to resolve from the
  root `node_modules`, which is the undeclared dependency of major 3 (deps lane).
- Fix: kill the child in a `finally` or in `afterEach`, and collect stderr into the failure message.

## Not verified

- No live-stack run of SIGINT or of early leave against the real back/pusher (lane 9).
- Prettier: I did not rerun it (the author reports exit 0 on the touched TS files).

## Resources

- Containers created: `wa-fable-r2-20261112-p1-review-1` and `-2`, both `--rm`.
  `docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-r2-20261112-p1-review` lists
  none at the end.
- Temporary script dir `sbh:~/wa-jobs/wa-fable-20261112/p1-review-tmp` was removed. The remote tree files
  touched by the mutants were restored, and their hashes were verified.
