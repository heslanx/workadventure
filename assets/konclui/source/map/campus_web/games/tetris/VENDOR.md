# Tetris vendor notes

- **Origin:** https://github.com/jakesgordon/javascript-tetris
- **Commit:** `e5c0c42f7dac0f3514a55eff656c6e22e95d68ed` (2025-06-01, shallow clone in `.scratch/office-redesign/vendor-src/javascript-tetris/`)
- **License:** MIT, Copyright (c) 2011-2016 Jake Gordon and contributors. Kept as `vendor/LICENSE`.

## Copied

The game script of the original `index.html` (everything between `<script>` and `</script>`), now `vendor/tetris.js`.

## Not copied

`stats.js` (FPS counter), `texture.jpg` (45 KB court background), the original page and its media queries.

## Changes to the copied code (each marked "Koncluí")

| Change | Why |
|---|---|
| Wrapped in a function; exposes `window.Tetris` (`play`, `pause`, `resume`, `act`, `resize`, `hooks.onState/onEnd`, read-only `score/rows/state/running/piece/court`, test hook `forceLose`) | The page glue drives the UI and the campus board |
| `requestAnimationFrame` loop replaced by `KG.loop`, started by `play()`, stopped by `pause()` and `lose()` | Zero CPU while idle, paused or over; hidden tab sleeps; 30 fps on the light profile (`BACKLOG.md` section 3) |
| FPS counter and the rAF polyfill removed | Not needed |
| Canvas sized by the stage (`#stage`) and by `devicePixelRatio` (1 on the light profile) instead of media queries; one block is a whole number of CSS px | Scales to the modal, crisp on retina |
| Next-piece preview has its own block size and is centered on the piece's real bounding box | The preview lives in the side panel |
| Palette from the platform, flat blocks with a light top and dark bottom edge, faint court grid | Look |
| Score shown as is (no slot-machine counting), formatted pt-BR; `textContent` instead of `innerHTML` | Simpler, safe |
| Pause on P / Esc (Space resumes) instead of "Esc loses"; ignores keys with Ctrl/Cmd/Alt | A game cannot be lost by accident |
| `Tetris.act(dir)` | One entry for keys, the on-screen pad and swipes |

## What is ours (`index.html`)

Layout (court + side panel with score, rows, next piece, campus board, "Jogar de novo"), veil for start, pause and game over with the
rank text ("Você entrou em 3º lugar!" / "Faltaram X pontos para o top 10."), `kg-pad` (left, rotate, right, down; left, right and down repeat
while held), swipes on the court for touch (tap turns, dragging moves one block per block of travel), `KG.board("recordesTetris")`,
`window.__game`.
