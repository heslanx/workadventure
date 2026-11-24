"""The drawing contract of the placed office pieces: the rules a picture can be measured against, a ratchet over today's art, the
reviewed list, the caster heights, and the rank of what the owner actually sees.

  python3 -I tools/contract.py report DIST        the table: one row per rule, today's offenders against the baseline
  python3 -I tools/contract.py check DIST         the results verify.py will register ("office.contract"), exit 1 on a fail
  python3 -I tools/contract.py baseline DIST      print the baseline (--write: hq-office/contract/baseline.json)
  python3 -I tools/contract.py ranking DIST       print the rank by placements x severity (--write: ranking.json)
  python3 -I tools/contract.py pieces DIST        print the caster heights (--write: pieces.json, manual entries kept)
  python3 -I tools/contract.py pieces-agreement DIST   how the generic height rules agree with the curated casters (printed)
  python3 -I tools/contract.py kind-suspects DIST      the stand pieces that look like tabletop pieces (printed)
  python3 -I tools/contract.py review-seed DIST --verdicts FILE   seed review.json from the audit (--write)
  python3 -I tools/contract.py review DIST        which reviewed pictures are current, stale (the picture changed) or missing

The data lives in hq-office/contract/: baseline.json (the ratchet), review.json (the reviewed list), pieces.json (casters,
declarations, kind corrections), ranking.json. Nothing here changes a pixel and nothing writes without --write.

THE RULES. Seven are pixel rules, each measured on the picture alone (the kinds come from tools/kinds.py, the one classifier):

  alpha           every pixel is 0 or 255 (a declared translucent piece is the exception)         all kinds
  foot_gap        at most FOOT_GAP_MAX empty rows under the lowest solid row (alpha >= 200)       stand
  edge_touch      no solid run of EDGE_RUN px or more on the top, left or right edge unless it is ink   stand, top, hang
  height_cap      at most HEIGHT_CAP_PX solid rows, unless the piece is declared tall            stand
  painted_shadow  the picture carries no soft shadow near its foot: tools/kinds.painted_shadow   stand, top
  outline         at least OUTLINE_MIN_SHARE of the boundary pixels are in an ink: any colour that holds INK_MIN_SHARE of
                  the boundary and is darker than the median solid luminance (one ink per material, as bake.py draws
                  them; for a thin piece only, a colour that is half of the piece or more, a thin pole's ink, is
                  compared with the pixels that are not that colour), within INK_TOLERANCE per channel. The definition is bake.outline_share, imported,
                  not copied                                                                    stand, top, hang
  colours         at most COLOURS_MAX distinct colours in the solid pixels                       stand, top, hang
  symmetry        a piece declared symmetric differs from its mirror by MIRROR_MAX or less        declared only

HOW EACH ONE GATES. Every pixel rule is a per-sprite ratchet: the baseline lists today's offenders with the pixel hash of the picture
they were measured on. An offender that still has that picture keeps its pass (the art is legacy); a sprite that is not listed, or
whose picture changed, is held to the full limit. So a redrawn piece is a gate from its first build, and nobody can swap one
offender for another (the counts alone could not tell). A rule whose count falls tells you to lower the baseline. The rules that
no pixel can see (the projection class, the light side, "reads right", the footprint of a legacy piece) are review-only: they live
in review.json, and a changed picture marks its entry stale. The model rules (projection, footprint, sort line, recipe
determinism) belong to the baker's own tests, not to this file.

WHAT "THE SAME PICTURE" MEANS. A picture is identified by its PIXELS, never by its file: the pixel hash is the sha256 of the size
("WxH:") and the RGBA bytes of the decoded picture (bake.pixels_sha256 over Pillow's convert('RGBA')). The bytes of a PNG file are
not an identity: the same pixels written on Linux and on macOS differ in the file (zlib), so a hash of the file made every
baselined sprite "changed" on a build from another host. baseline.json and review.json are schema 2 for that reason; a schema 1 file
(file hashes) is refused with a message that says how to write it again.

Result, PASS, FAIL and REPORTED repeat the shapes of tools/verify.py without importing it (verify will import this file): the
dataclass has the same five fields, `to_verify(Result)` converts. Python standard library, numpy and Pillow only."""
import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
sys.path.insert(0, str(HERE))
import kinds as K  # noqa: E402
import bake as B  # noqa: E402   the ONE outline definition (boundary, inks, share): this file only supplies its own limits

DATA_DIR = SOURCE / 'hq-office' / 'contract'
PASS, FAIL, REPORTED = 'pass', 'fail', 'reported'
SCHEMA = 1                       # pieces.json and ranking.json: they hold no picture identity
IDENTITY_SCHEMA = 2              # baseline.json and review.json: they identify a picture by the hash of its pixels (schema 1: of its file)
IDENTITY = ("a picture is identified by the pixel hash: the sha256 of 'WxH:' and the RGBA bytes of the decoded picture "
            "(bake.pixels_sha256); the bytes of the PNG file are never hashed (they differ between hosts for the same pixels)")
PROJECTION_FILE = HERE / 'projection.json'


def load_projection_numbers(path=PROJECTION_FILE):
    """{'height_px_per_m', 'ground_px_per_tile', 'foot_gap_max', 'colour_cap'} read from tools/projection.json, the one place that
    owns them (ground_px_per_tile is the default projection's sy_px_per_m x tile_m: the px of one tile of depth). `h` is a height,
    so every named projection must agree on sz_px_per_m (the ground may differ between projections, the height of a metre may
    not): a file where they differ is an error here, not a silent pick of the default."""
    doc = json.loads(Path(path).read_text())
    szs = {name: p['sz_px_per_m'] for name, p in doc['projections'].items()}
    if len(set(szs.values())) != 1:
        raise ValueError(f'{path}: the projections disagree on sz_px_per_m {szs}: pieces.json h is a height in px and needs one scale')
    default = doc['projections'][doc['default']]
    return dict(height_px_per_m=szs[doc['default']], ground_px_per_tile=default['sy_px_per_m'] * doc.get('tile_m', 1.0),
                foot_gap_max=doc['bake']['foot_gap_max'], colour_cap=doc['bake']['colour_cap'])


_PROJECTION = load_projection_numbers()
HEIGHT_PX_PER_M, GROUND_PX_PER_TILE = _PROJECTION['height_px_per_m'], _PROJECTION['ground_px_per_tile']
FOOT_GAP_MAX, COLOURS_MAX = _PROJECTION['foot_gap_max'], _PROJECTION['colour_cap']   # 21, 32, 1, 24 today

EDGE_RUN = 3                     # a solid run this long on the top, left or right edge: the art was cut by its canvas
HEIGHT_CAP_PX = 56               # the wall face, 2.65 m at 21 px per metre; trees are declared tall
OUTLINE_MIN_SHARE = 0.90
INK_MIN_SHARE = 0.05             # a colour is a candidate for the ink from this share of the boundary pixels (and 2 px)
INK_TOLERANCE = 32               # per channel: the tolerance tools/ audit metrics used for "the same outline colour"
MIRROR_MAX = 0.02
SEVERITY = {'redraw': 3, 'touch-up': 1, 'keep': 0}
AUDIT_REVIEWER = 'audit-2026-11-22'
AUDIT_DATE = '2026-11-22'

CATEGORY_KINDS = {
    'alpha': ('stand', 'top', 'hang', 'floor'),
    'foot_gap': ('stand',),
    'edge_touch': ('stand', 'top', 'hang'),
    'height_cap': ('stand',),
    'painted_shadow': ('stand', 'top'),
    'outline': ('stand', 'top', 'hang'),
    'colours': ('stand', 'top', 'hang'),
    'symmetry': ('stand', 'top', 'hang', 'floor'),
}
RULES = tuple(CATEGORY_KINDS)


@dataclass
class Result:
    """The five fields of tools/verify.py's Result, so `verify.Result(**dataclasses.asdict(r))` is the whole conversion."""
    name: str
    status: str
    detail: str
    lines: list = field(default_factory=list)
    data: dict = field(default_factory=dict)


def to_verify(result_class, result):
    """The same result as an instance of verify.Result (pass the class: this file does not import verify)."""
    return result_class(result.name, result.status, result.detail, list(result.lines), dict(result.data))


# ----------------------------------------------------------------------------------------------------------------- pictures

def load_rgba(path):
    with Image.open(path) as picture:
        return np.asarray(picture.convert('RGBA')).copy()


def pixel_hash(rgba):
    """The identity of a picture: the sha256 of its size and its RGBA bytes (bake.pixels_sha256, the one definition the baker's override
    patches use too). The same pixels give the same hash on every host and under every PNG encoder."""
    return B.pixels_sha256(rgba)


def picture_hash(path):
    """pixel_hash of the picture in the PNG file at `path`, decoded to RGBA (never a hash of the file's bytes)."""
    return pixel_hash(load_rgba(path))


def solid_mask(rgba):
    return np.asarray(rgba)[..., 3] >= K.SOLID_ALPHA


def boundary_mask(solid):
    """The solid pixels that touch a non-solid one (4-neighbourhood); the canvas border counts as empty (bake.boundary_mask)."""
    return B.boundary_mask(solid)


def luminance(colours):
    return B._luminance(colours)


def ink_colours(rgba):
    """The colours that are ink in this picture, darkest first, as [(r, g, b), ...]: bake.picture_inks with this file's limits.
    A piece can be drawn in several materials and each one outlines itself in its own darkest tone (tools/bake.py accepts any
    material's ink), so the picture alone defines the inks as: every exact colour that holds at least INK_MIN_SHARE (and 2 px)
    of the boundary pixels AND is darker than the median luminance of the solid pixels. The second clause is what keeps a light
    rim, a highlight or a fill that happens to line the edge from counting as an outline: a piece outlined in one light colour
    has no ink. A colour that holds half of the piece or more (the ink of a thin pole is two thirds of it) cannot be darker than
    a median it IS, so in a THIN piece (boundary 40% of the solid pixels or more) it is compared with the pixels that are not that
    colour instead (see bake.picture_inks); a wide body that is mostly one colour does not get that case. A piece with no
    solid pixel has none."""
    return B.picture_inks(rgba, solid_alpha=K.SOLID_ALPHA, min_share=INK_MIN_SHARE)


def ink_colour(rgba):
    """(r, g, b) of the darkest of ink_colours(rgba), or None when the piece has no ink."""
    inks = ink_colours(rgba)
    return inks[0] if inks else None


def near_any(colours, inks):
    """Boolean per colour row: within INK_TOLERANCE per channel of at least one of `inks` (a list of (r, g, b))."""
    return B.near_ink(colours, inks, INK_TOLERANCE)


def outline_share(rgba):
    """Share (0..1) of the boundary pixels within INK_TOLERANCE of any of the piece's inks, and the darkest ink; (0.0, None) when
    the piece has no ink. This is bake.outline_share, the same function the baker measures its own outline with."""
    share, inks = B.outline_share(rgba, None, tolerance=INK_TOLERANCE, solid_alpha=K.SOLID_ALPHA, min_share=INK_MIN_SHARE)
    return share, (inks[0] if inks else None)


def foot_gap(rgba):
    """Empty rows under the lowest solid row, or None for a picture with no solid pixel."""
    rows = K.silhouette_rows(np.asarray(rgba)[..., 3])
    return None if rows is None else int(np.asarray(rgba).shape[0] - 1 - rows[1])


def solid_rows(rgba):
    """Rows of the silhouette (foot - top + 1): what shadeBake.ts reads as the piece's height today; 0 with no solid pixel."""
    rows = K.silhouette_rows(np.asarray(rgba)[..., 3])
    return 0 if rows is None else rows[1] - rows[0] + 1


def colour_count(rgba):
    rgba = np.asarray(rgba)
    return int(len(np.unique(rgba[solid_mask(rgba)][:, :3], axis=0)))


def partial_pixels(rgba):
    alpha = np.asarray(rgba)[..., 3]
    return (alpha > 0) & (alpha < 255)


def mirror_difference(rgba, colours=False):
    """Share of the solid pixels that differ from the picture's own left-right mirror, taken about the centre of the solid box. By
    default only the silhouette counts (a pixel differs when one side is solid and the other is not): that is the figure of the
    audit (6.0% and 4.3% for the two side tables), and it catches a clipped corner, a seam or a hole. With `colours` a pixel also
    differs when both sides are solid and the colours are not equal (a light painted on one side). 0.0 with no solid pixel."""
    rgba = np.asarray(rgba)
    solid = solid_mask(rgba)
    if not solid.any():
        return 0.0
    ys, xs = np.nonzero(solid)
    crop = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    flip = crop[:, ::-1]
    a, b = crop[..., 3] >= K.SOLID_ALPHA, flip[..., 3] >= K.SOLID_ALPHA
    differ = a != b
    if colours:
        differ = differ | (a & b & ~(crop[..., :3] == flip[..., :3]).all(axis=-1))
    return float(min(1.0, differ.sum() / a.sum()))


def edge_runs(rgba):
    """{'top'|'left'|'right': [(start, length, ink_only), ...]} of the solid runs of EDGE_RUN px or more on that edge; `ink_only`
    is True when every pixel of the run is within INK_TOLERANCE of the piece's darkest ink (a piece that frames itself with ink is not cut)."""
    rgba = np.asarray(rgba)
    solid = solid_mask(rgba)
    inks = ink_colours(rgba)[:1]     # the darkest ink only: a lighter rim on the canvas edge cannot be told from a cut
    lines = {'top': (solid[0], rgba[0, :, :3]), 'left': (solid[:, 0], rgba[:, 0, :3]), 'right': (solid[:, -1], rgba[:, -1, :3])}
    out = {}
    for name, (flags, colours) in lines.items():
        runs, start = [], None
        for i, flag in enumerate(list(flags) + [False]):
            if flag and start is None:
                start = i
            elif not flag and start is not None:
                if i - start >= EDGE_RUN:
                    inked = bool(inks) and bool(near_any(colours[start:i], inks).all())
                    runs.append((start, i - start, inked))
                start = None
        out[name] = runs
    return out


# ----------------------------------------------------------------------------------------------------------------- the rules

def rule_alpha(rgba, declared):
    partial = partial_pixels(rgba)
    if 'translucent' in declared or not partial.any():
        return []
    ys, xs = np.nonzero(partial)
    return [f'{int(partial.sum())} px with 0 < alpha < 255, first at ({int(xs[0])}, {int(ys[0])})']


def rule_foot_gap(rgba, declared):
    gap = foot_gap(rgba)
    if gap is None:
        return ['no solid pixel']
    return [f'foot gap {gap} rows (at most {FOOT_GAP_MAX})'] if gap > FOOT_GAP_MAX else []


def rule_edge_touch(rgba, declared):
    return [f'solid run of {length} px on the {edge} edge (rows or columns {start} to {start + length - 1}) that is not ink'
            for edge, runs in edge_runs(rgba).items() for start, length, inked in runs if not inked]


def rule_height_cap(rgba, declared):
    rows = solid_rows(rgba)
    if 'tall' in declared or rows <= HEIGHT_CAP_PX:
        return []
    return [f'{rows} solid rows (at most {HEIGHT_CAP_PX} unless declared tall)']


def rule_painted_shadow(rgba, declared):
    return ['the picture draws its own soft shadow near its foot (kinds.painted_shadow)'] if K.painted_shadow(rgba) else []


def rule_outline(rgba, declared):
    share, ink = outline_share(rgba)
    if ink is None:
        return ['no ink: no colour darker than the piece holds enough of the boundary']
    if share < OUTLINE_MIN_SHARE:
        return [f'{share * 100:.1f}% of the boundary is in an ink (darkest #{ink[0]:02x}{ink[1]:02x}{ink[2]:02x}; at least {OUTLINE_MIN_SHARE * 100:.0f}%)']
    return []


def rule_colours(rgba, declared):
    count = colour_count(rgba)
    return [f'{count} colours (at most {COLOURS_MAX})'] if count > COLOURS_MAX else []


def rule_symmetry(rgba, declared):
    if 'symmetric' not in declared:
        return []
    share = mirror_difference(rgba)
    return [f'{share * 100:.1f}% of the solid pixels differ from the mirror silhouette (at most {MIRROR_MAX * 100:.0f}%)'] \
        if share > MIRROR_MAX else []


RULE_FUNCTIONS = {
    'alpha': rule_alpha, 'foot_gap': rule_foot_gap, 'edge_touch': rule_edge_touch, 'height_cap': rule_height_cap,
    'painted_shadow': rule_painted_shadow, 'outline': rule_outline, 'colours': rule_colours, 'symmetry': rule_symmetry,
}


def sprite_problems(rgba, kind, declared=()):
    """{rule: [problem, ...]} of one picture of the given kind; a rule that does not apply to the kind, or that passes, is absent."""
    rgba = np.asarray(rgba)
    declared = set(declared)
    out = {}
    for rule in RULES:
        if kind in CATEGORY_KINDS[rule]:
            problems = RULE_FUNCTIONS[rule](rgba, declared)
            if problems:
                out[rule] = problems
    return out


# ------------------------------------------------------------------------------------------------------------------- the data

def contract_path(name, data_dir=None):
    return Path(data_dir or DATA_DIR) / name


def load_json(name, data_dir=None, default=None):
    path = contract_path(name, data_dir)
    if not path.is_file():
        return default
    return json.loads(path.read_text())


def dump_json(document):
    return json.dumps(document, indent=2, ensure_ascii=False) + '\n'


def write_json(name, document, data_dir=None):
    path = contract_path(name, data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_json(document))
    return path


def declared_for(key, pieces):
    """The declarations of one sprite: the `declared` map of pieces.json plus `tall` from its caster entry."""
    pieces = pieces or {}
    out = set((pieces.get('declared') or {}).get(key, []))
    if ((pieces.get('casters') or {}).get(key) or {}).get('tall'):
        out.add('tall')
    return out


def placed_keys(dist):
    """{key: {'entry': prefab entry, 'placements': n}} of the sprites the built map places, in key order (stdlib JSON only)."""
    dist = Path(dist)
    wam = json.loads((dist / 'office.wam').read_text())
    prefabs = {}
    for path in sorted((dist / 'entities').glob('*/collection.json')):
        doc = json.loads(path.read_text())
        for entry in doc.get('collection', []):
            prefabs[(doc.get('collectionName'), entry.get('id'))] = (f"{path.parent.name}/{entry.get('imagePath')}", entry)
    out = {}
    for e in wam['entities'].values():
        hit = prefabs.get((e['prefabRef']['collectionName'], e['prefabRef']['id']))
        if hit:
            slot = out.setdefault(hit[0], {'entry': hit[1], 'placements': 0})
            slot['placements'] += 1
    return {k: out[k] for k in sorted(out)}


def measure(dist, pieces=None):
    """{key: {'kind', 'pixel_hash', 'placements', 'problems': {rule: [..]}, 'facts': {..}}} for every placed sprite of DIST."""
    dist = Path(dist)
    kinds = K.kinds_of(dist)
    placed = placed_keys(dist)
    out = {}
    for key in sorted(kinds):
        path = dist / 'entities' / key
        rgba = load_rgba(path)
        declared = declared_for(key, pieces)
        share, ink = outline_share(rgba)
        out[key] = dict(
            kind=kinds[key], pixel_hash=pixel_hash(rgba), placements=placed.get(key, {}).get('placements', 0),
            problems=sprite_problems(rgba, kinds[key], declared),
            facts=dict(rows=solid_rows(rgba), foot_gap=foot_gap(rgba), colours=colour_count(rgba), outline_share=round(share, 3),
                       mirror=round(mirror_difference(rgba), 4), mirror_colour=round(mirror_difference(rgba, colours=True), 4),
                       partial_px=int(partial_pixels(rgba).sum()),
                       width=int(rgba.shape[1]), height=int(rgba.shape[0])))
    return out


# ------------------------------------------------------------------------------------------------------------------ baseline

def make_baseline(measured):
    """The ratchet document: per rule the offenders (sorted keys), the scope size and the count; per sprite the pixel hash of the
    picture the offenders were measured on. Deterministic: no date, no path, nothing of the host that built the pictures."""
    rules = {}
    for rule in RULES:
        scope = [k for k, m in measured.items() if m['kind'] in CATEGORY_KINDS[rule]]
        offenders = sorted(k for k in scope if rule in measured[k]['problems'])
        rules[rule] = dict(scope_kinds=list(CATEGORY_KINDS[rule]), in_scope=len(scope), count=len(offenders), offenders=offenders)
    return dict(schema=IDENTITY_SCHEMA, identity=IDENTITY, limits=limits(), rules=rules,
                sprites={k: measured[k]['pixel_hash'] for k in measured})


def limits():
    return dict(foot_gap_max=FOOT_GAP_MAX, edge_run=EDGE_RUN, height_cap_px=HEIGHT_CAP_PX, outline_min_share=OUTLINE_MIN_SHARE,
                ink_min_share=INK_MIN_SHARE, ink_tolerance=INK_TOLERANCE, colours_max=COLOURS_MAX, mirror_max=MIRROR_MAX)


def compare(measured, baseline):
    """{rule: {'count', 'baseline', 'regressions': [(key, why, problem)], 'improved': [key], 'fixed': n}}.
    A regression is an offender that is not an exempt legacy offender: not listed in the baseline's offenders for the rule, or
    listed but its picture changed since (the pixel hash differs), or a sprite the baseline never saw. An improvement is a listed
    offender that is gone from the build or no longer offends."""
    out = {}
    for rule in RULES:
        entry = (baseline.get('rules') or {}).get(rule) or {}
        listed = set(entry.get('offenders', []))
        seen = baseline.get('sprites') or {}
        regressions, count = [], 0
        for key, m in measured.items():
            if rule not in m['problems']:
                continue
            count += 1
            if key in listed and seen.get(key) == m['pixel_hash']:
                continue
            if key not in seen:
                why = 'new sprite'
            elif key not in listed:
                why = 'not an offender in the baseline'
            else:
                why = 'picture changed since the baseline'
            regressions.append((key, why, m['problems'][rule][0]))
        improved = sorted(k for k in listed if k not in measured or rule not in measured[k]['problems'])
        out[rule] = dict(count=count, baseline=entry.get('count', 0), regressions=regressions, improved=improved)
    return out


# ------------------------------------------------------------------------------------------------------------------ results

def identity_problem(document, name, how):
    """None when `document` (baseline.json or review.json) identifies pictures by their pixels (IDENTITY_SCHEMA), else the message
    that refuses it. A schema 1 file holds hashes of PNG file bytes: they can never match a build made on another host, so reading
    them would call every picture changed. `how` says how to write the file again."""
    schema = (document or {}).get('schema')
    if schema == IDENTITY_SCHEMA:
        return None
    return (f'contract/{name} is schema {schema!r}, this tool reads schema {IDENTITY_SCHEMA}: schema 1 identified a picture by the hash of its '
            f'PNG file, which differs between hosts for the same pixels, schema {IDENTITY_SCHEMA} by the hash of its pixels; {how}')


BASELINE_HOW = 'write it again with `python3 -I tools/contract.py baseline DIST --write` over a build of the art it was measured on'
REVIEW_HOW = ('take the repository\'s schema 2 file, or seed it again with '
              '`python3 -I tools/contract.py review-seed DIST --verdicts FILE --write`')


def baseline_result(measured, baseline, enforce=True):
    refused = identity_problem(baseline, 'baseline.json', BASELINE_HOW)
    if refused:                         # not comparable: a gate that cannot read its baseline must not pass
        return Result('office.contract', FAIL if enforce else REPORTED, refused, [refused],
                      dict(sprites=len(measured), schema=baseline.get('schema')))
    compared = compare(measured, baseline)
    regressions = [(rule, *r) for rule, c in compared.items() for r in c['regressions']]
    improved = {rule: c['improved'] for rule, c in compared.items() if c['improved']}
    data = dict(sprites=len(measured), rules={rule: dict(count=c['count'], baseline=c['baseline'], regressions=len(c['regressions']),
                                                         improved=len(c['improved'])) for rule, c in compared.items()})
    lines = [f'{rule}: {key} ({why}): {problem}' for rule, key, why, problem in regressions]
    table = ', '.join(f'{rule} {c["count"]}/{c["baseline"]}' for rule, c in compared.items())
    if regressions:
        status = FAIL if enforce else REPORTED
        return Result('office.contract', status, f'{len(regressions)} contract regressions over {len(measured)} placed sprites '
                      f'(count/baseline: {table}): ' + lines[0], lines, data)
    note = ''
    if improved:
        note = '; ' + ', '.join(f'{rule} fell by {len(keys)}' for rule, keys in improved.items()) + ': lower the baseline with ' \
               '`python3 -I tools/contract.py baseline DIST --write`'
    return Result('office.contract', PASS, f'no regression over {len(measured)} placed sprites (count/baseline: {table}){note}', [], data)


def pieces_problems(pieces, measured):
    """[problem] of pieces.json against the build: every placed stand sprite has a caster entry with a usable h, no entry names
    a sprite that is not placed or not stand, h is at most the picture's own rows, declarations are known, corrections name
    placed sprites, a kind of kinds.KINDS, and the sprite's kind now is the correction's `from` (still open) or `to` (the rule has
    been fixed since: resolved)."""
    problems = []
    casters = (pieces or {}).get('casters') or {}
    stand = {k for k, m in measured.items() if m['kind'] == 'stand'}
    missing = sorted(stand - set(casters))
    if missing:
        problems.append(f'{len(missing)} placed stand sprites have no caster entry, first {missing[0]!r}')
    for key, entry in casters.items():
        if key not in measured:
            problems.append(f'caster entry {key!r} is not a placed sprite')
            continue
        if measured[key]['kind'] != 'stand':
            problems.append(f'caster entry {key!r} is a {measured[key]["kind"]} sprite, not stand')
        h = entry.get('h')
        if not isinstance(h, (int, float)) or isinstance(h, bool) or h < 1:
            problems.append(f'caster {key!r}: h {h!r} is not a number of px of at least 1')
        elif h > measured[key]['facts']['rows']:
            problems.append(f'caster {key!r}: h {h} is more than the picture\'s {measured[key]["facts"]["rows"]} solid rows')
        if not entry.get('source'):
            problems.append(f'caster {key!r} says nothing of how h was decided (source)')
    for key, names in ((pieces or {}).get('declared') or {}).items():
        unknown = sorted(set(names) - {'tall', 'symmetric', 'translucent'})
        if key not in measured:
            problems.append(f'declaration {key!r} is not a placed sprite')
        if unknown:
            problems.append(f'declaration {key!r}: unknown {unknown}')
    for fix in (pieces or {}).get('kind_corrections') or []:
        if fix.get('key') not in measured:
            problems.append(f'kind correction {fix.get("key")!r} is not a placed sprite')
            continue
        if fix.get('to') not in K.KINDS:
            problems.append(f'kind correction {fix.get("key")!r}: {fix.get("to")!r} is not one of {K.KINDS}')
            continue
        now = measured[fix['key']]['kind']
        if now not in (fix.get('from'), fix['to']):     # the rule moved it to `to` already (resolved) or it still is `from` (open)
            problems.append(f'kind correction {fix["key"]!r}: the sprite is {now} now, neither {fix.get("from")} nor {fix["to"]}')
    return problems


def pieces_result(pieces, measured, enforce=True):
    if pieces is None:
        return Result('office.contract.pieces', REPORTED, 'contract/pieces.json is missing: no caster heights, the runtime keeps '
                      'treating a sprite\'s rows as its height')
    problems = pieces_problems(pieces, measured)
    count = len((pieces.get('casters') or {}))
    if problems:
        return Result('office.contract.pieces', FAIL if enforce else REPORTED, f'{len(problems)} problems: ' + problems[0], problems,
                      dict(casters=count))
    return Result('office.contract.pieces', PASS, f'{count} caster entries for the placed stand sprites, '
                  f'{len((pieces.get("kind_corrections") or []))} kind corrections listed', data=dict(casters=count))


def review_status(review, measured):
    """{'current': [keys], 'stale': [keys] (the picture changed after the review), 'missing': [keys] (placed, never reviewed),
    'orphan': [keys] (reviewed, no longer placed)}."""
    entries = (review or {}).get('entries') or {}
    out = dict(current=[], stale=[], missing=[], orphan=sorted(k for k in entries if k not in measured))
    for key, m in measured.items():
        entry = entries.get(key)
        if entry is None:
            out['missing'].append(key)
        elif entry.get('pixel_hash') != m['pixel_hash']:
            out['stale'].append(key)
        else:
            out['current'].append(key)
    return out


def review_result(review, measured):
    """REPORTED only: the reviewed list is a human judgement, so a stale entry asks for a new look and never fails a build."""
    if review is None:
        return Result('office.contract.review', REPORTED, 'contract/review.json is missing: no reviewed verdicts')
    refused = identity_problem(review, 'review.json', REVIEW_HOW)
    if refused:
        return Result('office.contract.review', REPORTED, refused, [refused])
    status = review_status(review, measured)
    entries = review.get('entries') or {}
    open_work = {v: sum(1 for k in status['current'] if entries[k].get('verdict') == v) for v in SEVERITY}
    lines = [f'stale (the picture changed after the review): {k}' for k in status['stale']]
    lines += [f'not reviewed: {k}' for k in status['missing']]
    detail = (f'{len(status["current"])} reviewed pictures are current ({open_work["redraw"]} redraw, {open_work["touch-up"]} touch-up, '
              f'{open_work["keep"]} keep), {len(status["stale"])} stale, {len(status["missing"])} not reviewed')
    return Result('office.contract.review', REPORTED, detail, lines, dict(current=len(status['current']), stale=len(status['stale']),
                                                                        missing=len(status['missing']), orphan=len(status['orphan'])))


def check(dist, baseline=None, *, enforce=True, pieces=None, review=None, data_dir=None):
    """The results verify.py registers: [office.contract (the ratchet), office.contract.pieces, office.contract.review].
    `baseline`, `pieces` and `review` are documents or None (read from hq-office/contract/, or `data_dir`). With enforce False a
    regression is REPORTED, not FAIL (the plan's waves 0 to 2). A missing baseline is REPORTED: nothing to compare against."""
    pieces = pieces if pieces is not None else load_json('pieces.json', data_dir)
    review = review if review is not None else load_json('review.json', data_dir)
    baseline = baseline if baseline is not None else load_json('baseline.json', data_dir)
    measured = measure(dist, pieces)
    if baseline is None:
        first = Result('office.contract', REPORTED, f'contract/baseline.json is missing: {len(measured)} sprites measured, '
                       'nothing to compare against; run `python3 -I tools/contract.py baseline DIST --write`')
    else:
        first = baseline_result(measured, baseline, enforce)
    return [first, pieces_result(pieces, measured, enforce), review_result(review, measured)]


# ---------------------------------------------------------------------------------------------------------------------- rank

def ranking(dist, review):
    """What the owner sees: every placed sprite with its placement count and the severity of its reviewed verdict, ranked by
    placements x severity (redraw 3, touch-up 1, keep 0), then by placements, then by key. Unreviewed sprites rank as keep."""
    entries = (review or {}).get('entries') or {}
    rows = []
    for key, slot in placed_keys(dist).items():
        entry = entries.get(key) or {}
        verdict = entry.get('verdict', 'unreviewed')
        rows.append(dict(key=key, name=slot['entry'].get('name'), direction=slot['entry'].get('direction'), verdict=verdict,
                         placements=slot['placements'],
                         score=slot['placements'] * SEVERITY.get(verdict, 0)))
    rows.sort(key=lambda r: (-r['score'], -r['placements'], r['key']))
    for i, row in enumerate(rows, 1):
        row['rank'] = i
    return rows


def ranking_document(dist, review):
    """ranking.json: the whole rank, the share of placements that are not `keep`, the most repeated keeps, and `second_look`: the
    entries of the reviewed list that carry a `second_opinion` (a human looked again at a heavily repeated piece the audit kept)."""
    rows = ranking(dist, review)
    total = sum(r['placements'] for r in rows)
    by = {v: sum(r['placements'] for r in rows if r['verdict'] == v) for v in SEVERITY}
    keeps = sorted((r for r in rows if r['verdict'] == 'keep'), key=lambda r: (-r['placements'], r['key']))[:10]
    entries = (review or {}).get('entries') or {}
    placements = {r['key']: r['placements'] for r in rows}
    second = [dict(key=k, name=e.get('name'), placements=placements.get(k, 0), audit_verdict=e.get('verdict'),
                   second_verdict=e['second_opinion'].get('verdict'), changes_audit=e['second_opinion'].get('verdict') != e.get('verdict'),
                   reviewer=e['second_opinion'].get('reviewer'), reason=e['second_opinion'].get('reason'))
              for k, e in entries.items() if e.get('second_opinion')]
    second.sort(key=lambda r: (-r['placements'], r['key']))
    return dict(schema=SCHEMA, severity=SEVERITY, placements=total, sprites=len(rows), placements_by_verdict=by,
                share_of_placements_not_keep=round(1 - by['keep'] / total, 4) if total else 0,
                most_repeated_keep=[dict(key=r['key'], name=r['name'], direction=r['direction'], placements=r['placements']) for r in keeps],
                second_look=second, ranked=rows)


# --------------------------------------------------------------------------------------------------------------------- review

# Evidence text written during the audit names scratch files of the machine it ran on (the audit's crops and scripts, the build under
# test). A data file of the repository must not point into a scratch directory or a home directory, so the seed rewrites each one to
# an audit-relative or build-relative name and keeps the MEASURED / DERIVED / READ tag the sentence carries. The prefixes are spelled
# in parts so that a grep for scratch paths over this lane's files finds only data, never this code.
_SCRATCH = '(?:/pri' + 'vate)?/t' + 'mp/'
_HOME = '/Us' + 'ers/'
PATH_REWRITES = [
    (re.compile(_HOME + r'[^\s)]*?/\.worktrees/[^/\s)]+/'), ''),
    (re.compile(_HOME + r'[^/\s)]+/'), '~/'),
    (re.compile(_SCRATCH + 'asset-audit/'), 'audit-2026-11-22/'),
    (re.compile(_SCRATCH + 'lighting-v2/dist/'), 'dist/'),
    (re.compile(_SCRATCH + r'claude-\d+/(?:\.\.\./)?'), ''),
    (re.compile(_SCRATCH), ''),
]


def scrub_paths(text):
    """`text` with every scratch or home path rewritten (see PATH_REWRITES): the same string when it has none."""
    if not isinstance(text, str):
        return text
    for pattern, replacement in PATH_REWRITES:
        text = pattern.sub(replacement, text)
    return text


def scrub_document(value):
    """scrub_paths over every string of a JSON-like value (keys are left alone)."""
    if isinstance(value, dict):
        return {k: scrub_document(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub_document(v) for v in value]
    return scrub_paths(value)


def seed_review(dist, verdicts, reviewer=AUDIT_REVIEWER, date=AUDIT_DATE, previous=None):
    """The reviewed list from the audit's verdict records (a list of dicts with `key`, `verdict`, `problems`, ...). The pixel hash is
    that of the picture in DIST, so a changed picture invalidates its entry. A verdict whose key is not a placed sprite is
    matched to the one placed sprite that has the same editor name and no verdict of its own (the audit's transcription of two
    long ids was wrong); the repair is recorded in the entry. An entry that has a `second_opinion` in `previous` keeps it."""
    dist = Path(dist)
    placed = placed_keys(dist)
    by_key = {v['key']: v for v in verdicts}
    unclaimed = {k for k in placed if k not in by_key}
    entries, repairs = {}, []
    for verdict in verdicts:
        key = verdict['key']
        original = None
        if key not in placed:
            names = [k for k in sorted(unclaimed) if placed[k]['entry'].get('name') == verdict.get('name')]
            if len(names) != 1:
                raise ValueError(f'the verdict for {key!r} ({verdict.get("name")!r}) matches no placed sprite and {len(names)} '
                                 'candidates by name: fix the key by hand')
            original, key = key, names[0]
            unclaimed.discard(key)
            repairs.append(dict(was=original, now=key))
        entry = dict(verdict=verdict['verdict'], problems=list(verdict.get('problems') or []), fix=verdict.get('fix'),
                     name=verdict.get('name'), audit={k: verdict.get(k) for k in (
                         'projection', 'topFaceVisible', 'depthPxPerTile', 'lightFrom', 'outline', 'scaleVsAvatar', 'bakedShadow',
                         'castShadowWillLookWrong')},
                     pixel_hash=picture_hash(dist / 'entities' / key), reviewer=reviewer, date=date)
        entry = scrub_document(entry)
        if original:
            entry['key_repaired_from'] = original
        old = ((previous or {}).get('entries') or {}).get(key) or {}
        if old.get('second_opinion'):
            entry['second_opinion'] = scrub_document(old['second_opinion'])
        entries[key] = entry
    missing = sorted(set(placed) - set(entries))
    if missing:
        raise ValueError(f'{len(missing)} placed sprites have no verdict, first {missing[0]!r}')
    return dict(schema=IDENTITY_SCHEMA, identity=IDENTITY, reviewer=reviewer, repairs=repairs, entries={k: entries[k] for k in sorted(entries)})


# --------------------------------------------------------------------------------------------------------------------- pieces
# What a caster is. shadeBake.ts decides a standing piece's height today as
#     const height = shape.foot - shape.top + 1;                              (shadeBake.ts:388 keyOnFloor, :418 keyOnSupport,
#                                                                              :516 the lamps' shadows)
#     m: lengthScale(height, k.length, SHADOW_FLOOR_PX, SHADOW_CAP_PX)         (shadeShapes.ts:191: natural = height * length,
#                                                                              the shadow is clamped to 3..22 px, a lamp's 5..36)
# so the rows of the silhouette ARE the height: a table drawn from above (28 rows of top, 12 of front) throws a shadow as long as
# a 40 px wall. `h` is what should stand in place of `shape.foot - shape.top + 1`: the height, in px above the floor, of the part
# that throws the shadow. A piece drawn in front elevation has no top face: its rows are its height, `h = rows` (basis "rows").
# A piece with a top face visible has rows = h + depth, so `h` is (a) rows minus the footprint's depth in px when the prefab's
# collisionGrid and the audit's px-per-tile are known and the result is within PLAUSIBLE of the real-world anchor (basis
# "measured"), else (b) the real-world anchor of its kind of object at HEIGHT_PX_PER_M (basis "anchor"). An entry that starts
# its `source` with "manual" is kept by `pieces --write`.

PLAUSIBLE = (0.6, 1.4)
TALL_NAMES = re.compile(r'^(bétula|árvore|pinheiro)', re.IGNORECASE)

# (regex over the editor name, label, metres): the first match wins. Real-world heights of the part that throws the shadow.
ANCHORS = [
    (r'pufe', 'pouf', 0.40),
    (r'banqueta|banco alto', 'bar stool (plan: seat 16 px)', 0.75),
    (r'banco de praça', 'park bench (back)', 0.85),
    (r'adirondack', 'Adirondack chair (back)', 0.95),
    (r'sofá', 'sofa (back)', 0.85),
    (r'poltrona', 'armchair (back)', 0.85),
    (r'cadeira', 'chair (back)', 0.90),
    (r'luminária de mesa', 'desk lamp', 0.45),
    (r'mesa de centro|mesa lateral|criado-mudo|mesinha', 'low table', 0.50),
    (r'balcão', 'counter (plan: bar counter 22 px)', 1.05),
    (r'sinuca|air hockey', 'games table (plan: air hockey 17 px)', 0.80),
    (r'pebolim', 'foosball table', 0.90),
    (r'mesa', 'table top (plan: desk 16 px)', 0.74),
    (r'aparador', 'sideboard', 0.80),
    (r'arquivo de gavetas', 'filing cabinet', 0.75),
    (r'armário de cozinha', 'kitchen cabinet', 0.90),
    (r'estante de livros média', 'medium bookcase', 1.20),
    (r'estante', 'bookcase', 1.80),
    (r'piano', 'upright piano', 1.25),
    (r'luminária de arco', 'arc floor lamp (plan: apex 44 px)', 2.10),
    (r'luminária de chão', 'floor lamp', 1.50),
    (r'câmera no tripé', 'camera on a tripod', 1.50),
    (r'totem', 'sign totem', 2.00),
    (r'sino', 'sales bell on a stand', 1.20),
    (r'púlpito', 'lectern', 1.10),
]
PLANT_TAGS = ('Plantas', 'Exterior e jardim')


def anchor_for(name):
    for pattern, label, metres in ANCHORS:
        if re.search(pattern, name or '', re.IGNORECASE):
            return label, int(round(metres * HEIGHT_PX_PER_M))
    return None


def grid_depth(collision_grid):
    """Rows of the prefab's collisionGrid that block anything (contain a 1): the footprint's depth in tiles; None when there is no grid."""
    if not collision_grid:
        return None
    return sum(1 for row in collision_grid if any(row))


def measured_front(rows, collision_grid, px_per_tile):
    """rows minus the footprint's depth in px (rows = h + depth under a projection whose ground is `px_per_tile` px per tile of
    depth); None when the grid or the scale is unknown or the piece is not deeper than its picture is tall."""
    depth = grid_depth(collision_grid)
    if depth is None or not px_per_tile:
        return None
    value = rows - depth * px_per_tile
    return value if value >= 1 else None


def derive_caster(name, tags, rows, collision_grid, audit):
    """One caster entry {h, basis, source, rows, tall?} from the picture's rows, the prefab and the audit record
    (`topFaceVisible`, `depthPxPerTile`). The candidate is what the picture shows (its rows in front elevation, its rows minus the
    footprint's depth with a top face); it is used when it falls within PLAUSIBLE of the real-world anchor of the kind of
    object, else the anchor is (the picture is then not at scale, and the entry says so). A kind with no anchor, and a plant,
    keep the rows."""
    audit = audit or {}
    base = dict(rows=rows)
    if TALL_NAMES.search(name or ''):
        base['tall'] = True
    top_face = audit.get('topFaceVisible')
    plant = any(t in PLANT_TAGS for t in (tags or ()))
    anchor = None if plant else anchor_for(name)
    if anchor is None:
        why = ('a plant: the foliage is drawn in elevation and the pot\'s top ellipse is a few rows' if plant else
               'front elevation (audit topFaceVisible false): the rows are the height' if top_face is False else
               'no height anchor for this kind of object: the rows, as today')
        return dict(h=rows, basis='rows', source=f'{why}; {rows} solid rows (alpha >= {K.SOLID_ALPHA})', **base)
    label, px = anchor
    if top_face is False:
        candidate, basis, how = rows, 'rows', f'front elevation (audit topFaceVisible false): {rows} solid rows'
    else:
        candidate = measured_front(rows, collision_grid, audit.get('depthPxPerTile'))
        basis = 'measured'
        how = (f'top face visible: {rows} rows minus {grid_depth(collision_grid)} tile(s) of footprint depth x '
               f'{audit.get("depthPxPerTile")} px = {None if candidate is None else int(round(candidate))} px'
               if candidate is not None else 'top face visible, no collisionGrid or scale to measure the front face')
    if candidate is not None and PLAUSIBLE[0] * px <= candidate <= PLAUSIBLE[1] * px:
        return dict(h=min(rows, int(round(candidate))), basis=basis,
                    source=f'{how}, within {PLAUSIBLE[0]} to {PLAUSIBLE[1]} of the anchor {label} {px} px', **base)
    return dict(h=min(rows, px), basis='anchor', source=f'{how}; outside {PLAUSIBLE[0]} to {PLAUSIBLE[1]} of the anchor {label} '
                f'{px} px at {HEIGHT_PX_PER_M} px per metre, so the anchor is used' if candidate is not None else
                f'{how}; the anchor {label} {px} px at {HEIGHT_PX_PER_M} px per metre is used', **base)


# The rule proposed for a stand piece that has no caster entry (people place pieces from the catalogue that were never curated):
# h = min(rows, the smallest TAG_CAPS value over the piece's tags), and h = rows (today's behaviour) with no capped tag. The caps are the
# real-world heights of the part that throws the shadow in px at the map's scale (the plan's tag anchors: desk 16, chair back 19, sofa
# back 18, lamp apex 44).
TAG_CAPS = {'Mesas': 16, 'Cadeiras e bancos': 19, 'Sofás e poltronas': 18, 'Luminárias': 44}
OFF_BY = 8                       # px: "off by more than" in the agreement figures


def generic_height(tags, rows):
    """The generic rule: h for a stand piece with no caster entry."""
    caps = [TAG_CAPS[t] for t in (tags or ()) if t in TAG_CAPS]
    return min(rows, min(caps)) if caps else rows


def units_note():
    """The `units` sentence of pieces.json, from tools/projection.json (never a copy of its numbers)."""
    return (f"h and rows in px at the map's scale; 1 m of height = {HEIGHT_PX_PER_M} px in every projection of tools/projection.json "
            f"(they must agree on sz_px_per_m, see load_projection_numbers); the ground is {GROUND_PX_PER_TILE:g} px per tile of depth "
            f"in the default projection")


def pieces_agreement(casters, prefabs):
    """How the generic rules agree with the curated caster heights, so the figures can be rerun (`contract.py pieces-agreement DIST`).
    `casters` is pieces.json's casters; `prefabs` is {key: prefab entry} (tags, collisionGrid) of the placed sprites. Mean absolute
    error in px and the count off by more than OFF_BY px of: today's rule (h = rows), the tag caps (generic_height), and on the pieces
    that carry a collisionGrid also the grid-depth rule (h = rows - blocking grid rows x ground px per tile; unclamped, clamped
    at 1, and falling back to rows when under 1). The curated heights are NOT independent of the rules: the 'rows' entries equal
    today's rule by definition and the 'measured' ones come from the grid, so `anchor_only` (the entries whose h is a real-world
    anchor, independent of both rows and grid) is the fairer figure."""
    def score(keys, rules):
        out = dict(n=len(keys), mean_abs_error_px={}, off_by_more_than_8_px={})
        for name, fn in rules.items():
            errors = [abs(fn(k) - casters[k]['h']) for k in keys]
            out['mean_abs_error_px'][name] = round(float(np.mean(errors)), 1) if errors else None
            out['off_by_more_than_8_px'][name] = sum(1 for e in errors if e > OFF_BY)
        return out

    def rows(k):
        return casters[k]['rows']

    def grid_h(k):
        return rows(k) - grid_depth(prefabs[k].get('collisionGrid')) * GROUND_PX_PER_TILE

    rules = {'today_rows': rows, 'tag_cap': lambda k: generic_height(prefabs[k].get('tags'), rows(k))}
    keys = sorted(k for k in casters if k in prefabs and 'rows' in casters[k] and 'h' in casters[k])   # a hand entry may carry only h
    gridded = [k for k in keys if grid_depth(prefabs[k].get('collisionGrid')) is not None]
    grid_rules = dict(rules, grid_depth=grid_h, grid_depth_clamped_at_1=lambda k: max(1, grid_h(k)),
                      grid_depth_or_rows=lambda k: grid_h(k) if grid_h(k) >= 1 else rows(k))
    basis = {}
    for k in keys:
        basis[casters[k].get('basis')] = basis.get(casters[k].get('basis'), 0) + 1
    return dict(curated=len(keys), basis=dict(sorted(basis.items(), key=lambda kv: str(kv[0]))), all=score(keys, rules),
                anchor_only=score([k for k in keys if casters[k].get('basis') == 'anchor'], rules),
                with_collision_grid=score(gridded, grid_rules))


def rejected_text(agreement):
    """The `generic_rule.rejected` sentence, its numbers taken from pieces_agreement()."""
    g, n = agreement['with_collision_grid'], agreement['curated']
    e = g['mean_abs_error_px']
    return (f"collisionGrid depth as the footprint depth (h = rows - blocking grid rows x {GROUND_PX_PER_TILE:g} px) is not rejected for "
            f"being less accurate: on the {g['n']} of {n} curated stand entries that carry a grid its mean error is {e['grid_depth']} px "
            f"unclamped ({e['grid_depth_clamped_at_1']} clamped at 1, {e['grid_depth_or_rows']} falling back to rows under 1) against "
            f"{e['tag_cap']} for the tag caps and {e['today_rows']} for today's rows, so grid and tag caps are about equal and both "
            f"better than rows. It is rejected on coverage and optionality: EntityRawPrefab.collisionGrid is optional "
            f"(libs/map-editor/src/types.ts:305), only {g['n']} of {n} entries have one, so a catalogue piece may have none and the rule "
            f"would need the tag caps anyway; and the comparison is partly circular, since the {agreement['basis'].get('measured', 0)} "
            f"'measured' entries were derived from the grid. A grid says what blocks walking, not how deep the drawing is.")


def generic_rule_document(agreement):
    return dict(
        for_pieces='any stand piece placed from the catalogue that has no entry in casters',
        rule="h = min(rows, TAG_CAPS[tag]) over the piece's tags; no capped tag: h = rows (today's behaviour)",
        tag_caps=dict(TAG_CAPS),
        runtime_fields_needed="none new: the prefab's `tags` (casterKind.ts already reads them in KindInput) and the silhouette rows "
                              "(shadeBake.ts already computes them). `tall` cannot be derived: a piece with no entry is never tall, so the "
                              "22 px cap stays for it.",
        measured_agreement=agreement,
        measured_agreement_note="rerun with `python3 -I tools/contract.py pieces-agreement DIST`; the curated entries are NOT independent of "
                                "the rules (see pieces_agreement), `anchor_only` is the fair figure",
        rejected=rejected_text(agreement))


def prefabs_of(dist):
    """{key: prefab entry} of the placed sprites."""
    return {k: v['entry'] for k, v in placed_keys(dist).items()}


def derive_pieces(dist, review, previous=None):
    """The whole of pieces.json: casters for every placed stand sprite (manual entries of `previous` kept), declarations and
    kind corrections (kept from `previous`), the generic rule and its measured agreement (recomputed), the runtime proposal (kept).
    See the comment block above for the rule."""
    dist = Path(dist)
    placed = placed_keys(dist)
    kinds = K.kinds_of(dist)
    entries = (review or {}).get('entries') or {}
    old = previous or {}
    casters = {}
    for key, kind in kinds.items():
        if kind != 'stand':
            continue
        manual = (old.get('casters') or {}).get(key)
        if manual and str(manual.get('source', '')).startswith('manual'):
            casters[key] = manual
            continue
        entry = placed[key]['entry']
        rows = solid_rows(load_rgba(dist / 'entities' / key))
        casters[key] = derive_caster(entry.get('name'), entry.get('tags'), rows, entry.get('collisionGrid'),
                                     (entries.get(key) or {}).get('audit'))
    casters = {k: casters[k] for k in sorted(casters)}
    document = dict(schema=SCHEMA, units=units_note())
    document.update({k: old[k] for k in ('declared', 'declared_notes', 'kind_corrections') if k in old})
    document['casters'] = casters
    document['generic_rule'] = generic_rule_document(pieces_agreement(casters, prefabs_of(dist)))
    if 'runtime' in old:
        document['runtime'] = old['runtime']
    return document


# ------------------------------------------------------------------------------------------------------- kinds that are wrong
# casterKind.ts and kinds.classify decide the kind from the editor name and tags, so a table lamp or a banknote bundle that the
# Mobília collection lists as a plain piece is `stand` and throws a floor shadow from the middle of a desk (critic item 8). The
# map itself says what the piece does: when a small stand piece is placed with its foot inside a table or counter, it sits on it.

SUPPORT_TAGS = ('Mesas', 'Peças da marca', 'Armazenamento', 'Cozinha e café')
SEAT_TAGS = ('Cadeiras e bancos', 'Sofás e poltronas')
SMALL_ROWS = 32                  # a piece taller than this does not sit on a table
SMALL_AREA_SHARE = 0.35          # and neither does one that fills more than this share of its support's solid box


def solid_box(rgba):
    """(x0, y0, x1, y1), x1 and y1 exclusive, of the solid pixels, or None."""
    ys, xs = np.nonzero(solid_mask(rgba))
    return None if not len(ys) else (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def kind_suspects(dist):
    """{key: {'placements', 'on_support', 'supports': {name: n}}} of the placed `stand` sprites that look like tabletop pieces: not
    a seat, at most SMALL_ROWS rows tall, and with the bottom centre of its solid box inside the solid box of a placed stand
    piece tagged as a table, counter, storage or kitchen piece, at least SMALL_AREA_SHARE times smaller, in at least one
    placement. An entity's x, y is read as the top-left corner of its picture."""
    dist = Path(dist)
    kinds = K.kinds_of(dist)
    wam = json.loads((dist / 'office.wam').read_text())
    prefabs = {}
    for path in sorted((dist / 'entities').glob('*/collection.json')):
        doc = json.loads(path.read_text())
        for entry in doc.get('collection', []):
            prefabs[(doc.get('collectionName'), entry.get('id'))] = (f"{path.parent.name}/{entry.get('imagePath')}", entry)
    boxes, items = {}, []
    for e in wam['entities'].values():
        hit = prefabs.get((e['prefabRef']['collectionName'], e['prefabRef']['id']))
        if not hit or kinds.get(hit[0]) != 'stand':
            continue
        key, entry = hit
        if key not in boxes:
            boxes[key] = solid_box(load_rgba(dist / 'entities' / key))
        if boxes[key]:
            b = boxes[key]
            items.append((key, entry, (e['x'] + b[0], e['y'] + b[1], e['x'] + b[2], e['y'] + b[3])))
    out = {}
    for key, entry, box in items:
        tags = entry.get('tags') or []
        if any(t in SEAT_TAGS for t in tags) or box[3] - box[1] > SMALL_ROWS:
            continue
        slot = out.setdefault(key, {'placements': 0, 'on_support': 0, 'supports': {}})
        slot['placements'] += 1
        foot_x, foot_y, area = (box[0] + box[2]) / 2, box[3], (box[2] - box[0]) * (box[3] - box[1])
        for other_key, other, other_box in items:
            if other_key == key or not any(t in SUPPORT_TAGS for t in (other.get('tags') or [])):
                continue
            other_area = (other_box[2] - other_box[0]) * (other_box[3] - other_box[1])
            if other_box[0] <= foot_x <= other_box[2] and other_box[1] <= foot_y <= other_box[3] and area < SMALL_AREA_SHARE * other_area:
                slot['on_support'] += 1
                name = other.get('name')
                slot['supports'][name] = slot['supports'].get(name, 0) + 1
                break
    return {k: v for k, v in sorted(out.items()) if v['on_support']}


# ---------------------------------------------------------------------------------------------------------------- the report

def report_table(measured, baseline=None):
    lines = [f'{"rule":<15}{"scope":<22}{"in scope":>9}{"offenders":>10}{"baseline":>9}   worst']
    for rule in RULES:
        scope = [k for k, m in measured.items() if m['kind'] in CATEGORY_KINDS[rule]]
        bad = [k for k in scope if rule in measured[k]['problems']]
        base = ((baseline or {}).get('rules') or {}).get(rule, {}).get('count', '-')
        worst = ''
        if bad:
            key = bad[0] if rule not in ('foot_gap', 'height_cap', 'colours', 'outline', 'symmetry') else max(
                bad, key=lambda k: {'foot_gap': measured[k]['facts']['foot_gap'], 'height_cap': measured[k]['facts']['rows'],
                                    'colours': measured[k]['facts']['colours'], 'outline': 1 - measured[k]['facts']['outline_share'],
                                    'symmetry': measured[k]['facts']['mirror']}[rule])
            worst = f'{key.split("/")[-1][:34]}: {measured[key]["problems"][rule][0]}'
        lines.append(f'{rule:<15}{",".join(CATEGORY_KINDS[rule]):<22}{len(scope):>9}{len(bad):>10}{base!s:>9}   {worst}')
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('command', choices=['report', 'check', 'baseline', 'ranking', 'pieces', 'pieces-agreement', 'kind-suspects', 'review-seed', 'review'])
    parser.add_argument('dist')
    parser.add_argument('--write', action='store_true', help='write the file under hq-office/contract/ instead of printing it')
    parser.add_argument('--data-dir', help='read and write this directory instead of hq-office/contract/')
    parser.add_argument('--verdicts', help='review-seed: the audit verdicts.json')
    args = parser.parse_args(argv)
    data_dir = args.data_dir
    pieces, review = load_json('pieces.json', data_dir), load_json('review.json', data_dir)
    if args.command == 'report':
        print(report_table(measure(args.dist, pieces), load_json('baseline.json', data_dir)))
    elif args.command == 'check':
        results = check(args.dist, data_dir=data_dir)
        for r in results:
            print(f'{r.status:<9} {r.name}  {r.detail}')
            if r.status == FAIL:
                for line in r.lines[:8]:
                    print(f'          {line}')
        return 1 if any(r.status == FAIL for r in results) else 0
    elif args.command == 'pieces-agreement':
        print(dump_json(pieces_agreement((pieces or {}).get('casters') or {}, prefabs_of(args.dist))), end='')
    elif args.command == 'kind-suspects':
        print(dump_json(kind_suspects(args.dist)), end='')
    elif args.command == 'review':
        status = review_status(review, measure(args.dist, pieces))
        print(json.dumps({k: (len(v), v[:5]) for k, v in status.items()}, indent=1))
    else:
        if args.command == 'baseline':
            name, document = 'baseline.json', make_baseline(measure(args.dist, pieces))
        elif args.command == 'ranking':
            name, document = 'ranking.json', ranking_document(args.dist, review)
        elif args.command == 'pieces':
            name, document = 'pieces.json', derive_pieces(args.dist, review, pieces)
        else:
            if not args.verdicts:
                parser.error('review-seed needs --verdicts FILE')
            name, document = 'review.json', seed_review(args.dist, json.loads(Path(args.verdicts).read_text()), previous=review)
        if args.write:
            print(f'wrote {write_json(name, document, data_dir)}')
        else:
            print(dump_json(document), end='')
    return 0


if __name__ == '__main__':
    sys.exit(main())
