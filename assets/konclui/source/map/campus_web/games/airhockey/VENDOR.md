# Air hockey vendor notes

**Nothing is copied here: `airhockey.js` is our own compact Canvas 2D game** (circle physics, no engine). The upstream project was evaluated and
rejected, as the brief allows when the offline code is too entangled.

- **Evaluated:** https://github.com/kaleido1/Air-Hockey-Online
- **Commit:** `e4123d4d79fae9291d5d34497f96dc24dbbb1724` (2026-05-07, shallow clone in `.scratch/office-redesign/vendor-src/Air-Hockey-Online/`)
- **License:** MIT, Copyright (c) 2026 kaleido1, **plus a `NOTICE`**: visual, stylistic and "branding-adjacent" elements may carry third-party design
  rights that are *not* granted for commercial use. Koncluí is commercial, so even the look of that project is off limits.

## Why it was not imported

- The offline modes (vs the bot, two players on one device) live inside `public/client.js`: 4,171 lines, 129 KB, with the WebSocket and WebRTC
  rooms, the packet protocol, Chinese/English strings, iOS audio workarounds and every menu drawn on the canvas, all interleaved. The offline
  part is ~750 lines of that file (`startOfflineGame` ... `predictOfflinePuckXAtY`) plus `offline-physics.js` (445 lines) and **needs Matter.js**
  (`window.Matter`, ~80 KB minified) and `sat`. Extracting it meant rewriting most of it anyway, and then carrying a physics engine to move one disc.
- The `NOTICE` above: the visuals would have to be redrawn regardless.

Kept from it as the only idea: the rules of its offline modes (first to 7, one disc, a bot or two people on one device).

## What is ours

`airhockey.js`: 800 x 500 table, goals on the short sides (mouth 170, posts are small circles), a disc that bounces off rails and posts and
off the rebatedores (a rebatedor hits with its own velocity; it never crosses the middle line), 240 Hz physics sub-steps, drag, speed cap.
The Koru (`ai()`): a goalie that predicts where the disc will cross its line (with one misjudgement per shot), attacks a slow disc on its half
from behind (bank shots off the rails, hit from the open side when the disc is in a corner), backs off when pinned against a rail, and
plays harder when ahead and softer when behind (skill 0 to 8, starts at 4). Checked by playing bot against Koru: equal skill ends a game in
about 2.5 minutes, no stall in 84 games.
`index.html`: layout (table sized by the stage, side panel with mode, score, board, "Pausar" and "Jogar de novo"), the veil, pointer and touch
input (against the Koru every pointer moves your rebatedor; with two players each pointer moves the one on its half), `KG.board("recordesAirHockey")`,
`window.__game` (`mode()`, `state()`, `running()`, `score()`, `mallet(side)`, `puck()`, `table()`, `setMode()`, `simulate(seconds)`, `leftBot(level)`,
`park(x, y)`, `forceGameOver(a, b)`).

The Koru's face on her rebatedor is `games/koru.png` through `KG.asset`.

## The board `recordesAirHockey`

Same rule as the pingue-pongue: points = the **saldo de gols** of a **win against the Koru** (1 to 7). Wins against another person on the same device
and losses are never saved.
