# P6: native TypeScript 7 pilot, side by side with the TS 6 API

Status: PARTIAL deliverable, verified on a remote copy only. Nothing applied to the checkout.
Scope: CI/dev typecheck time on a capped, shared VPS (knc, `--cpus 2`). This is not runtime, room capacity or anything about the 1,000-user target.

## Shape

The P6 patch is the D01a line plus the following:
- Root, back and map-storage get `"@typescript/native": "npm:typescript@^7.0.2"`. The `tsc` bin becomes the native compiler.
- Every workspace that declared `typescript` gets `"typescript": "npm:@typescript/typescript6@^6.0.2"`. `require('typescript')` and the `tsc6` bin stay on the TS 6 JS API for typescript-eslint, svelte-check, ts-loader and tsserver.
- Scripts that ran `tsc` now run `tsc6`, so behaviour is unchanged by default.
- Pilot scripts: back `"typecheck:native": "tsc --noEmit"` and map-storage `"typecheck:native": "tsc --project tsconfig-node.json --noEmit"`.

Files:
- `p6-native-pilot.patch`: 16 files, 304 lines, cumulative against `HEAD` and including the D01a config fixes. `git apply --check` exit 0 on a `HEAD` copy. The applied result was compared byte-for-byte with the measured remote files: 0 mismatches.
- Lock (not in the patch): `/tmp/wa-fable-staging/D01/package-lock.p6.json`, sha256 `6490af0d17d6beb00b6381a247d503aae20829de744073c253214d6fe1b8cc68`. It is identical to the remote `/work/package-lock.json` that was measured.

## 1. Resolution proof (remote tree, all exit 0)

| From | `node -p "require('typescript').version"` | `npx --no-install tsc -v` | `npx --no-install tsc6 -v` | local `node_modules/.bin/tsc` |
|---|---|---|---|---|
| `/work` (root) | 6.0.3 | Version 7.0.2 | Version 6.0.3 | `tsc -> ../@typescript/native/bin/tsc`, `tsc6 -> ../typescript/bin/tsc6` |
| `/work/back` | 6.0.3 | Version 7.0.2 | Version 6.0.3 | none (hoisted to root) |
| `/work/map-storage` | 6.0.3 | Version 7.0.2 | Version 6.0.3 | none (hoisted to root) |

Lock entries:
- `node_modules/@typescript/native`: 7.0.2, `typescript-7.0.2.tgz`
- `node_modules/typescript`: 6.0.2, `@typescript/typescript6-6.0.2.tgz`. It depends on `"@typescript/old": "npm:typescript@^6"`.
- `node_modules/@typescript/old`: 6.0.3, `typescript-6.0.3.tgz`. This is the actual 6.x compiler. The `@typescript/typescript6@6.0.2` wrapper reports `Version 6.0.3`.

`c-clean-install-resolution.log`: full `npm ci` exit 0, and scoped `npm ci --workspace=workadventureback` and `--workspace=map-storage` exit 0. All three give the same links. `tsserver` resolves to `@typescript/old` (TS 6), so editors keep the TS 6 language service. Per-directory JSON: `c-resolution.json`.

## 2. Diagnostics parity (`c-parity.jsonl`, `--pretty false`)

| Package | Case | TS 6 exit / errors | native exit / errors | normalized output |
|---|---|---|---|---|
| back | clean | 0 / 0 | 0 / 0 | identical (both empty) |
| back | fixture `src/p6-pilot-fixture.ts` (string into number) | 2 / 1 TS2322 | 1 / 1 TS2322 | identical line, same position |
| map-storage | clean | 0 / 0 | 0 / 0 | identical (both empty) |
| map-storage | same fixture | 2 / 1 TS2322 | 1 / 1 TS2322 | identical |

- Exit-code difference: on diagnostics, native `tsc` exits 1 where TS 6 exits 2. Both are nonzero, so CI gating still holds, but a script that tests for exactly 2 would break.
- The fixture files were removed afterwards (verified absent).
- Config fixes the TS 6 line needed are documented and applied in `../D01/README.md` (types: node, rootDir, preserveValueImports).
- Native also passed (single runs, `c-native-extra.jsonl`, exit 0): math-utils 0.46 s, play `tsconfig-pusher.json` 4.16 s, play iframe typings 3.70 s.

## 3. Performance (`c-bench.jsonl`, `baseline-ts593.jsonl`)

Method:
- Direct binaries with `--noEmit`. Back uses `tsconfig.json`; map-storage uses `tsconfig-node.json`.
- TS 6 and native runs were interleaved: 1 discarded warm-up, then 5 runs each.
- No project sets `incremental`, so every run starts without build info. The OS page cache was not dropped (unprivileged container).
- The TS 5.9.3 baseline ran on the pristine p3 tree (back and map-storage untouched there). It used a throwaway container, `wa-fable-tsbase` (node:24-trixie, `--cpus 2 --memory 4g --cpu-shares 512`, tree mounted read-only), with 1 warm-up and 4 runs. The container was removed afterwards.

| Package | Compiler | n | wall median s (min-max) | user CPU median s | peak RSS median MiB (min-max) | exits |
|---|---|---|---|---|---|---|
| back | TS 5.9.3 | 4 | 13.85 (12.65-15.98) | 14.33 | 907 (906-908) | all 0 |
| back | TS 6.0.3 | 5 | 9.57 (8.64-13.00) | 14.22 | 879 (872-883) | all 0 |
| back | native 7.0.2 | 5 | 3.83 (3.56-4.28) | 6.08 | 768 (747-779) | all 0 |
| map-storage | TS 5.9.3 | 4 | 10.01 (8.43-10.72) | 9.41 | 638 (633-660) | all 0 |
| map-storage | TS 6.0.3 | 5 | 6.72 (6.11-8.24) | 9.75 | 626 (620-709) | all 0 |
| map-storage | native 7.0.2 | 5 | 2.29 (2.07-2.65) | 3.21 | 442 (435-462) | all 0 |

How to read it:
- Native vs TS 6, same container, interleaved:
  - Wall median: back 2.5x lower (9.57 to 3.83 s), map-storage 2.9x lower (6.72 to 2.29 s).
  - User CPU: 2.3x and 3.0x lower.
  - Peak RSS: 13 % and 29 % lower.
- TS 5.9.3 vs TS 6: user CPU is within 3 % (14.33 vs 14.22 s, 9.41 vs 9.75 s), so there is no measured change. The 5.9.3 wall times are inflated by host contention: wall exceeded user CPU, and knc load average was 6.04 at 00:39 UTC. An earlier same-container 5.9.3 run via `npm run typecheck` (`../D01/a-ts593.jsonl`, n=4) gave back 10.70 s and map-storage 6.04 s median wall. Do not read the 5.9.3 to 6 wall difference as a speedup.
- These are typecheck seconds on a shared 2-CPU cap. They are not deployment or runtime numbers.

## 4. Compatibility through the TS 6 API (`c-ts6api.jsonl`, P6 tree)

- Package scripts on `tsc6` all exit 0: back, map-storage, shared-utils, store-utils, map-editor, messages, e2e-report, and play typecheck.
- svelte-check:
  - play: exit 0, 0 errors, 0 warnings, 46.4 s.
  - store-utils: exit 0, 0 errors, 1 warning (the same warning as on 5.9.3).
- Typed eslint, one file each (back, map-storage, shared-utils, store-utils, map-editor, play .ts, play .svelte): 7/7 exit 0, no output.

## Blockers / blocked_with_reason

- typescript-eslint 8.60.0, @typescript-eslint/parser and typescript-estree: peer `typescript >=4.8.4 <6.1.0`. They need the TS JS API, which the native 7.0.2 package does not replace, so they must stay on the `typescript` alias (TS 6). Native for lint is blocked until upstream supports it.
- svelte-check 4.4.8 (peer `>=5.0.0`) and ts-loader 9.5.7 (peer `*`) load `require('typescript')`, so they stay on TS 6.
- Play `typecheck` (now `tsc6`) has no native pilot script. Native passed play's pusher and iframe-typings configs once each, but play's `.svelte` checking needs svelte-check on the TS 6 API.
- Exit codes on diagnostics: native 1 vs TS 6 2 (see section 2).
- npm aliases (`npm:` specifiers) in 12 manifests are a reviewer-visible cost. Whether maintainers accept them is open.
- Lock: regenerated remotely. Upstream must regenerate it.
- Not covered: CI workflow wiring for `typecheck:native`, native on play, vitest, and Docker builds.

## Resources

- `wa-fable-ts` on knc: retained, running, as the brief asks.
- `wa-fable-tsbase` on knc: created 00:37 UTC and removed 00:39 UTC (`docker ps -a` count 0).
- Scratch on knc under `~/wa-jobs/wa-fable-20261111/`: `tsbase-meas/` and `d01-out/`.
