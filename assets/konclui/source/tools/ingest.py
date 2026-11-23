"""The quarantine lane for art that was NOT drawn on the grid: pictures from an image model, or resized ones.

  ingest.py run INPUT --family office|avatars|pets --out STAGING [--cell 32] [--pixel-size N] [--palette FILE]
                      [--max-bytes N] [--max-pixels N] [--protect DIR ...]

INPUT is a PNG, JPEG or WEBP file, or a folder of them (not searched recursively; a file there that is not a picture is
reported as rejected). For each picture, in this order:

  1 refuse     not a PNG/JPEG/WEBP (by extension AND by content), animated, larger than --max-bytes or --max-pixels.
               The whole run is refused (exit 2, nothing written) when STAGING is inside a source art directory (anything
               under assets/konclui except tools/staging), inside $KONCLUI_DIST, equal to the input, or inside/around it.
  2 snap       the grid is recovered by the FIXED spritefusion-pixel-snapper (the pinned commit plus tools/patches/
               pixel-snapper-fix.patch, installed as spritefusion-pixel-snapper-fixed by tools/build_pixel_snapper.py)
               through toolchain.run: a missing tool, the stock build, or another version stops the whole run with
               toolchain.ToolMissing / ToolMismatch and the install command: never a fallback. The run is colour-neutral
               (at most GEOMETRY_COLOURS colours, no palette): it only finds the grid. The pixel size is auto-detected
               unless --pixel-size is given (--pixel-size 1 says "already on its grid, keep it"). WEBP is converted to a
               PNG in a temporary folder first (the snapper reads PNG and JPEG only).
  3 guard      tools/gridguard.py decides, from the picture and the snapper's answer alone, one of
                 PASS_THROUGH  the picture is already on its grid: the snapper returned it unchanged and the picture shows no
                               trace of an enlargement below the snapper's range (it is not made of blocks and not resampled:
                               `input-blocky`, `input-resampled` otherwise; a screen, not a proof, tools/README.md "Is it on its
                               grid?"). Or `--pixel-size 1` said so, and then it is the caller's word. The INPUT is staged, byte
                               for byte when it is a PNG whose alpha needs no repair. The snapper's palette and colour
                               reduction are not applied: art on its grid is kept as it is.
                 ACCEPT        an enlargement whose recovered grid is proven (cell multiples, family size, a factor in the
                               proven range, equal on both axes, not itself blocky, the result enlarged back agrees with the
                               input, and the result fits better where it is than moved by one art pixel). The snapper's
                               result is staged; with a palette of up to 256 colours a second, colour-only pass
                               (`--pixel-size 1 --palette`) maps it onto the palette without touching the grid.
                 REFUSE        anything else: the picture is rejected with the guard's reason (gridguard.REASONS) and, when the
                               snapper produced a picture, kept for inspection as rejected/NAME.png only.
               A refusal of the snapper ("Unresolved", exit 3) is a REFUSE: the family's hard contract is not taken as proof of
               a grid (an 8x enlargement of 32x32 art is 256x256, a multiple of the cell). The report of every picture holds
               the decision, the reason and the evidence numbers (`guard`).
  4 check      the staged picture goes through the existing alpha repair (pixelgrid.binary_alpha: same size, so the cell
               grid survives; a picture with binary alpha is not changed) and is then checked with pixelgrid.problems and the
               family's size rule:
                 office   width and height multiples of the cell
                 avatars  exactly 3 x 4 cells (96 x 128 at cell 32)
                 pets     16 cells wide (512 at cell 32), a whole number of rows
               plus the palette (below) and "not fully opaque" (a picture with no transparent pixel kept its background).
               The palette is tools/palettes/<family>.hex (office.hex, avatars.hex and pets.hex exist), or --palette (a
               file, or the name of a palettes/<name>.hex; a palette.json works too); it is read through the palette
               lane's tools/palettesnap.py (`read_palette(path)`) when that file exists. With no palette file, or no
               palettesnap.py, the check reads "not checked" and does not fail the picture on that alone; a palettesnap
               that cannot read the file fails it.
               The snapper reads at most 256 palette colours. A palette of up to 256 is handed to it in the colour pass of an
               ACCEPTed picture (every colour of the result is then a palette colour). A larger one (pets.hex has 377: the
               union of the species keys) is NOT handed over and the result is checked against the whole palette
               afterwards, which a reduced picture seldom passes (needs review; for a ready pet pass --palette with one
               species' palette). A picture that was reduced to at most GEOMETRY_COLOURS colours with no palette behind
               it is "needs review" (the "colours" check); a PASS_THROUGH picture keeps its own colours and its
               "colours" check says so.
  5 second     only when the Python module perfect_pixel is importable: it is asked for the grid size of the input (colour
    opinion    channels only; it never produces the output) and the answer is compared with the size that was produced.
               perfectPixel has no licence file: it is never required, vendored or copied, and a run without it gives the
               same staged files and the same verdicts, except that this check reads "not checked".
  6 write      per picture NAME.png (the staged picture), NAME.preview.png (before | after, nearest-neighbour, on a
               checkerboard, at most PREVIEW_MAX_WIDTH px wide) and, for the run, report.json: hashes, sizes, detected pixel
               size, colour counts, the INPUT's alpha class and the snapper output's, the guard's decision with its reason
               and numbers, every check with its result and reason, the tool identities, and the verdict.

Verdict per picture:  ready (no check failed), needs review (a judgement check failed: palette, colours, opaque
background, second opinion), rejected (refused by the guard or earlier, the tool failed, or a check on the sheet's size or
alpha failed; `size` is the cell-grid check). A rejected picture is never staged under NAME.png: what the snapper produced is
kept for inspection as rejected/NAME.png and rejected/NAME.preview.png only. Exit 0 only when every picture is ready (and
there is at least one). Exit 2: the run was refused or a tool is missing, nothing (or, after a crash, nothing but report.json
with "incomplete": true) is left in STAGING.

Art that is already on the grid is no longer excluded from this lane: the fixed snapper returns it unchanged, the guard says
PASS_THROUGH, and the staged picture is the input. (The stock snapper re-derived a grid for whatever it was given and a native
32x32 sprite came back 7x7; principle 4 of tools/README.md therefore did not hold for it.) --protect DIR (repeatable) names
more folders that STAGING may not be in or around (the served map folder lives outside the repository); a STAGING that already
holds a .konclui-release.json ledger or a .tmj map is refused whatever the flags.

Staging is a dead end by design: nothing here is read by a build, and promoting a staged picture into a family's sources
is a human copy (the last line of report.json and of the output says so). The input is only read, never modified or moved.

Python stdlib + numpy + Pillow, as the other art tools; toolchain.py for the snapper and gridguard.py for the decisions.
"""
import argparse
import hashlib
import importlib
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gridguard as GG  # noqa: E402
import pixelgrid as PG  # noqa: E402
import toolchain  # noqa: E402

SOURCE = HERE.parent                      # assets/konclui/source
ART_ROOT = SOURCE.parent                  # assets/konclui: everything under it is art or its tooling
STAGING_ROOT = HERE / 'staging'           # the only place under ART_ROOT a run may write (git-ignored)
INBOX = HERE / 'inbox'                    # where pictures wait (git-ignored); an input anywhere else works too
PALETTES = HERE / 'palettes'
PALETTE_MODULE = HERE / 'palettesnap.py'  # the palette lane's module; looked up when a run needs it, never imported at load

FAMILIES = ('office', 'avatars', 'pets')
CELL = PG.CELL
EXTENSIONS = {'.png': 'PNG', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.webp': 'WEBP'}
MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 25_000_000
PREVIEW_MAX_SCALE = 16
PREVIEW_MAX_WIDTH = 2048                  # a wide pet sheet used to give a preview of about 8,200 px
UNRESOLVED_EXIT = 3                       # the fixed snapper's exit code for "no grid found"
GEOMETRY_COLOURS = 256                    # colours kept by the grid run (no palette): it finds the grid, it does not recolour
SECOND_OPINION_MODULE = 'perfect_pixel'
REPORT = 'report.json'
REJECTED = 'rejected'                     # a rejected picture's inspection copies go here, never beside the ready ones
PUBLISH_LEDGER = '.konclui-release.json'  # what publish.py writes into a served map folder
MAX_SNAPPER_PALETTE = 256                 # the snapper reads at most 256 palette colours (palettesnap.MAX_PALETTE)
PROMOTION = ('Staging is a dead end: nothing here is part of any build. To promote a ready picture, a person copies its '
             'NAME.png from this folder into the family\'s source art folder and reviews the diff; ingest never does it.')

REJECT, REVIEW = 'reject', 'review'       # what a failed check does to the verdict


class IngestRefused(Exception):
    """The whole run is refused before anything is written (a bad output path, a missing input, a bad option)."""


# ---------------------------------------------------------------------------------------------------- the run's refusals

def _folded(path):
    return tuple(part.casefold() for part in Path(path).parts)


def _inside(child, parent):
    """True when `child` is `parent` or below it, by file identity: on a case-insensitive disk (APFS by default)
    `Path.resolve()` keeps the spelling it was given, so `ASSETS/konclui` and `assets/konclui` are the same folder with
    two names. Every existing ancestor of `child` (itself included) is compared with `os.path.samefile`; a `parent`
    that does not exist yet can only be compared by name, with the case folded (stricter than a case-sensitive disk
    needs: a refusal that is too wide is harmless, one that is too narrow writes into the art)."""
    child, parent = Path(child), Path(parent)
    if parent.exists():
        for ancestor in (child, *child.parents):
            try:
                if ancestor.exists() and os.path.samefile(ancestor, parent):
                    return True
            except OSError:
                continue
        return False
    wanted = _folded(parent)
    return _folded(child)[:len(wanted)] == wanted


def _same(a, b):
    a, b = Path(a), Path(b)
    if a.exists() and b.exists():
        return os.path.samefile(a, b)
    return _folded(a) == _folded(b)


def _protected_folders(protect):
    folders = [Path(p).resolve() for p in (protect or ())]
    dist = os.environ.get('KONCLUI_DIST')
    return ([('KONCLUI_DIST, a built map that is served', Path(dist).resolve())] if dist else []) + \
        [(f'--protect {p}', p) for p in folders]


def refuse_paths(input_path, out, protect=()):
    """Raise IngestRefused when `out` is a place a run must not write: the input itself or around it, a source art
    directory, a served build or a --protect folder, a folder that holds a published map. Every comparison is by file
    identity (see `_inside`), so a different spelling of the same path is refused as well."""
    source, target = Path(input_path).resolve(), Path(out).resolve()
    if not source.exists():
        raise IngestRefused(f'input {input_path} does not exist')
    if _same(target, source):
        raise IngestRefused(f'output {out} is the input: ingest never writes over its input')
    if source.is_dir() and _inside(target, source):
        raise IngestRefused(f'output {out} is inside the input folder {input_path}')
    if source.is_file() and _same(target, source.parent):
        raise IngestRefused(f'output {out} is the folder of the input file: staged names could land on the input')
    if _inside(ART_ROOT, target):
        raise IngestRefused(f'output {out} contains the source art ({ART_ROOT}): pick a staging folder of its own')
    if _inside(target, ART_ROOT) and not _inside(target, STAGING_ROOT):
        raise IngestRefused(f'output {out} is inside the source art tree {ART_ROOT}, which only {STAGING_ROOT} may be: '
                            f'staged pictures reach the sources by a human copy, never from here')
    for label, folder in _protected_folders(protect):
        if _inside(target, folder) or _inside(folder, target):
            raise IngestRefused(f'output {out} is inside or around {label}: nothing reaches it from here')
    if target.exists() and not target.is_dir():
        raise IngestRefused(f'output {out} exists and is not a folder')
    if target.is_dir():
        published = [p.name for p in target.iterdir() if p.name == PUBLISH_LEDGER or p.suffix.lower() == '.tmj']
        if published:
            raise IngestRefused(f'output {out} holds a published map ({", ".join(sorted(published)[:3])}): '
                                f'a served map folder is never a staging folder')


def prepare_out(out):
    """Create `out`. A folder that already holds something is accepted only when it is a previous run's (it has a
    report.json of this tool); then exactly the files that report lists are removed, so a picture that is rejected
    now cannot leave last run's staged copy behind. Anything else in the folder is a refusal."""
    out = Path(out)
    if not out.exists():
        out.mkdir(parents=True)
        return
    found = sorted(p.relative_to(out).as_posix() for p in out.rglob('*') if p.is_file() or p.is_symlink())
    if not any(out.iterdir()):
        return
    try:
        previous = json.loads((out / REPORT).read_text(encoding='utf-8'))
        assert previous.get('tool') == 'ingest'
        ours = {REPORT} | {n for pic in previous['pictures'] for n in (pic.get('staged'), pic.get('preview'),
                                                                        pic.get('inspection')) if n}
    except (OSError, ValueError, AssertionError, KeyError, TypeError, AttributeError):
        raise IngestRefused(f'output {out} is not empty and holds no report.json of a previous ingest run: '
                            f'use an empty or new folder') from None
    stray = sorted(set(found) - ours)
    if stray:
        raise IngestRefused(f'output {out} holds files that the previous run did not write ({", ".join(stray[:5])}): '
                            f'use an empty or new folder')
    for name in found:
        (out / name).unlink()
    (out / REJECTED).rmdir() if (out / REJECTED).is_dir() and not any((out / REJECTED).iterdir()) else None


def collect(input_path):
    """The files to ingest: the file itself, or the visible files of the folder, sorted by name."""
    path = Path(input_path)
    if path.is_dir():
        return sorted(p for p in path.iterdir() if p.is_file() and not p.name.startswith('.'))
    return [path]


def staged_names(files):
    """{file: stem used for its outputs}. Stems keep letters, digits, dot, dash and underscore. IngestRefused when two
    inputs would stage to the same name (a.png and a.jpg; or names that differ only by case or by a stripped
    character) or when one would collide with another picture's preview. A staged name always ends in .png, so it can
    never be report.json."""
    stems, seen = {}, {}
    for file in files:
        stem = re.sub(r'[^A-Za-z0-9._-]', '_', file.stem).lstrip('.') or 'picture'
        for taken in (stem, stem + '.preview'):
            key = taken.lower()
            if key in seen and seen[key] != file:
                raise IngestRefused(f'{file.name} and {seen[key].name} would both stage to {taken}.png: rename one')
        seen[stem.lower()] = seen[(stem + '.preview').lower()] = file
        stems[file] = stem
    return stems


# ---------------------------------------------------------------------------------------------------- reading a picture

def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def inspect(path, max_bytes, max_pixels):
    """(info, None) for a picture this lane may touch, else (partial info, the reason it is refused). Extension and
    content must agree; the size is read from the header, so a huge picture is refused before it is decoded."""
    info = {}
    try:
        size = path.stat().st_size
    except OSError as error:
        return info, f'cannot be read ({error.strerror or error})'
    info['bytes'] = size
    expected = EXTENSIONS.get(path.suffix.lower())
    if expected is None:
        return info, f'extension {path.suffix or "(none)"} is not .png, .jpg, .jpeg or .webp'
    if size > max_bytes:
        return info, f'{size} bytes is larger than the limit of {max_bytes}'
    try:
        info['sha256'] = sha256_file(path)
        with Image.open(path) as image:
            info['format'], (info['width'], info['height']) = image.format, image.size
            frames = getattr(image, 'n_frames', 1)
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        return info, f'is not a readable picture ({error})'
    if info['format'] not in set(EXTENSIONS.values()):
        return info, f'is a {info["format"]} picture, not PNG, JPEG or WEBP'
    if info['format'] != expected:
        return info, f'is named like a {expected} but holds a {info["format"]}'
    if frames > 1:
        return info, f'is animated ({frames} frames): ingest takes one picture'
    if info['width'] * info['height'] > max_pixels:
        return info, f'{info["width"]}x{info["height"]} px is larger than the limit of {max_pixels} px'
    return info, None


def colour_count(pixels):
    """Distinct RGB colours among the pixels that are visible (alpha > 0)."""
    rgb = pixels[pixels[..., 3] > 0][:, :3].astype(np.uint32)
    return int(np.unique((rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2]).size)


# ---------------------------------------------------------------------------------------------------- the family contract

def family_size_problems(family, width, height, cell=CELL):
    """The failures of a sheet's size against its family (empty when it fits). The rule is gridguard.FamilyContract's."""
    return GG.family_contract(family, cell).size_problems(width, height)


def check(name, passed, reason, severity):
    return {'name': name, 'result': 'pass' if passed else 'fail', 'reason': reason, 'severity': severity}


def not_checked(name, reason, severity):
    return {'name': name, 'result': 'not checked', 'reason': reason, 'severity': severity}


def contract_checks(pixels, family, cell):
    """The checks of a staged picture (RGBA array, alpha already repaired). `size` is the cell-grid check: it holds the
    family's sheet size, which for every family is a whole number of cells (avatars 3 x 4, pets 16 wide, office any), so
    a separate "multiple of the cell" check could never fail on its own. The alpha check reads pixelgrid.problems."""
    height, width = pixels.shape[:2]
    alpha = PG.problems(pixels, cell, check_grid=False)
    size = family_size_problems(family, width, height, cell)
    out = [check('size', not size, '; '.join(size) or f'{width}x{height} fits the {family} family on the {cell} px cell grid',
                 REJECT),
           check('alpha', not alpha, '; '.join(alpha) or 'alpha is binary (0 or 255)', REJECT)]
    transparent = int((pixels[..., 3] == 0).sum())
    out.append(check('transparency', transparent > 0,
                     f'{transparent} of {width * height} px are transparent' if transparent else
                     'no pixel is transparent: the picture kept its background', REVIEW))
    return out


def colours_check(handed, palette_size, count, before, after, changed=True):
    """Were the colours changed with a locked palette behind them? `handed` is the palette given to the snapper (a set)
    or None; `palette_size` the colours of the family palette (None: no palette); `count` what the snapper was told.
    `changed` False: the picture was kept as it is (PASS_THROUGH), nothing was reduced or mapped."""
    if not changed:
        return check('colours', True, f'the picture is on its grid and was kept as it is: its own {before} colours are unchanged',
                     REVIEW)
    if handed:
        return check('colours', True, f'the snapper mapped {before} input colours onto the {len(handed)} of the palette', REVIEW)
    if after >= before:
        return check('colours', True, f'no colour was merged or replaced ({before} in, {after} out) and no palette was applied', REVIEW)
    why = ('there is no palette for this run' if not palette_size else
           f'the palette has {palette_size} colours and the snapper reads at most {MAX_SNAPPER_PALETTE}'
           if palette_size > MAX_SNAPPER_PALETTE else 'the palette could not be read')
    return check('colours', False, f'the snapper reduced {before} colours to {after} (asked for at most {count}) with no '
                 f'locked palette handed to it ({why}): the colours may have shifted, compare the preview', REVIEW)


def palette_check(pixels, cell, palette):
    """`palette` is what `load_palette_for` gave: (set of colours, None) or (None, the check record to report)."""
    colours, status = palette
    if colours is None:
        return status
    off = [line for line in PG.problems(pixels, cell, palette=colours, check_grid=False)
           if line not in PG.problems(pixels, cell, check_grid=False)]
    return check('palette', not off, '; '.join(off) or f'every visible colour is one of the {len(colours)} of the palette', REVIEW)


# ---------------------------------------------------------------------------------------------------- the palette lane

def palette_lane():
    """The palette lane's module, loaded from tools/palettesnap.py when that file exists (by path: no search path is
    involved), else None. Looked up when a run needs it."""
    if not PALETTE_MODULE.is_file():
        return None
    spec = importlib.util.spec_from_file_location('palettesnap', PALETTE_MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resolve_palette(family, explicit):
    """The palette file of a run, or None: `explicit` (a file, or the name of a tools/palettes/<name>.hex), else
    tools/palettes/<family>.hex when it exists. IngestRefused when `explicit` names nothing."""
    if explicit:
        explicit = str(explicit)
        path = Path(explicit)
        if path.is_file():
            return path
        named = PALETTES / f'{explicit}.hex'
        if os.sep not in explicit and named.is_file():
            return named
        raise IngestRefused(f'palette {explicit} is neither a file nor a name under {PALETTES}')
    path = PALETTES / f'{family}.hex'
    return path if path.is_file() else None


def load_palette_for(family, path):
    """(set of (r, g, b) or None, the check record to report when the colours are unavailable). `path` is the file
    resolve_palette found (None: the family has none). The colours are read by the palette lane's
    `palettesnap.read_palette(path)`: a missing lane is "not checked", a lane that cannot read the file is a failure."""
    if path is None:
        hint = f'no palettes/{family}.hex: pass --palette with a palette file or the name of one under tools/palettes'
        return None, not_checked('palette', f'{hint}; not checked', REVIEW)
    try:
        lane = palette_lane()
    except Exception as error:   # a broken lane module is a failure to report, not a reason to skip the check silently
        return None, check('palette', False, f'tools/palettesnap.py cannot be loaded: {type(error).__name__}: {error}', REVIEW)
    if lane is None:
        return None, not_checked('palette', 'tools/palettesnap.py is not there yet: palette not checked', REVIEW)
    if not callable(getattr(lane, 'read_palette', None)):
        return None, check('palette', False, 'tools/palettesnap.py has no read_palette(path): the palette cannot be read', REVIEW)
    try:
        colours = {tuple(int(v) for v in c) for c in lane.read_palette(path)}
        if not colours or any(len(c) != 3 or not all(0 <= v <= 255 for v in c) for c in colours):
            raise ValueError('not a non-empty list of (r, g, b)')
    except Exception as error:
        return None, check('palette', False, f'{path.name} cannot be read as a palette: {type(error).__name__}: {error}', REVIEW)
    return colours, None


# ---------------------------------------------------------------------------------------------------- the second opinion

def second_opinion(rgb, produced):
    """Ask perfect_pixel (when importable) for the grid size of `rgb` and compare it with `produced` = (width, height)
    of the snapper's output. Returns (record for the report, check record)."""
    try:
        module = importlib.import_module(SECOND_OPINION_MODULE)
    except ImportError:
        reason = f'{SECOND_OPINION_MODULE} is not importable'
        return {'status': 'not available'}, not_checked('second-opinion', reason, REVIEW)
    try:
        width, height, _ = module.get_perfect_pixel(np.array(rgb, np.uint8, copy=True))
        theirs = (int(width), int(height))
    except Exception as error:
        reason = f'{SECOND_OPINION_MODULE} failed ({type(error).__name__}: {error}): no second opinion'
        return {'status': 'error', 'reason': reason}, not_checked('second-opinion', reason, REVIEW)
    agree = theirs == tuple(produced)
    record = {'status': 'agree' if agree else 'disagree', 'perfectPixelGrid': list(theirs), 'snapperGrid': list(produced)}
    reason = (f'perfect_pixel finds a {theirs[0]}x{theirs[1]} grid, the snapper produced {produced[0]}x{produced[1]}'
              + ('' if agree else ': they disagree'))
    return record, check('second-opinion', agree, reason, REVIEW)


# ---------------------------------------------------------------------------------------------------- the preview

def preview(before, after, scale_cap=PREVIEW_MAX_SCALE, max_width=PREVIEW_MAX_WIDTH):
    """Side-by-side PNG image: the input and the staged picture at the same height, both scaled with nearest-neighbour
    (the staged one by a whole factor), over a grey checkerboard so transparency shows. At most `max_width` px wide: the
    whole factor is lowered (to 1 at the least) until it fits, and a picture that is still wider at 1 (a staged picture wider
    than the cap) is scaled down as a whole, for the eye only."""
    after_img = Image.fromarray(after, 'RGBA')
    wa, ha = after_img.size
    gutter = 8
    k = max(1, min(scale_cap, -(-before.size[1] // ha)))
    left_width = lambda height: max(1, round(before.size[0] * height / before.size[1]))
    while k > 1 and left_width(ha * k) + gutter + wa * k > max_width:
        k -= 1
    height = ha * k
    right = after_img.resize((wa * k, height), Image.NEAREST)
    left = before.convert('RGBA').resize((left_width(height), height), Image.NEAREST)
    width = left.size[0] + gutter + right.size[0]
    yy, xx = np.mgrid[0:height, 0:width]
    board = np.where(((xx // 8 + yy // 8) % 2)[..., None] == 0, np.uint8(200), np.uint8(160))
    canvas = Image.fromarray(np.repeat(board, 3, axis=2).astype(np.uint8), 'RGB').convert('RGBA')
    canvas.alpha_composite(left, (0, 0))
    canvas.alpha_composite(right, (left.size[0] + gutter, 0))
    flat = np.asarray(canvas).copy()
    flat[:, left.size[0]:left.size[0] + gutter] = (40, 40, 40, 255)
    shown = Image.fromarray(flat[..., :3], 'RGB')
    if shown.size[0] > max_width:
        shown = shown.resize((max_width, max(1, round(shown.size[1] * max_width / shown.size[0]))), Image.NEAREST)
    return shown


# ---------------------------------------------------------------------------------------------------- one picture

_PIXEL_SIZE = re.compile(r'Pixel size:\s*([0-9]+(?:\.[0-9]+)?)\s*px\s*\(([^)]*)\)')


def verdict_of(checks, refusal=None):
    if refusal or any(c['result'] == 'fail' and c['severity'] == REJECT for c in checks):
        return 'rejected'
    return 'needs review' if any(c['result'] == 'fail' for c in checks) else 'ready'


def run_snapper(source, target, count, pixel_size=None, palette=None):
    """Run the fixed snapper through toolchain; `count` None leaves the colour count out (the snapper then keeps the colours of
    art that is already on its grid exactly). (RGBA array of what it wrote or a gridguard.ToolRefusal, its stdout). A missing
    or wrong tool is toolchain.ToolMissing / ToolMismatch (not caught here): it stops the run."""
    command = [str(Path(source).resolve()), str(target)] + ([str(count)] if count else [])
    if pixel_size:
        command += ['--pixel-size', str(pixel_size)]
    if palette:
        command += ['--palette', ','.join('%02x%02x%02x' % c for c in sorted(palette))]
    try:
        done = toolchain.run('pixel-snapper', command)
    except toolchain.ToolFailed as error:
        return GG.ToolRefusal('unresolved' if error.returncode == UNRESOLVED_EXIT else 'failed', error.stderr), ''
    try:
        with Image.open(target) as image:
            return np.asarray(image.convert('RGBA')).copy(), done.stdout or ''
    except (OSError, ValueError) as error:
        return GG.ToolRefusal('unreadable', f'{type(error).__name__}: {error}'), done.stdout or ''


def _rejected_entry(entry, name, reason):
    entry.update(verdict='rejected', reasons=[f'{name}: {reason}'])
    return entry


def ingest_picture(path, stem, args, palette, handed, work):
    """The report entry of one picture; the staged files are written when the snapper and the guard produced one."""
    entry = {'name': path.name, 'verdict': None}
    info, refusal = inspect(path, args['max_bytes'], args['max_pixels'])
    entry['input'] = info
    if refusal:
        return _rejected_entry(entry, path.name, refusal)
    source = path
    if info['format'] == 'WEBP':
        source = work / f'{stem}.webp.png'
        with Image.open(path) as image:
            image.convert('RGBA').save(source)
        entry['input']['convertedForSnapper'] = 'webp to png'
    with Image.open(path) as image:
        pixels_in = np.asarray(image.convert('RGBA')).copy()
    entry['input']['colours'] = colour_count(pixels_in)
    input_class = GG.alpha_class(pixels_in)
    snapped, stdout = run_snapper(source, work / f'{stem}.snapped.png', GEOMETRY_COLOURS, args['pixel_size'])
    if (not isinstance(snapped, GG.ToolRefusal) and snapped.shape == pixels_in.shape and not GG.same_pixels(pixels_in, snapped)
            and entry['input']['colours'] > GEOMETRY_COLOURS):
        # kept at its size, with more colours than the run keeps: it reduced them, so the run cannot show that the art was
        # left alone. Ask again without a colour count: art on its grid then comes back exactly (MEASURED, tools/README.md).
        again, again_stdout = run_snapper(source, work / f'{stem}.neutral.png', None, args['pixel_size'])
        if not isinstance(again, GG.ToolRefusal) and again.shape == pixels_in.shape:
            snapped, stdout = again, again_stdout
            entry['input']['rerunWithoutColourCount'] = True
    decision = GG.decide(pixels_in, snapped, args['cell'], GG.family_contract(args['family'], args['cell']),
                         pixel_size=args['pixel_size'])
    entry['guard'] = decision.as_json()
    found = _PIXEL_SIZE.search(stdout)
    refused_by_tool = isinstance(snapped, GG.ToolRefusal)
    if refused_by_tool:
        entry['alpha'] = {'inputClass': input_class}
        return _rejected_entry(entry, path.name, f'grid guard: {decision.reason}: {decision.message}')
    height_out, width_out = snapped.shape[:2]
    entry['pixelSize'] = {'detected': float(found.group(1)) if found else None,
                          'source': found.group(2) if found else 'not reported by the tool',
                          'impliedByWidth': round(info['width'] / width_out, 3)}
    passed_through = decision.outcome == GG.PASS_THROUGH
    produced, colour_pass = pixels_in if passed_through else snapped, False
    if decision.outcome == GG.ACCEPT and handed:
        mapped, _ = run_snapper(work / f'{stem}.snapped.png', work / f'{stem}.mapped.png', max(len(handed), 2),
                                pixel_size=1, palette=handed)
        if isinstance(mapped, GG.ToolRefusal) or mapped.shape != snapped.shape:
            why = mapped.message.strip() if isinstance(mapped, GG.ToolRefusal) else f'it returned {mapped.shape[1]}x{mapped.shape[0]}'
            entry['alpha'] = {'inputClass': input_class}
            return _rejected_entry(entry, path.name, f'the colour pass over the recovered grid failed: {why}')
        produced, colour_pass = mapped, True
    partial = (produced[..., 3] > 0) & (produced[..., 3] < 255)
    fixed = PG.binary_alpha(produced)
    entry['alpha'] = {'inputClass': input_class, 'snapperOutput': PG.partial_class(produced), 'partialPx': int(partial.sum()),
                      'afterRepair': 'binary', 'transparentPx': int((fixed[..., 3] == 0).sum()),
                      'opaquePx': int((fixed[..., 3] == 255).sum())}
    after = colour_count(fixed)
    if decision.outcome == GG.REFUSE:
        checks, verdict_reasons = [], [f'{path.name}: grid guard: {decision.reason}: {decision.message}']
        entry['verdict'] = 'rejected'
    else:
        checks = contract_checks(fixed, args['family'], args['cell'])
        checks.append(palette_check(fixed, args['cell'], palette))
        checks.append(colours_check(handed if colour_pass else None, len(palette[0]) if palette[0] else None, GEOMETRY_COLOURS,
                                    entry['input']['colours'], after, changed=not passed_through))
        opinion, opinion_check = second_opinion(pixels_in[..., :3], (width_out, height_out))
        checks.append(opinion_check)
        entry['secondOpinion'] = opinion
        entry['verdict'] = verdict_of(checks)
        verdict_reasons = [f'{path.name}: {c["name"]}: {c["reason"]}' for c in checks if c['result'] == 'fail']
    entry['quantisation'] = {'colourCount': None if passed_through else GEOMETRY_COLOURS,
                             'palette': 'not applied: the picture is on its grid and is kept as it is' if passed_through else
                             'handed to the snapper' if colour_pass else
                             'checked after the snap only' if palette[0] else 'none'}
    entry['checks'] = checks
    entry['reasons'] = verdict_reasons
    rejected = entry['verdict'] == 'rejected'
    folder = args['out'] / REJECTED if rejected else args['out']
    staged, preview_path = folder / f'{stem}.png', folder / f'{stem}.preview.png'
    if _same(staged, path) or _same(preview_path, path):
        raise IngestRefused(f'{path} would be overwritten by its own staged picture')
    folder.mkdir(exist_ok=True)
    for target in (staged, preview_path):
        args['written'].append(target)           # recorded before the write: a crash can still clean up
    if passed_through and info['format'] == 'PNG' and fixed is produced:
        shutil.copyfile(path, staged)            # on its grid and needing no repair: the very bytes it came with
    else:
        Image.fromarray(fixed, 'RGBA').save(staged, format='PNG')
    with Image.open(path) as before:
        preview(before, fixed).save(preview_path, format='PNG')
    entry['output'] = {'width': width_out, 'height': height_out, 'colours': after, 'sha256': sha256_file(staged),
                       'identicalToInput': sha256_file(staged) == info['sha256']}
    relative = lambda target: target.relative_to(args['out']).as_posix()
    if rejected:
        entry['staged'], entry['inspection'], entry['preview'] = None, relative(staged), relative(preview_path)
    else:
        entry['staged'], entry['preview'] = relative(staged), relative(preview_path)
    return entry


# ---------------------------------------------------------------------------------------------------- the run

def run_ingest(input_path, family, out, cell=CELL, pixel_size=None, palette=None, max_bytes=MAX_BYTES,
               max_pixels=MAX_PIXELS, protect=()):
    """Ingest `input_path` into the staging folder `out` and return the report (also written to out/report.json).
    IngestRefused when the run must not start; toolchain.ToolMissing / ToolMismatch when the snapper is missing or not
    the pinned one (nothing is written then). Any other failure in the middle of a run removes what the run staged,
    writes a report.json with "incomplete": true (so the folder can be reused) and raises again."""
    if family not in FAMILIES:
        raise IngestRefused(f'unknown family {family!r}: expected one of {", ".join(FAMILIES)}')
    if cell < 1 or (pixel_size is not None and pixel_size < 1):
        raise IngestRefused('--cell and --pixel-size must be positive')
    out = Path(out)
    refuse_paths(input_path, out, protect)
    palette_file = resolve_palette(family, palette)
    toolchain.require('pixel-snapper')          # a missing or wrong tool stops the run here, before any file is written
    files = collect(input_path)
    stems = staged_names(files)
    colours, unavailable = load_palette_for(family, palette_file)
    palette_state = (colours, unavailable)
    handed = colours if colours and len(colours) <= MAX_SNAPPER_PALETTE else None
    prepare_out(out)
    args = {'family': family, 'cell': cell, 'pixel_size': pixel_size, 'out': out.resolve(),
            'max_bytes': max_bytes, 'max_pixels': max_pixels, 'written': []}
    pictures = []
    report = {'tool': 'ingest', 'schema': 1, 'family': family, 'cell': cell}
    try:
        with tempfile.TemporaryDirectory(prefix='ingest-') as tmp:
            for file in files:
                pictures.append(ingest_picture(file, stems[file], args, palette_state, handed, Path(tmp)))
    except BaseException as error:
        for target in args['written']:
            target.unlink(missing_ok=True)
        (out / REJECTED).rmdir() if (out / REJECTED).is_dir() and not any((out / REJECTED).iterdir()) else None
        report.update(incomplete=True, error=f'{type(error).__name__}: {error}', pictures=[],
                      discarded=[p['name'] for p in pictures], promotion=PROMOTION)
        (out / REPORT).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        raise
    summary = {v: sum(p['verdict'] == v for p in pictures) for v in ('ready', 'needs review', 'rejected')}
    lane_present = PALETTE_MODULE.is_file()
    report.update({
        'incomplete': False,
        'options': {'pixelSize': pixel_size, 'maxBytes': max_bytes, 'maxPixels': max_pixels},
        'grid': {'geometryColours': GEOMETRY_COLOURS, 'guard': GG.parameters()},
        'palette': {'file': palette_file.name if palette_file else None,
                    'sha256': sha256_file(palette_file) if palette_file else None,
                    'colours': len(colours) if colours else None,
                    'source': None if not palette_file else 'explicit' if palette else 'convention',
                    'appliedBy': 'handed to the snapper, then checked' if handed else
                    f'checked after the snap only: {len(colours)} colours, the snapper reads at most {MAX_SNAPPER_PALETTE}'
                    if colours else 'not applied',
                    'lane': 'palettesnap.py present' if lane_present else 'palettesnap.py absent'},
        'toolchain': toolchain.versions(),
        'secondOpinionModule': SECOND_OPINION_MODULE,
        'pictures': pictures, 'summary': summary,
        'promotion': PROMOTION,
    })
    (out / REPORT).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return report


def exit_code(report):
    pictures = report['pictures']
    return 0 if pictures and all(p['verdict'] == 'ready' for p in pictures) else 1


def _evidence_line(guard):
    evidence = guard.get('evidence', {})
    parts = []
    if evidence.get('factor'):
        parts.append('factor {}x{}'.format(*evidence['factor']))
    if evidence.get('agreement') is not None:
        parts.append(f'agreement {evidence["agreement"]:.3f}')
    margin = (evidence.get('registration') or {}).get('margin')
    if margin is not None:
        parts.append(f'registration margin {margin:.3f}')
    if evidence.get('blendShare') is not None:
        parts.append(f'blend {evidence["blendShare"]:.3f}')
    if evidence.get('selfCoarseAgreement'):
        parts.append(f'self-coarse {max(evidence["selfCoarseAgreement"].values()):.3f}')
    return ', '.join(parts)


def print_report(report, out=None):
    out = out or sys.stdout
    for p in report['pictures']:
        size = f'{p["output"]["width"]}x{p["output"]["height"]}' if p.get('output') else '-'
        pixel = (p.get('pixelSize') or {}).get('detected')
        print(f'{p["verdict"].upper():12} {p["name"]}  {size}' + (f'  pixel {pixel:g}' if pixel else ''), file=out)
        guard = p.get('guard')
        if guard:
            numbers = _evidence_line(guard)
            print(f'    guard: {guard["decision"]} ({guard["reason"]})' + (f', {numbers}' if numbers else ''), file=out)
        for reason in p.get('reasons', []):
            print(f'    {reason}', file=out)
        for c in p.get('checks', []):
            if c['result'] == 'not checked':
                print(f'    {c["name"]}: not checked ({c["reason"]})', file=out)
    s = report['summary']
    print(f'{s["ready"]} ready, {s["needs review"]} need review, {s["rejected"]} rejected', file=out)
    if not report['pictures']:
        print('FAIL no picture found: an empty folder is not green', file=out)
    print(report['promotion'], file=out)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    run = sub.add_parser('run', help='stage the pictures of INPUT into --out and report')
    run.add_argument('input')
    run.add_argument('--family', required=True, choices=FAMILIES)
    run.add_argument('--out', required=True)
    run.add_argument('--cell', type=int, default=CELL)
    run.add_argument('--pixel-size', type=int, help='the enlargement of the picture, when known; 1 says it is already on its grid and keeps it')
    run.add_argument('--palette')
    run.add_argument('--max-bytes', type=int, default=MAX_BYTES)
    run.add_argument('--max-pixels', type=int, default=MAX_PIXELS)
    run.add_argument('--protect', action='append', default=[], metavar='DIR',
                     help='a folder STAGING may not be in or around (repeatable), e.g. a served map folder')
    args = parser.parse_args(argv)
    try:
        report = run_ingest(args.input, args.family, args.out, args.cell, args.pixel_size, args.palette,
                            args.max_bytes, args.max_pixels, args.protect)
    except (IngestRefused, toolchain.ToolError) as error:
        print(f'ingest: {error}', file=sys.stderr)
        return 2
    print_report(report)
    return exit_code(report)


if __name__ == '__main__':
    sys.exit(main())
