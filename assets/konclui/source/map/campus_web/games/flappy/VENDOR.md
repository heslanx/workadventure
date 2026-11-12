# Flappy Koru vendor notes

**No code is copied here: the origin is an iOS project (Objective-C, Cocos2d 3, SpriteBuilder) that cannot run in a browser.**
`flappy.js` is our Canvas 2D port of its game, and the art pack is reused, recoloured, with the Koru in place of the bird.

- **Origin:** https://github.com/MakeSchool/FlappyBirdTemplate-Spritebuilder (the owner picked it, 2026-10-20)
- **Commit:** `7efe6a878d78383bdeea6e442d0fb6d63bd8b2f9` (2015-01-29, shallow clone in
  `.scratch/office-redesign/vendor-src/FlappyBirdTemplate-Spritebuilder/`)
- **License:** the repository has no license file. `MainScene.m`, `Obstacle.m` and `Goal.m` say "Copyright (c) 2014 MakeGamesWithUs inc.
  Free to use for all purposes"; `Character.m` says "Copyright (c) 2014 Apportable. All rights reserved" (that file only sets a start
  position and a flap impulse, both rewritten). The art pack (`FlappyBirdArtPack/`) carries no notice and reproduces the look of the
  original Flappy Bird (.GEARS). Adopted for this internal office under the owner's reuse decision of 2026-10-11 (`AGENTS.md`); do not
  reuse this art outside the office.

## Taken from the origin

| From | Into | How |
|---|---|---|
| `FlappyBirdArtPack/{background,clouds,bush,ground,pipe_top,pipe_bottom}.png` | `art/raw/flappy/` (repo root, unchanged) | copied as is |
| the same | `art/*.png` here | baked by `art/build_flappy.py`: night version (day-for-night tint, banded navy sky with stars and a crescent moon, lit windows); pipes and ground only dimmed |
| `MainScene.m`, `Obstacle.m`, `Character.m`, `*.ccb` (physics node, sizes) | `flappy.js` | rules and numbers ported, code rewritten |

Numbers kept from the template (points): gravity 700, a flap leaves the climb at 200 (the template applies an impulse and clamps the
climb to 200), 80 forward, a pipe pair every 160, gap 117 (an 825 pt obstacle minus pipes of 243 and 270 scaled 1.38), pipes 53 wide,
the score is the number of gaps flown through, the bird tilts and ends at 90° on game over, a short shake when it hits.

## Not taken

Everything else: the Xcode and SpriteBuilder projects, cocos2d-iphone, `fly1/fly2.png` (the bird), launch images and icons,
`GamePreview.gif`.

## Changed from the template, and why

| Change | Why |
|---|---|
| The Koru replaces the bird: `office/fountain/assets/koru-open-wings.png` (the owner's approved open-wing Koru) sampled to its own 71 x 41 pixel grid, four flap frames made by shearing each wing column down from the shoulder | The brand's character, same look as the fountain |
| Night sky | The Koru is an owl, and her turquoise disappears against the template's light blue sky; the dark sky also matches the campus games |
| World 288 x 512 points (the art pack's native size), ground top at 400; the template's background offset and 1.17 scale dropped | One clean coordinate system; the canvas keeps 9:16 inside the stage |
| Gap centre between 100 and 300 (template: 200 to 380 from the bottom, skewed upward), two gaps in a row at most 150 apart | Gaps use the whole sky above the ground, and every climb is possible |
| Pipes drawn at their natural height (the template stretches them 1.38 vertically, caps included) | The caps keep their pixels |
| A lid at the top of the sky; the hitbox is her head and body (20 x 19), not the wings or the ear tufts | No escaping over the pipes; fair contact |
| Bush and clouds scroll in parallax (0.5 and 0.1 of the ground speed) | Depth; the template left that for part 2 of its tutorial |
| Fixed 1/120 s physics step on `KG.loop`; the loop runs only while she flies or falls | Same game at 30 and 60 fps (light profile), zero CPU when idle, paused or over |
| Shake and a white flash on a hit, both off with reduced motion | Feedback without forcing motion |

## What is ours (`index.html`)

Layout (sky sized by the stage, side panel with points, the office record, the campus board, "Jogar de novo"), the veil for start
(low, so the Koru waits in sight), pause and game over with the rank text, pointer and touch flap on the sky, pause when the page
loses focus or is hidden, `KG.board("recordesFlappy")`, `window.__game` (`state()`, `running()`, `score()`, `koru()`, `pipes()`,
`world()`, `canvas()`, `artLoaded()`, `record()`, `autopilot(on)`, `forceGameOver(score)`).
