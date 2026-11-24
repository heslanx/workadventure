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
RELIEF_PROFILES = ('none', 'flat', 'bevel', 'box', 'domed')

# Relief only where a surface curves (audit rule R12). A soft-furnishing TAG says what a piece is usually made of, not what this
# picture is: the white planter "Floreira branca" is tagged Plantas and is a box with reeds on it, and a dome across its face lit
# as a bright and a dark wedge. The picture says it: a box has a face painted in one colour, as a rectangle, and that rectangle is
# a large share of the piece; a sofa's cushions, a chair, a tree and a bean bag have none (MEASURED on the build of HEAD: the planter
# 1008 px, 56 x 18, 51% of its opaque pixels; the next soft piece is a sofa's cushion strip at 25% and 539 px, 77 x 7).
FACE_TOL = 6                                            # a pixel is in a face's colour when every channel is within this
BOX_MIN_AREA = 800                                      # px of the largest one-colour rectangle ...
BOX_MIN_SIDE = 12                                       # ... its shorter side ...
BOX_MIN_SHARE = 0.40                                    # ... and its share of the piece's opaque pixels
BOX_WORDS = ('floreira', 'jardineira', 'caixote', 'cubo')   # a name that says a box lowers the bar (below) but never replaces the picture
BOX_NAME_MIN_AREA = 300
BOX_NAME_MIN_SHARE = 0.25
BODY_MIN_WIDTH = 0.8                                    # a row belongs to a box's body while it is this share of the face's width


def _largest_rectangle(mask):
    """(area, x, y, w, h) of the largest axis-aligned rectangle of True in a boolean mask (the histogram-stack method)."""
    height, width = mask.shape
    heights = np.zeros(width, int)
    best = (0, 0, 0, 0, 0)
    for y in range(height):
        heights = np.where(mask[y], heights + 1, 0)
        stack = []
        for x in range(width + 1):
            current = int(heights[x]) if x < width else 0
            start = x
            while stack and stack[-1][1] >= current:
                at, top = stack.pop()
                if top * (x - at) > best[0]:
                    best = (top * (x - at), at, y - top + 1, x - at, top)
                start = at
            stack.append((start, current))
    return best


def flat_face(rgba, tol=FACE_TOL):
    """The largest rectangle of one colour in a picture's fully opaque pixels: (area, x, y, w, h), (0, 0, 0, 0, 0) when there is none.
    Only the 12 commonest colours are tried, and only those that have the pixels for it, so it costs a few ms per sprite."""
    rgba = np.asarray(rgba)
    solid = rgba[..., 3] == 255
    if not solid.any():
        return (0, 0, 0, 0, 0)
    rgb = rgba[..., :3].astype(int)
    colours, counts = np.unique(rgb[solid], axis=0, return_counts=True)
    best = (0, 0, 0, 0, 0)
    for colour in colours[np.argsort(-counts, kind='stable')][:12]:
        match = solid & (np.abs(rgb - colour).max(axis=-1) <= tol)
        if match.sum() > best[0]:
            found = _largest_rectangle(match)
            if found[0] > best[0]:
                best = found
    return best


def box_body(rgba, face=None):
    """The boolean mask of a box's body: the opaque pixels of the rows around its flat face that are at least BODY_MIN_WIDTH of the face's
    width (a planter's rim, soil and face, without the reeds that stand on it), or None when the picture has no opaque pixel. Whether the
    picture IS a box is box_evidence's question; this finds the part of one that is."""
    rgba = np.asarray(rgba)
    face = face or flat_face(rgba)
    area, fx, fy, fw, fh = face
    solid = rgba[..., 3] == 255
    if not area:
        return None
    rows = solid.sum(axis=1) >= BODY_MIN_WIDTH * fw
    top, bottom = fy, fy + fh - 1
    while top > 0 and rows[top - 1]:
        top -= 1
    while bottom < len(rows) - 1 and rows[bottom + 1]:
        bottom += 1
    body = np.zeros_like(solid)
    body[top:bottom + 1] = solid[top:bottom + 1]
    return body


def box_evidence(rgba, name=''):
    """True when the picture is a box: its largest one-colour rectangle is BOX_MIN_AREA px, BOX_MIN_SIDE on its shorter side and
    BOX_MIN_SHARE of the opaque pixels; a name with a BOX_WORDS word asks only BOX_NAME_MIN_AREA and BOX_NAME_MIN_SHARE of it."""
    rgba = np.asarray(rgba)
    area, _, _, w, h = flat_face(rgba)
    share = area / max(int((rgba[..., 3] == 255).sum()), 1)
    if area >= BOX_MIN_AREA and min(w, h) >= BOX_MIN_SIDE and share >= BOX_MIN_SHARE:
        return True
    return bool(re.search('|'.join(rf'(?<!\w){w_}(?!\w)' for w_ in BOX_WORDS), name or '', re.IGNORECASE)) \
        and area >= BOX_NAME_MIN_AREA and min(w, h) >= BOX_MIN_SIDE and share >= BOX_NAME_MIN_SHARE


def relief_profile(kind, tags=(), light_kind=None, box=False):
    """'none' for a floor piece (no normal at all), 'flat' for a lamp (a flat normal: it is lit, it does not shade), 'box' for a stand
    piece with a soft-furnishing tag whose picture is a box (`box`, from box_evidence: a flat face with a bevel along its edge, and the
    dome only on what stands out of it, a planter's reeds), 'domed' for any other stand piece with a soft-furnishing tag (the dome of
    its size class), else 'bevel' (flat inside, a 4 px bevel at the edge)."""
    if kind == 'floor':
        return 'none'
    if light_kind in LAMP_LIGHTS:
        return 'flat'
    if kind == 'stand' and any(t in SOFT_TAGS for t in (tags or ())):
        return 'box' if box else 'domed'
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
