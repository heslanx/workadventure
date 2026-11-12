# W3 round 2, lane cpu: independent review of `cpu-quota-aware.patch`

2026-11-12, 01:30-01:42 UTC. Reviewer did not write the change. Host `knc`, author tree
`~/wa-jobs/wa-fable-20261112/src-cpu`, reviewer scripts and raw receipts in `~/wa-jobs/wa-fable-20261112/review-cpu/`.
Local copies of the receipts: `review-receipt1.txt`, `review-receipt2.txt`, `review-receipt3.txt` (ANSI stripped).

**Verdict: PASS_WITH_NITS.** The patch fixes W3-H16 as briefed, the tests fail on the bug and on every targeted
mutant, and all the author's checks reproduce. No blocker, no major. Two minor findings and three nits below.

## Patch identity

| Check | Result |
|---|---|
| Patch sha256 | `f2420aac…0d84`, 263 lines: matches the author report |
| `git -C <checkout> apply --check cpu-quota-aware.patch` (Mac, read-only) | exit 0 |
| Patch applied in the scratch repo `/tmp/wa-r2/cpu-review/` vs remote tree | `CpuTracker.ts` `192dc08d…fc50`, `CpuTracker.test.ts` `1524f851…2d72`, the same on both sides, so the remote tree is exactly the patch |
| Remote tree after review (mutants restored, temporary test removed) | same two hashes; `RealCgroupReview.test.ts` count in `back/tests` = 0 |

## Brief coverage

| Brief item | Status |
|---|---|
| cgroup v2 `cpu.max` | done: `parseCgroupV2CpuMax`, `max` gives undefined |
| cgroup v1 `cfs_quota_us`/`cfs_period_us` | done: `parseCgroupV1CfsQuota`, `-1` gives undefined |
| Fallback to the current behavior when absent or unlimited | done: `cpuCapacityCores(undefined) = 1`; the unit cleanup (`ns / 1e6`) is algebraically identical to the old `* 1000000` |
| Parse at the boundary | done: the file reader is injected, the parsers return `number \| undefined`, and only strict positive decimal integers are accepted |
| Public API kept | done: `cpuTracker.getCpuPercent()` and `isOverHeating()` are unchanged; the only consumer is `SocketManager.ts:261`. The extra export of the `CpuTracker` class is additive |
| Tests: unlimited, v1, v2, missing files, malformed, percentage | done: 14 tests, fake cgroup contents, synthetic clock |
| Verify: new tests, back typecheck, eslint, prettier on changed files | reproduced, see below |

## Checks rerun (containers I created, `node:24-trixie`, `--network none`, `--memory 3g`)

| Container | Command (from `/work/back`) | Exit | Result |
|---|---|---|---|
| `wa-fable-r2-cpu-review-1` (`--cpus 1`) | `npx vitest --run tests/CpuTracker.test.ts --reporter=verbose` | 0 | 14/14 passed |
| same | `npx prettier --check src/Services/CpuTracker.ts tests/CpuTracker.test.ts` | 0 | all formatted |
| same | `DEBUG= npx eslint src/Services/CpuTracker.ts tests/CpuTracker.test.ts` | 0 | no output |
| same | `npm run typecheck` (`tsc --noEmit`, whole back, tests included because `tsconfig.json` has no `include`) | 0 | no diagnostics |
| same | `npx vitest --run tests/CpuTracker.test.ts tests/GameRoom.test.ts tests/SessionAnalytics.test.ts tests/RoomManager.test.ts`, the author's README command #3 run exactly as written | **1** | 3 files fail at load with `process.exit unexpectedly called with "1"` from the environment validator, which needs `PLAY_URL`. This is not caused by the patch, see N1 |
| `wa-fable-r2-cpu-review-2` (`--cpus 1`) | the same 4 files with the `npm test` environment (`PLAY_URL=http://play.workadventure.localhost ADMIN_URL=`) | 0 | 4 files, 43/43 passed, matching the author's `run3.txt` |
| `wa-fable-r2-cpu-review-3` (`--cpus 0.65`) | real-cgroup probe, below | 0 | 1/1 passed |

## Mutation testing (in place in the remote tree, restored after each run, final hash verified)

Each mutant is a single literal replacement in `back/src/Services/CpuTracker.ts` made by `mutate.mjs`. The anchor
must match exactly once, otherwise the mutant is not applied. Every mutant failed the suite (exit 1).

| Mutant | Tests that failed |
|---|---|
| M1 the bug: `cpuCapacityCores` always returns 1 | overheat at 0.65 v2; overheat at 0.5 v1; not overheat at 60 % of 0.65 |
| M2 no `Math.min(1, …)` | one-core reference when the quota exceeds one core |
| M3 integer guard removed | `max` as unlimited; v2 malformed; v1 malformed; unlimited/missing/malformed tracker case |
| M4 v1 quota through abs (`-1` becomes `1`) | v1 `-1` as unlimited; unlimited/missing/malformed tracker case |
| M5 v1 read before v2 when both exist | prefer v2 over v1 |
| M6 v1 branch skipped | v1 when `cpu.max` is absent; overheat at 0.5 v1 |
| M7 default v1 period when the period file is missing | no quota when the files are missing |
| M8 v2 fields swapped | v2 quota as cores; prefer v2; overheat at 0.65 v2; not overheat at 60 %; quota above one core |
| M9 v1 arguments swapped | v1 quota as cores; v1 when `cpu.max` is absent; overheat at 0.5 v1 |
| M10 ns-to-ms divisor `1e3` | all 5 tracker tests |

Every one of the 14 tests is killed by at least one mutant. M1 reproduces the pre-patch one-core reference, so the
tracker tests fail on the bug and pass on the fix. This closes the author's note that the new file cannot run against
the old module.

## Real cgroup probe (goes beyond the author's open item 2)

In a container I created with `--cpus 0.65` on knc (Docker `CgroupVersion=2`, `Driver=systemd`, private cgroup
namespace: `/proc/self/cgroup` = `0::/`), `/sys/fs/cgroup/cpu.max` read `65000 100000`. A temporary vitest file,
copied into `back/tests` and then removed, spun the CPU for 3 s in 20 ms slices. It ran two trackers side by side:
`new CpuTracker()` with the default cgroup reading, and `new CpuTracker(1)` with the old reference. The quota-aware
tracker read 97-110 % and overheated; the one-core tracker read 63-72 % and never overheated. The cgroup's `cpu.stat`
showed `nr_throttled 51`, `throttled_usec 2181800`, so the process really was throttled. This is a synthetic spin,
not eight users on the real backend (`review-receipt3.txt`).

## Findings

### m1 (minor): silent fallback with no observability of the selected reference

`back/src/Services/CpuTracker.ts:78-85` (`readOptionalFile`) catches every error, including EACCES and EIO as well
as ENOENT, and returns `undefined`. Neither a malformed `cpu.max` nor the chosen capacity is ever logged. In those
cases the H16 defect returns (a sub-core container reads at most 65 %) with no signal: the absence of the
`CPU high threshold alert` log is exactly what W3 warned cannot be trusted. `docs/agent/error-handling.md` asks that
unexpected infrastructure failures be logged with context.

Fix: log one line at construction with the reference capacity and its source, for example
`CpuTracker: reference 0.65 core (cgroup v2 cpu.max)` or `… 1 core (no cgroup quota)`. In the catch, stay quiet for
`ENOENT` and log any other error through `asError`. The author already listed this as open item 5; it is a finding
because the fallback hides the very bug being fixed.

### m2 (minor): only the root cgroup path is read

`back/src/Services/CpuTracker.ts:4-6` reads `/sys/fs/cgroup/cpu.max` and `/sys/fs/cgroup/cpu/cpu.cfs_*` only. The
Docker v2 default (private namespace) is covered, and the probe above confirms it on knc. Two cases are missed:
cgroup v2 with `--cgroupns=host`, and a process under a systemd slice with `CPUQuota=`. In both, the quota sits at
`/sys/fs/cgroup/<path from /proc/self/cgroup "0::<path>">/cpu.max`, so the tracker silently falls back to one core.

Fix: resolve the v2 path from `/proc/self/cgroup` through the same injected reader, keep the root as the fallback,
and add one fake-file test. Without this, document the supported deployment shape. Author open item 4.

### N1 (nit): the README check #3 command is not reproducible as written

`round2/README.md`, Checks row 3, runs `npx vitest --run tests/CpuTracker.test.ts tests/GameRoom.test.ts …` without
the `PLAY_URL` environment that `back/package.json` `test` sets. Run as written, it exits 1 because the environment
validator calls `process.exit(1)`. With the `npm test` environment it passes 43/43. The author's run evidently had
the variable set. Fix the documented command, for example `npm test -- --run tests/CpuTracker.test.ts …`, or prefix
the variables.

### N2 (nit): the constructor accepts any capacity

`back/src/Services/CpuTracker.ts:91`: `new CpuTracker(0)`, `NaN` or a negative value gives an `Infinity` or `NaN`
percentage. Production always goes through `cpuCapacityCores`, which only yields values in (0, 1], and only tests
call the constructor with an argument. The W3 proposal had a `capacityCores <= 0` guard, which was dropped. Fix: keep
the parameter but validate it, or type it through `cpuCapacityCores`.

### N3 (nit): the test file exercises the module-level singleton as a side effect

Importing the module still constructs the real `cpuTracker`. It reads the real `/sys/fs/cgroup` and starts a real,
non-unref'd 100 ms interval, and its callback runs against the mocked `process.cpuUsage` and `process.hrtime` during
the tests. It is harmless today (the results are deterministic: 14/14 in three runs and every mutant run), but it is
hidden coupling. Optional: note it in the test header. No product change is required.

## Observations (not findings, outside the brief)

- The overheat flag has no hysteresis. With a sub-core quota it is now reachable, and near the threshold the
  `console.warn`/`console.info` pair can flap up to 10 times per second. This is the pre-existing shedding policy.
- The quota is read once at start (author open item 3); `docker update --cpus` needs a restart.
- `play/src/pusher/services/CpuTracker.ts` keeps the one-core loop. It does not gate movement (W3 README), so it is
  out of scope.
- Readings above 100 % (up to 110 % in the probe) come from `process.cpuUsage` counting all threads. This is
  pre-existing and matches the W3 analysis.

## Docs claims checked against the code

The README's description of the parsers, the precedence, `min(1, quota)`, the read-once behavior, the API and the
hashes matches the code. "Identical to before" for no, unlimited or malformed quota and for quotas of one core or more
holds: the arithmetic is the same and M1 shows the one-core path. Check #3's command differs from the run, see N1.

## Resources

I created containers `wa-fable-r2-cpu-review-1..3`, all with `--rm`. After the review,
`docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-r2-cpu-review` lists 0. I created the
remote dir `~/wa-jobs/wa-fable-20261112/review-cpu/` (scripts and receipts) and the scratch `/tmp/wa-r2/cpu-review/`.
No product file in the checkout was edited. I did not touch any production container or file.
