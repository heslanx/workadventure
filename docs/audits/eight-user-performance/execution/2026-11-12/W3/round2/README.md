# W3 round 2, lane cpu: quota-aware backend CPU measurement

2026-11-12. Host `knc`, tree `~/wa-jobs/wa-fable-20261112/src-cpu` (checkout snapshot, Node 24). No product file of the
checkout was edited.

Deliverable: `cpu-quota-aware.v2.patch` (489 lines, sha256 `fd7e6bce…af8e`). It fully replaces `cpu-quota-aware.patch`
(v1, kept for the review trail) and applies to the checkout on its own. It was produced with `git diff` from the scratch
repo `/tmp/wa-r2/cpu-fix/` (base: the checkout's `back/src/Services/CpuTracker.ts`).

## Why

`back/src/Services/CpuTracker.ts` divided process CPU time by wall time, which gives a percentage of one core. Inside a
container capped below one core (0.65 CPU for `wa-fable-stack-back`), a fully throttled backend reported at most 65 %.
The default `CPU_OVERHEAT_THRESHOLD` of 80 could never be crossed, so movement shedding in
`SocketManager.handleUserMovesMessage` never engaged while the process was out of CPU (W3 `README.md`, H16;
demonstration with the unmodified code in `../cpu-tracker/vitest-runs.txt`: 0.65 core fully used gives 65 %, no overheat).
The reviewer measured the effect on a real cgroup v2 container at `--cpus 0.65` (`review.md`, `review-receipt3.txt`): the
quota-aware tracker read 97-110 % and overheated, the one-core tracker read 63-72 % and did not.

## What changed (v2)

`back/src/Services/QuotaAwareCpuTracker.ts` (new) holds the tracker class and the cgroup boundary:

- `parseCgroupV2CpuMax`, `parseCgroupV1CfsQuota`: cgroup contents to cores; only positive decimal integers are accepted;
  unlimited (`max`, `-1`) and malformed content give `undefined`.
- `parseCgroupV2Path`: the `0::<path>` entry of `/proc/self/cgroup`; a missing entry, a relative path or a `..`
  component gives `undefined`.
- `readCgroupCpuQuota(readFile)`: cgroup v2 `cpu.max` of the process cgroup (`/sys/fs/cgroup/<path>/cpu.max`, from
  `/proc/self/cgroup`), then the root `/sys/fs/cgroup/cpu.max`, then cgroup v1 `cpu.cfs_quota_us` / `cpu.cfs_period_us`.
  It returns the quota in cores and its source. Malformed content is logged with `console.warn` and its path; an
  unlimited quota is not logged. `readCgroupCpuQuotaCores` returns only the cores.
- `cpuCapacityCores(quota)`: `min(1, quota)`, or 1 with no quota (the event loop saturates at one core).
- `readCpuCapacity(readFile)`: the reference capacity and its source.
- `readOptionalFile(path)`: the production reader. `ENOENT` gives `undefined` silently; any other read error is logged
  through `asError` (`console.warn`) and then treated as absent.
- `CpuTracker`: the constructor takes a `CpuCapacity` (default: `readCpuCapacity(readOptionalFile)`), rejects a capacity
  that is not a finite positive number, and logs one `console.info` line with the capacity and its source. The
  percentage is `round(100 × cpuMs / (elapsedMs × capacity))`; nanoseconds are converted to milliseconds explicitly.

`back/src/Services/CpuTracker.ts` now only builds the singleton: `export { cpuTracker }` with `getCpuPercent()` and
`isOverHeating()`, the same public API as before the change. Threshold, interval and shedding policy are unchanged.

`back/tests/CpuTracker.test.ts` (new, 22 tests) imports `QuotaAwareCpuTracker` only, so loading the tests no longer builds
the real singleton, reads the real `/sys/fs/cgroup` or starts a real interval. Fake cgroup contents go through the injected
reader; the clock is synthetic (`process.hrtime.bigint` / `process.cpuUsage` spies, fake `setInterval`); `console.warn` and
`console.info` are spied.

Behavior: no cgroup files, unlimited quota, malformed content, or a quota of one core or more: same percentage as before.
A quota below one core: full use of the quota reads 100 %, so the threshold of 80 is reachable.

## Review findings (`review.md`) and how v2 addresses them

| Id | Finding | v2 |
|---|---|---|
| m1 | Every read error and malformed content fell back silently; the capacity was never logged | One `console.info` line at construction with capacity and source; malformed content is warned with its path; read errors other than `ENOENT` are warned through `asError`. Tests: `should warn about malformed content but not about an unlimited quota`, `should log a read failure other than a missing file` (reads `/`, `EISDIR`), `should return undefined for a missing file without logging`, and the `info` assertions in the tracker tests. |
| m2 | Only the root `/sys/fs/cgroup` paths were read | The cgroup v2 path is resolved from `/proc/self/cgroup` through the injected reader, with the root as the fallback. Tests: `parseCgroupV2Path` (2 tests), `should read cpu.max of the process cgroup from /proc/self/cgroup before the root`, `should fall back to the root cpu.max when the process cgroup has none`. |
| N1 | The consumer test command in this README lacked the `npm test` environment | Check 3 below now carries `PLAY_URL=http://play.workadventure.localhost ADMIN_URL=`, as in the reviewer's `review-receipt2.txt`. |
| N2 | A capacity of 0, NaN or a negative value gave an Infinity or NaN percentage | The constructor throws `CPU capacity must be a positive number of cores` for 0, negative, NaN and Infinity. Test: `should reject a capacity that is not a positive number of cores`. |
| N3 | Importing the tested module built the real singleton and started a real interval | Class and parsers moved to `QuotaAwareCpuTracker.ts`; `CpuTracker.ts` keeps only the singleton; the test imports the former. |

## Checks (each in a fresh container `wa-fable-r2-cpu-fix-<n>`, `--cpus 1 --cpu-shares 512 --memory 3g --network none`, on `knc`)

| # | Command (from `/work/back`) | Exit | Result | Receipt |
|---|---|---|---|---|
| 1 | `npx prettier --write` then `npx prettier --check src/Services/CpuTracker.ts src/Services/QuotaAwareCpuTracker.ts tests/CpuTracker.test.ts` | 0 | `--write` rewrapped the test file only (pulled back to the scratch repo before the diff); `--check` all formatted | `run1.v2.txt` |
| 1 | `DEBUG= npx eslint src/Services/CpuTracker.ts src/Services/QuotaAwareCpuTracker.ts tests/CpuTracker.test.ts` | 0 | no output | `run1.v2.txt` |
| 1 | `npx vitest --config vitest.config.ts --run tests/CpuTracker.test.ts --reporter=verbose` | 0 | 22/22 passed | `run1.v2.txt` |
| 2 | `npm run typecheck` (`tsc --noEmit`, whole back project including tests) | 0 | no diagnostics | `run2.v2.txt` |
| 2 | `PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest --run tests/CpuTracker.test.ts tests/GameRoom.test.ts tests/SessionAnalytics.test.ts tests/RoomManager.test.ts` (tests importing `SocketManager`, the consumer of `cpuTracker`) | 0 | 4 files, 51/51 passed (22 new + 29 consumer) | `run2.v2.txt` |
| - | `git -C <checkout> apply --check cpu-quota-aware.v2.patch` (Mac, read-only) | 0 | applies | - |

Files on `knc` and in the scratch repo are identical: `CpuTracker.ts` `ba63e453…5ee9`, `QuotaAwareCpuTracker.ts`
`9c8eb7aa…a83d`, `CpuTracker.test.ts` `1aea816f…a1ba`. The v1 checks (`run1.txt`..`run3.txt`) describe v1 only.

## Resources

Containers `wa-fable-r2-cpu-fix-1..2` ran with `--rm`; `docker ps -a --filter label=owner=wa-fable-20261112 --filter
name=wa-fable-r2-cpu-fix` lists 0 afterwards. Remote receipts and a copy of the v2 patch are in
`~/wa-jobs/wa-fable-20261112/receipts-cpu-fix/`. The `src-cpu` tree now holds the v2 files as the verified state.

## Open

1. Not run: full back vitest suite and `npm run lint` over all of `src/` (only changed files and consumer tests).
2. v2 was not re-measured on a real throttled container; the reviewer's real cgroup v2 measurement at `--cpus 0.65` used
   v1, and the percentage formula is unchanged in v2. No sample of a backend at 0.65 CPU under eight users yet.
3. The quota is read once at start; a live `docker update --cpus` is not followed until restart.
4. Only the process's own cgroup v2 `cpu.max` is read, not the ancestors' (a tighter limit on a parent slice is not seen).
   A v1 mount at `cpu,cpuacct` without the usual `cpu` symlink still falls back to the one-core reference, now with a log
   line naming the source.
5. Read failures and malformed content are logged with `console.warn`, not reported to Sentry: the fallback is safe and
   the line is emitted once at start.
6. `play/src/pusher/services/CpuTracker.ts` has the same one-core loop; it does not gate movement and is not changed here.
7. Policy question left to upstream: whether event-loop delay (`perf_hooks.monitorEventLoopDelay`) should replace CPU time
   as the overheat signal, and whether thread time above one core should count.
