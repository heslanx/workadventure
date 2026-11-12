# W3 round 3, lane cpu: effective cgroup CPU quota over ancestors and the real v1 mount

2026-11-12. Base: checkout HEAD `80b523ea8` (the three tracker files are those of `30fc109fc`). Host `knc`, tree
`~/wa-jobs/wa-fable-20261112/src-cpu` (Node 24, `npm ci` done). No product file of the checkout was edited.

Deliverable: `cpu-quota-ancestors.patch` (364 lines, sha256 `f2bb4416…0a87`). It applies to the checkout on its own
(`git -C <checkout> apply --check cpu-quota-ancestors.patch`, exit 0). It is `git diff` from the scratch repo
`/tmp/wa-cpu-r3/`, whose history is base (HEAD originals) → tests → fix. `tests-only.patch` is the tests commit alone.

## Why

WorkAdventure must scale toward 1,000 users, and eight people in one room must not freeze. Movement shedding in
`SocketManager.handleUserMovesMessage` engages when `cpuTracker.isOverHeating()` is true (CPU above 80 %). Commit
`30fc109fc` made the tracker measure CPU against the container quota so shedding can trigger under a sub-core cap. The
cross-family review (`docs/audits/performance-1000-users/execution/verdicts/30fc109fc.md`) found two majors where the
quota is missed and the tracker falls back to a one-core reference, so a backend capped at 0.5 core reads at most 50 %
and never sheds:

- F1. cgroup v2 read only the process cgroup's `cpu.max`, then the root, and stopped at the process file even when it
  said `max`. A limit on a parent cgroup was missed.
- F2. cgroup v1 read only `/sys/fs/cgroup/cpu/cpu.cfs_quota_us`. A quota on the process's nested cgroup, or a cpu
  controller mounted elsewhere (for example `cpu,cpuacct` without the `cpu` symlink), was missed.

## What changed

Only `back/src/Services/QuotaAwareCpuTracker.ts` and `back/tests/CpuTracker.test.ts`. `CpuTracker.ts` and the
`cpuTracker` singleton API are unchanged. Threshold, interval, percentage formula and `min(1, quota)` are unchanged.

The effective quota is now the tightest quota over the process cgroup and every ancestor up to the mounted root, in the
cgroup v2 hierarchy and in the cgroup v1 hierarchy that holds the cpu controller.

- Pure parsers (new): `parseCgroupV1CpuPath` reads the `/proc/self/cgroup` entry whose controller list contains `cpu`
  (exact item, so `cpuset` does not match). `parseCgroupMount(mountinfo, "v1" | "v2")` reads `/proc/self/mountinfo` and
  returns `{ root, mountPoint }` of the `cgroup2` mount, or of the `cgroup` mount whose super options contain `cpu`.
  Octal escapes such as `\040` are decoded. `parseCgroupV2Path` keeps its behavior and shares the path check.
- `cgroupDirectories(mount, cgroupPath)` maps the process cgroup path, relative to the mount root, to directories under
  the mount point, from the process cgroup up to the mount point. A path outside the mount root leaves only the mount
  point, which is what HEAD read.
- `CGROUP_HIERARCHIES` is a two-entry table (v2, v1). Each entry has a default mount point (`/sys/fs/cgroup`,
  `/sys/fs/cgroup/cpu`, used when mountinfo is unreadable or lists no such mount), its `/proc/self/cgroup` parser and its
  quota reader for one directory.
- `readCgroupCpuQuota` reads `/proc/self/cgroup` and `/proc/self/mountinfo` once through the injected reader, collects
  every limited quota from both hierarchies, and returns the smallest one with its file as the source. `max`, `-1` and
  missing files impose no limit. Malformed files are still warned once with their path and ignored, so the other levels
  still count.
- Boundary unchanged. All file reads go through `ReadOptionalFile` (`readOptionalFile` in production). With nothing
  found the capacity is still one core. The constructor still logs one `console.info` line at startup, and its source now
  names the file that set the limit, for example
  `cgroup v2 /sys/fs/cgroup/system.slice/cpu.max (quota 0.5 cores)`.

Semantic note. HEAD preferred v2 and read v1 only when no v2 `cpu.max` existed. Now both hierarchies contribute and
the smallest wins. The kernel binds the cpu controller to one hierarchy, so in a real system only one of them has quota
files. The existing test `should prefer cgroup v2 over cgroup v1` (v2 0.65, v1 2) stays green.

## Tests

9 new tests (31 in the file). Each fake layout goes through the injected reader.

| Test | Layout | HEAD result |
|---|---|---|
| `should take the tightest cpu.max over the process cgroup and its ancestors` (F1) | `0::/system.slice/wa.service`; leaf `max`, parent `system.slice` 0.5, root `max`. Expects 0.5 and the parent file as source. Second case: leaf 0.3 under parent 0.5 expects 0.3 | `expected undefined to be 0.5` |
| `should overheat when a parent cgroup caps the process at 0.5 core` (F1, consumer view) | same, process uses 0.5 core | `expected 50 to be 100` |
| `should take the tightest cgroup v1 quota over the process cgroup and its ancestors` (F2 nested) | `4:cpu,cpuacct:/workers/back`; leaf 0.8, `/workers` 0.5, root `-1` | `expected undefined to be 0.5` |
| `should find the cgroup v1 cpu controller through /proc/self/mountinfo when it is mounted elsewhere` (F2 mount) | Docker-on-v1 mountinfo, cpu at `/sys/fs/cgroup/cpu,cpuacct` rooted at `/docker/abc`, no `cpu` symlink | `expected undefined to be 0.5` |
| `should map a cgroup v1 path below the mount root to the directory under the mount point` (F2 mount root) | process `/docker/abc/back`, mount root `/docker/abc`, `back` 0.5, mount point `-1` | `expected undefined to be 0.5` |
| `parseCgroupV1CpuPath` (2), `parseCgroupMount` (2) | parser cases: cpuset and `name=systemd` skipped, `..` rejected, `\040` decoded | `is not a function` (new exports) |

The 22 tests of HEAD pass unchanged.

## Checks (each in a fresh `--rm` container `wa-fable-cpu3-<n>`, `--label owner=wa-fable-20261112 --cpu-shares 512 --memory 3g --network none`, `node:24-trixie`, from `/work/back`)

| # | Command | Exit | Result | Receipt |
|---|---|---|---|---|
| 1 | HEAD source + new tests, `npx vitest --config vitest.config.ts --run tests/CpuTracker.test.ts` (`--cpus 1`) | 1 | 9 failed, 22 passed (31). Test file before prettier rewrapped one line | `run1-head-src-new-tests.txt` |
| 3 | Same with the final test file, HEAD `QuotaAwareCpuTracker.ts` (sha256 `9c8eb7aa…`) bind-mounted read-only over the fix (`--cpus 1`) | 1 | 9 failed, 22 passed (31). The 5 layout tests fail on assertions, the 4 parser tests on missing exports | `run3-head-src-final-tests.txt` |
| 2 | `npx prettier --check` on the 3 files | 0 | all formatted (after one `prettier --write`, pulled back to the scratch repo before the diff) | `run2-fix-checks.txt` |
| 2 | `DEBUG= npx eslint` on the 3 files | 0 | no output | `run2-fix-checks.txt` |
| 2 | `npx vitest --config vitest.config.ts --run tests/CpuTracker.test.ts --reporter=verbose` | 0 | 31/31 passed | `run2-fix-checks.txt` |
| 2 | `npm run typecheck` (`tsc --noEmit`, whole back project) | 0 | no diagnostics | `run2-fix-checks.txt` |
| 2 | `PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest --run tests/CpuTracker.test.ts tests/GameRoom.test.ts tests/SessionAnalytics.test.ts tests/RoomManager.test.ts` | 0 | 4 files, 60/60 passed (31 + 29 consumer) | `run2-fix-checks.txt` |
| 4 | Real cgroup, `--cpus 0.5`, private cgroup namespace (default). Probe `WaFableCpu3Probe.test.ts` | 0 | capacity 0.5, source `cgroup v2 /sys/fs/cgroup/cpu.max (quota 0.5 cores)` | `run4-real-cpus-0.5.txt` |
| 5 | Real cgroup, `--cpus 0.5 --cgroupns host`. Same probe | 0 | capacity 0.5, source `cgroup v2 /sys/fs/cgroup/system.slice/docker-89dec98b….scope/cpu.max (quota 0.5 cores)` | `run5-real-cpus-0.5-cgroupns-host.txt` |
| - | `git -C <checkout> apply --check cpu-quota-ancestors.patch` (Mac, read-only) | 0 | applies | - |

The three files on `knc` and in the scratch repo are identical: `CpuTracker.ts` `ba63e453…5ee9` (unchanged),
`QuotaAwareCpuTracker.ts` `4ab1585d…eb99`, `CpuTracker.test.ts` `7c37b558…142a`.

### Real readings at `--cpus 0.5`

The probe calls `readCpuCapacity(readOptionalFile)` on the real files, builds `new CpuTracker()` (which prints the
startup line), then spins in 15 rounds of 100 ms and samples the percentage.

- Run 4. `/proc/self/cgroup` is `0::/`, mountinfo lists `cgroup2` at `/sys/fs/cgroup` with root `/`, `cpu.max` is
  `50000 100000`. Startup line: `CPU tracker: percentages are relative to 0.5 core(s), from cgroup v2
  /sys/fs/cgroup/cpu.max (quota 0.5 cores)`. Samples: `108! 94! 107! 74 128! 103! 102! 55 118! 123! 87! 83! 124! 103!
  82!` (`!` is overheating). `cpu.stat` shows `nr_throttled 46`.
- Run 5. `/proc/self/cgroup` is `0::/system.slice/docker-89dec98b….scope`. The walk reads the scope (`50000 100000`),
  `system.slice` (`max 100000`) and the root (no `cpu.max`), and picks the scope. This is a real nested v2 path through
  the new ancestor walk. Samples: `78 105! 97! 104! 102! 98! 97! 109! 100! 89! 96! 118! 94! 99! 107!`. Its `cpu.stat`
  line is the host root's, so its 0 throttling count says nothing about the container.

Explanation of the spread (inferred). The sampling window and the CFS period are both 100 ms and not aligned, so one
window can hold more or less than one period of quota. The samples centre on 100 % of the 0.5-core capacity, and a
one-core reference would centre on 50 %. The round-2 reviewer measured the one-core reference at 63-72 % under
`--cpus 0.65` (`../round2/review-receipt3.txt`).

## Resources

Containers `wa-fable-cpu3-1..6` ran with `--rm`. Afterwards `docker ps -a --filter name=wa-fable-cpu3` lists 0. The
probe test was copied into `src-cpu/back/tests/` for runs 4-5 and removed afterwards. `._*` files under `src-cpu/back`
were deleted before each run. Remote receipts, the HEAD source copy, the probe and the patch are in
`~/wa-jobs/wa-fable-20261112/receipts-cpu-r3/`. The `src-cpu` tree now holds the round-3 fix as the verified state (not
HEAD). Nothing else on `knc` was touched.

## Open

1. A parent-limited cgroup and a v1 host were not reproduced for real. Creating a CPU-limited parent slice needs host
   systemd configuration on a production host, and `knc` is cgroup v2. F1 and F2 are covered by fake layouts. The real
   runs cover the v2 mountinfo path and the nested v2 walk.
2. When several mounts hold the same hierarchy, the first one in mountinfo is used. A cgroup path outside its root reads
   only the mount point, as HEAD did. No such layout was observed.
3. Carried over from round 2. The quota is read once at start (a live `docker update --cpus` is not followed). Read
   failures and malformed content go to `console.warn`, not Sentry. `play/src/pusher/services/CpuTracker.ts` is not
   changed. Only changed files and consumer tests were run, not the full back suite or `npm run lint` over `src/`.
