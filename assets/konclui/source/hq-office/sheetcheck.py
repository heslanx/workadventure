"""Pixel contract of the office's sprites (tools/pixelgrid.py), run over a built map or the imported sheets.

  python3 hq-office/sheetcheck.py check --dist DIR    a build (build.py --out DIR): entities/**, seats/front/** and
                                                      tilesets/*, all with binary alpha except the declared translucent
                                                      layers of translucent.py, whose file counts are asserted
  python3 hq-office/sheetcheck.py check --sheets      sources/sheets/*.png, the imported third-party INPUT sheets (the
                                                      strict rule: they are not repaired at the source, the build snaps
                                                      what it writes)

The entity pictures are free-sized (only sheets and tilesets are cell grids), so entities and seats are checked without
the 32 px size rule. The fx/ data textures are not sprites and are not checked (their alpha carries data). Exit 1 on any
failure, an empty folder included.

The palette (tools/palettes/office.hex, generated from palette.py by tools/palettesnap.py, which also runs
spritefusion-palette-snapper) is a SECOND contract, `check_palette`, over the same pictures minus the declared translucent
layers (listed by layer and counted). The office does NOT conform today, and says why in palettesnap.FAMILY_DECLARATION, so
its result is reported and counted, but RATCHETED against the recorded baseline (pictures and px off the palette): more of
them than the baseline fails the build, fewer prints the delta. The day it conforms the check fails until the declaration is
flipped, and from then on a picture off the palette fails the build.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))             # python3 -I puts neither the script's folder
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))  # nor the cwd on the path
import palettesnap as PS  # noqa: E402
import pixelgrid as PG  # noqa: E402
import translucent as TL  # noqa: E402

HERE = Path(__file__).resolve().parent


def check_dist(dist, out=sys.stdout):
    """Failures of a built map: entities and seat fronts (free-sized), then the tilesets (cell grids)."""
    dist = Path(dist)
    entity_counts, tileset_counts = {}, {}
    failed = PG.check([dist / 'entities', dist / 'seats'], check_grid=False, out=out,
                      declared_for=TL.declared_entity(dist), counts=entity_counts)
    failed += PG.check([dist / 'tilesets'], out=out, declared_for=TL.declared_tileset, counts=tileset_counts)
    failed += PG.check_counts(entity_counts, TL.EXPECTED_ENTITY_FILES, out)
    failed += PG.check_counts(tileset_counts, TL.EXPECTED_TILESET_FILES, out)
    return failed


def palette_exempt(dist):
    """`exempt(path)` for palettesnap: the declared translucent layer of a picture (translucent.py), else None. They blend at
    runtime (glass, light pools, baked shadows, tileset overlays) and are never snapped."""
    entity = TL.declared_entity(dist)

    def exempt(path):
        declared = entity(path) or TL.declared_tileset(path)
        return declared.layer if declared else None
    return exempt


def check_palette(dist, out=sys.stdout, contact=None):
    """The palette contract of a built map: tools/palettes/office.hex over entities/, seats/ and tilesets/ minus the declared
    translucent layers (listed by layer, counted), by the pinned spritefusion-palette-snapper (a missing or wrong tool
    raises, it is never a pass). `palettesnap.judge('office', ...)` decides: not conforming, so the pictures off the palette
    are counted with the written reason and never fail; a conforming office with the declaration still saying otherwise is
    one failure. `contact`, a path, receives the before/after sheet of the 12 most-changed pictures. Returns the failures."""
    dist = Path(dist)
    palette = PS.read_palette(PS.PALETTE_DIR / 'office.hex')
    paths = [dist / 'entities', dist / 'seats', dist / 'tilesets']
    exempt = palette_exempt(dist)
    layers = {}
    for path in PG.png_files(paths):
        layer = exempt(path)
        if layer:
            layers[layer] = layers.get(layer, 0) + 1
    stats = {}
    changes = PS.check(paths, palette, exempt=exempt, stats=stats)
    for layer in sorted(layers):
        print(f'palette office: declared exception {layer}: {layers[layer]} pictures left out', file=out)
    if contact and changes:
        PS.contact_sheet(changes, palette, contact, sources=paths)
        print(f'palette office: contact sheet of the 12 most-changed pictures: {contact}', file=out)
    return PS.judge('office', changes, stats, out)


def main(argv):
    if not argv or argv[0] != 'check' or not ({'--sheets'} & set(argv) or '--dist' in argv):
        raise SystemExit(__doc__)
    if '--sheets' in argv:
        return 1 if PG.check([HERE / 'sources' / 'sheets']) else 0
    dist = argv[argv.index('--dist') + 1]
    return 1 if check_dist(dist) + check_palette(dist) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
