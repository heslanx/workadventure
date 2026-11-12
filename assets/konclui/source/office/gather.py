"""The "Gather" entity collection: furniture, decoration, doors, floors and thin walls collected from Gather.

Origin, licence and what stayed out (avatars, interface, map previews): sources/gather/NOTICE.md. The importer reads
the "Gather Asset Collector" folder (2026-10-14) and copies, byte-identical, only the images the collection uses to
sources/gather/files/<sha256>.png, with a compact sources/gather/catalog.json. Portuguese names come from
sources/gather/names-pt.json ("<category>/<family>/<type>" -> name).

Gather draws on the same 32 px grid as WorkAdventure, so each piece keeps Gather's own geometry:
  canvas    the tile box Gather places the image in (offsetInPixels), minus empty outer tile rows and columns
  collision Gather's collision points, one 32 px cell each
  depth     Gather's fold line (the row where the piece meets the floor), as depthOffset from the bottom
  seats     a Seating piece with sitting points is a seat (seats.json prefabSeats): the middle point, the way the
            piece faces; the sitter is drawn over a seat facing down or sideways and under one seen from behind,
            whose backrest (Gather's foreground layer, composited here) covers it
  floors    one 32 px tile each, no collision, drawn 96 px behind its top so a 3-row table on them stays on top
  doors     the closed and the open frame of Gather's door sheets, no collision
  walls     Gather's thin walls in 27 finishes, colliding on their base cell
Variants share a name and differ by colour and direction (the editor groups them); every object has one tag, its
"Gather: ..." category, so the pack sits together in the object panel.

  python3 office/gather.py import <collector-dir>   copy the originals and write sources/gather/catalog.json
  python3 office/gather.py build <dist>             write <dist>/entities/gather/
  python3 office/gather.py check [<dist>]           audit the sources and a build; exit 1 on any problem
  python3 office/gather.py board <category> <png>   labelled sheet of one built category, for review
"""
import argparse
import hashlib
import json
import re
import shutil
import sys
import urllib.parse
from collections import Counter
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'sources/gather'
COLLECTION = 'Gather'
T = 32
FLOOR_BEHIND = 96          # px a floor tile is drawn behind its own top (see the docstring)
SEAT_LIFT = 8              # the sitter's centre sits this far above the middle of Gather's sitting cell, as the
#                            Modern Office chairs do (modern_office.SEATS: cell middle 48, anchor 40)

# Gather colour names -> CSS colours for the editor's swatches; one code per name, so variants never merge.
COLOURS = {
    'black': '#2d2d38', 'white': '#f4f4f0', 'grey': '#8c9099', 'green': '#4f9d55', 'orange': '#ee8a2c',
    'red': '#d24a3f', 'blue': '#3d7bd6', 'yellow': '#f0c64a', 'purple': '#8b5dc6', 'teal': '#2aa79d',
    'pink': '#ee86b3', 'coffee': '#8d5b3b', 'brown': '#9d6b44', 'lightcoffee': '#c99c6c', 'darkbrown': '#5d3a22',
    'darkcoffee': '#4f3226', 'lightbrown': '#cba57b', 'lightpink': '#f6bfd6', 'lightgreen': '#9fd39a',
    'lightblue': '#a6c9f2', 'lightteal': '#93dcd4', 'lightyellow': '#f8e6a0', 'lightpurple': '#c6aee6',
    'lightred': '#ee9a92', 'lightorange': '#f6c08c', 'darkblue': '#24477e', 'darkorange': '#b35f13',
    'darkred': '#8b2a22', 'darkpink': '#b8517e', 'darkpurple': '#55337f', 'darkgreen': '#2f6234',
    'darkyellow': '#b8932a', 'darkteal': '#17665f',
}

# Editor category of a furniture piece: (Gather category, families or None for "the rest") -> category; first wins.
FESTIVE = 'Gather: festas e datas'
CATEGORIES = (
    ('Seating', {'Chair'}, 'Gather: cadeiras'),
    ('Seating', {'Armchair'}, 'Gather: poltronas'),
    ('Seating', None, 'Gather: sofás e bancos'),
    ('Table', {'Desk'}, 'Gather: mesas de trabalho'),
    ('Table', None, 'Gather: mesas'),
    ('CabinetsAndShelves', None, 'Gather: armários e estantes'),
    ('Machine', None, 'Gather: computadores e máquinas'),
    ('FoodAndDrink', None, 'Gather: comidas e bebidas'),
    ('Interactive', None, 'Gather: jogos e interativos'),
    ('SmartObjects', None, 'Gather: jogos e interativos'),
    ('Nature', {'Tree'}, 'Gather: árvores'),
    ('Nature', {'Effigy', 'Grave', 'Fireworks', 'Produce', 'Hay', 'Large Sculpture', 'Pole', 'Arch'}, FESTIVE),
    ('Nature', None, 'Gather: jardim e área externa'),
    ('RoomDecor', {'Room Plant', 'Desk Plant', 'Potted Flowers', 'Fantasy Plant', 'Terrarium'}, 'Gather: plantas'),
    ('RoomDecor', {'Desk Lamp', 'Floor Lamp'}, 'Gather: luminárias'),
    ('RoomDecor', {'Rug'}, 'Gather: tapetes'),
    ('RoomDecor', {'Barrier Small', 'Barrier Wall'}, 'Gather: divisórias'),
    ('RoomDecor', {'Arcade Machine', 'Game Table', 'Ball', 'Sports Equipment', 'Instrument', 'Record Player',
                   'Floor Radio', 'Headphones'}, 'Gather: lazer, esporte e música'),
    ('RoomDecor', {'Decorated Tree', 'Presents', 'Lantern', 'Remains', 'Cauldron', 'Centerpiece', 'Sheaf',
                   'Signpost', 'Giant Object', 'Bucket', 'Cleaning', 'Altar', 'Box', 'Divination', 'Table Set'},
     FESTIVE),
    ('RoomDecor', {'Document', 'Handwritten Notes', 'Book', 'Desk Phone', 'Desk Microphone', 'Microphone Stand',
                   'Camera', 'Typewriter', 'Map', 'Easel', 'Lectern', 'Whiteboard', 'Award', 'Globe'},
     'Gather: escritório e objetos de mesa'),
    ('RoomDecor', {'Fridge', 'Vending', 'Hydration', 'Cooler', 'Liquor Cabinet', 'HVAC', 'Waste Receptacle'},
     'Gather: copa, eletros e utilidades'),
    ('RoomDecor', None, 'Gather: decoração'),
    ('WallDecor', {'Window Large', 'Window Small'}, 'Gather: janelas'),
    ('WallDecor', {'Bunting', 'Wreath', 'Stocking', 'Cutout', 'Flag', 'Tapestry', 'Religious Iconography'}, FESTIVE),
    ('WallDecor', None, 'Gather: na parede'),
)
DOORS_CATEGORY, FLOORS_CATEGORY, WALLS_CATEGORY = 'Gather: portas', 'Gather: pisos', 'Gather: paredes'

# Floor tiles: file-name family -> name; the rest of the file name is the finish (a colour variant).
FLOORS = {
    'Carpet_Afghani': 'Carpete afegão', 'Carpet_Couture': 'Carpete couture', 'Carpet_Curls': 'Carpete de arabescos',
    'Carpet_Damask': 'Carpete adamascado', 'Carpet_Diamond': 'Carpete de losangos', 'Carpet_Floral': 'Carpete floral',
    'Carpet_Stripe': 'Carpete listrado', 'Carpet_Texture': 'Carpete texturizado', 'Carpet_Wave': 'Carpete em zigue-zague',
    'Carpet_Wavy': 'Carpete ondulado', 'Damask': 'Piso adamascado', 'NewStyle_Grass': 'Grama lisa',
    'Redux_Wood_Basketweave': 'Taco trançado escuro', 'Redux_Wood_Herringbone': 'Taco espinha de peixe, novo',
    'Redux_Wood_Parquet': 'Parquete escuro', 'Redux_Wood_Slats': 'Assoalho de réguas, novo',
    'Redux_Wood_Spiral': 'Taco em espiral escuro', 'Stone_Brick': 'Piso de tijolinho', 'Stone_Tile': 'Piso de pedra',
    'Tile_2tone': 'Ladrilho bicolor', 'Tile_Hex': 'Ladrilho hexagonal', 'Tile_Simple': 'Ladrilho simples',
    'Tile_Twotone': 'Ladrilho xadrez', 'Wood_Basket': 'Taco cesteiro', 'Wood_Basketweave': 'Taco trançado',
    'Wood_Herringbone': 'Taco espinha de peixe', 'Wood_Parquet': 'Parquete', 'Wood_Slats': 'Assoalho de réguas',
    'Wood_Spiral': 'Taco em espiral', 'floor_main_grass': 'Grama', 'floor_main_plain': 'Piso liso',
    'floor_main_planks': 'Tábuas corridas', 'floor_main_squares': 'Piso quadriculado',
    'floor_main_triangles_rug': 'Piso de triângulos', 'floor_main_water': 'Água',
}
# Thin walls: Gather piece -> (name, direction).
WALLS = {'n': ('Parede fina', 'Up'), 's': ('Parede fina', 'Down'), 'e': ('Parede fina', 'Right'),
         'w': ('Parede fina', 'Left'), 'ne': ('Canto de parede fina, fundo', 'Right'),
         'nw': ('Canto de parede fina, fundo', 'Left'), 'se': ('Canto de parede fina, frente', 'Right'),
         'sw': ('Canto de parede fina, frente', 'Left')}
# Door sheets: file -> (name stem, direction, frame width); the top and bottom halves of a side door are one piece.
DOORS = {'doors-n.png': ('Porta dupla', 'Up', 64), 'doors-s.png': ('Porta dupla', 'Down', 64),
         'doors-e': ('Porta lateral', 'Right', 96), 'doors-w': ('Porta lateral', 'Left', 96)}
DOOR_COLOUR = '#e8b48a'


def category(record):
    for cat, families, name in CATEGORIES:
        if record['category'] == cat and (families is None or record['family'] in families):
            return name
    raise KeyError(f"no editor category for {record['category']}/{record['family']}")


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


# ---------------------------------------------------------------------------------------------------- import

def import_collector(collector):
    """Copy what the collection uses from the collector folder into sources/gather/ and write catalog.json."""
    collector = Path(collector)
    snapshot = json.loads((collector / 'catalog/snapshot.json').read_text())
    files = {}                                                       # sha256 -> path in the collector

    def keep(sha, path):
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == sha, f'{path}: bytes do not match its sha256'
        files[sha] = path
        return sha

    organized = {}
    for line in (collector / 'organized/manifest.jsonl').read_text().splitlines():
        m = json.loads(line)
        if m['kind'] == 'furniture':
            organized[(m['id'], m['role'])] = m
    furniture = []
    for r in snapshot['records']:
        if r['kind'] != 'furniture':
            continue
        R = r['rendering']
        left, top = R['offsetInPixels']['left'], R['offsetInPixels']['top']

        def cells(points):
            out = []
            for p in points:
                x, y = p['x'] * T + left, p['y'] * T + top
                assert x == int(x) and y == int(y) and x % T == 0 and y % T == 0, (r['id'], p)
                out.append([int(x) // T, int(y) // T])
            return out
        main = organized[(r['id'], 'main')]
        fg = organized.get((r['id'], 'foreground'))
        furniture.append(dict(
            id=r['id'], item=r['catalogItemId'], category=r['category'], family=r['family'], type=r['type'],
            color=r['color'], orientation=r['orientation'], published=r['isPublished'],
            size=[R['dimensionsInPixels']['width'], R['dimensionsInPixels']['height']], offset=[left, top],
            fold=R['mainRenderable'].get('fold'), main=keep(main['sha256'], collector / main['file']),
            foreground=keep(fg['sha256'], collector / fg['file']) if fg else None,
            collision=cells(R['collision']['points']), seats=cells(R['sittable']['points'])))
    bundled = [json.loads(line) for line in (collector / 'bundled/organized/manifest.jsonl').read_text().splitlines()]
    floors, walls, doors = [], [], []
    for b in bundled:
        path = collector / 'bundled' / b['file']
        source = urllib.parse.unquote(b['source'])
        if b['category'] == 'floors':
            floors.append(dict(name=b['name'], sha=keep(b['sha256'], path)))
        elif b['category'] == 'walls':
            walls.append(dict(style=source.split('/')[-2], piece=b['name'][len('thin wall '):-len('.png')],
                              sha=keep(b['sha256'], path)))
        elif b['category'] == 'doors' and b['name'].startswith('doors-') and 'simplified' not in b['name']:
            doors.append(dict(name=b['name'], sha=keep(b['sha256'], path)))
    out = SRC / 'files'
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for sha, path in sorted(files.items()):
        shutil.copyfile(path, out / f'{sha}.png')
    doc = dict(collectedAt=snapshot['exportedAt'], source='Gather Asset Collector (app.v2.gather.town catalogue)',
               furniture=sorted(furniture, key=lambda f: (f['category'], f['family'], f['type'], f['id'])),
               floors=sorted(floors, key=lambda f: f['name']), walls=sorted(walls, key=lambda w: (w['style'], w['piece'])),
               doors=sorted(doors, key=lambda d: d['name']))
    (SRC / 'catalog.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    print(f"imported {len(furniture)} furniture variants, {len(floors)} floors, {len(walls)} wall pieces, "
          f"{len(doors)} door sheets; {len(files)} files")


# ---------------------------------------------------------------------------------------------------- geometry

def available():
    return (SRC / 'catalog.json').is_file() and (SRC / 'names-pt.json').is_file()


def catalog():
    return json.loads((SRC / 'catalog.json').read_text())


def image(sha):
    return Image.open(SRC / 'files' / f'{sha}.png').convert('RGBA')


def trim(canvas, keep=()):
    """(canvas, dx, dy) without the outer tile rows and columns that have no pixel and no cell in keep."""
    alpha = canvas.getchannel('A')
    cols, rows = canvas.width // T, canvas.height // T
    used = {(c, r) for c in range(cols) for r in range(rows) if alpha.crop((c * T, r * T, c * T + T, r * T + T)).getbbox()}
    used |= set(map(tuple, keep))
    c0, c1 = min(c for c, _ in used), max(c for c, _ in used)
    r0, r1 = min(r for _, r in used), max(r for _, r in used)
    return canvas.crop((c0 * T, r0 * T, (c1 + 1) * T, (r1 + 1) * T)), c0, r0


def seat_cell(points):
    """The sitting cell the runtime uses: the one nearest the middle of a couch's or bench's cells."""
    mx, my = sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)
    return min(points, key=lambda p: ((p[0] - mx) ** 2 + (p[1] - my) ** 2, p[1], p[0]))


def furniture_piece(f):
    """(image, collisionGrid or None, depthOffset, seat or None) of one furniture variant."""
    (w, h), (left, top) = f['size'], f['offset']
    marks = f['collision'] + f['seats']
    cols = max([-(-(left + w) // T)] + [c + 1 for c, _ in marks])
    rows = max([-(-(top + h) // T)] + [r + 1 for _, r in marks])
    canvas = Image.new('RGBA', (cols * T, rows * T))
    canvas.alpha_composite(image(f['main']), (left, top))
    if f['foreground']:
        canvas.alpha_composite(image(f['foreground']), (left, top))
    canvas, dx, dy = trim(canvas, marks)
    H = canvas.height
    grid = None
    if f['collision']:
        grid = [[0] * (canvas.width // T) for _ in range(H // T)]
        for c, r in f['collision']:
            grid[r - dy][c - dx] = 1
    seat = None
    if f['category'] == 'Seating' and f['seats']:
        c, r = seat_cell(f['seats'])
        anchor = ((c - dx) * T + T // 2, (r - dy) * T + T // 2 - SEAT_LIFT)
        facing = f['orientation'].lower()
        seat = dict(anchorOffset=dict(x=anchor[0], y=anchor[1]), direction=facing)
        depth = 0 if facing == 'up' else anchor[1] - 1 - H        # over the sitter only when seen from behind
    else:
        line = top - dy * T + (f['fold'] if f['fold'] is not None else h)
        depth = min(0, line - H)
    return canvas, grid, depth, seat


def swatch(img):
    """Mean colour of the opaque pixels, as #rrggbb."""
    a = np.asarray(img)
    return '#%02x%02x%02x' % tuple(int(v) for v in a[..., :3][a[..., 3] > 0].mean(axis=0))


def unique_colour(colour, used):
    """colour, nudged by one step until no other finish of the same name uses it."""
    r, g, b = (int(colour[i:i + 2], 16) for i in (1, 3, 5))
    while colour in used:
        b = (b + 1) % 256
        colour = '#%02x%02x%02x' % (r, g, b)
    used.add(colour)
    return colour


def floor_family(stem):
    family = max((f for f in FLOORS if stem == f or stem.startswith(f + '_')), key=len)
    return family, stem[len(family) + 1:] or 'base'


@lru_cache(maxsize=None)
def pieces():
    """[(prefab, image, seat or None)] of the whole collection, in panel order; skipped = [(what, why)]."""
    doc, names = catalog(), json.loads((SRC / 'names-pt.json').read_text())
    out, seen, skipped = [], {}, []

    def add(pid, img, name, cat, colour, direction, grid=None, depth=0, seat=None, folder='misc', published=True):
        key = (name, colour, direction)
        if key in seen:
            skipped.append((pid, published, f'same name, colour and direction as {seen[key]}'))
            return
        seen[key] = pid
        prefab = dict(id=pid, name=name, tags=[cat], imagePath=f'sprites/{folder}/{pid}.png', direction=direction,
                      color=colour)
        if grid:
            prefab['collisionGrid'] = grid
        if depth:
            prefab['depthOffset'] = depth
        out.append((prefab, img, seat))

    # Published variants first, so an unpublished duplicate is the one left out.
    for f in sorted(doc['furniture'], key=lambda f: (not f['published'], f['category'], f['family'], f['type'],
                                                     f['color'], f['orientation'])):
        img, grid, depth, seat = furniture_piece(f)
        add(f"gather-{f['id']}", img, names[f"{f['category']}/{f['family']}/{f['type']}"], category(f),
            COLOURS[f['color']], f['orientation'], grid, depth, seat, slug(f['category']), f['published'])
    for name, (stem, direction, width) in DOORS.items():
        sheets = [d for d in doc['doors'] if d['name'] == name or d['name'].startswith(name + '-')]
        assert sheets, f'door sheet {name} missing'
        sheet = Image.new('RGBA', image(sheets[0]['sha']).size)
        for d in sorted(sheets, key=lambda d: 'top' in d['name']):     # the top half over the bottom one
            sheet.alpha_composite(image(d['sha']))
        frames = [sheet.crop((i * width, 0, (i + 1) * width, sheet.height)) for i in range(sheet.width // width)]
        for state, frame in (('fechada', frames[0]), ('aberta', frames[-1])):
            img, _, _ = trim(frame)
            add(f'gather-door-{slug(name)}-{"closed" if state == "fechada" else "open"}', img, f'{stem} {state}',
                DOORS_CATEGORY, DOOR_COLOUR, direction, folder='doors')
    used = {}
    for fl in doc['floors']:
        stem = fl['name'][:-len('.png')]
        family, finish = floor_family(stem)
        img = image(fl['sha'])
        add(f'gather-floor-{slug(stem)}', img, FLOORS[family], FLOORS_CATEGORY,
            unique_colour(swatch(img), used.setdefault(family, set())), 'Down', depth=-(img.height + FLOOR_BEHIND),
            folder='floors')
    styles = {}
    for w in doc['walls']:
        styles.setdefault(w['style'], {})[w['piece']] = w['sha']
    wall_colours = set()
    for style, parts in sorted(styles.items()):
        colour = unique_colour(swatch(image(parts['n'])), wall_colours)
        for piece, (name, direction) in WALLS.items():
            img = image(parts[piece])
            grid = [[0]] * (img.height // T - 1) + [[1]]
            add(f'gather-wall-{slug(style)}-{piece}', img, name, WALLS_CATEGORY, colour, direction, grid,
                folder='walls')
    return out, skipped


def prefab_seats():
    """Seat templates for the seating runtime (seats.json prefabSeats)."""
    return [dict(collectionName=COLLECTION, prefabId=prefab['id'], **seat)
            for prefab, _, seat in pieces()[0] if seat]


def build(dist):
    """Write <dist>/entities/gather/; return the collection path relative to dist."""
    out = Path(dist) / 'entities/gather'
    if out.exists():
        shutil.rmtree(out)
    built, skipped = pieces()
    for prefab, img, _ in built:
        path = out / prefab['imagePath']
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
    doc = dict(collectionName=COLLECTION, tags=[], version='1.0', collection=[p for p, _, _ in built])
    (out / 'collection.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    print(f'gather: {len(built)} objects, {sum(1 for *_, s in built if s)} seats, {len(skipped)} duplicates left out')
    return 'entities/gather/collection.json'


# ---------------------------------------------------------------------------------------------------- check

def check(dist=None):
    """Problems in the sources and, given a dist, in its built collection; [] when all is well."""
    problems = []
    doc, names = catalog(), json.loads((SRC / 'names-pt.json').read_text())
    for sha in {f['main'] for f in doc['furniture']} | {f['foreground'] for f in doc['furniture'] if f['foreground']} \
            | {x['sha'] for k in ('floors', 'walls', 'doors') for x in doc[k]}:
        path = SRC / 'files' / f'{sha}.png'
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != sha:
            problems.append(f'source {sha[:12]}: missing or changed')
    keys = {f"{f['category']}/{f['family']}/{f['type']}" for f in doc['furniture']}
    problems += [f'names-pt.json: no name for {k}' for k in sorted(keys - set(names))]
    problems += [f'names-pt.json: unused key {k}' for k in sorted(set(names) - keys)]
    lower = Counter(n.lower() for n in names.values())
    problems += [f'names-pt.json: {n!r} names {c} pieces' for n, c in lower.items() if c > 1]
    problems += [f'unknown Gather colour {c}' for c in sorted({f['color'] for f in doc['furniture']} - set(COLOURS))]
    built, skipped = pieces()
    ids = Counter(p['id'] for p, _, _ in built)
    problems += [f'id {i} twice' for i, c in ids.items() if c > 1]
    for prefab, img, seat in built:
        where = f"{prefab['id']} {prefab['name']!r}"
        grid = prefab.get('collisionGrid')
        if grid and (img.width % T or img.height % T or len(grid) != img.height // T or
                     any(len(row) != img.width // T for row in grid)):
            problems.append(f'{where}: collision grid does not cover the {img.width}x{img.height} image')
        if prefab.get('depthOffset', 0) > 0 or -prefab.get('depthOffset', 0) > img.height + FLOOR_BEHIND:
            problems.append(f"{where}: depthOffset {prefab['depthOffset']} outside the image")
        if not img.getchannel('A').getbbox():
            problems.append(f'{where}: empty image')
        if seat:
            a = seat['anchorOffset']
            if not (0 <= a['x'] < img.width and 0 <= a['y'] < img.height):
                problems.append(f'{where}: seat anchor {a} outside the image')
            cell = (a['x'] // T, (a['y'] + SEAT_LIFT) // T)
            if grid and grid[cell[1]][cell[0]]:
                problems.append(f'{where}: the sitting cell collides')
    problems += [f'{pid}: left out, {why}' for pid, published, why in skipped if published]
    if dist:
        path = Path(dist) / 'entities/gather/collection.json'
        served = json.loads(path.read_text())
        if served['collection'] != [p for p, _, _ in built]:
            problems.append(f'{path}: differs from a fresh build')
        for prefab in served['collection']:
            if not (path.parent / prefab['imagePath']).is_file():
                problems.append(f"{prefab['id']}: image {prefab['imagePath']} missing in {path.parent}")
        # A name another collection of the map also uses shows twice in the panel's search, with nothing to tell
        # the two apart (names-pt.json adds " (Gather)" to those).
        others = {e['name'].lower() for c in Path(dist).glob('entities/**/collection.json') if c != path
                  for e in json.loads(c.read_text())['collection']}
        problems += [f'name {n!r} is also in another collection of {dist}'
                     for n in sorted({p['name'] for p in served['collection'] if p['name'].lower() in others})]
    stats = dict(objects=len(built), entries=len({(p['name']) for p, _, _ in built}),
                 seats=sum(1 for *_, s in built if s), unpublished_duplicates_left_out=len(skipped),
                 categories=dict(sorted(Counter(p['tags'][0] for p, _, _ in built).items())))
    return problems, stats


def board(cat, out):
    """One built category as a labelled sheet: each entry's first variant, collision cells and seat anchor marked."""
    first = {}
    for prefab, img, seat in pieces()[0]:
        if prefab['tags'][0] == cat:
            first.setdefault(prefab['name'], (prefab, img, seat))
    S, W = 2, 1600
    tiles = []
    for name, (prefab, img, seat) in first.items():
        bg = Image.new('RGBA', img.size, (232, 232, 228, 255))
        d = ImageDraw.Draw(bg)
        for r, row in enumerate(prefab.get('collisionGrid') or []):
            for c, v in enumerate(row):
                if v:
                    d.rectangle((c * T, r * T, c * T + T - 1, r * T + T - 1), fill=(255, 190, 190, 255))
        bg.alpha_composite(img)
        line = img.height + prefab.get('depthOffset', 0)
        ImageDraw.Draw(bg).line((0, line, img.width, line), fill=(0, 150, 0, 255))
        if seat:
            a = seat['anchorOffset']
            ImageDraw.Draw(bg).ellipse((a['x'] - 2, a['y'] - 2, a['x'] + 2, a['y'] + 2), fill=(0, 0, 255, 255))
        tiles.append((name, bg.resize((img.width * S, img.height * S), Image.Resampling.NEAREST)))
    x = y = rowh = 0
    placed = []
    for name, im in tiles:
        w = max(im.width, 150)
        if x + w > W:
            x, y, rowh = 0, y + rowh + 18, 0
        placed.append((x, y, name, im))
        x, rowh = x + w + 8, max(rowh, im.height)
    sheet = Image.new('RGB', (W, y + rowh + 20), 'white')
    d = ImageDraw.Draw(sheet)
    for x, y, name, im in placed:
        sheet.paste(im, (x, y + 14), im)
        d.text((x, y), name[:26], fill='black')
    sheet.save(out)
    print(f'{len(tiles)} entries -> {out}')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('import').add_argument('collector')
    sub.add_parser('build').add_argument('dist')
    sub.add_parser('check').add_argument('dist', nargs='?')
    b = sub.add_parser('board')
    b.add_argument('category')
    b.add_argument('out')
    args = parser.parse_args(argv)
    if args.command == 'import':
        import_collector(args.collector)
    elif args.command == 'build':
        build(args.dist)
    elif args.command == 'check':
        problems, stats = check(args.dist)
        print(json.dumps(stats, ensure_ascii=False, indent=1))
        for p in problems:
            print('PROBLEM', p)
        sys.exit(1 if problems else 0)
    else:
        board(args.category, args.out)


if __name__ == '__main__':
    main()
