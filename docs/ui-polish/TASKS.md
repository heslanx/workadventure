# UI polish program, task ledger

Goal: one full UI polish pass over the WorkAdventure front end (`play/src/front`, 490 Svelte
components), driven by the 8-step visual checklist (icons, text contrast, corner radius, shadows,
line spacing, type hierarchy, alignment, long text) plus the product usability guide (6 interaction
words, 10 interface heuristics, transparency rules, listing architecture, microcopy, performance and
accessibility). Every accepted change is verified against the real artifact before it is kept.

Rule of this ledger: a task is closed only with observed evidence. Unvalidated hypotheses stay in
`## Sprint 2 orchestration (session 2, 2026-11-15)

- Topology: one Workflow. Stage 1, ten Opus 5.5 implementers, one per findings file plus microcopy.
  Stage 2, one cross-vendor fresh-eyes reviewer per unit (GPT 6 Luna, Gemini 3.8 Flash, DeepSeek
  Flash, Grok, Sonnet 5.5, Haiku 5.5), refute-first. Stage 3, one Opus fix round only for confirmed
  findings, no loop.
- Scope decision: the polish checklist forbids wording, feature and layout changes, so microcopy
  findings are report only, and usability fixes that need new copy (silent chat failure, announcement
  success-before-send) are parked with evidence instead of landed.
- Each implementer records what it landed under `## Landed` in its own findings file; this ledger is
  edited only by the orchestrator.

## Hypotheses` and are never implemented.

## Status key

- `todo` not started
- `doing` in progress
- `done` closed with evidence
- `parked` blocked, reason named
- `rejected` evidence ruled it out

## Sprint 0, baseline and environment

| # | Task | Status | Evidence |
|---|---|---|---|
| 0.1 | Sync local refs with `origin` and `upstream` | done | `fetch --all --prune` (12 refs), `master` fast-forwarded to `origin/master`, branch merged `upstream/master` (16 commits) and pushed (`436e04d5a..f63be787b`) |
| 0.2 | Record Node version constraint | done | CI pins Node 24; local default is Node 26 and `localStorage` is missing under jsdom there, so every test run uses `~/.local/share/fnm/node-versions/v24.18.0/installation/bin` |
| 0.3 | Baseline unit tests for changed areas | done | play 333 passed / 10 skipped, desktop 162 passed, back 61 passed, shared-utils 41 passed, map-editor 39 passed, benchmark 15 passed |
| 0.4 | Baseline static checks | done | `play` typecheck + svelte-check 0 errors 0 warnings, `back` and `map-storage` typecheck clean, prettier clean on changed files |
| 0.5 | Inventory UI surfaces and design tokens | done | 490 `.svelte` files; tokens in `libs/tailwind/style/index.css` and `@workadventure/design-system/src/theme.css` |
| 0.6 | Confirm cross-vendor worker models through `klaude` | done | working: `gpt-6-luna`, `deepseek-flash`, `gemini-3.8-flash`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `claude-fable-5-2`. `grok-build-4.7` and `grok-4.7` return `400 unknown provider`, so Grok is unavailable |
| 0.7 | Run baseline pattern census over the UI | done | 49 Svelte files use native `disabled=`, only 3 use `aria-disabled`; 70 use `cursor-pointer`; shadows: 21 `shadow-lg`, 11 `shadow-2xl`, 9 `shadow-xl`, 3 `shadow-md`, 1 `shadow-sm` |

## Sprint 1, audit (read only, parallel workers)

Each worker writes one findings file under `docs/ui-polish/findings/`. A finding enters Sprint 2
only when it names a file, a line, the checklist step, and the exact change.

| # | Task | Status | Evidence |
|---|---|---|---|
| 1.1 | Step 1 icons: optical size and stroke weight consistency | done | `findings/step-1-icons.md`: 11 findings. 70 of 77 custom icons at `viewBox 0 0 24 24` and stroke 1.5; about 148 files use Tabler at 20px and stroke 2; `DownloadIcon` renders at weight 1 |
| 1.2 | Step 2 text contrast with measured ratios on real backgrounds | done | `findings/step-2-contrast.md`: 15 findings with computed WCAG ratios. Worst measured: `text-gray-500` 2.33 on a panel, `text-white/30` 2.63, `text-white/40` 3.22 |
| 1.3 | Step 3 corner radius per element type, nested shapes matched | done | `findings/step-3-radius.md`: 15 findings. Scale measured: `rounded` 8, `-sm` 4, `-md` 12, `-lg` 16, `-xl` 32; `rounded-2xl` equals `-lg`, `rounded-3xl` 24 is off scale |
| 1.4 | Step 4 shadows and elevation, depth only for real layering | done | `findings/step-4-shadows.md`: 46 token shadows censused, about 40 on real overlays, 15 findings |
| 1.5 | Step 5 line spacing in paragraphs | done | `findings/step-5-line-spacing.md`: 11 findings. `text-sm` ships 14/24, so `leading-4` collapses it to 16px (1.14) |
| 1.6 | Step 6 type hierarchy, main value vs title vs support | done | `findings/step-6-type-hierarchy.md`: 22 surfaces, 9 findings; two panels render the value smaller than its label |
| 1.7 | Step 7 alignment, one leading edge and one trailing column | done | `findings/step-7-alignment.md`: 12 findings, worst is a group title starting 28px off its siblings |
| 1.8 | Step 8 long text stress test with real worst case strings | done | `findings/step-8-long-text.md`: 15 findings against a Portuguese and German corpus; 5 surfaces break outright |
| 1.9 | Usability guide: six interaction words, ten heuristics, no silent error | done | `findings/usability-interaction.md`: `ActionBarButton` and `Button` use mute native `disabled`, chat connection failure only logs to console, announcement composer reports success before sending |
| 1.10 | Accessibility: keyboard reach, no hover-only action, reduced motion, focus ring | done | `findings/accessibility-motion.md`: 61 non-semantic clickable controls, `ActionBarButton` cancels the global focus ring, `ToastContainer` has no `aria-live`, 6 of about 610 animation sites honour reduced motion |
| 1.11 | Microcopy: active verbs, no em dash, error messages with cause, impact, next step | done | `findings/microcopy.md`: ranked top 40, report only (this pass forbids wording changes), all 45 catalogue citations re-verified |

## Sprint 2, implementation (verified units)

| # | Task | Status | Evidence |
|---|---|---|---|
| 2.1 | Land the accepted icon fixes | done | 13 landed, 0 skipped, 2 parked; review pass by gpt-6-luna (0 findings); fix round 0 applied, 0 rejected. Detail in findings file |
| 2.2 | Land the accepted contrast fixes | done | 22 landed, 2 skipped, 2 parked; review fix-needed by gemini-3.8-flash (6 findings); fix round 0 applied, 3 rejected. Detail in findings file |
| 2.3 | Land the accepted radius fixes | done | 37 landed, 1 skipped, 3 parked; review fix-needed by gpt-6-luna (2 findings); fix round 0 applied, 0 rejected. Detail in findings file |
| 2.4 | Land the accepted shadow fixes | done | 1 landed, 3 skipped, 2 parked; review pass by sonnet 5.5 (Grok fallback) (1 findings); fix round 0 applied, 0 rejected. Detail in findings file |
| 2.5 | Land the accepted line spacing fixes | done | 12 landed, 4 skipped, 1 parked; review pass by claude-sonnet-5-5 (0 findings); fix round 0 applied, 0 rejected. Detail in findings file |
| 2.6 | Land the accepted type hierarchy fixes | done | 12 landed, 0 skipped, 2 parked; review fix-needed by claude-haiku-5-5 (7 findings); fix round 1 applied, 3 rejected. Detail in findings file |
| 2.7 | Land the accepted alignment fixes | done | 12 landed, 1 skipped, 4 parked; review pass by gpt-6-luna (0 findings); fix round 0 applied, 0 rejected. Detail in findings file |
| 2.8 | Land the accepted long text fixes | done | 14 landed, 3 skipped, 1 parked; review fix-needed by gemini-3.8-flash (1 findings); fix round 0 applied, 0 rejected. Detail in findings file |
| 2.9 | Land the accepted usability and accessibility fixes | done | usability: 6 landed, 4 skipped, 11 parked; review pass by gpt-6-luna (0 findings); fix round 0 applied, 0 rejected. Detail in findings file. a11y: 15 landed, 2 skipped, 5 parked; review fix-needed by sonnet 5.5 (Grok fallback) (4 findings); fix round 4 applied, 2 rejected. Detail in findings file |

## Sprint 3, verification and report

| # | Task | Status | Evidence |
|---|---|---|---|
| 3.1 | `play` typecheck and svelte-check | done | final tree: typecheck exit 0; svelte-check 5748 files, 0 errors, 0 warnings |
| 3.2 | `play` unit tests | done | local, Node 24: 264 test files passed, 1778 tests passed, 10 skipped, 0 failed; `eslint src/ tests/` exit 0 |
| 3.3 | `play` prettier and i18n check | done | Prettier clean on every changed `.svelte`/`.ts`; `style.css` and `video-ui.css` fail but also fail at HEAD and are outside CI `pretty-check` (`*.{ts,svelte}`); `i18n:check` all translations complete |
| 3.4 | Build the front end | done | `npm run build` exit 0, built in 6.08s |
| 3.5 | Squint test: screenshot, blur, compare what is loud with what should be noticed | done | Playwright capture, 8px blur, `/tmp/wa-squint`. Login: Continue is the only loud spot (match). Game: map, then blue Login, then the low-emphasis Share (`bgColor white/10`), then avatar; Login is the one primary action for an anonymous visitor, so no mismatch and no change |
| 3.6 | Narrow phone width and large text size check | done | mobilechromium (Pixel class): bar collapses to icons + Login + menu, nothing clipped. Real 200% zoom (640x360 at 2x): bar moves to burger menu, profile menu scrolls, nothing clipped. Gap: mobile chat and profile panels not captured (they live in the burger menu; capture script limit) |
| 3.7 | Write `docs/ui-polish/REPORT.md` with per-step changes, contrast ratios, and what was left alone | done | `REPORT.md` written |

## Sprint 2 orchestration (session 2, 2026-11-15)

- Topology: one Workflow. Stage 1, ten Opus 5.5 implementers, one per findings file plus microcopy.
  Stage 2, one cross-vendor fresh-eyes reviewer per unit (GPT 6 Luna, Gemini 3.8 Flash, DeepSeek
  Flash, Grok, Sonnet 5.5, Haiku 5.5), refute-first. Stage 3, one Opus fix round only for confirmed
  findings, no loop.
- Scope decision: the polish checklist forbids wording, feature and layout changes, so microcopy
  findings are report only, and usability fixes that need new copy (silent chat failure, announcement
  success-before-send) are parked with evidence instead of landed.
- Each implementer records what it landed under `## Landed` in its own findings file; this ledger is
  edited only by the orchestrator.

## Hypotheses

Unvalidated ideas live here until a worker or a measurement promotes them. Nothing here is
implemented.

- The 49 native `disabled=` buttons are the largest single gap against the "no frustrated click"
  rule. Needs a per-site read: some disabled controls are correct when they also explain themselves.
- `shadow-2xl` and `shadow-xl` may be carrying depth on elements that do not overlap anything.
- Hand cursor coverage at 70 files against 490 components suggests many clickable surfaces rely on
  hover styling alone.

## Parked

- Grok workers: no provider behind `klaude` for `grok-build-4.7`. Revisit when the proxy exposes it.
- `map-storage` `UploadController.test.ts` has two tests that exceed the default 5000 ms timeout on
  this machine and pass at 30000 ms. Timing, not a behaviour change; left outside this program.

## Session 2 environment log

- 2026-11-15: user authorised unblocking everything. `docker compose up -d` started all 12 services.
  Risk being tracked: the containers run `npm install` (Linux) over the bind-mounted
  `node_modules`, which can drop the darwin `esbuild`/`rollup` binaries. Recovery before any local
  build: `npm install` on macOS with Node 24. Teardown: `docker compose down` when the squint test
  is done.
- 2026-11-15: the "earlier session" edits in 2.3, 2.4 and 2.8 came from a concurrent session,
  `workadventure-e0`, whose record is `docs/ui-polish/SESSION-workadventure-e0.md` (it reports
  svelte-check 0/0 and build ok after each of its batches). Agreed by message: this session owns
  every source file; `workadventure-e0` is read-only and runs no docker, npm or git writes.
- 2026-11-15: synapse exited 1 because the local `.env` defines only 9 variables and
  `synapse/start.sh` rejects empty template variables. Fix without opening `.env`: start with
  `docker compose --env-file .env.template --env-file .env up -d` (template as defaults, local
  overrides win). Use the same flags for `down`.
- 2026-11-15: `workadventure-e0` reconciled and went read-only. It reports, on the combined tree
  before this session's workflow landed: play typecheck clean, svelte-check 5748 files 0/0,
  prettier clean, i18n check complete, `npm run build` ok. This session confirmed against `HEAD`
  that `MapList` (1 to 0 shadows), `PresenterEffectsOverlay` (1 to 0) and `MovementStep` (9 to 1,
  the card `shadow-lg` kept on purpose) are fixed, not reverted. Its edit list with contrast
  ratios is `SESSION-workadventure-e0.md` and feeds REPORT.md (3.7). Those results predate the
  workflow, so Sprint 3 checks are re-run on the final tree.
- 2026-11-15: model failures in workflow `wf_b2b40820-d7e`: `grok-4.7-build-fast` failed on both
  units it got (review:shadows, review:a11y); the script's fallback re-ran both on Sonnet 5.5, and
  both passed. Every other reviewer model answered (gpt-6-luna, gemini-3.8-flash, deepseek-flash,
  claude-sonnet-5-5, claude-haiku-5-5). Rule from here on: no Grok in any workflow; its share goes
  to `gpt-6-luna`. Script edited for any resume.
- 2026-11-15: play container OOMKilled (Docker VM 7.7 GB shared with other projects' containers,
  left untouched). Restarted play without `svelte-check-watch` and `watch-iframe-api` through a
  temporary override `/tmp/wa-play-lowmem.override.yaml` (no repo file changed); svelte-check runs
  locally in 3.1. Teardown: delete the override with the stack.
- 2026-11-15: two DeepSeek Flash reviewers (radius, usability) looped at 231 and 274 tool calls on a
  read-only review, one running the forbidden svelte-check. Workflow stopped and resumed with
  `gpt-6-luna` in DeepSeek's reviewer slot; the 23 finished agents came from cache.
- 2026-11-15: front returned 504 although Vite (8080) and pusher (3000) answered 200 inside the
  container. Cause: this Traefik read every container on the daemon, including another project's
  `konclui-local-wa` stack with the same router names ("Router defined multiple times").
  Fix in the same `/tmp` override: `--providers.docker.constraints=Label(com.docker.compose.project,
  workadventure)`. Result: http 200, 0 duplicate-router errors. The other stack was not touched.
- 2026-11-15: Sprint 3 partial. 3.1 typecheck exit 0, svelte-check 5748 files 0/0; 3.3 i18n check
  complete; Prettier clean on every changed `.svelte` (the two CSS files that fail also fail at
  HEAD and sit outside CI `pretty-check`). Local `eslint`, `vitest` and `vite build` lack the
  darwin native bindings while the container owns `node_modules`; they run inside the play
  container until teardown.
- 2026-11-15: review follow-up landed by the orchestrator: `ParticipantMenuItem.svelte` ignores
  `event.repeat` on Enter/Space so a held key no longer toggles the menu open and shut.
- 2026-11-15: TEMPORARY file added: `tests/tests/zz_ui_polish_squint.spec.ts` (squint capture, outputs to /tmp/wa-squint). Must be deleted before finishing.
- 2026-11-15: running `eslint` + `vitest` inside the play container OOM-killed the container
  (exit 137, OOMKilled=true) and the squint capture with it. Decision: serialize, never overlap.
  Order: squint capture with the stack alone, then `docker compose down`, then local
  `npm install` (darwin bindings back), then lint, tests and build locally.
- 2026-11-15: teardown done. `docker compose down` (0 workadventure containers left), `/tmp`
  override removed, temporary spec `tests/tests/zz_ui_polish_squint.spec.ts` deleted (git status of
  `tests/` clean), local `npm install` restored the darwin bindings with `package-lock.json`
  unchanged.

## Sprint 4, fix everything that was parked (user request "corrija tudo", 2026-11-15)

The user lifted the polish pass's ban on wording and behaviour changes. Every item parked in
Sprints 2 and 3 is now in scope. Defaults for product decisions follow the usability guide and are
written down in the findings files; nothing is left silently undecided.

| # | Unit | Status | Evidence |
|---|---|---|---|
| 4.1 | Microcopy: the 40 ranked wording fixes plus the product-decision rows (glossary, verbs, error screens) | done | 26 landed, 38 new keys, 6 not done (reasons in findings); review fix-needed by gpt-6-luna, fix round 4 applied / 0 rejected |
| 4.2 | Blocked controls explain themselves: `ActionBarButton` and `Button` reasons, mute entries, lock and recording pickers, enable mic on go-live | done | 17 landed, 15 new keys, 5 not done (reasons in findings); review fix-needed by sonnet 5.5 (Gemini fallback), fix round 1 applied / 0 rejected |
| 4.3 | Chat connection failure becomes a visible state with cause, impact and retry | done | 9 landed, 6 new keys, 3 not done (reasons in findings); review fix-needed by claude-sonnet-5-5, fix round 4 applied / 1 rejected |
| 4.4 | Never lose work and honest success: announcement success only after send, dirty-close guards, undo and copy-failure notices | done | 23 landed, 24 new keys, 6 not done (reasons in findings); review fix-needed by claude-haiku-5-5, fix round 3 applied / 1 rejected |
| 4.5 | Toasts: close button, live regions, no toast as sole evidence of a failure | done | 9 landed, 1 new keys, 5 not done (reasons in findings); review fix-needed by gpt-6-luna, fix round 1 applied / 0 rejected |
| 4.6 | Accessibility structural: keyboard models, hover-only info, colour-only info, tap targets, large text | done | 25 landed, 8 new keys, 6 not done (reasons in findings); review pass by sonnet 5.5 (Gemini fallback), fix round 0 applied / 0 rejected |
| 4.7 | Reduced motion for Svelte JS transitions and Phaser camera tweens | done | 8 landed, 0 new keys, 3 not done (reasons in findings); review pass by claude-sonnet-5-5, fix round 0 applied / 0 rejected |
| 4.8 | Icons: one stroke weight and optical size across custom and Tabler icons in the action bar | done | 19 landed, 0 new keys, 4 not done (reasons in findings); review fix-needed by claude-haiku-5-5, fix round 0 applied / 4 rejected |
| 4.9 | Contrast over light maps: panel surfaces opaque enough to keep 4.5:1 | done | 18 landed, 0 new keys, 6 not done (reasons in findings); review pass by gpt-6-luna, fix round 0 applied / 0 rejected |
| 4.10 | Leftovers: 4 alignment items, 3 radius items, 2 type items, dead code, CSS Prettier | done | 13 landed, 0 new keys, 7 not done (reasons in findings); review pass by sonnet 5.5 (Gemini fallback), fix round 0 applied / 0 rejected |
| 4.11 | Doors, numbers and lists: clickable data and counters, filter/URL state where WorkAdventure has lists | done | 11 landed, 8 new keys, 9 not done (reasons in findings); review fix-needed by claude-sonnet-5-5, fix round 1 applied / 0 rejected |
| 4.12 | Translate every new i18n key into the other 15 locales | done | 100 new keys translated into 15 locales; i18n:check complete. dsb-DE and hsb-DE strings need a native-speaker review |
| 4.13 | Full check suite on the final tree, serial (typesafe-i18n, typecheck, svelte-check, lint, tests, i18n:check, build) | doing | Run 1: typesafe-i18n 0, tests 267 files 1789 passed 0 failed, build 0, i18n complete; FAILED typecheck (1), svelte-check (3), lint (16), prettier (12 i18n files). Fix agent dispatched |
| 4.14 | Squint and phone pass again, including the mobile chat and profile panels missed in 3.6 | todo | |

Topology: one Workflow. 11 Opus 5.5 implementers (4.1 to 4.11) in parallel, each reviewed by one
cross-vendor reviewer (GPT 6 Luna, Gemini 3.8 Flash, Sonnet 5.5, Haiku 5.5; DeepSeek and Grok
excluded after Sprint 2), one fix round, then 4.12 once every new key is known. The orchestrator
runs 4.13 and 4.14 itself, one job at a time, because Docker memory is tight.
- 2026-11-15 (Sprint 4): `gemini-3.8-flash` now returns `400 unknown provider` from the proxy
  (worked in Sprint 2; smoke test `klaude -p --model gemini-3.8-flash` fails, `gpt-6-luna` answers).
  Its reviews (blocked, a11y-structural, leftovers) run on the Sonnet 5.5 fallback. Gemini joins
  Grok as unavailable until the proxy serves it again.
- 2026-11-15 (Sprint 4): `workadventure-e0` resumed, at the user's request, on debt items limited to
  `map-storage/` and `play/src/pusher/`. Agreed: no `npm install` inside containers on the bind
  mount, checks on the host with Node 24, no containers while this session runs the final squint
  pass (this session announces it first), hands off `play/src/front`, `play/src/i18n`,
  `play/src/common`, `style/*.css`, `libs/tailwind`, `package*.json`.
- 2026-11-15 (Sprint 4): fix agent made typecheck, svelte-check (5757 files 0/0), lint (0) and
  pretty-check pass and closed the review residuals; orchestrator re-verification running on the host.
- 2026-11-15: user asked to see the app locally. Stack started with `/tmp/wa-stack.override.yaml`:
  every service that runs `npm install` gets its own `node_modules` in named Docker volumes
  (`wa_nm_*`), so the Linux install no longer replaces the host's darwin bindings. Also keeps the
  Traefik project constraint and drops only `svelte-check-watch` from play. Peer session told not to
  start containers. Start: `docker compose --env-file .env.template --env-file .env -f
  docker-compose.yaml -f /tmp/wa-stack.override.yaml up -d`.
