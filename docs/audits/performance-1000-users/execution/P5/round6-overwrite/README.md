# P5 round 6: replacements of a map run in order, a move keeps its edits, uploads leave no temporary file

Goal: WorkAdventure must scale toward 1,000 users and every review finding gets fixed. In map-storage, an
autosave write must never land over a DELETE, an upload or a move of the same `.wam`, a rejected request must
lose no edit, and a moved map must keep its edits. This round fixes the findings of the round 5 verdict
(`verdicts/p5-round5-overwrite.md`, FAIL) that the coordinator confirmed.

| Finding | Severity | Outcome |
|---|---|---|
| F1. `MapStorageServer.handleClearAfterUpload` clears the cache without waiting for the writes in flight. | major | Dismissed by the coordinator. It is "What remains unprotected", item 1, and ledger item MS-04. No change. |
| F2. A save that is scheduled but has not started when the wait ends is dropped with the map. | major | Intended for DELETE and uploads, now stated in the `replaceStoredMaps` doc comment. Fixed for `POST /move` of a `.wam` by patches 9 and 10. |
| F3. Concurrent replacements of the same map are not serialized, so the older one can finish last. | major | Fixed by patches 7 and 8. |
| F4. The 503 paths leave Multer's temporary upload file behind. | minor | Fixed by patches 11 and 12, on every exit of both upload handlers. |

## Patches

Stacked in this order on HEAD. Each pin patch is test-only and lands before the fix that flips it. Patches 1
to 6 are the round 5 patches, byte for byte.

| Order | File | sha256 | Content |
|---|---|---|---|
| 1 | `1-pin-autosave-overwrite.test.patch` | `f40c1b3a06a220bd1d4146b3fe255179c49c1d55ac165d7fb6fcd62f4c2338f1` | Round 5 patch 1. |
| 2 | `2-fix-autosave-overwrite.patch` | `881603cd8855984364f6cb80ec90ba760ee92fe621966146be6841086ca30b35` | Round 5 patch 2. |
| 3 | `3-pin-upload-move-clear.test.patch` | `ab6b4862e2b7e3bc9be4aafac11c80b6756be2b2cfc2b8e403f19740000abae5` | Round 5 patch 3. |
| 4 | `4-fix-upload-move-clear.patch` | `76e476ac3248020c8fa509a861575d867d5fc7be9e6438c6e40898d6a9b55bf3` | Round 5 patch 4. |
| 5 | `5-pin-rejected-replacement-edit.test.patch` | `8b12d45341a837dc0f9b20c2de9a5eee9e62d23aae9a7dca4b3fc307404f501a` | Round 5 patch 5. |
| 6 | `6-fix-rejected-replacement-edit.patch` | `4bff6b0ee61acb69bd7404ea2ea3ec7b8a12bf05e4dc6fad9902b47ea7ef05a2` | Round 5 patch 6. |
| 7 | `7-pin-overlapping-replacements.test.patch` | `ebb7a1eddca92a34d6d0944076cd962b8c0db5bda8cd4a4d66463a9b767a8fd5` | One `(known defect)` test for F3 in `MapsManagerAutosave.test.ts`. |
| 8 | `8-fix-overlapping-replacements.patch` | `63a9c509610ad008539bbf6fcbb2c54a8573dd4e3db8e6fec33b83b5ebcb347a` | `MapsManager.ts`: a replacement waits for the earlier replacements of its maps, then for their writes, against one deadline. The pin flipped, two tests added. |
| 9 | `9-pin-move-unsaved-edit.test.patch` | `f29e4422ed5a0e024ee982b55432e027d196b99e4e0983695dd6a1de05b29132` | One `(known defect)` test for F2 on `POST /move` in `UploadController.test.ts`, the verdict's scenario. |
| 10 | `10-fix-move-unsaved-edit.patch` | `0ef4c504610b86e067343486d27f287174ee66db3c9cb51a518893c03867b01f` | `MapsManager.ts`: option `saveFirst` of `replaceStoredMaps`. `UploadController.ts`: the move passes its source. The pin flipped, one move test adjusted, three tests added. |
| 11 | `11-pin-upload-temp-file.test.patch` | `17c13d2e58545ad3ea20712d7d6153c391b82c38b343c5b1e7942de0a892700a` | Four `(known defect)` tests for F4 in `UploadController.test.ts`. |
| 12 | `12-fix-upload-temp-file.patch` | `a0bd17effc2bd62638dcf57b0a4c6df47affc834ab7c234f6efcbac2bd05d63a` | `UploadController.ts`: both upload handlers delete the temporary file in a `finally`. The four pins flipped, one test added. |

The stack applies on the checkout. `receipts/apply-check.sh` runs `git apply --cached` of the twelve patches in
order on a temporary index (`GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` in `/tmp`, the checkout's objects as an
alternate). Nothing is written to the checkout. Each patch exits 0, and the resulting blobs equal the files
tested on sbh. Receipt: `receipts/apply-check.log`.

The checkout HEAD is `50632e874`. `map-storage` has not changed since round 5, so every state below is HEAD
plus patches, with the HEAD `MapValidator.ts` mounted as in round 5.

## Design

### Replacements of a map run in request order (F3)

`replaceStoredMaps` now keeps a second registry, `replacementsRequested`. A replacement is in it for each of
its keys from the call until it ends, whether it ran, was rejected or threw. At the call, a replacement reads
the earlier replacements of its keys, then registers itself. It then runs in this order:

1. It waits for those earlier replacements.
2. It waits until none of the writes of its keys is in flight, checking again after each batch.
3. It drops the maps, closes the load gate and runs `replace`, as in round 5.

Both waits count against one deadline, `REPLACEMENT_WAIT_MS` (60 s) after the call. At the deadline the
replacement fails closed as in round 5: `replace` does not run, the maps stay loaded, and the caller answers
503. A later replacement reads every earlier one of a shared key, so the replacements of a map run in request
order. With partial overlaps the order still holds, because each replacement waits for the earlier ones of
all its keys.

The verdict also notes that `replace` writes are not in `writesInFlight`. They do not need to be. The next
replacement of the map waits for the whole earlier replacement. An autosave write of the map cannot start
during `replace`, because the map is dropped and its loads wait for `replace`.

`replacementsInProgress`, the load gate, stays separate. Round 5 F1 needs the maps loaded and editable during
the wait, so the gate opens only between the drop and the end of `replace`. Both registries hold the same
promise, which resolves when the replacement ends.

### A move saves the edits of the moved map first (F2)

For a delete or an upload, edits that no write carried when the maps are dropped are dropped with them. The
coordinator kept this outcome. The request is the later operation and supersedes the edits of the old map.
The `replaceStoredMaps` doc comment now says so.

A move must keep them. `replaceStoredMaps` takes an option, `saveFirst`, a list of its keys whose unsaved
edits must reach storage before the drop. `POST /move` of a `.wam` passes its source:

```ts
const outcome = await mapsManager.replaceStoredMaps(
	[virtualPath, newVirtualPath],
	() => this.fileSystem.move(virtualPath, newVirtualPath),
	{ saveFirst: [virtualPath] },
);
```

Each pass of the wait loop of step 2 now calls `saveAndSettle`. It starts the save of a `saveFirst` map whose
state is `"dirty"` now, with the same `startSave` as the autosave timer, and then waits for the writes in
flight. The loop ends when no write of the keys is in flight and no `saveFirst` map has a save state, which
means every edit of the moved map is in storage. In the verdict's scenario, an edit lands while a write is in
flight and leaves a follow-up save scheduled. The next pass starts that save at once.

If the last write of a `saveFirst` map failed (state `"retrying"`), the move answers 503 at once. Storage is
unchanged and the map keeps its edit and its 15 s retry. Moving without the edit would lose it. Retrying inside
the loop would call failing storage as fast as it fails.

The option is the smaller shape. A separate flush call by the move route would run before
`replaceStoredMaps`. It would need its own deadline, and an edit made between the end of the flush and the
drop would be lost. That window includes the whole wait for earlier replacements and writes. Inside the loop,
the save shares the deadline and the fail-closed rule, and the last check sits next to the drop.

### The last check and the drop run in one synchronous block

Patch 8 replaces the `writesSettle` recursion of round 5 with a `while` loop in `replaceStoredMaps`. It needs
one `eslint-disable-next-line no-await-in-loop`, as `UploadController.ts` already has for the zip entries.
Round 5 kept the recursion and argued that no write starts between the last check and the drop, because a
write starts only from a timer. That argument does not cover `saveFirst`. An edit marks a map unsaved from a
promise continuation (`executeCommand` after `await command.execute()`), and such a continuation can run while
the recursion unwinds. With the loop, `replaceStoredMaps` evaluates the condition and drops the maps with no
`await` in between.

### Uploads delete their temporary file on every exit (F4)

`POST /upload` and `PUT` run their body in an async function. Each now chains
`.finally(() => removeUploadedFile(req.file))` before its `.catch`. The file is deleted after a success, a 503,
a 400 or 413 answer, and a thrown error. The two success-only `fs.unlink` blocks are gone. `removeUploadedFile`
logs and reports an unlink error as the old blocks did. `PATCH` does not use Multer.

The tests point `TMPDIR` at a fresh directory with `vi.stubEnv`. Multer's disk storage stores each upload in
`os.tmpdir()`, which reads `TMPDIR` on every call. The tests then assert that the directory empties. The pins
wait 100 event loop turns and assert that the file is still there.

## Behavior changes

Compared with round 5:

- Two deletes, uploads or moves of the same map run one after the other, in request order. The later one
  answers 503 if the earlier one and the writes in flight do not finish within 60 s of its call.
- `POST /move` of a `.wam` saves the unsaved edits of the source map at once and waits for that write. The
  moved file has every edit accepted before the maps were dropped. If that save fails, the move answers 503 at once.
- A move of a map that is edited again during every save does not find the map saved, and answers 503 after
  60 s.
- Uploads leave no temporary file, whatever the response.
- The rejection log reads `A write of map <keys> did not settle within 60000ms, or failed. The delete, upload
  or move is rejected, storage is left unchanged`. It lists every key of the request, and so does the Sentry
  `extra.keys`.

Unchanged from round 5:

- DELETE, PUT and PATCH of a `.wam`, a zip upload and a move of a `.wam` wait for the autosave writes of the
  maps they touch, and the maps stay loaded and editable during the wait.
- A request rejected with 503 leaves storage unchanged and its maps loaded with their edits.
- A delete or an upload drops the edits of its maps that no write carried, including the edits accepted during
  its wait.

## Checks

sbh, `node:24-trixie`, `--rm --cpus 1 --cpu-shares 512 --memory 3g --network none --label owner=wa-fable-20261112`,
tree `~/wa-jobs/wa-fable-20261112/src-p5` mounted read-only, cwd `map-storage`, one container at a time. Each
container mounts the files of its state read-only over the tree: `MapsManager.ts`, `UploadController.ts`, the
`src/tests` directory, and the HEAD `MapValidator.ts`. Vite writes to tmpfs. Each log starts with the sha256 of
the mounted files. Scripts: `receipts/export_states.py`, `receipts/mutants.py`, `receipts/run.sh`,
`receipts/final.sh`. Receipts: `receipts/runs/<state>.log`.

A state named `x-on-y` runs the sources of `y` (`MapsManager.ts`, `UploadController.ts`) with the tests of `x`.
Letters f to l name patches 6 to 12. Each test run is `npx vitest run --reporter=verbose` on
`MapsManagerAutosave.test.ts` and `UploadController.test.ts`.

| # | State | Container | Command | Exit | Result |
|---|---|---|---|---|---|
| 1 | `s1-g-on-f`: patch 6 sources, patch 7 tests | `wa-fable-ovw6-10` | tests | 0 | 34 passed, the F3 pin among them |
| 2 | `s2-g-pin-on-h`: patch 8 sources, patch 7 tests | `wa-fable-ovw6-11` | tests | 1 | 1 failed of 34: exactly the F3 pin (`expected 'second' to be 'first'`) |
| 3 | `s3-h-tests-on-g`: patch 7 sources, patch 8 tests | `wa-fable-ovw6-12` | tests | 1 | 2 failed of 36: the flipped F3 test (the later `replace` ran while the earlier one was held) and "should reject the later replacement when the earlier one does not finish in time" (timed out, the later `replace` is held too) |
| 4 | `s4-h`: patch 8 | `wa-fable-ovw6-13` | tests | 0 | 36 passed |
| 5 | `s5-i-on-h`: patch 8 sources, patch 9 tests | `wa-fable-ovw6-14` | tests | 0 | 37 passed, the F2 move pin among them |
| 6 | `s6-i-pin-on-j`: patch 10 sources, patch 9 tests | `wa-fable-ovw6-15` | tests | 1 | 2 failed of 37: the F2 pin (`expected 'edited by cmd-2' to be 'edited by cmd-1'`) and the round 4 move test, whose moved file now has the edit |
| 7 | `s7-j-tests-on-i`: patch 9 sources, patch 10 tests | `wa-fable-ovw6-16` | tests | 1 | 5 failed of 40: the flipped pin, the adjusted move test (`expected undefined to be 'edited by cmd-1'`), the move 503 test (`expected 200 to be 503`), and both `saveFirst` tests |
| 8 | `s8-j`: patch 10 | `wa-fable-ovw6-17` | tests | 0 | 40 passed |
| 9 | `s9-k-on-j`: patch 10 sources, patch 11 tests | `wa-fable-ovw6-18` | tests | 0 | 44 passed, the four F4 pins among them |
| 10 | `s10-k-pin-on-l`: patch 12 sources, patch 11 tests | `wa-fable-ovw6-50` | tests | 1 | 4 failed of 44: exactly the four pins |
| 11 | `s11-l-tests-on-k`: patch 11 sources, patch 12 tests | `wa-fable-ovw6-20` | tests | 1 | 4 failed of 45: the four flipped tests, each timed out waiting for the directory to empty |
| 12 | `s12-l`: patch 12, the final stack | `wa-fable-ovw6-51` | tests | 0 | 45 passed |
| 13 | final stack | `wa-fable-ovw6-4` | `npx vitest run` (whole map-storage suite) | 0 | 12 files, 114 passed |
| 14 | final stack | same | `npm run typecheck` | 0 | clean |
| 15 | final stack | same | `npx eslint` on the four files | 0 | no output |
| 16 | final stack | same | `npx prettier --check` on the four files | 0 | formatted |

Final file sha256 (state `s12-l`):

| File | sha256 |
|---|---|
| `src/MapsManager.ts` | `cccbc2abd9451ce6667135ac65c1ff79f8dbef15e68a8e118ce1b975ab082c33` |
| `src/Upload/UploadController.ts` | `70962c49fbbcac39dfbbd8919608dfa86ac275fc6d640cc05b97922439c0212a` |
| `src/tests/MapsManagerAutosave.test.ts` | `a19d03f164eaf27001cc72d113baf0cbbd72ff6e7cba5c554c5e8c7d92172123` |
| `src/tests/UploadController.test.ts` | `9d736165eb644505c4da94091488d971bdb056bd30b9b59bbd001791eddc735b` |
| `src/tests/MapStorageServer.test.ts` (HEAD, unchanged) | `1be0b55c07fe4b2881328a5749852d27e6941432daa47665fdbf22a5be6650c2` |
| `libs/map-editor/src/GameMap/MapValidator.ts` (HEAD, mounted) | `3a52822d686b31ebff133beb15c384c7206cd1be9d8dbc5bf0e0ef92cd567a0c` |

The pins of checks 2, 6 and 10 fail on their fix and pass on their base (checks 1, 5 and 9). The tests of each
fix fail on the sources before it (checks 3, 7 and 11). In check 3, the "one deadline" test passes on the
patch 7 sources, because round 5 has only one wait. It fails under the `deadline-per-wait` mutant below.

## Mutants

Each mutant is the final state with one change, run against the final tests (`MapsManagerAutosave.test.ts` and
`UploadController.test.ts`, 45 tests). `receipts/mutants.py` writes each mutant from the final sources. The
round 5 mutants are rewritten for the final code. Receipts: `receipts/runs/m-<mutant>.log`.

| Mutant | Change | Failed / passed | Failing tests |
|---|---|---|---|
| `no-replacement-serialization` | A replacement does not wait for the earlier ones. | 2 / 43 | "should run the later replacement only once the earlier one finished", "should reject the later replacement when the earlier one does not finish in time" |
| `deadline-per-wait` | The wait for the writes gets a fresh 60 s deadline after the wait for earlier replacements. | 1 / 44 | "should count the wait for the earlier replacement and for the writes in flight against one deadline" |
| `move-without-flush` | `POST /move` does not pass `saveFirst`. | 3 / 42 | the three move tests that expect the edits in the moved file or a 503 |
| `temp-file-kept-on-503` | Both upload handlers skip the deletion when they answer 503. | 2 / 43 | "should be deleted when the zip upload answers 503", "should be deleted when the PUT of a map answers 503" |
| `proceed-on-timeout` | After the deadline, drop the maps and run `replace` anyway. | 11 / 34 | the eleven tests that expect a rejection, the round 5 F1 test "should keep and save the edit made after the write in flight began when the delete is rejected" among them |
| `clear-before-wait` | Drop the maps before the waits. | 6 / 39 | the round 5 F1 test, both `saveFirst` tests, the three move tests |
| `no-recheck` | The `while` loop becomes an `if`, so one pass of the wait is trusted. | 3 / 42 | "should keep the deleted map deleted when an edit made while the delete waits starts its own write", "should reject the replacement and keep the edit when its save fails", "should move the map with an edit made while the write of an earlier edit was in flight" |
| `no-load-gate` | `loadWAMToMemory` does not wait for a replacement in progress. | 1 / 44 | "should load the map only once its replacement finished" |
| `no-recheck+no-load-gate` | Both. | 4 / 41 | the four tests above |
| `no-reread` | `loadWAMToMemory` keeps a read that a replacement overlapped. | 1 / 44 | "should not keep a map whose read was in flight when its replacement started" |
| `no-dedupe` | `loadWAMToMemory` installs its copy even when another load installed one first. | 1 / 44 | "should give every load that waited for the replacement the same map" |
| `zip-partial` | Round 3 zip: `deleteFilesExceptWAM` outside, one `replaceStoredMaps` per `.wam` entry. | 3 / 42 | both zip 503 tests, "should keep a map the zip deleted deleted when it had an unsaved edit" |
| `zip-deleted-not-gated` | The zip holds its own `.wam` entries only, not the ones it deletes. | 2 / 43 | "should answer 503 and write nothing when a map the zip deletes has a write in flight", "should keep a map the zip deleted deleted when it had an unsaved edit" |
| `move-no-clear` | `POST /move` calls `fileSystem.move` without `replaceStoredMaps`. | 3 / 42 | the three move tests |

Every mutant fails at least one test. The coordinator named `no-replacement-serialization`,
`move-without-flush` and `temp-file-kept-on-503`. `deadline-per-wait` checks the one-deadline rule. The `no-recheck` mutant now also loses the move edit:
after one pass, the follow-up save of the edit made during the write is still scheduled, and the move runs
without it.

## What remains unprotected

1. Writes that this process cannot wait for. A write from another map-storage instance is not in this process's
   `writesInFlight`. `MapStorageServer.handleClearAfterUpload` calls `clearAfterUpload` directly when the back
   servers relay an upload that this process did not serve, so a write that this process already handed to
   storage can land after that upload and restore the old map. Replacements served by different instances are
   not ordered either. Closing these needs conditional writes (ledger item MS-04): S3 `If-Match` and a
   compare-and-swap on disk, which change `FileSystemInterface` and both backends.
2. A write or a `replace` that never settles. A write keeps its map loaded and makes every delete, upload or
   move of that map answer 503 until it settles or the process restarts. A `replace` that never settles does
   the same to the later replacements of its maps, and the loads of its maps wait for it. The S3 client's
   `requestTimeout` and retries make an S3 call settle in practice. `DiskFileSystem` calls have no timeout.
3. An edit that arrives while `replace` runs waits in its load. Past the 10 s edition lock timeout, the caller
   gets a lock timeout and the next edit of that map can start while the first still waits (documented
   `LockByKey` behavior). When `replace` ends, the waiting edit runs on the new map, or fails if the map was
   deleted.
4. `POST /move` of a directory that holds `.wam` files, and `POST /copy` to a `.wam` path, do not hold any key. A
   loaded dirty map under a moved directory is saved back at its old path.
5. A `.wam` created between `wamKeysDeletedByUpload` and `deleteFilesExceptWAM` (by another instance, or a PUT
   outside the per-directory upload limiter) is deleted without being held.
6. `createWAMFileIfMissing` writes a `.wam` for a `.tmj` without one, outside `replaceStoredMaps`. It writes only
   when no file exists, so only a map loaded from a file that no longer exists is exposed.
7. The retry case from round 3. Between the late landing of a timed-out write and the rewrite (one autosave
   interval, 15 s, longer while storage keeps failing), storage holds the older WAM. A process stop in that window
   keeps it.
8. A move of a map that someone edits during every save answers 503 after 60 s (see Behavior changes). The
   edits are kept, and the move succeeds once the edits pause for one write.
9. `POST /move` checks that the destination does not exist before it waits. Two moves to the same destination
   both pass the check, then run in order, and the second one overwrites the first one's file. This
   check-then-act race predates P5.

## Replacement text for `pr-descriptions/P5.md`

Replace the "Not guaranteed" bullet that starts "Cancelling a write already handed to storage" with:

```markdown
- Cancelling a write already handed to storage. A delete, an upload or a move of a map waits for the
  earlier deletes, uploads and moves of that map, then for its writes, at most 60 s in total, and the map
  stays loaded and editable while it waits. A move saves the unsaved edits of the moved map first, so the
  moved file has them. A delete or an upload drops the edits that no write carried, because it replaces
  that map. If the 60 s run out, or the save before a move fails, the request answers 503 with
  `Retry-After: 60`, storage is unchanged, and the map keeps its edits for the next autosave. Writes and
  replacements from another map-storage instance are not waited for, and neither are the writes in flight
  when the back servers relay `handleClearAfterUpload` for an upload another instance served. A write or
  a replacement that never settles makes every later delete, upload or move of its map answer 503 until it
  settles or the process restarts. Moving a directory of maps, and copying onto a `.wam`, do not wait. A
  timed-out write that lands after its retry leaves the older state in storage for one autosave interval,
  until the map is saved again.
```

Replace the line "The WAM format, the upload, delete and lock call sites, and `FileSystemInterface` are unchanged."
with:

```markdown
The WAM format and `FileSystemInterface` are unchanged. The DELETE, PUT, PATCH, zip upload and move
endpoints of `UploadController` now replace stored `.wam` files through `MapsManager.replaceStoredMaps`.
Both upload endpoints delete Multer's temporary file whatever the response.
```

## Process

- Bug-fix playbook. Each pin passes on its base and fails after its fix, and each fix's tests fail on the
  sources before it (checks 1 to 3, 5 to 7 and 9 to 11). Each pin patch lands before its fix. The `how`, `why`
  and `architect` multi-model fan-out was skipped for the 05:15 UTC hard stop. The coordinator had fixed the
  designs of F2 and F3 beforehand, and Design justifies the one open choice, the shape of the move's save.
- BLOCKED: independent review. The change enforces a data-integrity invariant, so an independent correctness
  reviewer is required before merge-ready.
- Three final runs were superseded, and their logs were not kept. `wa-fable-ovw6-1` failed `npm run typecheck`
  (`storedName` returned `metadata.name`, which can be `null`) and prettier (one long condition in
  `MapsManager.ts`, one indentation in `UploadController.ts`). `wa-fable-ovw6-2` and `wa-fable-ovw6-3` failed
  prettier on a blank line that the first fix had left in `UploadController.ts`, one after the other.
  `receipts/rebuild.py` applied each text fix (`receipts/fixes-1.txt` to `fixes-3.txt`) to every scratch commit
  that had the old text. Only the patch 12 `UploadController.ts` changed after the batch started. Checks 1 to 9
  and 11 ran before that change, and their state files are byte-identical to the final export (`sha256sum -c`,
  0 mismatches). Checks 10, 12 and 13 to 16 and every mutant ran again on the final files. Each log starts with
  the sha256 of the files it mounted.
- The scratch commit ids that `receipts/export_states.py` and `receipts/mutants.py` resolve by subject only name
  states. The patches rebuild them.

## Resources

- Containers `wa-fable-ovw6-1` to `-4` (final checks), `-10` to `-21` (states), `-30` to `-43` (first mutant
  batch, superseded with the files it ran), `-50` and `-51` (checks 10 and 12 again) and `-60` to `-73`
  (mutants), all `--rm`, one at a time. Left: 0. `docker ps -a --filter label=owner=wa-fable-20261112 --filter
  name=wa-fable-ovw6` lists none.
- The sbh tree was never written. Every run mounted it read-only, mounted the state files and the `src/tests`
  directory read-only over it, and gave Vite tmpfs. No empty mount point was created: the runs mount files that
  exist in the tree and the test directory. After the round, `MapsManager.ts` (`84ddd0b7…`),
  `UploadController.ts` (`c5bbc727…`) and the two `src/tests` files equal HEAD, no file of the tree outside the
  Vite directories is newer than the round's upload, empty files under `map-storage/src`: 0, and `._*` files
  under `map-storage`: 0. The tree still holds the `e19bbf7dc` `MapValidator.ts` (`721b8a47…`). Remote dir
  `ovw6` removed.
- Mac scratch `/tmp/wa-p5r6/` deleted. Every tar ran with `COPYFILE_DISABLE=1`. The first one also carried
  macOS extended attributes, which GNU tar on sbh ignored with a warning. Later tars added `--no-mac-metadata
  --no-xattrs`.
