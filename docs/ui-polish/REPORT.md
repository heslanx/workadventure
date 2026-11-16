# UI polish pass, report

Scope: `play/src/front` (490 Svelte components), the 8-step visual checklist, plus the parts of the
usability guide that need no new wording and no new behaviour. Two sessions did the work in one
checkout, 2026-11-15: `workadventure-e0` (first batch) and this session (workflow
`wf_b2b40820-d7e`, 11 Opus 5.5 implementers, cross-vendor review by GPT 6 Luna, Gemini 3.8 Flash
and Claude Sonnet/Haiku 5.5, then one fix round). Task trail: `TASKS.md`. Per-finding detail:
`findings/*.md` (sections "Landed (session 2)", "Skipped", "Parked") and
`SESSION-workadventure-e0.md`.

Diff: 137 files, 131 of them `.svelte`; +729 / -425 lines. Nothing is committed.

## What changed, per step

| Step | Landed | What it did |
|---|---|---|
| 1 Icons | 13 | `DownloadIcon` rendered at stroke 1, now 2; `DesktopMiniWindow` 1.8 strokes to 2; three action-bar icons pinned to the 20px Tabler size the bar uses; the drawer chevron grows 28 to 32px inside an unchanged button; four `stroke` props removed that the Tabler bodies never applied (no rendering change) |
| 2 Contrast | 22 + 9 (e0) | Secondary text raised from `white/30`–`/50` and `gray-400`/`-500` to `white/60` or `white/70`; primary stays `text-white`. Ratios below |
| 3 Radius | 37 + 20 (e0) | Off-scale `rounded-3xl` (24px) and oversized `rounded-xl` (32px) on modals and cards to `rounded-lg` (16px); `rounded-2xl` (same 16px) renamed to `rounded-lg`; menu rows inside 4–6px padded menus to `rounded` |
| 4 Shadows | 1 + 30 (e0) | Every `shadow-2xl`/`shadow-xl` became `shadow-lg` and only sits on true overlays; glows removed (action bar hover, toast progress, participant pulse); shadows removed where nothing floats (map thumbnail, drawer tab, 8 keycaps) |
| 5 Line spacing | 12 + 5 (e0) | `leading-4` on 14px text (1.14) to 1.5; tight description cards to `leading-5`; no container was resized |
| 6 Type hierarchy | 12 + 3 (e0) | Side-panel statistics now show the value larger than its label; the proximity notification body no longer outranks its title |
| 7 Alignment | 12 | Five side-panel headers share one leading edge (`px-3`); grouped room titles align with their siblings |
| 8 Long text | 14 + 4 (e0) | `min-w-0` + `truncate` + `title` (full text on hover and for assistive tech) on user rows, profile name, room pills, calendar rows, raised hands, user tags; names wrap with `wrap-anywhere` where wrapping beats truncation |
| Usability | 6 | Hand cursor on clickable rows that lacked it; no wording or feature change |
| Accessibility | 15 + 2 (review) | Global focus ring no longer cancelled on `ActionBarButton`; non-semantic clickables converted to `<button>` or given `role`, `tabindex` and Enter/Space; `aria-live` on the toast region; one `prefers-reduced-motion` rule in `style.css` that keeps `.animate-spin`; device lists are proper radiogroups; held Enter no longer toggles the participant menu repeatedly |

## Contrast ratios (WCAG, measured on the composited real background)

| Text | Before | After | Surface |
|---|---|---|---|
| `text-gray-500` labels (Woka scenes, `EntitiesGrid`) | 2.33 | 5.21 | panel |
| Quoted reply `text-white/30` | 2.63 | 6.16 | composer |
| `DesktopMiniWindow` `text-white/40` (11 sites) | 3.76 | 6.86 | mini window |
| Message timestamp `text-white/40` | 3.22 | 5.21 | panel |
| Side-panel hints `text-white/45` | 3.31 / 3.53 | 5.60 / 6.14 | card on panel / `bg-contrast` + white/10 |
| Edited label `text-white/50` | 3.98 | 6.14 | message bubble |
| Section and meta labels `text-white/50` | 4.14 / 3.99 | 5.21 / 5.00 | panel / side panel |
| Placeholders `white/50` and `white/35` | 4.38 / 3.17 | 5.58 / 6.60 | input fills |
| `ShowMore` `text-gray-400` | 4.44 | 5.32 | panel (design-system `neutral-500`) |
| Primary `text-white` | 14.43 | 14.43 | `bg-contrast` |

Every body-text change now clears 4.5:1 on its normal surface. Known miss: a panel at
`bg-contrast/80` floating over a very light map tile keeps `white/60` at 3.93:1 (parked, below).

## Squint test

Captured with Playwright at 1280×720, blurred 8px.

- Login screen, loudest first: the Continue button, then the logo. A visitor should notice the
  name field and Continue. Match.
- In game, loudest first: the map and camera bubble, the blue Login button, the low-emphasis Share
  button (`white/10` fill), then the avatar and name. A visitor should notice the world and their
  own avatar, then the one primary action. Login is the single primary action for an anonymous
  visitor and Share stays visibly secondary. Match, so nothing was changed.
- Phone width (mobile Chromium): the bar collapses to chat, mic, camera, Login and a menu button;
  nothing clips; Login is the one loud control.
- 200% browser zoom (640×360 at 2×): the bar moves into the burger menu, the profile menu scrolls,
  nothing clips.

## Verification

Final tree, 2026-11-15, Node 24: typecheck exit 0; svelte-check 5748 files, 0 errors, 0 warnings; eslint exit 0; unit tests 264 files, 1778 passed, 10 skipped, 0 failed; `i18n:check` complete; `npm run build` exit 0. Not run: the Playwright e2e suite (only the squint capture ran).

## Left untouched on purpose

1. All wording. The checklist forbids it, so the 40 ranked microcopy findings stay a report
   (`findings/microcopy.md`) for a copy pass that edits en-US and pt-BR together.
2. Usability items that need new copy or behaviour: blocked-reason text for `ActionBarButton` and
   `Button`, the silent chat connection failure, the announcement composer that reports success
   before sending, undo notices, data "doors", URL state. Converting mute `disabled` buttons to
   `aria-disabled` without a reason line would create a focusable dead button, so it waits for copy.
3. Custom icons (stroke 1.5, 24px) next to Tabler icons (stroke 2, 20px) in the action bar. Matching
   them is a cross-family design decision over about 40 call sites.
4. Panels over light map tiles (3.93:1) and a semantic secondary-text token. Both need a new token
   or a more opaque panel surface.
5. Reduced motion for Svelte JS transitions (49 files) and Phaser tweens. Needs a shared transition
   wrapper; the CSS rule covers CSS animations only.
6. Four alignment items that need an arbitrary width or a browser comparison (`Room` timestamp
   column, calendar time and Join columns, settings slider inset).
7. Dead code found on the way (`FollowButton.svelte`, the `#cowebsite` short-screen CSS). Deleting it
   is cleanup, not polish.
8. `style.css` and `video-ui.css` fail Prettier at `HEAD` already; CI only checks `*.{ts,svelte}`.
