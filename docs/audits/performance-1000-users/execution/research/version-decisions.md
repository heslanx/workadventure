# Version decisions: Phaser, @types/node, deprecated packages, Zod 4

Lane: research-finish. Baseline `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`, branch `chore/orca-docker-ssh-env`.
Researched 2026-11-12, 00:08 to 00:40 UTC, on the Mac host. Scratch work was in `/tmp/wa-fable-research/`.

What this lane did and did not do:

- Read-only on the checkout. No `package.json`, lockfile, patch or source file was changed.
- Nothing was installed into the checkout. No build or test was run.
- Every status below is a recommendation for the ledger (`execution/dependency-status.csv`). None of them means `updated`.

Receipts in this directory:

| File | Content |
|---|---|
| `receipt-npm-view.txt` | `npm view` output for phaser, zod, @anatine/zod-openapi, @types/node and the nine deprecated packages |
| `receipt-phaser-dryrun.txt` | `patch --dry-run` and `git apply --check` of `patches/phaser+4.2.0.patch` against pristine phaser 4.2.1 |
| `receipt-phaser-rebase.txt` | per-file comparison of 4.2.0 and 4.2.1, the regenerated candidate patch, sha256 values |
| `receipt-types-node.txt` | the highest published 24.x and 25.x versions of @types/node |
| `receipt-consumers.txt` | importers found with `rg`, excluding `node_modules`, for the flagged packages, zod and @anatine/zod-openapi |

## 1. Phaser 4.2.0 -> 4.2.1, with `patches/phaser+4.2.0.patch`

Sources:

- `npm view phaser@4.2 version --json` returned `["4.2.0","4.2.1"]`. The `latest` tag is 4.2.1.
- `play/package.json:165` pins `"phaser": "4.2.0"`.
- The root `postinstall` runs `patch-package`.

Method:

1. Ran `npm pack phaser@4.2.1` into a new empty directory and extracted it. The tgz sha256 is `10c483ef...b714318b`. The registry `dist.shasum` is `5512f23d...ef919ea`.
2. Did the same for 4.2.0 as the control.
3. The patch paths are `a/node_modules/phaser/...`, so it was applied from the package root with `-p3`.

Results:

| Check | Result |
|---|---|
| `patch -p3 --dry-run --forward` against 4.2.1 | exit 0. All 7 files patch. 0 hunks failed, 0 rejected |
| `git apply -p3 --check --verbose` against 4.2.1 | all 29 hunks apply. `dist/phaser.esm.js` hunks 1-8 apply at offset +3 lines and hunks 9-10 at offset +11 lines. The other 6 files apply at offset 0 |
| Same checks against pristine 4.2.0 (control) | exit 0, 0 offsets |
| Is the patch already upstream? | No. `grep -rl 'WA_DATA_PRECISION\|WA patch'` finds 0 files in either pristine package. A reverse dry-run reports "Unreversed (or previously applied) patch detected" on every file, which means the patch is not applied |
| Patched source files that changed between 4.2.0 and 4.2.1 | 6 of 7 are byte-identical (the TilemapGPULayer shaders, `TilemapGPULayer.js`, `Tileset.js`). Only `dist/phaser.esm.js` differs, by 73 changed lines, outside the patched regions |

Hunk count: 29 applied, 0 failed, 0 already upstream.

What a rebased patch needs:

- Rename it to `patches/phaser+4.2.1.patch`. patch-package matches patches to versions by file name.
- Regenerate the `dist/phaser.esm.js` hunk headers so they apply with zero offset.
- No content change is needed. A candidate regenerated against 4.2.1 is at `/tmp/wa-fable-research/out/phaser+4.2.1.patch.candidate`. It has 498 lines, 29 hunks and 7 files, and its sha256 is `df9cd3ca...0cfab`. Compared with the current patch, its added and removed lines differ in 0 lines. It passes `git apply --check` on pristine 4.2.1 with 0 offset or fuzz lines. It was not copied into the repo because `patches/` is outside this lane.
- The upgrade PR also needs the following checks. None of them was run here:
  1. `play/package.json` set to `4.2.1`.
  2. A lockfile refresh.
  3. A clean `npm ci` with `postinstall` applying the patch without warnings.
  4. `play` typecheck and build.
  5. The tilemap rendering checks that the patch exists for (GPU layer precision on mediump devices).

Decision: `pending`. The upgrade is unblocked, and the patch rebases mechanically.

## 2. @types/node against the runtime line

Runtime line evidence:

- Every product Dockerfile uses `FROM ... node:24-trixie-slim`: `back/Dockerfile:2,11`, `map-storage/Dockerfile:6,15,37` and `play/Dockerfile:6,15,73`.
- CI uses `node-version: 24` 15 times and `'24.x'` twice. The only other value is `build-and-release-desktop.yml:25 [22.x]`, the Electron desktop build.
- No `engines.node` in any `package.json`. No `.nvmrc` or `.node-version`.

Declared versions:

- 12 `package.json` files declare `"@types/node": "^25.9.1"`, including back, play, map-storage, messages, libs/* and contrib/tools/*.
- These are types for Node 25, which is newer than the Node 24 runtime. They expose APIs that Node 24 does not have.

Highest patch of the matching major:

- `npm view @types/node versions --json` gives `24.19.2` as the highest 24.x. It also carries the `old-version` dist-tag.
- The highest 25.x is `25.9.9`. `latest` is `26.6.6`.

Decision: `pending`. Align all 12 manifests to `"@types/node": "^24.19.2"` in one PR. Run the typecheck of every workspace, because downgrading the types can surface uses of APIs added after Node 24. The desktop build on Node 22 is a separate decision and is not covered here.

## 3. The nine deprecated packages

The deprecation text comes from `npm view <pkg> deprecated` (see `receipt-npm-view.txt`). Consumers come from `rg` over the repository, excluding `node_modules` (see `receipt-consumers.txt`). `npm view <pkg>@<line> types` confirmed which runtime packages ship their own types.

| Package | Declared at | Deprecation text (abridged) | Real consumers | Decision |
|---|---|---|---|---|
| @types/adm-zip | `tests/package.json` `^0.5.0` | "stub types ... adm-zip provides its own type definitions" | `tests/tests/utils/zip.ts` imports `adm-zip`. `adm-zip@0.6.x` ships `types.d.ts` | Remove the redundant stub |
| @types/http-status-codes | `back/package.json`, `play/package.json` `^1.2.0` | "stub types ... http-status-codes provides its own type definitions" | 0 importers. `http-status-codes` is not declared anywhere | Remove: a dead stub with no runtime package |
| @types/mime | `map-storage/package.json` `^3.0.4` | "stub ... mime provides its own type definitions" | `map-storage/src/Services/Mime.ts` (3 imports). `mime@^4.1.0` ships `./dist/src/index.d.ts`, so the v3 types are not the right ones for v4 | Remove the redundant stub |
| @types/mkdirp | `back/package.json` `^1.0.2` | "stub ... mkdirp provides its own type definitions" | 0 importers. `back` also declares `mkdirp ^3.0.1` and has 0 importers of it. `map-storage` uses `fs.mkdirp` from fs-extra, not this package | Remove the stub. The unused `mkdirp` in `back` can go in the same PR |
| @types/uuid | `play/package.json`, `libs/map-editor/package.json` `^10.0.0` | "stub ... uuid provides its own type definitions" | 37 files import `uuid` (32 play, 3 libs/map-editor, 2 back). `uuid@14` ships `./dist/index.d.ts` | Remove the redundant stub |
| uuidv4 | `back/package.json` `^6.0.7` | "Package no longer supported" | 0 importers of `uuidv4`. `back/src/SpaceManager.ts` and `back/src/Model/Strategies/WebRTCCommunicationStrategy.ts` import `uuid`, which `back` does not declare: it resolves only through workspace hoisting | Replace: remove `uuidv4` and declare `"uuid": "^14.0.0"` in `back` (the version already locked through play and map-editor) |
| dtslint | `messages/package.json` devDependency `^4.0.5` | "See https://aka.ms/type-testing-tools" | 0 importers. No script calls it | Remove: unused dev tool |
| axios-retry | `play/package.json` `^4.5.0` | "no longer maintained. See https://github.com/softonic/axios-retry for alternatives" | `play/src/front/Connection/ConnectionManager.ts` and `AxiosUtils.ts` use `axiosRetry`, `exponentialDelay` and `isNetworkOrIdempotentRequestError` | Documented exception for now. 4.5.0 is the latest version and its peer range `axios 0.x \|\| 1.x` holds. Replacing it with an in-repo retry interceptor is its own PR, with tests of the retry and backoff behavior |
| prom-client | `back/package.json`, `play/package.json` `^15.1.3` | "prom-client has been replaced by @prometheus-io/client" | 4 files: back and play `PrometheusController.ts` (`register`, `collectDefaultMetrics`) and `GaugeManager.ts` (`Gauge`, `Counter`) | `blocked_with_reason`. The successor `@prometheus-io/client@0.16.1` (engines `^22 \|\| ^24 \|\| >=26`) is a new dependency, which needs approval, and it is a pre-1.0 API. The replacement also needs a contract test that keeps the metric names and the `/metrics` text output identical. Until then, 15.1.3 stays as a documented exception |

The five stub removals (@types/adm-zip, http-status-codes, mime, mkdirp and uuid) plus dtslint fit one small PR. To verify it:

1. Refresh the lockfile.
2. Run the typecheck of tests, back, play, map-storage, libs/map-editor and messages.

The uuidv4 replacement in `back` is a second small PR, with the back typecheck and back unit tests. None of these checks was run in this lane.

## 4. Zod 4 against @anatine/zod-openapi

Registry data (`receipt-npm-view.txt`):

- `zod` latest is `4.6.7`.
- `@anatine/zod-openapi` latest is `2.2.8`, with `peerDependencies.zod: "^3.20.0"`. There is no release that accepts Zod 4.
- `zod-to-json-schema@3.25.2` declares `zod: "^3.25.28 || ^4"`, so it does not block.

Repository state:

- `zod` is declared at `^3.25.76` in 8 manifests, and at `^3.23.8` in `map-storage`. The lockfile has 3.25.76.
- `@anatine/zod-openapi ^2.2.8` is declared in play, back, messages and libs/messages.

Consumers:

- 20 files import `@anatine/zod-openapi`. They make 209 `extendApi` calls in total. The largest counts are `MapDetailsData.ts` (75), `ErrorApiData.ts` (27), `AnalyticsEventsBatch.ts` (20) and `play/src/pusher/services/AdminApi.ts` (19).
- `play/src/pusher/services/SwaggerGenerator.ts` builds the public OpenAPI document with `generateSchema`.
- `play/tests/pusher/AnalyticsEventCatalog.test.ts` pins how that generator renders the analytics schema.
- 161 files import `zod`. Of these, 115 are in `play/src`.

Decision: `blocked_with_reason`. Moving to Zod 4 breaks the peer range of the only OpenAPI generator in use. The move requires a contract migration:

1. Replace `extendApi`/`generateSchema` with a Zod-4-compatible generator, such as Zod 4's native JSON Schema output or another adapter.
2. Prove that the generated OpenAPI document is unchanged. Diff the Swagger JSON before and after, and keep `AnalyticsEventCatalog.test.ts` green.
3. Bump `zod` in all nine manifests together.

No candidate generator was evaluated in this lane, and none is claimed to be compatible.

## Recommended ledger overrides

```json
[
  {"name": "phaser", "status": "pending", "evidence": "4.2.1 is the latest 4.2.x (npm view phaser@4.2 version). patches/phaser+4.2.0.patch dry-runs on pristine 4.2.1 with patch -p3 --dry-run exit 0, 29/29 hunks applied, 0 failed, 0 already upstream (only dist/phaser.esm.js offsets +3/+11). The rebased candidate (rename to phaser+4.2.1.patch, same 0-line body diff) is at /tmp/wa-fable-research/out, sha256 df9cd3ca. The pin bump, npm ci, build and tilemap checks are not run. See research/receipt-phaser-dryrun.txt and receipt-phaser-rebase.txt", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "@types/node", "status": "pending", "evidence": "The runtime is Node 24 (all product Dockerfiles FROM node:24-trixie-slim, CI node-version 24 x15 and '24.x' x2, no engines). 12 manifests declare ^25.9.1. The highest 24.x is 24.19.2 (npm view @types/node versions). Align to ^24.19.2 in one PR with the typecheck of every workspace. See research/receipt-types-node.txt", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "@types/adm-zip", "status": "pending", "evidence": "Deprecated stub. adm-zip 0.6.x ships types.d.ts. One consumer, tests/tests/utils/zip.ts. Decision: remove the stub from tests/package.json. See research/version-decisions.md section 3", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "@types/http-status-codes", "status": "pending", "evidence": "Deprecated stub. 0 importers and http-status-codes is not declared anywhere. Decision: remove it from back and play. See research/version-decisions.md section 3", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "@types/mime", "status": "pending", "evidence": "Deprecated stub. mime ^4.1.0 ships its own types. One consumer, map-storage/src/Services/Mime.ts. Decision: remove it from map-storage. See research/version-decisions.md section 3", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "@types/mkdirp", "status": "pending", "evidence": "Deprecated stub. 0 importers of mkdirp in back (map-storage uses fs-extra fs.mkdirp). Decision: remove the stub and the unused mkdirp dependency from back. See research/version-decisions.md section 3", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "@types/uuid", "status": "pending", "evidence": "Deprecated stub. uuid 14 ships ./dist/index.d.ts. 37 importers. Decision: remove it from play and libs/map-editor. See research/version-decisions.md section 3", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "uuidv4", "status": "pending", "evidence": "Deprecated ('no longer supported'). 0 importers. back imports undeclared uuid in 2 files. Decision: replace with a declared uuid ^14.0.0 in back. See research/version-decisions.md section 3", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "dtslint", "status": "pending", "evidence": "Deprecated (see aka.ms/type-testing-tools). 0 importers and no script uses it. Decision: remove the devDependency from messages. See research/version-decisions.md section 3", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "axios-retry", "status": "blocked_with_reason", "evidence": "Deprecated (unmaintained). 4.5.0 is the latest, with peer axios 0.x||1.x satisfied. 2 consumers in play/src/front/Connection. Documented exception until a replacement PR with in-repo retry/backoff and tests. See research/version-decisions.md section 3", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "prom-client", "status": "blocked_with_reason", "evidence": "Deprecated in favor of @prometheus-io/client 0.16.1, which is a new pre-1.0 dependency and needs approval plus a contract test of the metric names and /metrics output. 4 consumers in back and play. 15.1.3 is kept as a documented exception. See research/version-decisions.md section 3", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "zod", "status": "blocked_with_reason", "evidence": "zod 4.6.7 is available, but @anatine/zod-openapi 2.2.8 (latest) has peer zod ^3.20.0. 20 files with 209 extendApi calls and SwaggerGenerator generateSchema depend on it. A Zod 4 move needs a generator replacement and proof that the OpenAPI document is unchanged. See research/version-decisions.md section 4", "updated_utc": "2026-11-12T00:40Z"},
  {"name": "@anatine/zod-openapi", "status": "blocked_with_reason", "evidence": "2.2.8 is already the latest, but its peer zod ^3.20.0 blocks Zod 4. There is no Zod-4-compatible release. Replacing it is the Zod 4 contract migration. See research/version-decisions.md section 4", "updated_utc": "2026-11-12T00:40Z"}
]
```
