# Phase 2, first pass: `GameScene.ts` (refactoring-patterns)

The user is paying down technical debt in WorkAdventure on the way to 1,000 simultaneous users, responsive weak devices and an answer to the eight-user freeze. Phase 1 put a safety net under `play/src/front/Phaser/Game/GameScene.ts` (about 4,900 lines). This pass makes the frame loop's remote-player code easier to read without changing what it does, using only code that net pins: `update()`'s remote-player section and the local position-sharing path, both pinned by `play/tests/front/Phaser/Game/GameSceneMovement.test.ts`.

Baseline: `HEAD` = `052f2d840`, `GameScene.ts` sha256 `6abf3d8f538aa5a4388e4fd39d245799e17253180e6c971f45bf41c354f258ef`. The test files were not changed.

## Deliverables and stack order

Apply in this order with `git apply` from the repository root. Each patch is the diff between two consecutive stages of a scratch repository built from `git archive HEAD`, one commit per refactoring.

| # | file | refactoring | smell | sha256 | `GameScene.ts` after |
|---|---|---|---|---|---|
| 1 | `01-remove-dead-switch-cases.patch` | Remove Dead Code (18 lines deleted) | commented-out switch cases in `update()` | `ed3b1253c648c24295e9f1030dfd6f9f78b47ba592efdad3d1197bb18cfcf54d` | `72ef938b12fe75f7aff787cb4e1c23e5ad8d03968166971fc3355ec9587bae67` |
| 2 | `02-gs07-onPlayerMovementEnded-comment.patch` | comment corrected (3 lines changed); the API stays | GS-07, misleading comment | `2f405c00be1f3664dc6b1ca4ce7568a3251e00029c486f2639000bbaded7c223` | `99527fb22009893f64e27280f1c6de18678196a0c3db1af15b08d9316c89bfed` |
| 3 | `03-extract-update-remote-player-steps.patch` | Extract Method, twice | long method `update()` | `195e37f148034dbf4abc3a8037288020d9c650c7195f199dd9f6f9c68d95812f` | `699f7356614bac69d2709a54d7312a72bd214cb0293877cd82ed28cf81650301` |

Also here: `mutants.diff` (the three mutants of the check below, sha256 `d6b520049d89a11886c9d558dbb20385f820af2cb3f1ab53e26c3998ffd8b8e8`), `TECH-DEBT.md.rows` (ledger and Smell Inventory updates, one new row) and `checks.raw.log` (every run, ANSI stripped).

## The refactorings

### 1. Remove Dead Code: the commented-out cases in `update()`

`update()`'s `pendingEvents` switch kept four cases in comments: `AddPlayerEvent`, `RemovePlayerEvent`, `UserMovedEvent` and `PlayerDetailsUpdated` (`HEAD` `:1459-1473`, `:1477-1479`). The queue's type (`:318-320`) is `GroupCreatedUpdatedEventInterface | DeleteGroupEventInterface | GroupUsersUpdatedEventInterface`, and the switch ends in a `never` check, so none of those four events can reach it. Remote-player joins, moves, detail changes and leaves now arrive through `RemotePlayersRepository`, which the block just above the switch drains. The patch deletes the 18 comment lines and nothing else.

### 2. GS-07: `onPlayerMovementEnded` is not dead, so the comment was fixed

The search ran `rg -i --no-ignore --hidden` over `play`, `libs`, `tests`, `back` and `map-storage` without `node_modules`, so it includes git-ignored files, the scripting and iframe APIs (`play/src/front/Api`, `play/src/iframe_api.ts`) and the tests. The patterns `movement.?ended` and `onPlayerMove(ment)?End` also match access by string. The only hits outside `GameScene.ts` are `ExtensionModuleOptions.onPlayerMovementEnded` (`play/src/front/ExternalModule/ExtensionModule.ts:44`) and the docs. Nothing in the repository registers a callback. `GameScene` still hands the registration function to every extension module it loads (`GameScene.ts:2711`, inside `initExtensionModule`), and those modules come from `play/src/front/external-modules/*/index.ts` through `import.meta.glob`. That folder is git-ignored (`play/.gitignore:35`), holds only `.gitkeep` in this checkout, and, according to `play/tests/pusher/AnalyticsEventCatalog.test.ts:40-41`, is symlinked to the SaaS repository's own `external-modules/` when both are checked out. The API was added for those modules on purpose: `9988cb7a3`, "Add possibility to listen player movement for the external modules (#4890)". The callers sit in a repository this checkout does not contain, so the absence of a caller cannot be proven, and removing the API could break them.

So the patch fixes the comments instead, as the brief allows. The loop's comment ("Call movement ended callbacks if movement just ended") and the field's comment ("Listeners for when the player finishes moving") are deleted, and the comment on the public method now states the contract the code has. Callbacks get every move event of the local player: `Player.moveUser` emits one per moving frame and one on the stop (`Player.ts:158-171`), and turns (`:75`), path following (`:233`, `:239`) and teleports (`:284`, `GameScene.ts:1178`) emit too. No statement changed. The name itself still lies; renaming it, or filtering on `moving: false`, would change the extension API, so it is recorded as GS-09 in `TECH-DEBT.md.rows` and not done here.

### 3. Extract Method: `update()`'s remote-player block

Two pinned steps of `update()` became private methods. Every moved statement is byte-identical, indentation included, and keeps its order; the throw for a missing player and the draw loop's `this.dirty = true` moved with their step.

- `applyBufferedRemotePlayerChanges()` holds the four loops that apply the repository's added, moved, updated and removed players (`doAddPlayer`, `doUpdatePlayerPosition`, `doUpdatePlayerDetails`, `doRemovePlayer`), then the one-time player-count diagnostic, then `remotePlayersRepository.reset()`.
- `drawRemotePlayersAtInterpolatedPositions(time)` holds the interpolator call, the per-player position update with its throw, the conversation-bubble collection and the camera-follow viewport resend. It returns the set of conversation bubbles that the rest of `update()` still uses. Returning the set keeps `new Set()` after `getUpdatedPositions(time)`, as it was; creating the set in `update()` and passing it in would have reordered the two.

`update()` now reads as: frame bookkeeping, local-player input, `applyBufferedRemotePlayerChanges()`, the group-event loop, `drawRemotePlayersAtInterpolatedPositions(time)`, the bubble step, the debug overlay. The only comment dropped is "Let's move all users", which the new method name replaces.

| stage | `update()` lines | extracted methods (lines) | `GameScene.ts` lines |
|---|---|---|---|
| `HEAD` | 162 (`:1380-1541`) | none | 4,892 |
| after patch 1 | 144 (`:1380-1523`) | none | 4,874 |
| after patch 2 | 144 (`:1379-1522`) | none | 4,874 |
| after patch 3 | 84 (`:1379-1462`) | `applyBufferedRemotePlayerChanges` 42 (`:1464-1505`), `drawRemotePlayersAtInterpolatedPositions` 24 (`:1507-1530`) | 4,882 |

Mechanical check of patch 3, run on the patch file: the multiset of removed lines minus the multiset of added lines is exactly the one comment line `// Let's move all users`. The added lines left over are the two call sites, the two method signatures, their two closing braces, two blank lines and `return conversationBubblesToUpdate;`. No statement was edited. The patch shows the group-event loop and the end of `update()` as removed and re-added: the extracted drain body stays at the same place in the file, right after the new `update()`, so every diff algorithm (myers, patience, histogram, minimal) keeps it and moves the shorter code around it instead. In the scratch repository, `git diff --color-moved=plain` between stages 2 and 3 marks 96 of the 104 changed lines as moved (47 removed, 49 added); the 8 others are the call sites, signatures, closing braces, the `return` and the dropped comment.

## Checks

Host sbh, image `node:24-trixie`, `docker run --rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none --label owner=wa-fable-20261112`, names `wa-fable-p2gs-<run>`, one at a time. The dependency tree `~/wa-jobs/wa-fable-20261112/src-review` was mounted read-only and not modified; `tmpfs` on `play/node_modules/.vite` and `.vite-temp`. The tree predates `HEAD`, so the runner (`~/wa-jobs/wa-fable-20261112/p2gs/run.sh`, copied from `rt1/run.sh`) bind-mounts `HEAD`'s copies read-only over the files that differ: `play/src/pusher`, `play/tests`, `play/src/front/Chat/Components/Room`, `Game.ts`, `MediaStore.ts`, `childWindow.test.ts`, map-editor's `MapValidator.ts` and its test, plus the stage's `GameScene.ts`. A blob comparison of `HEAD` against the tree's blob list (`rt1/tree-blobs.tsv`) found the same source files as the RoomTimeline runner's list, plus `RoomTimelineCharacterization.test.ts`, which the `Room` directory mount covers. The `package.json` files and `play/Dockerfile` differ too and are not overlaid, as in Phase 1. The comparison split paths with spaces (character PNGs under `play/public/resources`), so it could not compare those; they are not overlaid either. `NODE_OPTIONS=--max-old-space-size=2700` for the focused runs, 3072 for the static checks and the whole suite. Raw output: `checks.raw.log`.

Test files in every run: `GameSceneMovement.test.ts` `569c800bb331b745a685cc6ee76f0907669b5040bb5b528cb36b48eb736ee6c5` and `GameLoop.test.ts` `861fa7089a06ee6978bb5cccec4065fe20d453ab1ddcc53409c3f15313c8fb73`, the same bytes as `HEAD` (each run prints them from inside the container).

| check | stage (`GameScene.ts`) | command (in `/work/play`) | exit | result |
|---|---|---|---|---|
| 1. before any change | `HEAD` `6abf3d8f…` | `npx vitest run tests/front/Phaser/Game/GameSceneMovement.test.ts tests/front/Phaser/Game/GameLoop.test.ts` | 0 | 2 files, 11 passed (7 + 4) |
| 2. after patch 1 | `72ef938b…` | same | 0 | 11 passed |
| 2. after patch 2 | `99527fb2…` | same | 0 | 11 passed |
| 2. after patch 3 | `699f7356…` | same | 0 | 11 passed |
| 3. whole play suite | `699f7356…` | `npm test -- --run` | 0 | 259 files passed; 1,676 passed, 10 skipped (1,686); `Duration` 423.7 s. The same counts as CI run 6 on `HEAD` |
| 4. eslint | `699f7356…` | `npx eslint --max-warnings 0 src/front/Phaser/Game/GameScene.ts` | 0 | no output (0 errors, 0 warnings) |
| 4. prettier | `699f7356…` | `npx prettier --check src/front/Phaser/Game/GameScene.ts` | 0 | `All matched files use Prettier code style!` |
| 4. typecheck | `699f7356…` | `npm run typecheck` (`tsc --noEmit`) | 0 | no diagnostics |
| 5. mutants | see below | the focused command | 1 each | see below |
| 6. `git apply --check` on a fresh `git archive HEAD` | each patch in order, each applied after its check | `git apply --check <patch>` | 0, 0, 0 | after each apply, `GameScene.ts` has the stage hash in the table above |

## Mutant evidence

No Phase 1 GameScene mutant falls inside the moved code. M1 is in `pushPlayerPosition`, M2 in `doUpdatePlayerPosition`, M3 in `doRemovePlayer`, M4, M6 and M7 in `handleCurrentPlayerHasMovedEvent`, and M5 in `removeAllRemotePlayers`. So the regressions that M2 and M3 stand for were re-applied at the call inside the new methods, where `update()` now reaches those helpers, and one more mutant removes the draw step. Each is one deleted line in the stage 3 file (`mutants.diff`), run with the same two test files.

| mutant | change (stage 3 line) | Phase 1 counterpart | exit | failing test and message |
|---|---|---|---|---|
| R1 | drop `this.doRemovePlayer(removedPlayerId);` in `applyBufferedRemotePlayerChanges` (`:1480`) | M3: a leaving player is not fully removed | 1 | 1 failed / 10 passed: "removes a leaving player from the scene and stops drawing its move in the same frame", `expected true to be false` (`MapPlayersByKey.has(7)`) |
| R2 | drop `this.doUpdatePlayerPosition(movedPlayer);` in `applyBufferedRemotePlayerChanges` (`:1471`) | M2: a received move is not drawn as received | 1 | 4 failed / 7 passed: the four remote-player tests. "draws a received move…": `expected [] to deeply equal [ …(5) ]`; "updates every remote player in flight…": `expected Set{ +0 } to deeply equal Set{ 2 }`; "removes a leaving player…" and "GS-02…": `expected [] to have a length of 1 but got +0` |
| R3 | drop `player.updatePosition(moveEvent);` in `drawRemotePlayersAtInterpolatedPositions` (`:1517`) | none (block-local: the frame skips the draw) | 1 | 4 failed / 7 passed: the same four tests with the same four messages as R2 |

Each mutant fails a test of `GameSceneMovement.test.ts` with exit 1, and `GameLoop.test.ts` (4 tests) passes in every run, so the net still covers the moved code. R1 fails on the scene-map assertion, where M3 failed on the `Cannot find player with ID "7"` throw: R1 skips the whole removal, M3 skipped only its interpolator part. R2 and R3 fail the same four tests, because a move that is never handed to the interpolator and a move that is interpolated but never drawn look the same to these tests.

## Left out, and why

- The local-player input block, the `pendingEvents` group-event loop and the conversation-bubble step stay inline in `update()`. The Safety Net Map lists the group events and the bubble path as gaps, and no test drives `update()` with a joined local player.
- The one-time player-count diagnostic moved with its step but was not extracted on its own. It is half of the duplicated repository dump; the other copy is in `doAddPlayer`, which is not pinned, so the dedup waits for that pin.
- No remote-players class (Break Out Method Object or Extract Class), as the brief asked. The two steps share no locals, so Extract Method was enough.
- `onPlayerMovementEnded` keeps its name and its every-event behavior (GS-09).
- No behavior fixes: GS-04, GS-05 and GS-06 are as they were.

## Suggested commit messages

1. `refactor(play): remove the commented-out player cases from GameScene.update` / The pending-event queue only carries group events, and the switch is exhaustive over them; remote-player changes arrive through RemotePlayersRepository.
2. `docs(play): say that onPlayerMovementEnded gets every local move event (GS-07)` / Extension modules outside this repository register through ExtensionModuleOptions, so the API stays; the comments now describe what it does.
3. `refactor(play): extract the remote-player steps of GameScene.update` / applyBufferedRemotePlayerChanges and drawRemotePlayersAtInterpolatedPositions hold the statements unchanged and in order; GameSceneMovement.test.ts passes unchanged.

## Resources

- sbh containers started by this task: `wa-fable-p2gs-s0`, `-s1`, `-s2`, `-s3`, `-r1`, `-r2`, `-r3`, `-static`, `-suite`, all `--rm` and run one at a time. Left: 0 (`docker ps -a --filter name=wa-fable-p2gs` at 07:04 UTC).
- Kept on sbh as evidence: `~/wa-jobs/wa-fable-20261112/p2gs/` (6.2 MB: `run.sh`, `batch.sh`, `assemble.sh`, the `HEAD` overlay, the stage and mutant files under `v/`, `logs/`, `checks.raw.log`).
- `src-review` was not modified: no file under its `play/src`, `play/tests` or `libs/map-editor` is newer than the runner, and its `GameScene.ts` is still `652254f9…`. Every bind mount targets a path that already exists in the tree, so Docker created no mount-point files.
- The Mac scratch `/tmp/wa-p2gs` was deleted after the deliverables were copied. Nothing was committed or staged in the checkout; only this folder was written.
