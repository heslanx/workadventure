"""The pixel contract of the Konclui sprite sheets, executable, and the explicit repair steps behind it.

  check PNG_OR_DIR...   every PNG must have binary alpha (0 or 255), a size on the 32 px cell grid, and (when a palette
                        is given) only palette colours. One line per failure with file, cell and pixel; exit 1, also
                        when no PNG is found. A DECLARED translucent layer (hq-office/translucent.py: glass, a lamp's
                        light pool, the tilesets' glass and light overlay) is allowed partial alpha, counted per layer
                        and its count asserted by the caller; nothing else is. "Cell grid" means the picture's width
                        and height are multiples of 32: art that crosses a cell border is NOT detected.
  report PNG_OR_DIR...  what `binary_alpha` would change: files per class, partial px dropped and raised
  binarize IN OUT       the size-preserving repair, `binary_alpha` below, never in place; a picture with no partial
                        alpha is left alone (idempotent).
  snap IN OUT           for AI-UPSCALED art only: run spritefusion-pixel-snapper and accept the result only when it
                        passes the same check. A passing IN is never touched: exit 0, nothing written.

The snapper re-detects the grid, so it RESIZES and crops: it can NOT repair a native sheet. MEASURED here (tools/
README.md): a native 32x32 cell with `--pixel-size 1` comes back 25x25, the 512x128 gato sheet 370x100, so `snap`
rejects both. It succeeds only when the upscaled input happens to resize onto the grid (test_pixelgrid.py has one such
fixture). That is why `snap` never writes in place and re-checks the size.

Python stdlib + numpy + Pillow, as the rest of the repository's art tools.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

CELL = 32
sys.path.insert(0, str(Path(__file__).resolve().parent))
import toolchain  # noqa: E402  (tools/toolchain.py: the one place that finds and identifies a tool)

SNAPPER_ENV = toolchain.TOOLS['pixel-snapper']['env']
SNAPPER_DEFAULT = toolchain.TOOLS['pixel-snapper']['binary']


def tool_path(env, default):
    """The tool a step runs: the env var when set, else the name on PATH. A clear error when neither exists. The lookup
    is toolchain's (the three SpriteFusion tools carry their install command in the message); ~/.cargo/bin is left out,
    as it always was here, so a step finds exactly what it found before."""
    try:
        return toolchain.locate(env, default, cargo=False, install=_install_command(env, default))
    except toolchain.ToolMissing as error:
        raise SystemExit(str(error))


def _install_command(env, default):
    for spec in toolchain.TOOLS.values():
        if (spec['env'], spec['binary']) == (env, default):
            return spec['install']
    return None


def load_rgba(path):
    return np.asarray(Image.open(path).convert('RGBA'))


def hex_colours(values):
    """'#rrggbb' strings -> a set of (r, g, b)."""
    return {tuple(int(v.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)) for v in values}


def _first(mask, cell):
    ys, xs = np.nonzero(mask)
    y, x = int(ys[0]), int(xs[0])
    return f'cell ({x // cell},{y // cell}) pixel ({x},{y})'


AA_LEVELS = 8          # this many distinct partial alpha values in one picture is a gradient, not a flat translucency
SHADOW_BELOW = 192     # in a flat-level picture a partial alpha under this is a baked shadow or halo, from here up an edge


def partial_levels(alpha):
    """The distinct alpha values strictly between 0 and 255, sorted."""
    return np.unique(alpha[(alpha > 0) & (alpha < 255)]).tolist()


def partial_class(pixels, aa_levels=AA_LEVELS):
    """How a picture uses partial alpha: 'none', 'aa' (`aa_levels` or more distinct values: an anti-aliased edge or a
    gradient) or 'flat' (fewer: a baked shadow plate, a halo, a flat pane). It decides how `binary_alpha` repairs it."""
    levels = partial_levels(pixels[..., 3])
    return 'none' if not levels else 'aa' if len(levels) >= aa_levels else 'flat'


def binary_alpha(pixels):
    """The pipeline's alpha repair: a copy of the RGBA array with every alpha 0 or 255, same size (so the cell grid
    survives), idempotent. A picture without partial alpha is returned as it is (same object).

      aa    alpha > 127 -> 255, else 0: the nearest silhouette, the same test the runtime's footprints, light specs and
            silhouettes use (fx.py `alpha > 127`)
      flat  alpha >= SHADOW_BELOW -> 255, else 0: a flat level below it is a baked contact shadow or halo (MEASURED
            over the built office: 83% of these px are alpha 128, a plate under the furniture); the runtime draws its
            own contact shadows from the footprint (fx.py `shadows`), so the plate is dropped, not dithered. Dithering
            keeps the tone but is a checkerboard that moires under a fractional camera; thresholding at 127 turns the
            plate into an opaque black slab.

    The colour under a pixel that becomes clear is zeroed, so no shadow colour is left to bleed."""
    kind = partial_class(pixels)
    if kind == 'none':
        return pixels
    out = pixels.copy()
    alpha = pixels[..., 3]
    partial = (alpha > 0) & (alpha < 255)
    keep = alpha > 127 if kind == 'aa' else alpha >= SHADOW_BELOW
    out[..., 3] = np.where(partial, np.where(keep, 255, 0), alpha)
    out[partial & ~keep, :3] = 0
    return out


def edge_px(alpha):
    """Partial-alpha pixels with both an opaque (255) and a clear (0) 4-neighbour: the pixels that look like an
    anti-aliased silhouette edge (a 1 px shadow strip counts too, so this is an upper bound for AA)."""
    padded = np.pad(alpha, 1)
    near = np.stack([padded[:-2, 1:-1], padded[2:, 1:-1], padded[1:-1, :-2], padded[1:-1, 2:]])
    partial = (alpha > 0) & (alpha < 255)
    return int((partial & (near == 255).any(0) & (near == 0).any(0)).sum())


class Declared:
    """A picture that may carry partial alpha because its translucency is the art: its layer name and, optionally, the
    only partial levels it may use (None: any)."""
    def __init__(self, layer, levels=None):
        self.layer, self.levels = layer, None if levels is None else set(levels)


def problems(pixels, cell=CELL, palette=None, check_grid=True, declared=None):
    """The failures of one picture (RGBA array) as strings; empty when it passes.

    grid     width and height are multiples of the cell size (a sheet cell is exactly cell x cell)
    alpha    only 0 or 255: the engine's linear filtering and the shaders' silhouette tests (alpha > 127) disagree
             about partial alpha. A `Declared` picture may use partial alpha (only its listed levels, when it lists any)
    palette  every opaque pixel's colour is in the palette (a set of (r, g, b))
    """
    h, w = pixels.shape[:2]
    out = []
    if check_grid and (w % cell or h % cell):
        out.append(f'size {w}x{h} is not a multiple of {cell}')
    alpha = pixels[..., 3]
    partial = (alpha > 0) & (alpha < 255)
    if declared is not None and declared.levels is not None:
        extra = sorted(set(partial_levels(alpha)) - declared.levels)
        if extra:
            out.append(f'declared layer {declared.layer}: alpha levels {extra} are not declared, first at '
                       f'{_first(partial & np.isin(alpha, extra), cell)}')
    elif declared is None and partial.any():
        out.append(f'{int(partial.sum())} px with partial alpha ({len(partial_levels(alpha))} levels, '
                   f'{edge_px(alpha)} on a silhouette edge), first at {_first(partial, cell)}')
    if palette is not None:
        solid = alpha > 0
        packed = (pixels[..., 0].astype(np.uint32) << 16) | (pixels[..., 1].astype(np.uint32) << 8) | pixels[..., 2]
        allowed = np.array(sorted((r << 16) | (g << 8) | b for r, g, b in palette), np.uint32)
        off = solid & ~np.isin(packed, allowed)
        if off.any():
            ys, xs = np.nonzero(off)
            colour = '#%02x%02x%02x' % tuple(pixels[ys[0], xs[0], :3])
            out.append(f'{int(off.sum())} px outside the palette, first {colour} at {_first(off, cell)}')
    return out


def png_files(paths):
    for p in map(Path, paths):
        yield from sorted(p.rglob('*.png')) if p.is_dir() else [p]


def check(paths, cell=CELL, palette_for=None, check_grid=True, out=None, declared_for=None, counts=None,
          extra_for=None):
    """Check every PNG under `paths`. `palette_for(path)` gives its palette set or None; `declared_for(path)` its
    `Declared` or None, `extra_for(pixels)` further failure strings (a sheet-specific size rule) counted before the
    summary. Returns the failure count; finding no PNG at all is one failure (an empty folder is not green).
    `counts`, when a dict, is filled with {layer: {'files', 'px', 'edge'}} over the declared pictures that really
    carry partial alpha, so the caller can assert how many there are (`check_counts`)."""
    out = out or sys.stdout
    failed = total = 0
    for path in png_files(paths):
        total += 1
        pixels = load_rgba(path)
        declared = declared_for(path) if declared_for else None
        found = problems(pixels, cell, palette_for(path) if palette_for else None, check_grid, declared)
        found += extra_for(pixels) if extra_for else []
        for line in found:
            print(f'FAIL {path}: {line}', file=out)
        failed += bool(found)
        alpha = pixels[..., 3]
        if declared is not None and counts is not None and partial_levels(alpha):
            c = counts.setdefault(declared.layer, {'files': 0, 'px': 0, 'edge': 0})
            c['files'] += 1
            c['px'] += int(((alpha > 0) & (alpha < 255)).sum())
            c['edge'] += edge_px(alpha)
    if not total:
        print(f'FAIL no PNG found under {[str(p) for p in paths]}', file=out)
        return 1
    print(f'{total - failed} of {total} sheets pass, {failed} fail', file=out)
    for layer, c in sorted((counts or {}).items()):
        print(f'declared translucent layer {layer}: {c["files"]} files, {c["px"]} partial px, '
              f'{c["edge"]} of them on a silhouette edge', file=out)
    return failed


def check_counts(counts, expected, out=None):
    """Failures where a declared layer's file count is not the asserted one ({layer: files}); a layer missing from
    `counts` counts as 0. A new translucent sprite, or one that stopped being translucent, changes a count."""
    out = out or sys.stdout
    failed = 0
    for layer in sorted(set(counts) | set(expected)):
        got, want = counts.get(layer, {}).get('files', 0), expected.get(layer, 0)
        if got != want:
            print(f'FAIL declared translucent layer {layer}: {got} files carry partial alpha, {want} are declared',
                  file=out)
            failed += 1
    return failed


def binarize(source, target, out=None):
    """Write `target` = `binary_alpha(source)`: same size, so the cell grid survives. Never in place; a picture with no
    partial alpha is left alone (nothing written). Returns 0."""
    out = out or sys.stdout
    source, target = Path(source), Path(target)
    if source.resolve() == target.resolve():
        raise SystemExit('binarize writes to a different file: repair is never applied in place')
    pixels = load_rgba(source)
    fixed = binary_alpha(pixels)
    if fixed is pixels:
        print(f'{source}: no partial alpha, not written', file=out)
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(fixed, 'RGBA').save(target)
    print(f'{source} -> {target}', file=out)
    return 0


def report(paths, out=None):
    """What `binary_alpha` would do to every PNG under `paths` (run it on a build made WITHOUT the repair to size the
    repair): files per class, partial px, and how many of those px the repair drops (-> 0) and keeps (-> 255)."""
    out = out or sys.stdout
    classes, partial_px, dropped, kept = {}, 0, 0, 0
    changed = []
    for path in png_files(paths):
        pixels = load_rgba(path)
        kind = partial_class(pixels)
        classes[kind] = classes.get(kind, 0) + 1
        fixed = binary_alpha(pixels)
        if fixed is not pixels:
            part = (pixels[..., 3] > 0) & (pixels[..., 3] < 255)
            partial_px += int(part.sum())
            kept += int((part & (fixed[..., 3] == 255)).sum())
            dropped += int((part & (fixed[..., 3] == 0)).sum())
            changed.append(path)
    print(f'files by class: ' + ', '.join(f'{k} {classes.get(k, 0)}' for k in ('none', 'flat', 'aa')), file=out)
    print(f'{len(changed)} files would change: {partial_px} partial px, {dropped} dropped to 0, {kept} raised to 255',
          file=out)
    return changed


def snap(source, target, palette=None, cell=CELL, pixel_size=None, out=None):
    """Snap `source` into `target` (never in place). Exit status: 0 done or nothing to do, 1 the result fails."""
    out = out or sys.stdout
    source, target = Path(source), Path(target)
    if source.resolve() == target.resolve():
        raise SystemExit('snap writes to a different file: the snapper resizes, so it is never applied in place')
    if not problems(load_rgba(source), cell, palette):
        print(f'{source}: already passes, not snapped', file=out)
        return 0
    command = [tool_path(SNAPPER_ENV, SNAPPER_DEFAULT)]
    with tempfile.TemporaryDirectory() as tmp:
        staged = Path(tmp) / 'snapped.png'
        command += [str(source), str(staged), str(len(palette) if palette else 16)]
        if pixel_size:
            command += ['--pixel-size', str(pixel_size)]
        if palette:
            command += ['--palette', ','.join('%02x%02x%02x' % c for c in sorted(palette))]
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
        left = problems(load_rgba(staged), cell, palette)
        if left:
            for line in left:
                print(f'FAIL snapped {source}: {line}', file=out)
            return 1
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(staged, target)
    print(f'{source} -> {target}', file=out)
    return 0


def palette_from_json(path):
    """A palette file: the colours under "key" of a pets/species/*/palette.json, or a plain list of '#rrggbb'."""
    doc = json.loads(Path(path).read_text())
    return hex_colours(doc['key'].values() if isinstance(doc, dict) else doc)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('report').add_argument('paths', nargs='+')
    for name in ('check', 'snap', 'binarize'):
        p = sub.add_parser(name)
        p.add_argument('--cell', type=int, default=CELL)
        p.add_argument('--palette-json')
    sub.choices['check'].add_argument('paths', nargs='+')
    sub.choices['check'].add_argument('--no-grid', action='store_true')
    sub.choices['binarize'].add_argument('source')
    sub.choices['binarize'].add_argument('target')
    sub.choices['snap'].add_argument('source')
    sub.choices['snap'].add_argument('target')
    sub.choices['snap'].add_argument('--pixel-size', type=int)
    args = parser.parse_args(argv)
    if args.command == 'report':
        report(args.paths)
        return 0
    palette = palette_from_json(args.palette_json) if args.palette_json else None
    if args.command == 'check':
        return 1 if check(args.paths, args.cell, lambda _p: palette, not args.no_grid) else 0
    if args.command == 'binarize':
        return binarize(args.source, args.target)
    return snap(args.source, args.target, palette, args.cell, args.pixel_size)


if __name__ == '__main__':
    sys.exit(main())
