# Pingue-pongue vendor notes

- **Origin:** https://github.com/jakesgordon/javascript-pong
- **Commit:** `ca3240536e4f79ab7144388e56ed19de715b6662` (2025-06-01, shallow clone in `.scratch/office-redesign/vendor-src/javascript-pong/`)
- **License:** MIT, Copyright (c) 2011-2016 Jake Gordon and contributors. Kept as `vendor/LICENSE`.

## Copied (`vendor/`)

`game.js` (trimmed), `pong.js`.

## Not copied

`index.html` (sidebar, links to the tutorial parts, settings), `pong.css`, `images/` (`press1.png`, `press2.png`, `winner.png`: the menu is now a
veil in our page), `sounds/` (four wav files: no sound in campus games), `part1` to `part5` (tutorial pages).

## Changes to the copied code (each marked "Koncluí")

| File | Change | Why |
|---|---|---|
| `game.js` | `Game.Runner` draws on `KG.loop`: `start()` when a game begins, `stop()` on pause and game over, instead of a `setInterval` that never stopped | Zero CPU outside play; hidden tab sleeps; 30 fps on the light profile |
| `game.js` | Backing store = CSS size x pixel ratio (1 on the light profile), drawing scaled from the 640 x 480 logical court; `courtPoint()` maps pointer coordinates; `resize()` called by the page glue | Crisp canvas that scales to the stage |
| `game.js` | Removed image and audio loaders, FPS stats, blocking `alert/confirm`, the unused key codes; arrows and Space never scroll the page | No external loads, no sound |
| `pong.js` | One human (left) against the Koru (right, the original AI), first to 7 (was 9); no menu, no demo mode, no two-player mode | The campus board needs a single player against the owl |
| `pong.js` | Palette from the platform (rails and dashes, mint for you, the Koru's orange for her paddle and score); the Koru's badge and name and your name under the scores | Look and brand |
| `pong.js` | Ball crosses the court in 3 s (was 4), accelerates at 10 (was 8), paddles cross it in 1.6 s (was 2) | Faster rallies for a campus break; checked with scripted players: a tracker with +-22 px of error wins 19 of 20, +-34 px loses all, the Koru's rubber band is untouched |
| `pong.js` | `Paddle.reset()`, `Paddle.aim(y)` (pointer control at twice the keyboard speed; up/down still drive the spin), `level()` clamped to the 17-entry table | Mouse and touch control |
| `pong.js` | 0.8 s serve wait before every serve; `start()`, `finish()`, `pause()`; keys W/S/arrows, Space/Enter start and resume, P/Esc pause | Controls and flow; hooks `onplay`, `onpause`, `onscore`, `ongameover` for the page |
| `pong.js` | Removed sounds, footprints, predictions overlay, stats; implicit globals (`pos`, `dh`, `w = h`) declared | Dead options; no globals leaking |

The AI (`Paddle.ai`, `predict`), the ball physics and `Pong.Helper` are unchanged.

## What is ours (`index.html`)

Layout (court 4:3 sized by the stage, side panel with the score line, campus board, "Pausar" and "Jogar de novo"), the veil for start, pause and
game over, pointer control (the mouse over the whole court, a finger only on the left half), `KG.board("recordesPong")`, resize observer,
`window.__game` (`state()`, `running()`, `score()`, `paddle()`, `koru()`, `ball()`, `court()`, `simulate(seconds)`, `aim(y)`, `forceGameOver(you, koru)`).

## The board `recordesPong`

Points = the **saldo** (points scored minus points conceded) of a **win**, from 1 to 7. Only wins are saved; a loss shows "A Koru venceu" and
touches nothing. Ties keep the earlier row first (the kit's rule), so once the top 10 is all 7 x 0 nobody can enter: the page says so
("O top 10 já está cheio de goleadas de 7 a 0.") instead of promising points that cannot exist. A richer score (win streak, time) would need a
different board shape; the saldo keeps the board readable and the page honest.
