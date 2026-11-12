# P1 harness contract (for the live-run agent)

Everything here was read from source at commit ddbe245a8 (RoomConnection.ts, WorkAdventureWebSocket.ts,
IoSocketController.ts, PusherRoomSocketController.ts, AuthenticateController.ts, messages.proto). The harness has
NOT been run against a real WorkAdventure stack yet: only against an in-process fake pusher.

## What you need

- Node 24, and these packages resolvable from `benchmark/`: `ws`, `@bufbuild/protobuf`, `tsx`
  (plus `vitest`, `typescript`, `@types/ws`, `@types/node` for the checks).
- Files: `benchmark/index.ts`, `benchmark/src/`, `libs/messages/src/ts-proto-generated/` (generated, must match
  the server's protobufs) and `libs/messages/src/JsonMessages/ApiVersion.ts`.
- A snapshot with those files and `node_modules` is retained on host `knc` at
  `~/wa-jobs/wa-fable-20261111/src-wa-fable-p1/` (throwaway `package.json` there, not the repo manifest). Mount
  it at `/work` in your own `node:24-trixie` container and run from `/work/benchmark`. No container is left
  running. Re-copy `benchmark/` into it if the checkout changes.

## Reachable endpoints

| Endpoint | Used for |
|---|---|
| `POST <WA_PUSHER_URL>/anonymLogin` | one token per session (`{ "authToken": "…" }`); 403 if `DISABLE_ANONYMOUS` |
| `GET  <WA_WS_URL or WA_PUSHER_URL>/ws/room` (WebSocket upgrade) | the room session |

The room URL is passed verbatim as the `roomId` query parameter, in the form the browser uses:
`<play base>/_/<instance>/<map host>/<map path>.json` (or `<play base>/@/<org>/<world>/<room>`). The pusher and
back must be able to resolve that map themselves; the generator never fetches the map.

`WA_API_VERSION` must equal the pusher's `apiVersionHash`. It is `dev` for a stack started from source, and an
8-character hash in built images (`messages/package.json` `tag-version`). On a mismatch every session is rejected
with `errorScreenMessage:NEW_VERSION`.

## Command

```bash
cd benchmark
WA_PUSHER_URL=http://play.workadventure.localhost \
WA_ROOM_URLS=http://play.workadventure.localhost/_/global/maps.workadventure.localhost/tests/E2E/empty.json \
WA_SESSIONS=10 WA_RAMP_SECONDS=5 WA_DURATION_SECONDS=30 WA_MOVE_HZ=2 \
WA_OUTPUT=/work/out/lane-4.json \
npx tsx ./index.ts
```

Same thing with flags: `npx tsx ./index.ts --pusher-url=… --room-urls=… --sessions=10 …` (flags win over env).
`npm start -- <flags>` is equivalent once `tsx` resolves from the workspace.

| Env var | Default | Meaning |
|---|---|---|
| `WA_PUSHER_URL` | required | http(s) base URL of play/pusher |
| `WA_WS_URL` | = `WA_PUSHER_URL` | WebSocket base URL if different; `http`→`ws` applied automatically |
| `WA_ROOM_URLS` | required | comma-separated; session `i` joins room `i mod rooms` |
| `WA_SESSIONS` | required | integer ≥ 1 |
| `WA_RAMP_SECONDS` | 10 | session `i` starts at `i × ramp / sessions` |
| `WA_DURATION_SECONDS` | 60 | total run time including the ramp; `< ramp` stops mid-ramp (lane 6) |
| `WA_MOVE_HZ` | 1 | `userMovesMessage` per second per accepted session; 0 = idle |
| `WA_JOIN_TIMEOUT_SECONDS` | 30 | then rejected as `join_timeout` |
| `WA_CLOSE_TIMEOUT_SECONDS` | 5 | then the socket is terminated |
| `WA_AUTH` | anonymous | `anonymous` \| `none` |
| `WA_API_VERSION` | `dev` (from `ApiVersion.ts`) | see above; a wrong value is the deliberate rejection of lane 5 |
| `WA_CHARACTER_TEXTURE` | male1 | woka texture id |
| `WA_NAME_PREFIX` | bot | player name `<prefix>-<index>` |
| `WA_DISCONNECT_FRACTION` | 0 | share of sessions (lowest indexes) leaving early (lane 9) |
| `WA_DISCONNECT_AT_SECONDS` | duration / 2 | when they leave |
| `WA_MIN_ACCEPTED` | 1 | set 0 for a run that is expected to be fully rejected |
| `WA_OUTPUT` | none | also write the summary to this file |

Exit codes: `0` valid run; `1` configuration/fatal error (usage on stderr); `2` run finished but invalid
(`reconciled` false or `sessions.accepted < WA_MIN_ACCEPTED`). `SIGINT`/`SIGTERM` stop early and still print the
summary (`stopReason: "aborted"`).

## Output (stdout, and `WA_OUTPUT`)

```jsonc
{
  "schemaVersion": 2,                  // 2: eventLoopLagMs excludes the sampling resolution; earlyLeave added
  "notice": "Headless protocol bots: this certifies neither client rendering nor audio/video performance.",
  "startedAt": "2026-11-12T00:00:00.000Z",
  "wallSeconds": 30.012,
  "stopReason": "completed",            // or "aborted"
  "config": { /* the resolved configuration, no token */ },
  "sessions": {
    "requested": 10, "started": 10, "neverStarted": 0,
    "accepted": 10,                     // authoritative roomJoinedMessage received
    "acceptedAtStop": 10,
    "rejected": 0,                      // error message, socket error, close or timeout before the join
    "abortedBeforeJoin": 0,             // the harness stopped while the session was still connecting
    "unexpectedCloses": 0,              // accepted sessions closed by the other side
    "uniqueUserIds": 10                 // distinct currentUserId values (ids are per room on the back)
  },
  "earlyLeave": { "planned": 0, "fired": false, "stateAtLeave": {} },   // planned leavers by state at the leave
  "sockets": { "opened": 10, "openPeak": 10, "openAtStop": 10, "closed": 10 },
  "joinLatencyMs": { "count": 10, "p50": 41.2, "p95": 77.9, "max": 80.3 },   // null without samples
  "rooms": [ { "roomUrl": "…", "started": 10, "accepted": 10, "rejected": 0, "uniqueUserIds": 10 } ],
  "sent": { "joinRoomFrontMessage": 10, "viewportMessage": 10, "userMovesMessage": 480, "pingMessage": 3 },
  "received": { "frames": 900, "bytes": 123456, "eventsByType": { "roomJoinedMessage": 10, "userMovedMessage": 4000 } },
  "rejections": { /* reason → count, e.g. "errorScreenMessage:NEW_VERSION": 1 */ },
  "errors": { /* message → count */ },
  "closeCodes": { "1000": 10 },
  "generator": {
    "cpuUserMs": 900.1, "cpuSystemMs": 200.4, "cpuPercentOfOneCore": 3.7,
    "rssPeakBytes": 120000000, "rssEndBytes": 110000000,
    "eventLoopLagMs": { "resolutionMs": 10, "p50": 0.1, "p95": 1.5, "p99": 2.6, "max": 22.7 }
  },
  "cleanup": { "openSockets": 0, "activeTimers": 0 },
  "reconciled": true
}
```

Numbers above illustrate the shape only; they are not measurements.

- Join latency runs from the session start (token request included) to `roomJoinedMessage`.
- `eventLoopLagMs` comes from `monitorEventLoopDelay` at 10 ms resolution (`resolutionMs`) and reports the delay
  beyond that interval, floored at 0, so an idle generator reads about 0. `schemaVersion: 1` summaries, such as
  lane 7's receipt (`eventLoopLagMs.p99` 13.6 ms), include the 10 ms: subtract 10 before comparing them.
- `earlyLeave` counts the `--disconnect-fraction` leavers. `stateAtLeave` keys each planned leaver by its
  session state when the leave fired: `accepted` left the room, `connecting` aborted its join, `idle` never
  starts, and `rejected`, `leaving` or `closed` were already out. Every planned leaver is out of the room from
  `--disconnect-at-seconds` on; an `idle` one still counts in `sessions.neverStarted`.
- `reconciled` = `started == accepted + rejected + abortedBeforeJoin`, `sockets.opened == sockets.closed`, and
  `cleanup` all zero. It checks the generator's own bookkeeping only; server-side room membership comes from the
  back and pusher gauges.
- A failed `/anonymLogin` is a rejection whose reason is the fetch error (`anonymLogin_http_403`,
  `fetch failed`); it opens no socket and adds no join latency sample.

## Not covered by the harness (needs the live lanes)

- Lane 3 (a real browser sees the bot move) and membership checks need a second observer; the harness only
  reports its own counters.
- 1,000 sessions from one process is unverified. Watch `generator.cpuPercentOfOneCore` and
  `eventLoopLagMs.p99`; split the population over several processes/containers if they climb.
- Reconnection/resume (`lastReceivedNonce`) is deliberately not modelled: a dropped socket is counted, not retried.
