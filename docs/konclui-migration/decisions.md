# Engineering decisions of 2026-11-18

On 2026-11-18 the owner delegated these decisions: "decide yourselves, validate every hypothesis, never wait on me". Each section gives the decision, the evidence, the open hypotheses and how each is checked, the first slice, and how to reverse it. Every slice is a separate, reversible commit made through the integrator session ([integration loop](../integration/LOOP.md)).

Status at the time of writing: decided. No implementation slice below is committed. The C5 rule in `messages/AGENTS.md` lands with this file, and the COPY catalog edits are in the working tree, uncommitted.

| ID | Subject | First slice |
|---|---|---|
| C1 | Who sees whom in one room of 1000 | Load generator: browser-like viewport, patterns, world-space join |
| C2 | Zoom-out and client cost | Measure the whole-map view; no product code |
| C3 | World headcount and roster | Bots join the world space; then headcount in space state |
| C4 | WebRTC and LiveKit roles | Opt-in cap on peers per user in the back |
| C5 | Protocol compatibility with upstream | Record the rule in `messages/AGENTS.md`; then pusher counters |
| COPY | Entry-screen button copy | Catalog-only commit |

Evidence notes:

- File and line references were read on 2026-11-18 and spot-checked at `75901117c`. Lines drift as other sessions edit; search by symbol when a line no longer matches.
- Measurements live outside git in `~/.claude/orchestrate/konclui-native/evidence/` (`perf/baseline-2026-11-17.md`, `perf/load-1000-stats.log`, `engine-1000-plan.md`). `konclui-work/` is the reference project, read only.
- Numbers marked "derived" are arithmetic over read constants, not measurements.
- A hypothesis stays open until its check passes. A failed check changes the decision, not the check.

## C1. Interest-managed awareness in one room

**Decision.** One room per office, no shards. Live avatars follow the existing viewport-to-zone subscription plus a per-viewer budget in the pusher: about 150 nearest peers at full rate, the rest of the viewport and margin at 1 Hz, a hard ceiling of about 400 in-scene peers at any zoom. The budget sits behind an env flag, default off. Awareness of everyone comes as cheap tiers: the headcount as one integer, and a windowed directory read only while the list is open, with "Ir até" through the existing `AskPosition` pull. Audio and video are unchanged. We do not promise "everyone sees all 1000 live". There is no proto change, so the fork stays wire-identical.

**Evidence.**

- Interest management exists end to end: `play/src/pusher/models/PositionDispatcher.ts:41,139-177` (1600-zone cap, same-rectangle skip), `back/src/Model/GameRoom.ts:144-148` (320 px zones), `play/src/front/Phaser/Game/GameScene.ts:317,1760-1792,4528-4547` (camera view plus 300 px margin). `HdpiManager.ts:45-52` allows zooming out to the whole map.
- Geometry alone is no bound (derived): the office is 86x56 tiles of 32 px, 54 zones. A 1920x1080 camera at zoom 2 subscribes 20.6 of 54 zones on average (38%); whole-map subscribes 100%. The Plateia area touches 6 zones, so a town hall of 1000 reaches every viewer at any zoom.
- All-see-all is too expensive (measured). 300 bots sent 11x the bytes of 100 (`baseline-2026-11-17.md:11-17`). At 1000 bots, 823 were accepted, delivery was 0.468, move p95 3.2 s, pusher 94-144% CPU while the back stayed at 5-19% (`load-1000-stats.log`). The reference project's own run costs about the same with viewport interest as with full awareness (`konclui-work/docs/plans/20261111-low-bandwidth-capacity.md:78-83`).
- The client is the other limit: 300 walking bots with effects on cost frame work p50/p95 7.4/8.5 ms on an M1 Max with Metal (`baseline-2026-11-17.md`, "Scene effects ported").
- Media is independent: bubbles come from the back's spatial hash (`GameRoom.ts:614-650`), capped at 4 (`EnvironmentVariableValidator.ts:70-73`); `TransitionPolicy.ts:44-52` moves to LiveKit above the cap.
- The repo contract already has this shape: `contracts.md:44` (no per-tick coordinates in `allWorldUser`, offscreen coordinates need a separate low-frequency contract).
- The 1000-bot run excludes the world roster: `benchmark/src` has no `joinSpace`, while every browser joins `allWorldUser` (`GameScene.ts:2582-2597`), and `SpaceToFrontDispatcher.ts:421-433` (`notifyAll`) does not call `encodeOnce` (`BatchFrame.ts:27`). Real-browser cost is understated by the current numbers.
- Wire-identical today: `git diff upstream/master...HEAD -- messages/protos` is empty, and the pusher rejects any other `apiVersionHash` (`IoSocketController.ts:291`).

**Open hypotheses.**

| Hypothesis | Check |
|---|---|
| Uniform walkers with a browser viewport know 31-38% of peers; whole-map knows 100% | Slice 1 report of known peers p50/p95; pass within 5 points |
| Pusher CPU per 1M delivered sub-messages at 1000 is within 25% of the 300 value | Slice 1 at N=1000 on the Linux host |
| The roster adds measurable join and CPU cost | Slice 1, `--world-space` on versus off; report both deltas |
| A second pusher halves per-pusher CPU | Slice 1, 2 pushers at 600 bots; if not halved, the scale-out claim stays dead (the reference's 2-replica row did not halve it; same-host contention is not excluded) |
| 1000 avatars exceed the 16.7 ms client budget | C2 slice 0 |
| A bot sees about 236 of 1000 at 1000 (derived; the 1000 run failed) | Slice 1 known peers at N=1000 |
| K=150 and the 400 ceiling are the right values | Slice 3 sets them from the slice 1 table |

**First slice** (size S, `benchmark/` only, no product code, no flag). This is the Phase 0 gate.

- Files: `benchmark/src/config.ts`, `protocol.ts` (viewport half sizes at `:56-57` become a parameter; add the `joinSpaceQuery` message), `session.ts` (the fixed ellipse becomes pattern-driven), `runner.ts`, `probe.ts`, `stats.ts`, tests in `benchmark/tests`.
- Flags: `--viewport=bot|browser|zoomout` (bot = today's 640x400; browser = 960x540 plus 300 px margin clipped to the map; zoomout = whole map); `--pattern=ring|uniform|plaza` (ring = today's ellipse; plaza = the Plateia rectangle 192,416,416x544); `--moving-fraction`; `--world-space`.
- Report per bot: known peers (joined minus left) p50/p95; sub-messages and bytes per second by event type over the steady window; joins per walker-second.
- Regression anchor: defaults (`--viewport=bot --pattern=ring`, world space off) reproduce `baseline-300.json` within 5%.
- Table: N = 50, 200, 1000 by four viewport/pattern combinations by 5/20/100% walking by world space on/off, 3 interleaved runs, median, plus one 600 s ramp. N = 300 may run on the Mac as a smoke. N = 1000 runs only on the Linux host with pusher and bots on one network, never on Colima (it dropped its VM at 1000).
- Flag reconciliation: C1 and C3 both name a `--world-space` flag. One flag serves both: a watch fraction from 0 to 1, with `off` = 0 (default, keeps baselines comparable) and `on` = 1.

Next slices, each flagged and measured with the slice 1 table: (2) headcount and lazy roster, which is C3; (3) the per-viewer budget: new `play/src/pusher/models/ViewerBudget.ts`, hook in `Zone.ts` `notifyUserMove` (`:468-475`), env `PUSHER_VIEWER_FULL_RATE_PEERS` (0 = off, suggested 150) and `PUSHER_VIEWER_MAX_PEERS` (suggested 400), client interpolation from C5 slice (c); (4) coarse place per person only if the minimap needs it (the only tier that adds a proto field).

Go/no-go for slice 3, read at N=1000 with the flag off: if uniform/browser at 20% walking holds delivery at or above 0.99, move p95 at or below 250 ms and the pusher under about 0.7 core, build the budget anyway for whole-map and plaza viewers, but keep K high. If it fails everywhere, the budget is mandatory.

**Reverse.** Slice 1 changes no product behaviour (benchmark only). Slice 2 is C3 1b, behind one flag, default on in Konclui; turn it off to restore the permanent roster watch. Slice 3 is reverted by turning its env flag off. If the budget fails its gate on a Linux host, the fallback is option D, floors of about 250-300 people per map.

## C2. Zoom-out and client cost

**Decision.** Keep the whole-map zoom-out exactly as upstream. Add no zoom limit and no zoom floor. Bound client cost with a detail budget keyed on avatars in view: when more than B remote avatars are in the camera view (start B = 80, tunable, flag default off), the B nearest the player plus pinned ones (hovered, followed, in my conversation bubble) stay full avatars and the rest become dots with no name tag, no animation, skipped by `SceneEffects`, drawn as tinted Blitter bobs. Below B nothing changes.

**Evidence.**

- A zoom limit cannot meet "never stall" (derived): the default view at 1451x855 plus the 300 px margin covers about 28% of the room, about 276 of 1000 uniform avatars. The measured slope is 62 us per present avatar (`client-frame-after-300.json` p50 7.7 ms at 114 name tags; `client-frame-0.json` 0.7 ms at 1), so 276-380 present avatars cost 17-24 ms per frame at default zoom, over the 16.7 ms budget.
- A zoom limit is the wrong tool: the whole-map clamp is `HdpiManager.ts:44-52` and every zoom path ends in it (`GameScene.ts:4862-4896`, `CameraManager.ts:316-328` and `:695-700`). A floor inside it would clamp `WA.camera.set`; a floor outside it needs a new `ClientExtensionPoints` port.
- Nothing culls: `ContainerWebGLRenderer.js:73-80` skips children only through `willRender`, and interpolated remote avatars dirty the scene every frame (`GameScene.ts` near 1555). At whole-map everything is visible, so only reducing detail helps.
- All measurements are default zoom only, JS time only, ring-walking bots. Whole-map has never been measured.
- Contract: whole-map awareness stays a zone-scoped subscription (`contracts.md`, room roster section). The budget needs no protocol change.

**Open hypotheses.**

| Hypothesis | Check |
|---|---|
| The 62 us per avatar slope holds from 113 to 1000 present avatars (extrapolated) | Slice 0 at bots 0/100/300, default and whole-map |
| With B = 80, frame work at 1000 is about 11 ms (80 x 59 us + 920 x 8 us or less; unverified) | Slice 1 against slice 0, 300 bots whole-map, then projected to 1000 |
| The default view holds about 276 of 1000 avatars | Slice 0 `nameTagsInDom` at default zoom (derived from `HdpiManager` default zoom, not re-read) |
| Names hidden below zoom 0.65 are enough for a first gain | First commit of slice 1, measured with the same probe |

**First slice.**

- Slice 0 (about 1 hour, no product code): add a whole-map step to `.local/konclui/qa/frame-probe/probe.mjs`. After a 5 s settle, send `page.mouse.wheel(0, 800)` twice, let the zoom settle, record 25 s with `e2eHooks.startFrameRecording()` and `stopFrameRecording()`. Matrix: bots 0/100/300 at 5 moves/s by default/whole-map by effects on/off, Metal GPU, 3 interleaved runs, median. Record name tags in DOM, work/step/render p50/p95, long tasks (including the 2 s after the wheel), WebSocket bytes. Write `evidence/perf/zoomout-<date>.md` next to the baseline.
- Slice 1 (size M, client only, flag default off): new `play/src/front/Phaser/Game/AvatarDetail.ts` (pure `chooseDetail` with hysteresis), `AvatarDotLayer.ts`, and tests in `play/tests/front/Phaser/Game/AvatarDetail.test.ts`. Recompute on zoom change (debounced), a 250 ms timer and player add/remove. First commit inside the slice: hide name tags below zoom 0.65. Do not touch `HdpiManager`, `CameraManager` or any zoom path. Coordinate before editing `UsernameDisplay.ts` (uncommitted edits by another session). No user-visible text, so no locale work.
- Accept: 300 bots whole-map, work p50 at least 50% below flag-off and no long task over 50 ms; 100 bots (below B) within noise with identical screenshots at default zoom; projected p95 at 1000 at or below 16.7 ms on a GPU. If the gain is under 30%, stop and re-plan.

Later: a flat plan view with a low-frequency overview feed, and a 1 Hz per-viewer position tier for dot viewers (C1 slice 3).

**Reverse.** Turn the flag off (localStorage override for A/B, like `konclui.fx.off`). The zoom code is untouched, so there is nothing else to undo.

## C3. World headcount and roster

**Decision.** Count first. The world headcount is one integer (distinct uuid) owned by the back and pushed in the world space state, at most one patch per second. The header and pill read it, never the roster. The full roster (`addSpaceFilter` on `allWorldUser`) is watched only while something reads it: the people panel reads it only when the headcount is at or below T = 200 (hysteresis 180/220, one constant). Above T the panel shows "Perto de você" from the zone feed already in memory, windowed to about 60 rows, plus an explicit "Todos" entry that watches on demand and shows the first 200 honestly, with the count taken from the headcount. A pusher-served name search replaces that entry later. We do not port the reference presence broadcast, and we do not keep a permanent live list of everyone. It ships behind a flag; off restores today's wiring.

**Evidence.**

- The waste is permanent: every client calls `joinSpace(allWorldUser, ALL_USERS)` at scene start (`GameScene.ts:2584-2595`, `WorldUserProvider.ts:23-26`); `ForwardableStore.forward` subscribes immediately (`libs/store-utils/src/ForwardableStore.ts:12-19`), which sends `addSpaceFilter` (`play/src/front/Space/Space.ts:152-162`). All N clients watch to show one number.
- The cost is a burst (read from code, quadratic): `notifyAll` sends each add to every local watcher (`SpaceToFrontDispatcher.ts:415-431`), a new watch gets a full init (`:461-486`), `encodeOnce` is used only in `Zone.ts`.
- A lazy watch alone saves nothing on desktop, because the shell opens the people panel on wide screens (`play/src/front/Konclui/Shell/stores/sidePanelStore.ts`). So the default panel must not need the roster above T.
- The count has a carrier with no proto change: state patches reach every member, watching or not (`SpaceToFrontDispatcher.ts:386-400`), the back broadcasts through `updateState` (`back/src/Model/Space.ts:787-806`), and `SpaceState.ts:126-137` has no headcount yet. `SpaceUser` has `uuid`.
- Nothing measured the roster: `benchmark/src` does not mention spaces.
- Upstream truncates at 200: `RoomUserList.svelte` slices the list and takes the badge from the slice, so above 200 the number is wrong. The count must not come from the list.
- The reference degrades by staleness at 1000, and the contract forbids rebuilding it (`contracts.md:44`).

**Open hypotheses.**

| Hypothesis | Check |
|---|---|
| Roster records encoded scale as N squared | Slice 1a BEFORE at N = 50, 200, 300, 500 |
| T = 200 is the right threshold (byte and microsecond constants are not verified; the two analyses disagree, 389-961 B versus 551 B per `SpaceUser`) | Slice 1a data; set T from it |
| With 0 watchers, 1000 members cost at most 1% of a core for the roster and about 0.15 KB/s per client | Slice 1b AFTER, same bot run as 1a |
| No client sends `addSpaceFilter` until the panel opens or "Todos" is chosen | Slice 1b: real-browser WebSocket capture |
| Hysteresis 180/220 prevents mode flicker | Slice 1b front test |

**First slice.**

- 1a (size S, the instrument): world-space support in the generator (`benchmark/src/protocol.ts`, `session.ts`, `config.ts`, `runner.ts`, `stats.ts`, `benchmark/tests/harness.test.ts`). `--world-space=<watchFraction>` (default 0): a bot sends `joinSpaceQuery` for `allWorldUser` (ALL_USERS, `availabilityStatus`, `chatID`) then `addSpaceFilter` for the watching fraction; the report gives records and bytes by type per second and per client; add a mass-rejoin step. BEFORE: N = 50, 200, 300, 500 with fraction 1, 60 s ramp, 60 s steady, one mass rejoin, production build, 3 interleaved runs, median. 1000 only on the Linux host. This is the same generator slice as C1 slice 1.
- 1b (size M, one flag, default on in Konclui): `headcount` (non-negative int, default 0) in `libs/shared-utils/src/SpaceState/SpaceState.ts`; the back keeps a `Map<uuid, refcount>` for the world space only (identified by the `allWorldUser` name) with a trailing 1000 ms debounce, then `updateState`; `GameScene.ts` reads `space.state.observe('headcount')` and falls back to the user count for an older back; a lazy gate around the world provider with pure mode rules in a new `play/src/front/Konclui/Presence/domain`; clear stale rows when the filter is registered again (`Space.ts:665-706,927-948`).
- Tests that fail on revert: back unit (two sessions of one uuid count 1; leave decrements; 10 joins in 1 s give 1 patch); pusher (a state patch reaches a member that never sent `addSpaceFilter`); front (the count store never subscribes `usersStore`; no `addSpaceFilter` while the panel is closed or above T; no stale user after re-watch; no flicker inside 180-220).

Later: Presence directory store with windowed rows; pusher-served name search; pulled positions for "Ver no mapa" (new low-frequency contract, then retire `office-presence`); `encodeOnce` for space add/remove, kept only if CPU per 1000 joins improves by more than 10%; set T from data.

**Reverse.** Turn the flag off to restore the permanent watch. The `headcount` field has a default, so older clients and backs ignore it.

## C4. WebRTC and LiveKit roles

**Decision.** Bubbles stay P2P up to `MAX_USERS_FOR_WEBRTC` = 4. LiveKit is the only transport above 4 and for every broadcast (megaphone, speaker zones, meeting rooms); there is no P2P broadcast. First slice: an opt-in env `MAX_P2P_PEERS` (positive int, unset = unlimited = upstream behaviour) that caps the peers one user holds in `WebRTCCommunicationStrategy`, so a missing or unhealthy LiveKit never becomes a 999-connection mesh in the speaker's tab. The Konclui compose should pin it to 3 (a config line in the other repo, a follow-up). LiveKit moves to its own node as a queued ops item, triggered before any broadcast above about 200 listeners or any screen-share broadcast, sized from a load test that does not exist yet. We do not lower `MAX_USERS_FOR_WEBRTC` to 1 or 2 and do not pace invitations. After the load test, broadcast listeners become cheap on the SFU (hidden, `canPublish=false`) behind a flag.

**Evidence.**

- The switch rule is in `back/src/Model/Policies/TransitionPolicy.ts:44-51`: WebRTC to LiveKit above the member threshold, for a CPU-limited member with more than 2 users, or for auto-recording, and only if LiveKit is available. Available means configured, not healthy (`LivekitAvailabilityService.ts:17-22`). The count includes every watcher (`CommunicationManager.ts:466-473`).
- The P2P strategy has no cap: `shouldEstablishConnection` only checks for an existing connection (`WebRTCCommunicationStrategy.ts:189-193`), `establishConnection` sends 2 messages per pair (`:195-199`), and `addUser`, `addUserToNotify` and `initialize` loop over every watcher (`:74-102,127-148,260-283`). One speaker and 999 watchers is 1,998 messages and 999 peer connections in one tab (derived from code).
- Nothing in `play/`, `libs/` or `messages/` reads `MAX_USERS_FOR_WEBRTC`; the rule lives only in the back.
- Why opt-in: the dev template ships `MAX_PER_GROUP=100` and `MAX_USERS_FOR_WEBRTC=3` (`.env.template:39,205`) and Helm ships `MAX_PER_GROUP` 1000 with LiveKit off (`contrib/helm/values.yaml:57`). A derived default would break bubbles for self-hosters without LiveKit.
- The only SFU numbers we own are the 2026-10-08 grid tests on the shared 3-vCPU VPS (`konclui-work/README.md:396-412`: 20 cameras ok, 40 cameras 44% loss). They are not the one-publisher, N-subscriber shape.

**Open hypotheses.**

| Hypothesis | Check |
|---|---|
| Bubbles cost the server nothing as P2P; a broadcast needs an SFU (arithmetic, not measured on this stack) | SFU load test (`lk load-test`, 1 publisher, N = 50/200/1000, once with screen share) on a Linux host |
| A failing `createRoom` downgrades two later speakers (H10) | Slice 1b unit test in `back/tests/LivekitCommunicationStrategy.test.ts` |
| Hidden listeners (`canPublish=false`) cut SFU cost | Measure in the load test before slice 3 |
| The 200-listener trigger is right | Load test table (cores, Gbps, join p95, loss) |

**First slice** (size S, back only, no protocol change, upstreamable).

- `back/src/Enum/EnvironmentVariableValidator.ts`: optional `MAX_P2P_PEERS` next to `MAX_USERS_FOR_WEBRTC` (`:158-161`), no default.
- `back/src/Model/Strategies/WebRTCCommunicationStrategy.ts`: constructor takes an optional `maxPeers`, passed from `States/WebRTCState.ts:18` and the factory in `CommunicationManager.ts:75-79`. One helper `canPair(a, b)`: no existing connection, and both peer counts below the cap. Use it in `shouldEstablishConnection` and in `initialize`. Log once per space and report with Sentry when a pair is refused. Do not touch the LiveKit path.
- `back/tests/WebRTCCommunicationStrategy.test.ts`: first, on unmodified code, a test that 1 speaker and 999 watchers dispatch 1,998 start messages. Then tests that fail on revert: cap 3 dispatches 6; a bubble of 4 with cap 3 still dispatches 12; a 5th user in a capped space dispatches 0 new starts; cap unset still dispatches 1,998.
- Known limits to name in the tests: a refused pair is not retried when a slot frees; with several speakers a watcher past the cap gets no stream (fail-closed).
- Slice 1b (XS): the failing-`createRoom` test; if two speakers fail while the first is present, clear `createRoomPromise` on rejection.
- Follow-ups: `MAX_P2P_PEERS=3` in `konclui-work/docker-compose.yml` (other repo, needs its own scope); the SFU load test; the dedicated LiveKit node (needs infrastructure and approval, queued, not waited on); `LIVEKIT_HIDDEN_LISTENERS` (default off) after measurement.

**Reverse.** Unset `MAX_P2P_PEERS`: behaviour is upstream. Everything else is configuration.

## C5. Protocol compatibility with upstream

**Decision.** Stay wire-compatible with upstream through phase 3 of the engine plan. Edit nothing under `messages/protos`: no velocity, no sender-side dead reckoning, no ack nonce, no new oneof arm, no second proto file. Cut the rate with server policy plus a client receiver that follows the observed update interval. Plan item 4.2 (fork-only sender protocol) becomes a gated option: first additive optional fields, then a relay-side stage in the pusher, only after the gate trips. Replace the ack nonce of plan item 2.3 with a cherry-pick of upstream `04634ad3f` (store cap) plus the existing `CLIENT_DISCONNECTION_RETENTION_MS`.

The gate, measured on a Linux host after the first slice, the interval-aware receiver and C1 slice 3, with `--moving-fraction` and a browser-sized viewport: the 1000-person dense run still fails any of move latency p95 at or below 250 ms, pusher at or below 0.10 core per 100 users (a threshold proposed here, about 60% of a core at 1000 and 20% walking), or near-band downlink at or below about 50 kbit/s per client; and a pusher CPU profile attributes at least 25% to move fan-out; and fork-built pusher and back images are the release path.

If the gate trips, fork additions are `optional` fields numbered 100 or higher, only in `PositionMessage`, `UserMovesMessage` and `UserMovedMessage`. See `messages/AGENTS.md`.

**Evidence.**

- The sender is not the bottleneck: at 1000 bots the pusher ran 94-144% CPU while the back stayed at 4.6-18.7% (`load-1000-stats.log`). The fan-out is `Zone.notifyUserMove` (`play/src/pusher/models/Zone.ts:468-475`) and then `emitInBatch` (`PusherWebSocket.ts:71-93`).
- Sender-side dead reckoning would put correctness risk on the back, which recomputes zones, area enter/leave and bubbles from every reported position (`back/src/Model/PositionNotifier.ts:76-96`, `AreaZoneTracker.ts:40-53`), and on six office scripts that subscribe to `WA.player.onPlayerMove` at the share cadence. The sender throttle is `POSITION_DELAY` = 200 ms (`GameScene.ts:4505-4540`).
- The release path is wire-bound to official images: `deployment/konclui/compose.yaml:24,60,74` pins `thecodingmachine/workadventure-{play,back,map-storage}:v1.34.5`, and `release.md:7` and `candidate-runtime.md:36` say the custom front is mounted into the official Play image. A fork protocol cannot ship until fork-built server images are scheduled. The QA stack is fork-built, which is why the two sets of documents looked inconsistent.
- Merge risk is in the oneofs and resume code, not the move messages: `git log upstream/master -L` on `PositionMessage` and `UserMovedMessage` shows only `e9ca8721a` (2020-09-18), and `git log upstream/master..konclui/main -- messages/protos` is empty.
- The pusher already keeps only the last group update per group in each 100 ms batch (`PusherWebSocket.ts:32,74-80`, commit `50632e874`), so the 29.9% group-update share in `pusher-300-after.json` is already post-conflation. The remaining gain is the position-only subset.
- Remote samples are drawn over a fixed `POSITION_DELAY` (`GameScene.ts:4733-4745`) and extrapolated at most 100 ms (`PlayerMovement.ts:13-42`), so a thinned stream reads as stop-and-go. The receiver is a prerequisite for any cadence below 5 Hz.
- Every number that depends on the walking fraction is unproven: the bots always walk (`benchmark/src/session.ts:60-67,251-260`).

**Open hypotheses.**

| Hypothesis | Check |
|---|---|
| Pusher CPU is dominated by move fan-out (at least 25%) | Pusher `--cpu-prof` in the 1000-bot dense run |
| The N squared model and per-client kbit/s extrapolations hold | Slice (a) counters plus the dense run at f = 0.2 and 1.0 |
| Real walking fraction f is well below 1 | Slice (a) gauge of sockets whose last move had `moving=true` |
| Without the receiver, still frames at 5/2.5/1.5/1/0.5 Hz are 8/24/54/69/85% | Deterministic test in slice (c) reproduces it |
| Slice (b) cuts pusher CPU median from 35% to about 27% | Exact `pusher-300-after` procedure, 3 interleaved runs, median |
| RemotePlayer has no collider, so no extrapolation beyond 100 ms is needed | Re-read `RemotePlayer` (not re-read for this record) |

**First slice** (docs, same day, no behaviour): record the rule in `messages/AGENTS.md` (done with this record). Optional pin test: a hash of the four move message blocks, so an upstream change is visible at the next merge.

Then three small slices, pusher-only (a, b) and client-only (c):

- (a) per-type accounting in `play/src/pusher/services/GaugeManager.ts`, incremented in `PusherWebSocket.emitInBatch` and `flushBatch`: `workadventure_pusher_sub_messages_total{type}`, `..._bytes_total{type}`, and a gauge of sockets whose last move had `moving=true`. Pass: counters match the bot-side counts of `pusher-300-after.json` within 1%.
- (b) in `Zone.ts` `handleGroupUpdateZone` (`:285-299`), compare size and lock before notifying; keep updating the descriptor so late listeners get the current position. Test next to `play/tests/pusher/PositionDispatcher.test.ts`. Pass: group updates under 10% of the 2,365,979 baseline, userMoved and delivery within noise. Revert if any bubble sticks locked or unlocked in a browser.
- (c) new `play/src/front/Phaser/Game/RemoteSampleInterval.ts`: per-user EWMA (alpha 0.3) of the gap between `UserMoved` receipts; draw duration 200 ms while the EWMA is at or below 300 ms (so 5 Hz walkers look exactly as today), clamped to 200-1500 ms above. `GameScene.ts:4741` uses it. Deterministic test with a fake clock at 5, 2.5, 1.5, 1, 0.5 Hz. Target: still frames at or below 15% down to 1 Hz; 5 Hz identical within 1 px.

Order after that: C1 slice 3 behind a flag; the `04634ad3f` cherry-pick in a scratch worktree; generator flags; the 1000-bot dense run; then the gate.

Not recorded here: the one-line note in `release.md` that the release path is wire-bound to the official v1.34.5 server images until fork images ship. That file has another owner; it is listed as a follow-up.

**Reverse.** Every slice is its own commit. (b) and C1 slice 3 are also flag-reverted. (c) draws exactly as today for any 5 Hz walker. Nothing touches `messages/protos`.

## COPY. Entry-screen button copy

**Decision.** Each button says what the click guarantees, in the owner's accepted vocabulary (OD-09 Avatar, OD-10 Escritório). pt-BR / en-US:

1. Name screen: "Continuar" / "Continue" (`login.continue`).
2. Avatar screen: "Usar este avatar" / "Use this avatar"; title "Escolha seu avatar" / "Choose your avatar"; secondary "Personalizar avatar" / "Customize avatar". If the footer buttons wrap at 360 px, the primary falls back to "Continuar" / "Continue".
3. Camera screen, first entry: "Entrar no escritório" / "Enter the office" (key `camera.enable.join`, ported from master with the `openedFromRoom` branch and the `enableCameraSceneFormSubmit` class). Reopened from the profile menu: "Salvar configurações" / "Save settings". Never "Entrar no mundo", never a bare "Salvar" on the entry path.

Do not touch `menu.settings.save`; RoomSettings, RecordingSettings and Megaphone share it.

**Evidence.**

- "Entrar no mundo" over-promises: the next step is the avatar picker or the camera page, and only the camera click enters the map (`GameManager.ts:358-381`). The scenes are also reopened from the profile menu (`ProfileMenuContent.svelte:68-86`), where the next scene just restarts the game scene (`GameManager.ts:359-362`). "Continuar" is true on every route.
- Commit `dfe63e565` (2026-11-16) wrote "Entrar no mundo" and "personagem" wording; OD-09, OD-10 and OD-07 (accepted the same day) replace it. The shell already says escritório (`play/src/i18n/pt-BR/konclui.ts:6,10,13`).
- The camera button still uses `menu.settings.save` (`EnableCameraScene.svelte:298`). Master already solves it with `isOpenedFromRoom` and `camera.enable.join` in 17 locales. Master's pt-BR value says "sala", which in the shell means a locked room (`konclui.ts:231`), so the value changes to "escritório".
- The label change breaks e2e that locate by text: `tests/tests/utils/auth.ts:129`, `error_pages.spec.ts:25,38,52` and `media_devices.spec.ts:383` click "Save". Master uses the class `button.enableCameraSceneFormSubmit` instead; port those locators with the component. The login and avatar buttons are already class-located.
- Label bytes are irrelevant to scale (tens of bytes against about 5.9 MB per cold browser).
- Caveats: the reference screenshot could not be viewed, so the reference copy rests on code and catalogue values from before `dfe63e565`. `DECISIONS.md` M1 says visible copy changes need the owner's yes; this record rests on the delegation above, and each commit says so in its message.

**Open hypotheses.**

| Hypothesis | Check |
|---|---|
| The avatar footer buttons stay on one line at 360 px | Screenshots of the three entry screens in pt-BR and en-US at 360 and 1440 px |
| Users do not hesitate when reopening name and camera from the profile menu | Walk first entry (name, avatar, camera, office) and the profile-menu reopen; note hesitation |
| The change moves entry completion (optional, needs the owner's consent to read analytics) | PostHog `wa-name-validation`, `wa-woka-validation`, `wa-video-validation`, 14 days before and after; too few first-timers to detect it, so the walkthrough carries the evidence |

**First slice.** Two commits through the integrator session, about 45 minutes, no engine files.

- Commit 1, catalog only: `login.ts:17`, and `woka.ts` `selectWoka` in pt-BR and en-US. Leave `customWoka.*`, companion and `menu.ts` alone. Do not revert `dfe63e565` (46 files).
- Commit 2, camera step: port master's hunks verbatim (`isOpenedFromRoom`, the button text, the class, `camera.enable.join` in all 17 locales, the class-based e2e locators), then set pt-BR "Entrar no escritório" and en-US "Enter the office". The other 15 locales carry the en-US text until translated.
- Checks from `play/`: `npm run typesafe-i18n`, `npm run i18n:check`, `npm run typecheck`, `npm run svelte-check`, `npm run lint`, `npm run pretty-check`, `npx vitest run tests/front/Components/LoginScene.test.ts` (it stubs `$LL`, so it shows no regression, not the copy), then the Playwright entry flow.
- Before and after: `rg 'Entrar no mundo|Enter the world|Usar este personagem|Use this WOKA' play/src/i18n` has hits before and none after.
- Working tree note: when this record was written, the uncommitted working tree already showed `selectWoka.continue` as "Continuar" / "Continue" (the 360 px fallback in rule 2) and `camera.enable.join` as "Entrar no escritório" / "Enter the office". Check `git diff play/src/i18n` before treating the catalog as final.

**Reverse.** Each commit reverts alone. Reverting commit 1 restores `login.continue`, `woka.selectWoka`; reverting commit 2 restores the `menu.settings.save` button and the text-based locators.
