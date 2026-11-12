# Deps cleanup: DEP-02 (declare) and DEP-01 (prune)

Goal. The WorkAdventure monorepo must stop depending on workspace hoisting for packages it imports (DEP-02) and stop shipping dependencies nothing uses (DEP-01), without changing runtime behavior. The smallest change is one `package.json` edit per package plus the matching root `package-lock.json` change, shipped as eight patches. Nothing in the checkout was edited or committed.

Result. Eight patches, all applying in order on the snapshot and on the current checkout HEAD. A real `npm ci` and every package check on the final stack exit 0. DEP-02 declares four dependencies in three packages. DEP-01 removes 42 of the 43 candidates. Two DEP-02 ledger entries (`nice-grpc`, `svelte-popperjs`) and one DEP-01 candidate (`tsconfig-paths` in map-storage) did not survive the evidence and are not in the patches.

## Base and apply order

Snapshot HEAD: `0d9d44dc6ae06abc8c322d45014a8ab63880e93b` (built the way `/tmp/wa-ci4/build.sh` builds it: env templates, signing key and credential helper removed, generated proto and i18n files added, `docs/` dropped).
Apply check against the checkout HEAD at the end of the run (`87b3c6e038339d7d93f42f3abdc1be69eae8e88a`): `git apply --check` and `git apply` exit 0 for all eight patches in order (resulting `package-lock.json` is byte-identical to the one generated in the container).

Apply with `git apply --whitespace=nowarn <patch>` from the repo root, in this order. Each patch changes one `package.json` and the root `package-lock.json`, and each lockfile hunk is incremental on the patch before it.

| # | Patch | sha256 (first 16) | Change |
|---|---|---|---|
| 1 | `dep02-back.patch` | `9863720835eb0bf2` | `back/package.json`: declare `@workadventure/map-editor` `1.0.0` and `uuid` `^14.0.0` in dependencies. Lockfile: 0 entries removed, 0 added. |
| 2 | `dep02-shared-utils.patch` | `e9345921ca343ff5` | `libs/shared-utils/package.json`: declare `@workadventure/messages` `1.0.0` in dependencies. Lockfile: 0 entries removed, 0 added. |
| 3 | `dep02-map-storage.patch` | `d6820872c1bd3e7c` | `map-storage/package.json`: declare `@smithy/types` `^4.14.2` in devDependencies. Lockfile: 0 entries removed, 0 added. |
| 4 | `dep01-back.patch` | `09d1611b134aa3d3` | `back/package.json`: remove 11 unused dependencies. Lockfile: 10 entries removed, 0 added. |
| 5 | `dep01-map-storage.patch` | `1a1552901e758f96` | `map-storage/package.json`: remove 11 unused dependencies (`tsconfig-paths` kept). Lockfile: 57 entries removed, 0 added. |
| 6 | `dep01-libs-messages.patch` | `289b82c5978a5b2d` | `libs/messages/package.json`: remove `google-protobuf`, `long`, `rxjs`. Lockfile: 0 entries removed, 0 added. |
| 7 | `dep01-libs-store-utils.patch` | `f67659332875c311` | `libs/store-utils/package.json`: remove `@types/debug`. Lockfile: 0 entries removed, 0 added. |
| 8 | `dep01-play.patch` | `7cacea9087090619` | `play/package.json`: remove 16 unused dependencies. Lockfile: 25 entries removed, 0 added. |

DEP-02 goes first so each declared dependency is in place before DEP-01 prunes the same package.

## DEP-02: declare what is imported

Each added range is the one the lockfile already resolves. Internal packages use `1.0.0`, the style back, map-storage and shared-utils already use for `@workadventure/*`. No lockfile package is added, removed or re-versioned by any DEP-02 patch (`evidence/lockdiffs/dep02-*.lockdiff.txt`: added 0, removed 0, version-changed 0).

| Patch | Added | Section | Why this section | Imported at |
|---|---|---|---|---|
| dep02-back | `@workadventure/map-editor` `1.0.0` | dependencies | runtime value imports in `src`, and `back/Dockerfile:25` installs with `--omit=dev` | `back/src/Model/GameRoom.ts:5-7` (`GameMapProperties`, `LocalUrlError`, `mapFetcher`), `back/src/Model/Services/WamManager.ts:1,13`, `back/src/Services/ModeratorTagFinder.ts:1`, `back/src/Model/AreaZoneTracker.ts:1`, `back/src/Model/AreaPropertyEvents/MaxUsersInAreaManager.ts:2`, `back/src/Model/AreaPropertyEvents/LockableAreaManager.ts:2`, and five test files |
| dep02-back | `uuid` `^14.0.0` | dependencies | runtime import in `src`. Same range as `play` and `libs/map-editor`, resolved `14.0.0` | `back/src/SpaceManager.ts:2`, `back/src/Model/Strategies/WebRTCCommunicationStrategy.ts:3` |
| dep02-shared-utils | `@workadventure/messages` `1.0.0` | dependencies | runtime value imports in `src` | `libs/shared-utils/src/SharedAdminApi.ts:2-3` (`isCapabilities`), `libs/shared-utils/src/SpaceState/SpaceState.ts:2` (`spaceKindSchema`), `libs/shared-utils/src/ApiClientRepository.ts:8`, `libs/shared-utils/src/AnalyticsEventsQueue.ts:2` (type) |
| dep02-map-storage | `@smithy/types` `^4.14.2` | devDependencies | the only import is `import type`, which TypeScript erases, so no runtime code loads it. Resolved `4.14.2` | `map-storage/src/Upload/S3ClientWithMD5.ts:11` |

`uuid` 14 ships its own types (`node_modules/uuid/package.json` has `types: ./dist/index.d.ts`), so back needs no `@types/uuid`.

### Not changed (ledger entries that do not hold at HEAD)

- `room-api-client-js` and `nice-grpc`. `libs/room-api-clients/room-api-client-js/package.json:42` already declares `"nice-grpc": "^2.1.16"`, added with the package in `f982421f1` (Room API, #3153). The import is `libs/room-api-clients/room-api-client-js/src/index.ts:7`. The package is also not a root workspace (`libs/*` does not match `libs/room-api-clients/room-api-client-js`) and has its own `package-lock.json`, so the root lockfile is the wrong place for it. No patch.
- `play` and `svelte-popperjs`. The only two mentions are comments: `play/src/front/Components/MapEditor/MapEditorSideBar.svelte:3` (`// import { createPopperActions } from "svelte-popperjs";`) and `play/src/front/Utils/svelte-floatingui.ts:1`. Nothing imports it, and `node_modules/svelte-popperjs` is not in the lockfile at all. Declaring it would add a new dependency, which is out of scope, and nothing needs it. No patch. The ledger entry should be closed for these two.

## DEP-01: remove what nothing uses

Method. `evidence/candidate-scan.py <snapshot-root>` searches the whole snapshot (4,372 files: every workspace plus `desktop`, `tests`, `benchmark`, `contrib`, `maps`, `.github`, `.husky`, Dockerfiles, yaml, md, html, css, svelte; `node_modules`, lockfiles and `dist` excluded) for each candidate in four ways. Specifier form (a quote, backtick or parenthesis, then the name, then a quote or `/`, which covers `import`, `require`, dynamic `import()`, CSS `@import`, `url()`, `types: []`). Word mention (shell flags such as `node -r`, `--import`, Dockerfile `RUN`, yaml, md). The package's `bin` names. And which lockfile entries require it. Positive controls: the same scan finds `livekit-server-sdk` in nine `back/src` and `back/tests` sites and `uuid` in `back`, `play` and `libs/map-editor`, so it does report real imports. Raw output: `evidence/candidate-scan.txt`. For an `@types/x` candidate the scan searches `x` itself, so its hits are the importers of `x` (for example `debug` and `uuid`), and the decision for those rows is in the table below. The scan treats `package.json` declarations as the thing being removed, so those lines are excluded from the hits.

Second check. `evidence/removed-packages-scan.py` lists every package that leaves the lockfile once the stack is applied (64 top-level, 92 lockfile entries counting nested copies; 20 are removed candidates and the rest are reached only through them, such as the webpack tree behind `ts-loader`) and searches the snapshot for any specifier naming one. Two names match, `loupe` and `touch`, and both matches are unrelated string literals (`tool === "loupe"`, `pointerType: "touch"`). No removed `@types/*` package is named by a `/// <reference types>` or a `types` array either. Raw output: `evidence/removed-packages-scan.txt`.

All 42 removals below came back with no import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference. Preload flags in the repo were listed too (`rg` for `-r`, `--require`, `--import`, `--loader` in package scripts, Dockerfiles, workflows, shell): they name only `tsx`, `source-map-support` (play's own `old_start`) and `tsconfig-paths` (kept, below). The listing is `evidence/preload-flags.txt`; its `zip -r` and `jq -r` lines are unrelated.

| Patch | Package | Removed | Declared at | Section | Lockfile effect | Evidence and notes |
|---|---|---|---|---|---|---|
| dep01-back | `back` | `@grpc/proto-loader` | `back/package.json:47` (`0.8.1`) | prod | stays installed (required by node_modules/@grpc/grpc-js) | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-back | `back` | `busboy` | `back/package.json:55` (`^1.6.0`) | prod | stays installed (required by node_modules/multer) | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-back | `back` | `@types/busboy` | `back/package.json:77` (`^1.5.4`) | dev | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-back | `back` | `google-protobuf` | `back/package.json:60` (`^4.0.2`) | prod | leaves lockfile | No file imports it. `messages/package.json:17` (not a workspace, own lockfile) is unaffected. |
| dep01-back | `back` | `@types/google-protobuf` | `back/package.json:79` (`^3.15.12`) | dev | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-back | `back` | `mkdirp` | `back/package.json:63` (`^3.0.1`) | prod | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-back | `back` | `@types/mkdirp` | `back/package.json:81` (`^1.0.2`) | dev | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-back | `back` | `query-string` | `back/package.json:67` (`^9.5.1`) | prod | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-back | `back` | `source-map-support` | `back/package.json:70` (`^0.5.21`) | prod | stays installed (required by node_modules/ts-node-dev, play) | The only `-r source-map-support/register` is `play/package.json:17` (`old_start`), and play declares its own copy. |
| dep01-back | `back` | `uuidv4` | `back/package.json:72` (`^6.0.7`) | prod | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-back | `back` | `@types/http-status-codes` | `back/package.json:80` (`^1.2.0`) | dev | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-map-storage | `map-storage` | `@grpc/proto-loader` | `map-storage/package.json:53` (`^0.8.1`) | prod | stays installed (required by node_modules/@grpc/grpc-js) | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-map-storage | `map-storage` | `busboy` | `map-storage/package.json:63` (`1.6.0`) | prod | stays installed (required by node_modules/multer) | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-map-storage | `map-storage` | `google-protobuf` | `map-storage/package.json:70` (`^4.0.2`) | prod | leaves lockfile | No file imports it. `messages/package.json:17` (not a workspace, own lockfile) is unaffected. |
| dep01-map-storage | `map-storage` | `nodemon` | `map-storage/package.json:74` (`^3.1.14`) | prod | leaves lockfile | In no script (`back:start:dev` uses `tsx watch`) and no other file. Its `nodemonConfig` block is left in place (see Findings). |
| dep01-map-storage | `map-storage` | `npm-check-updates` | `map-storage/package.json:75` (`^22.2.1`) | prod | leaves lockfile | No `ncu` or `npm-check-updates` call in any script, workflow or Dockerfile. |
| dep01-map-storage | `map-storage` | `reflect-metadata` | `map-storage/package.json:80` (`^0.2.2`) | prod | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-map-storage | `map-storage` | `rxjs` | `map-storage/package.json:82` (`^7.8.2`) | prod | stays installed (required by back, libs/shared-utils, libs/store-utils) | No rxjs import under `map-storage`. The libs it consumes declare rxjs themselves. |
| dep01-map-storage | `map-storage` | `zod-to-json-schema` | `map-storage/package.json:88` (`^3.25.2`) | prod | stays installed (required by libs/map-editor, libs/messages) | Imported only by `libs/messages/src/exportAnalyticsJsonSchema.ts:3` and `libs/map-editor/src/exportJsonSchema.ts:3`, which declare it. |
| dep01-map-storage | `map-storage` | `@total-typescript/ts-reset` | `map-storage/package.json:92` (`^0.6.1`) | dev | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-map-storage | `map-storage` | `source-map-support` | `map-storage/package.json:109` (`^0.5.21`) | dev | stays installed (required by node_modules/ts-node-dev, play) | Same as back: only `play/package.json:17` loads it, and play declares its own copy. |
| dep01-map-storage | `map-storage` | `ts-loader` | `map-storage/package.json:112` (`^9.5.7`) | dev | leaves lockfile | No webpack config in map-storage and nothing names `ts-loader` or `webpack`. Takes the webpack tree with it (57 lockfile entries). |
| dep01-libs-messages | `libs/messages` | `google-protobuf` | `libs/messages/package.json:18` (`^4.0.2`) | prod | leaves lockfile | The generated `ts-proto-generated/*.ts` import only `@bufbuild/protobuf/wire`, `@grpc/grpc-js` and each other. |
| dep01-libs-messages | `libs/messages` | `long` | `libs/messages/package.json:19` (`^5.3.2`) | prod | stays installed (required by node_modules/@grpc/proto-loader, node_modules/onnxruntime-web, node_modules/protobufjs) | The generated code does not import `long`. Stays installed because `protobufjs` and `@grpc/proto-loader` require it. |
| dep01-libs-messages | `libs/messages` | `rxjs` | `libs/messages/package.json:21` (`7.8.2`) | prod | stays installed (required by back, libs/shared-utils, libs/store-utils) | No rxjs import under `libs/messages`. Stays installed because back, play, shared-utils, store-utils and `concurrently` declare it. |
| dep01-libs-store-utils | `libs/store-utils` | `@types/debug` | `libs/store-utils/package.json:23` (`^4.1.13`) | dev | stays installed (required by back, libs/shared-utils, play) | No `debug` import under `libs/store-utils`. Stays installed because back, shared-utils and play declare it. |
| dep01-play | `play` | `hyper-express` | `play/package.json:152` (`^6.17.3`) | prod | leaves lockfile | The pusher imports `uWebSockets.js` directly (`play/src/pusher/controllers/IoSocketController.ts:6`). Nothing names `hyper-express`. |
| dep01-play | `play` | `live-directory` | `play/package.json:155` (`moufmouf/live-directory#hot_reload_param`) | prod | leaves lockfile | Git dependency (`moufmouf/live-directory#hot_reload_param`). Nothing names it. |
| dep01-play | `play` | `qs` | `play/package.json:169` (`^6.16.0`) | prod | stays installed (required by node_modules/body-parser, node_modules/express, node_modules/node-stdlib-browser/node_modules/url) | No `qs` import anywhere. Stays installed because express and body-parser require it. |
| dep01-play | `play` | `@types/qs` | `play/package.json:70` (`^6.15.1`) | dev | stays installed (required by node_modules/@types/express-serve-static-core) | No `qs` import anywhere. Stays installed because `@types/express-serve-static-core` requires it. |
| dep01-play | `play` | `ts-proto-descriptors` | `play/package.json:185` (`^2.1.0`) | prod | leaves lockfile | Nothing names it, and ts-proto is not in the root lockfile. |
| dep01-play | `play` | `google-protobuf` | `play/package.json:149` (`^4.0.2`) | prod | leaves lockfile | No file imports it. `messages/package.json:17` (not a workspace, own lockfile) is unaffected. |
| dep01-play | `play` | `@types/google-protobuf` | `play/package.json:65` (`^3.15.12`) | dev | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-play | `play` | `livekit-server-sdk` | `play/package.json:157` (`^2.15.3`) | prod | stays installed (required by back) | Imported only from `back/src` (9 sites), and back declares it. No play file imports it. |
| dep01-play | `play` | `@livekit/track-processors` | `play/package.json:110` (`^0.7.2`) | prod | leaves lockfile | No file imports it. It only installs `@types/dom-mediacapture-transform` and `@types/dom-webcodecs` as peers, and play does not need them: `play/src/types/webrtc-insertable-streams.d.ts` declares `MediaStreamTrackProcessor` and `MediaStreamTrackGenerator` itself, and TypeScript 5.9 `lib.dom` has `VideoFrame`. `git log -S track-processors` over non-lockfile paths shows only `d5b38f27d` (#5213), which added it to `play/package.json`. Proven by a typecheck with the types hidden (exit 0) and by the full final stack. |
| dep01-play | `play` | `@sentry/browser` | `play/package.json:112` (`^10.54.0`) | prod | stays installed (required by node_modules/@sentry/svelte) | Stays installed because `@sentry/svelte` pins it. |
| dep01-play | `play` | `@16bits/nes.css` | `play/package.json:100` (`^2.3.2`) | prod | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-play | `play` | `@rollup/plugin-inject` | `play/package.json:54` (`^5.0.5`) | dev | stays installed (required by node_modules/vite-plugin-node-polyfills) | Stays installed because `vite-plugin-node-polyfills` requires it. `vite.config.ts` does not name it. |
| dep01-play | `play` | `vitest-websocket-mock` | `play/package.json:97` (`^0.5.0`) | dev | leaves lockfile | No test imports it. |
| dep01-play | `play` | `@types/jsonwebtoken` | `play/package.json:67` (`^9.0.10`) | dev | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |
| dep01-play | `play` | `@types/uuid` | `play/package.json:75` (`^10.0.0`) | dev | stays installed (required by libs/map-editor) | play imports `uuid` ^14, which ships `dist/index.d.ts` (`node_modules/uuid/package.json` `types`), so the stub types are unused. `libs/map-editor` still declares `@types/uuid`, so the package stays installed. |
| dep01-play | `play` | `@types/http-status-codes` | `play/package.json:66` (`^1.2.0`) | dev | leaves lockfile | No import, `require`, CSS `@import`, config entry, script, bin call, Dockerfile line or string reference in any file. |

### Kept candidates (not removed)

| Package | Dependency | Why it stays |
|---|---|---|
| `map-storage` | `tsconfig-paths` `4.2.0` | Nothing in map-storage uses it, but `libs/map-editor/package.json:16` and `libs/shared-utils/package.json:16` run `node -r tsconfig-paths/register` in `test:debug` without declaring it. They reach it only through the copy map-storage hoists to the root. The experiment in `evidence/tsconfig-paths-experiment.txt` (lockfile regenerated with only that removal) deletes `node_modules/tsconfig-paths` 4.2.0. The only copy left is nested under `eslint-plugin-import`, which those libs cannot resolve, so both scripts would fail with module not found (inferred from Node's resolution, the scripts open a debugger and were not run). Declaring it in those two libs is the DEP-02 shape of this fix. That adds a dependency, so it needs a decision. |

## Checks

Environment. `node:24-trixie` (node `v24.22.2`, npm `11.19.1`), `--cpus 2 --memory 6g`, one container at a time. `npm ci` and the two `dockerfile-install-*` rows ran with network. Every other check ran with `--network none`. Checks mirror `/tmp/wa-ci4/run.sh`: `CI=true NODE_OPTIONS=--max-old-space-size=3072`, `PLAY_URL=http://play.workadventure.localhost ADMIN_URL=` for play and back tests, and `npm run build` in play. This npm version skips dependency install scripts (see `npm warn install-scripts` in the `npm-ci` section of `checks.raw.log`), the same as the mirror. Lockfile generation: `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` in the same image. A no-op run on the unchanged snapshot rewrote 0 lines, so no patch carries lockfile churn.

| Check | Dir | Exit | Time | Result |
|---|---|---|---|---|
| apply-dep02-back | repo root | check=0 apply=0 | 0s | `git apply --check` then `git apply` |
| apply-dep02-shared-utils | repo root | check=0 apply=0 | 0s | `git apply --check` then `git apply` |
| apply-dep02-map-storage | repo root | check=0 apply=0 | 0s | `git apply --check` then `git apply` |
| apply-dep01-back | repo root | check=0 apply=0 | 0s | `git apply --check` then `git apply` |
| apply-dep01-map-storage | repo root | check=0 apply=0 | 0s | `git apply --check` then `git apply` |
| apply-dep01-libs-messages | repo root | check=0 apply=0 | 0s | `git apply --check` then `git apply` |
| apply-dep01-libs-store-utils | repo root | check=0 apply=0 | 0s | `git apply --check` then `git apply` |
| apply-dep01-play | repo root | check=0 apply=0 | 0s | `git apply --check` then `git apply` |
| npm-ci | `.` | 0 | 55s | real `npm ci`, lockfile in sync |
| npm-ls-back-uuid-mapeditor | `.` | 0 | 0s | output below |
| npm-ls-shared-utils-messages | `.` | 0 | 0s | output below |
| npm-ls-map-storage-smithy | `.` | 0 | 0s | output below |
| npm-ls-removed-roots | `.` | 0 | 0s | output below |
| npm-ls-all-problems | `.` | 0 | 0s | output below |
| play-i18n-check | `play` | 0 | 2s | no diagnostics |
| play-typecheck | `play` | 0 | 23s | no diagnostics |
| play-svelte-check | `play` | 0 | 40s | 0 errors, 0 warnings |
| play-lint | `play` | 0 | 354s | no diagnostics |
| play-pretty-check | `play` | 0 | 24s | no diagnostics |
| play-test | `play` | 0 | 402s | 257 files, 1655 tests passed, 10 skipped |
| back-typecheck | `back` | 0 | 9s | no diagnostics |
| back-lint | `back` | 0 | 19s | no diagnostics |
| back-test | `back` | 0 | 22s | 29 files, 382 tests passed, 2 skipped |
| back-pretty-check | `back` | 0 | 2s | no diagnostics |
| map-storage-typecheck | `map-storage` | 0 | 6s | no diagnostics |
| map-storage-lint | `map-storage` | 0 | 14s | no diagnostics |
| map-storage-test | `map-storage` | 0 | 8s | 12 files, 114 tests passed |
| map-storage-pretty-check | `map-storage` | 0 | 3s | no diagnostics |
| messages-typecheck | `libs/messages` | 0 | 6s | no diagnostics |
| store-utils-typecheck | `libs/store-utils` | 0 | 2s | no diagnostics |
| store-utils-svelte-check | `libs/store-utils` | 0 | 2s | 0 errors, 1 warning (no `.svelte` input in this package, unrelated to dependencies) |
| store-utils-lint | `libs/store-utils` | 0 | 4s | no diagnostics |
| store-utils-test | `libs/store-utils` | 0 | 1s | 1 files, 12 tests passed |
| shared-utils-typecheck | `libs/shared-utils` | 0 | 5s | no diagnostics |
| shared-utils-lint | `libs/shared-utils` | 0 | 9s | no diagnostics |
| shared-utils-test | `libs/shared-utils` | 0 | 4s | 5 files, 30 tests passed |
| map-editor-typecheck | `libs/map-editor` | 0 | 5s | no diagnostics |
| map-editor-lint | `libs/map-editor` | 0 | 9s | no diagnostics |
| map-editor-test | `libs/map-editor` | 0 | 5s | 7 files, 39 tests passed |
| math-utils-typecheck | `libs/math-utils` | 0 | 1s | no diagnostics |
| benchmark-test | `benchmark` | 0 | 6s | 1 files, 15 tests passed |
| benchmark-typecheck | `benchmark` | 0 | 3s | no diagnostics |
| play-build | `play` | 0 | 20s | production build built in 15.12s, marker-files=2 |
| dockerfile-install-back | `back` | 0 | 0s | scoped install exit 0, declared modules resolve (see `dfm` section) |
| dockerfile-install-map-storage | `map-storage` | 0 | 0s | scoped install exit 0, declared modules resolve (see `dfm` section) |

The two `dockerfile-install-*` rows run the scoped installs the Dockerfiles run (`back/Dockerfile:25`, `npm ci --omit=dev --workspace workadventureback`, and `npm ci --workspace map-storage`) on a context that holds only the manifests those Dockerfiles copy. They then resolve the packages DEP-02 declared from inside the workspace. This is the production-install path where an undeclared dependency would be missing, so it is the closest local check of what DEP-02 buys. The output is in the `dfm` section of `checks.raw.log`.

### Declared dependencies resolve to the declared range (`npm ls`, exit 0 for all three)

```
$ npm ls uuid @workadventure/map-editor --workspace workadventureback
workadventure@ /w/final
`-- workadventureback@1.0.0 -> ./back
  +-- @workadventure/map-editor@1.0.0 -> ./libs/map-editor
  | `-- uuid@14.0.0 deduped
  +-- @workadventure/shared-utils@1.0.0 -> ./libs/shared-utils
  | `-- @workadventure/map-editor@1.0.0 deduped -> ./libs/map-editor
  `-- uuid@14.0.0

$ npm ls @workadventure/messages --workspace @workadventure/shared-utils
workadventure@ /w/final
`-- @workadventure/shared-utils@1.0.0 -> ./libs/shared-utils
  +-- @workadventure/map-editor@1.0.0 -> ./libs/map-editor
  | `-- @workadventure/messages@1.0.0 deduped -> ./libs/messages
  `-- @workadventure/messages@1.0.0 -> ./libs/messages

$ npm ls @smithy/types --workspace map-storage   (direct entry; the full tree dedupes to the same copy)
map-storage@1.0.0
  `-- @smithy/types@4.14.2
```

The full outputs are in `checks.raw.log`.

### Removed packages are gone, and nothing else is missing

```
$ npm ls google-protobuf mkdirp query-string uuidv4 busboy hyper-express live-directory ts-proto-descriptors webpack ts-loader nodemon reflect-metadata @livekit/track-processors @types/dom-mediacapture-transform @types/dom-webcodecs
workadventure@ /w/final
+-- map-storage@1.0.0 -> ./map-storage
| `-- multer@2.1.1
|   `-- busboy@1.6.0
`-- workadventure-artillery@1.0.0 -> ./benchmark
  `-- ts-node-dev@2.0.0
    `-- mkdirp@1.0.4
```

`busboy` is still installed through `multer` (map-storage) and `mkdirp` 1.0.4 through `ts-node-dev` (benchmark). Both are other packages' own dependencies.

```
$ npm ls --all   (problem lines only)
npm-ls-all-exit=0
invalid=0 missing=0 extraneous=0 unmet-required=0 unmet-optional=129
```


### Negative control (run 1, before `@livekit/track-processors` was added to the stack)

Run 1 was the same stack with `@livekit/track-processors` kept, on the assumption that it supplied the global types `MediaStreamTrackProcessor` and `MediaStreamTrackGenerator` that `MediaPipeTasksVisionWorkerTransformer.ts` uses. The control hid `node_modules/@types/dom-mediacapture-transform` and ran `npm run typecheck` in play. It exited 0 (`evidence/run1-negative-control.log`), which disproved the assumption: `play/src/types/webrtc-insertable-streams.d.ts` declares both globals locally. The dependency was then added to `dep01-play`, the lockfile regenerated, and the whole lane rerun as run 2 (the table above). Run 1 results, all exit 0 with the same lanes, are in `evidence/run1-results.tsv`. Patches 1 to 7 are byte-identical between runs.

Raw logs: `checks.raw.log` (ANSI stripped; the last 30,000 bytes of each check, the `npm ci` tail, and the `dfm` section).

To rebuild the stack on a moved HEAD, `evidence/lockgen/gen.sh` regenerates every lockfile step from `steps.json` (the edits, one entry per patch) inside the node container, and `npmci.sh`, `checks.sh` and `dfm.sh` are the verification scripts used here, and `exp.sh` is the `tsconfig-paths` experiment.

## What was not done

Everything in the brief was done. These limits remain.

- No bisection was needed. Run 1 and run 2 passed every lane. The only change between them is `@livekit/track-processors` joining `dep01-play`.
- No Docker image was built. The two scoped `npm ci` runs the back and map-storage Dockerfiles use were mirrored on the stacked tree (`dockerfile-install-*` rows), but the image layers, the `proto-builder` stage and `play/Dockerfile` were not run.
- The e2e `tests` workspace, `desktop` (own lockfile), `maps` and `contrib/tools/*` were not run. The scan shows nothing in them imports a removed package (`evidence/removed-packages-scan.txt` covers the whole snapshot), and `npm ci` accepted the lockfile for all workspaces.
- `play-test`, `back-test` and the other suites ran once each on the final stack. The lanes are the ones in `/tmp/wa-ci4/run.sh`, plus `libs/messages` typecheck. `libs/map-editor`, `benchmark` and `libs/math-utils` are not edited by any patch and ran as consumers.
- The stack was checked against the checkout HEAD shown above. HEAD moves as other work lands, so a later `package.json` or lockfile edit by another patch can make a lockfile hunk fail to apply. In that case regenerate with `evidence/lockgen/gen.sh` instead of hand-merging.
- The ledger (`docs/TECH-DEBT.md`) was not edited. DEP-02 should be reworded to three packages (four dependencies), and DEP-01 to 42 removals and one kept item, once the stack lands.

## Verdict round (coordinator)

The cross-family verdict (`gpt-6-luna`, `../../performance-1000-users/execution/verdicts/deps-cleanup.md`) returned PASS_WITH_NITS with one finding, DEP-NIT-01: the `nodemonConfig` block stays in `map-storage/package.json` after `nodemon` is removed. Fixed in `dep01-map-storage.v2.patch` (sha256 `b4a407b0fecce859ed3729ea7731594ebd8299f8abff5aad26846628c84462ed`), which also drops the block. Its `package-lock.json` hunk has the same patch-id as v1 (`f20e3bdec6c7`), since the lockfile does not record `nodemonConfig`, and patches 6 to 8 apply on top of it. Nothing reads the block once `nodemon` is gone, so no check was rerun for it; CI run 5 covers the landed stack. The stack lands with the v2 patch in place of patch 5.

## Findings outside this scope

- `map-storage/package.json:118` still had a `nodemonConfig` block. Removed by `dep01-map-storage.v2.patch` after the verdict.
- `libs/map-editor/package.json` declares `@types/uuid` as a production dependency, but `uuid` 14 ships its own types. Removing it is a separate small change.

## Resources

- knc job dir `~/wa-jobs/wa-fable-20261112/deps-clean/` (about 56 MB), left for the coordinator. It holds `src.tgz` (the snapshot), `patches/` (the stack), `out-lock/` and `out-lock-v1/` (lockfile generation output, lock before and after, per-step lock diffs), `out-final/` (run 2: results, every log, `dfm.log`) and `out-final-v1/` (run 1), `out-exp/` (the `tsconfig-paths` experiment), plus the scripts (`gen.sh`, `npmci.sh`, `checks.sh`, `dfm.sh`, `exp.sh`, `steps.json`) and the container logs. I removed the extracted trees (`final/` with `node_modules`, about 1.7 GB, and `lock/`) and the npm cache from it. Nothing was written to any other job dir.
- Containers: none left. Nine ran, all with `--rm` and the label `owner=wa-fable-20261112`, one at a time: `wa-fable-depsclean-lock` three times (the first run lost its git history to a file-ownership error and produced no patches, so it was rerun), `-ci` twice, `-checks` twice, `-dfm` once and `-exp` once (the `tsconfig-paths` lockfile experiment). Network was on only for the lockfile, `npm ci` and `dfm` runs. `docker ps -a --filter name=wa-fable-depsclean` is empty.
- Mac scratch: `/tmp/wa-fable-depsclean` was removed after the files were copied here. No `._*` files were created in the checkout.
