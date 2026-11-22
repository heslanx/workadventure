"""Pixel contract of the avatar sheets under art/out (tools/pixelgrid.py): 96 x 128 px (3 x 4 cells of 32 x 32), binary
alpha, and only the colours of the group's locked palette (avatars/sheet-palette.json, the source of truth:
tools/palettes/avatars.hex is generated from it and a test fails when they differ). That palette is a FREEZE guard (a
regression check): it was built from the committed sheets, so it passes them by construction and is not a design list; a
new colour is an edit of that file. The same pinned tool that would fix a sheet also checks it (tools/palettesnap.py): a
sheet with a colour off its palette fails, and a missing tool fails the check, never passes it.

  python3 avatars/sheetcheck.py check [ART_OUT_DIR]     art/out/wokas/*.png and art/out/companions/*.png; exit 1

A sheet of any other size fails here (a 32 px multiple is not enough: the engine reads these as 3 x 4 cell grids). The
modular avatars of avatars/catalog.json are run-length palette data, not sheets, and are not checked here.

`check_exported` is the same contract over what avatars/native_export.py WRITES (the layers the engine loads), without
the palette lock: the catalog's colour options are many and curated, there is no fixed list. native_export.py calls it
and fails the export on a partial-alpha pixel or a sheet that is not 96 x 128.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import palettesnap as PS  # noqa: E402
import pixelgrid as PG  # noqa: E402

HERE = Path(__file__).resolve().parent
ART_OUT = HERE.parent / 'art' / 'out'
SIZE = (96, 128)
GROUPS = ('wokas', 'companions')


def size_rule(pixels):
    h, w = pixels.shape[:2]
    return [] if (w, h) == SIZE else [f'size {w}x{h} is not {SIZE[0]}x{SIZE[1]}']


def check(root=ART_OUT, out=sys.stdout):
    """Size, alpha and palette of every sheet (pixelgrid), then the same lock through the snapper tool, per group
    (palettesnap.check_family: the one run `palettesnap.py check --family avatars` makes too): a sheet that has a colour off
    its group's palette fails (these sheets conform, so palettesnap.FAMILY_DECLARATION enforces it). Returns the failure
    count."""
    groups = PS.avatar_groups()                 # {group: sorted (r, g, b)} from sheet-palette.json: one reader, one source
    failed = 0
    for group in GROUPS:
        failed += PG.check([Path(root) / group], palette_for=lambda _p, g=group: set(groups[g]), out=out,
                           extra_for=size_rule)
    stats = {}
    changes = PS.check_family('avatars', [Path(root) / g for g in GROUPS], stats=stats)
    # A sheet off its palette is ONE failure whichever contract names it: the tool's and pixelgrid's palette rule are the same
    # exact test (a pixel whose colour is not listed), so the tool's failures are a subset of pixelgrid's.
    return max(failed, PS.judge('avatars', changes, stats, out))


def check_exported(folder, out=sys.stdout):
    """Failure count of every PNG under `folder` (the export's layers): binary alpha and exactly 96 x 128."""
    return PG.check([folder], out=out, extra_for=size_rule)


def main(argv):
    if argv[:1] != ['check'] or len(argv) > 2:
        raise SystemExit(__doc__)
    return 1 if check(*argv[1:]) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
