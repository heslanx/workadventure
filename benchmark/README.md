# Headless room load generator

Opens real `/ws/room` WebSocket sessions against a WorkAdventure play/pusher service, using the `ws` package and
the generated protobuf codecs (`libs/messages/src/ts-proto-generated`). No browser, no Phaser, no media.

**What it does not measure.** The bots speak the room protocol only. A run certifies neither client rendering
(FPS, memory of a real tab) nor audio/video (WebRTC, LiveKit) performance, and a passing run is not a capacity
claim: read the server metrics next to the summary.

## Session model

Each session follows the handshake of the real client:

1. `POST <pusher>/anonymLogin` returns `{ authToken }` (skipped with `--auth=none`).
2. WebSocket to `<ws>/ws/room?roomId=…&version=…&tabId=…&…`, the token sent as the WebSocket subprotocol.
3. The pusher sends `roomConnectedMessage`; the bot answers `joinRoomFrontMessage`.
4. The pusher sends `roomJoinedMessage`: only now is the session **accepted**.

Every frame is wrapped in the nonce envelope (`FrontToPusherWebSocketMessage` / `PusherToFrontWebSocketMessage`).
A refused upgrade is still upgraded by the pusher, which then sends one error message and closes with code 1000:
that is a **rejected** session, never an accepted one.

```
connecting ──roomJoinedMessage──▶ accepted ──▶ leaving ──▶ closed
     └─error message / socket error / close / join timeout──▶ rejected ──▶ leaving ──▶ closed
```

Accepted room sessions and open sockets are counted separately. The bot answers server pings, sends one
`viewportMessage` after joining and then `userMovesMessage` at `--move-hz` along a deterministic path
(same global bot index, same path; see `--pattern`), and leaves with close code 1000.

## Scenario

The defaults reproduce the baseline runs: every bot walks the same ellipse at `--move-hz`, with a 640 x 400 viewport,
and never joins the world space. The flags below change the load without changing that default, so old numbers stay
comparable. Everything that picks a bot (path, walker, world-space role) depends only on its *global* index, the
session index plus `--index-offset`, so the same bot behaves the same in any process.

| Flag | Default | Meaning |
|---|---|---|
| `--viewport` | `bot` | What the camera reports to the pusher: `bot` is the 640 x 400 box of the baselines; `browser` is a 960 x 540 canvas plus the 300 px margin the client adds on each side, clipped to the 2752 x 1792 map; `zoomout` is the whole map |
| `--pattern` | `ellipse` | `ellipse` is the baseline path (736 x 545 px around (1056, 745)); `ring` a 300 px circle around the same centre, 36 px per move; `plaza` laps of the Plateia rectangle (192, 416, 416 x 544) on four lanes; `walk-stop` stop and go over the whole floor: 12 moves to the next stop, then 5 to 30 silent ticks, the last move of a leg carrying `moving=false` |
| `--moving-fraction` | `1` | Share of the bots that walk. The others join, report their viewport and send nothing. The selection is spread evenly over any run of consecutive indexes: 20% of 250 bots is 50 +- 2 |
| `--world-space` | `0` | Share of the bots (`0`..`1`, also `on`/`off`) that subscribe to the user list of the `allWorldUser` space. Joining and subscribing are what `GameScene` and `Space` send: a `joinSpaceQuery` (ALL_USERS, `availabilityStatus` and `chatID`), then an `addSpaceFilterMessage` once it is answered |
| `--world-members` | `1` when `--world-space` is above 0, else `0` | Share of the bots that join the space. The watchers are part of it, so it cannot be lower than `--world-space`. `--world-members=1` alone measures members that never subscribe to the roster |
| `--index-offset` | `0` | Added to every session index for the name (`<prefix>-<global index>`), the path and the roles. Give each generator process its own range |
| `--steady-window` | `0` (whole run) | Seconds at the end of the run that traffic, delivery, latency and the per-type bytes cover. Must fit after the ramp: at most duration minus ramp |
| `--metrics-urls` | none | Comma-separated Prometheus `/metrics` URLs, scraped when the window starts (or at the start of the run), every 5 s and once more at the stop |

A pattern is a pure function of the global index and the step, so the probe can recompute it. `ring` and `plaza`
repeat exactly after 52 and 54 moves and the probe looks back one move fewer than that (a move delayed by a whole lap,
about 10 s at 5 Hz, is reported as unmatched). `walk-stop` never repeats on purpose, but two legs can cross on the
same pixel: then the later send takes the arrival, which affects at most a few moves in a thousand.

## Run

Needs Node 24 and the workspace dependencies installed from the repository root (`npm install`).

```bash
cd benchmark
npm start -- \
  --pusher-url=http://play.workadventure.localhost \
  --room-urls=http://play.workadventure.localhost/_/global/maps.workadventure.localhost/tests/E2E/empty.json \
  --sessions=10 --ramp-seconds=5 --duration-seconds=30 --move-hz=2 \
  --output=./summary.json
```

Every flag is also an environment variable (`--ramp-seconds` is `WA_RAMP_SECONDS`); flags win.

| Flag | Default | Meaning |
|---|---|---|
| `--pusher-url` | required | http(s) base URL of the play/pusher service |
| `--ws-url` | `--pusher-url` | WebSocket base URL when it differs (http→ws is applied automatically) |
| `--room-urls` | required | Comma-separated room URLs; session `i` joins room `i mod rooms` |
| `--sessions` | required | Number of sessions to start |
| `--ramp-seconds` | `10` | Session `i` starts at `i × ramp / sessions` |
| `--duration-seconds` | `60` | Total run time, ramp included. Shorter than the ramp stops mid-ramp |
| `--move-hz` | `1` | Movement messages per second per accepted session, `0` for idle |
| `--join-timeout-seconds` | `30` | Not joined in time counts as rejected (`join_timeout`) |
| `--close-timeout-seconds` | `5` | A socket that does not close in time is terminated |
| `--auth` | `anonymous` | `anonymous` or `none` |
| `--api-version` | `apiVersionHash` of this checkout | Must equal the pusher's `apiVersionHash`, else it answers `NEW_VERSION` |
| `--character-texture` | `male1` | Woka texture id |
| `--name-prefix` | `bot` | Player name is `<prefix>-<index>` |
| `--disconnect-fraction` | `0` | Share of sessions (lowest indexes) that leave early; one not started by then never starts |
| `--disconnect-at-seconds` | half the duration | When they leave |
| `--probe-observers` | `20` | Sessions after the early leavers that record move delivery; `0` turns the probe off |
| `--min-accepted` | `1` | Fewer accepted sessions makes the run invalid |
| `--output` | none | Also write the JSON summary to this file |

`SIGINT`/`SIGTERM` stop the run early; the summary is still printed after every socket and timer is released
(`stopReason: "aborted"`, covered by a test that interrupts the CLI process).

Exit codes: `0` run valid, `1` configuration or fatal error, `2` run finished but invalid (counters do not
reconcile, cleanup incomplete, or fewer than `--min-accepted` sessions accepted).

## Summary

One JSON document on stdout (`schemaVersion` 4): `sessions` (requested, started, neverStarted, accepted, rejected,
abortedBeforeJoin, unexpectedCloses, uniqueUserIds), `earlyLeave` (planned, fired, and the state of each planned
leaver when the leave fired: `accepted` left the room, `connecting` aborted its join, `idle` never started,
`rejected`, `leaving` and `closed` were already out of the room),
`sockets` (opened, openPeak, openAtStop, closed),
`joinLatencyMs` (p50, p95, max; `null` without samples), `rooms`, `sent`, `received`, `rejections`,
`errors`, `closeCodes`, `moveProbe` (see below), `generator` (CPU, RSS, event-loop lag), `cleanup` and `reconciled`.
New in version 4:

- `window`: whether a steady window was set, its length, where it starts and ends (seconds after the first start) and
  how long it was actually measured (`measuredSeconds`; shorter when the run was interrupted).
- `scenario`: viewport, pattern, moving fraction, how many bots walk, and the global index range of this process.
- `received`: frames, bytes and `eventsByType` over the window (the whole run without one); `wholeRun` always holds
  the frames and bytes of the ramp too.
- `traffic`: what the server sent over the measured span, by message type. Every type has `frames` (frames that
  carried it), `messages`, `records`, `bytes`, `messagesPerSecond`, `bytesPerSecond`, `peakBytesPerSecond` (the busiest
  second) and `kbitPerSecondPerSession`. `overheadBytes` is the nonce, envelope and batch headers; the typed bytes plus
  the overhead add up to `received.bytes`. Message sizes are read off the wire, so they include each batch entry's tag
  and length prefix.
- `worldSpace`: the same figures for the five roster messages of `allWorldUser` (`initSpaceUsersMessage`,
  `addSpaceUserMessage`, `removeSpaceUserMessage`, `updateSpaceUserMessage`, `spaceStatePatchMessage`) and for no other
  space, plus members and watchers planned and reached, `joinLatencyMs` of the space join and `joinErrors`. A roster
  snapshot counts one message and as many `records` as it has users. Zero everywhere unless `--world-space` or
  `--world-members` is set.
- `knownPeers`: how many other users each bot still in the room knew of at the stop (the `userJoinedMessage` of its
  watched zones minus the `userLeftMessage`): p50, p95 and max over this process's bots. In a single process this is
  the share of the room a viewport reaches; across processes read it with the population from the merged summary.
- `metrics`: one report per `--metrics-urls` entry: scrapes taken, errors, `cpuSeconds` and `cpuPercentOfOneCore` from
  `process_cpu_seconds_total` between the first and the last scrape (100 is a saturated single-threaded server),
  `rssPeakBytes`, the worst `nodejs_eventloop_lag_p99_seconds`, and `series` for every `workadventure_*` metric with its
  first, last, delta and max. A scrape that fails is counted in `errors`, never fatal.

### Move probe

`moveProbe` measures how movement reaches other players. The `--probe-observers` sessions with the lowest indexes
that do not leave early (`--disconnect-fraction`) are the observers; they record the `userMovedMessage` and
`userJoinedMessage` frames they receive. Every bot in the same process sends its moves through the same probe.

- `delivery` (`expected`, `received`, `ratio`): `expected` counts the moves an observer should get: moves by another
  bot in the same room, sent while the observer was accepted, whose position lay in the observer's viewport at that
  time. `received` counts only arrivals that match one of those expected moves, each at most once, so `ratio`
  (`received / expected`) is at most `1`. A shortfall is an expected move that did not arrive, or did not match, before
  the observer left or the run stopped.
- `moveLatencyMs` (`count`, `p50`, `p95`, `p99`): time from sending a move to its arrival, for received moves only.
  The move is matched by the mover's user id (learned from its own `roomJoinedMessage`) and by its position: the
  generator recomputes the position of each step, and a match takes the most recent send. A position repeats every
  377 steps, so a move that took a full repeat period (about 75 s at 5 Hz) or longer is reported as unmatched.
- `outsideExpectation`: arrivals that match a sent move the observer did not expect, or one it already received.
  The server delivers by 320 px zone, not by viewport, so this is normally above zero.
- `unmatched`: arrivals from a bot of this process that matched no sent step.

With `--steady-window` only moves sent inside the window are expected and counted, and a late arrival of a move sent
before it is ignored, not called unexpected.

Both numbers come from one generator process. With several processes, report each process's `moveProbe` on its own.
Only observers decode and match arrivals, which adds CPU there; a run that is generator-bound (see below) does not
measure server latency. Memory grows for the length of the run: one number per move sent by any bot, one per
received move, and one per expected move not yet received.
`null` means there was no sample or no expectation, never zero.

`generator.eventLoopLagMs` is the delay beyond the 10 ms sampling interval (`resolutionMs`): an idle generator
reads about 0, not 10.

`reconciled` checks the generator's own bookkeeping: every started session is accepted, rejected or aborted
before its join, every opened socket closed, and no socket or timer is left. It cannot see the server's room
membership; compare `sessions.accepted` with the back and pusher connection gauges for that.

Discard a run whose `generator.cpuPercentOfOneCore` approaches 100 or whose `generator.eventLoopLagMs.p99`
grows: the generator, not the server, was the bottleneck. Spread the population over several generator
processes instead, each with its own `--index-offset` (and `--output`); `scripts/load-staircase.sh` does this. Counters
add up, but percentiles do not: a combined p95 needs every sample, so the merge reports the worst process's percentile
as an upper bound, and pools delivery as total received over total expected.
`benchmark_multi_core.sh` predates this harness (it starts four identical processes with yarn, on the same paths) and
does not do this.

## Staircase over several processes

```bash
cd benchmark
scripts/load-staircase.sh --levels=300,500,700,1000 --processes=4 \
  --ramp-seconds=60 --duration-seconds=240 --steady-window=120 \
  --metrics-urls=http://127.0.0.1:9100/metrics \
  -- --pusher-url=http://127.0.0.1:3010 --ws-url=http://127.0.0.1:3001 \
     --room-urls=http://127.0.0.1:3010/~/konclui-office/office.wam \
     --move-hz=5 --viewport=browser --pattern=walk-stop --moving-fraction=0.2 --world-space=1
```

For every level it starts `--processes` generators, each with its share of the bots and its own `--index-offset`
range, `--stagger-seconds` (default 4) apart; process k runs k x stagger less, so all of them stop together and their
windows line up. It waits for them, merges `gen-<k>.json` into `merged.json` and prints a verdict line, rests
`--pause-seconds`, and goes on. `--repeat=3` runs the whole staircase three times, interleaved. At the end
`staircase.json` lists every level with its failures and the knee of each repeat: the first level where the run is
invalid, delivery falls below 0.99, or a scraped server is at or above 100% of one core (override with
`merge-summaries.ts staircase --min-delivery=... --max-server-cpu=... --max-move-p95=...`).

It starts nothing else: no server, no docker, no browser. Bring the servers up yourself, from a pinned commit, and
restart them between levels if you need `nodejs_eventloop_lag_max` or memory to start from zero. It runs on macOS
(bash 3.2) and Linux; `--taskset=4-7` pins the generators on Linux. `--dry-run` prints the plan and the commands.
A merged run is invalid when any process had a rejected session, a close code other than 1000, an unreconciled ledger,
fewer accepted sessions than requested, was stopped before its duration (`stopReason` other than `completed`), measured
more than 2 s less than its window (or its duration, with no window), or was generator-bound (CPU at 70% of a core or
more, event-loop lag p99 above 10 ms); the reasons are in `merged.json`.

The summaries cannot show a process that never wrote one, so the launcher runs the merge as
`merge-summaries.ts run <dir> --expect-processes=<P> --expect-sessions=<level>`: a different number of `gen-*.json`
files (a dead process or a leftover file), or requested bots that do not add up to the level, make the run invalid.
`staircase.json` also counts a level as failed when its `merged.json` requested another number of bots than the level.
Run the merge by hand without the two flags and those checks are skipped.

## Staircase on the CI pool

`ci/run-load.sh <out dir>` does the whole run on one Docker daemon: it builds the back, map-storage and play images
from the checkout, and for every level it starts a fresh stack (`ci/compose.yaml`: Traefik, play, back, map-storage,
redis, the office map of `ci/fixtures/`), runs `scripts/load-staircase.sh` for that one level and removes the stack.
The generator runs in the play image, on the stack's network: that image holds the generated protocol code and the
protocol version the pusher accepts. Nothing is published on the host.

`ci/load-run.env` holds what runs, and a value in the environment wins over it:

| Step                      | What it is                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calibration`             | The procedure of the workstation baseline (every bot walks, one generator process, 60 s, statistics over the whole run), to tell the host from the workstation.                         |
| `budget-off`, `budget-on` | The staircase with the defaults of the code and with `PUSHER_VIEWER_BUDGET_ENABLED=true`. The two scenarios of a level run side by side, and the one that goes first alternates.        |
| `profile`                 | One more level with a CPU profile of the pusher inside the steady window (`scripts/inspector-profile.mjs`, summarized by `scripts/profile-summary.mjs`). Its numbers carry the profiler. |

Read the result with three cautions:

1. Under the viewer budget a socket hears its 150 nearest peers at full rate, the next ones once a second and none
   beyond 400, while the move probe expects every move. Delivery of `budget-on` is lower by design, so its staircase
   runs with `--min-delivery=0` and its knee rests on validity and server CPU. Compare the two scenarios on server CPU,
   event-loop lag and kbit/s per session.
2. The CI host is shared. Every verdict line in `run.txt` ends with how long the cgroup of the run was throttled and
   with the CPU pressure of the host during the level; `host-load.txt` of each level holds the counters. A level that
   was throttled measured the limit of the pool, not the servers.
3. `docker-stats.txt` holds per-container CPU only where the daemon keeps a cgroup per container. The pool's rootless
   daemon does not, and the file then says so: the CPU of the servers is `serverCpu` in `merged.json`.

The script exits 0 when every level produced a measurement, saturated or not, and 1 when an image did not build, a
stack did not start or the generator of a level failed.

`.github/workflows/konclui-load.yml` runs it on the self-hosted pool (`runs-on: [self-hosted, ci-host]`) for a push to a
branch named `konclui/load/<anything>`, and measures the commit that branch points at. A branch named
`konclui/load/smoke<anything>` runs every step once with 100 bots and short levels. The job uses nothing GitHub bills:
the results are printed in the job log between two marker lines, and `ci/fetch-results.sh <run id> <dir>` reads them
back into a folder (the whole server logs stay on the runner; their last lines travel).

```bash
git push <remote> <commit>:refs/heads/konclui/load/<name>
gh run list --workflow konclui-load.yml --limit 1
benchmark/ci/fetch-results.sh <run id> ./load-out/<name>
```

## Checks

```bash
cd benchmark
npm test -- tests/harness.test.ts      # envelope handling, accepted vs rejected sessions, cleanup
npm test -- tests/probe.test.ts        # move probe matching, delivery ratio, percentiles, steady window
npm test -- tests/config.test.ts       # parsing of every scenario flag
npm test -- tests/scenario.test.ts     # viewports, movement patterns, who walks and who watches
npm test -- tests/traffic.test.ts      # bytes by message type, world-space roster counters, steady window
npm test -- tests/loadscenario.test.ts # the flags end to end against the fake pusher
npm test -- tests/metrics.test.ts      # /metrics scraping and the CPU figure
npm test -- tests/merge.test.ts        # merging processes, validity, staircase knee
npm test -- tests/staircase.test.ts    # load-staircase.sh plan and a real two-process run
npm run typecheck
```

The tests drive the harness against an in-process fake pusher over real sockets; they do not need a running
WorkAdventure.

## What to watch on the server

- CPU of the play and back Node processes.
- `nodejs_eventloop_lag_max_seconds` on the `/metrics` endpoints (restart the service between runs to reset it).
