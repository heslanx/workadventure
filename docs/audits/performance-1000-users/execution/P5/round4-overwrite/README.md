# P5 round 4: an autosave write must not land over a delete, an upload or a move

Goal: WorkAdventure must scale toward 1,000 users and every review finding gets fixed. This round fixes the
map-storage data loss that the round 3 verdict (`verdicts/p5-round3-overwrite.md`, FAIL) still found. An autosave
write already handed to storage lands after a DELETE or an upload of the same `.wam` and restores the old map.
It also closes round 3 gaps 5 and 6.

| Finding | Severity | Fixed by |
|---|---|---|
| F1. `replaceStoredMap` runs `replace()` when its wait times out, and the unsettled write can land later. | major | patch 2 |
| F2. `replaceStoredMap` waits on one snapshot of `writesInFlight`. A request that reloads and edits the map during the wait starts a write the snapshot misses. | major | patch 2 |
| F3. No test covers a write settling after the timeout, or a write starting after the wait began. | minor | patch 2 |
| Round 3 gap 5 (MS-02). A zip upload deletes `.wam` files that are not in the zip without dropping their loaded maps, so a dirty one is saved back. | data loss | patches 3 and 4 |
| Round 3 gap 5 (MS-03). `POST /move` of a `.wam` keeps the source map loaded, so a dirty one is saved back at the old path. | data loss | patches 3 and 4 |
| Round 3 gap 6. `UploadController` wiring has no test. | test gap | patch 3 |

## Patches

Stacked in this order. Each pin patch is test-only and lands before the fix that flips it.

| Order | File | sha256 | Content |
|---|---|---|---|
| 1 | `1-pin-autosave-overwrite.test.patch` | `f40c1b3a06a220bd1d4146b3fe255179c49c1d55ac165d7fb6fcd62f4c2338f1` | Round 3 patch 1, byte for byte. Three `(known defect)` tests in `MapsManagerAutosave.test.ts`. |
| 2 | `2-fix-autosave-overwrite.patch` | `881603cd8855984364f6cb80ec90ba760ee92fe621966146be6841086ca30b35` | `MapsManager.ts`: `replaceStoredMaps`, fail closed, re-checked wait, load gate, one loaded copy per map. `UploadController.ts`: DELETE, PUT, PATCH and zip upload call it and answer 503. Autosave tests flipped and 5 added. |
| 3 | `3-pin-upload-move-clear.test.patch` | `ab6b4862e2b7e3bc9be4aafac11c80b6756be2b2cfc2b8e403f19740000abae5` | New `tests/UploadController.test.ts`: the HTTP test for `UploadController`. Three wiring tests and two `(known defect)` pins for MS-02 and MS-03. |
| 4 | `4-fix-upload-move-clear.patch` | `76e476ac3248020c8fa509a861575d867d5fc7be9e6438c6e40898d6a9b55bf3` | `UploadController.ts`: the zip upload also holds the `.wam` keys it deletes, `POST /move` of a `.wam` holds both keys. Pins flipped, one test added. |

The stack applies on the checkout. `git apply --cached` of the four patches in order on a temporary index
(`GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` in `/tmp`, the checkout's objects as an alternate, nothing written to
the checkout) exits 0 for each patch. The resulting blobs equal the files tested on sbh. Receipt: `receipts/apply-check.log`.

The checkout HEAD moved from `e19bbf7dc` to `32f5571f1` during this round. `map-storage` is identical in both. Of the
seven new commits, `3b616d314` changes `libs/map-editor/src/GameMap/MapValidator.ts`, which the upload endpoints call.
The others change `back`, `play` and `benchmark/README.md`. The runs below use the sbh tree, which holds the
`e19bbf7dc` versions, and check 13 repeats the final run with the `32f5571f1` `MapValidator.ts` mounted.

## Design

A delete, upload or move never changes the stored file of a map while a write of that map may still land. When
map-storage cannot guarantee that, the request fails and storage stays as it was.

`MapsManager.replaceStoredMaps(keys, replace)` is the only path that changes stored `.wam` files on behalf of
`UploadController`. It returns `"replaced"` or `"writesInFlight"`, and every caller answers the second with HTTP 503
and `Retry-After: 60`. In order, it:

1. Counts the replacement in `replacementsStarted` and registers it in `replacementsInProgress` for every key.
2. Drops every key from memory (`clearAfterUpload`). No new write of these keys can start, because a write needs a
   loaded map and loading waits (step 5, the fix for F2).
3. Waits until `writesInFlight` holds no write of any key. It reads `writesInFlight` again after each settled batch
   instead of awaiting one snapshot (decision 2).
4. Runs `replace` only if the wait ended before `REPLACEMENT_WAIT_MS` (60 s). Otherwise it logs, reports to Sentry
   (`location: "replaceStoredMaps"`) and returns `"writesInFlight"` without calling `replace` (F1).
5. While the replacement runs, `loadWAMToMemory` of a key waits for it. A load whose read was already in flight when
   a replacement started reads again, because the read may have returned the old map (`replacementsStarted`
   changed during the read). When several loads waited for the same replacement, the first to finish installs its
   copy and the others return that copy, so no caller edits a map that is no longer loaded.

Why 60 s and not `SAVE_WRITE_TIMEOUT_MS` (5 min). Any bound keeps storage safe, because the request fails instead of
replacing. The bound only decides what the client sees. Production sits behind Cloudflare (see the
`DIRECT_UPLOAD_URL` comment in `UploadController.ts`), whose documented origin timeout is 100 s. A 5 min wait
returns a proxy 524 while map-storage keeps waiting, and the client cannot tell whether the delete happened. A 60 s
wait answers 503 first, which says storage was not changed. A healthy autosave write is one `PutObject`, subject to
`S3_REQUEST_TIMEOUT` (60 s by default). The 100 s figure is Cloudflare's published default, not measured here.

Callers in `UploadController`:

| Endpoint | Keys held | What `replace` does |
|---|---|---|
| `DELETE` of a `.wam` | the map | deletes the area resources (`resourceUrl`), then the file. The resource deletion moved inside, so a rejected delete leaves them. |
| `PUT` of a `.wam` | the map | writes the file |
| `PATCH` of a `.wam` | the map | writes the patched file |
| `POST /upload` (zip) | every `.wam` entry of the zip, and every `.wam` that `deleteFilesExceptWAM` deletes (patch 4) | `deleteFilesExceptWAM`, then every write of the zip. One call for the whole zip, so a rejection writes nothing. |
| `POST /move` of a `.wam` (patch 4) | source and destination | `fileSystem.move` |

`wamKeysDeletedByUpload` lists the `.wam` files under the directory with `listFiles` and applies the selection that
`DiskFileSystem` and `S3FileSystem` use in `deleteFilesExceptWAM`. They keep a `.wam` only when the zip has its
`.tmj` and not the `.wam` itself. Entries that `listFiles` returns outside the directory (S3 prefix matches such as
`dir2/` for `dir`) are skipped.

Rejected alternatives:

- **Proceed after the wait, as round 3 did.** It is F1.
- **Fail the load during a replacement instead of waiting.** An edit would fail at once instead of waiting up to
  60 s. The coordinator's decision 2 asks for the wait, and an upload usually takes less than the 10 s edition lock
  timeout.
- **Re-clear memory after the wait instead of a load gate.** It still lets a load that read the old file before the
  replacement install it after `replace` ran. The read-again check in step 5 covers that case.
- **Conditional writes (S3 `If-Match`, a compare-and-swap on disk).** The only option that also protects writes from
  another map-storage instance. Rejected again, as in round 3, because it changes `FileSystemInterface` and both
  backends.

## Behavior changes

- DELETE, PUT and PATCH of a `.wam`, a zip upload and a move of a `.wam` wait for the autosave writes of the maps they
  touch, usually one write. After 60 s they answer 503 with `Retry-After: 60` and change nothing.
- A request rejected with 503 has already dropped its maps from memory. Edits that no write carried yet are lost, as
  they would be if the request had run.
- `POST /move` of a `.wam` drops the source map from memory. Edits that no completed write carried (normally the last
  15 s) are not in the moved file.
- Loading a map waits while a replacement of that map runs. Any replacement makes the loads in flight at that moment
  read their file again, one extra read each.
- A load that finishes after another load of the same map returns the copy already loaded instead of replacing it.
  On HEAD the later load replaced it, so an edit already applied to the first copy was never saved. That HEAD
  behavior is read from the code, not tested.
- The round 3 changes stay. A map with a write in flight is not evicted, and a timed-out write that lands late triggers a
  new save.

## Checks

sbh, `node:24-trixie`, `--rm --cpus 1 --cpu-shares 512 --memory 3g --network none`, tree
`~/wa-jobs/wa-fable-20261112/src-p5`, cwd `map-storage`. Each container mounts the four files of its state read-only
over the tree and prints their sha256 first. Receipts: `receipts/runs/<state>.log`.

Scratch commits name the states. Base `9ce5c31` (HEAD files), patch 1 `6a451fe`, patch 2 `adbeebd`, patch 3
`3fbdf1d`, patch 4 `646923b`. A state named `x-on-y` runs the sources of `y` with the tests of `x`.

| # | State | Container | Command | Exit | Result |
|---|---|---|---|---|---|
| 1 | `e1-a-on-head`: HEAD sources, patch 1 tests | `wa-fable-ovw4-81` | `npx vitest run --reporter=verbose` on the autosave tests | 0 | 19 passed, the three `(known defect)` pins among them |
| 2 | `e2-a-pin-on-b`: patch 2 sources, patch 1 tests | `wa-fable-ovw4-82` | same | 1 | 2 failed of 19: the retry pin, and "should count a write that never settles as failed and retry it", whose eviction assertion patch 2 removes |
| 3 | `e3-b-tests-on-a`: HEAD sources, patch 2 tests | `wa-fable-ovw4-83` | same | 1 | 9 failed of 25: the flipped retry test, the three delete and upload tests, and the five new ones |
| 4 | `e4-b`: patch 2 | `wa-fable-ovw4-84` | same | 0 | 25 passed |
| 5 | `e5-c-on-b`: patch 2 sources, patch 3 tests | `wa-fable-ovw4-85` | autosave and `UploadController` tests | 0 | 30 passed, the two `(known defect)` pins and the three wiring tests among them |
| 6 | `e6-c-pin-on-d`: patch 4 sources, patch 3 tests | `wa-fable-ovw4-86` | same | 1 | 2 failed of 30: exactly the two pins |
| 7 | `e7-d-tests-on-c`: patch 3 sources, patch 4 tests | `wa-fable-ovw4-87` | same | 1 | 3 failed of 31: the two flipped pins and "should answer 503 and write nothing when a map the zip deletes has a write in flight" |
| 8 | `e8-d`: patch 4, the final stack | `wa-fable-ovw4-88` | same | 0 | 31 passed |
| 9 | final stack | `wa-fable-ovw4-100-final` | `npx vitest run` (whole map-storage suite) | 0 | 12 files, 100 passed |
| 10 | final stack | same | `npm run typecheck` | 0 | clean |
| 11 | final stack | same | `npx eslint` on the four files | 0 | no output |
| 12 | final stack | same | `npx prettier --check` on the four files | 0 | formatted |
| 13 | final stack, `MapValidator.ts` of `32f5571f1` | `wa-fable-ovw4-101-head-mapvalidator` | `npx vitest run`, then `npm run typecheck` | 0, 0 | 12 files, 100 passed. Typecheck clean. |

All 13 checks and the mutants ran in one batch on the final patches. Two earlier batches are superseded and their
receipts were not kept. The first failed `prettier` on one condition in patch 4, which `prettier --write` then
reformatted. After the second, my own review of the diff added the concurrent-load fix to patch 2 (step 5 of
the design). No independent reviewer has seen this stack.

Final file sha256 (state `e8-d`):

| File | sha256 |
|---|---|
| `src/MapsManager.ts` | `e23881e0577dfad602820851aaf24a62df2b7127bea7eade0dac3e043f56ddbf` |
| `src/Upload/UploadController.ts` | `9c01a30939e02a8e3ef37a25fb837387dddcde3279014afa33ae5192cad48663` |
| `src/tests/MapsManagerAutosave.test.ts` | `2318d3b999258a88b03bb481de15e23b2d24b3b34ffc582405c8ffd7dfedca56` |
| `src/tests/UploadController.test.ts` | `70c2483d8e919b96ed4b4b0bea4111194ffefd80a102958ef15be61aa38ccd17` |

HEAD files, unchanged on the sbh tree after the round: `MapsManager.ts` `84ddd0b7…`, `UploadController.ts`
`c5bbc727…`, `MapsManagerAutosave.test.ts` `0b1bb530…`.

In check 2, two pins of patch 1 still pass on the patch 2 sources. "recreates the deleted map..." and "overwrites
the uploaded map..." call `clearAfterUpload` and `storage.deleteFiles` directly, in the order `UploadController` used
on HEAD, and that order still loses data. Patch 2 changes the order in `UploadController`, not what those calls do.
It rewrites both pins to go through `replaceStoredMaps`, and the rewritten tests fail on HEAD (check 3). The HTTP
tests of patch 3 cover `UploadController` calling `replaceStoredMaps`.

## Mutants

Each mutant is the final state with one change, run against the final tests (`MapsManagerAutosave.test.ts` and
`UploadController.test.ts`, 31 tests).

`receipts/mutants.py` writes each mutant from the final sources. Receipts: `receipts/runs/m-<mutant>.log`.

| Mutant | Change | Failed / passed | Failing tests |
|---|---|---|---|
| `proceed-on-timeout` | After the wait times out, report and run `replace` anyway (round 3 behavior). | 4 / 27 | "should reject the delete and leave storage unchanged when the write in flight settles after the wait", DELETE 503, both zip 503 tests |
| `no-load-gate` | `loadWAMToMemory` does not wait for a replacement in progress. | 3 / 28 | "should load the map only once its replacement finished", "should give every load that waited for the replacement the same map", "should not keep a map whose read was in flight when its replacement started" |
| `no-reread` | `loadWAMToMemory` keeps a read that a replacement overlapped. | 1 / 30 | "should not keep a map whose read was in flight when its replacement started" |
| `no-dedupe` | `loadWAMToMemory` installs its copy even when another load installed one first. | 1 / 30 | "should give every load that waited for the replacement the same map" |
| `no-recheck` | `writesSettle` trusts its first snapshot. | 0 / 31 | none. Survives. See below. |
| `no-recheck+no-load-gate` | Both. | 4 / 27 | the three `no-load-gate` tests and "should keep the deleted map deleted when an edit arrives while the delete waits" |
| `zip-partial` | Round 3 zip: `deleteFilesExceptWAM` outside, one `replaceStoredMaps` per `.wam` entry. | 3 / 28 | both zip 503 tests, "should keep a map the zip deleted deleted when it had an unsaved edit" |
| `zip-deleted-not-gated` | The zip holds its own `.wam` entries only, not the ones it deletes. | 2 / 29 | "should answer 503 and write nothing when a map the zip deletes has a write in flight", "should keep a map the zip deleted deleted when it had an unsaved edit" |
| `move-no-clear` | `POST /move` calls `fileSystem.move` without `replaceStoredMaps`. | 1 / 30 | "should not recreate the moved map at its old path when it had an unsaved edit" |

`no-recheck` survives because it is equivalent while the load gate holds. A write starts only from a loaded map
(`startSave` reads `loadedMaps`), `replaceStoredMaps` drops the map before it waits, and the gate keeps it unloaded
until the replacement ends. No write of a held key can start during the wait, so a second look at `writesInFlight`
finds nothing new. The re-check stays, as decision 2 asks, as a second line of defense. With the gate also removed,
the F2 test fails (`no-recheck+no-load-gate`). With only the gate removed, it passes, because the re-check waits for
the new write. The gate is what fixes F2.

## What remains unprotected

1. Writes from another map-storage instance. The wait is in-process. Closing it needs the conditional write rejected
   above.
2. A write that never settles. Its map stays loaded, and every delete, upload or move of that map answers 503 until
   the write settles or the process restarts. The S3 client's `requestTimeout` and retries make an S3 write settle in
   practice. A `DiskFileSystem` write has no timeout.
3. An edit that arrives while its map is replaced waits in its load. Past the 10 s edition lock timeout, the caller
   gets a lock timeout and the next edit of that map can start while the first still waits (documented
   `LockByKey` behavior). When the replacement ends, the waiting edit runs on the new map, or fails if the map was
   deleted.
4. `POST /move` of a directory that holds `.wam` files, and `POST /copy` to a `.wam` path, do not hold any key. A
   loaded dirty map under a moved directory is saved back at its old path.
5. A `.wam` created between `wamKeysDeletedByUpload` and `deleteFilesExceptWAM` (by another instance, or a PUT
   outside the per-directory upload limiter) is deleted without being held.
6. `createWAMFileIfMissing` writes a `.wam` for a `.tmj` without one, outside `replaceStoredMaps`. It writes only when
   no file exists, so only a map loaded from a file that no longer exists is exposed.
7. The retry case from round 3. Between the late landing of a timed-out write and the rewrite (one autosave
   interval, 15 s, longer while storage keeps failing), storage holds the older WAM. A process stop in that window keeps it.

## Replacement text for `pr-descriptions/P5.md`

Replace the "Not guaranteed" bullet that starts "Cancelling a write already handed to storage" with:

```markdown
- Cancelling a write already handed to storage. A delete, an upload or a move of a map waits for the
  writes of that map, at most 60 s, and answers 503 with `Retry-After: 60` without changing storage if one
  is still in flight. Writes from another map-storage instance are not waited for. A write that never
  settles keeps its map loaded and makes every delete, upload or move of it answer 503 until it settles
  or the process restarts. Moving a directory of maps, and copying onto a `.wam`, do not wait. A
  timed-out write that lands after its retry leaves the older state in storage for one autosave
  interval, until the map is saved again.
```

Replace the line "The WAM format, the upload, delete and lock call sites, and `FileSystemInterface` are unchanged."
with:

```markdown
The WAM format and `FileSystemInterface` are unchanged. The DELETE, PUT, PATCH, zip upload and move
endpoints of `UploadController` now replace stored `.wam` files through `MapsManager.replaceStoredMaps`.
```

## Process

- Bug-fix playbook. Each defect is reproduced by a pin that passes on its base. The F1 and F2 tests fail on the round
  3 design (mutants `proceed-on-timeout` and `no-load-gate`). Each fix is verified on the same surface, and each pin
  lands before its fix. The `how`, `why` and `architect` multi-model fan-out was skipped for the 04:20 UTC hard stop.
  The coordinator had fixed the design decisions beforehand.
- BLOCKED: independent review. The change enforces a data-integrity invariant, so an independent correctness
  reviewer is required before merge-ready.
- The `UploadController` HTTP test runs an Express app on an ephemeral loopback port with the controller, an
  in-memory `FileSystemInterface`, mocked `passportAuthenticator` and `uploadDetector`, and Node `fetch`. Fake timers cover only
  `setTimeout`, `clearTimeout` and `Date`, so the request runs on the real event loop. No new dependency. It took
  about 10 minutes.

## Resources

- Containers `wa-fable-ovw4-1..5`, `-11..-26`, `-40..-42`, `-51..-60`, `-70`, `-71`, `-81..-97`, `-100-final`,
  `-101-head-mapvalidator`, all `--rm`. Left: 0.
  `docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-ovw4` lists none.
- The sbh tree was never written. Every run mounted its files read-only. Docker created an empty mount point at
  `map-storage/src/tests/UploadController.test.ts` in the tree, now removed. The three map-storage files equal
  HEAD (hashes above). `._*` files under `map-storage`: 0. Remote dirs `ovw4-*` removed.
- Mac scratch `/tmp/wa-p5r4/` deleted. The scratch commit ids above only name states. The patches rebuild them.
