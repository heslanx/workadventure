# P5 round 3: autosave writes that land over a delete, an upload or their retry

Goal: WorkAdventure must scale toward 1,000 users and every review finding gets fixed. This round fixes
two review findings on map-storage autosave, both caused by a storage write that cannot be cancelled:

- `verdicts/de8e4ad49.md` finding 2: a write in flight recreates a deleted map or overwrites an uploaded one.
- `verdicts/623cc91f8.md` finding 1: a write past `SAVE_WRITE_TIMEOUT_MS` lands after its retry and puts the
  older edit back in storage.

## Patches

Stacked, base = checkout HEAD `e19bbf7dc` (map-storage is unchanged since `623cc91f8` except the reworded
test comment of `ac8522d7e`).

| Order | File | sha256 | Content |
|---|---|---|---|
| 1 | `pin-autosave-overwrite.test.patch` | `f40c1b3a06a220bd1d4146b3fe255179c49c1d55ac165d7fb6fcd62f4c2338f1` | Test only. Three tests that pin the wrong outcome on HEAD, marked `(known defect)`, and a `deleteFiles` in the fake storage. |
| 2 | `fix-autosave-overwrite.patch` | `febf9edeef6633ba3879569e917de17ac17abce70d9a3abcf985599fe8614cef` | `MapsManager.ts`, `Upload/UploadController.ts`, the three tests flipped, two more tests. |

`git -C <checkout> apply --check pin-autosave-overwrite.test.patch`: exit 0. Patch 2 cannot be checked
against the working tree alone because it builds on patch 1, so it was checked against a temporary index
holding HEAD plus patch 1 (`GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` in `/tmp`, the checkout's objects as an
alternate, nothing written to the checkout): exit 0. The resulting file hashes equal the files tested on sbh.
Receipt: `receipts/apply-check.log`.

## Root cause

`MapsManager` hands a write to storage and can later stop tracking it while it still runs:
`clearAfterUpload` deletes the save state, and the 5 minute write timeout replaces the "saving" state with
"retrying". The write cannot be cancelled and can still land. Nothing orders the next storage mutation of
that key after it.

| Sequence on HEAD | What storage ends with | Pinned test (patch 1) |
|---|---|---|
| Edit, write W held. `UploadController.deleteFile` runs `clearAfterUpload`, then `deleteFiles`. W lands. | The deleted map, recreated with its pre-delete content (`cmd-1`). | "recreates the deleted map when the write in flight lands after the delete (known defect)" |
| Edit, write W held. PUT, PATCH or zip upload writes the new file, then `uploadDetector.refresh` makes the back servers call `handleClearAfterUpload`. W lands. | The pre-upload map (`cmd-1`) over the upload. | "overwrites the uploaded map when the write in flight lands after the upload (known defect)" |
| Edit `cmd-1`, write W1 held past 5 min and counted failed. Edit `cmd-2`, the retry stores `cmd-2`, the map is evicted when its command history expires. W1 lands. | `cmd-1`, and nothing saves `cmd-2` again. | "restores the older edit when a write past its timeout lands after its retry (known defect)" |

The tests drive the public `MapsManager` calls in the order `UploadController` and `MapStorageServer` make
them, against an in-memory `FileSystemInterface` whose writes can be held and released, with fake timers.

## Design

Data shape: `writesInFlight: Map<mapKey, Set<Promise<void>>>`, every write handed to storage until it settles.
It is kept apart from `mapSaveStates` because a write outlives its state (after a timeout or a clear).

1. **Delete and replace wait for the writes in flight.** New `replaceStoredMap(key, replace)`: drops the
   in-memory map (`clearAfterUpload`), waits until every write of that key in `writesInFlight` settled, then
   runs `replace`. The caller passes the storage mutation itself, so the order is enforced by the method and
   not by each caller remembering to await. The wait is bounded by `SAVE_WRITE_TIMEOUT_MS` (5 min) from its
   start; past it, `replace` runs anyway and the case is logged and sent to Sentry
   (`location: "replaceStoredMap"`). `UploadController` uses it for DELETE of a `.wam`, PUT of a `.wam`, PATCH
   of a `.wam`, and each `.wam` entry of a zip upload. The gRPC `handleClearAfterUpload` keeps calling
   `clearAfterUpload`: it runs after the upload landed and still drops a copy reloaded during the upload.
2. **A timed-out write that lands late triggers a new save.** The map stays loaded while any write of it is in
   flight (`evictIfIdle` checks `writesInFlight`). When a write whose state is gone succeeds and its `WamFile`
   instance is still the loaded one, the write timed out, not a clear, so the map is marked unsaved and the
   newest WAM is written again on the next autosave. When such a write fails, or the map was cleared,
   `evictIfIdle` runs again, because the map may have stayed loaded only for that write.

Rejected alternatives:

- **A per-key generation checked by the storage write itself** (conditional write: S3 `If-Match`, a
  compare-and-swap on disk). It is the only option that also protects writes from another map-storage
  instance. It changes `FileSystemInterface` and both implementations, S3-compatible providers differ in
  conditional `PutObject` support, and `DiskFileSystem` has no atomic compare-and-swap without file locks.
  Rejected as larger and backend-dependent. It is the follow-up if several map-storage instances must be
  covered.
- **Serialize writes per key, so a retry waits for the previous write (bounded).** Waiting without a bound
  brings back `de8e4ad49` finding 1 (a write that never settles blocks every later save). With a bound, the
  overlap and the stale landing return for any write that hangs past it. The rewrite in rule 2 converges
  whatever the delay is, as long as the process runs.
- **Make `clearAfterUpload` async and have callers await it before touching storage.** The order would rest on
  each caller, and the upload path calls it through gRPC after the upload already wrote, where awaiting orders
  nothing. `replaceStoredMap` runs the mutation itself instead.
- **Wait only for the write of the current "saving" state.** It misses a write that timed out. Mutant
  `current-state-only` below fails exactly the timed-out delete test.

## Behavior changes

- DELETE, PUT and PATCH of a `.wam`, and zip uploads, wait for the autosave writes of that map still in
  flight: usually the duration of one write, at most 5 minutes when storage hangs.
- A map with a write in flight is not evicted until that write settles. The existing test "should count a
  write that never settles as failed and retry it" lost its `not.toContain(mapKey)` assertion: a write that
  never settles now keeps its map loaded (one `WamFile`, next to the payload the hung write already holds).
  The flipped retry test asserts the map is released once the late write landed and the map was saved again.
- A timed-out write that lands late costs one extra write of the map.
- `clearAfterUpload` logs twice for an upload served by this instance (once in `replaceStoredMap`, once from
  gRPC).

## What remains unprotected

1. A write still unsettled when the 5 minute wait of a delete or upload ends. If it lands later, it restores the
   old map. This is reported (console and Sentry), not prevented.
2. Writes made by another map-storage instance. The protection is in-process: an upload served by instance A
   does not wait for a write of instance B. Closing it needs the conditional write rejected above.
3. Retry case: between the late landing and the rewrite (one autosave interval, 15 s, longer if storage keeps
   failing) storage holds the older WAM; a process stop in that window keeps it. A timed-out write that never
   settles keeps its map in memory.
4. An edit that reloads the map during the wait, before the delete or the replacement runs, starts its own
   write 15 s later. For a delete it can recreate the file; this window existed before (between
   `clearAfterUpload` and `deleteFiles`) and now lasts as long as the wait. For an upload, the gRPC clear that
   follows the upload drops that copy.
5. Same family, outside these findings, unchanged: the zip upload's `deleteFilesExceptWAM` deletes `.wam`
   files that are not in the zip without clearing them from memory, and `POST /move` of a `.wam` does not
   clear the source key. A loaded, dirty map at those keys is saved back.
6. The `UploadController` wiring has no test: map-storage has no HTTP harness for it. It is covered by
   typecheck, eslint and review only; the `MapsManager` contract it calls is tested.

## Checks

sbh, `node:24-trixie`, `--cpus 1 --cpu-shares 512 --memory 3g --network none`, tree
`~/wa-jobs/wa-fable-20261112/src-p5`, cwd `map-storage`. File hashes are printed at the top of each run.
Receipt: `receipts/final-run.log`.

| # | State | Container | Command | Exit | Result |
|---|---|---|---|---|---|
| 1 | patch 1 on HEAD | `wa-fable-ovw-10` | `npx vitest run src/tests/MapsManagerAutosave.test.ts src/tests/MapStorageServer.test.ts` | 0 | 32 passed (19 + 13), the three `(known defect)` tests among them |
| 2 | patch 1 on HEAD | same | `npx vitest run` (whole map-storage suite) | 0 | 11 files, 88 passed |
| 3 | patch 1 on HEAD | same | `npm run typecheck` | 0 | clean |
| 4 | patch 1 on HEAD | same | `npx eslint` on the test file | 0 | no output |
| 5 | patch 1 on HEAD | same | `npx prettier --check` on the test file | 0 | formatted |
| 6 | patches 1+2 | `wa-fable-ovw-11` | targeted vitest as in 1 | 0 | 34 passed (21 + 13) |
| 7 | patches 1+2 | same | `npx vitest run` | 0 | 11 files, 90 passed |
| 8 | patches 1+2 | same | `npm run typecheck` | 0 | clean |
| 9 | patches 1+2 | same | `npx eslint` on `MapsManager.ts`, `Upload/UploadController.ts`, the test file | 0 | no output |
| 10 | patches 1+2 | same | `npx prettier --check` on the same three files | 0 | formatted |

Hashes. HEAD `MapsManager.ts` `84ddd0b7…`, `UploadController.ts` `c5bbc727…`. Patch 1 test `06635f0e…`. Patches
1+2: `MapsManager.ts` `bc2ad646…`, `UploadController.ts` `a6a514d7…`, test `db81843f…`.

Flipped tests without the fix: the patch 1+2 test file, with `MapsManager.ts` replaced by a read-only mount
(`wa-fable-ovw-12-<variant>`). Every variant fails (exit 1), and each one fails the tests of the rule it removes.

| Variant of `MapsManager.ts` | Failed / passed | Failing tests |
|---|---|---|
| HEAD (`84ddd0b7`) | 5 / 16 | retry test (`expected 'cmd-1' to be 'cmd-2'`), the four replace tests (`replaceStoredMap is not a function`) |
| `no-wait`: `replaceStoredMap` does not wait | 4 / 17 | delete (`expected true to be false`), upload (stored WAM is the autosaved one, not the upload), timed-out delete, never-settles report |
| `current-state-only`: waits only for the write of the current "saving" state | 1 / 20 | timed-out delete |
| `no-resave`: a late timed-out write does not mark the map unsaved | 1 / 20 | retry test (`expected 'cmd-1' to be 'cmd-2'`) |
| `evict-with-writes-in-flight`: eviction ignores `writesInFlight` | 1 / 20 | retry test (`expected 'cmd-1' to be 'cmd-2'`) |

An earlier revision of the retry test released the timed-out write before the command history expired, so
the map was still loaded for another reason and `evict-with-writes-in-flight` survived (21 passed). The test
now releases it after the history expired, which kills that mutant. Superseded receipts were not kept.

Resources: containers `wa-fable-ovw-1..12-*`, all `--rm`; left: 0 (`docker ps -a` filtered on the owner label
lists no `ovw` container). The sbh tree's three map-storage files were restored to the checkout HEAD versions
(sha256 above, test `0b1bb530…` = HEAD `e19bbf7dc`), `._*` files under `map-storage`: 0. Remote dirs
`ovw-stage` and `ovw-mutants` removed. Scratch repo: `/tmp/wa-bug-overwrite/repo2` (base `5931c7e` = HEAD
files, `d5cafbf` patch 1, `22c2503` patch 2).

## Process

- Bug-fix playbook steps: reproduced (pinned tests on HEAD), root cause confirmed by the pinned runs, fix
  verified on the same surface, pin before fix in the stack. Skipped: the `how`/`why`/`architect` multi-model
  fan-out (hard stop 03:30 UTC); the four designs above were compared in-thread instead.
- BLOCKED: independent review. The change enforces a data-integrity invariant, so an independent correctness
  reviewer is required before merge-ready.
- `pr-descriptions/P5.md` "Not guaranteed" still says a write handed to storage can restore a deleted or
  replaced map. If patch 2 lands, replace that bullet with the "What remains unprotected" list above. That file
  was not edited.
