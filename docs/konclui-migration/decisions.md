# Engineering decisions of 2026-11-18

On 2026-11-18 the owner delegated these decisions: "decide yourselves, validate every hypothesis, never wait on me". Each section gives the decision, the evidence, the open hypotheses and how each is checked, the first slice, and how to reverse it. Every slice is a separate, reversible commit made through the integrator session ([integration loop](../integration/LOOP.md)).

Status at the time of writing: decided. No implementation slice below was committed. The C5 rule in `messages/AGENTS.md` landed with this file. Refreshed 2026-11-19 at `a0fc2bf18`: C4 slices 1 and 1b landed in `850605bee`, C5 slices (a) and (b) in `8c6034a42`, and the COPY catalog in `8b843ea1b`. This file does not track the other slices. Refreshed again 2026-11-19 at `47865006b`: C5 slice (c), C1 slice 3, C2 slice 1 and the back half of C3 slice 1b landed, all with unit-harness numbers only and the three flags off. Their shas are marked in the sections below, and the deviations from the text of this file are listed in the section "Landed slices and deviations (2026-11-19)". Refreshed 2026-11-22 at `ae2d88ad9`: the C2 detail budget is on by default (`863e8d384`), the C3 front half is built (`4d2a84570`), C1 slice 3 was reworked (`bda3a26c6`), and two domains joined the graph; the last two sections of this file ("MAPTOOLS-REACTIONS" and "Landed slices and deviations (2026-11-21 and 2026-11-22)") record them, and lines marked "Update 2026-11-22" below point there. Line numbers above that section stay stable on purpose: other documents cite them.

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
| K=150 and the 400 ceiling are the right values | Slice 3 sets them from the slice 1 table. ASSUMED: slice 3 landed with the suggested 150 and 400, because no slice 1 table exists yet (`7a37a5178`) |

**First slice** (size S, `benchmark/` only, no product code, no flag). This is the Phase 0 gate.

- Files: `benchmark/src/config.ts`, `protocol.ts` (viewport half sizes at `:56-57` become a parameter; add the `joinSpaceQuery` message), `session.ts` (the fixed ellipse becomes pattern-driven), `runner.ts`, `probe.ts`, `stats.ts`, tests in `benchmark/tests`.
- Flags: `--viewport=bot|browser|zoomout` (bot = today's 640x400; browser = 960x540 plus 300 px margin clipped to the map; zoomout = whole map); `--pattern=ring|uniform|plaza` (ring = today's ellipse; plaza = the Plateia rectangle 192,416,416x544); `--moving-fraction`; `--world-space`.
- Report per bot: known peers (joined minus left) p50/p95; sub-messages and bytes per second by event type over the steady window; joins per walker-second.
- Regression anchor: defaults (`--viewport=bot --pattern=ring`, world space off) reproduce `baseline-300.json` within 5%.
- Table: N = 50, 200, 1000 by four viewport/pattern combinations by 5/20/100% walking by world space on/off, 3 interleaved runs, median, plus one 600 s ramp. N = 300 may run on the Mac as a smoke. N = 1000 runs only on the Linux host with pusher and bots on one network, never on Colima (it dropped its VM at 1000).
- Flag reconciliation: C1 and C3 both name a `--world-space` flag. One flag serves both: a watch fraction from 0 to 1, with `off` = 0 (default, keeps baselines comparable) and `on` = 1.

Next slices, each flagged and measured with the slice 1 table: (2) headcount and lazy roster, which is C3; (3) the per-viewer budget: new `play/src/pusher/models/ViewerBudget.ts`, hook in `Zone.ts` `notifyUserMove` (`:468-475`), env `PUSHER_VIEWER_FULL_RATE_PEERS` (0 = off, suggested 150) and `PUSHER_VIEWER_MAX_PEERS` (suggested 400), client interpolation from C5 slice (c); (4) coarse place per person only if the minimap needs it (the only tier that adds a proto field). Slice 3 landed 2026-11-19 in `7a37a5178` (flag `PUSHER_VIEWER_BUDGET_ENABLED`, off; harness numbers only, no load run); the client interpolation of slice (c) landed in `0ff4a395d`. Deviations: last section.

Go/no-go for slice 3, read at N=1000 with the flag off: if uniform/browser at 20% walking holds delivery at or above 0.99, move p95 at or below 250 ms and the pusher under about 0.7 core, build the budget anyway for whole-map and plaza viewers, but keep K high. If it fails everywhere, the budget is mandatory. The go/no-go read has not been taken (no valid N=1000 run exists); `7a37a5178` was built behind a flag that is off, so it commits nothing.

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
- Slice 1 (size M, client only, flag default off): new `play/src/front/Phaser/Game/AvatarDetail.ts` (pure `chooseDetail` with hysteresis), `AvatarDotLayer.ts`, and tests in `play/tests/front/Phaser/Game/AvatarDetail.test.ts`. Recompute on zoom change (debounced), a 250 ms timer and player add/remove. First commit inside the slice: hide name tags below zoom 0.65. Do not touch `HdpiManager`, `CameraManager` or any zoom path. Coordinate before editing `UsernameDisplay.ts` (another session's edits landed in `e3aeb7bc2`). No user-visible text, so no locale work. Landed 2026-11-19 in `47865006b`, flag off, as `chooseFullDetail` (not `chooseDetail`); deviations in the last section.
- Accept: 300 bots whole-map, work p50 at least 50% below flag-off and no long task over 50 ms; 100 bots (below B) within noise with identical screenshots at default zoom; projected p95 at 1000 at or below 16.7 ms on a GPU. If the gain is under 30%, stop and re-plan. NOT VERIFIED: this gate has not been run, so the flag stays off (see the last section).

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
- 1b (size M, one flag, default on in Konclui): `headcount` (non-negative int, default 0) in `libs/shared-utils/src/SpaceState/SpaceState.ts`; the back keeps a `Map<uuid, refcount>` for the world space only (identified by the `allWorldUser` name) with a trailing 1000 ms debounce, then `updateState`; `GameScene.ts` reads `space.state.observe('headcount')` and falls back to the user count for an older back; a lazy gate around the world provider with pure mode rules in a new `play/src/front/Konclui/Presence/domain`; clear stale rows when the filter is registered again (`Space.ts:665-706,927-948`). Back half landed 2026-11-19 in `aab3487b1` (flag `WORLD_HEADCOUNT_ENABLED`, off) and the client keeps the field since `c973c394a`; the front half (`GameScene` reading the number, lazy gate, panel, stale-row clearing) was not built then. Update 2026-11-22: built in `4d2a84570` (the people panel). Deviations: the section "Landed slices and deviations (2026-11-19)" and the last section.
- Tests that fail on revert: back unit (two sessions of one uuid count 1; leave decrements; 10 joins in 1 s give 1 patch); pusher (a state patch reaches a member that never sent `addSpaceFilter`); front (the count store never subscribes `usersStore`; no `addSpaceFilter` while the panel is closed or above T; no stale user after re-watch; no flicker inside 180-220).

Later: Presence directory store with windowed rows; pusher-served name search; pulled positions for "Ver no mapa" (new low-frequency contract, then retire `office-presence`); `encodeOnce` for space add/remove, kept only if CPU per 1000 joins improves by more than 10%; set T from data.

**Reverse.** Turn the flag off to restore the permanent watch. The `headcount` field was meant to have a default, so older clients and backs ignore it. It landed optional instead, which an older client strips and an older back never sets (last section).

## C4. WebRTC and LiveKit roles

**Decision.** Bubbles stay P2P up to `MAX_USERS_FOR_WEBRTC` = 4. LiveKit is the only transport above 4 and for every broadcast (megaphone, speaker zones, meeting rooms); there is no P2P broadcast. First slice: an opt-in env `MAX_P2P_PEERS` (positive int, unset = unlimited = upstream behaviour) that caps the peers one user holds in `WebRTCCommunicationStrategy`, so a missing or unhealthy LiveKit never becomes a 999-connection mesh in the speaker's tab. The Konclui compose should pin it to 3 (a config line in the other repo, a follow-up). LiveKit moves to its own node as a queued ops item, triggered before any broadcast above about 200 listeners or any screen-share broadcast, sized from a load test that does not exist yet. We do not lower `MAX_USERS_FOR_WEBRTC` to 1 or 2 and do not pace invitations. After the load test, broadcast listeners become cheap on the SFU (hidden, `canPublish=false`) behind a flag.

**Evidence.**

- The switch rule is in `back/src/Model/Policies/TransitionPolicy.ts` (`shouldTransition`, `:58-85`): WebRTC to LiveKit above the threshold, for a CPU-limited member with more than 2 users, or for auto-recording, and only if LiveKit is available. Written on 2026-11-18 as environment-only (`:44-51`, above `MAX_USERS_FOR_WEBRTC`); since 2026-11-24 the threshold is the world's own when its admin gives one, and never more than `MAX_P2P_PEERS` plus 1 (`:32-35`; see "Landed slices and deviations (2026-11-24)" at the end of this file). Available means configured, not healthy (`LivekitAvailabilityService.ts:17-22`). The count includes every watcher (`CommunicationManager.ts:481-488`).
- The P2P strategy has no cap: `shouldEstablishConnection` only checks for an existing connection (`WebRTCCommunicationStrategy.ts:189-193`), `establishConnection` sends 2 messages per pair (`:195-199`), and `addUser`, `addUserToNotify` and `initialize` loop over every watcher (`:74-102,127-148,260-283`). One speaker and 999 watchers is 1,998 messages and 999 peer connections in one tab (derived from code).
- Nothing in `play/`, `libs/` or `messages/` reads `MAX_USERS_FOR_WEBRTC` or a world's threshold (two comments of the front name the variable, `LivekitPreload.ts:6` and `LivekitClientLoader.ts:8`); the rule lives only in the back.
- Why opt-in: the dev template ships `MAX_PER_GROUP=100` and `MAX_USERS_FOR_WEBRTC=3` (`.env.template:39,205`) and Helm ships `MAX_PER_GROUP` 1000 with LiveKit off (`contrib/helm/values.yaml:57`). A derived default would break bubbles for self-hosters without LiveKit.
- The only SFU numbers we own are the 2026-10-08 grid tests on the shared 3-vCPU VPS (`konclui-work/README.md:396-412`: 20 cameras ok, 40 cameras 44% loss). They are not the one-publisher, N-subscriber shape.

**Open hypotheses.**

| Hypothesis | Check |
|---|---|
| Bubbles cost the server nothing as P2P; a broadcast needs an SFU (arithmetic, not measured on this stack) | SFU load test (`lk load-test`, 1 publisher, N = 50/200/1000, once with screen share) on a Linux host |
| A failing `createRoom` downgrades two later speakers (H10) | Slice 1b unit test in `back/tests/LivekitCommunicationStrategy.test.ts` |
| Hidden listeners (`canPublish=false`) cut SFU cost | Measure in the load test before slice 3 |
| The 200-listener trigger is right | Load test table (cores, Gbps, join p95, loss) |

**First slice** (size S, back only, no protocol change, upstreamable). Landed in `850605bee`, with slice 1b.

- `back/src/Enum/EnvironmentVariableValidator.ts`: optional `MAX_P2P_PEERS` next to `MAX_USERS_FOR_WEBRTC` (`:158-161`), no default.
- `back/src/Model/Strategies/WebRTCCommunicationStrategy.ts`: constructor takes an optional `maxPeers`, passed from `States/WebRTCState.ts:18` and the factory in `CommunicationManager.ts:75-79`. One helper `canPair(a, b)`: no existing connection, and both peer counts below the cap. Use it in `shouldEstablishConnection` and in `initialize`. Log once per space and report with Sentry when a pair is refused. Do not touch the LiveKit path.
- `back/tests/WebRTCCommunicationStrategy.test.ts`: first, on unmodified code, a test that 1 speaker and 999 watchers dispatch 1,998 start messages. Then tests that fail on revert: cap 3 dispatches 6; a bubble of 4 with cap 3 still dispatches 12; a 5th user in a capped space dispatches 0 new starts; cap unset still dispatches 1,998.
- Known limits to name in the tests: a refused pair is not retried when a slot frees; with several speakers a watcher past the cap gets no stream (fail-closed).
- Slice 1b (XS): the failing-`createRoom` test; if two speakers fail while the first is present, clear `createRoomPromise` on rejection.
- Follow-ups: `MAX_P2P_PEERS=3` in `konclui-work/docker-compose.yml` (other repo, needs its own scope); the SFU load test; the dedicated LiveKit node (needs infrastructure and approval, queued, not waited on); `LIVEKIT_HIDDEN_LISTENERS` (default off) after measurement.

**Reverse.** Unset `MAX_P2P_PEERS`: behaviour is upstream. Everything else is configuration. The world's own threshold, the ask at a space's first join and the cap on that threshold, added on 2026-11-24, are recorded under "Landed slices and deviations (2026-11-24)" at the end of this file.

## C5. Protocol compatibility with upstream

**Decision.** Stay wire-compatible with upstream through phase 3 of the engine plan. Edit nothing under `messages/protos`: no velocity, no sender-side dead reckoning, no ack nonce, no new oneof arm, no second proto file. Cut the rate with server policy plus a client receiver that follows the observed update interval. Plan item 4.2 (fork-only sender protocol) becomes a gated option: first additive optional fields, then a relay-side stage in the pusher, only after the gate trips. Replace the ack nonce of plan item 2.3 with a cherry-pick of upstream `04634ad3f` (store cap) plus the existing `CLIENT_DISCONNECTION_RETENTION_MS`.

The gate, measured on a Linux host after the first slice, the interval-aware receiver and C1 slice 3, with `--moving-fraction` and a browser-sized viewport: the 1000-person dense run still fails any of move latency p95 at or below 250 ms, pusher at or below 0.7 core at 1000 (the budget of C1 at 20% walking; 1.0 core is the saturation line), or near-band downlink at or below about 50 kbit/s per client; and a pusher CPU profile attributes at least 25% to move fan-out; and fork-built pusher and back images are the release path. Budget note, 2026-11-19: this gate first read "at most 0.10 core per 100 users (about 60% of a core at 1000)". Those two figures disagree, since 0.10 per 100 users is 1.0 core at 1000, so the 0.7-core budget of C1 governs, as decided in `docs/PERFORMANCE.md` (Baselines & Budgets). The engine plan's 0.26-core projection at 1000 (DERIVED) includes item 4.2, which this decision defers. With the per-observer budget (2.4) alone the pusher needs about 0.86 core (DERIVED: about 320 thousand deliveries a second at 2.7 microseconds each), above the budget, so the gate can trip (council session 2026-11-19, `docs/ARCHITECTURE.md` Decision Log).

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
| Without the receiver, still frames at 5/2.5/1.5/1/0.5 Hz are 8/24/54/69/85% | Deterministic test in slice (c) reproduces it. MEASURED in `RemoteSampleInterval.test.ts:195` (`0ff4a395d`): 8.3% at 5 Hz, 70.1% at 1 Hz, 16.6% at 10 Hz without it; 2.5, 1.5 and 0.5 Hz are not run |
| Slice (b) cuts pusher CPU median from 35% to about 27% | Exact `pusher-300-after` procedure, 3 interleaved runs, median |
| RemotePlayer has no collider, so no extrapolation beyond 100 ms is needed | Re-read `RemotePlayer` (not re-read for this record) |

**First slice** (docs, same day, no behaviour): record the rule in `messages/AGENTS.md` (done with this record). Optional pin test: a hash of the four move message blocks, so an upstream change is visible at the next merge.

Then three small slices, pusher-only (a, b) and client-only (c):

- (a) per-type accounting in `play/src/pusher/services/GaugeManager.ts`, incremented in `PusherWebSocket.emitInBatch` and `flushBatch`: `workadventure_pusher_sub_messages_total{type}`, `..._bytes_total{type}`, and a gauge of sockets whose last move had `moving=true`. Pass: counters match the bot-side counts of `pusher-300-after.json` within 1%. Landed in `8c6034a42`; the 1% check is not run yet.
- (b) in `Zone.ts` `handleGroupUpdateZone` (`:285-299` at `700362b82`, `:302` at `a0fc2bf18`), compare size and lock before notifying; keep updating the descriptor so late listeners get the current position. Test next to `play/tests/pusher/PositionDispatcher.test.ts`. Pass: group updates under 10% of the 2,365,979 baseline, userMoved and delivery within noise. Revert if any bubble sticks locked or unlocked in a browser. Landed in `8c6034a42`; the harness number is 451,200 to 1,200 notifications, and the real-run pass is not measured yet.
- (c) new `play/src/front/Phaser/Game/RemoteSampleInterval.ts`: per-user EWMA (alpha 0.3) of the gap between `UserMoved` receipts; draw duration 200 ms while the EWMA is at or below 300 ms (so 5 Hz walkers look exactly as today), clamped to 200-1500 ms above. `GameScene.ts:4741` uses it. Deterministic test with a fake clock at 5, 2.5, 1.5, 1, 0.5 Hz. Target: still frames at or below 15% down to 1 Hz; 5 Hz identical within 1 px. Landed 2026-11-19 in `0ff4a395d`: 1 Hz still frames 70.1% to 1.7%, 5 Hz and 10 Hz identical frame for frame (MEASURED in a unit harness, no browser). Deviations: last section.

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
- Catalog note: when this record was written, the uncommitted working tree already showed `selectWoka.continue` as "Continuar" / "Continue" (the 360 px fallback in rule 2) and `camera.enable.join` as "Entrar no escritório" / "Enter the office". Both values are committed at `a0fc2bf18` (MEASURED, `git show HEAD:play/src/i18n/pt-BR/woka.ts` and `en-US/camera.ts`); the entry-copy commit is `8b843ea1b`.

**Reverse.** Each commit reverts alone. Reverting commit 1 restores `login.continue`, `woka.selectWoka`; reverting commit 2 restores the `menu.settings.save` button and the text-based locators.

## DOCK. Knock prompt deferred; Focus and OfficeMenu in the domain graph (2026-11-18)

**Decision.**

1. The knock prompt "Sala trancada · [Espaço] Bater" is deferred. Upstream has no knock action, and building one needs a new message between the pusher and the back. Decision C5 forbids edits under `messages/protos` for now. It returns when a knock message is accepted upstream, or when C5 is revisited.
2. `Focus` and `OfficeMenu` are Konclui domains. The domain graph in `play/src/front/Konclui/architecture.test.ts` (`domainEdges`) reads: `Shell` -> `OfficeMenu`, `Shell` -> `Focus`, `Focus` -> `Workplace`, `Focus` -> `Preferences`, `OfficeMenu` -> `Preferences`. `play/src/front/Konclui/AGENTS.md` lists both domains, citing this entry.

**Evidence.**

- A locked room today is told by the lock button's state and, when the player may not open it, by the reason the button gives (`actionbar.blocked.lockNotAllowed`). There is no upstream message a client could send to ask the people inside to let it in.
- The dock keeps its tab order equal to its visual order (WCAG 2.4.3): it draws upstream's place actions one by one instead of through `ContextualMenuItems`, so the lock sits after the desk and the ambient sound, as in the reference.

**Reverse.** Item 1: build the knock message in a slice of its own, with the proto change recorded under C5. Item 2: removing a domain means deleting its `domainEdges` entry and its folder, which `architecture.test.ts` checks.

## CONTROLS. A shared Controls domain for menu rows and controls (2026-11-20)

**Decision.** The owner approved a separate folder for the shared components of the menus and controls over the map, "to have less noise", and agreed to the name `Controls` (PascalCase, as the other 167 folders of `play/src/front` against 48 lowercase ones, and as every Konclui domain). `Controls` is a leaf of the domain graph in `architecture.test.ts` (`domainEdges`): it has `components/` only, imports no other domain, and `OfficeMenu` imports it. The first slice is `MenuRow` and `MenuGroup`, which the office menu now consumes instead of 90 lines of scoped CSS. Upstream files cannot import Konclui, so they take the same look from the `.k-*` utilities in `libs/tailwind/style/konclui.css`.

**Not decided.** `bits-ui` is not adopted: it is a new dependency, and what is missing today is CSS utilities and trivial components. ReUI (`/Users/erickheslan/Developments/study/reui`) is React: its designs are a reference, none of its code is copied.

**Evidence.** The office menu's tests select by role and `data-testid`, and pass unchanged on the shared components. The browser check of the office menu after the change is recorded in the commit.

**Reverse.** Delete the `Controls` entry of `domainEdges`, the `OfficeMenu` edge and the folder, and restore the scoped rules of `OfficeMenu.svelte` from the parent of the commit that introduced `Controls`.

## Landed slices and deviations (2026-11-19)

Five commits landed after `a0fc2bf18`. Each carries unit-harness numbers (`docs/PERFORMANCE.md` Optimization Ledger) and none has a load run or a browser frame-time run. The three flags are off by default, Konclui included. Update 2026-11-22: `avatarDetailBudget` is on by default since `863e8d384`, and a browser GPU run exists (Gate 1); see the last section. This section records where the landed code differs from the text of C1, C2, C3 and C5 above, and why. The text above is kept as decided.

### C1 slice 3: per-viewer budget, `7a37a5178` (flag off; reworked in `bda3a26c6`)

Landed: `ViewerBudget.ts` (pure `selectViewerBudget`), `PUSHER_VIEWER_FULL_RATE_PEERS` (default 150), `PUSHER_VIEWER_MAX_PEERS` (default 400), a 1 Hz tier for the rest of the view, stops, joins and leaves never held back, a 32 px seat margin so users at the edge do not churn. MEASURED in a harness (`play/tests/pusher/ViewerBudgetTraffic.test.ts:222,228`): one viewer among 1000 dense movers receives 4,995 moves a second and 89,137 bytes a second without it, 1,000 and 18,005 with it. No protocol change.

Deviations:

- A separate boolean `PUSHER_VIEWER_BUDGET_ENABLED` replaces "`PUSHER_VIEWER_FULL_RATE_PEERS` 0 = off". Reason: the full-rate default is 150, so a default on that variable would turn the budget on for everyone.
- A user that joins the 1 Hz tier while walking gets one extra move with the join. Reason: the client times its stream from the moves it receives, and without that move a joining walker stands still for 800 ms (`play/tests/pusher/ViewerBudget.test.ts:280`).
- The hook is in the zone callbacks of the pusher `SocketManager.ts` (`onUserEnters`, `onUserMoves`, `onUserLeaves`), with one budget per socket in a `WeakMap`, not in `Zone.notifyUserMove` as written above. `Zone.ts` gained one getter, `UserDescriptor.getPosition`. Reason: the budget is state of one viewer, and the socket manager already owns the socket. The structural `ZoneListener` (ARCHITECTURE V2) did not precede it, and `ViewerBudget.ts` takes a `PusherWebSocket`.
- 150 and 400 are the suggested values, not values set from a slice 1 table (none exists), and the go/no-go read of C1 was not taken. Both are ASSUMED until a valid N=1000 run exists.

### C2 slice 1: detail budget, `47865006b` (flag off when it landed; on by default since `863e8d384`)

Landed: `AvatarDetail.ts` (`chooseFullDetail`, B = 80), `AvatarDotLayer.ts` (dots on one Blitter), `RemotePlayer.applyDetail`, name tags hidden as one layer below zoom modifier 0.65, recompute on join or leave, 150 ms after the zoom settles, when the pointer reaches a dot, and every 250 ms. The flag is `localStorage` `avatarDetailBudget`; when it landed it was "1" and off by default (since `863e8d384` it is on, and "0" turns it off). COUNTED in a harness (`play/tests/front/Phaser/Game/AvatarDetailCost.test.ts:347,362`): 1000 avatars at whole-map zoom go from 1,000 full avatars to 80, and from 3,000 objects rendered per frame to 240. These are operation counts.

Deviations:

- Hysteresis is a distance ratio of 1.25 (`DETAIL_HYSTERESIS_RATIO`, `AvatarDetail.ts:19`: an avatar that was full ranks as if it were 1.25 times closer), not a plus or minus 15% band. The text of C2 above gives no number; the ratio is what the code does.
- The acceptance gate is NOT verified: 300 avatars at whole-map zoom, work p50 at least 50% below flag off, no long task over 50 ms. No browser frame time exists for this slice, so the flag stays off. Update 2026-11-22: Gate 1 read GPU time with 999 walkers at default zoom and the flag was turned on; this acceptance gate (work p50 at whole-map zoom) is still not run.
- Scene effects still process the hidden avatars of the dots. C2 asked for dots "skipped by `SceneEffects`"; this is a known gap of the commit. Update 2026-11-22: closed by `6191e6a28`, where the effects read only the drawn people.

### C3 slice 1b, back half: world headcount, `aab3487b1` (flag off), and `c973c394a`

Landed: `WORLD_HEADCOUNT_ENABLED`, `DistinctCounter.ts` (refcount per uuid, across tabs and pushers), the count in the world space state, a resync that recounts a pusher's users. MEASURED on a simulated clock (`back/tests/WorldHeadcount.test.ts:285`): 1,000 users joining over 60 s cost 58 state patches, against 1,000 without the timer. `c973c394a` makes `shareUnchanged` on the client start from the new state, so a field it has no rule for reaches the stores (`play/src/front/Space/tests/SpaceStateSharing.test.ts:37`).

Deviations:

- The field is optional (`z.number().int().min(0).optional()` in `SpaceState.ts`), not `default(0)`. Reason: a default would hide an older back behind a 0, and would break a literal `SpaceState` on the client.
- The timer is armed on the first change and publishes the count it holds when it fires, instead of a trailing 1000 ms debounce. Reason: a debounce that resets on every change publishes nothing while joins keep arriving.
- A back flag `WORLD_HEADCOUNT_ENABLED` exists and is off by default everywhere, Konclui included, where C3 said "default on in Konclui". Reason: no client reads the number until the front half lands, so turning it on would add patches for no reader. Update 2026-11-22: the front half landed in `4d2a84570`; the flag stays off.
- The front half is not built (update 2026-11-22: built in `4d2a84570`): `GameScene` reading `headcount` with a fallback to the user count, the lazy roster gate with T = 200, the panel, and the stale-row clearing. Every client still watches `allWorldUser`, so the roster cost C3 targets is unchanged. The front tests C3 lists are not written.
- A user without a uuid is counted by its space user id (`headcountKey`, `back/src/Model/Space.ts`). C3 does not say how to count an anonymous user.

### C5 slice (c): interval-aware receiver, `0ff4a395d`

Landed: `RemoteSampleInterval.ts`, called by `PlayersPositionInterpolator.receiveSample` from `GameScene`. MEASURED in a unit harness (`play/tests/front/Phaser/Game/RemoteSampleInterval.test.ts:195`, 180 px/s walker, 60 fps): at 1 Hz still frames go from 70.1% to 1.7% and the longest still from 717 ms to 17 ms, and the avatar trails the sender by one interval (mean error 58.2 px to 183.4 px). 5 Hz and 10 Hz are drawn frame for frame as before. No sender or protocol change.

Deviations:

- There is no sender hint, so the first slow sample after a rate drop costs one stall of about 680 ms (683 ms in the commit message; the test bounds it under 750 ms, `:275`). No receiver can foresee the drop. A rise from 1 Hz to 5 Hz has no stall and a catch-up peak of 422 px/s, 2.3 times the walk (bounded under 450 in the test, `:290`).
- `PlayerMovement.getPosition` now clamps at the end of its 100 ms extrapolation window, which changes one frame of today's behaviour: the frame that deletes a stopped avatar no longer overshoots (x 400 where it was 401, `GameSceneMovement.test.ts`, edited in the commit; `PlayerMovement.test.ts` has a new case). The C5 "Reverse" line says (c) draws exactly as today for a 5 Hz walker; that holds for the path but not for this frame.
- The interval is not a plain EWMA. A longer gap is taken at once and a shorter one is smoothed with alpha 0.3, a stop or a gap over 3 s resets it, and a jump that no walk can make in the gap (1.5 times the fastest walk, which is the sped-up diagonal since `75db31b6d`; before it, a straight sped-up line, so a diagonal walk that arrived 80 ms early was placed) is placed at once. Reason: a draw shorter than the real interval leaves the avatar still, while one that is too long only slows it.
- The test runs 10, 5 and 1 Hz and the two rate changes. The 2.5, 1.5 and 0.5 Hz cases that C5 asks for are not run.
- The constants are imports, not parameters as ARCHITECTURE V9 asked: `POSITION_DELAY` from `Enum/EnvironmentVariable`, and the fastest walk from `Phaser/Player/WalkSpeed.ts`, the one source of the walk speeds since `75db31b6d` (TECH-DEBT DS-31, done; it restated the speed-up factor of `Player.ts` before).

## MAPTOOLS-REACTIONS. MapTools and Reactions join the domain graph (2026-11-21)

**Decision.** `MapTools` and `Reactions` are Konclui domains, and leaves of the graph: `domainEdges` in `play/src/front/Konclui/architecture.test.ts` has an entry for each with no edge, and no other entry lists them. They joined with their first folders in `2a86b2565`, and `play/src/front/Konclui/AGENTS.md` names them in its domain sentence. `MapTools` is the column beside the zoom controls (Go to my desk, Center on me, Cancel walk), the desk model and the walk commands (`881b7bc67`: U06, E05, E06). `Reactions` adds 26 pixel emotes to the reactions menu through its own port, `ExternalModule/ReactionsMenuPort.ts`, and rides the emote message the game already sends, so the wire is unchanged and an upstream client shows a plain reaction (`531129d2c`: U15, E08). The room variable that the desk tool reads came through `ExternalModule/ClientExtensionPoints.ts` (`4620e59cf`); an empty port keeps the upstream behaviour (commit message). The people panel (C3 front, `4d2a84570`) stays in `Presence`.

**Evidence.** The two entries are in `domainEdges`, and the test that keeps the list equal to the folders on disk and to the `AGENTS.md` sentence passes with them (the architecture file has 11 tests, rerun 2026-11-22). The code of each domain is in its own folder with its tests beside it (`MapTools/**`, `Reactions/**`). A real-browser pass over the people panel, map tools and emotes found 9 defects, 8 fixed (the fix commits of the pass are `e5b00f07f`, `61ea29016` and `cc40ca7a5`) and 1 left on purpose (the upstream pt-BR label "Picture in picture"). A second browser pass on 2026-11-22 found the 8 fixed and nothing regressed. Not testable with 3 users: Everyone mode above 200 people, a person in another room, Go to my desk with a desk assigned.

**Where the code is.** The tile click is `play/src/front/Phaser/Game/TileInteractionController.ts` (in the upstream folder tree, with its test) and `MapTools/phaser/tileInteractionExtension.ts`; the custom emote texture is `play/src/front/Phaser/Entity/CustomEmotes.ts` with changes in `Character.ts`. The matrix rows U06, E05, E06, U15 and E08 say built, not verified.

**Reverse.** Delete the entry of the domain in `domainEdges`, its folder, its line in the `AGENTS.md` sentence and its registration in `integration.ts`; `architecture.test.ts` fails while any of the four disagrees. The emotes are removed by dropping the `Reactions` registration: the menu then shows the upstream reactions only.

## Landed slices and deviations (2026-11-21 and 2026-11-22)

Commits `560239d63` to `ae2d88ad9`. The measurements are in `docs/PERFORMANCE.md` ("HQ acceptance at 1,000 moving collaborators"), and each browser or GPU number there carries its machine and date (Google Chrome headless, one Apple M1 Max, 2026-11-22).

### C2 slice 1 follow-up: the three avatar flags are on by default, `e44764aa9`, `b90a4d962`, `863e8d384`

Landed: baked single-sheet avatars (`avatarBake`), zero-work culled and dot avatars (`avatarZeroWork`) and a promoted dot that stays drawn until its sprites are back; `avatarDetailBudget`, `avatarZeroWork` and `avatarBake` are on by default, each with its own constant and its own opt-out (`localStorage` set to `"0"`; a storage that cannot be read leaves them on), and `e2eHooks.getAvatarFlags` reports what the page runs with. Gate 1 (999 synthetic walkers, default zoom, 1920 × 1080, three runs per arm): GPU time at most 8.43 ms in any window with the flags on or off; the average at dusk and night is at least 0.5 ms higher with them on and the p99 and maximum are lower; no frame interval above 16.80 ms in 18 of 18 windows with them on, against 3 of 12 windows with a 33 ms interval with them off, all three in an earlier pair taken at a higher machine load.

Deviations:

- The C2 text says the flag is off by default until a browser run measures it. The run measured GPU time and the frame interval, not the acceptance gate of C2 (300 avatars at whole-map zoom, work p50 at least 50% below flag off, no long task over 50 ms). That gate is still not run.
- `avatarZeroWork` and `avatarBake` are not in the C2 text. They are two further flags of the same client tier, added so a culled avatar or a dot does no animation, body or listener work and a full avatar of several layers is one sprite. The benchmark bots send one layer, so only the in-page synthetic crowd exercises the bake.
- Hidden name tags are not zero-work: with the budget on the busiest walking frame at whole-map zoom still makes 80 style writes in the name layer that is hidden there (`AvatarDetailCost.test.ts`).
- The claim that the flags remove dropped frames is confounded by machine load (the flags-off windows with a 33 ms interval are in the earlier pair, taken at a load average of 7 to 8, and that pair also ran without `konclui.fx.rim`).

### C1 slice 3 rework: `bda3a26c6` (flag still off) and `658080e8e`

Landed: a user's encoded join is kept across moves and re-encoded at most once per move for all viewers; a linear selection replaces the per-viewer sort; a deadband (exit at 1.2 times the enter rank, so 150 to 180 and 400 to 480), a 1,750 ms cooldown, a re-rank every 500 ms on its own timer, and seats for the nearer; each user keeps the set of sockets it is at full rate for, so a move reaches those alone; an early flush that keeps half an interval between two frames of a socket. `ZONE_MESSAGES_BATCH_INTERVAL_MS` makes the back's 50 ms window a validated variable (1 to 1000 ms). In process, 1,000 walkers: 3.07M calls a second against 10.00M with the budget off and 18.1 against 89.8 MB/s, 0 joins and leaves a second for a steady crowd, 8.3 a second at the edge of the budget against 108,328 for the bare selection (asserted). No `.proto` change: `git diff --stat fe612bedc..HEAD -- messages` is empty.

Deviations and what is not met:

- The 50 ms p95 of move delivery is not met at the default windows (144 ms with or without the budget). It is met only for the nearest 120 users at 10 ms at the back and 40 ms at the pusher, which nothing sets. Whether "p95 under 50 ms" covers the far users, who are heard once a second by design, is an open question for the owner.
- JS time with the budget on is 205 to 340 ms per simulated second at N = 1,000 against the mandate's 150, and about 1.5 times the CPU of no budget in a sparse room. The 35% of 2 vCPU target is not measured: no run used real sockets or a 2 vCPU host.
- The mandate gives the deadband as 80 and 96. In the pusher the seats are 150 and 400, with exit ranks 180 and 480 (`RETAIN_EXIT_RATIO` 1.2, `RETAIN_COOLDOWN_MS` 1,750, `RERANK_INTERVAL_MS` 500); `ViewerBudgetRetention.test.ts` checks the 1.2 ratio at 80 and 96 as well.
- The flag stays off. TECH-DEBT DL-06 stays open for the p95, the CPU target and a real-socket run.

### C3 front half: the people panel, `4d2a84570` (and `4620e59cf`, `2a86b2565`, `61ea29016`)

Landed: the panel shows Online (N) from the headcount the back sends. It watches the roster only while it is open and the world is at or below T = 200 (hysteresis 180 and 220), or after the user chooses Everyone; above T it lists the people near the user. Search folds accents, Ctrl or Cmd + K opens it, arrows move along rows, and Go to walks to a person. The people view has its own state in the side panel and no longer borrows the chat visibility, so an unseen message still counts and sounds. A space that lost its last watcher replaces its held users on the next list instead of merging into stale rows. Without `WORLD_HEADCOUNT_ENABLED` on the back, the count and the roster behave as before, so the roster saving needs that flag and is not measured.

Deviations:

- The front tests that C3 lists exist under other names (`rosterWatch.test.ts`, `worldRoster.test.ts`, `SpaceUnwatchedUsers.test.ts`, `PeoplePanel.test.ts`); this entry did not check them one by one against C3's list.
- The phone sheet ends above the measured dock, and Go to closes the sheet so the walk can be seen (`61ea29016`, from the browser pass).

### Scene effects and the glass mirror: `6191e6a28`, `a76c2dbd9`

Landed: the effects read only the drawn people (median 80 of 1,000 players visited a frame), allocate nothing per draw, and cache the lights in view by camera cell; a steady frame uploads 0 bytes and the build uploads each of the two canvases once. After a baked sheet is evicted and baked again, the mirror follows the new texture. Rim and normal lighting of people at night is behind `konclui.fx.rim`, off by default, because it can light floor pixels inside a person's ellipse. The two whole-canvas textures can still upload once a second while pieces change: Phaser 4.2.1 has no `texSubImage2D` path, so the mandate's sub-rectangle upload was not built.

Deviations:

- Gate 1 ran with `konclui.fx.rim` on in all but two runs, and with no normal-map texture in the scene (`normalMapLoaded: false` in every window), so the cost of the props' bevel is not measured.
- The mandate's premise (a full-map mirror canvas uploaded on every frame) was not found in this tree at `ae2d88ad9`; no browser run exists of an earlier tree, so no browser before and after of the stall exists.

## Landed slices and deviations (2026-11-24)

Upstream's per-world threshold was merged at `abf3c8bd9` (upstream `8e7aa3a12`) and the fork adapted it in `014cfcdb2`. This section records what is now true of C4 where the text above is silent or says otherwise. The decision above is kept as decided, and its evidence lines about the switch rule were corrected in place on 2026-11-24 so that they describe the code as it is now.

### C4 follow-up: a world's own threshold, the ask at a space's first join, and the cap on the threshold: upstream `8e7aa3a12` (merged in `abf3c8bd9`), adapted in `014cfcdb2`

Landed:

- The admin's answer at `/api/livekit/credentials` may carry `maxUsersForWebrtc` (`back/src/Services/Repository/LivekitCredentialsResponse.ts`): a positive integer, or null or absent for "use the back's value". It is the user count above which a bubble or meeting area goes from peer to peer (P2P, browsers connected directly) to LiveKit, so the `MAX_USERS_FOR_WEBRTC` = 4 of C4 is now the default of that threshold, not the only value. A value that is not a positive integer (0, a decimal, a string) reads as absent, with a warning in the log, and the LiveKit host and keys in the same answer are kept; before `014cfcdb2` the whole answer was discarded with it.
- The back asks the admin at a space's first join, whether or not it has a recordings bucket (before the merge only a back with `LIVEKIT_RECORDING_S3_BUCKET` asked, for automatic recording). `CommunicationManager.askWorldSettings` (`back/src/Model/CommunicationManager.ts:294-304`) asks once in the life of a space, only while the space is in the WebRTC state, only from `handleUserAdded` (not from `handleUserToNotifyAdded`), and holds the transition lock meanwhile, so every join waits for the answer. `decideWorldSettings` (`:311-332`) then stores the world's threshold, tells the automatic recorder whether the world records, and takes the transport decision.
- The invariant: the effective threshold of a space is the smaller of the world's threshold (else `MAX_USERS_FOR_WEBRTC`) and `MAX_P2P_PEERS` plus 1 when `MAX_P2P_PEERS` is set; without the cap it is the world's threshold, else the environment's (`TransitionPolicy.effectiveMaxUsersForWebRTC`, `back/src/Model/Policies/TransitionPolicy.ts:32-35`). It is used in both directions, so a space also returns from LiveKit to P2P at the cap plus 1 users or fewer (`:73-81`). The reason: in a P2P space of n users each user holds n - 1 peers, the cap refuses a pair when either side already holds the cap's number of peers, and a refused pair is never retried when a slot frees (the known limit of the first slice above). From the cap plus 2 users on, a space whose threshold is higher would stay in P2P with people that nobody connects to, and nothing would move it until it reached the threshold: with a cap of 3 and an admin value of 8, the fifth user of a bubble gets no pair (reasoned in the back review; the back lane tests the policy and one manager case with that cap and value, in which the fifth user goes to LiveKit). The cap only ever lowers the threshold; a world's value below it is not changed (a threshold of 1 puts every conversation on LiveKit). When LiveKit is unavailable the policy never switches (`:67-69`) and the cap alone stops the mesh, as decided above.
- The ask is bounded and shared (`back/src/Services/AdminApi.ts`). `fetchLivekitCredentials` (`:97-120`) has a 5 second timeout and a hard deadline of 5 seconds (`AbortSignal.timeout`), because axios's timeout bounds the connection and then only the silence between two chunks, so an admin that drips its answer would not trip it. `fetchWorldLivekitSettings` (`:132-153`) is keyed by world, the string that prefixes the names of the world's spaces: every bubble and meeting area is a media space of its own, so a world of a thousand people sent hundreds of identical requests. It keeps one answer for 30 seconds and one failure for 5 seconds, and spaces that ask together share one request. Timers drop the entries (the answer holds the LiveKit API secret, so it is not kept for reuse). A failure is logged by its message only, because an `AxiosError` carries the admin token in its request, and is reported to Sentry once per failed ask. When the ask fails or times out, the space falls back to the environment's threshold and to "not recorded" (`CommunicationManager.ts:322-328`), and the join goes on.
- With no admin, nothing is asked. The back sets its capabilities at startup (`back/src/App.ts:61`); when `ADMIN_API_URL` is unset they stay empty (`libs/shared-utils/src/SharedAdminApi.ts:29-33`), and the same holds for an admin that does not advertise `api/livekit/credentials: v1`. `livekitCredentialsFromAdmin()` (`back/src/Model/States/StateFactory.ts:24-26`) is then false and `askWorldSettings` returns on its first test. There is no request, no transition lock and no Sentry report, `AutoRecorder.decide` is never called so the space stays not recorded (`enabled` starts false), and the policy uses `MAX_USERS_FOR_WEBRTC` (4 by default), capped at `MAX_P2P_PEERS` plus 1 when that is set. LiveKit credentials come from `LIVEKIT_HOST`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` (`StateFactory.ts:71-85`). This is the path of every deployment today: the release path runs upstream `v1.34.5` images (T-241) and no Koncluí admin has been decided (T-099).

Deviations and what is not met:

- C4 says LiveKit is the only transport above 4 and that the fork does not lower `MAX_USERS_FOR_WEBRTC` to 1 or 2. A world's threshold from an admin can now do exactly that. The decision stands: no world's threshold goes below the environment's before the load test of C4 (T-098).
- The ask is made once per space and not when a watcher joins first. A space whose first ask failed is never recorded and never asks again (T-094, T-096).
- A LiveKit state still asks the admin afresh when it starts (`StateFactory.ts:69`): it has the same deadline but not the cache (T-093).
- The schema descriptions of the admin's answer and the description of `MAX_P2P_PEERS` do not say any of this yet (T-097). The hard deadline was added after the independent review and has no test of its own (T-234). The timeout and the shared ask were proved in two halves (the admin API gives up at 5 seconds, and the manager falls back on any rejection) and never together with a real hung socket; no admin exists to run the ask against, so none of it ran end to end.
- The cache assumes that the admin's answer is per world. An admin that answers differently per room would have its first answer served to the other rooms of the world for 30 seconds, and only the first room's address reaches it (T-097).
- Checked: the back suite passes with 493 tests (2 skipped), run by the lane and again by its reviewer, with typecheck, eslint and prettier clean; the reviewer also mutated the source 30 times and each mutation turned its intended tests red.

**Reverse.** Unset `MAX_P2P_PEERS` to remove the cap on the threshold. Use no admin, or an admin that does not advertise `api/livekit/credentials: v1`, to remove the world's threshold and the ask. Either gives upstream's behaviour.
