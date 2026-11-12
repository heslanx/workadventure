# P2 - Svelte 5.55.9 to 5.57.3 (lane P2-svelte)

Status: unit gate evidence exists for base and head. Live lanes 1-10 and the perf probe are PENDING. No memory, retention, latency or frame-time improvement is claimed.

Update 2026-11-12 01:55 UTC: the coordinator applied the three manifests and the lockfile to the checkout (sha256 of the lockfile unchanged, `867162bd…c8d140`) and committed them as one commit after the independent review in `review-round2/review.md` (PASS_WITH_NITS). The lane work below ran on a remote snapshot of baseline commit `ddbe245a84c78c947dd9ae5310da1fc53cd3d278` (container `wa-fable-svelte` on `sbh`, Node 24.22.2, npm 11.19.1, x86_64, capped at 1.5 CPUs / 8 GB). The snapshot manifests and root lockfile were verified byte-identical to `HEAD` by sha256 before any change.

## 1. Target revalidation (2026-11-11 23:49 UTC)

- `npm view svelte version` = `5.57.3`; dist-tags `latest: 5.57.3`, `next: 5.0.0-next.272`. Published 2026-10-26.
- Target: `5.57.3`, same as the planning snapshot. Tarball integrity `sha512-5mAftM3SoDV9X0zdF386F9p2pv8iKOwi/KfBS1XnBAkVCKFzVOLHUoa8iGWAt4buoicLmyWVRpuuD5wplXOQsg==`.
- Changelog source: <https://github.com/sveltejs/svelte/blob/main/packages/svelte/CHANGELOG.md> (releases 5.55.10, 5.56.0-5.56.10, 5.57.0-5.57.3; 16 releases, two minors). The runtime changes this repo can reach, and how each was assessed, are listed in `review-round2/review.md` §3: #18268 (delegated propagation, including `delegateSvelteEvents` in `childWindow.ts`), #18749 (deferred listeners cancelled on cleanup), #18620 (effect teardown values) and #18838/#18944/#18949 (tracked `Object.hasOwn` and `in` checks on state proxies).

Entries relevant to this program (event, derived and teardown retention):

| Release | Entry | Link |
|---|---|---|
| 5.57.2 | prevent untracked derived reads from retaining disconnected dependencies | <https://github.com/sveltejs/svelte/pull/18829> |
| 5.57.2 | prevent duplicate subscriptions when reconnecting deriveds | <https://github.com/sveltejs/svelte/pull/18899> |
| 5.57.1 | cancel deferred event listeners during cleanup | <https://github.com/sveltejs/svelte/pull/18749> |
| 5.57.0 | keep the dependencies of a reaction that throws, so deriveds it read are neither leaked nor stuck in their error | <https://github.com/sveltejs/svelte/pull/18703> |
| 5.57.0 | remove `<svelte:head>` anchors on unmount | <https://github.com/sveltejs/svelte/pull/18697> |
| 5.56.10 | release `last_propagated_event` after event propagation settles so it no longer retains the last event's target subtree | <https://github.com/sveltejs/svelte/pull/18569> |
| 5.56.10 | clean up removed capture event handlers from spread attributes | <https://github.com/sveltejs/svelte/pull/18618> |
| 5.56.5 | abort deriveds own AbortSignal when it disconnects | <https://github.com/sveltejs/svelte/pull/18400> |
| 5.56.5 | don't (re)connect deriveds when read inside branch/root effects | <https://github.com/sveltejs/svelte/pull/18527> |
| 5.56.5 | clear `previous_task` reference after abort in Tween (memory leak) | <https://github.com/sveltejs/svelte/pull/18541> |
| 5.55.10 | walk `composedPath()` directly in delegated event propagation (perf) | <https://github.com/sveltejs/svelte/pull/18268> |

Entries that can change diagnostics or compile results (checked by the gates below, none fired):

| Release | Entry | Link |
|---|---|---|
| 5.57.3 | use the first valid fallback role in `role` for a11y checks | <https://github.com/sveltejs/svelte/pull/19045> |
| 5.57.2 | compile error: `{:else}` followed by another `{:else}` / `{:else if}` | <https://github.com/sveltejs/svelte/pull/18900> |
| 5.57.2 | compile error: snippet declaration redeclares one of its parameters | <https://github.com/sveltejs/svelte/pull/18842> |
| 5.57.2 | compile error: `let:` directive on a component with a `children` snippet | <https://github.com/sveltejs/svelte/pull/18873> |
| 5.57.2 | flush anything pending before invoking the `flushSync` callback | <https://github.com/sveltejs/svelte/pull/18878> |
| 5.57.0 | warn on undeclared shorthand event handlers on `<svelte:window>`, `<svelte:document>`, `<svelte:body>` | <https://github.com/sveltejs/svelte/pull/18480> |
| 5.57.0 | `@types/trusted-types` moved to devDependencies | <https://github.com/sveltejs/svelte/pull/18730> |

Source usage that makes these paths reachable in `play/src` (counted with `rg`, static only): 490 `.svelte` files, 436 using runes, 271 using event attributes, 49 using transitions, 22 using `<svelte:window|document|body>`, 0 importing `svelte/motion` (the Tween fix is not reachable).

## 2. Where Svelte is declared and resolved

Root npm workspace graph (lockfile `package-lock.json`, lockfileVersion 3):

| Manifest | Field | Before | After |
|---|---|---|---|
| `play/package.json` | devDependencies | `^5.55.9` | `^5.57.3` |
| `libs/store-utils/package.json` | devDependencies | `^5.55.9` | `^5.57.3` |
| `map-storage/package.json` | devDependencies | `^5.55.9` | `^5.57.3` |

- Root lockfile before: a single `node_modules/svelte` at `5.55.9`. After: a single `node_modules/svelte` at `5.57.3` (`npm ls svelte --all` exit 0, every consumer `deduped`; receipt `receipts/head/npm-ls-svelte.log`).
- No `overrides`/`resolutions` mention Svelte. Peer ranges of `svelte-check`, `@sveltejs/vite-plugin-svelte`, `eslint-plugin-svelte`, `svelte-eslint-parser`, `prettier-plugin-svelte`, `@sentry/svelte`, `svelte-modals`, `svelte-pan-zoom`, `unplugin-icons` all accept 5.57.3; none of them was bumped.
- Not touched: `desktop/electron/package.json` already declares `^5.57.3` in its own graph (`desktop/electron/package-lock.json`); `benchmark/`, `messages/`, `libs/room-api-clients/room-api-client-js/` and `maps/` lockfiles do not resolve Svelte from this change.

Lockfile effect of `npm install` (exit 0, "changed 7 packages", no `--force`, no `--legacy-peer-deps`; 1461 package entries before and after):

| Package | Before | After |
|---|---|---|
| `svelte` | 5.55.9 | 5.57.3 |
| `acorn` | 8.16.0 | 8.19.0 |
| `esrap` | 2.2.9 | 2.4.0 |
| `devalue` | 5.8.1 | 5.9.4 |
| `@sveltejs/acorn-typescript` | 1.0.10 | 1.0.13 |
| `@jridgewell/sourcemap-codec` | 1.5.5 | 1.6.0 |
| `@types/trusted-types` | 2.0.7 | 2.0.7, now flagged `optional` |

The five transitive bumps are forced by the raised minimums in Svelte 5.57.3's own `dependencies`. `acorn` and `@jridgewell/sourcemap-codec` are hoisted and shared with other tooling, so this PR is not Svelte-only at the lockfile level. Full diff: `p2-package-lock.diff` (138 lines).

## 3. Checks: base versus head

Same scripts, same container, same order (`run-step.sh`, `run-phase.sh`, `run-extra.sh`). One run per side. Durations are single wall-clock samples at 1.5 CPUs and are not a performance claim.

| Check (workspace) | Command | Base exit / s | Head exit / s | Result |
|---|---|---|---|---|
| svelte-check (play) | `npm run svelte-check` | 0 / 54 | 0 / 52 | 0 errors, 0 warnings on both |
| typecheck (play) | `npm run typecheck` | 0 / 27 | 0 / 26 | clean on both |
| focused tests (play) | `npm test -- run <7 filters>` | 0 / 106 | 0 / 124 | 79 files, 343 tests passed on both |
| svelte-check (libs/store-utils) | `npm run svelte-check` | 0 / 4 | 0 / 3 | 0 errors, 1 warning on both (pre-existing: "No svelte input files were found") |
| typecheck (libs/store-utils) | `npm run typecheck` | 0 / 2 | 0 / 3 | clean on both |
| tests (libs/store-utils) | `npm test` | 0 / 1 | 0 / 1 | 1 file, 12 tests passed on both |
| typecheck (map-storage) | `npm run typecheck` | 0 / 8 | 0 / 7 | clean on both |
| tests (map-storage) | `npm test -- run` | 0 / 7 | 0 / 7 | 10 files, 69 tests passed on both |
| UI build (map-storage) | `npm run front:build` | 0 / 1 | 0 / 1 | built on both |
| production build (play) | `npm run build` (CI env, heap 6144 MB) | 0 / 34 | 0 / 25 | built on both |
| iframe API build (play) | `npm run build-iframe-api` | 0 / 1 | 0 / 1 | built on both |
| format (play) | `npm run pretty-check` | 0 / 28 | 0 / 30 | all files formatted on both |
| whole suite (play) | `timeout 420 npm test -- run` (base), `timeout 540 ...` (head) | 124 / 420 | 0 / 470 | head: 251 files passed, 1605 tests passed, 10 skipped (the full log lived on sbh in `.p2/head/play-full-tests.log`, which was deleted with the job root at 01:06 UTC; only the summary tail survives in `receipts/head/play-full-tests.tail.log`, without its command header). Base was killed by its 420 s time box after 215 files passed and 0 failed, so this is a head pass, not a base/head pair |
| lint (play) | `timeout 360 npm run lint` | 124 / 360 | not run | base hit the time box; no comparison possible |

Focused test filters: `src/front/Chat/Components src/front/Chat/Stores src/front/Components src/front/Stores src/front/Utils/svelte-floatingui-show.test.ts tests/front/Components tests/front/Stores` (every test that mounts a `.svelte` component, plus the store tests).

No new diagnostic and no new test failure appeared on head. Pre-existing on base and unchanged on head: the single `libs/store-utils` svelte-check warning. Failed by time box, not by an assertion: the base whole-suite run (215 test files had passed, 0 failed, when `timeout` killed it) and the base lint run (no output before the kill).

## 4. Production bundle size (play, one build per side)

Measured from `play/dist` after `npm run build` (`PUSHER_URL=//localhost:3000 ADMIN_URL=//localhost:80`, `NODE_OPTIONS=--max-old-space-size=6144` instead of CI's 16384 because of the 8 GB cap). Bytes on disk and `gzip -9` bytes; receipt `receipts/bundle-size-comparison.txt`, per-file lists in `receipts/{base,head}/play-dist-js-css-wasm-sizes.txt`.

| Slice | Base | Head | Delta |
|---|---|---|---|
| JS, 73 files, raw | 18,138,584 | 18,129,923 | -8,661 (-0.05%) |
| JS, 73 files, gzip | 7,454,976 | 7,455,538 | +562 (+0.01%) |
| CSS, 4 files, raw / gzip | 502,144 / 99,897 | 502,144 / 99,897 | 0 |
| WASM, 8 files, raw | 69,288,460 | 69,288,460 | 0 |
| Source maps | 40,349,451 | 40,400,661 | +51,210 (+0.13%) |
| All files in dist (1167) | 184,838,080 | 184,880,629 | +42,549 (+0.02%) |

Largest changed chunks (raw / gzip): `main` -11,655 / -1,090; `i18n-svelte` +2,350 / +827; `Popup` +1,948 / +822; `GameManager` -953 / +30. Modules transformed: 4177 base, 4178 head.

Reading: bundle size is neutral (well inside the plan's 5% rule). This says nothing about runtime memory.

Correction applied to the raw head listing: `dist/public/iframe_api.js` (295,788 bytes) and its map (1,152,690 bytes) appear only in the head `dist` because this lane ran `build-iframe-api` (output dir `play/public`) after the base build. Both files are excluded from every head figure above. The uncorrected head total is 186,329,107 bytes.

## 5. Deliverables for integration (applied and committed on 2026-11-12)

- `p2-svelte.patch`: unified diff of the three manifests against `HEAD`; `git apply --check` exit 0.
- `/tmp/wa-fable-staging/P2/{play,libs/store-utils,map-storage}/package.json`: the changed manifests.
- `/tmp/wa-fable-staging/P2/package-lock.json` with `/tmp/wa-fable-staging/P2/package-lock.json.sha256` = `867162bd98318d4cfe0c46a4590407270c2d85cf981d676fe8836be103c8d140` (matches the remote file).
- `p2-package-lock.diff`: lockfile diff against `HEAD`, for review only.
- `../pr-descriptions/P2.md`: draft PR description.

The lockfile was generated with npm 11.19.1 on linux/x86_64. Apply the patch plus the staged lockfile together, then run `npm ci` once in the integration environment and confirm `npm ls svelte` still shows a single 5.57.3.

## Receipt gaps (review finding F1)

The exit codes and durations in the section 3 table were written by `run-step.sh` to `<name>.meta` files on sbh. None was copied into `receipts/`, and the job root that held them was deleted at 01:06 UTC, so those numbers have no surviving receipt. The surviving local logs show the summary lines: svelte-check 0 errors and 0 warnings, 79 files and 343 focused tests, 251 files and 1605 tests for the whole suite. The base whole-suite count (215 files passed before the time box) also has no surviving receipt. `receipts/base/play-lint.log` holds only the npm banner, so `npm run lint` for play has no base receipt either. The independent review reran svelte-check and the riskiest Svelte-dependent tests on a fresh tree (`review-round2/receipts/`), and a combined-state CI mirror including `npm run lint` was queued on the offload box as job `wa-ci-combined-1`.

Reproduction note (review finding F5): svelte-check in play needs more than about 1.5 GB of V8 heap. In a container capped at 3 GB or less, set `NODE_OPTIONS=--max-old-space-size=2560` or higher, or the check fails with an out-of-memory error that looks like a check failure.

## 6. PENDING (not run in this headless lane)

- Review finding F2: no automated test proves that a delegated `onclick` runs inside a child window's document through `delegateSvelteEvents` (`play/src/front/Components/Video/PictureInPicture/childWindow.ts:75`). On 5.57.3 this path is verified by reading the code only.

- Live lane 1: panel open/close regression against trunk (`P2/lane-1.zip`).
- Live lane 2: Matrix chat open/close after initialization (`P2/lane-2.zip`).
- Live lane 3: proximity chat mount and leave (`P2/lane-3.zip`).
- Live lane 4: repeated room changes (`P2/lane-4.zip`).
- Live lane 5: long conversation pagination (`P2/lane-5.zip`).
- Live lane 6: modal open/close through keyboard, focus return (`P2/lane-6.zip`).
- Live lane 7: reactive controls during a call (`P2/lane-7.zip`).
- Live lane 8: load the production worker/WASM assets in a browser (`P2/lane-8.zip`). Only the build half is covered here.
- Live lane 9: scripted interaction on the selected modest phone (`P2/lane-9.zip`).
- Live lane 10: idle after repeated lifecycle cycles, retained DOM and memory trend (`P2/lane-10.zip`).
- Perf probe: retained JS/DOM memory, detached node count, interaction latency and frame time on base and head, five interleaved valid runs on one device, heap snapshots kept separate from GC/frame traces.
- Whole `play` test suite with a base/head pair, and `npm run lint` in `play`: both need more than this lane's time box at 1.5 CPUs (see section 3).
- `map-storage` `front:check` was not run (it needs `svelte-kit sync`, which is not part of CI).

## 7. Resources

| Host | Handle | Purpose | State |
|---|---|---|---|
| sbh | container `wa-fable-svelte` | upgraded snapshot (Svelte 5.57.3 installed), receipts in `/work/.p2/` | released by the coordinator at 01:06 UTC; verified absent |
| sbh | `~/wa-jobs/wa-fable-20261111/src-wa-fable-svelte/.p2/` | raw logs, `orig/` copies of the baseline manifests and lockfile | removed with the job root at 01:06 UTC |
| Mac | `/tmp/wa-fable-staging/P2/` | staged manifests and lockfile | retained for the coordinator |
| Mac | `/tmp/wa-fable-p2-dl/` | downloaded changelog and receipt scratch | removed at the end of the lane |

No background process, tunnel or server was left running. No timeouts or overrides were added to the repository.
