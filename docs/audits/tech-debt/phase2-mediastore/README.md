# Phase 2, third pass: `MediaStore.ts` (refactoring-patterns)

The user is paying down technical debt in WorkAdventure on the way to 1,000 simultaneous users, responsive weak devices and an answer to the eight-user freeze. Phase 1 put a safety net under `play/src/front/Stores/MediaStore.ts` (1,811 lines), the module that decides what the browser's camera and microphone are asked for. This pass makes its one `getUserMedia` caller, `runRawStreamUpdate`, easier to read without changing what it does, and touches only code that net pins. First it pins the two failure branches the net missed, `NotFoundError` and `NotReadableError`. Then it extracts the failure handling and the track plan into two module functions, and corrects the comment that MD-05 calls wrong.

Baseline: `HEAD` = `40f7184b1`. `MediaStore.ts` sha256 `fc5f6b6ed780d25926418d26f2c940eb6913df9501fc67482e7073e10403640d`, `MediaStoreGetUserMedia.test.ts` `933c99e46c1054a08ac65475ba4006ec29e6243e656ff78ad098923361783699`. No file in the checkout was edited outside this folder.

## Deliverables and stack order

Apply in this order with `git apply` from the repository root. Each patch is the diff between two consecutive stages of a scratch repository built from `git archive HEAD`, one commit per item.

| # | file | kind | smell or gap | sha256 | `MediaStore.ts` after | test file after |
|---|---|---|---|---|---|---|
| 1 | `01-characterize-notfound-notreadable.patch` | characterization tests (tests only, +40 lines) | P3 gaps `NotFoundError` and `NotReadableError` | `438aaca1031b0ba136647c8f3ab49ac7aba25590e028dbfaeb230f73854c86f0` | `fc5f6b6e…10403640d` (unchanged) | `7a03f49a52d14c1553bb4117cd5f2c2343212655e76b84cf0f06dd8a5931dcec` |
| 2 | `02-extract-getusermedia-failure-handler.patch` | Extract Function | long function with four error branches (the `catch`) | `6bb432191b60cdac61e79e5cc5e2cd76822f30e66d56812d111eb70ff0f56174` | `155127affbd58f55c4178ff66ca8113af9d32d8bc0e2803bebcad07e08a68486` | `7a03f49a…` (unchanged) |
| 3 | `03-extract-track-plan.patch` | Extract Function (the row's prescribed refactoring) | same row: the track plan | `5bc08d9237e3b8daa8ac88b833a837abf67426f30a6c4b3382046d568c4e937d` | `1f01fc3c60632093d52dd1de4a413030ea68136490138015d0e2655bdaac7ac7` | `7a03f49a…` (unchanged) |
| 4 | `04-correct-md05-comment.patch` | comment corrected (comment only) | MD-05, the comment half | `71660fbd78907014c151a3eaacdb10273267ecab7872fe611981ca34b80117dc` | `8dad9d1ebe57193b66b579a45e9b5db83330c3c6231044bd6895454b5a638470` | `7a03f49a…` (unchanged) |

Also here: `mutants.diff` (the eleven mutants below, sha256 `f85eea034fa9db012c4b6f07003eb5603d6be6547a2b64105ffe062ac43ac2bd`), `TECH-DEBT.md.rows` (ledger and Smell Inventory updates), `TESTING.md.rows` (Test Strategy, Safety Net Map and backlog updates for item 1), `checks.raw.log` (every run, ANSI stripped), and the three scripts that built or checked the patches: `extract_catch.py` (patch 2), `make_mutants.py` (the mutants) and `moved.py` (the multiset check, copied from the SocketManager pass). Each runs with `python3 -I <script> <args>`.

## The items

### 1. Characterization tests: `NotFoundError` and `NotReadableError`

Two tests in `MediaStoreGetUserMedia.test.ts`, after the two MD-03 tests. Each queues one failed answer with the existing harness (`browser.failNext(namedError(...))`), enters the room with the batched camera and microphone request, and asserts what `HEAD` does:

- "a camera the browser cannot find (NotFoundError) turns the camera off, records no_device, and asks again for the microphone alone". Two `getUserMedia` calls: camera and microphone, then the microphone alone. `rawLocalStreamStore` emits one error, named `NotFoundError`. `requestedCameraState` is `false` and `requestedMicrophoneState` `true`. `cameraAccessIssueStore` and `cameraButtonHelpContextStore` are `"no_device"`; the microphone's issue and help context are `null`. The stream holds the microphone track of the second request.
- "a camera the browser cannot read (NotReadableError, taken by another application) turns the camera off without recording an access issue, and keeps the microphone". The same two calls, one error named `NotReadableError`, the camera off and the microphone on. Both access issues and both help contexts are `null`, because `classifyMediaAccessError` maps the name to nothing. This is the case the code's own comment names ("A camera taken by another application (NotReadableError on Windows) must not cost the microphone"), and the test is the first to hold it.

The assertions were written from a reading of the code and all passed on their first run against `HEAD`'s code, so each records an observed value; mutants E1 to E4 show that they can fail. Neither branch pins a defect, so no ledger row was added; `TECH-DEBT.md.rows` records the one observation (a `NotReadableError` leaves the camera button without a help context) as a product question. No product file was edited to pin them.

### 2. Extract Function: `handleGetUserMediaFailure`

The `catch` block of `runRawStreamUpdate` (`HEAD` `:957-1001`, 43 body lines) became a module function placed before `runRawStreamUpdate`. The `catch` now reads:

```ts
} catch (e) {
    handleGetUserMediaFailure(
        e,
        constraints,
        newConstraints,
        { mustRequestNewVideo, mustRequestNewAudio },
        setIfCurrent,
    );
}
```

The function takes exactly what the block read: the error, the run's constraints (only `.video` and `.audio`, for the "nothing requested" branch), the constraints sent to `getUserMedia` (for the log lines), the two request flags, and `setIfCurrent`. The two flags travel as one named object so a call cannot swap them; the function destructures them, so the body still reads `mustRequestNewVideo` and `mustRequestNewAudio`. The parameter keeps the name `e` and the constraints keep `newConstraints`, so every moved line is the old line, 8 spaces less indented.

What stays the same, and how each is shown:

- **Statements and their order.** `extract_catch.py` moved the 43 lines and asserted every boundary line first. The multiset check (`moved.py` on the patch, section `moved-lines-02` of `checks.raw.log`) lists what was removed and not re-added: `console.info(` and the message line of the camera branch's log call, which `prettier` joins into one line (`console.info("Error. Unable to get microphone and/or camera access. Trying audio only.", newConstraints, e);`) once it is 8 spaces less indented. Everything else added is the function's doc comment, its signature, its closing brace and the call.
- **Early returns and values.** The block had no `return`; the function returns `void` and the `catch` is still the last statement of its `if`, followed by `return nextConstraints;` as before. The stale-generation `return nextConstraints;` stays in the `try`.
- **Store writes and side effects.** Every store write (`requestedCameraDeviceIdStore`, `requestedMicrophoneDeviceIdStore` in a batch, `requestedCameraState.disableWebcam()`, `cameraAccessIssueStore`, `requestedMicrophoneState.disableMicrophone()`, `microphoneAccessIssueStore`, the `setIfCurrent` calls) is in the moved body, unchanged and in order. The function is synchronous, so it runs to its end inside the `catch` before anything else, as the inline block did, and an exception it throws leaves `runRawStreamUpdate` the same way.
- **The `navigator.mediaDevices === undefined` branches** at the top of `runRawStreamUpdate` (a P3 gap) were not touched.

### 3. Extract Function: the track plan, `planTracks`

The decisions which tracks to request and which to stop are now a pure function of the previous run's constraints, the new constraints and three flags about the live tracks:

```ts
const hasLiveVideoTrack = currentStream ? hasLiveTrack(currentStream.getVideoTracks()) : false;
const hasLiveAudioTrack = currentStream ? hasLiveTrack(currentStream.getAudioTracks()) : false;
const { mustRequestNewVideo, mustRequestNewAudio, mustStopVideo, mustStopAudio, oldAudioConstraints } = planTracks(
    oldConstraints,
    constraints,
    { hasLiveVideoTrack, hasLiveAudioTrack, hasWarmAudioTrack: warmAudioTrack !== undefined },
);
```

`planTracks` (after `:845-866`) holds the decisions of `HEAD` `:837-848`. It reads no module state and touches no track: the call site still reads `currentStream` for the two live flags, and passes the module's `oldConstraints` in. The call sits where `mustRequestNewVideo` and `mustRequestNewAudio` were computed, after `takeWarmAudio` and `releaseWarmAudio`, so no side effect moved.

The data shape that needed a decision: when the microphone is turned off during a conversation, its stopped track is kept warm with the constraints it was opened with (`warmAudio = { track: t, constraints: oldAudioConstraints }`). In `HEAD` that line type-checks only because `oldAudioConstraints` and `mustStopAudio` are locals of the same function, and TypeScript narrows `oldAudioConstraints` to `MediaTrackConstraints` through the `mustStopAudio` alias. A plan that returned four booleans would lose that narrowing, and the call site would need a cast or a redundant check. `TrackPlan` (after `:828-839`) therefore makes the pairing a type: `{ mustStopAudio: true; oldAudioConstraints: MediaTrackConstraints } | { mustStopAudio: false; oldAudioConstraints: MediaTrackConstraints | false }`, intersected with the three other flags. The destructured `if (mustStopAudio)` narrows `oldAudioConstraints` inside the `forEach` callback, as before; a probe with `tsc --strict` confirmed the pattern before the patch, and play's `npm run typecheck` passes on the stack.

What moved or changed, and why each keeps the behavior:

- **Moved, pure.** `mustRequestNewVideo` and `mustRequestNewAudio` (same place), and `mustStopVideo`, `oldAudioConstraints` and `mustStopAudio`, which moved from the top of `if (currentStream)` up to the plan call, just before that `if`. They read only `oldConstraints` and `constraints`, which nothing writes between the two points (no call and no `await` sits between them). When `currentStream` is `undefined` they are now computed and unused, which has no effect.
- **Rewritten, same value.** `warmAudioTrack === undefined &&` became `!hasWarmAudioTrack &&`, with `hasWarmAudioTrack: warmAudioTrack !== undefined` at the call: the plan gets a flag, not the track. `const mustStopAudio = oldAudioConstraints !== false && constraints.audio === false;` became the `if` that picks the union member, the same condition.
- **Not moved.** The stop loops, the `setIfCurrent` after a stop, the warm-track reuse, `newConstraints`, the stops before `getUserMedia`, the request and the merge stay in place and in order. The `keepAudioWarm` choice per stopped track stays in the loop, because it reads each track's `readyState`.

The multiset check of patch 3 (section `moved-lines-03`) lists the two rewritten lines as the only removed lines not re-added.

| stage | `runRawStreamUpdate` lines | extracted (lines) | `MediaStore.ts` lines |
|---|---|---|---|
| `HEAD` | 230 (`:776-1005`) | none | 1,811 |
| after patch 2 | 194 (`:828-1021`) | `handleGetUserMediaFailure` 47 (`:780-826`) | 1,827 |
| after patch 3 | 190 (`:868-1057`) | `handleGetUserMediaFailure` 47 (`:780-826`), `TrackPlan` 8 (`:832-839`), `planTracks` 22 (`:845-866`) | 1,863 |
| after patch 4 | 190 (`:868-1057`) | same | 1,865 |

The function is 40 lines shorter and its `catch` is one call. It is still long: the success path after `getUserMedia` (the merge and about 20 lines of store writes) and the stop loops are the next candidates (see "Left out").

### 4. The MD-05 comment

The comment above `gameSceneIsLoadedStore.subscribe` (`HEAD` `:1511-1517`) said "Nothing here may be watched from module scope", because subscribing to `effectiveMicrophoneStateStore` "is what STARTS that chain". Three module-scope subscriptions already start it at import: `speakerListStore.subscribe` (after `:1711`) and `deviceListStore.subscribe` (after `:1729`) start `deviceListStore`, whose start function subscribes to `localStreamStore` (after `:1612`), and `localStreamStore.subscribe` (after `:1803`) starts it directly. The new comment (after `:1563-1571`) says so, says that nothing is requested at import only because `myCameraStore` and `myMicrophoneStore` start `false`, and keeps the reason the microphone is watched only in a room: an analytics row needs a room. The comment inside `openMicrophoneDwell` began "Same reasoning one level down", pointing at the wrong reasoning; it now reads "Subscribing is what starts the SoundMeter, so it runs only while there is actually something to hear." MD-05 stays open as a design row.

## Checks

Host sbh, image `node:24-trixie`, `docker run --rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none --label owner=wa-fable-20261112`, names `wa-fable-p2md-<run>`, one at a time. The dependency tree `~/wa-jobs/wa-fable-20261112/src-review` was mounted read-only and not modified; `tmpfs` on `play/node_modules/.vite` and `.vite-temp`. The tree predates `HEAD`, so the runner (`~/wa-jobs/wa-fable-20261112/p2md/run.sh`, copied from `p2sm/run.sh`) bind-mounts `HEAD`'s copies read-only over the same paths as the SocketManager pass: `play/src/pusher`, `play/tests`, `play/src/front/Chat/Components/Room`, `Game.ts`, `GameScene.ts`, `childWindow.test.ts`, map-editor's `MapValidator.ts` and its test (`overlay.tgz`, a `git archive HEAD` of exactly those paths and `MediaStore.ts`). `git diff --stat 08040b7e0 HEAD` (the SocketManager pass's baseline) changes only `SocketManager.ts` and `SocketManagerRoomTraffic.test.ts`, both inside the overlay, so the list still covers every file that differs. Over that, each run mounts its stage's `MediaStore.ts` and `MediaStoreGetUserMedia.test.ts` from `v/<stage>/`. `HeldMediaStore.test.ts` (`53de6147…`) and `PrivacyShutdownStore.test.ts` (`c27d41d1…`) are `HEAD`'s bytes in the tree; each focused run prints the sha256 of the three test files and `MediaStore.ts` from inside the container. `NODE_OPTIONS=--max-old-space-size=2700` for the focused runs, 3072 for the static checks and the whole suite. Raw output: `checks.raw.log`.

| check | stage (`MediaStore.ts` / test file) | command (in `/work/play`) | exit | result |
|---|---|---|---|---|
| 1. before any change | `HEAD` `fc5f6b6e…` / `933c99e4…` | `npx vitest run` on the three files | 0 | 3 files, 26 passed (11 + 11 + 4) |
| 2. after patch 1 | `fc5f6b6e…` / `7a03f49a…` | same | 0 | 28 passed (MediaStoreGetUserMedia 13) |
| 2. after patch 2 | `155127af…` / `7a03f49a…` | same | 0 | 28 passed |
| 2. after patch 3 | `1f01fc3c…` / `7a03f49a…` | same | 0 | 28 passed |
| 2. after patch 4 | `8dad9d1e…` / `7a03f49a…` | same | 0 | 28 passed |
| 3. whole play suite | `8dad9d1e…` / `7a03f49a…` | `npm test -- --run` | 0 | 259 files passed; 1,679 passed, 10 skipped (1,689); `Duration` 426.8 s. The SocketManager pass counted 1,677 passed on the same tree; the two more are item 1's tests |
| 4. eslint | stage 4 | `npx eslint --max-warnings 0 src/front/Stores/MediaStore.ts tests/front/Stores/MediaStoreGetUserMedia.test.ts` | 0 | no output (0 errors, 0 warnings) |
| 4. prettier | stage 4 (also stages 1, 2 and 3) | `npx prettier --check` on the same two files | 0 | `All matched files use Prettier code style!` |
| 4. typecheck | stage 4 | `npm run typecheck` (`tsc --noEmit`) | 0 | no diagnostics |
| 5. mutants | see below | the focused command | 1 each | see below |
| 6. compiled output | stages 1 to 4 | `npx esbuild src/front/Stores/MediaStore.ts --format=esm \| sha256sum` | 0 | stage 1 `7748b97c…`, stage 2 `18ce31fc…`, stage 3 `98726123…`, stage 4 `98726123…` |
| 7. `git apply --check` on a fresh `git archive HEAD` of `play/src/front/Stores` and `play/tests/front/Stores` (Mac) | each patch in order, each applied after its check | `git apply --check <patch>`, then `git apply` | 0 for all eight | after each apply, both files have the stage hashes above; after patch 4 they equal the stage 4 files byte for byte (`cmp`) |

After patches 2 to 4 the test file is byte-identical to stage 1: every run prints `7a03f49a52d14c1553bb4117cd5f2c2343212655e76b84cf0f06dd8a5931dcec` for it from inside the container.

Three more checks of the structure-only claims:

- **Moved lines (patches 2 and 3).** `moved.py` on each patch file, described under items 2 and 3. Sections `moved-lines-02` and `moved-lines-03` of `checks.raw.log`.
- **Compiled output (patch 4).** esbuild drops types and these comments. Stage 3 and stage 4 give the same output (`9872612317b9b451e337aac72002d85aa7d6a22189b37c83d0daed88f7872a83`), and `cmp` of the two full outputs finds no difference (section `esb-s3-s4`; the two saved output files end with the runner's `EXIT 0` line, so their own sha256 is `e518159f…`), so patch 4 changed only comments. Stages 1, 2 and 3 differ from each other, as an Extract Function must.
- **The union narrowing (patch 3).** Before writing `TrackPlan`, a 24-line probe with the same shape (an intersection with a two-member union, destructured, the narrowed field read inside a `forEach` callback) compiled under `tsc --strict` with no diagnostic in the probe (section `ts-probe`). Play's typecheck then passed on the real code.

## Mutant evidence

Each mutant is one changed line (`mutants.diff`, built by `make_mutants.py`, which asserts the line exists inside the named function before changing it), run with the three test files. E1 to E4 are against stage 1 (`HEAD`'s code, the new tests). R1 to R3 are against stage 2, inside `handleGetUserMediaFailure`: R1 and R2 are Phase 1's M5 and M7 (`docs/audits/tech-debt/phase1-mediastore/mutants.diff`) re-applied there, and R3 is E3 re-applied there. P1 to P4 are against stage 3: P1 is Phase 1's M4 moved into `planTracks`, P2 and P4 flip one plan decision each, and P3 breaks the one new piece of plumbing, the warm-track flag at the call.

| mutant | change (line in its stage file) | counterpart | exit | failing tests and message |
|---|---|---|---|---|
| E1 | `classifyMediaAccessError` stops mapping `NotFoundError` to `"no_device"` (`:747`) | none | 1 | 1 failed / 27 passed: the `NotFoundError` test, `expected null to be 'no_device'` |
| E2 | the camera branch no longer calls `emitCurrentStreamOrError` (`:978`) | none | 1 | 2 failed / 26 passed: both new tests, `expected [] to deeply equal [ 'NotFoundError' ]` and `[ 'NotReadableError' ]` |
| E3 | `} else if (mustRequestNewVideo) {` becomes `… && classifyMediaAccessError(e) !== null) {` (`:972`): an unclassified camera failure falls to the microphone branch | none | 1 | 1 failed / 27 passed: the `NotReadableError` test, the second request is `{ video: true, audio: false }` instead of `{ video: false, audio: true }` (the microphone was turned off) |
| E4 | `classifyMediaAccessError` maps `NotReadableError` to `"no_device"` too (`:747`) | none | 1 | 1 failed / 27 passed: the `NotReadableError` test, `expected 'no_device' to be null` |
| R1 | the camera branch also calls `requestedMicrophoneState.disableMicrophone()` (`:809`) | M5 | 1 | 3 failed / 25 passed: the MD-03 camera test (`expected false to be true`, M5 failed this one test) and both new tests |
| R2 | drop `requestedMicrophoneDeviceIdStore.set(undefined);` in the `OverconstrainedError` branch (`:799`) | M7 | 1 | 1 failed / 27 passed: the MD-01 test, `expected [ undefined, 'mic-headset' ] to deeply equal [ undefined, undefined ]` (M7 failed the same test) |
| R3 | E3's change inside `handleGetUserMediaFailure` (`:801`) | E3 | 1 | 1 failed / 27 passed: the same test and message as E3 |
| P1 | `mustRequestNewAudio` ignores whether the audio constraints changed or the track ended: `(!deepEqual(…) \|\| !hasLiveAudioTrack);` becomes `true;` (`:859`) | M4 (Phase 1 changed the use at `:888`; this changes the decision) | 1 | 3 failed / 25 passed: the camera toggle test (`getUserMedia` called 2 times, not 1), the MD-03 camera test (`{ video: true, audio: true }` instead of `{ video: true, audio: false }`) and the away mode test. M4 failed the toggle and away tests |
| P2 | `mustStopVideo` negated (`:860`) | none (plan decision) | 1 | 6 failed / 22 passed: the camera toggle, warm microphone, MD-03 microphone, away mode, energy saving and device change tests, e.g. `expected "vi.fn()" to be called 1 times, but got 0 times` |
| P3 | the call passes `hasWarmAudioTrack: false` (`:932`) | none (new plumbing) | 1 | 1 failed / 27 passed: the warm microphone test, `getUserMedia` called 2 times instead of 1 (unmuting asks again) |
| P4 | `planTracks` returns `mustStopAudio: false` where it returned `true` (`:863`) | none (plan decision) | 1 | 2 failed / 26 passed: the warm microphone test (`expected true to be false`, the muted track stays enabled) and the energy saving test (the microphone track is never stopped) |

Each re-applied mutant fails the same test in the extracted function as its counterpart did inline (R1 and P1 fail more tests than Phase 1's M5 and M4 because the suite now has the two new tests, and because P1 changes the decision rather than its one use). The other two test files pass in every mutant run.

## Left out, and why

- The `navigator.mediaDevices === undefined` branches at the top of `runRawStreamUpdate` stay inline: they are a P3 gap, and nothing pins them.
- The success path after `getUserMedia` (merge, `usedCameraDeviceIdStore`, `usedMicrophoneDeviceIdStore`, voice isolation, `hideHelpCameraSettings`) and the stop loops were not extracted. Every test that opens a stream runs through them, but this pass's scope named only the `catch` and the plan.
- `mediaStreamConstraintsStore`'s callback (P1 still has gaps: the `"low"` quality branch, `inExternalServiceStore`, `inBackgroundSettingsStore`, status-held devices), MD-06 (module state into a class), MD-01, MD-02, MD-04, MD-07, MD-08 and the module split were out of scope. No behavior was fixed; MD-01 and MD-02 sit in the moved code unchanged and their pins still pass.
- `cameraButtonHelpContextStore` for a `NotReadableError`: pinned as `null`, not changed (see `TECH-DEBT.md.rows`).
- No independent review of the patches was run in this pass; the coordinator's verdict step applies.

## Suggested commit messages

1. `test(front): pin what MediaStore does when the camera is not found or not readable` / A NotFoundError on the room's request turns the camera off, records no_device and asks for the microphone alone; a NotReadableError turns the camera off with no access issue and keeps the microphone.
2. `refactor(front): extract MediaStore's getUserMedia failure handling` / handleGetUserMediaFailure holds the catch block of runRawStreamUpdate unchanged and in order.
3. `refactor(front): extract the track plan of runRawStreamUpdate` / planTracks decides which tracks to stop and which to request from the previous and new constraints and the live-track flags; TrackPlan keeps the stopped microphone's constraints typed for the warm track.
4. `docs(front): say that MediaStore's getUserMedia chain runs from import` / Three module-scope subscriptions start it; nothing is requested at import only because the camera and microphone stores start false.

## Resources

- sbh containers started by this task: `wa-fable-p2md-s0` to `-s4`, `-fmt-s1` to `-fmt-s3`, `-prettify` (twice), `-probe` (three runs), `-e1` to `-e4`, `-r1` to `-r3`, `-p1` to `-p4`, `-esb-s1` to `-esb-s4` and `-esbout-s3`, `-esbout-s4` (each twice), `-static` (twice), `-suite` (twice), all `--rm` and run one at a time. The first `-suite` run was stopped by this task (`docker stop`) after the planTracks doc comment was reworded, because its stage 4 file was then stale; the stage 3 and 4 focused runs, esbuild and static checks were redone on the new files (the superseded logs are in `checks.raw.log`, section `run1`). Left: 0 (`docker ps -a --filter name=wa-fable-p2md` at 08:07 UTC).
- Kept on sbh as evidence: `~/wa-jobs/wa-fable-20261112/p2md/` (7.0 MB: `run.sh`, `focus.sh`, `fmt.sh`, `prettify.sh`, `batch.sh`, `batch2.sh`, `mutants.sh`, `summary.sh`, `assemble.sh`, `probe.ts`, `overlay.tgz` and `overlay/`, `mutants.tgz`, the stage and mutant files under `v/`, the prettier outputs under `fmt/`, `logs/`, `checks.remote.log`). No other job dir was edited.
- The mutant tarball was made with macOS `tar`, which wrote 34 AppleDouble `._*` files into `p2md/v/` on extraction. They were deleted (`find . -name "._*" -delete` inside `p2md`); none is left in `p2md`, and none was created in this folder.
- `src-review` was not modified: it was mounted read-only in every run. Every directory mount targets a path that already exists in the tree, and the two per-stage file mounts target `MediaStore.ts` in the tree and the test file inside the overlay, so Docker created no mount-point files in the tree.
- The Mac scratch `/tmp/wa-p2md` was deleted after the deliverables were copied. Nothing was committed or staged in the checkout; only this folder was written.

## Coordinator round (verdict)

The cross-family verdict (`verdicts/debt-p2-mediastore.md`, `gpt-6-luna`) was PASS_WITH_NITS with one nit. N1: the doc comment of `handleGetUserMediaFailure` said a failure "records why", but a `NotReadableError` records no access issue (`classifyMediaAccessError` returns `null`, as the new test pins). Fixed in `02-extract-getusermedia-failure-handler.v2.patch`: the comment now says the handler records the device's access issue "if the error maps to one (a camera another application holds does not)". Only that comment changed. `03-extract-track-plan.v2.patch` and `04-correct-md05-comment.v2.patch` are the same changes rebased by one line, with the same patch-ids as v1 (`2c0ec524a47b`, `b89501b316f4`). The post-patch `MediaStore.ts` differs from stage 4 only in those comment lines, and no new line exceeds 116 characters.

| patch | sha256 |
|---|---|
| `02-extract-getusermedia-failure-handler.v2.patch` | `22d4a0f6ece3ca9fba74aeeacd8d1b6017b3412b9b9367452f5d731d4fb93711` |
| `03-extract-track-plan.v2.patch` | `2258c260c566552ab01812da5b6a0333de4f9d88eb3180911f5d7adb0353dee6` |
| `04-correct-md05-comment.v2.patch` | `e4f1ec2aadc82031ed3c991d79d41f1f3c7b6f019aaae00d7808b386c4ce3618` |
