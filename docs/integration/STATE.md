# Integration state

Owned by the integrator ([`LOOP.md`](LOOP.md)). Status key: `ready`, `waiting` (reason named),
`blocked` (evidence named), `done` (SHA named), `user` (needs a user decision).

## Last green

- `origin/master` = `28d01caf7` (merge of `chore/orca-docker-ssh-env` at `ce6ece405`), 2026-11-16.
- Check on `ce6ece405`: play typesafe-i18n, typecheck, svelte-check (5775 files, 0/0), lint,
  pretty-check, i18n:check all exit 0; play vitest 268 files, 1793 passed; back 382 passed;
  map-storage typecheck 0, vitest 119 passed (30 s timeout).
- After it, documentation-only commits (this loop, `2a6fbf6a8` onward) on both `master` and
  `chore/orca-docker-ssh-env`; they change no code, so the check above still covers the code tree.

## Queue

| # | Item | Producer | Status | Evidence / next |
|---|---|---|---|---|
| 1 | Apple HIG pass, round 2 (critic residuals) | workadventure-cb | waiting | Round 1 done 2026-11-16: fully committed (`2b572e4ba`..`ec1851d3a`, `bffa20c5b`, `be66d0f89`, `ce6ece405`), no a11y key changes (31 keys). Round 2 touches only `play/src/front/**`, no new keys, no package.json. Wait for its "done", then commit and run the full check. `/tmp/wa-hig` belongs to cb until then |
| 2 | Dependency upgrades, one per commit | workadventure-b0 | waiting | Runs in `/tmp/wa-upgrade-repo` on branch `chore/deps-upgrade` from `ce6ece405`. b0 announces before fetching into this checkout or pushing. Integrate as a fast-forward when its gate is green |
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

Read this file. Item 1 and item 2 are `waiting`: check `ListAgents` and the inbox for cb's "done" or
b0's upgrade report. When one arrives, run one iteration of LOOP.md on it. When neither has arrived,
stop and report the queue.
