# Integration state

Owned by the integrator ([`LOOP.md`](LOOP.md)). Status key: `ready`, `waiting` (reason named),
`blocked` (evidence named), `done` (SHA named), `user` (needs a user decision).

## Last green

- `origin/master` = `37636665f` (merge of `chore/orca-docker-ssh-env` at `a3f11a964`), 2026-11-16.
- Check on `a3f11a964`: play typesafe-i18n, typecheck, svelte-check (5775 files, 0/0), lint,
  pretty-check, i18n:check, build all exit 0; play vitest 268 files, 1793 passed; back 382 passed;
  map-storage typecheck 0, tests 119 passed at the default timeout.
- Gate gotcha: `npm run typesafe-i18n` exits 0 even when generation fails. Read its log for `ERROR`
  and check `play/src/i18n/i18n-types.ts` is not near-empty before trusting typecheck.

## Queue

| # | Item | Producer | Status | Evidence / next |
|---|---|---|---|---|
| 1 | Apple HIG pass, rounds 1 and 2 | workadventure-cb | done | Round 2 landed as `05127a813`..`a3f11a964` (contrast, hit areas, reduced motion, input borders); full check green on `a3f11a964`, pushed as `37636665f`. Open: nobody has looked at the input borders in a browser yet (`style/input.css` moved the colour into `@layer components`) |
| 2 | Dependency upgrades (Vite 8.3, Prettier 3.10, TypeScript 6.0.3, Vitest 5.1) | workadventure-b0 | blocked | Tip `2c098b31d` merged locally, red: under TypeScript 6 `npm run typesafe-i18n` fails to import its temp base locale (`ERR_MODULE_NOT_FOUND .../temp-output/0/en-US/audio`), still exits 0 and writes an empty `i18n-types.ts`, so play typecheck shows 675 errors and svelte-check 2995. Merge reset to `a3f11a964`, host deps reinstalled. Waiting for a new tip from b0 |
| 3 | Native-speaker review of dsb-DE and hsb-DE strings | user | user | Machine translations in `play/src/i18n/{dsb-DE,hsb-DE}/` (a11y.ts from `bffa20c5b`, earlier keys from the UI polish). Needs a reviewer the loop cannot supply |
| 4 | `.env.bak` at the repo root, untracked | user | user | Keep untracked, move out of the repo, or delete. The loop never reads or commits it |
| 5 | `map-storage` `UploadController` tests stalled 6 s after earlier tests | integrator | done | Cause: `fetch` reused a keep-alive loopback socket the test server was about to drop, so the request waited for the server's 5 s keep-alive timeout. Fix: `server.closeIdleConnections()` after each test; 3 runs 18/18 at the default 5 s timeout, full map-storage suite 119/119 |

## Decisions

- 2026-11-16: the user asked for every change in the checkout, including other sessions' work in
  progress, to land on `master` as granular commits. Batches 1 and 2 were built with `commit-tree`,
  which skipped the hooks and pushed a red `edf4653e9`; from then on commits go through `git commit`.
- 2026-11-16: the coordinator (workadventure-3d) set the order: producer "done", one serial full
  check, granular commits, push only on green, SHA to b0 and 3d.

## Next prompt

Read this file. Item 2 is `blocked` on a new tip from workadventure-b0. When it arrives, fetch it,
merge it, run a host `npm install` with Node 24, run `npm run typesafe-i18n` and confirm its log has
no `ERROR`, then run the full serial check of LOOP.md and push on green. Items 3 and 4 wait for the
user.
