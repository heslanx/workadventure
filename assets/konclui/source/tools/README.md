# The art pipeline: grid, palette, alpha, normals, verify, publish

Run from `assets/konclui/source`, Python 3 with numpy and Pillow. Nothing here is imported by the runtime. Every number is
MEASURED (a command in this repo, run on 2026-11-22 unless said otherwise) or marked DERIVED.

**Is this build fit to publish?** `python3 -I tools/verify.py DIST` (section "verify"). **Which tools are installed?**
`python3 -I tools/toolchain.py status`. **The tests:** `for t in tools/test_*.py; do python3 -I $t; done` (each file as a script: `python3 -I -m unittest test_verify` fails, `-I` drops the working directory from the import path). MEASURED 2026-11-22 with `KONCLUI_DIST` set to a built
map (without it `BuiltOffice` and `BuiltMap` are skipped, with a note on stderr), all OK: toolchain 69, pixelgrid 73,
palettesnap 58, ingest 55, publish 79, verify 67. Tests that run a tool skip, with the install commands, on a host without it.

## The principles

1. Pinned tools. The three SpriteFusion tools are pinned in `toolchain.json`. A missing or wrong tool stops the run with the
   exact install command; there is no silent fallback. One exception is kept as it was: the build's luminance fallback for the
   normals (below), which is stamped in the file and fails `verify.py` unless allowed.
2. Sources are immutable. Every tool writes into a build or staging directory; `snap` and `binarize` refuse to work in place.
3. Deterministic. The same inputs give the same bytes (`verify.py --rebuild` builds twice and compares every file).
4. Each tool is also a checker where that is possible: `palettesnap check` runs the palette tool on art and fails when a pixel
   is off its palette (a pixel the tool would only merge into a close palette colour is counted, not failed). Not possible for the pixel snapper, which re-derives the grid of whatever it is given (a native 32x32 cell
   comes back 25x25, MEASURED), so `ingest` is excluded from this principle and native art never goes through it.
5. Nothing reaches a served map directory except through `publish.py`, which backs up what it replaces and can roll back.

## The two doors

| Door | For | Path |
|---|---|---|
| Art drawn on the grid | everything the repository builds today: the office (imported art recoloured by `hq-office/build.py`), the pets, the avatar and companion sheets | the checks below, run by the builds and by `verify.py` |
| Art that was NOT drawn on the grid: from an image model, or resized | nothing yet; the quarantine lane for when it arrives | `ingest.py` into a staging folder; a person promotes a picture by copying it |

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
| build | `hq-office/build.py --out /tmp/kv/dist --renders /tmp/kv/renders` | the office map; runs `sheetcheck.check_dist` (grid, alpha, translucent layers), `sheetcheck.check_palette`, writes `fx/normal.png` and the manifest (72 to 98 s on this Mac) |
| grid, alpha | `tools/pixelgrid.py check /tmp/kv/dist/entities /tmp/kv/dist/seats --no-grid` | `check`: alpha, 32 px size, optional palette lock, one line per failure with file, cell and pixel, exit 1. `report`, `binarize IN OUT`, `snap IN OUT` (the pixel snapper, for AI-upscaled art only) |
| palette | `tools/palettesnap.py check --family avatars art/out/wokas art/out/companions` | exit 1 on a picture off its palette. `--family avatars\|pets` use each picture's own lock; `--palette FILE` checks any palette; `snap`, `report`, `palettes [--write]` |
| ingest | `tools/ingest.py run IN --family avatars --out /tmp/kv/staging --palette tools/palettes/avatars.hex --pixel-size 4` | quarantine lane, below |
| normals | `tools/normals.py /tmp/kv/dist /tmp/kv/normal.png --method tool` | map-space normals; `compare`, `atlas` |
| verify | `tools/verify.py /tmp/kv/dist [--family office\|avatars\|pets\|all] [--allow-legacy-normals] [--rebuild]` | one line per check, `verify.json` beside DIST; exit 0 only without a failure |
| publish | `tools/publish.py plan\|apply\|rollback\|verify ...` | below |

Per-family gates, which the builds call and which stay as commands: `hq-office/sheetcheck.py check --dist DIR` (also the
imported `--sheets`), `pets/tools/sheetcheck.py check`, `avatars/sheetcheck.py check` (`check_exported` is the alpha and
96 x 128 rule over the layers `avatars/native_export.py` writes, which fails the export on it). "Cell grid" means width and
height are multiples of 32 (avatars exactly 96 x 128, pets 512 wide); art that crosses a cell border is NOT detected.

## Tools, versions, provenance (`toolchain.json`)

| Tool | Pin | Source | Environment override | Install (run once on the host; nothing installs it for you) |
|---|---|---|---|---|
| `spritefusion-pixel-snapper` | 1.0.0, commit `5743009265051098831ad7298092072325d1149b` (tag v1.0.0), MIT | Homebrew tap `hugo-dz/tap`, https://github.com/Hugo-Dz/spritefusion-pixel-snapper | `SPRITEFUSION_PIXEL_SNAPPER_BIN` | `brew install hugo-dz/tap/spritefusion-pixel-snapper` |
| `spritefusion-sprite-normals` | 0.1.0, commit `d14b06726cabab09c68a403ce2e684a52efbfe4c`, MIT | https://github.com/Hugo-Dz/spritefusion-sprite-normals | `SPRITEFUSION_NORMALS_BIN` | `cargo install --locked --git https://github.com/Hugo-Dz/spritefusion-sprite-normals --rev d14b06726cabab09c68a403ce2e684a52efbfe4c` |
| `spritefusion-palette-snapper` | 0.1.0, commit `ea647826abf82b70f87f54a4e45a58515eab650a`, MIT | https://github.com/Hugo-Dz/spritefusion-palette-snapper | `SPRITEFUSION_PALETTE_SNAPPER_BIN` | `cargo install --locked --git https://github.com/Hugo-Dz/spritefusion-palette-snapper --rev ea647826abf82b70f87f54a4e45a58515eab650a` |

Lookup: the override when set (set but wrong is an error, never a fallback), else `PATH`, else `~/.cargo/bin`. The version is
the tool's own `--version`; a build suffix or extra digits (`1.0.0.1`, `1.0.0-rc1`) is not 1.0.0. `status` prints the first
16 hex digits of each binary's sha256. The hashes on this Mac (`toolchain.json` lists them) are recorded and printed, and
enforced only with `KONCLUI_TOOLCHAIN_SHA256=enforce`, because a rebuild of the same commit gives another binary. The
palette-snapper hash is of a build from a local checkout of the pinned commit, not of the documented `cargo install --git`
command: re-measure and list the hash when that command is run on a host. Source review (no `build.rs`, no network, no process
spawning, `unsafe_code` forbidden): sprite-normals 60 crates, palette-snapper 65 crates. `KONCLUI_TOOLCHAIN_ALLOW_MISMATCH=1`
lets a step run another version with a loud warning; `verify.py` still fails it.

**What a missing tool does.** `toolchain.require` raises `ToolMissing` or `ToolMismatch` with the install command: the palette
check (so the office build and the avatar and pet gates), `ingest` and `verify.py` stop or fail. The
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
| office | `palettes/office.hex`, 51 colours | 12,540 of 12,542 pictures are off it (14,340,377 px; 116 declared translucent pictures are left out), largest move 0.2628 OKLab | the off-palette pictures or px GROWING past that baseline, or the office conforming while the declaration still says it does not | the counts, every build and every `verify.py` |

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
stamped back to front by `y + height + depthOffset`, a tie to the larger x. It covers 962,055 of 4,931,584 px (19.5%) and the
file is 1,026,574 bytes with the tool, 522,601 with the fallback. Atlases of the pets, avatars and companions
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

### toolchain, determinism

`toolchain`: all three tools resolve, match their pin, and with `KONCLUI_TOOLCHAIN_SHA256=enforce` have a listed hash.
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
record: rebuild). `NORMAL_TOLERANCE` is 0.0070 (the 8-bit rounding bound 0.0068 plus a hair; the measured worst is 0.0065). It took 32 s on an idle Mac and 118 s on a loaded one; with `--rebuild` (two builds) 9 min 24 s on a loaded one, and the two
builds were byte-identical over 12,793 files and identical to the DIST given. The
avatar and pet sheets are not in the office map: their families are checked where their gates check them, read only. Planted
defects each fail their own check by name (`test_verify.py`): a partial-alpha sprite `office.alpha`, an off-palette pixel in
avatars or pets `<family>.palette`, a normal map of the wrong size or stamped `legacy` `office.normals`, a missing or other-version
tool `toolchain` (and `<family>.palette`, which raises `ToolMissing`).

The build manifest records which tools made it: `fx/manifest.json` has `tools` (`fx.tool_record()`: for each tool version,
pin, commit, sha256, `matches`; missing tools by name). The runtime's schema ignores the key. `publish.py` copies it into
the release ledger.

## ingest: art from a model or resized

`tools/ingest.py run INPUT --family office|avatars|pets --out STAGING [--cell 32] [--pixel-size N] [--palette FILE]`.
For each picture: refuse (not a PNG/JPEG/WEBP by extension and content, animated, too large; STAGING inside any source art
directory, `$KONCLUI_DIST`, a `--protect DIR`, or holding a release ledger or `.tmj`), snap the grid with the pixel snapper,
repair alpha, check the family's size rule, the palette and "not fully opaque", and write `NAME.png`, `NAME.preview.png` and
`report.json`. Verdicts: `ready`, `needs review` (a judgement check failed), `rejected` (also written only as
`rejected/NAME.png`, never as a staged picture). Exit 0 only when every picture is ready. MEASURED today, one folder, two
pictures, `--family avatars --palette tools/palettes/avatars.hex --pixel-size 4`: the avatar-style picture (380 x 508, a 95 x
127 figure at 4x, 8 of the 32 palette colours) came out `ready` at 96 x 128; a 203 x 151 opaque photograph saved as JPEG came out
`rejected` (60 x 49, "size is not 96x128", "no pixel is transparent"), exit 1.

The snapper returns one pixel more than it divides: 384 x 512 at `--pixel-size 4` came back 97 x 129 and was rejected; the
same art drawn 95 x 127 comes back 96 x 128. With the pixel size left to auto-detect on small noisy art it guessed 5 and 6.
`pets.hex` has 377 colours, more than the tool reads, so a pet picture is `needs review` unless `--palette` names one species'
palette. Staging is a dead end: nothing reads it, and promoting a staged picture into a family's sources is a human copy.

## publish and roll back

`tools/publish.py` is the only door from a build to a served map directory; map-storage serves it while people edit it in the
map editor, so a plain copy would destroy those edits. Always give `--backup` a directory outside the target and the build.
MEASURED today on a COPY under `/tmp` (never a real served directory or docker volume): an older build was published into
`/tmp/kv/served` (12,793 files), `office.tmj` there was edited by hand, then:

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
release id, the files, and the tool identities of the build. Exit codes: 0 ok, 1 verify found drift, 2 refused (nothing
written), 3 a protected file (nothing written), 4 a write failed and everything was restored, 5 an incomplete restore (the
backup is kept). The module docstring has the manual recovery after a SIGKILL (`BACKUP/<id>/intent.json`), the note that
map-storage keeps WAMs in memory (reload the room after publishing a `.wam`), and the ownership rule (the tool chowns best
effort).

## What is NOT automated

- Promoting a staged picture into a family's sources (a human copy and a diff review).
- Repainting a family to its palette. The office is 12,540 pictures off it; avatars and pets conform and are guarded.
- The publish to a served volume. The integrator runs `publish.py` against the real directory; `konclui-assets.yml` never does.
- Installing a tool. The CI job and every step stop with the install command; a person runs it on the host.
- Looking at the result in a browser: pan shimmer, shadows on and off, the normals' direction and GPU cost are unmeasured.

## perfectPixel

`https://github.com/theamusing/perfectPixel` has NO licence file and takes RGB only. It is never required, installed, vendored or
copied. `ingest.py` asks it for a second opinion on the grid size only when the module `perfect_pixel` happens to be importable
(today it is not: the report says "not checked"); a run without it gives the same staged files and verdicts.

## CI

`.github/workflows/konclui-assets.yml`, `workflow_dispatch` only, on `[self-hosted, ci-host]`. Steps: the numpy and Pillow
import, `toolchain.py status`, optionally the office build, the six test files, optionally `verify.py` (`--rebuild` on request),
whose `verify.json` goes to the job summary. **The runner needs `python3` with numpy and Pillow and the three tools** (on `PATH`,
in `~/.cargo/bin`, or named by the override variables above): the job installs nothing, and fails at `toolchain.py status` with
the install command of each missing tool. The pinned hashes are of macOS arm64 binaries; the version pin is what a Linux runner
is held to. Not run here (it needs a dispatch).

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
- The snapper IS now a pipeline step, but only for the second door: `ingest.py`. No build calls it, because every sheet the
  repository builds is native and the snapper breaks native sheets.

## Open

- `normals.py` and `pixelgrid.snap` find their tool with `toolchain.locate` and do not call `toolchain.require`, so the normals
  and pixel snapper versions are not pin-checked at the moment they run; `verify.py`'s `toolchain` check is where a wrong
  version is caught. Closing it is a two-line change in `normals.py` and `pixelgrid.py`, files outside the integration lane.
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
