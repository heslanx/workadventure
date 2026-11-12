# P1-stack lane: isolated WorkAdventure server stack on sbh

Status at 2026-11-12 00:07 UTC: done. The stack is running and retained for the generator lane. Start with `STACK.md`.

No product file in the checkout was edited. Everything this lane wrote is in this directory and in
`~/wa-jobs/wa-fable-20261111/stack/` on `sbh`.

## What was done

1. Read `docs/agent/dev-setup.md`, `docker-compose.yaml`, `.env.template`, `back/AGENTS.md`, `play/AGENTS.md`, and the pusher/back
   env validators and join path, to find the minimum set of services: pusher, back, redis, a static map server.
2. Wrote a compose file and started four capped containers on a dedicated network `wa-fable-net`, with no published ports.
   The source snapshot is mounted read-only.
3. Proved readiness from inside the network: HTTP checks and a two-client WebSocket join.
4. Wrote `STACK.md` with names, endpoints, protocol facts, the generator command template and teardown.

## What was measured

Single idle requests from a throwaway container on `wa-fable-net` (not load measurements):

| Check | Result |
|---|---|
| `GET /ping`, `/ready`, `/ping-backs` on the pusher | 200, 3.6 to 41.8 ms |
| `POST /anonymLogin` | 200 in 4.8 ms, body keys `authToken,userUuid` |
| Map JSON from the maps container | 200, 33251 bytes |
| Two anonymous clients join the same room | exit 0; `roomJoinedMessage` 49.5 ms and 17.4 ms after login; first client received `userJoinedMessage` |
| Idle footprint | back 212 MiB, pusher 228 MiB, about 1 % CPU each |
| Caps in force | 1.50 cores and 3456 MB total, `cpu_shares=512`, zero published ports |

## Failures met on the way

| Step | Exit / symptom | Cause | Fix |
|---|---|---|---|
| First pusher start | env validation: `ICON_URL: Required` | the pusher requires `ICON_URL` | added the dev compose value |
| First join probe | exit 1, close code 1003 `Invalid message format` | frames must be wrapped in `FrontToPusherWebSocketMessage` with a nonce | probe now sends and decodes the envelopes |
| First state capture | exit 1 with complete output | `grep -c` exits 1 on a zero count (zero published ports is the expected result) | recaptured with `awk`, exit 0 |

## Files

| File | Content |
|---|---|
| `STACK.md` | how to reach, use and tear down the stack |
| `docker-compose.wa-fable-stack.yaml` | byte-identical copy of the compose file on `sbh` (synthetic keys only) |
| `join-probe.ts`, `readiness-curl.sh` | the probes, also at `~/wa-jobs/wa-fable-20261111/stack/probe/` on `sbh` |
| `readiness-curl.out.txt`, `join-probe.out.txt` | probe receipts with commands and exit codes |
| `stack-state.txt` | containers, caps, labels, mounts, network, idle stats |
| `stack-logs.txt` | bounded service logs, including the back's map fetch |

## What remains

1. The generator lane has to build and run the load generator; nothing here measures capacity.
2. Not verified: a client that never answers `joinSpaceRequestMessage`, `/anonymLogin` at high request rates, sessions longer than a few seconds,
   and any map other than `starter/map.json`.
3. Teardown when the generator lane is finished: `ssh sbh 'docker compose -f ~/wa-jobs/wa-fable-20261111/stack/docker-compose.yaml down'`.
