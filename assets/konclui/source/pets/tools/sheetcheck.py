"""Pixel contract of the pets' source sheets (pets/README.md "Contrato do atlas"), run over species/*/base.png.

  python3 pets/tools/sheetcheck.py check [SPECIES_DIR]   binary alpha, 32 px cells, only the species' palette.json key
                                                          colours; one line per failure; exit 1
  python3 pets/tools/sheetcheck.py snap SPECIES OUT.png   the explicit snap step (tools/pixelgrid.py): refuses a sheet
                                                          that already passes, never writes in place

A sheet is 16 cells wide (512 px), so a width other than 512 fails here and not in petkit.py's later validation.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
import pixelgrid as PG  # noqa: E402

SPECIES = Path(__file__).resolve().parents[1] / 'species'
WIDTH = 512


def palette_for(base):
    return PG.palette_from_json(base.parent / 'palette.json')


def main(argv):
    if len(argv) >= 2 and argv[0] == 'snap' and len(argv) == 3:
        base = SPECIES / argv[1] / 'base.png'
        return PG.snap(base, argv[2], palette_for(base))
    if argv[:1] != ['check'] or len(argv) > 2:
        raise SystemExit(__doc__)
    root = Path(argv[1]) if len(argv) == 2 else SPECIES
    bases = sorted(root.glob('*/base.png'))
    if not bases:
        raise SystemExit(f'no */base.png under {root}')
    return 1 if PG.check(bases, palette_for=palette_for, extra_for=wide_rule) else 0


def wide_rule(pixels):
    width = pixels.shape[1]
    return [] if width == WIDTH else [f'width {width} is not {WIDTH} (16 cells)']


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
