# The art pipeline: grid, palette, alpha, normals, verify, publish

Run from `assets/konclui/source`, Python 3 with numpy and Pillow. Nothing here is imported by the runtime. Every number is
MEASURED (a command in this repo, run on 2026-11-22 unless a date is given) or marked DERIVED.

**Is this build fit to publish?** `python3 -I tools/verify.py DIST` (section "verify"). **Which tools are installed?**
`python3 -I tools/toolchain.py status`. **The tests:** `for t in tools/test_*.py; do python3 -I $t; done` (each file as a script: `python3 -I -m unittest test_verify` fails, `-I` drops the working directory from the import path). MEASURED 2026-11-23, each file as a script with `KONCLUI_DIST`
unset, all OK: toolchain 95, pixelgrid 75 (1 skipped), palettesnap 58 (1 skipped), ingest 80, gridguard 52, publish 100,
verify 67 (1 skipped). The one skip in each of pixelgrid, palettesnap and verify is the class that needs `KONCLUI_DIST` set to a
built map (`BuiltOffice`, `BuiltMap`; skipped with a note on stderr). Tests that run the normals or palette tool skip, with the
install command, on a host without it. The tests that run the pixel snapper (`test_ingest.py`, and `SnapSucceeds` in
`test_pixelgrid.py`) do not skip: they call `toolchain.require` and fail with the install command when the fixed build is missing
or only the stock one is there. The counts above were taken before art wave 1 (2026-11-23 and 24), which added seven Python test
files and one Node test file and grew `test_pixelgrid.py` and `test_verify.py`: "The art tests" below lists them, with what each
needs.

## The principles

1. Pinned tools. The three SpriteFusion tools are pinned in `toolchain.json` (the pixel snapper as the pinned commit plus a
   carried patch, see "Tools, versions, provenance"). A missing or wrong tool stops the run with the
   exact install command; there is no silent fallback. One exception is kept as it was: the build's luminance fallback for the
   normals (below), which is stamped in the file and fails `verify.py` unless allowed.
2. Sources are immutable. Every tool writes into a build or staging directory; `snap` and `binarize` refuse to work in place.
3. Deterministic. The same inputs give the same bytes (`verify.py --rebuild` builds twice and compares every file).
4. Each tool is also a checker where that is possible: `palettesnap check` runs the palette tool on art and fails when a pixel
   is off its palette (a pixel the tool would only merge into a close palette colour is counted, not failed). Not possible for the
   stock pixel snapper, which re-derived the grid of whatever it was given (a native 32x32 sprite came back 7x7, MEASURED
   2026-11-22). The pin is now the FIXED build, which keeps art on its grid; `ingest` uses nothing it returns before
   `tools/gridguard.py` has judged it (section "ingest"), and `pixelgrid snap` re-checks what it returns against the pixel rules.
5. Nothing reaches a served map directory except through `publish.py`, which backs up what it replaces and can roll back.

## The two doors

| Door | For | Path |
|---|---|---|
| Art drawn on the grid | everything the repository builds today: the office (imported art recoloured by `hq-office/build.py`), the pets, the avatar and companion sheets | the checks below, run by the builds and by `verify.py` |
| Art that was NOT drawn on the grid: from an image model, or resized | nothing yet; the quarantine lane for when it arrives | `ingest.py` into a staging folder (the FIXED pixel snapper, judged by `gridguard.py`); a person promotes a picture by copying it |

The order, for either door: **grid, palette, alpha, normals**.

- **Grid first.** Every later step counts or compares pixels; on a resized picture the pixels are not the art's.
- **Palette, then alpha.** The palette tool never changes alpha (`palettesnap.AlphaChanged` stops it if it does) and the alpha
  repair never changes the colour of a pixel it keeps, so the two commute on kept pixels (DERIVED). The order is fixed so that
  the alpha repair has the last word on what is visible and zeroes the colour under what it drops.
- **Normals last.** They are computed from the final silhouette and colours of the placed sprites.

## Commands

All from `assets/konclui/source`, all `python3 -I`.

| Step | Command (a real example) | What it does |
|---|---|---|
| tools | `tools/toolchain.py status [--json]` | table of the three tools: pin, version found, hash, status; exit 0 only when all resolve and match |
| pixel snapper | `tools/build_pixel_snapper.py [--offline] [--repo URL_OR_PATH] [--force]` | builds the pinned commit plus `tools/patches/pixel-snapper-fix.patch`, installs `spritefusion-pixel-snapper-fixed` into `~/.cargo/bin`, prints its sha256; idempotent; run once per host (also `--build-dir`, `--bin-dir`) |
| build | `hq-office/build.py --out /tmp/kv/dist --renders /tmp/kv/renders` | the office map; runs `sheetcheck.check_dist` (grid, alpha, translucent layers), `sheetcheck.check_palette`, writes `fx/normal.png` and the manifest (72 to 98 s on this Mac). It needs `rsvg-convert` on `PATH`: `hq-office/pool.py` rasterises the brand's K and Koru from their SVGs with it, and the build fails without it. `KONCLUI_VOLUME_PIECES` (below) changes what it builds |
| grid, alpha | `tools/pixelgrid.py check /tmp/kv/dist/entities /tmp/kv/dist/seats --no-grid` | `check`: alpha, 32 px size, optional palette lock, one line per failure with file, cell and pixel, exit 1. `report`, `binarize IN OUT`, `snap IN OUT` (runs the pinned FIXED pixel snapper, found by `pixelgrid.snapper_path()`, which refuses a stock build; for AI-upscaled art only; the result is re-checked for alpha, cell size and palette and is not judged by `gridguard`) |
| palette | `tools/palettesnap.py check --family avatars art/out/wokas art/out/companions` | exit 1 on a picture off its palette. `--family avatars\|pets` use each picture's own lock; `--palette FILE` checks any palette; `snap`, `report`, `palettes [--write]` |
| ingest | `tools/ingest.py run IN --family avatars --out /tmp/kv/staging --palette tools/palettes/avatars.hex --pixel-size 4` | quarantine lane, below |
| normals | `tools/normals.py /tmp/kv/dist /tmp/kv/normal.png --method tool [--profile domed\|plain]` | map-space normals, floor pieces left out; `compare`, `atlas` |
| verify | `tools/verify.py /tmp/kv/dist [--family office\|avatars\|pets\|all] [--allow-legacy-normals] [--rebuild]` | one line per check, `verify.json` beside DIST; exit 0 only without a failure |
| publish | `tools/publish.py plan\|apply\|rollback\|verify ...` | below (`plan` and `apply` take `--public-base-url URL`, which writes absolute `entityCollections` urls into the staged `.wam`) |

Per-family gates, which the builds call and which stay as commands: `hq-office/sheetcheck.py check --dist DIR` (also the
imported `--sheets`), `pets/tools/sheetcheck.py check`, `avatars/sheetcheck.py check` (`check_exported` is the alpha and
96 x 128 rule over the layers `avatars/native_export.py` writes, which fails the export on it). "Cell grid" means width and
height are multiples of 32 (avatars exactly 96 x 128, pets 512 wide); art that crosses a cell border is NOT detected.

## Tools, versions, provenance (`toolchain.json`)

| Tool | Pin | Source | Environment override | Install (run once on the host; nothing installs it for you) |
|---|---|---|---|---|
| `spritefusion-pixel-snapper-fixed` | 1.0.0 (the crate version does not change), commit `5743009265051098831ad7298092072325d1149b` (tag v1.0.0) plus `tools/patches/pixel-snapper-fix.patch` (sha256 `32bb537ec17dc2a0910d371fcf4e636364485fd15766c2b30bd3e649a9bede0a`), MIT | https://github.com/Hugo-Dz/spritefusion-pixel-snapper, upstream issue https://github.com/Hugo-Dz/spritefusion-pixel-snapper/issues/15 | `SPRITEFUSION_PIXEL_SNAPPER_BIN` | `cd assets/konclui/source && python3 -I tools/build_pixel_snapper.py` (needs `git` and `cargo`) |
| `spritefusion-sprite-normals` | 0.1.0, commit `d14b06726cabab09c68a403ce2e684a52efbfe4c`, MIT | https://github.com/Hugo-Dz/spritefusion-sprite-normals | `SPRITEFUSION_NORMALS_BIN` | `cargo install --locked --git https://github.com/Hugo-Dz/spritefusion-sprite-normals --rev d14b06726cabab09c68a403ce2e684a52efbfe4c` |
| `spritefusion-palette-snapper` | 0.1.0, commit `ea647826abf82b70f87f54a4e45a58515eab650a`, MIT | https://github.com/Hugo-Dz/spritefusion-palette-snapper | `SPRITEFUSION_PALETTE_SNAPPER_BIN` | `cargo install --locked --git https://github.com/Hugo-Dz/spritefusion-palette-snapper --rev ea647826abf82b70f87f54a4e45a58515eab650a` |

Lookup: the override when set (set but wrong is an error, never a fallback), else `PATH`, else `~/.cargo/bin`. The version is
the tool's own `--version`; a build suffix or extra digits (`1.0.0.1`, `1.0.0-rc1`) is not 1.0.0. `status` prints the first
16 hex digits of each binary's sha256. The hashes on this Mac (`toolchain.json` lists them) are recorded and printed, and
enforced only with `KONCLUI_TOOLCHAIN_SHA256=enforce`, because a rebuild of the same commit gives another binary (the pixel
snapper's build script is the exception it was written to be: see below). The palette-snapper hash is of a build from a local checkout of the pinned commit, not of the documented `cargo install --git`
command: re-measure and list the hash when that command is run on a host. Source review (no `build.rs`, no network, no process
spawning, `unsafe_code` forbidden): sprite-normals 60 crates, palette-snapper 65 crates. `KONCLUI_TOOLCHAIN_ALLOW_MISMATCH=1`
lets a step run another version with a loud warning; `verify.py` still fails it. It does not waive the pixel snapper's
capability probe (below).

**The pixel snapper is the FIXED build.** The stock 1.0.0 shrinks art that is already on its grid (a 32x32 sprite came back 7x7,
a 96x128 sheet 20x29) and adds a cell to clean enlargements (an 8x of 32x32 came back 65x65), with exit 0 (MEASURED 2026-11-22
in the lab recorded in `tools/patches/README.md`). The patch (`README.md` and `src/lib.rs` only) is carried here until upstream
ships it: the upstream issue above had no answer when `tools/patches/README.md` was written, and that file says what the patch
fixes and how to remove it. The patch does not change the crate version, so `toolchain.py` tells the two builds apart by a probe
recorded in `toolchain.json`: the fixed build's `--help` lists `--expect-cell`. The stock build, or any build that fails the
probe, named by `SPRITEFUSION_PIXEL_SNAPPER_BIN` is a `ToolMismatch` with the install command (MEASURED 2026-11-23 with the
Homebrew build: `toolchain.py status` says MISMATCH, and `pixelgrid.py snap` stops with the install command), and
`KONCLUI_TOOLCHAIN_ALLOW_MISMATCH` does not waive it. A stock `spritefusion-pixel-snapper` on `PATH` is not looked up at all:
the pin's binary is named `spritefusion-pixel-snapper-fixed`. `toolchain.STOCK` keeps the stock pins, so the stock tool is
refused by name. The upstream commit has a `Cargo.lock`, so the build runs `cargo build --release --locked`.
`build_pixel_snapper.py` (standard library only) is idempotent, installs `spritefusion-pixel-snapper-fixed` into `~/.cargo/bin`,
leaves the stock tool where it is, and prints the installed sha256 (`ffd76a74…` on this Mac, listed in `toolchain.json`;
`toolchain.py status` printed it on 2026-11-23). `RUSTFLAGS` remaps the build and cargo paths, so two builds in different folders
give the same bytes (MEASURED 2026-11-23 by the snapper lane, `ffd76a74…`). Run it once per host. Until then `toolchain.py status`, the `toolchain` check of `verify.py`, and the
ingest tests fail there, by design. A build manifest recorded before the switch says 1.0.0 and cannot say which build made it:
rebuild it (`hq-office/build.py`); `office.tools` fails it only with `KONCLUI_TOOLCHAIN_SHA256=enforce`.

**What a missing tool does.** `toolchain.require` raises `ToolMissing` or `ToolMismatch` with the install command: the palette
check (so the office build and the avatar and pet gates), `ingest`, `pixelgrid snap` (through `pixelgrid.snapper_path()`) and
`verify.py` stop or fail. The
exception: `normals.py --method auto` (the build's default) uses the luminance method when the normals tool is neither on
`PATH` nor named by its override, prints `normals: !!! ... LUMINANCE FALLBACK` on stderr, and stamps the PNG text chunk
`konclui-normals-method: legacy`; `verify.py` fails that stamp unless `--allow-legacy-normals` (then it is `reported`).

## The checks, and what each fails on

### grid and alpha

The built office meets binary alpha everywhere except the DECLARED translucent layers of `hq-office/translucent.py`, each with
its reason, its allowed levels and an asserted file count. Strict result with no declarations: exactly those 113 entity
pictures fail (MEASURED 2026-11-21), so the mandate's "every sheet has binary alpha" is relaxed for 113 entity pictures and 3
tilesets, on purpose; the owner confirms or removes a layer by editing `translucent.py`.

| Layer | Pictures | Why it is translucent |
|---|---|---|
| `glass` | 77 | a pane the player sees through; levels {51, 128, 179, 192, 204, 230} |
| `lamp-light-pool` | 4 | the lamp's own baked glow, a gradient |
| `baked-shadow` | 32 | the picture's own shadow on a piece the runtime draws no footprint shadow for (`fx.py` `FLAT`); 14 levels, locked |
| `tileset-glass-walls`, `-doors`, `-light-overlay` | 1 each | glass tint, painted reflections, the light overlay |

Everything else is repaired by the build with `pixelgrid.binary_alpha`: `aa` pictures (8 or more partial levels) alpha > 127
becomes 255 else 0; `flat` ones (fewer: a baked shadow plate) alpha >= 192 becomes 255 else 0; the colour under a cleared pixel
is zeroed. MEASURED 2026-11-21 against an identity build: 4,541 of 12,651 pictures changed, 703,509 partial px, 95% dropped to 0.
The trade-off: with the `lean` fx preset, with `konclui.fx.off`, or in a room without an fx manifest nothing replaces a dropped
plate (61 placed pieces); the owner can declare them in `baked-shadow`. The real budgets (77, 4, 32, 113) are enforced by
`build.py` every build, by `BuiltOffice` in `test_pixelgrid.py` when `KONCLUI_DIST` is set, and by `DeclaredBudget` always.
A one-level soft edge on a declared picture passes, and only a picture's first bad pixel is named.

`verify.py` result on the built office: grid `pass` (7 tilesets are cell multiples; the other 12,651 entity and seat pictures
are free-sized), alpha `pass` (12,658 pictures), translucent `pass` (6 layers, 116 pictures). Avatars 6 of 6 and pets 24 of 24
pass grid and alpha.

### palette

The same pinned tool that would fix a picture checks it: `spritefusion-palette-snapper` runs into a temporary directory and the
check compares both sides, decoded (it writes indexed PNGs). Locked palettes live in `palettes/<family>.hex`, generated from
their sources of truth (`hq-office/palette.py`, `avatars/sheet-palette.json`, `pets/species/*/palette.json`) and kept in sync by
`palettesnap.py palettes`. `palettesnap.FAMILY_DECLARATION` says what each family does:

| Family | Palette | Result | Fails on | Reported only |
|---|---|---|---|---|
| avatars | wokas 19 colours, companions 13 | 6 of 6 pictures on their palette | any picture with a pixel off its palette | 2 pictures the tool would merge (809 px, largest 0.0244 OKLab): two palette colours closer than 0.03 |
| pets | one `palette.json` key per species, 377 colours in `pets.hex` | 24 of 24 on their palette | the same | 19 pictures the tool would merge (14,272 px, largest 0.0290) |
| office | `palettes/office.hex`, 51 colours | 12,540 pictures are off it, and the baseline in `palettesnap.py` is 14,340,856 px (116 declared translucent pictures are left out). The baseline was 14,340,377 px until art wave 1; it moved by 479 px and by 0 pictures, the net of four changes: the facade floors, the water art and the floor patterns add off-palette px, and the new lawn removes 42,844 (the lawn lane's figure on its own build; no report measured the four on one final build). The 12,542 pictures checked and the largest move of 0.2628 OKLab were measured on 2026-11-22 and not measured again | the off-palette pictures or px GROWING past that baseline, or the office conforming while the declaration still says it does not | the counts, every build and every `verify.py` |

The office is not repainted: it is drawn from imported catalogue art recoloured by luminance ramps whose stops are `palette.py`
colours but whose pixels are interpolated between them, plus pieces with colours of their own (`lounge.py`, `signature.py`,
`flora.py`, `fountain.py`). Repainting onto the palette is a visual decision for the owner. `palettesnap.py report --family office
DIST/entities DIST/seats DIST/tilesets` (MEASURED, declared layers included): 12,658 pictures, 48,933 distinct colours (at most
1,767 in one), 1,063 pictures lose 58,668 colours to the tool's own merge. The avatar lock is a FREEZE guard built from the
committed sheets of 2026-11-21 (it would not have failed on that art); a new colour is an edit of that file.

Limits of the tool, MEASURED on 0.1.0: a palette has at most 256 colours (so pets run per species palette, never with
`pets.hex`), and it merges the picture's own colours closer than OKLab 0.03 before mapping (the threshold cannot be set with
`--palette`), which is why a "merge only" picture is counted and never failed. `snap` is all or nothing, refuses a picture the
tool would damage, and never writes in place.

### normals (`fx/normal.png`)

Contract with the runtime, read from `play/src/front/Konclui/Ambience/phaser/effectsLoader.ts`, `domain/effectsManifest.ts` and
`domain/shaders.ts` (not edited here):

| What the shader and loader do | What is written |
|---|---|
| asks for `fx/normal.png` only when `manifest.normal === true` and the night-lit setting is on; a missing or broken file is ignored | `fx/normal.png`, `manifest.normal: true` (`fx.add_normals`, unless `KONCLUI_FX_NORMALS=0`) |
| size must equal `manifest.map`, else ignored with a warning | 2752 x 1792, the map's |
| sampled at `mapUV(w, 1.0)`, as `masks.png`: whole map pixels, rows from the top, NEAREST | composed in map pixels, rows from the top |
| `nm.rgb * 2.0 - 1.0`, OpenGL (+Y up) | RGB = (n + 1) / 2 * 255, +X right, +Y up |
| `nm.a > 0.5` is "has a normal", else flat `(0, 0, 1)` | A = 255 under an opaque sprite pixel; elsewhere `(128, 128, 255, 0)` |

Only fully opaque (255) sprite pixels are geometry (a translucent pixel of a declared layer gets no normal). Sprites are
stamped back to front by `y + height + depthOffset`, a tie to the larger x. On 2026-11-23 `verify.py` counted 815,452 opaque px
with a normal on HEAD's build and on the relief lane's (MEASURED by the relief lane; 16.5% of 4,931,584 px, DERIVED). Earlier text
here said 962,055 px (19.5%), 1,026,574 bytes with the tool and 522,601 with the fallback, measured on 2026-11-21: they were not
measured again, and why the pixel count differs was not traced. Atlases of the pets, avatars and companions
(`normals.py atlas OUT_DIR`, `--frame-size 32x32`) have no consumer: pets and avatars walk, and the shader has no per-sprite
normal path.

`verify.py` checks it without trusting the writer: the manifest advertises it and the file exists (a manifest that does not
advertise it is `reported`); the size is the map's; the stamp says `tool` (`legacy` fails unless `--allow-legacy-normals`, no
stamp fails; the stamp is a label, not a signature); alpha is only 0 or 255; every opaque pixel's normal has length 1 within
0.0136, the truncation bound of 8-bit channels (the rounding bound is 0.0068; MEASURED on the built office: 0.9935 to 1.0065
over all 962,055 pixels); and the pixels with a normal are exactly the opaque pixels of the placed sprites, read from
`office.wam` and the sprites, so every other pixel has alpha 0. Tool output against the luminance fallback
(`normals.py compare`, MEASURED 2026-11-21): angle between them mean 31.1 deg, p95 51.5; the tool bevels barrels the fallback
barely tilts. No GPU or browser number exists here.

### kinds and painted (`fx/manifest.json`, the lighting's per-piece data)

Written by `hq-office/fx.py` from the one rule in `tools/kinds.py`; read by `normals.py` (a floor piece is not stamped) and
re-derived by `verify.py` (`office.kinds`). Both keys are optional and `version` stays 1: an older manifest has neither, the
runtime then classifies by prefab and treats `painted` as empty, and `normals.py` stamps every piece as before. A build made with
`KONCLUI_VOLUME_PIECES` set adds three more optional keys, `volume`, `volumePieces` and `casters`: see "Volume pieces".

| Key | Layout | Rule |
|---|---|---|
| `kinds` | `{"<collection folder>/<image path>": "stand"\|"top"\|"hang"\|"floor"}` for every placed sprite (the keys of `shadows`) | `kinds.classify`, first match wins: floor (tag "Tapetes e pisos", depthOffset <= -100, `/floors/`), top ("(sobre móvel)"), hang (tag "Decoração de parede", folder `walldecor`, `walls`, `doors`, or a whole-word name match), floor by whole-word name, else stand. Whole words only: the old unanchored `tela` of `fx.FLAT` matched "Costela-de-adão" |
| `painted` | sorted list of keys | stand or top pieces whose picture already draws its own contact shadow: the declared `baked-shadow` layer of `translucent.py`, plus any picture with 6 or more DARK pixels (every channel under 128) with 0 < alpha < 128 in the bottom quarter of its silhouette's rows or below its foot (`kinds.painted_shadow`) |

`normal.png` leaves a `floor` piece at the flat value `(128, 128, 255, 0)`, "nothing": a rug has no volume and got stripes. The
tool is not run on it. Profile `domed` (the default, stamped in the PNG chunk `konclui-normals-profile`) tells the tool a size
class per sprite by the longest side of its opaque box (under 48 px `--shape-radius 4`, under 96 px 10, else 20) with
`--shape-strength 1.4 --normal-strength 2.0`; `plain` is the tool's own defaults. The numbers are `normals.SIZE_CLASSES`,
`SHAPE_STRENGTH` and `NORMAL_STRENGTH`: the lighting lab's relief pictures decide the final values.
`python3 hq-office/fx.py --dump-kinds DIST OUT.json` writes the classifier fixture the runtime lane's tests read
(`[{key, name, tags, depthOffset, kind}]`).

`KONCLUI_PAINTED_SHADOWS=0` builds the lounge pieces without their `shade_row` shadow rows (default 1: every picture is
byte-identical to before; a test pins the hash). Those 11 declared names (`translucent.LOUNGE_ROW_SHADOWS`, 13 pictures) stop
being translucent and stop being declared, so the declared baked-shadow count is 19, not 32. MEASURED on a build with 0: the
contract passes except the palette ratchet, which grows by 13 pictures and 33,168 px (the pictures are no longer exempt as
declared translucent): raising that baseline, or repainting them, is the owner's decision at the flip. Run `verify.py` with the same `KONCLUI_PAINTED_SHADOWS` as the build (the declared counts follow the switch; the dist does not record it). The pebolim and the Lig 4 table
carry the catalogue's own shadow (alpha 128), not lounge.py's, and stay `painted` either way.

### toolchain, determinism

`toolchain`: all three tools resolve, match their pin (for the pixel snapper the pin includes the capability probe, which a
stock build fails), and with `KONCLUI_TOOLCHAIN_SHA256=enforce` have a listed hash.
`determinism` (only with `--rebuild`): `hq-office/build.py` runs twice into temporary directories and every file is compared by
sha256; the manifest's `tools` entry (versions and hashes, no host paths) is part of the bytes, so two hosts with different tool
builds do not give the same map, on purpose.

## verify

```
$ python3 -I tools/verify.py /tmp/kv/dist2
pass      toolchain           pixel-snapper 1.0.0, sprite-normals 0.1.0, palette-snapper 0.1.0 match their pins
pass      office.dist         entities, seats, tilesets, fx/manifest.json, office.tmj, office.wam exist
pass      office.tools        the manifest records pixel-snapper 1.0.0, sprite-normals 0.1.0, palette-snapper 0.1.0, all the pinned versions
pass      office.grid         7 pictures have cell-multiple sizes (the other 12651 are free-sized)
pass      office.alpha        12658 pictures have only alpha 0 or 255 (outside the declared layers)
pass      office.translucent  6 declared layers, 116 pictures, only their declared levels and counts
reported  office.palette      12540 of 12542 pictures are off the palette (14340377 px), declared not conforming; baseline ...
pass      office.normals      2752x1792, method tool, 962055 opaque px with normals within 0.0065 of unit length ...
pass      avatars.grid / avatars.alpha / avatars.palette, pets.grid / pets.alpha / pets.palette   (six more lines)
verify: 12 pass, 0 fail, 1 reported: fit to publish (/private/tmp/kv/verify.json)
```

Status is `pass`, `fail` or `reported` (counted and shown, never failing). A check that raises is a `fail` with the error;
exit 0 only without a failure, 2 when DIST is not a directory or `--out` is inside the source tree. `verify.json` is written beside
DIST, not inside it (DIST is what gets published), or to `--out FILE`; **never into `assets/konclui/source`**: for
`tools/verify.py hq-office/dist` (whose parent is a source directory) it goes to `$TMPDIR/konclui-verify/dist-<hash>/verify.json`,
and the last line says where. A report left by an earlier run at that place is deleted before the checks start, so a run that dies
leaves no stale `ok: true`. The verdict `fit to publish` is printed only when the office family ran (DIST was examined);
`--family avatars|pets` prints `no failure in avatars only; DIST not examined, so this is not a verdict on the build`, and
`verify.json` has `dist_examined: false` and `dist: null`.
`toolchain` looks at the tools on THIS machine; `office.tools` reads back the tools that MADE the build (the manifest's `tools`
record) and fails on another version, a tool listed missing, a tool not recorded, or no record at all (a build from before the
record: rebuild). `NORMAL_TOLERANCE` is 0.0070 (the 8-bit rounding bound 0.0068 plus a hair; the measured worst was 0.0065 on 2026-11-22 and 0.0057 on the
relief lane's build of 2026-11-23). It took 32 s on an idle Mac and 118 s on a loaded one; with `--rebuild` (two builds) 9 min 24 s on a loaded one, and the two
builds were byte-identical over 12,793 files and identical to the DIST given. The
avatar and pet sheets are not in the office map: their families are checked where their gates check them, read only. Planted
defects each fail their own check by name (`test_verify.py`): a partial-alpha sprite `office.alpha`, an off-palette pixel in
avatars or pets `<family>.palette`, a normal map of the wrong size or stamped `legacy` `office.normals`, a missing or other-version
tool `toolchain` (and `<family>.palette`, which raises `ToolMissing`).

The build manifest records which tools made it: `fx/manifest.json` has `tools` (`fx.tool_record()`: for each tool version,
pin, commit, sha256, `matches`; missing tools by name). The runtime's schema ignores the key. `publish.py` copies it into
the release ledger.

## Volume pieces: the kit, the baker, proxies, touch-ups and `KONCLUI_VOLUME_PIECES`

A piece of the office is drawn by hand (the catalogue's art, or code in `hq-office/lounge.py` and `hq-office/signature.py`) or, on this
second path, described as solids and baked. Four terms. A *recipe* is a piece written as solids in metres. The *baker* turns a recipe
into a sprite, a normal map and a height map. A *proxy volume* is a few solids laid over a hand-drawn sprite: the drawing stays and the
lighting gets a relief and a shadow height. A *touch-up* is a function over a picture's pixels that fixes one audited defect and nothing
else. None of this is in a default build: with `KONCLUI_VOLUME_PIECES` empty (the default) the lounge does not import the kit. MEASURED
on 2026-11-23 by the lane that wired the switch and by its reviewer: a build with the switch empty, with the facade fill of `build.py`
left out (it changes the default build on purpose) and with the relief change left out had the same sha256 list as the build before the
hooks, over 12,793 files.

### The kit and the baker (`tools/volume.py`, `tools/bake.py`, `tools/projection.json`)

`volume.py` is the kit. The world is in metres: x right, y toward the viewer along the ground, z up, one tile is one metre. A recipe has
solids (`box` with bevels and decals, `lathe`, `sphere`, `frustum`, `tube`, `ring`, `leaf`, `soft_box`), materials taken from
`hq-office/palette.py`, a footprint in tiles and named anchors (`foot`, `seat`, `light_head`). `bake.bake(recipe)` samples the solids 4 by 4
per pixel with an analytic normal, keeps what faces the camera, z-buffers it, tones it by the angle to a light straight above, calls a
pixel opaque when at least half of its samples are covered, removes stray pixels and draws a 1 px outline inside the silhouette. It
returns the sprite (alpha 0 or 255 only), a normal map (the encoding of `fx/normal.png`: RGB = (n + 1) / 2 * 255, +Y up, alpha 255
exactly on the opaque pixels), a height map in px above the floor, the footprint, the sort line, the foot and the anchors in canvas px,
and a list of violations (colour cap, foot gap, margin, footprint, height, outline, symmetry). No left or right highlight is baked: the
runtime light gives direction. Both modules are deterministic, use numpy and Pillow only, and freeze their public API at version 1: a
change is a new version, never an edit in place.

`projection.json` says how metres become pixels. `oblique` is the default: ground 32 px per tile in both screen axes and height 21 px per
metre drawn straight up, because the floor, the rugs and the collision grid already use that ground (the integrator's decision of
2026-11-23). `camera75` (24 px per metre of depth) is kept to compare and is never what the build uses. Nothing else may type those
scales: the baker and the drawing contract read this file, which also holds the colour cap (24) and the largest foot gap (1 row). What
the baker cannot draw is finished by a hand patch, `hq-office/art/overrides/<piece>.<projection>.txt`, a character picture laid over the
baked pixels. A patch is refused when it is stale (the baked pixels are no longer the ones it was drawn on) or when it changes more than
8% of the opaque pixels (`override_budget`); `python3 -I tools/bake.py --restamp` re-stamps a patch's header. Run
`python3 -I tools/bake.py <piece> --out DIR [--sheet] [--projection oblique|camera75]`; `--list` prints the names. The registry is
`hq-office/props/`: one module per piece with a `RECIPE` (`air_hockey`, `arc_lamp`, `potted_plant`, `stool`).

### Proxy volumes and touch-ups (`tools/proxy.py`, `hq-office/props/proxies/`, `hq-office/props/touchup.py`)

A hand-drawn piece that reads well keeps its drawing: the baker would redraw it worse. A `ProxyRecipe` (solids in metres, an integer
canvas origin, optional named anchors) is baked with the baker's own projection and z-buffer and laid over the sprite. It supplies a
height and a normal for every pixel and the caster facts of the piece (height in px, foot row, foot span, where its light comes from).
The picture is never touched. The proxy is lined up with the sprite by a search of 6 px and must cover the sprite's opaque pixels; a best
offset of more than 1 px is an error, because the relief would sit on the wrong pixels. The runtime reads one height per piece (a
shear), not the height of each pixel. A proxy cannot repaint a defect in the drawing: that is a touch-up. `touchup.py` has pure functions
over an RGBA array (`strip_light_pool`, `strip_painted_shadow`, `unclip`, `darken_underside`, `curve_foot`) and one recipe per piece. The
Koncluí arc lamp's recipe strips only the painted light pool and shadow: its orange underside stays, because the runtime paints the
lamp's bulb rectangle (8 x 2 px at the head) over it at night and a dark dome leaves that rectangle as an olive smudge (seen in the
shader lab, lounge preset, hours 15.5 and 22, by the touch-up lane). `touchup.enabled()` reads `KONCLUI_TOUCHUPS=1`, but the build
does not call it: touch-ups run only through the switch names below.

### The switch: `KONCLUI_VOLUME_PIECES`

A comma list, case and spaces ignored, empty by default. An unknown name stops the build with a `ValueError`: a typo must not build the
default quietly. `hq-office/translucent.py` owns the names.

| Name | What it does to the build |
|---|---|
| `air-hockey` | The table's picture is baked from `props/air_hockey.py` in place of the drawn one, under the same sprite key and with its foot where the old foot was; its normals and its caster come with it. The collision grid becomes 4 x 2 (the footprint is in the middle two columns of the lower row, because the baked canvas has 32 px of empty pad on the left) and the games interaction rectangle moves by 1 to 3 px (both found by the prototype's judge; not measured again). Its two sides are the office palette's mint and steel-blue ramps: the palette has no red, and an earlier red and blue were off the palette |
| `stool` | The bar stool is baked from `props/stool.py` and seats by the recipe's `sit` anchor. The art review scored it 6 of 10 and not better than today's drawing by eye, so it is taken only by this name |
| `arc-lamp-proxy` | The Koncluí arc lamp and the two catalogue arc lamps keep their drawing and get a touch-up and a proxy volume |
| `plant-proxy` | The two bird of paradise plants ("branco" and "alta") keep their drawing and get a touch-up and a proxy volume. The judge found that, lit, the tall plant's white pot turns into a flat grey bucket, so it is taken only by this name |
| `casters-all` | Changes no picture and no declaration: adds the shadow height of every placed stand sprite to the manifest's `casters` (below) |
| `all` | `air-hockey` and `arc-lamp-proxy`, the two whose piece read better lit than today's |

The build records the value in `fx/manifest.json` as `volume` (the chosen names in the order of the table, so `all` is
`air-hockey,arc-lamp-proxy`) and adds two keys. `volumePieces` is `{sprite key: "volume" | "proxy"}`: "volume" for a baked picture,
"proxy" for a kept one. `casters` is `{sprite key: {h, foot, span}}`: `h` the height in px above the floor (21 px per metre), `foot` the
last picture row of the ground contact, `span` the columns `[x0, x1)` of that contact with `x1` exclusive, as `effectsManifest.ts` reads
it. The runtime throws a piece's shadow from `h` when the piece has an entry (`shadeBake.ts`, `placedCaster`) and from the rows of its
picture when it has none. By default `casters` holds only the pieces the other names replace or touch, so turning on one name changes
the shadow of its own piece and of no other. With `casters-all` every placed stand sprite has one: the legacy ones take `h` from
`hq-office/contract/pieces.json` (a measured front face, an anchor or the rows), else from the generic rule (a cap per tag over the
picture's rows), and their foot and span from their own pixels. A proxy's named anchors move a lamp's light only when they lie within
2 px (`fx.ANCHOR_TOLERANCE`) of what the pixel heuristic found for the lamp's head and foot; the catalogue lamps' proxy head sits 6 px
lower than their shade, so those lamps keep the heuristic. The file counts of the declared translucent layers follow the switch
(`translucent.VOLUME_DROPS`): one picture each for `air-hockey` and `stool`, which also leave the declaration because a baked picture is
new art judged by the palette and the drawing contract, and one for `arc-lamp-proxy` and two for `plant-proxy`, whose names stay declared.

`verify.py` judges a build by the switch the build recorded, not by its own environment: `translucent.configure` points the declared
layers and their counts at the recorded names for the pixel and palette checks (`built_with`) and puts the process's own back after.
`office.contract.casters` checks the manifest: exactly the pieces `volumePieces` lists (exactly the stand sprites when the recorded value
has `casters-all`), each with an integer `h` between 1 and the picture's height, a foot row inside the picture and a span inside its
width. A manifest with no `casters` is REPORTED. `office.contract`, `office.contract.pieces` and `office.contract.review` come from
`tools/contract.py`. What each name changes, MEASURED by the reviewer of the switch lane against the default build: `air-hockey`, 3,122
px of the preview, all inside the table, and one caster; `casters-all`, 0 px (only the manifest changes, and it has 105 casters);
`arc-lamp-proxy,plant-proxy`, 2,153 px (the lamp's pool and painted shadow, the plant's leaf tips). On four builds (default,
`air-hockey`, `casters-all`, `arc-lamp-proxy,plant-proxy`) `verify.py` gave 16 pass, 0 fail and 3 reported (the default build 15 pass
and 4 reported) in the lane's snapshots, with the palette baseline raised in the snapshot only; the integrated tree was not built once
per value.

### The acceptance board (`tools/pieceboard.py`)

`python3 -I tools/pieceboard.py stool arc-lamp potted-plant air-hockey --dist DIST --floor PICTURE --out DIR` (also `--view X,Y,W,H`,
`--projections oblique,camera75`, `--map FILE.json`, `--no-overrides`, `--strict`, `--list`) reads a finished build and a lit-lab floor
picture (the unlit `off.png`) and writes only into `DIR`: `board.png` (today's sprite, the baked piece in each projection, its normal and
height maps, aligned on the foot), `scene-<projection>.png` (the lounge at 1:1 and at 3x, the new piece on a clean floor strip beside
today's with a 26 x 32 Woka stand-in for scale), `shadows.png` (the shadow swept from the height map beside the old way) and
`measurements.json` (each measurement of the prototype plan that can be taken without the game, pass or fail with its method, and the
list of what was not taken). It exits 1 only with `--strict` and a failed check.

## The art tests: what each new file checks, how to run it, what it needs

All from `assets/konclui/source`, each file as a script, `python3 -I tools/<file>` (`-m unittest` fails: `-I` drops the working
directory from the import path). The counts are the lanes' runs and their reviewers' runs of 2026-11-23 and 24, MEASURED by them, not a
run of the integrated tree. `KONCLUI_DIST` names a built map (`python3 hq-office/build.py --out DIR --renders DIR2`); a class that needs
it is skipped, with a note on stderr, when it is unset. The tests of the volume kit, the baker, the proxies, the touch-ups, the board and
the four recipes (`test_volume.py`, `test_bake.py`, `test_proxy.py`, `test_touchup.py`, `test_pieceboard.py`, `test_prop_air_hockey.py`,
`test_prop_arc_lamp.py`, `test_prop_potted_plant.py`, `test_prop_stool.py`) run the same way and need no build.

| File | What it checks | Needs | Their run |
|---|---|---|---|
| `test_normals_flat.py` | Relief only where a surface curves: `kinds.flat_face`, `box_body`, `box_evidence`, `relief_profile` and `normals.limit_lean`, `grounded`, `ground_foot`, `tool_normals` on synthetic sprites. `BuiltRelief` measures the placed set: under 2% of the opaque px of `fx/normal.png` lean more than 0.8, none inside a flat face | The pinned normals tool for the classes that run it (skipped with the install command without it); `KONCLUI_DIST` for `BuiltRelief` | 20 tests OK |
| `test_glass.py` | `hq-office/glass.py`: every east-west face is 60 rows, no ground-shadow rows, the film on partitions only, mullion bays between anchors, door leaves, heads, jambs and threshold. `BuiltTilesets` reads the placed tiles of `Konclui_Walls` and `Konclui_Doors` | Nothing; `KONCLUI_DIST` for `BuiltTilesets` | 22 tests OK |
| `test_lawn.py` | `hq-office/lawn.py`: the ground (no period, no seam, few tiles, only the lawn's colours, the same picture on every run), the decor, the gust's redraw budget, the path fringe. `LAWN_FILE=<path>` tests another copy of the module | Nothing, no build, about 10 s | 20 tests OK |
| `test_floor_patterns.py` | `signature.tile_pattern`: the seam, pinstripe and period measures on each floor pattern and, as a control, on the picture it replaced (the measures must fail there); the patterns that must not move are pinned by hash | Nothing, no build | 26 tests OK |
| `test_water_art.py` | The water zone: contact line, bridge, K deck, fountain and basin, banks, glints and ripples, and that the collision did not move | `rsvg-convert` on `PATH` (the file does not skip without it), no build, about 10 s | 22 tests OK |
| `test_reactions_page.py` | `hq-office/reactions/index.html`, read without a browser (section "Reações" of `hq-office/README.md`) | Nothing; with `KONCLUI_DIST` one more test checks that the built page is the source byte for byte | 15 tests OK and 1 skipped, 16 of 16 with `KONCLUI_DIST` |
| `test_volume_pieces.py` | The wiring of the switch: the names, the pieces it replaces or touches, the manifest keys, the light anchors, the normals. `BuiltVolume` needs a build made with the switch; its default-build half runs on a build made without it | Nothing for the pure part; `KONCLUI_DIST` for `BuiltVolume` | 61 tests OK |
| `hq-office/pool/koi/size-and-pixels.test.mjs` | Koi length 10 to 20 px, a seed keeps its patterns, the painter writes only whole opaque 1 px cells closed by ink | Node: `cd hq-office/pool/koi && node --test`; `KOI_DIR=<copy of the module>` tests another copy | 4 tests OK |

`test_pixelgrid.py` gained `FacadeFloors` (7 cases, counted in the file: it imports `build.py` and runs `draw_floors`, no build needed) and `BuiltFacadeDecor`
(needs `KONCLUI_DIST`), which keep the floor under each glass facade and the tufts around it (section "Vidros, portas e pisos sob as
fachadas" of `hq-office/README.md`). `test_verify.py` gained the cases of the recorded switch and of `office.contract.casters`. The tests
differ in strength. The reviewer mutated `glass.py` ten ways and each mutation failed a test. The water tests pass when a constant of the
module they test is changed, because they compare the art with that module's own constants (TODO T-273). The reactions tests are tied to the shipped wording of the
page, so editing the page means updating the variants (the reviewer's note).

## ingest: art from a model or resized

`tools/ingest.py run INPUT --family office|avatars|pets --out STAGING [--cell 32] [--pixel-size N] [--palette FILE]`. It needs
the FIXED pixel snapper: a missing or stock build stops the run before any file is written, with the install command (exit 2).
For each picture: refuse (not a PNG/JPEG/WEBP by extension and content, animated, too large; STAGING inside any source art
directory, `$KONCLUI_DIST`, a `--protect DIR`, or holding a release ledger or `.tmj`), run the FIXED pixel snapper without a
palette (at most 256 colours: it finds the grid, it does not recolour), let `tools/gridguard.py` decide, repair alpha
(`pixelgrid.binary_alpha`, size-preserving, a no-op on binary alpha), check the family's size rule, the palette and "not fully
opaque", and write `NAME.png`, `NAME.preview.png` (at most 2048 px wide) and `report.json`. For every picture the report states
the guard's decision, its reason and the numbers behind it, and the INPUT's alpha class (opaque, binary or partial). Verdicts:
`ready`, `needs review` (a judgement check failed), `rejected` (also written only as `rejected/NAME.png`, never as a staged
picture). Exit 0 only when every picture is ready.

MEASURED 2026-11-23, re-run for this text: one folder, four pictures made with Pillow from `art/out/wokas/konclui-bone.png`
(96 x 128): the native as it is, the same at 4x (nearest), at 8x (nearest, Gaussian blur radius 1, RGB noise of +-6) and at 16x
(nearest). `--family avatars --palette tools/palettes/avatars.hex`, 1.4 s, exit 1: the native `ready` (PASS_THROUGH, `on-grid`),
the 4x `ready` (ACCEPT, agreement 1.000), the 8x `ready` (ACCEPT, agreement 1.000), the 16x `rejected` (`factor-out-of-range`).
The same folder with `--pixel-size 4` for all four: only the 4x is `ready`; the native is shrunk to 24 x 32 (`off-grid-size`),
and the 8x and the 16x come back 192 x 256 and 384 x 512 (`family-size`). The four pictures and the script that made them are
not kept.

### The guard (`tools/gridguard.py`, pure functions, no tool calls)

| Decision | Meaning | Staged |
|---|---|---|
| `PASS_THROUGH` | the snapper returned the same size and the same pixels (same alpha everywhere, same colour wherever alpha > 0) and the input shows no trace of an enlargement (below); or `--pixel-size 1` was given and the snapper kept it (`on-grid-asserted`: the caller's word, not screened) | the INPUT: its own bytes when it is a PNG with nothing to repair; colours are not mapped, so off-palette art says so in the `palette` check |
| `ACCEPT` | an enlargement whose recovered grid is proven: both sides whole multiples of the cell and fit for the family (avatars 96 x 128, pets 512 wide, office cell multiples); a factor input/output of 3.5x to 10x on each axis (plus 0.1 for a 3 px pad on a 32 px axis) and the two within 8% of each other; the result enlarged back with nearest neighbour agrees with the input on at least 90% of the compared pixels; no coarser reading of the result (every 2nd, 3rd or 4th pixel) agrees at 97% or more; and the result fits at least 0.02 better where it is than moved by one art pixel in any of 8 directions | the snapper's result; with a palette of 256 colours or fewer a second, colour-only pass (`--pixel-size 1 --palette`) maps it, the grid is not touched |
| `REFUSE` | anything else, with one reason (below) | nothing; `rejected/NAME.png` only for inspection |

Agreement is measured on the central half of every cell only (blur, bilinear and JPEG live on the borders), over the pixels
visible in either picture: alpha within 0 levels for opaque and binary input and within 64 for partial, colour within 48 per
channel where both are visible. REFUSE reasons (`gridguard.REASONS`): `tool-unresolved`, `tool-failed`, `tool-unreadable`,
`blank-input`, `on-grid-altered`, `off-grid-size`, `family-size`, `factor-out-of-range`, `factor-unequal`, `pixel-size-mismatch`,
`reenlargement-disagrees`, `reenlargement-unmeasurable`, `coarser-grid-explains`, `registration-ambiguous`, `input-blocky`,
`input-resampled`. `report.json` has per picture `guard.decision`, `guard.reason`, `guard.message` and `guard.evidence` (factor,
agreement, coarse agreements, sizes, alpha class, blend share, registration margin), and records the thresholds in `grid.guard`.

Why not the contract. A refusal of the snapper is never turned into a pass-through because the picture meets the family's rules
(size, alpha, colour): an 8x enlargement of 32x32 art is 256x256, a multiple of the cell, and an avatar drawn 24x32 and shown at
4x is exactly 96x128. MEASURED 2026-11-23: of the 227 pictures the snapper refused (6 natives, 221 degraded), 4 natives and 22
enlargements met those rules as they were, so a contract-based pass-through would stage 22 wrong pictures to save 4 right ones.

### Is it on its grid? (what PASS_THROUGH does and does not claim)

The snapper cannot tell an enlargement below 3.5x from art on its grid and returns it unchanged. MEASURED 2026-11-23 (lab at
`/tmp/gridlab`, 112 natives; 1,502 enlargements of them below 3.5x: 2x, 2.5x, 3x and 3.3x as nearest, bilinear, bicubic, Lanczos,
blur and noise, and art halved and re-enlarged): the first version of the guard passed 315 of the 1,502 through. PASS_THROUGH now
looks for two traces in the input and refuses on either: `input-blocky` (the input read at every 2nd, 3rd or 4th pixel explains
itself at 0.97 or more: nearest enlargements, and art drawn in blocks) and `input-resampled` (`blend_share` at 0.25 or more: the
share of clear edges crossed by a pixel that is a blend of its two neighbours; natives at most 0.202 of 112, bilinear at least
0.309, bicubic at least 0.280). Result: 19 of 1,502 pass (all Lanczos 2x enlargements of pet or avatar sheets, at sizes the family
size check rejects later: 16 pet sheets 1024 wide, 3 avatar sheets 192 x 256); 5 of 106 natives that used to pass are refused
(32x32 office entities made of exact 4x4 blocks; `--pixel-size 1` keeps them). So PASS_THROUGH is "no trace found", not a proof.
Not covered: other resamplers (Lanczos blends fall to 0.151, under the native maximum), JPEG, and art with no flat run at all (a
per-pixel noise picture enlarged 2x with bilinear has blend 0.085 and self-coarse 0.93, synthetic); pictures whose sides no step of
2, 3 or 4 divides get the blend screen only. The thresholds were fitted on these natives (lab alone, then checked on the
held-out ones): there is no untouched set for them. Cost on the largest native (1030 x 1348, loaded host): 0.12 s and 0.30 s.

### Measured, the lane (tool + guard), 2026-11-23, tool auto-detecting the pixel size

Scripts and pictures live under `/tmp/gridlab` and `/tmp/gridguard-eval`, not in the repository: these numbers cannot be
reproduced from a clean checkout.

| set | n | lane: identical or right / refused / silently wrong | tool alone: right / refused / wrong |
|---|---|---|---|
| lab natives | 91 | 81 / 10 / 0 | 85 / 6 / 0 |
| held-out natives | 21 | 20 / 1 / 0 | 21 / 0 / 0 |
| lab degraded (13 variants) | 390 | 245 / 145 / 0 | 301 / 84 / 5 |
| held-out degraded | 273 | 152 / 121 / 0 | 192 / 79 / 2 |
| stress, 12x to 32x | 80 | 0 / 80 / 0 | 16 / 58 / 6 |
| below 3.5x | 1,502 | 1,483 refused, 19 false pass-through | the tool returns 341 of them, not refused |

"Wrong" is a size different from the true art's. Natives: of the 10 lab natives refused, 6 are refused by the tool itself ("no
grid found": 3 blank layers and 3 sparse pictures) and 4 are `input-blocky`; the held-out refusal is `input-blocky`. Those 5 are
native art built from 4x4 blocks, which cannot be told from an enlargement. The manual route is `--pixel-size 1`
(`on-grid-asserted`): with it all 91 and 21 natives were kept, the 6 the tool refuses included. Degraded: 572 of the 663 have an
answer that fits a family (338 lab, 234 held-out); the other 91 (52 and 39) have none and are refused by construction as
`off-grid-size`. Of the 572 the guard refuses 17 that the tool had right: 14 `coarser-grid-explains` (flat or blocky tiles cannot
be told from a result that stopped at a fraction of the grid) and 3 `reenlargement-disagrees` (crop or pad variants, agreement
0.855 to 0.897). All 7 wrong sizes of the tool alone (lab 5, held-out 2: 96x124 for 96x128, 511x128, 63x32, 32x67, 224x67,
367x208 and 371x217 for 373x209) are refused as `off-grid-size`: their agreement is 0.956 to 1.000 (one 0.807), so the cell
multiple is what stops them. The one stress result at a wrong multiple (128x256 for 32x64) has factor 4 and agreement 0.987 and
is caught only by the coarse check. With the pixel size given exactly (150 lab and 105 held-out pictures, nearest at 4x, 8x and
10x) the tool never refuses and is wrong on 11 and 7; the lane keeps 107 and 79, refuses 43 and 26 and is wrong on 0.
Enlargements of 2x and 3x (104 pictures, nearest and bilinear) were all refused, none passed through.

Calibration. Agreement 0.90: among 509 right outputs the minimum is 0.855, p1 0.917, median 1.000; the threshold costs the 3
pictures above, and it was set on both the lab and the held-out sets, so the held-out set is not independent for it. Coarse 0.97:
on 424 right outputs it flags 13 (3%), and it flags 3 of the 4 wrong stress outputs that reached it. Accepted pictures (397): factors
4.0 to 10.03, skew at most 4.9%. Registration: the lowest margin over the 8 one-pixel moves of those 397 is 0.0299 (lab 0.0299,
held-out 0.0313), so it refuses none of them; of 3,176 one-pixel moves of them, 131 still read back at 0.90 and all 131 are refused
by the margin; against the true art (best of 9 one-pixel moves) 0 of the 397 are misregistered, before and after the check was
added. Limits: on small diagonal art the registration check sees the border effect and can pass a one-pixel diagonal shift; other
resamplers and JPEG are not measured; only 2x to 32x enlargements were measured.

`pets.hex` has 377 colours, more than the tool reads, so a pet picture is `needs review` unless `--palette` names one species'
palette. Staging is a dead end: nothing reads it, and promoting a staged picture into a family's sources is a human copy.

## publish and roll back

`tools/publish.py` is the only door from a build to a served map directory; map-storage serves it while people edit it in the
map editor, so a plain copy would destroy those edits. Always give `--backup` a directory outside the target and the build.
MEASURED 2026-11-22, before `--public-base-url` existed (below), on a COPY under `/tmp` (never a real served directory or
docker volume): an older build was published into `/tmp/kv/served` (12,793 files), `office.tmj` there was edited by hand, then:

```
python3 -I tools/publish.py plan   /tmp/kv/dist /tmp/kv/served
    new 0, changed 5, identical 12787, left alone 1, protected 1 ... office.tmj ... edited  PROTECTED (edited-in-place)
python3 -I tools/publish.py apply  /tmp/kv/dist /tmp/kv/served --backup /tmp/kv/backups --time 2026-11-22T12:00:00Z
    exit 3, "protected files would change; nothing was written", office.tmj unchanged (sha256 b2de45d6...)
python3 -I tools/publish.py apply  /tmp/kv/dist /tmp/kv/served --backup /tmp/kv/backups --time 2026-11-22T12:00:00Z --exclude office.tmj
    exit 0, published 4 files as release 33511cdd8f3a8636, office.tmj still b2de45d6...
python3 -I tools/publish.py verify /tmp/kv/served
    ok: 12791 files of publish 33511cdd8f3a8636 have the hash that was recorded
python3 -I tools/publish.py rollback /tmp/kv/served --backup /tmp/kv/backups
    rolled back release 33511cdd8f3a8636: restored 4; office.tmj still b2de45d6..., bell.json back to the older bytes
```

After the rollback `plan` again lists `office.tmj` as protected: its content is still not what the ledger recorded.
`--include-edited GLOB` overrides a protection only when named, after the plan was read. Writes are atomic per file (a temporary
dot-name renamed into place), map files go last, every file is read back and hashed, the ledger `.konclui-release.json` records the
release id, the files, the tool identities of the build, and `public_base_url` and `rewrites` (below; null and empty when no base
was given). Exit codes: 0 ok, 1 verify found drift, 2 refused (nothing written), 3 a protected file (nothing written), 4 a write
failed and everything was restored, 5 an incomplete restore (the backup is kept). The module docstring has the manual recovery
after a SIGKILL (`BACKUP/<id>/intent.json`), the note that map-storage keeps WAMs in memory (reload the room after publishing a
`.wam`), and the ownership rule (the tool chowns best effort).

The transcript above predates the flag. The build's `office.wam` has relative `entityCollections` urls (MEASURED 2026-11-23: a
`plan` of `/private/tmp/kv/dist2` into an empty folder without `--public-base-url` exits 2 and names `office.wam` with its 6
relative urls), so on such a build every `plan` and `apply` above now exits 2 until `--public-base-url` is given or
`--exclude '*.wam'` leaves the `.wam` out.

### publish: entityCollections and `--public-base-url`

The client does not resolve a WAM's `entityCollections` urls against the map. `GameScene.loadEntityCollections` hands them as they
are to `EntitiesCollectionsManager`, which calls `fetch(url)` (a relative url resolves against the page's `<base href="/">`, the
play origin, never map-storage; `play/index.html`) and then `new URL(entity.imagePath, url)` (throws `Invalid URL` on a relative
url). So a published `.wam` with relative urls, which is how `hq-office/build.py` writes them (`hq-office/taxonomy.py` reads them
relative to the dist), loads with no furniture. No relative form works, so the build is unchanged and `publish.py` writes the
absolute form into the staged copy. `docs/map-building/inline-editor/entity-collection-file-format.md` says a relative url is
relative to the map file; the client at this commit does not do that.

```
python3 -I tools/publish.py plan  /tmp/kv/dist /tmp/kv/served --public-base-url http://localhost:9090/maps/office/
python3 -I tools/publish.py apply /tmp/kv/dist /tmp/kv/served --backup /tmp/kv/backups --public-base-url http://localhost:9090/maps/office/
```

`--public-base-url` is the URL under which TARGET is served: http or https, ending in `/`, no credentials, query or fragment; it is
never completed or guessed, and a bad one exits 2 with nothing written. Every relative url of a selected `.wam` is resolved against
that `.wam`'s own public URL (base + its path in the target), as the client resolves `mapUrl`; an absolute url is left alone and
listed; only the url strings change, the rest of the file keeps its bytes. `plan` shows old and new for every entry. Without the
flag a selected `.wam` with a relative url is REFUSED by `plan` and `apply` (exit 2, nothing written, before the protection check),
even when the target already holds an identical copy: `--exclude '*.wam'` publishes the rest. A `.wam` that is not JSON with an
`entityCollections` list is published as it is ("not inspected"). An entry with no usable string `url` is listed as `invalid` and
left alone. The DIST is never written; the rewritten bytes are kept at `BACKUP/<release id>/staged/<path>` as the record of what was
published. The plan, the ledger and `verify` use the hash of those bytes, so a `.wam` whose only difference from the last publish is
the rewrite is `identical`, a rebuilt one is `as-published` and protected only as `editor-owned`, and an editor edit is still
`edited`. The ledger entry records `public_base_url` and `rewrites` (hash of the build's copy, old and new value of every url); a
rollback puts back the bytes the target held. Re-publishing a changed `.wam` still needs `--include-edited '*.wam'`, because
`*.wam` is editor-owned. MEASURED by the publish lane on the built office (`/private/tmp/kv/dist2`): 6 collection urls and 11,355
entity images, all 11,361 resolved urls land on a file of the build; the published `.wam` differs from the build's in 6 lines
(12 diff lines). `.local/konclui/qa/seed.mjs` of the QA stack did the same by hand (`<publicBase>/<room>/<url>`): that base is the
flag's value. For a real publish the operator names the base; the dry run in the lane's report used `http://example.test/maps/office/`.

## What is NOT automated

- Promoting a staged picture into a family's sources (a human copy and a diff review).
- Repainting a family to its palette. The office is 12,540 pictures off it; avatars and pets conform and are guarded.
- The publish to a served volume. The integrator runs `publish.py` against the real directory; `konclui-assets.yml` never does.
  The `--public-base-url` is named by the operator; the tool never guesses it.
- Installing a tool. The CI job and every step stop with the install command; a person runs it on the host. The fixed pixel
  snapper is built from source by `tools/build_pixel_snapper.py` (needs `git` and `cargo`), once per host.
- Looking at the result in a browser: pan shimmer, shadows on and off, the normals' direction and GPU cost are unmeasured. Art wave 1
  added things that only unit tests and still pictures have seen: the painted water frames over the water shader by day and under it at
  night, the fountain's rings, the reaction page's claps and confetti, the koi, and the entrance doors (the shader lab does not draw
  water, glass or the doors layer).

## perfectPixel

`https://github.com/theamusing/perfectPixel` has NO licence file and takes RGB only. It is never required, installed, vendored or
copied. `ingest.py` asks it for a second opinion on the grid size only when the module `perfect_pixel` happens to be importable
(today it is not: the report says "not checked"); a run without it gives the same staged files and verdicts.

## CI

`.github/workflows/konclui-assets.yml`, `workflow_dispatch` only, on `[self-hosted, ci-host]`. Steps: the numpy and Pillow
import, `toolchain.py status`, optionally the office build, the test loop, optionally `verify.py` (`--rebuild` on request),
whose `verify.json` goes to the job summary. The test loop runs `test_toolchain.py`, `test_pixelgrid.py`, `test_palettesnap.py`,
`test_ingest.py`, `test_publish.py` and `test_verify.py`, and also `test_gridguard.py`, `test_kinds.py` and `test_fx_kinds.py`, and,
since art wave 1, `test_volume.py`, `test_bake.py`, `test_contract.py`, `test_proxy.py`, `test_touchup.py`, `test_pieceboard.py`,
`test_prop_air_hockey.py`, `test_prop_arc_lamp.py`, `test_prop_potted_plant.py`, `test_prop_stool.py`, `test_volume_pieces.py`,
`test_lawn.py`, `test_glass.py`, `test_floor_patterns.py`, `test_water_art.py`, `test_normals_flat.py` and `test_reactions_page.py`
(`KONCLUI_DIST` is exported only when the build step ran; the koi's Node test is not in the loop). **The runner also needs
`rsvg-convert`** (the office build and `test_water_art.py` call it; the workflow does not check for it).
**The runner needs `python3` with numpy and Pillow and the three tools** (on `PATH`, in `~/.cargo/bin`, or named by the override
variables above), the pixel snapper being the FIXED build (`python3 -I tools/build_pixel_snapper.py` once; a stock one named by
the override is a mismatch): the job installs nothing, and fails at `toolchain.py status` with the install command of each missing
tool. The pinned hashes are of macOS arm64 binaries; the version pin (and the pixel snapper's capability probe) is what a Linux
runner is held to. A build manifest made before the fixed snapper became the pin must be rebuilt. Not run here (it needs a
dispatch).

## The mandate against what is built (item 3 of `.local/konclui/MANDATE-2026-11-21.md`)

- `sources/entities/*.png` does not exist; the placed sprites are the build's `dist/entities/**/*.png` (219 distinct sprites
  under 664 placements), which `normals.py` reads.
- `--tile-size 32x32` is the tool's `--frame-size WxH`; `atlas` passes it.
- `fx.py`'s `dx = (lum[:, 2:] - lum[:, :-2]) * 0.5` and `pixelMaps.ts` normals are not in this tree; the only luminance finite
  difference is the fallback `normals.py` `legacy_normal`. The tool is the default.
- `vWorld` is not in `shaders.ts`; the lookup that decides pan shimmer is `mapUV` (whole map pixels, not 32 x 32 cells). 213 of
  664 placed entities are off the 32 px tile grid in x (DERIVED), so cell alignment does not decide shimmer.
- The file is `fx/normal.png` (what `effectsLoader.ts` reads), not `normals.png`; B is `nz`, not a constant.
- Stamping pet and avatar atlases into the map texture is not possible (they walk); `atlas` writes separate files.
- The `POST_FRAG` rim light for `uPeople` is the ambience lane's file, not touched here.
- The snapper IS now a pipeline step, but only for the second door: `ingest.py` (and the manual `pixelgrid.py snap`). No build
  calls it, because every sheet the repository builds is native. The stock snapper broke native sheets; the fixed build keeps
  them, and `ingest` stages a native picture unchanged as PASS_THROUGH (section "ingest").

## Open

- `normals.py` finds its tool with `toolchain.locate` (through `pixelgrid.tool_path`) and does not call `toolchain.require`, so
  the normals version is not pin-checked at the moment it runs; `verify.py`'s `toolchain` check is where a wrong version is
  caught. Closing it is a change at the three `PG.tool_path` call sites of `normals.py`, a file outside the integration lane.
  (`pixelgrid snap` does call `toolchain.require`, through `pixelgrid.snapper_path()`.)
- The module docstring of `pixelgrid.py` still describes the stock snapper ("it can NOT repair a native sheet", a native 32x32
  cell coming back 25x25, the 512x128 gato sheet 370x100); `snap` now runs the fixed build. The docstring is outside this README.
- Hosts and CI runners need `python3 -I tools/build_pixel_snapper.py` once: until then `toolchain.py status`, the `toolchain`
  check of `verify.py` and the ingest tests fail there. A build manifest made before the switch records the stock hash, and
  `verify.py` fails it only with `KONCLUI_TOOLCHAIN_SHA256=enforce`; `manifest_tools_result` could also refuse a recorded hash
  that is listed under `toolchain.STOCK['pixel-snapper']` (a suggestion, not done).
- The guard's thresholds (agreement 0.90, blend 0.25, registration margin 0.02) have no untouched validation set, and the lab,
  held-out and stress sets and the scripts that score them are under `/tmp`, not in the repository. PASS_THROUGH is "no trace
  found": 19 of 1,502 enlargements below 3.5x (Lanczos 2x of pet and avatar sheets) pass it, and other resamplers and JPEG are not
  measured (above). The guard refuses flat or blocky tiles (a tile drawn in 4 px cells) as ambiguous; `--pixel-size 1` keeps them.
- Upstream issue https://github.com/Hugo-Dz/spritefusion-pixel-snapper/issues/15 had no answer when `tools/patches/README.md`
  was written; remove the patch when upstream ships the behaviour (`tools/patches/README.md`, "Removing it"), and run the
  guard's measurement again before trusting the new binary.
- The office is 12,540 pictures off its palette (above); the avatar lock freezes today's sheets.
- The palette-snapper hash in `toolchain.json` is from a local-checkout build (above).
- `palettesnap.snap --force` is not atomic if a move fails halfway, and the wiring of `build.py` to `check_palette` is covered by
  a text test only.
- `test_ingest.py`'s upper-case-path test assumes the repository has an `assets/konclui` layout.
- `publish.py` has no automatic recovery after a SIGKILL (documented manual steps), and cannot know about the map editor's in-memory WAMs.
- Pet and avatar atlas normals have no consumer; `verify.py` does not check them.
- Pan shimmer, shadows on and off, the normals' direction, and every GPU number: not measured here; the shader owner owns them.
- `fx.py` writes `normal.png` once per build, so any later change of a prefab's `depthOffset` changes its bytes: expected.
- `konclui-assets.yml` has not been dispatched; its first run on the pool is the test.
- Art wave 1 left open work in `docs/TODO.md`: section 8b (T-285 to T-299: the unwired terrazzo, the entrance sign, the film alpha,
  three wall items, floor transitions, round pieces without a soft tag, the leftovers of the water zone and the TV slide, the air hockey's
  colours, the banks, the fountain's rings, the koi README and the reactions page's browser floor), section 8 (T-273 to T-275: the water
  tests' literals, smaller test gaps, and byte comparisons across machines) and section 2 (T-267 to be seen in the game, T-268 under repair).


## Relief by piece, and what counts as the piece (2026-11-23)

`tools/kinds.py` has two more decisions beside the kind. `SOLID_ALPHA` (200) is the alpha from which a pixel is the piece: the art
is 0 or 255, and the layers a picture carries on purpose are not (a painted shadow at 128 to 166, a lamp's baked pool of light at 130 to
155 under the lounge's bedside tables). The runtime's `shadeShapes.ts` reads the same bound, and `__fixtures__/shade-shapes-cases.json`
holds pictures both sides run (top, foot, painted). `relief_profile(kind, tags, light_kind)` says what `normals.py` stamps: nothing for a
floor piece, the flat normal for a lamp (it is the light and takes no relief: a lit shade fell to 80% of its brightness), a 4 px bevel
for a table, counter, shelf, picture, screen or piece on furniture (a 20 px dome folded a desk top into four triangles), and the dome of
its size class only for soft furnishings (plants, sofas, chairs) whose picture is not a box (below, "Relief only where a surface
curves"). The bevel is made, not asked of the tool: the tool's `--shape-radius` is a
long fall-off (a 4 px radius left none of a plain rectangle flat) and its `--detail-strength` reads a picture's painted wash as relief (the air
hockey's playfield became a four-faced roof), so a bevel piece runs with `--detail-strength 0` and keeps the tool's normal only on the outer
`BEVEL_PX` (4) px; inside that edge the normal is the flat one. `test_kinds.py` pins it, and the lab's `flatPropChanged` is 0 for the relief. A manifest with no "kinds" is an older build: every piece is domed.

Two changes after the review of 2026-11-23. (1) A domed piece's normals are averaged over its solid pixels (`normals.smooth`, 1 pass under 48 px,
2 under 96, 3 above; `SMOOTH_PASSES`), because the tool's relief on a tree's canopy, a bean bag and a planter came out as facets that the
lighting's bands cut into hard-edged triangles; the step between two neighbouring normals, which is what a crease is, is under 45% of what
it was (`test_kinds.py`, `Profiles`). A bevel piece and a lamp are not smoothed. (2) `kinds.classify` has a fourth rule, after the hang
rule: a WHOLE-WORD match of `TOP_WORDS` (imac, notebook, laptop, macbook) in the name is `top`, so "Computador iMac" on the reception desk is
a piece on furniture whether or not its name says "(sobre móvel)" (a picture named "Quadro: Koru no notebook" is still a `hang` by the
rule above it). The runtime's `casterKind.ts` has the same rule and `placed-kinds.json` was written again with `fx.py --dump-kinds`: the
iMac is the one piece whose kind changed on the placed map (stand to top).

### Relief only where a surface curves (audit rule R12, 2026-11-23 and 24)

A soft-furnishing tag says what a piece is usually made of, not what this picture is. The white planter "Floreira branca" is tagged
Plantas and its picture is a box with reeds on it, so the dome across its face lit as a bright and a dark wedge. `kinds.relief_profile`
therefore has a fifth profile, `box` (`RELIEF_PROFILES` is now none, flat, bevel, box and domed), and a `box=` argument. The picture, not
the tag, says a piece is a box (`kinds.box_evidence`): its largest rectangle of one colour (`flat_face`, tolerance 6 per channel, over the
fully opaque pixels) is at least 800 px, at least 12 px on its shorter side and at least 40% of the opaque pixels. A name with the whole
word `floreira`, `jardineira`, `caixote` or `cubo` lowers the bar to 300 px and 25% but never replaces the picture. The body of a box
(`kinds.box_body`: the rows around the face that are at least 80% as wide as the face) takes the `bevel` treatment, and what stands out
of it, a planter's reeds, takes the dome. The rule is evidence-based and fires on exactly one piece today: `piece_profiles` on the relief
lane's build gave bevel 154, domed 50, flat 9 and box 1 (MEASURED by its reviewer). The planter's face is 1,008 px, 56 x 18 and 51% of
its opaque pixels; the next soft piece, a sofa's cushion strip, is 539 px, 77 x 7 and 25% (the figures in the comment of `kinds.py`,
MEASURED on HEAD's build). The 800 px, 12 px and 40% were chosen on this one map: a box-shaped piece with a soft tag, a small or broken
face and no box word in its name would stay domed.

A flat face keeps the flat normal (128, 128, 255). Only the 4 px edge (`BEVEL_PX`) leans, never more than `EDGE_LEAN` (0.7, a chamfer of
about 45 degrees and not a cliff). A piece that stands on the floor has no bevel at its foot, because there it meets the floor and
nothing turns: the manifest calls it `stand` and its lowest solid row is at least `GROUND_SHARE` (0.6) of its width (`normals.grounded`,
`ground_foot`); a desk's top on legs is not grounded, so its lower edge stays an edge. A `domed` piece leans at most `SOFT_LEAN` (0.7).
`normals.limit_lean` is the one soft clip, cap * tanh(lean / cap): it is the lean itself when the lean is small and never reaches the
cap, so the order of the slopes is kept and no plateau forms. MEASURED by the relief lane on the placed set: the pixels of
`fx/normal.png` that lean more than 0.8 went from 364,946 of 815,452 to 0, and those that lean more than 0.5 from 509,330 to 475,606.
Its reviewer measured the mean lean of the opaque px going from 0.523 to 0.365, with 530,974 px changed and none outside an opaque
pixel. By eye only the white planter is clearly better (its wedges are gone); the desks, the Eames table and the cabinet were already
flat inside and show no difference at 1:1, and the sofas keep a soft relief. `test_normals_flat.py` pins all of it (section "The art
tests").

Not done: a round or curved piece without a soft tag (an oval coffee table, a round walnut table, a guitar, a piano) stays on the
`bevel` profile, as it did before, so the other half of the rule, curved things curve, is done only through the soft tags (TODO T-292).
