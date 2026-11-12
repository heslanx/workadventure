# Server bench loop: pusher and back under N headless sessions (knc, 2026-11-12)

Goal: WorkAdventure must scale toward 1,000 simultaneous users at controlled server cost, and eight people in one room
must not freeze. This loop measures the server side (pusher in `play/src/pusher`, and `back`) with the repository's
headless load generator, and promotes only the best measured safe variant.

## Verdict

- **Promoted, V3** (`v3-coalesce-group-updates.patch`, on top of V1, which HEAD already carries as `a589e9fdf`). At
  N=500 in one room, the pusher's event-loop lag p99 fell from 896 ms (V1, median of 3, range 576 to 2695) to 518 ms
  (range 482 to 520); every V3 run is below every V1 run, which with 3 runs per side is an exact rank-sum p of 0.10.
  Received bytes per session-second fell 15% (5277 to 4470, disjoint ranges) and `userMovedMessage` delivered per
  session-second rose from 91.5 to 97.7 (disjoint ranges). Correct in 3/3 runs; 34 pusher test files (279 tests) pass on
  the V3 tree, and the new test fails 2 of 5 cases on V1's code. The limiter did not move: the pusher stays CPU-bound
  at its 0.65-core cap, so CPU per session-minute is the cap divided by N for every variant at N=500. At N=250, where
  the pusher is not saturated, received bytes per session-second fell 16% (3031 to 2559, disjoint ranges); pusher CPU
  per session-minute was 0.0722 against 0.0769 for the three V1 runs interleaved with it (0.0832 over all six V1
  runs), but the ranges overlap ([0.0654..0.0773] vs [0.0731..0.0950]), so no CPU saving is claimed at that size.
- **V1** (`a589e9fdf`, already in HEAD): no measurable difference from the baseline at N=250 (pusher CPU per
  session-minute 0.0832 over 6 runs vs 0.0893 over 3, overlapping ranges) or at N=500 (lag p99 896 vs 1403 ms, overlapping ranges). The
  profile explains why: viewport handling is 1.2% of the pusher's CPU at N=500 with V1 in place, so V1 can save at most
  a few percent end to end. At N=100 it reads 0.0799 vs 0.0764 CPU-s per session-minute, with overlapping ranges
  ([0.0666..0.0968] vs [0.0700..0.1065]).
- **V2** (quota-aware back CPU tracker, back at 0.65 CPU): not promoted. The tracker read the 0.65-core quota
  (`CPU tracker: percentages are relative to 0.65 core(s), from cgroup v2 /sys/fs/cgroup/cpu.max`) and entered overheat
  2, 9 and 1 times in its three runs (V1's one-core tracker: 1, 2, 0; the transitions happen during the join ramp, when
  the back bursts). It made no measurable difference: the back used 0.05 to 0.06 of its 0.65 cores in the steady window
  and is not the limiter; the pusher is. Lag p99 885 ms vs V1's 896; join p95 9060 ms vs 2367 with overlapping ranges
  (5369 to 15242 vs 1906 to 11867), so the join difference is inside the noise. Its value is a correct overload signal
  when the back is the bottleneck, which this one-room setup does not produce.
- **V4 to V6 not run.** The profile points at one lever larger than V3: the pusher encodes the same sub-message once per
  listening socket (`PusherToFrontWebSocketMessage.encode` of each 100 ms batch, 54% inclusive, plus most of the 22%
  GC). Encoding each sub-message once per tick and splicing the bytes into every listener's batch is not a small
  one-hypothesis change, and the time budget ended first.

## Baseline (master `ddbe245a8`, dev mode, knc)

| N, rooms | Pusher CPU-s / session-min | Back CPU-s / session-min | Pusher cores (cap 0.65) | Join p95 ms | Received B / session-s | Pusher lag p99 ms | Back lag p99 ms | Generator cores (cap 1.2), lag p99 |
|---|---|---|---|---|---|---|---|---|
| 100, 1 | 0.0764 [0.0700..0.1065] | 0.0309 [0.0284..0.0373] | 0.127 [0.117..0.177] | 34.3 [28.4..48.1] | 1232 [1223..1234] | 21.7 [17.1..39.3] | 15.3 [13.7..20.3] | 0.065, 4.8 ms |
| 250, 1 | 0.0893 [0.0753..0.0950] | 0.0205 [0.0181..0.0233] | 0.372 [0.314..0.396] | 168 [34..704] | 2999 [2974..3046] | 42.8 [28.4..47.7] | 13.0 [12.1..13.4] | 0.127, 5.1 ms |
| 500, 1 | 0.0777 [0.0775..0.0779] | 0.0069 [0.0053..0.0069] | 0.648 [0.646..0.649] | 4456 [2034..4605] | 5589 [5076..5743] | 1403 [599..1734] | 22.3 [19.7..24.4] | 0.152, 4.0 ms |
| 500, 4 (125 per room), 1 run | 0.0493 | 0.0113 | 0.411 | 101 | 1259 | 49.3 | 14.6 | 0.140, 4.1 ms |

Median of 3 interleaved runs, [min..max]; every run passed the correctness gate. What limits each:

- **N=100 and N=250.** Nothing saturates. The pusher uses 0.13 and 0.37 of its 0.65 cores, the back 0.05 to 0.10.
  CPU per session-minute here is the work itself. It grows 17% from N=100 to N=250 (0.0764 to 0.0893) while each
  session receives 2.5x more moves (21 to 51.5 `userMovedMessage` per session-second), so a per-socket cost that does
  not scale with the room (the 100 ms batch timer, one encode and one send per batch, keep-alive) is most of it at
  these sizes (inferred from the N=500 profile's shape; not profiled at N=100 or N=250).
- **N=500, one room.** The pusher is CPU-bound at its cap (0.646 to 0.649 cores; the cgroup throttled it in 307 to 322
  CFS periods of a window about 31 s long, so in nearly every 100 ms period) and its event loop lags 0.6 to 1.7 s at
  p99, which is the freeze users feel. The back idles (0.04 to 0.06 cores). The generator uses 0.15 of its 1.2 cores with event-loop lag p99 4.0 ms (at most 20.6 ms in any
  N=500 run), so it is not the limit. The pusher's CPU per session-minute (0.0777) is its cap divided by N, not a work measure; at this size
  the comparison metrics are lag, join latency and delivered messages.
- **N=500 in 4 rooms of 125.** The same 500 sessions cost the pusher 0.41 cores, unsaturated, with lag p99 49 ms and
  join p95 101 ms (one run). Cost follows the size of a room, not the number of users on the server: fan-out inside
  one room is what saturates the pusher. V3 in the same shape (one run): 0.387 cores, lag p99 44 ms, join p95 48 ms,
  31% fewer group updates (501,821 vs 725,767); one run per side, so no difference is claimed.
- **Untuned.** Dev mode (`tsx watch`, `NODE_ENV=development`, inspector open) and 0.65-core caps, identical for every
  variant. Absolute numbers are not production capacity. A production build would likely move the saturation point (a guess, not measured).
- **Host noise.** knc ran production and other agents (load average 1.0 to 5.8 at the start of the measured runs,
  43 to 46 other running containers; one attempt at 9.3 was aborted by the guard). Join p95 at N=500 is the noisiest metric (range 536 to 15242 ms across all variants): joins queue behind
  a saturated pusher, so their tail follows whatever else holds the host's CPUs during the 50 s ramp.

## Variant table

Generated by `summarize.mjs` (`variant-table.md`). Median [min..max] over the runs listed; profile runs excluded.

| Variant | Hypothesis | Command | N x rooms | Runs | Pusher CPU-s / session-min | Back CPU-s / session-min | Pusher cores (cap 0.65) | Join p95 ms | Received B / session-s | Pusher lag p99 ms | Back lag p99 ms | Generator cores (cap 1.2) | Correct? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base: master `ddbe245a8` | baseline | `run-one.sh base 100 1 <rep>` | 100 x 1 | 3 | 0.0764 [0.0700..0.1065] | 0.0309 [0.0284..0.0373] | 0.1270 [0.1170..0.1770] | 34.30 [28.40..48.10] | 1232 [1223..1234] | 21.70 [17.10..39.30] | 15.30 [13.70..20.30] | 0.0650 [0.0520..0.0680] | 3/3 |
| base: master `ddbe245a8` | baseline | `run-one.sh base 250 1 <rep>` | 250 x 1 | 3 | 0.0893 [0.0753..0.0950] | 0.0205 [0.0181..0.0233] | 0.3720 [0.3140..0.3960] | 168 [33.80..704] | 2999 [2974..3046] | 42.80 [28.40..47.70] | 13.00 [12.10..13.40] | 0.1270 [0.1260..0.1420] | 3/3 |
| base: master `ddbe245a8` | baseline | `run-one.sh base 500 1 <rep>` | 500 x 1 | 3 | 0.0777 [0.0775..0.0779] | 0.0069 [0.0053..0.0069] | 0.6480 [0.6460..0.6490] | 4456 [2034..4605] | 5589 [5076..5743] | 1403 [599..1734] | 22.30 [19.70..24.40] | 0.1520 [0.1430..0.1590] | 3/3 |
| base: master `ddbe245a8` | baseline | `run-one.sh base 500 4 <rep>` | 500 x 4 | 1 | 0.0493 [0.0493..0.0493] | 0.0113 [0.0113..0.0113] | 0.4110 [0.4110..0.4110] | 101 [101..101] | 1259 [1259..1259] | 49.30 [49.30..49.30] | 14.60 [14.60..14.60] | 0.1400 [0.1400..0.1400] | 1/1 |
| v1: `a589e9fdf` zone-reconciliation shortcut | lower pusher CPU per moving session | `run-one.sh v1 100 1 <rep>` | 100 x 1 | 3 | 0.0799 [0.0666..0.0968] | 0.0344 [0.0281..0.0373] | 0.1330 [0.1110..0.1610] | 117 [50.10..170] | 1231 [1231..1236] | 13.40 [12.40..29.70] | 12.80 [11.90..20.60] | 0.0640 [0.0560..0.0650] | 3/3 |
| v1: `a589e9fdf` zone-reconciliation shortcut | lower pusher CPU per moving session | `run-one.sh v1 250 1 <rep>` | 250 x 1 | 6 | 0.0832 [0.0731..0.0950] | 0.0190 [0.0164..0.0201] | 0.3470 [0.3050..0.3960] | 56.85 [26.70..205] | 3031 [2995..3056] | 41.85 [31.80..87.60] | 15.60 [13.20..23.00] | 0.1280 [0.1100..0.1400] | 6/6 |
| v1: `a589e9fdf` zone-reconciliation shortcut | lower pusher CPU per moving session | `run-one.sh v1 500 1 <rep>` | 500 x 1 | 3 | 0.0776 [0.0775..0.0779] | 0.0070 [0.0062..0.0072] | 0.6460 [0.6450..0.6490] | 2367 [1906..11867] | 5277 [4960..5514] | 896 [576..2695] | 21.50 [21.00..23.50] | 0.1690 [0.1470..0.1750] | 3/3 |
| v2: V1 + quota-aware back CPU tracker (`cpu-quota-aware.v2.patch`), back 0.65 CPU | overheat triggers movement shedding at N=500 | `run-one.sh v2 500 1 <rep>` | 500 x 1 | 3 | 0.0773 [0.0769..0.0779] | 0.0065 [0.0060..0.0073] | 0.6440 [0.6410..0.6490] | 9060 [5369..15242] | 5211 [4454..5355] | 885 [604..1484] | 19.60 [18.10..26.40] | 0.1520 [0.1510..0.1580] | 3/3 |
| v3: V1 + `v3-coalesce-group-updates.patch` | fewer group updates to encode per batch lowers pusher CPU and lag | `run-one.sh v3 250 1 <rep>` | 250 x 1 | 3 | 0.0722 [0.0654..0.0773] | 0.0177 [0.0166..0.0185] | 0.3010 [0.2720..0.3220] | 26.80 [24.00..193] | 2559 [2235..2618] | 35.80 [27.60..39.40] | 13.90 [13.10..14.00] | 0.1080 [0.0930..0.1180] | 3/3 |
| v3: V1 + `v3-coalesce-group-updates.patch` | fewer group updates to encode per batch lowers pusher CPU and lag | `run-one.sh v3 500 1 <rep>` | 500 x 1 | 3 | 0.0771 [0.0766..0.0774] | 0.0080 [0.0079..0.0084] | 0.6430 [0.6380..0.6450] | 748 [536..5103] | 4470 [4382..4495] | 518 [482..520] | 17.30 [16.90..21.50] | 0.1510 [0.1490..0.1510] | 3/3 |
| v3: V1 + `v3-coalesce-group-updates.patch` | fewer group updates to encode per batch lowers pusher CPU and lag | `run-one.sh v3 500 4 <rep>` | 500 x 4 | 1 | 0.0465 [0.0465..0.0465] | 0.0103 [0.0103..0.0103] | 0.3870 [0.3870..0.3870] | 48.10 [48.10..48.10] | 1102 [1102..1102] | 43.60 [43.60..43.60] | 13.70 [13.70..13.70] | 0.1280 [0.1280..0.1280] | 1/1 |

Generator check for every N=500 run (questions 4 and 7 of the benchmark checklist): accepted 500, `reconciled: true`,
no errors, no unexpected closes, about 34,500 `userMovesMessage` sent per run (500 sessions at 1 Hz over the run minus
the ramp), and 85 to 98 `userMovedMessage` received per session-second, so the moves reached the server and came back.
Per run, from the generator summaries:

| Runs | `groupUpdateMessage` / session-s | `userMovedMessage` / session-s | Frames / session-s |
|---|---|---|---|
| base N=500 | 87.5, 80.3, 91.3 | 96.3, 90.2, 96.8 | 2.7, 2.1, 3.1 |
| V1 N=500 | 87.3, 75.3, 82.8 | 91.5, 88.4, 93.8 | 3.0, 2.3, 3.2 |
| V2 N=500 | 80.2, 63.8, 82.6 | 94.6, 84.9, 95.1 | 2.8, 1.7, 3.3 |
| V3 N=500 | 49.1, 51.2, 51.1 | 96.6, 97.7, 98.4 | 3.8, 3.9, 4.1 |

V3 sends 38% fewer group updates. The pusher then spends less of its capped CPU encoding them, flushes batches closer
to the 100 ms schedule (more, smaller frames), and delivers more of the moves within the run. The back used 0.066 to
0.070 cores in V3 runs against 0.052 to 0.060 in V1 runs; it stays far from its cap, and why it rose is not measured
(a guess: the less-lagged pusher drains the back's streams sooner).

## Promotion gate (benchmark-optimization-loop)

| Gate | V3 |
|---|---|
| Correctness tests pass | 3/3 runs pass the generator gate; `tests/pusher/` 34 files, 279 passed, 10 skipped on `bench-v3` (`receipts/unit-v3-pusher-suite.txt`, run at 0.1 CPU during the matrix); the new `PusherWebSocketBatch.test.ts` passes on V3 and fails 2 of 5 on V1's code (`receipts/unit-v3-test-on-v1.txt`); V1 and V2's own tests: `receipts/unit-v1-v2-before-matrix.txt` |
| Delta repeated or explained | repeated in 3 interleaved runs with disjoint ranges on lag p99, received bytes and delivered moves; explained by the profile (encode-bound pusher) and the 38% drop in group updates |
| Rollback obvious | one file and one test: `git apply -R v3-coalesce-group-updates.patch` |
| Encoded in source control or a runbook | `v3-coalesce-group-updates.patch` (`git -C <checkout> apply --check` passes on HEAD `623cc91f8`); this directory's scripts re-run the matrix |
| Exact commands and measurements | below and in `ledger.tsv` |

Not covered: `npm run typecheck` and lint of the play package were not run on the V3 tree (vitest strips types); the
coordinator should run them before landing the patch.

## Profiles (V1, N=500, one room)

Run `v1-n500-r1-2-prof`: 20 s CPU profile at 1 ms sampling through the dev inspector, inside the steady window, both
processes at once. Not a reported measurement (the profiler costs CPU). Files: `profiles/v1-n500-pusher.cpuprofile`,
`profiles/v1-n500-back.cpuprofile`; top frames in `profiles/top-frames-v1-n500.txt`.

The pusher was busy in 97.9% of samples. Top self time:

| Self | Frame |
|---|---|
| 21.9% | garbage collector |
| 17.2% | `BinaryWriter.finish` (`@bufbuild/protobuf` wire/binary-encoding.js:92) |
| 13.4% | ts-proto `encode` (`libs/messages/src/ts-proto-generated/messages.ts`) |
| 8.6% | `BinaryWriter.raw` (binary-encoding.js:151) |
| 6.1% | uWebSockets `send` (native) |
| 4.3% | `BinaryWriter.join` (binary-encoding.js:125) |
| 2.7% | `TextEncoder.encode` (node:internal/encoding) |
| 1.5% | `Zone.isListeningZone` |
| 1.2% | `Zone.notifyUserMove` |

Inclusive (`inclusive.mjs`): `PusherWebSocket.flushBatch` 53.9%, of which `PusherWebSocket.send` 53.7% (the
`PusherToFrontWebSocketMessage.encode` of each socket's 100 ms batch, then the uWS send, 6.1%). Viewport handling
(`SocketManager.handleViewport`, V1's target) is 1.2% inclusive with V1 in place; zone fan-out (`Zone.handleUserMoved`)
2.7%. So the pusher spends half of its CPU, plus most of the 22% GC, encoding the same sub-messages once per listening
socket.

The back was busy in 6.5% of samples (top frame `SpatialMap.queryCircle`, 0.8%). It is not the limiter at N=500 in
one room.

What the generator received in that run explains the encode volume: per session-second about 84
`userMovedMessage` and 78 `groupUpdateMessage`. The bots stand on one ellipse close enough to form bubbles, and every
move of a bubble member makes the back send a `groupUpdateMessage` (position, size, user ids) to every listener of the
zone. The client applies a whole batch in one frame (`GameScene.pendingEvents` is drained in `update()`), and
`doShareGroupPosition` no longer uses the group position to draw the bubble, so every update of a group but the last
in a 100 ms batch is invisible to the user. V3 drops them in the batch.

## Method

**Stack.** One stack at a time on `knc` (4 vCPU, 15 GB, shared with production and other agents), recreated from
`../P1/stack/` under task names: `wa-fable-bench-{play,back,redis,maps}` on network `wa-fable-bench-net`, label
`owner=wa-fable-20261112`, no published ports, `--cpu-shares 512`, json logs capped. Dev mode as in P1 for every
variant (`npm run dev-pusher` and `npm run dev`: `tsx watch`, `NODE_ENV=development`, inspector on `:9229` inside the
network). Caps: pusher 0.65 CPU / 1536 MB, back 0.65 / 1536 MB, redis 0.10 / 256 MB, maps nginx 0.10 / 128 MB; the
generator container 1.2 CPU / 1536 MB. Total 2.7 cores (cap 2.8). The unit-test containers ran at 0.1 CPU while a
measurement was running, and at 1 CPU only before the matrix started. Compose file: `docker-compose.bench.yaml`.

**Trees.** `setup-trees.sh` builds them on knc under `~/wa-jobs/wa-fable-20261112/`:

| Tree | Content |
|---|---|
| `bench-base` | `git archive ddbe245a8` plus the generated `libs/messages/src/ts-proto-generated` and `play/src/i18n/i18n-*.ts` from the checkout, `node_modules` hard-linked from `src-cpu` |
| `bench-v1` | base plus `a589e9fdf`'s `PositionDispatcher.ts` and its test (the only back/pusher difference between `ddbe245a8` and HEAD) |
| `bench-v2` | V1 plus `docs/audits/eight-user-performance/execution/2026-11-12/W3/round2/cpu-quota-aware.v2.patch` (the commit had not landed) |
| `bench-v3` | V1 plus `v3-coalesce-group-updates.patch` (this loop) |
| `bench-genpkg` | HEAD's `benchmark/` (generator from `cf2e43dac`), mounted over the base tree's `benchmark/` for every variant |

**One run** (`run-one.sh <variant> <N> <rooms> <rep>`). Record the 1-minute load average and the number of running
containers not named `wa-fable-bench-*`; abort and halt the loop (`STOP` file) if the load average exceeds 6. Start a
fresh stack, wait for `/ready`, `/ping-backs` and the back's `:9100/metrics`. Start the generator with
`WA_SESSIONS=N`, `WA_RAMP_SECONDS=max(10, N/10)`, `WA_MOVE_HZ=1`, `WA_DURATION_SECONDS=ramp+45`,
`WA_JOIN_TIMEOUT_SECONDS=60`. After ramp + 10 s, sample every container's cgroup v2 `cpu.stat` (`usage_usec`,
`nr_throttled`), its `eth0` byte counters, and the pusher's and back's `:9100/metrics`; sample again 30 s later. That
30 s is the steady window. prom-client resets its event-loop histogram on each scrape, so the second scrape's
`nodejs_eventloop_lag_p99_seconds` covers the window only. Wait for the generator, keep its summary and the logs, tear
the stack down.

**Matrix** (`matrix.sh plan.txt`). Drains `plan.txt` one line at a time and re-reads it after every run, so lines can be
appended while it runs. Configurations are interleaved round-robin and the starting side alternates by rep. Before each
run it waits at most 60 s for the load average to fall to 6, which lets the loop's own previous run decay out of the
1-minute average; co-tenant load that stays above 6 still aborts the run. `resume.sh` restarts a halted matrix only after
two samples below 6, 10 s apart, and moves aborted run directories to `bench-out/aborted/`.

**Metrics** (`summarize.mjs bench-out .` writes `ledger.tsv` and `table.tsv`).

| Column | Definition |
|---|---|
| `pusherCpuSPerSessionMin`, `backCpuSPerSessionMin` | cgroup `usage_usec` delta over the steady window / (N x window minutes) |
| `pusherCoresUsed`, `backCoresUsed` | the same delta / window seconds; 0.65 is the cap |
| `joinP95Ms` | generator, token request to `roomJoinedMessage`, all N sessions |
| `recvBytesPerSessionS` | generator received bytes / (N x (wall - ramp/2)), whole run |
| `pusherTxBytesPerSessionSWindow` | pusher `eth0` tx bytes over the window / (N x window seconds) |
| `userMovedRecvPerSessionS` | generator `userMovedMessage` count / session-second, whole run |
| `pusherLagP99Ms`, `backLagP99Ms` | `nodejs_eventloop_lag_p99_seconds` scraped at the end of the window |
| `genCoresUsedWindow`, `genLagP99Ms` | generator cgroup CPU over the window; generator event-loop lag p99 over the run |
| `correct` | `reconciled: true`, accepted = N, `errors` empty, `unexpectedCloses` 0 |

## Commands

```bash
# From the Mac, repository root: build the trees and copy the scripts.
bash docs/audits/performance-1000-users/execution/bench-loop/setup-trees.sh
# On knc: run the matrix (re-runnable; delete a run directory under bench-out/ to re-run it).
ssh knc 'cd ~/wa-jobs/wa-fable-20261112/bench-loop && nohup bash matrix.sh plan.txt > ../bench-out/matrix.log 2>&1 < /dev/null &'
ssh knc 'cd ~/wa-jobs/wa-fable-20261112/bench-loop && WAIT_S=1200 bash resume.sh'   # after a load-guard halt
# Back on the Mac: ledger and table.
rsync -a --exclude '*.cpuprofile' knc:wa-jobs/wa-fable-20261112/bench-out/ /tmp/wa-bench-out/
node docs/audits/performance-1000-users/execution/bench-loop/summarize.mjs /tmp/wa-bench-out docs/audits/performance-1000-users/execution/bench-loop
# Profiles: a plan line with mode "profile" attaches to the dev inspector (cdp-prof.mjs) for 20 s in the steady window.
node docs/audits/performance-1000-users/execution/bench-loop/topframes.mjs profiles/v1-n500-pusher.cpuprofile 25
node docs/audits/performance-1000-users/execution/bench-loop/inclusive.mjs profiles/v1-n500-pusher.cpuprofile '^(flushBatch|send)$'
```

One run's generator command, as `run-one.sh` issues it (N=500, one room):

```bash
docker run -d --name wa-fable-bench-gen --label owner=wa-fable-20261112 --cpus 1.2 --cpu-shares 512 --memory 1536m \
  --network wa-fable-bench-net --tmpfs /tmp \
  -v ~/wa-jobs/wa-fable-20261112/bench-base:/work:ro -v ~/wa-jobs/wa-fable-20261112/bench-genpkg/benchmark:/work/benchmark:ro \
  -v ~/wa-jobs/wa-fable-20261112/bench-out/<run>:/out -w /work/benchmark \
  -e WA_PUSHER_URL=http://wa-fable-bench-play:3000 -e WA_WS_URL=ws://wa-fable-bench-play:3001 \
  -e WA_ROOM_URLS=http://wa-fable-bench-play:3000/_/global/wa-fable-bench-maps/starter/map.json \
  -e WA_API_VERSION=dev -e WA_OUTPUT=/out/summary.json -e WA_SESSIONS=500 -e WA_RAMP_SECONDS=50 \
  -e WA_DURATION_SECONDS=95 -e WA_MOVE_HZ=1 -e WA_JOIN_TIMEOUT_SECONDS=60 \
  node:24-trixie /work/node_modules/.bin/tsx ./index.ts
```

The 4-room runs use `WA_ROOM_URLS` with instances `/_/room1/` to `/_/room4/` on the same map.

## Aborted and invalid attempts

| Attempt | What happened | Kept in |
|---|---|---|
| `base-n100-r1-1` at 02:31 | load guard: load average 9.33 > 6 (production gateway restart and other agents' containers); the matrix halted, `resume.sh` restarted it at 02:36 when two samples were below 6 | `bench-out/aborted/base-n100-r1-1-023610` |
| `v1-n250-r1-1` at 02:41 | invalid, caused by this agent: `cp -al bench-v1 bench-v1t` during the run changed the link count of the V1 tree's files, `tsx watch` saw a change in `PositionDispatcher.ts` and restarted the pusher; all 250 sockets closed with 1006. Re-run at 02:46 | `bench-out/aborted/v1-n250-r1-1-invalid-tsx-restart` |
| `v1-n500-r1-1-prof` | profile files lost (`docker cp` cannot read a tmpfs); its numbers are in the ledger as a profile run, not used | ledger row |

Rule learned: in dev mode, do not create, delete or hard-link bench trees while a stack runs, because every tree shares
inodes with `bench-base` and `tsx watch` restarts on attribute changes. `summarize.mjs` marks a run incorrect when the
pusher or back log shows `Restarting...`.

## Files

| File | Content |
|---|---|
| `ledger.tsv` | one row per run, including the two profile runs; the aborted and invalid attempts are in the section above, not in the ledger |
| `receipts/` | unit-test outputs for V1, V2 and V3 |
| `variant-table.md` | the skill's variant table, generated by `summarize.mjs` |
| `table.tsv` | medians and ranges per variant, N and rooms, more columns than the variant table |
| `v3-coalesce-group-updates.patch` | promoted change: `play/src/pusher/services/PusherWebSocket.ts` and the new `play/tests/pusher/PusherWebSocketBatch.test.ts` |
| `profiles/` | the V1 N=500 CPU profiles and their top frames |
| `plan.txt`, `matrix.sh`, `run-one.sh`, `resume.sh`, `docker-compose.bench.yaml`, `cdp-prof.mjs`, `setup-trees.sh`, `teardown.sh` | the re-runnable matrix |
| `summarize.mjs`, `topframes.mjs`, `inclusive.mjs` | ledger, table and profile readers |

Raw run directories (generator summary, cgroup and metrics samples, logs) stay on knc in
`~/wa-jobs/wa-fable-20261112/bench-out/`, the trees in `~/wa-jobs/wa-fable-20261112/bench-*`.
