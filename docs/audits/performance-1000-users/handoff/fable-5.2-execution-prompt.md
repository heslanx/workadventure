# Execute the WorkAdventure upgrade and performance program

You are the implementation owner receiving a full handoff from Codex. The user explicitly selected Fable 5.2, currently configured at xhigh effort in this terminal. Preserve that model/effort. This is now an execution request, not another planning-only exercise.

## Objective and time budget

Implement the saved WorkAdventure dependency-upgrade and performance program as far as can be completed and verified in the authorized two-hour window. The product goal is 1,000 simultaneous users with responsive modest laptops/phones and controlled server/network cost. Produce maintainable changes suitable for upstream review, with concrete evidence. Do not claim capacity or speedups that were not measured.

The user wants to use about 90% of the remaining Claude allowance before renewal, doing useful work. The user also explicitly authorizes using all their SSH servers for parallel processing if the MacBook is insufficient. That authorization is part of this assignment, not a future question.

- Window began at 2026-11-11 23:24:30 UTC, which is 2026-11-12 00:24:30 Europe/Rome.
- Hard end is 2026-11-12 01:24:30 UTC, which is 2026-11-12 02:24:30 Europe/Rome. Calculate remaining time from the real clock; do not restart a fresh two hours after reading this prompt.
- Reserve the final ten minutes for integration, applicable checks, cleanup and an honest final handoff. Avoid starting large migrations in that closing interval.
- The terminal's /usage panel was inspected around 23:25 UTC. It showed 8% used for the current all-model weekly allowance and 0% used for Fable. Both displayed reset at Nov 12, 03:00 Europe/Rome. Usage credits were OFF. These are observations, not an exact token balance.
- Ninety percent of the then-remaining general allowance is approximately 82.8 percentage points, reaching about 90.8% total usage. The analogous Fable ceiling is about 90% used. Treat the most restrictive applicable allowance as the budget, allowing margin for delayed metering and other sessions.
- Use the supported usage display/telemetry at meaningful phase boundaries. Never invent utilization or confuse session tokens/cost with subscription percentage. Do not enable paid usage credits, switch accounts to bypass limits or generate pointless work merely to spend quota. If telemetry is unavailable, say so and respect the wall-clock boundary.
- Work autonomously within the granted scope. If one path blocks, advance an independent useful task while preserving the blocker and its evidence. At the deadline or budget boundary, stop launching work, consolidate and report actual completion. Do not call the entire program complete merely because time expired.

## Workspace and ownership

The repository is /Users/erickheslan/Developments/study/workadventure.
The inspected source baseline was ddbe245a84c78c947dd9ae5310da1fc53cd3d278.
The active branch observed was chore/orca-docker-ssh-env. Do not assume this branch is yours to rename or reset.
The borrowed user terminal is term_12b57763-67f8-40fd-9909-f5b9199d94c7 in Orca worktree b15e85c4-f456-460a-806a-b9bfbab98d00::/Users/erickheslan/Developments/study/workadventure.

You are not alone in the checkout. At handoff, unrelated existing changes included .gitignore, .audit/, orca.yaml and scripts/. Other work may have progressed since inspection. Capture current status and ownership before editing. Do not revert, overwrite, stage, kill or clean up another task's work/resources. The existing .audit/sprite-cache.* artifacts belong to other work. Do not treat them as disposable.

The user's standing agreements prohibit creating branches/worktrees, commits, pushes or force-pushes without an explicit request. This assignment authorizes implementation, dependency installs/upgrades needed by the saved plan, verification, local PR-ready descriptions/patches and remote processing. It does not add authorization to publish, merge, deploy, create Git branches/worktrees or change global configuration. Work in the current checkout and prepare reviewable local changes. For remote processing, use isolated job directories/snapshots without making Git branches/worktrees. Do not alter production services or data.

You own integration and the final report in this terminal. This is a full handoff, not an Orca dispatched worker task with Task/Dispatch IDs. Do not fabricate worker_done IDs or wait for Codex to coordinate you. If you delegate, you become the coordinator of those workers and must collect their results and cleanup receipts.

## Required instructions and saved artifacts

Read the actual root and nearest AGENTS.md and the document owning each affected area. Follow repository scripts and .github/workflows/continuous_integration.yml as verification sources of truth. Read applicable user guides under ~/.claude/development-harness/policy/ and ~/.orca/docs/, particularly testing, engineering, orchestration-reference and resource-lifecycle. Keep .env files, private keys, tokens and credentials out of reads, output and version control. Synthetic test configuration should use documented non-secret defaults or the project's existing managed setup.

Apply the user-requested domain-driven-design, refactoring-patterns, ecc:contract-first, clean-architecture and clean-code skills to the concrete scope. Apply pstack routing when its trigger applies, but user/project instructions override generic automatic branches/publication/ten-worker mechanics. Do not spend the implementation window redoing a broad abstract architecture review. Use existing contracts and narrowly scoped, behavior-preserving changes.

The complete saved plan is under docs/audits/performance-1000-users/. Read these in order and use them as the actionable queue:

1. README.md and plans/full-dependency-program.md.
2. plans/typescript-native-migration.md and plans/dependency-upgrades.md.
3. plans/upstream-pr-plan.md. P1-P6 have owned paths, invariants, unit/live/performance gates and rollback conditions.
4. plans/1000-user-workloads.md and plans/architecture-and-replacements.md.
5. inventory/dependency-upgrade-targets.csv and evidence/dependency-registry-snapshot.json, selecting rows relevant to each work unit rather than dumping entire lockfiles into context.

Use baseline/REPORT.md, CAPACITY.md, DEPENDENCIES.md, SCOPE.md and inventory CSVs as reference. Preserve the original 14 imported files and archive byte for byte. evidence/import-manifest.json records their hashes. Add execution evidence without rewriting the historical baseline to imply tests were run earlier.

At handoff the expanded plan had six PR sections and passed its structure checker. That proves document structure only. No dependency installation, compiler run, product build, test suite, browser benchmark or load test was performed by Codex during planning. Treat all performance candidates as unmeasured and revalidate release metadata at execution time when needed.

## Complete scope and priorities

The inventory maps all 419 direct declarations, 217 names, 208 externally consumed npm names, eight internal package names and one GitHub dependency. Internal publication workspaces with version placeholders must not be confused with the published dependency consumers actually resolve. The full program also covers transitive graph refresh, five npm lockfiles, two Yarn lockfiles, 44 Docker/Compose image declarations, seven Helm image declarations and declared OS packages.

Use the plan's five waves and D01-D14 queues. A queue is not one giant PR. Resolve every line eventually as updated, already_current, blocked_with_reason, replaced_with_contract_proof or internal_rebuilt. Within this window, prioritize coherent verified increments over maximizing the number of edited version strings. Report the complete denominator and remaining exceptions.

Suggested independent lanes, with explicit file ownership and one integration owner for shared manifests/lockfiles:

- Toolchain/dependencies lane. You or one designated owner exclusively edits shared manifests, lockfiles and tsconfigs. Start TS6 compatibility/native TypeScript pilot and the isolated Svelte upgrade. Serialize shared lockfile generation. Other lanes submit requested package edits to this owner rather than racing npm installs.
- Protocol/measurement lane. Restore P1's headless benchmark using existing ws and generated protobuf contracts. The current script imports a nonexistent WebSocket module and obsolete browser connection signature. Prove one accepted room session, observable movement and clean leave before scaling. Bots do not certify client rendering or media performance.
- Pusher lane. Profile and, if justified, implement P4 effective-zone reconciliation skipping with all coordinate, cropping, subscription and lifetime invariants. Investigate P3 by reviewing existing upstream #6688 instead of building a competing replay implementation. Save local review/test/benchmark evidence without publishing comments.
- Storage lane. Reproduce P5 failure, overlap and dirty eviction scenarios, then implement the smallest complete autosave lifecycle fix that passes observable persistence tests. Do not present code mechanisms as already-reproduced data loss. Preserve upload/delete/cache-coherence and the distinction between memory acknowledgement and durable storage.
- Verification/client lane. Independently validate completed slices. Profile the conditional interpolation allocation and bounded chat DOM candidates only when resources/time permit. Do not introduce virtualization or renderer changes without proving the relevant behavior and accessibility invariants.

Adjust lane count to actual CPU/RAM and shared-file ownership. Useful independent evidence is a reason to delegate; consuming quota alone is not. Do not block all work on a slow full-suite run if focused independent work remains.

## Known compatibility constraints

TypeScript:

- The observed stable native compiler is typescript 7.0.2, built in Go. The last JS compiler line observed is 6.0.3. TypeScript 7.1 is beta, not the default stable target.
- svelte-check 4.7.8 accepts TS5/6; typescript-eslint/parser 8.72.2 requires TypeScript >=4.8.4 <6.1.0. A blanket replacement of every typescript package with 7 breaks the supported API integration.
- Microsoft's supported side-by-side pattern uses @typescript/native as an npm alias to typescript@^7.0.2, and typescript as an npm alias to @typescript/typescript6@^6.0.2. The wrapper and underlying compiler versions differ; inspect and lock both. tsc is native, tsc6 and imports of typescript retain the JS API. Verify actual executable/API resolution in each workspace and scoped installation, not just package.json text.
- Follow D01a compatibility, P6/D01b backend --noEmit pilot, D01c promotion, then D01d emission/public declarations. Preserve Svelte checking and typed lint. Do not conflate faster typechecking with a Go runtime or higher room capacity.
- Inspect omitted types/rootDir defaults, inherited configs, side-effect imports and play/tsconfig-pusher.json's preserveValueImports setting. Keep existing browser targets. Do not suppress diagnostics broadly to obtain green checks.
- ts-node still uses the JS compiler API. ts-proto/gRPC generation is a separate upgrade and contract check; generated @ts-nocheck files excluded from a tsconfig make a passing check insufficient proof of wire compatibility.
- Validate Sentry sourcemap output locally; do not run an upload/publishing script as a verification shortcut.

Other packages and existing behavior:

- Svelte 5.55.9 to 5.57.3 has relevant event/derived retention fixes. Upgrade consistently and measure lifecycle behavior, without combining UI refactoring.
- Matrix 42.4.0 to 45.1.0 crosses OAuth/RTC changes and local crypto storage lifecycle. Keep separate from timeline windowing and assess downgrade/storage compatibility.
- Phaser 4.2.1 requires preserving/rebasing patches/phaser+4.2.0.patch and GPU/tile validation. A patch version does not justify silently dropping that patch.
- LiveKit client 2.23.0 was already current. LiveKit server SDK upgrades do not automatically increase SFU capacity. Existing adaptiveStream, dynacast, autoSubscribe:false, dirty rendering and movement coalescing must not be reproposed as new optimizations.
- Zod latest was 4.6.7, while @anatine/zod-openapi 2.2.8 declares Zod ^3.20.0. Treat it as a contract migration or an explicit temporary blocker, not a forced incompatible bump.
- Match @types/node to the selected runtime line. Observed latest types were 26.x while the runtime uses Node24.
- Do not blindly use --force, --legacy-peer-deps or global transitive overrides to conceal incompatibility. Investigate deprecation flags and actual consumer use before replacing packages.
- Additional backend replicas do not split a single hot room under the current ownership routing. Do not claim 1,000 visible avatars or videos are supported merely because 1,000 sockets connect.

Current source links and official release references are already in the plan. Recheck upstream duplicate status before drafting a new contribution. #6688 already addresses replay retention/caps, while #6814 and #6800 were open overlapping client/media work. Preserve relevant map-storage precedents #5887/#5888.

## Explicit SSH and parallel compute authorization

The user explicitly said you may use ALL of their SSH servers to process things in parallel if the MacBook cannot handle the workload. You may discover reachable configured hosts, assess capacity and run isolated task-owned builds/tests/benchmarks there without asking again. Prefer moving heavy compilation, test shards and protocol load generation off the MacBook when local memory pressure would distort results or disrupt it.

Use available Orca host/environment metadata and the supported CLI. The coordinator resolved the executable to `orca` and loaded `orca skills get orchestration`, `orca skills get orca-cli` and the placement-and-remote reference. Read the version-matched guide yourself before remote agent operations. Do not infer an environment route from a host id. Discover exact remote repository/path/context selectors. If a remote Orca server is unavailable, use an already configured SSH route after inspecting its documented syntax. Do not expose SSH configuration values or keys in reports.

At discovery, connected SSH entries included hostinger, 82.25.76.95 and sbh. Other configured entries included rocket-hipnose, cw-novo, cw-adsbh, knc and 82.25.69.58. Paired environment selectors included hostinger, 82.25.76.95, hostinger-knc, hostinger-sbh, sbh and vm-grok-bot. These names are discovery hints, not proof of current reachability, free capacity or distinct physical machines. Rediscover and de-duplicate actual machines before scheduling.

Use isolated job directories or containers and synthetic test data. Transfer only the required code/artifacts, preserving the exact tested revision/patch hashes, including necessary untracked generated inputs. Do not copy .env files, credential stores, private keys or unrelated work. Do not mutate production services, databases, existing containers, global runtime configuration, firewalls or other users' jobs. Do not provision paid cloud capacity. Use the existing remote environment or task-scoped dependencies; lack of a tool is not permission for system-wide changes.

Record CPU architecture, cores, free memory, disk, runtime, available container tooling and relevant current workload. Avoid saturating shared hosts. Do not compare benchmark numbers between different machines as if they were a same-machine before/after comparison. Keep the load generator separate from the measured server when testing capacity. A server farm does not replace actual modest-device browser verification.

Orca-managed remote workers require completion/steering/cleanup routing. Use dispatch messaging, not terminal injection, for workers you create. Do not create new Git worktrees because the standing user instruction still requires explicit permission. If a remote orchestration recipe requires a new worktree, use isolated SSH compute jobs on code snapshots instead, or continue another supported path without blocking the rest.

For every task-owned process/container/worker/browser/job record host, handle or PID/start identity, purpose, owner and supported shutdown command. Each worker must clean its resources and report retained resources before returning. You reconcile cleanup. Never kill by generic process name or run workspace-wide cleanup. The user terminal receiving this handoff is borrowed and must remain open for the user.

## Verification and time management

Read and follow the project's testing guide before adding or auditing tests. Use existing runners and meaningful consumer behavior tests. For each bug, first create an observable reproduction; for each performance change, first measure the relevant baseline. Reuse passing evidence while the code/dependencies/environment are unchanged. Fix failures caused by your work; report unrelated baseline failures with evidence instead of expanding scope silently.

Use the plan's five workload scenarios. Distinguish distributed sessions, one crowded room, P2P/TURN/SFU groups, presentation fanout and long-session churn. The proposed SLOs are not official supported limits and have not been met yet. Run smaller valid checkpoints before a 1,000-session test. Do not load a live public deployment. Public source/registry fetches are allowed; load testing is only against isolated task environments you control.

At each integration checkpoint record changed paths, exact checks, exit codes, measured values and current limitations. Missing or unavailable checks remain explicitly pending. A nonzero test exit is a failure unless the task was specifically to capture a failing baseline; do not relabel it as success.

Start with a short Portuguese status stating the first concrete action and current remaining time. Continue useful work; do not spend the window asking whether the user wants the already-requested upgrades. Give brief meaningful updates at phase boundaries and preserve detailed state in files. Use English for code, commands, worker prompts/reports and upstream PR descriptions, Portuguese for user-facing updates and final summary.

## Deliverables and stopping rule

Save all new execution artifacts under docs/audits/performance-1000-users/execution/ with per-lane directories, a status ledger, version decisions, measurement receipts and local PR descriptions. Keep raw logs bounded and sanitized. Do not commit bulky machine artifacts or secrets. Preserve historical audit originals.

Deliver working code/dependency changes, the checks actually run, unresolved compatibility exceptions, upstream-ready local PR scopes/descriptions and measured results where available. Maintain a row-level dependency status CSV derived from the 419-row target inventory. Separate code-ready slices from research-only candidates and time-limited unfinished work.

Ten minutes before the deadline, stop opening new broad changes and integrate what can be verified. Do not destroy another worker's edits to make a clean tree. Coordinate return/stop of your workers, preserve their useful results, and make unfinished state explicit. Release task-owned remote/local resources once their consumer is done, preserve reusable evidence, and transfer any deliberately retained resource with a named owner and reason.

Finish with a self-contained Portuguese report containing the most important completed changes, validation evidence, remaining gaps, quota telemetry if available, and the next bounded action. Link execution artifacts. If all planned work is not complete, say exactly what remains; do not claim that 419 declarations or 1,000-user capacity are finished without the corresponding evidence.

Start execution now. Codex has handed ownership to you and will not edit the implementation concurrently.
