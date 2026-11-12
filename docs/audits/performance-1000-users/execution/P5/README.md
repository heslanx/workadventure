# P5 storage lane: map autosave lifecycle

Status: unit-level work done. The plan's live lanes and real-backend perf probe were not run.

## What was done

1. Wrote `map-storage/src/tests/MapsManagerAutosave.test.ts` (11 tests) against an in-memory, controllable
   `FileSystemInterface` with fake timers.
2. Ran it against the unchanged baseline (`ddbe245a8`): 7 failed, 4 passed. See `reproduction.md`.
3. Wrote `lifecycle-contract.md`.
4. Replaced the interval and timestamp maps in `map-storage/src/MapsManager.ts` with one save state per map
   key (dirty, saving, saving+dirty, retrying; clean is the absence of a state).
5. Drafted `../pr-descriptions/P5.md`.

## What was measured

| Check | Trunk | Head |
|---|---|---|
| Autosave test file | 7 failed, 4 passed, exit 1 | 11 passed |
| Max concurrent writes of one map, slow storage | 3 | 1 |
| Writes for one edit, healthy storage | 2 | 1 |
| Writes for 13 edits over 60 s, healthy storage | 6 | 5 |

Head verification (`receipts/head-verification.log`), all exit 0:

- `npm test -- --run src/tests/MapStorageServer.test.ts src/tests/MapsManagerAutosave.test.ts` (24 passed)
- `npm run typecheck`
- `npx eslint src/MapsManager.ts src/tests/MapsManagerAutosave.test.ts`
- `npx prettier --check src/MapsManager.ts src/tests/MapsManagerAutosave.test.ts`

## Where the checks ran

The receipts come from `ssh knc`, in one-shot containers named `wa-fable-p5` (`node:24-trixie`, `--rm`,
`--cpus 2 --memory 6g --cpu-shares 512 --network none`, label `owner=wa-fable-20261111`, no ports), on a
private copy of the installed snapshot at `~/wa-jobs/wa-fable-20261111/src-wa-fable-p5`.

Reason: in `wa-fable-local` the first Vitest run produced no result in 12 minutes while another lane's
benchmark was running, and was stopped by PID.

The copy was checked against this checkout before use: identical aggregate sha1 over
`map-storage/src`, `libs/map-editor/src` and `libs/shared-utils/src` (the two lane files excluded), and
identical `package-lock.json`, `map-storage/package.json`, `tsconfig-node.json`, `eslint.config.js`,
`vitest.config.ts`. The two lane files on the remote had the same sha1 as the checkout files when the final
runs were made (first lines of each receipt).

See "Local container run" at the end for the result in `wa-fable-local`.

## Precedents read

- #5888, commit `55093ba2c` "Move map eviction behind per-map edition lock": the lock and re-check around
  eviction are kept, now in `evictIfIdle`.
- #5887: not found by number in `git log -- map-storage/src/MapsManager.ts`. Eviction at queue expiry was
  read from the current source and kept for clean maps.

## What remains

- Plan "Verify, live" lanes 1 to 10 as live runs with `P5/lane-N.json`. None was run. At the
  fault-injection boundary only, the unit tests cover the logic of lanes 1 to 6 and 9, and of lanes 7 and 8
  for a pending or failing save. A successful write that lands after the upload or delete is not covered,
  and neither is lane 10 (restart).
- Real disk and S3-compatible backend probe: write bytes, save latency, real completion ordering.
- The in-flight write that outlives `clearAfterUpload` (contract, "Upload and delete"). Needs changes outside
  this lane's files.
- Maintainer review of the 1 hour retry horizon and the constant 15 s retry values. The horizon semantics were
  decided in round 2: it is measured from the newest unsaved edit (see `round2/README.md`).
- Full `map-storage` test suite and lint were not run, only the focused files.

## Files

- `reproduction.md`: trunk results per scenario, with test names and assertion messages.
- `lifecycle-contract.md`: states, transitions, guarantees, bounds.
- `receipts/trunk-autosave-tests.log`: final test file against baseline `MapsManager.ts`, exit 1.
- `receipts/head-verification.log`: tests, typecheck, eslint, prettier on head, all exit 0.
