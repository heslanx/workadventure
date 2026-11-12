# D15 round 2, lane deps: independent review

Reviewer: independent (did not author the change). Date: 2026-11-12, 01:43 to 01:47 UTC (stage deadline 01:52 UTC).
Host: knc. Remote tree: `~/wa-jobs/wa-fable-20261112/src-deps`. Container prefix: `wa-fable-r2-deps-review`.

## Verdict: FAIL (one major open item; items 1 and 2 pass)

Items 1 and 2 are correct and verified. Item 3 is correct as far as it was checked, but the brief requires the play tests that import phaser to pass, and they have not passed yet: the author's run exited 134 with no vitest summary. One stale doc reference also needs a fix.

## Checks run by the reviewer

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | Stack-apply 01, 02, 03 on a scratch copy of the checkout's current files (`/tmp/wa-r2/deps-review`, `git apply --check` then `git apply`) | 0, 0, 0 | All three patches apply in order |
| 2 | sha256 of package-lock.json, play/package.json, benchmark/package.json, back/package.json, DiskFileSystem.ts and patches/phaser+4.2.1.patch: scratch result vs remote tree | n/a | All 6 identical, so the remote tree is checkout + 01 + 02 + 03 |
| 3 | Container `-1`: `./node_modules/.bin/patch-package` | 0 | `phaser@4.2.1 ✔` (rebased patch matches the installed 4.2.1) |
| 4 | Container `-1`: `npm ci --dry-run --ignore-scripts --offline` | 0 | Lockfile in sync with the manifests |
| 5 | Mutant A (container `-2`): rename the patch back to `phaser+4.2.0.patch`, run patch-package | 0 | Prints `Warning: patch-package detected a patch file version mismatch`. The rename is needed to keep installs warning-free, but a wrong name does not fail the install |
| 6 | Mutant B (container `-2`): revert the DiskFileSystem.ts typing fix, `npx tsc --noEmit -p .` in map-storage | 2 | `DiskFileSystem.ts(77,38): error TS2345`, which reproduces the author's pre-fix error. (A second error at line 189 is a side effect of the mutant's sed, not of the product code.) |
| 7 | Restore after the mutants (`sha256sum -c`) | 0 | DiskFileSystem.ts and phaser+4.2.1.patch are back to the patched content |
| 8 | Lockfile inspection | n/a | Root `node_modules/@types/node` is still 25.9.1. There are 10 nested `<workspace>/node_modules/@types/node` 24.19.2 entries |

Containers left with prefix `wa-fable-r2-deps-review`: 0.

## Findings

### F1 (major): item 3's required test verification is missing
- File: `play/package.json` (phaser 4.2.1), `patches/phaser+4.2.1.patch`.
- The brief says to verify play typecheck **and the play tests that import phaser**. The author's `npx vitest run` on the 8 phaser-importing test files exited 134 with no summary, and the cause was not diagnosed (OOM at 3 GB is a guess). This review confirmed that the patch applies cleanly (`phaser@4.2.1 ✔`) and the lockfile is in sync, but it did not confirm the tests.
- Fix: run the phaser-importing play tests one file at a time, for example `npx vitest run <file>` with `NODE_OPTIONS=--max-old-space-size=2560`, and record the exit codes. If a file still aborts, compare it against phaser 4.2.0 + the old patch to see whether the bump caused it.

### F2 (minor): play/Dockerfile still names the old patch file
- File: `play/Dockerfile:22`, the comment `unpatched phaser (patches/phaser+4.2.0.patch fixes TilemapGPULayer rendering).`
- After patch 03 renames the file, the comment points to a file that no longer exists, which misleads anyone debugging the build. (`COPY patches ./patches` still works.)
- Fix: change the comment to `patches/phaser+4.2.1.patch` in patch 03.

### F3 (minor): @types/node 24 is nested per workspace while the root stays on 25.9.1
- File: `package-lock.json` (root `node_modules/@types/node` 25.9.1, plus 10 nested 24.19.2 copies).
- Every workspace now resolves 24.19.2, but anything that resolves from the root (root scripts, and packages without their own declaration) still type-checks against Node 25. That falls short of the decision in version-decisions.md to move to 24.x, and it adds duplicate entries to the lockfile.
- Fix: decide on root hoisting, for example a root `devDependencies` `@types/node: ^24.19.2` plus `npm dedupe`, or an `overrides` entry if the lane is allowed to add one. Then confirm with `npm ls @types/node`. The author already lists this as open.

### F4 (minor): some workspaces that declare @types/node were not typechecked
- Files: `messages/package.json`, `contrib/tools/e2e-report/package.json`, `contrib/tools/generate-env-docs/package.json`, `libs/math-utils/package.json` (no typecheck script), `libs/room-api-clients/room-api-client-js/package.json` (generated proto missing from the snapshot).
- The brief asks for typecheck of "play, back, map-storage, libs that use it". math-utils and room-api-client-js are libs that use it but have no Node 24 typecheck result.
- Fix: run `npx tsc --noEmit -p .` in math-utils, and in room-api-client-js after generating its proto, or record that these packages do not import Node types.

### F5 (nit): patch 02 includes a source change outside the deps scope
- File: `map-storage/src/Upload/DiskFileSystem.ts:76-77`.
- The change is correct and needed: mutant B reproduces TS2345 without it. `new Promise<void>` with `() => resolve()` keeps the behavior the same. It does, however, touch a product source file from the deps lane, so it can conflict with any other lane that edits this file.
- Fix: none required. Tell the integrator about it.

## Items in the brief

| Item | Status | Evidence |
|---|---|---|
| (1) benchmark devDependencies match the lockfile versions | Pass | Patch 01 adds `@types/node ^25.9.1`, `tsx ^4.22.3`, `vitest ^4.1.7`; the lockfile change is +5 lines. npm ci dry run exits 0 (rerun here). Author receipts: tests 12/12 with `._*` excluded, tsc exit 0 |
| (2) @types/node 24.19.2 in every workspace that declares it | Pass, with F3 and F4 | 13 manifests; the DiskFileSystem fix is confirmed by mutant B |
| (3) phaser 4.2.1 + rebased GPU patch | Partial (F1, F2) | patch-package `phaser@4.2.1 ✔`, author's play typecheck exit 0; phaser-importing tests not passing yet |

## Open (not done by this review before the deadline)
- Rerun of benchmark tests and tsc, play/back typecheck: not repeated. The remote tree matches the patches exactly, so the author's receipts still apply.
- The tests in F1.
