# W3 round 6, lane cpu: process and mount paths that climb out of the namespace root

2026-11-12. The base is checkout HEAD `50632e874`, where `back/` is unchanged since `1f48d79d5`, with the round 3, round 4
and round 5 patches applied in that order. The host is `knc` (Linux `6.8.0-147-generic`, cgroup v2) with the tree
`~/wa-jobs/wa-fable-20261112/src-cpu`. This round wrote no file of the checkout outside this folder.

## Why

WorkAdventure must scale toward 1,000 users and explain an eight-user freeze. The back server sheds movement when
`cpuTracker.isOverHeating()` is true, which is 80 % CPU measured against the container's CPU quota. A wrong quota either
hides throttling or sheds movement for nothing. When the quota cannot be known, the one-core reference is the honest
fallback. A quota read from a cgroup that is not an ancestor of the process is never acceptable.

Round 5 left one hole (`../round5/README.md`, open item 2). When `/proc/self/cgroup` holds a path with `..`, for example
`0::/../x` for a process moved outside its namespace root, `plainAbsolutePath` rejected the path and
`readCgroupCpuQuota` used the mount root in its place (`hierarchy.processPath(procSelfCgroup) ?? mount.root`).
`cgroupDirectories` then found the process path equal to the root and read the mount point, whichever mount that was.
That mount point need not be an ancestor of the process.

## What changed

`back/src/Services/QuotaAwareCpuTracker.ts` gains 48 lines and loses 30, 20 of the added lines being comments. The
parsers, the quota readers, the threshold and the `min(1, quota)` rule are unchanged apart from what this section lists.

`/proc/self/cgroup` and the mount root in `/proc/self/mountinfo` are both rendered relative to the namespace root of the
reader, with one `/..` for each level above it (`../round4/README.md`, section "The kernel renders both paths from the
same root"). `parseCgroupPath` reads each path as an ascent count and the names that follow it. Write the mount root as
(a, R) and the process path as (b, P). The mount point is the cgroup "up a levels, then down R". The process is "up b
levels, then down P". `cgroupDirectories` applies this table.

| Layout | Example | Directories read |
|---|---|---|
| a = b and R is a prefix of P | root `/docker/abc`, process `/docker/abc/back`. Also root `/..`, process `/../x`. | The process cgroup up to the mount point, found by walking down `P[len(R):]` from the mount point. a = b = 0 is the case of rounds 3 to 5. |
| a > b and R is empty | root `/../..`, process `/` or `/../x` | The mount point only. The levels between the mount and the process have no names. b = 0 is round 5's pure ascent. |
| Anything else | a < b. a > b with R non-empty. a = b with R not a prefix of P. A `..` after a name in either path. A path that is not absolute. | None. |

Before, the first two rows worked only for b = 0, and every other layout with a `..` in the process path read the mount
point through the mount-root substitution.

Other edits in the same function family.

- `parseCgroupV2Path` and `parseCgroupV1CpuPath` return the path text of the entry as the file renders it, or
  `undefined` when there is no entry. `plainAbsolutePath` is gone. `parseCgroupPath` decides whether a path is readable.
- `cgroupDirectories` returns no directory when either path is unreadable.
- `readCgroupCpuQuota` no longer substitutes the mount root. A process path that cannot be read yields no directory.

### Two decisions the rule does not cover

1. **A missing entry.** When `/proc/self/cgroup` has no entry for the hierarchy, `readCgroupCpuQuota` now takes the
   process to be at the namespace root (`?? "/"`), where it took the mount root before. Existing tests give no
   `/proc/self/cgroup` and expect the quota at the default mount point (`/sys/fs/cgroup/cpu.max` for v2, the
   `cpu.cfs_quota_us` files for v1). With a missing entry treated as unreadable, 6 of them fail
   (`run12-alt-missing-entry-yields-no-directory.txt`, `altE-missing-entry-yields-no-directory.diff`). With
   the namespace root as the process path, a mount rooted at `/` still reads its mount point, and a mount rooted at a
   named cgroup reads nothing. Round 5 read the mount point in both cases.
2. **Two existing tests changed.** `parseCgroupV2Path` and `parseCgroupV1CpuPath` no longer reject `..`, because the
   rule makes `/../x` readable. Each test "should reject a missing entry or a path that is not plain absolute" became two
   tests. The assertions `parseCgroupV2Path("0::/../../escape\n")` and `parseCgroupV1CpuPath("4:cpu,cpuacct:/../escape\n")`
   were `toBeUndefined()` and are now `toBe("/../../escape")` and `toBe("/../escape")`. The assertion
   `parseCgroupV2Path("0::relative\n")` is gone from the parser tests. The unreadable-path tests below cover it through
   `readCpuCapacity`, where the decision now lives. The other 39 tests of the file are unchanged, and the two helper
   constants `WA_SERVICE` and `mountRootedAt` moved from round 5's `describe` to the top of the file so the new `describe`
   can use them.

## Patches

Apply them in this order. The first three are not in the checkout yet.

| Order | Patch | sha256 |
|---|---|---|
| 1 | `../round3/cpu-quota-ancestors.patch` | `f2bb4416f1431e43f34a6f8a2688305b14f93de5505e2f96cf4f71d971140a87` |
| 2 | `../round4/namespace-evidence.test.patch` | `b1b3416c4d7ccd2615b4e6c2d5285fefacbcad5406e00e2f126018acebbce239` |
| 3 | `../round5/cpu-mount-ancestry.patch` | `9d4b3eeb500c3b68e355d7aa81a69be77c910f79af57fa5564b462416bf4c252` |
| 4 | `cpu-ascent-paths.patch` (product change and its tests, 291 lines) | `65581226f9fae23f383f2eb30c922fc0a7c445744da52b27fc228566fa873a45` |
| - | `cpu-ascent-paths.pin-tests.patch` (the tests of patch 4 alone, 167 lines, not part of the stack) | `980348a99a30dc30eefcbfbbfed24094f16929ff7e645ca9ee6f4fad15acd343` |

Patch 4 holds the fix and its tests together. `cpu-ascent-paths.pin-tests.patch` is the tests-only state on the round 3,
4 and 5 source, kept so a reviewer can reproduce the red run (run 1). After patch 4 the two files have these git blobs
and hashes.

| File | git blob | sha256 |
|---|---|---|
| `back/src/Services/QuotaAwareCpuTracker.ts` | `5c1f03fd5969…` | `9b79bf6ab046e41ff399bcc91881fecc3ac318ceeb1091850f7086d48d28dbca` |
| `back/tests/CpuTracker.test.ts` | `9955ded57f90…` | `c17f59319133788f390a85ca9565a374516df34c35a24f8ab00335077e43c3c4` |

`apply-check.sh` builds a temporary index from HEAD with `GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` in a `mktemp`
directory under `/tmp`, with the checkout's objects as an alternate, then applies the patches (`apply-check.txt`).

| Check | Exit | Result |
|---|---|---|
| Patch 4 on HEAD alone | 1 | `patch does not apply`, as expected for a stacked patch |
| Patch 4 on patches 1 and 2, without 3 | 1 | `patch does not apply`, as expected |
| Patches 1, 2, 3, 4 in order, `--check` then apply | 0, 0, 0, 0 | all apply |
| `cpu-ascent-paths.pin-tests.patch` on the round 3, 4 and 5 state | 0 | applies |
| Blobs after the stack | - | `5c1f03fd5969…` and `9955ded57f90…`, equal to the blobs of the tested files |

## Tests

`back/tests/CpuTracker.test.ts` has 55 tests, 14 more than round 5. The new `describe("cgroup paths that climb out of
the namespace root")` has 12 of them, and the two parser tests above add two. Each new test feeds fake
`/proc/self/cgroup`, `/proc/self/mountinfo` and quota files through the injected reader and asserts the `readCpuCapacity`
result, which is what the tracker reports at startup. Run 1 is the whole new test file against the round 3, 4 and 5
tracker. It has 10 failures and 45 passes.

| Test | Layout, as (a, R) and (b, P) | On rounds 3 to 5 | On the fix |
|---|---|---|---|
| `should not read the mount point for a process outside the namespace root` (brief's pin 1) | mount `/` (0, []), process `/../x` (1, [x]), `0.2` at the mount point | fails, reads 0.2 | one-core reference |
| `should walk down from a mount rooted at the level the process climbed to`, process quota `20000 100000` (brief's pin 2) | mount `/..` (1, []), process `/../x` (1, [x]), `0.5` at the mount point, `0.2` at `<mount>/x` | fails, reads 0.5 | 0.2 from `<mount>/x/cpu.max` |
| same, process quota `max 100000` | same, `max` at `<mount>/x` | passes, 0.5 | 0.5 from the mount point |
| `should read the mount point of a mount rooted above the level the process climbed to` (brief's pin 3) | mount `/../..` (2, []), process `/../x` (1, [x]), `0.2` at the mount point | passes, 0.2 | 0.2 from the mount point |
| `should not read the mount point of a mount rooted at a sibling at the same level` | mount `/../y` (1, [y]), process `/../x` (1, [x]) | fails, reads 0.2 | one-core reference |
| `should not read the mount point of a mount rooted at a named level above the process` | mount `/../y` (1, [y]), process `/y` (0, [y]) | passes, one-core | one-core reference |
| `should not read the mount point when the process path cannot be read`, three cases `/system.slice/../x`, `/../system.slice/../x` and `relative` | mount `/` | fails, reads 0.2 (all three) | one-core reference |
| `should not read the mount point when the mount root cannot be read` | mount `/system.slice/../x`, process `/system.slice/wa.service` | passes, one-core | one-core reference |
| `should not read a mount rooted at a named cgroup when the file has no entry for the process` | mount `/system.slice/other.service`, no `/proc/self/cgroup` | fails, reads 0.2 | one-core reference |
| `should walk down below a cgroup v1 mount rooted at the level the process climbed to` | v1 mount `/..`, process `4:cpu,cpuacct:/../x`, `0.5` at the mount point, `0.2` at `<mount>/x` | fails, reads 0.5 | 0.2 from `<mount>/x/cpu.cfs_quota_us` |
| `should keep a path that climbs out of the namespace root as the file renders it` (v2 and v1) | parser contract | fails, `undefined` | the path text |

Brief's pin 3 passes on rounds 3 to 5 as well, and by accident. The old code could not read `/../x`, took the mount root
`/../..` as the process path, found it below itself and read the mount point. The new rule reads the same directory for a
different reason. The test keeps that result, and only mutant F (below) fails on it. Pins 1 and 2 fail first, as the
brief required.

The other 39 tests that rounds 3 to 5 produced pass on the fix. They include the five observed layouts of round 4, its
derived test, and the sibling and mixed cases of round 5.

## Checks

Each run used a fresh `--rm` container on `node:24-trixie` with `--cpus 0.5 --cpu-shares 512 --memory 1g --network none`
and `--label owner=wa-fable-20261112`, from `/work/back`. `checks.sh` bind-mounts, read-only, the final test file, the
tracker under test, and HEAD's versions of the four files that `f35d9b151` changed (the same set as rounds 4 and 5). The
knc tree is not written. Run 1 mounts the round 5 tracker (`QuotaAwareCpuTracker.r5.ts`, sha256 `bbe8044d019e…`, the
verified file of round 5), so it is the round 3, 4 and 5 source with the new tests. `fmt.sh` ran `prettier --write` once
on the test file before the runs. It reflowed one `it.each` call, and the tracker was already formatted.

| Run | Command | Exit | Result | Receipt |
|---|---|---|---|---|
| 1 | `npx vitest --config vitest.config.ts --run tests/CpuTracker.test.ts --reporter=verbose`, round 5 tracker | 1 | 10 failed, 45 passed (55). The failures are the rows marked "fails" above | `run1-pins-on-round3-round4-round5-source.txt` |
| 2 | same command, fixed tracker | 0 | 55 passed (55) | `run2-fix-final-tests.txt` |
| 8 | `npx prettier --check` on `CpuTracker.ts`, `QuotaAwareCpuTracker.ts`, `CpuTracker.test.ts` | 0 | `All matched files use Prettier code style!` | `run8-prettier-check.txt` |
| 9 | `DEBUG= NODE_OPTIONS=--max-old-space-size=960 npx eslint` on the same three files | 0 | no output | `run9-eslint-heap960.txt` |
| 10 | `NODE_OPTIONS=--max-old-space-size=960 npm run typecheck` | 0 | `tsc --noEmit`, no diagnostics | `run10-typecheck-heap960.txt` |
| 11 | `npm test -- --run`, the whole back suite | 0 | 29 files, 376 passed and 2 skipped (378). Round 5 had 362 and 2 skipped, and the 14 new tests are the difference | `run11-back-whole-suite.txt` |

The heap option is the one rounds 4 and 5 needed, because the default V8 heap is too small under a 1 GiB container limit.
Runs 3 to 7, 12 and 13 are the mutants and the alternative design below.

## Mutants

Each mutant changes the fixed tracker in one line (`mutant*.diff`) and runs the final test file (runs 3 to 7 and 13).
Mutants A, B and C are the three the brief asked for, A being split in two because the old substitution had two places.
D and F check that the new branches do not loosen or narrow the rule. Row E is not a mutant. It is the alternative
design that decision 1 above rejects.

| Mutant | Change | Result | Failing tests | Receipt |
|---|---|---|---|---|
| A1, old substitution for an unreadable process path | `parseCgroupPath(processPath) ?? root` | killed, 3 failed and 52 passed | the three unreadable-path cases | `run3-mutantA1-unreadable-process-uses-mount-root.txt` |
| A2, old substitution for a missing entry | `processPath(...) ?? mount.root` | killed, 1 failed and 54 passed | `should not read a mount rooted at a named cgroup when the file has no entry for the process` | `run4-mutantA2-missing-entry-uses-mount-root.txt` |
| B, a > b with R non-empty is an ancestor | the ascent branch drops `root.names.length === 0` | killed, 2 failed and 53 passed | round 5's `a mount whose root climbs out of the namespace root and descends again`, and `a named level above the process` | `run5-mutantB-ascent-with-named-root-is-ancestor.txt` |
| C, a = b without the prefix check | the walk-down branch drops the `every` test | killed, 3 failed and 52 passed | round 5's sibling test, `a sibling at the same level`, and the missing-entry test | `run6-mutantC-same-ascent-without-prefix-check.txt` |
| D, a < b walked | `root.ascent <= own.ascent` in the walk-down branch | killed, 1 failed and 54 passed | `should not read the mount point for a process outside the namespace root` | `run7-mutantD-lower-ascent-is-walked.txt` |
| F, the ascent only from the namespace root | the ascent branch adds `own.ascent === 0`, which is round 5's rule | killed, 1 failed and 54 passed | `should read the mount point of a mount rooted above the level the process climbed to` | `run13-mutantF-ascent-only-from-the-namespace-root.txt` |
| E, alternative design | a missing entry yields no directory (`?? "relative"`) | 6 existing tests fail, 49 pass | `should prefer cgroup v2 over cgroup v1`, `should read cgroup v1 when cpu.max is absent`, `should warn about malformed content but not about an unlimited quota`, and three `getCpuPercent and isOverHeating` tests | `run12-alt-missing-entry-yields-no-directory.txt` |

## Real probes with the fixed tracker

The five layouts of round 4 ran again on real files, one container at a time at `--cpus 0.5`, with the fixed tracker
bind-mounted. `probe.sh` and `WaFableCpu6Probe.test.ts` are round 5's probe, pointed at the round 6 folder. Every result
is the same as in rounds 4 and 5, so the fix changes no observed outcome. In every run `HostConfig.NanoCpus` was
`500000000` and the host `cpu.max` of the container scope was `50000 100000`.

| Probe | Layout | Mount root | Process path | Tracker resolves | Receipt |
|---|---|---|---|---|---|
| 1 | private cgroupns (Docker default) | `/` | `/` | 0.5 from `/sys/fs/cgroup/cpu.max` | `probe1-private-cgroupns.txt` |
| 2 | `--cgroupns host` | `/` | the scope | 0.5 from the scope's `cpu.max` | `probe2-cgroupns-host.txt` |
| 3 | private cgroupns, host cgroupfs bound over `/sys/fs/cgroup` | `/../..` | `/` | one-core reference. The mount point is the host root and has no `cpu.max` | `probe3-private-bind-host-cgroupfs-over-default.txt` |
| 4 | private cgroupns, host cgroupfs bound at `/host-cgroup` | `/` and `/../..` | `/` | 0.5 from `/sys/fs/cgroup/cpu.max` | `probe4-private-bind-host-cgroupfs-elsewhere.txt` |
| 5 | `--cgroupns host`, host cgroupfs bound over `/sys/fs/cgroup` | `/` | the scope | 0.5 from the scope's `cpu.max` | `probe5-cgroupns-host-bind-host-cgroupfs-over-default.txt` |

Probe 3 is the pure ascent (a = 2 > b = 0, R empty). It reads the mount point, as the rule says, and reports the one-core
reference because no `cpu.max` exists there. This is round 4's known limit and is unchanged.

## Open

1. No real layout renders a process path with `..` or a named mount root. Round 4 observed only `/` and `/../..`. Every
   new layout is a fake one built from the kernel's rendering rule, as in round 5. A nested `unshare --cgroup` would
   produce them, and it needs `CAP_SYS_ADMIN`, which the brief rules out.
2. A missing entry in `/proc/self/cgroup` still reads a mount rooted at `/`, by decision 1. This is the one case where
   a mount point is read without a process path. Six existing tests pin the defaults for a host that has no
   `/proc/self/cgroup` and no mountinfo. The claim that a hierarchy with no entry has no process in it, so that nothing
   else can apply, is inferred from the kernel rule and was not probed.
3. cgroup v1 was not probed on a real v1 host, because knc is cgroup v2. The new v1 test covers the shared function with
   a fake layout.
4. Carried over from rounds 3 to 5. The quota is read once at start, read failures go to `console.warn`, and
   `play/src/pusher/services/CpuTracker.ts` is unchanged.
5. The round 3 README sentence "a path outside the mount root reads only the mount point" is outdated. Round 5's open
   item 2 is closed by this patch.

## Resources

Containers `wa-fable-cpu6-1` to `wa-fable-cpu6-13`, `wa-fable-cpu6-fmt` and `wa-fable-cpu6-probe1` to
`wa-fable-cpu6-probe5` ran with `--rm`, one at a time, at `--cpus 0.5`, between 03:50 and 03:57 UTC, before the 04:45
UTC limit. `docker ps -a --filter name=wa-fable-cpu` lists 0 afterwards. The container `wa-fable-ci3` belongs to another
lane and was not touched.

No file of the knc tree was written. The tree files still hash to the round 3 values (`QuotaAwareCpuTracker.ts`
`4ab1585d…eb99`, `CpuTracker.ts` `ba63e453…5ee9`, `CpuTracker.test.ts` `7c37b558…142a`), and no file outside
`node_modules` is newer than `checks.sh`. The tree holds 24 `._*` files under `src-cpu` from before round 3 (modified
between 23:59 and 00:26 UTC). This round did not create them and left them in place. The test files were mounted over
the existing paths, so no placeholder file was created. Remote receipts and the staged files are in
`~/wa-jobs/wa-fable-20261112/receipts-cpu-r6/` on knc. The scratch folder `/tmp/wa-cpu6` on the Mac was deleted after
the apply check.
