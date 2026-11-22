# TypeScript Style

## Ignoring TypeScript and ESLint rules

- Never use @ts-ignore or eslint-disable unless absolutely necessary. If you do so, ask the user first and comment why afterwards.
- Avoid `any` and type assertions (as).
- Always handle Promise rejections (no floating promises).

## AbortControllers

- Use `AbortController` for cancellable async operations (fetch, timers, streams, WebSocket).
- Accept `AbortSignal` as parameter in reusable async functions.
- Check `signal.aborted` before updating state after await.
- Catch `AbortError` separately and ignore it silently (not a real error).
- Use `AbortSignal.any([signal, AbortSignal.timeout(ms)])` for timeout + manual abort.

## Import style

Type-only imports and import ordering are enforced by ESLint.

```typescript
import type { ServerDuplexStream } from "@grpc/grpc-js";
import type { CharacterTextureMessage } from "@workadventure/messages";

import { AvailabilityStatus } from "@workadventure/messages";

import { PlayerVariables } from "../Services/PlayersRepository/PlayerVariables";
```

## Naming conventions

- Match the established convention in the surrounding module.
- Classes and Svelte components generally use PascalCase filenames.
- Utility modules may use camelCase filenames.
- Store filenames and exported store values generally use the `Store` suffix when they represent a Svelte store.

## Formatting (Prettier)

- Print width: 120 characters
- Tab width: 4 spaces
- EOL: newline at end of file

## ESLint key rules

- `@typescript-eslint/no-explicit-any`: no `any`
- `@typescript-eslint/consistent-type-imports`: require type imports
- `no-throw-literal`: throw `Error` objects only
- `rxjs/no-ignored-subscription`: handle RxJS subscriptions
- `svelte/require-each-key`: keys required in Svelte each blocks

## TypeScript 7 and svelte-check

Checked on 2026-11-22 against the sources named on each line, and re-checked after review the same day. The open work is item T-154 (adoption) and T-162 (commit of this section) in `docs/TODO.md`. This section settles a disagreement: an earlier note said
"svelte2tsx crashes on TypeScript 7, issue #3063", and the owner said svelte-check already works with TypeScript 7. Both
are true. They describe two different setups. Nothing in this tree was changed or measured for this section.

### What works today

- `svelte-check` runs with TypeScript 7 when TypeScript 7 is installed under an npm alias and TypeScript 6 stays as the
  package named `typescript`, with the flag `--tsgo` or `--tsgo-experimental-api`. Maintainer statement:
  <https://github.com/sveltejs/language-tools/issues/3063#issuecomment-5472405798> (comment by `jasonlyu123`, 2026-08-31,
  "svelte-check currently has --tsgo and --tsgo-experimental-api flags"; open issue: <https://github.com/sveltejs/language-tools/issues/3063>).
- Independent check by a user on 2026-10-22 (svelte-check 4.7.7, macOS arm64, Node 24): with TypeScript 7.0.2 as `typescript`,
  `svelte-check` exits with the alias instructions; with TypeScript 6.0.3 plus `@typescript/native@npm:typescript@7.0.2`, the
  default run, `--incremental`, `--tsgo` and `--tsgo-experimental-api` all report the same expected error on a two-component
  fixture. The same user notes that `svelte2tsx` still imports TypeScript before its `emitDts` guard, so the original
  `svelte-package` failure is not proven fixed
  (<https://github.com/sveltejs/language-tools/issues/3063#issuecomment-6341972121>). We do not run `svelte-package`.
- The setup the maintainers document, in the README and in the error text that `svelte-check` prints:
  `npm install --save-dev typescript@~6 @typescript/native@npm:typescript@7`.
  Source: <https://github.com/sveltejs/language-tools/blob/master/packages/svelte-check/README.md> (section "TypeScript 7 supports")
  and `packages/svelte-check/bin/ts-version-check.js` (upstream path, in the `sveltejs/language-tools` repository, not in this tree) on the same branch.
- Since which version:
  - `4.7.0`: `--tsgo-experimental-api` added (PR 3036); `4.7.1` and `4.7.2` fixed its flag parsing and bin path (PRs 3067, 3074).
  - `4.7.4` (npm, 2026-07-27): "support TypeScript 7 Stable under npm alias" (PR 3073, merged 2026-07-27).
    PR 3073 added a version check in `bin/svelte-check` that throws a clear error for TypeScript 7 as `typescript`, and
    made `svelte-check` find TypeScript 7 as `@typescript/native` or `@typescript/native-preview`.
  - `4.7.8` (npm, 2026-11-01): `--tsgo-experimental-api` follows the TypeScript 7.1 API (PR 3168, merged 2026-10-29). For a
    TypeScript 7.0.x install it loads `<package>/unstable/sync`; for 7.1 and later it loads `<package>/sync`
    (`packages/svelte-check/src/tsgo.ts` in the upstream `sveltejs/language-tools` repository, function `shouldLoadStableApi`). The package's own smoke test uses
    `"@typescript/native": "npm:typescript@7.0.2"` with `"typescript": "^6.0.3"` (its `package.json`, also in our
    `node_modules/svelte-check/package.json`).
  - Sources: <https://github.com/sveltejs/language-tools/blob/master/packages/svelte-check/CHANGELOG.md>,
    <https://github.com/sveltejs/language-tools/pull/3073>, <https://github.com/sveltejs/language-tools/pull/3168>,
    <https://www.npmjs.com/package/svelte-check>.
- The two flags differ (maintainer, same comment on issue 3063): `--tsgo` runs the `tsgo` binary and is slightly faster, but
  has limits; `--tsgo-experimental-api` uses an experimental API "that might break before TypeScript 7.1". They cannot be
  combined with each other, and `--tsgo-experimental-api` cannot be combined with `--incremental`
  (`packages/svelte-check/src/options.ts`, upstream). `--tsgo` writes the transpiled Svelte files to disk, in `.svelte-kit` if it exists,
  else in `.svelte-check`, and has the same limits as `--incremental`
  (<https://github.com/sveltejs/language-tools/blob/master/packages/svelte-check/README.md>, table of flags; the README row
  for `--tsgo` still says `@typescript/native-preview`, while the code looks for `@typescript/native` first).

### What does not work

- TypeScript 7 installed as the package named `typescript`. `svelte-check@4.7.8` declares the peer
  `"typescript": "^5.0.0 || ^6.0.0"` (<https://www.npmjs.com/package/svelte-check>), its start script throws for major 7, and the
  original crash is the issue title: "Typescript 7 crashes svelte2tsx and svelte-check" (still open, 2026-06-18,
  <https://github.com/sveltejs/language-tools/issues/3063>). A user report of the crash, "Cannot read properties of undefined
  (reading 'useCaseSensitiveFileNames')", is in the same thread.
- The cause is upstream, not ours. TypeScript 7.0 "does not ship with an API"; Microsoft expects a different API in 7.1 and
  says that Svelte projects "will need to continue using TypeScript 6.0 for now"
  (<https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>, published 2026-07-08, sections "Running Side-by-Side
  with TypeScript 6.0" and "TypeScript and Embedded Languages"). `svelte2tsx` (bundled in `svelte-check`; peer
  `^4.9.4 || ^5.0.0 || ^6.0.0`, <https://www.npmjs.com/package/svelte2tsx>) imports the TypeScript 6 API at the top of its modules.
- The alternative setup, TypeScript 7 as `typescript` plus `@typescript/typescript6` beside it, is not supported by the
  maintainers. They said it breaks `svelte-kit sync` and typescript-eslint, and that they chose the other direction
  (comment by `jasonlyu123`, 2026-10-24, <https://github.com/sveltejs/language-tools/issues/3063#issuecomment-6384121401>). A contributor ran it with local patches to `svelte-check`; no patch was merged.
- The reverse of the Microsoft recipe is what `svelte-check` supports: Microsoft shows `"typescript":
"npm:@typescript/typescript6@^6.0.2"` with `"@typescript/native": "npm:typescript@^7.0.2"`
  (<https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>). Whether `svelte-check@4.7.8` accepts that
  alias for `typescript` is **to verify** (try it in a scratch copy; commands below).

### What each of our tools needs

Installed today in this tree (HEAD `33f411f2f`): `typescript` 5.9.3, `svelte-check` 4.7.8, `typescript-eslint` and `@typescript-eslint/parser`
8.73.0 (`node_modules/typescript-eslint/package.json`; `libs/eslint-config` declares `^8.73.0` since `50e6f8789`), `vite` ^8.3.8, `vitest` ^4.1.7, `@sveltejs/vite-plugin-svelte` ^7.3.1 (`package.json`, `play/package.json`,
`node_modules/*/package.json`).

| Tool                                             | Where it runs here                                                              | Needs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Source                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`                                   | `play` script `typecheck`, `back` through `scripts/gate.sh`                     | `tsc` from TypeScript 7 works for plain `.ts`. Its `.svelte` imports use the Svelte ambient shim, as today. TypeScript 7 turns the options deprecated in 6.0 into hard errors (`baseUrl`, `moduleResolution: node10` and `classic`, `target: es5`, `downlevelIteration`). Our tsconfigs use `moduleResolution: bundler` and `paths` without `baseUrl` (`play/tsconfig.json`, `back/tsconfig.json`), so none is expected to fail, **to verify**. The `types` default also changed: list needed `@types` packages explicitly.                                                                                                                                                                                                                                                                                  | <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/> (section on breaking changes) |
| `svelte-check`                                   | `play` script `svelte-check` (`--fail-on-warnings`), lint-staged for `*.svelte` | Both packages: `typescript` at 6.x and `@typescript/native` as an alias of `typescript@7`, plus `--tsgo-experimental-api` (or `--tsgo`). Without the flag it still uses TypeScript 6 and gains nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | README and issue 3063 comments, linked above                                                         |
| `typescript-eslint`                              | `eslint` in `play` and `back`, `libs/eslint-config`                             | `typescript` must be below 6.1. `typescript-eslint@8.73.0` declares `"typescript": ">=4.8.4 <6.1.0"`, so it accepts 6.0.x and rejects 7. It needs the TypeScript 6 API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | <https://www.npmjs.com/package/typescript-eslint>                                                    |
| `vite` and `vitest`                              | `play` build, tests                                                             | No TypeScript dependency: `vite@8.3.8` and `vitest@4.1.7` list no `typescript` peer; `@sveltejs/vite-plugin-svelte@7.3.1` peers are `vite` and `svelte` only. They transpile with their own tools, so the TypeScript version does not change them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `npm view <package> peerDependencies` on 2026-11-22                                                  |
| `typesafe-i18n`                                  | `play` script `typesafe-i18n`, first step of the gate                           | Peer `"typescript": ">=3.5.1"`, so npm accepts any version. It reads the TypeScript API, so it must keep resolving TypeScript 6 as `typescript`. Behavior on 6.x is known from prior art: the master-branch upgrade tip `dba158e7d` (TypeScript 6.0.3; in the object store, not an ancestor of HEAD) was red at `2c098b31d` until `patches/typesafe-i18n+5.27.1.patch` set `module: ts.ModuleKind.CommonJS` in typesafe-i18n's transpile step (TypeScript 6 defaults `module` to ESNext, whose extensionless imports Node cannot load); the root `postinstall` applies it with `patch-package`. Source: the main checkout's `docs/integration/STATE.md`, queue item 2, and `git show dba158e7d:patches/typesafe-i18n+5.27.1.patch`. Our HEAD has no such patch (`patches/` holds only `phaser+4.2.1.patch`). | `npm view typesafe-i18n peerDependencies`                                                            |
| `svelte-eslint-parser`, `prettier-plugin-svelte` | `eslint`, `prettier`                                                            | Peers are `svelte` only (`svelte-eslint-parser`). Whether they load `typescript` at run time: **to verify**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `npm view svelte-eslint-parser peerDependencies`                                                     |

Packages for the two-version setup, from npm on 2026-11-22: `typescript` latest `7.0.2` (published 2026-07-08), `7.1.0-beta`
(2026-10-20), 6.x line ends at `6.0.3` (2026-04-16); `@typescript/typescript6` `6.0.2` (bin `tsc6`); `@typescript/native-preview`
latest is `7.0.0-dev.20260707.2` (old preview name, no longer the path to follow). The name `@typescript/native` is only an npm
alias name chosen by Microsoft and by `svelte-check`, not a published package; an install of `@typescript/typescript7`
returns 404.

### Expected gain, and where the number comes from

None of these numbers was measured by us.

- Microsoft, whole-program `tsc` builds, TypeScript 6 against 7: `vscode` 125.7 s to 10.6 s (11.9x), `sentry` 139.8 s to
  15.7 s (8.9x), `bluesky` 8.7x, `playwright` 8.7x, `tldraw` 7.7x
  (<https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>). This is the `tsc --noEmit` step only.
- A third-party SvelteKit app of about 1,000 components: `pnpm typecheck` from about 97 s to about 30 s, and
  `svelte-check --tsgo-experimental-api` at 12 to 22 s over five runs (comment by `xyrolle`, 2026-10-24, <https://github.com/sveltejs/language-tools/issues/3063#issuecomment-6383944138>; the setup
  there has `typescript` at 7 with local patches, which we must not copy). A pull request on `--tsc-rs` (a Rust port, not TypeScript) reports
  about 20% faster than `--tsgo` on a small app (<https://github.com/sveltejs/language-tools/pull/3144>, open).
- Our baseline, from the latest local gate log (`<git-dir>/gate-logs/play`, 2026-11-22 12:00, run beside the other gate steps,
  so it is an upper bound; each `*.result` file reads `<exit> <seconds>`): `typecheck` 153 s, `svelte-check` 196 s for 6,283 files,
  0 errors, 0 warnings (`svelte-check.log`: `COMPLETED 6283 FILES 0 ERRORS 0 WARNINGS`). The log of the same morning at 11:10 read 175 s, 273 s
  and 6,241 files: the file count moves with the tree, so it must be re-taken on the same tree at adoption time. The last
  integration check on record counted 5,775 files (`docs/integration/STATE.md`, at `ce6ece405`). The gain for us is
  unknown until the commands below are run once with the old and once with the new setup.

### Risks and upstream items to watch

- Experimental by the maintainers' own words: `--tsgo-experimental-api` "might break before TypeScript 7.1"; the flag was
  re-targeted once already (PR 3168). Pin exact versions of `svelte-check`, `typescript` and the alias in the lockfile.
- Open `tsgo` issues that can change results: 3156 (a relative `compilerOptions.types` entry makes `--tsgo` and `--incremental`
  skip all semantic checks), 3157 (errors from deleted components), 3185 (`--tsgo` exits 0 when a component fails to parse),
  3187 (import of a missing `.svelte` file is not reported), 3202 (slow and out of memory with about 1,000 errors in one
  component), 3159 (lowercased diagnostic paths on case-insensitive file systems, relevant on macOS), 3095 (crash on
  Linux arm64 CI, `--tsgo-experimental-api`). All at <https://github.com/sveltejs/language-tools/issues/NNNN>.
- The gate needs "zero errors" to mean "checked everything". Issues 3156 and 3185 mean a green run can hide missing checks, so
  keep the file count comparison below as part of the gate.
- Pending work that removes the two-version setup: PR 3196 "add svelte2tsx tsgo entry point" (open) and PR 3193 "proper
  tsgo support in svelte-check" (open, marked WIP by its author). Merged parts: PR 3111 (TypeScript 7 content mapper, editor
  support; `svelte-check` support is a separate change per PR 3168), PR 3183 (component references). Read 3196 and 3193
  before upgrading: they may change the install recipe.
- Open issues 3191 (detect `tsrs`, a Rust port, as TypeScript 7) and 3207 (the content mapper rejects a `.svelte` file whose text
  starts with an emoji; fix proposed in PRs 3208 and 3209) are not blockers for us unless we use `tsrs` or the content
  mapper. Both are issues, not pull requests.
- `typescript-eslint` stays on TypeScript 6 until it supports the 7.1 API; its newest `@typescript-eslint/typescript-estree`
  already lists an optional `@typescript/native` peer of `7.1.0-beta` or later, which suggests work in progress
  (`npm view @typescript-eslint/typescript-estree@8.73.0 peerDependencies`). Not a promise; watch the release notes.

### Adopting it here (checklist)

Do this in a branch, one package at a time. Nothing below has been run.

- [ ] Try it in a scratch copy first, not in this tree (needs the user's go-ahead for installs): a scratch copy of `play`, then
      `npm install --save-dev typescript@~6 @typescript/native@npm:typescript@7`, then `npx svelte-check --tsgo-experimental-api`
      and `npx svelte-check --tsgo`. Done when `scripts/gate.sh play` and `scripts/gate.sh back` are green, `svelte-check` reports 0 errors
      and 0 warnings on the same number of files as the old setup, and the timings are written down (the last three checklist
      lines). Mark **to verify** items in this section as done or false. This is item T-154 in `docs/TODO.md`.
- [ ] Carry the typesafe-i18n fix into the setup: with TypeScript 6 as `typescript`, the `typesafe-i18n` step needs
      `patches/typesafe-i18n+5.27.1.patch` (prior art: tip `dba158e7d`, see the table above), and `play/tsconfig.json` needed
      `types: ["node"]`, `rootDir`, `allowImportingTsExtensions` and `noEmit` there (`git diff 78f3f2528 dba158e7d -- play/tsconfig.json`).
- [ ] Also try Microsoft's alias form in the scratch copy: `typescript` as `npm:@typescript/typescript6@^6.0.2` and
      `@typescript/native` as `npm:typescript@^7.0.2`. Record whether `svelte-check` and `typescript-eslint` accept it. This is the
      only way to keep `tsc` as TypeScript 7 without a bin name clash, because `typescript@6` and `typescript@7` both provide `tsc`.
- [ ] Move `typescript` from `^5.9.3` to `~6.0` first, alone. Run the gate (below). This step is useful even if the rest fails:
      `svelte-check@4.7.8` and `typescript-eslint` accept 6.0.x.
- [ ] Add the `@typescript/native` alias. Decide which command runs TypeScript 7 `tsc`: `node_modules/@typescript/native/bin/tsc`
      by path, until the bin clash is understood.
- [ ] Change the `play` script `svelte-check` to add `--tsgo-experimental-api`. Keep `--fail-on-warnings`. Do not use
      `--incremental` with it. Keep the lint-staged entry on the TypeScript 6 path until the gate is stable.
- [ ] Gate that must pass, from the repository root, with Node 24:
      `scripts/gate.sh play` and `scripts/gate.sh back`. Read the printed lines: `typecheck`, `svelte-check`, `eslint`,
      `prettier` and `vitest` all `exit=0`.
- [ ] `svelte-check` must report zero errors and zero warnings and the same file count as the old setup on the same tree
      (the log line `COMPLETED <n> FILES 0 ERRORS 0 WARNINGS` in `<git-dir>/gate-logs/play/svelte-check.log`; 6,283 at 12:00 on 2026-11-22,
      6,241 earlier that day). Take both counts on the same tree at the same time. A lower count fails the gate even with zero errors.
- [ ] Prove that it still finds errors: add one deliberate type error in a `.svelte` file and in a `.ts` file in a scratch
      change, confirm both are reported, then remove them.
- [ ] Write the timings (old and new, same machine, `GATE_SERIAL=1`) in this section, then replace the "not measured by us" note.
- [ ] Record in `docs/integration/STATE.md` the exact versions installed and the gate result.

### Sources

- <https://github.com/sveltejs/language-tools/issues/3063> (issue and maintainer comments)
- <https://github.com/sveltejs/language-tools/pull/3073>, <https://github.com/sveltejs/language-tools/pull/3111>,
  <https://github.com/sveltejs/language-tools/pull/3168>, <https://github.com/sveltejs/language-tools/pull/3183>
- <https://github.com/sveltejs/language-tools/issues/3191>, <https://github.com/sveltejs/language-tools/issues/3207>,
  <https://github.com/sveltejs/language-tools/pull/3193>, <https://github.com/sveltejs/language-tools/pull/3196>
- <https://github.com/sveltejs/language-tools/blob/master/packages/svelte-check/README.md>,
  <https://github.com/sveltejs/language-tools/blob/master/packages/svelte-check/CHANGELOG.md>
- <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>
- <https://www.npmjs.com/package/svelte-check>, <https://www.npmjs.com/package/svelte2tsx>,
  <https://www.npmjs.com/package/typescript>, <https://www.npmjs.com/package/typescript-eslint>,
  <https://www.npmjs.com/package/@typescript/typescript6>
