# Research provenance and unresolved claims

Research baseline is `ddbe245a84c78c947dd9ae5310da1fc53cd3d278`. Dependency and upstream checks were made on 2026-11-11. Planning files were completed across the local date boundary into 2026-11-12. Version observations are dated snapshots, not an evergreen latest-version service.

## Independent exploration

Three read-only planning workers examined separate scopes under the multi-phase planning workflow. The dependency worker compared lockfile resolutions with primary registry/release sources. The backend worker traced benchmark, replay, viewport and autosave behavior and existing upstream work. The client worker traced interpolation, timeline, provider boundaries and language tradeoffs. Their findings were incorporated into the four plan documents and diagnostic; no worker changed product files, installed packages, ran tests or retained processes.

The dependency and backend workers used GitHub tools for metadata. Their upstream inspection found #6688 open, unmerged and non-draft. The direct web fetch for that PR failed during the final root cross-check; the documented state comes from the successful worker metadata fetch. Searches were bounded and unauthenticated search rate limiting prevented exhaustive duplicate clearance. Recheck before publication.

## Source anchors

| Claim | File at the audited commit |
|---|---|
| Obsolete benchmark browser import and call | `benchmark/index.ts`; `play/src/front/Connection/ConnectionManager.ts` |
| Replay allocation and retention | `play/src/common/NoncedMessageStore.ts`; `play/src/pusher/services/PusherWebSocket.ts` |
| Repeated viewport reconciliation | `play/src/pusher/models/PositionDispatcher.ts` |
| Save interval, failure and cache eviction | `map-storage/src/MapsManager.ts` |
| Interpolation intermediate Map | `play/src/front/Phaser/Game/PlayersPositionInterpolator.ts`; `play/src/front/Phaser/Game/GameScene.ts` |
| Full accumulated timeline DOM | `play/src/front/Chat/Components/Room/RoomTimeline.svelte` |
| Existing render skipping | `play/src/front/Phaser/Game/Game.ts` |
| Existing LiveKit adaptive options | `play/src/front/Livekit/LiveKitRoom.ts` |
| Room/backend routing | `libs/shared-utils/src/ApiClientRepository.ts` |
| Local renderer patch | `patches/phaser+4.2.0.patch` |

Source inspection proves the listed code mechanisms, not their measured contribution to total latency or memory. In particular, interval overlap and failed-save eviction are hypotheses for observable persistence failure until fault injection reproduces the outcome. Do not publish them as demonstrated data loss.

## Scope and resource boundary

This task copied and created documentation/inventory artifacts only. No dependency, runtime, product code, credential, environment configuration, branch, commit, PR or deployment was changed by this planning task. The shared checkout had unrelated changes in `.gitignore`, `.audit/`, `orca.yaml` and `scripts/`; they were preserved. Other concurrent work may add changes after this receipt.

No runtime prototype, benchmark or product test was run. The protocol generator was not repaired during planning. No new dependency was introduced. No temporary measurement override or disabled check was created. All three planning workers completed and reported no retained resources. Earlier analysis artifacts remain preserved byte for byte.

The Prove It Works principle is reflected in separate static findings, modeled bandwidth, proposed SLOs and future measurement gates. None of the documents claims a verified capacity of 1,000 users or a measured percentage improvement.

## Complete dependency extension on 2026-11-12

The user requested all upgrades and the Go-based TypeScript compiler in the complete plan. The root enumerated every original direct declaration and queried npm latest metadata for all 208 externally consumed registry names, including the published iframe typings whose local publication workspace has a placeholder version. Eight names are internal packages and uWebSockets.js is a GitHub dependency. The 419-row target CSV is a coverage map, not a solver or compatibility certification. Engines, peers and deprecation text are retained in the public metadata snapshot.

The dependency worker performed a second read-only pass on stable TypeScript 7.0.2, the official TypeScript 6 compatibility wrapper, Svelte/lint/ts-node consumers, tsconfigs and emission/CI paths. It completed without retained resources. The official migration arrangement and supported peer ranges motivate the staged dual-compiler plan.

No install, product file edit, benchmark, compiler execution or PR publication was performed in this extension. The finite registry collection process completed normally. Container target resolution and OS SBOM production remain explicit execution tasks. The broader plan preserves the earlier performance priorities and adds compiler optimization as a separate CI/development concern.
