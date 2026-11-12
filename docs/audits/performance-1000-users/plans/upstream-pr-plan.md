# WorkAdventure 1,000-user contribution plan

Help users on modest devices stay responsive while 1,000 people share the platform, with measurable server and traffic costs.
Initial contributions are P1, P2, P3, P4, P5 and the P6 native compiler pilot. P3 contributes to existing upstream work.
The complete dependency program adds D01 through D14 queues with every direct declaration mapped.
This is a planning artifact, not an execution grant or a capacity claim. No implementation boxes are checked.
Source baseline is `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`. Initial research date is 2026-11-11. Dependency coverage and TypeScript were extended on 2026-11-12.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists. Keep logs, SHAs and workload definitions beside results. The body is a how-to. Appendices explain unresolved decisions.

Future execution follows `skills/poteto-mode/playbooks/autopilot-full.md` from the installed plugin, adapted to the user's working agreements and the repository guides. These are independent production diffs. P1 provides measurement infrastructure rather than a mandatory code base for the other PRs. Upstream maintainers own acceptance and merge.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

The live lanes below are scenario coverage, not permission to start ten concurrent agents or provision infrastructure. Run related scenarios in the same existing runner where appropriate. Respect runtime resource limits. Machine-readable traces are the evidence for backend scenarios; capture screenshots/video when actual UI behavior is involved. Project instructions take precedence over generic workflow mechanics.

## Program checklist

### Arm the program

- [ ] Record the user's explicit execution scope and the selected PR before changing code. Branches, worktrees, commits and pushes require explicit authorization under the current working agreement. Save the scope in the execution receipt.
- [ ] Write the plan path, chosen PR IDs, verification rule, merge ownership and done condition into `notes.md` in the program's store. Use this repository's audit evidence directory unless another location is explicitly selected.
- [ ] Read the installed plugin execution playbook and applicable repository `AGENTS.md`, test, lint and setup guides. Record the guide revisions used.
- [ ] If a sustained program is explicitly requested, select a supported scheduling mechanism for an hourly audit. Otherwise use completion notifications and bounded waits. Record resource ownership and send a status message only for a meaningful change. No scheduler is armed by this plan.
- [ ] Recheck upstream duplicates and the exact base revision. Save issue/PR URLs and states, including #6688, #6814 and #6800.

### Spawn owners

- [ ] Assign one bounded owner at a time unless parallel agent work is authorized by applicable instructions. Record owned paths and resource cleanup responsibilities.
- [ ] Keep P1 and P2 independent. Use P1 receipts for P3 and P4 load evidence; P5 has independent storage fault probes. P6 follows D01a compatibility work. Follow the five waves and per-family boundaries in the complete dependency program. Save the selected execution order and SHAs.
- [ ] Preserve all unrelated shared-checkout work. Record the initial status without reading secrets.

### PR mechanics, for every PR

- [ ] Resolve the available GitHub integration and publication authorization before any remote mutation. Draft title/body locally first. For P3, coordinate a contribution to #6688 instead of creating a competing PR.
- [ ] Run applicable repository checks and preserve focused passing results while inputs remain unchanged. Save exact commands and exit codes. Do not use package updates as a reason to repair unrelated failures.
- [ ] Describe the concrete trigger, resulting behavior, measured evidence and limitations in English. Record source and target SHAs and versions. Separate maintained behavior from proposed behavior.

### Verdict and merge, for every PR

- [ ] Review the diff and receipts at the exact head. Verify behavioral invariants and both sides of performance comparisons. Record independent review findings before requesting upstream review.
- [ ] Hand over only the authorized contribution. Do not infer permission to publish or merge from this planning request. Save upstream review/merge state if future execution is authorized.

### Boot recipe, for every live lane

- [ ] Follow `docs/agent/dev-setup.md` and the nearest `AGENTS.md` in an authorized test environment. Record Node/image identity and generated protobuf prerequisites. Keep environment values and credentials out of receipts.
- [ ] Start only the services needed for the selected scenario and wait for readiness. Use the repaired `cd benchmark && npm start` for protocol load, existing Playwright scripts under `tests/` for browser behavior, and the filesystem interface fault harness for P5. Save the exact configured command with each receipt.
- [ ] Capture profile and trace artifacts under the selected PR ID in the evidence directory. Use JSON/text for protocol and storage state, browser traces/screenshots for UI, and record hardware/network conditions.
- [ ] Stop owned services, agents and generators and remove injected faults or measurement overrides. Save the cleanup result. Do not stop unrelated resources.


## Restore a headless room load generator (P1)

**Depends on.** None. First measurement milestone.

**Files.**

- [ ] `benchmark/index.ts`, `benchmark/README.md` and `benchmark/package.json`; add narrowly scoped benchmark helpers only if necessary.

**Build.**

- [ ] Replace the missing WebSocket import and obsolete browser connection path with a headless client using the existing `ws` dependency and generated protobuf codecs. Save the diff.
- [ ] Make concurrency, ramp, duration and room distribution reproducible. Count accepted room sessions separately from open sockets and account for rejection and cleanup. Save the CLI contract and example configuration.

**You see.**

- [ ] One synthetic user joins, sends movement seen by a real client, leaves, and disappears from room membership. Save the protocol and browser receipt.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add an existing-runner-compatible check for envelope handling, accepted/rejected sessions and cleanup. Record the new checking command in the benchmark README. The current package has only `npm start`, so do not claim an existing benchmark test/typecheck command passes.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, subject to the project verification and resource rules above.

- [ ] Lane 1. Regression lane against trunk. Attempt the current entry point and the repaired one using the same setup. Save `P1/lane-1.json`. Pass when trunk failure is documented without inventing a successful baseline and head joins and leaves.
- [ ] Lane 2. Join one anonymous session in the configured test room. Save `P1/lane-2.json`. Pass when an authoritative room acceptance is counted.
- [ ] Lane 3. Send movement and a viewport update. Save `P1/lane-3.json`. Pass when a second real client observes the expected position.
- [ ] Lane 4. Open ten unique logical connections. Save `P1/lane-4.json`. Pass when IDs are unique and membership equals accepted sessions.
- [ ] Lane 5. Reject a deliberately invalid connection. Save `P1/lane-5.json`. Pass when failure is counted and is not reported as joined.
- [ ] Lane 6. Ramp and stop before the requested population is reached. Save `P1/lane-6.json`. Pass when all owned sockets and timers close.
- [ ] Lane 7. Complete a finite movement run. Save `P1/lane-7.json`. Pass when event counters and duration agree with the selected workload.
- [ ] Lane 8. Run two rooms with separate populations. Save `P1/lane-8.json`. Pass when no cross-room events leak and counts match.
- [ ] Lane 9. Disconnect a subset during the run. Save `P1/lane-9.json`. Pass when membership and error/close counters reconcile.
- [ ] Lane 10. Run the distributed ramp at 100, 250, 500 and 1,000 sessions. Save `P1/lane-10.json`. Pass when results include generator utilization and all failures without hiding saturation.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Accepted sessions, join latency, event delivery, errors, generator CPU/RSS/lag and server CPU/RSS/lag/egress. Browser FPS is outside this harness.
- [ ] Probe. Run the defined workload from `1000-user-workloads.md` using `cd benchmark && npm start` with the configuration interface introduced by this PR. Save exact commands. Use the identical repaired harness against future base/head server builds.
- [ ] Baseline. Record that the original generator is statically broken, then reproduce the failure. Establish the first usable absolute baseline on the unchanged server. No speedup ratio can be computed from a non-running generator.
- [ ] Rule. Reject runs where the generator saturates or counters fail to reconcile. One accepted session and clean leave are mandatory. Report each 100/250/500/1,000 result, even when it fails the proposed SLO. A working tool does not certify capacity.

**Review gate.** None. P1 does not intentionally redesign an interaction. Standard correctness, compatibility and upstream review still apply. If implementation changes user interaction, add operator screenshot/video review before proceeding.

**Merge.**

- [ ] Record the exact reviewed head, focused checks, live receipts and measured limitations before any authorized upstream handoff.
- [ ] Record rollback readiness. Revert benchmark-only changes. Production code and wire format remain unchanged.


## Update Svelte and verify component lifecycle (P2)

**Depends on.** None. May proceed independently of P1.

**Files.**

- [ ] Web workspace manifests that resolve Svelte and the authoritative root lockfile. Do not rewrite unrelated lockfiles or the separately managed desktop graph.

**Build.**

- [ ] Update the shared web Svelte resolution from `5.55.9` to the revalidated stable candidate `5.57.3`. Save the manifest/lockfile diff.
- [ ] Keep application refactoring out of this PR. Document the upstream event and derived-dependency retention fixes and the locally exercised paths.

**You see.**

- [ ] Repeated panel, chat and room lifecycle operations preserve behavior and release resources at least as well as the baseline. Save paired traces.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `npm run svelte-check`, `npm run typecheck`, focused affected tests and production build from `play`, plus checks required by changed shared consumers. Record any unrelated baseline failures. Do not add tests that only assert the installed version.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, subject to the project verification and resource rules above.

- [ ] Lane 1. Regression lane against trunk. Open and close the same panels repeatedly. Save `P2/lane-1.zip`. Pass when state and visible controls match and retained resources are compared.
- [ ] Lane 2. Open and close Matrix chat after initialization. Save `P2/lane-2.zip`. Pass when messages remain usable and cleanup is measured.
- [ ] Lane 3. Mount proximity chat and leave the conversation. Save `P2/lane-3.zip`. Pass when no stale conversation UI remains.
- [ ] Lane 4. Change rooms repeatedly. Save `P2/lane-4.zip`. Pass when old room UI and subscriptions are released.
- [ ] Lane 5. Paginate a long conversation. Save `P2/lane-5.zip`. Pass when scroll position and message ordering remain correct.
- [ ] Lane 6. Open and close a modal through keyboard input. Save `P2/lane-6.zip`. Pass when focus returns correctly.
- [ ] Lane 7. Exercise reactive controls during a call. Save `P2/lane-7.zip`. Pass when device controls and stores remain synchronized.
- [ ] Lane 8. Build and load the production worker/WASM assets. Save `P2/lane-8.zip`. Pass when no missing asset or runtime import error occurs.
- [ ] Lane 9. Run the scripted interaction on the selected modest phone. Save `P2/lane-9.zip`. Pass when the baseline behavior is preserved and frame/interaction traces exist.
- [ ] Lane 10. Leave the client idle after repeated lifecycle cycles. Save `P2/lane-10.zip`. Pass when retained DOM and memory trends are reported after comparable settling.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Retained JS/DOM memory, detached node count, interaction latency, frame time and bundle/load size.
- [ ] Probe. Capture the same mount/unmount and room-navigation script on base and head, interleaving five valid runs on the same device. Save heap snapshots separately from natural GC/frame traces.
- [ ] Baseline. Record Svelte 5.55.9 retained memory and user-visible timings first. Match app data, browser build and map.
- [ ] Rule. No new correctness failure or repeatable regression above 5% outside measurement noise. Claim memory improvement only if reproduced. A maintenance/correctness upgrade need not meet the 10% target used for complexity-adding perf PRs.

**Review gate.** None. P2 does not intentionally redesign an interaction. Standard correctness, compatibility and upstream review still apply. If implementation changes user interaction, add operator screenshot/video review before proceeding.

**Merge.**

- [ ] Record the exact reviewed head, focused checks, live receipts and measured limitations before any authorized upstream handoff.
- [ ] Record rollback readiness. Revert the manifests and lockfile together. No product schema or UI redesign belongs to this change.


## Contribute replay evidence to upstream PR 6688 (P3)

**Depends on.** Existing upstream PR #6688. P1 is needed for comparable large-load receipts, not for its production diff.

**Files.**

- [ ] Review the current PR versions of `play/src/common/NoncedMessageStore.ts`, `play/src/pusher/services/PusherWebSocket.ts` and `play/tests/pusher/NoncedMessageStore.test.ts`. Add only uncovered behavioral tests and reproducible measurements.

**Build.**

- [ ] Fetch and inspect the authorized PR head before planning edits. Preserve the existing proposal instead of submitting a competing deque or cap. Save the reviewed SHA.
- [ ] Separate insertion/expiry/retrieval equivalence from the new count/byte limit and resume-refusal behavior. Document close-code and fresh-join semantics before extending tests.

**You see.**

- [ ] Clients either resume with complete ordered history or receive the defined failure and establish a fresh session. Save both receipts; no silent partial replay is accepted.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] From `play`, run `npm test -- --run tests/front/Connection/WorkAdventureWebSocket.test.ts` and the PR-head `tests/pusher/NoncedMessageStore.test.ts` and `tests/pusher/PusherRoomSocketController.test.ts`. Run typecheck and focused lint/format checks. These PR-head tests are not all present in the audited baseline.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, subject to the project verification and resource rules above.

- [ ] Lane 1. Regression lane against trunk. Disconnect briefly with replay history available. Save `P3/lane-1.json`. Pass when ordered delivered payloads match on base/head.
- [ ] Lane 2. Expire a large prefix at the exact cutoff. Save `P3/lane-2.json`. Pass when only the defined expired records disappear.
- [ ] Lane 3. Expire all buffered records then request older history. Save `P3/lane-3.json`. Pass when head refuses an impossible resume instead of silently losing messages.
- [ ] Lane 4. Overflow the count limit while caught up. Save `P3/lane-4.json`. Pass when the PR-defined healthy-socket behavior and memory bound hold.
- [ ] Lane 5. Overflow the byte limit while backpressured. Save `P3/lane-5.json`. Pass when the documented close/resume policy occurs.
- [ ] Lane 6. Overflow while transport-disconnected. Save `P3/lane-6.json`. Pass when history loss is detected on reconnect.
- [ ] Lane 7. Replay repeatedly from different nonces. Save `P3/lane-7.json`. Pass when order, identity and missing-history detection remain correct.
- [ ] Lane 8. Exercise a legitimate large map-editor payload. Save `P3/lane-8.json`. Pass when the defined cap policy is visible and no silent corruption occurs.
- [ ] Lane 9. Perform a fresh join after refused resume. Save `P3/lane-9.json`. Pass when the new session is usable and old membership is removed.
- [ ] Lane 10. Run 1,000 sessions with mixed slow consumers. Save `P3/lane-10.json`. Pass when retained bytes, errors, cleanup and memory are recorded and satisfy the documented limits.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Retained bytes/messages per socket, heap/RSS, prune/replay time, event-loop lag, successful resumes and forced fresh joins.
- [ ] Probe. Use the same deterministic expiry/replay traces and P1 load against the baseline and current #6688 head. Include healthy, backpressured and disconnected transports. Keep traces free of message content or credentials.
- [ ] Baseline. Record uncapped baseline retention and replay time first. Treat incident figures in the existing PR body as maintainer reports, not locally reproduced measurements.
- [ ] Rule. Enforce the PR cap/resume contract and zero silent event loss. Require no repeatable healthy-path regression above 5% outside noise. Report absolute memory bounds and saturation, not just percentages. A correctness cap can be valuable without 10% throughput improvement.

**Review gate.** None. P3 does not intentionally redesign an interaction. Standard correctness, compatibility and upstream review still apply. If implementation changes user interaction, add operator screenshot/video review before proceeding.

**Merge.**

- [ ] Record the exact reviewed head, focused checks, live receipts and measured limitations before any authorized upstream handoff.
- [ ] Record rollback readiness. Coordinate with the existing PR owner. Reverting cap behavior restores unbounded replay retention and must be documented. Do not change close codes casually.


## Skip unchanged effective viewport zone reconciliation (P4)

**Depends on.** None for production code. Use P1 or an equivalent validated harness for load evidence.

**Files.**

- [ ] `play/src/pusher/models/PositionDispatcher.ts` and `play/tests/pusher/PositionDispatcher.test.ts`. Add socket state only if the minimal lifetime design requires it.

**Build.**

- [ ] After existing validation and centered bounding, compare the effective zone rectangle for this socket. Skip redundant reconciliation only when equivalent. Save the diff and cache-lifetime reasoning.
- [ ] Invalidate state on `removeViewport`. Preserve exact viewport updates in SocketManager and the existing first-oversize warning behavior. No protocol change or new library.

**You see.**

- [ ] Repeated movement inside the same zone rectangle preserves subscriptions while allocating less reconciliation work. Save an observable membership/event trace.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] From `play`, run `npm test -- --run tests/pusher/PositionDispatcher.test.ts`, then typecheck and focused lint/format checks. Add repeated updates, crossing, removal/re-add and shared-listener behavior. Assert subscriptions and events, not that a private cache was used.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, subject to the project verification and resource rules above.

- [ ] Lane 1. Regression lane against trunk. Replay the same viewport trajectory. Save `P4/lane-1.json`. Pass when zone membership and subscription events match.
- [ ] Lane 2. Repeat a stationary viewport. Save `P4/lane-2.json`. Pass when no subscription churn occurs.
- [ ] Lane 3. Move inside unchanged effective bounds. Save `P4/lane-3.json`. Pass when exact viewport state remains current.
- [ ] Lane 4. Cross a positive grid boundary. Save `P4/lane-4.json`. Pass when the expected zones enter and leave once.
- [ ] Lane 5. Cross negative coordinates. Save `P4/lane-5.json`. Pass when Math.floor and inclusive boundaries match the baseline.
- [ ] Lane 6. Send nonfinite or inverted coordinates. Save `P4/lane-6.json`. Pass when existing rejection behavior is preserved.
- [ ] Lane 7. Request an oversized viewport. Save `P4/lane-7.json`. Pass when centered crop, 1600-zone cap and first warning remain correct.
- [ ] Lane 8. Use an elongated cropped viewport. Save `P4/lane-8.json`. Pass when zone limits and subscriptions match the baseline.
- [ ] Lane 9. Share zones across sockets then remove one. Save `P4/lane-9.json`. Pass when first-listener and last-listener semantics remain correct.
- [ ] Lane 10. Remove and re-add the same viewport under load. Save `P4/lane-10.json`. Pass when resubscription occurs and no stale lifetime cache skips it.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Effective-bound hit ratio, calls/sec, allocation bytes, CPU/update, event-loop lag and event/subscription counts.
- [ ] Probe. Interleave the same deterministic trajectory on base/head at ordinary and maximum bounded viewports, then repeat with 1,000 moving users. Save traces and profiler output.
- [ ] Baseline. Record the original allocation/time distribution and effective-bound hit ratio before implementing the early return.
- [ ] Rule. Keep only if the target metric improves at least 10% beyond noise with identical behavior and no repeatable other-metric regression above 5%. If misses dominate or benefit is noise, close the experiment without adding the cache.

**Review gate.** None. P4 does not intentionally redesign an interaction. Standard correctness, compatibility and upstream review still apply. If implementation changes user interaction, add operator screenshot/video review before proceeding.

**Merge.**

- [ ] Record the exact reviewed head, focused checks, live receipts and measured limitations before any authorized upstream handoff.
- [ ] Record rollback readiness. Revert the local optimization. There is no protocol or stored-data migration.


## Keep map autosave recoverable without overlapping writes (P5)

**Depends on.** None. Reproduce failure paths before deciding the lifecycle design.

**Files.**

- [ ] `map-storage/src/MapsManager.ts` and a focused autosave test using `Upload/FileSystemInterface.ts`. Preserve existing upload/delete and lock behavior.

**Build.**

- [ ] Reproduce failed save without a later edit, slow write beyond 15 seconds, and dirty queue expiry. Save failing observable persistence receipts before claiming data loss.
- [ ] Implement one explicit per-map save lifecycle only after agreeing dirty-state, retry and eviction semantics. Preserve newer edits during writes, serialize writes, bound retry timing and expose failures. Do not turn the current in-memory acknowledgement into a durable one silently.
- [ ] Define prolonged-outage memory behavior and cache coherence with routing/upload/delete. Review prior #5887 and #5888. Indefinite dirty retention alone is not a complete solution. Save the lifecycle contract.

**You see.**

- [ ] After storage recovers, accepted dirty edits are eventually saved without another edit and without stale overwrites. Save the persisted WAM and command ID after restart.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] From `map-storage`, run `npm test -- --run src/tests/MapStorageServer.test.ts` plus the new focused autosave test, then typecheck and focused lint/format checks. Existing server tests mock executeCommand and do not prove autosave behavior.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, subject to the project verification and resource rules above.

- [ ] Lane 1. Regression lane against trunk. Edit and save a map with healthy storage. Save `P5/lane-1.json`. Pass when the persisted WAM and command ID match.
- [ ] Lane 2. Fail the first write then recover without a new edit. Save `P5/lane-2.json`. Pass when head eventually persists the dirty state.
- [ ] Lane 3. Delay a write beyond the autosave interval. Save `P5/lane-3.json`. Pass when no concurrent same-map write occurs on head.
- [ ] Lane 4. Apply a second edit while saving. Save `P5/lane-4.json`. Pass when the newer edit is not marked clean by the older completion.
- [ ] Lane 5. Expire command history while the map is dirty. Save `P5/lane-5.json`. Pass when unsaved state is not silently discarded.
- [ ] Lane 6. Evict a clean map then reload it. Save `P5/lane-6.json`. Pass when existing cache-coherence behavior remains valid.
- [ ] Lane 7. Upload a replacement while a save is pending. Save `P5/lane-7.json`. Pass when the approved lock/invalidation contract prevents a stale overwrite.
- [ ] Lane 8. Delete a map while a save is pending. Save `P5/lane-8.json`. Pass when an obsolete save does not resurrect the map.
- [ ] Lane 9. Hold storage unavailable for the configured retry horizon. Save `P5/lane-9.json`. Pass when failure and dirty-age/memory are observable and policy remains bounded.
- [ ] Lane 10. Recover storage and restart after persistence. Save `P5/lane-10.json`. Pass when the recovered file contains the correct final state and timers/locks clean up.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Concurrent writes per map, write count/bytes, save latency, oldest dirty age, dirty-map memory, errors and retries.
- [ ] Probe. Use deferred/failing filesystem operations for deterministic tests, then repeat against an isolated real filesystem/S3-compatible test backend. Compare identical schedules on base/head and restore all injected faults.
- [ ] Baseline. Record source-confirmed interval clearing and lack of in-flight guard separately from runtime outcomes. Capture which fault sequences actually lose or stale-write data before selecting the fix.
- [ ] Rule. At most one in-flight write per map, no lost newer acknowledged edit in the defined recoverable scenarios, and healthy-path write amplification no more than 5% above baseline outside noise. Freeze retry horizon and dirty-memory bounds in the lifecycle contract before implementation. Do not claim outage durability beyond that contract.

**Review gate.** None. P5 does not intentionally redesign an interaction. Standard correctness, compatibility and upstream review still apply. If implementation changes user interaction, add operator screenshot/video review before proceeding.

**Merge.**

- [ ] Record the exact reviewed head, focused checks, live receipts and measured limitations before any authorized upstream handoff.
- [ ] Record rollback readiness. No WAM format migration. Flush or explicitly recover dirty state before restarting onto an older version; an immediate process rollback can discard the very state being protected.


## Pilot the stable native TypeScript compiler (P6)

**Depends on.** D01a establishes TS6 configuration and tooling compatibility first. P6 does not depend on a runtime performance PR. Later promotion and declaration emit remain separate D01c/D01d PRs.

**Files.**

- [ ] Scope official compiler aliases to the authoritative manifests/lockfile and pilot scripts for `back` and `map-storage`. Update the relevant CI comparison job only. Save the exact affected manifest list before editing.

**Build.**

- [ ] Add stable TypeScript 7.0.2 through the official native alias and keep the TypeScript 6 API accessible to Svelte/lint/ts-node tooling. Follow `typescript-native-migration.md`. Save the resolved binaries, packages and lockfile.
- [ ] Compare native and compatible JavaScript `--noEmit` checks without changing public declaration emission or deleting existing Svelte checks. Save diagnostic and exit-code comparisons. Keep the required existing gate until parity is established.

**You see.**

- [ ] The backend reports the same meaningful type errors and successful checks with a measured compiler time/memory change. Svelte and typed lint still run through supported APIs. Save CI/local receipts.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run the existing `npm run typecheck` checks in the pilot packages with explicit compiler resolution. Run `svelte-check` and affected typed lint consumers as compatibility checks. Do not add a test that only asserts a version string or weaken diagnostics to obtain a green result.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, using the project CLI runner and resource limits.

- [ ] Lane 1. Regression lane against trunk. Run the same backend check at TS6 baseline and native head. Save `P6/lane-1.json`. Pass when the diagnostic comparison and both exit codes are recorded.
- [ ] Lane 2. Resolve compiler executables from the repository root. Save `P6/lane-2.json`. Pass when tsc and tsc6 identify the intended distinct implementations.
- [ ] Lane 3. Resolve compiler and API from back. Save `P6/lane-3.json`. Pass when the local workspace does not shadow the chosen native CLI.
- [ ] Lane 4. Resolve the map-storage Node project explicitly. Save `P6/lane-4.json`. Pass when only the intended tsconfig is checked and diagnostics match.
- [ ] Lane 5. Run the existing play Svelte checker. Save `P6/lane-5.json`. Pass when Svelte diagnostics remain available through the supported API.
- [ ] Lane 6. Run typed ESLint through the shared config. Save `P6/lane-6.json`. Pass when projectService and parser imports resolve a supported TypeScript API.
- [ ] Lane 7. Repeat the pilot with an intentional diagnostic in a temporary fixture. Save `P6/lane-7.json`. Pass when both compilers detect it and the fixture is removed afterward.
- [ ] Lane 8. Run an authorized scoped install or CI image recipe. Save `P6/lane-8.json`. Pass when native binaries and the API wrapper are available on the target architecture.
- [ ] Lane 9. Run a warm repeated check after the cold check. Save `P6/lane-9.json`. Pass when cache mode and output are identified rather than mixed.
- [ ] Lane 10. Exercise rollback to tsc6 for the pilot checks. Save `P6/lane-10.json`. Pass when the original supported check path works and comparison overrides are removed.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Cold/warm elapsed typecheck time, peak RSS, diagnostics and process exit status. These are development/CI metrics, not runtime FPS or room capacity.
- [ ] Probe. Interleave five valid TS6/TS7 runs for identical back and map-storage projects with fixed machine, worker limits, generated inputs and cache mode. Save exact commands and raw process measurements.
- [ ] Baseline. Record TS5.9.3 before D01a and the passing TS6 compatibility baseline before P6. Attribute configuration and compiler changes separately.
- [ ] Rule. Require diagnostic parity or explicitly reviewed differences and no lost Svelte/lint gate. Promote only with improvement of at least 10% beyond noise in time or memory and no material regression in the other metric. Do not reuse Microsoft's published speedups as local results.

**Review gate.** None. P6 changes developer tooling, not product interaction. Standard compatibility and upstream review still apply.

**Merge.**

- [ ] Record exact reviewed head, supported API resolution, diagnostic parity, measured benefit and rollback to tsc6 before an authorized upstream handoff.
- [ ] Leave native declaration emission, public API output, protobuf generator changes and global editor settings outside this pilot. Remove temporary comparison jobs only after a recorded promotion/rejection decision.

## Close the program

- [ ] Reconcile every selected PR box with evidence. Reconcile all 419 declaration rows, transitive graph decisions and D14 image/service exceptions before claiming the full dependency program is complete. Mark rejected experiments explicitly rather than presenting them as completed improvements. Link accepted upstream work and outstanding maintainer decisions.
- [ ] Re-run the relevant 1,000-user scenarios on the combined accepted head. Report achieved workload, hardware, resource budgets and limitations. Clean up owned resources and preserve raw receipts.

## Appendix A. Prototype evidence

No runtime prototype, product test or benchmark was executed during planning. No branch or worktree was created by this task. Source inspection identifies plausible work; it does not settle performance benefit or reproduce data loss. P1 establishes a measurement path. P4 needs a profile before accepting a cache. P5 requires fault reproduction and a reviewed lifecycle contract before implementation. P2 needs actual browser retention measurements.

The source snapshot and prior artifacts are in [the baseline report](../baseline/REPORT.md). The [workload document](1000-user-workloads.md) defines proposed acceptance conditions. The [validation receipt](../evidence/validation.md) covers this planning deliverable only.

## Appendix B. Alternatives rejected

A wholesale Go/Rust rewrite lacks a measured bottleneck and expands upstream maintenance. A duplicate replay-store implementation competes with #6688. Blind Phaser upgrades risk dropping the local GPU patch. Removing map cloning changes scripting/cache isolation. Adding dirty rendering, movement coalescing or LiveKit adaptive options duplicates existing behavior.

Conditional next contributions are interpolation allocation reduction, bounded timeline DOM and a Matrix SDK migration. Their scopes, invariants and rejection conditions are in [the architecture document](architecture-and-replacements.md). Timeline windowing is review-gated because it can change navigation, selection and accessibility. It is not authorized for implementation by this plan.

## Appendix C. Risks

One thousand distributed sessions and one thousand visible avatars are different workloads. P1 cannot certify browser performance. Room ownership limits scaling of a single hot room. P3 limits still need a total process-memory budget. P5 must respect map cache coherence across routing changes. Matrix storage migration can constrain downgrade. No CPU/RAM purchase recommendation is validated yet.

The generic playbook's automatic branch/worktree/publication/scheduling mechanics are subordinate to user authorization. Its ten-lane template is treated as scenario coverage and scheduled proportionally through project runners. Backend receipts use structured state and timing evidence instead of decorative screenshots. No hidden execution obligation is created by this document.

## Appendix D. Links and reading list

Read root and affected-package `AGENTS.md`, `docs/agent/testing-vitest.md`, `docs/agent/lint-format.md`, `docs/agent/dev-setup.md` and the current package scripts. Use the existing test/browser drivers and record actual commands at execution time. Apply architecture exploration only when a contract or responsibility boundary really changes.

Upstream references are [replay #6688](https://github.com/workadventure/workadventure/pull/6688), [bounded zones #6423](https://github.com/workadventure/workadventure/pull/6423), [cache eviction #5887](https://github.com/workadventure/workadventure/pull/5887), [edition-lock race #5888](https://github.com/workadventure/workadventure/pull/5888), [storage-key decoding #6427](https://github.com/workadventure/workadventure/pull/6427), [lock telemetry #6339](https://github.com/workadventure/workadventure/pull/6339) and [large-viewport Intel GPU issue #6399](https://github.com/workadventure/workadventure/issues/6399). Issue reports motivate investigation; they are not reproduced measurements.

The planning process used pstack poteto-mode/how, the multi-phase plan workflow, technical-writing and unslop. The Prove It Works principle kept measured claims separate from static findings and made live/performance evidence explicit. The user's five design skills shaped narrow contracts and responsibility boundaries, as recorded in [the diagnostic](../evidence/skill-diagnostics.md).

## Appendix E. Complete dependency upgrade coverage

The user expanded the plan on 2026-11-12 to include all dependency updates and the latest stable Go-based TypeScript compiler. [The complete program](full-dependency-program.md) maps five waves to D01 through D14 and names per-family contracts, graph ownership, image/data migration gates and completion states. A queue is not a license to bundle unrelated packages into one PR.

[The target CSV](../inventory/dependency-upgrade-targets.csv) covers all 419 declarations and 217 distinct names. The registry snapshot covers 208 external npm names; eight internal names and one GitHub dependency have explicit dispositions. Latest-tag candidates are not compatibility approvals. Peer conflicts, deprecated packages and runtime-matched Node types are called out.

[The native TypeScript plan](typescript-native-migration.md) targets stable 7.0.2 with a TS6 API compatibility route. D01a precedes P6. D01c promotion and D01d emission follow successful pilot evidence. Svelte/lint and public declaration contracts remain mandatory. The obsolete native-preview package and TypeScript 7.1 beta are not the stable migration target.
