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
| Native destination | Svelte map/tools in `play/src/front/Konclui/<Domain>/components/`; native geometry from `gameViewportBounds` in `ExternalModule/ClientExtensionPoints.ts` (the map's cell: the side panel floats over it and is not subtracted) and, for the strip that panel covers, `gameViewportCoveredStart` in the same file; Phaser input, camera, and pathfinding in `GameScene` and the E05/E06 controller. |

Single-click selection, double-click movement, right-click movement, and drag-pan remain distinct actions. Dragging the camera must not issue a walk. Walking or recentering restores camera follow. A real touch event needs its own proof; a mouse test does not certify the native joystick.

Mount binds to the current scene and geometry once. ResizeObserver is appropriate for the painted dock's actual bounds; replacing a dock unobserves the old element. Teardown cancels a pending walk owned by this view, removes input and resize listeners, and prevents old projections from writing into the next room. It does not stop unrelated native navigation.

Acceptance evidence must cover root/direct entry, map open/close with focus return, selection after zoom/pan, blocked/cancelled/replaced walks, moving targets, desk deletion, and panel/chat/control changes at all required widths. At 768 pixels the minimap must not cover the painted dock or avatar, including reduced motion. From 768 pixels the side panel floats over the map's start edge (see [Motion of surfaces over the map](#motion-of-surfaces-over-the-map)), so the minimap must also stay clear of the strip it covers. Reference `tests/test_moment_hud_layout.py` characterizes clearance. Offscreen markers remain an open design dependency because native world membership has no coordinates; adding room-wide per-tick movement is prohibited.

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

## Menus and controls over the map

Every menu, popover, and control that floats over the map follows the bottom dock and the office menu. The utilities in `libs/tailwind/style/konclui.css` are the single source of these values. Upstream and Konclui markup applies them as plain classes, as with `.k-chrome`. `Konclui/OfficeMenu/components/OfficeMenu.svelte` takes its edge from them (`.k-chrome rounded-lg p-1.5`) and its rows from `Konclui/Controls/components/MenuRow.svelte` (`.k-menu-row`); its scoped styles keep what is its own: its place, its size, its entrance origin, the locked-status reason inside the list and the copied-link notice under it. The press, the hover pill and the entrance of these surfaces are in [Motion of surfaces over the map](#motion-of-surfaces-over-the-map).

| Aspect | Standard | Utility |
|---|---|---|
| Edge | The surface is `.k-chrome` with radius `var(--k-radius-surface)` (16 px) and 6 px padding, the dock's padding. Nothing touches the rim. | `.k-chrome rounded-lg p-1.5` |
| Row | Minimum height 44 px, 12 px inline padding, 12 px between the icon and the label, 2 px between rows, radius `var(--k-radius-inner)`. Text is 14 px/600 in `--k-fg-2`; hover fills `--k-hover` and turns the text `--k-fg`. A checked or current row is `--k-accent`. The focus ring is 2 px `--k-accent`, inside the row. A row that cannot act keeps `aria-disabled`, the focus, and 60% opacity. | `.k-menu-row`, `.k-menu-label` (one line, ellipsis), `.k-menu-mark` (18 px trailing mark); rows sit in a `flex flex-col gap-0.5` group |
| Lead icon | Every row has an 18x18 lead slot, empty when its icon cannot be known, so the labels align. The icon is a Tabler outline glyph from `Components/Icons.ts` at Tabler's own stroke, sized by the slot, never by `font-size`, never a `-filled` variant. A picture keeps its proportions in the slot. | `.k-menu-lead` |
| Group | The title is 12 px/600 in `--k-fg-muted`, sentence case. Groups are separated by 6 px, a 1 px `--k-border-subtle` rule, and 6 px. | `.k-menu-title`, `.k-divider` |
| Scroll | An inner scroller, never the chrome surface: a 4 px `--k-border-strong` thumb on a transparent track, and contained overscroll. A 24 px fade marks an end only while content is hidden past it. It needs scroll-driven animations, so a browser without them shows no fade. Nothing fades when nothing scrolls, and more contrast drops the fade. A chip row scrolls sideways with no scrollbar. | `.k-scroll-y`, `.k-scroll-x` |
| Control box | 36x36 with an 18 px glyph, radius `var(--k-radius-control)`, and 6 px between controls. Hover fills `--k-hover`. The selected control (`aria-pressed="true"`) is the dock's mint fill with `--k-on-accent` ink. Under forced colours a 2 px `Highlight` outline carries that state. Below 768 px wide, the hit area grows to 42x44 in a row and to 44x42 in a column, so two controls 6 px apart never share a hit pixel. | `.k-control`, in a `gap-1.5` row or a `gap-1.5` column marked `.k-control-column` |

`.scrollable-content` in `play/src/front/style/style.css` takes the same scrollbar values for its two media popover users.

`--k-radius-control` (10 px) exists under UI-02: the dock's controls and the rail repeated a 10 px literal. No radius token expressed it, because it lies between `--k-radius-inner` (8 px) and `--k-radius-menu` (12 px), and every control sized like the dock needs the same value.

## Motion of surfaces over the map

Owner: `libs/tailwind/style/konclui.css` (the tokens and the utilities) and `play/src/front/Utils/` (`spring.ts`,
`surfaceTransition.ts`, `glide.ts`, `floatingUiSurface.ts`). Benefit named (MOT-01): orientation and continuity. A panel
or menu that appears in one frame gives no hint of where it came from, and one that vanishes in one frame gives no hint
of where it went; a short move from its origin, and a shorter one back toward it, does. Under the side panel the canvas
is not resized, so the picture keeps its size and its zoom while the panel comes and goes; the camera glides the view to
the part of the map the card leaves free.

This section describes the code at `526dd5400`, `568d0c735` and `916b78bca` (2026-11-24). The tests named under
"Verification" run in jsdom. After the lanes, the integrator ran the play checks on the tree that was then committed (`.local/konclui/bin/wa-playgate-remote.sh`, on the build host, 2026-11-24): i18n, typecheck, `svelte-check`, eslint and prettier on the 69 changed files all exited 0, and Vitest passed 546 files and 5,598 tests with 14 skipped. The measurements come from one browser probe the integrator ran that day.

### Override of MOT-02, 2026-11-24

- **What this contract said before.** MOT-02 meant one entrance with one owner, `.k-enter`, on the durations
  `--k-dur-fast` (150 ms) and `--k-dur-settle` (280 ms), and every exit was instant.
- **What the owner decided.** On 2026-11-24 the owner asked that every sheet, menu and popover open and close with the
  feel of three React and framer-motion examples he supplied: springs of stiffness 420, damping 32 and mass 0.6, and of
  350, 25 and 1; an entry scale of 0.98; a press scale; a highlight that slides from row to row; and height
  disclosures with a turning chevron. His numbers are the contract. That departs from MOT-02 of the motion policy,
  which says not to take another product's numeric presets: the owner chose it, and this paragraph is the record.
- **Two deliberate differences from his examples.** Each surface keeps its own origin (the side panel comes from the
  rail, the office menu from the logo, a popup from its trigger), where the examples make every surface rise 10 px. The
  theme keeps two springs, where the examples used four.
- **What stays of MOT-02.** One owner per transition. `.k-enter` owns an entrance that is CSS alone (today only the map
  explorer). `transition:surface` owns every surface that an `{#if}` removes, entrance and exit. A surface never
  carries both.

### The springs and the tokens

- **Two springs.**
  - `--k-ease-spring` over `--k-dur-spring` (290 ms): stiffness 420, damping 32, mass 0.6. It is for a surface that
    opens over the map, a disclosure and the sliding pill. Damping is just above critical (1.008), so it settles
    without bouncing.
  - `--k-ease-spring-turn` over `--k-dur-spring-turn` (360 ms): stiffness 350, damping 25, mass 1. It is for a mark
    that turns, a chevron. It is the one place a spring overshoots, by about 5 % of the turn: the generated curve peaks
    at 1.0526 (the point at 61.2 % in `konclui.css`). The comment above `.k-turn` in `konclui.css` and `SPRING_TURN` in
    `spring.ts` say 6 %, which is the overshoot of the spring before `springEasing` divides it by where the spring is at
    360 ms.
  - Each duration is within 10 ms of the time its spring takes to come within 0.5 % of its travel (286 ms and 365 ms,
    `settleMs` in `spring.ts`).
- **Generated, not typed.** `linearCss` in `play/src/front/Utils/spring.ts` samples the closed-form spring 4,000 times,
  divides it by where the spring is at the end of the duration so that it lands exactly on 1, and keeps the points that
  a straight line would miss by more than 0.2 % of the travel. The result is about twenty points, inputs to 0.1 % and
  outputs to four decimals. The stylesheet holds the text it produced.
  `tests/front/Style/KoncluiMotionTokens.test.ts` compares each token's `linear()` text with the generator's output and
  fails when only one of them is edited. To change a spring, change it in `spring.ts`, regenerate the text, and change
  the duration constant (`SPRING_SURFACE_MS`, `SPRING_TURN_MS`) and the token together. The same test pins the JS
  constants to the CSS tokens.
- **Fallback.** Chrome and Edge 111 to 112 and Safari 16.4 to 17.1 do not know `linear()` and would drop the whole
  `transition` that uses a spring token (the comment in `konclui.css`). Inside
  `@supports not (transition-timing-function: linear(0, 1))` the two tokens hold a cubic-bezier that follows the same
  spring within 0.9 % (surface) and 1.9 % (turn) of the travel. `transition:surface` does not use the token: it runs
  the spring as a JS easing function from `spring.ts`.
- **`--k-motion-scale`.** It is 1 on the root. `transition:surface` reads it from its element and multiplies both of its
  durations by it, so `document.documentElement.style.setProperty("--k-motion-scale", "10")` slows every surface ten
  times for a look frame by frame, and 0 makes it instant. A value that is not a number counts as 1, a negative value
  as 0. The CSS utilities (press, lift, turn, disclosure, pill) do not read it. Reduced motion needs no value: that
  transition is instant for that viewer.
- **Reduced motion (MOT-04).** Every `--k-dur-*` token, the two new ones included, is 0.01 ms under
  `prefers-reduced-motion: reduce`. Each utility and `transition:surface` has its own rule below.

### transition:surface

- **Where it is written.** `surface` in `play/src/front/Utils/surfaceTransition.ts`. The directive sits on the element
  directly under the `{#if}`, never as an `in:` and `out:` pair (a pair cannot be reversed half way) and never together
  with `.k-enter` (the surface would arrive twice). It is local: it plays when its own block changes and not when a
  parent block appears, so nothing springs in at room entry while the loader fades.
- **What it reads from the element.** `--k-enter-x` and `--k-enter-y` in pixels and `--k-enter-scale` as a number, with
  the defaults of `.k-enter`: 0 px, 6 px and 0.98 (a value written as a `calc()` or in `rem` is not read, and the
  default stands). A parameter object `{ x, y, scale }` overrides them. It also reads `direction` (on a page that reads
  right to left, x changes sign), `--k-motion-scale`, and the element's own `opacity`.
- **Entrance.** 290 ms (`SPRING_SURFACE_MS`) on the surface spring: opacity from 0 to the resting opacity, translation
  from the origin to 0, scale from the origin's to 1.
- **Exit.** 200 ms (`SURFACE_EXIT_MS`, the value of `--k-dur-normal`) on the curve of `--k-ease-sheet`,
  `cubic-bezier(0.22, 1, 0.36, 1)`. The surface goes half as far as it came (`SURFACE_EXIT_TRAVEL`): 6 px become 3,
  24 px become 12, and the scale ends at 0.99. A dismissed surface has been seen, so it needs the cue that says where it
  goes and not the whole distance; the curve starts fast, and opacity does the leaving. A test keeps the exit's length
  and curve equal to the two tokens.
- **Held content.** Svelte keeps the element in the page for the whole exit, with what is inside it frozen (read in
  Svelte 5.59.1 by the review of the lane that wrote it). A card whose content an inner `{#if}` would remove does not
  slide away blank.
- **Reversal half way.** Opening during an exit keeps the same element and plays the rest of the entrance from where it
  is, and the other way round. The exit does not go as far as the entrance came, so `surface` starts each run from the
  pose the last run had reached, and the picture does not jump. Measured on the side panel: reopened 90 ms into an
  exit, it continued from opacity 0.08 and x of -11.1 px over 268 ms.
- **Inert during the exit.** Svelte sets `inert` on a leaving element. It takes no focus and no press, and it leaves
  the accessibility tree at once. The owners of the surfaces hand the focus on before the exit starts: the office menu
  and the dialog to the control that opened them, the side panel to its button on the rail, a map tool to the next
  tool. A press on a surface that is still painted falls through to what is under it, which is the map (T-304).
- **Reduced motion and no animation.** The duration is 0 where `prefers-reduced-motion: reduce` matches, read as each
  run starts, and where the browser has no `Element.animate` (jsdom). Svelte then removes the element in the same
  flush, with no animation and no event, so nothing waits for `animationend`.
- **Rest opacity.** Opacity runs between 0 and the opacity the element rests at, not between 0 and 1. A map tool that
  cannot act now rests at 0.5: it arrives at 0.5, leaves from 0.5 and does not jump when the run ends. The integrator
  fixed this on 2026-11-24 after the review of the surfaces lane found it, and `surfaceTransition.test.ts` pins it.
- Only `opacity` and `transform` move, so the map is not re-fitted frame by frame. Svelte samples the keyframes at
  60 Hz whatever the display (T-316).
- **Popups of the shared floating host.** `Components/Util/FloatingUiPopupList.svelte` carries one
  `transition:popupSurface={value}` on the wrapper of each popup. `popupSurface` in `Utils/floatingUiSurface.ts` gives
  `surface` to an entry that `showFloatingUi` registered with its last parameter, `motion`, set to true, and a
  transition of 0 ms to every other entry, so a tooltip is gone as it closes and does not spring in each time the
  pointer crosses a reaction. After Floating UI settles the placement, `showFloatingUi` writes the `transform-origin`
  from the placement it settled on, flip and right-to-left included (`popupTransformOrigin`). The callers that pass
  `motion` are the profile menu, the recording, lock and raise-hand pickers and the favourites emoji picker.

### Where each one comes from

Each row that names `transition:surface` or `transition:popupSurface` enters on the surface spring over 290 ms and
leaves over 200 ms at half the travel, as above. The last two rows are the exceptions.

| Surface | From | Written in |
| --- | --- | --- |
| People/chat panel, wide (768 px and up) | 24 px left, from the rail | `transition:surface` on the card in `Konclui/Shell/components/Frame.svelte`, `--k-enter-x: -24px` |
| People/chat panel, phone (767 px and down) | 16 px below, a sheet over the map | the same card, `--k-enter-y: 16px` in the phone rule |
| Office menu | 6 px left, from the logo | `Konclui/OfficeMenu/components/OfficeMenu.svelte`, `--k-enter-x: -6px` |
| Profile menu (dock avatar), recording, lock and raise-hand pickers, favourites emoji picker | 6 px below, growing from the side that faces the trigger | `transition:popupSurface` in the floating host, `motion` set by each caller |
| Reactions menu (the emoji bar), apps menu | 6 px below, from the bottom left corner | `EmojiSubMenu.svelte` and `AppsMenuItem.svelte`, `transition:surface` and `origin-bottom-left` (T-308) |
| Camera and microphone popover | 6 px below, from the bottom centre | `MediaSettingsList.svelte`, `transition:surface`; the origin is in `Konclui/Shell/components/Dock.svelte` |
| Preferences dialog | 6 px below | `PreferencesDialog.svelte`, `transition:surface` on the box (it was 0.95 over 300 ms) |
| Preferences dimming | a fade, no travel and no scale | `transition:surface={{ x: 0, y: 0, scale: 1 }}` on `.k-prefs-dim`; the scrim around it has none |
| Call chip, focus chip, place chip | 6 px below | `CallIndicator.svelte`, `FocusChip.svelte`, `PlaceChip.svelte` |
| Tools of the map column that come and go | 6 px below | `MapToolButton.svelte`, on the button itself |
| People/chat content when the card swaps its view | a fade of 150 ms on `--k-ease-out-expo`, opacity only | `in:swap` on `.content` in `Frame.svelte`; it plays on a swap and not when the card opens |
| Map explorer | 16 px right, 200 ms (`--k-dur-normal`), no exit | `.k-enter` in `Components/Exploration/Explorer.svelte` (T-310) |

- **Still on `.k-enter`.** Only the map explorer. `.k-enter` now starts at the scale `--k-enter-scale` (0.98) too.
- **Still on nothing.** The surfaces left out on purpose: the in-call video grid, the loader, the onboarding overlay,
  the desktop mini window, the co-website tabs, the phone message sheet, the native `<select>` and the camera's own pan
  easing (T-311). The chat's chevrons and section bodies are on their old motion (T-309). Every other caller of
  `showFloatingUi` (the invite item, the video box, the chat's pickers and menus, the reaction tooltips) passes no
  `motion` and appears and goes at once.

### The side panel over the map

- **It floats from 768 px up and is a sheet on a phone.** `.konclui` has two grid columns, the rail and the map's cell,
  whether the panel is open or not. From 768 px the card is `position: absolute` beside the rail: 6 px from the top and
  the bottom (`--frame-gap`), 60 px from the start edge (`--rail-width`), 290 px wide (`--panel-width`, 296 px, less
  the gap), over the canvas. At 767 px and below the frame is a block and the card is a sheet over the map: 58 px from
  the top, 8 px from each side, standing 6 px above the whole dock stack, 144 px high at least, at `z-index` 35.
- **The canvas is not resized by it** (the co-website case is below). The bounds that `Frame.svelte` publishes as `gameViewportBounds` are the map
  cell's, and they are the same with the panel open, closed, leaving and open again. The panel is not subtracted from
  them. A third grid column exists only beside a co-website (below).
- **The grid column never animates.** Measured 2026-11-20 on the QA stack: animating `grid-template-columns` re-fitted
  the canvas 13 times per open and the map was black mid-transition. `KoncluiEntrance.test.ts` guards that no rule
  transitions or animates the grid columns, and `Frame.test.ts` that the panel changes no grid column.
- **Measured before and after, 2026-11-24.** In the owner's pane, 1057 by 1005 px, opening the panel used to take the
  canvas from 661 by 662 buffer pixels at 1.4992 CSS px per buffer pixel to 695 by 993 at 1.0: the zoom step fell from
  1.5 to 1.0 and the drawing buffer grew by 58 % (`s0-evidence.md`, device pixel ratio 1). With the change, the
  acceptance probe read the same canvas with the panel closed and open, with 0 resizes over an open and a close
  (`acceptance.md`, device pixel ratio 2 in the pane that day). Canvas as buffer size, then CSS size, then offset from
  the left:

  | Window | Canvas, panel closed and open | Resizes | Card |
  | --- | --- | --- | --- |
  | 1057x1005 | 661x662 at 991x993, 60 px | 0 | 290x993 at x 60, z-index 5 |
  | 1440x900 | 916x592 at 1374x888, 60 px | 0 | 290x888 at x 60 |
  | 1000x900 | 623x592 at 934x888, 60 px | 0 | 290x888 at x 60 |
  | 768x900 | 702x888 at 702x888, 60 px | 0 | 290x888 at x 60 |
  | 360x800, phone sheet | 480x1067 at 360x800, 0 px | 0 | 344x672 at x 8, y 58 |

- **The strip under the card.** `.panel-reserve` in `Frame.svelte` is a box of its own, outside the card and never
  animated: 296 px wide (`--panel-width`), as high as the card, `pointer-events: none`. It is mounted by the panel's
  state, as the card starts to enter, and goes as the card starts to leave. It is not drawn (`display: none`) on a phone
  and beside a co-website. It carries the camera's blocker and publishes its measured width as
  `gameViewportCoveredStart` in `ExternalModule/ClientExtensionPoints.ts`, which is 0 by default and when the frame is
  taken down. `Components/MainLayout.svelte` adds it to the start padding of `#main-layout`, so the dock and the in-call
  video layout stand beside the card. A blocker measures its element again only on a CSS transition or animation of
  that element, which a Svelte transition never starts: that is why the strip is not the card.
- **How the camera keeps the avatar and the map's edge clear.** `CameraManager.updateGameBounds` extends the camera's
  bounds along the start edge (the right edge in right-to-left) by the strip, in map pixels at the current zoom. The
  map's edge can scroll out from under the card, and an avatar at the map's edge stands beside the card. A map is
  centred only when it fits beside the strip too (`displayWidth > mapWidth + covered`): a map narrower than the window
  but wider than the part the card leaves scrolls. With the port at 0 the camera is as upstream. A strip that arrives
  is given to the bounds at once; a strip that goes is given back along the camera's offset glide, so the view does not
  jump.
- **The glide is matched to the card.** The camera's offset glide takes the card's own timing when the strip is what
  changed: 200 ms on the exit curve when the strip goes, so that the void under the leaving card narrows in step with the
  card's fading (296 px times one minus the curve, against an opacity of one minus the curve), and 290 ms on the
  surface spring when it comes. Any other blocker (a video box) keeps 500 ms on `QuadEaseOut`. All of them go through
  `motionDuration`, which is 0 under reduced motion. Tests: `tests/front/Phaser/Game/CameraManualPan.test.ts`.
- **Stacking.** The wide card is at `z-index` 5. It is over the canvas and over Phaser's name tags (their DOM layer is a
  stacking context at level 0) and under `#main-layout`, whose `z-index` is 10. What the HUD draws over the whole window
  (a fullscreen video, a modal with its scrim, a popup centred on the window) covers the card as it covers the map. At
  the phone sheet's level, 35, the card would have painted over a fullscreen video and over an iframe modal (the review
  of the panel lane read this from the CSS; it was never seen). A click on the card is a click on the card: `#main-layout` takes none where it draws nothing,
  and Phaser takes a press whose target is not the canvas as outside the game (`PointerOnOverlay.test.ts`).
- **Beside a co-website.** The frame has `.shares-map` while a co-website is open. From 768 px the card then keeps its
  own grid column (three columns), the published bounds leave it out and the strip is not drawn: the page and the game
  split the cell, and the split is not made under the card. When the exit starts the frame is no longer `panel-open`,
  the grid re-fits to two columns at once, and the card leaves floating where its column was (the rule is
  `.konclui:not(.shares-map.panel-open) .side-panel`), so it does not move. The re-fit at the start of the exit is
  T-305. Who gets the space between 768 and 1023 px is the owner's question (T-327): today the panel keeps its column.
- **Entrance and exit, measured.** One run of 290 ms on `aside.side-panel`: opacity 0 to 1, x from -24 px to 0, scale
  0.98 to 1 (at 203 ms: opacity 0.93, x -1.6 px). The exit is one run of 200 ms with the card `inert`: opacity 1 to 0,
  x 0 to -12 px, scale to 0.99, and the node was gone between 204 and 230 ms (209 to 224 ms across the five windows).
  Seven presses 60 ms apart ended closed, with no card and no animation left.
- **People and chat.** The card stays at opacity 1 when its view swaps and `.content` fades from 0 to 1 over 150 ms (the
  card's label changes in the first frame). The first time the chat opens in a session the page stalls for about one
  second while the chat code loads: a load cost, not motion (T-325).
- **Focus and keys.** `aria-controls` on the rail's two buttons and on the people pill points at `konclui-side-panel`
  only while the panel is open. As the panel closes, the focus goes to the rail's button (to the pill on a phone) while
  the card is still in the page, `chatInputFocusStore` is reset at that moment so the game's keys are not blocked until
  the card is removed, and Escape and Ctrl+K keep working during the exit.
- **The rail.** Every rail button carries `k-press`, and the rail is `k-glide` with one pill (40x40 px in the probe).
  The hover fill is drawn only inside `@media (hover: hover)` and only while the pill is absent. The pressed button
  keeps its fill and its colour, and has a 2 px `Highlight` outline under forced colours when it is not focused.

### The utilities

All of them are in `libs/tailwind/style/konclui.css`, in `@layer utilities`.

- **`.k-press`.** While pressed, the control scales to 0.985 (`--k-press-scale`) with `transition: scale` over
  `--k-dur-press` (160 ms) on `--k-ease-out-expo`. It uses the individual `scale` property, so it never clashes with
  the `transform` that `.k-enter` and `transition:surface` write. A control with `aria-disabled="true"` does not give.
  A press is not a hover, so it plays on a touch screen too. Under reduced motion there is no transition and no scale,
  and the fill change stays. It is on the rail's buttons, the dock's buttons and menu rows (`ActionBarButton.svelte`),
  `MenuRow.svelte`, the status rows, the profile menu's raw rows, the dock's chevron, the focus chip's button, the
  preferences tabs and close button, and the tools of the map column.
- **`.k-lift`.** It has the press, and a card or tile that the pointer is over also scales to 1.02 (`--k-lift-scale`).
  The hover rule is inside `@media (hover: hover)` and skips `aria-disabled="true"`, so a tap does not leave the tile
  grown. The emote tiles set 1.08 locally in `EmoteSection.svelte` (T-312). Under reduced motion it does not scale.
- **`.k-turn`.** A mark that rotates from `--k-turn-closed` (default -90deg) to 0deg when it has `.is-open` or its
  parent has `aria-expanded="true"`, on the turn spring over 360 ms. Under reduced motion it is upright at once.
- **`.k-disclosure` and `.k-disclosure-body`.** A reveal of unknown height: the one-row grid goes from `0fr` to `1fr` on
  the surface spring over 290 ms, so the body grows to what it holds, even while its content grows. `.is-open` comes
  from state. The body clips (`overflow: hidden`, `min-height: 0`), so a focus ring inside it needs room within its own
  box. Once shut, the body is `visibility: hidden` after the row has closed, so nothing in it takes the focus or is read
  out; open, it is visible at once. It animates a layout property, so it belongs inside a surface whose own box may
  change (a menu over the map, a fixed-height panel) and never to a grid column of the frame. Under reduced motion it is
  open or shut at once. Its users are the office menu's notice line, the explorer's two lists and the people panel's
  Online section.
- **`.k-glide`, `.k-glide-pill` and the `glide` attachment.** One pill under the rows of a list that follows the
  pointer, or the keyboard focus, from row to row. The container carries `.k-glide`, which isolates a stacking context
  so the pill, at `z-index` -1, is under the rows' text and over the surface behind. `{@attach glide({ item })}` in
  `Utils/glide.ts` creates the pill and adds `.k-glide-on` to the container, and from then on the rows' own hover fill
  is gone (the rule skips `aria-disabled` and `aria-pressed` rows), or the fill would arrive at once and the pill's
  travel would not be seen. Users: the office menu, the profile menu, the preferences tabs and the rail.
  - The pill is drawn only inside `@media (hover: hover)`. On a device without hover, or where the browser cannot say,
    the attachment does nothing: no pill, no listener, no `.k-glide-on`, so every row keeps its own hover. A touch
    pointer is not a hover either.
  - It listens to `pointerover` and `focusin` on the container, not to each row. The keyboard counts only where
    `:focus-visible` matches, so a menu opened with the mouse shows no pill on its first row.
  - It moves by `translate`, `width` and `height` on the surface spring (290 ms) and fades on `--k-dur-fast`. The first
    place after it was hidden is taken at once with the transition off, and the pill fades in there; only the move from
    one row to the next glides.
  - Over a gap, a title or a divider it stays where it is, so a pointer crossing from row to row glides and does not
    fade out and in. It hides on `pointerleave`, when the focus leaves the container, and over a row that cannot act.
  - It reads `offsetLeft`, `offsetTop`, `offsetWidth` and `offsetHeight`, which a press's scale and a surface's
    transform do not change, and writes them as `--k-glide-x`, `--k-glide-y`, `--k-glide-w` and `--k-glide-h`. They are
    physical, so the pill is placed by `top` and `left`. A scrolling container scrolls the pill with its rows.
  - Under reduced motion the pill jumps. Under forced colours it is a 2 px `Highlight` outline with an offset of -2 px.
  - When the rows change under a resting pointer the pill stays where it was (T-306).

### What stays still on purpose

- Typing in a search: the people rows (`PersonRow.svelte`) and the walk notice get none of the new motion, and neither
  does the chat's mention typeahead (`MentionSuggestions.svelte`), which changes per keystroke.
- Hover tooltips: the reaction and its tooltip, `InfoButton.svelte` and `HelpTooltip.svelte` get none of the new motion,
  and a floating popup registered without `motion` is gone in the same flush.
- Keyboard navigation: no utility transitions an outline or a shadow, so the focus ring is drawn at once on the focused
  row and does not glide. The pill follows the keyboard focus only as a hover fill, and only for `:focus-visible`.
- `KoncluiMotionSurfaces.test.ts` pins the same seven files against `transition:surface`, `popupSurface`, `.k-glide`,
  `.k-disclosure` and `.k-turn`.

### Known gaps

Closed by this change: exits are no longer instant for any surface that uses `transition:surface`; the map no longer
re-fits when the side panel opens or closes, except beside a co-website; "Link copiado" in the office menu has its
transition (a disclosure, the text kept while the line shuts). Open, each in `docs/TODO.md`:

- The top row of the HUD, the dock and the in-call video layout jump in one frame when the card starts to move (T-303).
- A press on a leaving surface falls through to the map for up to 200 ms, because the surface is inert; only the
  preferences dialog has a guard, its scrim (T-304).
- Beside a co-website the grid re-fits at the start of the card's exit, and the 768 to 1023 px band is the owner's
  question (T-305, T-327).
- The glide pill stays at its old offset when rows change under a resting pointer (T-306).
- The logout row's scoped style block in `ProfileMenuContent.svelte` should move to `konclui.css` (T-307).
- The reactions menu and the apps menu have a fixed `origin-bottom-left`, and every popup rises from 6 px below even
  when it flips (T-308).
- The chat's chevrons and section bodies are still on the old motion (T-309).
- The map explorer has a `.k-enter` entrance that its parent's `fly` probably hides, and no exit (T-310).
- The surfaces left out on purpose, and the camera's pan easing, are not decided (T-311, T-329).
- The hover lift of 1.08 on the emote tiles and 1.02 by default is a number the owner never gave (T-312, T-328).
- On a phone the sheet registers no camera blocker, so the view stays centred under it (T-324).
- Resizing across 768 px with the card open keeps the same card and replays nothing; an exit that crosses 768 px ends
  with the pose it started with, a wobble of 12 px or less for under 200 ms (T-323).
- Not seen in a browser, each a row of its own: reduced motion (T-313), right to left (T-314), forced colours (T-315),
  a frame trace at 120 Hz (T-316), a screen reader on the people disclosure and the notice (T-317), the card under a
  fullscreen video and a modal (T-318), the avatar at the map's left edge and the void band on close (T-319), the
  people disclosure's scrolling (T-320), focus and `inert` order (T-321), the surfaces the probe did not open (T-322),
  and the CSS springs, the press, the turn, the disclosure and the pill's glide playing (T-330).

### Verification (MOT-06)

- **Tests, by file.** Under `play/`: `src/front/Utils/spring.test.ts`, `surfaceTransition.test.ts`, `glide.test.ts`,
  `floatingUiSurface.test.ts` and `svelte-floatingui-show.test.ts`;
  `src/front/Components/Util/FloatingUiPopupList.test.ts`;
  `src/front/Konclui/Shell/components/Frame.test.ts`, `FrameBounds.test.ts`, `FramePanelMotion.test.ts` and
  `FramePhone.test.ts`; `src/front/Konclui/OfficeMenu/components/OfficeMenu.test.ts`;
  `src/front/Konclui/Preferences/components/PreferencesHost.test.ts`;
  `src/front/Konclui/Focus/components/FocusChip.test.ts`;
  `src/front/Konclui/Presence/components/CallIndicator.test.ts`, `PlaceChip.test.ts`, `PeoplePanel.test.ts` and
  `PeoplePill.test.ts`; `src/front/Konclui/MapTools/components/MapTools.test.ts`; `src/front/Chat/ChatSidebar.test.ts`;
  `src/front/ExternalModule/ClientExtensionPoints.test.ts`; `tests/front/Components/Exploration/Explorer.test.ts`;
  `tests/front/Components/MainLayoutCoveredStrip.test.ts`; `tests/front/Phaser/Game/CameraManualPan.test.ts` and
  `PointerOnOverlay.test.ts`; `tests/front/Style/KoncluiMotionTokens.test.ts`, `KoncluiMotionSurfaces.test.ts`,
  `KoncluiEntrance.test.ts`, `KoncluiMenuUtilities.test.ts` and `KoncluiThemeContrast.test.ts`.
- **What they prove.** They run in jsdom with `Element.animate` stubbed (`src/front/Utils/webAnimationsStub.ts`, and
  `SurfaceTransitionFixture.svelte` and `FloatingUiPopupFixture.svelte` as hosts). They prove the lifecycle (the held
  node, `inert`, removal, reversal half way, reduced motion, the focus hand-off), the geometry the CSS and the camera
  code give, and source pins on which directive sits on which element. They do not prove rendering, feel or
  hit-testing, and jsdom does not apply `inert` (no hit-testing and no blur).
- **Browser probe, 2026-11-24.** `.local/konclui/motion-2026-11-24/acceptance.md` (git-ignored, on this Mac only,
  T-070). The front of the working tree that the three commits then took whole (the lanes plus the rest-opacity fix;
  nothing under `play/` or `libs/` changed between the probe and the commits), built with `.local/konclui/bin/qa-front-swap.sh` (bundle
  `main-CNlc9193.js`), in the QA play container of `candidate-6c6a38b2d53b`; the Claude desktop browser pane, device
  pixel ratio 2, frames about every 17 ms. Each number was read in the page with `requestAnimationFrame`, a
  `ResizeObserver` on the canvas and `Element.getAnimations()`. Read: the canvas table and the side panel's entrance,
  exit, reversal and rapid presses above. Other surfaces:

  | Surface | Entrance | Exit |
  | --- | --- | --- |
  | Office menu (logo) | 290 ms, from 6 px left and scale 0.98; 13 rows, pill present | 200 ms, `inert`, to 3 px left and 0.99, gone at about 215 ms |
  | Camera and microphone settings (dock) | 290 ms | 200 ms, `inert`, removed |
  | Emoji bar (the reactions menu, dock) | 290 ms | 200 ms, `inert`, removed |
  | Preferences dialog and its dimming | 290 ms on both | 200 ms on both, `inert`, removed (closed with Escape) |

- **Not seen in the browser.** Reduced motion (the pane cannot emulate it); the avatar at the map's left edge with the
  card open, and the camera's glide against the card (unit tests only; in the screenshots the view re-centres on the
  part of the map beside the card); right-to-left pages; forced colours; a 120 Hz trace; a screen reader on the people
  disclosure; a co-website beside the panel; the card under a fullscreen video or a modal; and the profile menu, the
  status list, the map tools, the focus chip, the call and place chips, the apps menu and the favourites emoji picker,
  which were not probed one by one.
- **The CSS springs and the pill, never seen to play (T-330).** The probe measured the JS runs of `transition:surface`
  through `Element.getAnimations()` and saw the rail's and the office menu's pill present. It did not see these play:
  the `linear()` easings and the spring's feel (the owner asked for exactly this feel), `.k-press` on a pressed row,
  `.k-turn`, `.k-disclosure`, the pill gliding across the 2 px gaps between rows (`gap-0.5` in `MenuGroup.svelte`) and
  over the dividers (`glide.ts` is unit-tested only), and the office menu's padding (`p-1.5`) and its position on a
  phone.
- **Console errors.** The two during the probe were the ones the QA stack already had (the service worker script and
  the missing `entities.json`); none came from the motion code. A frame-rate trace was not taken.
- **The earlier probe.** `evidence/ui-feedback-2026-11-19/motion/verify-motion.mjs` (16 of 16 against
  `candidate-7be83ab59ade`) measured the `.k-enter` design that this section replaces. It is not evidence for the
  present one.
