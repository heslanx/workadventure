# MD-09 fix: a camera or microphone another application holds

The user is paying down technical debt in WorkAdventure on the way to 1,000 simultaneous users, responsive weak devices and an answer to the eight-user freeze. MD-09 is a gap in what the action bar tells a user: when the browser cannot read a camera or microphone (`NotReadableError`, usually because a video-call app holds it), `MediaStore` turns the device off and records no access issue, so the camera or microphone tooltip names no cause. The user approved the fix (Key Decisions, 2026-11-12): a third access issue for `NotReadableError`, with tooltip text and i18n keys, and the MD-09 pin flipped in the same commit.

Baseline: `HEAD` = `5deb37fd5`. `MediaStore.ts` sha256 `21d9c104f55462e242efa2d152f4c62ca4a92a861dbc6a13d2d0d71327a5a2c1` (1,866 lines), `MediaStoreGetUserMedia.test.ts` `7a03f49a52d14c1553bb4117cd5f2c2343212655e76b84cf0f06dd8a5931dcec`. No file in the checkout was edited outside this folder.

## Deliverables

| # | file | kind | sha256 |
|---|---|---|---|
| 1 | `01-md09-device-in-use.patch` | behavior fix with its flipped pin and one new test (21 files, +159 / -7) | `d82df040aebb72fe0249c54247ccca8b02715bc44dbdf22424a8d005cc4a5147` |

Also here: `mutants.diff` (the three mutants below), `TECH-DEBT.md.rows` (the MD-09 status), `TESTING.md.rows` (the Safety Net Map sentence that the flip makes stale), `checks.raw.log` (every container run, ANSI stripped), the container runner `run.sh`, and the two scripts that wrote the i18n keys and the mutants: `add_i18n.py` and `make_mutants.py` (each runs with `python3 -I <script> <args>`).

After the patch: `MediaStore.ts` `e9a5a9294cade141869b84941c08731c546df5a5dec515c058e1133274da5a46` (1,877 lines), `MediaStoreGetUserMedia.test.ts` `9d59ed8ec4d164d37e9890edf1d29372a7d0368535902ad3950e17ccacaad378`.

## The patch

The data shape is the union `MediaAccessIssue`, which gains a third member: `"permission_denied" | "no_device" | "device_in_use"`. Everything else follows the path the other two members already take, so the patch adds one branch at each point that reads an issue and changes no flow.

- **Classify.** `classifyMediaAccessError` returns `"device_in_use"` for an error named `NotReadableError` (after `MediaStore.ts:750-752`). `handleGetUserMediaFailure` already writes the classified issue: the camera branch to `cameraAccessIssueStore` (after `:814`), the microphone branch to `microphoneAccessIssueStore` (after `:827`). Neither write changed.
- **Clear.** Unchanged code clears it. The run that asks for a device again sets that device's issue to `null` (after `:912-917`, MD-03's fix `87b3c6e03`), whatever the issue kind. The new tests show it for both devices.
- **Help context.** `cameraButtonHelpContextStore` and `microphoneButtonHelpContextStore` return `"device_in_use"` for that issue (after `:1649`, `:1680`), placed after the two existing issue branches and before the empty-device-list fallback, so a held device is never reported as missing.
- **Tooltip.** `CameraMenuItem.svelte` and `MicrophoneMenuItem.svelte` map that context to `$LL.camera.help.tooltip.deviceInUseTitle()` / `deviceInUseDesc()` and `$LL.camera.help.microphoneTooltip.deviceInUseTitle()` / `deviceInUseDesc()`, with no illustration (`media: ""`), as the no-device branch does.
- **Text.** English source: "Camera in use" / "Your camera is being used by another application. Close that application, then try again." and "Microphone in use" / "Your microphone is being used by another application. Close that application, then try again." `docs/agent/i18n.md` names `npm run i18n:check`, which fails when any locale lacks a key of `en-US` (`play/scripts/diff-i18n.ts --check`, run by CI), so the four keys are in all 17 locales, next to `noDeviceDesc`, in each locale's existing register (formal in `de-DE`, `fr-FR`, `ca-ES`, `dsb-DE`, `hsb-DE`; informal where the neighbouring keys are). The translations are this worker's own; the Sorbian ones (`dsb-DE`, `hsb-DE`) are the least certain and are worth a native reader. `prettier` joined the shorter descriptions onto one line.
- **Doc comments.** `handleGetUserMediaFailure`'s comment said a camera another application holds maps to no issue; that clause is gone. The two help-context comments list the third case.
- **Raw error.** `emitCurrentStreamOrError` still emits the error on `rawLocalStreamStore` first, so `MediaManager` gets the same error as before (the flipped test still asserts the one emitted `NotReadableError`).

Consumers of `MediaAccessIssue` (`rg` over `play/src` and `play/tests`): `classifyMediaAccessError`, `trackMediaAccessIssue`, the two help-context stores, and `MediaSettingsPanel.svelte`. None is a `switch` or a `Record` keyed by the union. The help-context stores and the tooltips now handle every member. `MediaSettingsPanel.svelte` compares with `"permission_denied"` and `"no_device"` only, so a device in use shows the panel it showed before (the issue was `null` then). `trackMediaAccessIssue` sends an event for `"permission_denied"` and `"no_device"` and nothing otherwise, so a device in use still sends no analytics event, as before the patch (see "Left out").

### Tests

In `play/tests/front/Stores/MediaStoreGetUserMedia.test.ts`:

- **Flipped pin** (from `271c6f9d9`): "MD-09 (fixed): a camera the browser cannot read (NotReadableError, taken by another application) turns the camera off, keeps the microphone, and records device_in_use until the camera is asked for again". Same setup and same first-half assertions as the pin, except `cameraAccessIssueStore` and `cameraButtonHelpContextStore` are now `"device_in_use"` (were `null`). It then turns the camera on again and asserts a camera-only request, both values back to `null`, and the stream holding the microphone and the new camera track.
- **New microphone case**: "MD-09 (fixed): a microphone the browser cannot read (NotReadableError) turns the microphone off and records device_in_use while the camera is asked for, until the microphone is asked for again". It mirrors the MD-03 microphone test: a microphone-only request fails, the microphone is off with `"device_in_use"` and its help context; a camera-only run keeps both; turning the microphone on again asks for it alone and clears both.

## Test-first evidence

The patch's test file (`9d59ed8e…`) run against `HEAD`'s code (`MediaStore.ts` `21d9c104…`, the tree's own copy, whose sha256 equals `HEAD`'s; only the test file was mounted), section `t1-on-s0` of `checks.raw.log`, exit 1:

```
 FAIL  … > MD-09 (fixed): a camera the browser cannot read (NotReadableError, taken by another application) …
AssertionError: expected null to be 'device_in_use' // Object.is equality
 ❯ tests/front/Stores/MediaStoreGetUserMedia.test.ts:378:47
        expect(get(m.cameraAccessIssueStore)).toBe("device_in_use");
 FAIL  … > MD-09 (fixed): a microphone the browser cannot read (NotReadableError) …
AssertionError: expected null to be 'device_in_use' // Object.is equality
 ❯ tests/front/Stores/MediaStoreGetUserMedia.test.ts:406:51
        expect(get(m.microphoneAccessIssueStore)).toBe("device_in_use"…
 Test Files  1 failed (1)
      Tests  2 failed | 12 passed (14)
```

The same file with the patched code (`MediaStore.ts` `e9a5a929…`), section `s1-focus`, exit 0: `MediaStoreGetUserMedia.test.ts (14 tests)` all passed, and the 11 files that import or mock `MediaStore` passed, 95 tests.

## Mutants

Each mutant is one line of the patched `MediaStore.ts`, written by `make_mutants.py` (it asserts the line sits inside the named function before changing it; `mutants.diff`), run with the patched test file and the 11 test files, one container each.

| mutant | change (line in the patched file) | exit | failing tests and message |
|---|---|---|---|
| M1 | `classifyMediaAccessError` maps `NotReadableError` to `"no_device"` instead of `"device_in_use"` (`:751`) | 1 | 2 failed / 93 passed: both MD-09 tests, `expected 'no_device' to be 'device_in_use'` |
| M2 | `cameraButtonHelpContextStore` returns `null` for `"device_in_use"` (`:1659`) | 1 | 1 failed / 94 passed: the MD-09 camera test, `expected null to be 'device_in_use'` (the help context) |
| M3 | `microphoneButtonHelpContextStore` returns `"no_device"` for `"device_in_use"` (`:1690`) | 1 | 1 failed / 94 passed: the MD-09 microphone test, `expected 'no_device' to be 'device_in_use'` (the help context) |

In-container sha256 of the mutated files: M1 `014772a3…`, M2 `33c082ca…`, M3 `1e69e359…`, equal to the files `make_mutants.py` wrote. The other 10 test files passed in every mutant run.

## Checks

Host `ci`, image `node:24-trixie`, `docker run --rm --cpus 1.5 --cpu-shares 512 --memory 4g --network none --label ci-job=wa-fable-20261112 --name wa-fable-fixmd-<suffix>`, one at a time, each started only after `/proc/loadavg` read 24 or less (`run.sh`, copied here; it held `static-s1` while the load was above 24). The tree `/srv/ci-jobs/wa-fable-20261112/src-review` was mounted read-only at `/work` and not modified; the 21 touched files in it had `HEAD`'s sha256 before any run. The tree has no `play/node_modules/.vite`, and a read-only mount cannot get a new mount point, so the first attempt of check 1 failed at container start (exit 125, section `s0-focus-attempt1`). The runner then mounts a copy of `play/node_modules` (`fixmd/nm-play`, four packages, plus the empty `.vite` and `.vite-temp` dirs) read-only over the tree's and puts `tmpfs` on the two cache dirs. Each stage file is mounted read-only over its path (writable only in `fmt-s1`, on the job's own copies of the stage files, and in `gen-s1`, on the job's copies of the generated files), and each run prints the sha256 of every mounted file from inside the container. The i18n types were regenerated with `npx typesafe-i18n --no-watch` in a container on writable copies of the generated files (section `gen-s1`); only `i18n-types.ts` changed, and it is git-ignored (`play/src/i18n/.gitignore`), so the patch ships no generated file. The static checks and the suite mount that regenerated `i18n-types.ts` (`6cd6fe6b…`). `NODE_OPTIONS=--max-old-space-size=2700` for the focused runs, 3072 for the rest.

| check | stage | command (in `/work/play`) | exit | result |
|---|---|---|---|---|
| 1. before any change | `HEAD` | `npx vitest run` on the 11 test files that import or mock `MediaStore` | 0 | 11 files, 94 passed |
| 2. test first | patched test file, `HEAD` code | `npx vitest run tests/front/Stores/MediaStoreGetUserMedia.test.ts` | 1 | 2 failed / 12 passed (above) |
| 2. after the patch | stage 1 | the 11 files | 0 | 11 files, 95 passed (MediaStoreGetUserMedia 14) |
| 3. mutants | M1 to M3 | the 11 files | 1 each | above |
| 4. eslint | stage 1 | `npx eslint --max-warnings 0` on the 21 touched files | 0 | no output |
| 4. prettier | stage 1 | `npx prettier --check` on the 21 touched files | 0 | `All matched files use Prettier code style!` |
| 4. typecheck | stage 1 | `npm run typecheck` | 0 | no diagnostics |
| 4. svelte-check | stage 1 | `npm run svelte-check` | 0 | `svelte-check found 0 errors and 0 warnings` |
| 4. i18n | stage 1 | `npm run i18n:check` | 0 | `✅ All translations are complete.` |
| 4. whole play suite | stage 1 | `npm test -- --run` | 0 | 259 files passed; 1,683 passed, 10 skipped (1,693); `Duration` 408.0 s |
| 5. `git apply --check` (Mac) | fresh `git archive 5deb37fd5` | `git apply --check 01-md09-device-in-use.patch`, then `git apply` | 0, 0 | the 21 files then equal stage 1 byte for byte (`cmp`) |

The checkout moved during the task: at 16:28 UTC its `HEAD` was `c007401b5`, one docs-only commit on top of `5deb37fd5` (it adds `docs/TECH-DEBT.md`, `docs/TESTING.md` and `docs/REMOVE-TECHNICAL-DEBT-PLAN.md`), and its working tree held other uncommitted edits. Neither touches the 21 files of the patch (`git diff --name-only` on them is empty for both), and `git apply --check 01-md09-device-in-use.patch` in the checkout exits 0 (section `apply-check-checkout`).

The 11 test files: `tests/front/Stores/MediaStoreGetUserMedia.test.ts`, `src/front/Stores/HeldMediaStore.test.ts`, `src/front/Stores/PrivacyShutdownStore.test.ts`, `src/front/Stores/MicrophoneSignalDetectorStore.test.ts`, `src/front/Stores/RaiseHandAvailabilityStore.test.ts`, `src/front/Space/Utils/BindMuteEvents.test.ts`, `src/front/Space/tests/SpaceFilter.test.ts`, `src/front/Livekit/LiveKitRoom.test.ts`, `src/front/Stores/NoMicrophoneSoundWarningVisibleStore.test.ts`, `tests/front/WebRtc/JitsiCoWebsite.test.ts`, `tests/front/Connection/RoomConnection.test.ts` (every test file that imports or mocks `MediaStore`, plus `PrivacyShutdownStore.test.ts`, which the earlier MediaStore passes ran).

`prettier --write` ran once on the stage files before the commit (section `fmt-s1`) and joined the shorter translated descriptions onto one line; the first `fmt-s1` attempt pointed at a wrong directory, so it formatted nothing and only read the tree's own files, all `(unchanged)` (section `fmt-s1-wrongpath`).

## Left out, and why

- **Analytics.** `trackMediaAccessIssue` sends `media.permission_denied` or `media.device_error` for the two old kinds and nothing otherwise. A device in use sent no event before (its issue was `null`) and sends none now. Counting it as `media.device_error` with `reason: "device_in_use"` would change the experience-issue counts on the admin dashboards, which the approved decision does not cover. It is one `else if` in `trackMediaAccessIssue` if the owner wants it.
- **The tooltip text is not tested.** No test renders `CameraMenuItem.svelte` or `MicrophoneMenuItem.svelte`, for any of the three contexts. The tests pin the help-context value each tooltip reads; `svelte-check` proves the four keys exist in the generated types. A mutant that swapped the camera and microphone keys in a menu item would survive. A component test would need the `GameManager` seam (MD-07) and the action-bar tooltip markup, which is more than this fix.
- **`MediaSettingsPanel.svelte`** shows no device-in-use state; it shows what it showed before for a `null` issue. The decision named the action-bar tooltips only.
- **Legacy error names.** The other two cases also match old Chrome names (`PermissionDeniedError`, `DevicesNotFoundError`). Old Chrome's `TrackStartError` was not added: no supported browser sends it, and nothing could show it working.
- **A stale comment.** The doc comments of `cameraAccessIssueStore` and `microphoneAccessIssueStore` (`:71-81`) still say the issue is "cleared when the user turns the camera off manually, when a video track is obtained, or when a camera appears". Since `87b3c6e03` only a run that asks for the device clears it, so turning the device off no longer does. Not touched: a comment fix is a separate structure commit, and this patch is the behavior commit.
- MD-01, MD-02, any refactor, and `MediaManager`'s popups were out of scope. No independent review was run; the coordinator's verdict step applies.

## Suggested commit message

```
fix(play): say when another application holds the camera or microphone

When getUserMedia fails with NotReadableError, usually because a
video-call app holds the device, MediaStore turned the device off and
recorded no access issue, so the action-bar tooltip named no cause
(MD-09). The user saw the camera go off with nothing to act on.

classifyMediaAccessError now maps NotReadableError to a third access
issue, "device_in_use". The camera and microphone help contexts return
it, and the tooltips say that another application is using the device
and to close that application, then try again. The issue is recorded
and cleared like the other two: a run clears it only when it asks for
that device again. The error still reaches MediaManager as before.

The NotReadableError test flips from "no access issue" to
"device_in_use", and a microphone-only case is added. The new keys
deviceInUseTitle and deviceInUseDesc are in every locale, because
i18n:check fails on a missing key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Resources

- `ci` containers started by this task, all `--rm` and run one at a time: `wa-fable-fixmd-s0-focus` (twice; the first failed at start, exit 125), `-fmt-s1` (twice; the first pointed at a wrong directory), `-gen-s1`, `-t1-on-s0`, `-s1-focus`, `-m1`, `-m2`, `-m3`, `-static-s1`, `-suite-s1`. Left: 0 (`docker ps -a --filter name=wa-fable-fixmd` at 16:28 UTC).
- Kept on `ci` as evidence: `/srv/ci-jobs/wa-fable-20261112/fixmd/` (3.4 MB: `run.sh`, `mutants.sh`, `static.cmd`, `nm-play/` (the `play/node_modules` copy), the stage, test-only, generated-types and mutant files under `v/`, and `logs/`). No `._*` file there. `src-review` was mounted read-only in every run and not modified; no other job dir was touched.
- The Mac scratch `/tmp/wa-fixmd` (the `git archive` repo with stage 0 and stage 1 as commits, the apply-check copy and the packing dirs) was deleted after the deliverables were copied. Nothing was committed, branched or staged in the checkout; only this folder was written, and no `._*` or `.DS_Store` file was created in it.
