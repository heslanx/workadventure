# Performance

Measured performance state of Koncluí (a WorkAdventure fork) for the goal of 1000 live participants in one world without stalls in movement, audio or video. Phase 1 of the architecture-optimization journey (performance net and ledger). Written 2026-11-18 at HEAD `700362b82` with an uncommitted working tree. Refreshed 2026-11-19 at `a0fc2bf18`, where that tree is committed: the rows that were pending now carry their commit. Refreshed again 2026-11-19 at `47865006b`: four engine commits after `a0fc2bf18` (C5 slice c, C1 slice 3, C3 slice 1b back half, C2 slice 1) have ledger rows. All four are unit-harness numbers: none has a load run or a browser frame-time run, and the three flags (`PUSHER_VIEWER_BUDGET_ENABLED`, `WORLD_HEADCOUNT_ENABLED`, the `avatarDetailBudget` override) are off by default. Refreshed a third time 2026-11-19 at `75db31b6d`: the section "Budgets as tests" and one ledger row (`75db31b6d`) were added; no new measurement was made.

Claim labels: MEASURED is a number from a log, report or test. DERIVED is arithmetic over measured numbers. HYPOTHESIS has no measurement yet and names the check that would settle it. Budgets are DECIDED by the coordinator. "Proposed here" marks a budget that no plan or decision file states and that this document supplied, so the coordinator may overrule it.

Times are CET (UTC+1), as in BASE; each report's `startedAt` is UTC (the 1000 run is `2026-11-17T17:43:40Z`).

Path shorthand used in every source citation:

| Short | Path |
|---|---|
| EV | `/Users/erickheslan/.claude/orchestrate/konclui-native/evidence` (outside git; numbers are copied inline below and the path is provenance only) |
| PERF | `EV/perf` |
| BASE | `PERF/baseline-2026-11-17.md` |
| PLAN | `EV/engine-1000-plan.md` |
| DEC | `docs/konclui-migration/decisions.md` (in git; sections C1 to C5) |
| BENCH | the `bench` key of `EV/decisions/decide-and-map-2026-11-18.json` |

## Phase 1 gate

**Verdict: PARTIAL.** A measurement net exists for four of the five hot flows, but no valid 1000-person run has ever completed.

Why the gate stays open:

1. The only 1000 run (2026-11-17 18:42) predates seven landed optimizations and the commits after `700362b82` that change the pusher, the scene, the media cap and the counters, so no current 1000 baseline exists (see Load Reality). Four engine commits landed after `a0fc2bf18` (`0ff4a395d`, `aab3487b1`, `7a37a5178`, `47865006b`); none changes that count, since three sit behind flags that are off and the fourth only matters when a stream is thinned.
2. The client frame has never been measured with more than 300 avatars or at whole-map zoom (DEC `decisions.md:74`, "All measurements are default zoom only").
3. The frame probe lives in `.local/konclui/qa/frame-probe/probe.mjs`, which is ignored by git (`.gitignore:35` is `/.local/`; `git ls-files .local` is empty). A fresh checkout cannot reproduce the client numbers.
4. The back sheds moves above the CPU threshold. It had no counter: `back/src/Services/SocketManager.ts:300` returned silently, and the only log lines are on entering and leaving the mode (`back/src/Services/QuotaAwareCpuTracker.ts:328,331`). `7493dc8e3` added `workadventure_moves_shed_total` on the back scrape, so a run can no longer lose delivery silently. No real run has read it yet (BENCH finding; PLAN H1 asked for the counter).
5. Media (LiveKit, SFU) has no harness. DEC names `lk load-test` as the missing tool (`decisions.md:146`).

What is in place:

- Headless load generator `benchmark/` (`b7a9aed2c`, "187 tests" per its message). It reports move latency p50/p95/p99, delivery ratio, bytes per message type, known peers, a `--steady-window` and a `--metrics-urls` scrape (`benchmark/README.md:47-48,126-128,142`).
- `benchmark/scripts/load-staircase.sh` splits N bots over P staggered processes and marks a level invalid on a missing or aborted process, on generator CPU at 70% of a core or more, or on generator event-loop lag p99 above 10 ms (`benchmark/README.md:191,199-200`).
- Client frame recorder `e2eHooks.startFrameRecording` and `stopFrameRecording` (`2e2631fc0`, in git, tested by `play/tests/front/Utils/E2EHooksFrameRecorder.test.ts`).
- Vitest measurement files: `back/tests/SpaceUserLookup.bench.ts` and `back/tests/RoomSocketBatching.test.ts` (tracked), `play/tests/front/Phaser/Game/RemotePlayerCulling.test.ts:466-480` (tracked; 1000 avatars, 322 drawn) and `play/tests/front/Phaser/Game/RemotePlayerCullingCost.test.ts` (tracked since `e3aeb7bc2`), `back/tests/MovesShedCounter.test.ts` (`7493dc8e3`). The cost test counts DOM and scene work per frame, not milliseconds (its header).

The gate passes when a valid 1000 staircase exists on the Linux host and the items marked P1 in Next actions are done.

## Intake (decided)

The tracker `docs/ARCHITECTURE-OPTIMIZATION-PLAN.md` exists (`a0fc2bf18`) and its Intake table is the owner; this section is a copy. Operating rule from the user's standing instruction: decide, record, continue.

| Question | Decision |
|---|---|
| System and cost of slow | Koncluí, a WorkAdventure fork for a virtual office. Goal: 1000 live participants in one world without stalls in movement, audio or video. |
| Measured now | 100 and 300 bots hold. 1000 does not: 823 of 1000 accepted, delivery 0.468 (`PERF/load-1000.json`). |
| Hot flows | (a) pusher zone fan-out and move traffic, (b) back room batching and space state, (c) client scene with many remote avatars, (d) media pairing, (e) the Koncluí shell over the map. |
| Tests | Vitest per workspace, green at the last full gate (play 2473 tests on `75901117c`, `EV/qa/interactive-qa-2026-11-17.md:68-69`); a newer pass: play 3,156 tests in 396 files at `75db31b6d`, back 456 in 32 files at `5f9dbbef7` (MEASURED, commit messages). Playwright in `tests/`. |
| Stack | TypeScript, Svelte 5, Phaser 4, Node 24, uWebSockets pusher, gRPC and protobuf to the back, Redis, LiveKit. Local QA on Colima with 8 GB VM limits (`colima.yaml:3,13` per BENCH). |
| Load host | A Linux host with pusher and bots on one network. Never 1000 bots on this Mac or Colima. Open item (BASE, "1000 bots"). |
| Scope | All 8 phases. Phases 2 and 3 audit first (the Koncluí seam already has an enforced domain graph in `play/src/front/Konclui/architecture.test.ts`). Phases 5 and 6 are carried by the engine plan items C1 to C5. Phase 1 is a gate. |

## Baselines & Budgets

Baseline conditions unless a row says otherwise: bots walk a fixed ellipse at 5 moves/s (the browser rate, `POSITION_DELAY` 200 ms, DEC `decisions.md:173`), 640x400 viewport, 20 observers, ramp 20 s inside a 60 s run (`--duration-seconds` includes the ramp, `benchmark/README.md:77`; `wallSeconds` 60.0 in `baseline-300.json`), so about 40 s at full population (BASE writes "60 s steady"; the report config contradicts it), local QA stack on the Mac with load average 5.6 to 8 (BASE header). Absolute latencies are indicative; the ratio between runs is the signal. Every baseline is MEASURED unless the cell says DERIVED. All walkers walk all the time, but the budgets below are set at 1000 dense with 20% walking (DEC `decisions.md:61`), so a budget row and its baseline row are not yet the same workload.

Reconciliation, DECIDED: DEC C5 said "at most 0.10 core per 100 users" and, in the same sentence, "about 60% of a core at 1000" (`decisions.md:166`). They disagree, since 0.10 per 100 users is 1.0 core at 1000. The 0.7-core budget of DEC C1 (`decisions.md:61`) governs, and 1.0 core is the saturation line. The C5 text carries the 0.7-core figure and a budget note since 2026-11-19.

### (a) Pusher zone fan-out and move traffic

Tool of record: `benchmark/` generator through `benchmark/scripts/load-staircase.sh` on the Linux host, with `--metrics-urls` and `--steady-window`. Gate: run valid (no rejected session, generator CPU under 70%).

| Metric | Baseline (date, source) | Budget | Gate |
|---|---|---|---|
| Move latency p95, dense room | 113 ms at 300 bots after `605fec17b` (11-17 19:10, `PERF/pusher-300-after.json`). 164 ms before it (11-17 18:16, `PERF/baseline-300.json`). 3,157.8 ms at 1000 with 823 accepted (11-17 18:42, `PERF/load-1000.json`). | 250 ms at 1000 (DEC `decisions.md:61,166`; PLAN H-series) | A staircase level fails above it. |
| Move latency p50 and p99 | 62.3 and 131.5 ms at 300 (`pusher-300-after.json`). 199.1 and 4,428.8 ms at 1000 (`load-1000.json`). | p50 under 125 ms, p99 under 500 ms (proposed here) | Report only. |
| Delivery ratio | 0.9896 at 300 after, 0.9949 before (`pusher-300-after.json`, `pusher-300-before.json`). 0.468 at 1000 (`load-1000.json`). | At least 0.99 (DEC `decisions.md:61`; staircase default, `benchmark/README.md:191`) | Knee of the staircase. |
| Accepted sessions | 823 of 1000, 177 rejected (`load-1000.json`) | 1000 of 1000, 0 rejected | A rejected session invalidates the level (`benchmark/README.md:199`). |
| Join latency p95 | 33.2 ms at 300 (`baseline-300.json`). 5,178.9 ms at 1000 (`load-1000.json`). | 1,000 ms at 1000 (proposed here) | Report. |
| Pusher CPU (docker %, 100 = one core) | Steady median 65% before and 35% after at 300 (BASE, "Pusher encodes each zone event once"). Whole-run median 60.1% before and 26.4% after (DERIVED from 16 samples in each of `pusher-300-before-stats.log` and `pusher-300-after-stats.log`). At 1000: six samples 36.5, 59.2, 94.3, 143.7, 124.3, 134.9% (`load-1000-stats.log`). | At most 70% of one core at 1000 dense with 20% walking (DEC `decisions.md:61`). Saturation line 100%. | `--metrics-urls` `cpuPercentOfOneCore` (`benchmark/README.md:126`). |
| Pusher RSS | 780.8 MiB of a 3 GiB cap at 823 bots (`load-1000-stats.log`). The cap is `mem_limit: 3g` (`.local/konclui/qa/compose.yaml:36`, outside git). | At most 1.5 GB at 1000 (PLAN item 2.3, H3) | `--metrics-urls` RSS. |
| Downlink per client | 24.0 kbit/s at 100 bots and 89.0 kbit/s at 300 (DERIVED: `received.bytes` x 8 / `wallSeconds` / accepted sessions, from `baseline-100.json`, `baseline-300.json`; includes the ramp). | At most 50 kbit/s (DEC `decisions.md:166`), target 32 kbit/s (PLAN section 6, item 1). The per-viewer budget harness (`7a37a5178`, flag off) reads 144 kbit/s of move bytes for one viewer at 100% walking (DERIVED, see the Ledger), so this budget is not yet shown to hold | `kbitPerSecondPerSession` in the report `traffic` block (`benchmark/README.md:115`). |
| Delivered moves in 60 s | 502,382 at 100 and 4,711,110 at 300 (`baseline-100.json`, `baseline-300.json`) | Informational | Per-type bytes from the report. |

Growth shape (DERIVED from `baseline-100.json` and `baseline-300.json`): 3x the bots gives 11.1x the bytes (200.4 MB over 18.0 MB), 9.4x the moves and 18.6x the group updates (BASE, "Reading"). That is quadratic growth, as the plan predicted.

### (b) Back room batching and space state

Tool of record: the staircase scrape for CPU and event-loop lag, plus vitest harnesses for the per-operation numbers.

| Metric | Baseline (date, source) | Budget | Gate |
|---|---|---|---|
| Back CPU | 4.6% to 18.7% at 823 bots (`PERF/load-1000-stats.log`). Not the bottleneck. | At most 50% at 1000 and no `Going in "overheat" mode` log line (proposed here). The shed line is `CPU_OVERHEAT_THRESHOLD`, default 80 (`back/src/Enum/EnvironmentVariableValidator.ts:33-36`). | `--metrics-urls`, plus `workadventure_moves_shed_total` (`7493dc8e3`). |
| gRPC writes per RoomSocket | 1,687.5 per second at 300 moving users before, 20 after (`b323baca9` message; harness `back/tests/RoomSocketBatching.test.ts:278`) | 20 per second (50 ms batch, PLAN item 2.2) | `back/tests/RoomSocketBatching.test.ts`. |
| 999 space-user lookups (megaphone burst) | 23.6 ms and 54.2 ms before, 0.14 ms and 0.10 ms after (`back/tests/SpaceUserLookup.bench.ts:17-22`). Mac load average was about 200, so only the ratio is solid (same header). | Under 1 ms (PLAN item 5.2) | `vitest bench` on that file. |
| Back event-loop lag p99 | None recorded. The scrape supports it (`nodejs_eventloop_lag_p99_seconds`, `benchmark/README.md:128`). | At most 100 ms (proposed here) | The first staircase run sets the baseline. |

### (c) Client scene with many remote avatars

Tool of record: the frame probe (`.local/konclui/qa/frame-probe/probe.mjs`, to be moved into git) on `e2eHooks` frame recording. Headless Chromium on SwiftShader (CPU rendering, pessimistic) and on the Metal GPU (ANGLE, Apple M1 Max), viewport 1451x855, 5 s settle, 25 s recording on SwiftShader and 15 s on Metal (BASE). Plus `RemotePlayerCullingCost.test.ts` for DOM and scene work per frame.

| Metric | Baseline (date, source) | Budget | Gate |
|---|---|---|---|
| Frame work p50 / p95, SwiftShader | 0 bots: 0.7 / 0.9 ms (`PERF/client-frame-0.json`). 100 bots: 2.0 / 2.5 ms (`client-frame-after-100.json`, BASE "Cause and fix"). 300 bots: 7.7 / 8.6 ms with 114 name tags in the DOM (`client-frame-after-300.json`). Before the bubble fix: 188 / 844 ms at 100 and 9,327 / 17,356 ms at 300 (`client-frame-100.json`, `client-frame-300.json`). | p95 at most 16.7 ms with 200 visible avatars and at most 33.3 ms at 1000 (PLAN phase 3, H4) | Frame probe. |
| Frame work, Metal GPU, effects on | 300 bots: 7.4 / 8.5 ms, 901 frames in 15 s (BASE, "Scene effects ported", `57077c211`) | Same as above | Frame probe. |
| Long tasks over 50 ms | 0 at 100 and 300 after the fix (`client-frame-after-100.json`, `client-frame-after-300.json`) | 0, including the 2 s after a zoom (DEC C2 slice 0, `decisions.md:88`) | Frame probe. |
| Per-avatar slope | 62 us per present avatar (DERIVED, DEC `decisions.md:71`: 7.7 ms at 114 name tags minus 0.7 ms at 1). Extrapolates to about 62 ms at 1000 and about 20 ms at 322 drawn. HYPOTHESIS: step cost is 4.6 of the 7.7 ms (`client-frame-after-300.json`, `stepMs.p50`), and culling does not remove it. | Verify at whole-map and above 300 bots | DEC C2 slice 0 (not run). |
| Avatars drawn at 1000 over the office | 322 of 1000 drawn and 1,610 of 5,000 quads (`700362b82` message; `play/tests/front/Phaser/Game/RemotePlayerCulling.test.ts:466-480`) | Informational | That test. |
| Name-tag style writes per zoom notch, 1000 tags | 90,000 before and 17 after (`c5bd4ad97` message, MEASURED in a harness) | At most 20, the bound the test already pins (`MAX_STYLE_WRITES_PER_NOTCH`, `play/tests/front/Phaser/Components/UsernameDisplay.test.ts:18,169`) | That test. |

### (d) Media pairing

Tool of record: vitest strategy tests (`back/tests/WebRTCCommunicationStrategy.test.ts`). No SFU harness exists; `lk load-test` is open (DEC `decisions.md:146`).

| Metric | Baseline (source) | Budget | Gate |
|---|---|---|---|
| P2P start messages, 1 speaker and 999 watchers | 1,998 messages and 999 peer connections in the speaker's tab (DERIVED from code: `WebRTCCommunicationStrategy.ts:189-199` at `700362b82`; `850605bee` shifted these lines, DEC `decisions.md:137`; pinned since `850605bee` by the test "one speaker and 999 watchers", `back/tests/WebRTCCommunicationStrategy.test.ts:305-314`) | 6 with `MAX_P2P_PEERS=3` (DEC `decisions.md:155`; `back/tests/WebRTCCommunicationStrategy.test.ts:321-325`, `850605bee`) | The strategy test. |
| SFU load: cores, Gbps, join p95 and loss for one publisher and N listeners | Not measured. The only SFU numbers are the 2026-10-08 grid tests on a shared 3-vCPU VPS: 20 cameras fine, 40 cameras 44% loss (DEC `decisions.md:140`). They are not the one-publisher shape. | Open until the load test fills a table. DEC trigger: a dedicated node before any broadcast above about 200 listeners or any screen-share broadcast (`decisions.md:132`). | `lk load-test` at N = 50, 200, 1000 (`decisions.md:146`). |

### (e) Koncluí shell over the map

Tool of record: the frame probe with `konclui.fx.off` toggled.

| Metric | Baseline (source) | Budget | Gate |
|---|---|---|---|
| Scene effects, added frame work, Metal GPU, 0 bots | 0.8 to 0.9 / 1.6 to 1.8 ms off and 1.0 to 1.1 / 2.6 to 2.8 ms on (BASE, "Scene effects ported") | At most +2 ms p95 added (proposed here) | Frame probe, on versus off. |
| Effects on CPU rendering | 178 to 230 frames in 15 s on versus 430 to 488 off (SwiftShader, same table). The frame rate halves. | The lean preset or `konclui.fx.off` stays reachable (BASE, "Reading") | Manual check of the Performance pane. |
| Seated pose, per-frame cost, 50 to 1000 seated | 0.53 to 0.68 of the previous cost (`b7e754c64` message; Node measurement) | No regression | The differential test in that commit. |
| Shell DOM (Dock, Frame, side panels) | Not measured. | Set after a first probe. | Gap. |

## Load Reality

This is the single source for load numbers; `docs/ARCHITECTURE.md` cites this section. All numbers are MEASURED unless marked. Source for every row: `PERF/*.json` and BASE.

| Run | Bots | Result |
|---|---|---|
| 2026-11-17 18:16, `184e96848`, image `candidate-4adc365948de` | 100 | 100 accepted, join p95 36 ms, move p50/p95/p99 96/113/119 ms, delivery 0.9997, 18.0 MB, 502 k moves, 115 k group updates (`baseline-100.json`) |
| Same | 300 | 300 accepted, join p95 33 ms, move 90/164/181 ms, delivery 0.9951, 200.4 MB, 4.71 M moves, 2.13 M group updates (`baseline-300.json`) |
| 18:42, image `candidate-85fbe0a13024`, pusher cap 3 GiB, ramp 40 s inside a 45 s run (`config`, `wallSeconds` 45.0), so about 5 s at full population (BASE writes "45 s steady") | 1000 | 823 accepted, 177 rejected (socket hang up 91, closed before join 46, fetch failed 31, reset 6, plus 3 empty socket errors). All 823 accepted sessions closed with 1006 (969 close events in total, `closeCodes`). Join p95 5,178.9 ms. Move p50/p95/p99 199.1/3,157.8/4,428.8 ms. Delivery 0.468 (116,494 of 248,931). Pusher 135% at the last sample, back under 19% (`load-1000.json`, `load-1000-stats.log`). |
| 19:10, `605fec17b`, image `candidate-9400feaadbae` | 300 | Pusher CPU median 65% to 35%. Move p95 167 to 113 ms. Delivery 0.9949 to 0.9896. Bytes 197.4 to 207.0 MB (`pusher-300-before.json`, `pusher-300-after.json`, BASE). |

- **Workload shape.** Every bot walks the same ellipse at 5 moves/s. The 640x400 viewport sees about 236 of 1000 (DERIVED, BENCH; PLAN phase 0 "Today a bot sees 236 of 1000"). That is a worst-case stress, not a real office.
- **What the 1000 run left out.** A steady phase: the run lasted 45 s with a 40 s ramp (`load-1000.json`, `config`), so its latency and delivery mix ramp and full load. The world roster `allWorldUser`, which every browser joins (DEC `decisions.md:35`). Any walking fraction below 1 (DEC `decisions.md:178`: the bots always walk). Media, a GPU and a real browser. The report's own notice says the bots certify neither client rendering nor audio or video (`load-1000.json`, `notice`).
- **The 1000 run is stale.** Its image already had the bubble fix (`25685a03f`) and `63986e480`, `6b38839ef` and `6da6e7a0c`. It predates `605fec17b` (19:10 run), `b323baca9`, `1c9047960`, `34ec1cdc6`, `59dfb7cac`, `c5bd4ad97`, `700362b82` and the changes of `850605bee` (C4 cap), `8c6034a42` (C5 a and b), `e3aeb7bc2` (scene) and `7493dc8e3` (shed counter), then `0ff4a395d`, `aab3487b1`, `7a37a5178` and `47865006b` (C5 c, C3 1b back half, C1 slice 3 and C2 slice 1, all flag-gated or receiver-only). Treat it as a pre-optimization baseline, not a current result.
- **Environment.** The Mac load average was 5.6 to 8 during the 100 and 300 runs, 9 to 14 during the client runs and 22 to 37 during the effects runs (BASE). It was 299 on 10 cores at 02:09 on 2026-11-18 (BENCH). Bots reached the VM through one Lima ssh port forwarder (`colima.yaml:170` per BENCH) that also carries the Docker socket; the socket and every forwarded port died together at the end of the 1000 run (BASE, "1000 bots"). Those artifacts are why 1000 must run elsewhere.
- **Production concurrency.** HYPOTHESIS and a gap: no real concurrency, QPS or growth figure appears in the evidence. PostHog events `wa_game_performance` and `wa_room_connection` exist (`docs/observability.md:12-13`), but no values are recorded. Take a 30-day p50 and p95 of room population before sizing anything beyond the 1000 target.
- **Extrapolation.** HYPOTHESIS: 3.3 MB/s at 300 (200.4 MB over 60 s, `baseline-300.json`) times (1000/300)^2 = 11.1 gives about 37 MB/s through one forwarder (BENCH).
- **Next load step, DECIDED.** Run `benchmark/scripts/load-staircase.sh` with levels 300, 500, 700, 1000 and 4 staggered processes (`benchmark/README.md:178-180`), with `--repeat=3` where the script supports it, on a CI-pool job (runners `ci-host-1..4`, Contabo 16 vCPU / 62 GiB, `ci.slice` 10 cores / 20 GiB, BENCH). Use a pinned commit, not the dirty checkout. Add a start and end guard that prints `nproc`, `/proc/loadavg` and `/proc/pressure/cpu`, because production meeting bots share that host (BENCH: production noise on the host is unknown). Expect a saturated single pusher first and report that as the knee, not as a harness failure.

## Profile Findings

USE per resource, from the 1000 run (`PERF/load-1000-stats.log`, `PERF/load-1000.json`) unless noted. Utilization is how busy, saturation is queueing or loss, errors are counted failures.

| Resource | Utilization | Saturation | Errors |
|---|---|---|---|
| Pusher CPU | 134.9% at the last sample, max 143.65% (`load-1000-stats.log`) | Join p95 5.2 s and delivery 0.468 (`load-1000.json`). CPU-bound (BASE). | 177 rejected sessions, 969 close events at 1006 |
| Pusher memory | 780.8 MiB of 3 GiB, 25% (`load-1000-stats.log`) | None reached. HYPOTHESIS: the 30 s replay store would add 0.57 to 2.85 GB at 1000 (PLAN finding 5, itself derived). In this run saturation cut the delivered rate, so memory is understated. | None |
| Back CPU | 4.6% to 18.7% (`load-1000-stats.log`) | None visible. The back log was not captured, so overheat shedding is unknown. | Not recorded |
| Load generator | 18.8% of one core, event-loop lag p99 5.11 ms, max 81.16 ms (`load-1000.json`, `generator`) | Valid: below the 70% CPU and 10 ms lag p99 discard lines (`benchmark/README.md:199-200`) | None |
| Client frame | See section (c). With 300 bots after the bubble fix the profile is 72.4% idle and `step` is 5.5% (`PERF/client-profile-300-after.txt`). | None below 300 avatars | 0 long tasks |
| Host network (Lima ssh forwarder) | Not measured | HYPOTHESIS: the single ssh thread caps or kills the run. Check with `ps -o pcpu` on the forwarder during a 300 run. | The Docker socket died with it (BASE) |

| Hotspot | Evidence (profiler/APM) | Suspected cause | Fix | Status |
|---|---|---|---|---|
| Client frame at 100 bots (188 ms p50) | `PERF/client-profile-100-callers.txt`: 40% `texImage2D`, 15% canvas `save`, 13% `getProgramParameter`, 4% canvas `width` (BASE, "Cause and fix") | `ConversationBubble.drawSpline` built a canvas, a texture and a shader program per bubble per frame | `25685a03f` | Fixed. MEASURED 188 to 2.0 ms at 100 bots and 9.3 s to 7.7 ms at 300 |
| Pusher CPU at 300 | 65% steady median (BASE) | Per-recipient protobuf encode in `Zone.ts` and `PusherWebSocket.ts` (PLAN item 2.1) | `605fec17b` | Fixed. MEASURED 65% to 35%. Profile of 2026-11-19 at `75db31b6d` (two runs, `PERF/pusher-profile-2026-11-19/README.md`): 28 to 31% of a core; of the busy main thread, JavaScript 61%, garbage collector 5 to 6%, native `send` 19%, loop outside JavaScript 10%. No function above 5.2% except `send` |
| Pusher CPU at 1000 | 135% (`load-1000-stats.log`) | HYPOTHESIS: move fan-out takes at least 25% of CPU (DEC `decisions.md:166`). MEASURED at 300 only: the per-recipient flush is 35 to 39% of the busy main thread and moves are 81% of the delivered events (`PERF/pusher-profile-2026-11-19/README.md`); unconfirmed at 1000. | None measured. The per-viewer budget (`7a37a5178`, flag off) is the candidate fix | Open. Take a pusher `--cpu-prof` in the dense 1000 run. |
| Group updates | 2,134,326 against 4,711,110 moves at 300, 45% of moves (`baseline-300.json`). After `605fec17b`: 2,365,979 against 4,689,707 moves, 50.5% of moves and 29.9% of all received messages (`pusher-300-after.json`, DERIVED). Both runs already include the in-batch conflation of `50632e874` (DEC `decisions.md:176`). | A group update is sent when only its position changed; the remaining gain is that position-only subset (DEC `decisions.md:176,196`) | `8c6034a42` (C5 b, `Zone.ts`). Harness: 451,200 group notifications become 1,200 at 300 users in bubbles of 3 (`docs/TESTING.md:87`, MEASURED in a harness). | Landed; the 300-bot run is owed. Target: under 10% of 2,365,979 (DEC `decisions.md:196`). |
| World roster join cost | Not measured. `notifyAll` does not use `encodeOnce` (DEC C1). | Every client watches `allWorldUser` (DEC `decisions.md:35`) | C3 headcount behind a flag | Open. The back half landed (`aab3487b1`, `WORLD_HEADCOUNT_ENABLED`, off); the front half is not built, so every client still watches `allWorldUser`. `--world-space` now exists in the generator (`b7a9aed2c`). |
| Client at 1000 avatars or whole-map | Never measured | HYPOTHESIS: 62 us per avatar (section (c)) | C2 detail budget (B = 80, DEC `decisions.md:67`) | Open (DEC C2 slice 0). Slice 1 landed behind a flag (`47865006b`, off); only operation counts exist, no frame time. |
| Silent back shedding | No counter at `700362b82`: `back/src/Services/SocketManager.ts:300` returned without a count (BENCH). Now `workadventure_moves_shed_total` is counted at `:300-302` | `isOverHeating()` drops moving updates and only logged the mode change | `7493dc8e3` adds the counter | Landed. The first staircase run reads it. |

## Optimization Ledger

Verdict key. `keep` means tests pin the behavior and the gain was measured in a run. `keep, needs 1000 run` means the gain is derived or came from a unit harness and no end-to-end number exists. `keep, flag off` marks an optional change that is off by default and has only a unit-harness number. `revert` has no rows: no landed optimization has been rejected. The date is the commit date. Numbers come from the commit message plus the file named.

| Change | Before | After | Verdict | Date |
|---|---|---|---|---|
| `605fec17b` Encode each zone event once for all its watchers (MEASURED) | Pusher CPU median 65%, move p95 167 ms at 300 bots, sampled every 3 s (`PERF/pusher-300-before.json`, BASE). Encoder calls for one move watched by 200 sockets: 200. | CPU 35%, move p95 113 ms (`pusher-300-after.json`). Encoder calls: 1. Bytes unchanged by design, frames pinned by golden tests (`play/tests/pusher/ZoneFanOutEncoding.test.ts`). Side effect in the run: delivery 0.9949 to 0.9896, bytes +4.9% and group updates +17% (DERIVED from the two JSON files). BASE calls this noise on a loaded Mac; 3 interleaved runs would settle it. | keep, needs 1000 run | 2026-11-17 |
| `b323baca9` One 50 ms batch per pusher stream (MEASURED in a harness, 300 moving users) | 1,687.5 gRPC writes/s | 20 writes/s, about 84x fewer (DERIVED). Latency added is up to 50 ms by design. With move p95 at 113 ms at 300 (`pusher-300-after.json`), 163 ms worst case stays under 250 ms (DERIVED). | keep, needs 1000 run. The back was at 5% to 19% CPU in the 1000 run, so the effect on end-to-end lag is unmeasured. PLAN item 2.2 itself says "unverified". | 2026-11-18 |
| `1c9047960` Space user index and megaphone room kept between talks | 999 lookups: 23.6 ms and 54.2 ms | 0.14 ms and 0.10 ms (`back/tests/SpaceUserLookup.bench.ts:17-22`, MEASURED at load average about 200). The grace period has no number (HYPOTHESIS). | keep. The grace period needs the SFU load test. | 2026-11-18 |
| `34ec1cdc6` Token bucket, about 10 moves/s per socket | A client sending 60/s reached the back at 60.0/s (comment in `play/tests/pusher/SocketManagerUserMoves.test.ts:68`) | 10.4/s (commit message; the test bounds it at 9.5 to 11, MEASURED in a harness). Normal clients send 5/s, so nothing changes for them (DERIVED, DEC `decisions.md:173`). A ceiling, not a throughput gain, at 1000. | keep | 2026-11-18 |
| `59dfb7cac` Refuse a stale resume before authenticating, plus a 0 to 2 s rebuild spread | 2.00 authenticated upgrades per reconnecting client | 1.00 (`play/tests/pusher/PusherRestartReconnect.test.ts:26`, MEASURED in a harness). At 1000 clients 2,000 become 1,000 (DERIVED). A lone reconnect can be up to 2 s slower from the rebuild spread (commit message) and the plan names a risk of up to 5 s (PLAN item 5.3). | keep, needs 1000 run | 2026-11-18 |
| `c5bd4ad97` One scale variable for every name tag during a zoom | 90,000 style writes per wheel notch at 1000 tags | 17 (commit message, MEASURED in a harness; the test bounds it at 20, `UsernameDisplay.test.ts:18,169`). Tags may look soft during a magnifying zoom; not checked in Safari (commit message). | keep, needs a Safari check | 2026-11-18 |
| `700362b82` Avatar build queue and camera culling | About 100 avatar builds in one frame per 320 px walked. 1000 avatars drawn, 5,000 quads. | 322 drawn, 1,610 quads (`RemotePlayerCulling.test.ts:472-480`). Build timing has no number (TECH-DEBT DL-04). The message lists what is not done: culled avatars keep their DOM name and still dirty the scene. | keep, needs a probe run at 300 bots or more | 2026-11-18 |
| `850605bee` Optional `MAX_P2P_PEERS` caps the peers one user holds in a WebRTC space, and a failed LiveKit `createRoom` no longer blocks the next speaker (MEASURED in unit tests) | 1 speaker and 999 watchers: 1,998 start messages and 999 peer connections in the speaker's tab (`back/tests/WebRTCCommunicationStrategy.test.ts:305-314`) | 6 starts with `MAX_P2P_PEERS=3` (`:321-325`, DEC `decisions.md:155`). Opt-in: unset is upstream behaviour. It fails closed: a refused pair is not retried when a slot frees, and a watcher past the cap of every speaker gets no stream (two "known limit" tests). The `createRoom` change is a correctness fix, not a performance claim. | keep, needs the SFU load test: the real effect on media is unmeasured | 2026-11-18 |
| `8c6034a42` C5 (a): per-type pusher counters `workadventure_pusher_sub_messages_total` and `workadventure_pusher_sub_messages_bytes_total`, and the gauge `workadventure_pusher_moving_sockets` (`GaugeManager.ts`, `PusherWebSocket.ts`, `SocketManager.ts`) | No server-side count of what each socket sends | Counters in place. Pass condition: they match the bot-side counts of `pusher-300-after.json` within 1% (DEC C5). The gauge also gives the real walking fraction. | keep. Instrumentation, no gain claimed. The 300 procedure is owed. | 2026-11-18 |
| `8c6034a42` C5 (b): `Zone.handleGroupUpdateZone` notifies listeners only when the size, the lock or the members of a group change (`GroupDescriptor.update`) | 451,200 group notifications at 300 users in bubbles of 3 (harness, `MovingUsersTraffic.test.ts:51`) | 1,200, with moves unchanged at 448,500 (`:56,289`, MEASURED in a harness; `docs/TESTING.md:87`). A late watcher still gets the current position. Real-run target: under 10% of 2,365,979 group updates (DEC `decisions.md:196`). Revert if a bubble sticks locked or unlocked. | keep, needs the 300 procedure and a bubble check in a browser | 2026-11-18 |
| `e3aeb7bc2` A culled avatar hides its name with one write (`RemotePlayer.setCulled`, `Character.setNameHidden`, `UsernameDisplay.setHidden`); the companion picture is read back from the GPU on first look; the name-tag scale moved into `UsernameDomLayer.ts` | A culled avatar's moves queued a name position and marked the scene dirty (commit message). A companion paid a texture readback of about 16 ms when it entered (commit message; PLAN item 3.3, derived). | One write, no queued position and no dirty mark while culled. The readback happens only when something reads the picture. No number: `RemotePlayerCullingCost.test.ts` counts DOM and scene work, not time. | keep, needs a probe run with culling and companions | 2026-11-18 |
| `7493dc8e3` Counter `workadventure_moves_shed_total` for the moves the back drops while the CPU overheats (`back/src/Services/GaugeManager.ts`, `SocketManager.ts:300-302`) | Shed moves left no count; a run could lose delivery silently | N shed moves read N on the back scrape (`back/tests/MovesShedCounter.test.ts:40`, MEASURED in a test). The final (not moving) position is not counted. | keep. Instrumentation, no gain claimed. A staircase run reads it. | 2026-11-19 |
| `facc86a83`, `45934b027`, `b0e26fde0` Preferences stores, the office menu, focus mode and the dock | Not applicable | No performance claim is made for these: they include the `motion.ts` zero-length transition guard, the `browserEffectsPort` `focused` option, Preferences panes, Dock and Frame, and the locale files. | keep. Not a performance change. | 2026-11-19 |
| `25685a03f` Conversation bubbles as vector geometry | Frame work p50/p95 188 / 844 ms at 100 bots and 9,327 / 17,356 ms at 300. Frames in 25 s: 69 and 3. | 2.0 / 2.5 ms and 7.7 / 8.6 ms. Frames in 25 s: 854 and 729 (BASE, "Cause and fix"). | keep. MEASURED end to end. | 2026-11-17 |
| `63986e480` One viewport rectangle while walking | 170 zones entered and 152 left in a 2 s walk (`play/tests/pusher/PositionDispatcher.test.ts:436`) | 5 and 5 (commit message). The plan estimate of 270 to 295 joins per walker-second is DERIVED, not measured. | keep. A joins-per-walker-second reading needs a generator report (HYPOTHESIS). | 2026-11-17 |
| `6b38839ef` Talk indicator kept out of spaces that do not draw it | One flip: 43 sub-messages (40 world watchers plus a 3-person bubble) | 3 (commit message, MEASURED in a test). The plan estimate of 50 k to 200 k sub-messages/s (PLAN item 1.2) is DERIVED. | keep | 2026-11-17 |
| `6da6e7a0c` Jitter on reconnect attempts | Every client retried in the same instant | Base delay plus a random share, capped at 3 s (commit message). No number. | keep, needs 1000 run | 2026-11-17 |
| `a589e9fdf` Skip zone reconciliation inside the same zones | Reference time 1.0 | 0.27x walking inside the zones and 0.28x for a 1,000-socket crowd walk (single-process micro-benchmark, commit message) | keep | 2026-11-12 |
| `50632e874` Only the last update of a group per batch | Group updates 75 to 87 per session-second, event-loop lag p99 896 ms (500 sessions, pusher capped at 0.65 core) | 49 to 51 and 518 ms, no overlapping ranges, 3 interleaved runs (commit message) | keep | 2026-11-12 |
| `e38c3d8f5` Redraw animated tiles only when a visible tile changes | Whole frame repainted on every tick | No number in the commit message. A fallback keeps the old behavior. | keep | 2026-11-16 |
| `b7e754c64` Seated idle animation key built once per change | Reference frame cost 1.0 | 0.53 to 0.68 over 50 to 1000 seated (Node measurement, commit message) | keep | 2026-11-18 |
| `0ff4a395d` C5 (c): a remote avatar is drawn over the interval its positions arrive at (`RemoteSampleInterval.ts`, `PlayersPositionInterpolator.receiveSample`); `PlayerMovement.getPosition` now stops at the end of its 100 ms extrapolation window (MEASURED in a unit harness: 180 px/s walker, 60 fps, fake clock) | 1 Hz stream: 70.1% still frames, longest still 717 ms, mean error 58.2 px (`play/tests/front/Phaser/Game/RemoteSampleInterval.test.ts:195`) | 1.7% still frames, longest still 17 ms, mean error 183.4 px: the avatar trails the sender by about one interval (180 px at 180 px/s, DERIVED). 10 Hz and 5 Hz are drawn frame for frame as before (`:182-193`). 5 Hz to 1 Hz leaves one stall of 683 ms (commit message; the test bounds it under 750 ms, `:275`), which no receiver can foresee. 1 Hz to 5 Hz has no stall and a catch-up peak of 422 px/s, 2.3 times the walk (commit message; the test bounds it under 450, `:290`). A 1 Hz walker with samples 80 ms early or late stays under 15% still frames (`:259`). One frame of today's behaviour changes: the deleting frame rests at x 400 where it was 401 (`GameSceneMovement.test.ts`, edited in the commit). No sender or protocol change | keep, needs a browser look. It changes nothing while every stream is 5 Hz, and nothing thins a stream until the per-viewer budget is on. No browser frame-time or load run | 2026-11-19 |
| `7a37a5178` C1 slice 3: optional per-viewer budget, `PUSHER_VIEWER_BUDGET_ENABLED` (default off), `PUSHER_VIEWER_FULL_RATE_PEERS` 150, `PUSHER_VIEWER_MAX_PEERS` 400 (`play/src/pusher/models/ViewerBudget.ts`, hooked in the zone callbacks of `SocketManager.ts`) (MEASURED in a harness: one viewer among 1000 dense movers at 5 positions a second, fake clock) | 4,995 moves a second to the viewer, 89,137 move bytes a second, 999 users known (`play/tests/pusher/ViewerBudgetTraffic.test.ts:222`) | 1,000 moves a second, 18,005 bytes a second, 400 users known, no join or leave churn (`:228`): 5.0 times fewer moves and bytes (DERIVED). Selection costs 31 ms per 1000 viewers of 1000 peers against 184 ms for a full sort (M1 Max, best of 3, stated in the comment above `play/tests/pusher/ViewerBudget.test.ts:89`; the test asserts the same users, not the time). A user that joins the 1 Hz tier while walking gets one move with the join: 0 ms still, 800 ms without it (`:280`). DERIVED: 18,005 B/s is 144 kbit/s of move bytes alone at 100% walking; the 50 kbit/s downlink budget is set at 20% walking (DEC `decisions.md:61`), so this does not show that the budget is met. Not measured: a load run with real clients. No protocol change | keep, flag off, needs a load run. Off sends the same frames as before (commit message); `ViewerBudget.test.ts:398` pins the same frames while a viewer watches fewer users than the full-rate set | 2026-11-19 |
| `aab3487b1` C3 slice 1b, back half: optional world headcount, `WORLD_HEADCOUNT_ENABLED` (default off), one distinct-uuid count in the world space state, at most one patch a second (`back/src/Model/Space.ts`, `DistinctCounter.ts`, optional `headcount` in `libs/shared-utils/src/SpaceState/SpaceState.ts`). `c973c394a` makes the client keep that field when it shares the state (MEASURED in a harness: simulated clock) | 1,000 users joining over 60 s: 1,000 patches, 16.7 a second, without the timer (DERIVED: the count changes on every join, `back/tests/WorldHeadcount.test.ts:297`) | 58 patches in 60 s, 0.97 a second, 59 with the last one, ending on 1,000 (`:285`). This compares the timer with a patch per join. It does not compare the headcount with the roster: no client reads the number yet, so every client still watches `allWorldUser` | keep, flag off, no gain yet. The front half (`GameScene` reading the number, lazy roster, panel) is not built | 2026-11-19 |
| `47865006b` C2 slice 1: optional detail budget, `localStorage` `avatarDetailBudget` = "1" (default off). The 80 nearest avatars plus the hovered, followed and bubble ones stay full; the others in view become dots on one Blitter (`AvatarDetail.ts`, `AvatarDotLayer.ts`, `RemotePlayer.applyDetail`). COUNTED in a harness: 1000 avatars at whole-map zoom, fake operations | Flag off: 1,000 full avatars, 2,000 active sprites, 1,000 name tags shown. Per frame while walking: 3,000 objects rendered, 2,000 animation plays, 1,000 name tag writes, 0 dot writes (`play/tests/front/Phaser/Game/AvatarDetailCost.test.ts:347`) | Flag on: 80 full avatars, 160 active sprites, 0 name tags shown, 920 dots. Per frame: 240 objects rendered, 164 animation plays, 84 name tag writes in a hidden layer, 1,840 dot position writes (`:362`). These are operation counts, not time. The frame time in a browser is not measured, and the acceptance gate of DEC C2 (300 avatars at whole-map zoom, work p50 at least 50% below flag off, no long task over 50 ms) was not run. Known gap: scene effects still process the hidden avatars of the dots | keep, flag off, needs a browser frame-time run before the flag is turned on | 2026-11-19 |
| `75db31b6d` A sped-up diagonal walk is no longer placed as a teleport by the C5 (c) receiver; the walk speeds have one source, `Phaser/Player/WalkSpeed.ts` (MEASURED in a unit harness: the new test in `RemoteSampleInterval.test.ts` failed before and passes after) | The teleport check took the fastest walk as a sped-up straight line, 450 px/s at the default speed. A sped-up diagonal covers 636 px/s, so a sample that arrived 80 ms early on a 1 Hz stream was placed at once instead of drawn (`snap` true; commit message). Only the 1.5 slack hid the case at other gaps | `snap` false for that sample (`RemoteSampleInterval.test.ts:388`). No number for a frame time | keep. A correctness fix to `0ff4a395d`, no performance claim. It matters only when a stream is thinned, which nothing does while the per-viewer budget is off | 2026-11-19 |

## Decisions and next actions

Decisions, recorded by the coordinator:

1. The Phase 1 gate stays open until a valid 1000 staircase exists on the Linux host. Passing it takes the P1 items below. The shed counter (`7493dc8e3`) and the C5 (a) counters (`8c6034a42`) have landed, and so have four flag-gated or receiver-only engine slices (`0ff4a395d`, `aab3487b1`, `7a37a5178`, `47865006b`); the frame probe move, the C5 comparison runs and the staircase remain.
2. The budgets in Baselines & Budgets stand. Rows marked "proposed here" carry no plan source and are the first to revisit once real data arrives.
3. No Mac 1000 run, ever. The 300-bot run on the Mac stays a smoke test only (DEC `decisions.md:56`).
4. DEC C5's "0.10 core per 100 users" is overruled by the 0.7-core budget of DEC C1; 1.0 core is the saturation line.
5. An optional engine change ships with its flag off and stays off until a real run measures it: a load run for the pusher and back flags, a browser frame-time run for the client flag. Unit-harness numbers in the Ledger do not turn a flag on (2026-11-19).

Next actions. Owner "code workflow" is the session that edits `back/`, `play/src` and `play/tests`; this docs task cannot do those.

| Done | Action | Owner | Priority |
|---|---|---|---|
| [ ] | Move the frame probe from `.local/konclui/qa/frame-probe/probe.mjs` into git under `benchmark/` or `tests/` | code workflow | P1 |
| [x] | Add a counter for moves shed at `back/src/Services/SocketManager.ts:300` and export it on the back scrape. Done in `7493dc8e3` (`workadventure_moves_shed_total`) | code workflow | P1 |
| [ ] | Run C5 (a) and (b) against the exact `pusher-300-after` procedure and compare the counters with the bot-side counts | code workflow | P1 |
| [ ] | Run a valid staircase 300, 500, 700, 1000 on a CI-pool host from a pinned commit, with the load guard printing `nproc`, `/proc/loadavg`, `/proc/pressure/cpu` | coordinator with infra | P1 |
| [ ] | Take a pusher `--cpu-prof` during the dense 1000 run to settle the 25% fan-out hypothesis | code workflow | P1 |
| [ ] | C2 slice 0: whole-map frame measurements at bots 0, 100, 300 (DEC `decisions.md:88`) | code workflow | P2 |
| [ ] | Repeat `605fec17b` before and after with 3 interleaved 300-bot runs to settle the delivery 0.9949 to 0.9896 difference | code workflow | P2 |
| [ ] | `lk load-test` with one publisher and N = 50, 200, 1000 listeners, once with screen share; fill the SFU row of section (d) | coordinator with infra | P2 |
| [ ] | Pull a 30-day p50 and p95 of room population from PostHog and add it to Load Reality | coordinator | P2 |
| [ ] | First probe of the shell DOM cost (Dock, Frame, side panels) to set its budget | code workflow | P3 |
| [ ] | Check `ps -o pcpu` of the Lima forwarder during a 300 run to test the host-network hypothesis | code workflow | P3 |
| [ ] | Check the name-tag zoom in Safari (`c5bd4ad97`) | code workflow | P3 |
| [ ] | Link this file from `docs/konclui-migration/performance.md`, which is a contract with no results | docs | P3 |
| [ ] | Run the staircase twice from one pinned commit, `PUSHER_VIEWER_BUDGET_ENABLED` off and on (150 / 400), to read delivery, move p95 and pusher CPU against the harness numbers of `7a37a5178` | coordinator with infra | P1 |
| [ ] | Browser frame-time run for the C2 detail budget (300 avatars at whole-map zoom, flag off and on, work p50 and long tasks) before `avatarDetailBudget` is turned on by default | code workflow | P2 |

## Budgets as tests

Written 2026-11-19 at `75db31b6d`. The Phase 8 view of this file: which budget a test asserts today, and which budget nothing enforces. Source: the test files named in each row, read at `75db31b6d`. The phase record is in `docs/ARCHITECTURE-OPTIMIZATION-PLAN.md` (Phase 8).

Every number in the first table is an assertion in a vitest file. Each file runs in `npm test` (play or back) and in `scripts/gate.sh` (`docs/TESTING.md`, Local gate). Each counts operations on a fake clock or a fake scene (MEASURED, read from the files). None runs a real clock, a real network or a browser, so a test here holds the shape of a cost and says nothing about its time in milliseconds. "Breaks it" names the change that turns the test red.

### Enforced today (asserted by a test)

| Budget | Asserted number | Test file | What breaks it |
|---|---|---|---|
| Moves a socket forwards to the back | A client sending 60 a second reaches the back at 9.5 to 11 a second. A busy socket does not starve another (fewer than 60 forwarded in one second) | `play/tests/pusher/SocketManagerUserMoves.test.ts:81-82,115` | A change to `MAX_MOVES_PER_SECOND` (10) or `MOVE_BURST` (5), a shared bucket, or no limiter |
| Back write rate per pusher stream | At most 201 writes in 10 s for 300 walkers (10,000 / 50 + 1). Every move written within 50 ms. 0 order violations | `back/tests/RoomSocketBatching.test.ts:364-369` | A write per event, a longer batch window, a leave that overtakes a move |
| Encodes per zone event | One move watched by 200 sockets: 1 user-moved encode, 1 batch encode, 0 server-to-client and 0 envelope encodes. Frames byte-identical | `play/tests/pusher/ZoneFanOutEncoding.test.ts:252-282` | A per-socket encode in the fan-out |
| Group notifications | 300 users in bubbles of 3: 1,200 notifications and 1,200 on the wire, each below a tenth of 451,200. Moves unchanged at 448,500 | `play/tests/pusher/MovingUsersTraffic.test.ts:288-297`; `ZoneGroupUpdate.test.ts` (a size, lock or member change tells each watcher once; a position-only move tells none) | Notifying watchers on a position-only group change; dropping the member comparison fails 2 of 7 tests (`80568a5ae` message) |
| Zone subscriptions while walking | A 2 s walk with one rectangle enters 5 and leaves 5 zones. With two rectangles it is 170 and 152 | `play/tests/pusher/PositionDispatcher.test.ts:436,441` | The client sending two rectangles again (`63986e480`); a hysteresis would change the pinned count on purpose |
| Per-viewer budget (flag off by default) | One viewer among 1,000 dense movers. Off: 4,995 moves and 89,137.5 bytes a second, 999 users known. On (150 and 400): 1,000 moves and 18,005.5 bytes a second, 400 users known, 0 joins and leaves a second, and never above 150 x 5 + 250 moves a second | `play/tests/pusher/ViewerBudgetTraffic.test.ts:222-239`; `ViewerBudget.test.ts` | A change to the selection, the tick, the limits or the join and leave rules |
| World headcount patches (flag off by default) | At most one state patch a second: 58 in a 60 s ramp (0.97 a second), 59 with the last, ending on 1,000. Without the debounce it would be 1,000 | `back/tests/WorldHeadcount.test.ts:285-309` | Removing or shortening the 1,000 ms timer |
| Peer connections in a WebRTC space | 1 speaker and 999 watchers: 1,998 starts without a cap, 6 starts and 3 peer connections in the speaker's tab with `MAX_P2P_PEERS=3`, and no watcher gets more than one start | `back/tests/WebRTCCommunicationStrategy.test.ts:305-340` | Taking `canPair` out of `tryEstablish` (ten tests fail, `15f042918` message) |
| Reconnect after a pusher restart | 200 clients, pusher down 3 s: 200 of 200 rebuilds settle, and 1 authenticated upgrade per client | `play/tests/pusher/PusherRestartReconnect.test.ts:334-335` | A resume that authenticates before it is refused (`59dfb7cac`) |
| Remote receiver smoothness | 5 Hz and 10 Hz drawn frame for frame as before. A 1 Hz walker: under 5% still frames, longest still under 100 ms (with samples 80 ms early or late: under 15% and 250 ms). A drop from 5 Hz to 1 Hz: one stall under 750 ms, then under 5%. A rise from 1 Hz to 5 Hz: longest still under 100 ms, peak speed under 2.5 times the walk | `play/tests/front/Phaser/Game/RemoteSampleInterval.test.ts:182-296` | A change to the interval estimate, its clamp or its smoothing; a teleport check that places a legal walk (`75db31b6d`) |
| Avatars drawn at 1,000 | 322 drawn, 1,610 quads and 322 name tags, against 1,000, 5,000 and 1,000 before culling. While all 1,000 walk, the busiest frame updates at most 322 name pills and 322 dirty marks (1,000 and 1,000 without the hook). 0 companion picture readbacks on entry | `play/tests/front/Phaser/Game/RemotePlayerCulling.test.ts:466-480`; `RemotePlayerCullingCost.test.ts:331-334,384` | The culling margin, or a culled avatar that updates its name again. The 322 is one fixture, not a general bound |
| Avatar detail at whole-map zoom (flag off by default) | Off: 1,000 full avatars, 2,000 active sprites, 1,000 name tags; walking, 1,000 tag writes, 3,000 objects rendered, 2,000 animation plays a frame. On: 80 full, 160 active sprites, 0 tags shown, 920 dots; walking, 84 tag writes in a hidden layer, 240 objects, 1,840 dot writes, 164 animation plays. The full avatars are the nearest | `play/tests/front/Phaser/Game/AvatarDetailCost.test.ts:347-395` | A change to the budget of 80, the hysteresis, or a second writer of visibility (DS-32). The test needs `{ timeout: 120_000 }` |
| Name-tag style writes per zoom notch | At most 20, and the same with 10 tags as with the full crowd (17 measured) | `play/tests/front/Phaser/Components/UsernameDisplay.test.ts:18,169-170` | A per-tag style write during a zoom |
| Avatar builds per frame | The queue stops at the cap it is given (4 in the test) even when builds are free, and at its time budget otherwise | `play/tests/front/Phaser/Entity/AvatarBuildQueue.test.ts:166-172` | A queue that ignores the cap. The production values (`MAX_AVATAR_BUILDS_PER_FRAME`, `AVATAR_BUILD_BUDGET_MS`) are guesses (TECH-DEBT DL-04) and no test asserts them |
| Presence reads in the shell | At most one read every 250 ms of frame time | `play/src/front/Konclui/Presence/phaser/presenceExtension.test.ts:93-102` | A read on every frame |

Measured by a file but not asserted: `back/tests/SpaceUserLookup.bench.ts` (999 lookups, 0.14 ms against 23.6 ms) is a `.bench.ts` and `vitest run` skips it. The 31 ms against 184 ms selection time of `ViewerBudget.test.ts:89` is a comment, and the test asserts the users, not the time. The `[moving users]`, `[room-socket-batching]` and `[zone fan-out]` lines are printed, not asserted.

### Not enforced by any test or run

These budgets are in Baselines & Budgets above and are asserted nowhere. The gate is what would enforce each. Every gate except the frame probe needs the Linux load host of Next actions (owner: coordinator with infra), because no valid 1000 run can happen on this machine (`docs/ARCHITECTURE-OPTIMIZATION-PLAN.md`, decision 2026-11-18).

| Budget | Value | Gate that would enforce it | Owner action |
|---|---|---|---|
| Pusher CPU at 1,000 dense, 20% walking | At most 70% of one core, 100% is saturation | A staircase level at 1,000 fails above it (`--metrics-urls` `cpuPercentOfOneCore`) | Provide the CI-pool host and run `benchmark/scripts/load-staircase.sh` from a pinned commit (plan action 4) |
| Move latency p95 at 1,000 | 250 ms | The same staircase level reads the report's p95 | Same run. Delivery at least 0.99 and 0 rejected sessions are read from it too |
| Client frame time | p95 at most 16.7 ms with 200 visible avatars, at most 33.3 ms at 1,000 | The frame probe in git, as a Playwright spec on `startFrameRecording` with a `workMs` p95 limit (N-04) | Move `.local/konclui/qa/frame-probe/probe.mjs` into git (plan action 5), and choose a runner with a GPU |
| Pusher RSS at 1,000 | At most 1.5 GB | `--metrics-urls` RSS in the same staircase. A cheaper first gate is a test of `NoncedMessageStore` retained bytes at a client that does not drain (N-02) | Write N-02 (code workflow); the staircase run for the real number |
| Reconnect storm | Not stated as a number. The SLO proposals are in `docs/RELIABILITY.md` | A drill: restart the pusher under N clients and read the time to resume and the failed resumes. The generator cannot make bots rejoin, so it cannot run today | Add a rejoin mode to the generator, build fork images so the counters exist where users are (plan action 16, R-01), then drill at 300 bots on this machine and at 1,000 on the host |
| Downlink per client | At most 50 kbit/s, target 32 | `kbitPerSecondPerSession` in the staircase report. The harness reads 144 kbit/s of move bytes for one viewer at 100% walking (DERIVED, Ledger `7a37a5178`) | Same staircase, with the viewer budget off and on |
| Back CPU and shed moves | At most 50% at 1,000, no overheat line, `workadventure_moves_shed_total` at 0 | The staircase scrape | Same run |
| C2 detail budget in a browser | Work p50 at least 50% below flag off at 300 avatars at whole-map zoom, no long task over 50 ms | The frame probe, flag off and on | Plan action 17, before `avatarDetailBudget` is turned on |
| SFU load | Open until the load test fills section (d) | `lk load-test` at N = 50, 200, 1,000 | Plan action 10 |

### What this section does not do

It adds no CI job and edits no workflow file. Wiring a budget into CI waits for the owner: the fork's CI policy is the owner's call, and this run did not push. The tests above already run in the local gate, which no workflow calls. A budget that needs the load host stays unenforced until that host exists.

## Cross-references

- `docs/TECH-DEBT.md` rows SM-04 (a gRPC stream per socket, line 38), SM-05 (per-recipient fan-out, line 39; answered by `605fec17b`, 200 encoder calls to 1) and GS-04 and GS-05 (per-frame scans in `GameScene`, lines 12 and 13) are not repeated here.
- `docs/TESTING.md:161` already marks "Measure SM-05" closed by `605fec17b`, and `docs/TESTING.md:87,100,102,109-111` hold the harness numbers for C5 (b), the back batch, the space index, culling, name tags and the companion picture. The ledger cites them rather than restating their test detail.
- `docs/konclui-migration/performance.md` states the bounded optimization loop and has no results; this file holds the results.
- One discrepancy, kept visible: BASE reports pusher CPU 65% and 35% for the steady part, while a recompute over each whole sample log gives 60.1% and 26.4%. Both show the same direction, and the ledger quotes BASE.
