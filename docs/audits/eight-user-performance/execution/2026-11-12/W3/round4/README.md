# W3 round 4, lane cpu: cgroup namespace paths in the quota walk

2026-11-12. The base is checkout HEAD `ddd39f18b` with `../round3/cpu-quota-ancestors.patch` (sha256
`f2bb4416…0a87`), which still applies to HEAD (`git apply --check` exit 0). The host is `knc` (Linux
`6.8.0-147-generic`, cgroup v2) with the tree `~/wa-jobs/wa-fable-20261112/src-cpu`. This round wrote no file of the
checkout outside this folder.

This round dismisses the verdict's finding. The deliverable is `namespace-evidence.test.patch` (122 lines, sha256
`b1b3416c4d7ccd2615b4e6c2d5285fefacbcad5406e00e2f126018acebbce239`). It changes only `back/tests/CpuTracker.test.ts`
and stacks on the round-3 patch. On a copy of HEAD's `back/` with the round-3 patch applied, `git apply --check
namespace-evidence.test.patch` exits 0. On HEAD alone it does not apply, which is expected for a stacked patch.

## Why

WorkAdventure must scale toward 1,000 users, and eight people in one room must not freeze. The back server sheds
movement when `cpuTracker.isOverHeating()` is true, which needs CPU measured against the container quota. The round-3
patch walks the cgroup ancestors for v1 and v2. The cross-family verdict
(`docs/audits/performance-1000-users/execution/verdicts/cpu-round3-ancestors.md`) failed it with one finding.
`cgroupDirectories` treats a process path outside the mount root as "not below root" and reads only the mount point. The
reviewer's case is `/proc/self/cgroup` reporting `/child` while the mount root in `/proc/self/mountinfo` is
`/docker/abc`. The reviewer expects `<mount>/child/cpu.max` to be read.

## The kernel renders both paths from the same root

The finding assumes that the two files can use different frames. They cannot. Sources are Linux `v6.8` (knc runs
Ubuntu `6.8.0-147`), fetched from the upstream tag.

- `proc_cgroup_show` (`kernel/cgroup/cgroup.c:6246`) prints the path of each hierarchy with
  `cgroup_path_ns_locked(cgrp, buf, PATH_MAX, current->nsproxy->cgroup_ns)` (line 6294). `cgroup_path_ns_locked`
  (line 2363) returns `kernfs_path_from_node(cgrp->kn, root->kn, …)`, where `root` is the reader's namespace root cgroup
  in that hierarchy.
- The root field of a cgroup line in `/proc/self/mountinfo` comes from the kernfs `show_path` operation. That operation
  is `cgroup_show_path` for v2 (`cgroup_kf_syscall_ops`, `kernel/cgroup/cgroup.c:5975`) and for v1
  (`cgroup1_kf_syscall_ops`, `kernel/cgroup/cgroup-v1.c:1130`). `cgroup_show_path` (`kernel/cgroup/cgroup.c:1892`) takes
  `ns_cgroup = current_cgns_cgroup_from_root(kf_cgroot)` and writes
  `kernfs_path_from_node(kf_node, ns_cgroup->kn, …)` (line 1906).
- `kernfs_path_from_node_locked` (`fs/kernfs/dir.c:134`) writes one `/..` for each level from the namespace root up to
  the common ancestor, then the names down to the target. Its comment gives `/../../n5` and `/../..` as results.
- `Documentation/admin-guide/cgroup-v2.rst`, section "Namespace", shows the same rule for `/proc/$PID/cgroup`:
  `0::/../container_id2/sub_cgrp_1` when read from a sibling namespace.

So both fields are paths relative to the reader's cgroup namespace root. In the reviewer's pair, `/child` is not below
`/docker/abc`, so the process cgroup lies outside the mounted subtree. `<mount>/child` is then the cgroup
`<namespace root>/docker/abc/child`, which is not the process cgroup and not one of its ancestors. Reading it, as the
finding asks, reads an unrelated cgroup.

## Probes on knc

Each probe ran in a fresh `node:24-trixie` container (`--rm --cpus 0.5 --cpu-shares 512 --memory 1g --network none
--label owner=wa-fable-20261112`, names `wa-fable-cpu4-<n>`), one at a time, with the round-3 tree mounted. The probe
test (`WaFableCpu4Probe.test.ts`, driven by `probe.sh`) prints `/proc/self/cgroup`, the cgroup lines of
`/proc/self/mountinfo`, `parseCgroupMount`, `readCgroupCpuQuotaCores` and `readCpuCapacity` on the real files. The true
quota comes from the host side, through `docker inspect` `HostConfig.NanoCpus` (`500000000` in every run) and the host file
`/sys/fs/cgroup/system.slice/docker-<id>.scope/cpu.max` (`50000 100000` in every run).

| Run | Layout | Extra docker flags | `/proc/self/cgroup` | mountinfo root, mount point | Tracker resolves | True quota |
|---|---|---|---|---|---|---|
| 1 | private cgroupns (Docker default) | none | `0::/` | `/`, `/sys/fs/cgroup` | 0.5 from `/sys/fs/cgroup/cpu.max` | 0.5 |
| 2 | host cgroupns | `--cgroupns host` | `0::/system.slice/docker-6fd459bd….scope` | `/`, `/sys/fs/cgroup` | 0.5 from `/sys/fs/cgroup/system.slice/docker-6fd459bd….scope/cpu.max` | 0.5 |
| 3 | private cgroupns, host cgroupfs bound over the default | `-v /sys/fs/cgroup:/sys/fs/cgroup:ro` | `0::/` | `/../..`, `/sys/fs/cgroup` (Docker's own cgroup mount is replaced) | none, one-core reference | 0.5 |
| 4 | private cgroupns, host cgroupfs bound elsewhere | `-v /sys/fs/cgroup:/host-cgroup:ro` | `0::/` | `/`, `/sys/fs/cgroup` (first line) and `/../..`, `/host-cgroup` | 0.5 from `/sys/fs/cgroup/cpu.max` | 0.5 |
| 5 | host cgroupns, host cgroupfs bound over the default | `--cgroupns host -v /sys/fs/cgroup:/sys/fs/cgroup:ro` | `0::/system.slice/docker-43c1d151….scope` | `/`, `/sys/fs/cgroup` | 0.5 from `/sys/fs/cgroup/system.slice/docker-43c1d151….scope/cpu.max` | 0.5 |
| - | nested `unshare --cgroup` | none | - | - | skipped | - |

The receipts are `run1-private-cgroupns.txt`, `run2-cgroupns-host.txt`,
`run3-private-bind-host-cgroupfs-over-default.txt`, `run4-private-bind-host-cgroupfs-elsewhere.txt`, and
`run5-cgroupns-host-bind-host-cgroupfs-over-default.txt`.

The nested namespace needs privileges. In every container, `unshare --cgroup true` and
`unshare --user --map-root-user --cgroup true` both exit 1 with `unshare failed: Operation not permitted`. Creating a
cgroup namespace needs `CAP_SYS_ADMIN`, which the brief rules out. Per the kernel code above, a nested namespace renders
the outer mount root as `/..` repeated, the same shape as run 3.

The observed mount roots are `/` and `/../..`. No layout rendered a named root that excludes the process path, which is
the shape the finding needs.

## Why run 3 is a known limit, not a defect of the walk

Run 3 is the one layout where the tracker reports one core while the quota is 0.5. The container's scope directory is
visible at `/sys/fs/cgroup/system.slice/docker-5db3c245….scope`, but nothing in the two `/proc` files names it.
`/proc/self/cgroup` says `/` and the mount root says `/../..`, so the files give the depth of the two missing levels but
not their names. The tracker reads the mount point, the host root, which is an ancestor and has no `cpu.max`.

HEAD resolves the same layout the same way. It read `/sys/fs/cgroup/cpu.max`, which is absent there. The finding's join
also resolves it the same way, because `/` joined under the mount point is the mount point. The startup `console.info`
line names `no cgroup CPU quota, one-core reference` as its source, so the case shows in the logs. An operator who needs
the host cgroupfs inside the container gets the quota with `--cgroupns host` (run 5) or by binding it elsewhere (run 4).

## Tests

`namespace-evidence.test.patch` adds `describe("observed cgroup v2 layouts")` to `back/tests/CpuTracker.test.ts` (31
tests become 37).

- Five tests, one per probe run. Each uses that run's `/proc/self/cgroup` and mountinfo lines verbatim and the
  `cpu.max` files the container showed. Each asserts the `readCpuCapacity` result, cores and source, against the probe
  table.
- One derived test, `should not read the host cgroup that has the process path when the mount root is above the
  namespace root`. It keeps run 3's mount and moves the process to `/system.slice/wa-back.service` below its namespace
  root, as systemd inside a container would. A host cgroup with that relative path carries a 0.2 quota. The test
  expects the one-core reference. It is derived because moving a process needs a write to cgroupfs, which the probe may
  not do.

## Mutants

Each mutant replaced `QuotaAwareCpuTracker.ts` through a read-only bind mount, with the final test file, at `--cpus
0.5`.

| Mutant | Change | Result | Receipt |
|---|---|---|---|
| A, the finding's proposal | `cgroupDirectories` walks the process path under the mount point when the path is outside the root (`mutantA-join-outside-root.diff`) | killed, 1 failed and 36 passed. Only the derived test fails: `expected { cores: 0.2, …(1) } to deeply equal { cores: 1, …(1) }` | `run7-mutantA-join-outside-root.txt` |
| B | `parseCgroupMount` takes the last matching mount instead of the first (`mutantB-last-mount.diff`) | killed, 1 failed and 36 passed. `should resolve a private cgroup namespace with the host cgroupfs bound at /host-cgroup` fails: `expected { cores: 1, …(1) } to deeply equal { cores: 0.5, …(1) }` | `run8-mutantB-last-mount.txt` |

Mutant A passes all five observed layouts. The change the finding asks for alters no observed outcome, and in the
derived layout it reports a host service's 0.2-core quota as the container's.

## Checks

The final state is checkout HEAD's `back/` plus the round-3 patch plus `namespace-evidence.test.patch`. The knc tree
holds the round-3 state of `80b523ea8`, so `checks.sh` bind-mounts, read-only, the final `CpuTracker.test.ts` and
HEAD's versions of the four files that `f35d9b151` changed (`CommunicationTypes.ts` and `Capabilities.ts` as HEAD has
them, `/dev/null` over the deleted `Identificable.ts` and `Logger.ts`). The tracker files there match the round-3 patch
(`QuotaAwareCpuTracker.ts` `4ab1585d…eb99`, git blob `b45a368`). Each run used a fresh `--rm` container at
`--cpus 0.5 --memory 1g`, from `/work/back`.

| Run | Command | Exit | Result | Receipt |
|---|---|---|---|---|
| 6 | `npx vitest --config vitest.config.ts --run tests/CpuTracker.test.ts --reporter=verbose` | 0 | 37 passed (37) | `run6-round3-source-new-tests.txt` |
| 7 | same, mutant A | 1 | 1 failed, 36 passed | `run7-mutantA-join-outside-root.txt` |
| 8 | same, mutant B | 1 | 1 failed, 36 passed | `run8-mutantB-last-mount.txt` |
| 9 | `npx prettier --check` on `CpuTracker.ts`, `QuotaAwareCpuTracker.ts`, `CpuTracker.test.ts` | 0 | `All matched files use Prettier code style!` | `run9-prettier-eslint-typecheck.txt` |
| 9 | `DEBUG= npx eslint` on the same files, then `npm run typecheck` | 134, 134 | `JavaScript heap out of memory`. The default V8 heap is too small under the 1 GiB container limit | `run9-prettier-eslint-typecheck.txt` |
| 11 | the same two with `NODE_OPTIONS=--max-old-space-size=960` | 0, 0 | no output from eslint, no diagnostics from `tsc --noEmit` | `run11-eslint-typecheck-heap960.txt` |
| 10 | `npm test -- --run` (whole back suite) | 0 | 29 files, 358 passed and 2 skipped (360) | `run10-back-whole-suite.txt` |

## Open

1. The verdict's synthetic pair still reads a non-ancestor. With `/child` and root `/docker/abc`, the round-3 patch
   reads `/docker/abc/cpu.max` through the mount point, and `/docker/abc` is not an ancestor of `/child`. HEAD read the
   same file. No probed layout produced a named root outside the process path. A guard that reads the mount point only
   when the root consists of `..` parts would close the case. It is not in the patch because no runtime evidence asks
   for it.
2. cgroup v1 was not probed, because knc is cgroup v2. The kernel citation covers v1, which uses the same `cgroup_show_path`.
3. Carried over from round 3: the quota is read once at start, read failures go to `console.warn`, and
   `play/src/pusher/services/CpuTracker.ts` is unchanged.

## Resources

Containers `wa-fable-cpu4-1` to `wa-fable-cpu4-11` and `wa-fable-cpu4-p` (one `prettier --stdin-filepath` pass over
the new test file) ran with `--rm`, one at a time, at `--cpus 0.5`, all before the 03:55 UTC benchmark limit.
Afterwards `docker ps -a --filter name=wa-fable-cpu4` lists 0. The benchmark containers were not touched.

The probe test was copied into `src-cpu/back/tests/` for runs 1-5 and removed afterwards. No other tree file was
written. The tracker files still hash to the round-3 values, and `CpuTracker.test.ts` is still `7c37b558…142a`. The
only file under `src-cpu` newer than the probe is vitest's cache, `back/node_modules/.vite/vitest/<hash>/results.json`.
No `._*` files remain. The two eslint and tsc aborts in run 9 left no core file in the tree or in `/var/crash`.

The scratch repo `/tmp/wa-cpu-r4/repo` (Mac) has the history base (HEAD), round 3, then the uncommitted test change.
`namespace-evidence.test.patch` is its `git diff`. The kernel sources used for the citations are in
`/tmp/wa-cpu-r4/kernel/`. Their sha256 values are `kernel/cgroup/cgroup.c` `81c9d3db…46ae`,
`kernel/cgroup/cgroup-v1.c` `94325c26…fd03`, `fs/kernfs/dir.c` `b254ac22…e346`, `cgroup-v2.rst` `71727756…56d3`.
Remote receipts and the staged files are in `~/wa-jobs/wa-fable-20261112/receipts-cpu-r4/` on knc.
