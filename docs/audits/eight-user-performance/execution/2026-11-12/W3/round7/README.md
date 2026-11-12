# W3 round 7, lane cpu: read every mount of the cgroup hierarchy

2026-11-12. The base is checkout HEAD `50632e874`, where `back/` is unchanged since `1f48d79d5`, with the round 3, round 4,
round 5 and round 6 patches applied in that order. The host is `knc` (Linux `6.8.0-147-generic`, cgroup v2) with the tree
`~/wa-jobs/wa-fable-20261112/src-cpu`. This round wrote no file of the checkout outside this folder.

## Why

WorkAdventure must scale toward 1,000 users and explain an eight-user freeze. The back server sheds movement when
`cpuTracker.isOverHeating()` is true, which is 80 % CPU measured against the container's CPU quota. When the tracker
misses a quota, it measures against one core. A process capped at 0.5 core then tops out at 50 %, never crosses 80, and
keeps accepting movement while the container is throttled.

The cross-family verdict `docs/audits/performance-1000-users/execution/verdicts/cpu-round6-stack.md` failed the round 6
stack with one major finding. `parseCgroupMount` returned only the first matching cgroup mount of
`/proc/self/mountinfo`. When a mount rooted at a sibling cgroup is listed before a valid mount, `readCgroupCpuQuota`
checked the sibling mount, found no directory that is an ancestor of the process, and reported the one-core reference.
The quota under the valid mount was never read.

## What changed

`back/src/Services/QuotaAwareCpuTracker.ts` gains 15 lines and loses 13, 6 of the added lines and 4 of the removed ones
being comments. The parsers, the quota readers, the path rule of round 6, the threshold and the `min(1, quota)` rule are
unchanged.

- `parseCgroupMount` is now `parseCgroupMounts`. It returns every mount of the hierarchy in the order listed (every
  `cgroup2` mount for v2, every `cgroup` mount with the `cpu` option for v1), or an empty array.
- `readCgroupCpuQuota` runs `cgroupDirectories` for each mount of each hierarchy and takes the tightest quota over all
  the directories found. The default mount point is still the stand-in when `/proc/self/mountinfo` lists no mount of the
  hierarchy. When it lists mounts and none is an ancestor, nothing is read and the one-core reference applies, as before.

Reading every mount is safe because of round 6. `cgroupDirectories` returns a directory only when the mount's root is
proven to be the process cgroup or one of its ancestors, so each quota found through any mount constrains the process.
The tightest of several real constraints is the effective one, and the set of quotas is the same in any mount order.

The callers of `parseCgroupMount` outside the file were the test file, which this patch updates, and the probe tests of
earlier rounds. `back/src/Services/CpuTracker.ts` imports only `CpuTracker`. Several mounts of one hierarchy appear when a
container binds a cgroup directory next to its own `/sys/fs/cgroup`, as in round 4's probe 4.

## Patches

Apply them in this order. The first four are not in the checkout yet.

| Order | Patch | sha256 |
|---|---|---|
| 1 | `../round3/cpu-quota-ancestors.patch` | `f2bb4416f1431e43f34a6f8a2688305b14f93de5505e2f96cf4f71d971140a87` |
| 2 | `../round4/namespace-evidence.test.patch` | `b1b3416c4d7ccd2615b4e6c2d5285fefacbcad5406e00e2f126018acebbce239` |
| 3 | `../round5/cpu-mount-ancestry.patch` | `9d4b3eeb500c3b68e355d7aa81a69be77c910f79af57fa5564b462416bf4c252` |
| 4 | `../round6/cpu-ascent-paths.patch` | `65581226f9fae23f383f2eb30c922fc0a7c445744da52b27fc228566fa873a45` |
| 5 | `cpu-all-mounts.patch` (the fix and its tests, 202 lines) | `50634782ceb5dd8c0f55074ed7db349190725481ad0ec4a8302ba0276fe3e9f2` |
| - | `cpu-all-mounts.pin-tests.patch` (the tests of patch 5 alone, 138 lines, not part of the stack) | `9b1b3fe9ba1e0b91d0c041c0910acbf7dd2426bc472cc88a299cf7d16b451b09` |

Patch 5 holds the fix and its tests together. `cpu-all-mounts.pin-tests.patch` is the tests-only state on the round 3 to 6
source, kept so a reviewer can reproduce the red run (run 1). After patch 5 the two files have these git blobs and hashes.

| File | git blob | sha256 |
|---|---|---|
| `back/src/Services/QuotaAwareCpuTracker.ts` | `84680d75d0abd96196b580e1d960b53e2d260e34` | `a6054a9e53699bed138d4a97e89372c8dab8b64c9fd9c1056be14962bfad8af4` |
| `back/tests/CpuTracker.test.ts` | `877ec11044726a7951c58a3d96ce1907923d4087` | `178121c70923e3bab4ac35a9dd682f0d92694fe308f0f1842cb91bc28120220e` |

`apply-check.sh` builds a temporary index from HEAD with `GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` in a `mktemp`
directory under `/tmp`, with the checkout's objects as an alternate, then applies the patches (`apply-check.txt`). The
checkout's index and working tree are not written.

| Check | Exit | Result |
|---|---|---|
| Patch 5 on HEAD alone | 1 | `patch does not apply`, as expected for a stacked patch |
| Patch 5 on patches 1 to 3, without 4 | 1 | `patch does not apply`, as expected |
| Patches 1 to 5 in order, `--check` then apply | 0, 0, 0, 0, 0 | all apply |
| `cpu-all-mounts.pin-tests.patch` on the round 3 to 6 state | 0 | applies |
| Blobs after the stack | - | `84680d75d…` and `877ec1104…`, equal to the blobs of the tested files |

## Tests

`back/tests/CpuTracker.test.ts` has 61 tests, 6 more than round 6. The helper `mountRootedAt` takes an optional mount
point, with `/sys/fs/cgroup` as its default. No other test or helper changed, except the two parser tests below.

The two tests of `describe("parseCgroupMount")` became `describe("parseCgroupMounts")`. Their assertions changed from a
`CgroupMount` or `undefined` to an array with one `CgroupMount` or an empty array. The inputs are the same.

Run 1 is the whole new test file against the round 3 to 6 tracker. It has 6 failures and 55 passes. Three failures are
`TypeError: parseCgroupMounts is not a function`, because the function does not exist there. They prove nothing about
behavior. The three behavior pins fail on a real disagreement, quoted in the table.

| Test | Layout | On rounds 3 to 6 | On the fix |
|---|---|---|---|
| Two adjusted parser tests, and `should return every mount of the hierarchy in the order listed` | parser contract | fail with the `TypeError` | pass |
| `should read a valid mount listed after a mount rooted at a sibling (the sibling first)` (the brief's pin) | cgroup2 mounts listed as root `/system.slice/other.service` at `/sys/fs/cgroup` (`0.1` in its `cpu.max`), then root `/` at `/mnt/cgroup`. Process `/system.slice/wa.service`, `0.2` at the process directory | fails, `expected { cores: 1, …(1) } to deeply equal { cores: 0.2, …(1) }` | 0.2 from `/mnt/cgroup/system.slice/wa.service/cpu.max` |
| same, `the sibling last` | the same two mounts in the other order | passes, 0.2 | 0.2 |
| `should take the tightest quota over two valid mounts (the mount of the whole hierarchy first)` | root `/` at `/mnt/cgroup` (`0.5` at the process, `0.3` at `/system.slice`) and root `/system.slice/wa.service` at `/mnt/self` (`0.5`) | passes, 0.3 | 0.3 from `/mnt/cgroup/system.slice/cpu.max` |
| same, `the mount of the process cgroup first` | the same two mounts in the other order | fails, `expected { cores: 0.5, …(1) } to deeply equal { cores: 0.3, …(1) }` | 0.3 |
| `should read a valid cgroup v1 mount listed after a mount rooted at a sibling` | v1 mounts, root `/docker/other` at `/sys/fs/cgroup/cpu,cpuacct` (`0.1`), then root `/docker/abc` at `/mnt/cpu` (`0.2`). Process `4:cpu,cpuacct:/docker/abc` | fails, reads the one-core reference | 0.2 from `/mnt/cpu/cpu.cfs_quota_us` |

The two tests that pass on rounds 3 to 6 are the mirror orders of two pins. They pass there because the first listed
mount happens to be the one that matters. They stay to kill the last-mount-only mutant (G2 below).

The 53 other tests of the round 6 file pass unchanged on the fix. They include the five observed layouts of round 4,
the sibling and mixed cases of round 5, and the ascent tests of round 6.

## Checks

Each run used a fresh `--rm` container on `node:24-trixie` with `--cpus 0.5 --cpu-shares 512 --memory 1g --network none`
and `--label owner=wa-fable-20261112`, from `/work/back`. `checks.sh` bind-mounts, read-only, the final test file, the
tracker under test, and HEAD's versions of the four files that `f35d9b151` changed (the same set as rounds 4 to 6). The
knc tree is not written. Run 1 mounts the round 6 tracker (`QuotaAwareCpuTracker.r6.ts`, sha256 `9b79bf6ab046…`, the
verified file of round 6). `fmt.sh` ran `prettier --write` once on the tracker and the test file before the runs, and
run 7 confirms the result.

| Run | Command | Exit | Result | Receipt |
|---|---|---|---|---|
| 1 | `npx vitest --config vitest.config.ts --run tests/CpuTracker.test.ts --reporter=verbose`, round 6 tracker | 1 | 6 failed, 55 passed (61). The failures are the rows marked "fails" above | `run1-pins-on-round3-to-round6-source.txt` |
| 2 | same command, fixed tracker | 0 | 61 passed (61) | `run2-fix-final-tests.txt` |
| 7 | `npx prettier --check` on `CpuTracker.ts`, `QuotaAwareCpuTracker.ts`, `CpuTracker.test.ts` | 0 | `All matched files use Prettier code style!` | `run7-prettier-check.txt` |
| 8 | `DEBUG= NODE_OPTIONS=--max-old-space-size=960 npx eslint` on the same three files | 0 | no output | `run8-eslint-heap960.txt` |
| 9 | `NODE_OPTIONS=--max-old-space-size=960 npm run typecheck` | 0 | `tsc --noEmit`, no diagnostics | `run9-typecheck-heap960.txt` |
| 10 | `npm test -- --run`, the whole back suite | 0 | 29 files, 382 passed and 2 skipped (384). Round 6 had 376 and 2 skipped, and the 6 new tests are the difference | `run10-back-whole-suite.txt` |

The heap option is the one rounds 4 to 6 needed, because the default V8 heap is too small under a 1 GiB container limit.
Runs 3 to 6 are the mutants below.

## Mutants

Each mutant changes the fixed tracker (`mutantG*.diff`) and runs the final test file (runs 3 to 6). G1 to G3 are the three
the brief asked for. G3 is the strict form of "max instead of min across mounts". It takes the tightest quota of each
mount and then the loosest of those, so a plain flip of the final comparison, which many older tests already catch, is
not what it tests. G4 is not a mutant that must fail. It reverses the mount order, and it must survive.

| Mutant | Change | Result | Failing tests | Receipt |
|---|---|---|---|---|
| G1, first matching mount only | `listedMounts.slice(0, 1)` | killed, 3 failed and 58 passed | the sibling first, the process-cgroup mount first, and the v1 sibling tests | `run3-mutantG1-first-matching-mount-only.txt` |
| G2, last matching mount only | `listedMounts.slice(-1)` | killed, 3 failed and 58 passed | the sibling last, the whole-hierarchy mount first, and round 4's `should resolve a private cgroup namespace with the host cgroupfs bound at /host-cgroup` | `run4-mutantG2-last-matching-mount-only.txt` |
| G3, loosest over mounts | the tightest quota per mount, then the largest of those | killed, 2 failed and 59 passed | both orders of `should take the tightest quota over two valid mounts` | `run5-mutantG3-loosest-over-mounts.txt` |
| G4, mounts in reverse order (equivalent) | `[...listedMounts].reverse()` | survives, 61 passed | none, by design | `run6-mutantG4-reversed-mount-order-equivalent.txt` |

### The last-mount mutants of rounds 4 and 5 are retired

Round 4's mutant B and round 5's mutant E took the last matching mount instead of the first, by reversing the lines of
`/proc/self/mountinfo`. The test `should resolve a private cgroup namespace with the host cgroupfs bound at /host-cgroup`
killed them. With every mount read, the order of the lines no longer changes the result, and G4 shows it. The reversed
list passes all 61 tests. Those two mutants are now equivalent mutants and no test can kill them. G2 replaces them. It
reads only the last mount, and the same observed-layout test kills it again, because the last mount of that layout is
`/host-cgroup`, which has no `cpu.max`. The test title names no order, so no test needed rewording. Two sentences in
older READMEs are outdated. The round 3 README, open item 2, says that the first mount in mountinfo is used. The round 4
README, mutant B row, calls the reversal a mutant. This patch closes both.

## Real probes with the fixed tracker

The five layouts of round 4 ran again on real files, one container at a time at `--cpus 0.5`, with the fixed tracker
bind-mounted. `probe.sh` and `WaFableCpu7Probe.test.ts` are round 6's probe, pointed at this folder and printing
`parseCgroupMounts`. Every capacity is the same as in rounds 4 to 6. In every run `HostConfig.NanoCpus` was `500000000`
and the host `cpu.max` of the container scope was `50000 100000`.

| Probe | Layout | Mounts the parser lists (root, mount point) | Tracker resolves | Receipt |
|---|---|---|---|---|
| 1 | private cgroupns (Docker default) | `/` at `/sys/fs/cgroup` | 0.5 from `/sys/fs/cgroup/cpu.max` | `probe1-private-cgroupns.txt` |
| 2 | `--cgroupns host` | `/` at `/sys/fs/cgroup` | 0.5 from the scope's `cpu.max` | `probe2-cgroupns-host.txt` |
| 3 | private cgroupns, host cgroupfs bound over `/sys/fs/cgroup` | `/../..` at `/sys/fs/cgroup` | one-core reference. The mount point is the host root and has no `cpu.max` | `probe3-private-bind-host-cgroupfs-over-default.txt` |
| 4 | private cgroupns, host cgroupfs bound at `/host-cgroup` | `/` at `/sys/fs/cgroup`, then `/../..` at `/host-cgroup` | 0.5 from `/sys/fs/cgroup/cpu.max` | `probe4-private-bind-host-cgroupfs-elsewhere.txt` |
| 5 | `--cgroupns host`, host cgroupfs bound over `/sys/fs/cgroup` | `/` at `/sys/fs/cgroup` | 0.5 from the scope's `cpu.max` | `probe5-cgroupns-host-bind-host-cgroupfs-over-default.txt` |

Probe 4 is the one real layout with two mounts of the hierarchy. Round 6 listed only the first. The fixed tracker lists
both and also reads `/host-cgroup`, which holds no `cpu.max`, so the 0.5 result is unchanged. The probe `QUOTA_CORES`,
`CAPACITY` and `/proc/self/cgroup` lines match the round 6 receipts in all five runs.

## Open

1. No real host layout lists a sibling-rooted mount next to a valid mount. Probe 4 is the only real layout with two
   mounts, and both of its mounts are ancestors. The sibling cases are fake layouts built from the kernel's rendering
   rule. A bind of another container's cgroup directory next to the container's own would produce one.
2. When two mounts show the same cgroup, its `cpu.max` is read twice and the answer is the same. A malformed file would
   log one warning for each mount path.
3. cgroup v1 was not probed on a real v1 host, because knc is cgroup v2. The new v1 test covers the shared function with
   a fake layout.
4. Carried over from rounds 3 to 6. The quota is read once at start, read failures go to `console.warn`, a missing entry
   in `/proc/self/cgroup` still reads a mount rooted at `/` (round 6, open item 2), and
   `play/src/pusher/services/CpuTracker.ts` is unchanged.

## Resources

Containers `wa-fable-cpu7-1` to `wa-fable-cpu7-10`, `wa-fable-cpu7-fmt` and `wa-fable-cpu7-probe1` to
`wa-fable-cpu7-probe5` ran with `--rm`, one at a time, at `--cpus 0.5`, between 04:05 and 04:10 UTC, before the 05:00 UTC
limit. `docker ps -a --filter name=wa-fable-cpu` lists 0 afterwards. The container `wa-fable-ci3` belongs to another lane
and was not touched.

No file of the knc tree was written. The tree files still hash to the round 3 values (`QuotaAwareCpuTracker.ts`
`4ab1585d…eb99`, `CpuTracker.ts` `ba63e453…5ee9`, `CpuTracker.test.ts` `7c37b558…142a`), and no file outside
`node_modules` is newer than `checks.sh`. The test files were mounted over the existing paths, so no placeholder file
was created. This round created no `._*` file. Remote receipts and the staged files are in
`~/wa-jobs/wa-fable-20261112/receipts-cpu-r7/` on knc. The scratch folder `/tmp/wa-cpu7` on the Mac was deleted after
the apply check.
