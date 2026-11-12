# P5 round 2: fixes for the seven review findings

## v2 (review nits N1-N7)

Patch: `p5-round2.v2.patch` (sha1 `e5ccc9257c429e46b7fba2818e2f5ef50921a2c4`). It fully replaces
`p5-round2.patch` (same base: the checkout's current P5 state) and changes the same two files.
`git -C <checkout> apply --check p5-round2.v2.patch`: exit 0. Result files: `MapsManager.ts` sha1
`4380e3c394856e85c47536e20daf5497faac6df7`, test sha1 `94660593ea3d315aeb873f1817d8354c7e67b9e9`
(equal on sbh). Review: `review.md`.

| Review ID | Change |
|---|---|
| N1 new write source not in the write-count section | `P5.md`: queue-only commands (custom entity upload/modify, file upload, error) now cause one coalesced write where trunk wrote none; the "does not change these counts" claim is limited to the two measured schedules. |
| N2 terminal `.catch` untested | New test "should still retry and report the handler error when logging the failure throws": `console.error` throws on the first-attempt failure log; the test expects the retry to store `cmd-1` and the terminal `.catch` to log the handler error. Mutant with the `.catch` removed fails with an unhandled rejection (`Logger unavailable`). `P5.md` no longer says no throw path exists. |
| N3 logging before the state change | `onSaveFailed` schedules the retry (or removes the state and evicts on abandonment) before it logs and reports; `onSaveSucceeded` makes the map clean or schedules the follow-up before its `console.info`. The same new test fails on the author round-2 code (1 failed, 15 passed: nothing stored). |
| N4 `editedDuringWriteAt` value unread | Replaced by `editedDuringWrite: boolean`. |
| N5 memory bound omits hung writes | `P5.md` adds the payloads of timed-out writes still in flight (about 12 per map per hour on a hanging backend; S3 60 s timeout limits it, `DiskFileSystem` and `s3UploadConcurrencyLimit` queueing do not). |
| N6 trunk passes five, not four | `P5.md`: five of the 16 tests pass on trunk (four guards plus the never-settles test); the 16th test was not run against trunk. |
| N7 round-1 README horizon item | `../README.md` "What remains" now says the horizon semantics were decided in round 2 (newest edit); only the values remain for review. |

v2 checks (receipt `receipts/v2-verification.log`):

| # | Container (sbh) | Command | Exit | Result |
|---|---|---|---|---|
| 1 | `wa-fable-r2-p5-fix-1` | `npx vitest run src/tests/MapsManagerAutosave.test.ts src/tests/MapStorageServer.test.ts` | 0 | 29 passed (16 + 13) |
| 2 | same | `npm run typecheck` | 0 | clean |
| 3 | same | `npx eslint src/MapsManager.ts src/tests/MapsManagerAutosave.test.ts` | 0 | no output |
| 4 | same | `npx prettier --check` on the same two files | 0 | all formatted |
| 5 | `wa-fable-r2-p5-fix-2` | v2 test file against author round-2 `MapsManager.ts` (`e109bb53`, read-only mount) | 1 | expected: 1 failed (new test), 15 passed |
| 6 | `wa-fable-r2-p5-fix-3` | v2 test file against v2 `MapsManager.ts` without the terminal `.catch` (`a7d9dc7f`, read-only mount) | 1 | expected: 1 failed, unhandled rejection `Logger unavailable` |
| 7 | Mac | `git -C <checkout> apply --check p5-round2.v2.patch` | 0 | applies |

Containers created in v2: `wa-fable-r2-p5-fix-1..3`, all `--rm`; left: 0. Remote temp dir
`~/wa-jobs/wa-fable-20261112/p5-fix-tmp` removed. Scratch repo: `/tmp/wa-r2/p5-fix/` (commit `084d004`
base, `eecd6bd` author round 2, working tree v2).

Open after v2: the timeout/horizon/retry/log values are proposals, not measured; no backoff and whole-WAM
serialization per retry; a write handed to storage cannot be cancelled; the full map-storage suite, a real
disk or S3 backend and live editor sessions were not run.

## Author round 2 (superseded by v2)

Patch: `p5-round2.patch` (sha1 `2c5b451b09564a491f5384a899681008e8767357`), on top of the checkout's current
P5 state (round-1 `MapsManager.ts` sha1 `6c51f25b`, test `c0296d5a`). It changes
`map-storage/src/MapsManager.ts` and `map-storage/src/tests/MapsManagerAutosave.test.ts`.
`git -C <checkout> apply --check p5-round2.patch`: exit 0. The checkout was not modified; the PR description
`../../pr-descriptions/P5.md` was updated in place.

Result files after the patch: `MapsManager.ts` sha1 `e109bb53e31ab3dd3d9fd5154ea900657562a4c8`, test sha1
`49a80108c13c9b260b2f7cc5e0c26be161cf53b6` (checked equal on sbh before every run).

## What changed and why

| Review ID | Decision | Change | Test |
|---|---|---|---|
| M1 "at most one write" overstated | Wording | `P5.md` now says "at most one write in flight per loaded map instance" and names both exceptions: a reload after `clearAfterUpload` while the old write runs, and a write past the new 5 min timeout. | none (wording) |
| M2 test passes on trunk | Relabel | Renamed to "should not retry the abandoned state after the map was replaced by an upload", with a comment that it is a regression guard and that a held write that succeeds after the upload still overwrites it. `P5.md` lists the four trunk-passing guards. | renamed |
| m1 entity commands never `markUnsaved` | Fix | Evidence: `MapStorageServer.ts` runs custom entity commands through `entitiesManager.executeCommand`, `DeleteCustomEntityMapStorageCommand` mutates the in-memory WAM (comment at 394-396), and `addCommandToQueue` always mutates `lastCommandId`. A test that only mutates the WAM and queues the command fails on trunk and on round 1 (file left unchanged). `addCommandToQueue` now calls `markUnsaved` when the map is loaded. On the `executeCommand` path it is a no-op on top of the existing mark: the write-count tests (1 and 5 writes) still pass. | "should persist a change made by a command that only went through the command queue" |
| m2 horizon from oldest edit | Fix, deliberate | State field `unsavedSince` replaced by `lastEditAt`, updated by every `markUnsaved`. A failing save is abandoned only when an attempt fails 1 h or more after the newest unsaved edit, so a map still being edited is not dropped. | "should measure the retry horizon from the newest edit, not the first one" (edit at 0, edit at 59m50s, recover at 60m50s: stored `cmd-2`; round 1 stored nothing) |
| m3 write that never settles | Fix | The saving state now carries a `timer` that fails the write after `SAVE_WRITE_TIMEOUT_MS` = 5 min (above the 60 s S3 default), which schedules the normal retry. A late completion of the timed-out write is ignored by the existing identity check. `clearAfterUpload` clears the timer of every state. Trade-off, documented: after a timeout, the retry may overlap the hung write, and if the hung write lands last it restores an older state. | "should count a write that never settles as failed and retry it" |
| m4 log every 15 s per map | Fix | `console.error` on attempt 1 and every 20th attempt (`SAVE_FAILURE_LOG_EVERY_ATTEMPTS`, every 5 min); abandonment is always logged; one `console.info` on recovery with the failed-attempt count. Sentry unchanged (first failure and abandonment). | "should log a failing save on its first attempt and then periodically, not on every attempt" (40 attempts in 10 min, at most 3 logs; round 1 logged 40) |
| n1 no terminal `.catch` | Fix | `.then(onOk, onFail).catch(...)` logs with the map key and reports to Sentry (`location: "autosaveCompletion"`). | none: no throw path exists to drive it |

## Checks

All on sbh, node:24-trixie, `--cpus 1 --memory 3g --network none`, tree
`~/wa-jobs/wa-fable-20261112/src-p5`, cwd `map-storage`.

| # | Container | Command | Exit | Result |
|---|---|---|---|---|
| 1 | `wa-fable-r2-p5-impl-1` | `npx vitest run src/tests/MapsManagerAutosave.test.ts src/tests/MapStorageServer.test.ts` | 0 | 28 passed (15 + 13) |
| 2 | same | `npm run typecheck` | 0 | `tsc --project tsconfig-node.json --noEmit` clean |
| 3 | same | `npx eslint src/MapsManager.ts src/tests/MapsManagerAutosave.test.ts` | 0 | no output |
| 4 | same | `npx prettier --check` on the same two files | 0 | all formatted |
| 5 | `wa-fable-r2-p5-impl-2` | new test file against round-1 `MapsManager.ts` (`6c51f25b`) | 1 | 4 failed, 11 passed: the four new tests above |
| 6 | same | new test file against trunk `MapsManager.ts` (`d6026e47`) | 1 | 10 failed, 5 passed |
| 7 | same | restore patched `MapsManager.ts` | n/a | sha1 `e109bb53` after restore |
| 8 | Mac | `git -C <checkout> apply --check p5-round2.patch` | 0 | applies |

Receipts: `receipts/head-verification.log` (1-4), `receipts/discrimination-round1-and-trunk.log` (5-7).
On trunk, "should count a write that never settles" passes because trunk starts a new write every interval
regardless; it discriminates against round 1 only.

## Open

- (Resolved in v2) The terminal `.catch` has no test (no throw path in the handlers).
- The 5 min write timeout, 1 h horizon, 15 s retry and log-every-20 values are proposals, not measured.
- Each retry still serializes the whole WAM; no backoff (not in this lane's findings).
- A write handed to storage still cannot be cancelled: after an upload or delete, or after a write timeout,
  a late write can restore an older file. Closing it needs the upload/delete paths to wait for the write.
- Not run: the full map-storage suite, real disk or S3, live editor sessions.
- (Resolved in v2) Round-1 `../README.md` "What remains" still lists the horizon semantics as a maintainer decision; this
  round decides it (newest edit). That file was not edited.

## Resources

Containers created: `wa-fable-r2-p5-impl-1`, `wa-fable-r2-p5-impl-2`, both `--rm`; left: 0.
Remote temp dir `src-p5/.p5-base` (round-1 and trunk copies for runs 5-6) was removed. Scratch repo:
`/tmp/wa-r2/p5/`.
