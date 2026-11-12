# Sinuca: vendored from Classic-Pool-Game

| | |
|---|---|
| Origin | github.com/henshmi/Classic-Pool-Game |
| Commit | `f60e9b824648faabe1d931e9116b20333559da2a` (2020-02-07, "Merge pull request #2 from henshmi/imgbot") |
| License | MIT, (c) 2018 Chen Shmilovich. Copy in `vendor/LICENSE.txt` |
| Cloned at | `.scratch/office-redesign/vendor-src/Classic-Pool-Game/` (shallow, never built or run) |

Upstream is a plain-canvas 8-ball game (7 red, 7 yellow, 1 black, a white cue ball) with hot-seat and an AI. It is built
around global singletons (`Game`, `Mouse`, `Keyboard`, `Canvas2D`, `sounds`, `AI`), so the physics, the table geometry
and the AI search are kept and decoupled, and everything around them is replaced by the glue in `index.html`.

## What is in `vendor/`

| File | State | Notes |
|---|---|---|
| `script/geom/Vector2.js` | verbatim | |
| `script/system/Color.js` | verbatim | `Ball` picks its colour from it |
| `script/AI/Opponent.js` | verbatim | |
| `script/game_objects/Ball.js` | patched | physics unchanged (0.98 damping, 0.95 cushion loss, pocket test). Removed: sounds, the two `setTimeout`s after a pocket, `reset()`, `out()`, the `Game.policy` global (each ball now has `policy`). Added: `id`, `sunk` (steps since pocketed, replaces the timers) and `draw(ctx)` with a shrinking sink animation |
| `script/GamePolicy.js` | patched | kept: borders and pocket positions/radii. Removed: turns, scores, players, menus, `Mouse` use. `checkColisionValidity` and `handleBallInHole` now only record the shot log (`first` ball touched by the cue ball, `pots` in order) |
| `script/GameWorld.js` | patched | kept: rack positions and ball order (the index is the ball id of the shared state), `update`, `handleCollision`, `ballsMoving`. Removed: stick, `handleInput`, `ballInHand`, AI and sound calls, `Game.*` globals. Added: `place`, `snapshot`, `shoot`, `maxSpeed`, `canPlaceWhite`, `draw(ctx)`. `handleCollision` computes the distance with scalars instead of allocating four vectors per pair: same arithmetic, results bit-identical on 100 recorded shots, 3.6x faster (9 us a step) |
| `script/AI/AIPolicy.js` | patched | same weights (spread of balls, contact, 2000 per own pot, +-10000 win/loss, -3000 foul); the outcome comes from the glue's judge instead of `Game.policy` |
| `script/AI/AITrainer.js` | patched | same search (random restart every 10 candidates, otherwise a mutation of the best). Now time-sliced (`train(budget)`) and driven by a `run(power, rotation)` callback, no `Game`/`GameWorld` globals |
| `script/Global.js` | patched | constants only (`TABLE_W/H`, `WHITE_ID`, `BLACK_ID`, `SINK_STEPS`); menu, sound and AI-mode flags removed |
| `assets/sprites/spr_{ball,redBall,yellowBall,blackBall}2.png` | verbatim | 50x50, 10.7 KB together |

Not copied: `index.html`, `LAB.min.js` (loader), `Game.js`, `Assets.js`, `Canvas2D.js`, `Stick.js`, `Score.js`, `Player.js`,
`Mouse.js`, `Keyboard.js`, `Keys.js`, `ButtonState.js`, `menu/*`, `css/`, `README.md`, and the media: the 9 MB "Bossa
Antigua" music (CC BY 3.0, Kevin MacLeod, so no attribution is owed), the four WAV sounds (640 KB), `spr_background4/5.png`
(1.4 and 1.6 MB), `main_menu_background.png`, `controls.png`, `spr_stick.png` and the button sprites. The table and the cue are
drawn in canvas instead (felt `#0f6a76` to `#08414d`, navy rails, mint only on the aim line, the cue tip and the turn
highlight), so they stay sharp at any size and cost no bytes. The game has no sound.

## What the glue (`index.html`) adds

- **Shared state** (`mesaSinuca`, game `sinuca`): `{ b, g, h, l, s }`, about 300 bytes. `b`: 16 balls indexed like
  `GameWorld.balls`, `[x, y]` in 0.1 px or `0` when pocketed. `g`: group of each seat (0 open, 1 red, 2 yellow). `h`: cue
  ball in hand for the player in turn (then `b[15]` is 0). `l`: log of the last shot (seat, ball ids pocketed, foul code).
  `s`: last shot `{ a: angle in 1e-4 rad, p: power in 0.1, c: cue ball start | 0 }`. `validState` checks types, ranges,
  ids, group consistency, the `h`/`b[15]` invariant and the exact key set.
- **Shot flow**: the player in turn plays the quantised shot to rest on a headless world (milliseconds), judges it, sends
  `sinuca:tacada` `{ id, seq, a, p, c }`, animates the same steps locally, then writes the final state with
  `KG.table.play(state, { next, winner, reason })`. Everyone else animates the event from the positions they already
  have and snaps to the saved state when it arrives (the shooter's result is the truth); a spectator who missed the event
  replays `s` from the previous positions; a preview with no saved state is dropped after 5 s. A hidden tab runs the steps at
  once, so the turn never stalls on a background tab.
- **Rules** (`judge`): the first legal pot on an open table assigns the groups; potting an own ball without a foul keeps the
  turn; foul = cue ball pocketed, no ball touched, or (groups assigned) first ball touched not from the player's group (the
  8 once the group is cleared). A foul gives the opponent the cue ball in hand, anywhere on the table (upstream's
  head-string TODO is not implemented). The 8 pocketed legally with the group cleared wins; any other 8 (early, or with a
  foul on the same shot) loses. Differences from upstream: groups are not assigned on a foul shot, and a scratch with only
  the 8 left is a foul, not an automatic loss.
- **Pacing**: physics runs at 60 steps/s (upstream's pace at 60 fps), independent of the frame rate; the slow tail
  (under 150 px/s) runs 3 steps per tick. The frame loop (`KG.loop`) only runs while something moves or the pointer drags,
  so an idle table costs no frames. Canvas backing store follows the CSS size (device pixel ratio capped at 2, 1 on the
  light profile).
- **Input**: pointer events (mouse and touch): drag away from the direction of the shot, farther = harder, release to
  shoot, a short drag cancels. Keyboard: arrows aim (Shift for fine), hold Space to charge, release to shoot, Enter places
  the cue ball in hand. Aim guide (dashed line, ghost ball, target direction) is new.
- **Koru** (solo, never touches `mesaSinuca`): the upstream AI search on a private world. Levels map to upstream's
  `TRAIN_ITER` (30, 50, 100); the two easier ones also miss the aim by up to 3 and 1 degrees, because the upstream AI plays a
  perfect simulation. Cue ball in hand: the free spot closest to the head spot (upstream's TODO there too).
- **Test hooks** (`window.__game`): `ready`, `state()`, `shoot(angle, power, cue?)`, `plan()` (the AI's best shot for the
  player in turn), `join()`. Never used by the game itself.

## Checks

`python3 tests/games_check.py sinuca` (`tests/games/sinuca.py`): two players, out-of-turn refusal, live spectator, board
equality across pages, forged room values, W.O. and new game, late spectator, drag shot and Koru reply without touching the
table. The network scan of `games/README.md` (rule 3) finds only the `iframe_api.js` script tag the page contract requires.
