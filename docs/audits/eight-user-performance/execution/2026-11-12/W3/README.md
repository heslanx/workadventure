# W3 transport and operations: H15-H20, A04

Stream W3, 2026-11-12, 00:35-00:58 UTC. Baseline `ddbe245a8`. No product file was edited; the quota-aware change is a
proposed patch only (`quota-aware-cpu.proposed.patch`, not applied, threshold untouched).

## How the backend CPU tracker computes its percentage

Source: `back/src/Services/CpuTracker.ts` (sha256 `093496fa…938b`, identical in the checkout and in the `wa-fable-h8` tree).
The pusher has a copy with the same loop (`play/src/pusher/services/CpuTracker.ts`); only the backend copy gates movement.

| Aspect | Value |
|---|---|
| API | `process.cpuUsage(previous)`: user + system CPU time of the **whole process** (all threads: main loop, libuv pool, GC), in µs |
| Denominator | wall time from `process.hrtime.bigint()` between ticks (ns). The variable is named `elapTimeMS` but holds ns; the `* 1000000` factor compensates, so the unit is right |
| Formula | `round(100 * cpuMs / wallMs)`: percent of **one core**, no upper bound at 100 |
| Interval | `setInterval` 100 ms; one tick above the threshold switches overheat on, one tick at or below switches it off (no hysteresis) |
| Threshold | `CPU_OVERHEAT_THRESHOLD`, default 80 (`EnvironmentVariableValidator.ts`) |
| Consumer | `SocketManager.handleUserMovesMessage`: while overheated, every `moving === true` position is dropped; stopped positions pass |
| Quota awareness | none: no read of `cpu.max`, `cpu.cfs_quota_us` or `os.availableParallelism()` |

## Deterministic demonstration with the real code

Harness `cpu-tracker/CpuTracker.current.demo.test.ts` imports the unmodified module, fakes `setInterval`, and feeds
`process.hrtime.bigint` / `process.cpuUsage` so that each 100 ms tick credits `cores × 100 ms` of CPU time: what a process
that fully consumes a quota of `cores` CPUs accumulates. Run in `wa-fable-h8` (vitest 4.1.7): 5/5 passed, exit 0.
Receipt: `cpu-tracker/vitest-runs.txt`.

| Controlled input (CPU time per wall second) | Reported | Overheat (threshold 80) |
|---|---|---|
| 0.50 core, quota 0.50 fully consumed | 50 % | false |
| 0.65 core, quota 0.65 fully consumed (`wa-fable-stack-back`) | 65 % | false |
| 1.00 core | 100 % | true |
| 2.00 cores, quota 2 fully consumed (threads) | 200 % | true |
| 0.90 core inside a 2-core quota (45 % of quota) | 90 % | true |

Effective limit of `wa-fable-stack-back` on `sbh` (docker inspect, 00:37 UTC): `NanoCpus=650000000` = 0.65 CPU,
memory 1.5 GiB. Receipt: `cpu-tracker/back-cgroup-limit.txt`.

**Consequence below one core.** A backend capped at 0.65 CPU that is fully throttled reports at most 65 %. The default
threshold of 80 can never be crossed, so movement shedding never engages, exactly when the process is out of CPU. Absence
of the `CPU high threshold alert` log does not rule out throttling there (H16 already warns this).

**Consequence above one core.** The figure is relative to one core, not to the quota. Shedding starts at 0.8 core of process
CPU even when a 2-core quota is 40 % used. For the main thread this one-core reference is the right ceiling (the event loop
cannot use the second core), but thread time (GC, libuv) also counts, so off-loop work can trigger shedding while the loop
still has headroom. The demonstration does not show which effect dominates in production; that needs event-loop delay.

## Proposed patch (not applied)

`quota-aware-cpu.proposed.patch` (181 lines): reads cgroup v2 `cpu.max` or v1 `cpu.cfs_quota_us`/`cpu.cfs_period_us`
once at start, sets capacity = `min(1 core, quota)`, and divides by it. Behavior with no quota or a quota of one core or
more is unchanged; a quota below one core makes full use read 100 %. Threshold and shedding policy untouched. It adds
`back/tests/CpuTracker.test.ts` (7 tests).

| Check (on scratch copies in `wa-fable-h8`, removed afterwards) | Result |
|---|---|
| `git apply --check -p1` against the checkout | exit 0 |
| `npx vitest run …/tests/CpuTracker.test.ts --reporter=verbose` | 7/7 passed, exit 0 (`cpu-tracker/vitest-runs.txt`) |
| `npx tsc --noEmit --strict` on the two files, `npx eslint`, `npx prettier --check` | see `cpu-tracker/static-checks.txt` |

Limits: the quota is read once (a live `docker update` is not followed); `cpu.max` of a nested cgroup is read from
`/sys/fs/cgroup` only; not run against the full back suite or a real throttled process. Upstream reviewers may prefer
event-loop delay (`perf_hooks.monitorEventLoopDelay`) as the overheat signal; that is a policy change and out of scope.

## Hypothesis states

| ID | State | Scenario | Evidence | Next discriminator | Owner |
|---|---|---|---|---|---|
| H15 | confirmed (mechanism) | static + real tracker with controlled inputs | `SocketManager.ts` L257-263; `cpu-tracker/vitest-runs.txt` | align `CPU high threshold alert` timestamps with remote jumps in an 8-user run | backend rooms |
| H16 | confirmed (measurement does not see a sub-core quota) | `wa-fable-stack-back` 0.65 CPU, demo at 0.50/0.65/1/2 cores | `cpu-tracker/back-cgroup-limit.txt`, `cpu-tracker/vitest-runs.txt` | `cpu.stat` `nr_throttled`/`throttled_usec` and event-loop delay of the back during an 8-user run; whether production back runs below one core | operations |
| H17 | not_executed | no RSS/heap/GC/event-loop samples under load in this window | P1 `stack/stack-state.txt` (restart=no, no OOM line in `stack/stack-logs.txt`) | RSS, heap, GC pauses, event-loop delay, restarts/OOM over the same interval as client freezes | backend/pusher/operations |
| H18 | not_executed | P1 two-client join only; no slow consumer generated | P1 `stack/STACK.md`, `stack/join-probe.out.txt` | bytes/messages queued, drain time and replay burst size with a deliberately slow consumer | transport (P3, upstream PR 6688) |
| H19 | not_executed | no proxy in the P1 stack; no disconnect observed | P1 `stack/STACK.md` | close codes, proxy logs and reconnect periodicity aligned across participants | transport/operations |
| H20 | not_executed | needs participants' networks; no headless substitute | none | same-network vs different-network comparison: RTT, loss, jitter, upload saturation, VPN | operations/support |

A04 proposal: `A04.proposal.md`.

## Resources

Scratch dirs `back/w3scratch` and `back/w3scratch-patch` inside the `wa-fable-h8` tree were created for these runs and
removed (see `cpu-tracker/static-checks.txt`). No container was created. Local staging `/tmp/wa-fable-w3` removed at
00:42 UTC. `CpuTracker.current.demo.test.ts` is an evidence harness kept under `docs/`, outside every package's vitest root.
