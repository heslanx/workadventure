# W2 proximity and media lifecycle: H10-H14, A02

Stream W2, 2026-11-12. Baseline `ddbe245a8`. No product file was edited: no failure was reproduced, so the brief's
condition for product code ("only for a reproduced failure") was not met.

## Tests that ran

Run by the previous W2 agent before its quota ran out; this round read the logs and did not re-run them (same tree,
no relevant change). Paths in the logs (`/work/play`, `/work/back`) are the `wa-fable-h8` mount on `sbh` (1 CPU,
pristine npm-ci'd tree of the baseline). The exact command lines were not captured in the logs; the file list below
comes from the vitest output.

| Log | Window (UTC) | Files | Result |
|---|---|---|---|
| `logs/01-front-baseline.log` | 00:18:41-00:19:39 | `src/front/Space/tests/SpaceRegistry.test.ts`, `src/front/Space/tests/SpaceIntegration.test.ts`, `tests/front/Chat/Connection/ProximityChatRoomManager.test.ts`, `tests/front/WebRtc/ProximitySpaceManager.test.ts` | 4 files, 37/37 passed, `EXIT_CODE=0`, 47.88 s |
| `logs/02-back-baseline.log` | 00:21:13-00:21:27 | `tests/CommunicationManager.test.ts`, `tests/TransitionPolicy.test.ts` | 2 files, 79/79 passed, `EXIT_CODE=0`, 4.73 s |

The stderr lines in both logs (`Space user id not found`, a failing admin on end) are expected errors raised by the
tests that assert them; each such test passed.

Relevant cases covered: abort of a bubble join left before it was joined, so the next bubble does not wait
(`ProximitySpaceManager`); leave requested during an in-flight join runs after it; a concurrently re-joined room is not
lost; stale bubble leave ignored (`ProximityChatRoomManager`); concurrent joins of one space coalesce, leave+join race
(`SpaceRegistry`); delayed LiveKit-to-WebRTC transition, cancellation when conditions change, a concurrent watch waits for
the in-flight transition (`CommunicationManager`); threshold, LiveKit availability and `cpuLimited` rules
(`TransitionPolicy`).

What these tests do not show: real media, peer connections, CPU, heap, or browser timing. Transport is mocked.

## Hypothesis states

| ID | State | Scenario | Evidence | Next discriminator | Owner |
|---|---|---|---|---|---|
| H10 | not_executed | needs a browser session with repeated enter/leave cycles | none in this window (MacBook saturated, see integration journal) | heap snapshots at equivalent checkpoints after N identical cycles; count detached nodes, textures, listeners, peer connections | game/chat/media lifecycle |
| H11 | not_executed | needs real tracks and AudioContexts in a browser | static only (`README.md` H11) | four arms: outside conversation; inside without publishing; microphone; microphone with suppression; per arm tracks, connections, bytes, renderer CPU | audio |
| H12 | inconclusive | policy in unit scope (mocked transport) | `logs/02-back-baseline.log`: `TransitionPolicy` moves above threshold only when LiveKit is available, returns at or below it | effective nonsecret `MAX_PER_GROUP` / `MAX_USERS_FOR_WEBRTC` of the deployment, provider and peer count per participant when crossing it | communication |
| H13 | inconclusive | known ordering/cancellation races, unit scope | both logs: 116/116 passed, no ordering failure reproduced | correlate pauses with provider switches, peer counts and connection events in an 8-user run with repeated entries/exits | communication/proximity |
| H13a: a stale leave holds the next bubble for the 9 s backstop | refuted_in_scenario | `ProximitySpaceManager` unit test, mocked transport | `logs/01-front-baseline.log` line 70 (58 ms) | same case against a real pusher with latency | proximity |
| H14 | not_executed | needs ICE/TURN negotiation in browsers on real networks | static only (`README.md` H14) | selected candidate pair, RTT, loss, renegotiation count; same person on two networks; no credentials logged | media/operations |

A02 proposal: `A02.proposal.md`.

## Resources

None created in this round (logs only read).
