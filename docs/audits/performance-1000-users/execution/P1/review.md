# P1 independent review (headless room load generator)

Reviewer: independent lane, did not write the change. Reviewed 2026-11-12 00:47-00:58 UTC against baseline
`ddbe245a8`. Scope: `benchmark/index.ts`, `benchmark/src/*.ts`, `benchmark/tests/harness.test.ts`,
`benchmark/README.md`, `benchmark/package.json`, and the lane receipts in this directory.

**Verdict: PASS_WITH_NITS.** No blocker. Three majors must be fixed or re-labelled before an upstream
handoff or lane 8: the cross-room `uniqueUserIds`, the lane 3 verdict, and the undeclared script dependencies.

## Checks run by this review

| # | Command (abridged) | Exit | Result |
|---|---|---|---|
| 1 | `shasum -a 256` on the 9 benchmark files (checkout) vs `sha256sum` of the same paths in `sbh:~/wa-jobs/wa-fable-20261111/src-wa-fable-stack` | 0 | all 9 equal (same digests as `live-run-receipts.txt` §1); no rsync needed |
| 2 | same for `libs/messages/src/ts-proto-generated/messages.ts` and `libs/messages/src/JsonMessages/ApiVersion.ts` | 0 | equal: `944acfdc…`, `a2f0fe0e…` |
| 3 | `docker run --rm --name wa-fable-p1rev --label owner=wa-fable-20261111 --cpus 1 --memory 1g --cpu-shares 512 --network none -v …/src-wa-fable-stack:/work -w /work/benchmark node:24-trixie /work/node_modules/.bin/vitest run tests/harness.test.ts` | 0 | 12 passed (vitest 4.1.7, Node 24.22.2), 00:48:41 UTC, 3.92 s |
| 4 | same container: `tsc --noEmit --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --types node index.ts tests/harness.test.ts` | 0 | no errors |
| 5 | `node -e` nearest-rank check: `Math.ceil(p*n)` vs exact integer rank, p ∈ {0.5, 0.95, 0.99}, n = 1..2000 | 0 | 0 mismatches |
| 6 | `node -e` idle `monitorEventLoopDelay({resolution:10})` for 1.5 s (local Node 26.10.0) | 0 | min 9.30 ms, p50 11.20 ms, p99 17.32 ms |
| 7 | `ssh sbh docker ps -a --filter name=wa-fable-p1rev` | 0 | empty: the review container is gone |

The checks did not run inside the checkout itself: `wa-fable-local` is saturated (brief).

## Refutation attempts that failed (the code holds)

1. **Authoritative acceptance.** A session becomes `accepted` only on a top-level `roomJoinedMessage`, and only
   from `connecting` (`benchmark/src/session.ts` `accept()`, `nextState`). The back writes `roomJoinedMessage`
   after `GameRoom` created the user (`back/src/Services/SocketManager.ts:242-251`, `back/src/Model/GameRoom.ts:305`);
   the pusher forwards it (`play/src/pusher/services/SocketManager.ts:285`). An open socket is counted separately
   (`RunStats.socketOpened`). Live corroboration: lane 4 back gauge 10 = pusher gauge 10 = accepted 10.
2. **Rejection.** A refused upgrade is upgraded, sent one nonce-1 frame and closed 1000
   (`play/src/pusher/services/PusherRoomSocketController.ts:267-277`, `IoSocketController.ts:486-505`). The harness
   maps `errorScreenMessage`, `tokenExpiredMessage`, invalid texture, `worldConnectionMessage`, `banUserMessage`
   to `rejected`; a top-level `errorMessage` is an error and the following close gives
   `closed_before_join:<code>`, also `rejected`. The lane's mutation receipt shows the tests catch a dropped mapping.
3. **Envelope.** Client frames are `FrontToPusherWebSocketMessage{nonce, message:{message}}` with nonce 1, 2, …;
   the pusher drops `nonce <= lastReceivedNonce` starting from 0 (`play/src/pusher/services/PusherWebSocket.ts:34,
   117-131`). Server pings arrive as `pingMessage` inside `batchMessage` (`back/src/RoomManager.ts:312-322`); the
   harness answers `pingMessage`, like the browser (`play/src/front/Connection/RoomConnection.ts:442-445,
   2091-2097`). Protocol-level pings are answered by `ws`. The query string matches the validator
   (`IoSocketController.ts:257-269`). The codec file used remotely equals the checkout's (check 2).
4. **Reconciliation.** `started = accepted + rejected + abortedBeforeJoin`; `requested = started + neverStarted`.
   The three buckets are mutually exclusive: `accept`/`reject` are guarded by `connecting`, and
   `abortedBeforeJoin` is counted only on `connecting → leaving`. `errors` is an event counter, not a session
   bucket; an error on a connecting session also produces a rejection.
5. **Early stop.** Every timer goes through `TimerRegistry`; `leave()` clears join and move timers, `finish()`
   the close timer, the runner clears ramp/early-leave/completion/RSS timers, and `cleanup.activeTimers` is
   reported without a blanket `clearAll()`. A socket still handshaking is aborted by `close()` and its error is
   ignored in `leaving`. The run awaits every started session's `closed` promise. Unit test
   `harness.test.ts:220-235` (abort at 700 ms) passed in check 3; live lane 6 shows 0 sockets and 0 timers.
6. **Percentiles.** Nearest rank, `null` on an empty sample, `max` = rank n (`benchmark/src/stats.ts:8-15`).
   Check 5 found no floating-point off-by-one for n ≤ 2000.
7. **Dependencies.** `git diff -- benchmark/package.json` changes `scripts` only. `benchmark/package-lock.json`
   and `benchmark/yarn.lock` are unchanged. The root `package-lock.json` is modified in the shared checkout, but
   its hunks are `svelte`, `@jridgewell/sourcemap-codec`, `@sveltejs/acorn-typescript`, `acorn`, `devalue`,
   `esrap`, `@types/unzipper`, etc.: none touches `benchmark`. Not attributable to P1.
8. **Receipts vs code.** Every field in `lane-2..7.json` exists in the `runLoad` summary schema. Lane 7: sent
   4946 `userMovesMessage` vs Σ(60 − 0.2·i) for i = 0..99 = 5010 expected at 1 Hz; the 1.3 % gap fits join
   latency plus the `setInterval` floor. Lane 6 `closeCodes {"1000":3}` with `abortedBeforeJoin 1` fits a 4th
   session still in its token request. The README states that 100 sessions on a shared 4-vCPU host shows nothing
   about 1,000 users; no capacity claim found.

## Findings (ranked)

### 1. major: top-level `sessions.uniqueUserIds` is wrong for multi-room runs

- File: `benchmark/src/runner.ts:95` and `:115`; masked by `benchmark/tests/harness.test.ts:34,63,194`.
- The runner flattens the per-room id sets into one `Set<number>`. The back assigns ids per room
  (`back/src/Model/GameRoom.ts:100` `private nextUserId = 1`, incremented at `:305`), so two rooms both hand out
  2, 3, 4, … Example: `--room-urls=A,B --sessions=10`, all accepted → per-room `uniqueUserIds` 5 and 5, top-level
  `uniqueUserIds` 5 while `accepted` is 10.
- The fake pusher uses one global `lastUserId` across rooms, and the test asserts `uniqueUserIds: 3` over two
  rooms, so the suite encodes the wrong assumption.
- Impact: lane 8 ("counts match") would show a false mismatch. The error understates; it cannot inflate a
  result. Lanes 2-7 used one room and are unaffected.
- Fix: key the set by room (`${roomUrl}#${userId}`) or drop the top-level field; give the fake pusher a
  per-room counter.

### 2. major: lane 3 is reported as PASS, but its plan criterion was not observed

- File: `docs/audits/performance-1000-users/execution/P1/README.md:3` ("Lanes 2 to 7 passed") and `:19`.
- The plan (`upstream-pr-plan.md:79`) requires that "a second real client observes the expected position". The
  observer was a headless harness process. The harness counts event types only: `handleFrame` never reads
  coordinates or ids (`benchmark/src/session.ts`, `decodeServerFrame` keeps `$case` only). The position in
  `lane-3.json` ("about x=1558 y=1144") is computed from `positionAt`, not observed.
- Impact: even the headless observation shows that moves arrived, not where they landed.
- Fix: report lane 3 as PARTIAL/open in the README status line and table. The README already says the
  real-browser check is open.

### 3. major (upstream readiness): scripts call binaries the package does not declare

- File: `benchmark/package.json:6-8` (`tsx`, `vitest`, `tsc` with `--types node`) vs `:24-29` (declares `ts-node-dev`,
  `typescript`, `ws`, `@types/ws`, `@workadventure/messages`).
- `tsx`, `vitest` and `@types/node` resolve only through root workspace hoisting. `ts-node-dev` stays declared and
  unused. The lane filed `manifest-requests.md` and did not edit dependency fields, as instructed.
- Impact: an upstream reviewer sees scripts that depend on other workspaces' devDependencies.
- Fix: coordinator applies `manifest-requests.md` before handoff.

### 4. minor: `--disconnect-fraction` skips sessions that have not started yet, and nothing counts planned leaves

- File: `benchmark/src/runner.ts:59-68`; `benchmark/src/session.ts:135` (`leave()` returns on `idle`).
- Example: `--sessions=100 --ramp-seconds=60 --duration-seconds=60 --disconnect-fraction=1` → leave at 30 s;
  sessions 50-99 are still `idle`, so `leave()` does nothing. Their ramp timers then start them and they stay
  until the end.
- The summary also has no counter for sessions that left early as planned. For lane 9 ("membership and
  error/close counters reconcile"), the expected membership after the leave cannot be read from the summary.
- Lane 9 has not run, so no receipt is affected.

### 5. minor: `eventLoopLagMs` includes the 10 ms sampling interval

- File: `benchmark/src/runner.ts:26` and `:147-152`.
- Check 6: an idle loop reports p50 11.2 ms and min 9.3 ms at `resolution: 10`. Lane 7's "p99 13.6 ms" is
  therefore about 3-4 ms of real lag. The 50 ms rule errs on the safe side, but the label overstates lag by
  about 10 ms. Document it or subtract the resolution.

### 6. minor: the README points to a multi-process script that the new harness cannot use as written

- File: `benchmark/README.md:79-81` → `benchmark/benchmark_multi_core.sh` (unchanged).
- The script runs `yarn run start` four times with no flags (the repo uses npm workspaces). With the config in
  the environment, the four processes share session indexes 0..N-1: same `bot-<i>` names, identical
  deterministic paths and, with `WA_OUTPUT` set, one output file overwritten four times. No index-offset flag
  exists. This is not usable for lane 10 as documented.

### 7. minor: the session part of `reconciled` holds by construction

- File: `benchmark/src/runner.ts:155-159`.
- As refutation item 4 shows, the session identity is always true unless a guard breaks. `reconciled`
  therefore detects socket/timer leaks and harness bugs, not a client/server membership mismatch. Server-side
  membership must come from the gauges, as lanes 4 and 7 did. Worth one README sentence.

### 8. minor: the SIGINT/SIGTERM path is not verified live

- File: `benchmark/index.ts` (signal handlers); `benchmark/README.md:67`.
- Lane 6 stopped through `--duration-seconds=3` < ramp (`stopReason: "completed"`), not through a signal. The
  abort path is covered only by the unit test (`harness.test.ts:220-235`).

## Resources

- Started and released: container `wa-fable-p1rev` on `sbh` (`--rm`, `--network none`, 1 CPU / 1 GB,
  `--cpu-shares 512`, owner label); absent at 00:52:58 UTC (check 7).
- Local temp file `/tmp/p1rev-run.txt` (check 3-4 output): deleted after this review was written.
- No file changed on `sbh` or `knc`; no product file changed in the checkout. Only this file was written.

## Coordinator follow-up (01:03 UTC)

- Finding "uniqueUserIds is wrong for multi-room runs" (major, `benchmark/src/runner.ts:95`): fixed. The top-level count is now the sum of the per-room id sets, because the back numbers users per room. Checked on the sbh tree after a checksum match with the checkout (`37d2fd75…`): `vitest run tests/harness.test.ts` 12 passed, exit 0; `tsc --noEmit` exit 0. No multi-room regression test was added in this window. Lanes 2 to 7 used one room, so their receipts are unaffected.
- Finding "lane 3 reported as PASS" (major): the README row now reads PARTIAL with the real-client criterion PENDING.
- Finding "tsx, vitest and @types/node are not declared" (major): still open. Declaring them changes the root npm workspace lockfile (`benchmark` is a root workspace), which needs an `npm install` that cannot run in this checkout while another task's stack bind-mounts its `node_modules`. This blocks upstream handoff of P1 until done.
- Minor findings: not addressed in this window.
