# P3 review: upstream PR #6688 "fix(pusher): cap what a socket keeps for a resume"

- Reviewed head: `04634ad3f38b5a74460911d2a7f2850258119aa3` (PR base `master` at `baf3a336be2e`). Local baseline: `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`.
- State at check time (2026-11-11 23:52-23:59 UTC): open, ready, no review, CI green (`../research/upstream-duplicates.md`).
- Diff: `pr-6688-04634ad.diff` (3 files). PR-head copies: `pr-head/play/...`. Nothing was posted upstream.
- Incident figures in the PR (the 2026-09-08 pusher with a 1 GB heap) are maintainer reports. They were **not reproduced locally**.

## 1. Insertion, expiry and retrieval equivalence with the baseline

What changed without changing intent:

- `add()` still prunes first and appends `{nonce, payload, storedAt}` (`pr-head/play/src/common/NoncedMessageStore.ts` around line 25).
- `getAfter()` walks back from the end instead of filtering the whole array. It relies on nonces being added in increasing order. `PusherWebSocket.send()` and `WorkAdventureWebSocket` both use a monotonic counter.
- `pruneExpired()` counts the expired prefix and runs one `splice(0, expired)` instead of a `shift()` per message (line 82). The expiry rule is unchanged: a message is kept while `storedAt > now - retentionMs`.
- `has(nonce)` was removed. It has no caller at the baseline (`rg NoncedMessageStore play/src`).

Evidence: a seeded differential trace (`proposed/bench.mts`, seeds 1-3, 200,000 random operations each) compared the baseline store with the PR store. It found 0 mismatches for `getAll`, `getAfter` and `hasEveryNonceAfter` on a non-empty store. The only mismatches (409, 345 and 372) are the intended change: an empty store queried by a peer behind the last added nonce (`micro-measurement.json`, `differential`).

## 2. New behaviour: count/byte cap and resume refusal

- `NoncedMessageStore(retentionMs, maxMessages = Infinity, maxBytes = Infinity)`. When an `add()` pushes the store over a cap, the store clears everything, including the new message, and returns `false`.
- `hasEveryNonceAfter()` on an empty store now returns `lastReceivedNonce >= lastAddedNonce` instead of `true` (line 62). This is a correctness fix in its own right: at the baseline, a client whose missing messages all *expired* gets a resume with silent loss. The proposed test "refuses a resume that needs an expired message once every message expired" covers it.
- Only the pusher passes caps: `RESUME_STORE_MAX_MESSAGES = 2_000` and `RESUME_STORE_MAX_BYTES = 4 MiB` per socket (`PusherWebSocket.ts`). The front (`play/src/front/Connection/WorkAdventureWebSocket.ts:47`) stays uncapped, but it gets the new store implementation and the new empty-store rule.

### Close codes and fresh join

| Situation at overflow | Pusher action | Client outcome |
|---|---|---|
| Transport up, frame handed to uWS (send status 0 or 1) | none | Session continues. The replay history is gone, so a later resume needs `lastReceived >= lastAddedNonce` |
| Transport up, the new frame waits for a drain, or uWS drops it (status 2) | `socket.end(4000 WS_CLOSE_CODE_SESSION_DESTROYED)` through `closeAfterLostMessages()` (line 337-351) | The close handler destroys the session. The front does not resume on 1000, 1008 or 4000 (`WorkAdventureWebSocket.ts:208`) and joins from scratch |
| Transport down | no close (nothing to close) | The resume is refused: `replaceSocket()` ends the new socket with `1008` "server is missing messages to replay". The retention timeout cleans up the old session |

`closeAfterLostMessages()` deliberately calls the raw `socket.end()` instead of `this.end()`, so that `SocketManager.cleanupSocket()` still removes the user from the room. The proposed controller test pins this: after the 4000 close, the context is gone and a new connection id opens a fresh context.

## 3. Findings

| # | Severity | Where | Finding | Evidence |
|---|---|---|---|---|
| F1 | Medium (performance) | `pr-head/play/src/common/NoncedMessageStore.ts:82` | On the healthy path (about 10 frames/s, about 300 frames retained, one expiry per `add`), `splice(0, 1)` costs about 16 times more than `shift()`. The new cost also hits the uncapped front store | `micro-measurement-2.jsonl` (one process per implementation, 9 rounds of 1,000,000 adds). Median ns per add: baseline 110.6 and 95.8; PR head capped 1,875.2 and 1,701.8; PR head uncapped 1,743.1. Adding an `expired > 0` guard does not help (1,799.6 and 1,620.7). Using `shift()` when `expired === 1` restores 105.8 and 117.1 (`proposed/variants/NoncedMessageStore.shift-one.ts`). The earlier in-process run (`micro-measurement.json`, `steady`) was noisy: median 473.5 vs 106.3, range 115-912 |
| F2 | Low (policy to confirm) | `PusherWebSocket.ts` `send()` | A frame larger than 4 MiB that arrives while an earlier frame waits for a drain overflows the store. That frame is lost and the session is destroyed with 4000, even if the client is healthy and only slower than the burst. One over-cap frame sent on an idle socket is still delivered. The PR description does not state this | `proposed/OverCapFrameRepro.test.ts`, 3 tests passed on the PR head (`logs/run6-pr-head-final.filtered.log`). Relevant to large map-editor payloads (plan lane 8) |
| F3 | Pre-existing, not introduced by the PR | `PusherWebSocket.handleDrain()` plus store expiry | A frame that waits for a drain longer than `CLIENT_DISCONNECTION_RETENTION_MS` is pruned and never sent. The client receives nonce 1, then 3, with no close. The PR does not change it | `proposed/DrainExpiryRepro.test.ts` passed unchanged on the baseline (`logs/run6-baseline-drain-expiry.filtered.log`, 1/1) and on the PR head (final log) |
| F4 | Test gap, filled | `pr-head/play/tests/pusher/NoncedMessageStore.test.ts` | The PR tests did not cover: the exact retention boundary, resume refusal after every message expired, byte-cap equality, an overflow frame dropped by uWS (status 2), resume after an overflow, overflow while disconnected, delivery of a single over-cap frame, or the controller-level 4000 close and fresh join | `proposed-tests.patch` adds 8 store/socket tests and 1 controller test |

No correctness defect was found in the cap or refusal logic itself.

## 4. Tests that ran

Environment: a container snapshot of the PR head at `/work` with Node v24.22.2. The host was not recorded in the artifacts. The filtered logs keep the vitest summaries but not the shell exit codes. Vitest exits nonzero when any test fails, so exit codes below are inferred from the summaries.

| Run | Scope | Result | Inferred exit |
|---|---|---|---|
| run1 (`logs/run1-pr-head-tests.filtered.log`) | Unmodified PR-head tests: `NoncedMessageStore`, `PusherRoomSocketController`, `WorkAdventureWebSocket` | 3 files, 25/25 passed | 0 |
| run4 (`logs/run4-mutation-empty-store.filtered.log`) | Proposed tests against a mutated store where the empty-store branch of `hasEveryNonceAfter` returns the baseline `true` | 3 failed, 29 passed (32), "expected true to be false". The proposed tests catch a regression to the baseline rule | 1 (expected) |
| run6 baseline (`logs/run6-baseline-drain-expiry.filtered.log`) | `DrainExpiryRepro` on the baseline | 1/1 passed | 0 |
| run6 final (`logs/run6-pr-head-final.filtered.log`) | PR head with `proposed-tests.patch` plus both repros, 5 files | 38/38 passed | 0 |
| run6 lint (`logs/run6-prettier-eslint.log`) | Prettier and ESLint on the changed test files | Prettier clean. ESLint clean after two fixes in the controller test (`no-void`, `no-misused-promises`) | 0 after the fixes |

Not run: `play` typecheck (`svelte-check` or `tsc`) at the PR head with the proposed tests. This plan item stays open.

## 5. What the micro-measurement shows, and its limits

Store-level only (`micro-measurement.json` `storm`; 256-byte synthetic frames, fake clock):

- Memory bound holds. With the pusher caps, peak retention is 2,000 messages and 512,000 payload bytes at 25k, 50k, 100k and 200k frames. The uncapped baseline reaches 200,000 messages and 51.2 MB of payload (heap delta 54.9 MB). At 100k frames in separate processes (`micro-measurement-2.jsonl`), RSS grows by 64.7-65.1 MB at the baseline vs 11.0-16.8 MB with caps.
- Pruning a large backlog gets much cheaper. Pruning 100k frames at once takes 4,663-5,223 ms at the baseline (one `shift()` per message) vs 0.2-0.4 ms capped and 7.6-8.9 ms uncapped. At 200k frames: 20,142 ms vs 57 ms uncapped.
- A replay tail of 100 frames costs 1,431-6,747 µs per call at the baseline vs 6-26 µs at the PR head.
- The cost: the healthy-path `add` regression in F1.

Limits: synthetic microbenchmarks in one container with a fake clock. There is no uWS, no network, no real client, no event-loop lag measurement and no 1,000-session load. Single-round heap and arrayBuffer deltas are GC-noisy (one capped 200k run shows a negative arrayBuffer delta). F1 is a relative per-call cost. At 1,000 sockets × 10 frames/s it would be roughly 17 ms of CPU per second (about 1.7% of a core). That figure is extrapolated, not measured.

## 6. What remains

- Live lanes 1-10 in `../../plans/upstream-pr-plan.md` (P3 section) were not run. They need the P1 load harness against a pusher at the baseline and at `04634ad`: disconnect/resume, exact-cutoff expiry, count and byte overflow (healthy, backpressured and disconnected), large map-editor payload, fresh join after refusal, and 1,000 sessions with mixed slow consumers.
- Perf rule check: the plan requires no repeatable healthy-path regression above 5%. F1 fails that rule at the store level until the shift-one variant (or an equivalent) is adopted and re-measured at the PR head.
- Typecheck at the PR head with the proposed tests.
- Maintainer answer on F2 (is a 4000 close intended for a healthy client receiving more than 4 MiB during backpressure?).
