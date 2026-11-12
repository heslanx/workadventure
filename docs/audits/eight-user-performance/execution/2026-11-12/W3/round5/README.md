# W3 round 5, lane cpu: a cgroup mount root that is not an ancestor of the process

2026-11-12. The base is checkout HEAD `50632e874`, where `back/` is unchanged since `1f48d79d5`, with the round 3 and
round 4 patches applied in that order. The host is `knc` (Linux `6.8.0-147-generic`, cgroup v2) with the tree
`~/wa-jobs/wa-fable-20261112/src-cpu`. This round wrote no file of the checkout outside this folder.

## Why

WorkAdventure must scale toward 1,000 users and explain an eight-user freeze. The back server sheds movement when
`cpuTracker.isOverHeating()` is true, which is 80 % CPU measured against the container's CPU quota. A wrong quota either
hides throttling or sheds movement for nothing.

The cross-family verdict `docs/audits/performance-1000-users/execution/verdicts/cpu-round4-ancestors-evidence.md`
failed round 4 with finding C1 (major). When the process cgroup path is not below the mount root, `cgroupDirectories`
returned the mount point, and the mount point's `cpu.max` is not necessarily the quota of an ancestor of the process. With
mount root `/system.slice/other.service` and process path `/system.slice/wa.service`, the tracker read the quota of
`other.service` for `wa.service`. A quota that is too small inflates the CPU percentage and sheds movement without cause.

## What changed

One function in `back/src/Services/QuotaAwareCpuTracker.ts`, 11 lines added and 2 removed, 7 of them comment lines.
`/proc/self/cgroup` and the mount root in `/proc/self/mountinfo` are both rendered relative to the namespace root of the
reader (`../round4/README.md`, section "The kernel renders both paths from the same root"). `cgroupDirectories` now reads
this from the two paths.

| Mount root against the process path | Example | Directories read |
|---|---|---|
| The process path is below the root, including root `/` | root `/docker/abc`, process `/docker/abc/back` | The process cgroup up to the mount point. Unchanged. |
| The root only climbs, every component is `..` | root `/../..`, process `/` | The mount point. The mount's cgroup is an ancestor of the namespace root, so it is an ancestor of the process. The levels in between have no names, so only the mount point is known. |
| Any other root, a sibling or a climb that descends again | root `/system.slice/other.service` or `/../x`, process `/system.slice/wa.service` | None. The root names a cgroup that is not an ancestor of the process. |

Before, the second and third rows both read the mount point. `readCgroupCpuQuota`, the parsers, the threshold and the
`min(1, quota)` rule are unchanged. When no directory of a hierarchy is read, that hierarchy adds no quota, and the
capacity stays the one-core reference unless the other hierarchy has one.

## Patches

Apply them in this order. The first two are not in the checkout yet.

| Order | Patch | sha256 |
|---|---|---|
| 1 | `../round3/cpu-quota-ancestors.patch` | `f2bb4416f1431e43f34a6f8a2688305b14f93de5505e2f96cf4f71d971140a87` |
| 2 | `../round4/namespace-evidence.test.patch` | `b1b3416c4d7ccd2615b4e6c2d5285fefacbcad5406e00e2f126018acebbce239` |
| 3 | `cpu-mount-ancestry.patch` (product change and its tests, 80 lines) | `9d4b3eeb500c3b68e355d7aa81a69be77c910f79af57fa5564b462416bf4c252` |
| - | `cpu-mount-ancestry.pin-tests.patch` (the tests of patch 3 alone, 50 lines, not part of the stack) | `dd73351a442be0c1db23437d2fa90954791d092033761a3aa0b0ed9cc119985d` |

Patch 3 holds the fix and the tests together. The pin tests were run first, alone and against the round 3 and round 4
source, and failed (run 1). `cpu-mount-ancestry.pin-tests.patch` is that tests-only state, kept so a reviewer can
reproduce the red run. After patch 3 the two files have these git blobs: `QuotaAwareCpuTracker.ts` `213451aa1c54…`
(sha256 `bbe8044d019eaeadf38eee1e23fe2e0374f5200142bf7f921bcf819b04cba666`) and `CpuTracker.test.ts` `732e901d5d59…`
(sha256 `f03db9f12e215a8026a2b871cbedf294d599502d864977d90eaeab2add763e28`).

`apply-check.sh` builds a temporary index from HEAD with `GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` in a `mktemp`
directory and the checkout's objects as an alternate, then applies the three patches in order (`apply-check.txt`).

| Check | Exit | Result |
|---|---|---|
| Patch 3 on HEAD alone | 1 | `patch does not apply`, as expected for a stacked patch |
| Patches 1, 2, 3 in order, `--check` then apply | 0, 0, 0 | all apply |
| `cpu-mount-ancestry.pin-tests.patch` on the round 3 and round 4 state | 0 | applies |
| Blobs after the stack | - | `213451aa1c54…` and `732e901d5d59…`, equal to the blobs of the verified files |

## Tests

`back/tests/CpuTracker.test.ts` gains `describe("cgroup v2 mount roots outside the process path")` with four tests, so
41 tests in the file. Each test feeds fake `/proc/self/cgroup`, `/proc/self/mountinfo` and `cpu.max` content through the
injected reader and asserts the `readCpuCapacity` result, which is what the tracker reports at startup.

| Test | Layout | On round 3 and round 4 | On the fix |
|---|---|---|---|
| `should not read the quota of a mount rooted at a sibling of the process cgroup` (the verdict's layout) | process `/system.slice/wa.service`, root `/system.slice/other.service`, `0.2` at the mount point | fails | passes |
| `should not read the quota of a mount whose root climbs out of the namespace root and descends again` | same process, root `/../x`, `0.2` at the mount point | fails | passes |
| `should read the quota of a mount whose root only climbs out of the namespace root` (two cases, process `/` and process `/system.slice/wa.service`) | root `/../..`, `0.2` at the mount point, expects `0.2` and the mount point as source | passes | passes |

The two red results are real mismatches, not exceptions. For the verdict's layout the assertion diff in
`run1-pin-on-round3-round4-source.txt` is

    - Expected
    + Received

      {
    -   "cores": 1,
    -   "source": "no cgroup CPU quota, one-core reference",
    +   "cores": 0.2,
    +   "source": "cgroup v2 /sys/fs/cgroup/cpu.max (quota 0.2 cores)",
      }

The third test passes before and after on purpose. It keeps round 4 run 3 (pure ascent) reading the mount point, and it
is the only test that notices if the fix stops reading the mount point for a pure ascent (mutant C). The five observed
layouts and the derived test of round 4 pass unchanged.

## Checks

Each run used a fresh `--rm` container on `node:24-trixie` with `--cpus 0.5 --cpu-shares 512 --memory 1g --network none`
and `--label owner=wa-fable-20261112`, from `/work/back`. `checks.sh` bind-mounts, read-only, the final test file, the
fixed tracker where a run names it, and HEAD's versions of the four files that `f35d9b151` changed (the same set as
round 4). The knc tree is not written. The tree files are the round 3 state, so run 1 (no tracker override) is the round
3 and round 4 source with the new tests.

| Run | Command | Exit | Result | Receipt |
|---|---|---|---|---|
| 1 | `npx vitest --config vitest.config.ts --run tests/CpuTracker.test.ts --reporter=verbose`, round 3 and round 4 source | 1 | 2 failed, 39 passed (41). The two failures are the sibling and the mixed-ascent tests | `run1-pin-on-round3-round4-source.txt` |
| 2 | same command, fixed tracker | 0 | 41 passed (41) | `run2-fix-final-tests.txt` |
| 8 | `npx prettier --check` on `CpuTracker.ts`, `QuotaAwareCpuTracker.ts`, `CpuTracker.test.ts` | 0 | `All matched files use Prettier code style!` | `run8-prettier-check.txt` |
| 9 | `DEBUG= NODE_OPTIONS=--max-old-space-size=960 npx eslint` on the same three files | 0 | no output | `run9-eslint-heap960.txt` |
| 10 | `NODE_OPTIONS=--max-old-space-size=960 npm run typecheck` | 0 | `tsc --noEmit`, no diagnostics | `run10-typecheck-heap960.txt` |
| 11 | `npm test -- --run`, the whole back suite | 0 | 29 files, 362 passed and 2 skipped (364). Round 4 had 358 and 2 skipped, so the 4 new tests are the difference | `run11-back-whole-suite.txt` |

The heap option is the one round 4 needed, because the default V8 heap is too small under a 1 GiB container limit.
Prettier made no change to the new test file (a `prettier --write` pass in container `wa-fable-cpu5-p` left it
unchanged).

## Mutants

Each mutant replaces `QuotaAwareCpuTracker.ts` through a read-only bind mount, with the final test file. Each diff is
against the fixed tracker.

| Mutant | Change | Result | Receipt |
|---|---|---|---|
| A, the round 3 behavior | a root outside the process path always returns the mount point (`mutantA-always-mount-point.diff`) | killed, 2 failed and 39 passed. The sibling and the mixed-ascent tests fail | `run3-mutantA-always-mount-point.txt` |
| B | mixed ascent is treated like pure ascent, the test is `rootParts[0] === ".."` (`mutantB-mixed-like-pure-ascent.diff`) | killed, 1 failed and 40 passed. The mixed-ascent test fails | `run4-mutantB-mixed-like-pure-ascent.txt` |
| C, added | a pure ascent reads nothing (`mutantC-pure-ascent-ignored.diff`) | killed, 2 failed and 39 passed. Both cases of the pure-ascent test fail | `run5-mutantC-pure-ascent-ignored.txt` |
| D, round 4 mutant A on the new code | a pure ascent walks the process path under the mount point (`mutantD-join-outside-root.diff`) | killed, 1 failed and 40 passed. `should not read the host cgroup that has the process path when the mount root is above the namespace root` fails | `run6-mutantD-join-outside-root.txt` |
| E, round 4 mutant B | `parseCgroupMount` takes the last matching mount (`mutantE-last-mount.diff`) | killed, 1 failed and 40 passed. `should resolve a private cgroup namespace with the host cgroupfs bound at /host-cgroup` fails | `run7-mutantE-last-mount.txt` |

A and B are the two the brief asked for. C, D and E check that the new branches do not loosen what rounds 3 and 4 pinned.

## Real probes with the fixed tracker

The five layouts of round 4 were run again on real files, one container at a time at `--cpus 0.5`, with the fixed tracker
bind-mounted. `probe.sh` and `WaFableCpu5Probe.test.ts` are round 4's probe, pointed at the round 5 folder. Every result is
the same as in round 4, so the fix changes no observed outcome. The true quota was `HostConfig.NanoCpus` `500000000` and
the host `cpu.max` `50000 100000` in every run.

| Probe | Layout | Mount root | Tracker resolves | Receipt |
|---|---|---|---|---|
| 1 | private cgroupns (Docker default) | `/` | 0.5 from `/sys/fs/cgroup/cpu.max` | `probe1-private-cgroupns.txt` |
| 2 | `--cgroupns host` | `/` | 0.5 from the scope's `cpu.max` | `probe2-cgroupns-host.txt` |
| 3 | private cgroupns, host cgroupfs bound over `/sys/fs/cgroup` | `/../..` | one-core reference. The mount point is the host root and has no `cpu.max` | `probe3-private-bind-host-cgroupfs-over-default.txt` |
| 4 | private cgroupns, host cgroupfs bound at `/host-cgroup` | `/` and `/../..` | 0.5 from `/sys/fs/cgroup/cpu.max` | `probe4-private-bind-host-cgroupfs-elsewhere.txt` |
| 5 | `--cgroupns host`, host cgroupfs bound over `/sys/fs/cgroup` | `/` | 0.5 from the scope's `cpu.max` | `probe5-cgroupns-host-bind-host-cgroupfs-over-default.txt` |

Probe 3 is the pure-ascent layout. It still reads the mount point, as the table above says. It reports the one-core
reference because no `cpu.max` exists there, which is round 4's known limit and is unchanged.

## Open

1. No real layout renders a named mount root that excludes the process path. Round 4 observed only `/` and `/../..`. The
   sibling and mixed cases are covered by fake layouts built from the kernel's rendering rule, not by a real probe. A
   nested `unshare --cgroup` would produce the pure ascent, and it needs `CAP_SYS_ADMIN`, which the brief rules out.
2. When `/proc/self/cgroup` has no usable path for the hierarchy, `readCgroupCpuQuota` uses the mount root as the process
   path (`hierarchy.processPath(procSelfCgroup) ?? mount.root`). `cgroupDirectories` then finds the process path equal to
   the root and reads the mount point, whatever the root is. This happens when the file has no entry, or when the path
   contains `..` (for example `0::/../x`, a process outside its namespace subtree, which `plainAbsolutePath` rejects). It
   is not finding C1, the patch leaves it as it is, and no probed layout reaches it. A change that reads the mount point
   in that case only when the root is `/` would close it, at the cost of round 3's fallback when mountinfo is present and
   the process path is missing.
3. cgroup v1 was not probed because knc is cgroup v2. The kernel citation of round 4 covers v1, which uses the same
   `cgroup_show_path`, and the fix is shared by both hierarchies.
4. Carried over from rounds 3 and 4. The quota is read once at start, read failures go to `console.warn`, and
   `play/src/pusher/services/CpuTracker.ts` is unchanged.
5. The round 3 README says that a path outside the mount root reads only the mount point. That sentence is outdated once
   this patch lands.

## Resources

Containers `wa-fable-cpu5-1` to `wa-fable-cpu5-11`, `wa-fable-cpu5-p` and `wa-fable-cpu5-probe1` to
`wa-fable-cpu5-probe5` ran with `--rm`, one at a time, at `--cpus 0.5`, between 03:34 and 03:41 UTC, before the 03:55 UTC
benchmark limit. `docker ps -a --filter name=wa-fable-cpu5` lists 0 afterwards. The container `wa-fable-ci3` belongs to
another lane and was not touched.

No file of the knc tree was written. The tree files still hash to the round 3 values (`QuotaAwareCpuTracker.ts`
`4ab1585d…eb99`, `CpuTracker.ts` `ba63e453…5ee9`, `CpuTracker.test.ts` `7c37b558…142a`), no `._*` file remains, and no file
outside `node_modules` is newer than `checks.sh`. The probe test was mounted over the existing `tests/CpuTracker.test.ts`
path, so no placeholder file was created. Remote receipts and the staged files are in
`~/wa-jobs/wa-fable-20261112/receipts-cpu-r5/` on knc. The scratch repo and the staging folder on the Mac were deleted.
