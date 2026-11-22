# Shared pipeline scripts: pixel contract and normal maps

Run from `assets/konclui/source`, Python 3 + numpy + Pillow. Nothing here is imported by the runtime. Every number is
MEASURED (a command that is in this repo) or marked DERIVED; the measurements are of 2026-11-21.

Tests: `python3 -I tools/test_pixelgrid.py` (73 tests; the ones that need a SpriteFusion binary are skipped without it, and
`BuiltOffice` is skipped, with a note on stderr, unless `KONCLUI_DIST` points at a built map: see "Which test enforces which
number"). `python3 -m unittest tools/test_pixelgrid.py` works only without `-I` (`-I` drops the working directory from the path).

| File | What it does |
|---|---|
| `pixelgrid.py` | `check`: alpha, 32 px size, optional palette lock, one line per failure with file, cell and pixel, exit 1 (also when no PNG is found). `report`: what the alpha repair would change. `binarize IN OUT`: the size-preserving alpha repair. `snap IN OUT`: spritefusion-pixel-snapper, for AI-upscaled art only |
| `normals.py` | Map-space normal texture of the placed entity sprites (`tool`, `legacy` or `auto`), `compare` (old vs new: summary.json with the angle and sign-agreement figures, and crops), `atlas` (per-cell normals of the 32x32 sheets) |
| `test_pixelgrid.py` | the tests |
| `../hq-office/translucent.py` | the DECLARED translucent layers of the office, each with its reason, its allowed levels and its asserted file count; the alpha repair the build runs (`snapped`) |
| `../hq-office/sheetcheck.py` | `check --dist DIR [--no-grid]` over a build (`entities/`, `seats/`, `tilesets/`), or `--sheets` over the imported third-party sheets |
| `../pets/tools/sheetcheck.py` | `check` over `species/*/base.png`: strict binary alpha, 512 px wide, the species' `palette.json` key as the locked palette. `petkit.py build` runs the same alpha and cell rules on the base sheet AND on every recoloured atlas it writes (`pets/out`) |
| `../avatars/sheetcheck.py` | `check` over `art/out/wokas/*.png` and `art/out/companions/*.png`: 96 x 128 (3 x 4 cells of 32 x 32), strict binary alpha, the locked palette of `avatars/sheet-palette.json`. `check_exported` is the same alpha and 96 x 128 rule (no palette) over the layers `avatars/native_export.py` writes, and `native_export.py` fails the export on it |

"Cell grid" means a picture's width and height are multiples of 32 (the avatars: exactly 96 x 128). Art that crosses a
cell border is NOT detected.

## Tools, versions, provenance

| Tool | Version | Source | Used through |
|---|---|---|---|
| spritefusion-pixel-snapper | 1.0.0 | Homebrew tap `hugo-dz/tap`; MIT; https://github.com/Hugo-Dz/spritefusion-pixel-snapper tag v1.0.0 = commit `5743009265051098831ad7298092072325d1149b` (`gh api repos/Hugo-Dz/spritefusion-pixel-snapper/commits/v1.0.0`) | `SPRITEFUSION_PIXEL_SNAPPER_BIN`, else `PATH` |
| spritefusion-sprite-normals | 0.1.0 | https://github.com/Hugo-Dz/spritefusion-sprite-normals commit `d14b06726cabab09c68a403ce2e684a52efbfe4c` (2026-10-20), MIT | `SPRITEFUSION_NORMALS_BIN`, else `PATH` |

Both are installed on the build Mac (`command -v` finds `/opt/homebrew/bin/spritefusion-pixel-snapper` and
`/opt/homebrew/bin/spritefusion-sprite-normals`). **Install commands for the owner**, if either is missing (nothing was
installed by this work):

```
brew install hugo-dz/tap/spritefusion-pixel-snapper
cargo install --locked --git https://github.com/Hugo-Dz/spritefusion-sprite-normals --rev d14b06726cabab09c68a403ce2e684a52efbfe4c
```

The normals binary on PATH is the `cargo install` of that commit (`~/.cargo/bin`, symlinked from `/opt/homebrew/bin`),
sha256 `559b9a534a36aa5e4c938211226bd015a5d2b1b1b2b696d7abf308b8a4dcd6ce`. The build prints the first 16 hex digits of the
hash it ran with. An earlier review built the same commit with `cargo build --release --locked` in `/tmp` (sha256
`ad254fed...`, a different binary): both gave a byte-identical `fx/normals.png` on the office map (wave A, MEASURED).
Review of the source (wave A): no `build.rs`, no process spawning (only `std::process::id()` to name a temp file), no network,
`unsafe_code = "forbid"`, 60 crates from crates.io.

A set-but-wrong `SPRITEFUSION_NORMALS_BIN` (or `SPRITEFUSION_PIXEL_SNAPPER_BIN`) is an ERROR, never a fallback. With the
variable unset and the tool missing from PATH, `normals.py --method auto` (the build's default) falls back to the luminance
method and says so on stderr: `normals: !!! spritefusion-sprite-normals not found ...: using the LUMINANCE FALLBACK, not
silhouette-aware normals`, and the build prints `legacy luminance fallback (NOT silhouette-aware; the tool was not used)`.
The method is also stamped in the PNG (text chunk `konclui-normals-method`: `tool` or `legacy`). Covered by `Fallback` and
`Stamped` tests.

## The owner's mandate against what is built (item 3)

The text is `.local/konclui/MANDATE-2026-11-21.md`. Where it names something that is not in this tree:

- `sources/entities/*.png`: the folder does not exist (`hq-office/sources` holds `sheets/` and `seat-front-folds.json`).
  The placed sprites are the build's `dist/entities/**/*.png`; that is what `normals.py` reads (219 distinct sprites under 664
  placements).
- `--tile-size 32x32`: the tool's flag is `--frame-size WxH` (tool `--help`). `atlas` passes it.
- `fx.py` `dx = (lum[:, 2:] - lum[:, :-2]) * 0.5` and `pixelMaps.ts` normals: neither exists in this tree (`rg` over HEAD,
  `play/src` and `fx.py`; `normalFromLuminance` is gone from `pixelMaps.ts`). The only luminance finite difference is the
  fallback this lane keeps, `normals.py` `legacy_normal` (height = luminance, central differences, edge-replicated border).
  Nothing was replaced; the tool path is the default and the luminance path is the documented fallback.
- `vWorld` of `shaders.ts`: not in the code (`rg vWorld play/src` finds nothing). The lookup that decides pan shimmer is
  `mapUV` (`shaders.ts:302`), `(floor(w * scale) + 0.5) / (uMap * scale)`: whole map pixels, not 32 x 32 cells.
- The mandate calls the file `fx/normals.png` in one block and `dist/fx/normal.png` in another. The runtime reads
  `normal.png` (`effectsLoader.ts`, `manifest.normal`), so that is the name written. `B` is the z component (`nz`, never 255
  except on a flat pixel), not a constant.
- `POST_FRAG` rim light for `uPeople`: the ambience lane's file (`shaders.ts`, `@night-lit` blocks), not touched here.
- "Stamp the pet and avatar atlases into `dist/fx/normal.png` in map space": not possible. Pets and avatars walk, so their
  normals have no fixed map position, and the shader has no per-sprite normal path. `atlas` writes them as separate files
  (below). Nothing reads them; that is an open item for the shader owner.

## What the pixel contract shows

Final build (`python3 hq-office/build.py --out DIR --renders DIR2`, exit 0): `check_dist` passes 12,651 of 12,651
entity and seat-front pictures and 7 of 7 tilesets. Pets 24 of 24, avatars 5 of 5 and companions 1 of 1
(`python3 pets/tools/sheetcheck.py check`, `python3 avatars/sheetcheck.py check`).

"No claim of crisp, no shimmer": only binary alpha and cell sizes are checked. `shaders.ts` snaps lookups to whole map
pixels; 213 of 664 placed entities are off the 32 px tile grid in x (DERIVED from the built map), so sheet-cell alignment
does not decide pan shimmer. Pan shimmer depends on the camera's fractional position and the texture filter; there is no
pan capture or GPU number here. Open: a real run.

### Partial alpha: the rule, the repair, the declared layers

Mandate line 56 says every sheet has binary alpha. The built office meets it everywhere except the DECLARED layers below,
which are the only pictures allowed partial alpha, each with its reason in `translucent.py`, the levels it may use, and a file
count the check asserts. Strict result with no declarations (`python3 tools/pixelgrid.py check DIST/entities DIST/seats
--no-grid`): exactly those 113 pictures fail, 12,538 pass. So mandate line 56 is relaxed for 113 entity pictures and 3
tilesets, on purpose; the owner confirms or removes a layer by editing `translucent.py` (the build then repairs it).

| Layer | Pictures | Partial px | on a silhouette edge | Why it is translucent |
|---|---|---|---|---|
| `glass` | 77 | 66,466 | 1,188 | a pane the player sees through; opaque it is a wall of colour. Levels {51, 128, 179, 192, 204, 230} |
| `lamp-light-pool` | 4 | 4,309 | 11 | the lamp's own baked glow, a gradient (any level). Dynamic lamp light is separate; whether the glow doubles it is unmeasured in a browser |
| `baked-shadow` | 32 | 4,148 | 913 | the picture's own contact or drop shadow on a piece the runtime draws NO footprint shadow for (fx.py `FLAT`: 16 wall frames, a TV, 13 lounge pieces whose shadow `lounge.py` paints in the picture). 30 prefabs. 14 levels, locked |
| `tileset-glass-walls` / `-doors` / `-light-overlay` | 1 each | 32,812 / 17,052 / 171,080 | 31 / 182 / 0 | glass tint, painted reflections, the light overlay (an alpha gradient by definition); `fx.py glass_mask` reads the glass levels by value |

Everything else is snapped by the build (`translucent.snapped` -> `pixelgrid.binary_alpha`). MEASURED, comparing the same
build with the repair switched off (identity) against the final one: **4,541 of 12,651 pictures changed** (4,382 entity PNGs
and 159 seat fronts; 4,407 flat-level, 134 anti-aliased), 703,509 partial px: 670,882 dropped to 0 (95%), 32,627 raised to
255. 113 declared pictures are kept as they are; 7,997 had no partial alpha. The rule, per picture:

- `aa` (8 or more distinct partial levels: an anti-aliased edge or a gradient): alpha > 127 becomes 255, else 0, the
  silhouette test the runtime already uses (`fx.py`: `alpha > 127`).
- `flat` (fewer levels: a baked contact shadow plate or halo): alpha >= 192 becomes 255, else 0. 583,237 of the repaired
  px are alpha 128, a plate under the furniture; thresholding at 127 would turn it into an opaque black slab, dithering
  would be a checkerboard that moires under a fractional camera.
- the colour under a px that becomes clear is zeroed, so no shadow colour is left to bleed.

Why dropping a plate is safe, per case (DERIVED/MEASURED over the build): of the placed prefabs that lost shadow px, 61 have
a footprint in the manifest's `shadows`, so the runtime draws a soft shadow from it (`SceneEffects.ts`, `features.shadows`);
30 have none (`FLAT`) and are the `baked-shadow` layer above. **The trade-off of that decision**: the runtime shadow exists only
while `features.shadows` is on and the room has an fx manifest. With the `lean` preset (`effectSwitches.ts`: `lean: []`), with
`konclui.fx.off` (which `qa.py` uses) and in a room with no fx manifest, nothing replaces the dropped plate: those 61 placed pieces
have no shadow at all. The owner can choose to declare them too (add their prefab names to `baked-shadow` in `translucent.py`,
raise its count, and accept the partial alpha); the default here is binary alpha everywhere the runtime can shadow. 4,320 changed pictures are not placed at all (the editor's
library). `translucent.lost_only_shadow` makes the build fail when a placed `FLAT` piece loses a shadow and is not
declared, so a new one cannot be dropped silently. Side effect: the footprint is measured on the repaired picture, so 22 of
219 footprints moved up (the plate no longer counts as the sprite's base; MEASURED, manifest diff). The composited preview
changes in 62,070 of 4,931,584 px (1.26%, MEASURED, `renders/preview.png` of the two builds). Open: the visual check in a
browser (screenshots with `konclui.fx` shadows on and off) is the integrator's.

Show that the check fails on a new partial-alpha sprite (MEASURED on a copy of the build): clean build exit 0; one
128-alpha pixel in one `konclui` sprite gives exit 1 with `FAIL ...: 1 px with partial alpha (1 levels, 1 on a silhouette
edge), first at cell (0,0) pixel (7,9)` and `12650 of 12651 sheets pass`. In the suite: `Partial`, `DeclaredLayers`
(a new sprite, a second declared file, a sprite that lost its translucency, a level that is not declared, a seat front).

#### Which test enforces which number

The budgets 77 (glass), 4 (lamp-light-pool), 32 (baked-shadow), 113 in all, the level sets and the name lists of
`translucent.py` are enforced in three places, each by a different run:

| Where | What it asserts | When it runs |
|---|---|---|
| `build.py` (`check_dist`, about 90 s) | the real constants over the map it just built; exit 1 on a miss | every build |
| `BuiltOffice` in `test_pixelgrid.py` | `check_dist` with the real constants (nothing mocked) over `$KONCLUI_DIST`, a built map | only when `KONCLUI_DIST` is set (the integrator's gate sets it); otherwise skipped, with a note on stderr |
| `DeclaredBudget` in `test_pixelgrid.py` | the constants themselves: 77/4/32, 113, 6/4/30 names, the glass and shadow level sets, the tileset layers | every run, no build needed |

`DeclaredLayers` mocks the counts and uses fixture levels, so it tests the MECHANISM (a new sprite fails, a lost one breaks the
count), not the numbers. MEASURED on a copy of the tree with `KONCLUI_DIST` set: glass 77 to 78, baked-shadow 32 to 31 and to
33, level 230 dropped from glass, a name dropped from baked-shadow each fail both `BuiltOffice` and `DeclaredBudget`; without
`KONCLUI_DIST` the `DeclaredBudget` test alone still fails them.

Two limits the check has, so nobody reads more into it: a one-level soft edge on a DECLARED picture passes (the glass layer
has 1,188 edge px: a pane's edge against its frame), and a picture's first bad pixel only is named per failure.

The imported third-party sheets (`hq-office/sources/sheets`, `check --sheets`) fail by design: 0 of 7 pass (partial alpha,
and `bookshelves` and `indoor-plants` are off the 32 px grid). They are INPUT; the build repairs what it writes. Do not run
the snapper on them.

### `snap` and `binarize`

- `snap` NEVER succeeds on a native sheet. The snapper re-detects a grid and resizes: a 32x32 cell with `--pixel-size 1`
  came back 25x25 and the 512x128 gato sheet 370x100 (MEASURED), so the re-check rejects both and nothing is written. It is
  kept for AI-upscaled art: 31x31 art upscaled 4x (124 px) with a stray half-transparent pixel returns 32x32 with binary
  alpha under `--pixel-size 4`; 32x32 art upscaled 4x comes back 33x33 and is rejected. `pets/tools/sheetcheck.py snap
  SPECIES OUT.png` is the pets' entry. Never in place.
- `binarize IN OUT` is the size-preserving repair for one picture (the `aa` rule above on any picture); never in place.

**Mandate item NOT delivered as written: the snapper is not a pipeline step.** The mandate asks for `spritefusion-pixel-snapper`
in the offline pipeline, snapping AI-generated or upscaled sheets before packing. It is installed and `snap` runs it, but no
build step calls it: `hq-office/build.py` repairs alpha with the in-house `binary_alpha`, `petkit.py build` and
`avatars/native_export.py` only CHECK what they write (binary alpha, cell size). Why: every sheet this repository builds is
native pixel art, and the snapper re-detects a grid and resizes (a 32x32 cell comes back 25x25, the gato sheet 370x100, MEASURED),
so it can only break native sheets; it has an input only where art is AI-upscaled, and no such step exists in the pipeline today.
Owner decision needed: when AI-upscaled sheets enter the pipeline, say which folder they land in; the wiring is then a call of
`PG.snap` before that folder's pack step (with `--pixel-size` of the upscale factor). Until then it stays a manual tool.

### The locked palette

Locked: pets (`palette.json` key per species, checked by `sheetcheck.py` and by `petkit.py build`) and the avatar sheets
(`avatars/sheet-palette.json`: wokas 19 colours, companions 13). The avatar lock is a FREEZE guard (a regression check): it was
BUILT FROM the committed sheets of 2026-11-21, so it passes by construction, would not have failed on today's art, and does not
derive from a design-system list (`avatars/catalog.json` colours are another,
per-option palette); a new colour is an edit of that file. Not locked: the office (it recolours imported art into the design
system by rule in `palette.py`; there is no fixed list, and one built from the current output would be circular).

## `fx/normal.png`

Contract with the runtime, read from `play/src/front/Konclui/Ambience/phaser/effectsLoader.ts`,
`domain/effectsManifest.ts` and `domain/shaders.ts` (not edited here; the ambience lane owns them). All of it matches:

| What the shader/loader does | What is written |
|---|---|
| file `fx/normal.png`, asked for only when `manifest.normal === true` and the night-lit setting is on | `fx/normal.png`; `manifest.normal: true` (`fx.add_normals`) |
| size must equal `manifest.map`, else the picture is ignored with a warning (`loadNormal`) | 2752 x 1792, the map's |
| sampled at `mapUV(w, 1.0)`, the same lookup as `masks.png`: texel centre of the world pixel, rows from the top, NEAREST | rows from the top, composed in map pixels |
| `nm.rgb * 2.0 - 1.0`, OpenGL (+Y up; the lamp direction is `(l.x - w.x, w.y - l.y, 42)`) | RGB = (n + 1) / 2 * 255, +X right, +Y up |
| `nm.a > 0.5` is "has a normal", else flat `(0, 0, 1)` | A = 255 under an opaque (alpha 255) sprite pixel; a pixel with no normal is `(128, 128, 255, 0)`, exactly `vec4(0.5, 0.5, 1.0, 0.0)` |
| a missing or broken file is ignored (`loadNormal` catches; a manifest without `normal` makes no request) | the shader's `uNormalsOn` stays 0 |

Alpha is only 0 or 255, so a premultiplied upload leaves every normal intact. No colour chunk (no sRGB, gAMA, iCCP), so
it is data. Sprites are composed back to front by the runtime's depth, `y + image height + depthOffset` (`EntitiesManager.ts`, `Entity.ts`), the
prefab's `depthOffset` read from its `collection.json` entry (651 of 664 placed prefabs have a non-zero one, -305 to +100); a tie goes
to the larger x (the runtime's tie is the texture load order, which no file records). Only fully opaque (255) sprite pixels are geometry: a
translucent pixel of a declared layer gets no normal (9,084 placed px, DERIVED; the tool is fed `geometry()` and the result
is masked to the sprite's own alpha, tested with a stand-in binary that returns alpha 128 everywhere). It covers 962,055 of
4,931,584 px (19.5%): floors and walls are flat. The file is 1,026,574 bytes (method `tool`) and 522,601 bytes (method
`legacy`). **These bytes changed** from 927,998 and 456,354: the first version ordered the overlaps by the bottom edge only, which
stamped the normal of a sprite that is drawn BEHIND. MEASURED on the same build, same sprites: the depth-aware order changes 89,397 of
the 962,055 covered px (9.3%) for `legacy` and 118,674 (12.3%) for `tool`; the old key reproduces the old sizes exactly. Coverage is
unchanged (the order decides whose normal wins, never whether a pixel is covered).

**On by default.** `fx.py` writes it unless `KONCLUI_FX_NORMALS=0`. Both conditions for that hold: (1) the runtime ignores
a missing file and does not even request it unless the night-lit setting is on, so the default adds no frame time and no
request; (2) the build is deterministic: two full builds (`build.py --out`, rerun after the depth fix) gave 12,793 byte-identical files, `normal.png`
included (`md5 -r` of the whole `dist`, MEASURED); two tool runs and two legacy runs are byte-identical (tested in
`RuntimeContract`, and over the whole `atlas` set). The method is printed by the build and stamped in the file, because the
bytes differ between the tool and the fallback: a host without the tool gets the fallback, loudly, never a silent change.

Methods (`normals.py --method`): `tool` runs the tool once per distinct sprite (silhouette-aware); `legacy` is the luminance
fallback; `auto` is the build's choice. Tool output vs luminance fallback, `python3 tools/normals.py compare DIST OUT_DIR`
over the office map (MEASURED): 962,055 px covered; angle between them mean 31.1 deg, p95 51.5, max 68.1; sign agreement
where the fallback leans (|channel - 128| > 8) R 86.4%, G 87.0%; tilt from flat mean 4.4 deg fallback, 34.2 deg tool. The two
use different default strengths, so the tilt is not a like-for-like quality number, and both read coverage from the same
alpha, so equal coverage shows nothing. "Silhouette-aware" is what the `ToolNormals` tests assert: a flat square gets outward
edge normals from the tool and flat ones from the fallback. By eye (`compare` crops): the tool bevels the barrels; the fallback
barely tilts them. No GPU or browser number: the integrator measures the shader path.

### Atlases (pets, avatars, companions)

`python3 tools/normals.py atlas OUT_DIR [SHEET.png...]` runs the tool per sheet with `--frame-size 32x32`, so a cell is lit as
its own sprite. Default input: 24 pet `base.png` + 5 `art/out/wokas` + 1 `art/out/companions/koru.png` = 30 sheets, written as
`OUT_DIR/<name>_n.png` plus the tool's `.color.png` and `.frames.json` side files (90 files, 1.7 MB), each output the size of
its sheet (checked), identical across two runs. The git-ignored place for them is `.local/konclui/pet-normals/`. Nothing in
the pet pipeline or the runtime reads them.

## Assumptions

- "Sheet" means the pets `base.png`, the avatar and companion sheets, the imported sources and the built entity, seat-front
  and tileset PNGs. The `fx/` data textures are excluded (their alpha carries data).
- The `baked-shadow` and `glass` level sets, and every layer's file count, are what the build produces today; a change of art
  updates them on purpose.
- The row order of `normal.png` is the one `masks.png` has (rows from the top): both are PIL saves of top-down arrays and the
  shader uses one `mapUV` for both. Not seen in a browser.
- Legacy normal: luminance height, central differences, edge-replicated border, strength 1.
- `check` "alignment" is the size multiple (above); crossing a cell border is not detected.
- Draw order of `normal.png`: depth `y + height + depthOffset`, ties to the larger x. Not seen in a browser; the runtime's own tie is the
  texture load order.
- The avatar export check has no palette (the catalog's colour options are many and curated); the committed `art/out` sheets have the
  frozen one.

## Open

- The shader owner confirms the +Y-up convention and the unfiltered data-texture sampling in a real run, and measures the GPU
  cost of the night-lit path (`normal.png` is loaded only with the setting on).
- A browser capture of the office with `shadows` on and off, to see the repaired baked shadows against the runtime ones.
- Pet and avatar atlas normals have no consumer.
- Pan shimmer and every GPU number: not measured here.
- The office has no locked palette; the avatar one freezes today's sheets.
- The snapper is not a pipeline step (owner decision above).
- `fx.py` writes `normal.png` once per build, so any later change of `depthOffset` in a prefab changes its bytes: expected.
