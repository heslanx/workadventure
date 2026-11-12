# P5 independent review: map autosave lifecycle

Verdict: PASS_WITH_NITS. No blocker or major product defect stands. M1 and M2 are the ones to fix before
upstream (a description claim and a test name that overstate coverage of the in-flight write window); all
findings are minor or nit.

Reviewer did not write the change. Scope: `git diff -- map-storage/src/MapsManager.ts` and the new
`map-storage/src/tests/MapsManagerAutosave.test.ts`, against baseline `ddbe245a8`. Callers read:
`map-storage/src/MapStorageServer.ts` (lock at 127, `executeCommand` then `addCommandToQueue` at 451,
`clearAfterUpload` at 73), `map-storage/src/Upload/UploadController.ts` (delete path, 740-767).

## Checks run by the reviewer

All on sbh, container `wa-fable-h8` (1 CPU, idle `sleep infinity` before the run), tree
`~/wa-jobs/wa-fable-20261111/src-wa-fable-h8` mounted at `/work`. Window 00:36:31 to 00:39:11 UTC.

| # | Command | Remote file sha1 | Exit | Result |
|---|---|---|---|---|
| 1 | `npx vitest run src/tests/MapsManagerAutosave.test.ts` (trunk `MapsManager.ts`) | MM `d6026e47` (= `git show HEAD:`), test `c0296d5a` | 1 | 7 failed, 4 passed |
| 2 | `npx vitest run src/tests/MapsManagerAutosave.test.ts src/tests/MapStorageServer.test.ts` (head) | MM `6c51f25b` (= checkout), test `c0296d5a` (= checkout) | 0 | 24 passed (11 + 13) |
| 3 | `npm run typecheck` (head) | same as 2 | 0 | `tsc --project tsconfig-node.json --noEmit` clean |
| 4 | Mutant: head with `editedDuringWriteAt ??= Date.now()` (line 237) removed | MM `47bfca99` | 1 | 2 failed, 9 passed |
| 5 | Restore: `git show HEAD:map-storage/src/MapsManager.ts` piped over ssh, test file deleted | MM `d6026e47` | 0 | test file absent (`ls`: No such file) |

Trunk failures in run 1 (same seven as `receipts/trunk-autosave-tests.log`, whose messages are
`expected 2 to be 1`, `expected 6 to be 5`, `expected undefined to be 'cmd-1'` x2, `console.error` not called
with the map key, `expected 3 to be 1`, `expected 'cmd-1' to be 'cmd-2'`):

- on healthy storage: writes a map edited once a single time; writes a continuously edited map once per interval
- when a save fails: persists after recovery without another edit; keeps the unsaved edit after history expiry;
  reports, gives up and releases past the horizon
- when a save is slower than the interval: never two writes at once; newest edit stored when the first write
  finishes last

Pass on trunk (regression guards, they do not reproduce a trunk defect): persist-and-release, stop retrying
after replace/delete, follow-up write for an edit during a write, abandoned state not written after upload.

Mutant run 4 is killed by "should end with the newest edit stored when the first write is the last to finish"
and "should persist that newer edit with a follow-up write" (`expected 'cmd-1' to be 'cmd-2'`), so the
stale-completion guard is covered by assertions, not only by trunk's coarse behaviour.

## Refutation attempts

1. Two writes of one map overlapping. Within one save state: not possible. `startSave` runs only from a
   timer (`scheduleSave`, 248-251); timers are created only when there is no state (`markUnsaved`, 232-239) or
   by the completion of the current `saving` object (`onSaveSucceeded` 276-296, `onSaveFailed` 298-329), which
   is identity-checked and settles once. Across `clearAfterUpload`: possible, see finding M1.
2. Older completion marking a newer edit clean. Not possible for edits that go through
   `mapsManager.executeCommand`: `markUnsaved` runs after `command.execute()` (95-101), so an edit whose
   mutation straddles `startSave`'s synchronous `JSON.stringify` (269) still sets `editedDuringWriteAt`. No
   timer can run between `markUnsaved` and `addCommandToQueue`'s `updateLastCommandIdProperty`
   (MapStorageServer 451): only microtask continuations separate them. Mutant run 4 confirms the guard is
   load-bearing. Gap for commands that bypass `markUnsaved`: finding m1.
3. Failed save, no further edit. A retry is scheduled every 15 s (328) until a failure finds
   `Date.now() - unsavedSince >= 1 h` (305), then the state is dropped and `evictIfIdle` runs. Bounded: about
   240 attempts per failing streak. Timers: `clearAfterUpload` clears the timer of a dirty/retrying state
   (164-168), a saving state has none; `evictIfIdle` only evicts when no state exists (218), so eviction never
   orphans a timer. No new unhandled rejection path in practice (`.then(ok, fail)` at 270, nit n1).
   Exception: a write that never settles, finding m3.
4. In-flight write completing after `clearAfterUpload`. The completion is ignored (identity check 277, 299),
   but the bytes already handed to storage land and restore the pre-upload WAM (or recreate a deleted one:
   UploadController 764 then `deleteFiles` 767). Trunk is the same: its interval callback captured
   `loadedMaps.get(key)` and awaited the write the same way. Not a regression; acknowledged in
   `pr-descriptions/P5.md` 54-56. See M2 for the test that claims to cover it.
5. `evictIfIdle` holding a failing map. Yes, up to the horizon after the oldest unsaved edit, and re-armed by
   any later edit. Memory bound: one `WamFile` per map with unsaved edits in the last hour. Trunk evicted it
   at queue expiry and lost the edit. Cost during an outage: one full-WAM `JSON.stringify` and one write
   attempt per dirty map every 15 s, and one `console.error` per attempt. Finding m4.
6. `markUnsaved` in `finally` when `execute()` throws. Harmless: at most one write of the current in-memory
   WAM. Trunk set the timestamp and started the interval before `execute()`, so it persisted the same state
   (including a partial mutation, or a WAM that fails the `WAMFileFormat.parse` check at 104) with more writes.
7. Healthy-path write count. Head is at or below trunk on both measured schedules: 1 vs 2 writes for one edit,
   5 vs 6 for 13 edits over 60 s (trunk values from the failing assertions above, head values from the passing
   `writesStarted` assertions). Within the 5% budget (fewer writes). Measured on the fake storage only, not on
   disk or S3.
8. Tests fail on trunk in the relevant assertion: yes for 7 of 11 (run 1). Pass on head (run 2).

## Findings

| ID | Severity | File:line | Claim | Evidence |
|---|---|---|---|---|
| M1 | minor | `docs/audits/performance-1000-users/execution/pr-descriptions/P5.md:31` | "At most one write per map" is overstated. After `clearAfterUpload` drops a `saving` state, a reload plus an edit creates a new state whose write starts 15 s later while the old write may still be in flight. | `MapsManager.ts:164-168` deletes the saving state without waiting; `markUnsaved` (233-234) then schedules a fresh write. Line 48 of the same description says "of one loaded map", which is the accurate scope. Trunk overlapped more. Fix: reword line 31 to "per loaded map instance". |
| M2 | minor | `map-storage/src/tests/MapsManagerAutosave.test.ts:284` | "should not write the abandoned state after the map was replaced by an upload" passes on trunk and settles the held write with `fail` (290). The case its name describes, a held write that succeeds after the replacement, overwrites `"replacement upload"` on both trunk and head and is untested. | Run 1: this test passes on trunk. Code path: `ControllableStorage.succeed` sets `files` (63) regardless of `clearAfterUpload`. Fix: rename to the retry scope, or add a test that documents the residual overwrite as known behaviour. |
| m1 | minor | `map-storage/src/MapStorageServer.ts:404` | Commands run through `entitiesManager.executeCommand` never call `markUnsaved`, yet `DeleteCustomEntityMapStorageCommand` mutates the in-memory WAM (comment at 394-396) and `addCommandToQueue` mutates `lastCommandId` (`MapsManager.ts:179`). Pre-existing on trunk; head narrows the incidental window in which such a mutation rode along with a running save (trunk interval ran about 20-35 s after the last marked edit; head is clean right after its write). | `rg executeCommand map-storage/src/MapStorageServer.ts`: lines 373, 387, 404, 440 use `entitiesManager`. Follow-up: mark unsaved in `addCommandToQueue`, or route WAM-mutating entity commands through `mapsManager.executeCommand`. |
| m2 | minor | `map-storage/src/MapsManager.ts:305` | The horizon is measured from the oldest unsaved edit, not the last one. A map edited continuously through an outage is abandoned at 1 h even though its last edit is seconds old; the next edit re-arms it, and if none comes before queue expiry (30 s) the map is evicted with its edits lost. | `onSaveFailed` uses `saving.unsavedSince` (304); `markUnsaved` keeps it while dirty/retrying (238). Documented as a maintainer decision in `README.md` "What remains". |
| m3 | minor | `map-storage/src/MapsManager.ts:270` | A write that never settles leaves the map in `saving` forever: no retry, no horizon, never evicted, later edits only set `editedDuringWriteAt`. Trunk started a new write every 15 s regardless. | Horizon is checked only in `onSaveFailed`. Mitigated on S3: `S3_REQUEST_TIMEOUT` defaults to 60000 ms (`Enum/EnvironmentVariableValidator.ts:47-49`). Not mitigated for `DiskFileSystem` or time spent queued in `s3UploadConcurrencyLimit` (`Upload/S3FileSystem.ts:394`). |
| m4 | minor | `map-storage/src/MapsManager.ts:316` | During an outage every dirty map logs one `console.error` with the error per 15 s attempt (about 240 per map per hour) and stringifies the whole WAM per attempt. Sentry is bounded (first failure and abandonment only, 322-327, 310-313). | Constant 15 s retry at 328, no backoff. The description lists the constant retry as a proposal (`P5.md:83`). |
| n1 | nit | `map-storage/src/MapsManager.ts:270` | `.then(onOk, onFail)` has no terminal `.catch`; a throw inside a handler would be an unhandled rejection. Trunk had a terminal `.catch`. Handlers only call `console`, `Sentry`, `setTimeout` and `evictIfIdle` (which catches), so no throw path was found. | Read of 276-329. |

## Not verified

- Real disk or S3 write latency, completion ordering and write bytes: only the fake `FileSystemInterface`.
- Live lanes 1 to 10 of the plan, restart durability, the full `map-storage` suite and lint (head lint and
  prettier receipts are the author's, `receipts/head-verification.log`, not re-run here).
- No leaked-timer assertion (`vi.getTimerCount()`) exists in the tests; timer release was checked by reading
  the code paths in refutation 3.

## Resources

- Started: two ssh sessions to sbh running `docker exec` in the existing `wa-fable-h8` (not created by this
  lane, named in the brief). No container, port or process was created or left running.
- Remote tree restored: `map-storage/src/MapsManager.ts` sha1 `d6026e47257c44f42e9e1113b5486db2c56e99b2`
  (equals `git show HEAD:`), `map-storage/src/tests/MapsManagerAutosave.test.ts` deleted. The tree is not a
  git checkout (`git status`: not a git repository), so restore was checked by checksum only.
- Local scratch: `/tmp/p5review/run.log` and `/tmp/p5review/mutant.log` (logs), the mutant copy was deleted.
