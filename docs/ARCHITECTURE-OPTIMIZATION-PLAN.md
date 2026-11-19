# Architecture Optimization Plan

## Context

Started 2026-11-18 on branch `konclui/main` at `700362b82` ("perf(scene): queue avatar builds and cull avatars outside the camera"), with an uncommitted working tree that another workflow is editing in `back/`, `play/src` and `play/tests` (TECH-DEBT DL-02, `docs/TECH-DEBT.md:68`).

The coordinator decides. The user's standing instruction for these journeys is: do not ask, decide, record the decision and continue. Every decision below was taken under it.

Mode: skills-installed. All eight phase skills are present under `~/.klaude/skills/` (`working-with-legacy-code`, `clean-architecture`, `software-design-philosophy`, `refactoring-patterns`, `system-design`, `ddia-systems`, `release-it`, `pragmatic-programmer`; checked with `ls` on 2026-11-18). The writers of this run followed `architecture-optimization/references/methods.md` per phase, so the artifacts are skill-grade in method.

The prior journey on this repo is `docs/REMOVE-TECHNICAL-DEBT-PLAN.md` (started 2026-11-12). Its rows (GS, SM, MD and RT in `docs/TECH-DEBT.md`, and the GameScene, SocketManager, MediaStore and RoomTimeline nets in `docs/TESTING.md`) are reused here and not repeated.

Claim labels, as in the four artifacts: MEASURED is a number from a log, report or test. DERIVED is arithmetic over measured numbers. HYPOTHESIS is not verified yet. DECIDED marks a coordinator decision.

Path shorthand: `EV` is `/Users/erickheslan/.claude/orchestrate/konclui-native/evidence` (outside git, provenance only). `CHK` is `/Users/erickheslan/.claude/orchestrate/konclui-native/recovery-codex/checkpoint.md` (outside git).

### Intake

The coordinator decided these answers from the evidence. `docs/PERFORMANCE.md:41-53` holds the same intake; this table is now the owner, and that section is a copy.

| # | Question | Decision | Source |
|---|---|---|---|
| 1 | System and cost of slow | Koncluí, a WorkAdventure fork for a virtual office. Goal: 1000 live participants in one world without stalls in movement, audio or video. Today 1000 dense bots do not hold: 823 of 1000 joined, delivery 0.47 (0.468 in the report), pusher saturated (MEASURED). | `CHK:80-84` (checkpoint 2026-11-17 19:20); `docs/PERFORMANCE.md:131` (`EV/perf/load-1000.json`) |
| 2 | Evidence | The measured baselines and the commit numbers in `docs/PERFORMANCE.md` (Baselines & Budgets, Load Reality, Optimization Ledger). | `docs/PERFORMANCE.md:55-197` |
| 3 | Hot flows | (a) pusher zone fan-out and move traffic (`play/src/pusher/models/Zone.ts`, `PositionDispatcher.ts`, `services/PusherWebSocket.ts`, `SocketManager.ts`). (b) back room batching and space state (`back/src/Model/GameRoom.ts`, `Space.ts`, RoomSocket batching). (c) client scene with many remote avatars (`play/src/front/Phaser/Game/GameScene.ts`, `Entity/RemotePlayer.ts`, `Character.ts`, `Components/UsernameDisplay.ts`, `Game/UsernameDomLayer.ts`, `RemotePlayerCulling.ts`). (d) media pairing (`back/src/Model/Strategies/*CommunicationStrategy.ts`, `States/WebRTCState.ts`). (e) the Koncluí shell over the map (`play/src/front/Konclui`). | `docs/PERFORMANCE.md:49`, sections (a) to (e) |
| 4 | Tests | Vitest per workspace, green at the last full gate: play 2473 tests on `75901117c` (MEASURED). `HEAD` is 10 commits past that gate, so the pass is not current. Playwright in `tests/`. | `docs/PERFORMANCE.md:50` (`EV/qa/interactive-qa-2026-11-17.md:68-69`); `docs/TECH-DEBT.md` Scores, "Tests pass" row |
| 5 | Stack | TypeScript, Svelte 5, Phaser 4, Node 24, uWebSockets pusher, gRPC and protobuf to the back, Redis, LiveKit. Local QA on Colima with an 8 GB VM: never 1000 bots locally. | `docs/PERFORMANCE.md:51`; `docs/TESTING.md` CI Gates item 6 |
| 6 | Load | Target 1000 concurrent in one world. Measured runs exist at 100 and 300 bots. The one 1000 run is stale and invalid as a baseline. A valid 1000 run needs a remote Linux load host: open item. | `docs/PERFORMANCE.md:127-140` |
| 7 | Scope | All 8 phases. Phases 2 and 3 audit first: the Koncluí seam already has an enforced domain graph (`play/src/front/Konclui/architecture.test.ts`, `play/src/front/Konclui/AGENTS.md`). Phases 5 and 6 are carried by the engine plan items C1 to C5 already in flight (`docs/konclui-migration/decisions.md`). Phase 1 is a gate. | `docs/PERFORMANCE.md:53` |

## Phase Status

| Phase | Skill | Status | Artifact | Date |
|---|---|---|---|---|
| 1 | working-with-legacy-code | in-progress. Behaviour net exists: hot-flow rows and N-01 to N-16 in TESTING.md, with uncommitted (U) tests outside the net until committed (N-16). Baseline at 100 and 300 bots exists (MEASURED, PERFORMANCE.md Load Reality). The 1000-bot baseline is awaiting-evidence: no load host yet (Next Actions 1, 2 and 4). Gate verdict PARTIAL (`docs/PERFORMANCE.md:22`). | TESTING.md, TECH-DEBT.md, PERFORMANCE.md | 2026-11-18 |
| 2 | clean-architecture | in-progress. Audit done this run: 13 violation rows V1 to V13 and 2 accepted rows A1 and A2 in ARCHITECTURE.md (`docs/ARCHITECTURE.md:135`). Fixes pending: V1 and V13 are fix-now; V2 gates C1 slice 3. | ARCHITECTURE.md | 2026-11-18 |
| 3 | software-design-philosophy | in-progress. Audit done this run: DS rows and the design-depth score 7/10 in TECH-DEBT.md (phases 3 and 4 audit, `docs/TECH-DEBT.md:119`). Fixes pending. | TECH-DEBT.md | 2026-11-18 |
| 4 | refactoring-patterns | in-progress. Audit done this run: structural score 5/10 and the named refactorings DS-01 to DS-29 with a ranked checklist (`docs/TECH-DEBT.md:201-216`). Fixes pending; each is one structure-only commit. | TECH-DEBT.md, TESTING.md | 2026-11-18 |
| 5 | system-design | in-progress through engine items C1 to C5. Landed optimizations and their verdicts are in the Optimization Ledger (`docs/PERFORMANCE.md:165-197`); C4 and C5 slices are uncommitted. Most verdicts read "keep, needs 1000 run". | PERFORMANCE.md, ARCHITECTURE.md | 2026-11-18 |
| 6 | ddia-systems | in-progress through the data paths in back `Space` and Redis: space-user index (`1c9047960`), C3 headcount in the space state patch (not started). ARCHITECTURE.md `## Data & Storage Decisions` is still a placeholder. | ARCHITECTURE.md, PERFORMANCE.md | 2026-11-18 |
| 7 | release-it | pending. RELIABILITY.md does not exist. | RELIABILITY.md | |
| 8 | pragmatic-programmer | pending. Gates are drafted in TESTING.md CI Gates (1000-participant items 1 to 6); none runs a budget yet. | PERFORMANCE.md, TECH-DEBT.md, TESTING.md | |

Statuses: pending · in-progress · awaiting-evidence · done · deferred: <reason> · skipped: <reason>

## Key Decisions

| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-11-18 | intake | The coordinator answers the intake from the evidence and records it here (DECIDED). | The user's standing instruction: do not ask, decide, record and continue. |
| 2026-11-18 | 1 | The hot flows are (a) to (e) as written in `docs/PERFORMANCE.md` sections (a) to (e). No other flow is in scope until a profile names one. | The 1000 run saturated the pusher (CPU max 143.65% of one core, MEASURED, `docs/PERFORMANCE.md:148`) while the back stayed at 4.6% to 18.7% (MEASURED, `docs/PERFORMANCE.md:150`); the client and media flows have their own stall modes (`docs/PERFORMANCE.md:96-110`). |
| 2026-11-18 | 1 | The budgets are the ones in `docs/PERFORMANCE.md` Baselines & Budgets. Rows marked "proposed here" are revisited first when real data arrives. The 0.7-core pusher budget of C1 governs; 1.0 core is the saturation line. | `docs/PERFORMANCE.md:59,204,206`; DEC C1 and C5 disagree, and PERFORMANCE.md resolves it. |
| 2026-11-18 | 1 | The tool of record per flow is the one PERFORMANCE.md names: the `benchmark/` staircase with `--metrics-urls` and `--steady-window` for (a) and back CPU; vitest harnesses for per-operation numbers in (b); the frame probe plus `RemotePlayerCullingCost.test.ts` for (c); strategy tests and, once it exists, `lk load-test` for (d); the frame probe with `konclui.fx.off` for (e). | `docs/PERFORMANCE.md:63,81,92,105,114` |
| 2026-11-18 | 1 | No 1000-bot run on the Mac or Colima, ever. The 300-bot Mac run is a smoke test only. 1000 runs on a CI-pool Linux host from a pinned commit. | `docs/PERFORMANCE.md:137,140,205`; the 1000 run killed the Colima SSH link (`CHK:84`). |
| 2026-11-18 | 1 | Phase 1 is split into its two nets. The behaviour net unlocks phases 2 to 4 now. The baseline net unlocks phases 5 and 6 at 100 and 300 bots only; a phase 5 or 6 verdict stays "keep, needs 1000 run" until the staircase exists. | `architecture-optimization` SKILL.md ("Phase 1 gates them all — as two independent nets"); `docs/PERFORMANCE.md:167`. |
| 2026-11-18 | 1 | A test that is uncommitted (U) is not part of the net and not a gate until it is committed. | `docs/TESTING.md:23`, decision 2 at `:228`. |
| 2026-11-18 | 1, 4 | A bug found while characterizing is pinned first with its ledger ID, then fixed in a separate behaviour commit whose test flips. | `docs/TESTING.md:18`; `docs/TECH-DEBT.md:240`; the prior journey's intake (`docs/REMOVE-TECHNICAL-DEBT-PLAN.md`, Intake table). |
| 2026-11-18 | 2, 3 | Phases 2 and 3 run audit first: rows are recorded with a fix, a priority and an owner, and the fixes wait for the in-flight edits in `back/` and `play/src` to land. | The Koncluí seam is already enforced (48 tests passed in the two fitness files, MEASURED, `docs/ARCHITECTURE.md` "The Konclui seam holds"); fixing in files another workflow edits would conflict (`docs/ARCHITECTURE.md:202`). |
| 2026-11-18 | 2 | A boundary is added only where a second implementation can be named. No full hexagonal rewrite. | `docs/ARCHITECTURE.md:201`. |
| 2026-11-18 | 2, 4 | V1 (ARCHITECTURE.md) and DS-06 (TECH-DEBT.md) are one item: the `CommunicationConfig` cycle. Its fix is DS-06's (import `MAX_USERS_FOR_WEBRTC` directly, delete the wrapper). V13 and DS-27 are one item: the Koncluí domain list drift. Each is done once and closes both rows. | Same files and lines: `AbstractCommunicationState.ts:6,18` (`docs/ARCHITECTURE.md:119`, `docs/TECH-DEBT.md:177`); `play/src/front/Konclui/AGENTS.md:17-18` and `architecture.test.ts:23-35` (`docs/ARCHITECTURE.md:131`, `docs/TECH-DEBT.md:198`). |
| 2026-11-18 | 5, 6 | Phases 5 and 6 are carried by the engine items C1 to C5 in `docs/konclui-migration/decisions.md`, which owns their reasoning and slices. This tracker does not repeat them. | `docs/ARCHITECTURE.md` Decision Log, C1 to C5 rows. |
| 2026-11-18 | 5 | The protocol stays wire-compatible with upstream through phase 3 (C5). Nothing under `messages/protos` changes. | The release path runs the official v1.34.5 server images (`docs/ARCHITECTURE.md` System Context; `messages/AGENTS.md:12-13`). |

## Next Actions

Ranked. "Code workflow" is the session that edits `back/`, `play/src` and `play/tests`. Due dates are DECIDED by the coordinator.

1. [ ] Commit the working tree in granular, verified steps, including the U tests that pin each change (DL-02, N-16). Owner: integrator. P1. Due 2026-11-20. Why first: U tests are outside the net (`docs/TESTING.md:23`), and the staircase must run from a pinned commit (`docs/PERFORMANCE.md:140`). Source: `docs/TECH-DEBT.md:68`, `docs/TESTING.md:202`.
2. [ ] Add a counter for moves shed at `back/src/Services/SocketManager.ts:300` and export it on the back scrape, so a run cannot lose delivery silently. Owner: code workflow. P1. Due 2026-11-20. Source: `docs/PERFORMANCE.md:29,213`.
3. [ ] Verify C5 (a) and (b) against the exact `pusher-300-after` procedure: the new counters within 1% of the bot-side counts, group updates under 10% of 2,365,979. Pin the client side of (b) first (N-01). Owner: code workflow. P1. Due 2026-11-21. Source: `docs/PERFORMANCE.md:193-194,214`; `docs/TESTING.md:187`.
4. [ ] Run the valid staircase 300, 500, 700, 1000 with 4 staggered processes on a CI-pool host, from the commit of action 1, with the load guard (`nproc`, `/proc/loadavg`, `/proc/pressure/cpu`) and a pusher `--cpu-prof`. This is the evidence Phase 1 awaits. Owner: coordinator with infra. P1. Due 2026-11-25. Source: `docs/PERFORMANCE.md:140,215,216`.
5. [ ] Move the frame probe from `.local/konclui/qa/frame-probe/probe.mjs` into git, then build the frame-time gate (N-04: p95 at most 16.7 ms at 200 visible, at most 33.3 ms at 1000). Owner: code workflow. P1. Due 2026-11-21. Source: `docs/PERFORMANCE.md:28,212`; `docs/TESTING.md:190`.
6. [ ] V2: introduce the structural `ZoneListener` in its own structure-only commit before C1 slice 3 starts. Owner: pusher. P1. Source: `docs/ARCHITECTURE.md:120,144`.
7. [ ] Write the remaining P1 pins: N-02 (replay retention), N-03 (`benchmark/` tests in a gate, shared decoder), N-05 (world roster fan-out), N-11 (no texture per bubble redraw). Owner: coordinator. P1. Source: `docs/TESTING.md:188-191,197`.
8. [ ] P1 structure fixes, one commit each, after action 1: DS-03, DS-01, DS-02, DS-29. Owners: pusher and back. P1. Source: `docs/TECH-DEBT.md:171-174,206-209`.
9. [ ] Smallest safe fixes: DS-06 (closes V1) and DS-27 (closes V13). Owners: back and Konclui. P2. Source: `docs/TECH-DEBT.md:177,198`; `docs/ARCHITECTURE.md:142-143`.
10. [ ] `lk load-test` with one publisher and N = 50, 200, 1000 listeners, once with screen share; fill the SFU row. Owner: coordinator with infra. P2. Source: `docs/PERFORMANCE.md:110,219`.
11. [ ] C2 slice 0: whole-map frame measurements at 0, 100 and 300 bots. Owner: code workflow. P2. Source: `docs/PERFORMANCE.md:217`.
12. [ ] Start phase 7: create `docs/RELIABILITY.md` (timeouts, backpressure and restart behaviour on the pusher-to-back and pusher-to-client links). Owner: coordinator. P2. After action 4.
13. [ ] Start phase 8: turn the TESTING.md 1000-participant gates into budget checks in CI. Owner: coordinator. P3. After actions 4 and 5.
14. [ ] Update three stale lines that say a file does not exist yet: `docs/PERFORMANCE.md:43` and `docs/TESTING.md:238` (this tracker now exists), and `docs/ARCHITECTURE.md:43` (PERFORMANCE.md now exists). Owner: docs. P3.
