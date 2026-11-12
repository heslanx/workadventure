# Breakout vendor notes

- **Origin:** https://github.com/jakesgordon/javascript-breakout
- **Commit:** `eed59e2affa9423b93d2ac8ff93061bb88b33284` (2025-06-01, shallow clone in `.scratch/office-redesign/vendor-src/javascript-breakout/`)
- **License:** MIT, Copyright (c) 2011-2016 Jake Gordon and contributors. Kept as `vendor/LICENSE`. That file also says the original sound
  effects are Freesound clips under CC BY-ND 2.0: **they are not copied** (see below).

## Copied (`vendor/`)

`game.js`, `breakout.js`, `levels.js`.

## Not copied

`sound/` (SoundManager 2 and the mp3 files), `images/` (`paving.jpg` 197 KB, level arrows), `packaged/` (Chrome app, 1 MB), `breakout.css`,
the original `index.html` (level picker, sound checkbox, instructions box).

## Changes to the copied code (each marked "Koncluí")

| File | Change | Why |
|---|---|---|
| `game.js` | `Game.Runner` runs on `KG.loop`: `start()` when a game begins, `stop()` on pause, menu and game over, instead of a `setInterval` that never stopped | Zero CPU outside play; hidden tab sleeps; 30 fps on the light profile |
| `game.js` | Backing store = CSS size x pixel ratio (1 on the light profile); `canvasX()` maps pointer coordinates; `resize()` called by the page glue, no window resize listener | Crisp canvas that scales to the stage |
| `game.js` | Removed sound/script/image loaders, `storage()`, FPS stats, blocking `alert/confirm`; arrows and Space never scroll the page | No external loads, no localStorage |
| `breakout.js` | Palette from the platform; canvas fonts in px, sized by the court chunk, brand font; labels in pt-BR ("prontos... atenção... vai!") | Look |
| `breakout.js` | Court chunk fits a 32 x 29 chunk canvas (30 x 25 court + walls + score bar) | The canvas follows the court instead of a 4:3 box |
| `breakout.js` | Pause on P / Esc (Space resumes); `restart()`; pointer events move the paddle (mouse, pen, touch), a press launches the ball | Controls |
| `breakout.js` | Every game starts at level 1; level picker, `localStorage` (level, sound, high score) and all sound calls removed | Fair campus board |
| `breakout.js` | The score bar shows "RECORDE" = the campus record (`setRecord`); hooks `onGameOver`, `onpause`, `onlevel`, `onscore`, `refont` | Glue with the campus board |
| `levels.js` | All brick colors remapped to the platform palette, same letters and layouts | Look |

## What is ours (`index.html`)

Layout (court 32:29 sized by the stage, side panel with score, level, campus board, "Jogar de novo"), veil for start, pause and game over with the
rank text, `KG.board("recordesBreakout")`, resize observer, `window.__game` (`score()`, `lives()`, `level()`, `state()`, `running()`,
`ballMoving()`, `paddle()`, `court()`, `record()`, `forceGameOver(score)`).
