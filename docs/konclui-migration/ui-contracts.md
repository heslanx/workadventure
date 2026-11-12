# Native UI boundary characterization

This document characterizes source behavior for five migration boundaries. It does not certify runtime behavior or mark a migration item complete. The [migration matrix](../migration-matrix.md) owns status. The [boundary contracts](contracts.md) own room generations, roster identity, media ownership, live map state, and shared lifecycle rules. The [asset record](assets.md) owns provenance and generated resource paths.

Reference paths below are relative to the read-only `konclui-work` checkout. Native paths are relative to `play/src/front/`. Source observations describe the files inspected on 2026-11-12. Native requirements are acceptance conditions, not claims that their implementation exists. UI appearance, widths, input modes, and independent review follow the [project guide](README.md#product-verification).

## Profile, accessories, and companions

Matrix items U10 and U11 depend on U07, U21, and U23.

### Source behavior and owners

`theme/hud-profile.js` constructs the legacy editor. Its `avatarEditor` reads `gameManager.loadWokaData()` and `/resources/konclui/accessories.json`. Catalogue collection order determines the tabs and options. Texture IDs identify selections; labels do not. `areCharacterTexturesValid`, `GameManager`, `ConnectionManager`, and `localUserStore` own validation and persistence.

The accessory document supplies the empty texture ID and the piece-to-group mapping. The editor keeps at most one selected piece per group and writes accessories in catalogue order. Missing accessory metadata falls back to the existing single-accessory behavior. An unknown saved texture falls back to the starting selection; the native UI must distinguish this displayed fallback from a successful save.

The companion editor requests `companion/list` with the current room URL and supports no companion. A companion absent from the current catalogue appears as no selection without immediately replacing the saved value. Pet names belong to the pet runtime, not to the avatar texture list. The map adapter publishes the name through the public `officePet` player variable. Name-only edits do not restart the scene.

### Boundary

| Aspect | Contract |
|---|---|
| Inputs | Room identity, current saved texture IDs, current companion ID or no companion, authoritative catalogues, accessory groups, and optional pet-name capability. |
| Outputs | A validated texture selection, a companion selection, or a pet-name change through their native owners. A successful texture or companion change requests one scene restart. |
| Identifiers | Preserve catalogue texture IDs and companion IDs. Accessory group IDs enforce exclusivity. Account/player identity is separate from these resource IDs. |
| State | Closed, loading, editable draft, saving, failed, and saved. Reopening reads current native saved state. Cancel discards the draft. |
| Invalid or unavailable | Catalogue failure exposes retry/unavailable state. An invalid combination cannot save. Missing pet capability does not expose a nonfunctional name control. |
| Native destination | Svelte profile content composed with the native menu/settings; reuse `Phaser/Login/SelectCharacterScene.ts`, `SelectCompanionScene.ts`, `GameManager`, and `Connection/LocalUserStore.ts` behavior without switching to hidden scenes or clicking hidden controls. |

The legacy save path updates local selection before awaiting the remote save. A failed request displays an error but does not establish atomic rollback. The native implementation must reconcile against the owning saved state and keep retry possible; it must not claim that failure left all persistence unchanged without evidence.

Initialization loads only the active editor and treats asynchronous results as room-bound. Closing cancels pending view updates and disconnects thumbnail observers. Thumbnail loading may use IntersectionObserver because visibility is a browser boundary. Destroying the editor removes keyboard handlers and does not release shared engine textures. A successful save must not restart twice when the user presses Save again while the first request is pending.

Acceptance evidence must show catalogue parity, lazy loading, keyboard navigation without moving the player, draft cancellation, two accessory groups in the saved order, invalid combinations, unavailable catalogues, save failure/retry, no companion, pet-name validation, and exactly one restart after a successful resource change. The rendered player and reopened editor must agree with saved IDs. Reference `hq-office/qa_hud.py` case `profile` provides existing runtime scenarios; it does not certify this port.

## Map selection, minimap, and navigation

Matrix items U05 and U06 depend on U03, E04, E05, E06, and E09. [Room roster, viewport, and call](contracts.md#room-roster-viewport-and-call) owns membership and offscreen-location limitations.

### Source behavior and owners

`theme/moment-hud.js` owns the legacy people map, simplified map, tile selection, and tool presentation. `hq-office/runtime/hud.mjs` translates `walk`, `walk-cancel`, and `goto-desk` intents into map API calls. Its walk operation uses a token so a replaced request cannot announce arrival for the current walk. The scene owns collision, pathfinding, world coordinates, camera follow, and zoom.

`measureBar` measures the painted dock and minimap. Horizontal conflict reserves at least 8 pixels above the dock; without conflict the bottom inset remains 14 pixels. The map view closes with Escape and returns focus to its opener. The simplified plan uses named map areas and stable desk/entity IDs. A person's display name is never a navigation identifier.

### Boundary

| Aspect | Contract |
|---|---|
| Inputs | Current room/scene generation, viewport rectangle, camera transform, finite world coordinates, current spatial player positions, named map areas, desk entities, and roster availability. |
| Outputs | Tile selection, camera pan/zoom/recenter, or a native walk request. Walk results distinguish going, arrived, cancelled, and blocked. |
| Identifiers | Native session/player ID for a person, entity ID for a desk, room generation for all asynchronous requests. World pixels remain distinct from viewport pixels and tile indices. |
| State | Map closed/open; camera following/exploring; selection absent/present; walk idle/going/arrived/cancelled/blocked. These states do not redefine membership. |
| Invalid or unavailable | A missing/offscreen coordinate is unavailable, not zero. An unreachable destination reports blocked. A disappeared person or desk invalidates its target without moving to a stale room. |
| Native destination | Svelte map/tools in `Components/Konclui/`; native geometry from `Stores/KoncluiViewportStore.ts`; Phaser input, camera, and pathfinding in `GameScene` and the E05/E06 controller. |

Single-click selection, double-click movement, right-click movement, and drag-pan remain distinct actions. Dragging the camera must not issue a walk. Walking or recentering restores camera follow. A real touch event needs its own proof; a mouse test does not certify the native joystick.

Mount binds to the current scene and geometry once. ResizeObserver is appropriate for the painted dock's actual bounds; replacing a dock unobserves the old element. Teardown cancels a pending walk owned by this view, removes input and resize listeners, and prevents old projections from writing into the next room. It does not stop unrelated native navigation.

Acceptance evidence must cover root/direct entry, map open/close with focus return, selection after zoom/pan, blocked/cancelled/replaced walks, moving targets, desk deletion, and panel/chat/control changes at all required widths. At 768 pixels the minimap must not cover the painted dock or avatar, including reduced motion. Reference `tests/test_moment_hud_layout.py` characterizes clearance. Offscreen markers remain an open design dependency because native world membership has no coordinates; adding room-wide per-tick movement is prohibited.

## Media and lightweight preferences

Matrix items U07, U08, and U09 depend on E11. [Media and economy](contracts.md#media-and-economy) owns track release, user overrides, and remote-video budget rules. This section adds the observed preference policy.

### Source behavior and owners

`theme/moment-hud.js` contains `lightMedia`, `applyPower`, `watchFrames`, and `watchPower`. Native owners are `Stores/MediaStore.ts`, `Stores/NoiseSuppressionStore.ts`, `Stores/MyMediaStore.ts`, `Connection/LocalUserStore.ts`, and `Components/EmbedScreens/CamerasContainer.svelte`. The bridge names are adapters, not a second source of truth.

The inspected `applyPower` source caps the hidden or simplified canvas at 5 frames per second. Economy or a visible window without focus caps at 20. When several reasons apply, the lowest cap wins. This differs from the older documentation's 8-frame simplified-mode value. Source behavior is the characterization baseline; a different native value requires an explicit decision and movement-time proof.

The slow detector waits 20 seconds, samples a 12-second window, and triggers when at least half the measured intervals exceed 45 milliseconds. It excludes capped/background periods, resets a window after a gap over 1000 milliseconds, and bypasses automated browsers. Saved on/off decisions expire after seven days. Tests need an explicit detector seam rather than treating the automation bypass as a passing slow-device scenario.

### Boundary

| Aspect | Contract |
|---|---|
| Inputs | Native device and quality preferences, actual track/connection state, battery availability/state, document visibility/focus, reduced-motion preference, measured foreground frame intervals, and explicit user overrides. |
| Outputs | Native preference actions, an effective scene frame cap, effect-motion policy, and an accessible reason/restoration notice. Device intent is distinct from actual acquired media. |
| Identifiers | Existing device IDs and storage keys remain owned by native stores. Economy adjustments record the previous value and the override they applied. |
| State | User mode, economy reason, background reason, detector state, and media acquisition state remain distinguishable. Clearing one reason cannot clear another still-active constraint. |
| Invalid or unavailable | Missing Battery API leaves that input unavailable. Storage denial permits a session-only choice. Permission denial or device removal uses native errors and retry. A failed media preview must not falsely show active capture. |
| Native destination | Native settings controls and stores; scene-owned E11 frame policy; Svelte notice/settings presentation. No `window.__kWa` access or hidden-control invocation. |

The legacy economy adapter saves prior video/noise preferences, selects low video quality, and disables WA noise suppression. On exit it restores only while values still equal its applied override. Equality alone cannot detect a user's deliberate choice of the same value; native preference ownership must make that case explicit. Existing measurements also show that video quality may take effect on the next conversation, so a changed preference is not proof that the current encoder changed.

The inspected restoration callback clears the slow detector only for a slow notice. A battery notice sets a battery-restored flag. Whether restoring under both conditions should suppress the later slow notice needs a regression experiment; the prose record is broader than this source branch. No universal restore fix is certified here.

Opening a preview may reuse engine tracks. Only an exclusively acquired preview stream is stopped when its section closes. Initialization and teardown own frame callbacks, focus timers, battery listeners, device listeners, and asynchronous captures. A capture resolved after close releases its exclusive tracks instead of attaching to the closed view. An absent room cancels room-specific economy work without rewriting persistent user settings.

Acceptance covers denied devices, device changes, preview close during acquisition, call leave/reconnect, user overrides during economy, mixed economy reasons, hidden/focus transitions, saved-decision expiry, and restored movement speed under a cap. Camera tile acceptance includes manual shrinking while walking and reset at conversation end. Runtime synthetic-media evidence must identify the quality actually encoded and received; a local preference assertion alone does not pass it.

## Emotes

Matrix item U15 depends on E08. The asset manifest owns the selected Kenney art and notices.

### Source behavior and owners

`theme/emotes.js` is generated by `office/sources/emotes/build_emotes.py` and supplies IDs, slash commands, labels, and PNG data. Its introductory transport comment is stale. `local-wa/hot-reload/custom-emotes.mjs` implements the active wire encoding because the server rejects the literal `:k-id:` string.

The wire value is the speech-balloon emoji followed by `k` plus the allowlisted ID encoded as Unicode tag characters, then a cancel tag. A client without the custom renderer displays the speech balloon. `:k-id:` remains a local adapter input. `back/src/Services/EmoteValidator.ts` and `Stores/EmoteStore.ts` remain authoritative for accepted payloads and native submission. An arbitrary image URL received from another user is never an emote asset.

### Boundary

| Aspect | Contract |
|---|---|
| Inputs | A selected catalogue ID or recognized chat command, native permission/rate state, and a native received emote payload associated with a player. |
| Outputs | One native emote submission and the corresponding local/remote character presentation. Existing emoji behavior remains available. |
| Identifiers | Catalogue ID selects art. Player/session identity selects the character. Texture keys reuse the same decoded art across characters. |
| State | Idle, loading an allowlisted texture, displaying, replaced, and destroyed. A replaced pending load cannot display an older emote. |
| Invalid or unavailable | Unknown IDs do not load external art. Native validation remains active. Texture failure uses the established native emoji fallback without an unhandled rejection. |
| Native destination | `Stores/EmoteStore.ts`, native reaction menu/chat command ownership, `Phaser/Entity/Character.ts`, and E08 `CustomEmotes.ts`. The exact command-registration owner remains to be verified during implementation. |

The legacy patch coalesces an in-flight texture load by key and uses a character token to reject stale completion. Native lifecycle must preserve those guarantees while removing the window catalogue/sender registration. Scene teardown removes load callbacks and character teardown removes emote display/tweens. The renderer does not acquire a new room-wide position stream.

Acceptance uses two local clients to prove that menu and slash-command submission produce the same remote emote and native fallback. Repeated/shared emotes reuse the texture. Replacement during load, player departure, room restart, unsupported payload, failed texture, native emoji, keyboard access, and reduced motion need observable results. A local `playEmote` call alone cannot certify transport.

## Scene effects

Matrix item U18 depends on E10 and U13. [Map rules and engine behavior](contracts.md#map-rules-and-engine-behavior) owns privacy independently of effect preferences.

### Source behavior and owners

`hq-office/fx.py` generates `fx/manifest.json` and images. `theme/fx/fx.mjs`, `core.mjs`, and `shaders.mjs` consume that data. The manifest describes geometry, masks, static lights, sprite-light rules, room rectangles, water, and TV assets. The legacy adapter obtains the GameScene through `window.__kScene` and publishes configuration through `window.__kFx`.

The effects include water, time-of-day lighting, glass, locked-room appearance, floor/glass reflections, shadows, grass trails, clouds, meeting TV, focus vignette, and arrival iris. The owning reference descriptions are in `hq-office/README.md` under "Shaders". This list does not imply every effect needs its own service or store.

### Boundary

| Aspect | Contract |
|---|---|
| Inputs | Active GameScene generation, scene-relative FX manifest/images, native camera and entity state, map mutations, lock/privacy state, focus state, effect preferences, motion policy, and clock. |
| Outputs | Scene-owned shader objects, render textures, postprocessing, and TV images. Preference changes update existing scene objects and persist through the preference owner. |
| Identifiers | Manifest keys and placed entity IDs retain their asset/map meanings. Sprite texture keys determine light/reflection data. No display-name identity is introduced. |
| State | Disabled, unavailable for this room/renderer, loading, active, failed, and disposed. A scene replacement invalidates pending loads. |
| Invalid or unavailable | Missing manifest means the room has no FX. Fetch/decode/compile failure preserves the usable base scene and reports the failure. Unsupported WebGL does not produce a black map. Malformed data needs boundary validation before shader construction. |
| Native destination | GameScene-owned E10 lifecycle and Phaser effect implementation, pure core/shader modules, and native Svelte preference controls. No scene globals, DOM focus flags, or injected module fallback. |

`attach` already uses a generation check and tests scene activity before constructing effects. Native teardown must release owned textures, render targets, scene callbacks, and preference subscriptions. Shared map/player textures remain owned by Phaser. Source code that reads `html.dataset.kmhFocus` must consume the native focus state instead. Dynamic room occupancy used for TV appearance remains a visual map condition and cannot be reused as call membership.

The legacy design avoids an independent timer that redraws every idle frame. Animated effects follow scene invalidation and visible animation cadence; static data recomputes on relevant map/state changes. The native implementation must preserve those bounds and measure its result. A copied shader file or exported FX manifest is not runtime proof.

Acceptance covers map entry/reentry, missing/malformed manifest, compile failure, preference changes, reduced motion/economy, editor mutations, local/remote people and pets in reflections, locked-room names with effects disabled, and day/night captures. Scene objects and listeners must return to their expected count after repeated transitions. GPU draw counters and idle redraw counts follow the existing `hq-office/perf.py` scenarios, with raw receipts and independent visual review before any performance or parity claim.
