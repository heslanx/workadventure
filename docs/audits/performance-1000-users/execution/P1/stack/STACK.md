# wa-fable stack: task-owned WorkAdventure server stack for the P1 load generator

State at 2026-11-12 00:04 UTC: **running on `sbh`, retained for the generator lane**. Two-client join probe passed.

## Where it lives

| Item | Value |
|---|---|
| Host | `sbh` (x86_64, 4 cores, 15 GB, shared with production services) |
| Compose file on host | `~/wa-jobs/wa-fable-20261111/stack/docker-compose.yaml` (copy: `docker-compose.wa-fable-stack.yaml` in this directory) |
| Compose project | `wa-fable-stack` |
| Source tree | `~/wa-jobs/wa-fable-20261111/src-wa-fable-stack`, baseline `ddbe245a8`, mounted **read-only** in every container |
| Network | `wa-fable-net` (bridge, label `owner=wa-fable-20261111`) |
| Published host ports | none |

## Containers

All carry `owner=wa-fable-20261111`, `--cpu-shares 512`, `restart: no`, json-file logs capped at 2 x 10 MB.

| Container | Image | Command | CPU cap | Memory cap | In-network endpoints |
|---|---|---|---|---|---|
| `wa-fable-stack-play` | `node:24-trixie` | `npm run dev-pusher` | 0.65 | 1536 MB | HTTP `:3000`, WebSocket `:3001`, metrics `:9100` |
| `wa-fable-stack-back` | `node:24-trixie` | `npm run dev` | 0.65 | 1536 MB | HTTP `:8080`, gRPC `:50051`, metrics `:9100` |
| `wa-fable-stack-maps` | `nginx:1.27-alpine` | static files from `maps/` | 0.10 | 128 MB | HTTP `:80` |
| `wa-fable-stack-redis` | `redis:6` | no persistence | 0.10 | 256 MB | `:6379` |

Total: 1.50 cores, 3456 MB.

## How to join

There is no reverse proxy, so the HTTP and WebSocket ports differ (the dev compose's traefik routes `/ws/` to 3001).

| Purpose | URL |
|---|---|
| Liveness | `GET http://wa-fable-stack-play:3000/ping` |
| Readiness | `GET http://wa-fable-stack-play:3000/ready` |
| Back reachable from pusher | `GET http://wa-fable-stack-play:3000/ping-backs` |
| Anonymous login | `POST http://wa-fable-stack-play:3000/anonymLogin` returns `{authToken, userUuid}` |
| Room socket | `ws://wa-fable-stack-play:3001/ws/room?...` |
| Room URL (`roomId`) | `http://wa-fable-stack-play:3000/_/global/wa-fable-stack-maps/starter/map.json` |
| Map JSON the back fetches | `http://wa-fable-stack-maps/starter/map.json` |
| Metrics, no token | `http://wa-fable-stack-play:9100/metrics`, `http://wa-fable-stack-back:9100/metrics` |

Other public test maps: any JSON under `maps/` of the snapshot, as
`http://wa-fable-stack-play:3000/_/global/wa-fable-stack-maps/<path under maps/>`.
Only `starter/map.json` was exercised. By code reading (`LocalAdmin.fetchMapDetails`, `GameRoom`), the segment after `/_/`
is an instance name that is not part of the map URL, so another value should give a separate room on the same map; not exercised here.

### Protocol facts the generator needs (verified by `join-probe.ts`)

1. The auth token goes in the WebSocket subprotocol (`new WebSocket(url, [authToken])`), not in the query string.
2. Required query parameters: `roomId`, `version` (`dev` in this snapshot, from `libs/messages/src/JsonMessages/ApiVersion.ts`),
   `chatID` (may be empty), `roomName`, `cameraState`, `microphoneState`, `tabId` (non-empty). The browser also sends `connectionId`.
3. Every frame is wrapped in a transport envelope. Client to server: `FrontToPusherWebSocketMessage { nonce, message: ClientToServerMessage }`,
   nonce strictly increasing from 1. Server to client: `PusherToFrontWebSocketMessage { nonce, message: ServerToClientMessage }`.
   A bare `ClientToServerMessage` is rejected with close code 1003 `Invalid message format`.
4. After `open`, send `joinRoomFrontMessage { positionMessage, viewportMessage, name, availabilityStatus: 1 }`.
   The pusher answers `roomConnectedMessage`, `roomJoinedMessage` (carries `currentUserId`), then `joinSpaceRequestMessage`.
5. Other users arrive inside `batchMessage` payloads (`userJoinedMessage`, `groupUpdateMessage`, ...).
6. Client reference implementation: `play/src/front/Connection/WorkAdventureWebSocket.ts` and `RoomConnection.ts`.

## Readiness evidence

Measured from a throwaway container on `wa-fable-net`, 2026-11-12 00:03 UTC. Receipts: `readiness-curl.out.txt`, `join-probe.out.txt`.

| Check | Result | Time |
|---|---|---|
| `GET play:3000/ping` | 200 `pong` | 3.9 ms |
| `GET play:3000/ready` | 200 `ready` | 3.6 ms |
| `GET play:3000/ping-backs` | 200 `pong` | 41.8 ms |
| `POST play:3000/anonymLogin` | 200, keys `authToken,userUuid` | 4.8 ms |
| `GET maps/starter/map.json` | 200, 33251 bytes | 3.8 ms |
| `GET back:8080/ping` | 200 | 5.6 ms |
| `GET back:9100/metrics` | 200, 137 metric lines | 5.9 ms |
| `GET play:9100/metrics` | 200, 134 metric lines | 5.4 ms |
| Two-client join (`join-probe.ts`) | exit 0, `PROBE_OK` | login to `roomJoinedMessage`: 49.5 ms (first client, room created) and 17.4 ms (second) |

The join probe shows the back owns the room: the first client received `userJoinedMessage` and `groupUpdateMessage` for the second one,
and the maps container logged the map fetch from the back's address (`172.21.0.4`, user agent `axios/1.16.1`; see `stack-logs.txt`).

These timings are single idle requests. They are not capacity or latency-under-load measurements.

## Run a generator on the same network

Run from the Mac as `ssh sbh '<command>'`. Put the generator script in a directory under the job root and mount it read-only.

```bash
docker run --rm --network wa-fable-net --name wa-fable-gen \
  --label owner=wa-fable-20261111 --cpus 1 --memory 1g --cpu-shares 512 --tmpfs /tmp \
  -v /root/wa-jobs/wa-fable-20261111/src-wa-fable-stack:/usr/src/app:ro \
  -v /root/wa-jobs/wa-fable-20261111/<generator dir>:/gen:ro \
  -w /usr/src/app/play -e TSX_TSCONFIG_PATH=tsconfig-pusher.json \
  -e PUSHER_HTTP=http://wa-fable-stack-play:3000 \
  -e PUSHER_WS=ws://wa-fable-stack-play:3001 \
  -e ROOM_URL=http://wa-fable-stack-play:3000/_/global/wa-fable-stack-maps/starter/map.json \
  node:24-trixie ../node_modules/.bin/tsx /gen/<script>.ts
```

The source mount gives the script the generated protobuf code without an install:
`import { FrontToPusherWebSocketMessage, PusherToFrontWebSocketMessage } from "/usr/src/app/libs/messages/src/ts-proto-generated/messages";`
Node 24's global `WebSocket` and `fetch` are enough; no extra packages are needed.

Re-run the probes (the working example of the join):

```bash
docker run --rm --network wa-fable-net --name wa-fable-stack-probe --label owner=wa-fable-20261111 \
  --cpus 0.5 --memory 512m --cpu-shares 512 \
  -v /root/wa-jobs/wa-fable-20261111/stack/probe:/probe:ro node:24-trixie bash /probe/readiness-curl.sh

docker run --rm --network wa-fable-net --name wa-fable-stack-probe --label owner=wa-fable-20261111 \
  --cpus 1 --memory 1g --cpu-shares 512 --tmpfs /tmp \
  -v /root/wa-jobs/wa-fable-20261111/src-wa-fable-stack:/usr/src/app:ro \
  -v /root/wa-jobs/wa-fable-20261111/stack/probe:/probe:ro \
  -w /usr/src/app/play -e TSX_TSCONFIG_PATH=tsconfig-pusher.json \
  node:24-trixie ../node_modules/.bin/tsx /probe/join-probe.ts
```

Watch the stack during a run:

```bash
docker stats --no-stream wa-fable-stack-play wa-fable-stack-back wa-fable-stack-redis wa-fable-stack-maps
docker logs --tail 50 wa-fable-stack-play
```

## What limits any number measured against this stack

1. The pusher and the back are each capped at 0.65 core. Saturation of this stack is a property of the cap, not of WorkAdventure at production sizing.
2. Both run in dev mode, as the dev compose does: `tsx watch`, `NODE_ENV=development`, Node inspector listening on `:9229` inside the network.
3. The host is shared. At setup time a sibling lane's container (`wa-fable-svelte`) was using about 1.6 cores.
4. `MAX_PER_GROUP=100`, `MINIMUM_DISTANCE=64`, `GROUP_RADIUS=48` (`.env.template` values). Users closer than 64 px form a bubble; the probe's two clients, 32 px apart, did.
5. Not verified: behaviour when a client never answers `joinSpaceRequestMessage`, behaviour of `/anonymLogin` at high request rates, and long-lived sessions. The probe held its sockets for a few seconds only.

## Differences from the dev compose

| Dev compose | This stack | Reason |
|---|---|---|
| `ghcr.io/thecodingmachine/nodejs:v2-24-trixie` plus startup `npm install` | `node:24-trixie`, tree already `npm ci`'d | image already on the host; no install on a shared host |
| play runs `npm run dev` (vite, svelte-check, i18n watch, pusher) | `npm run dev-pusher` only | the join path does not need the browser build; `ASSETS_URL` unset, the pusher reads `play/index.html` |
| traefik on 80/443 with `*.workadventure.localhost` | none; container names as hostnames | no published ports allowed |
| php/apache `maps` container | nginx serving `maps/` | the back only needs the map JSON |
| `DEBUG=socket,space` on play | unset | keeps per-socket log volume out of a load run |
| map-storage, synapse, oidc mock, icon server, redisinsight | absent; `ENABLE_MAP_EDITOR=false` | not on the anonymous join path |
| no metrics port | `PROMETHEUS_PORT=9100` on back and play | unauthenticated metrics inside the private network |

Known harmless log line at pusher start: `Failed to override admin account ratelimit: TypeError: Invalid URL` (Matrix is not configured).

## Do not

1. Edit anything under `src-wa-fable-stack` while the stack runs: `tsx watch` restarts the service and drops every socket.
2. Add `-p` to any container, or attach non-task containers to `wa-fable-net`.

## Restart and teardown

Restart one service without changing configuration:

```bash
ssh sbh 'docker compose -f ~/wa-jobs/wa-fable-20261111/stack/docker-compose.yaml restart play'
```

Teardown (stop any `wa-fable-gen` / `wa-fable-stack-probe` container first, or the network removal fails):

```bash
ssh sbh 'docker compose -f ~/wa-jobs/wa-fable-20261111/stack/docker-compose.yaml down'
ssh sbh 'docker ps -a --filter name=wa-fable-stack --format "{{.Names}}"; docker network ls --filter name=wa-fable-net --format "{{.Name}}"'
```

The second command must print nothing. `down` removes the four containers and `wa-fable-net`; there are no volumes.
The compose file and probe scripts stay in `~/wa-jobs/wa-fable-20261111/stack/` until the job root is removed.
