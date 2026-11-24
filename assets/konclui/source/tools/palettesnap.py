"""Locked palettes of the art families, fixed and checked by the same tool: spritefusion-palette-snapper.

  read_palette(path)                the colours of a palette file (.hex, .txt, .gpl, .json) as a sorted list of unique
                                    (r, g, b): the ONE reader, used by `check`, `snap` and the other lanes
  check(paths, palette, mode)       run the tool into a temporary directory, decode both sides and return the pictures
                                    whose pixels would change (`Change`: how many px, how far in OKLab). The sources are
                                    never touched; alpha must come back unchanged (AlphaChanged otherwise)
  snap(source, target, palette)     the same run, written to a `target` that is never the source (nor inside it, nor
                                    around it). A picture the tool would damage is refused, never written
  report(paths, palette)            how many colours the pictures really use, how many are near-duplicates (OKLab
                                    under 0.03, the tool's own threshold), how many pictures leave the palette
  contact_sheet(changes, ...)       before/after of the most-changed pictures, a PNG
  office_palette() avatars_palette() pets_palette()
                                    the family palettes, generated from their source of truth: hq-office/palette.py,
                                    avatars/sheet-palette.json, pets/species/*/palette.json. `palettes/<family>.hex`
                                    is generated from these (`palettes --write`) and a test fails when it differs

Command line (python3 -I tools/palettesnap.py ...):
  check  --palette FILE PATHS...                     exit 1 when any picture would change
  check  --family avatars|pets PATHS...              the gates' judgement (`family_locks`, `judge`): each picture against its
                                                     own lock (the wokas / companions group, the species palette.json); exit 1
                                                     on a picture off the palette, a merge by the tool alone does not fail.
                                                     `--family office` is refused: use hq-office/sheetcheck.py check --dist
  snap   (--family F | --palette FILE) SOURCE TARGET [--mode nearest|lightness]   all or nothing, per-picture locks
  report (--family F | --palette FILE) PATHS...      the family's union palette is the reference
  palettes [--write]                                 verify (or rewrite) palettes/*.hex against their sources

THE TOOL'S LIMITS, MEASURED on the pinned 0.1.0 (tools/palettes/README.md has the probes):
  * a palette has at most 256 colours (tool error). pets.hex, the union of the 24 species keys, has more: the tool is
    run per species palette, never with pets.hex.
  * the tool merges the PICTURE's colours that are closer than OKLab 0.03 BEFORE it maps them to the palette, even with
    --palette (the more frequent colour wins; the threshold cannot be set with --palette). So when two colours of the
    palette are closer than 0.03 and a picture uses both, the tool moves the rarer one onto the other although both are
    in the palette. `Change.merged` counts those pixels; `Change.off_palette` counts the pixels whose colour is not in
    the palette at all. Only the second is a violation of the lock; the first is the tool's own behaviour.
  * indexed output: up to 256 (colour, alpha) pairs the result is a palette PNG, else RGBA. Both are decoded.

Python stdlib + numpy + Pillow, as the rest of the repository's art tools.
"""
import argparse
import ast
import itertools
import json
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
import pixelgrid as PG  # noqa: E402
import toolchain  # noqa: E402

TOOL = 'palette-snapper'
THRESHOLD = 0.03                  # the tool's own merge threshold (OKLab, Euclidean); --threshold only without --palette
MODES = ('nearest', 'lightness')
MAX_PALETTE = 256                 # the tool: "A palette has at most 256 colors"
BATCH = 400                       # pictures per tool run (the command line stays far below ARG_MAX)
PALETTE_DIR = HERE / 'palettes'
FAMILIES = ('office', 'avatars', 'pets')
OFFICE_PALETTE_PY = SOURCE / 'hq-office' / 'palette.py'
AVATAR_PALETTE_JSON = SOURCE / 'avatars' / 'sheet-palette.json'
PETS_SPECIES = SOURCE / 'pets' / 'species'
AVATAR_GROUPS = ('wokas', 'companions')


class PaletteError(Exception):
    """Base of what this module raises about a palette run (a missing tool is toolchain.ToolMissing, never swallowed)."""


class AlphaChanged(PaletteError):
    """The tool returned a picture whose alpha (or size) is not the source's: nothing it writes is used."""


class PaletteTooLarge(PaletteError):
    """More colours than the tool reads (256)."""


class OutputOffPalette(PaletteError):
    """The tool returned a pixel that is not a palette colour: its output cannot be trusted."""


# ----------------------------------------------------------------------------------------------------------- colours

_LINEAR = np.array([(c / 255 / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4) for c in range(256)])
_M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                [0.2119034982, 0.6806995451, 0.1073969566],
                [0.0883024619, 0.2817188376, 0.6299787005]])
_M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                [1.9779984951, -2.4285922050, 0.4505937099],
                [0.0259040371, 0.7827717662, -0.8086757660]])


def oklab(rgb):
    """(..., 3) uint8 sRGB -> (..., 3) float OKLab (Ottosson). The tool's distance is the Euclidean one in this space."""
    lin = _LINEAR[np.asarray(rgb, np.uint8)]
    return np.cbrt(lin @ _M1.T) @ _M2.T


def distance(a, b):
    """OKLab distance between two (r, g, b) colours."""
    return float(np.linalg.norm(oklab(np.array(a, np.uint8)) - oklab(np.array(b, np.uint8))))


def pack(rgb):
    """(..., 3) uint8 -> (...) uint32 r<<16 | g<<8 | b."""
    rgb = np.asarray(rgb)
    return (rgb[..., 0].astype(np.uint32) << 16) | (rgb[..., 1].astype(np.uint32) << 8) | rgb[..., 2].astype(np.uint32)


def unpack(values):
    values = np.asarray(values, np.uint32)
    return np.stack([(values >> 16) & 255, (values >> 8) & 255, values & 255], -1).astype(np.uint8)


def hex_of(colour):
    return '#%02x%02x%02x' % tuple(int(v) for v in colour)


def _colours(values):
    """A sorted list of unique (r, g, b) from tuples/lists of ints or '#rrggbb' strings."""
    out = set()
    for v in values:
        if isinstance(v, str):
            m = re.fullmatch(r'#?([0-9a-fA-F]{6})', v.strip())
            if not m:
                raise ValueError(f'not a colour: {v!r}')
            h = m.group(1)
            out.add(tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)))
        else:
            r, g, b = (int(x) for x in v)
            if not all(0 <= x <= 255 for x in (r, g, b)):
                raise ValueError(f'not a colour: {v!r}')
            out.add((r, g, b))
    return sorted(out)


_HEX_LINE = re.compile(r'#?[0-9a-fA-F]{6}')


def _hex_lines(text, path):
    found = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.split(';', 1)[0].strip()                  # "; a comment" and "ffffff ; white"
        if not line or line.startswith('//'):
            continue
        if line.startswith('#') and not _HEX_LINE.fullmatch(line):
            continue                                         # "# a comment"; "#ffffff" is a colour
        if not _HEX_LINE.fullmatch(line):
            raise ValueError(f'{path}:{number}: not a colour: {raw.strip()!r}')
        found.append(line)
    return found


def _gpl_lines(text, path):
    found = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#') or line.lower().startswith(('gimp palette', 'name:', 'columns:')):
            continue
        parts = line.split()
        try:
            found.append(tuple(int(p) for p in parts[:3]))
            if len(found[-1]) != 3:
                raise ValueError
        except ValueError:
            raise ValueError(f'{path}:{number}: not an "R G B name" line: {raw.strip()!r}') from None
    return found


def _json_values(doc, path):
    if isinstance(doc, list):
        return doc
    if isinstance(doc, dict):
        if isinstance(doc.get('key'), dict):                 # a pets/species/*/palette.json
            return list(doc['key'].values())
        for name in ('colors', 'colours', 'palette'):
            if isinstance(doc.get(name), list):
                return doc[name]
    raise ValueError(f'{path}: a palette JSON is a list of "#rrggbb", an object with "colors", "colours" or "palette" '
                     f'(a list) or a species palette.json with a "key" object')


def read_palette(path):
    """The colours of a palette file as a sorted list of unique (r, g, b) ints. The one reader of this pipeline.

      .hex .txt   one colour per line, `rrggbb` or `#rrggbb`, upper or lower case; blank lines, `;` comments (also after
                  a colour) and lines that start with `#` and are not a colour are ignored; any other line is an error
      .gpl        GIMP palette: `R G B name` lines
      .json       a list of "#rrggbb", {"colors"|"colours"|"palette": [...]}, or a pets species palette.json ("key")

    A colour listed twice is one colour. A malformed line is a ValueError naming file and line, never skipped."""
    path = Path(path)
    text = path.read_text(encoding='utf-8')
    suffix = path.suffix.lower()
    try:
        if suffix in ('.hex', '.txt'):
            values = _hex_lines(text, path)
        elif suffix == '.gpl':
            values = _gpl_lines(text, path)
        elif suffix == '.json':
            values = _json_values(json.loads(text), path)
        else:
            raise ValueError(f'{path}: unknown palette format {suffix!r} (.hex, .txt, .gpl or .json)')
        return _colours(values)
    except ValueError as error:
        message = str(error)
        raise ValueError(message if str(path) in message else f'{path}: {message}') from None


def hex_text(colours):
    """The text of a `.hex` file (Lospec): `rrggbb` per line, lowercase, sorted, no comment (the tool rejects one)."""
    return ''.join('%02x%02x%02x\n' % c for c in _colours(colours))


def close_pairs(palette, threshold=THRESHOLD):
    """[(colour a, colour b, OKLab distance)] of the palette colours closer than `threshold`: the pairs the tool merges."""
    colours = _colours(palette)
    lab = oklab(np.array(colours, np.uint8)) if colours else np.zeros((0, 3))
    out = []
    for i, j in itertools.combinations(range(len(colours)), 2):
        d = float(np.linalg.norm(lab[i] - lab[j]))
        if d < threshold:
            out.append((colours[i], colours[j], d))
    return out


# --------------------------------------------------------------------------- the family palettes and their sources

def office_palette(path=OFFICE_PALETTE_PY):
    """The colours hq-office/palette.py DEFINES: every '#rrggbb' string that is (inside) the value of a module-level
    assignment, read from the source text (no import: palette.py pulls in the catalogue). The design tokens, the wall
    finishes and the stops of the floor and furniture ramps. The ramps are interpolated at build time (`ramp_map`), so
    the colours of a floor or a couch are BETWEEN these stops: they are not in the palette, and that is measured by
    `report`, not hidden here."""
    found, names = set(), {}

    def walk(node):
        """The colours of an assigned value, read from its syntax: a string, a Name of an earlier colour constant (WALL
        maps catalogue colours onto INK, so it is not a literal and `ast.literal_eval` would drop the whole dict), the
        items of a list or tuple, the keys and values of a dict. Anything computed contributes nothing."""
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if re.fullmatch(r'#[0-9a-fA-F]{6}', node.value):
                found.add(node.value)
        elif isinstance(node, ast.Name):
            if node.id in names:
                found.add(names[node.id])
        elif isinstance(node, ast.Dict):
            for part in (*node.keys, *node.values):
                if part is not None:
                    walk(part)
        elif isinstance(node, (ast.List, ast.Tuple)):
            for item in node.elts:
                walk(item)

    for node in ast.parse(Path(path).read_text(encoding='utf-8')).body:
        if isinstance(node, ast.Assign):
            walk(node.value)
            if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) \
                    and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str) \
                    and re.fullmatch(r'#[0-9a-fA-F]{6}', node.value.value):
                names[node.targets[0].id] = node.value.value
    return _colours(found)


def avatar_groups(path=AVATAR_PALETTE_JSON):
    """{group: colours}: the per-group locks of avatars/sheet-palette.json, the source of truth of the avatar palette."""
    doc = json.loads(Path(path).read_text(encoding='utf-8'))
    return {group: _colours(doc[group]) for group in AVATAR_GROUPS}


def avatars_palette(path=AVATAR_PALETTE_JSON):
    """The avatar family palette: the union of its groups (a woka sheet and the companion sheet each keep their own,
    stricter lock in `avatar_groups`)."""
    return _colours(c for colours in avatar_groups(path).values() for c in colours)


def pet_species_palettes(root=PETS_SPECIES):
    """{species: colours}: the `key` of each species' palette.json, the lock `pets/tools/sheetcheck.py` applies."""
    return {p.parent.name: read_palette(p) for p in sorted(Path(root).glob('*/palette.json'))}


def pets_palette(root=PETS_SPECIES):
    """The pets family palette: the union of the species keys (more than 256 colours: the tool takes one species)."""
    return _colours(c for colours in pet_species_palettes(root).values() for c in colours)


def family_palette(family):
    if family not in FAMILIES:
        raise KeyError(f'unknown family {family!r}: expected one of {", ".join(FAMILIES)}')
    return {'office': office_palette, 'avatars': avatars_palette, 'pets': pets_palette}[family]()


def family_files():
    """{file name: text} of palettes/*.hex as they must be, generated from the sources."""
    return {f'{family}.hex': hex_text(family_palette(family)) for family in FAMILIES}


def palette_files_problems(directory=PALETTE_DIR):
    """What differs between `directory`'s palettes/*.hex and the generated ones: one line per file, [] when in sync."""
    out = []
    for name, text in family_files().items():
        file = Path(directory) / name
        if not file.is_file():
            out.append(f'{file} is missing (python3 -I tools/palettesnap.py palettes --write)')
        elif file.read_text(encoding='utf-8') != text:
            have, want = set(read_palette(file)), set(read_palette_text(text))
            out.append(f'{file} differs from its source: {len(want - have)} colours missing, {len(have - want)} extra')
    return out


def read_palette_text(text):
    return _colours(_hex_lines(text, '<text>'))


def write_family_files(directory=PALETTE_DIR):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for name, text in family_files().items():
        (directory / name).write_text(text, encoding='utf-8')
    return sorted(family_files())


# --------------------------------------------------------------------------------------------------------- the tool

def _palette(palette):
    colours = read_palette(palette) if isinstance(palette, (str, Path)) else _colours(palette)
    if not colours:
        raise PaletteError('the palette is empty')
    return colours


def _require(mode):
    """Before anything else, also for an empty or all-exempt input: a usable pinned tool and a known mode. A missing or
    wrong tool is toolchain.ToolMissing/ToolMismatch, so no input shape can turn it into a pass."""
    if mode not in MODES:
        raise ValueError(f'mode {mode!r}: expected one of {", ".join(MODES)}')
    toolchain.require(TOOL)


def _run_tool(files, palette, mode, root):
    """Run the tool over `files` into new folders under `root`; {file: path of its snapped picture}. The tool writes
    `<stem>_snapped.png` into one folder, so files are grouped by their folder and run in batches of BATCH."""
    if mode not in MODES:
        raise ValueError(f'mode {mode!r}: expected one of {", ".join(MODES)}')
    if len(palette) > MAX_PALETTE:
        raise PaletteTooLarge(f'the tool reads at most {MAX_PALETTE} colours and this palette has {len(palette)}: '
                              f'use a per-species or per-group palette')
    palette_file = Path(root) / 'palette.hex'
    palette_file.write_text(hex_text(palette), encoding='utf-8')
    by_folder = {}
    for file in files:
        by_folder.setdefault(Path(file).resolve().parent, []).append(Path(file))
    staged, batch_no = {}, 0
    for folder in sorted(by_folder):
        group = sorted(by_folder[folder])
        for start in range(0, len(group), BATCH):
            chunk = group[start:start + BATCH]
            out = Path(root) / f'out-{batch_no}'
            batch_no += 1
            toolchain.run(TOOL, [*chunk, '--output-dir', out, '--palette', palette_file, '--mode', mode])
            for file in chunk:
                result = out / f'{file.stem}_snapped.png'
                if not result.is_file():
                    raise PaletteError(f'the tool wrote nothing for {file} (expected {result.name})')
                staged[file] = result
    return staged


def _lock_of(palette):
    """`palette` (a list of colours, a palette file, or a function picture -> palette) as a function picture -> colours."""
    if callable(palette):
        cache = {}
        return lambda path: cache.setdefault(path, _palette(palette(path)))
    fixed = _palette(palette)
    return lambda _path: fixed


def _run_locked(files, lock, mode, root):
    """`_run_tool` for pictures that have their own palette: one run per distinct palette, each in its own folder of `root`."""
    groups = {}
    for file in files:
        groups.setdefault(tuple(lock(file)), []).append(file)
    staged = {}
    for n, (colours, members) in enumerate(groups.items()):
        folder = Path(root) / f'lock-{n}'
        folder.mkdir()
        staged.update(_run_tool(members, list(colours), mode, folder))
    return staged


@dataclass(frozen=True)
class Change:
    """A picture whose pixels the tool would change. Counts are over pixels with alpha > 0 (a clear pixel's colour is
    not a colour: the tool leaves it alone)."""
    path: Path
    solid: int            # pixels with alpha > 0
    changed: int          # pixels whose colour the tool changes
    off_palette: int      # of the changed: the source colour is not in the palette (a violation of the lock)
    merged: int           # of the changed: the source colour IS in the palette, the tool merged it into a close one
    max_distance: float   # the largest OKLab distance a pixel moves
    first: str            # the first changed pixel: "(x,y) #before -> #after"

    def line(self):
        return (f'{self.path}: {self.changed} of {self.solid} px would change ({self.off_palette} off the palette, '
                f'{self.merged} merged by the tool), largest move {self.max_distance:.4f} OKLab, first {self.first}')


def compare(before, after, palette, path=''):
    """The `Change` between a source RGBA array and the tool's result for it, or None when the pixels are the same.
    AlphaChanged when the size or the alpha differs; OutputOffPalette when the result has a colour the palette lacks."""
    if before.shape != after.shape:
        raise AlphaChanged(f'{path}: the tool changed the size {before.shape[1]}x{before.shape[0]} to '
                           f'{after.shape[1]}x{after.shape[0]}')
    if not np.array_equal(before[..., 3], after[..., 3]):
        n = int((before[..., 3] != after[..., 3]).sum())
        raise AlphaChanged(f'{path}: the tool changed the alpha of {n} px')
    solid = before[..., 3] > 0
    allowed = np.array(sorted(pack(np.array(palette, np.uint8))), np.uint32)
    if (solid & ~np.isin(pack(after[..., :3]), allowed)).any():
        raise OutputOffPalette(f'{path}: the tool wrote a colour that is not in the palette')
    moved = solid & (before[..., :3] != after[..., :3]).any(-1)
    if not moved.any():
        return None
    in_palette = np.isin(pack(before[..., :3]), allowed)
    ys, xs = np.nonzero(moved)
    steps = np.linalg.norm(oklab(before[moved][:, :3]) - oklab(after[moved][:, :3]), axis=-1)
    y, x = int(ys[0]), int(xs[0])
    return Change(Path(path), int(solid.sum()), int(moved.sum()), int((moved & ~in_palette).sum()),
                  int((moved & in_palette).sum()), float(steps.max()),
                  f'({x},{y}) {hex_of(before[y, x, :3])} -> {hex_of(after[y, x, :3])}')


def _files(paths, exempt):
    files = list(PG.png_files(paths))
    if not files:
        raise PaletteError(f'no PNG found under {[str(p) for p in paths]}')
    skipped = [f for f in files if exempt and exempt(f)]
    return [f for f in files if f not in set(skipped)], skipped


def check(paths, palette, mode='nearest', exempt=None, stats=None):
    """The pictures under `paths` whose pixels the tool would change to fit `palette` (a list of colours or a palette
    file, or a function picture -> palette): a list of `Change`, in path order, empty when all conform to the tool. The tool runs into a temporary
    directory and both sides are DECODED (it writes indexed PNGs, so their bytes say nothing). Alpha and size must come
    back unchanged. `exempt(path)` leaves a picture out (a declared exception); `stats`, when a dict, is filled with
    {'pictures': checked, 'exempt': left out}. A missing or wrong tool raises toolchain.ToolMissing/ToolMismatch."""
    _require(mode)
    lock = _lock_of(palette)
    files, skipped = _files(paths, exempt)
    changes = []
    with tempfile.TemporaryDirectory(prefix='palettesnap-') as tmp:
        staged = _run_locked(files, lock, mode, tmp) if files else {}
        for file in files:
            change = compare(PG.load_rgba(file), PG.load_rgba(staged[file]), lock(file), file)
            if change:
                changes.append(change)
    if stats is not None:
        stats.update(pictures=len(files), exempt=len(skipped))
    return changes


@dataclass
class SnapResult:
    written: list      # target paths of the pictures written
    changed: list      # `Change` of the written pictures whose pixels moved
    refused: list      # `Change` of the pictures NOT written: the tool would also move colours that are in the palette


def _inside(inner, outer):
    return inner == outer or outer in inner.parents


def snap(source, target, palette, mode='nearest', force=False, out=None):
    """Write the tool's snap of `source` (a PNG, or a folder: its PNGs, same relative paths) into `target`. The target is
    never the source, nor inside it, nor around it (the sources are immutable); an existing output is an error unless
    `force`. A picture whose result moves colours that ARE in the palette (the tool merged two close palette colours) is
    refused: not written, listed in `refused`. Alpha must come back unchanged. Returns a `SnapResult`."""
    out = out or sys.stdout
    _require(mode)
    lock = _lock_of(palette)
    source, target = Path(source).resolve(), Path(target).resolve()
    if _inside(source, target) or _inside(target, source):
        raise PaletteError(f'snap writes to a different place than it reads: {source} and {target} overlap '
                           f'(the sources are immutable)')
    files = list(PG.png_files([source]))
    if not files:
        raise PaletteError(f'no PNG found under {source}')
    destination = {f: (target if source.is_file() else target / f.relative_to(source)) for f in files}
    clash = [d for d in destination.values() if d.exists()]
    if clash and not force:
        raise FileExistsError(f'{clash[0]} exists ({len(clash)} outputs): pass force to replace')
    result = SnapResult([], [], [])
    with tempfile.TemporaryDirectory(prefix='palettesnap-') as tmp:
        staged = _run_locked(files, lock, mode, tmp)
        # ALL-OR-NOTHING: every picture is judged first (AlphaChanged / OutputOffPalette from any one of them aborts the
        # whole snap before a byte reaches `target`), and only then are the staged results moved into place. A later
        # publish step can therefore take a target that exists as a complete snap.
        plan = []
        for file in files:
            change = compare(PG.load_rgba(file), PG.load_rgba(staged[file]), lock(file), file)
            if change and change.merged:
                result.refused.append(change)
                print(f'REFUSED {change.line()}', file=out)
                continue
            plan.append((file, change))
        try:
            for file, change in plan:
                destination[file].parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(staged[file]), destination[file])
                result.written.append(destination[file])
                if change:
                    result.changed.append(change)
        except BaseException:
            for path in result.written:                  # a move that fails halfway (disk full) does not leave a half snap
                path.unlink(missing_ok=True)
            raise
    print(f'snapped {len(result.written)} of {len(files)} pictures into {target}: {len(result.changed)} changed, '
          f'{len(result.refused)} refused', file=out)
    return result


# ------------------------------------------------------------------------------------------- the family locks

def family_locks(family, paths):
    """{picture: colours}: the palette each picture under `paths` is locked to, by the rule the family's gate applies.
    office   office.hex for every picture
    avatars  the group palette of avatars/sheet-palette.json: the group is the NEAREST folder of the picture's path called
             `wokas` or `companions` (PaletteError when there is none: the union avatars.hex is informational, never a lock)
    pets     the `palette.json` beside the picture (a species folder); PaletteError when there is none
    One lock per picture so that the command line and the gates (avatars/sheetcheck.py, pets/tools/sheetcheck.py) judge the
    same files by the same palette."""
    if family not in FAMILIES:
        raise KeyError(f'unknown family {family!r}: expected one of {", ".join(FAMILIES)}')
    files = list(PG.png_files(paths))
    if not files:
        raise PaletteError(f'no PNG found under {[str(p) for p in paths]}')
    if family == 'office':
        colours = read_palette(PALETTE_DIR / 'office.hex')
        return {f: colours for f in files}
    locks = {}
    if family == 'avatars':
        groups = avatar_groups()
        for f in files:
            names = [part for part in reversed(f.resolve().parts) if part in groups]
            if not names:
                raise PaletteError(f'{f}: not under a {" or ".join(AVATAR_GROUPS)} folder, so its avatar palette is unknown '
                                   f'(--palette FILE checks any palette)')
            locks[f] = groups[names[0]]
        return locks
    cache = {}
    for f in files:
        sheet = f.resolve().parent / 'palette.json'
        if not sheet.is_file():
            raise PaletteError(f'{f}: no palette.json beside it, so its species palette is unknown (give a species '
                               f'folder or base.png; --palette FILE checks any palette)')
        locks[f] = cache.setdefault(sheet, read_palette(sheet))
    return locks


def check_family(family, paths, mode='nearest', exempt=None, stats=None):
    """`check` with each picture's own lock (`family_locks`): the `Change`s of every picture under `paths`, in path order,
    `stats` filled as in `check`. This is the one run both the command line and the family gates make; `judge` then decides
    what fails."""
    locks = family_locks(family, paths)
    return check(list(locks), locks.__getitem__, mode, exempt=exempt, stats=stats)


# ------------------------------------------------------------------------------------------------------ the judgement

# What each family's art is today against its locked palette, and the written reason where it is not conforming.
# `conforming` True: an off-palette pixel FAILS the family's check. False: it is reported and counted with the reason, and
# RATCHETED: `baseline` is what the art measured when it was declared (pictures off the palette, and their px), the check
# fails when either number GROWS (new art off the palette, or more of it) and prints the delta when it does not. It also
# fails if the family would then be conforming (declare it, so the lock holds). Lower the baseline as art is repainted.
FAMILY_DECLARATION = {
    'office': dict(
        conforming=False,
        # MEASURED 2026-11-24 on a real `hq-office/build.py` of the tree with art wave 1 and the reception's redrawn pieces
        # (12543 pictures checked, 116 declared left out): 12541 pictures off the palette (the reception's LED screen is one
        # more picture of its own). Fewer is progress; more fails the build. 14,346,478 px after the drawing contract's fixes of
        # the reception pieces (lane rcfix1; 14,346,494 before): the LED screen's outer ring is now the palette's ink #05061A
        # where it was the off-palette brass line, and its brass moved one pixel in, over the old bezel outline (the outer ring
        # has 452 px, the ring the brass took has 436: 16 px fewer off the palette). The bell, the counter and the two pictures
        # changed no pixel's membership.
        baseline=dict(pictures=12541, px=14346478),
        reason=('the office is drawn from imported catalogue art, recoloured by luminance ramps whose stops are the '
                'palette.py colours but whose pixels are interpolated between them, and from pieces painted by '
                'lounge.py, signature.py, flora.py and fountain.py with colours of their own; palette.py lists far '
                'fewer colours than the pictures use. Repainting them onto the palette is a visual decision for the '
                'owner, not made here')),
    'avatars': dict(conforming=True, reason=''),
    'pets': dict(conforming=True, reason=''),
}


def judge(family, changes, stats=None, out=None):
    """The failures of one family's palette check, printed. A `conforming` family fails on every picture with an
    off-palette pixel. A family declared not conforming never fails on them: they are counted, with the written reason,
    and it fails only when no picture is off the palette any more (the declaration is then stale). Pictures that the
    tool would merely MERGE (colours that are in the palette) are counted, never failing: they are the tool's limit on a
    palette with close colours, not a fault of the art."""
    out = out or sys.stdout
    declaration = FAMILY_DECLARATION[family]
    off = [c for c in changes if c.off_palette]
    merge_only = [c for c in changes if not c.off_palette]
    pictures = (stats or {}).get('pictures')
    exempt = (stats or {}).get('exempt', 0)
    head = f'palette {family}: ' + (f'{pictures} pictures checked' if pictures is not None else 'checked') \
        + (f', {exempt} declared exceptions left out' if exempt else '')
    print(head, file=out)
    if merge_only:
        merged = sum(c.merged for c in merge_only)
        print(f'palette {family}: {len(merge_only)} pictures use two palette colours closer than {THRESHOLD} OKLab and '
              f'the tool would merge them ({merged} px, largest {max(c.max_distance for c in merge_only):.4f}); '
              f'not a violation, and the reason `snap` refuses them', file=out)
        for c in merge_only[:5]:
            print(f'palette {family}:   merge only: {c.path.parent.name}/{c.path.name} {c.merged} px', file=out)
        if len(merge_only) > 5:
            print(f'palette {family}:   ... and {len(merge_only) - 5} more', file=out)
    px = sum(c.off_palette for c in off)
    if declaration['conforming']:
        for c in off:
            print(f'FAIL {c.line()}', file=out)
        print(f'palette {family}: {len(off)} pictures off the palette, {px} px' if off
              else f'palette {family}: every picture is on its palette', file=out)
        return len(off)
    if off:
        far = max(c.max_distance for c in off)
        baseline = declaration.get('baseline')
        grew = bool(baseline) and (len(off) > baseline['pictures'] or px > baseline['px'])
        print(f'palette {family}: {len(off)} of {pictures} pictures are off the palette ({px} px, largest move '
              f'{far:.4f} OKLab), ' + ('FAIL (grew past the baseline): ' if grew else 'NOT FAILING: ')
              + declaration['reason'], file=out)
        if baseline:
            print(f'palette {family}: baseline {baseline["pictures"]} pictures / {baseline["px"]} px, now {len(off)} / {px} '
                  f'({len(off) - baseline["pictures"]:+d} pictures, {px - baseline["px"]:+d} px)'
                  + (': new art is off the palette, put it on the palette or (a decision) raise the baseline' if grew
                     else ': lower the baseline in palettesnap.FAMILY_DECLARATION when it is below' if
                     len(off) < baseline['pictures'] or px < baseline['px'] else ''), file=out)
        return 1 if grew else 0
    print(f'FAIL palette {family}: declared not conforming, but no picture is off the palette: set conforming=True in '
          f'FAMILY_DECLARATION so the lock holds', file=out)
    return 1


# ------------------------------------------------------------------------------------------------------ the numbers

def near_pairs(colours, threshold=THRESHOLD):
    """(pairs closer than `threshold` OKLab, colours that are in at least one such pair) over distinct (r, g, b)."""
    colours = np.asarray(colours, np.uint8).reshape(-1, 3)
    if len(colours) < 2:
        return 0, 0
    lab = oklab(colours)
    cells = np.floor(lab / threshold).astype(np.int64)
    buckets = {}
    for i, cell in enumerate(map(tuple, cells)):
        buckets.setdefault(cell, []).append(i)
    forward = [o for o in itertools.product((-1, 0, 1), repeat=3) if o > (0, 0, 0)]
    touched = np.zeros(len(colours), bool)
    pairs = 0
    for cell, members in buckets.items():
        a = np.array(members)
        d = np.linalg.norm(lab[a][:, None] - lab[a][None], axis=-1)
        close = np.triu(d < threshold, 1)
        pairs += int(close.sum())
        touched[a[close.any(0) | close.any(1)]] = True
        for offset in forward:
            other = buckets.get((cell[0] + offset[0], cell[1] + offset[1], cell[2] + offset[2]))
            if other:
                b = np.array(other)
                close = np.linalg.norm(lab[a][:, None] - lab[b][None], axis=-1) < threshold
                pairs += int(close.sum())
                touched[a[close.any(1)]] = True
                touched[b[close.any(0)]] = True
    return pairs, int(touched.sum())


def _colour_count(pixels):
    return len(np.unique(pack(pixels[..., :3][pixels[..., 3] > 0])))


def tool_merge_counts(files):
    """What the tool's own merge does to each picture, no palette (`--max-colors none`, threshold 0.03): (pictures that
    lose at least one colour, colours lost, summed per picture). MEASURED by running the tool, not derived."""
    files = list(files)
    lost = pictures = 0
    with tempfile.TemporaryDirectory(prefix='palettesnap-') as tmp:
        by_folder = {}
        for file in files:
            by_folder.setdefault(Path(file).resolve().parent, []).append(Path(file))
        n = 0
        for folder in sorted(by_folder):
            group = sorted(by_folder[folder])
            for start in range(0, len(group), BATCH):
                chunk, out = group[start:start + BATCH], Path(tmp) / f'm-{n}'
                n += 1
                toolchain.run(TOOL, [*chunk, '--output-dir', out, '--max-colors', 'none'])
                for file in chunk:
                    before = _colour_count(PG.load_rgba(file))
                    after = _colour_count(PG.load_rgba(out / f'{file.stem}_snapped.png'))
                    if after < before:
                        pictures += 1
                        lost += before - after
    return pictures, lost


def report(paths, palette=None, exempt=None, with_tool=True, out=None):
    """The colour numbers of the pictures under `paths`, printed and returned as a dict:
      pictures, solid_px, colours (distinct r,g,b with alpha > 0, over all of them), per_picture_max,
      near_pairs / colours_in_a_near_pair (pairs closer than 0.03 OKLab over those colours),
      merge_pictures / merge_lost (the tool's own merge, run per picture: MEASURED, `with_tool`),
    and with a palette: palette_colours, palette_close_pairs, pictures_outside (use a colour the palette lacks),
    px_outside, colours_outside. `exempt(path)` leaves a declared exception out and counts it in `exempt`."""
    out = out or sys.stdout
    files, skipped = _files(paths, exempt)
    allowed = None
    if palette is not None:
        palette = _palette(palette)
        allowed = np.array(sorted(pack(np.array(palette, np.uint8))), np.uint32)
    seen, solid_px, per_max, outside_px, outside_pictures = [], 0, 0, 0, 0
    outside_colours = set()
    for file in files:
        pixels = PG.load_rgba(file)
        mask = pixels[..., 3] > 0
        packed = pack(pixels[..., :3])[mask]
        unique = np.unique(packed)
        seen.append(unique)
        solid_px += int(mask.sum())
        per_max = max(per_max, len(unique))
        if allowed is not None:
            off = ~np.isin(packed, allowed)
            if off.any():
                outside_pictures += 1
                outside_px += int(off.sum())
                outside_colours.update(np.unique(packed[off]).tolist())
    colours = np.unique(np.concatenate(seen)) if seen else np.zeros(0, np.uint32)
    pairs, in_pair = near_pairs(unpack(colours))
    result = dict(pictures=len(files), exempt=len(skipped), solid_px=solid_px, colours=int(len(colours)),
                  per_picture_max=per_max, near_pairs=pairs, colours_in_a_near_pair=in_pair)
    if with_tool:
        result['merge_pictures'], result['merge_lost'] = tool_merge_counts(files)
    if palette is not None:
        result.update(palette_colours=len(palette), palette_close_pairs=len(close_pairs(palette)),
                      pictures_outside=outside_pictures, px_outside=outside_px, colours_outside=len(outside_colours))
    print(f'{result["pictures"]} pictures ({result["exempt"]} exempt left out), {result["solid_px"]} px with alpha: '
          f'{result["colours"]} distinct colours (at most {per_max} in one picture)', file=out)
    print(f'near-duplicates (OKLab < {THRESHOLD}): {pairs} colour pairs, {in_pair} colours in at least one pair', file=out)
    if with_tool:
        print(f'the tool merging them per picture (no palette): {result["merge_pictures"]} pictures lose '
              f'{result["merge_lost"]} colours in all', file=out)
    if palette is not None:
        print(f'palette: {result["palette_colours"]} colours, {result["palette_close_pairs"]} pairs closer than '
              f'{THRESHOLD}; {outside_pictures} of {len(files)} pictures use a colour outside it '
              f'({outside_px} px, {len(outside_colours)} colours)', file=out)
    return result


# --------------------------------------------------------------------------------------------------- contact sheet

def contact_sheet(changes, palette, target, count=12, mode='nearest', side=160, columns=3, sources=()):
    """Write `target` (a PNG): the `count` most-changed pictures of `changes` as before | after, nearest-neighbour
    scaled into a `side` px box each, labelled with the file and its changed px. Runs the tool on those pictures only.
    `palette` is a palette (list or file) or a function picture -> palette (`family_locks(...).__getitem__`). The sheet is never
    written over, or inside, a picture it shows or one of the checked `sources`. Returns the paths shown, most changed first."""
    _require(mode)
    top = sorted(changes, key=lambda c: (-c.changed, str(c.path)))[:count]
    if not top:
        raise PaletteError('nothing changed: there is no contact sheet to write')
    target = Path(target).resolve()
    protected = [Path(c.path).resolve() for c in changes] + [Path(s).resolve() for s in sources]
    if any(_inside(target, root) or _inside(root, target) for root in protected):
        raise PaletteError(f'the contact sheet {target} is a checked picture, or inside or around a checked source '
                           f'(the sources are immutable)')
    lock = _lock_of(palette)
    with tempfile.TemporaryDirectory(prefix='palettesnap-') as tmp:
        staged = _run_locked([c.path for c in top], lock, mode, tmp)
        pairs = [(c, PG.load_rgba(c.path), PG.load_rgba(staged[c.path])) for c in top]
    tile_w, tile_h = side * 2 + 30, side + 30            # one box per picture: a tileset next to a 32 px sprite stays legible
    rows = -(-len(pairs) // columns)
    sheet = Image.new('RGB', (tile_w * columns, tile_h * rows), (245, 245, 245))
    draw = ImageDraw.Draw(sheet)

    def paint(pixels, x, y):
        h, w = pixels.shape[:2]
        board = np.indices((h, w)).sum(0) % 2
        base = np.where(board[..., None] == 0, 200, 232).astype(np.uint8).repeat(3, -1)
        alpha = pixels[..., 3:4].astype(float) / 255
        flat = Image.fromarray((pixels[..., :3] * alpha + base * (1 - alpha)).astype(np.uint8), 'RGB')
        zoom = max(1, side // max(w, h))
        flat = flat.resize((w * zoom, h * zoom), Image.NEAREST)
        flat.thumbnail((side, side), Image.NEAREST)       # a picture larger than the box is shrunk, never cropped
        sheet.paste(flat, (x, y))

    for i, (change, before, after) in enumerate(pairs):
        x, y = (i % columns) * tile_w + 6, (i // columns) * tile_h + 16
        draw.text((x, y - 13), f'{change.path.name[:40]}  {change.changed} px', fill=(20, 20, 20))
        paint(before, x, y)
        paint(after, x + side + 10, y)
    sheet.save(target)
    return [c.path for c in top]


# --------------------------------------------------------------------------------------------------------- the CLI

def _lock_arg(args, paths):
    """What the command line locks the pictures to: --palette FILE (one palette, any change counts), or --family F (each
    picture's own lock, the gates' rule: `family_locks`). Exactly one of the two."""
    if bool(args.family) == bool(args.palette):
        raise SystemExit('give exactly one of --family and --palette')
    if args.palette:
        return read_palette(args.palette)
    return family_locks(args.family, paths).__getitem__


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('check', 'snap', 'report'):
        p = sub.add_parser(name)
        p.add_argument('--family', choices=FAMILIES)
        p.add_argument('--palette', help='a .hex, .txt, .gpl or .json palette file')
        if name != 'report':
            p.add_argument('--mode', choices=MODES, default='nearest')
    sub.choices['check'].add_argument('paths', nargs='+')
    sub.choices['check'].add_argument('--contact-sheet', help='write the 12 most-changed pictures, before | after, here')
    sub.choices['report'].add_argument('paths', nargs='+')
    sub.choices['report'].add_argument('--no-tool', action='store_true', help='skip the run of the tool per picture')
    sub.choices['snap'].add_argument('source')
    sub.choices['snap'].add_argument('target')
    sub.choices['snap'].add_argument('--force', action='store_true')
    pal = sub.add_parser('palettes')
    pal.add_argument('--write', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.command == 'palettes':
            if args.write:
                print('wrote ' + ', '.join(write_family_files()))
                return 0
            found = palette_files_problems()
            for line in found:
                print(f'FAIL {line}')
            print('palettes/*.hex match their sources' if not found else f'{len(found)} palette files are out of sync')
            return 1 if found else 0
        if args.command == 'snap':
            source = Path(args.source).resolve()
            return 1 if snap(source, args.target, _lock_arg(args, [source]), args.mode, args.force).refused else 0
        if args.command == 'report':
            if args.family and args.palette:
                raise SystemExit('give exactly one of --family and --palette')
            # the numbers: the family's union palette is the reference (informational), a check of the lock is `check`
            palette = read_palette(PALETTE_DIR / f'{args.family}.hex') if args.family else read_palette(args.palette)
            report(args.paths, palette, with_tool=not args.no_tool)
            return 0
        if args.family == 'office':
            raise PaletteError('the office is checked through hq-office/sheetcheck.py check --dist DIR: its declared '
                               'translucent layers come from the built collection, and the gate counts them; a check here '
                               'would count the glass as off the palette. Use --palette tools/palettes/office.hex for a '
                               'raw check of any pictures')
        stats = {}
        if args.family:
            # the gates' judgement: pictures off the palette fail, a merge by the tool alone does not (`judge`)
            locks = family_locks(args.family, args.paths)
            lock = locks.__getitem__
            changes = check(list(locks), lock, args.mode, stats=stats)
            failed = judge(args.family, changes, stats)
        else:
            lock = _lock_arg(args, args.paths)
            changes = check(args.paths, lock, args.mode, stats=stats)
            for change in changes:
                print(f'FAIL {change.line()}')
            print(f'{len(changes)} of {stats["pictures"]} pictures would change')
            failed = len(changes)
        if changes and args.contact_sheet:
            contact_sheet(changes, lock, args.contact_sheet, mode=args.mode, sources=args.paths)
            print(f'contact sheet: {args.contact_sheet}')
        return 1 if failed else 0
    except (toolchain.ToolError, PaletteError, ValueError, FileExistsError) as error:
        print(f'palettesnap: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
