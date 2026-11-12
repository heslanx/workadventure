# P5 map save lifecycle contract

Scope: `map-storage/src/MapsManager.ts`. One lifecycle state per map key, held in `mapSaveStates`.
`FileSystemInterface` and its implementations are unchanged.

## Acknowledgement is not durability

An edit is acknowledged to the editor once it is applied to the in-memory WAM, exactly as on trunk. This
change does not make that acknowledgement durable. An acknowledged edit is still lost if the process stops
before its write succeeds, or if storage stays unavailable past the retry horizon.

## States

| State | Stored as | Meaning |
|---|---|---|
| clean | no entry | Storage holds the in-memory WAM, or the map is not loaded. |
| dirty | `status: "dirty"`, timer | Unsaved edits. A write starts when the timer fires. |
| saving | `status: "saving"`, `editedDuringWriteAt: undefined` | The only write of this map is in flight. |
| saving+dirty | `status: "saving"`, `editedDuringWriteAt` set | A write is in flight and already misses a newer edit. |
| retrying | `status: "retrying"`, timer, `failedAttempts > 0` | The last write failed. The next attempt starts when the timer fires. |

Every state other than clean carries `unsavedSince`, the time of the oldest edit not on storage.

## Transitions

| From | Event | To |
|---|---|---|
| clean | edit (`executeCommand` finished, even by throwing) | dirty, timer 15 s |
| dirty, retrying | edit | unchanged: the scheduled write saves the map as it is when it starts |
| saving | edit | saving+dirty |
| dirty, retrying | timer fires | saving (write starts with a snapshot of the current WAM) |
| saving | write succeeds | clean, then eviction check |
| saving+dirty | write succeeds | dirty, timer `max(0, 15 s - time since that write started)` |
| saving, saving+dirty | write fails, oldest unsaved edit younger than the horizon | retrying, timer 15 s |
| saving, saving+dirty | write fails, oldest unsaved edit at or past the horizon | clean (abandoned), then eviction check |
| any | `clearAfterUpload` (upload, delete) | clean, timer cancelled, map and queue dropped |

## Guarantees

1. **One write per map.** A write starts only from dirty or retrying and moves the state to saving. Nothing
   starts a write from saving. Exception: see "Upload and delete".
2. **A newer edit survives an older completion.** The edit is marked after the command ran, so a write that
   started while the command was executing is known to be stale. Only a write with no edit since its start
   makes the map clean.
3. **Follow-up write.** saving+dirty always ends in another write, with no further edit required. It starts
   one autosave interval after the previous write started, or at once if that write took longer. A map under
   continuous edition is therefore written at most once per 15 s, as on trunk.
4. **Retry without another edit.** A failed write is retried every 15 s (`AUTO_SAVE_INTERVAL_MS`), one
   attempt at a time, with the current WAM. The retry rate per map equals the trunk autosave rate, so an
   outage does not multiply storage calls.
5. **Unsaved maps stay loaded.** A map is evicted only when its command queue is empty and its state is
   clean. The check runs under the edition lock (kept from #5888, commit `55093ba2c`) when the queue empties and when the map
   becomes clean. Command history still expires 30 s after each command, whatever the save state.
6. **Clean maps are evicted as before**: at queue expiry on the healthy path.

## Retry horizon and memory bound

- `SAVE_RETRY_HORIZON_MS` is 1 hour, measured from `unsavedSince`.
- When a write fails and the oldest unsaved edit is that old, the save is abandoned: the state becomes clean
  and the map is evicted once its queue is empty. If the map is edited again it becomes dirty again and the
  whole current WAM, earlier edits included, gets a fresh horizon.
- An edit that lands during the very attempt that crosses the horizon is abandoned with the rest. It is
  saved only if another edit follows.
- Retained per unsaved map: its one `WamFile` and one state object. Edits do not accumulate: each write
  serializes the current WAM, and the command queue keeps its own 30 s expiry.
- Bound during an outage: the maps edited in the last hour, each held once. At most 240 attempts per map
  before abandonment.
- The 1 hour value is a proposal for maintainer review. It was not derived from a measurement.

## Failure exposure

Same channels as the rest of the package: `console.error` with an ISO timestamp, and Sentry.

- Every failed attempt: `console.error` with the map key, attempt number and unsaved age in ms.
- First failure of a streak: `Sentry.captureException` tagged `location: autosaveFailed`. Later attempts of
  the same streak are not sent, so an outage does not report every attempt of every map.
- Abandonment: `console.error` stating that unsaved changes are lost, and `Sentry.captureException` tagged
  `location: autosaveAbandoned` with `failedAttempts` and `unsavedForMs`.

No metric or health endpoint is added.

## Upload and delete

`clearAfterUpload(key)` stays synchronous and keeps its callers unchanged. It drops the map, its queue and
its save state, and cancels a pending save or retry timer.

- Guaranteed: no write of the invalidated in-memory map starts after `clearAfterUpload`. A completion of an
  older write no longer finds its state and changes nothing, including a state created later for the same key.
- Not guaranteed, same as trunk: a write already handed to storage before `clearAfterUpload` cannot be
  cancelled through `FileSystemInterface`. If it lands after the delete or the replacement upload, it
  restores the old file. If the reloaded map is edited and saved while that obsolete write is still in flight,
  two writes of the key overlap.
- Closing that window needs the upload and delete paths to wait for the in-flight write (for example an
  awaitable invalidation, or taking the edition lock around the storage mutation). That touches
  `UploadController` and `MapStorageServer` and is out of this change.

## Not covered

- Flush on process shutdown. Up to 15 s of acknowledged edits, plus anything retrying, is lost on exit, as
  on trunk.
- Several map-storage instances editing the same key.
- Backoff. The retry interval is constant.
