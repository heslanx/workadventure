# P4: skip unchanged effective viewport zone reconciliation

Plan: `docs/audits/performance-1000-users/plans/upstream-pr-plan.md`, section P4. Baseline: `ddbe245a8`.

## Change under test

`PositionDispatcher.setViewport` keeps, per socket, the zone rectangle its last viewport was reconciled to
(`lastZoneRectangles`, a `WeakMap<PusherWebSocket, ZoneRectangle>`; commit `eb43d0446` replaced the earlier `{ reconciled }` wrapper with the rectangle itself). After the existing validation and the centered 1600-zone crop, it
returns early when the new effective rectangle equals the reconciled one. `removeViewport` deletes the entry.
The reconciliation itself moved unchanged into a private `reconcileZones()` (see "Miss-path fix").

Invariants the change must keep:

1. Validation runs first: non-finite or inverted viewports are still rejected with the same warning, and they leave
   the current zones and the cached rectangle untouched.
2. The comparison uses the bounded (cropped) rectangle, so an oversized viewport keeps the 1600-zone cap and the
   first-oversize warning of the room.
3. The cached rectangle is only trusted after a full reconciliation: it is cleared before subscribing and set after,
   so a subscription that throws halfway cannot make a later viewport skip work.
4. `removeViewport` invalidates the entry: the same viewport sent after a removal subscribes again.
5. Zone sharing is unchanged: first listener subscribes the zone to the back, last listener unsubscribes it.
6. No protocol change, no new dependency. `SocketManager` still stores the exact viewport.

## Method

- Host knc, container `wa-fable-p4-*` (`--cpus 2 --memory 3g --cpu-shares 512 --network none`, image
  `node:24-trixie`), on the read-only `src-wa-fable-p3` snapshot (npm-ci'd tree). The checkout files are
  bind-mounted read-only; every receipt prints their sha256. Final checkout `PositionDispatcher.ts`:
  `9605481a...` (earlier inline version `f2bcb3a4...`), test file `4ccf0536...`, HEAD's file `c27eacdc...`.
  Bench copies with rewritten import paths: `bench/PositionDispatcher.{base,base2,head,variant}.ts`.
- Tests: `npm test -- --run tests/pusher/PositionDispatcher.test.ts` from `play/` (tmpfs over `node_modules/.vite*`
  because the snapshot is read-only).
- Lint: `npx eslint` and `npx prettier --check` on the two files with the repo config of the snapshot.
- Micro-benchmark: `bench/viewport-bench.ts` replays fixed trajectories against several implementations in one
  process, interleaved per replay. `base` and `base2` are two copies of HEAD's file: their ratio is the A/A noise.
  It reports the effective-bound hit ratio, ns per update, JS heap bytes per update and a hash of every
  subscription, unsubscription and resulting zone membership (`trace`). `time/ref` is the median of the
  per-replay ratios to `base`.

## Behavior

| Check | Code | Result | Receipt |
|---|---|---|---|
| 21 tests (13 new) | HEAD (unchanged) | 21 passed, exit 0 | `receipts/test-unchanged-code-knc-2.log` (attempt 1 exit 1: EROFS on the vite cache, no test ran) |
| 21 tests | inline version `f2bcb3a4...` | 21 passed, exit 0 | `receipts/test-head-knc.log` |
| 21 tests | final version `9605481a...` (current checkout) | 21 passed, exit 0 | `receipts/test-variant-knc.log` |
| eslint + prettier, production file | final version | eslint exit 0, prettier exit 0 | `receipts/lint-variant-knc.log` |
| 21 tests | mutant: no invalidation in `removeViewport` | 1 failed (`subscribes again ... after its viewport was removed`), exit 1 | `receipts/test-mutant-noinvalidate-knc.log` |
| eslint + prettier, two files | checkout | eslint exit 0, prettier exit 0 | `receipts/lint-knc.log` |
| trace hash per scenario | all labels, all runs | identical for base, base2 and head in every scenario | bench logs |

The new tests assert subscriptions and socket events (repeat, move inside zones, crossing, return, negative
coordinates, cropped move, invalid after valid, shared zones, remove then re-add), not the private cache. They pass
on HEAD, so they are characterization tests of existing behavior; the mutant run shows they also catch a stale
cache.

## Performance runs (micro-benchmark, knc)

Head/base median `time/ref` per run. Run 1 measured an earlier head that deleted and re-set the WeakMap entry on
every miss; runs 2 and 3 measure the inline version (`f2bcb3a4...`, the checkout file at the time of those runs,
printed by `receipts/bench-run2-knc.log` and `bench-run3-knc.log`; superseded by the final `9605481a...`, see
"Miss-path fix"), with label orders base, base2, head and base, head, base2.

| Scenario | hit ratio | base2/base (runs 1/2/3) | head/base run 1 (earlier head) | head/base runs 2/3 (inline version) | B/update base -> head |
|---|---|---|---|---|---|
| stationary | 100% | 0.967 / 1.059 / 1.047 | 0.008 | 0.007 / 0.008 | 6665 -> 168 |
| inside-bounds | 100% | 1.061 / 1.033 / 1.017 | 0.008 | 0.007 / 0.009 | 6609 -> 168 |
| walk (1080p, 26 px/update) | 84% | 0.976 / 0.993 / 1.044 | 0.336 | 0.338 / 0.290 | 7490 -> 1995 |
| cross-every-update | 0% | 1.018 / 0.990 / 1.037 | 1.150 | 1.078 / 1.064 | 16855 -> 16528 |
| max-inside-bounds (40x40) | 100% | 1.010 / 1.002 / 0.973 | 0.000 | 0.000 / 0.000 | 195959 -> 171 |
| max-cross-every-update | 0% | 1.012 / 1.003 / 1.025 | 1.073 | 1.077 / 1.079 | 265089 -> 265109 |
| oversized-cropped | 100% | 1.000 / 0.990 / 1.010 | 0.000 | 0.001 / 0.001 | 200508 -> 251 |
| crowd-walk (1,000 sockets) | 84.1% | 0.939 / 0.982 / 1.022 | 0.322 | 0.315 / 0.307 | 7264 -> 1606 |

Absolute medians for the inline head, runs 2/3: walk 3149 / 2308 ns vs base 9349 ns (run 2); crowd-walk
4013 / 4056 ns vs base 12859 ns (run 2); cross-every-update 19167 / 17883 ns vs base 18484 ns (run 2). The
per-replay p10-p90 spread of base2/base is wide (about 0.6 to 1.6 on the 1080p scenarios): only medians repeated
across runs are used for decisions. Noise band from the base2/base medians of runs 1-3 (all eight scenarios):
0.939 (crowd-walk, run 1) to 1.061 (inside-bounds, run 1), so 0.94 to 1.06. Run 4 widens it to 0.93 to 1.10
(both ends come from run 4; run 5's base2/base medians, 0.942 to 1.056, sit inside; see "Decision").

Reading:

- Target metric (time and bytes per update on trajectories that stay in the same zones): improves 3x on walk and
  crowd-walk and by two orders of magnitude on repeated or in-zone viewports, in every run, far beyond the noise
  band, with identical traces.
- Miss path (every update changes the rectangle): the head is slower in all six head measurements (1.064 to
  1.150), above 5% each time, while base2 stays within 0.990 to 1.037 on these two scenarios. The regression is
  proportional to the reconciliation size (about +1 us at 1080p, about +25 us at 40x40), so it is not the constant
  cost of one WeakMap lookup.

### Miss-path fix: reconciliation extracted to a method

Hypothesis: the early-return block made `setViewport` larger and the reconciliation loops were compiled worse
(a cost proportional to the loop work). Variant: the reconciliation body moves unchanged into a private
`reconcileZones(socket, topLeft, bottomRight)`; `setViewport` keeps validation, crop, comparison and cache
bookkeeping. Behavior is identical by construction and by trace. Checkout file after the change:
`9605481a...` (21 tests passed, exit 0, `receipts/test-variant-knc.log`; eslint exit 0, prettier exit 0,
`receipts/lint-variant-knc.log`).

Run 4 (labels base, base2, head, variant, all four loaded from `bench/`; `receipts/bench-run4-knc.log`):

| Scenario | base2/base | head/base | variant/base | B/update base / head / variant |
|---|---|---|---|---|
| walk | 0.979 | 0.293 | 0.268 | 7491 / 1995 / 2032 |
| cross-every-update | 0.998 | 1.069 | 1.011 | 16855 / 16528 / 17500 |
| max-cross-every-update | 1.011 | 1.120 | 1.027 | 265094 / 265113 / 265153 |
| crowd-walk | 1.100 | 0.275 | 0.281 | 7264 / 1606 / 1639 |

The other scenarios behave as in runs 2 and 3 (variant in-zone and repeated viewports below 0.01x of base).
Traces are identical for all four labels in every scenario.

Run 5 (re-measure, label order base, variant, base2; `receipts/bench-run5-knc.log`): walk 0.262, crowd-walk
0.282, cross-every-update 1.013 (base2 0.996), max-cross-every-update 0.983 (base2 1.005), stationary and
inside-bounds 0.007, max-inside-bounds and oversized-cropped 0.000; traces identical.

## Decision: keep (variant `9605481a...`)

Plan rule: keep only if the target metric improves >= 10% beyond noise with identical behavior and no repeatable
other-metric regression above 5%.

- Target: walk 0.268 / 0.262 and crowd-walk 0.281 / 0.282 of base time (runs 4/5), bytes per update 7491 -> 2032
  and 7264 -> 1639. Improvement about 70%. Noise band from the base2/base medians of every run (A/A baseline run,
  runs 1-5, all eight scenarios): 0.927 (max-inside-bounds, run 4) to 1.100 (crowd-walk, run 4), so 0.93 to 1.10.
  The target result is far outside it. Pass.
- Behavior: identical traces in all scenarios and runs; 21/21 tests on the final file. Pass.
- Miss path: 1.011 / 1.013 and 1.027 / 0.983, inside the base2 band. The inline version's repeatable +6-12%
  regression is gone. Pass.
- Bytes per all-miss update at 1080p: 16855 -> 17500 (+3.8%) in both runs, repeatable but below 5%. Recorded,
  not blocking. At 40x40 it is +0.02%.

Superseded: the inline version (`f2bcb3a4...`, runs 1-3 head) fails the rule on the miss path and is not kept.

## What this does not show

- This is a single-function micro-benchmark in one process. It is not a 1,000-user live measurement: no
  WebSocket traffic, protobuf encoding, back connection, event-loop lag or GC pressure of a real pusher.
  The plan's live lanes (P4/lane-1..10.json on the swarm workers) and the "1,000 moving users" probe were not run.
- Hit ratios come from synthetic trajectories (26 px per update, 1080p viewports, 320 px zones); real clients may
  send viewports at another rate or step.
- `npm run typecheck` was not run for `play/` in round 1; round 2 ran it (exit 0, `round2/receipts/static-knc.log`).
  Round 2 also added the tests the reviews asked for (partial subscribe failure and its retry, bottom-right-only
  resize in width and in height): 25 tests, see `round2/README.md` (`round2/p4-round2-tests.v2.patch`).
- Profiler output was not captured; the miss-path cause above is a hypothesis tested by one variant, not a profile.
