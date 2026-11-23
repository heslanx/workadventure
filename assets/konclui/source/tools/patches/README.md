# Patches carried against pinned tools

## pixel-snapper-fix.patch

A patch against `spritefusion-pixel-snapper` that makes it safe to run on art that is already on its grid, and lets it say "no".
Remove it when upstream ships the same behaviour (see "Removing it").

| | |
|---|---|
| Tool | `spritefusion-pixel-snapper` 1.0.0 (the crate version does not change) |
| Base | https://github.com/Hugo-Dz/spritefusion-pixel-snapper, commit `5743009265051098831ad7298092072325d1149b` (tag v1.0.0; `src/` is identical on `main` at `02f9315`) |
| Files touched | `README.md` (+9), `src/lib.rs` (+1491 / -146, about 580 lines of it tests) |
| sha256 of the patch | `32bb537ec17dc2a0910d371fcf4e636364485fd15766c2b30bd3e649a9bede0a` (also `patchSha256` of `pixel-snapper` in `../toolchain.json`; `build_pixel_snapper.py` refuses a patch that does not match) |
| Upstream issue | https://github.com/Hugo-Dz/spritefusion-pixel-snapper/issues/15 (open, no answer when this was written) |
| Approved to carry here | by the owner, meanwhile |
| Build and install | `python3 -I tools/build_pixel_snapper.py` (from `assets/konclui/source`): installs `spritefusion-pixel-snapper-fixed` into `~/.cargo/bin`. The stock `spritefusion-pixel-snapper` is left where it is. |

**Do not reformat this file** (an editor, `prettier`, a trailing-whitespace hook): the build checks its hash and stops.

### What it fixes (MEASURED in a lab on this Mac, 2026-11-22; the full record is the lab's PATCH-NOTES.md)

| Picture | Stock 1.0.0 | Fixed |
|---|---|---|
| 32x32 opaque, already on its grid | 7x7 | 32x32, pixel-identical |
| 96x128 avatar sheet, already on its grid | 20x29 | 96x128, pixel-identical |
| 512x32 pet strip, already on its grid | 110x8 | 512x32, pixel-identical |
| 8x enlargement of 32x32, clean | 65x65 | 32x32 |
| 8x of 32x32, blur and noise | 33x33 | 32x32 |
| 8x of 96x128, blur and noise | 97x129 | 96x128 |
| no grid at all | a guess, exit 0 | exit 3, "Unresolved", nothing written |

Causes: art that is already one pixel per art pixel was never recognised (the step estimate cannot go below 4); with no strict
edge peak the code fell back to `min(w,h)/64` without saying so; the edge profile lit two bins per boundary so every cut landed
a pixel early and left a 1 px sliver (the 33 and the 97 x 129); the walker window skipped pixels at small steps; k-means ran
before anything else and replaced colours even when no resampling was needed; nothing could fail.

New in the CLI: `--pixel-size 1` means "keep as it is"; `--expect-cell N` fails unless the result is a multiple of N; exit 3 and an
"Unresolved" message when no grid is found. `spritefusion-pixel-snapper-fixed --help` lists `--expect-cell`; the stock tool's
does not, and `toolchain.py` tells the two builds apart by that line (the version is 1.0.0 in both).

### What it does NOT fix (so the guard in `gridguard.py` exists)

- It is silently wrong on about 1% of degraded pictures (sizes off by one to three pixels), and outside enlargements of 3.5x to 10x
  it can return a wrong multiple (384x512 for a 96x128 sheet enlarged 16x).
- Enlargements below 3.5x are not told from art on its grid. WEBP is not read.
- It was built only with Rust 1.99.1.

Nothing in this repository trusts its answer without `tools/gridguard.py`.

### Removing it

When upstream releases a version with the same behaviour: bump `version`, `commit` and `install` of `pixel-snapper` in
`../toolchain.json`, delete `patch`, `patchSha256` and the capability probe if the release lists `--expect-cell`, delete
`pixel-snapper-fix.patch`, this file and `../build_pixel_snapper.py`, and re-run the guard's measurement
(`tools/README.md`, "ingest") before trusting the new binary.
