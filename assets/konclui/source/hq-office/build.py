"""Build the HQ office (plan.py) into a WorkAdventure 1.34.1 map.

python3 hq-office/build.py [--out DIR]       writes DIR (default hq-office/dist) and hq-office/renders/

dist/office.tmj        tile layers: floor (floors and the pool; only the fountain animates, 8 x 220 ms), decor (tufts
                       swaying in a breeze, clover, flowers and pebbles over the grass, lawn.py; glints and ripples on
                       the pool, pool.py), walls (thin walls and glass),
                       collisions (wall faces and water, whole tiles), thin-walls (edge walls, see below), floorLayer
dist/office.wam        2.1.0: furniture, decoration and trees as editor objects of the "Mobília" and "Koncluí"
                       collections; the arrival and the functional areas (rooms, booths, stage, cafe, lake...)
dist/entities/         mobilia/ (catalogue.py) and konclui/ (design-system recolours and signature pieces)
dist/seats.json        seat templates of both collections, rooms and collision, for the seating runtime
dist/scripts/          map script: automatic sitting (runtime/seating.mjs) and the koi overlays
dist/planta.webp       the map at 8 px per tile, for the HUD's people map; dist/hud.json its size in map pixels
dist/social.json       desks, lockable rooms and the ambient sources (file, ideal volume, rect, falloff)
dist/bell.json         the sales bell's area name, sound and quiet rects; dist/sounds/ and dist/pages/sale.html
dist/koi/              koi module (pool/koi/) and one scene per overlay (lake, canal): masks at map resolution
dist/build_report.json wall faces, doors, seats and rooms for map/validate_map.py
renders/preview.png    the whole map composited (frame 0); renders/build.json the summary

Thin walls (a wall on the edge between two tiles, both walkable). Each V wall of the plan stands on a
tile boundary (plan.vb) and is written to the tile layer "thin-walls" (opacity 0) as tiles of the embedded tileset
"ThinWalls" whose custom string property `wallEdges` lists the blocked edges of the tile (n, e, s, w). The local
gateway (local-wa/hot-reload/thin-walls.mjs) makes the engine's physics and pathfinder honour them; an engine
without that patch lets people through those lines. Wall faces stay whole blocked tiles.
"""
import argparse
import base64
import hashlib
import json
import re
import shutil
import sys
import uuid
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(REPO / 'office'))
sys.path.insert(0, str(REPO / 'map'))
sys.path.insert(0, str(HERE))
import catalogue as CAT  # noqa: E402
import flora_optics as FLORA_OPTICS  # noqa: E402
import fx as FX  # noqa: E402
import glass as GL  # noqa: E402
import lawn as LAWN  # noqa: E402
import palette as PL  # noqa: E402
import plan as P  # noqa: E402
import pool as POOL  # noqa: E402
import sheets as SHEETS  # noqa: E402
import signature as SIG  # noqa: E402
import taxonomy as TAX  # noqa: E402
from v7.paint import TileBank, slice_into  # noqa: E402
from validate_map import validate  # noqa: E402

T = 32
W, H = P.W, P.H
NS = 'konclui-hq-office/'
KCOLL = 'Koncluí'
LIVEKIT_PREFIX = 'konclui-sede-'      # never the main office's rooms: the two maps must not share a call
COPYRIGHT = [dict(name='tilesetCopyright', type='string',
                  value='Koncluí; arte de terceiros licenciada para uso interno (ver o repositório)')]
RUNTIME_OFFICE = ('seat-core.mjs',)
RUNTIME_HERE = ('wam.mjs', 'seating.mjs', 'seat-pick.mjs', 'interactions.mjs', 'social.mjs', 'hud-core.mjs', 'hud.mjs', 'page.mjs',
                'bell.mjs', 'pets.mjs')
BELL_AREA_NAME = 'Sino da venda'      # runtime/bell.mjs listens to the area by this name (bell.json)
MARKER = '.hq-office-build'
EDGE_BITS = {'n': 1, 'e': 2, 's': 4, 'w': 8}


def cushions(seat, f):
    """The piece's other sitting points (a couch's or bench's cushions) in `more`, as anchors like the seat's own: the
    catalogue lists every sitting cell and its importer keeps the middle one as the seat. The runtime makes each a seat
    (runtime/seat-pick.mjs withCushions)."""
    cells = sorted({tuple(p) for p in f['seats']}) if f else []
    if len(cells) < 2:
        return seat
    c, r = CAT.seat_cell(f['seats'])
    a = seat['anchorOffset']
    return dict(seat, more=[dict(x=a['x'] + (cx - c) * T, y=a['y'] + (cy - r) * T) for cx, cy in cells if (cx, cy) != (c, r)])


def uid(key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, NS + key))


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower().replace('í', 'i')).strip('-')


# ------------------------------------------------------------------------------------------------ pieces

CATALOG = CAT.catalog()
# Plants never block here (owner, 18/10/2026: their collisions got in the way of walking): pots, trees, bushes and
# plant stands lose their collision in this map's furniture collection, so plants placed in the editor walk
# through too. The main office's own collection is untouched.
PLANT_FAMILIES = {('RoomDecor', 'Room Plant'), ('RoomDecor', 'Desk Plant'), ('RoomDecor', 'Potted Flowers'),
                  ('RoomDecor', 'Fantasy Plant'), ('RoomDecor', 'Terrarium'), ('Nature', 'Tree'), ('Nature', 'Bush'),
                  ('Nature', 'Ground Plant'), ('Nature', 'Tall gound plant'), ('Table', 'Stand')}
PLANTS = {CAT.variant_id(f) for f in CATALOG['furniture'] if (f['category'], f['family']) in PLANT_FAMILIES}


def _walkable(prefab):
    return {k: v for k, v in prefab.items() if k != 'collisionGrid'} if prefab['id'] in PLANTS else prefab


TREES = {CAT.variant_id(f) for f in CATALOG['furniture'] if (f['category'], f['family']) == ('Nature', 'Tree')}
MOB = {p['id']: (_walkable(p), LAWN.ground_ring(img) if p['id'] in TREES else img, seat) for p, img, seat in CAT.pieces()}
KONCLUI = {}                             # prefab id -> (prefab, image, seat) of the "Koncluí" collection
# The sheets the owner brought (sheets.py): one collection each ("Escritório moderno", "Estantes e livros", "Plantas
# em vaso", "LPC"), every piece in the editor whether the plan places it or not. A seat piece sorts behind its sitter
# (as sit_between); a chair seen from behind is drawn in front of its sitter whole (its backrest), as the source does.
SHEET_COLLECTIONS = {}                   # collection name -> {prefab id: (prefab, image, seat)}
SHEET_BY_KEY = {}                        # (name, colour, direction) -> (collection, prefab id)
SHEET_FOLDERS = {'Escritório moderno': 'escritorio-moderno', 'Estantes e livros': 'estantes-e-livros',
                 'Plantas em vaso': 'plantas-em-vaso', 'LPC': 'lpc'}
for _p in SHEETS.pieces():
    _prefab = dict(id=_p['id'], name=_p['name'], tags=[_p['category']], imagePath=f"sprites/{_p['id']}.png",
                   direction=_p['direction'], color=_p['colour'])
    if _p['collisionGrid']:
        _prefab['collisionGrid'] = _p['collisionGrid']
    if _p['seat']:
        _prefab['depthOffset'] = _p['seat']['anchorOffset']['y'] - 1 - _p['image'].height
    elif _p['depthOffset']:
        _prefab['depthOffset'] = _p['depthOffset']
    SHEET_COLLECTIONS.setdefault(_p['collection'], {})[_p['id']] = (_prefab, _p['image'], _p['seat'])
    SHEET_BY_KEY[(_p['name'], _p['colour'], _p['direction'])] = (_p['collection'], _p['id'])

SEAT_SOURCE = {}                         # recoloured seat id -> its catalogue variant (sitting points)
DEFS = {}


def catalogue_variant(type_, colour, direction):
    for published in (True, False):
        for f in CATALOG['furniture']:
            if (f['type'], f['color'], f['orientation'], f['published']) == (type_, colour, direction, published):
                if CAT.variant_id(f) in MOB:
                    return f
    raise KeyError(f'no catalogue variant {type_!r} {colour} {direction}')


def image_box(f):
    """(x, y, w, h) of a variant's main picture inside its trimmed canvas (as the catalogue builds it)."""
    (w, h), (left, top) = f['size'], f['offset']
    marks = f['collision'] + f['seats']
    cols = max([-(-(left + w) // T)] + [c + 1 for c, _ in marks])
    rows = max([-(-(top + h) // T)] + [r + 1 for _, r in marks])
    canvas = Image.new('RGBA', (cols * T, rows * T))
    canvas.alpha_composite(CAT.image(f['main']), (left, top))
    if f['foreground']:
        canvas.alpha_composite(CAT.image(f['foreground']), (left, top))
    _, dx, dy = CAT.trim(canvas, marks)
    return left - dx * T, top - dy * T, w, h


# Seats as the source office seats a sitter (owner, 18/10/2026: "copiar do gather como ele faz pra sentar"; its office
# chair seen from behind shows only the top of the head over the backrest). Read from the source's own client and
# server: the sitter is centred on its sitting tile and its 64 px sitting frame is drawn from 48 px above that point,
# with the head at row 22 facing the viewer or sideways and at row 27 from behind (no legs); the piece's main picture
# sorts on its fold row and its front layer (backrest, armrest, seat front) on its own fold row, and whichever sorts
# below the sitter's point is drawn in front of it. Here the whole piece is drawn behind the sitter, the gateway's
# seated-pose patch draws `front` (what the source draws in front) right above it, and `pose.dy` puts the woka's hair
# (15 px above its position) where the source's head is.
SITTING_HEAD = {'down': 22, 'up': 27, 'left': 22, 'right': 22}    # head row of the source's sitting frames
WOKA_HEAD = 15
FRONT_FOLDS = {k: v for k, v in json.loads((HERE / 'sources/seat-front-folds.json').read_text()).items() if k != '_'}
FRONTS = {}                              # seat prefab id -> what is drawn in front of its sitter


def front_layer(img, seat, f):
    """The whole picture when its main fold sorts below the sitter's point, else the front layer's pixels when that
    layer's fold does, else None."""
    if not f:
        return None
    bx, by, _, h = image_box(f)
    sitter = seat['anchorOffset']['y'] + CAT.SEAT_LIFT                # the sitting tile's middle
    if f.get('fold') is not None and by + f['fold'] > sitter:
        return img
    if not f.get('foreground'):
        return None
    fold = FRONT_FOLDS.get(f['id'])
    if by + (h if fold is None else fold) <= sitter:
        return None
    mask = Image.new('L', img.size)
    mask.paste(CAT.image(f['foreground']).getchannel('A').point(lambda v: 255 if v else 0), (bx, by))
    front = Image.composite(img, Image.new('RGBA', img.size), mask)
    return front if front.getbbox() else None


def sit_between(pid, prefab, img, seat, f):
    """The piece behind its sitter: its depth line right above the anchor, as the importer already sets for every way
    but up. What the source draws in front of the sitter is kept as its front layer."""
    if not seat:
        return prefab
    front = front_layer(img, seat, f)
    if front is not None:
        FRONTS[pid] = front
    return dict(prefab, depthOffset=seat['anchorOffset']['y'] - 1 - img.height)


def seat_pose(pid, seat):
    """A seat template's sitting numbers: the woka's hair where the source's sitting head is, no legs from behind, and
    the front layer."""
    a = seat['anchorOffset']
    hair = a['y'] + CAT.SEAT_LIFT - 48 + SITTING_HEAD[seat['direction']]
    out = dict(seat, pose=dict(dy=hair + WOKA_HEAD - a['y'], crop=10 if seat['direction'] == 'up' else 0))
    if pid in FRONTS:
        out['front'] = f'seats/front/{pid}.png'
    return out


SOURCES = {CAT.variant_id(f): f for f in CATALOG['furniture']}
MOB = {pid: (sit_between(pid, p, img, seat, SOURCES.get(pid)), img, seat) for pid, (p, img, seat) in MOB.items()}


def resolve(type_, colour, direction):
    """dict(type, collection, id, prefab, image, seat, box, surface) of a plan piece."""
    key = (type_, colour, direction)
    if key in DEFS:
        return DEFS[key]
    if (type_, colour, direction) in SHEET_BY_KEY:
        coll, pid = SHEET_BY_KEY[(type_, colour, direction)]
        prefab, img, seat = SHEET_COLLECTIONS[coll][pid]
        bx0, by0, bx1, by1 = img.getbbox()               # the visible box: what stands on a surface is its bottom
        d = dict(collection=coll, id=pid, prefab=prefab, image=img, seat=seat, box=(bx0, by0, bx1 - bx0, by1 - by0),
                 surface=None)
    elif type_.startswith('Koncluí: '):
        sig = SIG.pieces()[type_][colour]
        pid = f'konclui-{slug(type_)}-{colour}'
        img = sig['image']
        swatch = TAX.colours({c: v['image'] for c, v in SIG.pieces()[type_].items()}, PL.INK)[colour]
        prefab = dict(id=pid, name=SIG.NAMES[type_], tags=[TAX.tag('konclui', type_)], imagePath=f'sprites/{pid}.png',
                      direction=direction, color=swatch)
        if sig.get('collisionGrid'):
            prefab['collisionGrid'] = sig['collisionGrid']
        if sig.get('depthOffset'):
            prefab['depthOffset'] = sig['depthOffset']
        seat = sig.get('seat')                           # a seat piece sorts behind its sitter, as the sheets' do
        if seat:
            prefab['depthOffset'] = seat['anchorOffset']['y'] - 1 - img.height
        KONCLUI[pid] = (prefab, img, seat)
        d = dict(collection=KCOLL, id=pid, prefab=prefab, image=img, seat=seat, box=(0, 0, img.width, img.height),
                 surface=sig.get('surface'))
    elif colour.startswith('ds-'):
        colours = sorted({f['color'] for f in CATALOG['furniture']
                          if f['type'] == type_ and f['orientation'] == direction and f['published']})
        base_colour = next(c for c in ('grey', 'white', 'black', *colours) if c in colours)
        base = catalogue_variant(type_, base_colour, direction)
        img, grid, depth, seat = PL.recolour(type_, direction, colour)
        pid = f'konclui-{slug(type_)}-{direction.lower()}-{colour}'
        name = MOB[CAT.variant_id(base)][0]['name']
        prefab = dict(id=pid, name=name + TAX.suffix('recolour'), tags=list(MOB[CAT.variant_id(base)][0]['tags']),
                      imagePath=f'sprites/{pid}.png', direction=direction, color=PL.FURNITURE_RAMPS[colour][1])
        if grid:
            prefab['collisionGrid'] = grid
        if depth:
            prefab['depthOffset'] = depth
        seat = dict(seat) if seat else None
        prefab = sit_between(pid, prefab, img, seat, base)
        KONCLUI[pid] = (prefab, img, seat)
        SEAT_SOURCE[pid] = base
        d = dict(collection=KCOLL, id=pid, prefab=prefab, image=img, seat=seat, box=image_box(base), surface=None)
    else:
        f = catalogue_variant(type_, colour, direction)
        pid = CAT.variant_id(f)
        prefab, img, seat = MOB[pid]
        d = dict(collection=CAT.COLLECTION, id=pid, prefab=prefab, image=img, seat=seat, box=image_box(f),
                 surface=None)
    d['type'] = type_
    DEFS[key] = d
    return d


# What the owner did in the map editor, kept across builds: plan key -> {x, y} in px, or {deleted: true}; under
# "_added" the objects the owner created there, as the WAM holds them (uuid -> entity); under "_areas" the areas the
# owner changed or created there, as the WAM holds them, or {deleted: true} (area id -> area) (README, "Edições no
# editor"; capture_edits.py writes all three from the served room).
_EDITOR = json.loads((HERE / 'editor-edits.json').read_text())
EDITS = {k: v for k, v in _EDITOR.items() if not k.startswith('_')}
EDITOR_ADDED = _EDITOR.get('_added', {})
EDITOR_AREAS = _EDITOR.get('_areas', {})


def place_pieces():
    """{key: (def, x, y)} in pixels: mirrors resolved, seats by their anchor, small pieces on their parent."""
    placed, pending = {}, []
    for piece in P.PIECES:
        if EDITS.get(piece['key'], {}).get('deleted'):    # the owner deleted it in the editor
            continue
        d = resolve(piece['type'], piece['colour'], piece['dir'])
        if 'on' in piece:
            pending.append((piece, d))
            continue
        if 'seat' in piece:
            assert d['seat'], f"{piece['key']}: {piece['type']} {piece['dir']} is not a seat"
            sx, sy = piece['seat']
            if piece.get('mirror_of'):
                sx = 2 * P.AXIS - sx
            a = d['seat']['anchorOffset']
            x, y = sx * T + T // 2 - a['x'], sy * T + T // 2 - CAT.SEAT_LIFT - a['y']
        else:
            x, y = piece['x'] * T + piece['px'], piece['y'] * T + piece['py']
            if piece.get('mirror_of'):
                x = (2 * P.AXIS + 1) * T - x - d['image'].width
        if piece['key'] in EDITS:                 # the owner's editor placement wins over the plan
            x, y = EDITS[piece['key']]['x'], EDITS[piece['key']]['y']
        placed[piece['key']] = (d, x, y)
    sort_line = lambda dd, yy: yy + dd['image'].height + dd['prefab'].get('depthOffset', 0)
    for piece, d in pending:
        pd, px, py = placed[piece['on']]
        bx, by, bw, bh = pd['box']
        surface = piece['s'] if piece['s'] is not None else (pd['surface'] or P.SURFACE[pd['type']])
        cbx, cby, cbw, cbh = d['box']
        x = round(px + bx + bw / 2 + piece['dx'] - cbw / 2 - cbx)
        y = round(py + by + surface - cbh - cby)
        d = on_surface(d, sort_line(pd, py) + 1 - (y + d['image'].height))
        if piece['key'] in EDITS:                 # moved in the editor: the same piece, where the owner left it
            x, y = EDITS[piece['key']]['x'], EDITS[piece['key']]['y']
        placed[piece['key']] = (d, x, y)
    return placed


def on_surface(d, depth):
    """A copy of a small piece drawn just after the piece it stands on (the catalogue draws a child over its parent; the
    engine only sorts by each picture's base line plus depthOffset), still before whoever sits at that desk. Every copy
    of a piece shares one picture: the engine keys its textures by imagePath, and each distinct texture in the map costs
    draw calls in every frame (16 to a batch)."""
    if depth == d['prefab'].get('depthOffset', 0):
        return d
    base = d['id'].replace('mob-', 'konclui-', 1) if d['collection'] != KCOLL else d['id']
    pid = f'{base}-on{-depth}'
    if pid not in KONCLUI:
        image = d['prefab']['imagePath'] if d['collection'] == KCOLL else f'sprites/{base}.png'
        prefab = dict(d['prefab'], id=pid, name=d['prefab']['name'] + TAX.suffix('supported'),
                      tags=list(d['prefab']['tags']), imagePath=image, depthOffset=depth)
        prefab.pop('collisionGrid', None)
        KONCLUI[pid] = (prefab, d['image'], None)
    return dict(d, collection=KCOLL, id=pid, prefab=KONCLUI[pid][0], seat=None)


# ------------------------------------------------------------------------------------------------ architecture

def h_face_cells():
    """Wall faces: two rows of whole blocked tiles from boundary to boundary, minus the door gaps."""
    cells = set()
    for row, a, b, _, _ in P.H_WALLS:
        cells |= {(x, y) for x in range(P.vb(a), P.vb(b)) for y in (row, row + 1)}
    for row, g, w in P.DOORS_H:
        cells -= {(x, y) for x in range(g, g + w) for y in (row, row + 1)}
    return cells


# Sunlight through the glass facades (the owner's sheet pattern-light.png, 18/10/2026: "o que faz com isso?"): white
# diagonal beams, on a layer above the avatars, aligned to the map so the beams run on across tiles; strongest at the
# glass and gone LIGHT_DEPTH tiles in. At the sheet's own strength (18 % at most) the beams vanish on the light oak, so
# they are LIGHT_GAIN times stronger and sun-warm. (x0, y0, x1, y1) inclusive tiles, glass side.
LIGHT = [((P.vb(19), P.BY0 + 2, P.vb(41) - 1, 16), 'n'), ((P.vb(45), P.BY0 + 2, P.vb(67) - 1, 16), 'n'),
         ((P.vb(P.BX0), P.BY1 - 4, P.vb(P.BX1) - 1, P.BY1 - 1), 's')]
LIGHT_DEPTH = {'n': 6, 's': 4}
LIGHT_GAIN, LIGHT_TINT = 5.0, (255, 246, 222)


def draw_light():
    pattern = np.asarray(Image.open(SHEETS.SRC / 'pattern-light.png').convert('RGBA')).astype(float)
    n = pattern.shape[0]
    canvas = np.zeros((H * T, W * T, 4))
    for (x0, y0, x1, y1), side in LIGHT:
        ys, xs = np.mgrid[y0 * T:(y1 + 1) * T, x0 * T:(x1 + 1) * T]
        into = (ys - y0 * T) if side == 'n' else ((y1 + 1) * T - 1 - ys)
        fade = np.clip(1 - into / (LIGHT_DEPTH[side] * T), 0, 1) ** 1.5
        px = pattern[ys % n, xs % n]
        px[..., :3] = LIGHT_TINT
        px[..., 3] = np.clip(px[..., 3] * LIGHT_GAIN * fade, 0, 255)
        region = canvas[y0 * T:(y1 + 1) * T, x0 * T:(x1 + 1) * T]
        np.maximum(region, px, out=region)
    return Image.fromarray(canvas.round().astype(np.uint8), 'RGBA')


def v_wall_rows(faces):
    """[(boundary, row, material)] of every drawn thin-wall segment: not across a face, not in a door gap."""
    doors = {(P.vb(c), r + i) for c, r in P.DOORS_V for i in (0, 1)}
    out = []
    for c, a, b, material in P.V_WALLS:
        bx = P.vb(c)
        for y in range(a, b + 1):
            if (bx, y) in doors or (bx, y) in faces or (bx - 1, y) in faces:
                continue
            out.append((bx, y, material))
    return out


def edges_of(vrows):
    """{tile: set of blocked edges} for the thin-walls layer."""
    edges = {}
    for bx, y, _ in vrows:
        if 0 <= bx - 1 < W:
            edges.setdefault((bx - 1, y), set()).add('e')
        if 0 <= bx < W:
            edges.setdefault((bx, y), set()).add('w')
    return edges


def paint(canvas, tile, x0, y0, x1, y1):
    """Fill the pixel rectangle [x0, x1) x [y0, y1) with a floor tile aligned to the map's 32 px grid."""
    x0, y0, x1, y1 = (int(max(0, v)) for v in (x0, y0, x1, y1))
    if x1 <= x0 or y1 <= y0:
        return
    tw, th = tile.size                   # 32 px catalogue tiles or 64 px patterns, aligned to their own grid
    gx0, gy0 = x0 // tw * tw, y0 // th * th
    block = Image.new('RGBA', (x1 - gx0 + tw, y1 - gy0 + th))
    for y in range(0, block.height, th):
        for x in range(0, block.width, tw):
            block.paste(tile, (x, y))
    canvas.paste(block.crop((x0 - gx0, y0 - gy0, x1 - gx0, y1 - gy0)), (x0, y0))


def floor_tile(kind):
    v = P.FLOORS[kind]
    if v == '@lawn':
        return LAWN.texture()
    if isinstance(v, str) and v.startswith('@'):
        return SIG.tile_pattern(v[1:])
    return PL.floor_tile(*(v if isinstance(v, tuple) else (v, None)))


def interior(l, t, r, b):
    return P.vb(l), t + 2, P.vb(r) - 1, b - 1


def draw_floors(kind_map=None):
    """The floor picture; with kind_map (an H*T x W*T array of '' strings) also the floor kind of each pixel."""
    canvas = Image.new('RGBA', (W * T, H * T))
    tile = {k: floor_tile(k) for k in P.FLOORS}

    def fill(kind, x0, y0, x1, y1):
        paint(canvas, tile[kind], x0, y0, x1, y1)
        if kind_map is not None:
            kind_map[int(max(0, y0)):int(max(0, y1)), int(max(0, x0)):int(max(0, x1))] = kind
    fill('lawn', 0, 0, W * T, H * T)
    fill('path', (P.AXIS - 1) * T, P.BY1 * T, (P.AXIS + 2) * T, H * T)
    LAWN.fringe(canvas, (P.AXIS - 1) * T, (P.BY1 + 2) * T, H * T, +1)
    LAWN.fringe(canvas, (P.AXIS + 2) * T, (P.BY1 + 2) * T, H * T, -1)
    fill('hall', P.vb(P.BX0) * T, P.BY0 * T + 4, P.vb(P.BX1) * T, (P.BY1 + 2) * T)
    kinds = {'auditorium': 'audience', 'meeting_01': 'meeting', 'meeting_02': 'meeting', 'cafe': 'cafe'}
    for key, (l, t, r, b) in P.ROOMS.items():
        fill(kinds.get(key, 'room'), P.vb(l) * T, t * T + 4, P.vb(r) * T, b * T + 4)
    for key, (x0, y0, x1, y1) in P.BOOTHS.items():
        top = key[-1] in '123'
        fill('booth', x0 * T, y0 * T if top else 24 * T + 4, (x1 + 1) * T, (y1 + 1) * T + 4 if top else (y1 + 1) * T)
    for kind, x0, y0, x1, y1 in P.ZONES:
        fill(kind, x0 * T, y0 * T, (x1 + 1) * T, (y1 + 1) * T)
    # Facade glass is seen through, so it shows the lawn outside, not the floor under its face (owner, 18/10/2026: "esse
    # vidro é transparente ou um espelho? ... por trás é a grama de fora"; 20/10/2026, of the south facade: "só os vidros
    # de cima ficaram transparentes"). The entrance's door, filled below, keeps the hall's floor.
    for row, a, b, _, material in P.H_WALLS:
        if row in (P.BY0, P.BY1) and material == 'glass':
            fill('lawn', P.vb(a) * T, row * T, P.vb(b) * T, (row + 2) * T)
    # and a room's glass seen from the corridor shows the room behind it, as its doors do (owner, 20/10/2026, of the team
    # rooms' glass: it read as a flat pale panel over the corridor's floor)
    for row, a, b, _, material in P.H_WALLS:
        if material != 'glass' or row in (P.BY0, P.BY1):
            continue
        for key, (l, t, r, bottom) in P.ROOMS.items():
            x0, x1 = max(P.vb(l), P.vb(a)), min(P.vb(r), P.vb(b))
            if bottom == row and x0 < x1:
                fill(kinds.get(key, 'room'), x0 * T, row * T, x1 * T, (row + 2) * T)
    for row, g, w in P.DOORS_H:            # a door in a face shows the floor of the room above it
        above = next((k for k, (l, t, r, b) in P.ROOMS.items() if b == row and P.vb(l) <= g and g + w <= P.vb(r)), None)
        kind = kinds.get(above, 'room') if above else 'hall'
        fill(kind, g * T, row * T, (g + w) * T, (row + 2) * T)
    return canvas


def draw_walls(vrows):
    canvas = Image.new('RGBA', (W * T, H * T))
    solid_strip, glass_strip = PL.wall_piece('w'), GL.strip()
    for bx, y, material in vrows:
        if material == 'glass':
            canvas.alpha_composite(glass_strip, (bx * T - 16, y * T))
        else:
            canvas.alpha_composite(solid_strip, (bx * T - 2, y * T))
    for row, a, b, kind, material in P.H_WALLS:
        left, right = P.vb(a) * T - 2, P.vb(b) * T + 2
        gaps = [(g * T - left, (g + w) * T - left) for drow, g, w in P.DOORS_H if drow == row and P.vb(a) < g < P.vb(b)]
        if material == 'feature':
            face = SIG.feature_wall(right - left)
        elif material == 'glass':
            face = GL.face(right - left, facade=row in (P.BY0, P.BY1), south=kind == 's')
            post = GL.post(top=0 if kind == 's' else 4)
            for g0, g1 in gaps:
                face.paste((0, 0, 0, 0), (g0, 0, g1, 2 * T))
                face.alpha_composite(post, (g0 - 4, 0))
                face.alpha_composite(post, (g1, 0))
            face.alpha_composite(post, (0, 0))
            face.alpha_composite(post, (face.width - 4, 0))
        else:
            face = Image.new('RGBA', (right - left, 2 * T))
            body, west, east = (PL.wall_piece(p) for p in (kind, kind + 'w', kind + 'e'))
            for x in [*range(0, face.width - T, T), face.width - T]:
                face.alpha_composite(body, (x, 0))
            face.alpha_composite(west, (0, 0))
            face.alpha_composite(east, (face.width - T, 0))
            for g0, g1 in gaps:
                face.paste((0, 0, 0, 0), (g0, 0, g1, 2 * T))
                face.alpha_composite(east, (g0 - T, 0))
                face.alpha_composite(west, (g1, 0))
        canvas.alpha_composite(face, (left, row * T))
    # A thin wall that stops on a face runs on down to it (owner, 20/10/2026: "a parede tá terminando errado aqui...
    # pelo menos juntar assim"): a face's frame starts a few pixels below its top row, so the wall's last row of pixels
    # is repeated down the transparent gap until it meets the face's first pixel.
    faces = h_face_cells()
    px = np.asarray(canvas).copy()
    for bx, y, _ in vrows:
        if (bx, y + 1) not in faces and (bx - 1, y + 1) not in faces:
            continue
        y0, xs = (y + 1) * T, slice(bx * T - 16, bx * T + 16)
        last = px[y0 - 1, xs].copy()
        for yy in range(y0, y0 + T):
            if px[yy, bx * T - 1, 3] or px[yy, bx * T, 3]:
                break
            gap = (last[:, 3] > 0) & (px[yy, xs, 3] == 0)
            px[yy, xs][gap] = last[gap]
    return Image.fromarray(px, 'RGBA')


# ------------------------------------------------------------------------------------------------ checks

def on_bank(placed, pool, inward=6):
    """The ground plants around the pool (plan.POOL_PLANTS) planted on the bank (owner, 18/10/2026: "essas plantinhas
    sem vaso estão esquisitas... talvez por cima da borda"): each moves so the foot of its picture stands on the
    nearest point of the bank's outer edge, `inward` px into the green. A plant the owner moved in the editor goes to
    the point of the bank nearest to where the owner left it (those drags had left four of them on the floor)."""
    ex, ey = pool.bank_edge
    for key, (d, x, y) in list(placed.items()):
        if not key.startswith('pool/'):
            continue
        bx, by, bw, bh = d['box']
        foot = np.array([x + bx + bw / 2, y + by + bh])
        k = int(np.argmin((ex - foot[0]) ** 2 + (ey - foot[1]) ** 2))
        target = np.array([ex[k], ey[k]], float)
        step = target - foot
        n = np.hypot(*step)
        if n:
            target += step / n * inward
        placed[key] = (d, int(round(x + target[0] - foot[0])), int(round(y + target[1] - foot[1])))


def collision_of(placed, blocked_cells):
    blocked = np.zeros((H, W), bool)
    for x, y in blocked_cells:
        blocked[y, x] = True
    owner = {}
    for key, (d, x, y) in placed.items():
        for r, row in enumerate(d['prefab'].get('collisionGrid') or []):
            for c, solid in enumerate(row):
                if not solid:
                    continue
                assert x % T == 0 and y % T == 0, f'{key}: a colliding object must sit on the 32 px grid'
                tx, ty = x // T + c, y // T + r
                assert 0 <= tx < W and 0 <= ty < H, f'{key}: collision outside the map'
                assert (tx, ty) not in blocked_cells, f'{key}: collision on a wall or the pool at {(tx, ty)}'
                assert (tx, ty) not in owner, f'{key}: collision on {owner.get((tx, ty))} at {(tx, ty)}'
                owner[(tx, ty)] = key
                blocked[ty, tx] = True
    return blocked


def reach_from(start, blocked, edges):
    def crossing(a, b):
        (ax, ay), (bx, by) = a, b
        if bx == ax + 1:
            return 'e' in edges.get(a, ()) or 'w' in edges.get(b, ())
        if bx == ax - 1:
            return 'w' in edges.get(a, ()) or 'e' in edges.get(b, ())
        if by == ay + 1:
            return 's' in edges.get(a, ()) or 'n' in edges.get(b, ())
        return 'n' in edges.get(a, ()) or 's' in edges.get(b, ())
    seen, q = {start}, deque([start])
    while q:
        x, y = q.popleft()
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= n[0] < W and 0 <= n[1] < H and not blocked[n[1], n[0]] and n not in seen \
                    and not crossing((x, y), n):
                seen.add(n)
                q.append(n)
    return seen


def seats_of(placed):
    out = []
    for key, (d, x, y) in placed.items():
        if d['seat']:
            a = d['seat']['anchorOffset']
            out.append((key, ((x + a['x']) // T, (y + a['y'] + CAT.SEAT_LIFT) // T)))
    return out


# ------------------------------------------------------------------------------------------------ areas

def rect_px(x0, y0, x1, y1):
    return dict(x=x0 * T, y=y0 * T, width=(x1 - x0 + 1) * T, height=(y1 - y0 + 1) * T)


def prop(key, kind, **values):
    return dict(id=uid(f'area/{key}/{kind}'), type=kind, **values)


def area(key, name, rect, description, props=()):
    return dict(id=uid(f'area/{key}'), name=name, **rect, visible=True,
                properties=[*props, prop(key, 'areaDescriptionProperties', description=description, searchable=True)])


def meeting(key):
    return prop(key, 'livekitRoomProperty', roomName=LIVEKIT_PREFIX + key,
                livekitRoomConfig=dict(startWithAudioMuted=True, startWithVideoMuted=True, disableChat=False,
                                       raiseHandEnabled=True))


def capacity(key):
    """Room capacity: nobody enters a full room."""
    return prop(key, 'maxUsersInAreaPropertyData', maxUsers=P.CAPACITY[key])


def build_areas():
    """The main office's functional areas (office/communication.py), on this plan and with this map's own calls."""
    out = []
    names = {**{f'room_0{n}': f'Sala 0{n}' for n in range(1, 5)}, 'meeting_01': 'Reunião 01', 'meeting_02': 'Reunião 02'}
    for key, name in names.items():
        out.append(area(key, name, rect_px(*interior(*P.ROOMS[key])),
                        'Conversa separada das outras salas. Ative câmera e microfone quando desejar.',
                        [meeting(key), capacity(key)]))
    for key, box in P.BOOTHS.items():
        out.append(area(key, f'Cabine de foco {key[-2:].upper()}', rect_px(*box),
                        'Área silenciosa para uma pessoa: sem conversas por proximidade.',
                        [prop(key, 'silent'), capacity(key)]))
    x0, y0, x1, y1 = interior(*P.ROOMS['auditorium'])
    stage_key = 'auditorium-stage'
    out.append(area(stage_key, 'Palco', rect_px(x0, y0, x1, y0 + P.STAGE_ROWS - 1),
                    'Área de apresentação para a plateia.',
                    [prop(stage_key, 'speakerMegaphone', name='Palco Koncluí', chatEnabled=True, seeAttendees=True)]))
    out.append(area('auditorium-audience', 'Plateia', rect_px(x0, y0 + P.STAGE_ROWS, x1, y1),
                    'Ouça a apresentação e levante a mão para participar.',
                    [prop('auditorium-audience', 'listenerMegaphone', speakerZoneName=uid(f'area/{stage_key}'),
                          chatEnabled=True, allowTalking=False, raiseHandEnabled=True)]))
    out.append(area('cafe', 'Café e convivência', rect_px(*interior(*P.ROOMS['cafe'])),
                    'Copa, mesas e espaço de convivência da equipe.', [meeting('cafe')]))
    common = {'commercial_west': ('Estações de trabalho — oeste', 'Postos de trabalho e conversas por proximidade.'),
              'commercial_east': ('Estações de trabalho — leste', 'Postos de trabalho e conversas por proximidade.'),
              'entry_plaza': ('Recepção', 'Entrada do escritório e acesso aos espaços da equipe.'),
              'lake': ('Lago das carpas', 'Canal da fonte da Koru e lago com o K. Clique na água para alimentar.')}
    for key, (name, description) in common.items():
        out.append(area(key, name, rect_px(*P.HALL_AREAS[key]), description))
    out.append(area('sales-bell', BELL_AREA_NAME, rect_px(*P.BELL_AREA),
                    'Fechou uma venda? Aperte ESPAÇO aqui para tocar o sino para todo o escritório.'))
    return out


def seat_rooms():
    rooms = []
    for key, (x0, y0, x1, y1) in P.BOOTHS.items():
        y0, y1 = (y0 - 1, y1) if key[-1] in '123' else (y0, y1 + 1)
        rooms.append(dict(id=key, **rect_px(x0, y0, x1, y1), silentRadius=0))
    for key, box in P.ROOMS.items():
        rooms.append(dict(id=key, **rect_px(*interior(*box)), silentRadius=0))
    rooms.append(dict(id='hall', **rect_px(P.vb(19), 19, P.vb(67) - 1, P.BY1 - 1), silentRadius=0))
    rooms.append(dict(id='outside', **rect_px(0, 0, W - 1, H - 1), silentRadius=0))
    return rooms


# ------------------------------------------------------------------------------------------------ build

def write_collection(dist, name, prefabs, folder):
    out = dist / 'entities' / folder
    if out.exists():
        shutil.rmtree(out)
    written = {}
    for prefab, img, _ in prefabs.values():
        path = out / prefab['imagePath']
        if path in written:                  # a shared picture (on_surface): the engine would show only one of them
            assert written[path].tobytes() == img.tobytes(), f"{prefab['id']}: another picture at {prefab['imagePath']}"
            continue
        written[path] = img
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
    doc = dict(collectionName=name, tags=[], version='1.0', collection=[p for p, _, _ in prefabs.values()])
    (out / 'collection.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    return f'entities/{folder}/collection.json'


def whiteboard_link(key, namespace=NS):
    digest = hashlib.sha256((namespace + key).encode()).digest()
    room = digest[:10].hex()
    secret = base64.urlsafe_b64encode(digest[10:26]).decode().rstrip('=')
    return f'https://excalidraw.com/#room={room},{secret}'


def main(out, render_out=None, whiteboard_namespace=NS):
    dist = Path(out) if out else HERE / 'dist'
    renders = Path(render_out) if render_out else HERE / 'renders'
    if dist.exists():                    # replace only an earlier output of this script (finished or not)
        assert (dist / MARKER).exists() or not any(dist.iterdir()), f'{dist} is not an earlier build; not replacing it'
        shutil.rmtree(dist)
    for d in (dist / 'tilesets', dist / 'scripts/runtime', dist / 'koi', renders):
        d.mkdir(parents=True, exist_ok=True)
    (dist / MARKER).write_text('hq-office/build.py output; safe to replace\n')

    faces = h_face_cells()
    vrows = v_wall_rows(faces)
    edges = edges_of(vrows)
    problems = FLORA_OPTICS.check()                   # one stroke weight and optical size for the bank's sprites
    assert not problems, 'flora: ' + '; '.join(problems)
    pool = POOL.build(P)
    kind_map = np.full((H * T, W * T), '', dtype=object)
    floors, wall_art = draw_floors(kind_map), draw_walls(vrows)
    # Koru stands in front of the facade: the walls layer gets a hole where the statue is opaque.
    rx, ry = pool.region
    hole = np.asarray(pool.statue)[..., 3] > 0
    wa = np.asarray(wall_art).copy()
    wa[ry:ry + hole.shape[0], rx:rx + hole.shape[1]][hole] = 0
    wall_art = Image.fromarray(wa, 'RGBA')
    frames = []
    for f in pool.frames:
        fr = floors.copy()
        fr.alpha_composite(f, (rx, ry))
        frames.append(fr)

    placed = place_pieces()
    on_bank(placed, pool)
    blocked_cells = faces | pool.blocked
    blocked = collision_of(placed, blocked_cells)
    start = P.START
    assert not blocked[start[1], start[0]], 'the arrival tile must be free'
    reach = reach_from(start, blocked, edges)
    seats = seats_of(placed)
    problems = [f'{k}: chair tile {c} blocked or unreachable' for k, c in seats if c not in reach]
    covered = set()                       # tiles under a solid object's picture (a desk's front, a fridge's top)
    for key, (d, x, y) in placed.items():
        if d['prefab'].get('collisionGrid'):
            img = d['image']
            covered |= {(tx, ty) for tx in range(x // T, (x + img.width) // T)
                        for ty in range(y // T, (y + img.height) // T)}
    for key, box in {**{k: interior(*v) for k, v in P.ROOMS.items()}, **P.BOOTHS}.items():
        x0, y0, x1, y1 = box
        free = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1) if not blocked[y, x]]
        lost = [c for c in free if c not in reach and c not in covered]
        if len(lost) * 4 > len(free):
            problems.append(f'{key}: {len(lost)} of {len(free)} free tiles cut off, e.g. {lost[:3]}')
        elif lost:
            print(f'note: {key}: {len(lost)} free tiles nobody reaches (behind furniture): {lost[:4]}')
    assert not problems, '\n'.join(problems)

    # Tiles
    sets, layers = [], []
    Image.new('RGBA', (T, T)).save(dist / 'tilesets/Collision.png')
    sets.append(dict(firstgid=1, name='Collision', image='tilesets/Collision.png', imagewidth=T, imageheight=T,
                     columns=1, tilewidth=T, tileheight=T, tilecount=1,
                     tiles=[dict(id=0, properties=[dict(name='collides', type='bool', value=True)])],
                     properties=COPYRIGHT))
    gid = 2

    def tile_layer(name, data, opacity=1):
        return dict(id=len(layers) + 1, name=name, type='tilelayer', width=W, height=H, x=0, y=0, opacity=opacity,
                    visible=True, data=data)

    def add_bank(bank):
        nonlocal gid
        sheet = bank.image()
        sheet.save(dist / f'tilesets/{bank.name}.png', optimize=True)
        entry = dict(firstgid=gid, name=bank.name, image=f'tilesets/{bank.name}.png', imagewidth=sheet.width,
                     imageheight=sheet.height, columns=bank.cols, tilewidth=T, tileheight=T,
                     tilecount=bank.cols * (sheet.height // T), properties=COPYRIGHT)
        if bank.animations:
            entry['tiles'] = bank.tiled_tiles()
        sets.append(entry)
        first = gid
        gid += entry['tilecount']
        return first

    ground = TileBank('Konclui_Floor')
    ids, animated = [], 0
    for ty in range(H):
        for tx in range(W):
            cells = [f.crop((tx * T, ty * T, tx * T + T, ty * T + T)) for f in frames]
            if all(c.tobytes() == cells[0].tobytes() for c in cells[1:]):
                ids.append(ground.add(cells[0]))
            else:
                ids.append(ground.animate(cells, POOL.FRAME_MS))
                animated += 1
    first = add_bank(ground)
    layers.append(tile_layer('floor', [0 if i < 0 else first + i for i in ids]))
    # The lawn's decor, on the cells nothing else is painted over (not the path, the building or its walls).
    grass = floor_tile('lawn')
    n = grass.width // T
    lawn_cells = [(tx, ty) for ty in range(H) for tx in range(W)
                  if floors.crop((tx * T, ty * T, tx * T + T, ty * T + T)).tobytes()
                  == grass.crop((tx % n * T, ty % n * T, tx % n * T + T, ty % n * T + T)).tobytes()]
    lawn_decor = LAWN.decor(lawn_cells)
    water_decor = POOL.water_decor(pool.surface)
    assert not any(f[0].getbbox() for f in water_decor.values()), 'water decor: frame 0 (animations off) must be empty'
    decor = {**lawn_decor, **water_decor}
    decor_bank, decor_ids = TileBank('Konclui_Decor'), [-1] * (W * H)
    for (tx, ty), cell in decor.items():
        decor_ids[ty * W + tx] = decor_bank.add(cell[0]) if len(cell) == 1 else decor_bank.animate(cell, LAWN.FRAME_MS)
    first = add_bank(decor_bank)
    layers.append(tile_layer('decor', [0 if i < 0 else first + i for i in decor_ids]))
    walls_bank = TileBank('Konclui_Walls')
    wall_ids = slice_into(wall_art, walls_bank, W, H)
    first = add_bank(walls_bank)
    layers.append(tile_layer('walls', [0 if i < 0 else first + i for i in wall_ids]))
    # Sliding glass doors: every frame's tiles in one tileset, the closed frame on the "doors" layer; the runtime swaps
    # frames with setTiles (doors.json lists each door's cells and the gids of every frame).
    door_bank = TileBank('Konclui_Doors')
    door_specs = []
    for row, g, w in P.DOORS_H:
        south = row == P.BY1
        door_frames = [GL.door_h(w, k, south) for k in range(GL.DOOR_FRAMES)]
        cells = [(g + i, row + j) for j in (0, 1) for i in range(w)]
        door_specs.append((f'h{row}-{g}', cells, door_frames, ((g + w / 2) * T, (row + 1) * T)))
    for c, r in P.DOORS_V:
        bx = P.vb(c)
        door_frames = [GL.door_v(k) for k in range(GL.DOOR_FRAMES)]
        cells = [(bx - 1 + i, r + j) for j in (0, 1) for i in range(2)]
        door_specs.append((f'v{bx}-{r}', cells, door_frames, (bx * T, (r + 1) * T)))
    door_ids = []
    for _, cells, door_frames, _ in door_specs:
        x0, y0 = min(x for x, _ in cells), min(y for _, y in cells)
        door_ids.append([[door_bank.add(f.crop(((x - x0) * T, (y - y0) * T, (x - x0 + 1) * T, (y - y0 + 1) * T)))
                          for x, y in cells] for f in door_frames])
    first = add_bank(door_bank)
    door_layer = [0] * (W * H)
    doors_json = []
    for (key, cells, _, center), ids_by_frame in zip(door_specs, door_ids):
        gids = [[0 if i < 0 else first + i for i in frame] for frame in ids_by_frame]
        for (x, y), gid_ in zip(cells, gids[0]):
            door_layer[y * W + x] = gid_
        doors_json.append(dict(id=key, cells=[list(c) for c in cells], frames=gids, center=list(center)))
    layers.append(tile_layer('doors', door_layer))
    coll = np.zeros((H, W), bool)
    for x, y in blocked_cells:
        coll[y, x] = True
    # Opacity 0: the engine still blocks on it, Phaser no longer draws its transparent tiles (-21 % vertices per frame,
    # hq-office/perf.py, 18/10/2026)
    layers.append(tile_layer('collisions', [int(v) for v in coll.flatten()], opacity=0))
    # Thin walls: 15 transparent tiles, tile i carries wallEdges = the edges of bitmask i + 1.
    combos = [''.join(e for e in 'nesw' if (i + 1) & EDGE_BITS[e]) for i in range(15)]
    Image.new('RGBA', (15 * T, T)).save(dist / 'tilesets/ThinWalls.png')
    thin_first = gid
    sets.append(dict(firstgid=gid, name='ThinWalls', image='tilesets/ThinWalls.png', imagewidth=15 * T, imageheight=T,
                     columns=15, tilewidth=T, tileheight=T, tilecount=15, properties=COPYRIGHT,
                     tiles=[dict(id=i, properties=[dict(name='wallEdges', type='string', value=c)])
                            for i, c in enumerate(combos)]))
    gid += 15
    thin = [0] * (W * H)
    for (x, y), es in edges.items():
        thin[y * W + x] = thin_first + combos.index(''.join(e for e in 'nesw' if e in es))
    layers.append(tile_layer('thin-walls', thin, opacity=0))
    layers.append(dict(id=len(layers) + 1, name='floorLayer', type='objectgroup', draworder='topdown', objects=[],
                       visible=True, opacity=1, x=0, y=0))
    light_bank = TileBank('Konclui_Light')                      # above the avatars: sunlight through the glass
    light = draw_light()
    light_ids = slice_into(light, light_bank, W, H)
    first = add_bank(light_bank)
    layers.append(tile_layer('luz', [0 if i < 0 else first + i for i in light_ids]))
    # Shared variables the games use (VariablesManager.ts: objects of class "variable", declared up front).
    layers.append(dict(id=len(layers) + 1, name='variables', type='objectgroup', draworder='topdown', visible=False,
                       opacity=1, x=0, y=0, objects=[
                           dict(id=k, name=name, **{'class': 'variable'}, type='variable', x=0, y=0, width=0, height=0,
                                point=True, rotation=0, visible=True,
                                properties=[dict(name='default', type='string', value=default),
                                            dict(name='persist', type='bool', value=True)])
                           for k, (name, default) in enumerate(
                               [*[(n, '' if n.startswith('mesa') else '[]') for n in P.GAME_VARIABLES],
                                ('mesas', '{}'), ('salas', '{}')], 1)]))
    # Locked rooms: one hidden layer per lockable room whose collision closes its door gaps when shown.
    lockable = []
    for key in ('room_01', 'room_02', 'room_03', 'room_04', 'meeting_01', 'meeting_02'):
        l, t, r, b = P.ROOMS[key]
        cells, door_keys, centers = [], [], []
        for row, g, w in P.DOORS_H:
            if row == b and P.vb(l) <= g < P.vb(r):
                cells += [(g + i, row + j) for i in range(w) for j in (0, 1)]
                door_keys.append(f'h{row}-{g}')
                centers.append([(g + w / 2) * T, (row + 1) * T])
        for c, rr in P.DOORS_V:
            bx = P.vb(c)
            if bx == P.vb(r) and t + 2 <= rr <= b - 1:
                cells += [(bx - 1, rr), (bx - 1, rr + 1)]
                door_keys.append(f'v{bx}-{rr}')
                centers.append([bx * T, (rr + 1) * T])
        data = [0] * (W * H)
        for x, y in cells:
            data[y * W + x] = 1
        layer = tile_layer(f'lock-{key}', data)
        layer['visible'] = False
        layers.append(layer)
        lockable.append(dict(key=key, name={'room_01': 'Sala 01', 'room_02': 'Sala 02', 'room_03': 'Sala 03',
                                            'room_04': 'Sala 04', 'meeting_01': 'Reunião 01',
                                            'meeting_02': 'Reunião 02'}[key],
                             rect=rect_px(*interior(l, t, r, b)), layer=f'lock-{key}', doors=door_keys,
                             doorCenters=centers))
    start_tiles = [0] * (W * H)                # an invisible Tiled start keeps new visitors off the walls
    i = start[1] * W + start[0]
    start_tiles[i] = layers[0]['data'][i]
    layers.append(tile_layer('start', start_tiles, opacity=0))

    # Objects and the WAM
    collections = [CAT.build(dist, lambda p: MOB[p['id']][0], lambda p, img: MOB[p['id']][1]),
                   write_collection(dist, KCOLL, KONCLUI, 'konclui'),
                   *[write_collection(dist, name, prefabs, SHEET_FOLDERS[name]) for name, prefabs in SHEET_COLLECTIONS.items()]]
    for prefabs in SHEET_COLLECTIONS.values():          # chairs seen from behind: the whole piece over the sitter
        for pid, (_, img, seat) in prefabs.items():
            if seat and seat['direction'] == 'up':
                FRONTS[pid] = img
    entities = {uid(key): dict(x=x, y=y, name=d['prefab']['name'],
                               prefabRef=dict(collectionName=d['collection'], id=d['id']))
                for key, (d, x, y) in placed.items()}
    entities.update(EDITOR_ADDED)                     # what the owner created in the editor, kept as it is
    for key, label in P.WHITEBOARDS.items():         # whiteboard: SPACE by it opens the room's shared board
        entities[uid(key)]['properties'] = [
            dict(id=uid(key + '/board'), type='openWebsite', link=whiteboard_link(key, whiteboard_namespace),
                 application='excalidraw', trigger='onaction', triggerMessage=f'ESPAÇO para abrir o {label.lower()}',
                 closable=True, newTab=False, width=70, buttonLabel=label),
            dict(id=uid(key + '/desc'), type='entityDescriptionProperties', name=label,
                 description='Quadro branco compartilhado da sala.', searchable=True)]
    arrival = dict(id=uid('start'), name='', x=start[0] * T - T // 2, y=start[1] * T - T // 2, width=2 * T,
                   height=2 * T, visible=True, properties=[dict(id=uid('start/prop'), type='start', isDefault=True)])
    areas = build_areas()
    planned = [arrival, *areas]
    ids = {a['id'] for a in planned}
    wam_areas = [EDITOR_AREAS.get(a['id'], a) for a in planned if not EDITOR_AREAS.get(a['id'], {}).get('deleted')]
    wam_areas += [a for i, a in EDITOR_AREAS.items() if i not in ids and not a.get('deleted')]   # created in the editor
    wam = dict(version='2.1.0', mapUrl='office.tmj', entities=entities, areas=wam_areas,
               entityCollections=[dict(url=c, type='file') for c in collections],
               # spotlight: anyone can speak to the whole office from the megaphone button
               settings=dict(megaphone=dict(enabled=True, title='Koncluí · todo o escritório', scope='ROOM', rights=[])))
    (dist / 'office.wam').write_text(json.dumps(wam, ensure_ascii=False, indent=1))
    props = [dict(name='script', type='string', value='scripts/office.js'),
             dict(name='mapName', type='string', value='Koncluí · Sede'),
             dict(name='mapCopyright', type='string',
                  value='Koncluí; arte de terceiros licenciada para uso interno da Koncluí')]
    tmj = dict(type='map', version='1.10', tiledversion='1.11.2', orientation='orthogonal', renderorder='right-down',
               infinite=False, width=W, height=H, tilewidth=T, tileheight=T, layers=layers, tilesets=sets,
               properties=props, nextlayerid=len(layers) + 1, nextobjectid=1)
    (dist / 'office.tmj').write_text(json.dumps(tmj, ensure_ascii=False))

    # Seating, koi and the map script
    sources = SOURCES | SEAT_SOURCE
    prefab_seats = [dict(collectionName=c, prefabId=pid,
                         **cushions(seat_pose(pid, seat), sources.get(pid)))
                    for c, src in ((CAT.COLLECTION, MOB), (KCOLL, KONCLUI), *SHEET_COLLECTIONS.items())
                    for pid, (_, _, seat) in src.items() if seat]
    (dist / 'seats/front').mkdir(parents=True, exist_ok=True)
    for pid, front in FRONTS.items():
        front.save(dist / 'seats/front' / f'{pid}.png', optimize=True)
    grids = {f"{c}/{p['id']}": p['collisionGrid'] for c, src in ((CAT.COLLECTION, MOB), (KCOLL, KONCLUI),
                                                                  *SHEET_COLLECTIONS.items())
             for p, _, _ in src.values() if p.get('collisionGrid')}
    (dist / 'seats.json').write_text(json.dumps(dict(
        interactionRadius=64, occupancyRadius=12, seats=[], rooms=seat_rooms(), prefabSeats=prefab_seats,
        collision=dict(width=W, tile=T, blocked=[int(i) for i in np.flatnonzero(coll)], prefabs=grids)),
        ensure_ascii=False, separators=(',', ':')))
    for name in RUNTIME_OFFICE:
        shutil.copy(REPO / 'office/runtime' / name, dist / 'scripts/runtime' / name)
    for name in RUNTIME_HERE:
        shutil.copy(HERE / 'runtime' / name, dist / 'scripts/runtime' / name)
    shutil.copy(HERE / 'map-script.js', dist / 'scripts/office.js')
    games_src = REPO / 'map/campus_web/games'
    shutil.copytree(games_src, dist / 'games', ignore=shutil.ignore_patterns('VENDOR.md'))
    spots = []
    for key, (game, label) in P.GAMES.items():
        d, x, y = placed[key]
        bx0, by0, bx1, by1 = d['image'].getbbox()       # the drawn object, not its canvas: terminals stand side by
        spots.append(dict(key=key, game=game, label=label,   # side and a seat may be a tile from one
                          rect=dict(x=x + bx0 - T, y=y + by0 - T, width=bx1 - bx0 + 2 * T, height=by1 - by0 + 2 * T)))
    (dist / 'interactions.json').write_text(json.dumps(dict(doors=doors_json, games=spots)))
    desks = [dict(chair=uid(key)) for key in placed if '/ws' in key and key.split('/')[-1 if key[-2:] != '/e' else -2] == 'chair']
    # Ambient sound by distance (owner, 20/10/2026: "Ir do volume 0 até o volume 100 do efeito... quanto mais perto
    # chegar, mais alto"): each source plays at its ideal `volume` inside `rect` and fades to silence over `falloff` px
    # (theme/hud-audio.js; social.mjs without it). The lake: its water, heard from 6 tiles out. The coffee bar: the
    # café's kitchen and tables, north of the lounge and games, heard from 4 tiles out.
    lx0, ly0, lx1, ly1 = P.POOL['lake']
    cx0, cy0, cx1, cy1 = interior(*P.ROOMS['cafe'])
    lounge_top = min((z[2] for z in P.ZONES if z[0] in ('cafe-warm', 'lounge-warm')), default=cy1 + 1)
    ambience = [dict(file='lake.mp3', volume=0.22, rect=rect_px(lx0, ly0, lx1, ly1), falloff=6 * T),
                dict(file='coffee.mp3', volume=0.18, rect=rect_px(cx0, cy0, cx1, lounge_top - 1), falloff=4 * T)]
    (dist / 'social.json').write_text(json.dumps(dict(desks=desks, rooms=lockable, ambience=ambience)))
    # The sales bell (runtime/bell.mjs): its area, its sound, and where it rings quieter (team and meeting rooms, the
    # auditorium and the focus booths).
    quiet = [rect_px(*interior(*P.ROOMS[k])) for k in ('room_01', 'room_02', 'room_03', 'room_04', 'meeting_01',
                                                       'meeting_02', 'auditorium')]
    quiet += [rect_px(*box) for box in P.BOOTHS.values()]
    (dist / 'bell.json').write_text(json.dumps(dict(area=BELL_AREA_NAME, sound='sale.mp3', quiet=quiet),
                                               ensure_ascii=False))
    fx = FX.write(dist, pool=pool, kind_map=kind_map, wall_art=wall_art, P=P, lockable=lockable)  # theme/fx/
    shutil.copytree(HERE / 'reactions', dist / 'reactions')
    (dist / 'sounds').mkdir(exist_ok=True)
    for name in ('lake.mp3', 'coffee.mp3', 'sale.mp3'):
        shutil.copy(REPO / 'media/sounds' / name, dist / 'sounds' / name)
    (dist / 'pages').mkdir(exist_ok=True)              # the campus sale card, for a page without theme/hud-sale.js
    shutil.copy(REPO / 'map/campus_web/sale.html', dist / 'pages/sale.html')
    overlays = []
    koi_src = HERE / 'pool/koi'
    for name, k in pool.koi.items():
        folder = dist / 'koi' / name
        folder.mkdir(parents=True, exist_ok=True)
        for mask_name in ('swim', 'open'):
            m = np.zeros((*k[mask_name].shape, 4), np.uint8)
            m[k[mask_name]] = (255, 255, 255, 255)
            Image.fromarray(m, 'RGBA').save(folder / f'{mask_name}.png', optimize=True)
        ys, xs = np.nonzero(k['open'])
        rng = np.random.default_rng(len(name))
        spawn = [[int(xs[i]), int(ys[i])] for i in rng.choice(len(xs), size=6, replace=False)]
        (folder / 'scene.json').write_text(json.dumps(dict(
            width=k['size'][0], height=k['size'][1], count=k['count'], seed=41 + len(name), spawnPoints=spawn,
            scale=1, origin=k['origin'])))
        overlays.append(dict(name=name, position=dict(x=k['origin'][0], y=k['origin'][1], width=k['size'][0],
                                                      height=k['size'][1])))
    koi_ready = (koi_src / 'index.html').exists()
    if not koi_ready:
        raise FileNotFoundError(f'Missing koi runtime: {koi_src / "index.html"}')
    if koi_ready:
        for path in koi_src.glob('*'):
            if path.is_file() and path.suffix in ('.html', '.mjs', '.js') and 'test' not in path.name \
                    and 'preview' not in path.name:
                shutil.copy(path, dist / 'koi' / path.name)
        (dist / 'koi/overlays.json').write_text(json.dumps(overlays))

    # Report for map/validate_map.py: tile-level faces, doors, seats and rooms.
    report = dict(
        walls=sorted(map(list, faces)), arrival=[list(start)],
        doors=[dict(axis='h', cells=[[x, y] for y in (row, row + 1) for x in range(g, g + w)])
               for row, g, w in P.DOORS_H],
        seats=[dict(id=k, x=c[0], y=c[1], **{'from': list(c)}) for k, c in seats],
        rooms=[dict(key=k, cells=[[x, y] for x in range(b[0], b[2] + 1) for y in range(b[1], b[3] + 1)])
               for k, b in {**{k: interior(*v) for k, v in P.ROOMS.items()}, **P.BOOTHS}.items()])
    (dist / 'build_report.json').write_text(json.dumps(report))

    # Preview: floor (frame 0), walls, objects by depth (the engine's order: bottom edge plus depthOffset).
    comp = frames[0].copy()
    for (tx, ty), cell in decor.items():
        comp.alpha_composite(cell[0], (tx * T, ty * T))
    comp.alpha_composite(wall_art)
    drawn = sorted(((y + d['image'].height + d['prefab'].get('depthOffset', 0), x, y, d['image'])
                    for d, x, y in placed.values()), key=lambda t: (t[0], t[1]))
    for _, x, y, img in drawn:
        comp.alpha_composite(img, (x, y))
    comp.alpha_composite(light)                          # the layer above the avatars
    comp.convert('RGB').save(renders / 'preview.png')
    # The HUD's people map (runtime/hud.mjs): the same picture at 8 px per tile, and the map size it covers.
    comp.convert('RGB').resize((W * 8, H * 8), Image.LANCZOS).save(dist / 'planta.webp', quality=86, method=6)
    (dist / 'hud.json').write_text(json.dumps(dict(plan=dict(file='planta.webp', width=W * T, height=H * T))))

    result = validate(dist)
    summary = dict(size=[W, H], objects=len(entities), seats=len(seats), areas=1 + len(areas),
                   wall_faces=len(faces), thin_wall_tiles=len(edges), pool_tiles=len(pool.blocked),
                   animated_tiles=animated, reachable_tiles=len(reach), konclui_prefabs=len(KONCLUI),
                   lawn=dict(cells=len(lawn_cells), decor=len(lawn_decor),
                             swaying=sum(len(c) > 1 for c in lawn_decor.values())),
                   water=dict(surface=len(pool.surface), glints_and_ripples=len(water_decor)),
                   koi_overlays=[o['name'] for o in overlays] if koi_ready else 'pending',
                   fx=dict(lights=len(fx['lights']), rooms=len(fx['rooms']), water=fx['water']['rect']),
                   tiles={s['name']: s['tilecount'] for s in sets}, errors=result.errors, warnings=result.warnings)
    (renders / 'build.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps({k: v for k, v in summary.items() if k != 'warnings'}, ensure_ascii=False)[:900])
    for w in result.warnings:
        if w['code'] != 'DOOR_AT_CORNER':
            print('warning', w['code'], w['message'], w.get('x'), w.get('y'), w.get('objectName', ''))
    return 1 if result.errors else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--out', help='output folder instead of hq-office/dist')
    parser.add_argument('--renders', help='preview and validation summary folder instead of hq-office/renders')
    parser.add_argument('--whiteboard-namespace', default=NS, help='isolate shared whiteboard links without changing entity IDs')
    args = parser.parse_args()
    sys.exit(main(args.out, args.renders, args.whiteboard_namespace))
