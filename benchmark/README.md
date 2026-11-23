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
comparable. Everything that picks a bot (path, walker, world-space role) depends only on its _global_ index, the
session index plus `--index-offset`, so the same bot behaves the same in any process.

| Flag                | Default                                       | Meaning                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--viewport`        | `bot`                                         | What the camera reports to the pusher: `bot` is the 640 x 400 box of the baselines; `browser` is a 960 x 540 canvas plus the 300 px margin the client adds on each side, clipped to the 2752 x 1792 map; `zoomout` is the whole map                                                                                                                            |
| `--pattern`         | `ellipse`                                     | `ellipse` is the baseline path (736 x 545 px around (1056, 745)); `ring` a 300 px circle around the same centre, 36 px per move; `plaza` laps of the Plateia rectangle (192, 416, 416 x 544) on four lanes; `walk-stop` stop and go over the whole floor: 12 moves to the next stop, then 5 to 30 silent ticks, the last move of a leg carrying `moving=false` |
| `--moving-fraction` | `1`                                           | Share of the bots that walk. The others join, report their viewport and send nothing. The selection is spread evenly over any run of consecutive indexes: 20% of 250 bots is 50 +- 2                                                                                                                                                                           |
| `--world-space`     | `0`                                           | Share of the bots (`0`..`1`, also `on`/`off`) that subscribe to the user list of the `allWorldUser` space. Joining and subscribing are what `GameScene` and `Space` send: a `joinSpaceQuery` (ALL_USERS, `availabilityStatus` and `chatID`), then an `addSpaceFilterMessage` once it is answered                                                               |
| `--world-members`   | `1` when `--world-space` is above 0, else `0` | Share of the bots that join the space. The watchers are part of it, so it cannot be lower than `--world-space`. `--world-members=1` alone measures members that never subscribe to the roster                                                                                                                                                                  |
| `--index-offset`    | `0`                                           | Added to every session index for the name (`<prefix>-<global index>`), the path and the roles. Give each generator process its own range                                                                                                                                                                                                                       |
| `--steady-window`   | `0` (whole run)                               | Seconds at the end of the run that traffic, delivery, latency and the per-type bytes cover. Must fit after the ramp: at most duration minus ramp                                                                                                                                                                                                               |
| `--metrics-urls`    | none                                          | Comma-separated Prometheus `/metrics` URLs, scraped when the window starts (or at the start of the run), every 5 s and once more at the stop                                                                                                                                                                                                                   |

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

| Flag                      | Default                           | Meaning                                                                                   |
| ------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `--pusher-url`            | required                          | http(s) base URL of the play/pusher service                                               |
| `--ws-url`                | `--pusher-url`                    | WebSocket base URL when it differs (http→ws is applied automatically)                     |
| `--room-urls`             | required                          | Comma-separated room URLs; session `i` joins room `i mod rooms`                           |
| `--sessions`              | required                          | Number of sessions to start                                                               |
| `--ramp-seconds`          | `10`                              | Session `i` starts at `i × ramp / sessions`                                               |
| `--duration-seconds`      | `60`                              | Total run time, ramp included. Shorter than the ramp stops mid-ramp                       |
| `--move-hz`               | `1`                               | Movement messages per second per accepted session, `0` for idle                           |
| `--join-timeout-seconds`  | `30`                              | Not joined in time counts as rejected (`join_timeout`)                                    |
| `--close-timeout-seconds` | `5`                               | A socket that does not close in time is terminated                                        |
| `--auth`                  | `anonymous`                       | `anonymous` or `none`                                                                     |
| `--api-version`           | `apiVersionHash` of this checkout | Must equal the pusher's `apiVersionHash`, else it answers `NEW_VERSION`                   |
| `--character-texture`     | `male1`                           | Woka texture id                                                                           |
| `--name-prefix`           | `bot`                             | Player name is `<prefix>-<index>`                                                         |
| `--disconnect-fraction`   | `0`                               | Share of sessions (lowest indexes) that leave early; one not started by then never starts |
| `--disconnect-at-seconds` | half the duration                 | When they leave                                                                           |
| `--probe-observers`       | `20`                              | Sessions after the early leavers that record move delivery; `0` turns the probe off       |
| `--min-accepted`          | `1`                               | Fewer accepted sessions makes the run invalid                                             |
| `--output`                | none                              | Also write the JSON summary to this file                                                  |

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

| Step                      | What it is                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calibration`             | The procedure of the workstation baseline (every bot walks, one generator process, 60 s, statistics over the whole run), to tell the host from the workstation.                          |
| `budget-off`, `budget-on` | The staircase with the defaults of the code and with `PUSHER_VIEWER_BUDGET_ENABLED=true`. The two scenarios of a level run side by side, and the one that goes first alternates.         |
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

## Frame probe (a real browser)

`frame-probe/` is the browser half of a load run. The generator above measures the servers and renders nothing; the probe
enters the room as one guest in a real Chromium and times the client's own frames with the recorder the client already
carries (`e2eHooks.startFrameRecording()` and `stopFrameRecording()`, `play/src/front/Utils/E2EHooks.ts`). It is the gate
for the client frame budgets of `docs/PERFORMANCE.md`: frame work p95 at most 16.7 ms with 200 visible avatars and at
most 33.3 ms with 1000 (`docs/TESTING.md` N-04, plan actions 5, 11 and 17, decision C2 slice 0).

It starts no bots and no server. Start the bots first (the staircase above, on the same room) and keep them up for as long
as `--dry-run` says. It needs a GPU: on macOS `npx playwright install chromium` once, then the default is the Metal
backend of the full Chromium. A run whose WebGL renderer is a software rasteriser (SwiftShader, llvmpipe) is invalid
unless you pass `--allow-software-renderer`, because those frame times say nothing about a user's machine.

```bash
cd benchmark
npx tsx frame-probe/run.ts frames <room url> --dry-run     # the plan and how long it takes, no browser
npx tsx frame-probe/run.ts frames <room url> [options]
```

**What a run is.** A session is one fresh browser context per condition: the scene effects (`konclui.fx.off`) on or off and
the avatar detail budget (`localStorage avatarDetailBudget`, commit `47865006b`) off or on, applied before the page loads
and read back after it. The budget is on by default in the client since 2026-11-22, and so are `avatarZeroWork` and
`avatarBake`, which this command does not touch: its budget-off arm keeps the zero-work states and the bake on, so it is
not the old all-off baseline. The all-off "before" is `gate1` with `FRAME_PROBE_GATE1_BASELINE=1` (below). Inside a session: enter as a guest, settle 5 s, record 25 s at the default zoom, then send two wheel
events over the canvas, record the zoom step (from the first wheel event to 2 s after the last one), wait until the scale
stops changing, wait 2 s more, and record 25 s at the whole-map zoom. After each of the two long recordings the WebSocket
bytes are counted through CDP in a window of their own (5 s): CDP copies every frame's payload on the page's main thread,
so it is never switched on inside a recording. The DOM name tags are counted last (`.username-display`: in the DOM, and
laid out), so the count is the crowd at the end of the phase. The whole matrix runs `--runs` rounds (3), each round
starting one condition later than the last, and the figure of a condition is the median of its runs, with the lowest and
highest beside it. The first failed session stops the run.

| Phase (`@view`) | What it covers                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`       | The recording at the default zoom                                                                                                                                     |
| `zoom`          | From the first wheel event to the end of `--zoom-window-seconds`: the avatar rebuilds the zoom causes are its frames, and its long tasks are the "2 s after the zoom" |
| `wholeMap`      | The recording at the whole-map zoom, after the scale settled                                                                                                          |

Each phase reports `work`, `step` and `render` p50 and p95 (the recorder's definitions; `work` is the series a budget is
judged on), `interval` p95, frames, long tasks (count, longest, total, from a page observer, in that phase's window), name
tags, and received and sent KiB/s (p50 and p95 of whole seconds). `gpu.*` (avg, p50, p95, p99, max) is the recorder's GPU
timer query, quoted only when at least 90% of the rendered frames have a sample (`GPU_MIN_COVERAGE`, `E2EHooks.ts`). A
browser without the timer, or with too few samples, gives `n/a` and the page's reason (for example `extension-missing`)
under the verdict: that is a normal state, not a failed run, but a budget on a `gpu.*` metric then makes the run invalid
(exit 2), never a pass. `work.avg` is `n/a` against a client whose recorder has no averages.

**Budgets and the exit code.** Nothing is judged unless a budget is given. A budget is
`METRIC=LIMIT[@VIEW][:fx=on|off][:detail=on|off]` on the median of the runs. Without conditions it binds every condition
measured, the baseline ones included: with the detail budget off at 300 bots the whole-map view is the thing being
fixed, so a budget meant for the shipped configuration names its conditions after the `:`.

```bash
--budget=work.p95=16.7@default                 # every condition: at most 16.7 ms
--budget=work.p95=33.3@wholeMap                # at most 33.3 ms
--budget=longTasks.count=0@zoom:detail=on      # only the rows with the detail budget on: no long task (50 ms or more)
                                               # in the 2 s after the wheel
--require-reduction=work.p50=50@wholeMap       # detail budget on at least 50% below off, per effects setting
--expect-at-least=nameTags.present=300@wholeMap  # the crowd the bots should make (see below)
```

A budget whose conditions nothing measured (`:detail=on` with `--detail-budget=off`) cannot be read, and that is never a
pass. `--expect-at-least=METRIC=MIN[@VIEW]` is the opposite bound, for what the run assumes about its load: the **lowest
run** of every condition must reach `MIN`, or the run is invalid, not failed, because the numbers then describe another
crowd. Budgets are upper bounds, so without it a staircase that expired, never started or joined another room lowers
every number toward a pass. `nameTags.present` counts the `.username-display` tags in the DOM: one per avatar the client
holds, hidden or not (the detail budget hides a tag with `display: none`, `UsernameDisplay.setHidden`, and keeps its
element), and the probe's own. The pusher sends the users near the client's viewport, so at the default zoom the count
is the neighbourhood, not the crowd; at the whole-map zoom the viewport is the map, so `nameTags.present` there is the
bots plus one. Put the minimum on `@wholeMap` (the bots, so one of slack) or, with `--views=default`, on a count you saw
in a run.

| Exit code | Meaning                                                                                                                                                                                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | Every budget held, or none was given                                                                                                                                                                                                                                                                            |
| 1         | A budget was exceeded                                                                                                                                                                                                                                                                                           |
| 2         | The measurement cannot be trusted, or the arguments are wrong: a session failed, the run stopped early, a recording outgrew its buffer or has no frame, the wheel did not zoom out, the renderer is software, an expected crowd is not there, or a budget names something nobody measured. Never read as a pass |

`--out-dir` (default: a new folder under the system temp directory) receives `frame-probe.json` (schema version 1: the
runs, the summaries and the verdict) and `frame-probe.md` (the summary, also printed). `--screenshots` adds a PNG at the end
of every phase of every run, to put the detail budget off and on side by side.

**0, 100 and 300 bots.** Put the room URL and the servers in the shell once; with 0 bots there is no staircase.

```bash
ROOM=http://127.0.0.1:3010/~/konclui-office/office.wam     # the room the bots join
PUSHER=http://127.0.0.1:3010 WS=http://127.0.0.1:3001      # as in the staircase example above
cd benchmark
OUT=../.local/konclui/qa/frame-runs                        # ignored by git
```

```bash
# 0 bots: the full matrix, 12 sessions, about 20 minutes
npx tsx frame-probe/run.ts frames "$ROOM" --budget=work.p95=16.7@default --out-dir=$OUT/bots-0

# 100 and 300 bots: terminal A starts the bots (one process, 5 moves a second, every bot walks the baseline ellipse)...
scripts/load-staircase.sh --levels=100 --processes=1 --ramp-seconds=30 --duration-seconds=1500 \
  -- --pusher-url=$PUSHER --ws-url=$WS --room-urls="$ROOM" --move-hz=5
# ...terminal B starts the probe once the ramp is over (about 45 s later); --levels=300 for the second run
npx tsx frame-probe/run.ts frames "$ROOM" --screenshots --budget=work.p95=16.7@default \
  --expect-at-least=nameTags.present=100@wholeMap --out-dir=$OUT/bots-100
npx tsx frame-probe/run.ts frames "$ROOM" --expect-at-least=nameTags.present=300@wholeMap \
  --budget=work.p95=16.7@default:detail=on \
  --budget=longTasks.count=0@zoom:detail=on --budget=longTasks.count=0@wholeMap:detail=on \
  --require-reduction=work.p50=50@wholeMap --out-dir=$OUT/bots-300
```

The 300 command is the acceptance of decision C2 and plan action 17: with the detail budget on, no long task in the zoom
step or at the whole-map zoom and the frame cost at least half below the detail budget off, for the crowd the bots
should make. The rows with the detail budget off are the baseline, which the first budget leaves out and the long tasks of
which would otherwise fail it; read them in `frame-probe.md`. Exit 0 is a pass, 1 a failed criterion, and 2 a run to
repeat: a missing crowd, a failed session, a software renderer.

**How long the bots must stay up.** `--duration-seconds` of the staircase counts from the start of the bots, ramp included,
and the probe starts about 45 s after them. So it is the length of the sessions plus 45 s plus a margin, not the length
of the sessions plus the ramp: `frames --dry-run` prints the figure to use (1329 s for the matrix above, which the 1500 s
of the example covers; 411 s for the shipping run). A crowd that leaves before the last recording ends makes that
session read low, and `--expect-at-least` turns it into an invalid run.

`--fx=on --detail-budget=off` measures only the shipping configuration (3 sessions, about 5 minutes: give the bots the
`--duration-seconds` that `--dry-run` prints for those flags).
The generator and the browser share the machine, so read `generator.cpuPercentOfOneCore` of the staircase's `gen-0.json`
next to the report: a saturated generator or a loaded machine makes the numbers indicative only.

**Gate 1 of the mandate (999 players, GPU time).** `gate1` is the client frame gate of
`.local/konclui/MANDATE-2026-11-21.md`, from one command, against one URL. It needs no bots: the crowd is made inside the
page by `window.e2eHooks.spawnSyntheticCrowd(999)` (`play/src/front/Utils/SyntheticCrowd.ts`), which joins 999 remote
players through the repository a real join uses (so culling, the detail budget, the build queue and the avatar bake all
run), in four groups (near the glass, under the lights, across room borders, spread over the map), each walking 5 moves a
second on a path fixed by its index.

```bash
cd benchmark
npx tsx frame-probe/run.ts gate1 "http://127.0.0.1:3010/~/konclui-office/office.wam" --out-dir=../.local/konclui/qa/gate1
```

On a host without Playwright's Chromium, `FRAME_PROBE_BROWSER_CHANNEL=chrome` runs the installed Google Chrome instead.

It opens Chromium on the GPU (Metal on macOS) at 1920x1080, with WebGL 2 forced (`?phaserMode=webgl2`; see `--context=default`
below for the context a visitor gets), and sets two keys
in localStorage before the page loads: `konclui.e2e.bench` (opens the page to the crowd) and `konclui.fx.rim`. It sets no
avatar flag: `avatarDetailBudget`, `avatarZeroWork` and `avatarBake` are on by default in the client since the 2026-11-22
run, so the gate measures what ships. Then: enter as a guest, spawn 999, settle
`--settle-seconds` (10), and for each of three windows set the hour (`setBenchNight(level)`, the effects' `konclui.fx.hour`
QA key, which they re-read once a second: the probe waits 2 s) and capture 300 consecutive frames with `captureFrameBench()`
while `panCamera` swings the view out and back. At the end it clears the crowd and the fixed hour, whatever happened.

`FRAME_PROBE_GATE1_BASELINE=1` runs the same command with the three avatar flags forced off (`"0"` in localStorage, on top
of the two keys above): layered avatars, no detail budget, no zero-work states, no bake. It is the "before" of a
comparison, on the same scene and lights. Any other value of the variable than empty, `0` or `1` stops the run before the
browser opens, so a typo cannot give a normal run that looks like a baseline. Both runs record the storage the page started
with (`engine.storage`) and the three flags the page reported through `window.e2eHooks.getAvatarFlags()`
(`engine.avatarFlags`), so a figure can be tied to the configuration that produced it. The run is invalid, with the flag
named, when the page's flags are not all on (a normal run) or all off (a baseline): a client built before the defaults
changed would otherwise measure the layered avatars under the storage of a correct run. On 2026-11-22 (Chrome, Apple M1 Max, 999 players) the two
gave the same GPU time (at most 8.43 ms with the flags on, 8.07 ms off); the flags off had two windows of six with a frame
of 33.3 to 33.5 ms, the flags on had none above 16.8 ms: the flags remove dropped frames, they do not lower GPU time.

**The context a visitor gets (`--context=default`).** Every Gate 1 number before 2026-11-22 was taken on a WebGL 2 context,
which the probe forces; a visitor gets Phaser's own choice (WebGL 1 in Phaser 4.2, with `ANGLE_instanced_arrays` and
`OES_vertex_array_object` bound onto it). The comparison is one command more, on the same room, the same crowd and the same
limits:

```bash
npx tsx frame-probe/run.ts gate1 "$ROOM" --out-dir=../.local/konclui/qa/gate1-webgl2
npx tsx frame-probe/run.ts gate1 "$ROOM" --context=default --out-dir=../.local/konclui/qa/gate1-default
```

`--context=default` forces nothing (no `?phaserMode`; a URL that already carries one, in the query or in the `#` hash, is refused, because the run would not
be the default one). The GPU time then comes from the extension the context has: `EXT_disjoint_timer_query` on WebGL 1 (the
fallback of `GpuFrameTimer`, reported as `gpuTimer: webgl1-ext`), `EXT_disjoint_timer_query_webgl2` on WebGL 2 (`webgl2`).
The two timers are not the same instrument: the report says, for each window, the context version the page had when the
window was captured and the timer that measured it, and the verdict, the headline and `gate1.json` (`setup.context`,
`verdict.context`) say `default`. The limits are the same ones; a verdict on the default context is a verdict on that
context, not on WebGL 2. The run is **invalid, never a pass**, when the context has no timer (`gpuTimer none`: the message
names the extension that is missing), when the page reports no WebGL version, or when the context changed between the start
and a window (lost and recreated). Whether Chrome exposes `EXT_disjoint_timer_query` on a WebGL 1 context of the test
machine is a fact about that browser and has not been confirmed: the first run says.

**Draw calls.** Each window reports the draw calls per frame, average and maximum (`drawArrays`, `drawElements` and the two
instanced forms, counted by a wrapper on the context that the frame bench installs and removes: `FrameBench.ts`). They are
in `gate1.json` (`bench.drawCalls`, null when the bench could not count) and in the third table of `gate1.md`; they are not
judged. The wrapper costs main-thread time, so the frame interval includes it; the GPU time does not.

**Extra flags (`--flag=KEY=VALUE`, repeatable).** Sets localStorage keys before the page loads, after the gate's own and the
baseline's, to measure the flags of a change without editing the probe:

```bash
# the change of each flag, against a plain run of the same room: cap off, the three off-by-default flags on
npx tsx frame-probe/run.ts gate1 "$ROOM" --flag=gameStepCap=0 --flag=gameRenderSkipCovered=1 --flag=gameNoStencil=1 --flag=konclui.fx.external=1
```

Each flag has a default, and **a flag set to its default measures nothing new**: the run is the plain one.

| Flag                    | Default                   | The value that changes the run |
| ----------------------- | ------------------------- | ------------------------------ |
| `gameStepCap`           | `1` (on since 2026-11-22) | `0`                            |
| `gameRenderSkipCovered` | `0`                       | `1`                            |
| `gameNoStencil`         | `0`                       | `1`                            |
| `konclui.fx.external`   | `0`                       | `1`                            |

So `--flag=gameStepCap=1` compares two identical runs; "with and without the cap" is a plain run against `--flag=gameStepCap=0`.
The probe prints a note, and writes it under the verdict, for a known flag set to its default
(`GATE1_FLAG_DEFAULTS` in `gate1.ts`). `gameNoStencil` drops the stencil buffer on every context, but the depth buffer only on
the forced WebGL 2 context (`createWebgl2Canvas`, App.svelte), so on `--context=default` it measures the smaller change; the
note says so. One avatar flag cannot be isolated: `avatarDetailBudget`, `avatarZeroWork` and `avatarBake` must be all on (a
normal run) or all off (`FRAME_PROBE_GATE1_BASELINE=1`), so `--flag=avatarBake=0` alone makes the run invalid.

The value is written as given (the client's flags read `"1"` on and `"0"` off). A flag without `=`, with an empty key or an
empty value, or one key given two values, stops the run before the browser opens. `konclui.e2e.bench`, `konclui.fx.rim` and
`konclui.fx.off` cannot be set: the gate sets or clears them itself. The flags are listed under the verdict in `gate1.md` and
recorded in `gate1.json` (`setup.flags`, and the whole storage in `engine.storage`). The probe cannot tell whether the client
read a flag it does not know (a misspelt key is stored and ignored), except for the three avatar flags, whose state the page
reports and which make a run invalid when they contradict it: check the key against the client's flag file.

**Requires the `?phaserMode=webgl2` case of `play/src/front/Components/App.svelte`** (in the client since `89dd5ecdf`). A
client built before it throws "phaserMode parameter must be one of ..." at start and never shows the room: the probe names
that error when it sees it, and a client that drops the query parameter in a redirect shows as "a WebGL 2 context is
required" (`gate1.json` records the final URL).

The three windows:

| Window | `setBenchNight` | What it is                                                                                                                                                                                                                  |
| ------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| day    | 0               | The plain day (hour 12)                                                                                                                                                                                                     |
| dusk   | 0.85            | The mandate's literal "night 0.85": the lamps factor of a dusk look (hour 17.85). The effects switch their night-only lights on at lamps 0.9, so these lights are **off** here and this window is lighter than a real night |
| night  | 1               | The full night (hour 19.3), night-only lights **on**                                                                                                                                                                        |

Each window is judged on `getFrameBench()` with the limits of the mandate: GPU time from the disjoint timer query
`avgGpuMs <= 11.0`, `p99GpuMs <= 15.5`, `maxGpuMs <= 16.7`, and two upload criteria, both `== 0`. `fullMapUploads` is the
mandate's: texImage2D or texSubImage2D calls whose width and height are both at least the map's. It cannot see the mirror of
this tree, which is the map wide and 128 px per glass row high (2752 x 384 for the konclui-office, 4.2 MB), so
`largeUploads` is judged beside it: calls that hand the GPU 1 MiB or more of CPU data, whatever their shape (the occlusion
canvas, half the map, is 4.9 MB). The largest single upload is in the report. A `texImage2D` with no data (Phaser allocating
a render target) moves no CPU data: it is counted as an `allocation`, shown, and not judged. Frame intervals, upload bytes a
second and the full, dot and culled avatar counts are in the report and do not decide it.

| Exit | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| 0    | All fifteen criteria held (five in each of three windows)                          |
| 1    | A criterion was exceeded; the run was valid                                        |
| 2    | The run cannot be judged, or failed (the report is still written, with the reason) |

An exit 2 is, in order of likelihood on a first run: no GPU timer (`gpuTimer none`: headless Chromium may not expose
`EXT_disjoint_timer_query_webgl2`, which is a fact about the browser and not a defect of the code); a software renderer or an
unnamed GPU; no WebGL 2 context (a forced run; the default context accepts any version); a drawing buffer below 1920x1080 in either dimension; fewer than 90% of the frames with a
GPU sample; a window of other than 300 frames; fewer than 999 players in the scene; **a crowd group that fell back to
spread placement** (the map's `fx/manifest.json` is missing, or has no glass face, light or room) or an avatar of fewer than
two layers; **the post pass `KfxPost` active in fewer than 95% of a window's rendered frames** (it switches itself off in a
plain day with nobody mirrored and no room locked, and a frame without it is lighter than the lit scene the gate names; the
share is in the report); the night-only lights in the wrong state for a window; a pan, a capture of 301 game steps that did not
complete in 60 s (a hidden tab), or any page error.

`--out-dir` receives `gate1.json` (schema 3: the gate, the setup, the verdict, every criterion, every window, the crowd's groups, the flags the page
ran with and the URL it ended on), `gate1.md` (the same, as tables, also printed), and `day.png`, `dusk.png` and `night.png`
taken after each window. A number from a run is a GPU number only if `gpuTimer` says `webgl2` or `webgl1-ext` (and the report's
context says which) and the renderer is the GPU named in the report; the GPU window trails the frame window by at most the query pool (8 frames), and the browser may
coarsen timer queries.

```bash
npm test -- tests/frameprobe-gate1.test.ts     # parsing the page's shape, the judge, the sequence on a canned session, the command
```

**Screenshot passes.** The same entry flow drives the two QA walkthroughs, reproducible from git:

```bash
npx tsx frame-probe/run.ts compare "$ROOM" --reference-url=<reference url> --viewports=1451x855,375x812 --out-dir=$OUT/compare
npx tsx frame-probe/run.ts panel "$ROOM" --out-dir=$OUT/panel
```

`compare` walks the entry, the office and every tab of the settings, saves one PNG per step
(`<side>-<width>-<step>.png`) and, with a reference, `side-by-side-<width>-<step>.png` with the native build on the left;
steps only one side has are reported. `panel` checks the side panel: it opens by itself once per room from 768 px, Escape
closes it, focus returns to the control that opened it, and the people and chat buttons toggle it. The entry flow is read
by its Portuguese labels (`frame-probe/entry.ts`), so the locale is `pt-BR`.

```bash
npm test -- tests/frameprobe-signals.test.ts   # percentiles, CDP bytes, long-task windows, zoom scale, settling, recording shape
npm test -- tests/frameprobe-verdict.test.ts   # budget grammar, medians against limits, reductions, valid or not
npm test -- tests/frameprobe-report.test.ts    # schedule, estimate, median of runs, report shape and Markdown
npm test -- tests/frameprobe-cli.test.ts       # the command line, and the gate end to end with a canned browser
```

The report shape the page returns is also tested from the page's side, with the real recorder and the real bench on a
fake GL (`play/tests/front/Utils/FrameProbeContract.test.ts`, run from `play/`), so the two sides cannot drift apart.

The tests run without a browser: the page is stood in for by canned sessions, so nothing here proves a selector or a wheel
event works. That is checked by running the probe.

`benchmark/` has no lint script and CI does not lint it. The probe and its tests are checked with the repository rules
(`libs/eslint-config`) through the config next to them, by hand, from `benchmark/`:

```bash
npx eslint -c frame-probe/eslint.config.mjs frame-probe tests/frameprobe-*.test.ts tests/support/frameProbeFixtures.ts
```

It is the shared config with one change: `no-await-in-loop` is off, because the sessions run one at a time on purpose.

## Shader lab (the ambience filter, alone, in a real GPU)

`shader-lab/` draws the office's camera pass (`POST` in `play/src/front/Konclui/Ambience/domain/shaders.ts`, and the
shaded program next to it once the tree has one) on a bare WebGL context in the installed Google Chrome, without Phaser
and without a game server. It answers two questions fast: what does the light look like, and what does the pass cost.
It compiles the REAL shader source (bundled from the repository by esbuild, in memory), sets its uniforms for an hour, a
camera and a crowd, and writes pictures and numbers.

```bash
cd benchmark
npx tsx shader-lab/run.ts /private/tmp/kv/dist2 --out /tmp/lab --preset reception            # night, one view
npx tsx shader-lab/run.ts /private/tmp/kv/dist2 --out /tmp/lab --preset all --hour 17.4      # every preset, one folder each
npx tsx shader-lab/run.ts /private/tmp/kv/dist2 --out /tmp/lab --hour 19.3 --camera 1391,1330,2 --people "1176,1334;1392,1404"
npx tsx shader-lab/run.ts /private/tmp/kv/dist2 --out /tmp/lab --flag konclui.fx.rim=legacy  # today's rim instead of the shaded program
npx tsx shader-lab/run.ts --list-presets
npx tsx shader-lab/run.ts --phaser --out /tmp/lab-phaser                                      # the Phaser probe (below): no map needed
```

`<built map dir>` is a build with `fx/` (manifest, masks, normal) and `office.wam` with its collections. No server runs:
the page and the map are served to Chrome with `page.route`. Chrome is launched as the frame probe does (`channel chrome`,
headless, `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`); `--channel chromium` uses Playwright's own browser.
Playwright and esbuild come from the repository root's `node_modules`.

| Option                                                 | Meaning                                                                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--hour H`                                             | decimal hour in the office's zone; else the flag `konclui.fx.hour`; else 22 (night)                                                                             |
| `--camera x,y,zoom`                                    | the world point at the centre of the window, in map px (fractions allowed), and the zoom                                                                        |
| `--people x,y;x,y`                                     | feet of the synthetic people in map px; `none` for nobody. Default: the preset's                                                                                |
| `--preset NAME\|all`                                   | `reception` (default), `lounge`, `entrance`, `floor-lamps`, `overview`; `all` writes one folder each                                                            |
| `--flag k=v ...`                                       | the client's switches: `konclui.fx.hour`, `konclui.fx.rim` (`0`, `1`, `full`, `reduced`, `legacy`). `konclui.fx.off` is ignored (the lab always draws the pass) |
| `--size WxH`                                           | the window in screen px (default 960x540)                                                                                                                       |
| `--gl 1\|2`, `--webgl2`                                | the context of the pictures (default WebGL1, as the game). Timing always runs on both                                                                           |
| `--frame map\|compose\|FILE`                           | the colour frame (below)                                                                                                                                        |
| `--no-timing`, `--timing-draws N`, `--timing-size WxH` | skip the GPU timing, or set its draws (default 200 per round, 3 rounds) and window (default 1920x1080)                                                          |
| `--on-shader FILE`, `--off-shader FILE`                | GLSL to draw instead of the tree's shaded program or `POST`: try a shader without editing `shaders.ts`                                                          |
| `--phaser`                                             | the Phaser probe instead of the lab (below); needs `--out`, not a map; `--webgl2` picks the context                                                             |
| `--no-clouds`                                          | no cloud shadows (they are in the pass; the lab freezes them at offset 0)                                                                                       |
| `--unmarked`                                           | draw the people with no mark (alpha 255), as the avatars beyond the marks' cap are, and list the first 8 in `uCrowd`; `acceptance.unmarkedPeopleTakeNoRelief`   |
| `--shimmer`                                            | also render 4 fractional scrolls at zoom 1 and 2, off and on, and count what swims (`acceptance.shimmer`)                                                       |

Presets are the views of the owner's captures, read from the built map: **reception** (the desk between the arcs at
(1151,1281) and (1568,1280)), **lounge** (the arc at (2453,1108) and the pendant at (2373,1278)), **entrance** (the glass
and the door light at (1392,1522)), **floor-lamps** (the west lounge's two at (576,1152) and (576,1440)) and
**overview** (the building at zoom 0.75; use `--size 2048x1200` to see all of it). Each has people under a lamp's pool,
beside it and away from it. A synthetic person is a 14x26 capsule with an outline, a head, a torso and legs, feet at the
given point.

### What it writes

In `--out` (or `--out/<preset>` with `--preset all`):

- `off.png`, `on.png`, `diff.png` (the off picture dimmed to 40%, every pixel whose largest channel changed by more than
  2/255 painted red), `sheet.png` (all of them and the elements, labelled).
- `el-<element>.png`: one element switched alone, where the shader has a switch. With today's `POST`: `el-bevel` (props
  only: `uPeopleN = 0`) and `el-person-rim` (people only: `uNormalsOn = 0`). With the shaded program: `el-relief`
  (`uShade = (level, 0, 0, 0)`, people marked but not lit), `el-person-light` (only `uShade.w`, normals off), one
  `el-contact`, `el-key`, `el-lamp`, `el-surface` for each baked channel alone (the runtime's `bakeCast` with only that
  option on; the receiver mask `solid` stays, because it says where a shadow may land; relief and person light are off)
  and `el-person-shadow` (only the people's stamps). Each `el-*` picture is the element's own render, and the `sheet.png`
  tile for it is its diff against `off`. An element whose runtime module is missing is listed under `skippedElements`.
- `stats.json`: per variant `changedShare`, `changedPixels`, `maxDelta`, `alphaMin` of the draw, `rugChanged` (changed
  pixels on a rug's own visible pixels: the stripes defect), `flatPropChanged` (changed pixels where the normal map holds a FLAT
  normal on a prop, the inside of a table top or a lamp: relief must leave them as they were, so it is 0 for `relief`), `wallWaterFacadeChanged`, `personPixels`,
  `changedOnPeople`, `changedOutsidePeople` (spill: light that is not on a person), `personLuma` against `offPersonLuma`,
  `personSides` (for each person: how much brighter their left half and their right half are than off, the side a lamp
  lighting them is on, and the side that is lit more: a person beside a lamp must be lit on the side that faces it);
  `bake` (with the shaded program and the runtime's bake: CPU milliseconds of the whole bake and of each element, the
  runtime's counts, the kinds of the 664 pieces and where they came from, painted pieces, how many `stand` pieces throw
  at least 8 shadow px outside their silhouette, the ones that do not with the reason, the shortest and longest shadow
  in px against the cap; `floatingShadows`: the stand pieces whose shadow, baked alone, does not touch the foot row of
  their picture's fully opaque pixels (the lounge's bedside tables floated 16 px until the silhouette stopped counting
  a baked pool of light; listed empty now, five pieces with `SOLID_ALPHA` back at 128); `topsWithoutShadow` and
  `hangsWithoutShadow`: the pieces on furniture and on a wall that leave no shadow on a support or a wall of their own
  (empty: every one of the 177 and the 30 does); `lamps`: for each caster lamp, where its light lands and the pieces it
  casts shadows from), `acceptance.lampShadow` (the lamp element alone must change at least 1% of the window by 50/255 or more where a caster lamp with casters
  lights the window; `meets` is null for a window with no such lamp, as the floor lamps' and the overview's), `castChannels` (pixels each channel marks, over the map and in the view), `stamps` (the
  runtime's pick for each person); the renderer, the uniforms the program declares and nothing set (`unsetUniforms`, a drift alarm), `compile`
  (per program: status, driver log, uniform vectors, source and `WEBGL_debug_shaders` translated length), the
  `maxFragmentUniformVectors` of the GPU, the lights in the view, and the self-test.
- `timing.json`: GPU time of the pass alone, on WebGL1 (`EXT_disjoint_timer_query`) and WebGL2
  (`EXT_disjoint_timer_query_webgl2`), `off` and `on`, through `play/src/front/Utils/GpuFrameTimer.ts` imported as is.
  3 interleaved rounds of 200 timed draws at 1920x1080 per context and variant; mean, median, p95, p99, max, the median
  of each round (a drifting GPU clock shows there), dropped samples. The numbers are marked `valid: false` when the
  renderer is SwiftShader or llvmpipe, and `gpuTimer: "unavailable"` replaces them when the extension is missing. Each
  draw is a full-screen quad into a framebuffer: the pass alone, without the camera pass, the scene or the compositor.
  Plus the compile log.
- `log.txt`: the notes of the run (lights found, uniforms source, what was left out).

A shader that does not compile or link stops the run (exit 1) with the driver's message and, for each error it gives a
line for, the source line with its neighbours (the pragma line Phaser's template engine reads is blanked, not removed, so
line numbers match the file). The first run of a session also runs a self-test (exit 2 if it fails): the masks texture
read through POST's own `mapUV` at the map's four corners against the decoded PNG (texture row order), the camera pass
at a fractional scroll against a CPU nearest crop, and `POST` drawn twice giving the same picture.

### The Phaser probe (`--phaser`)

`shader-lab/phaser-probe.ts` builds a real `Phaser.Game` (4.2.1, WebGL1; `--webgl2` for the other) with the real `postFilter.ts`
and `peopleMark.ts` and a scene of coloured rectangles, depth-sorted like the office. It writes `phaser-probe.json` and prints:
the draw calls of a frame with the marks on and off for 0, 24 and 80 avatars; the blend mode as the renderer holds it and that a
second registration reuses the id; the alpha an avatar leaves (0 on its opaque pixels, back to 1 under a prop drawn after it); the
final canvas alpha (255 everywhere); the row order of the cast texture through `POST_SHADED` (one marked pixel at map (3, 1) must
darken exactly that pixel); a camera at half a map pixel putting the world-keyed lookups where the next whole pixel does; and the
GPU time of the whole frame (`EXT_disjoint_timer_query`) and the CPU time of the render call, with the marks on and off, for 80
avatars. Exit code 2 when the row order, the alpha or the sub-pixel camera is wrong. Measured on the M1 Max on 2026-11-23:
4 draw calls more for each marked avatar (324 for 80), and 5.2 ms of whole-frame GPU for 80 marked avatars against 0.2 ms
unmarked at 200x120, so the runtime marks 20 at most at level 2 (10 at level 1), about 1.3 ms. It is not Gate 1: that runs the
real office (`frame-probe`).

### The colour frame, and what the lab lacks

The pass receives the camera's picture; the lab builds it from the build's whole-map render (`preview.png` beside the
build, in `fx/`, or in the sibling `renders<N>` of `dist<N>`), cropped by the camera with one nearest sample per screen
pixel, people drawn into it. With no render it composes one (`--frame compose`): a flat floor and lawn from the masks,
then every piece's picture at its placement in the game's depth order; it has no tiles, walls or doors, so it is only
good enough to judge light on furniture. What the lab does NOT have, on purpose: Phaser (so whether the alpha-0 mark
survives the camera filter chain, the draw calls it breaks, and the CPU of a render call are the Phaser probe's job, not
this one's), the ground-shadow quad, the water, glass and sun-layer passes, the mirrored floor (`uAvN = 0`), locked rooms
(`uLockN = 0`), the grass trail (`uStepN = 0`), the vignette and the arrival iris (off), name tags and emotes (a known
artifact: in the game they sit under the pass, so a tag inside a shadow zone is darkened; the lab draws none), and
anything animated. The preview's pictures still carry their own painted shadows. Weak-GPU timings do not exist on the Mac
this was written on: the lab prints the renderer it ran on and nothing else should be read from it.

With the shaded program present, people are drawn with alpha 0 (the mark of plan 2f), the stamps of the runtime's
`personShadow.ts` are blended under them (first-frame picks, no hysteresis), and the cast texture is the runtime's own
bake of the built map for the hour: every piece's picture is decoded in the page, its silhouette, kind and painted flag
read by `shadeShapes.ts` and `casterKind.ts` (or the manifest's `kinds` and `painted` when the build has them), the
caster lamps by `casterLampsFrom`, the key by `keyLightAt`. Without those modules the lab falls back, and says so in
`log.txt`: to the 1x1 `(0,0,0,255)` dummy ("nothing is a receiver") for the cast, and to no stamps. The bake's CPU time is
wall clock in the page (it is a report, not an assertion); a first bake includes the JIT warming up. A cast texture is
uploaded for each picture and not on a timed draw, but the `on` GPU timing does read the map-sized texture.

### Mirrored from the runtime (read this when a picture looks wrong)

Imported, not copied: `lookAt` (`timeOfDay.ts`), `lightsFrom`, `staticLights`, `visibleLights`, `visibleRects`,
`touchesView`, `EMISSIVE_TINTS` (`lights.ts`), `POST`, `POST_SHADED`, `forProbe` (`shaders.ts`), and, when the file exists
in the tree at run time, `lightUniformsInto`, `keyLightAt`, `newKeyLight`, `shadeUniformsInto`, `newShadeUniforms`,
`bakeCast`, `newCastBuffer`, `silhouetteOf`, `hasPaintedShadow`, `lengthScale`, `classifyPiece`, `casterLampsFrom`,
`personShadowFrames`, `pickPersonShadow`, `newPersonShadow` and `stampFrameAt`.
`SceneEffects.ts` is too entangled with Phaser to import, so `shader-lab/uniforms.ts` mirrors these parts of it, cited by name
(line numbers go stale with every edit of a 2,300-line file; search the symbol):

| Mirrored in `uniforms.ts`                                                                                                                                                                                     | From `SceneEffects.ts`                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `lookAt(hour, { light: true })`                                                                                                                                                                               | `refresh`, with the light switch on                                                                        |
| `night = look.lamps >= 0.9`, pools with `night` kept only then, then `visibleLights(..., view, 32)`                                                                                                           | `litCache` and `const night`; the lab asks for the view itself, the game for the camera's 16 px cell       |
| the pool packing loop, used only if `lightUniforms.ts` is absent                                                                                                                                              | `postUniforms`, the loop over `lit`                                                                        |
| the glow rectangles: `visibleRects(..., 64)`, `touchesView`, at most 24, the tint index in the width's fraction                                                                                               | `GLOW_CANDIDATES`, `MAX_GLOW` and `postUniforms`                                                           |
| `uShafts = [look.shafts, 58, 24, 0.84]`                                                                                                                                                                       | `shafts`                                                                                                   |
| `uCloud = [look.clouds, 236, 0, 0]` (offset frozen at 0)                                                                                                                                                      | `cloud`                                                                                                    |
| `uVignette = [0, 0.62]`, `uReveal = [0, 0, -1, 0]`                                                                                                                                                            | `vignetteUniform`, `revealUniform`                                                                         |
| `uFrost = [0.59, 0.8, 0.76]`                                                                                                                                                                                  | `FROST`                                                                                                    |
| `uInk = manifest.ink / 255`                                                                                                                                                                                   | the constructor, `inkUniform`                                                                              |
| `uLime`, `uCream`: PLACEHOLDERS (unused while `uStepN = 0`)                                                                                                                                                   | `TRAIL_COLOURS`                                                                                            |
| the people's feet into `uPeople` (first 8), `uPeopleN`                                                                                                                                                        | `placePeopleUniform` (the lab does no nearest-eight selection)                                             |
| `uCrowd[0]`: the first 8 people when `--unmarked`, else zeros                                                                                                                                                 | `Shading.chooseCrowd` / `placeCrowd` (phaser/shading.ts): the 8 unmarked avatars nearest the view's centre |
| the default fallback key `(-0.7071, 0.7071, 1, 1)`, `uShade = (level, 0.42, 0.6, 0.9)`, `uKeyShade` day/night mix: used only when `keyLight.ts` or `shadeUniforms.ts` is absent or throws (said in `log.txt`) | plan 2d / 1b                                                                                               |

Everything else in `uniforms.ts` is an import. `stats.json > unsetUniforms` lists any uniform the program declares that
the lab did not set: if a new uniform appears there, the lab has drifted from the runtime.

### Reading the numbers

`changedShare` is over the whole window, so it depends on the view: compare the same preset at the same size. A change
inside a rug's own pixels (`rugChanged`) is the relief stripes defect (a rug is a floor piece and gets no relief); it is
non-zero on a build whose `normal.png` still stamps rugs. `changedOutsidePeople` for `person-light` is the light that
spills past the people. For hours, run the command in a loop (`for h in 12.5 15.5 17.4 22; do ... --hour $h; done`).

### Acceptances (`stats.json > acceptance`, printed with the run)

Each is a number for a defect the reviewers of 2026-11-23 saw in a picture and measured by hand; they are plain arithmetic over the
pictures (`shader-lab/acceptance.ts`, unit-tested with the defect and the fix as small pictures). On the shader text of that
review (lab run with `--on-shader`) the reception window gave relief correlation -0.01 with 8% of the changed pixels not darker,
people lit on the far side from the lamp, and 1,525 swimming pixels; on the tree they pass.

| Key                                         | Question                                                                                                                                                                                                                                                                     | Passes when                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lampShadow`                                | is a lamp's shadow evident around a lamp that has casters                                                                                                                                                                                                                    | the lamp element changes 1% of the window by 50/255                                                                                                                 |
| `reliefLit`                                 | is a prop's lit side the lamp's side, and does the relief only darken (it was 96 to 97% darker, the lamp-facing side the darkest)                                                                                                                                            | correlation of (gain, lean toward the lamp) >= 0.2 over the prop pixels a lamp lights, and >= 20% of the changed pixels not darker; null with under 200 such pixels |
| `peopleLampSide`                            | is a person whose lamp pool or rim reaches their feet (within 100 px) lit on the lamp's side                                                                                                                                                                                 | every checked person is; null with none checked, and always null with `--unmarked`                                                                                  |
| `shadowCoverage`                            | does every standing piece, and every piece on furniture, have a shadow that SHOWS beside it (key and lamp alone for a standing one, key and surface alone for one on furniture; contact does not count, 6/255 delta), for the pieces whole in the window with 36 px of reach | the lists `stand.without` and `top.without` are empty, each gap with its reason (`none`, `wall`, `dark receiver`)                                                   |
| `shimmer` (`--shimmer`)                     | a camera one screen px along must give the picture one px along, at 4 fractional scrolls at zoom 1 and 2                                                                                                                                                                     | on never differs in more pixels than off by over the slack (0.02% of the window)                                                                                    |
| `unmarkedPeopleTakeNoRelief` (`--unmarked`) | does an avatar drawn in full with no mark take a sofa's relief                                                                                                                                                                                                               | the relief element changes none of their pixels (8 are listed in `uCrowd`; null beyond 8 people)                                                                    |

For the whole map at once: `--preset overview --camera 1376,896,1 --size 2752x1792` (the coverage then judges every piece
whole in the picture: 426 standing and 178 on furniture at the time of writing).

### What the shading does not reach (say this to the owner)

- Light on people reaches 20 avatars at most (10 at level 1): each marked avatar is a blend mode of its own and costs 4 draw
  calls (measured in the Phaser probe). The others are drawn as they are; the shader is told the feet of the 8 nearest to the
  view's centre among them (`uCrowd`) so that they take none of a sofa's relief, and beyond those 8 an avatar in front of a
  prop still takes its relief. All the avatars with a stamp (every one drawn in full) have a shadow under them; baked contact
  and key shadows still darken an unmarked avatar standing in them.
- Far avatars drawn as dots, and people culled, get no shadow and no light: they are not drawn in full.
- Level 1 saves little in the pass on an M1 Max (it drops one texture tap, the lamp accumulation and the person scan; the pass
  measured 5.28 ms off and 5.56 ms on at level 2, night, 1920x1080, and level 1 is within the noise of it). Its real saving is
  half the marks (about 40 draw calls). Whether it saves more on a weak GPU has not been measured: there is none here.
- The budget is MEASURED for the pass alone (the table above; the lab's p99 of 13 to 16 ms is a timer-query artifact of its
  pass-only loop, present with the shading off too) and ESTIMATED for the whole frame (the probe's 15 us a draw, about 1.2 ms for
  80 more draws on the M1 Max). Gate 1 at night, level 2, 80 drawn avatars, `konclui.fx.rim=full`, and then on a weak
  integrated GPU, has not been run (`scripts/gate.sh` was out of bounds for this work).

### Tests

```bash
npm test -- tests/shaderlab-args.test.ts    # the grammar: options, camera, people, flags, every refusal
npm test -- tests/shaderlab-model.test.ts   # presets, view maths, people, picture diffs, percentiles, shader errors, placements, uniforms
npm test -- tests/shaderlab-cast.test.ts    # the bake's inputs and channel counts, the real bake on a small map, the stamps
npm test -- tests/shaderlab-acceptance.test.ts   # the arithmetic acceptances: relief agreement, shimmer, coverage, lamp side, each with the defect it guards
npm test -- tests/shaderlab-smoke.test.ts   # the lab on a built map in Chrome; skips with a message without them
npx tsc -p shader-lab/tsconfig.lint.json    # types
npx eslint -c shader-lab/eslint.config.mjs shader-lab tests/shaderlab-*.test.ts
```

The smoke test needs a build with `fx/` (`SHADER_LAB_DIST`, default `/private/tmp/kv/dist2`) and a Google Chrome; it
draws a 320x180 window without timing, checks the PNGs, the self-test, the compile status, and that a shader with an
undeclared identifier stops the run with the driver's message and the source line.

## What to watch on the server

- CPU of the play and back Node processes.
- `nodejs_eventloop_lag_max_seconds` on the `/metrics` endpoints (restart the service between runs to reset it).
