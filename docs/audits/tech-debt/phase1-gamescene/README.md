# Phase 1 gate: `GameScene.ts` (working-with-legacy-code)

Date: 2026-11-12, 02:06-02:43 UTC (hard stop 03:15). Module: `play/src/front/Phaser/Game/GameScene.ts` (4,889 lines). Baseline: the checkout's file, sha256 `652254f916bdfdd64a595d330bf970271dcf86414ecac92d347eefedb97940e8`. It is the same as `HEAD` and as the knc tree `src-p4`. No product file in the checkout was edited. The patches were made in the scratch repo `/tmp/wa-debt/p1-gamescene`.

## Deliverables and stack order

| order | patch | sha256 | kind | summary |
|---|---|---|---|---|
| - | `seams.patch` | - | not produced | No seam needed a product edit (see "Seams"). |
| 1 | `characterization-tests.patch` | `a216336e5a286df5c17753474fa5eeaae473c97bc6e37014fac151b2ffc8d0ae` | tests only | Adds `play/tests/front/Phaser/Game/GameSceneMovement.test.ts`: 7 tests at two pinch points. GS-01 and GS-02 are pinned as they behave today. |
| 2 | `fix-GS-01.patch` | `683d61eca2b402c052466ca846f1756c4b01b8fd382eb3dbe44941fa5f240114` | behavior + flipped test | `lastSentTick` starts at minus infinity, so a first walk heading DOWN is shared like any other walk. The GS-01 test flips from "nothing shared" to 4 throttled sends. |
| 3 | `fix-GS-02.patch` (round 4, v2) | `47779b0d8f7ff5b3323b7af13b63690dc5deb933c086ea935b601a707b55498e` | behavior + flipped test | `removeAllRemotePlayers()` also removes each player's interpolation. The GS-02 test flips from "next frame throws" to "next frame runs, and later frames keep drawing": after the removal a player joins, moves, and is drawn on a later frame. |
| (3, superseded) | `fix-GS-02.v1.patch` | `ba5b47267e9a363f575a6c5696457239ef3f5497020a2674f489bbc044c9a645` | behavior + flipped test | The first version: the same product change, and a test that checks one frame after the removal. |

Round 4 (verdict `gamescene-phase1.md`, finding 2) changed only the test hunk of patch 3. Patches 1 and 2 are byte-identical to round 3, and nothing is stacked after patch 3, so no other patch was regenerated. The product hunk of patch 3 is byte-identical to v1. Finding 1 of that verdict (a scene restart keeps `lastSentTick`) was dismissed by the coordinator: `GameScene.update(time)` receives Phaser's monotonic game-loop time, which a restart does not reset, so a kept tick is never ahead of the clock. GS-01 is unchanged.

`git -C <checkout> apply --check characterization-tests.patch` exits 0. A multi-patch `git apply --check` cannot chain a file that an earlier patch creates (exit 1, "No such file"). So the stack was checked on a copy of the checkout's files instead (`/tmp/wa-debt/stackcheck`, GameScene sha256 as above). `apply --check` then `apply` for patches 1, 2 and 3 all exited 0. The result matches the scratch repo byte for byte (GameScene `6abf3d8f…`, test `d3d0712b…` after round 4; `e841eac3…` with v1). The files the checks ran on are the same as the files in the patches: stage 1 test `92f1ff5f…`, stage 2 test `eaa04b3b…`, stage 2 GameScene `c8ad4820…`, stage 3 test `d3d0712b…` (v1 `e841eac3…`), stage 3 GameScene `6abf3d8f…`. The round 4 stack check was repeated on a fresh copy of `HEAD`'s `GameScene.ts` (`/tmp/wa-nits/a/stackcheck`): `apply --check` then `apply` for patches 1, 2 and 3 all exited 0.

## Change points chosen

These match the program goals. H02 asks whether per-frame update work freezes the canvas. H15 is about moves dropped under backend CPU load, which concerns the move/interpolation path. The 1,000-user goal needs the per-frame cost of remote players and of the local move path.

- **E1: `update(time, delta)`**, remote-player block (`:1412-1518`).
- **E2: `handleCurrentPlayerHasMovedEvent(event)`** → `pushPlayerPosition` → `doPushPlayerPosition` (`:4290-4408`).

## Effect sketch

```
connection streams (:2168-2236)
  userJoined / userMoved / userLeft / playerDetailsUpdated
        │ (buffered, no scene work)
        ▼
RemotePlayersRepository  added / moved / updated / removed  ──reset() each frame
        │
        ▼  E1 update(time, delta)  ── currentTick = time
  doAddPlayer ──► MapPlayersByKey, remotePlayersSpatialIndex, RemotePlayer (Phaser sprite; rethrows texture errors)
  doUpdatePlayerPosition ──► new PlayerMovement(drawn pos, tick, target, tick+200) ──► playersPositionInterpolator
  doUpdatePlayerDetails ──► RemotePlayer status/outline/talk/say
  doRemovePlayer ──► destroy, MapPlayersByKey, spatial index, interpolator
  pendingEvents ──► groups (ConversationBubble), currentPlayerGroupId stores
  interpolator.getUpdatedPositions(time) ──► for EVERY in-flight player:
        RemotePlayer.updatePosition ──► drawn avatar
        addConversationBubblesAffectedByPlayerMove (scans ALL groups) ──► group.step ──► bubble redraw (H01)
        cameraManager.playerFollowing === player ──► _sendViewportToServer ──► connection.setViewport
        player missing ──► throw ──► Phaser RAF loop stops (GS-03)
  dirty ──► Game.step isDirty ──► render

  CurrentPlayer.moveUser (inside update) ──emit hasMoved──► E2 handleCurrentPlayerHasMovedEvent
        pushPlayerPosition ──(turn | stop | ≥200 ms)──► doPushPlayerPosition
              ──► connection.sharePosition(x, y, dir, moving, viewport) ──► pusher/back (H15 drop point)
              ──► iframeListener.hasPlayerMoved ──► map scripts
        gameMapFrontWrapper.setPosition ──► area/property triggers
        activatablesManager.updateActivatableObjectsDistances(ALL remote players + items + entities)  (GS-04)
        onPlayerMovementEndedCallbacks (none registered, GS-07)
        hasMovedThisFrame ──► bubble re-check in the same update()
```

## Pinch points

- **P1: the remote-player block of `update()`.** Every remote change from the server, and every drawn remote position, passes through this one method. Three of the tests cover the repository, `doAddPlayer`/`doUpdatePlayerPosition`/`doRemovePlayer`, the interpolator and `PlayerMovement` together.
- **P2: `pushPlayerPosition`, reached from `handleCurrentPlayerHasMovedEvent`.** This is the only path from a local move to the server and to map scripts.
- P3 (backlog): the conversation-bubble block of `update()` (`:1499-1534`).

## Seams

No seam needed a product edit, so there is no `seams.patch`.

| seam | technique | enabling point |
|---|---|---|
| Real constructor with a fake `Room` | Parameterize Constructor already exists. `_isInsidePersonalAreaStore` has a production default, and the constructor does no I/O. | `new GameScene(fakeRoom, key)` in the test |
| `doAddPlayer`, `getViewport` replaced on the instance | Subclass and Override Method, applied to the instance. These are the only two methods that need a running Phaser game: sprites and camera. | test `createScene()` |
| `connection`, `activatablesManager`, `gameMapFrontWrapper` | Field injection, for sensing | test |
| `biggestAvailableAreaStore.consumePendingRecompute`, `iframeListener.hasPlayerMoved`, `console.error` | Import seam (`vi.spyOn`), restored in `afterEach` | test |

An Extract-pure-function seam was prepared first: `shouldSharePlayerPosition` in a new `PositionSharingPolicy.ts`, with `pushPlayerPosition` delegating to it. It was dropped once the runtime import of `GameScene` was shown to work. The least invasive seam is the one that edits nothing. The draft is kept outside the repo at `/tmp/wa-debt/dropped-seam/PositionSharingPolicy.ts` in case the next change to `pushPlayerPosition` wants to sprout it.

Harness cost (GS-08): the first probe, with the default heap in a 3 GB container, hit an OOM (exit 134 after 29 s). With `NODE_OPTIONS=--max-old-space-size=2700`, the import takes about 36 s and works.

## Tests and the behavior each pins

File: `play/tests/front/Phaser/Game/GameSceneMovement.test.ts` (7 tests). For each pinned value, a probe that was deliberately wrong (`"PROBE"`, `-1`) was asserted first, and the failure output was read. Probe logs (local, `/tmp/wa-debt/run3-probe.log` to `run5-probe.log`): run 3 read the local-path values (the remote tests stopped on a fake without `getPosition`), run 4 pinned them and hit a fake without `moved$`, and run 5 read the remote-path values once the fake stayed out of the spatial index.

| # | test | pins |
|---|---|---|
| 1 | shares a turn and a stop at once, and a straight walk at most once per POSITION_DELAY | Observed sends: LEFT x=1 (a turn away from the DOWN placeholder), LEFT x=4 at exactly +200 ms (`>=`), UP x=5 (turn), stop x=6, stop x=7. Nothing at +50/+199 ms. Re-sending the same object does nothing. `hasPlayerMoved` is called 5 times. |
| 2 | GS-01 (pinned): does not share a first walk heading DOWN until the player turns or stops | 7 DOWN moves over 600 ms give `[]`. Then the stop gives one send (x=700). |
| 3 | draws a received move from the drawn position over POSITION_DELAY, extrapolates briefly, then stops | Draws x = 100, 200, 300, 400 (`moving: true`), then 401 (`moving: false`) at +301 ms. Nothing at +400 ms (GS-06). |
| 4 | updates every remote player in flight once per frame | 50 players, 2 frames: each gets exactly 2 `updatePosition` calls. |
| 5 | removes a leaving player from the scene and stops drawing its move in the same frame | `MapPlayersByKey.has(7)` is false. 1 draw, then none. `destroy` is called once. |
| 6 | GS-02 (pinned): throws from the next frame when the players are removed while one is still moving | `update()` throws `Cannot find player with ID "7"` |
| 7 | measures the distance to every remote player, actionable item and entity on each move event | `updateActivatableObjectsDistances` receives 4 objects per event (3 players + 1 entity), twice. `setPosition` is called with (5,100) and (6,100). Only the first event is shared (16 ms apart). |

After `fix-GS-01.patch`, test 2 becomes "shares a first walk heading DOWN like any other walk": sends at x = 0, 200, 400 and 600, then the stop. After `fix-GS-02.patch`, test 6 becomes "keeps drawing frames…": no throw and 1 draw at the next frame, then (round 4) player 8 joins at frame 2,200, moves, and is drawn once at frame 2,300.

## Checks

All checks ran on knc in `node:24-trixie` containers labeled `owner=wa-fable-20261112` (`--cpus 1 --cpu-shares 512 --memory 3g --network none`), with `src-p4` mounted. Variant files were bind-mounted read-only over the existing paths, so the GameScene in `src-p4` was never modified. Logs are in `knc:~/wa-jobs/wa-fable-20261112/debt-gs/logs/`.

Final runs (the `v2-*` logs and `v2-static.log`; an earlier round is in `logs-run1/`):

| check | stage | command (in `/work/play`) | exit code |
|---|---|---|---|
| probe: import GameScene, default heap | - | `npx vitest run DebtGsProbe.test.ts` | 134 (V8 OOM at about 1.5 GB) |
| probe: import GameScene, `--max-old-space-size=2700` | - | same | 1 (the assertion was deliberately wrong: `expected 'function' to be 'number'`) |
| vitest `GameSceneMovement.test.ts` on the baseline GameScene | 1 | `npx vitest run tests/front/Phaser/Game/GameSceneMovement.test.ts` | 0 (7/7) |
| vitest, GS-01 flipped test on the baseline | 2 test, 1 code | same | 1 (GS-01 test only: `expected [] to deeply equal [ { x: +0, direction: 2, … } …(3) ]`) |
| vitest, fix GS-01 | 2 | same | 0 (7/7) |
| vitest, GS-02 flipped test before its fix | 3 test, 2 code | same | 1 (GS-02 test only: `Cannot find player with ID "7"` was thrown) |
| vitest, fix GS-02 | 3 | same | 0 (7/7) |
| typecheck | 1 | `npx tsc --noEmit` (= `npm run typecheck`) | 0 (39 s) |
| typecheck | 3 (full stack) | same | 0 (42 s) |
| eslint, test file | 1, 2, 3 | `npx eslint --max-warnings 0 --stdin --stdin-filename tests/front/Phaser/Game/GameSceneMovement.test.ts` | 0, 0, 0 |
| eslint, GameScene.ts | 2, 3 | same, for `src/front/Phaser/Game/GameScene.ts` | 0, 0 |
| prettier, test file | 1, 2, 3 | `npx prettier --check --stdin-filepath <path>` | 0, 0, 0 |
| prettier, GameScene.ts | 2, 3 | same | 0, 0 |
| `git apply --check characterization-tests.patch` on the checkout | 1 | `git -C <checkout> apply --check` | 0 |
| stack `apply --check` then `apply` on a copy of the checkout files | 1, 2, 3 | `git apply --check` | 0, 0, 0 |

In the first round, eslint flagged the test file (exit 1: `unbound-method` ×2 and an unnecessary `as` cast), and typecheck failed on it (exit 2: two tuple-typed `mock.calls` callbacks). Prettier then flagged a long `vi.fn<…>` generic (exit 1). All of these were fixed in the test file only. Every check above was then run again on the final files.

### Round 4 checks (GS-02 test, `fix-GS-02.patch` v2)

Host sbh, tree `~/wa-jobs/wa-fable-20261112/src-review` (GameScene sha256 `652254f9…`, the same as `HEAD`), image `node:24-trixie`, `--cpus 1.5 --cpu-shares 512 --memory 4g --network none`, label `owner=wa-fable-20261112`, names `wa-fable-nits-a-*`, `NODE_OPTIONS=--max-old-space-size=2700`. The variant files were bind-mounted read-only over the tree. Raw output: `round4-checks.raw.log`.

| check | variants | command (in `/work/play`) | exit code |
|---|---|---|---|
| vitest, new stage 3 test on the fixed GameScene | test v2, `gs-F2` | `npx vitest run tests/front/Phaser/Game/GameSceneMovement.test.ts` | 0 (7/7) |
| vitest, new test with GS-02 reverted (the `removePlayer` call dropped, which is the stage 2 GameScene `c8ad4820…`) | test v2, `gs-F1` | same | 1 (GS-02 test only: `expected [Function] to not throw an error but 'Error: Cannot find player with ID "7"' was thrown`; 6 passed) |
| vitest, new test with a late-failing wrong fix (M5 below) | test v2, `gs-Mlate` | same | 1 (GS-02 test only: `expected [] to have a length of 1 but got +0`; 6 passed) |
| vitest, old stage 3 test with the same wrong fix | test v1, `gs-Mlate` | same | 0 (7/7) |
| eslint, new test file | test v2 | `npx eslint --max-warnings 0 --stdin --stdin-filename tests/front/Phaser/Game/GameSceneMovement.test.ts` | 0 |
| prettier, new test file | test v2 | `npx prettier --check --stdin-filepath <path>` | 0 |
| typecheck, full stack | test v2, `gs-F2` | `npx tsc --noEmit` (28 s) | 0 |
| stack `apply --check` then `apply`, patches 1, 2, 3 on a copy of `HEAD`'s `GameScene.ts` | - | `git apply --check`, `git apply` | 0, 0, 0 |
| `git -C <checkout> apply --check characterization-tests.patch` | - | - | 0 |

The mutant that drops the `removePlayer` call is the one the verdict names. It fails the new test at the first frame after the removal, as the v1 test did. The follow-up frames are what separate the two versions of the test, as M5 shows.

## Round 5 (verdict `a2af87ddf.md`: the distance test never filled `actionableItems`)

The test "measures the distance to every remote player, actionable item and entity on each move event" left `actionableItems` empty, so deleting `...this.actionableItems.values()` from `handleCurrentPlayerHasMovedEvent` (`GameScene.ts:4299`) still passed. The fix touches the test only, as a patch on `HEAD` (`32f5571f1`): `distance-pass-actionable-items.test.patch`, sha256 `b403e26f9c4ee76f1c0b450abfd184f2dd1a71d3e2a4a3d6e9b0b7a68c1ce3ba`.

- `GameSceneInternals` gains `actionableItems: Map<number, unknown>`, the same `internals` access the test already uses.
- The test puts one item in the map, expects 5 objects per event (3 players, 1 item, 1 entity), and asserts for each event that the item itself is among the objects passed to `updateActivatableObjectsDistances`.
- No product file changed. `GameScene.ts` stays at `HEAD` (sha256 `6abf3d8f…`). Applied to `HEAD`'s test file (`d3d0712b…`), the patch gives `569c800b…`, the file every check below ran on.

Host sbh, tree `~/wa-jobs/wa-fable-20261112/src-review` (play with deps), image `node:24-trixie`, `--cpus 1.5 --cpu-shares 512 --memory 4g --network none`, label `owner=wa-fable-20261112`, names `wa-fable-gsd-*`, `NODE_OPTIONS=--max-old-space-size=2700`. The tree's `GameScene.ts` (`652254f9…`) and its test predate `HEAD`, so `HEAD`'s `GameScene.ts`, the mutants and the test files were bind-mounted read-only over it. The tree was not modified.

| check | variants | command (in `/work/play`) | exit code |
|---|---|---|---|
| vitest, new test on `HEAD`'s `GameScene.ts` | test `569c800b…`, `GameScene.ts` `6abf3d8f…` | `npx vitest run tests/front/Phaser/Game/GameSceneMovement.test.ts` | 0 (7/7) |
| vitest, new test on mutant M6 (`...this.actionableItems.values(),` deleted, `:4299`) | test `569c800b…`, mutant `6b14da69…` | same | 1 (the distance test only, 6 passed): `expected [ 4, 4 ] to deeply equal [ 5, 5 ]` |
| vitest, new test on mutant M7 (`.values()` replaced by `.keys()`, same count of objects) | test `569c800b…`, mutant `95ca6c1a…` | same | 1 (the distance test only, 6 passed): `expected [ …(5) ] to include { name: 'item' }` |
| vitest, old test (`HEAD`'s, empty `actionableItems`) on mutant M6 | test `d3d0712b…`, mutant `6b14da69…` | same | 0 (7/7): survives, the gap the verdict named |
| eslint, new test file | test `569c800b…` | `npx eslint --max-warnings 0 --stdin --stdin-filename tests/front/Phaser/Game/GameSceneMovement.test.ts` | 0 |
| prettier, new test file | test `569c800b…` | `npx prettier --check --stdin-filepath tests/front/Phaser/Game/GameSceneMovement.test.ts` | 0 |
| typecheck | test `569c800b…`, `GameScene.ts` `6abf3d8f…` | `npx tsc --noEmit` (27 s) | 0 |
| `git -C <checkout> apply --check distance-pass-actionable-items.test.patch` | - | - | 0 |

| mutant | change | what fails |
|---|---|---|
| M6 | drop `...this.actionableItems.values(),` from the list passed to `updateActivatableObjectsDistances` | the length assertion (4 objects instead of 5). The old test passed it. |
| M7 | pass `this.actionableItems.keys()` instead of `.values()` | the `toContain(item)` assertion. The length stays 5, so only the new item assertion catches it. |

Resources: 4 containers on sbh (`wa-fable-gsd-new-on-head`, `-new-on-mutant`, `-old-on-mutant`, `-new-on-swap`) plus `wa-fable-gsd-static`, all `--rm`; containers left: 0. The empty `GameSceneMovement.test.ts` that Docker created as a mount point in `src-review/play/tests/front/Phaser/Game/` was deleted, and the tree's `GameScene.ts` is still `652254f9…`. Scratch `~/wa-jobs/wa-fable-20261112/gsd` on sbh and `/tmp/wa-gsd` on the Mac were deleted.

## Mutant evidence

Each mutant is a one-line change to the baseline `GameScene.ts`, run against the characterization tests (patch 1).

| mutant | change | result on stage 1 | failing test |
|---|---|---|---|
| M1 | throttle `>= POSITION_DELAY` → `> POSITION_DELAY` (`:4394`) | exit 1, 1 failed / 6 passed | "shares a turn and a stop at once…": 4 sends instead of 5 |
| M2 | interpolation end `currentTick + POSITION_DELAY` → `+ POSITION_DELAY * 2` (`:4621`) | exit 1, 1 failed / 6 passed | "draws a received move…": 6 draws instead of 5 |
| M3 | drop `playersPositionInterpolator.removePlayer(userId)` from `doRemovePlayer` (`:4588`) | exit 1, 1 failed / 6 passed | "removes a leaving player…": `Error: Cannot find player with ID "7"` |
| M4 | drop the remote players from the distance update (`:4295`) | exit 1, 1 failed / 6 passed | "measures the distance…": `[1, 1]` instead of `[4, 4]` |

Each mutant is caught by exactly the test that pins its behavior, and the other six tests still pass. The baseline passes 7/7 (exit 0).

Round 4 adds one mutant, run against the stage 3 tests (patch 3) with the GS-02 fix in place:

| mutant | change | old stage 3 test (v1) | new stage 3 test (v2) |
|---|---|---|---|
| M5 | after `this.playersPositionInterpolator.removePlayer(player.userId)` in `removeAllRemotePlayers`, add `this.playersPositionInterpolator.updatePlayerPosition = () => undefined;` (a wrong fix: the next frame no longer throws, but no later move is ever interpolated again) | exit 0, 7/7: survives | exit 1, 1 failed / 6 passed: `expected [] to have a length of 1 but got +0` |

M5 is the case the verdict asked for: a scene that survives the first frame after the removal and then stops drawing.

## Ledger items found

GS-01 to GS-08. See `TECH-DEBT.md.draft`. Two were pinned as bugs and have fix patches: GS-01 and GS-02. GS-03 (a throw in `update()` stops the Phaser loop for good, while the DOM UI stays alive) is a candidate freeze mechanism for the H02 discriminator. Nothing ties it to the incident yet. The next discriminator is the browser console at the moment of a freeze.

## Gaps

- P3 is not pinned: the conversation-bubble block of `update()` (GS-05, H01).
- `doAddPlayer` is replaced in every test, so the real `RemotePlayer` construction and the texture-error rethrow (GS-03) are not characterized. `doUpdatePlayerDetails`, the camera-follow viewport resend and the `pendingEvents` group events are not pinned either (see the Characterization Backlog).
- GS-02 was not shown reachable in production. The only caller of `removeAllRemotePlayers()` is `create()`, and no `scene.restart` caller exists in `play/src/front`.
- GS-03 is not linked to the eight-user incident. No browser run, console log or frame trace exists.
- Only the new test file was run, not the full `play` suite. Nothing else imports the changed code paths: `lastSentTick` and `removeAllRemotePlayers` have no readers outside `GameScene.ts`. `svelte-check` was not run, since no Svelte file changed.
- `npm run pretty-check` only covers `src/`. The test file was checked by hand with `prettier --check --stdin-filepath`.
- Whether the CI `vitest` step fits in the default heap on `ubuntu-latest` was not measured (GS-08).
- `TESTING.md` and `TECH-DEBT.md` are drafts in this directory. They are not yet in `docs/`, and the tracker `docs/REMOVE-TECHNICAL-DEBT-PLAN.md` is not updated. Both belong to the coordinator.

## Resources

- knc containers created by this task: `wa-fable-debt-gs-1` to `-5` (probes), `wa-fable-debt-gs-<run>` and `wa-fable-debt-gs-v2-<run>` (vitest), `wa-fable-debt-gs-static`, `-static2`, `-tsc-c`, `-tsc-c2`, `-fmt`, `-fmt2`. All ran with `--rm`, and none was left running (`docker ps -a --filter label=owner=wa-fable-20261112` at 02:41 UTC listed only another task's `wa-fable-bench-*` containers).
- Files in `src-p4`: the temporary `play/tests/front/Phaser/Game/DebtGsProbe.test.ts` and `GameSceneMovement.test.ts` were deleted. `src-p4`'s `GameScene.ts` is unchanged (sha256 `652254f9…`).
- Kept on knc as evidence: `~/wa-jobs/wa-fable-20261112/debt-gs/` (variants, mutants, runner scripts, logs).
- Round 4: containers `wa-fable-nits-a-new-on-F2`, `-new-on-F1-revert`, `-new-on-Mlate`, `-old-on-Mlate` and `-static` on sbh, all `--rm`; containers left: 0. The empty `GameSceneMovement.test.ts` that Docker created as a mount point in `src-review/play/tests/front/Phaser/Game/` was deleted, and the tree has no other change (GameScene `652254f9…`). Scratch kept on sbh: `~/wa-jobs/wa-fable-20261112/nits-a/` (variants and logs); on the Mac: `/tmp/wa-nits/a/` (scratch repo with stages 1, 2, 3 and 3b, variants, `stackcheck`).
- Kept on the Mac: the scratch repo `/tmp/wa-debt/p1-gamescene` (commits `20d486d` tests, `e5f4df7` GS-01, `2e88719` GS-02), `/tmp/wa-debt/variants`, `/tmp/wa-debt/stackcheck` and the dropped seam `/tmp/wa-debt/dropped-seam/`.
- No product file in the checkout was edited, and no git command that writes was run there.
