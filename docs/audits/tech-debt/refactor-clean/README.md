# Dead-code cleanup (`/ecc:refactor-clean`)

Base: checkout HEAD `a9081f4ac` (master `ddbe245a8` + 4 commits). Edits were made in a scratch repo (`/tmp/wa-clean`, one commit per item) and verified on the remote tree `sbh:~/wa-jobs/wa-fable-20261112/src-review` inside `node:24-trixie` containers (`--cpus 1.5 --memory 4g`, `--network none` except for the `npx` downloads). Every remote file edited was first confirmed byte-identical to `git show HEAD:<path>` by sha256.

Out of scope, not touched: the files owned by other agents (GameScene.ts, MapsManager.ts, PositionDispatcher.ts, benchmark/**, back CpuTracker/QuotaAwareCpuTracker, RoomTimeline*, PictureInPicture childWindow*), every package.json / package-lock.json, generated code (ts-proto-generated, i18n-*.ts), i18n dictionaries, docs/.

## Patches

| Patch | Applies on | `git apply --check` (checkout) | What it does | Lines |
|---|---|---|---|---|
| `dead-code-back.patch` | HEAD | exit 0 | Deletes 2 dead files, 1 dead function, 1 dead interface in `back/` | -14 |
| `dead-code-play.patch` | HEAD | exit 0 | Deletes 7 dead pusher files and 4 dead types/schemas in `play/src/pusher/` | -132 |
| `consolidate-map-editor.patch` | HEAD | exit 0 | Removes `MapValidator`'s two copies of `FunctionalTypes/Result`'s guards (`isSuccess`: dead and mis-typed; `isFailure`: one test consumer, redirected) | +3 / -10 |
| `consolidate-play.patch` | HEAD (independent of `dead-code-play.patch`; both also apply together) | exit 0 | Drops two unused re-exports from the `SpaceNotificationStrategy` barrel | -2 |

No dead-code patch for `map-storage` (knip, ts-prune and grep found no dead source code there; only unused dependencies, below) or for `libs/shared-utils`, `libs/messages`, `libs/store-utils` (the only findings are kept items, below).

The map-editor `isSuccess` deletion was detected as dead code (item L2) but ships inside `consolidate-map-editor.patch`: it sits next to the `isFailure` consolidation in the same 10 lines, so two separate patches could not each apply to HEAD.

## Detection

| Tool | Command (remote container) | Exit | Output |
|---|---|---|---|
| knip 5 | `npx -y knip@5 --reporter json` at the repo root (workspaces auto-detected) | 1 (issues found) | `tool-output/knip-trimmed.json` (desktop/maps/tests/benchmark/contrib entries removed) |
| depcheck 1 | `npx -y depcheck@1 --json` in back, map-storage, play, libs/{messages,shared-utils,map-editor,store-utils} | 255 each (findings present) | `tool-output/depcheck-summary.txt` |
| ts-prune 0.10 | `npx -y ts-prune@0.10 -p tsconfig(.node).json` in back, map-storage | 0 | `tool-output/ts-prune-*.txt` (agrees with knip: every back export it lists is "used in module") |
| rg | per item: `rg -w <symbol>` and import-path searches across the repo (incl. desktop, tests, benchmark, contrib, configs, yaml/json) | n/a | evidence column below |

Coverage limit: knip reported 163 unresolved imports under `play/src` (Vite/Svelte aliases), so its view of `play/src/front` is incomplete and no front item was acted on.

## Baseline and verification (remote, exit codes)

| Package | typecheck | svelte-check | lint | vitest (whole package) |
|---|---|---|---|---|
| back (baseline) | 0 | n/a | 0 | 0 (28 files, 321 passed, 2 skipped) |
| back (after dead-code-back) | 0 per edit x4, 0 after batch | n/a | 0 | 0 (28 files, 321 passed, 2 skipped) |
| map-storage (baseline) | 0 | n/a | 0 | 0 (80 passed) |
| map-storage (after map-editor changes; consumer of `GameMap/MapValidator`) | 0 | n/a | n/a (no map-storage file changed) | 0 (80 passed) |
| libs/map-editor (baseline) | 0 | n/a | 0 | 0 (39 passed) |
| libs/map-editor (after L2, then after C3) | 0, 0 | n/a | 0, 0 | 0 (39 passed), 0 (39 passed) |
| libs/shared-utils, store-utils, messages (baseline only, unchanged) | 0, 0, 0 | n/a | 0, 0, n/a | 0 (30), 0 (12), n/a |
| play (baseline) | 0 | 0 (0 errors, 0 warnings) | 0 | 0 (251 files, 1620 passed, 10 skipped) |
| play (after dead-code-play + consolidate-play) | 0 per edit x11 (P1-P11, C1) | 0 (0 errors, 0 warnings) | 0 | 0 (251 files, 1620 passed, 10 skipped) |

`PLAY_URL=http://play.workadventure.localhost ADMIN_URL=` was set for back and play; `NODE_OPTIONS=--max-old-space-size=3072` for svelte-check and the play suite.

## Items

Tiers follow the skill: SAFE = unused internal code; CAUTION = shared libs / services that could be wired by string or deep import; DANGER = config, env, entry points, public typings.

For every deleted file, a repo-wide search for its import path (`rg 'pusher/models/(Movable|PositionInterface|Websocket/(Point|PointInterface|ItemEventMessage|ProtobufUtils))|pusher/services/CpuTracker|Services/Logger|Websocket/Identificable'`, all workspaces incl. desktop, tests, benchmark, contrib, yaml/json configs) returns no hit.

### Deleted

| ID | Tier | Item | Evidence of no consumers | Verification | Patch |
|---|---|---|---|---|---|
| B1 | SAFE | `back/src/Services/Logger.ts` (empty, 0 bytes) | knip unused file; `rg 'Services/Logger\|\./Logger"'` no hit | back typecheck 0 | dead-code-back |
| B2 | SAFE | `back/src/Model/Websocket/Identificable.ts` (interface `Identificable`) | knip unused file; `rg -w Identificable` only the file itself | back typecheck 0 | dead-code-back |
| B3 | SAFE | `getCapabilities()` in `back/src/Services/Capabilities.ts` | knip unused export; `rg -w getCapabilities back/` only the definition (play has its own, unrelated `getCapabilities`) | back typecheck 0 | dead-code-back |
| B4 | SAFE | `IWebRTCCredentials` in `back/src/Model/Types/CommunicationTypes.ts` | knip unused type; 1 in-file reference (the definition); no `back` importer (play's `IWebRTCCredentials` is a separate interface in `play/src/pusher/services/WebRTCCredentialsService.ts`) | back typecheck 0 | dead-code-back |
| P1 | SAFE | `play/src/pusher/models/Websocket/ProtobufUtils.ts` (class `ProtobufUtils`) | knip unused file; no importer of `pusher/models/Websocket/ProtobufUtils` (the live copy is `back/src/Model/Websocket/ProtobufUtils.ts`) | play typecheck 0 | dead-code-play |
| P2 | SAFE | `play/src/pusher/models/Websocket/Point.ts` (class `Point`) | knip unused file; no importer (`back/tests/GameRoom.test.ts` uses back's own `Point` from `MessageUserPosition`) | play typecheck 0 | dead-code-play |
| P3 | SAFE | `play/src/pusher/models/Websocket/ItemEventMessage.ts` | knip unused file; no importer in play | play typecheck 0 | dead-code-play |
| P4 | SAFE | `play/src/pusher/models/Websocket/PointInterface.ts` | knip unused file; only importers were P1 and P2 | play typecheck 0 | dead-code-play |
| P5 | SAFE | `play/src/pusher/models/Movable.ts` | knip unused file; no importer (back/shared-utils use `@workadventure/shared-utils`'s `Movable`) | play typecheck 0 | dead-code-play |
| P6 | SAFE | `play/src/pusher/models/PositionInterface.ts` | knip unused file; only importer was P5 | play typecheck 0 | dead-code-play |
| P8 | SAFE | `isFetchWorldChatMembers` schema + `FetchWorldChatMembers` type in `play/src/pusher/services/AdminApi.ts` | knip unused export + type; `rg -w` only these two lines repo-wide | play typecheck 0 | dead-code-play |
| P9 | SAFE | `FetchMemberDataByUuidSuccessResponse` type in `AdminApi.ts` (the schema `isFetchMemberDataByUuidSuccessResponse` stays: used by `isFetchMemberDataByUuidResponse`) | knip unused type; `rg -w` only the definition | play typecheck 0 | dead-code-play |
| P10 | SAFE | `SocketUpgradeFailed` type and its now-unused `UpgradeFailedData` import in `play/src/pusher/services/SocketManager.ts` | knip unused type; `rg -w SocketUpgradeFailed` only the definition | play typecheck 0 | dead-code-play |
| P11 | CAUTION | `play/src/pusher/services/CpuTracker.ts` (class, `secNSec2ms`, `cpuTracker` singleton; never imported, so its interval never ran in the pusher) | knip unused file; `rg -w 'CpuTracker\|cpuTracker'` hits only this file and the separate `back/src/Services/CpuTracker.ts`; no dynamic `import()`, `require()` or config string references | play typecheck 0 | dead-code-play |
| L2 | CAUTION | `isSuccess` in `libs/map-editor/src/GameMap/MapValidator.ts` (typed `Y is Failure<E>` while returning `Y.ok`, i.e. a wrong guard) | knip unused export; `rg -w isSuccess` hits only this file and `FunctionalTypes/Result.ts`; `GameMap/MapValidator` is not re-exported from `libs/map-editor/src/index.ts`; its only deep importers (map-storage `UploadController`, `ValidatorController`, the map-editor test) do not use it | map-editor typecheck 0, lint 0, test 0; map-storage typecheck 0, test 0 | consolidate-map-editor |

### Consolidated

| ID | Item | Evidence | Verification | Patch |
|---|---|---|---|---|
| C3 | `isFailure` in `MapValidator.ts` duplicated `FunctionalTypes/Result.ts`'s `isFailure` (same body and guard). Removed the copy and the unused `Failure` import; `tests/GameMap/MapValidator.test.ts` now imports `isFailure` from `../../src/FunctionalTypes/Result` | only consumer was that test (`rg -w isFailure`) | map-editor typecheck 0, lint 0, test 0 (39); map-storage typecheck 0 | consolidate-map-editor |
| C1 | `play/src/pusher/models/SpaceNotificationStrategy/index.ts` re-exported `DefaultNotificationStrategy` and `LiveStreamingNotificationStrategy`, which nothing imports through the barrel (the factory imports the modules directly) | knip unused exports; `rg 'SpaceNotificationStrategy"'` shows the only barrel consumer, `SpaceToFrontDispatcher.ts`, uses the types and the factory | play typecheck 0 (applied after P1-P11); then the play batch run below | consolidate-play |

### Kept (investigated, not changed)

| Item | Tier | Why kept |
|---|---|---|
| Unused env constants: back `ENABLE_MAP_EDITOR`; pusher `ADMIN_BO_URL`, `CPU_OVERHEAT_THRESHOLD`, `GOOGLE_DRIVE_PICKER_API_KEY` (`*/enums/EnvironmentVariable.ts`) | DANGER | Env/config surface: still declared in the validators, docker-compose and Helm values; removing them is a configuration decision. `CPU_OVERHEAT_THRESHOLD` has no consumer left in the pusher once P11 lands. |
| 21 `play/src/front/style/**/*.css` files flagged by knip | DANGER | False positive: knip does not follow CSS `@import` (e.g. `font.css` is how `@fontsource/*` is loaded). |
| `play/.dependency-cruiser.cjs`, `play/public/service-worker-prod.js`, `map-storage/tests/assets/maps/empty.js`, `libs/room-api-clients/room-api-client-js/{eslint.config.js,src/example_*.ts}` | DANGER | Tool config, runtime-served asset, test fixture, published-client examples. |
| `libs/shared-utils/src/RandomDelay/RandomDelay.ts` | CAUTION | No consumer, but it is a documented developer aid meant to be inserted temporarily while chasing race conditions (`localStorage.randomDelay`); deleting it is a team decision. |
| `UpdateWritingStatusChatListEvent` type (shared-utils), `ChatMessageTypes` enum members `text/me/userIncoming/userOutcoming` (shared-utils `ChatEvent.ts`) | CAUTION | Part of the iframe/chat event surface consumed through `play/src/front/Api/Events/IframeEvent.ts` and the iframe API typings. |
| `meetingKindSchema` (libs/messages `AnalyticsEventCatalog.ts`, knip "duplicate export" of `spaceKindSchema`) | CAUTION | Deliberate, documented alias, exported from the `@workadventure/messages` entry point. |
| Exports used only inside their own module (e.g. back `SocketManager` class, `DefaultInitialStateFactory`, `AreaUpdatedEvent`; pusher `extractApiVersion`, `getPalette`, `AdminMessages` schemas, service classes; `common/DesktopVersionPolicy` types) | SAFE | Not dead code: only the `export` keyword is unused. Left as is (no behaviour or size gain). |

### Skipped (failed verification)

None. Every deletion and consolidation passed its per-edit typecheck and the batch run (lint, whole suite, svelte-check where applicable).

## Dependency findings (not edited: the coordinator owns the manifests)

Reported by both knip and depcheck, and `rg` finds no import, `require`, CSS `@import`, config or path-string reference inside the package (package.json scripts and Dockerfiles included):

| Package | Likely unused |
|---|---|
| back | `@grpc/proto-loader`, `busboy`, `@types/busboy`, `google-protobuf`, `@types/google-protobuf`, `mkdirp`, `@types/mkdirp`, `query-string`, `source-map-support`, `uuidv4`, `@types/http-status-codes` |
| map-storage | `@grpc/proto-loader`, `busboy`, `google-protobuf`, `nodemon`, `npm-check-updates`, `reflect-metadata`, `rxjs`, `zod-to-json-schema`, `@total-typescript/ts-reset`, `source-map-support`, `ts-loader`, `tsconfig-paths` |
| libs/messages | `google-protobuf`, `long`, `rxjs` |
| libs/store-utils | `@types/debug` |
| play | `hyper-express`, `live-directory`, `qs`, `@types/qs`, `ts-proto-descriptors`, `google-protobuf`, `@types/google-protobuf`, `livekit-server-sdk`, `@livekit/track-processors`, `@sentry/browser`, `@16bits/nes.css`, `@rollup/plugin-inject`, `vitest-websocket-mock`, `@types/jsonwebtoken`, `@types/uuid`, `@types/http-status-codes` |

False positives (keep): play `@fontsource/*` (CSS `@import` in `src/front/style/font.css`), `swagger-ui-dist` (read by path in `SwaggerController.ts`), `buffer` (Vite polyfill in `vite.config.ts`), `@iconify-json/tabler` (unplugin-icons), `@types/dom-screen-wake-lock` (ambient types), `tailwindcss`/`@tailwindcss/forms`, `eslint-plugin-svelte`/`globals`, `patch-package`, `tslib`; depcheck's Svelte-only imports in play (`quill`, `svelte-select`, `emoji-picker-element`, ...).

Unlisted (imported but not declared, resolved only through workspace hoisting): back imports `@workadventure/map-editor` (8 files) and `uuid` (2 files); `libs/shared-utils` imports `@workadventure/messages`; map-storage imports `@smithy/types`; `room-api-client-js` imports `nice-grpc`; play imports `svelte-popperjs` (`MapEditorSideBar.svelte`); every vitest config uses `@vitest/coverage-v8`.

Before removing any of these, run `npm ci` and each package's build, typecheck and test, because a few may be loaded by a tool at runtime (Docker images, `node -r`).

## Summary

```
Dead Code Cleanup
------------------------------
Deleted:   9 unused files (back 2, play 7)
           4 standalone functions (getCapabilities, isSuccess, isFailure copy, secNSec2ms)
           3 classes (ProtobufUtils, Point, CpuTracker in play/src/pusher)
           9 unused types/schemas (IWebRTCCredentials, Identificable, PointInterface, PositionInterface,
             Movable, ItemEventMessageInterface + schema, FetchWorldChatMembers + schema,
             FetchMemberDataByUuidSuccessResponse, SocketUpgradeFailed)
           2 pointless re-exports (SpaceNotificationStrategy barrel)
           0 dependencies (reported above; manifests out of scope)
Skipped:   0 items (no check failed); 11 items kept after investigation (see Kept)
Saved:     158 lines removed, 3 added (dead-code 146, consolidation 12 / +3)
------------------------------
All checks passing: back, play, libs/map-editor, map-storage (exit 0)
```

The play batch run verified the combined state dead-code-play + consolidate-play. Dead-code-play alone was typechecked after each edit. C1 only removes two unused re-exports, so it cannot hide a dead-code-play failure.

Remote scratch state: after verification every step patch was reverse-applied in `src-review`. The 18 touched files match `git show HEAD:<path>` by sha256 again. Containers left by this task: 0 (`wa-fable-clean-1` to `-9`, all `--rm`).

`git apply --check` re-run at 03:22 UTC on checkout HEAD `32f5571f1`: `dead-code-play` and `consolidate-play` exit 0. `dead-code-back` and `consolidate-map-editor` now fail the forward check because the checkout already contains them; their reverse check (`git apply --check -R`) exits 0. All four exited 0 against `a9081f4ac` at 02:28 UTC.
