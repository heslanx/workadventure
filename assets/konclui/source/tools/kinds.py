"""What a placed piece IS to the lighting: one of four kinds, and whether its picture already carries its own contact shadow.

  stand   a piece that stands on the floor (chair, table, plant, lamp): casts a shadow on the floor, gets relief
  top     a piece that sits on another piece (the "(sobre móvel)" prefabs): casts nothing on the floor, gets relief
  hang    a piece on a wall or hanging (frame, clock, TV, pendant, wall panel): casts nothing on the floor, gets relief
  floor   a piece that lies on the floor (rug, mat, carpet, floor decal): gets NO relief and casts nothing

The rule is one function, `classify`, written once here and read by hq-office/fx.py (the manifest's "kinds"), tools/normals.py
(a floor piece is left out of fx/normal.png: a rug has no relief) and tools/verify.py (it re-derives the kinds and compares
them with the manifest). The runtime lane ports the same order to play/src/front/Konclui/Ambience/domain/casterKind.ts and both
sides run the same fixture (`fx.py --dump-kinds`). The order matters, first match wins:

  1. floor  the tag "Tapetes e pisos", or depthOffset <= -100 (a rug sorts under everything: lounge.py gives its rugs
            -(height + 96)), or a "/floors/" folder
  2. top    the name contains "(sobre móvel)"
  3. hang   the tag "Decoração de parede", or a folder in walldecor, walls or doors, or a WHOLE-WORD match of HANG_WORDS
  4. top    a WHOLE-WORD match of TOP_WORDS in the name: a computer on a desk is on the desk whether or not the editor's
            name says "(sobre móvel)" ("Computador iMac" stood on the reception desk, its shadow fell on the desk's own front
            and nothing showed on the desk top: the review of 2026-11-23)
  5. floor  a WHOLE-WORD match of FLOOR_WORDS in the name
  6. stand  everything else

Words are matched as whole words, `(?<!\\w)word(?!\\w)`, never as substrings: the old FLAT pattern of fx.py had an unanchored
`tela` that matched "Costela-de-adão". The tag "Tecnologia e telas" is not used (a TV on a stand stands); the computers are told by their names. The plural "painéis"
is listed beside "painel": a whole-word match does not see it, and the catalogue has "Painéis acústicos hexagonais".

`painted_shadow` is the second decision: does the picture draw its own soft shadow on the floor (so the runtime must not draw a
contact shadow over it)? At least PAINTED_MIN_PX DARK pixels (every channel under PAINTED_DARK_BELOW: lounge.py's shadows are
(10, 10, 61) and (60, 40, 40)) with 0 < alpha < SOLID_ALPHA (200) in the bottom quarter of the silhouette's rows or below it. The darkness test
is this lane's addition to the plan's rule: without it a lamp's baked pool of LIGHT (partial alpha, warm and bright, under the
shade) counted as a shadow and the arc lamp and the nightstands lost their contact band for no reason. Pure numpy, no tool, no
file: the runtime repeats it on the loaded picture of a piece the editor added.
"""
import json
import re
from pathlib import Path

import numpy as np

KINDS = ('stand', 'top', 'hang', 'floor')

FLOOR_TAGS = ('Tapetes e pisos',)
FLOOR_DEPTH = -100                       # depthOffset at or under this: the piece sorts under everything, a floor piece
FLOOR_FOLDERS = ('/floors/',)
TOP_MARK = '(sobre móvel)'
HANG_TAGS = ('Decoração de parede',)
HANG_FOLDERS = ('/walldecor/', '/walls/', '/doors/')
HANG_WORDS = ('quadro', 'pôster', 'poster', 'relógio', 'clock', 'painel', 'painéis', 'janela', 'cortina', 'espelho',
              'letreiro', 'prateleira flutuante', 'pendente', 'placa', 'tv', 'luminária de parede', 'vaso de parede')
TOP_WORDS = ('imac', 'notebook', 'laptop', 'macbook')
FLOOR_WORDS = ('tapete', 'carpete', 'capacho', 'piso', 'mancha', 'grama', 'rug', 'carpet')

PAINTED_MIN_PX = 6                       # partial-alpha pixels that make a picture "painted"
SOLID_ALPHA = 200                        # a pixel is the piece from this alpha (the runtime's SOLID_ALPHA): the art is 0 or 255,
                                         # its layers are not (a painted shadow 128 to 166, a lamp's baked pool of light 130 to
                                         # 155): at 128 the pool of a bedside table was part of it and its shadow floated
PAINTED_ALPHA_BELOW = SOLID_ALPHA        # partial: 0 < alpha < SOLID_ALPHA
PAINTED_DARK_BELOW = 128                 # a shadow pixel: every colour channel under this (a pool of light is bright)
PAINTED_BOTTOM = 0.25                    # the bottom quarter of the silhouette's rows, and anything below its foot


def _words(words):
    return re.compile('|'.join(rf'(?<!\w){re.escape(w)}(?!\w)' for w in words), re.IGNORECASE)


HANG_RE = _words(HANG_WORDS)
TOP_RE = _words(TOP_WORDS)
FLOOR_RE = _words(FLOOR_WORDS)


def classify(name, tags=(), depth_offset=0, path=''):
    """'stand', 'top', 'hang' or 'floor' for a prefab: its editor name, its tags, its depthOffset and its picture's path
    (the manifest key `<collection folder>/<imagePath>` or just the imagePath: only folder names are read from it)."""
    name = name or ''
    tags = tuple(tags or ())
    folder = '/' + (path or '')
    if any(t in FLOOR_TAGS for t in tags) or (depth_offset or 0) <= FLOOR_DEPTH or any(f in folder for f in FLOOR_FOLDERS):
        return 'floor'
    if TOP_MARK in name:
        return 'top'
    if any(t in HANG_TAGS for t in tags) or any(f in folder for f in HANG_FOLDERS) or HANG_RE.search(name):
        return 'hang'
    if TOP_RE.search(name):
        return 'top'
    if FLOOR_RE.search(name):
        return 'floor'
    return 'stand'


# What a piece's relief is made of (tools/normals.py reads it, and the lab's relief pictures decided the numbers). The first
# lab pictures, with every big piece domed by a 20 px radius, folded a desk top into four triangles and gave a framed picture
# an X, and a lit lamp's shade went dull: a table, a counter, a shelf, a picture and a screen are flat slabs with an edge, and a
# lamp is the light and takes none. Only soft furnishings keep the dome, so a sofa still has a lit face and a turned one.
SOFT_TAGS = ('Plantas', 'Exterior e jardim', 'Sofás e poltronas', 'Cadeiras e bancos')
LAMP_LIGHTS = ('arc', 'floor', 'desk')                  # the manifest's light kinds of a lamp: it is the light, it takes none
RELIEF_PROFILES = ('none', 'flat', 'bevel', 'domed')


def relief_profile(kind, tags=(), light_kind=None):
    """'none' for a floor piece (no normal at all), 'flat' for a lamp (a flat normal: it is lit, it does not shade), 'domed' for
    a stand piece with a soft-furnishing tag (the dome of its size class), else 'bevel' (flat inside, a 4 px bevel at the edge)."""
    if kind == 'floor':
        return 'none'
    if light_kind in LAMP_LIGHTS:
        return 'flat'
    if kind == 'stand' and any(t in SOFT_TAGS for t in (tags or ())):
        return 'domed'
    return 'bevel'


def placed_entries(dist):
    """{'<collection folder>/<image path>': [prefab entry, ...]} of the objects the built map (DIST/office.wam) places, in key
    order, every distinct (name, tags, depthOffset) once: several prefabs may share a picture (a mug on different tables at
    different depths). Stdlib only: fx.py writes the manifest from it and verify.py re-derives the kinds from it."""
    dist = Path(dist)
    wam = json.loads((dist / 'office.wam').read_text())
    prefabs = {}
    for path in sorted((dist / 'entities').glob('*/collection.json')):
        doc = json.loads(path.read_text())
        for entry in doc.get('collection', []):
            prefabs[(doc.get('collectionName'), entry.get('id'))] = (f"{path.parent.name}/{entry.get('imagePath')}", entry)
    out = {}
    mark = lambda v: (v.get('name'), tuple(v.get('tags', [])), v.get('depthOffset', 0))
    for e in wam['entities'].values():
        hit = prefabs.get((e['prefabRef']['collectionName'], e['prefabRef']['id']))
        if not hit:
            continue
        seen = out.setdefault(hit[0], [])
        if all(mark(v) != mark(hit[1]) for v in seen):
            seen.append(hit[1])
    return {k: out[k] for k in sorted(out)}


def entry_kind(key, entry):
    """The kind of one prefab entry of `placed_entries` (key: its picture's manifest key)."""
    return classify(entry.get('name'), entry.get('tags', []), entry.get('depthOffset', 0), key)


def kinds_of(dist):
    """{key: kind} of every placed sprite, in key order. A picture shared by prefabs that classify differently is an error
    (ValueError): the kind belongs to the picture, it decides what normal.png stamps and what the runtime shadows."""
    out = {}
    for key, entries in placed_entries(dist).items():
        found = {entry_kind(key, e) for e in entries}
        if len(found) > 1:
            raise ValueError(f'{key}: the prefabs {[e.get("name") for e in entries]} share a picture but are '
                             f'{sorted(found)}: one picture, one kind')
        out[key] = found.pop()
    return out


def silhouette_rows(alpha):
    """(top, foot) rows of the silhouette (alpha >= SOLID_ALPHA: what the runtime casts a shadow from), or None when there is none."""
    rows = np.nonzero((np.asarray(alpha) >= SOLID_ALPHA).any(axis=1))[0]
    return (int(rows[0]), int(rows[-1])) if len(rows) else None


def painted_shadow(rgba):
    """True when the picture carries its own soft shadow near its foot: PAINTED_MIN_PX or more dark pixels (every channel under
    PAINTED_DARK_BELOW) with 0 < alpha < PAINTED_ALPHA_BELOW in the last ceil(PAINTED_BOTTOM * height) rows of the silhouette
    (top to foot, alpha >= SOLID_ALPHA) or in any row below the foot. A picture with no solid pixel is not painted."""
    pixels = np.asarray(rgba)
    alpha = pixels[..., 3]
    rows = silhouette_rows(alpha)
    if rows is None:
        return False
    top, foot = rows
    height = foot - top + 1
    first = foot - int(np.ceil(height * PAINTED_BOTTOM)) + 1
    band, colour = alpha[first:], pixels[first:, :, :3]
    shadow = (band > 0) & (band < PAINTED_ALPHA_BELOW) & (colour.max(axis=-1) < PAINTED_DARK_BELOW)
    return int(shadow.sum()) >= PAINTED_MIN_PX


def manifest_problems(manifest):
    """[problem] of the manifest's "kinds" and "painted" entries against their contract; [] when they conform, and when
    the manifest has neither (an older build: the runtime classifies by prefab and treats `painted` as empty)."""
    kinds, painted = manifest.get('kinds'), manifest.get('painted')
    problems = []
    if kinds is None and painted is None:
        return problems
    if not isinstance(kinds, dict):
        return ['"kinds" is missing or not an object' + (' but "painted" is present' if painted is not None else '')]
    bad = {k: v for k, v in kinds.items() if v not in KINDS}
    if bad:
        problems.append(f'{len(bad)} kinds outside {KINDS}, first {next(iter(bad))!r}: {bad[next(iter(bad))]!r}')
    if painted is not None:
        if not isinstance(painted, list) or not all(isinstance(k, str) for k in painted):
            problems.append('"painted" is not a list of strings')
        else:
            if len(set(painted)) != len(painted):
                problems.append('"painted" lists a key twice')
            off = [k for k in painted if kinds.get(k) not in ('stand', 'top')]
            if off:
                problems.append(f'{len(off)} painted keys are not stand or top pieces, first {off[0]!r} '
                                f'(kind {kinds.get(off[0])!r})')
    return problems
