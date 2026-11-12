# P5 reproduction on trunk

Baseline: `map-storage/src/MapsManager.ts` at commit `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`
(sha1 `d6026e47257c44f42e9e1113b5486db2c56e99b2`).

Test file: `map-storage/src/tests/MapsManagerAutosave.test.ts` (final version, sha1
`c0296d5a14871d2da70325c5fc123bfc5bd5cbb5`), run unchanged against the baseline source.

Command (inside a capped container on the remote snapshot, see `README.md` for the venue):

```
cd map-storage && npm test -- --run src/tests/MapsManagerAutosave.test.ts
```

Exit code: `1`. Result: `7 failed | 4 passed (11)`. Full output: `receipts/trunk-autosave-tests.log`.

## How the probe works

- `../fileSystem` is replaced by an in-memory `FileSystemInterface` whose `writeStringAsFile` can succeed,
  fail, or be held open. A write only becomes visible when it succeeds, so the last write to finish wins.
- Time is driven by Vitest fake timers.
- An edit goes through the public calls `MapStorageServer` uses: `waitForLock`, `getOrLoadWamFile`,
  `executeCommand`, `addCommandToQueue`.
- Every assertion reads the stored file, the storage write counters, or what `getOrLoadWamFile` returns.

This is a deterministic fault model, not a real backend. No disk or S3 run was made.

## Scenarios asked for

| # | Scenario | Test name | Trunk | Assertion message on trunk |
|---|---|---|---|---|
| a | First save fails, no later edit | `when a save fails > should persist the edit once storage recovers, without waiting for another edit` | FAILS | `expected undefined to be 'cmd-1'` |
| b1 | Write slower than the interval: overlap | `when a save is slower than the autosave interval > should never run two writes of the same map at once` | FAILS | `expected 3 to be 1` |
| b2 | Write slower than the interval: stale overwrite | `when a save is slower than the autosave interval > should end with the newest edit stored when the first write is the last to finish` | FAILS | `expected 'cmd-1' to be 'cmd-2'` |
| c | Second edit lands while a save is in flight | `when an edit lands while a save is in flight > should persist that newer edit with a follow-up write` | PASSES | none |
| d | Command history expires while the map is unsaved | `when a save fails > should keep the unsaved edit in memory after its command history expired` | FAILS | `expected undefined to be 'cmd-1'` |

### a. Reproduced: an acknowledged edit is never persisted

Edit at 0 s, the 15 s write fails, storage is healthy again from then on, no further edit. After 5 more
minutes the stored WAM still has no `lastCommandId`. Trunk clears the save interval on the first failure and
nothing starts it again.

### b1. Reproduced: three writes of one map in flight

Edit at 0 s, writes held open from the first tick, second edit at 15 s. By 45 s three `writeStringAsFile`
calls for the same key are pending at once (ticks at 15 s, 30 s, 45 s). Trunk has no in-flight guard.

### b2. Reproduced under out-of-order completion: the older state ends on storage

Same start. At 36 s the two pending writes finish newest first: the 30 s write (`cmd-2`) lands, then the
15 s write (`cmd-1`). The stored WAM ends with `cmd-1` and stays that way for the next 5 minutes, because the
newest write completed more than 20 s after the last edit and stopped the interval.

Scope of this result: it needs the older write to finish after the newer one, and the newer one to finish
more than 20 s after the last edit. The fake storage produces that order on demand. How often a real backend
does was not measured.

### c. Not reproduced on trunk

Edit at 0 s, write held from 15 s, second edit at 15 s, the held write succeeds at 16 s. Trunk persists
`cmd-2` at the 30 s tick. Trunk has no "clean" marker: the interval keeps ticking for 20 s after the last
edit, so an edit made during a write is picked up by a later tick. Losing it on trunk needs scenario a or b2
on top. The test is kept because the new lifecycle does have a clean transition, and this is the check that
an older completion does not apply it to a newer edit.

### d. Reproduced together with a failing save: unsaved state is evicted

Edit at 0 s, every write fails. The command leaves the queue at 30 s, the queue is empty, and trunk evicts
the map from memory without looking at whether it was saved. `getOrLoadWamFile` then reloads the pre-edit
file: `getLastCommandId()` is `undefined`. On healthy storage this path does not lose anything, because the
15 s write lands before the 30 s eviction (first test of the file passes on trunk).

## Other results in the same run

| Test name | Trunk | Meaning |
|---|---|---|
| `on healthy storage > should persist the edited map and release it from memory` | PASSES | Healthy path baseline: stored `lastCommandId` and metadata match, map evicted, reload returns the edit. |
| `on healthy storage > should write a map edited once a single time` | FAILS, `expected 2 to be 1` | Measurement, not a defect: trunk writes one edit twice (15 s and 30 s). |
| `on healthy storage > should write a continuously edited map once per autosave interval` | FAILS, `expected 6 to be 5` | Measurement, not a defect: 13 edits over 60 s cost 6 writes on trunk. |
| `when a save fails > should report the failure, then give up and release the map past the retry horizon` | FAILS on the log assertion | Not a data-loss reproduction. Trunk logs the error without the map key and has no retry horizon. |
| `when a save fails > should stop retrying once the map was replaced or deleted` | PASSES | Guard for the new retry: trunk never retries. |
| `when an edit lands while a save is in flight > should not write the abandoned state after the map was replaced by an upload` | PASSES | Guard for the new follow-up write: trunk never starts one. |

## Not reproduced, not tested

- A write already in flight that lands after a delete or a replacement upload. It follows from the source on
  both trunk and head (`FileSystemInterface` has no cancellation) but no test asserts it.
- Any failure rate, latency, or ordering of a real disk or S3 backend.
