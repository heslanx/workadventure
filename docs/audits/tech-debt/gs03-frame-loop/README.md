# GS-03: an error in a game frame stops the frame loop for good

Date: 2026-11-12. Base: checkout HEAD `322c7704c`, where `play/src/front/Phaser/Game/Game.ts` is unchanged since the
Phaser 4 migration (`81d68aad3`). Ledger item GS-03 in `docs/TECH-DEBT.md`. Author: the coordinator, in the scratch repo
`/tmp/wa-gs3`.

## Why

WorkAdventure must stay responsive for 1,000 users and explain an eight-user freeze. GS-03 is a freeze mechanism that
matches "the canvas freezes, the menus still work". Phaser's `RequestAnimationFrame.step` calls the frame callback and
schedules the next frame only after the callback returns (`node_modules/phaser/src/dom/RequestAnimationFrame.js`,
`step`). `Game.step` runs `scene.update`, which runs `GameScene.update()`. That method throws explicitly
(`GameScene.ts`, "Cannot find player with ID", GS-02) and `doAddPlayer` rethrows texture errors. One throw, and no
frame is ever scheduled again. No browser console from the incident exists, so this is a candidate, not the proven
cause.

## Change

`Game.step` now runs the frame body (`runFrame`, the old `step` body, unchanged) inside `try`/`catch`. On an error it:

1. drops the rest of the frame (no render for that frame);
2. sets `scene.isProcessing` to `false`, which `SceneManager.render()` would have done at the end of the frame;
3. reports the error with `console.error` and `Sentry.captureException`, at most once every 10 s, with the number of
   failed frames since the last report (`extra.failedFramesSinceLastReport`);
4. returns, so Phaser schedules the next frame.

A bug that throws on every frame now logs once per 10 s instead of freezing the canvas. Scenes after the throwing one
in Phaser's update order miss that frame's update.

## Patches

| Order | File | sha256 | Content |
|---|---|---|---|
| 1 | `1-pin-frame-loop-stop.test.patch` | `d0cf669f57a259d713ce4219550f60bd1be235b7c265fef20d7852396e19c89a` | New `play/tests/front/Phaser/Game/GameLoop.test.ts`: a characterization test of a normal frame, and the pin `GS-03 (pinned): stops the frame loop for good when a scene update throws`. No product change. |
| 2 | `2-fix-frame-loop-stop.patch` | `37e16c22dfa6d63312f842f332a9e4d5a207c3c7729e7d01bf9a615d8a559eec` | `Game.ts` as above. The pin flips into "should keep the frame loop going when a scene update throws, and report the error", plus two tests: the next frame renders, and a repeating error is reported once per 10 s with its count. |

Seam: the test replaces only the `Phaser.Game` base class at the module boundary (`vi.mock("phaser")` spreading the
real module), so `Game`'s own constructor, field initializers and `step` run. The frame loop is Phaser's real
`RequestAnimationFrame` with a fake `window.requestAnimationFrame` that records scheduled frames. The fake scene
manager's `update` sets `isProcessing` like the real one.

## Checks

sbh, tree `~/wa-jobs/wa-fable-20261112/src-review` mounted read-only (its `Game.ts` equals HEAD's), Vite caches on
tmpfs, `node:24-trixie`, `--rm --cpus 1 --cpu-shares 512 --memory 3g --network none`, label
`owner=wa-fable-20261112`, names `wa-fable-gs3-*`, runner `gs3/run.sh`. Raw output: `checks.raw.log`.

| # | State | Command | Exit | Result |
|---|---|---|---|---|
| 1 | pin test on HEAD's `Game.ts` | `npx vitest run tests/front/Phaser/Game/GameLoop.test.ts` | 0 | 2 passed |
| 2 | pin test on the fixed `Game.ts` | same | 1 | the pin fails: `expected [Function] to throw an error` |
| 3 | fix tests on HEAD's `Game.ts` | same | 1 | 3 failed of 4: `Error: boom` escapes `step` |
| 4 | fix | same | 0 | 4 passed |
| 5 | fix | `npx eslint --max-warnings 0` on both files | 0 | after one fix (`typeof import("phaser")` replaced by `typeof Phaser`; the first run exited 1) |
| 6 | fix | `npx prettier --check` on both files | 0 | formatted by the project's prettier first |
| 7 | fix | `npx tsc --noEmit` in play | 0 | |
| 8 | pin | eslint and prettier on the pin test | 0, 0 | |

## Mutants

Each runs the final tests against a changed fixed `Game.ts` (`mutants.diff`).

| Mutant | Result | Failing test |
|---|---|---|
| M1, no `isProcessing` reset | killed, 1 failed | keep the loop going: `expected true to be false` |
| M2, report every failed frame | killed, 1 failed | once per 10 s: `expected "error" to be called 1 times, but got 625 times` |
| M3, failed-frame count not reset after a report | killed, 1 failed | once per 10 s: the second report's count |
| HEAD's `Game.ts` (no guard) | killed, 3 failed | check 3 |

## Open

- Not tied to the incident. The discriminator stays an uncaught error in the browser console at the moment of a freeze.
- The guard keeps the canvas alive. It does not fix the error that threw. GS-02 (fixed in `ddd39f18b`) was one source.
- A frame error now shows in Sentry with a count instead of a frozen canvas. Its rate is unknown until it runs in a
  browser.
- No browser run. The test drives Phaser's real `RequestAnimationFrame` with a fake `requestAnimationFrame`.

## Resources

sbh job dir `~/wa-jobs/wa-fable-20261112/gs3` (states, mutants, runner); containers `wa-fable-gs3-*` all `--rm`, left 0.
Mac scratch `/tmp/wa-gs3`, `/tmp/wa-gs3-out`, `/tmp/wa-gs3-1-pin.patch`.
