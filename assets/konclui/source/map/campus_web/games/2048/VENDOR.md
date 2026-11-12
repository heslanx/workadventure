# 2048 vendor notes

- **Origin:** https://github.com/gabrielecirulli/2048
- **Commit:** `478b6ec346e3787f589e4af751378d06ded4cbbc` (2024-10-24, shallow clone in `.scratch/office-redesign/vendor-src/2048/`)
- **License:** MIT, Copyright (c) 2014 Gabriele Cirulli. Kept as `vendor/LICENSE.txt`.

## Copied (`vendor/js/`)

`game_manager.js`, `grid.js`, `tile.js`, `keyboard_input_manager.js`, `html_actuator.js`, `local_storage_manager.js`.

## Not copied

`meta/` (app icons and splash images), `favicon.ico`, `style/` (webfonts `.eot/.svg/.woff`, `main.scss`, compiled `main.css`),
the three IE polyfills (`bind`, `classList`, `requestAnimationFrame`) and `application.js` (the glue in `index.html` starts the game),
the original page text, footers and links.

## Changes to the copied code (each marked "Koncluí" where it is more than a string)

| File | Change | Why |
|---|---|---|
| `game_manager.js` | `onEnd(score)` hook, called once per finished run: on game over, or when "play again" drops a run that reached 2048 (`report()`, `reported` flag) | Feeds the campus top 10 (`recordes2048`) |
| `local_storage_manager.js` | Only the personal best is stored, under `kg:2048:best`; the run in progress is no longer saved | The campus board replaces the old best score; a run ends with the window |
| `html_actuator.js` | Result messages in pt-BR; score, addition and best formatted with `toLocaleString("pt-BR")` | Same number format as the campus board |

## What is ours (`index.html`)

Markup keeps the original class names (`grid-container`, `tile-container`, `tile-N`, `tile-position-X-Y`, `game-message`, `*-button`) so the
original JS runs unchanged. The stylesheet is rewritten (not derived from `main.css`): square board sized by the stage with container query
units, tiles placed with custom properties, platform dark tokens, tile ramp from dark teal to mint (`#53FFC8` from 256 up). Animations are off on
the light profile (`html.leve`). The glue wires `KG.chrome`, the board `recordes2048` (`KG.board`), rank text, focus on the stage, and
`window.__game` (`score()`, `over()`, `move(dir)`, `tiles()`, `layout(values)`, `forceGameOver(score)`).
No frame loop: the game is DOM + CSS transitions, so it costs nothing while idle.
