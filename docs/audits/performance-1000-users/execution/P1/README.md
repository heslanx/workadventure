# P1 - headless room load generator (lanes P1-harness and P1-live)

Status: the harness has joined a real WorkAdventure stack. Lanes 2 to 7 passed on 2026-11-12 between 00:36 and
00:42 UTC. Lane 3 passed only with a headless observer; the plan asks for a real client. Lanes 8, 9 and 10 have not
run. The largest run was 100 sessions in one room on a capped, shared 4-vCPU host. It shows nothing about capacity
at 1,000 users.

## Live lanes (host `sbh`, stack `wa-fable-stack`, baseline `ddbe245a8`)

The checkout's `benchmark/` was copied into the stack's source tree and checked by sha256
(`live-run-receipts.txt` section 1). Every run used one `node:24-trixie` container on `wa-fable-net` with 1 CPU and
1 GB (`--cpu-shares 512`), `WA_PUSHER_URL=http://wa-fable-stack-play:3000`, `WA_WS_URL=ws://wa-fable-stack-play:3001`,
the room `http://wa-fable-stack-play:3000/_/global/wa-fable-stack-maps/starter/map.json` and `WA_API_VERSION=dev`,
unless the table says otherwise. Each lane file has the full command, exit code and harness summary.

| Lane | File | Workload | Result | Verdict |
|---|---|---|---|---|
| 2 | `lane-2.json` | 1 session, 6 s, 2 Hz | accepted 1 (one `roomJoinedMessage`), rejected 0, reconciled, exit 0 | PASS |
| 3 | `lane-3.json` | idle observer process (22 s) and a mover process (8 s, 2 Hz) started 6 s later in the same room | mover sent 15 `userMovesMessage`; the observer received 15 `userMovedMessage`, 1 `userJoinedMessage`, then 1 `userLeftMessage` after the mover closed; both exit 0 | PARTIAL: protocol delivery shown by a headless observer; the plan criterion (a real client sees the expected position) is PENDING |
| 4 | `lane-4.json` | 10 sessions, 5 s ramp, 24 s, 2 Hz | accepted 10, 10 unique user ids; back `workadventure_nb_clients_per_room` 10 and pusher `workadventure_nb_sockets` 10 at t=16 s, 0 before and after; exit 0 | PASS |
| 5 | `lane-5.json` | 1 session, `WA_API_VERSION=wrong-version`, `WA_MIN_ACCEPTED=0` | rejected 1 as `errorScreenMessage:NEW_VERSION`, accepted 0, no latency sample, exit 0 | PASS |
| 6 | `lane-6.json` | 10 sessions over a 10 s ramp, stopped at 3 s | started 4, never started 6, accepted 3, aborted before join 1; sockets 3 opened and 3 closed; 0 open sockets and 0 timers at the end; the process exited without a signal (4.59 s including container start); exit 0 | PASS |
| 7 | `lane-7.json` | 100 sessions, 20 s ramp, 60 s, 1 Hz, one room | accepted 100, 100 unique ids, 0 errors, 0 unexpected closes; server gauges 100 and 100 at t=30 s; 4946 moves sent against about 5010 expected | PASS; generator not saturated |

### Lane 7 checkpoint at 100 sessions

| Metric | Value |
|---|---|
| Join latency, token request included | p50 18.6 ms, p95 308.7 ms, max 987.1 ms (max = the first join, which creates the room) |
| Events received, all sessions | `groupUpdateMessage` 104,956, `userMovedMessage` 101,342, `userJoinedMessage` 9,623, `userLeftMessage` 7,353, `groupDeleteMessage` 3,111; 29,679 frames, 5.83 MB |
| Generator | 6.3% of one core over the run, RSS peak 167 MiB, event-loop lag p99 13.6 ms and max 49.8 ms (resolution 10 ms) |
| `docker stats` at t≈15/30/45 s | pusher 13.3 / 17.7 / 13.4% CPU (cap 65%), 249-303 MiB; back 5.0 / 4.6 / 5.8% (cap 65%), 221-225 MiB; generator 7.7 / 8.3 / 6.5% |
| Host load average | 3.7-5.1 on 4 vCPU during the run |

Rule fixed before the run: reject it if the generator used more than 80% of its 1-CPU cap or had event-loop lag p99
above 50 ms. It used neither.

**Limits.** The generator and the server shared one 4-vCPU host (AMD EPYC 9354P VM, 15 GB) with production services
and a sibling lane container. The pusher and the back were each capped at 0.65 CPU and ran in dev mode
(`tsx watch`). The bots are headless protocol clients: no rendering, no audio, no video, no Matrix, no map editor.
Everything ran in one room on one map. Most `userLeftMessage` and `userJoinedMessage` events in lanes 4 and 7 come
from bots moving in and out of each other's watched zones. During the runs the server gauges held at 10 and 100,
and no session closed unexpectedly. The closes at the end of each run produce the rest. The harness does not
separate the two causes.

## Harness defects found live

None. Every lane behaved as the unit tests predicted, so no harness file changed after the copy to `sbh`. The open
questions in `HARNESS-CONTRACT.md` were settled:

1. `/anonymLogin` took 100 logins in 20 s with no rejection.
2. The WebSocket upgrade succeeds without an `Origin` header.
3. The stack's `apiVersionHash` is `dev`.

The harness counts event types per process. It checks neither the coordinates of an observed move nor the user
id in a `userLeftMessage`, so lane 3 needed a separate observer process.

## Earlier evidence (lane P1-harness, receipts in this directory)

| Evidence | File | Result |
|---|---|---|
| Trunk entry point | `lane-1-trunk-failure.txt` | Two runtime attempts hit the timeout wrapper (exit 124) under container load. Static evidence shows the imported module is missing and the call signature is obsolete. No runtime error text was captured. |
| Unit tests (knc) | `unit-and-typecheck.txt` | `vitest run tests/harness.test.ts`: 12 passed, exit 0 (vitest 4.1.12) |
| Unit tests (sbh, files used live) | `live-run-receipts.txt` | 12 passed, exit 0 (vitest 4.1.7, Node 24.22.2) |
| Typecheck | `unit-and-typecheck.txt` | `tsc --noEmit --strict …` exit 0 |
| Mutation check | `unit-and-typecheck.txt` | Dropping the errorScreenMessage→rejection mapping fails 2 tests (exit 1); reverted |
| Entry point smoke | `entrypoint-smoke.txt` | no config → usage, exit 1; refused port with 2 sessions → rejected 2, accepted 0, reconciled, exit 2 |

The `npm test`, `npm run typecheck` and `npm start` scripts have still not run inside the checkout itself:
`wa-fable-local` is saturated. The same files ran on remote trees, with the same packages resolved from the root
`node_modules`.

## Remaining

1. Lane 3 with a real browser watching a bot move, if the plan keeps "real client" as its pass criterion.
2. Lane 8 (two rooms, check that no events cross rooms), lane 9 (part of the population disconnects mid-run) and
   lane 10 (distributed ramp at 250, 500 and 1,000 sessions, on hosts that do not share CPU with the server).
3. Coordinator: apply `manifest-requests.md` (declare `tsx`, `vitest`, `@types/node` for the benchmark workspace).
4. Re-run `cd benchmark && npm test -- tests/harness.test.ts && npm run typecheck` in the checkout once
   `wa-fable-local` responds.
5. Lint/format: `benchmark/` has no eslint or prettier script. The files follow the repo style (4 spaces, 120
   columns), but no tool has checked them.

## Resources

- Released: stack `wa-fable-stack` on `sbh` (`docker compose … down` at 00:44 UTC). Its 4 containers and the
  network `wa-fable-net` are gone. Only `wa-fable-h8` and `wa-fable-svelte` keep the owner label
  (`live-run-receipts.txt` section 4). The generator and probe containers were all `--rm`.
- Retained: `sbh:~/wa-jobs/wa-fable-20261111/p1-live/` holds the runner scripts and raw lane outputs, the source of
  the lane files. Remove it with `ssh sbh 'rm -rf ~/wa-jobs/wa-fable-20261111/p1-live'`.
- Modified and retained: `sbh:~/wa-jobs/wa-fable-20261111/src-wa-fable-stack/benchmark/` now holds the checkout's
  harness (`index.ts`, `README.md`, `package.json`, `src/`, `tests/`), not the baseline. It goes with the job root.
- Retained by lane P1-harness: `knc:~/wa-jobs/wa-fable-20261111/src-wa-fable-p1/`. Remove it with
  `ssh knc 'rm -rf ~/wa-jobs/wa-fable-20261111/src-wa-fable-p1'`.
