# Architecture

System structure and decisions for the Koncluí fork of WorkAdventure. Phase 2 (clean architecture) of the
architecture-optimization journey filled `## System Context`, `## Layer Map & Dependency Rule` and
`## Decision Log`. The other sections are placeholders for later phases.

Conventions of this file:

- Claims carry a tag. MEASURED is a number from a log, a test run, or a `wc`/`rg` count. DERIVED is arithmetic over
  measured or read values. HYPOTHESIS is not verified.
- Every number names its source as `path:line`, a commit sha, or the command that produced it.
- Evidence base: `konclui/main` at `700362b82` (2026-11-18), plus uncommitted edits by other sessions in `back/` and
  `play/src`. Those edits are committed at `a0fc2bf18` (2026-11-19). The cited lines in the rows changed by that
  refresh were re-read against `a0fc2bf18`; the others are as read at `700362b82` and can drift. Search by symbol when
  one no longer matches.
- Counts marked "rg" were taken from the working tree on 2026-11-18.
- Refreshed 2026-11-19 at `75db31b6d`: only the rows that the sixteen commits after `d0467cfbc` close or change (V1, V9, V13, the Recommendations and the Decision Log) were re-read; the other cited lines are as before.

## System Context

Koncluí is a fork of WorkAdventure for a virtual office. Its goal is 1000 live participants in one world without
stalls in movement, audio or video.

Parts of the system:

| Part | Where | Role |
|---|---|---|
| Client | `play/src/front` | Svelte 5 UI and a Phaser 4 scene |
| Pusher | `play/src/pusher` | uWebSockets server. Holds one socket per client and fans zone events out to them |
| Back | `back/src` | gRPC/protobuf server behind the pusher. Owns room, zone, group, space and media-pairing state |
| Redis | external | Shared state |
| LiveKit | external | Media above 4 people in a bubble and for every broadcast |
| Admin API, map-storage | external | Room metadata and map files |
| Konclui shell | `play/src/front/Konclui` | Downstream context that draws the office UI over the map through the extension ports |

Facts that bound the architecture:

- One room per office, no shards (`docs/konclui-migration/decisions.md`, C1).
- The fork stays wire-identical to upstream. `git diff upstream/master...HEAD -- messages/protos` is empty
  (decisions.md C1 evidence). The rule is recorded at `messages/AGENTS.md:12`. The pusher rejects any other
  `apiVersionHash` (`play/src/pusher/controllers/IoSocketController.ts:291`, as cited by decisions.md C1).
- The release path runs the official v1.34.5 server images (`deployment/konclui/compose.yaml:24,60,74`, as cited by
  decisions.md C5). A fork protocol cannot ship until fork-built server images are scheduled.

Load reality, the 100/300/1000-bot runs and the client frame probes, is in `docs/PERFORMANCE.md` `## Load Reality`.
This section does not copy those numbers. `docs/PERFORMANCE.md` landed in `a0fc2bf18` as the Phase 1 gate artifact. Its
raw sources, outside git, are
`~/.claude/orchestrate/konclui-native/evidence/perf/{baseline-2026-11-17.md,load-1000.json,load-1000-stats.log}`.

## Layer Map & Dependency Rule

Method: Dependency Rule, source dependencies point inward (frameworks, then adapters, then use cases, then entities),
with the procedure of `architecture-optimization/references/methods.md` section 2. The audit read imports, not
intentions. Boundaries are kept only where there is volatility, meaning a second implementation can be named (a test
double counts).

### Layers as they exist

**Pusher (`play/src/pusher`)**

- Models: `models/Zone.ts`, `PositionDispatcher.ts`, `Space.ts`, `SpaceToFrontDispatcher.ts`.
- Orchestration: `services/SocketManager.ts` (1879 lines, MEASURED `wc -l`), `models/PusherRoom.ts`.
- Adapters: `services/PusherWebSocket.ts` (the uWS wrapper), `services/BatchFrame.ts` (protobuf encoding),
  `services/ApiClientRepository.ts`, `services/MoveRateLimiter.ts`.
- Direction is bidirectional. `models/` imports `services/` in 7 files (MEASURED,
  `rg -n 'from "\.\./services/' play/src/pusher/models`): `Zone.ts:23-24`, `PositionDispatcher.ts:13`, `Space.ts:7`,
  `SpaceToFrontDispatcher.ts:20`, `SpaceToBackForwarder.ts:12-13`, `PusherRoom.ts:8-10`, `SpaceConnection.ts:6`.

**Back (`back/src`)**

- Domain: `Model/GameRoom.ts` (1653 lines), `Model/Space.ts` (966), `Group`, `PositionNotifier` (MEASURED `wc -l`).
- Media policy and state: `CommunicationManager`, `Strategies/`, `States/`, `Policies/`, `Interfaces/`.
- Adapters: `Services/SocketManager.ts` (1886 lines, MEASURED), `RoomManager.ts` (the gRPC server), `AdminApi`,
  `MapStorageClient`, `LivekitService`.
- The media seam points inward. Strategies depend on `Interfaces/ICommunicationSpace`
  (`WebRTCCommunicationStrategy.ts:5`, `LivekitCommunicationStrategy.ts:9`). `TransitionPolicy` depends on
  `ITransitionPolicy` (`TransitionPolicy.ts:2`). LiveKit sits behind `LivekitService`; only a type import of
  `S3Upload` from the SDK remains (`LivekitCommunicationStrategy.ts:8`).
- The rest of `Model/` points outward (MEASURED, `rg -l` on `back/src/Model`): 5 files import `@grpc/grpc-js` or
  `RoomManager` types (`GameRoom`, `Admin`, `Zone`, `PositionNotifier`, `User`); 14 files reach `Services/`; 9 files
  import `Enum/EnvironmentVariable`.

**Client (`play/src/front`)**

- Upstream scene: `Phaser/Game/GameScene.ts` (5066 lines, MEASURED), with 197 `import` statements and 23 lines that
  name `gameManager` or `connectionManager` (MEASURED, `rg -c`).
- Entities: `Phaser/Entity/RemotePlayer.ts`, `Character.ts`. Svelte stores and components. `Connection/`.
- Konclui, downstream of all of these.
- `GameScene` as a god class is already ledgered in `docs/TECH-DEBT.md:72`. It is not added again here.

### The Konclui seam holds

- MEASURED: `npx vitest run src/front/Konclui/architecture.test.ts src/front/ExternalModule/ClientExtensionPoints.test.ts`
  in `play/` gave 2 files and 48 tests passed (re-run on 2026-11-18, 312 ms, under `node v26.10.0`; no Node 24
  install was found on this machine, and `play/src/front/Konclui/AGENTS.md` says Node 24 first).
- The only upstream import of Konclui code is `play/src/svelte.ts:7` (`installKonclui`). MEASURED, `rg 'from ".*Konclui'`
  outside the Konclui folder, generated caches excluded.
- Upstream reaches the ports through `ExternalModule/ClientExtensionPoints.ts`: `GameScene.ts:195` (import),
  `:1265` (`notifySceneShutdown`), `:1446` (`runSceneFrame`); stores for the action bar, embedded chat host and game
  viewport bounds are read by upstream components.
- `domain/` layers import only `./`, `zod` and type-only upstream modules. An empty port keeps upstream behaviour
  (`play/src/front/Konclui/AGENTS.md`).
- Inversion already done at the root: `integration.ts` hands Ambience a `focused()` callback, because Ambience cannot
  import Focus under the domain graph.

### Inversions already done (the pattern to copy)

- `Phaser/Game/RemotePlayerCulling.ts` imports only `rxjs` types and defines structural `CullableAvatar` and
  `CullableObject` interfaces (`:8-37`). No Phaser import. Built in `700362b82`.
- `Phaser/Entity/AvatarBuildQueue.ts` has no imports (MEASURED, `rg -c '^import'` finds none).
- `pusher/services/BatchFrame.ts` imports only `@workadventure/messages`. `MoveRateLimiter.ts` is pure.
- Back batching: `emitZoneMessage` and `flushZoneMessages` (`back/src/Services/SocketManager.ts:101-139`) sit in the
  adapter, keyed by the gRPC stream in a `WeakMap`. Model code does not know about the queue.

### Violations

Status values: fix-now (do next, XS size; until 2026-11-19 it was blocked only by another workflow's uncommitted edits), ledgered (recorded
with a trigger, not scheduled), accepted (deliberate, recorded so nobody "fixes" it).

| # | Violation | Location | Fix | Status |
|---|---|---|---|---|
| V1 | Import cycle `CommunicationManager` and `AbstractCommunicationState`, 3 paths (fallow). The state needs only a config constant that lives in the manager | `back/src/Model/States/AbstractCommunicationState.ts:6,18`; `back/src/Model/CommunicationManager.ts:719-721` (`CommunicationConfig`) | Move `CommunicationConfig` to its own module, or pass `MAX_USERS_FOR_WEBRTC` through the constructor (the parameter exists at `:18`). Structure-only commit | fixed 2026-11-19 in `f716254ef`. The state's constructor parameter was dead, so it left with its import and the `CommunicationConfig` wrapper (no `rg CommunicationConfig back/src` hit); `madge --circular` no longer reports the cycle and reports it again with the import put back (commit message). Fallow was not rerun |
| V2 | The zone fan-out port is typed to the uWS wrapper. `ZoneEventListener` (`Zone.ts:26-37`) and the listener set use `PusherWebSocket`, but Zone needs only identity and `getUserData().userId` (`Zone.ts:489-492`). The same type appears in 5 more model files | `Zone.ts:23`, `PositionDispatcher.ts:13`, `Space.ts:7`, `SpaceToFrontDispatcher.ts:20`, `SpaceToBackForwarder.ts:13`, `PusherRoom.ts:10` | Replace with a structural `ZoneListener { getUserData(): { userId: number } }`. Do it as the preparatory refactoring (methods.md section 4.4) of C1 slice 3, in its own structure-only commit | ledgered, open. The trigger, the start of C1 slice 3, passed without it: the budget landed in `7a37a5178` and `ViewerBudget.ts:1` is one more file typed to `PusherWebSocket`. Second implementation: the test fakes in `play/tests/pusher/ZoneFanOutEncoding.test.ts` |
| V3 | Pusher import cycle `PusherRoom` and `SocketManager` through the module singleton (fallow, 4th cycle) | `PusherRoom.ts:9`, `services/SocketManager.ts` (`socketManager` singleton) | Inject the cleanup callback | ledgered as SM-07, `docs/TECH-DEBT.md:41,101` (open). No new row |
| V4 | `SocketManager` (pusher) is a god class that also implements `ZoneEventListener`, and imports axios, grpc `Metadata`, uWS types and the admin service | `services/SocketManager.ts:56-62,75,86,116`; zone callbacks near `:1135-1156` | Extract the zone listener adapter, per the existing ledger row | ledgered as `docs/TECH-DEBT.md:97` (open). No new row |
| V5 | The back domain model holds gRPC and infrastructure types | `GameRoom.ts:3,53` (grpc `Metadata`, `RoomSocket`), `:54-62` (adminApi, `MapStorageClient`, variables manager); direct stream writes at `:230,238,251,356,576,704,1425,1500,1570`; `new Metadata()` at `:1486` | Wrap the map-storage call and the stream writes behind a port in `Services/`. Ordering hazard to keep: anything written to a `RoomSocket` directly must call `flushZoneMessages` first (`back/src/Services/SocketManager.ts:114` doc comment) | ledgered. HYPOTHESIS: `GameRoom`'s `.write` calls go to per-user streams, not the batched `listenRoom` stream, so there is no ordering bug today. Check before any change |
| V6 | Back `Model/` reads env constants directly: 9 files import `Enum/EnvironmentVariable`, e.g. `CommunicationManager.ts:12`, `WebRTCState.ts:2` | Same files | `WebRTCState.ts:16` already shows the target shape: the constant is a default parameter (`maxPeers = MAX_P2P_PEERS`). Apply it where a test needs a different value | ledgered, low risk. Fallow lists 20 consumers of the env module (public-API decision in the fallow brief) |
| V7 | A Phaser entity carries UI and telemetry behaviour. `RemotePlayer` builds the woka menu, tracks analytics, opens a Svelte modal and a chat room | `RemotePlayer.ts:11-29` (imports); menu `:162-215`; actions `:239-281`; `modals.open(RequiresLoginForChatModal)` at `:277` | Extract the menu-action assembly into a service the scene injects. The entity only emits "clicked". Fallow: fan-in 19, fan-out 16, 10 consumers outside the diff | ledgered. The culling work on this file landed (`700362b82`, `e3aeb7bc2`), so the edit is no longer blocked |
| V8 | `Character` reads Svelte stores for outline colour and picture | `Character.ts:3-4,10,12-13`; `get()` near `:394`, subscription near `:407` | Pass the outline colour in as a plain value or callback | ledgered, low. Fallow: 5 consumers |
| V9 | A frame-path class reads a global config constant | `play/src/front/Phaser/Game/PlayerMovement.ts:1,19` (`MAX_EXTRAPOLATION_TIME`) | Constructor parameter. The planned C5 (c) `RemoteSampleInterval` must take its constants as parameters, not imports. It landed in `0ff4a395d` importing `POSITION_DELAY` and `WOKA_SPEED`, so the row covers two files. Since `75db31b6d` it imports `POSITION_DELAY` and the fastest walk from `Phaser/Player/WalkSpeed.ts`, which imports `WOKA_SPEED` (`RemoteSampleInterval.ts:1-2`; MEASURED, read); the constants are still imports, not parameters | ledgered |
| V10 | The seam's context type leaks Phaser classes. `SceneFrameContext` exposes `scene: GameScene`, `currentPlayer: Player | undefined` and `remoteCharacters: ReadonlyMap<number, RemotePlayer>`, and Konclui's phaser layer imports those types | `ExternalModule/ClientExtensionPoints.ts:118-131`; `Ambience/phaser/SceneEffects.ts:18-20`, `sceneEffectsExtension.ts:3`, `Preferences/phaser/gameActions.ts:4-5` | Narrow to structural interfaces, as `CullableAvatar` does. Needed because C2 and plan item 3.x change `RemotePlayer` | ledgered. Trigger: the next change to `RemotePlayer` that breaks a Konclui type check |
| V11 | Konclui `stores/` import upstream infrastructure singletons. The `AGENTS.md` table allows "upstream stores"; `architecture.test.ts` does not enforce it | `analyticsClient` in 7 store files: `OfficeMenu/stores/{mapTools,globalMessage}.ts`, `Preferences/stores/{generalSettings,mediaSettings,miniSettings,soundSettings,notificationSettings}.ts` (MEASURED `rg -l`). `localUserStore` in 6 store files. `connectionManager`, `Room` and `AudioOutputManager` in `mediaSettings.ts` and `soundSettings.ts` | One `Preferences/stores` port file for telemetry and persistence, once a second consumer needs a double. Tests already mock these modules, so the volatility is low | ledgered |
| V12 | The Konclui shell re-hosts upstream internals: `Dock.svelte` imports 10 upstream `ActionBar/*` components, `Frame.svelte` imports `ChatSidebar` | `Shell/components/Dock.svelte:17-26`, `Frame.svelte:27`. Fallow: `Dock.svelte` fan-out 23, `Frame.svelte` fan-out 14 | Not a rule breach, since components may import upstream components. It is merge risk: re-check at each upstream merge | ledgered |
| V13 | `domainEdges` and `AGENTS.md` name domains that are not on disk and omit two that are. Disk (MEASURED `ls`): `Ambience, Focus, OfficeMenu, Preferences, Presence, Shell, Workplace`. `AGENTS.md` lists `Rooms, Expression, Identity, Notifications` as domains. `domainEdges` keeps those four. When audited, `AGENTS.md` omitted `Focus` and `OfficeMenu`; `45934b027` and `b0e26fde0` added both to `domainEdges` and to `AGENTS.md` (MEASURED, `git show HEAD:<path>`). The four dead names remained until `f6a622968` | `play/src/front/Konclui/architecture.test.ts:23-35`; `play/src/front/Konclui/AGENTS.md:17-20` | Remove the four dead names from both files. A rule change needs the owner's recorded decision per `AGENTS.md`: the owner's standing instruction (2026-11-18, "decide yourselves", `decisions.md:3`) supplies it, so name it in the commit. A new folder called `Rooms` would pass the test silently today | fixed 2026-11-19 in `f6a622968`: the four names left `domainEdges` and `AGENTS.md`, and the test now also requires the keys of `domainEdges` to equal the domain folders on disk, every edge to point at a key, and the `AGENTS.md` sentence to list the same names. Putting `Rooms` back fails it (commit message). The commit cites the standing instruction of 2026-11-18 |
| A1 | Accepted: entities cache wire-format bytes. `UserDescriptor` and `GroupDescriptor` hold encoded `SubMessage`s, invalidated on change | `Zone.ts:41-45,94,155-165,229-236` (`encodeOnce` from `services/BatchFrame`) | None. Encoding depends only on `@workadventure/messages`. `605fec17b`: encoder calls for one move watched by 200 sockets go from 200 to 1 (commit message; counts pinned in `play/tests/pusher/ZoneFanOutEncoding.test.ts:211-212`; MEASURED) | accepted. Recorded in the Decision Log |
| A2 | Accepted: `Preferences` is declared the leaf every domain may read, but `Preferences/phaser/gameActions.ts:6-9` imports upstream scenes (`LoginScene`, `PwaInstallScene`, `SelectCharacterScene`, `SelectCompanionScene`). The test cannot see it | `Preferences/phaser/gameActions.ts:6-9` | None. The `phaser/` layer row allows upstream Phaser classes; registered through `installGameCommands` at `integration.ts` | accepted |

Row counts: 13 violation rows (V1-V13), 2 accepted rows (A1, A2). fix-now: V1 and V13, both fixed on 2026-11-19 (`f716254ef`, `f6a622968`), so none is open. Ledgered by this audit:
V2, V5-V12. Already in `docs/TECH-DEBT.md`: V3 (`:41,101`), V4 (`:97`).

### Recommendations

| Done | Action | Owner lane | Priority |
|---|---|---|---|
| [x] | V1: remove the `CommunicationConfig` wrapper and the dead parameter that imported it, structure-only commit. Done 2026-11-19 in `f716254ef` | back | P2 |
| [x] | V13: delete the 4 dead domain names in `architecture.test.ts` and `AGENTS.md`, cite the standing instruction in the commit. Done 2026-11-19 in `f6a622968`, with a test that keeps the list equal to the folders. Listing `Focus` and `OfficeMenu` was done in `45934b027` and `b0e26fde0` | Konclui | P2 |
| [ ] | V2: introduce `ZoneListener` (separate structure-only commit). It was to come before C1 slice 3, which landed without it in `7a37a5178`, so it gates nothing now | pusher | P1 when written |
| [x] | Insert the per-viewer budget at `Zone.notifyUserMove` only after V2 (see the boundary map below). Done 2026-11-19 in `7a37a5178`, flag off, but in the zone callbacks of `SocketManager.ts` and without V2 | pusher | P1 |
| [ ] | V10: narrow `SceneFrameContext` to structural interfaces before C2 changes `RemotePlayer` | Konclui, play front | P2 |
| [ ] | V7: extract the woka-menu assembly after the culling work on `RemotePlayer.ts` lands | play front | P3 |
| [ ] | V5: port for `RoomSocket` writes in `GameRoom`; first check the ordering hypothesis | back | P3 |
| [ ] | V6, V8, V9, V11, V12: touch only when a test or an upstream merge needs it (triggers in the table) | owner of the file at the time | P3 |
| [ ] | Run the Konclui fitness test under Node 24 once an install exists (this audit ran Node 26) | Konclui | P3 |

### Fallow cross-check (`/tmp/fallow-brief.txt`, MEASURED)

- 4 circular dependencies (`:322-329`): 3 in the `CommunicationManager` group (V1), 1 in `PusherRoom` and
  `SocketManager` (V3). No cycle is reported inside Konclui.
- Metrics line (`:400`): 23,495 LOC, dead files 0.0%, dead exports 0.0%, maintainability 89.3.
- 4,789 duplicated lines (1.9%) across 18 files (`:398`).
- 15 unused dependencies and 5 dev or optional ones (`:334`). These belong in `docs/TECH-DEBT.md` (DEP-01, `:31`), not here.
- The four public-API decisions the brief asks about: `EnvironmentVariable.ts` (20 consumers outside the diff),
  `RemotePlayer.ts` (10), `PusherWebSocket.ts` (8), `Character.ts` (5). They map to V6, V7, V2 and V8.

## Bounded Contexts & Context Map

Not filled by Phase 2. One fact is already enforced: Konclui is a downstream context of upstream WorkAdventure,
reached only through the extension ports, and its domains follow the edge table in
`play/src/front/Konclui/architecture.test.ts` (`domainEdges`). Owner of the full map: the next architecture phase.

## Domain Glossary (Ubiquitous Language)

Not filled by Phase 2.

| Term | Meaning | Code name |
|---|---|---|

## Data & Storage Decisions

Not filled by Phase 2. The one data fact recorded so far: the world headcount is one optional integer owned by the back and
carried in the space state patch (Decision Log, C3), not derived from the roster. Back half landed in `aab3487b1` (flag off); the people panel (`4d2a84570`) reads it when the flag is on.

## Decision Log

All entries below were taken between 2026-11-17 and 2026-11-19 under the standing instruction to decide, record and
continue. Engine commits carry their before/after numbers in their messages; each of those commits adds the tests or
bench that produced them. This audit did not re-run them. The C1-C5 entries summarize
`docs/konclui-migration/decisions.md`, which owns the full reasoning, hypotheses and slices.

| Date | Decision | Why | Alternatives rejected |
|---|---|---|---|
| 2026-11-17 | Encode each zone sub-message once and cache it on its descriptor (`605fec17b`) | 300 walking bots: pusher CPU median 65% to 35%, move p95 167 to 113 ms (commit message, MEASURED). Encoder calls per move watched by 200 sockets: 200 to 1 | A per-zone shared buffer; a 1 Hz dense relay; last-move dedupe in the batch (near-zero gain, ordering hazard, per `evidence/engine-1000-plan.md` section 5) |
| 2026-11-18 | One 50 ms batch per pusher stream, in the back adapter (`b323baca9`) | 300 moving users: 1,687.5 writes/s to 20 (commit message, harness; MEASURED) | Multiplexing per-user gRPC streams. The back is idle (4.64-18.67% CPU in `load-1000-stats.log`) |
| 2026-11-18 | Token bucket of about 10 moves/s per socket in the pusher; a stop is never dropped (`34ec1cdc6`) | A client sending 60/s reaches the back at 10.4/s (commit message, MEASURED) | Sender-side dead reckoning, now gated (C5) |
| 2026-11-18 | Refuse a stale resume before authentication; spread the scene rebuild over 0-2 s (`59dfb7cac`) | Upgrades per reconnecting client 2 to 1 (commit message) | Pacing invitations |
| 2026-11-18 | Name tags read two CSS variables set once per layer (`c5bd4ad97`) | One notch with 1000 tags: 90,000 style writes to 17 (commit message). Safari sharpness unchecked (HYPOTHESIS) | Per-tag style writes |
| 2026-11-18 | Build avatars from a nearest-first queue with a per-frame budget, and cull avatars outside the camera (`700362b82`) | 1000 avatars over the office with a 1451x855 camera draw 322, not 1000 (1,610 quads vs 5,000; commit message) | An avatar pool keyed by user id (helps only oscillation) |
| 2026-11-18 | Index space users by id; keep the LiveKit room for a grace period after a speaker stops (`1c9047960`) | 999 lookups 23 ms to about 0.1 ms (`SpaceUserLookup.bench.ts`, via commit message) | Lowering `MAX_USERS_FOR_WEBRTC` to 1-2 (the plan says it causes the freeze) |
| 2026-11-18 | **C1**: one room per office, no shards. Awareness through the viewport-to-zone subscription plus an env-flagged per-viewer budget in the pusher (about 150 nearest at full rate, the rest at 1 Hz, ceiling about 400). Default off. Slice 3 landed 2026-11-19 in `7a37a5178` (`PUSHER_VIEWER_BUDGET_ENABLED`, off; harness numbers only). Its first load run, the same day on the CI pool (INVALID host), measured more pusher CPU with the flag on at every paired level and move p95 25 s at 1000, so it stays off (`docs/PERFORMANCE.md` section (a); TECH-DEBT DL-06). Reworked 2026-11-22 in `bda3a26c6` (deadband, cooldown, its own re-rank timer, a cached join): in process, 3.07M calls a second against 10.00M for 1,000 walkers and no churn at the edge of the budget; the 50 ms p95 and the CPU target are not met and no real-socket run exists, so the flag is still off | At 1000 bots 823 joined, delivery 0.468 (116,494 of 248,931 expected), pusher 94-144% CPU in the last four samples while the back stayed at 4.6-18.7% (`evidence/perf/load-1000.json:33-35,96-100`, `load-1000-stats.log`; MEASURED) | All-see-all live; shards; a zoom floor. Fallback if the budget fails its gate: floors of 250-300 people per map (decisions.md C1) |
| 2026-11-18 | **C2**: keep upstream zoom-out. Bound client cost with a detail budget keyed on avatars in view (B = 80). Slice 1 landed 2026-11-19 in `47865006b` (off; operation counts only, no browser frame time). On by default since `863e8d384` (2026-11-22, opt-out `localStorage` `avatarDetailBudget` set to `"0"`), together with zero-work hidden avatars and baked single-sheet avatars, after Gate 1 on one Apple M1 Max in Google Chrome (999 synthetic walkers, default zoom: GPU time at most 8.43 ms in every window; `docs/PERFORMANCE.md`). The DEC C2 acceptance gate (work p50 at whole-map zoom) was not run | A zoom limit cannot meet "never stall" (DERIVED, decisions.md C2: slope 62 us per present avatar, 276-380 avatars cost 17-24 ms against a 16.7 ms frame) | A floor inside `HdpiManager` (it clamps `WA.camera.set`) |
| 2026-11-18 | **C3**: the world headcount is one integer owned by the back and carried in the space state patch, at most one per second. The roster is watched lazily, only at or below T = 200. The back half landed 2026-11-19 in `aab3487b1` (`WORLD_HEADCOUNT_ENABLED`, off); the front half is built (people panel, `4d2a84570`, 2026-11-21) and changes nothing until the back flag is on | Every client watches the whole roster to show one number (`GameScene.ts:2633-2645`, `WorldUserProvider.ts:23-26`, re-read at `700362b82`; decisions.md C3 cites older lines) | A permanent live roster; porting the reference presence broadcast |
| 2026-11-18 | **C4**: bubbles are P2P up to `MAX_USERS_FOR_WEBRTC` = 4. LiveKit is the only transport above that and for every broadcast. First slice is the opt-in `MAX_P2P_PEERS` cap, unset = upstream behaviour. Landed in `850605bee` (validator, `WebRTCState`, strategy, tests and `env-variables.md`). It fails closed: a refused pair is not retried when a slot frees, and a watcher past the cap of every speaker gets no stream (`back/tests/WebRTCCommunicationStrategy.test.ts:420,442`) | Without a cap, one speaker and 999 watchers is 999 peer connections in one tab (DERIVED, decisions.md C4) | A derived default (it breaks self-hosters without LiveKit); pacing invitations |
| 2026-11-18 | **C5**: stay wire-compatible through phase 3. Edit nothing under `messages/protos` (`messages/AGENTS.md:12-13`). Replace the ack nonce of plan item 2.3 with upstream `04634ad3f` plus `CLIENT_DISCONNECTION_RETENTION_MS`. Plan item 4.2 becomes a gated option | The release path is wire-bound to the official images (`deployment/konclui/compose.yaml:24,60,74`) | Fork the protocol now; the ack nonce |
| 2026-11-18 | Boundary only at volatility (methods.md section 2.4). The listener port and the other insertion points below are kept. No new ceremony layers in `GameScene`, which stays under the existing sprout policy (`docs/TECH-DEBT.md:118-122`) | Both cited rules already exist | A full hexagonal rewrite. The plan is about fifteen local fixes, not a rewrite |
| 2026-11-18 | Record the Phaser 4 and uWS typing violations (V2, V7, V10) as ledgered with triggers instead of fixing them now | They sat in files with uncommitted edits by another workflow (committed since, `a0fc2bf18`); none is on the critical path before C1 slice 3 | Fix all in one structure-only pass (conflicts with the in-flight work) |
| 2026-11-19 | **Language per tier: rewrite nothing now.** Keep TypeScript on the client (Svelte 5 and Phaser), the pusher and the back. LiveKit (Go) carries media, with its control plane in TypeScript. Electron stays the desktop shell; Tauri stays a separate experiment, blocked by `desktopCapturer`. Rust for the pusher only, as a written contingency with the triggers below, not as a plan | Council session 2026-11-19. Tally: keep TypeScript 2.75, hybrid with a conditional pusher 1.75, full native rewrite 0. It split and did not reach two thirds, so the chair decided. All five seats agreed on the immediate action (change nothing now); they split on whether the pusher contingency is part of the decision. It is, because the number that argued against it depends on plan item 4.2, which C5 deferred. Every large server win so far was algorithmic: encode-once took pusher CPU from 65% to 35% at 300 bots (`605fec17b`, MEASURED), back gRPC writes fell from 1,687.5 to 20 a second (`b323baca9`, MEASURED in a harness), and the client frame at 300 bots fell from 9,327 ms to 7.7 ms (`25685a03f`, MEASURED; 90.4% of the old cost was `texImage2D` inside browser GL, so no language could have removed it). The back used 4.6% to 18.7% CPU at 1000 bots (MEASURED, `load-1000-stats.log`) | Full native rewrite now, weight 0: it ends upstream merges, is not reversible, and changes neither bandwidth, the 50 ms plus 100 ms batching latency floor, nor how cost grows per avatar (evidence `evidence/structure-and-language-2026-11-18.md`). Hybrid now: no profile yet shows that JavaScript is the pusher's limit |
| 2026-11-19 | The Konclui domain list is the folders on disk, and `architecture.test.ts` checks it (`f6a622968`). `domainEdges`, the folders and the `AGENTS.md` sentence must name the same domains, so a planned domain is added with its first folder | The four names without a folder (`Rooms`, `Expression`, `Identity`, `Notifications`) let a new folder called `Rooms` pass the fitness test silently (V13). The rule change follows the standing instruction of 2026-11-18 (`docs/konclui-migration/decisions.md:3`) | Keep the four names as planned domains (no document says they are planned) |
| 2026-11-21 | `MapTools` and `Reactions` are Konclui domains and leaves of the graph, added with their first folders (`2a86b2565`). `MapTools` is the column beside the zoom controls with the desk model and walk commands (U06, E05, E06); `Reactions` adds 26 pixel emotes through its own port and rides the emote message the game already sends | The domain list is the folders on disk (row above); a leaf entry in `domainEdges` is the smallest change that keeps `architecture.test.ts` passing with the two folders (entry MAPTOOLS-REACTIONS in `docs/konclui-migration/decisions.md`). A new proto message for emotes is refused by C5 | Folding the tools into `Shell` or `Presence`; a proto field for emotes |

**Language per tier, 2026-11-19: blind spots.** The council named these; none is closed.

- The 0.26-core pusher projection at 1000 bots (DERIVED, evidence note) is fix 2.4 plus fix 4.2. C5 deferred 4.2 to a gated option (decisions.md C5), so the projection is not what the approved plan delivers. Fix 2.4 alone leaves about 320 thousand deliveries a second; at 2.7 microseconds per delivery that is about 0.86 core (DERIVED by the council chair), above the 0.7-core budget and near the 1.0-core saturation line (`docs/PERFORMANCE.md` Baselines & Budgets). "A rewrite saves only 0.2 core" holds only with 4.2. The contingency can fire.
- No valid 1000-bot run exists. The first one accepted 823 of 1000 sessions, ramped for 40 s of a 45 s run (about 5 s at full population), predates the optimizations, and left out the world roster, media and a real browser (MEASURED, `docs/PERFORMANCE.md` Load Reality). A second one, on the CI pool on 2026-11-19 at `13fc89a45` (20% walking, world space on), accepted 1000 of 1000 at delivery 0.995 and 77.9% of a pusher core with the code defaults, but every level of it is INVALID by the generator's lag guard: production load on the shared host descheduled the generator (MEASURED, same section).
- Client frame time at 1000 avatars was never measured. "322 of 1000 drawn" is a count from a culling test, not a frame time. Measurements stop at 300 bots and default zoom. The pre-culling extrapolation of about 31 ms of `step` alone at 1000 (DERIVED, evidence note) was not re-measured.
- `MAX_P2P_PEERS` fails closed. A refused pair is not retried when a slot frees, and a watcher past the cap of every speaker gets no stream (MEASURED, the two "known limit" tests). Capping connections does not show that audio is delivered.
- The premise that a Rust or Go pusher is 5 to 15 times cheaper per delivery is a HYPOTHESIS. No profile splits the 2.7 microseconds between JavaScript object work, uWebSockets (C++) and syscalls.
- Pusher replicas are not proven either: C1 records that the reference project's 2-replica row did not halve CPU, with same-host contention not excluded (decisions.md C1). Any pusher change reaches production only when fork-built server images replace the official v1.34.5 images (decisions.md C5). The five seats were three models of one family, so their agreement is not independent evidence.

**Language per tier, 2026-11-19: kill criteria.** Status open; the council review date is 2026-11-26. The first row was measured on 2026-11-19 (MEASURED, two runs, `~/.claude/orchestrate/konclui-native/evidence/perf/pusher-profile-2026-11-19/README.md`): JavaScript is 61.0% and 61.4% of the pusher's busy main-thread time at 300 walking bots, 66 to 67% with the garbage collector; the native `send` is 19% and the loop outside JavaScript 10%. That is above the 50% line, so the Rust contingency stays alive and its next step is the message trace. The pusher was not saturated in these runs (28 to 31% of a core). At 1000 bots on 2026-11-19 (CI pool, budget off, a run that is INVALID by generator lag; `~/.claude/orchestrate/konclui-native/evidence/perf/ci-run-2/profile/rep1-n1000/profile-summary.txt`) JavaScript self time is 62.3% of the busy main thread (67.4% with the garbage collector), native `send` 25.1%, at 85% of a core; the per-recipient flush is 60.4% inclusive. The contingency stays alive and its next step, the message trace, is unchanged. The 2026-12-10 row is open: the staircase ran on a CI-pool host on 2026-11-19, but no level of it was valid (`docs/PERFORMANCE.md` Load Reality).

| By | Signal | Threshold | Then |
|---|---|---|---|
| 2026-11-26 | `node --cpu-prof` of the pusher at 300 walking bots (the Mac smoke run; no Linux host needed): the share of time per delivery spent on JavaScript object work, against uWebSockets and syscalls | Under 50% in JavaScript ends the Rust contingency (10x becomes impossible). 50% or more keeps it alive | Under 50%: drop the native pusher and spend the effort on replicas, worker threads and rate policy. Otherwise record a message trace of the same load for a later replay |
| 2026-12-10 | A Linux load host and a valid staircase 300, 500, 700, 1000 from a pinned commit | No valid 1000 run (0 rejected sessions, generator under 70% CPU) | Stop stacking unmeasured optimizations: the plan is blocked on measurement, not on language, and the host becomes the only task. The date is the chair's proposal; no external deadline exists |
| 2026-12-17 | Post-fix Linux run at 1000, dense, 20% walking, with the per-observer budget (2.4) on and without 4.2 | Pusher above 0.7 core, or move p95 above 250 ms, or delivery below 0.99; and 2 pushers at 600 bots do not cut CPU per pusher by at least 40%; and the profile kept 50% or more in JavaScript | Open a Rust pusher spike behind the same protocol, replaying the recorded trace. Rewrite only if the spike is at least 3x cheaper per delivery with identical resume and ordering. The TypeScript pusher stays as fallback |
| 2026-12-17 | Client frame probe at 1000 bots after culling, real GPU, default zoom and whole map (partly run 2026-11-22: Gate 1, 999 synthetic walkers, default zoom, one Apple M1 Max, GPU time at most 8.43 ms in every window; whole map and frame work p95 not run; `docs/PERFORMANCE.md`) | Frame work p95 above 33.3 ms at 1000, or above 16.7 ms with 200 visible | The limit is the client and it is algorithmic: turn on the C2 detail budget (B = 80) and measure again. A Rust/WASM kernel only if a pure-math core passes half of a step above 8 ms |
| 2027-01-15 | The owner's decision on merging upstream and on the visibility contract | The fork stops merging upstream, or the owner requires everyone to see all 1000 live at full rate | Reopen the decision: without upstream the largest cost of a native pusher disappears; with full visibility the algorithmic plan does not close and the talk becomes protocol and a multi-core pusher |

### Where a cache, a queue or a budget goes (the boundary map)

A boundary is an insertion point (methods.md section 2.5). This table lists the existing and the missing ones on the hot
flows.

| Flow | Boundary | Location | Holds or would hold | Item and status |
|---|---|---|---|---|
| Pusher ingress, per socket | `isMoveAllowed` with `MoveRateLimiter` | `play/src/pusher/services/SocketManager.ts:93,127,734,773-780` | budget (shipped, `34ec1cdc6`) | plan item 4.1, done |
| Pusher fan-out, per viewer | `ZoneEventListener` | `Zone.ts:26-37`; `notifyUserMove` at `:489-496`; `onUserMoves` near `SocketManager.ts:1139` | budget: new `ViewerBudget.ts`, env `PUSHER_VIEWER_BUDGET_ENABLED`, `PUSHER_VIEWER_FULL_RATE_PEERS` and `PUSHER_VIEWER_MAX_PEERS` | C1 slice 3 landed (`7a37a5178`, flag off). Hooked in the `SocketManager.ts` zone callbacks, not at `Zone.notifyUserMove`; V2 did not precede it. Reworked in `bda3a26c6`: each user keeps the set of sockets it is at full rate for, and the zone sends a move to those alone |
| Pusher fan-out, encode | cached `SubMessage` on descriptors | `Zone.ts:41-45,94,155-165,229-236` | cache; invalidated when the descriptor updates | plan item 2.1, done (`605fec17b`) |
| Pusher egress, per socket | `PusherWebSocket.emitInBatch` and `flushBatch` (100 ms timer), group-update conflation, replay store | `PusherWebSocket.ts:72-100` | queue with a replay window of `CLIENT_DISCONNECTION_RETENTION_MS` | exists. The memory cap is replaced by the `04634ad3f` cherry-pick (C5, not done) |
| Back to pusher stream | `emitZoneMessage` and `flushZoneMessages`, 50 ms | `back/src/Services/SocketManager.ts:101-139` | queue (20 writes/s per pusher) | plan item 2.2, done (`b323baca9`) |
| Back space state | `updateState` carrier | `back/src/Model/Space.ts:787` (`updateState`, re-read at `a0fc2bf18`) | headcount published by a 1000 ms timer armed on the first change, and a refcount per uuid (`DistinctCounter.ts`) for the world space | C3 slice 1b back half landed (`aab3487b1`, flag off). The front half is not built |
| Back space users | index by id | `back/src/Model/Space.ts` (`1c9047960`) | cache | done |
| Media pairing | `ICommunicationSpace`, `ICommunicationStrategy`, `ITransitionPolicy` | `back/src/Model/Interfaces/`; `WebRTCState.ts:16` | budget: `MAX_P2P_PEERS` cap in `WebRTCCommunicationStrategy`; cache: LiveKit room grace timer in `LivekitCommunicationStrategy` | C4 slice 1 done (`850605bee`); the cap sits in `tryEstablish`, the one method that opens a pair (`15f042918`); grace timer done (`1c9047960`) |
| Client avatar build | `AvatarBuildQueue` (pure) | `GameScene.ts:66,391` | queue with a per-frame time budget | plan item 3.3, done |
| Client avatar draw | `RemotePlayerCulling` with `CullableAvatar.setCulled?` | `GameScene.ts:260,389`; `RemotePlayerCulling.ts:8-37` | budget: the C2 detail tier hooks here and in `SceneEffects` | culling done; C2 slice 1 landed (`47865006b`, on by default since `863e8d384`) in `RemotePlayerCulling.setDrawn` and `RemotePlayer.applyDetail`. `SceneEffects` reads only the drawn people since `6191e6a28` (median 80 of 1,000 players visited a frame, asserted); culled and dot avatars do no animation or body work with `avatarZeroWork` (on by default) |
| Client receive | `PlayerMovement` and the `POSITION_DELAY` draw (`GameScene.ts:4788-4796`, re-read at `700362b82`; decisions.md C5 cites older lines) | `PlayerMovement.ts:1,19` | new pure `RemoteSampleInterval.ts` | C5 slice (c) landed (`0ff4a395d`) without V9. `GameScene` calls `PlayersPositionInterpolator.receiveSample`; `PlayerMovement.getPosition` stops at the end of its 100 ms window |
| Konclui per-frame cost | `runSceneFrame` loop | `ClientExtensionPoints.ts:185-194`, called at `GameScene.ts:1446` | HYPOTHESIS: the one place to add a per-extension frame-time budget. It has `try/catch` and failure reports but no timing today | not decided. No measurement of extension cost exists beyond the 300-bot probe with effects on (p50/p95 7.4/8.5 ms, `baseline-2026-11-17.md`, via decisions.md C1) |

Two boundaries are missing that the plan needs:

- No pusher-to-world roster boundary. `joinSpace(allWorldUser)` is wired at scene start (`GameScene.ts:2633-2645`,
  `WorldUserProvider.ts:23-26`). The C3 lazy gate needs a wrapper there, plus pure mode rules in a new
  `Konclui/Presence/domain`.
- No client-side budget for what the shell does per extension per frame. `SceneEffects` skips the avatars that are not drawn since `6191e6a28` (it was open after `47865006b`); the per-extension frame-time budget of the `runSceneFrame` row above is still not decided.

### Open items (HYPOTHESIS, not verified by this audit)

- No pusher or back test ran, and no measurement was made. Every number above comes from commit messages, evidence
  files, `wc`/`rg` counts, the fallow brief, or the one vitest run named above.
- The C3 and C5 insertion points were re-read by the fresh-eyes check. The `GameScene.ts` lines in decisions.md
  (spot-checked at `75901117c`) had drifted by about 50 lines; this file uses the `700362b82` lines.
- The Konclui seam claim holds for the committed rules in `architecture.test.ts`. The V11 coupling (stores reading
  upstream singletons) is outside what that test enforces.
- Next phase evidence still owed: `docs/PERFORMANCE.md` `## Load Reality` (Phase 1 gate, cited above), and a 1000-bot
  run on a remote Linux host (never on this machine; the local Colima VM dropped at 1000, decisions.md C1).
