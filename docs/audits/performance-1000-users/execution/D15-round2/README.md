# D15 round 2, lane deps

Host knc, tree `~/wa-jobs/wa-fable-20261112/src-deps`, image `node:24-trixie`, every check in a `wa-fable-r2-deps-impl-<n>` container (`--cpus 1 --memory 3g`, `--network none` except the two `npm install` runs that needed the registry). Raw output is in `logs/`. Scratch repo: `/tmp/wa-r2/deps`. Containers left: 0.

## Patches (stacked, apply in order)

| Patch | sha256 | Change |
|---|---|---|
| `01-benchmark-devdeps.patch` | `06b55009...` | `benchmark/package.json` declares `devDependencies` `@types/node ^25.9.1`, `tsx ^4.22.3`, `vitest ^4.1.7` (these match the root lockfile: 25.9.1, 4.22.3, 4.1.7). The lockfile change adds only the `benchmark` devDependencies block (+5 lines). |
| `02-types-node-24.patch` | `f5ba20a1...` | Changes `@types/node` from `^25.9.1` to `^24.19.2` in all 13 manifests that declare it (12 listed in version-decisions.md plus benchmark). Lockfile updated by `npm install`. Also changes `map-storage/src/Upload/DiskFileSystem.ts:76-77` to `new Promise<void>(...)` with `() => resolve()`, because Node 24 types type the `finish` listener as `() => void`. |
| `03-phaser-4.2.1.patch` | `64d78930...` | Changes `play/package.json` to `phaser 4.2.1` and updates the lockfile. Renames `patches/phaser+4.2.0.patch` to `patches/phaser+4.2.1.patch` and regenerates the hunk headers against pristine 4.2.1: 29 hunks, 7 files, 498 lines, 0 offset or fuzz, and the same +/- body as the 4.2.0 patch. |

## Checks

| # | Command (container) | Exit | Result |
|---|---|---|---|
| 1 | `npm install --ignore-scripts --no-audit --no-fund` (item 1) | 0 | lockfile +5 lines |
| 2 | `npm ci --dry-run --ignore-scripts --offline` | 0 | lockfile in sync with manifests (dry run, see open) |
| 2 | `benchmark: npm test` | 1 | fails only on `tests/._harness.test.ts`, a macOS AppleDouble file in the snapshot (24 `._*` files in the tree). This is not a product failure |
| 4 | `benchmark: npx vitest run --exclude "**/._*"` | 0 | 1 file, 12/12 tests passed |
| 2 | `benchmark: npm run typecheck` | 0 | |
| 5 | `npm install --ignore-scripts` (item 2) | 0 | 11 added, 1 changed |
| 6 | `play: npm run typecheck` (@types/node 24) | 0 | |
| 7 | typecheck back / libs/messages / shared-utils / store-utils / map-editor / benchmark | 0 each | |
| 7 | `map-storage: npm run typecheck` before the fix | 2 | `DiskFileSystem.ts(77,38) TS2345` |
| 8 | `map-storage: npm run typecheck` after the fix | 0 | |
| 7 | `libs/math-utils: npm run typecheck` | 1 | the workspace has no `typecheck` script |
| 8 | `room-api-client-js: npx tsc --noEmit` | 2 | missing `compiled_proto` and `nice-grpc` in the snapshot. Not caused by @types/node |
| 9 | `npm install --ignore-scripts` (phaser 4.2.1) | 0 | node_modules/phaser 4.2.1 |
| 9 | `patch -p1 < patches/phaser+4.2.0.patch` on 4.2.1 | 0 | 29/29 hunks applied, offsets +3/+11 in phaser.esm.js |
| 9 | `npx --offline patch-package phaser` | 1 | could not fetch the pristine copy offline. Replaced by run 11 |
| 11 | reverse-apply to pristine, `git diff --no-index`, `git apply --check` on pristine 4.2.1 | 0 | 0 offset lines, body diff exit 0 |
| 12 | `play: npm run typecheck` (phaser 4.2.1 + rebased patch) | 0 | |
| 12 | `play: npx vitest run` on 8 test files that import phaser | 134 | aborted with no vitest summary, probably out of memory under 3 GB. Not diagnosed |
| Mac | `git apply --check 01` on the checkout | 0 | |
| Mac | `git apply --check 02` on base+01; `03` on base+01+02 (scratch worktree) | 0 / 0 | |

## Fix round (v2 patches, replace 01/02/03 entirely)

Scratch repo `/tmp/wa-r2/deps-fix` (branch `v2b`), containers `wa-fable-r2-deps-fix-1..3` on knc. Logs in `logs/r2-fix/`. Containers left: 0.

| Patch | sha256 | Change vs v1 |
|---|---|---|
| `01-benchmark-devdeps.v2.patch` | `06b55009...` | byte-identical to v1 |
| `02-types-node-24.v2.patch` | `7639568e...` | v1 plus root `package.json` devDependency `@types/node ^24.19.2`; lockfile hoists `node_modules/@types/node` 24.19.2 and drops the 10 nested workspace copies (lockfile -112 lines vs v1). Still contains the DiskFileSystem.ts typing fix (F5) |
| `03-phaser-4.2.1.v2.patch` | `1ecda008...` | v1 plus `play/Dockerfile:22` comment now names `patches/phaser+4.2.1.patch` |

| Finding | Command (container) | Exit | Result |
|---|---|---|---|
| F1 | `play: npx vitest run <file> --maxWorkers=1` with `NODE_OPTIONS=--max-old-space-size=2048`, one run per file, 8 phaser-importing files (`fix-1`) | 0 x8 | 28+2+12+1+7+6+24+3 = 83 tests passed. The v1 exit 134 came from running all 8 files in one 3 GB process |
| F2 | `play/Dockerfile:22` edited in patch 03.v2 | n/a | no other `phaser+4.2.0` reference outside docs/lockfile |
| F3 | root devDependency + `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` (`fix-2`, registry access) | 0 | lockfile: `node_modules/@types/node` 24.19.2; nested copies left only for `@types/ssh2` (18.19.130) and `stanza` (22.19.19), whose own ranges require them |
| F4 | `libs/math-utils: tsc --noEmit -p .` (`fix-3`) | 0 | passes with Node 24 types |
| F4 | `messages: tsc --noEmit -p .` | 1 | TS5057: `messages/` has no tsconfig.json (proto generator package, no TypeScript to check) |
| F5 | no change | n/a | the fix is required: the reviewer's mutant B shows TS2345 without it. It stays in patch 02.v2 and other lanes must rebase on it |
| all | `git apply --check` 01.v2 on the checkout; 01.v2, 02.v2, 03.v2 stacked on the scratch base | 0 / 0,0,0 | stacked result equals the final scratch commit (empty diff) |

## Open

0. After the v2 fix round: a real `npm ci` from the hoisted lockfile was not run (node_modules on knc still has the v1 layout, with the same 24.19.2 version nested). `contrib/tools/*` and `room-api-client-js` are still not typechecked. The items below are the v1 list; items 1, 3 and math-utils from 4 are closed by the fix round.

1. Play tests that import phaser: run 12 exited 134 with no summary. Rerun them with more memory or one file at a time.
2. A real `npm ci` from the new lockfile was not run, only `npm ci --dry-run`. It runs postinstall `patch-package`, which must pick up `phaser+4.2.1.patch`.
3. Root `node_modules/@types/node` stays 25.9.1 because vitest pulls it in (`npm ls`). Each workspace gets a nested 24.19.2. Hoisting 24.x at the root needs a dedupe or override decision.
4. `messages/`, `contrib/tools/*` and `room-api-client-js` were not typechecked with Node 24 types.
5. `DiskFileSystem.ts` is a source change in patch 02. Another lane that edits that file would conflict.
6. Phaser build, tilemap rendering and e2e checks were not run.
