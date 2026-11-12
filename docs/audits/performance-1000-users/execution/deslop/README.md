# Deslop of the branch's product code

Base of the patches: the final state of every product file changed since `master` (ddbe245a8): `HEAD` a9081f4ac plus the five round-2 v2 patches (P5, P4 tests, P1, W3 cpu-quota-aware, W4 chat-render-items-reuse), all of which applied cleanly on top of `HEAD`. Scratch repo: `/tmp/wa-deslop` (commit `c073d19` = final state, working tree = deslop edits). Each patch applies with `git apply` from the repository root once those five patches are committed. Each patch is one commit.

## Patches

| Slice | Patch | Summary |
|---|---|---|
| map-storage | `map-storage.deslop.patch` | Drops the trunk and PR-description references from a test comment. Keeps the known limitation. |
| play pusher | `play-pusher.deslop.patch` | `PositionDispatcher`: replaces the mutable `{ reconciled }` holder in the WeakMap with the rectangle itself (delete, reconcile, set). |
| benchmark | `benchmark.deslop.patch` | `stats.ts`: removes the unused `TimerRegistry.clearAll()` and the `increment(..., by = 1)` parameter that no caller passes. |
| back CpuTracker | none | No slop found. |
| play chat | none | No slop found. |

## Edits

Line numbers refer to the final state, before the edit.

1. `map-storage/src/tests/MapsManagerAutosave.test.ts:361-362`. Focus area: unnecessary comment. The comment said "Regression guard, it also passes on trunk" and "(see the PR description)". Those describe the change history, not the test. The edit keeps what the test covers and the known limitation: a held write that succeeds after the replacement still overwrites it.
2. `play/src/pusher/models/PositionDispatcher.ts:46-50, 161-182`. Focus area: needless indirection inconsistent with the file. The WeakMap held a mutable `{ reconciled: ZoneRectangle | undefined }` box: created on the first viewport, emptied before reconciling, refilled afterwards. A missing entry and an empty box mean the same thing, so the edit stores the rectangle directly: `delete` before `reconcileZones()`, `set` after it. Behavior is unchanged. A subscription that throws halfway still leaves no rectangle, and `removeViewport()` still deletes the entry. The 25 tests pass before and after the edit, including the two partial-failure tests. The field doc comment now describes when an entry is absent.
3. `benchmark/src/stats.ts:3-4`. Focus area: speculative generality. No caller passes `increment`'s `by` parameter, which defaulted to 1. The edit hardcodes `+ 1`.
4. `benchmark/src/stats.ts:59-63`. Focus area: dead code. Nothing calls `TimerRegistry.clearAll()`, including the tests, and `runner.ts` deliberately avoids a blanket clear (see its cleanup comment). The edit removes the method.

## Considered and kept

These patterns are deliberate or carry behavior:

- `MapsManager.startSave`: the async IIFE turns a synchronous throw (from `JSON.stringify` or the storage call) into a rejection, so the failure path runs. The trailing `.catch` covers throwing handlers, which a dedicated test exercises.
- `QuotaAwareCpuTracker` constructor guard on `capacity.cores`: no production input can trip it, but the constructor takes injected capacities and a test covers the guard. Removing it would change behavior and a test.
- `readCgroupCpuQuotaCores` is a one-line wrapper that only the tests use. Removing it would mean rewriting six tests, which is beyond a minimal deslop.
- `RoomTimelineRenderItems`: `renderedSenders.has(previous)` is needed because a sender can be `undefined`.
- `as unknown as` in `PositionDispatcher.test.ts`: test doubles, the same pattern the file used on master.

## Checks

The checks ran in `node:24-trixie` containers (`--cpus 1 --cpu-shares 512 --memory 3g --network none`) against `~/wa-jobs/wa-fable-20261112/src-base`, with the final-state files copied in. Baseline: knc, container `wa-fable-deslop-1`, final state without edits. After: sbh, container `wa-fable-deslop-2`, with the edits. Extra prettier runs: `wa-fable-deslop-3` (knc) and `wa-fable-deslop-4` (sbh). Raw tails: `receipts/baseline-knc.txt` and `receipts/after-sbh.txt`.

| Check | Command (package dir) | Before | After |
|---|---|---|---|
| map-storage test | `vitest run src/tests/MapsManagerAutosave.test.ts` (16 tests) | 0 | 0 |
| map-storage typecheck | `npm run typecheck` | 0 | 0 |
| map-storage eslint | `eslint` on the two files | 0 | 0 |
| map-storage prettier | `prettier --check` on the two files | 0 | 0 |
| pusher test | `vitest run tests/pusher/PositionDispatcher.test.ts` (25 tests) | 0 | 0 |
| play typecheck | `npm run typecheck` (`tsc --noEmit`) | 0 | 0 |
| pusher eslint | `eslint` on the two files | 0 | 0 |
| pusher prettier | `prettier --check` on the two files | 0 | 0 |
| benchmark test | `vitest run` (15 tests) | 0 | 0 |
| benchmark typecheck | `npm run typecheck` | 0 | 0 |
| benchmark eslint | `eslint index.ts src tests` | 2 | 2 |
| benchmark prettier | `prettier --check index.ts src tests` | 1 | 1 |
| benchmark prettier, repo style | `prettier --check --print-width 120 --tab-width 4 index.ts src tests` | 0 | 0 |

Two benchmark failures predate this patch and are identical before and after. `benchmark/` has no eslint config (eslint exits 2, "couldn't find a config"), and it has no prettier config, so prettier applies its defaults to all 7 files. With the repo's style (`play/.prettierrc.json`: width 120, tab 4), formatting passes before and after.

The unedited slices were checked at baseline only, all exit 0: back test (22 tests), back typecheck, eslint, prettier; chat test (4 tests), eslint, prettier; play `svelte-check` (73 s).

## Noticed, not fixed

- `MapsManager.clearAfterUpload`: a write already handed to storage cannot be cancelled. If it succeeds after an upload replaced the map, it overwrites the uploaded file. The test comment and the `clearAfterUpload` comment both document this, so the limitation is known. It is still open.

## Remote state left

- No container is left: the four containers ran with `--rm`, and `docker ps -a --filter name=wa-fable-deslop` is empty on both hosts. The `.deslop` script and output dir is removed from both `src-base` trees.
- `src-base` on knc and sbh now holds the final-state versions of the 18 files in scope. They were copied in as instructed and not restored. sbh additionally holds the three deslop edits.
