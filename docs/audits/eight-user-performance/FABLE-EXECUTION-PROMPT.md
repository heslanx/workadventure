# Execute the eight-user performance program alongside your current WorkAdventure work

## Assignment, authority, and deadline

You are the user's existing Fable 5.2 agent in terminal `term_12b57763-67f8-40fd-9909-f5b9199d94c7`, working in `/Users/erickheslan/Developments/study/workadventure`. The terminal was verified as Claude Code, Fable 5.2, xhigh effort. Keep the requested model and effort. This is an additional user-authorized implementation assignment, not a replacement for your current work.

The user explicitly asked us to finish the plan, send you the complete prompt, have you integrate this work concurrently with your existing assignment, and allow use of all their available SSH servers for parallel processing if the MacBook cannot sustain it. They have a two-hour window and want to use about 90% of their available Claude quota before it expires/resets. Carry useful implementation, investigation, verification, and review forward aggressively within that window.

The timebox was anchored when this request was received:

- Start: **2026-11-11 23:25:49 UTC**, or **2026-11-12 00:25:49 Europe/Rome**.
- Deadline: **2026-11-12 01:25:49 UTC**, or **2026-11-12 02:25:49 Europe/Rome**.
- The clock does not restart when you read this message. Obtain current time and allocate the remaining interval.
- Stop starting new changes during the final 15 minutes. Use that interval for verification, integration, cleanup, and a truthful handoff. Existing failing checks may still justify a bounded corrective action.

If the actual quota reset shown by the supported usage meter differs from the user's two-hour estimate, record that difference and the effective stop condition. Treat the quota target as approximately 90% of the available allowance measured at the start, leaving about 10% for completion, unless your existing conversation gives a clearer interpretation. Observe the actual meter through the supported authenticated interface; do not infer quota from token counts or elapsed time. If usage cannot be observed, say it is unavailable and govern work by the deadline and useful task completion. Do not create repetitive or irrelevant work solely to consume allowance.

The instruction to implement this program supersedes the earlier document-only scope for this added work. It does not erase unrelated constraints or silently authorize every speculative change. You can choose and execute justified improvements without asking the user to select A02 first. Preserve the original assignment and any explicit authorizations it already carries.

## Current state and authoritative inputs

Read the workspace `AGENTS.md`, nearest package instructions, and applicable testing, engineering, performance, orchestration, and resource-lifecycle guides. User-facing messages are Portuguese; code, commands, worker prompts, worker reports, and commit messages are English.

Primary documents, all available in this same checkout:

1. `docs/audits/eight-user-performance/README.md`: 22 hypotheses H01–H22, seven debt/gap entries D01–D07, evidence and exact source references.
2. `docs/audits/eight-user-performance/architecture.md`: five deepening candidates A01–A05, deletion tests, existing seams/adapters, behavioral invariants and test paths.
3. `docs/audits/eight-user-performance/investigation-plan.md`: controlled experiments P0–P4, measurement fields, acceptance and rollback rules.
4. `docs/audits/eight-user-performance/evidence/`: original two-client cache results and SHA-256 provenance.
5. `docs/audits/eight-user-performance/VALIDATION.md`: what the documentation author actually checked; no eight-user benchmark or product tests were claimed.

Also reconcile, rather than duplicate, the concurrent broader program:

- `docs/audits/performance-1000-users/README.md`
- `docs/audits/performance-1000-users/plans/upstream-pr-plan.md`
- `docs/audits/performance-1000-users/plans/1000-user-workloads.md`
- `docs/audits/performance-1000-users/plans/architecture-and-replacements.md`
- `docs/audits/performance-1000-users/plans/dependency-upgrades.md`

Those documents may be changing in parallel. Inspect their current content and your existing assignment before choosing owners. Their version/PR research is time-specific and must be revalidated before relying on an external PR's present state. They contain a benchmark restoration lane and existing replay/retention work; do not start competing implementations for those paths. Separate dependency upgrades from behavior/performance changes so their effects remain attributable.

Reference HEAD at investigation time was `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`; the checkout already contained unrelated changes and untracked work. The verified terminal branch was `chore/orca-docker-ssh-env`; do not switch it. Earlier status included a modified `.gitignore` and untracked `.audit/`, `docs/audits/`, `orca.yaml`, and `scripts/`. Preserve all existing and concurrently arriving work. Never reset, clean, or restore the shared checkout to manufacture a baseline.

No `GLOSSARY.md` or `docs/adr/` was found in the bounded architecture scan. Recheck if relevant decisions now exist; absence in that scan is not proof that the project has no historical decisions.

## Objective and success criteria

The reported incident is that **eight people in one room experience general freezes, even with cameras off**. The goal is a responsive session with correct movement, proximity communication, chat, and resource cleanup, with credible evidence identifying what was improved.

Complete as much of the full program as the timebox permits, prioritizing a demonstrated user-visible improvement and complete verification over speculative breadth. Every hypothesis must receive an explicit triage state: confirmed, refuted within a stated scenario, inconclusive with a next discriminator, or not executed with a reason and owner. Never mark all 22 optimized simply because they were listed or statically reviewed.

A correction is complete when its behavior is implemented, relevant consumers preserve their contracts, applicable focused checks pass, representative runtime evidence supports the claim, and temporary overrides/resources are accounted for. A small correct implementation with reproducible evidence is a completed slice; an unverified broad refactor is not.

Do not infer a universal eight-user limit, or claim capacity for 1,000 users from an eight-user test. Keep browser, protocol generator, backend, and media evidence distinct.

## Confirmed facts that must shape decisions

- In one local two-client test, a returning custom avatar produced **zero additional sprite requests** while the observer remained in the scene. A full reload yielded six 304 responses. This establishes cache reuse for that scenario, not bandwidth totals or eight-user FPS.
- Sprite cache, binary protobuf, movement updates around 200 ms with immediate exceptions, approximately 100 ms batching, spatial/viewport interest, interpolation, and dirty rendering already exist.
- `Game.step` updates scenes before its render gate. Skipping a draw does not prove cheap update work.
- Conversation bubbles already use affected-state filtering and a spatial lookup. Their active redraw path calculates geometry, creates graphics, replaces a generated texture, and cleans up the previous texture. This is a real cost candidate, not a proven leak or unconditional redraw.
- Camera-off does not imply microphone-off, no audio processing, no screen share, or no peer connections. `keepAudioWarm` can retain a live disabled microphone track; that does not prove noise suppression continues processing absent audio.
- Eight users in a map are not necessarily eight in one media space. Only a full eight-person mesh implies 28 pairs and seven counterparts per participant.
- Source defaults for `MAX_PER_GROUP` and `MAX_USERS_FOR_WEBRTC` are four, but Helm examples override maximum group size to 1,000. Inspect effective nonsecret settings; do not report source defaults as the deployed configuration.
- LiveKit configuration presence is not evidence of a healthy active media connection. The policy refuses transition when LiveKit is unavailable. Delayed fallback and transition serialization already exist.
- Proximity-session cancellation/readiness is distinct from provider switching. Existing code documents a nine-second participant-readiness backstop and serialized default-room joins. Delayed conversation activation with responsive menus is not the same symptom as a frozen renderer.
- The backend intentionally drops intermediate `moving=true` positions while its CPU tracker is overheated, preserving final stopped positions. The default threshold is process-relative and not quota-aware. This can explain remote jumps but not, alone, frozen local menus.
- Pusher drain handling, nonce replay, keepalive and reconnect already exist. Retention in the inspected nonce store is time-based without a byte/count bound in that implementation. Coordinate with existing upstream work before changing it.
- The local stack was started earlier at `http://play.workadventure.localhost/` under Compose project `workadventure-sprite-check`. It is a development setup with a minimal map, not a production capacity benchmark. Reuse only after checking current ownership/readiness. Preserve unrelated containers and the user-requested local preview.

## Integrate this assignment with the work already in progress

At your next safe coordination point:

1. Read this prompt and the primary documents; acknowledge integration through Orca. Do not interrupt, restart, or discard your current task or active workers.
2. Inventory the current tasks, active file owners, existing evidence, available capacity, and remaining time. Add these workstreams to the same plan/DAG where appropriate.
3. Assign exactly one writer to each file/module. If an existing worker owns a path, send it the additional requirements or schedule the dependent change after it finishes. Read-only reviewers may work concurrently.
4. Preserve passing evidence while its source, configuration, dependencies, and environment remain unchanged. Do not repeatedly rerun expensive suites without a new hypothesis or relevant change.
5. Maintain a shared integration journal and reconcile worker results before reporting completion. State which task produced each diff and artifact.

Do not create a separate competing project or universal architecture rewrite. Keep this program's runtime diagnosis coordinated with the 1,000-user program's generator, replay and dependency lanes.

## Workstream ownership and execution DAG

The streams below are responsibility partitions, not a requirement to launch five heavy workers on the MacBook. Choose concurrency from observed capacity and existing owners. A worker brief must identify the exact paths it owns and explicitly say that other agents share the checkout and their edits must be preserved.

| Stream                            | Owns and investigates                                                                                                     | Dependencies and acceptance                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W0: reproduction and evidence     | P0–P4 protocol, run manifests, timestamp correlation, environment inventory; coordinate with the existing benchmark owner | Starts immediately; must distinguish local UI freezes, remote movement lag, media stalls and join waits; proves real room acceptance and cleanup         |
| W1: game and rendering            | H01–H04, H07–H09; A01; scene, bubbles, interpolator, map rendering and asset costs                                        | Baseline first for performance changes; preserve movement, appearance, cache isolation and resource cleanup; one owner for GameScene                     |
| W2: proximity and media lifecycle | H10–H14; A02; session operation identity, cancellation, readiness, join/leave, provider and audio processing              | Reproduce behavioral failure or demonstrate interface friction; preserve existing abort/locks/backstops, history and registry ownership                  |
| W3: transport and operations      | H15–H20; A04; pusher, nonce store, reconnect, quotas and per-process observability                                        | Coordinate with existing replay/upstream and benchmark owners; preserve ordered durable events and stopped position; collect actual quota/queue evidence |
| W4: timeline and compatibility    | H05/H06/H21/H22, relevant H10; A05; chat projection/DOM, scripting attribution, build/version/device checks               | Coordinate package changes with the existing dependency owner; preserve anchors/read markers/focus; no extra owner editing GameScene or lockfiles        |

W0 should produce usable early evidence while W1–W4 inspect bounded paths and run existing focused behavioral tests. Implementation forks start after the relevant evidence gate; independent proven fixes need not wait for every hypothesis to finish. Integration waits for all required consumers/checks of each selected change. Final review and resource cleanup apply to every stream.

If broad coverage exceeds the remaining time, finish complete slices and leave a precise continuation queue. Do not let unfinished experiments hide failed checks or overwrite the original task's priorities.

## Hypothesis coverage checklist

Use the complete details in the README; retain these IDs in the execution journal:

| ID  | Mechanism and discriminating check                                                                     |
| --- | ------------------------------------------------------------------------------------------------------ |
| H01 | Bubble geometry/texture churn: separated versus grouped, stationary versus moving                      |
| H02 | Scene update/event bursts: local controls and long tasks, stationary versus moving                     |
| H03 | Animated map/render invalidation: real map versus static minimal map                                   |
| H04 | GPU/DPR/device pressure: backing dimensions, resolution, acceleration and device comparison            |
| H05 | Chat history/DOM: short versus long history, visible versus closed, anchor behavior                    |
| H06 | Map scripts/embedded sites: isolate integrations and attribute frame/origin work                       |
| H07 | Cold assets/avatar construction: same versus different avatars, first appearance versus return         |
| H08 | Map cloning/collision setup: room transition CPU/memory and cache mutation invariants                  |
| H09 | Pathfinding: keyboard versus long/unreachable click-to-move requests                                   |
| H10 | Lifecycle retention: repeated equivalent room/conversation cycles and retained-object analysis         |
| H11 | Audio/suppression/meters: inspect real tracks and compare no publication, microphone, suppression      |
| H12 | P2P/SFU topology: actual peers/provider and effective transition threshold                             |
| H13 | Proximity churn/readiness: rapid enter/leave/reenter, pending join cancellation and provider switches  |
| H14 | ICE/TURN/UDP/VPN: selected route, loss, RTT, connection attempts and another network                   |
| H15 | Backend movement shedding: correlate overheat with remote jumps and preserved final position           |
| H16 | Quotas/host contention: per-process capacity, throttled time and event-loop delay                      |
| H17 | Backend memory/GC/blocking paths: timestamped pauses, restarts, allocation and I/O attribution         |
| H18 | Backpressure/replay bursts: queue sizes/bytes, drains, replay completeness and application cost        |
| H19 | Proxy/session loss/reconnect: close codes, timeouts, restarts and session routing                      |
| H20 | Shared network loss/congestion: compare networks while preserving client/map conditions                |
| H21 | Development/profiler overhead: comparable production build and observer overhead control               |
| H22 | Version/patch/extension/background behavior: known versions, clean profile, patches and tab visibility |

## Architecture choices

Use `codebase-design` vocabulary and the existing candidates. The user now authorizes you to make routine bounded choices needed for execution, preserving established product behavior; do not stop solely because the earlier report ended with a candidate-selection question.

- A02 is the first architectural exploration recommendation because cancellation/ordering knowledge is distributed and existing tests provide a behavioral foothold. It is not the proven performance culprit.
- A01 is a concrete rendering candidate; it moves ahead if bubble work dominates the profile.
- A03 starts with existing diagnostic tools. A new module or generic analytics interface remains speculative until repeated real consumers justify it.
- A04 deepens existing delivery guarantees, not a universal controller combining backend CPU, network, and browser frame budgets.
- A05 can concentrate projection and anchors; virtualization remains conditional, with search/selection/read semantics explicitly preserved or resolved.

Apply the deletion test: consolidate real complexity instead of creating pass-through facades. The interface is the test surface. One adapter does not justify a hypothetical seam. Preserve real existing variation such as Matrix/Proximity and room transport/test adapters. Do not infer that mocks make a remote dependency locally substitutable in production.

## SSH and compute placement

The user explicitly authorizes using **all their available SSH servers** for parallel processing when the MacBook is insufficient. This grants placement of this work, not deletion of existing workloads or production-wide load tests.

Discover available host aliases or Orca paired servers and inspect only metadata needed for capacity and ownership. Do not print private keys, credentials, `.env` contents or authenticated URLs. Reuse established access; do not change global SSH/agent configuration. Do not assume every listed host is an empty test machine.

Prefer heavy builds, focused test shards, protocol generators and independent analysis on suitable remote hosts. Keep real browser/GPU observations on representative hardware; a headless software renderer on a server is not evidence of MacBook or end-user GPU performance. Separate load generators from the application under test where feasible and record both loads.

Before remote work, load the installed version-matched Orca guide and its placement reference. Use the executable selected for that session. For an Orca worker on a paired server, discover the exact remote project selector, and use supported `worker-start --on`/dispatch messaging. Do not guess a local repository path on a remote host. Honor the project's restriction on creating branches/worktrees: this add-on does not authorize new Git branches or worktrees. Use an already authorized workspace or isolated non-Git test snapshot; if a remote Orca path requires a new worktree, use an existing allowed execution route instead, or report the specific constraint.

For plain SSH test execution, use task-owned scratch directories and exact process identities. Transfer only necessary source/artifacts, excluding credentials, `.env` files, private keys, unrelated repositories, and existing data stores. Use safe structured arguments or properly quoted commands. Respect current CPU/RAM/disk and other users' jobs. Do not install new dependencies or change shared infrastructure unless a separate user authorization already covers it.

Record host, directory, command, source identity, timestamps, process/terminal handle and cleanup owner for each remote task. Collect results and patches into the authoritative checkout through the file owner, not concurrent blind synchronization. Never terminate by executable name, port alone or broad pattern. Restore only your fault injections and overrides, and stop only your generators/processes.

## Measurements, verification, and acceptance

Start with a short 1 → 4 → 8 participant comparison, including eight separated/grouped and stationary/moving, then actual media isolation. If the affected map is unavailable, use the fixture for mechanism tests and explicitly retain the real-incident gap. Do not claim a fixture reproduces the user's map.

Measure frame-time distributions, input response, browser long tasks/layout, heap/retention/GPU where available, real media tracks/peer counts/RTT/loss, backend and pusher CPU/RSS/GC/event-loop delay, quota throttling, queue/drain/replay and reconnect events. Record units, origins, build/map/device/network and changed variable. HTTP 304 means no body, not zero total traffic.

Use at least three comparable repeated runs as the initial eight-user protocol where time allows; if executing a broader PR plan with stronger repetition requirements, honor that plan. Alternate baseline/candidate when possible. State insufficient samples rather than fabricating percentiles or improvement. No numerical product SLO was approved by this investigation; the broader program's thresholds are proposals, not already met guarantees.

For behavioral bugs, obtain a focused reproduction at the real public behavior/test interface and fix the actual failure. For performance refactors, identify the hot path and compare before/after with the same inputs and environment. Pure maintenance can be valuable without a speedup, but must be labeled accordingly.

Re-use applicable existing tests, including PlayerMovement, ProximitySpaceManager, ProximityChatRoomManager, SpaceRegistry/SpaceIntegration, CommunicationManager/TransitionPolicy, WorkAdventureWebSocket, SocketManagerSpaceStateQuery, timeline tests and encoder/stat tests. Inspect their cases before claiming coverage. Add tests only for missing observable behavior. Run checks through the owning package's scripts and nearest AGENTS. Do not mask failures with casts, disabled checks, weakened assertions, sleeps or unreported skips.

For rendering/media changes, verify actual runtime state and visible behavior, not just a unit test or screenshot. Preserve final movement, ordering, resource disposal, media publication/privacy, room membership, history and scroll/read state. Do not remove map cloning without protecting the cache from scripting mutations. Do not drop arbitrary replay messages to lower memory. Do not raise the overheating threshold as a substitute for diagnosis.

Use independent review for each integrated production slice, with reviewers reading the actual diff and evidence. A claimed gain must include baseline/candidate values, variability, workload and limitations. Report unrelated failures with evidence and keep their repair outside scope unless they block the authorized work.

## Time and quota allocation

Recompute time remaining at receipt. Use the phases below as allocation guidance, compressing early phases if earlier work already supplies valid evidence:

| Remaining-window phase                | Concrete output                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| First 10 minutes                      | Acknowledgment, existing-task integration, ownership/DAG, quota reading if available, host placement and baseline setup                     |
| Next 20 minutes                       | First accepted session/movement/leave evidence, eight-user symptom classification or documented access gap, focused lifecycle reproductions |
| Main middle interval                  | Parallel bounded fixes/deepening where justified; hypothesis triage; before/after evidence; continuous integration through owners           |
| Last 25 to 15 minutes before deadline | Stop expanding scope; independent review, focused consumer checks, final runtime comparison                                                 |
| Final 15 minutes                      | Finish verification, remove measurement overrides, reconcile SSH/local resources, preserve results and write continuation queue             |

Increase useful parallelism across independent files/hosts if the usage meter and capacity permit. Reduce concurrency if it compromises benchmark validity, creates file conflicts, exhausts memory, or leaves insufficient allowance for finishing. Do not repeatedly sample status or repeat passing suites to burn quota. No promise of exactly 90% is possible without the actual meter.

## Required artifacts and final report

Keep new evidence in a task-owned directory such as `docs/audits/eight-user-performance/execution/2026-11-12/`, coordinating with any existing owner. Large raw traces may remain in an agreed artifact location with stable references and hashes; avoid committing secrets or unrelated logs. Do not overwrite earlier functional evidence.

Required outputs:

1. An integration/ownership journal covering the original assignment plus this addition, exact start/deadline, effective resources and quota observations or their absence.
2. A hypothesis status matrix for H01–H22, architectural decisions for A01–A05, and debt status for D01–D07, each tied to evidence or an explicit remaining gap.
3. Complete reviewable diffs for accepted fixes, exact checks and exit codes, runtime receipts, before/after evidence and rollback notes.
4. Resource accounting for local/remote workers, browsers, test stacks and generators; retained resources have an explicit purpose and owner. Preserve the user's pre-existing Fable terminal and local WorkAdventure preview.
5. A Portuguese final report distinguishing implemented/verified work, investigated-but-not-changed items, failures/blockers and the next concrete action. Worker reports and technical receipts stay English.

The newest plan is not an instruction to commit, push, publish PRs, merge, deploy, create branches/worktrees, buy capacity, or modify global settings. If your original assignment separately authorized an action, preserve that authorization and record its source; otherwise keep reviewable local results. New dependencies retain the project's approval requirement.

Use the selected Orca runtime for acknowledgments, questions and results. Read any receipt `next` instruction. Do not replace Orca with an unrelated agent transport for this handoff. Integrate this task, acknowledge the effective plan, and proceed without waiting for another user confirmation on already authorized reversible work.
