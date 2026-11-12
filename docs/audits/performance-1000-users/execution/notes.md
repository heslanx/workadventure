# Execution notes

Program store for the execution window that follows the saved plan in `../plans/`.
The historical baseline (`../baseline/`, `../inventory/`, `../evidence/`, `../archive/`, `../plans/`, `../handoff/`) is preserved unmodified. Everything produced by execution lives under this directory.

## Scope granted by the user

- Execute the saved dependency-upgrade and performance program as far as it can be completed and verified inside one two-hour window.
- Window: 2026-11-11 23:24:30 UTC to 2026-11-12 01:24:30 UTC. Work started at 23:29:41 UTC after the handoff was read. Last ten minutes reserved for integration and the final report.
- Authorized: implementation in the current checkout, dependency installs and upgrades the plan needs, verification, local PR-ready descriptions and patches, remote processing on the user's SSH servers.
- Not authorized: branches, worktrees, commits, pushes, publishing, merging, deploying, global configuration changes, changes to production services or data, paid capacity.
- Source baseline: `ddbe245a84c78c947dd9ae5310da1fc53cd3d278` on branch `chore/orca-docker-ssh-env`.

## Selected PR IDs for this window

P1 (headless load generator), P2 (Svelte), P3 (review evidence for upstream #6688), P4 (zone reconciliation, measured keep/reject), P5 (map autosave lifecycle), P6 with its D01a prerequisite (TypeScript 6 line, then native compiler pilot). Research-only: D14 image targets, compatibility blockers, client candidates.

## Verification rule

A slice is verified only when its unit, live and perf gates in `../plans/upstream-pr-plan.md` each have a receipt here. A nonzero exit is a failure. A gate without a receipt stays PENDING in `STATUS.md`. Each product diff also gets an independent review by an agent that did not write it.

## Merge ownership and done condition

Upstream maintainers own acceptance and merge. Nothing is published from this window. Done for the window means: every lane has a status row in `STATUS.md`, every dependency declaration has a row in `dependency-status.csv`, and task-owned resources are released or handed over in `resources.md`. It does not mean the 419-declaration program or 1,000-user capacity is complete.

## Guides read

Root `AGENTS.md`, `docs/agent/dev-setup.md`, `~/.claude/development-harness/policy/testing.md`, `~/.orca/docs/orchestration-reference.md`, `~/.orca/docs/resource-lifecycle.md`. Lane owners read the nearest `AGENTS.md` and the test, lint and TypeScript style guides for their area.

## Shared checkout at start

`git status` at 23:29 UTC showed changes that belong to other work and are left untouched: ` M .gitignore`, `?? .audit/`, `?? docs/audits/`, `?? orca.yaml`, `?? scripts/`.

## Environment findings that shaped execution

1. The checkout is bind-mounted into another task's live dev stack (`workadventure-sprite-check-*`), and its `node_modules` holds linux-arm64 binaries. Node tooling for the checkout therefore runs inside a task-owned container (`wa-fable-local`), and no `npm install` is run in the checkout while that stack is live. Dependency changes are prepared and verified on remote snapshots and applied to the checkout as manifest and lockfile diffs.
2. The MacBook was saturated at start (load average above 400, about 95 MB of free pages; the Docker VM has 4 CPUs and 8 GB shared with eleven other containers). Builds, typechecks and the live stack moved to the two VPS hosts.
3. Both VPS hosts also run production and staging services. Task containers are CPU and memory capped, use lower CPU shares, publish no ports and live under one job directory.
