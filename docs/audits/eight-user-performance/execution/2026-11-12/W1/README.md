# W1 - game and rendering triage (2026-11-12)

Scope: H01-H04, H07-H09, A01, D02. Static reading of the cited sources at baseline `ddbe245a8` plus one dependency-free node micro-measurement (H08). No product file was edited. No browser, GPU or frame measurement exists in this window (see `../W0/README.md`), so no hypothesis below is confirmed or refuted for the incident.

## 1. Micro-measurement: H08 map deep copy

What it measures: `GameScene.onMapLoad` deep-copies the parsed map with `structuredClone(data)` (`play/src/front/Phaser/Game/GameScene.ts:1925`, comment at 1921-1924: protects the Phaser cache from scripting mutations). The bench repeats that call on real map JSON files from `maps/`.

- Script: `bench/map-clone-bench.mjs` (no dependencies). Receipt: `bench/map-clone-results.log`.
- Command (from the repo root, host node v26.10.0): `node docs/audits/eight-user-performance/execution/2026-11-12/W1/bench/map-clone-bench.mjs <map> <iterations>`; 5 warm-up copies, then timed copies.
- Run 1 failed (exit 1, ENOENT: zsh did not split `"<map> <n>"`); run 2 fixed the invocation, all three maps exit 0. Run 1 is recorded at the top of the receipt.
- Host load during run 2: `{ 569.55 541.95 625.83 }` before, `{ 573.35 543.19 625.78 }` after (MacBook saturated). Tail values (p95, max) are dominated by contention and are not representative; medians are an upper bound for an idle machine of this class.

| Map | File (bytes) | Size (tiles) | Layers | Copies | Median (ms) | p95 (ms) | Max (ms) | Heap of one copy (bytes) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `maps/starter/map.json` | 33,251 | 31 x 17 | 13 | 30 | 0.141 | 1.784 | 2.173 | 71,208 |
| `maps/Tuto/tutoV3.json` | 179,338 | 73 x 30 | 24 | 30 | 0.839 | 105.165 | 151.966 | 439,080 |
| `maps/tests/BigMap/map.json` | 17,380,422 | 500 x 500 | 20 | 10 | 128.886 | 370.045 | 370.045 | 38,037,392 |

Reading (bounded): the copy is one synchronous call per map load. On a 17 MB map it costs about 129 ms median of main-thread time in node V8 and about 38 MB of extra heap per copy; on the two starter-sized maps it is below 1 ms median. Browser `structuredClone` uses a different serializer than node, so these are node proxies, not browser numbers. The cost occurs on map load or reload, not per frame, so it cannot explain a continuous freeze at rest (as the H08 entry already says). It is a candidate for a load-time pause only on large maps.

## 2. Triage

States: confirmed / refuted_in_scenario / inconclusive / not_executed.

| ID | State | Scenario | Evidence | Next discriminator | Owner |
|---|---|---|---|---|---|
| H01 bubble redraw | inconclusive (mechanism confirmed in code, cost not measured) | static read | `play/src/front/Phaser/Entity/ConversationBubble.ts:193` `drawSpline`, `:255` removes the previous texture, `:262` `generateTexture`, `:265` destroys the temporary Graphics; callers at `:58`, `:153`, `:278` | browser trace with 8 users close vs apart, still vs walking: self time in `drawSpline`/`generateTexture` per frame | rendering |
| H02 per-frame update | inconclusive | static read | `play/src/front/Phaser/Game/Game.ts:52` calls `scene.update` before the dirty gate at `:59` (`SKIP_RENDER_OPTIMIZATIONS \|\| this.isDirty()`), so a skipped draw does not skip update work | browser trace: update self time vs render time; menus freeze with the canvas or not | game runtime |
| H02 interpolation input | not_executed | - | `docs/audits/performance-1000-users/execution/client/bench/interpolation-bench.mjs` exists; `client/results/` is empty, so there is no interpolation result to cite | run that bench or a browser trace | game runtime |
| H03 animated map | inconclusive | static read | `play/src/front/Phaser/Game/GameMap/GameMapFrontWrapper.ts:322` clamps the animation delay to at least 16 ms (the README cites `#L282`; the line has drifted to 322 at this baseline) | 1 idle client on the incident map vs a static copy: frame deltas and GPU time | maps/rendering |
| H04 resolution/GPU | inconclusive | static read | `play/src/front/Phaser/Services/WaScaleManager.ts:61-64` multiplies the canvas size by `devicePixelRatio` | record DPR, canvas physical size, GPU process time; compare a smaller window | rendering/compatibility |
| H07 first avatar appearance | inconclusive (cache reuse confirmed for the two-client scenario only) | E01-E04 | `docs/audits/eight-user-performance/evidence/sprite-cache.browser.json`, `sprite-cache.http.json`: zero extra sprite requests on return, six 304 on reload | 8 sequential vs simultaneous joins with distinct avatars: download, decode and texture upload times | assets/avatars |
| H08 map copy | refuted_in_scenario as a continuous-freeze cause (load-time only); inconclusive as a load-pause cause on large maps | node v26 proxy, 3 real maps, saturated host | section 1, `bench/map-clone-results.log` | browser `structuredClone` timing on the incident map size; entry/reload pauses correlated with map load | map loading |
| H09 pathfinding | inconclusive | static read | `play/src/front/Utils/PathfindingManager.ts:28` `setIterationsPerCalculation(1000)`; cancellation at `:44`, `:213`, `:244` | click to a far or unreachable target vs keyboard on the same map; long tasks during path requests | movement |

H08 "refuted_in_scenario" is narrow: the scenario is "freeze while everybody is already in the map and nobody reloads". The copy runs once per map load, so it is outside that scenario by construction; the timing only bounds its size.

## 3. A01 and D02

Decision: `A01.proposal.md` - keep A01 as worth exploring, do not start the module deepening now; gate it on an H01 measurement.

## 4. Resources

Host node processes only (two bench runs, both finished). Nothing retained.
