# Xadrez: vendored sources

Imported 2026-10-11 ("import the ready-made ones and add our touch"). Downloaded into
`.scratch/office-redesign/vendor-src/` (never built or run there), copied here without a build step.

| Piece | Origin | Pinned | License | Where |
|---|---|---|---|---|
| Rules | https://github.com/jhlywa/chess.js | tag `v1.4.0`, commit `ce1ff9e9fc342984ff75ca475ab39f37888cb28a` | BSD-2-Clause | `vendor/chess.js/` |
| Board UI | https://github.com/shaack/cm-chessboard | `8.15.3`, commit `be441fa1acc322c02cd6afae6ed99a51c8b93faa` | MIT | `vendor/cm-chessboard/` |
| Engine (Koru) | https://github.com/josefjadrny/js-chess-engine | tag `v2.4.6`, commit `25c8a1f077b81999faa78d504c74ec42639903b1` | MIT | `vendor/js-chess-engine/` |
| Piece art | `cm-chessboard/assets/pieces/standard.svg`, Cburnett and Rfc1394 (Wikimedia Commons) | with cm-chessboard | CC BY-SA 3.0 | `vendor/cm-chessboard/assets/pieces/` |

Each library keeps its `LICENSE` next to it. The piece art is credited in the page footer (CC BY-SA 3.0 asks for credit; the
adapted sprite stays under the same license).

## What was copied

- **chess.js**: `dist/esm/chess.js` of the npm package `chess.js@1.4.0` (the git repository ships no built file). The package's
  `src/chess.ts` is identical to the tag's (`git show v1.4.0:src/chess.ts` diff is empty). Unchanged.
- **cm-chessboard**: `src/{Chessboard.js,lib,model,view}`, the extensions `markers`, `promotion-dialog` and `accessibility`
  (keyboard move input), `assets/chessboard.css`, `assets/pieces/standard.svg`, `assets/extensions/markers/{markers.css,markers.svg}`,
  `assets/extensions/promotion-dialog/promotion-dialog.css`. Left out: SCSS and source maps, the other extensions, the
  `staunty.svg` set (**CC BY-NC-SA 4.0, non-commercial**: not usable in a company's product), examples, tests.
- **js-chess-engine**: the `dist/` CommonJS output of the npm package `js-chess-engine@2.4.6` (the git repository ships only
  TypeScript), wrapped by the recipe below into `vendor/js-chess-engine/engine.bundle.js`. Left out: `.d.ts`, source maps,
  `core/index.js` (nobody requires it).

## What was changed (minimal)

- `cm-chessboard/src/extensions/{accessibility/I18n.js,accessibility/Accessibility.js,promotion-dialog/PromotionDialog.js}`:
  added a `pt` (pt-BR) entry to each translation table and let `language: "pt"` through the `de`/`en` check. Marked
  `// Koncluí: pt-BR added`. Without it the keyboard announcements and the promotion dialog read in English.
- `engine.bundle.js` is generated, not edited: every `dist/**/*.js` file verbatim inside
  `"<path>": function (exports, require, module) { ... }` in one table, `self.__cjsModules`; only the
  `//# sourceMappingURL=` lines are dropped. Why: the engine is CommonJS with `exports.X` references inside functions, which a
  plain `importScripts()` cannot support (the globals change per file); a Web Worker needs function scopes. The alternatives
  were a bundler (a build step) or another engine (a UCI single-file engine like Lozza would need its own protocol and strength-limiting layer; js-chess-engine takes a FEN and a level from 1 to 5). The wrapper resolves `require()` in
  `engine-worker.js`. Recipe (repo root, `$DIST` = the unpacked `package/dist`):

  ```sh
  { printf '%s\n' "// js-chess-engine 2.4.6 ... Do not edit."; printf 'self.__cjsModules = {\n'
    (cd "$DIST" && find . -name '*.js' ! -path './core/index.js' | sed 's#^\./##' | sort) | while read -r f; do
      printf '"%s": function (exports, require, module) {\n' "${f%.js}"
      grep -v '^//# sourceMappingURL=' "$DIST/$f"; printf '\n},\n'
    done; printf '};\n'; } > vendor/js-chess-engine/engine.bundle.js
  ```

## Our glue

`index.html` (table over `KG.table("mesaXadrez")`, solo mode, theme, test hooks), `engine-worker.js` (Koru's search off the
main thread). Koru levels: Fácil = engine level 1 with 80 cp of randomness, Médio = level 3 with 30 cp, Difícil = level 5.

## Network scan

`rg -n "fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?://" games/xadrez/` finds nothing that leaves the origin:

- `XMLHttpRequest` in `cm-chessboard/src/view/ChessboardView.js`: loads the piece and marker sprites from
  `vendor/cm-chessboard/assets/` (same origin, relative `assetsUrl`).
- `https://work.konclui.com/iframe_api.js` in `index.html`: the office's own WorkAdventure API script (the test answers it empty).
- Everything else is license headers, comments and the SVG/XML namespace `http://www.w3.org/2000/svg`.

`tests/games_check.py` fails on any request that leaves 127.0.0.1.
