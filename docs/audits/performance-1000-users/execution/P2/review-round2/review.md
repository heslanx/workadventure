# P2 review, round 2: Svelte ^5.55.9 to ^5.57.3

Verdict: **PASS_WITH_NITS**. The manifest and lockfile change is the minimum the bump requires. Every changed integrity hash matches the npm registry. On the review tree, `svelte-check` (play) reports 0 errors and 0 warnings, and the riskiest Svelte-dependent tests pass. The findings below are gaps in receipts and documentation, plus one test-coverage gap. None of them blocks the change.

Reviewer lane: `review`, host `sbh`, tree `~/wa-jobs/wa-fable-20261112/src-review`, between 01:24 and 01:40 UTC on 2026-11-12. No manifest, lockfile or product file was changed.

## 1. Inputs checked

- `../README.md`, `../p2-svelte.patch`, `../p2-package-lock.diff`, `../receipts/{base,head}/*`, `../receipts/bundle-size-comparison.txt`, `../run-step.sh`.
- The checkout's working tree versus `HEAD` (`git diff HEAD -- package-lock.json` and the three manifests).
- The upstream changelog, `packages/svelte/CHANGELOG.md` on `sveltejs/svelte` `main`. Its top entry is 5.57.3. `node_modules/svelte` does not ship a `CHANGELOG.md`.
- The npm registry version documents for the six changed packages.

## 2. Lockfile and manifests

| Check | Method | Result |
|---|---|---|
| The P2 diff equals the checkout's current change | changed `+`/`-` lines of `git diff HEAD -- package-lock.json` versus `p2-package-lock.diff` | identical |
| The review tree equals the checkout | sha256 of `package-lock.json` and the three manifests, on the Mac and on `sbh` | identical; lockfile `867162bd98318d4cfe0c46a4590407270c2d85cf981d676fe8836be103c8d140` (same as the README's staged hash) |
| Package set | JSON parse of `HEAD` and working lockfiles | 1461 entries on both sides, no key added or removed |
| Changed entries | per-key comparison | `play`, `libs/store-utils`, `map-storage` (only `devDependencies.svelte`); `svelte`, `acorn`, `esrap`, `devalue`, `@sveltejs/acorn-typescript`, `@jridgewell/sourcemap-codec` (version, resolved, integrity; svelte also its dependency list); `@types/trusted-types` (only `optional: true`). Nothing else |
| Each transitive bump is required | Svelte 5.57.3 `dependencies` from the registry against the old versions | yes: `acorn ^8.18.0` (was 8.16.0), `esrap ^2.3.6` (was 2.2.9), `devalue ^5.9.2` (was 5.8.1), `@sveltejs/acorn-typescript ^1.0.13` (was 1.0.10), `@jridgewell/sourcemap-codec ^1.6.0` (was 1.5.5). `@jridgewell/remapping` 2.3.5 and `@types/estree` 1.0.9 already met the new minimums and did not move. npm picked the newest version in each range (acorn 8.19.0, esrap 2.4.0, devalue 5.9.4), which is normal resolution, not drift |
| Shared hoisted packages remain compatible | every dependent range in the lockfile | `acorn` 8.19.0 satisfies all 13 dependents (webpack, terser, espree, mlly, unplugin, ts-node, acorn-walk, ...). `@jridgewell/sourcemap-codec` 1.6.0 satisfies all 7 dependents. No nested copies |
| `@types/trusted-types` now `optional` | dependents in the lockfile | its only remaining dependent is `dompurify` (`optionalDependencies`), so the flag is correct. No Dockerfile under `play/`, `back/` or `map-storage/` passes `--omit=optional` |
| Integrity hashes present and genuine | lockfile, plus `https://registry.npmjs.org/<pkg>/<version>` `dist.integrity` | all six changed entries carry `sha512` and match the registry exactly |
| Registry | `resolved` hosts across the whole working lockfile | 1426 entries on `registry.npmjs.org`. The others are workspace links and 2 `git@github.com` entries, all unchanged from `HEAD` |
| Svelte peer ranges | every `peerDependencies.svelte` in the lockfile | all accept 5.57.3 (`@sveltejs/vite-plugin-svelte ^5.46.4`, `svelte-check ^4 \|\| ^5.0.0-next.0`, `@sentry/svelte 3.x \|\| 4.x \|\| 5.x`, `svelte-modals >=5`, ...) |
| Overrides | root `package.json` | `overrides` is empty |
| Other manifests | `rg '"svelte"' --glob package.json` | only the three bumped workspaces, plus `desktop/electron` (already `^5.57.3`, separate lockfile) |

## 3. Changelog versus patterns in `play/src`

The range covers 16 releases: 5.55.10, 5.56.0 to 5.56.10, and 5.57.0 to 5.57.3. Play compiles in the default runes and non-async mode: `vite.config.ts` sets no `compilerOptions.experimental`. So the async-mode, SSR, hydration and `migrate` fixes cannot be reached from play's client code. Pattern counts were taken with `rg` over `play/src` (and `play/tests` where noted).

| Release / PR | Change | Use in this repo | Assessment |
|---|---|---|---|
| 5.55.10 #18268 | delegated propagation walks `composedPath()` directly | all event attributes; also `delegateSvelteEvents` in `src/front/Components/Video/PictureInPicture/childWindow.ts`, which calls `on()` from `svelte/events` on another window's document so that Svelte's delegation runs there (PiP and desktop child windows) | I read `handle_event_propagation` in 5.57.3: it still starts from `path[0]` and stops at the listening document, so the helper keeps working. No automated test exercises a delegated handler in a child window (finding F2) |
| 5.57.1 #18749 | cancel deferred event listeners during cleanup | the same helper subscribes to 8 `pointer*`/`touch*` events. Svelte defers attaching those through `queue_micro_task` | Helps this repo: with 5.57.3, a stop call that runs before the microtask no longer leaves the listener attached |
| 5.56.10 #18569 | release `last_propagated_event` after propagation | every delegated event | Retention fix. It removes one way a detached subtree stays reachable after a click |
| 5.56.10 #18620 | effect teardowns read the value from before the first write in a flush | 24 runes files have `$effect` teardowns | Sampled all 24: the teardowns use captured `const`s or plain `let`s (for example `ScreenAnnotationOverlay.svelte` `const target = ...`), not reactive state read directly. No change in behavior found |
| 5.57.2 #18878 | `flushSync(fn)` flushes pending work before `fn` | one callback use, in `tests/front/Components/PwaInstallScreen.test.ts:61`; `childWindow.ts:121` calls `flushSync()` with no argument | The test passes on head (section 4) |
| 5.57.0 #18480 | warning for undeclared shorthand handlers on `<svelte:window>` and similar | 22 files. The two shorthands, `ActionsMenu.svelte:60 {onkeydown}` and `ChatSidebar.svelte:114 {onresize}`, are both declared | `svelte-check --fail-on-warnings` is clean |
| 5.57.0 #18646 | component instances stored in `$state` are no longer proxied | `bind:this` into `$state` | Exported functions are called, never mutated reactively. No change expected |
| 5.57.1 #18838, 5.57.3 #18944 / #18949 | `Object.hasOwn` and `in` checks on state proxies are now tracked | `Object.hasOwn` in runes files: 0. `in` checks: not counted | These can only add dependencies, which could mean extra re-runs. Unmeasured; belongs to the pending perf probe |
| 5.57.0 #18647 / #18431, 5.57.2 #18776 | transition measuring and outro fixes | 49 files with transitions, none `\|global` | Fixes. Visual effect only; covered by the pending live lanes |
| 5.57.2 #18864 | an unchanged spread `value` is not overwritten | `src/front/Components/Input/InputSearch.svelte` (an input with a spread) | Fix that keeps incomplete input |
| 5.56.0 #18282 | declarations allowed in the template (`{let ...}`) | parser change | `svelte-check` is clean on all 490 `.svelte` files |
| 5.56.5 #18541 | Tween leak fix | `svelte/motion`: 0 imports | cannot be reached (matches the README) |
| others | `<svelte:head>` anchors, `bind:activeElement`, `SvelteDate`/`SvelteURL`, `$state.eager` | 0 uses each | cannot be reached |

The README's own counts check out: 490 `.svelte` files, 436 with runes, 22 with `<svelte:window|document|body>`, 0 `svelte/motion`. Every PR it cites appears in the release it names.

## 4. Checks rerun on the review tree

Each check ran in its own container (`node:24-trixie`, `--cpus 1 --cpu-shares 512 --memory 3g --network none`). Logs are in `receipts/` in this directory.

| Check | Command | Result |
|---|---|---|
| svelte-check (play), first attempt | `npm run svelte-check` | **V8 heap out of memory** after 89 s (`FATAL ERROR: Ineffective mark-compacts near heap limit`, heap ~1.48 GB). Node sized its default heap from the 3 GB container cap. This is an environment limit, not a diagnostic. CI runs this step without `NODE_OPTIONS` on a larger runner, and the earlier lane ran it at 8 GB |
| svelte-check (play) | same, with `NODE_OPTIONS=--max-old-space-size=2560` (container env only, nothing added to the repo) | exit 0, 70 s, **0 errors and 0 warnings** (`receipts/play-svelte-check.log`) |
| riskiest play tests | `npm test -- run --maxWorkers=2 <20 paths>` | exit 0, 55 s, **20 files, 65 tests passed** (`receipts/play-risk-tests.log`) |
| store-utils tests | `npm test` in `libs/store-utils` | exit 0, 1 file, 12 tests passed (`receipts/store-utils-test.log`) |

The test subset was chosen by risk:
- Every test that mounts a `.svelte` component: 13 files.
- Every test that calls `flushSync`, including the one `flushSync(fn)` caller.
- The child-document chat input test.
- The `PictureInPicture` directory.
- Floating UI.
- Keyboard handling on room rows.
- `SidePanelStore`.

Exact paths are in the log header.

## 5. Findings

| ID | Severity | File | Finding | Evidence |
|---|---|---|---|---|
| F1 | minor | `../README.md` §3, §7 | The exit codes and durations in the §3 table, the base whole-suite figure (215 files passed), and the "receipt on sbh `.p2/head/play-full-tests.log`" have no surviving receipt. `run-step.sh` wrote exit code and duration to `<name>.meta`, but no `.meta` file was copied into `../receipts/`. The remote job root `~/wa-jobs/wa-fable-20261111/src-wa-fable-svelte/.p2` no longer exists on `sbh`, and neither does container `wa-fable-svelte`, which §7 still lists as RETAINED. The local logs do show the summary lines (svelte-check 0/0, 79 files/343 tests, 251 files/1605 tests). `head/play-full-tests.tail.log` is a tail with no command header, and `base/play-lint.log` has only the npm banner | `ls` on `sbh`: "No such file or directory"; `docker ps -a --filter name=wa-fable-svelte -q` returned 0 rows; `ls ../receipts/*/` shows no `.meta` file |
| F2 | minor | `play/src/front/Components/Video/PictureInPicture/childWindow.ts:75` | `delegateSvelteEvents` relies on Svelte's internal delegation, which this range changes twice (#18268, #18749). No test proves that a delegated `onclick` runs inside a child window's document. `childWindow.test.ts` tests only `observeElementSize`. On 5.57.3 the path is verified by reading the code only, and the README's live lanes do not name PiP or desktop child windows | `rg delegateSvelteEvents play/src play/tests`: no test file |
| F3 | nit | `../README.md` §1 | The README says "15 releases"; the range has 16 (5.55.10, 11 releases of 5.56.x, 4 of 5.57.x). Its diagnostics table also omits the runtime behavior changes that this repo can reach: #18749, #18620, #18838/#18944/#18949 and #18268 as it affects `delegateSvelteEvents` (see §3 above) | `grep '^## 5\.5[5-7]\.' CHANGELOG.md` |
| F4 | nit | `../README.md` §5, line 5 | "Nothing in the local checkout was modified" and "nothing applied to the checkout" are now out of date: the checkout's working tree carries exactly the P2 manifests and lockfile, uncommitted (sha256 matches the staged lockfile) | `git diff --stat HEAD` |
| F5 | nit | review environment | `svelte-check` in play needs more than ~1.5 GB of V8 heap. Any capped container at 3 GB or less needs `NODE_OPTIONS=--max-old-space-size=...` to reproduce §3, or the check fails with an OOM that looks like a failure | §4 first attempt |

## 6. Not verified here

- Runtime retention, memory, latency and frame time on base and head. These are the README's PENDING perf probe and live lanes 1 to 10. Nothing in this review supports a performance claim.
- Delegated events inside a real PiP or desktop child window (F2) need a browser lane.
- The whole `play` suite as a base/head pair, and `npm run lint` in play. I did not rerun them; the head whole-suite pass rests on the earlier lane's tail log.

## 7. Resources

Containers created by this lane, all removed: `wa-fable-r2-review-1` (OOM attempt), `-2` (svelte-check), `-3` (tests). `docker ps -a --filter label=owner=wa-fable-20261112 --filter name=wa-fable-r2-review` returns 0 rows. Scratch on the Mac: `/tmp/wa-r2/review/`, holding the downloaded changelog, the `HEAD` lockfile copy and the lockfile diff. Logs on the remote tree: `src-review/.review-r2/`.
