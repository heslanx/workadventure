#!/usr/bin/env python3
"""Is this build fit to publish? One command, one line per check, exit 0 only when no check failed.

  python3 -I tools/verify.py DIST [--family office|avatars|pets|all] [--allow-legacy-normals] [--rebuild] [--out FILE]

DIST is a built office map (hq-office/build.py --out DIST). The avatar and pet sheets are not part of that map: their
families are checked where their gates check them (avatars/art/out, pets/species), read only. The checks, in the order
they run (the pipeline's fixed order is grid, palette, alpha, normals; the checks are independent here, so the order of
the lines only groups them):

  toolchain          the three pinned tools resolve and match their pins (toolchain.problem). A mismatch fails even with
                     KONCLUI_TOOLCHAIN_ALLOW_MISMATCH=1: a build made by another tool is not fit to publish.
  office.dist        the folders and files of a build exist (entities, seats, tilesets, fx/manifest.json, office.tmj, office.wam)
  office.tools       the tools that MADE the build, read back from fx/manifest.json "tools" (fx.tool_record): every pinned tool is
                     recorded, matches its pin (version, pinned version) and none is listed missing. A manifest with no record
                     (a build from before the record, or from other code) FAILS: nothing says which tools made it. This is the
                     other half of `toolchain`, which only looks at the tools on THIS machine
  <family>.grid      width and height are cell multiples (the avatars exactly 96 x 128, the pets 512 wide)
  <family>.alpha     alpha is 0 or 255 (pixelgrid)
  <family>.translucent  the declared translucent layers: only their declared levels, and the file counts asserted (office)
  <family>.palette   the locked palette through spritefusion-palette-snapper (palettesnap.check / check_family), judged by
                     palettesnap.FAMILY_DECLARATION: a conforming family FAILS on a picture off its palette; the office is
                     declared not conforming, so it is REPORTED with its counts and fails only when the pictures or px off the
                     palette grow past the recorded baseline (or when it would conform and the declaration is stale)
  office.normals     fx/normal.png when the manifest advertises it: exists, has the map's size, is stamped method "tool" (the
                     legacy luminance fallback fails unless --allow-legacy-normals, then it is reported), alpha only 0 or 255,
                     every opaque pixel's normal has unit length within NORMAL_TOLERANCE, and the pixels with a normal are
                     exactly the opaque pixels of the placed entity sprites that are not floor pieces (every other pixel has
                     alpha 0: a rug has no normal)
  office.kinds       fx/manifest.json "kinds" and "painted" (tools/kinds.py): every placed sprite has a kind of stand, top, hang or
                     floor, equal to the kind re-derived from the build's own collection.json (name, tags, depthOffset, folder);
                     "painted" lists only stand or top pieces, and every stand or top picture that draws a dark soft shadow of
                     its own (kinds.painted_shadow) is listed. A manifest with neither key is REPORTED (an older build: the
                     runtime classifies by prefab)
  office.contract    tools/contract.py over the placed sprites (the drawing contract: alpha, foot gap, edge touch, height cap, painted
                     shadow, outline, colours, symmetry), as a ratchet over hq-office/contract/baseline.json. The legacy pieces behind
                     the baseline are REPORTED with their counts and never fail; a sprite the baseline does not list, or whose picture
                     changed, is held to the full limit and a rule it breaks FAILS. A "volume" piece of a KONCLUI_VOLUME_PIECES build
                     (a picture baked from a recipe) is such a sprite; a "proxy" piece (a hand-drawn picture touched up by code) keeps the
                     standing of its legacy art: it stays behind the baseline for the rules it offended, and fails on a new one.
                     office.contract.pieces (pieces.json against the build) and office.contract.review (stale or missing reviews,
                     REPORTED) come with it
  office.contract.casters   the manifest's "casters" (a build made with KONCLUI_VOLUME_PIECES): exactly the pieces "volumePieces" lists (the
                     recorded switch has no "casters-all") or exactly the placed "stand" sprites (it has), each with
                     an integer h, a foot row inside its picture and a span [x0, x1) inside its width. A manifest with no "casters" is REPORTED
  determinism        only with --rebuild: hq-office/build.py runs twice into temporary directories and every file of the two
                     dist directories is compared by sha256

Status per check: pass, fail, or reported (counted and shown, never failing: the palette of a family declared not
conforming; legacy normals when allowed; a manifest that does not advertise normals). A check that raises is a fail with the
error as its reason: verify never crashes to green. verify.json: any report of an earlier run at the target is deleted first (a
run that dies cannot leave a stale ok:true behind); it is written beside DIST (not inside it: DIST is what gets published) or to
--out FILE, but never into assets/konclui/source: a DIST whose parent is in the source tree (hq-office/dist) writes to
$TMPDIR/konclui-verify/<dist name>-<hash>/verify.json instead, and an explicit --out inside the source tree is refused (exit 2).
The verdict "fit to publish" is printed only for a run that examined DIST (the office family); `--family avatars` or `pets`
reads art/out and species/ and says so ("DIST not examined").

A build made with KONCLUI_VOLUME_PIECES records the switch in fx/manifest.json ("volume"). The office checks judge it by that
record, not by this process's environment: translucent.configure points the declared translucent layers and their file counts at the
switch the build was made with (an empty record, or none, is the default build), and puts the process's own back afterwards.

The stamp of fx/normal.png is a label, not a signature: this check trusts the text chunk to say which method wrote the file
and proves the pixels (size, alpha, unit length, coverage) by reading them. Not checked here: that the normals point the
right way for the shader (a run in a browser), and any avatar or pet normals (nothing reads them).

Python stdlib + numpy + Pillow, as the other art tools; the three SpriteFusion tools through toolchain.py.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SOURCE / 'hq-office'))
import contract as C  # noqa: E402
import kinds as K  # noqa: E402
import normals as N  # noqa: E402
import palettesnap as PS  # noqa: E402
import pixelgrid as PG  # noqa: E402
import toolchain  # noqa: E402
import translucent as TL  # noqa: E402


def _load(name, path):
    """Three wrappers are called sheetcheck.py (hq-office, pets/tools, avatars): each is loaded under its own name."""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


OFFICE = _load('verify_office_sheetcheck', SOURCE / 'hq-office' / 'sheetcheck.py')
AVATARS = _load('verify_avatars_sheetcheck', SOURCE / 'avatars' / 'sheetcheck.py')
PETS = _load('verify_pets_sheetcheck', SOURCE / 'pets' / 'tools' / 'sheetcheck.py')

FAMILIES = ('office', 'avatars', 'pets')
PASS, FAIL, REPORTED = 'pass', 'fail', 'reported'
# fx/normal.png stores a unit normal as three 8-bit channels, (n + 1) / 2 * 255, ROUNDED to the nearest step (normals.py writes
# floor(x + 0.5)). Rounding is off by at most 1/255 per component, so a rounded unit vector is within sqrt(3)/255 = 0.0068 of
# length 1 (MEASURED on the built office: 0.9935 to 1.0065 over 962,055 pixels). 0.0070 is that bound plus a hair: a normal of
# length 1.01 fails. (The bound for a writer that truncated instead would be twice as large; none does.)
NORMAL_TOLERANCE = 0.0070
REBUILD_TIMEOUT = 1800
SHOWN_LINES = 8                       # failure lines printed under a check; verify.json keeps up to JSON_LINES
JSON_LINES = 200
EXPECTED_DIST = ('entities', 'seats', 'tilesets', 'fx/manifest.json', 'office.tmj', 'office.wam')


@dataclass
class Result:
    name: str
    status: str
    detail: str
    lines: list = field(default_factory=list)      # what failed (or what is reported), one line each
    data: dict = field(default_factory=dict)       # the numbers, for verify.json

    def as_json(self):
        shown = self.lines[:JSON_LINES]
        out = dict(name=self.name, status=self.status, detail=self.detail, data=self.data)
        out['lines'] = shown + ([f'... and {len(self.lines) - JSON_LINES} more'] if len(self.lines) > JSON_LINES else [])
        return out


def guarded(name, function, *args, **kw):
    """The results of `function`, or one fail naming the error: a check that cannot run is a failure, never a pass."""
    try:
        return function(*args, **kw)
    except (Exception, SystemExit) as error:  # noqa: BLE001 (deliberate: the gate must fail, not crash, on anything; the tool
        # helpers answer a missing tool or a bad input with SystemExit)
        return [Result(name, FAIL, f'could not run: {type(error).__name__}: {error}'.splitlines()[0],
                       str(error).splitlines() or [type(error).__name__])]


# ------------------------------------------------------------------------------------------------------------ toolchain

def check_toolchain():
    """One result: the three tools resolve and match their pins (and, with KONCLUI_TOOLCHAIN_SHA256=enforce, a listed hash)."""
    problems = {}
    for name in toolchain.NAMES:
        text = toolchain.problem(name)
        if text:
            problems[name] = text
    found = toolchain.versions()
    data = dict(tools={n: {k: i[k] for k in ('version', 'pinnedVersion', 'sha256', 'path')} for n, i in found['tools'].items()},
                missing=sorted(found['missing']))
    if problems:
        lines = [f'{name}: {text}' for name, text in problems.items()]
        return Result('toolchain', FAIL, f'{len(problems)} of {len(toolchain.NAMES)} tools need attention: '
                      + ', '.join(sorted(problems)) + ' (python3 -I tools/toolchain.py status)', lines, data)
    return Result('toolchain', PASS, ', '.join(f'{n} {found["tools"][n]["version"]}' for n in toolchain.NAMES)
                  + ' match their pins', [], data)


def manifest_tools_result(dist):
    """office.tools: the tools that made DIST, from fx/manifest.json "tools" (fx.tool_record), against the pins of
    toolchain.json. Fails on: no manifest, no record, a tool not recorded, a recorded tool whose version is not the pin (or whose
    own `matches` is not true), a tool listed missing, and (KONCLUI_TOOLCHAIN_SHA256=enforce) a recorded hash the pins do not
    list. Not compared: the recorded hash with the one on this host (another host's build of the same version differs)."""
    manifest_path = Path(dist) / 'fx' / 'manifest.json'
    if not manifest_path.is_file():
        return Result('office.tools', FAIL, 'fx/manifest.json is missing: nothing says which tools made this build',
                      [f'{manifest_path}: missing'])
    record = json.loads(manifest_path.read_text()).get('tools')
    if not isinstance(record, dict) or not isinstance(record.get('tools'), dict) or not isinstance(record.get('missing'), list):
        why = 'the manifest has no "tools" record (a build from before the record, or from other code): rebuild with hq-office/build.py'
        return Result('office.tools', FAIL, why, [why], dict(recorded=False))
    recorded, missing = record['tools'], record['missing']
    enforce = toolchain._sha_mode() == 'enforce'
    lines = [f'{name}: listed missing when the build was made' for name in sorted(missing)]
    for name in toolchain.NAMES:
        pin, entry = toolchain.TOOLS[name], recorded.get(name)
        if not isinstance(entry, dict):
            if name not in missing:
                lines.append(f'{name}: not recorded')
            continue
        if entry.get('version') != pin['version'] or entry.get('matches') is not True:
            lines.append(f'{name}: made with version {entry.get("version")!r}, the pin is {pin["version"]} (matches: {entry.get("matches")!r})')
        elif enforce and entry.get('sha256') not in pin['sha256']:
            lines.append(f'{name}: recorded sha256 {entry.get("sha256")} is not listed in toolchain.json and {toolchain.SHA256_ENV}=enforce is set')
    data = dict(recorded=True, tools={n: recorded[n].get('version') for n in recorded if isinstance(recorded[n], dict)},
                missing=sorted(missing))
    if lines:
        return Result('office.tools', FAIL, f'the build was not made by the pinned tools: {lines[0]}', lines, data)
    return Result('office.tools', PASS, 'the manifest records ' + ', '.join(f'{n} {recorded[n]["version"]}' for n in toolchain.NAMES)
                  + ', all the pinned versions', [], data)


# ------------------------------------------------------------------------------------------------------ the pixel checks

_PICTURE_LINE = re.compile(r'^FAIL (?P<path>.*?\.png): (?P<what>.*)$')
_SUMMARY = re.compile(r'^(\d+) of (\d+) sheets pass, (\d+) fail$')
_LAYER = re.compile(r'^declared translucent layer (\S+): (\d+) files')


def classify(line):
    """The check ('grid', 'alpha', 'translucent') a `FAIL ...` line of pixelgrid.check belongs to. The messages are
    pixelgrid's own (`problems`, `check_counts`) and the size rules of the avatar and pet gates; the tests build each from
    the real function so a reworded message fails them. An unrecognised line goes to 'alpha': it is still a failure."""
    if line.startswith('FAIL declared translucent layer ') or line.startswith('FAIL no PNG found'):
        return 'translucent' if 'translucent' in line else 'grid'
    match = _PICTURE_LINE.match(line)
    what = match.group('what') if match else line
    if re.match(r'size \d+x\d+ is not ', what) or re.match(r'width \d+ is not \d+', what):
        return 'grid'
    if what.startswith('declared layer '):
        return 'translucent'
    return 'alpha'


def pixel_results(family, text, translucent=True, grid_summaries=None):
    """grid, alpha and (office only) translucent results from the text pixelgrid.check printed over a family's pictures.
    `grid_summaries`: which of the printed summary lines count pictures whose SIZE was checked (the office's entities and
    seat fronts are free-sized: only its tilesets, the last summary, are on the cell grid); None means all of them."""
    failures = {'grid': [], 'alpha': [], 'translucent': []}
    pictures = failed = 0
    per_summary = []
    layers = {}
    for line in text.splitlines():
        if line.startswith('FAIL '):
            failures[classify(line)].append(line[5:])
        summary = _SUMMARY.match(line)
        if summary:
            pictures += int(summary.group(2))
            failed += int(summary.group(3))
            per_summary.append(int(summary.group(2)))
        layer = _LAYER.match(line)
        if layer:
            layers[layer.group(1)] = int(layer.group(2))
    out = []
    sized = pictures if grid_summaries is None else sum(per_summary[i] for i in grid_summaries if i < len(per_summary))
    pass_text = {'grid': f'{sized} pictures have cell-multiple sizes' + ('' if sized == pictures
                                                                         else f' (the other {pictures - sized} are free-sized)'), 'alpha': f'{pictures} pictures have only alpha 0 or 255 (outside the declared layers)',
                 'translucent': (f'{len(layers)} declared layers, {sum(layers.values())} pictures, only their declared levels and counts'
                                 if layers else 'no declared layer')}
    for check in ('grid', 'alpha') + (('translucent',) if translucent else ()):
        lines = failures[check]
        data = dict(pictures=pictures, failing_lines=len(lines))
        if check == 'translucent':
            data['layers'] = layers
        out.append(Result(f'{family}.{check}', FAIL if lines else PASS,
                          f'{len(lines)} failures' if lines else pass_text[check], lines, data))
    return out


def office_dist_result(dist):
    dist = Path(dist)
    missing = [name for name in EXPECTED_DIST if not (dist / name).exists()]
    if missing:
        return Result('office.dist', FAIL, f'{len(missing)} of {len(EXPECTED_DIST)} expected paths are missing: '
                      + ', '.join(missing), [f'{dist / name}: missing' for name in missing], dict(missing=missing))
    return Result('office.dist', PASS, f'{", ".join(EXPECTED_DIST)} exist')


def office_pixels(dist):
    out = io.StringIO()
    OFFICE.check_dist(dist, out=out)
    return pixel_results('office', out.getvalue(), grid_summaries=[1])   # summary 0: entities and seats, 1: tilesets


def avatar_pixels(root=None):
    root = Path(root or AVATARS.ART_OUT)
    out = io.StringIO()
    for group in AVATARS.GROUPS:
        PG.check([root / group], out=out, extra_for=AVATARS.size_rule)
    return pixel_results('avatars', out.getvalue(), translucent=False)


def pet_bases(root=None):
    root = Path(root or PETS.SPECIES)
    return sorted(root.glob('*/base.png'))


def pet_pixels(root=None):
    bases = pet_bases(root)
    if not bases:
        why = f'no */base.png under {root or PETS.SPECIES}'
        return [Result(f'pets.{c}', FAIL, why, [why]) for c in ('grid', 'alpha')]
    out = io.StringIO()
    PG.check(bases, out=out, extra_for=PETS.wide_rule)
    return pixel_results('pets', out.getvalue(), translucent=False)


# ------------------------------------------------------------------------------------------------------------- palette

def palette_result(family, changes, stats):
    """The palette check of one family from the tool's `changes`, judged by palettesnap (`judge`): pass, reported (a family
    declared not conforming, counted with its baseline) or fail."""
    out = io.StringIO()
    failed = PS.judge(family, changes, stats, out)
    off = [c for c in changes if c.off_palette]
    px = sum(c.off_palette for c in off)
    pictures = stats.get('pictures')
    declaration = PS.FAMILY_DECLARATION[family]
    data = dict(pictures=pictures, exempt=stats.get('exempt', 0), off_pictures=len(off), off_px=px, conforming=declaration['conforming'])
    if not declaration['conforming']:
        data['baseline'] = declaration.get('baseline')
    if failed:
        # a conforming family: the FAIL line of each picture; a declared one: the whole judgement (baseline, stale flag)
        lines = [l for l in out.getvalue().splitlines() if l.startswith('FAIL ')] if declaration['conforming'] \
            else out.getvalue().splitlines()
        return Result(f'{family}.palette', FAIL, f'{len(off)} of {pictures} pictures off the palette ({px} px)'
                      + ('' if declaration['conforming'] else ', past what the declaration allows'), lines, data)
    if off:
        base = declaration.get('baseline')
        return Result(f'{family}.palette', REPORTED,
                      f'{len(off)} of {pictures} pictures are off the palette ({px} px), declared not conforming'
                      + (f'; baseline {base["pictures"]} / {base["px"]}, now {len(off) - base["pictures"]:+d} / {px - base["px"]:+d}'
                         if base else ''), [], data)
    return Result(f'{family}.palette', PASS, f'{pictures} pictures are on the locked palette', [], data)


def office_palette(dist):
    dist = Path(dist)
    palette = PS.read_palette(PS.PALETTE_DIR / 'office.hex')
    paths = [dist / 'entities', dist / 'seats', dist / 'tilesets']
    stats = {}
    changes = PS.check(paths, palette, exempt=OFFICE.palette_exempt(dist), stats=stats)
    return [palette_result('office', changes, stats)]


def avatar_palette(root=None):
    root = Path(root or AVATARS.ART_OUT)
    stats = {}
    changes = PS.check_family('avatars', [root / g for g in AVATARS.GROUPS], stats=stats)
    return [palette_result('avatars', changes, stats)]


def pet_palette(root=None):
    stats = {}
    changes = PS.check_family('pets', pet_bases(root), stats=stats)
    return [palette_result('pets', changes, stats)]


# ------------------------------------------------------------------------------------------------------------- normals

def expected_coverage(dist, size):
    """Boolean (height, width) array: the pixels covered by a fully opaque (alpha 255) pixel of a placed entity sprite that is
    not a floor piece. Read from the map and the sprites, not from normal.png: this is what the normal map must cover,
    whoever wrote it."""
    width, height = size
    mask = np.zeros((height, width), bool)
    cache = {}
    floor = N.floor_sprites(dist)                 # a floor piece (the manifest's "kinds") has no normal
    for x, y, path, _ in N.placed(dist):
        if path in floor:
            continue
        if path not in cache:
            cache[path] = PG.load_rgba(path)[..., 3] == 255
        solid = cache[path]
        h, w = solid.shape
        x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, width), min(y + h, height)
        if x1 > x0 and y1 > y0:
            mask[y0:y1, x0:x1] |= solid[y0 - y:y1 - y, x0 - x:x1 - x]
    return mask


def first_at(mask):
    ys, xs = np.nonzero(mask)
    return f'({int(xs[0])},{int(ys[0])})'


def normals_result(dist, allow_legacy=False, tolerance=NORMAL_TOLERANCE):
    dist = Path(dist)
    manifest_path = dist / 'fx' / 'manifest.json'
    if not manifest_path.is_file():
        return Result('office.normals', FAIL, 'fx/manifest.json is missing', [f'{manifest_path}: missing'])
    manifest = json.loads(manifest_path.read_text())
    path = dist / 'fx' / 'normal.png'
    if manifest.get('normal') is not True:
        return Result('office.normals', REPORTED, 'the manifest does not advertise fx/normal.png: this build has no normal map'
                      + (' (the file is there, unadvertised: nothing requests it)' if path.is_file() else ''),
                      data=dict(advertised=False, file=path.is_file()))
    if not path.is_file():
        return Result('office.normals', FAIL, 'the manifest advertises fx/normal.png but the file is missing',
                      [f'{path}: missing'], dict(advertised=True, file=False))
    fails, notes = [], []
    with Image.open(path) as image:
        image.load()
        stamp = image.info.get(N.METHOD_KEY)
        picture = np.asarray(image.convert('RGBA'))
    height, width = picture.shape[:2]
    size = tuple(manifest['map'])
    data = dict(advertised=True, file=True, size=[width, height], map=list(size), method=stamp)
    if (width, height) != size:
        fails.append(f'size {width}x{height} is not the map\'s {size[0]}x{size[1]}: the shader ignores the picture')
    if stamp == 'tool':
        pass
    elif stamp == 'legacy':
        (notes if allow_legacy else fails).append(
            'method legacy: the luminance fallback, not silhouette-aware normals (the tool was not used)'
            + ('; allowed by --allow-legacy-normals' if allow_legacy else '; run the build with the tool installed, or pass --allow-legacy-normals'))
    else:
        fails.append(f'no method stamp ({N.METHOD_KEY} is {stamp!r}): the file does not say which tool wrote it')
    alpha = picture[..., 3]
    odd = (alpha != 0) & (alpha != 255)
    if odd.any():
        fails.append(f'{int(odd.sum())} px have an alpha other than 0 or 255, first at {first_at(odd)}')
    opaque = alpha == 255
    vectors = picture[opaque][:, :3].astype(np.float64) / 255 * 2 - 1
    lengths = np.linalg.norm(vectors, axis=1)
    deviation = np.abs(lengths - 1)
    worst = float(deviation.max()) if len(deviation) else 0.0
    data.update(opaque_px=int(opaque.sum()), max_length_deviation=round(worst, 6), tolerance=tolerance)
    if len(deviation) and worst > tolerance:
        bad = np.zeros(opaque.shape, bool)
        bad[opaque] = deviation > tolerance
        fails.append(f'{int(bad.sum())} of {int(opaque.sum())} normals are not unit length within {tolerance} '
                     f'(worst {lengths[int(deviation.argmax())]:.4f}), first at {first_at(bad)}')
    if (width, height) == size:
        expected = expected_coverage(dist, size)
        data['expected_px'] = int(expected.sum())
        missing, extra = expected & ~opaque, opaque & ~expected
        if missing.any():
            fails.append(f'{int(missing.sum())} opaque entity px have no normal (alpha not 255), first at {first_at(missing)}')
        if extra.any():
            fails.append(f'{int(extra.sum())} px have a normal but are not an opaque entity px, first at {first_at(extra)}')
    if fails:
        return Result('office.normals', FAIL, f'{len(fails)} problems: ' + fails[0], fails + notes, data)
    detail = (f'{width}x{height}, method {stamp}, {int(opaque.sum())} opaque px with normals within {worst:.4f} of unit length '
              f'(tolerance {tolerance}), coverage equals the placed sprites\' opaque pixels')
    return Result('office.normals', REPORTED if notes else PASS, notes[0] if notes else detail, notes, data)


# --------------------------------------------------------------------------------------------------------------- kinds

def kinds_result(dist):
    """office.kinds: the manifest's "kinds" and "painted" against the build's own prefabs and pictures."""
    dist = Path(dist)
    manifest_path = dist / 'fx' / 'manifest.json'
    if not manifest_path.is_file():
        return Result('office.kinds', FAIL, 'fx/manifest.json is missing', [f'{manifest_path}: missing'])
    manifest = json.loads(manifest_path.read_text())
    if 'kinds' not in manifest and 'painted' not in manifest:
        return Result('office.kinds', REPORTED, 'the manifest has no "kinds" or "painted": an older build, the runtime '
                      'classifies by prefab and a rug is not left out of normal.png', data=dict(present=False))
    fails = K.manifest_problems(manifest)
    kinds, painted = manifest.get('kinds') or {}, manifest.get('painted') or []
    placed = K.placed_entries(dist)
    try:
        derived = K.kinds_of(dist)
    except ValueError as error:
        derived = {}
        fails.append(str(error))
    if derived:
        missing = sorted(set(derived) - set(kinds))
        extra = sorted(set(kinds) - set(derived))
        if missing:
            fails.append(f'{len(missing)} placed sprites have no kind, first {missing[0]!r}')
        if extra:
            fails.append(f'{len(extra)} kinds are not placed sprites, first {extra[0]!r}')
        differ = sorted(k for k in set(derived) & set(kinds) if derived[k] != kinds[k])
        if differ:
            fails.append(f'{len(differ)} kinds differ from the rule on the build\'s prefabs, first {differ[0]!r}: manifest '
                         f'{kinds[differ[0]]!r}, rule {derived[differ[0]]!r}')
        listed = set(painted)
        unlisted = []
        for key, kind in derived.items():
            if kind in ('stand', 'top') and key not in listed:
                folder, image = key.split('/', 1)
                with Image.open(dist / 'entities' / folder / image) as picture:
                    if K.painted_shadow(np.asarray(picture.convert('RGBA'))):
                        unlisted.append(key)
        if unlisted:
            fails.append(f'{len(unlisted)} stand or top pictures draw their own soft shadow but are not in "painted", first '
                         f'{unlisted[0]!r}: the runtime would draw a second contact shadow over it')
    counts = {kind: sum(1 for v in kinds.values() if v == kind) for kind in K.KINDS}
    data = dict(present=True, sprites=len(kinds), painted=len(painted), **counts, placed_keys=len(placed))
    if fails:
        return Result('office.kinds', FAIL, f'{len(fails)} problems: ' + fails[0], fails, data)
    return Result('office.kinds', PASS, f'{len(kinds)} placed sprites: ' + ', '.join(f'{counts[k]} {k}' for k in K.KINDS)
                  + f'; {len(painted)} painted (their own contact shadow); kinds equal the rule on the build\'s prefabs', data=data)


# ------------------------------------------------------------------------------------------------------------- contract

def recorded_switch(dist):
    """The KONCLUI_VOLUME_PIECES set the build at `dist` was made with, from fx/manifest.json "volume" (empty when there is no manifest
    or no record: the default build). A value that is not a switch is a ValueError."""
    path = Path(dist) / 'fx' / 'manifest.json'
    if not path.is_file():
        return frozenset()
    return TL.volume_pieces({TL.VOLUME_ENV: json.loads(path.read_text()).get('volume') or ''})


@contextlib.contextmanager
def built_with(dist):
    """The declared translucent layers and their counts (translucent.configure) pointed at the switch DIST was made with, and the
    process's own put back after: the pixel and palette checks of the office judge a build by what made it."""
    before, recorded = TL.configured(), recorded_switch(dist)
    if recorded == before:                 # the process already is configured for this build: leave its declarations as they are
        yield
        return
    TL.configure(recorded)
    try:
        yield
    finally:
        TL.configure(before)


def contract_baseline(dist, manifest=None):
    """tools/contract.py's committed baseline as it applies to the build at `dist`: a piece the manifest lists as "proxy" (a hand-drawn
    picture touched up by code) is looked up by its standing, not by its picture hash, so its legacy offenders stay legacy and a rule it
    did not offend before FAILS. The same as the committed baseline for a build with no proxy piece. None when there is no baseline."""
    dist = Path(dist)
    if manifest is None:
        manifest = json.loads((dist / 'fx' / 'manifest.json').read_text()) if (dist / 'fx' / 'manifest.json').is_file() else {}
    baseline = C.load_json('baseline.json')
    if baseline is not None:
        baseline = json.loads(json.dumps(baseline))
        for key, kind in (manifest.get('volumePieces') or {}).items():
            if kind == 'proxy' and key in (baseline.get('sprites') or {}) and (dist / 'entities' / key).is_file():
                baseline['sprites'][key] = C.picture_hash(dist / 'entities' / key)
    return baseline


def contract_results(dist):
    """office.contract, office.contract.pieces and office.contract.review from tools/contract.py, as verify Results. The ratchet's
    PASS with legacy offenders behind the baseline is REPORTED (counted, never failing); contract_baseline says how a proxy piece
    is judged."""
    dist = Path(dist)
    manifest = json.loads((dist / 'fx' / 'manifest.json').read_text()) if (dist / 'fx' / 'manifest.json').is_file() else {}
    baseline = contract_baseline(dist, manifest)
    results = [C.to_verify(Result, r) for r in C.check(dist, baseline=baseline)]
    first = results[0]
    rules = (first.data or {}).get('rules') or {}
    offenders = sum(r['count'] for r in rules.values())
    if first.status == PASS and offenders:
        first.status = REPORTED
        first.detail = f'{offenders} legacy offenders behind the baseline; ' + first.detail
    manifest_volume = manifest.get('volumePieces') or {}
    if manifest_volume:
        first.data['volume_pieces'] = dict(manifest_volume)
    return results


def casters_result(dist):
    """office.contract.casters: the manifest's "casters" against the placed stand sprites."""
    dist = Path(dist)
    path = dist / 'fx' / 'manifest.json'
    if not path.is_file():
        return Result('office.contract.casters', FAIL, 'fx/manifest.json is missing', [f'{path}: missing'])
    manifest = json.loads(path.read_text())
    if 'casters' not in manifest:
        return Result('office.contract.casters', REPORTED, 'the manifest has no "casters": the runtime takes a sprite\'s rows as its '
                      'height (a build made without KONCLUI_VOLUME_PIECES)', data=dict(present=False))
    casters = manifest['casters']
    kinds = manifest.get('kinds') or {}
    fails = []
    if not isinstance(casters, dict):
        return Result('office.contract.casters', FAIL, '"casters" is not an object', ['"casters" is not an object'], dict(present=True))
    stand = {k for k, v in kinds.items() if v == 'stand'}
    pieces = manifest.get('volumePieces') or {}
    try:
        everything = TL.VOLUME_CASTERS_ALL in recorded_switch(dist)    # "casters-all": the legacy heights too (fx.casters)
    except ValueError as error:
        return Result('office.contract.casters', FAIL, f'the manifest\'s "volume" is not a switch: {error}', [str(error)])
    expected = stand if everything else stand & set(pieces)             # else only the pieces the switch replaced or touched
    missing, extra = sorted(expected - set(casters)), sorted(set(casters) - expected)
    if missing:
        fails.append(f'{len(missing)} {"placed stand sprites" if everything else "volume pieces"} have no caster, first {missing[0]!r}')
    if extra:
        fails.append(f'{len(extra)} casters are not {"placed stand sprites" if everything else "volume pieces"}, first {extra[0]!r}')
    for key in sorted(set(casters) & stand):
        entry = casters[key]
        if not (isinstance(entry, dict) and set(entry) == {'h', 'foot', 'span'}):
            fails.append(f'caster {key!r} is not {{h, foot, span}}')
            continue
        h, foot, span = entry['h'], entry['foot'], entry['span']
        ints = lambda *vs: all(isinstance(v, int) and not isinstance(v, bool) for v in vs)
        if not (ints(h, foot) and isinstance(span, list) and len(span) == 2 and ints(*span)):
            fails.append(f'caster {key!r}: h, foot and span must be integers: {entry!r}')
            continue
        with Image.open(dist / 'entities' / key) as picture:
            width, height = picture.size
        if h < 1 or h > height:
            fails.append(f'caster {key!r}: h {h} is not between 1 and the picture\'s {height} rows')
        if not 0 <= foot < height:
            fails.append(f'caster {key!r}: foot row {foot} is outside the picture ({height} rows)')
        if not 0 <= span[0] < span[1] <= width:
            fails.append(f'caster {key!r}: span {span} is outside the picture ({width} columns)')
    for key, kind in pieces.items():
        if kind not in ('volume', 'proxy') or key not in kinds:
            fails.append(f'volumePieces {key!r}: {kind!r} is not "volume" or "proxy" on a placed sprite')
    data = dict(present=True, casters=len(casters), stand=len(stand), volume_pieces=len(pieces), switch=manifest.get('volume'),
                scope='all' if everything else 'volume pieces')
    if fails:
        return Result('office.contract.casters', FAIL, f'{len(fails)} problems: ' + fails[0], fails, data)
    what = 'exactly the placed stand sprites' if everything else f'exactly the {len(expected)} volume pieces (the others keep the runtime\'s own shadow)'
    return Result('office.contract.casters', PASS, f'{len(casters)} casters, {what}'
                  + (f'; switch {manifest.get("volume")!r}, {len(pieces)} volume pieces' if pieces else ''), data=data)


# --------------------------------------------------------------------------------------------------------- determinism

def tree_hashes(root):
    """{relative path: sha256} of every file under `root`."""
    root = Path(root)
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob('*')) if p.is_file()}


def determinism_result(dist=None, build_script=None, timeout=REBUILD_TIMEOUT):
    """Build twice into temporary directories and compare every file by sha256. `build_script` (tests) replaces
    hq-office/build.py; it is called with `--out DIR --renders DIR`. With `dist`, the given map is compared with the first
    rebuild and the count of differing files is recorded (informational: it only says whether DIST was made by this code)."""
    script = Path(build_script or SOURCE / 'hq-office' / 'build.py')
    with tempfile.TemporaryDirectory(prefix='verify-rebuild-') as tmp:
        built = []
        for n in (1, 2):
            out, renders = Path(tmp) / f'dist{n}', Path(tmp) / f'renders{n}'
            run = subprocess.run([sys.executable, '-I', str(script), '--out', str(out), '--renders', str(renders)],
                                 capture_output=True, text=True, timeout=timeout)
            if run.returncode:
                tail = (run.stdout + run.stderr).strip().splitlines()[-12:]
                return Result('determinism', FAIL, f'build {n} of 2 exited {run.returncode}', tail, dict(build=n, returncode=run.returncode))
            built.append(tree_hashes(out))
        first, second = built
        names = sorted(set(first) | set(second))
        differ = [n for n in names if first.get(n) != second.get(n)]
        data = dict(files=len(names), differing=len(differ))
        if dist is not None:
            given = tree_hashes(dist)
            data['given_dist_differs_in'] = len([n for n in sorted(set(first) | set(given)) if first.get(n) != given.get(n)])
        if differ:
            lines = [f'{n}: ' + ('only in one build' if (n in first) != (n in second) else 'bytes differ') for n in differ]
            return Result('determinism', FAIL, f'{len(differ)} of {len(names)} files differ between two builds', lines, data)
        note = '' if 'given_dist_differs_in' not in data else (
            '; DIST itself is identical to them' if not data['given_dist_differs_in']
            else f'; DIST differs from them in {data["given_dist_differs_in"]} files (made by other code or inputs: informational)')
        return Result('determinism', PASS, f'two builds are byte-identical: {len(names)} files{note}', [], data)


# ------------------------------------------------------------------------------------------------------------ the run

def run(dist, families=FAMILIES, allow_legacy_normals=False, rebuild=False, avatars_root=None, pets_root=None,
        build_script=None):
    """Every check of `families` over `dist`, as a list of Result, in order."""
    results = [guarded('toolchain', lambda: [check_toolchain()])[0]]
    if 'office' in families:
        results.append(guarded('office.dist', lambda: [office_dist_result(dist)])[0])
        results.append(guarded('office.tools', lambda: [manifest_tools_result(dist)])[0])
        try:
            with built_with(dist):          # the build's own switch decides which pictures may carry partial alpha
                for name, function in (('office.pixels', office_pixels), ('office.palette', office_palette)):
                    results += guarded(name, function, dist)
        except ValueError as error:
            results.append(Result('office.pixels', FAIL, f'the manifest\'s "volume" is not a switch: {error}', [str(error)]))
        results += guarded('office.normals', lambda: [normals_result(dist, allow_legacy_normals)])
        results += guarded('office.kinds', lambda: [kinds_result(dist)])
        results += guarded('office.contract', contract_results, dist)
        results += guarded('office.contract.casters', lambda: [casters_result(dist)])
    if 'avatars' in families:
        results += guarded('avatars.pixels', avatar_pixels, avatars_root)
        results += guarded('avatars.palette', avatar_palette, avatars_root)
    if 'pets' in families:
        results += guarded('pets.pixels', pet_pixels, pets_root)
        results += guarded('pets.palette', pet_palette, pets_root)
    if rebuild:
        results += guarded('determinism', lambda: [determinism_result(dist, build_script)])
    return results


def report(results, dist, families):
    """The document of verify.json. `dist` is null, and `dist_examined` false, for a run without the office family: nothing
    looked at DIST then."""
    counts = {s: sum(r.status == s for r in results) for s in (PASS, FAIL, REPORTED)}
    examined = 'office' in families
    return dict(schema=1, dist=str(Path(dist).resolve()) if examined else None, dist_examined=examined, families=list(families),
                ok=not counts[FAIL], summary=counts, checks=[r.as_json() for r in results], toolchain=toolchain.versions())


def print_results(results, out):
    width = max(len(r.name) for r in results)
    for r in results:
        print(f'{r.status:<9} {r.name:<{width}}  {r.detail}', file=out)
        if r.status == FAIL:
            for line in r.lines[:SHOWN_LINES]:
                print(f'          {line}', file=out)
            if len(r.lines) > SHOWN_LINES:
                print(f'          ... and {len(r.lines) - SHOWN_LINES} more (verify.json has up to {JSON_LINES})', file=out)


def inside(path, root):
    path, root = Path(path).resolve(), Path(root).resolve()
    return path == root or root in path.parents


def report_target(dist, out=None):
    """Where verify.json goes. --out when given; else beside DIST. Never into the source tree (assets/konclui/source): a DIST
    whose parent is there (hq-office/dist) reports under $TMPDIR/konclui-verify/<name>-<hash>/. ValueError for an explicit
    --out inside the source tree."""
    if out:
        if inside(out, SOURCE):
            raise ValueError(f'--out {out} is inside {SOURCE}: the reports are never written into the source tree')
        return Path(out)
    beside = Path(dist).resolve().parent
    if not inside(beside, SOURCE):
        return beside / 'verify.json'
    tag = hashlib.sha256(str(Path(dist).resolve()).encode()).hexdigest()[:8]
    return Path(tempfile.gettempdir()) / 'konclui-verify' / f'{Path(dist).resolve().name}-{tag}' / 'verify.json'


def verdict(document):
    """The last line's judgement. 'fit to publish' only when DIST was examined."""
    if not document['ok']:
        return 'NOT fit to publish' if document['dist_examined'] else f'NOT fit: {"/".join(document["families"])} failed'
    if document['dist_examined']:
        return 'fit to publish'
    return f'no failure in {"/".join(document["families"])} only; DIST not examined, so this is not a verdict on the build'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('dist', help='a built office map (hq-office/build.py --out DIST)')
    parser.add_argument('--family', choices=(*FAMILIES, 'all'), default='all')
    parser.add_argument('--allow-legacy-normals', action='store_true',
                        help='accept a normal.png stamped "legacy" (the luminance fallback), reported instead of failed')
    parser.add_argument('--rebuild', action='store_true', help='build twice into temporary directories and compare the bytes')
    parser.add_argument('--out', help='where to write the report (default: verify.json beside DIST; never inside assets/konclui/source)')
    args = parser.parse_args(argv)
    dist = Path(args.dist)
    if not dist.is_dir():
        print(f'verify: {dist} is not a directory', file=sys.stderr)
        return 2
    try:
        target = report_target(dist, args.out)
    except ValueError as error:
        print(f'verify: {error}', file=sys.stderr)
        return 2
    target.unlink(missing_ok=True)           # a run that dies before the write must not leave an earlier ok:true behind
    families = FAMILIES if args.family == 'all' else (args.family,)
    results = run(dist, families, args.allow_legacy_normals, args.rebuild)
    print_results(results, sys.stdout)
    document = report(results, dist, families)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(document, indent=2, sort_keys=True) + '\n')
    s = document['summary']
    print(f'verify: {s[PASS]} pass, {s[FAIL]} fail, {s[REPORTED]} reported: {verdict(document)} ({target})')
    return 0 if document['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
