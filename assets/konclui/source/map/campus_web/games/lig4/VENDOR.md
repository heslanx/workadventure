# Lig 4: vendored sources

Imported 2026-10-11 ("import the ready-made ones and add our touch"). Downloaded into
`.scratch/office-redesign/vendor-src/connect-four/` (never built or run there), copied here without a build step.

| Origin | Pinned | License | Where |
|---|---|---|---|
| https://github.com/bryanbraun/connect-four | commit `ee62db41dc9b32a5e5ebf20b876809c9c3e0db6b` (2022-05-21, no tags) | MIT | `vendor/connect-four/` |

The `LICENSE` of the origin sits next to the files.

## What was copied (unchanged)

- `js/vars.js`: the `Game` namespace, config (7 columns, 6 rows, four to win) and the board array.
- `js/functions.js`: the rules, `Game.check.isVerticalWin / isHorizontalWin / isDiagonalWin / isGameADraw` and `Game.do.dropToBottom`.
  The win and draw verdict of the table, of solo play and of Koru's search all come from these functions.
- `js/accessibility.js`: arrow-key navigation over the board's buttons (the page keeps the origin's markup: a `table#board` of
  `button`s, and `<style id="a11y-styles">`).

Left out: `js/main.js` (hot-seat game flow: `alert()`, `location.reload()`, editable names), `css/main.css` (white page, red and
black discs: replaced by the campus theme), `index.html`, the Google Fonts link (`fonts.googleapis.com`), `img/arrow-keys.svg`,
`favicon.ico`.

## What was changed

Nothing in the vendored files. Our additions live in `index.html` (the glue) and `ai-worker.js`:

- the table over `KG.table("mesaLig4")`: seats, spectators, resign, W.O., new game, a strict `validState`;
- `fours()`: finds the cells of every four in a row. The origin only answers true or false, and the page needs the cells to light
  up the winning four, and to refuse a shared state in which both players have one. A test checks it against the origin's verdict
  on known positions (horizontal, vertical, both diagonals, no win, full board);
- theme (navy board, menta and gold discs, drop animation, column highlight, drop preview) and the Koru panel;
- `ai-worker.js`: negamax with alpha-beta, off the main thread. The search loads the origin's `vars.js` and `functions.js` with
  `importScripts()` and calls `Game.check.*` for wins; only the position score is ours. Levels: Fácil = depth 2 and a 30% chance of
  a random column, Médio = depth 4, Difícil = depth 6.

## Network scan

`rg -n "fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?://" games/lig4/` finds only
`https://work.konclui.com/iframe_api.js` in `index.html` (the office's own WorkAdventure API script; the test answers it empty).
`tests/games_check.py` fails on any request that leaves 127.0.0.1.
