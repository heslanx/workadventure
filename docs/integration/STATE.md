# Integration state

Owned by the integrator ([`LOOP.md`](LOOP.md)). Status key: `ready`, `waiting` (reason named),
`blocked` (evidence named), `done` (SHA named), `user` (needs a user decision).

## Recovery verification (2026-11-16)

- Codex desktop owns MC/NW integration after the user confirmed e6/f7 paused.
- Candidate `94ea93a31`: generation verified (no ERROR, 602831-byte types), typecheck,
  svelte-check (5784 files, 0 errors, 0 warnings), lint, formatting and locale checks pass.
- Full play Vitest: 275 suites, 1832 passed, 10 skipped. Back: 382 passed, 2 skipped.
  Map-storage: typecheck passes, 119 tests pass.
- Initial analytics suite failure came from a stale persisted transform of import.meta.glob
  referencing a deleted component. Preserved only that cache entry outside node_modules;
  the default full suite then passed. No code change or permanent cache override.
- Evidence: `~/.claude/orchestrate/konclui-native/recovery-codex/evidence/`.
- Recovery commit `c9a608fa9` fixes false Undo success with normal hooks and independent review.
  Focused tests pass (4 cases), combined recovery tests pass (29 cases before final pending-removal regression).
- Current generation passes (no ERROR, 605277-byte types), typecheck passes, svelte-check has 0 errors and 0 warnings.
- Browser Delete then Undo restores the isolated QA chair. Uploaded-file property deletion now
  confirms before mutation, Cancel preserves the file, and confirmed deletion offers no false Undo.
- Tutorial Skip restores focus to the profile control in the real browser. Attachment warnings
  update to the remaining failed file and disappear when none remain. Temporary upload failure injection removed.
- Independent closure review passes with a pending-removal error finding now fixed (13 focused tests pass).
- Onboarding commit `8eba7c9c3` passed normal hooks after correcting four new test typing errors.
- Owned personal-area browser QA passes: warning identifies irreversible uploaded-file loss,
  Cancel preserves the area and object. Evidence: personal-area-upload-warning.png.
- Attachment commit `14da16d19` and uploaded-file guard commit `fd52afc1d` passed normal hooks.
- Final independent GPT6Luna review passes at `fd52afc1d`. Generation, typecheck and
  svelte-check, lint, pretty-check, i18n:check and all serial test suites pass on this HEAD.
- Final play Vitest: 280 suites, 1862 passed, 10 skipped. Back: 382 passed, 2 skipped.
  Map-storage: typecheck passes, 119 tests pass. Logs: evidence/final-*.log.
- Completeness review and affected runtime QA pass. E2E caller scan found three stale
  immediate-delete flows. Commit `444906164` updates them, with normal hooks and scoped
  eslint/Prettier passing. E2E specs were scanned, not executed; browser evidence covers
  the actual confirmation behavior. Product/package gate inputs are unchanged from `fd52afc1d`.
- Independent GPT6Luna E2E delta review passes at `444906164`.
- Integrated and pushed as `b6136db03`. Merge adds only the existing erick-mode skill documentation
  to the reviewed candidate. All workers released. No product gate inputs changed.

## Last green

- `origin/master` = `b6136db03`, HIG round 3 integration, 2026-11-16.
- Product candidate `fd52afc1d`: generation without ERROR and 605277-byte generated types,
  typecheck, svelte-check (0 errors, 0 warnings), lint, pretty-check and i18n:check pass.
- Play: 280 suites, 1862 passed, 10 skipped. Back: 29 suites, 382 passed, 2 skipped.
  Map-storage: typecheck passes, 12 suites, 119 passed.
- `444906164` only updates E2E callers; scoped eslint/Prettier and normal hooks pass.
  E2E specs were scanned, not executed. Real browser confirmation flows passed.
- Independent review passes on the product candidate and final E2E delta. Documentation
  and merge preserve all verified product/package inputs, so those checks are reused.
- Evidence: `~/.claude/orchestrate/konclui-native/recovery-codex/evidence/final-*.log`.
- Integration uses `[skip ci]` to avoid inherited paid GitHub runner workflows. No hook bypass.

## Queue

| # | Item | Producer | Status | Evidence / next |
|---|---|---|---|---|
| 1 | Apple HIG pass, rounds 1 and 2 | workadventure-cb | done | Round 2 landed as `05127a813`..`a3f11a964` (contrast, hit areas, reduced motion, input borders); full check green on `a3f11a964`, pushed as `37636665f`. Open: nobody has looked at the input borders in a browser yet (`style/input.css` moved the colour into `@layer components`) |
| 2 | Dependency upgrades (Vite 8.3, Prettier 3.10, TypeScript 6.0.3, Vitest 5.1) | workadventure-b0 | waiting | New tip `dba158e7d` (5 commits on `78f3f2528`, fetched from `/tmp/wa-upgrade-repo chore/deps-upgrade`). Fix for the red `2c098b31d`: `patches/typesafe-i18n+5.27.1.patch` sets `module: CommonJS` in its transpile step, applied by the root `postinstall`. b0 reports all gates green. Waits for cb's round 3 "done" (cb asked for no host `npm install` until then); then merge, host `npm install`, `rm -f play/src/i18n/i18n-*.ts && npm run typesafe-i18n` with no `ERROR`, full check |
| 3 | Native-speaker review of dsb-DE and hsb-DE strings | user | user | Machine translations in `play/src/i18n/{dsb-DE,hsb-DE}/` (a11y.ts from `bffa20c5b`, earlier keys from the UI polish). Needs a reviewer the loop cannot supply |
| 4 | `.env.bak` at the repo root, untracked | user | user | Keep untracked, move out of the repo, or delete. The loop never reads or commits it |
| 5 | `map-storage` `UploadController` tests stalled 6 s after earlier tests | integrator | done | Cause: `fetch` reused a keep-alive loopback socket the test server was about to drop, so the request waited for the server's 5 s keep-alive timeout. Fix: `server.closeIdleConnections()` after each test; 3 runs 18/18 at the default 5 s timeout, full map-storage suite 119/119 |
| 6 | PR #4, erick-mode skill (docs only) | workadventure-3d | done | Pushed `origin/master` = `3c9bc294a` (fast-forward from `78f3f2528`) on the user's yes |
| 7 | QA findings ISSUE-001..008 (`/tmp/wa-qa/run-20261116T074504Z/`) | workadventure-cb | waiting | Runs as HIG round 4 after round 3 is green; two separate "done" messages. Browser re-test still owes map editor, reduced motion, input.css borders |

## Decisions

- 2026-11-16: the user asked for every change in the checkout, including other sessions' work in
  progress, to land on `master` as granular commits. Batches 1 and 2 were built with `commit-tree`,
  which skipped the hooks and pushed a red `edf4653e9`; from then on commits go through `git commit`.
- 2026-11-16: the coordinator (workadventure-3d) set the order: producer "done", one serial full
  check, granular commits, push only on green, SHA to b0 and 3d.

## Next prompt

L-03 is integrated and pushed. Execute L-04 in bounded verified units, beginning with
LoginScene ISSUE-001, ISSUE-002 and ISSUE-008. Root reproduced all three in the browser.
Then address the remaining browser issues and tracked accessibility concerns, including
replacement of an uploaded sound by a URL without confirmation. Follow with L-05
dependencies, L-06 through L-09 reference UI, and L-10 through L-14 native integration.
