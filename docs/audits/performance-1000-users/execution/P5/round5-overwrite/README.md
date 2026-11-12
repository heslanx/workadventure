# P5 round 5: a rejected delete, upload or move keeps the edits of its maps

Goal: WorkAdventure must scale toward 1,000 users and every review finding gets fixed. In map-storage, an
autosave write already handed to storage must never land over a DELETE, an upload or a move of the same `.wam`,
and no edit may be lost. This round fixes the finding of the round 4 verdict (`verdicts/p5-round4-overwrite.md`,
FAIL) that the coordinator confirmed.

| Finding | Severity | Outcome |
|---|---|---|
| F1. `replaceStoredMaps` drops the maps from memory before it waits. When the wait times out, the request answers 503 and storage is unchanged, but the edits that no write carried yet are gone. | major | Fixed by patches 5 and 6. |
| F2. `MapStorageServer.handleClearAfterUpload` still calls `clearAfterUpload` directly. | major | Dismissed by the coordinator. The notification arrives after an upload this process did not serve, so no wait in this process can order a write already handed to storage before it. It is ledger item MS-04 and stays in "What remains unprotected", item 1. |

## Patches

Stacked in this order on HEAD. Each pin patch is test-only and lands before the fix that flips it. Patches 1 to
4 are the round 4 patches, byte for byte.

| Order | File | sha256 | Content |
|---|---|---|---|
| 1 | `1-pin-autosave-overwrite.test.patch` | `f40c1b3a06a220bd1d4146b3fe255179c49c1d55ac165d7fb6fcd62f4c2338f1` | Round 4 patch 1. Three `(known defect)` tests in `MapsManagerAutosave.test.ts`. |
| 2 | `2-fix-autosave-overwrite.patch` | `881603cd8855984364f6cb80ec90ba760ee92fe621966146be6841086ca30b35` | Round 4 patch 2. `MapsManager.replaceStoredMaps`, fail closed, re-checked wait, load gate, one loaded copy per map. `UploadController` DELETE, PUT, PATCH and zip upload call it and answer 503. |
| 3 | `3-pin-upload-move-clear.test.patch` | `ab6b4862e2b7e3bc9be4aafac11c80b6756be2b2cfc2b8e403f19740000abae5` | Round 4 patch 3. New `tests/UploadController.test.ts` with three wiring tests and two `(known defect)` pins. |
| 4 | `4-fix-upload-move-clear.patch` | `76e476ac3248020c8fa509a861575d867d5fc7be9e6438c6e40898d6a9b55bf3` | Round 4 patch 4. The zip upload also holds the `.wam` keys it deletes, and `POST /move` of a `.wam` holds both keys. |
| 5 | `5-pin-rejected-replacement-edit.test.patch` | `8b12d45341a837dc0f9b20c2de9a5eee9e62d23aae9a7dca4b3fc307404f501a` | One `(known defect)` test for F1, the verdict's scenario. |
| 6 | `6-fix-rejected-replacement-edit.patch` | `4bff6b0ee61acb69bd7404ea2ea3ec7b8a12bf05e4dc6fad9902b47ea7ef05a2` | `MapsManager.ts`: drop the maps only after the wait succeeded. The F1 pin flipped, one test added, three load-gate tests adjusted. |

The stack applies on the checkout. `git apply --cached` of the six patches in order on a temporary index
(`GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` in `/tmp`, the checkout's objects as an alternate, nothing written to
the checkout) exits 0 for each patch, and the resulting blobs equal the files tested on sbh. Receipt:
`receipts/apply-check.log`.

The checkout HEAD is `1f48d79d5`. The three commits after `32f5571f1` change files under `play` only. Since
`e19bbf7dc`, the commit the sbh tree holds, `map-storage` has not changed, and the only changes under `libs` and
`messages` are `libs/map-editor/src/GameMap/MapValidator.ts` and its test (`3b616d314`). Every run below mounts the
HEAD `MapValidator.ts`, so every state is HEAD plus patches.

## Design

A delete, upload or move never changes the stored file of a map while a write of that map may still land, and a
request that map-storage rejects leaves its maps as they were, in storage and in memory.

`MapsManager.replaceStoredMaps(keys, replace)` now runs in this order:

1. It waits until `writesInFlight` holds no write of any key, at most `REPLACEMENT_WAIT_MS` (60 s).
   `writesSettle` reads `writesInFlight` again after each settled batch. The maps stay loaded and editable
   during the wait, so an edit made meanwhile can start a write, and the re-check waits for that write too.
2. If a write is still in flight at the deadline, it logs, reports to Sentry (`location: "replaceStoredMaps"`)
   and returns `"writesInFlight"`. It drops nothing. The edits stay in memory and the next autosave stores them
   (F1).
3. Otherwise it counts the replacement in `replacementsStarted`, registers it in `replacementsInProgress` for
   every key, and drops every key from memory (`clearAfterUpload`). No write of these keys starts between the
   last check of `writesSettle` and the drop. A write starts only from a timer (`scheduleSave`), and no timer
   callback runs inside that chain of promise continuations.
4. It runs `replace`. Until `replace` ends, `loadWAMToMemory` of a key waits for it. A load whose read was in
   flight when the maps were dropped reads again, and when several loads waited, the first to finish installs
   its copy and the others return it. Steps 3 and 4 are the round 4 load gate, now limited to the window
   between the drop and the end of `replace`.

Every `UploadController` caller still answers `"writesInFlight"` with HTTP 503 and `Retry-After: 60`.
`UploadController.ts` does not change in this round.

The coordinator's design held. No test showed a reason to deviate. One implementation choice differs from a
first draft. The draft replaced the recursion of `writesSettle` with a loop in `replaceStoredMaps`, so that the
last check and the drop sat in one synchronous block. ESLint rejects it (`no-await-in-loop`), so the recursion
stayed, and step 3 states the reason no write starts in between.

Patch 6 changes three tests of patch 2 that assumed the drop happens when the request arrives:

- "should load the map only once its replacement finished" and "should give every load that waited for the
  replacement the same map" held an autosave write so that the load gate covered the wait. The map is now loaded
  during the wait, and a load returns it at once. Both tests now start a replacement with no write in flight,
  hold its own write of the file, and let the drop happen (`advanceTimersByTimeAsync(0)`) before the loads
  start, so the loads meet the closed gate.
- "should not keep a map whose read was in flight when its replacement started" started a read that the
  in-memory storage answers at once. The drop now happens a few promise continuations after the call, even with
  no write in flight, so that read finished first and returned the old map, which the drop then removed from
  memory. The old copy did not stay loaded, but the test asserts on the copy the load returns. The test now holds
  the read with a spy until the upload finished, then returns the file as it was before the upload. It still
  fails without the read-again check (mutant `no-reread`).

Rejected alternative: **drop before the wait and put the map back on timeout.** An edit during the wait would
still wait in its load for up to 60 s, past the 10 s edition lock timeout, and a map put back from the dropped
copy would miss the commands queued for it meanwhile.

## Behavior changes

Compared with round 4:

- A request rejected with 503 leaves its maps loaded. The edits made before and during the wait stay in memory,
  and the next autosave stores them.
- During the wait, at most 60 s, the maps stay editable and their loads do not wait. Edits accepted during the
  wait of a request that then succeeds are dropped with the map, as the edits accepted just before the request
  are.
- A load waits only while `replace` runs.

Unchanged from round 4:

- DELETE, PUT and PATCH of a `.wam`, a zip upload and a move of a `.wam` wait for the autosave writes of the maps
  they touch, usually one write.
- `POST /move` of a `.wam` drops the source map from memory once the wait succeeded. Edits that no completed
  write carried (normally the last 15 s) are not in the moved file.
- Any replacement makes the loads in flight when it drops its maps read their file again, one extra read each. A
  load that finishes after another load of the same map returns the copy already loaded.
- A map with a write in flight is not evicted, and a timed-out write that lands late triggers a new save.

## Checks

sbh, `node:24-trixie`, `--rm --cpus 1 --cpu-shares 512 --memory 3g --network none --label owner=wa-fable-20261112`,
tree `~/wa-jobs/wa-fable-20261112/src-p5` mounted read-only, cwd `map-storage`. Each container mounts the files of
its state read-only over the tree: `MapsManager.ts`, `UploadController.ts`, the `src/tests` directory, and the HEAD
`MapValidator.ts`. Vite writes its config bundle and cache to tmpfs. Each log starts with the sha256 of the mounted
files. Scripts: `receipts/export_states.py`, `receipts/mutants.py`, `receipts/run.sh`, `receipts/final.sh`.
Receipts: `receipts/runs/<state>.log`.

A state named `x-on-y` runs the sources of `y` (`MapsManager.ts`, `UploadController.ts`) with the tests of `x`.
Letters a to f name patches 1 to 6.

Each test run is `npx vitest run --reporter=verbose` on `MapsManagerAutosave.test.ts`, plus
`UploadController.test.ts` when the state has it.

| # | State | Container | Command | Exit | Result |
|---|---|---|---|---|---|
| 1 | `e1-a-on-head`: HEAD sources, patch 1 tests | `wa-fable-ovw5-45` | tests | 0 | 19 passed, the three `(known defect)` pins among them |
| 2 | `e2-a-pin-on-b`: patch 2 sources, patch 1 tests | `wa-fable-ovw5-46` | tests | 1 | 2 failed of 19: the retry pin, and "should count a write that never settles as failed and retry it", whose eviction assertion patch 2 removes |
| 3 | `e3-b-tests-on-a`: HEAD sources, patch 2 tests | `wa-fable-ovw5-47` | tests | 1 | 9 failed of 25 |
| 4 | `e4-b`: patch 2 | `wa-fable-ovw5-73` | tests | 0 | 25 passed |
| 5 | `e5-c-on-b`: patch 2 sources, patch 3 tests | `wa-fable-ovw5-74` | tests | 0 | 30 passed, the two `(known defect)` pins among them |
| 6 | `e6-c-pin-on-d`: patch 4 sources, patch 3 tests | `wa-fable-ovw5-75` | tests | 1 | 2 failed of 30: exactly the two pins |
| 7 | `e7-d-tests-on-c`: patch 3 sources, patch 4 tests | `wa-fable-ovw5-76` | tests | 1 | 3 failed of 31: the two flipped pins and "should answer 503 and write nothing when a map the zip deletes has a write in flight" |
| 8 | `e8-d`: patch 4, the round 4 stack | `wa-fable-ovw5-77` | tests | 0 | 31 passed |
| 9 | `e9-e-on-d`: patch 4 sources, patch 5 tests | `wa-fable-ovw5-32` | tests | 0 | 32 passed, the F1 pin among them |
| 10 | `e10-e-pin-on-f`: patch 6 sources, patch 5 tests | `wa-fable-ovw5-33` | tests | 1 | 4 failed of 32: the F1 pin (`expected 'cmd-2' to be 'cmd-1'`) and the three load-gate tests that patch 6 adjusts |
| 11 | `e11-f-tests-on-e`: patch 5 sources, patch 6 tests | `wa-fable-ovw5-62` | tests | 1 | 2 failed of 33: the flipped F1 test (`expected undefined to be 'cmd-2'`) and "should keep the deleted map deleted when an edit made while the delete waits starts its own write" (timed out) |
| 12 | `e12-f`: patch 6, the final stack | `wa-fable-ovw5-60` | tests | 0 | 33 passed |
| 13 | final stack | `wa-fable-ovw5-61` | `npx vitest run` (whole map-storage suite) | 0 | 12 files, 102 passed |
| 14 | final stack | same | `npm run typecheck` | 0 | clean |
| 15 | final stack | same | `npx eslint` on the four files | 0 | no output |
| 16 | final stack | same | `npx prettier --check` on the four files | 0 | formatted |

Checks 1 to 8 repeat round 4 checks 1 to 8 with the HEAD `MapValidator.ts`, and give the same counts.

Final file sha256 (state `e12-f`):

| File | sha256 |
|---|---|
| `src/MapsManager.ts` | `408a8aad1e63c9c854636999222587879c7eff8666cb738ac735d4e2a331e158` |
| `src/Upload/UploadController.ts` | `9c01a30939e02a8e3ef37a25fb837387dddcde3279014afa33ae5192cad48663` |
| `src/tests/MapsManagerAutosave.test.ts` | `963495d0fbed43261bc97698c7b30fa0d978afb5470f136ea4dded7949b1b244` |
| `src/tests/UploadController.test.ts` | `70c2483d8e919b96ed4b4b0bea4111194ffefd80a102958ef15be61aa38ccd17` |
| `libs/map-editor/src/GameMap/MapValidator.ts` (HEAD, mounted) | `3a52822d686b31ebff133beb15c384c7206cd1be9d8dbc5bf0e0ef92cd567a0c` |

Check 10 fails three tests besides the F1 pin. They are the load-gate tests in their patch 2 form, which assume
the drop happens when the request arrives (see Design). In check 11, the new test times out on the round 4
sources. Its edit made during the wait waits in its load, because round 4 closes the load gate for the whole wait.

## Mutants

Each mutant is the final state with one change, run against the final tests (`MapsManagerAutosave.test.ts` and
`UploadController.test.ts`, 33 tests). `receipts/mutants.py` writes each mutant from the final sources. Receipts:
`receipts/runs/m-<mutant>.log`.

| Mutant | Change | Failed / passed | Failing tests |
|---|---|---|---|
| `proceed-on-timeout` | After the wait times out, drop the maps and run `replace` anyway (round 3 behavior). | 5 / 28 | the flipped F1 test, "should reject the delete and leave storage unchanged when the write in flight settles after the wait", DELETE 503, both zip 503 tests |
| `clear-before-wait` | Drop the maps before the wait. The mutant file is round 4's `MapsManager.ts`. | 2 / 31 | the flipped F1 test (`expected undefined to be 'cmd-2'`), "should keep the deleted map deleted when an edit made while the delete waits starts its own write" (timed out) |
| `no-recheck` | `writesSettle` trusts its first snapshot. | 1 / 32 | "should keep the deleted map deleted when an edit made while the delete waits starts its own write" |
| `no-load-gate` | `loadWAMToMemory` does not wait for a replacement in progress. | 1 / 32 | "should load the map only once its replacement finished" |
| `no-recheck+no-load-gate` | Both. | 2 / 31 | the two tests above |
| `no-reread` | `loadWAMToMemory` keeps a read that a replacement overlapped. | 1 / 32 | "should not keep a map whose read was in flight when its replacement started" |
| `no-dedupe` | `loadWAMToMemory` installs its copy even when another load installed one first. | 1 / 32 | "should give every load that waited for the replacement the same map" |
| `zip-partial` | Round 3 zip: `deleteFilesExceptWAM` outside, one `replaceStoredMaps` per `.wam` entry. | 3 / 30 | both zip 503 tests, "should keep a map the zip deleted deleted when it had an unsaved edit" |
| `zip-deleted-not-gated` | The zip holds its own `.wam` entries only, not the ones it deletes. | 2 / 31 | "should answer 503 and write nothing when a map the zip deletes has a write in flight", "should keep a map the zip deleted deleted when it had an unsaved edit" |
| `move-no-clear` | `POST /move` calls `fileSystem.move` without `replaceStoredMaps`. | 1 / 32 | "should not recreate the moved map at its old path when it had an unsaved edit" |

Every mutant fails at least one test. `no-recheck` survived in round 4, because the map left memory before the
wait and no write could start during it. The map now stays loaded during the wait, so an edit can start a write
that the first snapshot misses. The new test makes the write of `cmd-1` time out (5 min) while it stays held,
starts the delete, edits `cmd-2`, and lets the retry, which carries `cmd-2`, start during the wait. Without the
re-check, the delete runs when `cmd-1` settles, and the retry then lands and recreates the deleted map.

## What remains unprotected

1. Writes that this process cannot wait for. A write from another map-storage instance is not in this process's
   `writesInFlight`. `MapStorageServer.handleClearAfterUpload` (`MapStorageServer.ts`) calls `clearAfterUpload`
   directly when the back servers relay an upload that this process did not serve, so a write that this process
   already handed to storage can land after that upload and restore the old map. Closing both needs conditional
   writes (ledger item MS-04): S3 `If-Match` and a compare-and-swap on disk, which change `FileSystemInterface`
   and both backends.
2. A write that never settles. Its map stays loaded, and every delete, upload or move of that map answers 503
   until the write settles or the process restarts. The S3 client's `requestTimeout` and retries make an S3 write
   settle in practice. A `DiskFileSystem` write has no timeout.
3. An edit that arrives while `replace` runs waits in its load. Past the 10 s edition lock timeout, the caller
   gets a lock timeout and the next edit of that map can start while the first still waits (documented
   `LockByKey` behavior). When `replace` ends, the waiting edit runs on the new map, or fails if the map was
   deleted. `replace` is one file operation for DELETE, PUT, PATCH and move, and every write of the zip for a zip
   upload.
4. `POST /move` of a directory that holds `.wam` files, and `POST /copy` to a `.wam` path, do not hold any key. A
   loaded dirty map under a moved directory is saved back at its old path.
5. A `.wam` created between `wamKeysDeletedByUpload` and `deleteFilesExceptWAM` (by another instance, or a PUT
   outside the per-directory upload limiter) is deleted without being held.
6. `createWAMFileIfMissing` writes a `.wam` for a `.tmj` without one, outside `replaceStoredMaps`. It writes only
   when no file exists, so only a map loaded from a file that no longer exists is exposed.
7. The retry case from round 3. Between the late landing of a timed-out write and the rewrite (one autosave
   interval, 15 s, longer while storage keeps failing), storage holds the older WAM. A process stop in that window
   keeps it.

## Replacement text for `pr-descriptions/P5.md`

Replace the "Not guaranteed" bullet that starts "Cancelling a write already handed to storage" with:

```markdown
- Cancelling a write already handed to storage. A delete, an upload or a move of a map waits for the
  writes of that map, at most 60 s, and the map stays loaded and editable while it waits. If a write is
  still in flight at 60 s, the request answers 503 with `Retry-After: 60`, storage is unchanged, and the
  map keeps its edits for the next autosave. Writes from another map-storage instance are not waited for,
  and neither are the writes in flight when the back servers relay `handleClearAfterUpload` for an upload
  another instance served. A write that never settles keeps its map loaded and makes every delete, upload
  or move of it answer 503 until it settles or the process restarts. Moving a directory of maps, and
  copying onto a `.wam`, do not wait. A timed-out write that lands after its retry leaves the older state
  in storage for one autosave interval, until the map is saved again.
```

Replace the line "The WAM format, the upload, delete and lock call sites, and `FileSystemInterface` are unchanged."
with:

```markdown
The WAM format and `FileSystemInterface` are unchanged. The DELETE, PUT, PATCH, zip upload and move
endpoints of `UploadController` now replace stored `.wam` files through `MapsManager.replaceStoredMaps`.
```

The second replacement is the round 4 text, unchanged.

## Process

- Bug-fix playbook. The F1 pin (patch 5) passes on the round 4 stack, and the flipped test fails there. The fix
  is verified on the same surface, and the pin lands before the fix. The `how`, `why` and `architect`
  multi-model fan-out was skipped for the 04:30 UTC hard stop. The coordinator had fixed the design beforehand.
- BLOCKED: independent review. The change enforces a data-integrity invariant, so an independent correctness
  reviewer is required before merge-ready.
- Two earlier batches are superseded, and their receipts were not kept. In the first, ESLint failed the loop
  draft (`no-await-in-loop`). In the second, mutant `no-reread` also failed "should load the map only once its
  replacement finished". That showed the test's load started before the drop and reached the gate through the
  read-again path. Both load-gate tests now let the drop happen first. The `no-recheck+no-load-gate` container did
  not start in that batch, because Docker rejects `+` in a container name. `run.sh` now writes it as `_`. Checks
  1 to 3, 9 and 10 below come from the second batch. Their states did not change after it.

## Resources

- Containers `wa-fable-ovw5-1`, `-2`, `-10` to `-21`, `-30` to `-48` and `-60` to `-77`, all `--rm`. Two were
  stopped by exact name when their batch was superseded (`-21-m-no-dedupe`, `-48-e4-b`). Left: 0.
  `docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-ovw5` lists none.
- The sbh tree was never written. Every run mounted it read-only, mounted the state files and the `src/tests`
  directory read-only over it, and gave Vite tmpfs for `node_modules/.vite` and `node_modules/.vite-temp`. No
  empty mount point was created, because the runs mount the test directory instead of a missing file. After the
  round, the three map-storage files equal HEAD (`MapsManager.ts` `84ddd0b7…`, `UploadController.ts` `c5bbc727…`,
  `MapsManagerAutosave.test.ts` `0b1bb530…`), `src/tests` holds its two HEAD files, no file outside the Vite
  directories is newer than the round's upload, and `._*` files under `map-storage`: 0. The tree still holds the
  `e19bbf7dc` `MapValidator.ts` (`721b8a47…`). Remote dir `ovw5` removed.
- Mac scratch `/tmp/wa-p5r5/` deleted. The scratch commit ids in `receipts/export_states.py` only name states.
  The patches rebuild them.
