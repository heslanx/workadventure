# Phase 1 gate: `MediaStore.ts` (working-with-legacy-code)

Date: 2026-11-12, 04:23-05:00 UTC (hard stop 06:00). Module: `play/src/front/Stores/MediaStore.ts` (1,805 lines), the browser's media hub: it turns the user's requests and the room's state into `getUserMedia` calls, and exposes the local stream, the device lists and the availability status. Baseline: `HEAD` = `fdd651abf`. `HEAD`'s `MediaStore.ts` has sha256 `c224e56fc5ec7c38cb29acb4a315e3df088e3c39e123456d759f5329460908c4`. While this ran, the checkout's `HEAD` moved to `0d9d44dc6` (24 files, among them `SocketManagerRoomTraffic.test.ts`, `PusherRoom.ts`, `Game.ts` and `GameLoop.test.ts`). Every check below ran on `fdd651abf`. `MediaStore.ts` is the same in both, and `git apply --check characterization-tests.patch` still exits 0 on `0d9d44dc6`; the whole-suite counts there will include the files those commits added. No file in the checkout was edited outside this folder. The patches were made in the scratch repo `/tmp/wa-md1/repo`, built from `git archive HEAD`.

## Deliverables and stack order

| order | patch | sha256 | kind | summary |
|---|---|---|---|---|
| - | `seams.patch` | - | not produced | No seam needed a product edit (see "Seams"). |
| 1 | `characterization-tests.patch` | `40d6acd394be2c847b2ccfc9a2bbca3492dcd5a652f673b8f80f50c910991c37` | tests only | Adds `play/tests/front/Stores/MediaStoreGetUserMedia.test.ts`: 10 tests at six pinch points. MD-01, MD-02 and MD-03 are pinned as they behave today. |
| 2 | `fix-MD-03.patch` | `ca00cb877c2a6b13389f4b51a07a4b34b1971dce12ad788d78488d5dc2db3145` | behavior + flipped test | A run clears the access issue of a device only when it requests that device. The MD-03 test flips from "that retry erases the denial" to "keeps the denial". |
| - | `mutants.diff` | `f11f60eaeb3d0b4763b6def75f8787b6c78bedb093f4b963b52ddb38554f6d3a` | evidence, not to land | The 12 mutants as unified diffs against `HEAD`, one hunk each. |
| - | `checks.raw.log` | `97d93bed08bd0b8d12653a790dbdd2506c96b03e43aa5b38f2bb98786a336ae5` | evidence, not to land | Every run on sbh, ANSI colors stripped, one section per log; the per-file pass lines of the two whole-suite runs are dropped. |
| 2 (lands) | `fix-MD-03.v2.patch` | `6e1c186e0e9380d9bfb6b7e569f41cb10c34a6005e551232fbe53d221e465a27` | behavior + flipped test | Replaces `fix-MD-03.patch` after the verdict (see "Verdict round"). Same product change, a corrected comment, the camera test extended to the camera's recovery, and a new microphone test. 11 tests. |
| - | `mutants-v2.diff` | `b5b81d0d851f64bbae89d542fdbc11565c45666bd8cd94c4eeff25f15f6feb63` | evidence, not to land | M13 and M14 as unified diffs against the v2 `MediaStore.ts`. |
| - | `checks-v2.raw.log` | `44cc2dd17c55a691e1f8acef3a555cfb3d87d12581b69e0a681d923655490c29` | evidence, not to land | The five v2 runs on sbh, ANSI colors stripped. |

The test file is sha256 `25f5a748c48d036bca08f80eaacf5d0e6efb94b604ccd945a876a9ab0ad96404` after patch 1 and `f0af6679dc14a31016208ccb52d9f626457047d9ef06b94f636d723feee87f02` after patch 2. `MediaStore.ts` is `042728d5f75b28f8aa2acb20e77904a04c447cacb981b6e249b0efd60d40d5f3` after patch 2. `git -C <checkout> apply --check characterization-tests.patch` exits 0. The stack check is in "Checks".

The MD-03 fix restores the behavior that `02b30fa37` ("refactor: simplify media status management", 2026-04-03) removed. Before that commit, `disableWebcam` and `disableMicrophone` took a `retainAccessIssueFromError` option so that the error path kept the issue it had just recorded. The refactor moved the clearing to the start of every run, which also runs right after the error path. The fix keeps the refactor's single place and limits it: a run that requests the camera clears the camera issue, and a run that requests the microphone clears the microphone issue. After a denial the denied device is off, so the retry that follows does not request it and keeps the issue. Turning the device on again clears it in the first run that requests it, close to what `enableWebcam` did before `02b30fa37`. The whole play suite passes on the stack (see "Checks").

## Change points chosen

Heuristic: changing next, churn, core. `MediaStore.ts` had 22 commits in the last three months and 34 in six (166 in all), most of them media fixes (`git log -- play/src/front/Stores/MediaStore.ts`). It has 62 importers in `play/src` outside tests. The freeze and weak-device work will change what reopens the camera and the microphone, so the change points are the paths that call the browser.

- **C1: the constraints that a store change produces** (`mediaStreamConstraintsStore`, `:532-641`). Fifteen input stores; each emission recomputes it. Changing next: the eight-user freeze investigation asks what re-requests media when stores change.
- **C2: the `getUserMedia` pipeline** (`runRawStreamUpdate` and `rawLocalStreamStore`, `:776-1060`). Recent churn: the warm microphone (`badd08338`, `9c2db3132`), the camera failure that no longer costs the microphone (`d1dbb953d`). The same function holds the stale-result discard (`e02a43786`, 2026-04-22).
- **C3: away mode and energy saving** (`privacyShutdownStore` into `mediaHeldByStatus`, `cameraEnergySavingStore`, `:166-247`, `:379-417`). Recent churn: `422ab53f9` (away mode and the mini window). Core for weak devices: they release and reopen both devices.
- **C4: the device list** (`deviceListStore` and its subscription, `:1534-1571`, `:1669-1731`). The only `enumerateDevices` caller; a removed device triggers a new request.

Not chosen: the noise suppression and background pipelines (`:1081-1284`). They are downstream of C2 and need WebAudio and WebGL fakes; they are in "Gaps" and in the backlog rows.

## Effect sketch

```
user and room inputs                        away / energy saving
 requestedCameraState, requestedMicrophoneState    window blur/focus ─► focusStore ─► privacyShutdownStore
 myCameraStore, myMicrophoneStore (room)            currentPlayerGroupIdStore, isLiveStreamingStore ─┘
 batchGetUserMediaStore (GameScene enter)           userMovingStore, constraint changes, camera enable
 inExternalServiceStore, inBackgroundSettingsStore    ─► 5 s / 10 s timers ─► cameraEnergySavingStore
 videoConstraintStore ◄─ device id, frame rate, quality      availabilityStatusStore ─► mediaHeldByStatus
 audioConstraintStore ◄─ mic device id, AGC, echo, noise suppression (10 stores)
 isLiveStreamingAudioStore ◄─ gameSceneStore.spaceRegistry
                     │
                     ▼
 C1 mediaStreamConstraintsStore  (skip while batching; emit only when {video, audio, keepAudioWarm} differ)
                     │
                     ▼
 C2 rawLocalStreamStore ─► generation++ ─► queue.then(runRawStreamUpdate)
        clear camera and microphone access issues            ◄── MD-03
        take the warm microphone if the constraints match
        stop tracks no longer wanted (or keep the microphone warm, disabled)
        stop tracks about to be re-requested (Chromium)
        navigator.mediaDevices.getUserMedia(only what changed)
          ├─ stale generation ─► stop every track it opened      ◄── MD-02
          ├─ success ─► currentStream = kept tracks + new tracks; used device ids
          └─ failure ─┬─ OverconstrainedError deviceId ─► reset both device ids   ◄── MD-01
                      ├─ camera requested ─► disableWebcam, cameraAccessIssueStore
                      └─ microphone only ─► disableMicrophone, microphoneAccessIssueStore
                     │
        ┌────────────┴──────────────┐
        ▼                           ▼
 rawLocalAudioTrackStore      rawLocalVideoTrackStore
   ─► noise suppression queue    ─► background effect queue
        └──────────┬───────────────┘
                   ▼
 localStreamStore ─► localStreamStoreForPublishing ─► LiveKit / WebRTC
        │
        └─► C4 deviceListStore (first stream, devicechange) ─► enumerateDevices
                 ─► camera / microphone / speaker lists, lastNewMediaDeviceDetectedStore
                 ─► removed device in use ─► retry (default) or reset the chosen id
```

## Pinch points

- **P1: `mediaStreamConstraintsStore`** (`:532-641`). Every input meets here. A test reads its effect as the `getUserMedia` calls that follow.
- **P2: `runRawStreamUpdate` behind `rawLocalStreamStore`** (`:776-1060`). The only `getUserMedia` caller; it decides which tracks are stopped, kept warm, or requested.
- **P3: the error branches** (`:951-995`). They decide which device a failure turns off and what issue is recorded.
- **P4: the away and energy-saving inputs of P1.** `privacyShutdownStore` through `mediaHeldByStatus`, and `cameraEnergySavingStore` with its timers.
- **P5: the update queue and its generation check** (`:912-917`, `:1033-1054`).
- **P6: `deviceListStore` and its subscription** (`:1534-1571`, `:1669-1731`).

`HeldMediaStore.test.ts` and `PrivacyShutdownStore.test.ts` already pin away mode at the store level with `MediaStore` mocked. These tests pin what away mode does to the devices.

## Seams

No seam needed a product edit, so there is no `seams.patch`.

| seam | technique | enabling point |
|---|---|---|
| `navigator.mediaDevices` | Object seam at the browser boundary: a fake installed with `Object.defineProperty` before the module loads. `getUserMedia` answers from a queue (`failNext`, `holdNext`) and otherwise opens one fake track per requested kind, with the exact `deviceId` asked or `cam-1` / `mic-1`. `enumerateDevices` returns the current list; `changeDevices` fires the `devicechange` listeners. | test `fakeBrowser()` |
| `MediaStreamTrack` | A structural fake class (`kind`, `id`, `enabled`, `readyState`, `stop` spy that ends the track, `getSettings().deviceId`). `MediaStream` is the polyfill of `tests/setup/vitest.setup.ts`, since jsdom has none. | test `FakeTrack` |
| Timers, focus, preferences | `vi.useFakeTimers` for `setTimeout` and `setInterval` only (`queueMicrotask` stays real for `FocusStore`). `document.hasFocus` returns `true`; window `blur` and `focus` events drive away mode. `localStorage` turns noise suppression off, which keeps the DeepFilterNet pipeline out of these tests. | test `beforeEach` |
| Module state | `vi.resetModules()` and a dynamic import in each test give a fresh `MediaStore` and its stores (MD-06). The copies of earlier tests stay subscribed to window events, so `afterEach` turns their devices off before the next test. | test `loadMediaStore()`, `afterEach` |
| The Phaser game (`GameManager`) | Link seam (`vi.mock`). Without it, importing `MediaStore` first fails in `ScreenSharingStore.ts:102` (MD-07). Nothing in these tests reads the game. | test top |
| "Our audio is streamed" | A structural fake of the game scene's `spaceRegistry` (`isLiveStreamingStore`, `isLiveStreamingAudioStore`, `shouldPublishScreenShareStore`), set through the existing `gameSceneStore`. Only test 4 uses it. | test 4 |

`MyMediaStore`, `PrivacyShutdownStore`, `FocusStore`, `MediaHeldByStatus`, `NoiseSuppressionStore`, `NoiseSuppressionController`, `BackgroundTransformStore`, `LocalUserStore` and `AnalyticsClient` are the real modules. The tests read only the browser boundary (`getUserMedia` arguments and call count, `enumerateDevices` call count, `track.stop()`, `track.enabled`) and exported store values.

## Tests and the behavior each pins

File: `play/tests/front/Stores/MediaStoreGetUserMedia.test.ts` (10 tests). The expected values were written from the code, then run. Three behaviors differed from the first prediction, and the runs that showed them are in `checks.raw.log`: the unbatched enter opens the camera twice (`probe3`, now MD-02), the denied camera's issue is erased (predicted from the code and confirmed by the first green run, MD-03), and a test's away events reached the module copies of earlier tests (`probe3` and `probe4`, fixed in `afterEach`).

| # | test | pinch point | pins |
|---|---|---|---|
| 1 | asks once for both devices when the room turns them on in a batch, and not again for changes that keep the constraints | P1 | Loading the module calls `getUserMedia` 0 times. The batched enter calls it once, with video `1280×720 @30` and audio, and the stream holds both tracks. A hover on the camera button, `inJitsiStore` and `frameRateStore` set to their current values, and an empty batch call nothing more. |
| 2 | MD-02 (pinned): without the batch, the same two changes open the camera twice, the first time for nothing | P1, P5 | `myCameraStore` then `myMicrophoneStore` set in one tick: call 1 asks for the camera alone, call 2 for both. The first camera track is stopped; the stream holds the second camera and the microphone. |
| 3 | turning the camera off stops only its track, and turning it on asks for the camera alone | P2 | Off: the video track is stopped once, the audio track is not, no request, the stream holds the microphone alone. On: one request for video only, and the old microphone track joins the new camera track. |
| 4 | keeps a muted microphone open and disabled while our audio is streamed, and unmutes it without asking again | P1, P2 | Muted while streamed: the audio track is not stopped, `enabled` is `false`, and it leaves the stream. Unmuted: no request, the same track returns with `enabled` `true`. Muted while not streamed: the track is stopped, and unmuting asks for the microphone alone. |
| 5 | MD-03 (pinned): a camera the user denies turns the camera off, asks again for the microphone alone, and that retry erases the denial | P3 | `NotAllowedError` on the camera and microphone request: the camera is off, the microphone is still requested, call 2 asks for the microphone alone, and the stream holds it. `cameraAccessIssueStore` and `microphoneAccessIssueStore` are `null`. |
| 6 | MD-01 (pinned): a chosen camera the browser cannot open also drops the chosen microphone | P3 | Call 1 asks for `cam-gone` and `mic-headset` exactly. `OverconstrainedError` on `deviceId`: call 2 asks for neither device id, and `requestedMicrophoneDeviceIdStore` is `undefined`. |
| 7 | away mode releases the camera and keeps the microphone, and coming back asks for the camera alone | P4 | Window `blur` outside a conversation: the video track is stopped, the audio track is not, no request. Window `focus`: one request for video only. |
| 8 | energy saving releases the camera and the microphone after 10 s idle outside a conversation, and a conversation asks for both at once | P4 | At 9.1 s nothing is stopped. By 10.7 s both tracks are stopped with no request. Joining group 7 asks once for both. |
| 9 | MD-02 (pinned): a change during a pending request throws away its whole stream, then reopens the microphone it still wanted | P5 | The camera is turned off while the batched request is pending. When it resolves, both its tracks are stopped and its stream never reaches `rawLocalStreamStore`. Call 2 asks for the microphone alone. |
| 10 | lists the devices once the first stream exists and on each device change, and asks again for a default microphone that was unplugged | P6 | `enumerateDevices` is not called at load, once after the first stream, and once per `devicechange`. `devicesNotLoaded` turns `false`. The new `mic-2` is reported in `lastNewMediaDeviceDetectedStore`. The default microphone in use (`mic-1`) is unplugged: its track is stopped and one request asks for the microphone alone. |

After `fix-MD-03.patch`, test 5 becomes "MD-03 (fixed): a camera the user denies turns the camera off, asks again for the microphone alone, and keeps the denial": `cameraAccessIssueStore` is `"permission_denied"` and `cameraButtonHelpContextStore` is `"permission"`.

## Checks

Host sbh, tree `~/wa-jobs/wa-fable-20261112/src-review` (play with deps). Image `node:24-trixie`, `--rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none`, label `owner=wa-fable-20261112`, names `wa-fable-md1-*`, `NODE_OPTIONS=--max-old-space-size=2700` (3072 for the whole suite). One `md1` container at a time.

The tree predates `HEAD`. A git blob comparison of the 3,397 files `HEAD` tracks under `play/`, `libs/` and the root `package.json` found 16 that differ or are missing in the tree, all under `play/src/pusher`, `play/tests`, `play/src/front/Chat/Components/Room`, plus `GameScene.ts`, `childWindow.test.ts`, map-editor's `MapValidator.ts` and its test. `MediaStore.ts` and every file it imports match `HEAD`. The runner (`md1/run.sh`) bind-mounts `HEAD`'s copies read-only over those three directories and four files (overlay built from the scratch repo), like the SocketManager runner. A new test file cannot be mounted on its own (the tests directory is a read-only mount), so the runner copies `HEAD`'s `play/tests` into `md1/tests-run`, adds the test file there and mounts that copy instead. Variant `MediaStore.ts` files are mounted over their single path. The tree was not modified.

The runs are in `checks.raw.log`, one section per log file (`f-*` for the final runs). "Stage 1" is the test file after patch 1 on `HEAD`'s code. "Stage 2" is the stack after patch 2.

| check | stage | command (in `/work/play`) | exit code |
|---|---|---|---|
| first runs of the new tests | 1, draft | `npx vitest run tests/front/Stores/MediaStoreGetUserMedia.test.ts` | `probe1`: 1 (10 failed): 5 s timeouts on the first import, then `derived() expects stores as input` (MD-07). `probe2`: 1 (10 failed, same error, with a 60 s timeout). `probe3`, with the `GameManager` link seam: 1 (2 failed, 8 passed): the unbatched enter asked for video and audio in call 2 (now MD-02), and away mode saw 7 calls instead of 2. `probe4`, away test alone with a trace: passed, 2 calls, so the extra calls came from the module copies of earlier tests. `probe5`, with `afterEach` turning their devices off: 0 (10/10) |
| eslint, prettier, typecheck, draft | 1, draft | `static1` | eslint 1 (`no-await-in-loop` in `settle`), prettier 0, `tsc` 0 |
| vitest, characterization tests on `HEAD` | 1 | `npx vitest run tests/front/Stores/MediaStoreGetUserMedia.test.ts` | 0 (10/10, `Duration` 8.1 s) (`f-static`) |
| eslint, test file | 1 | `npx eslint --max-warnings 0 tests/front/Stores/MediaStoreGetUserMedia.test.ts` | 0 (`f-static`) |
| prettier, test file | 1 | `npx prettier --check <test>` | 0 (`f-static`) |
| typecheck | 1 | `npx tsc --noEmit` (= `npm run typecheck`) | 0 (26 s) (`f-static`) |
| mutants M1-M12 | 1 | the vitest command, each mutant mounted over `MediaStore.ts` | 1 for each of the 12 (`f-m1` to `f-m12`; table below) |
| whole play suite | 1 | `npx vitest run`, `--max-old-space-size=3072` | 0 (256 files, 1,652 passed and 10 skipped, 428 s) (`f-suite`). The baseline of 254 files and 1,637 passed predates `50632e874` (03:39 UTC), which added `PusherWebSocketBatch.test.ts` (5 tests); with it and the new file (10 tests) the counts match: 254 + 2 files, 1,637 + 15 tests |
| vitest, flipped MD-03 test on `HEAD`'s `MediaStore.ts` | 2 test, 1 code | the vitest command | 1 (the MD-03 test only, 9 passed): `expected null to be 'permission_denied'` (`f-flip`) |
| vitest, fix MD-03 | 2 | the vitest command | 0 (10/10, `Duration` 7.1 s) (`f-fix`) |
| eslint, prettier on test file and `src/front/Stores/MediaStore.ts` | 2 | as above, both files | eslint 0, prettier 0 (`f-fix`) |
| typecheck | 2 | `npx tsc --noEmit` | 0 (25 s) (`f-fix`) |
| whole play suite | 2 (full stack) | `npx vitest run`, `--max-old-space-size=3072` | 0 (256 files, 1,652 passed and 10 skipped, 396 s) (`f-suite2`): the same counts as stage 1, with the MD-03 test flipped |
| `git -C <checkout> apply --check characterization-tests.patch` | 1 | - | 0 |
| stack `apply --check` then `apply`, patches 1 and 2, on a fresh `git archive HEAD` copy | 1, 2 | `git apply --check`, `git apply` | 0, 0, 0, 0; the results match the sha256 values in "Deliverables" (`/tmp/wa-md1/stackcheck`) |

## Mutant evidence

Each mutant is one plausible regression in `HEAD`'s file, run against the stage 1 test file (`25f5a748…`). The mutants are in `mutants.diff`. The script that wrote them, `make_mutants.py`, replaces one exact string per mutant and fails unless that string occurs once; it is in the sbh job dir.

| mutant | pinch point | change (`HEAD` line) | result | failing tests |
|---|---|---|---|---|
| M1 | P1 | drop the `$batchGetUserMediaStore` early return (`:571-573`) | exit 1, 9 failed / 1 passed | every test that enters the room with the batch: `getUserMedia` is called twice instead of once |
| M2 | P1, P2 | `keepAudioWarm` becomes `false` (`:597-598`) | exit 1, 1 failed / 9 passed | test 4: the muted microphone track is stopped |
| M3 | P2 | drop `t.stop()` for the video tracks when the camera turns off (`:846`) | exit 1, 3 failed / 7 passed | tests 3, 7 and 8: the video track is never stopped |
| M4 | P2 | ask for audio whenever it is wanted, not only when it changed (`:888`) | exit 1, 2 failed / 8 passed | tests 3 and 7: the camera request also asks for the microphone |
| M5 | P3 | the camera failure also calls `requestedMicrophoneState.disableMicrophone()` (`:978`, the behavior before `d1dbb953d`) | exit 1, 1 failed / 9 passed | test 5: the microphone is no longer requested |
| M6 | P3 | drop `cameraAccessIssueStore.set(null)` at the start of a run (`:814`) | exit 1, 1 failed / 9 passed | test 5: the issue stays `permission_denied` (the MD-03 pin detects the fix direction) |
| M7 | P3 | drop `requestedMicrophoneDeviceIdStore.set(undefined)` in the `OverconstrainedError` branch (`:964`) | exit 1, 1 failed / 9 passed | test 6: call 2 still asks for `mic-headset` |
| M8 | P4 | drop `heldByStatus.camera` from the camera conditions (`:606`) | exit 1, 1 failed / 9 passed | test 7: away mode keeps the camera |
| M9 | P4 | drop `isEnergySaving` from `isMicrophoneForcedOff` (`:585`) | exit 1, 1 failed / 9 passed | test 8: energy saving keeps the microphone |
| M10 | P5 | the stale-generation check never fires (`:912`) | exit 1, 1 failed / 9 passed | test 9: the stale camera track is never stopped. Test 2 passes: there the next run stops the stale camera track itself before re-requesting it |
| M11 | P6 | drop `retryGetUserMedia(false, true)` for a removed default microphone (`:1721`) | exit 1, 1 failed / 9 passed | test 10: no request after the microphone is unplugged |
| M12 | P6 | drop `deviceListCanBeQueried = true` (`:1556`) | exit 1, 1 failed / 9 passed | test 10: `enumerateDevices` runs on every stream emission (3 calls instead of 1) |

Each pinch point has at least one mutant, and each mutant fails only tests that pin its pinch point. The exception is M1, which breaks the batched enter that nine tests start from. The mutant files' sha256: M1 `2ad51a14…`, M2 `7c3d4eee…`, M3 `8a4ebb09…`, M4 `c3451274…`, M5 `bde8674e…`, M6 `b6976ead…`, M7 `f0083651…`, M8 `64624436…`, M9 `353556e0…`, M10 `07d732c9…`, M11 `dcc312b1…`, M12 `a4ec2311…`.

## Verdict round

The cross-family verdict (`gpt-6-luna`, `../../performance-1000-users/execution/verdicts/debt-p1-mediastore.md`) returned PASS_WITH_NITS with two findings. The coordinator fixed both in `fix-MD-03.v2.patch`, in the scratch repo `/tmp/wa-md2/repo` (`HEAD`'s `MediaStore.ts`, then patch 1, then patch 2, then the edits).

- T1, minor: the MD-03 test did not pin that a later camera request clears the denial, so a run that never clears the camera issue passed. The camera test now turns the camera on again and expects a camera-only request, `cameraAccessIssueStore` `null`, `cameraButtonHelpContextStore` `null` and both tracks. The fix's microphone half had the same gap, so a new test denies a microphone-only request, then turns the camera on (a camera-only run that must keep the microphone issue), then turns the microphone on (the issue clears).
- T2, nit: the comment said a failed request turns its device off, which the `deviceId` fallback does not. It now says that each failure that records an issue turns its device off.

v2 files: the test file sha256 `933c99e46c1054a08ac65475ba4006ec29e6243e656ff78ad098923361783699`, `MediaStore.ts` `fc5f6b6ed780d25926418d26f2c940eb6913df9501fc67482e7073e10403640d`. Runs on sbh with the same runner and limits, `TEST=t2/fix2.test.ts`, logs in `checks-v2.raw.log`:

| Run | `MediaStore.ts` | Exit | Result |
|---|---|---|---|
| `v2-fix` | v2 | 0 | 11 passed |
| `v2-head` | `HEAD` | 1 | both MD-03 tests fail: `expected null to be 'permission_denied'` |
| `v2-m13` | v2 without the camera clear | 1 | the camera MD-03 test fails at the recovery: `expected 'permission_denied' to be null` |
| `v2-m14` | v2 without the microphone clear | 1 | the microphone MD-03 test fails at the recovery, same message |
| `v2-static` | v2 | 0 | `prettier --check` 0, `eslint --max-warnings 0` 0 on both files, `tsc --noEmit` 0 |

The whole play suite was not rerun for v2: the edit adds assertions and one test to this file and changes one comment.

## Ledger items found

MD-01 to MD-08, in `TECH-DEBT.md.rows`. Three were pinned: MD-01 (quirk, left as is), MD-02 (performance, two tests, open) and MD-03 (bug, fixed by `fix-MD-03.v2.patch`). The others come from reading the code and from building the harness, and are not pinned.

MD-02 is the item that bears on weak devices. A stale result costs a full device open that is then thrown away, and the next request opens the device again. The room's enter is batched, so the common path asks once (test 1). Any two inputs of P1 that change in the same tick outside a batch, or one change while a request is pending, pay twice. In a browser a request takes 0.3 to 3 s (the module's own estimate at `:520-524`), so the pending window is wide. This is inferred from the code and the fakes; no browser trace was taken.

On the eight-user freeze: none of P1 to P6 takes the number of remote users as an input. The pinned paths run once per local change, not once per peer, so this module's `getUserMedia` chain alone does not explain a freeze that appears with eight users and cameras off (inferred from the inputs of `mediaStreamConstraintsStore` and of `cameraEnergySavingStore`). What does run on a timer is unpinned: `localVolumeStore` starts a `SoundMeter` and a 100 ms interval per subscription (`:1369-1420`).

## Gaps

- The noise suppression queue (`audioProcessedLocalAudioTrackStore`, `:1081-1143`) and the background effect queue (`backgroundProcessedLocalVideoTrackStore`, `:1242-1284`) are not pinned. The tests turn noise suppression off and leave the background mode at `none`.
- `localStreamStoreForPublishing`, `availabilityStatusStore`'s order of statuses, the status and microphone dwell analytics, the volume stores and `speakerListStore` are not pinned.
- The `navigator.mediaDevices` missing branches (HTTP, old iOS webview, old browser), `NotFoundError` and `NotReadableError` are not pinned. The microphone-only failure branch is pinned since v2.
- The `"low"` video quality (640×360), `inExternalServiceStore`, `inBackgroundSettingsStore` and the statuses that hold both devices (busy, silent zone) are not pinned. `mediaHeldByStatus` itself is covered through `HeldMediaStore.test.ts`.
- Every fake request resolves at once. Real requests take long enough for MD-02 to occur more often than the tests show (inferred).
- MD-04 to MD-08 are not pinned.
- `TESTING.md.rows` and `TECH-DEBT.md.rows` were the worker's drafts. The coordinator merged them into `docs/TESTING.md` and `docs/TECH-DEBT.md` with the v2 changes.

## Resources

Containers `wa-fable-md1-*` on sbh, `--rm`, one at a time: 23 runs (`probe1` to `probe5`, `static1`, `f-static`, `f-m1` to `f-m12`, `f-suite`, `f-flip`, `f-fix`, `f-suite2`), the last one ended at 04:57 UTC. Left: 0 (`docker ps --filter label=owner=wa-fable-20261112` lists no `md1` container; another worker's `wa-fable-gs3-*` containers were running with the same label and were not touched). Remote dir `~/wa-jobs/wa-fable-20261112/md1` stays until the coordinator releases the job dir. It holds the runner `run.sh`, the `HEAD` overlay (`overlay/`, `overlay.tgz`), the staged tests copy (`tests-run/`), the blob comparison (`head-blobs.tsv`, `tree-blobs.tsv`, `paths.txt`, `differ.txt`, `a`, `b`), the test and fix variants (`t/`), the mutants (`mutants/`, `mutants.tgz`, `make_mutants.py`), the logs (`logs/`) and `checks.raw.log`. No `._*` file was created there (`find` counts 0). Mac scratch `/tmp/wa-md1` was removed after the deliverables were copied here.

Verdict round: 5 more `wa-fable-md1-v2-*` containers, `--rm`, one at a time, left 0. They added `md1/t2/` (variants), `md1/run2.sh` and `md1/logs2/` to the sbh job dir. Mac scratch `/tmp/wa-md2`.
