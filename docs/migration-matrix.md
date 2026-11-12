# Konclui native migration matrix

Status vocabulary: `inventoried` means source inspection only; `implemented` means candidate source exists; `verified` requires named runtime evidence. No row is complete merely because a legacy test passed. Reference paths below are relative to `konclui-work`; candidate frontend paths are relative to `play/src/front`.

Baseline: official v1.34.5, commit `38c808924267157fb3bd3f7a943de35f026e4773`. See [preflight](konclui-migration/preflight.md), [contracts](konclui-migration/contracts.md), and [handoff](konclui-migration/handoff.md). This matrix records discovery before implementation. It must grow when runtime inventory finds another active capability.

## Product capabilities

| ID | Capability and current source | Authoritative owner and native destination | Dependencies and acceptance | Baseline defect or limit | Status |
|---|---|---|---|---|---|
| U01 | Shell, panel, rail; `theme/moment-hud.js`, CSS | Room lifecycle; native Svelte shell composed with MainLayout | CurrentRoomStore; same shell for root/direct/reload/history/reconnect at 360/768/1000/1440 | Initial-path GATHER flag breaks root entry | implemented in first slice; build/runtime pending |
| U02 | Dock/profile menu; `theme/moment-hud.js` | Native ActionBar and its media/context/profile controls | U01; keyboard/touch, denied media, changing call actions, chat and small widths | Legacy moves and locates controls by DOM/text | implemented in first slice; build/runtime pending |
| U03 | Room roster/place/status/focus; `hq-office/runtime/hud.mjs`, `hud-core.mjs` | Server room membership; native room-presence projection | Stable IDs, full snapshot/diffs, concurrent joins/reconnect, windowed 1000-person list | Local roster undercount weakens broadcast pacing; convergence gaps | inventoried |
| U04 | Chat navigation/notifications; `moment-hud.js` and native chat | Existing chat stores/components | U01/U03; chat replaces panel, close restores it, unread state, history, files | Missing painted dock in historical 768px chat sweep | implemented in first slice; build/runtime pending |
| U05 | Minimap/people map/simplified map; HUD, `planta.webp`, `hud.json` | Native scene positions and Svelte map | U03/E04/E05; 8px clearance above conflicting dock, else 14px inset; select, cancel, focus return | Fixed minimap overlap corrected in dirty reference | inventoried |
| U06 | Camera follow/drag-pan/tile selection; HUD input | Phaser camera/input plus Svelte tools | E05/E06/E09; right-click and double-click movement, recenter, zoom, touch | Global events and HTML flags | inventoried |
| U07 | Device/media/language/network/PiP/settings; HUD | Existing MediaStore/MyMediaStore/settings and native preference owner | U02; real setting effects, device denial, preview track cleanup | Store bridge and duplicated presentation state | inventoried |
| U08 | Lightweight/battery/away/reduced-motion policies; HUD | Native preference and scene lifecycle | E11/U07; measured-frame trigger, seven-day restore, preserve user overrides, hidden-tab behavior | Existing policies need characterization before port | inventoried |
| U09 | Camera tiles and manual size; HUD/theme | CamerasContainer and native layout stores | Synthetic calls, join/leave, walking, resize and aspect ratio | Historical focus/contrast findings remain open | inventoried |
| U10 | Avatar/accessory/companion editor; `hud-profile.js`, woka catalogues | GameManager, ConnectionManager, localUserStore; Svelte profile | Selected assets; catalogue order, draft cancel, save/restart, lazy thumbnails | Private bridges, injected modal | inventoried |
| U11 | Live pets; `theme/pets/*.mjs`, map runtime pets | Phaser scene lifecycle, pure planner, native menus | U10/E10; atlas reuse, collision/perches/water, calm mode, native fallback and restoration | Global scene/pet bridge and polling | inventoried |
| U12 | Sitting/desks/occupancy; seating/seat-pick/social runtime and seat-core | Map entities/public scripting plus native pose/collision | E01/E02/E03; moved/deleted/off-grid chairs, front occlusion, remote pose, desk claims | Preserve edited entities, not only generated map | inventoried |
| U13 | Doors/locks/knock/privacy; interactions/social runtime, FX masks | Map rules plus engine collision/rendering | E02/U12; doors, empty unlock, locked names hidden even with FX off | Privacy must not depend on visual preferences | inventoried |
| U14 | Games/whiteboards/stage/booths/room calls; map properties/runtime | Public map APIs and media space ownership | U09; input return, per-room call IDs, silent zones and overlays | Same geographic area is not call membership | inventoried |
| U15 | Reactions/custom emotes/say-think; reactions, `emotes.js` | Native reaction/chat commands and Phaser character rendering | E08; local/remote animations, cooldown, reduced motion, attribution | Global sender/catalogue interface | inventoried |
| U16 | Spatial ambience/volume; `hud-audio.js`, social runtime, sounds | Native scene-bound audio service and settings | U07; distance curve, user activation, idle shutdown, hidden-tab fade | Global audio adapter | inventoried |
| U17 | Bell/sale notifications; `bell/`, bell runtime, `hud-sale.js` | Separate bell backend; Svelte notification UI | Public Room API; cooldown, queue10, real-sale priority, quiet areas; synthetic events only | Player events must not impersonate backend sale events | inventoried |
| U18 | Scene FX; `theme/fx/`, `hq-office/fx.py` | GameScene-owned effects, pure shaders/core | E10/U13; water/light/glass/reflections/shadows/trails/clouds/TV/iris; day/night captures and draw budgets | Existing source port only exposes scene to external FX | inventoried |
| U19 | Map editor/catalogue; taxonomy, collections, editor-edits | Native MapEditor and map-storage | E01/E02/E09; visitor editing, 21 categories, move/add/delete/save/reload | Never overwrite editor-authored state with generated defaults | inventoried |
| U20 | Help popups/focus/accessibility; dirty theme CSS and popup_fit | Native HelpSettings/popup hosts and component styles | Denied permissions, mouse/touch, narrow widths, keyboard/reduced motion | Existing 360px overflow and inconclusive contrast remain open | inventoried |
| U21 | Branding/bootstrap/fonts/logo; boot/theme/Admin API | Native bootstrap/styles; bounded Admin adapter | U01/U10; first-load branding and appropriate catalogues | HTML injection must be removed from active candidate | implemented in first slice; build/runtime pending |
| U22 | HTTP asset cache; service worker and asset-pack | Versioned static asset serving/service worker | First appearance, reuse, reload, revision update, failure fallback; WAM stays live | Map iframe scripts are outside worker control | inventoried |
| U23 | HQ map generation/selected sources | Target-owned source pipeline and generated outputs | Dependency/provenance manifest, deterministic build, no old checkout needed | HQ imports selected office/map/design/media sources | asset build verified; native runtime pending |
| U24 | WAM refresh/presence traffic optimization | Map state owner and room presence owner | HEAD-before-GET, change detection, bounded events, invalidation | Legacy presence limiter is approximate, not a global guarantee | inventoried |
| U25 | LiveKit disposal/global video budget | Native LiveKit modules | Local synthetic camera/screenshare calls; no leaked listeners or >budget video subscriptions | Existing runtime proof does not certify native group calls | inventoried |

## Engine patch registry

Registry source: `local-wa/hot-reload/server.mjs`, lines 106-119. All 12 source ports exist in reference native commit `9b6e842`; reuse is subject to native adapter replacement and runtime validation.

| ID | Gateway patch | Native source owner | Acceptance | Obsolete behavior to retire | Status |
|---|---|---|---|---|---|
| E01 | editor-placement | Phaser/Game/MapEditor/EditorPlacement.ts; Utils/PathfindingManager.ts | Existing focused tests plus editing/pathfinding costs 0/4/5 | Bundle rewriting | implemented; tests/runtime pending |
| E02 | thin-walls | Phaser/Game/ThinWallsController.ts; GameScene | Native controller tests plus edited-door/wall traversal | Bundle rewriting | implemented; tests/runtime pending |
| E03 | seated-pose | Phaser/Game/SeatedPoseController.ts | Pose tests plus local/remote sitting and standing | Bundle rewriting | implemented; tests/runtime pending |
| E04 | game-inset | Stores/KoncluiViewportStore.ts; CoWebsiteStore; KoncluiFrame | Canvas/camera bounds follow shell and chat at all widths | DOM-derived layout adapter where native geometry exists | implemented; build/runtime pending |
| E05 | tile-click | Phaser/Game/TileInteractionController.ts | Single selects, double/right-click moves, cancellation | Window events and HTML flags | inventoried |
| E06 | tile-hover | Same controller | Camera-aware tile/desk projection | Window events | inventoried |
| E07 | anim-in-view | Phaser/Game/TileAnimationRefreshTracker.ts | Visible tile-frame changes, GPU layers, hidden animations | Bundle rewriting | implemented; tests/runtime pending |
| E08 | custom-emotes | Phaser/Entity/CustomEmotes.ts; Character | Remote compatibility, texture reuse and lifecycle | Window catalogue/sender | inventoried |
| E09 | explore-click | Phaser/Game/MapEditor/Tools/ExploreClickGuard.ts | Click inspection vs real drag/glide | Bundle rewriting | inventoried |
| E10 | scene-fx | Phaser/Game/SceneFx.ts; GameScene | U18 effects and scene teardown | __kScene/__kFx globals | inventoried |
| E11 | frame-cap | Phaser/Game/FrameCap.ts; Game.ts | Frame skipping preserves movement time and restores rate | HTML observer/polling adapter | inventoried |
| E12 | wa-bridge | NativeWaBridge/WaBridge | Every native consumer imports actual owner | Delete bridge registration and window-store exposure | inventoried |

## Independent services

| Service | Contract and consumers | Acceptance | Status |
|---|---|---|---|
| Admin API or compatible LocalAdmin | map/access/sameWorld/tags/members/woka/companion/capabilities and save acknowledgements; pusher/profile | Branding/catalogues/visitor access; unavailable states; do not route uploader fileSize calls to an absent endpoint | inventoried |
| Bell | Read-only sales source to Room API events; manual bell has sender/cooldown semantics | Synthetic local events and queue correctness; no production sales actions | inventoried |
| LiveKit/TURN | Media publication/subscription and relay | Synthetic local media and reconnect; media loss counters | inventoried |
| Back/pusher/Redis | Protocol state, room membership, spatial subscriptions | Generated hash parity; concurrent movement/join/leave/reconnect | inventoried |
| Map-storage | Editor state persistence, map assets, gRPC | Editor mutations survive restart; no source-map overwrite | inventoried |
| Uploader | File transfer and authorization boundary | Chat attachment round trip and declared size limit | inventoried |

## Verification gates

- Baseline runtime and live cache/movement proof: open.
- Native first slice and all product rows: open.
- Reference-to-candidate visual parity and independent review: open.
- Equivalent production-build performance comparison and 1000-client scale: open.
- Local release package and rollback inputs: open. PR/review/merge are now authorized; implementation and verification gates remain open.

Detailed source characterization for U05–U11, U15, and U18 is in [UI contracts](konclui-migration/ui-contracts.md). In the inspected source, simplified rendering uses a 5 fps cap, custom emotes use Unicode-tag encoding, and mixed battery/slow restoration remains unverified. These observations do not close their runtime gates.

Current execution (2026-11-12 09:28 Europe/Rome): the external jobs have not returned evidence. A bounded local retry built the pinned A frontend successfully (1,178 files; generated protocol f4cfe455). The isolated baseline services are starting; first HTTP request returned 404 before readiness. C checks/build and the full asset rebuild are active. Browser and first-slice acceptance remain open.
