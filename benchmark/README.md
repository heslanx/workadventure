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
`viewportMessage` after joining and then `userMovesMessage` at `--move-hz` along a deterministic ellipse
(same session index, same path), and leaves with close code 1000.

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
| `--min-accepted` | `1` | Fewer accepted sessions makes the run invalid |
| `--output` | none | Also write the JSON summary to this file |

`SIGINT`/`SIGTERM` stop the run early; the summary is still printed after every socket and timer is released
(`stopReason: "aborted"`, covered by a test that interrupts the CLI process).

Exit codes: `0` run valid, `1` configuration or fatal error, `2` run finished but invalid (counters do not
reconcile, cleanup incomplete, or fewer than `--min-accepted` sessions accepted).

## Summary

One JSON document on stdout: `sessions` (requested, started, neverStarted, accepted, rejected,
abortedBeforeJoin, unexpectedCloses, uniqueUserIds), `earlyLeave` (planned, fired, and the state of each planned
leaver when the leave fired: `accepted` left the room, `connecting` aborted its join, `idle` never started,
`rejected`, `leaving` and `closed` were already out of the room),
`sockets` (opened, openPeak, openAtStop, closed),
`joinLatencyMs` (p50, p95, max; `null` without samples), `rooms`, `sent`, `received.eventsByType`, `rejections`,
`errors`, `closeCodes`, `generator` (CPU, RSS, event-loop lag), `cleanup` and `reconciled`.

`generator.eventLoopLagMs` is the delay beyond the 10 ms sampling interval (`resolutionMs`): an idle generator
reads about 0, not 10.

`reconciled` checks the generator's own bookkeeping: every started session is accepted, rejected or aborted
before its join, every opened socket closed, and no socket or timer is left. It cannot see the server's room
membership; compare `sessions.accepted` with the back and pusher connection gauges for that.

Discard a run whose `generator.cpuPercentOfOneCore` approaches 100 or whose `generator.eventLoopLagMs.p99`
grows: the generator, not the server, was the bottleneck. Spread the population over several generator
processes instead, each with its own `--name-prefix` and `--output`. Add their counters (sessions, sockets,
frames, bytes, events, errors), but not their percentiles: a combined p95 needs every sample, so report each
process's latency and lag percentiles separately, or take the worst of them as an upper bound. Session indexes
restart at 0 in every process, so processes with the same room list follow the same movement paths.
`benchmark_multi_core.sh` predates this harness (it starts four identical processes with yarn) and does not do
this.

## Checks

```bash
cd benchmark
npm test -- tests/harness.test.ts   # envelope handling, accepted vs rejected sessions, cleanup
npm run typecheck
```

The tests drive the harness against an in-process fake pusher over real sockets; they do not need a running
WorkAdventure.

## What to watch on the server

- CPU of the play and back Node processes.
- `nodejs_eventloop_lag_max_seconds` on the `/metrics` endpoints (restart the service between runs to reset it).
