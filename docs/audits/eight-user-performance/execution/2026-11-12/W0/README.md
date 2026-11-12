# W0 - reproduction and browser evidence (2026-11-12)

State: **not_executed**. No real-browser run (1, 4 or 8 clients) happened in this window. Nothing below is a measurement of frames, GPU, media or freeze duration.

## 1. Access gap (why no browser run)

| UTC | Command | Result | Source |
|---|---|---|---|
| 00:05 | local preview reachability probe, 8 s budget | no answer within 8 s; MacBook load average above 700 | `../INTEGRATION-JOURNAL.md`, "Known limits" (recorded by the coordinator, not re-run by this lane) |
| 00:38:26 | `sysctl -n vm.loadavg` | `{ 575.97 545.75 624.78 }` | this lane |
| 00:38:26 | `curl -s -o /dev/null -w 'http_code=%{http_code} time_total=%{time_total}s\n' --max-time 8 http://play.workadventure.localhost/` | `http_code=000 time_total=0.001395s`, `curl_exit=7` (connection refused: nothing listens) | this lane |

Consequence: the only representative GPU hardware (the MacBook) was saturated and the preview was down. The brief forbids substituting a server-side software renderer, so the browser discriminators for H01-H04 and H21 stay `not_executed`. Protocol-only receipts belong to the P1 lane (`../../../../performance-1000-users/execution/P1/`); a headless generator proves protocol behavior, not rendering.

## 2. D04 - group and media settings readable from source (not the deployed values)

No container environment and no `.env` file was read. These are code defaults and checked-in examples only; the installation where the incident happened may override any of them.

| Setting | Source default | Where | Checked-in override |
|---|---|---|---|
| `MAX_PER_GROUP` (back) | 4 | `back/src/Enum/EnvironmentVariableValidator.ts:64-67` (`toNumber(val, 4)`) | Helm example `contrib/helm/values.yaml:57` sets `1000` in `commonEnv` |
| `MAX_PER_GROUP` (pusher) | 4 | `play/src/pusher/enums/EnvironmentVariableValidator.ts:410-412` | same Helm `commonEnv` |
| `MAX_USERS_FOR_WEBRTC` (back) | 4 | `back/src/Enum/EnvironmentVariableValidator.ts:152-155` | not set in `contrib/helm/values.yaml` |
| pass-through | `"$MAX_PER_GROUP"` | `docker-compose.yaml:85`, `docker-compose.yaml:260` | value comes from the operator's environment (not read) |
| pass-through | `MAX_USERS_FOR_WEBRTC` | `docker-compose.livekit.yaml:109`, `contrib/docker/docker-compose.prod.yaml:202` | same |
| P1 isolated stack | `MAX_PER_GROUP: "100"` | `docs/audits/performance-1000-users/execution/P1/stack/docker-compose.wa-fable-stack.yaml:56,107` | test stack only, not the incident |

Reading: with source defaults a bubble holds at most 4 users and stays WebRTC up to 4, so 8 users would form at least two bubbles. With the Helm example (`MAX_PER_GROUP=1000`, `MAX_USERS_FOR_WEBRTC` left at 4) all 8 can share one bubble and the policy should move it to LiveKit once it exceeds 4, or above 2 users when one reports CPU-limited encoders (`LIVEKIT_SWITCH_ON_CPU_LIMITATION`, described as default true at `back/src/Enum/EnvironmentVariableValidator.ts:156-159`), if LiveKit is configured and healthy (H12, `back/src/Model/Policies/TransitionPolicy.ts:42-48`). Only a full 8-person P2P mesh means 28 pairs. The deployed values are still the D04 gap: owner = operation, next discriminator = the operator reads the effective non-secret values of the incident installation.

## 3. Runbook for the next session: 1 -> 4 -> 8 browsers

Preconditions (record each in the receipt):

1. MacBook load average below the core count for 2 minutes: `sysctl -n vm.loadavg`.
2. Preview answers: the `curl --max-time 8` line above returns `http_code=200`.
3. Build mode written down (H21): the local stack is a Vite dev build; a production-build comparison is a separate run, never mixed.
4. Same map for every step; record the map URL and whether it has scripts or embedded sites (H06).
5. Browser extensions off (clean profile); record browser version, `devicePixelRatio`, canvas physical size (H04, H22).

Steps (each step: 2 minutes idle, then 2 minutes walking in and out of one bubble):

1. **1 client**: open the room, record `performance.now()` frame deltas for 60 s via a `requestAnimationFrame` loop in the console, plus one 30 s DevTools Performance trace. Baseline for H03 (a single idle user already spending frames means the map, not the crowd).
2. **4 clients** (separate browser profiles or machines, never 8 tabs on one saturated host): same recording on the observer. Note the media provider shown and the peer count (`chrome://webrtc-internals`).
3. **8 clients**: same recording. Then the discriminators: everyone still vs everyone walking (H01/H02), all far apart vs all in one bubble (H01, H12), chat panel closed vs open with long history (H05), map with scripts vs a copy without (H06).
4. For each step, store: frame-delta p50/p95/max (ms), long tasks over 50 ms (count), JS heap (MB), peer connections (count), provider (P2P or LiveKit), and whether menus froze together with the canvas (H02) or only conversation activation lagged (H13).
5. Put receipts under `docs/audits/eight-user-performance/execution/<date>/W0/` with UTC times; no credentials, tokens or `.env` values.

Acceptance: a hypothesis moves to `confirmed` or `refuted_in_scenario` only when the 8-client value differs from the 1- and 4-client values by more than the spread of two repetitions.

## 4. States

| ID | State | Scenario | Evidence | Next discriminator | Owner |
|---|---|---|---|---|---|
| D04 | inconclusive | source defaults and Helm example only | this file, section 2 | effective non-secret values of the incident installation | operation |
| D01/D07/A03 browser side | not_executed | no browser run | this file, section 1 | runbook section 3 | W0 browser agent |
| H01-H04 browser discriminators | not_executed | no browser run | this file, section 1 | runbook steps 1-3 | rendering |
| H21 | not_executed (dev build confirmed locally) | local stack is Vite dev | `../W4/README.md` H21 row | production-build run with the same map | build/operation |

## 5. Resources

None started by this stream for W0 (one `curl` and one `sysctl`, both finished).
