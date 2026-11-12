# P4 deslop: no measurable timing change in the P4 micro-benchmark

Goal: WorkAdventure must scale toward 1,000 simultaneous users at controlled server cost. Slice P4 made the pusher
skip zone reconciliation when a viewport keeps covering the same zones. Its PR description says the all-miss path
(every update reconciles) stays within noise only because of the code shape, since the inline reconciliation was
6-12% slower. The deslop pass then replaced the per-socket `{ reconciled }` box (two field writes per
reconciliation) with the rectangle itself (a `WeakMap` delete and a set per reconciliation).

Question: does the deslop version change walk, crowd-walk, or all-miss timing beyond run-to-run noise?

**Verdict: no measurable difference.** Over 6 interleaved runs, the median B/A paired time ratio is 1.008 on walk,
1.022 on crowd-walk, 0.997 on cross-every-update and 0.974 on max-cross-every-update. Each B/A spread sits inside
or below the A2/A spread from the same runs: A2/A medians were 1.017, 1.037, 1.009 and 0.968. No scenario's rank-sum
test separates B/A from A2/A (smallest p = 0.18, on an all-hit scenario). The noise floor limits this run to about
5%. The changed bookkeeping costs 62 ns (1 socket) and 229 ns (1,000 sockets) more per reconciliation in
isolation. That is a predicted 0.3% on cross-every-update, 0.4% on walk and 0.9% on crowd-walk, too small for this
bench to resolve.

No revert patch is written, because B is not slower beyond noise on any scenario.

## Versions

| Label | Source | sha256 of the bench copy |
|---|---|---|
| A | `git show a589e9fdf:play/src/pusher/models/PositionDispatcher.ts` (blob `4025c1b27`, boxed), imports rewritten to `../../../../../../play/src/pusher/...`. Byte-identical to `P4/bench/PositionDispatcher.variant.ts`. | `fb964bb8...dec84a5d0` |
| A2 | A copied to a second file, so it gets its own module, class and JIT code. A2/A is the noise. | `fb964bb8...dec84a5d0` |
| B | A with `deslop/play-pusher.deslop.patch` applied (`patch -o`). The diff touches only the field type, the doc comment and the cache bookkeeping in `setViewport`. | `964e91c6...4dec604` |
| harness | `P4/bench/viewport-bench.ts`, unchanged | `28ffdce7...a51346a` |

The checkout's `play/src/pusher/models/PositionDispatcher.ts` is still blob `4025c1b27` (A) at the time of this run.
The deslop edit is not committed yet.

## Method

- Host sbh (`srv742000`, 4 cores), tree `~/wa-jobs/wa-fable-20261112/src-p5` (npm-ci'd). The 24 `._*` files in
  the tree were deleted first. The bench files live in `src-p5/docs/audits/performance-1000-users/execution/p4db/`,
  so the relative imports resolve to `src-p5/play/src`. `play/src` was not touched. Both sides share that tree's
  `Zone` and dependencies, so only `PositionDispatcher` differs.
- One container per run, run in sequence: `docker run --rm --name wa-fable-p4db-<n> --label
  owner=wa-fable-20261112 --cpus 2 --cpu-shares 512 --memory 2g --network none -v
  ~/wa-jobs/wa-fable-20261112/src-p5:/work -w /work/play node:24-trixie`, Node v24.22.3.
- Command inside the container, same flags as P4:
  `npx tsx --expose-gc --min-semi-space-size=64 --max-semi-space-size=64 ../<p4db>/bench/viewport-bench.ts
  ../<p4db>/results/run<n>.json <label>=../<p4db>/bench/PositionDispatcher.<label>.ts ...`.
  The driver is `bench/run-all.sh`.
- Interleaving at two levels. Inside a run, the harness rotates the label order at every timed replay, so A, A2
  and B see the same drift. Across runs, the module load order takes each of the 6 permutations once
  (run 1 `A A2 B`, 2 `B A A2`, 3 `A2 B A`, 4 `A B A2`, 5 `B A2 A`, 6 `A2 A B`).
- Ratios: for each scenario and run, the median of the per-replay paired ratios B/A and A2/A (same rotation
  round, adjacent in time). Across runs: the median and the min to max of the 6 per-run medians, plus a rank-sum
  test of the pooled per-replay B/A against A2/A. `bench/analyze.mjs` computes all of it from the raw JSON:
  `node bench/analyze.mjs results/run{1..6}.json` (output in `logs/analyze.txt`).
- The driver waited up to 90 s before each run for the sibling `wa-fable-*` containers to stop. They never did,
  so every run shared the host with them and with the production containers. One-minute load average before
  runs 1 to 6: 5.06, 5.10, 5.55, 3.01, 6.87, 4.64, and 4.47 to 8.16 after. Each run took 1 min 34 s to 2 min 5 s.

## Results

Per-run medians of the paired per-replay time ratios. A2/A is the A/A noise on the same host, in the same runs.

| Scenario | Pair | run 1 | run 2 | run 3 | run 4 | run 5 | run 6 | median | min to max |
|---|---|---|---|---|---|---|---|---|---|
| walk (84% hits) | B/A | 0.958 | 1.036 | 1.060 | 0.994 | 1.023 | 0.963 | 1.008 | 0.958 to 1.060 |
| walk | A2/A | 0.973 | 1.045 | 1.147 | 1.093 | 0.943 | 0.989 | 1.017 | 0.943 to 1.147 |
| crowd-walk (1,000 sockets, 84.1% hits) | B/A | 1.001 | 1.044 | 1.050 | 0.947 | 0.899 | 1.076 | 1.022 | 0.899 to 1.076 |
| crowd-walk | A2/A | 0.997 | 1.049 | 0.992 | 1.025 | 1.056 | 1.098 | 1.037 | 0.992 to 1.098 |
| cross-every-update (all miss, 1080p) | B/A | 1.016 | 0.960 | 0.996 | 0.978 | 0.998 | 1.014 | 0.997 | 0.960 to 1.016 |
| cross-every-update | A2/A | 1.052 | 1.012 | 0.913 | 1.006 | 1.032 | 0.954 | 1.009 | 0.913 to 1.052 |
| max-cross-every-update (all miss, 40x40) | B/A | 0.966 | 0.890 | 1.035 | 0.957 | 1.028 | 0.982 | 0.974 | 0.890 to 1.035 |
| max-cross-every-update | A2/A | 1.031 | 0.945 | 0.986 | 0.973 | 0.963 | 0.948 | 0.968 | 0.945 to 1.031 |
| stationary | B/A | 1.121 | 0.946 | 0.981 | 0.970 | 1.041 | 0.942 | 0.975 | 0.942 to 1.121 |
| stationary | A2/A | 0.997 | 1.048 | 1.029 | 1.020 | 1.072 | 1.015 | 1.024 | 0.997 to 1.072 |
| inside-bounds | B/A | 0.907 | 1.023 | 1.008 | 0.822 | 1.068 | 1.032 | 1.015 | 0.822 to 1.068 |
| inside-bounds | A2/A | 1.014 | 1.146 | 1.048 | 1.004 | 0.994 | 1.066 | 1.031 | 0.994 to 1.146 |
| max-inside-bounds | B/A | 1.072 | 0.876 | 1.088 | 0.989 | 0.909 | 0.868 | 0.949 | 0.868 to 1.088 |
| max-inside-bounds | A2/A | 1.043 | 0.911 | 1.070 | 1.043 | 1.059 | 0.916 | 1.043 | 0.911 to 1.070 |
| oversized-cropped | B/A | 0.986 | 0.948 | 0.997 | 1.038 | 0.982 | 0.940 | 0.984 | 0.940 to 1.038 |
| oversized-cropped | A2/A | 0.963 | 1.009 | 1.052 | 0.984 | 0.966 | 0.991 | 0.987 | 0.963 to 1.052 |

Rank-sum test of the pooled per-replay B/A ratios against A2/A (180 replays per pair; 72 on crowd-walk). Two-sided
p: walk 0.35, crowd-walk 0.39, cross-every-update 0.94, max-cross-every-update 0.97. The four all-hit scenarios
give 0.18 to 0.92. Their absolute times are 50 to 130 ns per update, close to the timer and loop overhead, so their
ratios are the noisiest.

Absolute medians (median of the 6 run medians, ns per update), A / A2 / B: walk 2366 / 2541 / 2473, crowd-walk
3979 / 4046 / 3877, cross-every-update 19787 / 19176 / 19670, max-cross-every-update 352654 / 343636 / 346092.

Bytes per update (median of 10 batches) are identical for A, A2 and B in every scenario and run: walk 2032,
cross-every-update 17500, max-cross-every-update 265153, crowd-walk 1639. Removing the box saves no measurable
allocation, and the delete and set allocate nothing measurable either.

## Why the number cannot move: the changed piece is tiny

`bench/weakmap-op-cost.mjs` times only the bookkeeping the edit changes, 2,000,000 reconciliations per round,
10 alternating rounds, in container `wa-fable-p4db-7` (`logs/weakmap-op-cost.log`). Boxed (A) does a get, clears
the field and writes a new rectangle into it. Direct (B) does a get, a delete and a set.

| Sockets in the WeakMap | boxed ns per reconciliation | direct ns per reconciliation | B minus A |
|---|---|---|---|
| 1 | 25.6 (17.4 to 34.3) | 87.5 (73.5 to 106.9) | +62 ns |
| 1,000 | 28.3 (23.1 to 35.5) | 257.3 (224.6 to 295.4) | +229 ns |

The delete and set cost is real and grows with the table size. Against the measured cost of the work around it,
this is the predicted share (inferred, not measured end to end):

- cross-every-update: +62 ns on a 19.8 us reconciliation, 0.3%.
- max-cross-every-update: +62 ns on 353 us, 0.02%.
- walk: 16% of updates reconcile, so +10 ns on 2.37 us, 0.4%.
- crowd-walk: 15.9% of updates reconcile in a 1,000-entry WeakMap, so +36 ns on 3.98 us, 0.9%.

Every prediction is below the 5% floor, which is why the bench shows nothing. The PR's "exact code shape" remark
was about the reconciliation loop inlined into `setViewport` (6-12% slower, proportional to the zones
reconciled). The deslop edit keeps `reconcileZones()` extracted and only shrinks `setViewport`, so it does not
reopen that effect. P4's run 1 "earlier head" also deleted and re-set the entry, but it had the inline loop too,
so its 1.150 does not isolate the delete and set.

A CPU profile of B alone (`--cpu-prof`, container `wa-fable-p4db-8`, diagnostic run, `logs/profile-B.log`) names
the limiter. Self time is `reconcileZones` 34.7%, garbage collection 25.6% (the harness calls `gc()` before every
timed replay), anonymous closures in the dispatcher 12.9%, `subscribeZone` and `unsubscribeZone` 6.1%, and
`Zone.startListening` and `stopListening` 5.4%. All of `setViewport`'s own code, including validation, crop,
comparison and the `WeakMap` calls, takes 6.0%. The zone reconciliation bounds the miss path, and the edited
lines are a small part of a 6% slice.

## What was checked

- Errors: every run exited 0 (`logs/run<n>.log`). Traces (sha256 of every subscribe, unsubscribe and resulting
  zone membership) and hit counts are identical for A, A2 and B in every scenario and run. Hit ratio is 0% on both
  cross scenarios, so every timed update in them ran a full reconciliation, and 84.0% on walk and 84.1% on
  crowd-walk, as in P4.
- Work happened: the all-miss scenarios allocate 17500 and 265153 bytes per update on all three labels, the cost of
  the reconciled zones, not of an early return.
- Load order: the median ratio of a label to the mean of the three labels, grouped by load position, stays within
  0.96 to 1.06 in every scenario (`logs/analyze.txt`), so the first or last loaded module gets no systematic edge.
  Each label took each position twice anyway.

## Limits

- The noise floor is the limit. On this contended host, A2/A per-run medians spread 0.943 to 1.147 on walk,
  0.992 to 1.098 on crowd-walk, 0.913 to 1.052 on cross-every-update and 0.945 to 1.031 on max-cross-every-update.
  Across all eight scenarios they spread 0.91 to 1.15, wider than P4's 0.93 to 1.10 on knc. A real B/A effect
  smaller than about 5% cannot be told apart from noise with 6 runs. The op-cost arithmetic above puts the real
  effect at 1% or less.
- The op-cost figures come from a tight loop over the same keys, not from inside `setViewport`. They size the
  edit. They do not prove its in-situ cost.
- sbh was busy: load average 3 to 8 on 4 cores, sibling `wa-fable-*` containers running throughout, and the
  container has `--cpu-shares 512`. Median absolute ns per update are 8-16% higher than P4's knc run 5 and vary
  run to run (cross-every-update A median from 17.1 to 23.3 us). Only the paired ratios are used.
- This is the P4 single-function micro-benchmark in one process. It is not a live pusher with 1,000 users, and it
  has no WebSocket, protobuf, back connection or real GC pressure.
- The profile is aggregated over all eight scenarios and the untimed behavior passes. tsx emits one-line
  transpiled code, so it has function names but no line numbers. The full `.cpuprofile` (1.1 MB) stays on sbh in
  `src-p5/docs/audits/performance-1000-users/execution/p4db/profile/`.

## Files

- `bench/`: the A, A2 and B copies, the unchanged harness, `run-all.sh`, `analyze.mjs`, `weakmap-op-cost.mjs`,
  `profile-top.mjs`.
- `results/run1.json` to `run6.json`: raw harness output, with every per-replay ns per update.
- `logs/run1.log` to `run6.log`: per-run receipt (date, label order, load average before and after, sibling
  containers, file hashes, harness stdout, `time`, exit code). `logs/analyze.txt`, `logs/weakmap-op-cost.log`,
  `logs/profile-B.log` and its harness output `logs/profile-B-out.json`, `logs/driver.out`.
- Containers: 8 created (`wa-fable-p4db-1` to `-8`), all with `--rm`. `docker ps -a --filter name=wa-fable-p4db`
  counts 0 left after the last run. The sibling `wa-fable-clean-*` and `wa-fable-ovw-*` containers belong to
  other jobs and were not touched.
