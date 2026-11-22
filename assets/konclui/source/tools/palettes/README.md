# Locked palettes

`tools/palettesnap.py` is the one reader and checker of these files; `spritefusion-palette-snapper` (pinned in
`../toolchain.json`) is the tool it runs. The `.hex` files are Lospec lists (one `rrggbb` per line, sorted, no comment: the
tool rejects one). They are GENERATED, never edited by hand: `python3 -I tools/palettesnap.py palettes` fails when one differs
from its source, `palettes --write` regenerates them, and `test_palettesnap.py` runs the same comparison.

| File | Source of truth | Used for |
|---|---|---|
| `office.hex` | the colour constants of `hq-office/palette.py` (51 colours: design tokens, `WALL` finishes, the stops of the floor and furniture ramps) | the office's entity, seat-front and tileset pictures, minus the declared translucent layers of `hq-office/translucent.py` |
| `avatars.hex` | `avatars/sheet-palette.json` (wokas 19 + companions 13, 32 in all) | informational union; each sheet is checked against its own group |
| `pets.hex` | the `key` of every `pets/species/*/palette.json` (377 colours, more than the tool's 256) | informational union; the tool is run per species, never with this file |

Declared exceptions (left out of the office check, listed by layer and counted in its output): `glass` 77, `lamp-light-pool` 4,
`baked-shadow` 32, `tileset-glass-walls` 1, `tileset-glass-doors` 1, `tileset-light-overlay` 1 (116 pictures). They blend at
runtime and are never snapped.

## What the pinned tool does (MEASURED, 0.1.0)

- With `--palette` it still merges the colours of one picture that are closer than OKLab 0.03 (Euclidean) before mapping them,
  and `--threshold` / `--max-colors` are refused together with `--palette`. Two palette colours that close, both in a picture, come
  back as one: `art/out/companions/koru.png` loses 801 px of in-palette colours, `art/out/wokas/konclui-dolma.png` 8 px, the pet
  bases 14,272 px in 19 of 24 sheets (MEASURED with `palettesnap.py check --family`, which names each picture).
  `palettesnap` counts these as `merged` (never a violation) and `snap` refuses to write such a picture.
- Alpha is kept (every level, 0 to 255); a fully transparent pixel is left alone. Up to 256 colours the output is an indexed PNG
  with a tRNS chunk, so pictures are compared decoded, never by bytes. A palette of more than 256 colours is an error.
- Two runs give the same bytes. The tool writes `<stem>_snapped.png`; it refuses to replace an output without `--force`.

## Command line and gates agree

`palettesnap.py check --family avatars|pets PATHS` applies the gates' rule, not a raw comparison: each picture against its own
lock (`family_locks`: the nearest `wokas` / `companions` folder, the `palette.json` beside a pet sheet; `avatars.hex` and
`pets.hex` are informational unions and never a lock), then `judge`: a picture off the palette fails, a merge by the tool alone
is named and never fails. `--family office` is refused (the declared translucent layers come from the built collection: use
`hq-office/sheetcheck.py check --dist`). `--palette FILE` stays the raw "any change fails" check. `snap` writes all or nothing.
