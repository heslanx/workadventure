# Draft review comment for workadventure/workadventure#6688 (NOT POSTED)

Target: PR #6688 "fix(pusher): cap what a socket keeps for a resume", head `04634ad3f38b5a74460911d2a7f2850258119aa3`.
Posting requires the user's explicit authorization. Attach `../P3/proposed-tests.patch` only if the author wants it.

---

Thanks for this. I reviewed `04634ad` against `master` and ran the tests and some store-level measurements. Summary below; I can push the tests to your branch or open them as a follow-up, whichever you prefer.

**Equivalence.** I ran a seeded differential trace (3 seeds × 200,000 random `add`/clock-advance/`getAll`/`getAfter`/`hasEveryNonceAfter` operations) against the store on `master`. `getAll`, `getAfter` and `hasEveryNonceAfter` on a non-empty store gave 0 mismatches. The only differences come from the intended change: an empty store queried by a peer that is behind the last added nonce. That change also fixes a pre-existing case. On `master`, a client whose missing messages all *expired* (no cap involved) is allowed to resume and silently misses them.

**One performance point (`NoncedMessageStore.pruneExpired`).** On the healthy path, steady traffic expires one message per `add()`. There, `splice(0, expired)` costs much more than the `shift()` it replaces. With one Node 24.22 process per implementation, 9 rounds of 1M adds, 10 frames/s and about 300 frames retained, the median ns per `add` was:

| Store | Run A | Run B |
|---|---|---|
| master | 110.6 | 95.8 |
| this PR, capped | 1,875.2 | 1,701.8 |
| this PR, uncapped (front configuration) | 1,743.1 | - |
| this PR with `if (expired > 0)` around the splice | 1,799.6 | 1,620.7 |
| this PR, `shift()` when `expired === 1`, else `splice` | 105.8 | 117.1 |

So the cost comes from `splice(0, 1)` itself, not from the caps. The store is also used uncapped by `WorkAdventureWebSocket` in the front. A small change keeps both the cheap common case and the bulk prune:

```ts
if (expired === 1) {
    // Steady traffic expires one message per add: shift() does not move the rest of the array.
    this.messages.shift();
} else if (expired > 1) {
    this.messages.splice(0, expired);
}
```

These are synthetic microbenchmarks with a fake clock. I did not measure event-loop impact on a running pusher.

**What the caps buy (same harness, 256-byte frames).** With 2,000 messages / 4 MiB, the store peaks at 2,000 messages and 512,000 bytes for bursts of 25k to 200k frames. `master` holds all 200k frames (51.2 MB of payload). Pruning 100k expired frames at once takes about 4.7 to 5.2 s on `master` (one `shift()` per message). The PR takes under 1 ms capped and about 8 ms uncapped. A 100-frame replay tail goes from about 1.4 to 6.7 ms down to 6 to 26 µs. I did not reproduce the 1 GB heap incident described in the PR. These figures are store-level only.

**A policy question.** If one frame over 4 MiB is queued while an earlier frame is still waiting for a drain, the store overflows and drops that frame, and the socket is closed with 4000. That happens even when the client is healthy and only slower than the burst. The same frame on an idle socket is still delivered. Is this intended for large map-editor payloads? If so, it may be worth one line in the PR description. I have a 3-test repro.

**Pre-existing, not caused by this PR.** A frame that waits for a drain longer than `CLIENT_DISCONNECTION_RETENTION_MS` is pruned and never sent. The client receives nonces 1 then 3 and is not closed. This behaves the same on `master` and on this branch, so it belongs in a separate issue. I have a 1-test repro.

**Proposed extra tests** (all pass on `04634ad`; Prettier and ESLint clean):

- the exact retention boundary (kept at `retention - 1` ms, gone at `retention`);
- resume refused after an expired prefix, and after every message expired;
- the byte cap reached exactly, and the store starting over after an overflow;
- an overflowing frame that uWS drops (send status 2) destroys the session;
- after an overflow, a caught-up client resumes only if it got every dropped frame, and the replay is in order;
- an overflow while the transport is down: no close, and the resume is refused with 1008;
- a single frame larger than the byte cap is delivered but not kept for a resume;
- controller level: a backpressured overflow closes with 4000, removes the logical connection, and the tab can join again with a new connection id.

With the empty-store rule mutated back to `return true`, 3 of these tests fail. They do pin the new refusal behaviour.

Not covered on my side yet: a typecheck with the extra tests, and live runs against a real pusher (resume and refusal at load, 1,000 sessions with slow consumers).
