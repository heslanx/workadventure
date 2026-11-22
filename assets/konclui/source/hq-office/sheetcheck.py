"""Pixel contract of the office's sprites (tools/pixelgrid.py), run over a built map or the imported sheets.

  python3 hq-office/sheetcheck.py check --dist DIR    a build (build.py --out DIR): entities/**, seats/front/** and
                                                      tilesets/*, all with binary alpha except the declared translucent
                                                      layers of translucent.py, whose file counts are asserted
  python3 hq-office/sheetcheck.py check --sheets      sources/sheets/*.png, the imported third-party INPUT sheets (the
                                                      strict rule: they are not repaired at the source, the build snaps
                                                      what it writes)

The entity pictures are free-sized (only sheets and tilesets are cell grids), so entities and seats are checked without
the 32 px size rule. No palette is locked: the office recolours imported art into the design system by rule (palette.py),
there is no fixed list, and one built from the current output would be circular (tools/README.md). The fx/ data
textures are not sprites and are not checked (their alpha carries data). Exit 1 on any failure, an empty folder included.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))             # python3 -I puts neither the script's folder
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))  # nor the cwd on the path
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


def main(argv):
    if not argv or argv[0] != 'check' or not ({'--sheets'} & set(argv) or '--dist' in argv):
        raise SystemExit(__doc__)
    if '--sheets' in argv:
        return 1 if PG.check([HERE / 'sources' / 'sheets']) else 0
    return 1 if check_dist(argv[argv.index('--dist') + 1]) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
