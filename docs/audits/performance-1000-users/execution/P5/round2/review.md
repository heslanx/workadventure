# P5 round 2 independent review: autosave fixes for the seven round-1 findings

Verdict: PASS_WITH_NITS. All seven round-1 findings (M1, M2, m1, m2, m3, m4, n1) are addressed in code or
wording. Every new test fails on its own mutant and passes on the patch. No blocker, major or minor defect
stands. Seven nits remain: four documentation precision points, one test gap, one ordering edge case and one
dead field.

Reviewer did not write the change. Scope: `p5-round2.patch` (`map-storage/src/MapsManager.ts`,
`map-storage/src/tests/MapsManagerAutosave.test.ts`) and `pr-descriptions/P5.md`, measured against the
round-1 checkout state (`MapsManager.ts` sha1 `6c51f25b`) and trunk `ddbe245a8` (sha1 `d6026e47`). Callers
read: `MapStorageServer.ts` 112-469 (lock, entity commands at 373/387/404/440, `addCommandToQueue` at 451),
`EntitiesManager.ts`, `DeleteCustomEntityCommand.ts` (mutates the WAM in `execute`),
`EnvironmentVariableValidator.ts` 47-53 (S3 request timeout default 60000 ms).

## Checks run by the reviewer

All on sbh, tree `~/wa-jobs/wa-fable-20261112/src-p5` mounted at `/work`, `--cpus 1 --memory 3g --network
none`, window 01:40:17 to 01:41:10 UTC. Receipts: `review-receipts/`.

| # | Command | File sha1 | Exit | Result |
|---|---|---|---|---|
| 0 | Local: `git apply` of the patch on a scratch copy of the checkout files, then `git -C <checkout> apply --check` | MM `e109bb53`, test `49a80108` | 0 | Patched sha1s equal the remote tree (`sha1sum` on sbh), so the tree carries exactly this patch |
| 1 | `npx vitest run src/tests/MapsManagerAutosave.test.ts src/tests/MapStorageServer.test.ts` (container `-review-1`) | MM `e109bb53`, test `49a80108` | 0 | 28 passed (15 + 13) |
| 2 | `npx eslint src/MapsManager.ts src/tests/MapsManagerAutosave.test.ts` | same | 0 | clean |
| 3 | `npx prettier --check` same two files | same | 0 | all formatted |
| 4 | `npm run typecheck` | same | 0 | `tsc --project tsconfig-node.json --noEmit` clean |
| 5 | Autosave file against trunk `MapsManager.ts` (`-review-2`) | `d6026e47` | 1 | 10 failed, 5 passed (same set as the author's receipt) |
| 6 | Autosave file against round-1 `MapsManager.ts` (`-review-3`) | `6c51f25b` | 1 | 4 failed (the four new tests), 11 passed |
| 7 | Mutant a: no `markUnsaved` in `addCommandToQueue` (`-review-4`) | `4b300e99` | 1 | 1 failed: queue-only command test (`expected { version: '1.0.0', ... } to match object { lastCommandId: 'entity-cmd' }`) |
| 8 | Mutant b: `markUnsaved` no longer updates `lastEditAt` (horizon from oldest edit) (`-review-5`) | `5eb0fdf8` | 1 | 1 failed: horizon-from-newest test (`expected undefined to be 'cmd-2'`) |
| 9 | Mutant c: log every failed attempt (`-review-6`) | `9aa156e6` | 1 | 1 failed: log-rate test (`expected 40 to be less than or equal to 3`) |
| 10 | Mutant d: write timeout 24 h instead of 5 min (`-review-7`) | `0cd86cd4` | 1 | 1 failed: never-settles test (`expected undefined to be 'cmd-1'`) |
| 11 | Mutant e: terminal `.catch` removed (`-review-8`) | `1834c6af` | 0 | 15 passed: no test covers it (disclosed by the author, see N2) |

Each variant was bind-mounted read-only over `/work/map-storage/src/MapsManager.ts` inside its container, so
the tree file was never modified: `sha1sum` after all runs is still `e109bb53`. Each mutant kills exactly
the test written for it and no other, so the tests are specific, not coincidentally red.

## Finding-by-finding verification

| Round-1 ID | Status | Evidence |
|---|---|---|
| M1 "at most one write" overstated | Fixed (wording) | `P5.md:41-44` and `72-74` now say "per loaded map instance" and name both exceptions: reload after `clearAfterUpload` while the old write runs, and a write past the 5 min timeout. Code read confirms no third path: `startSave` runs only from a `scheduleSave` timer, created when no state exists (`markUnsaved` 256-258) or by the identity-checked completion or timeout of the current `saving` object (319-381). |
| M2 trunk-passing test overclaims | Fixed (relabelled) | Renamed to "should not retry the abandoned state after the map was replaced by an upload" (test 343), with a comment that it passes on trunk and that a held write succeeding after the upload still overwrites it. Run 5 confirms it passes on trunk. |
| m1 entity commands never schedule a save | Fixed | `addCommandToQueue` (194-200) calls `markUnsaved` for a loaded map. Evidence that a save is needed: `DeleteCustomEntityCommand.execute` mutates `wamFile.getGameMapEntities()`, and `MapStorageServer` runs it through `entitiesManager` (404), which never marks unsaved. Killed by mutant a; fails on trunk and round 1. Healthy-path write counts unchanged (1 and 5, runs 1, 7-10). |
| m2 horizon from the oldest edit | Fixed (deliberate, tested) | `lastEditAt` updated on every edit (`markUnsaved` 261), carried into `saving` at write start (301) and into the follow-up/retry state (342, 380); horizon check at 354-355. Killed by mutant b. Constant doc 78-81 and `P5.md:57-60` state the semantics. |
| m3 write that never settles | Fixed (bounded) | The `saving` state carries a 5 min timer (289-297) that calls `onSaveFailed`; both completion handlers clear it after the identity check (324, 352); `clearAfterUpload` now clears any state's timer (179-182). A late completion after the timeout finds a different state and is ignored. Killed by mutant d. The overlap after a timeout is disclosed (`P5.md:43-44`, `81-82`). |
| m4 one `console.error` per attempt | Fixed | Logged on attempt 1 and every 20th (368); abandonment always logged (356-359); Sentry unchanged (first failure, abandonment). Killed by mutant c. |
| n1 no terminal `.catch` | Fixed in code, untested | `.catch` at 313-316 logs with the map key and reports to Sentry. Mutant e survives (run 11). See N2 and N3. |

## Refutation attempts

1. Timer leaks. Every `saving` state's write timer is cleared on success, on failure, or by
   `clearAfterUpload`; it fires only once in the timeout path, which replaces the state. A dirty/retrying
   timer is the one that starts the write. No other code path replaces a state with a live timer
   (`scheduleSave` runs only with no state or after the identity-checked handler cleared the timer).
2. Self-reference in initializers (`state` at 274-276, `saving` at 289-297): the closures run from timers
   after the `const` is initialized; `tsc` accepts it (run 4).
3. Double `markUnsaved` on the `executeCommand` path: the second call only moves `lastEditAt` forward by
   the microtask gap between `executeCommand` and `addCommandToQueue` and sets nothing new while saving
   (`editedDuringWriteAt ??=` already set). Write-count tests still pass.
4. New writes on paths that wrote nothing on trunk: `uploadEntityMessage`, `modifyCustomEntityMessage`,
   `uploadFileMessage` and `errorCommandMessage` only change `lastCommandId` but now schedule one coalesced
   WAM write each. Correct (the persisted `lastCommandId` is otherwise stale), low frequency, but not stated
   in the write-count section: N1.
5. Timeout amplification under a hanging backend: one extra in-flight write per map every ~5 min 15 s, until
   the horizon from the newest edit. With S3 the 60 s request timeout settles writes first; with
   `DiskFileSystem` or long `s3UploadConcurrencyLimit` queueing (default 100) it can stack. Disclosed as a
   trade-off in `P5.md:81-82`, memory note in N5.

## Findings

| ID | Severity | File:line | Claim | Evidence |
|---|---|---|---|---|
| N1 | nit | `docs/audits/performance-1000-users/execution/pr-descriptions/P5.md:97-98` | "Marking unsaved in `addCommandToQueue` does not change these counts" is true only for the two measured schedules. Custom entity upload/modify, file upload and error commands now cause one WAM write each, where trunk wrote none. | `MapStorageServer.ts:367-377, 378-391, 437-445` queue those commands through 451; `MapsManager.ts:199` marks unsaved. Fix: add one sentence or table row stating the new write per entity/file command (coalesced by the 15 s timer). |
| N2 | nit | `docs/audits/performance-1000-users/execution/pr-descriptions/P5.md:109` | "no throw path exists in the handlers to drive it" is inaccurate for tests: the handlers call `console.info`/`console.error`/`Sentry`, which the test file already mocks, so a throwing mock drives the `.catch`. Mutant e (catch removed) survives all 15 tests. | Run 11. `onSaveSucceeded` calls `console.info` at 326 when `failedAttempts > 0`. Fix: add a test (fail once, recover with `console.info` throwing, assert the "Error while handling the save" log), or reword to "not covered by a test". |
| N3 | nit | `map-storage/src/MapsManager.ts:352-380` | `onSaveFailed` clears the write timer before logging and reporting; if `console.error` or `Sentry.captureException` threw, no retry would be scheduled and the map would stay "saving" forever (the m3 state). The terminal `.catch` only logs. | Order: `clearTimeout` 352, logs 356-378, `scheduleSave` 380. Pathological (logging rarely throws). Fix: schedule the retry or drop the state before logging. |
| N4 | nit | `map-storage/src/MapsManager.ts:40, 263` | `editedDuringWriteAt` stores a timestamp that is no longer read; only `=== undefined` is checked (330). | Round 2 moved the follow-up's time source to `lastEditAt` (342). Fix: make it a boolean, or keep and note it is a flag. |
| N5 | nit | `docs/audits/performance-1000-users/execution/pr-descriptions/P5.md:59-60` | "bounds memory during an outage to ... one `WamFile` each" omits the serialized payloads held by timed-out writes that are still in flight (up to about 12 per map per hour on a hanging backend). | Refutation 5. Fix: add "plus the payload of any write past its timeout that is still pending". |
| N6 | nit | `docs/audits/performance-1000-users/execution/pr-descriptions/P5.md:29` | "Four of the 15 tests are regression guards that pass on trunk", while trunk passes five. The fifth (write that never settles) is only implied by the "Not reproduced" row at line 27. | Run 5: 10 failed, 5 passed. Fix: "Five pass on trunk: four regression guards, plus the write-timeout test, which targets a round-1 regression trunk did not have." |
| N7 | nit | `docs/audits/performance-1000-users/execution/P5/README.md` ("What remains") | Still calls the horizon semantics a maintainer decision; round 2 decided it (newest edit). Listed as open by the author. | Author report `open[5]`. Fix: one-line update or a pointer to `round2/README.md`. |

## Not verified

- Real disk or S3 latency, completion ordering and write bytes: only the fake `FileSystemInterface`.
- The full `map-storage` suite, live editor sessions, restart durability.
- The recovery `console.info` line has no assertion.
- No `vi.getTimerCount()` leak assertion; timer release was checked by reading (refutation 1).

## Resources

- Created on sbh: containers `wa-fable-r2-p5-review-1` to `-8`, all `--rm`; `docker ps -a --filter
  label=owner=wa-fable-20261112 --filter name=wa-fable-r2-p5-review` returns 0. Temporary dir
  `~/wa-jobs/wa-fable-20261112/review-p5-mut` (variants and runner) removed. The tree `src-p5` was not
  modified (`MapsManager.ts` sha1 `e109bb53` before and after).
- Local scratch: `/tmp/wa-r2/p5-review/` (scratch repo, variants). Checkout product files untouched.
