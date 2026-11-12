"""Pieces cut from the sprite sheets the owner brought (sources/sheets/, 18/10/2026: "implemente eles pra gente"), for
the map editor and the plan.

  (in pieces())          the LimeZu Modern Office singles the main office already cut, named and measured
                         (office/modern_office.py, read only): its names, kinds, physics and seat contracts
  cut(sheet)            the pieces of a sheet whose objects stand apart on a transparent ground: connected parts of
                         the alpha on a 4 px grid (a gap of one cell keeps two objects apart), each piece masked to its
                         own part so a neighbour's pixels never come along; tiny and huge parts dropped
  pieces()               every piece of every sheet: dict(id, name, collection, source, key, category, colour,
                         direction, image, collisionGrid, depthOffset, seat); the editor category comes from
                         taxonomy.json by source and key, and the exact duplicates it lists are left out

Physics of the cut pieces, by kind (as the main office's Modern Office): 'tall' collides on the bottom covered row, a
plant never collides (owner, 18/10/2026), 'item' and 'floor' never collide. Curation (which parts are kept, their kind
and name) is in CUTS below, made by looking at the numbered contact sheets (sheets.py --sheets).
"""
import sys
from collections import deque
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

import taxonomy as TAX

HERE = Path(__file__).resolve().parent
SRC = HERE / 'sources/sheets'
T = 32
CELL = 4


def components(alpha, cell=CELL):
    """[(cell mask, (x0, y0, x1, y1) in px)] of the connected opaque parts, on a `cell` px grid, 8-connected."""
    h, w = alpha.shape
    gh, gw = -(-h // cell), -(-w // cell)
    pad = np.zeros((gh * cell, gw * cell), bool)
    pad[:h, :w] = alpha
    on = pad.reshape(gh, cell, gw, cell).any(axis=(1, 3))
    seen = np.zeros_like(on)
    out = []
    for sy, sx in zip(*np.nonzero(on)):
        if seen[sy, sx]:
            continue
        part = np.zeros_like(on)
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        while q:
            y, x = q.popleft()
            part[y, x] = True
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < gh and 0 <= nx < gw and on[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        ys, xs = np.nonzero(part)
        out.append((part, (xs.min() * cell, ys.min() * cell, min(w, (xs.max() + 1) * cell),
                           min(h, (ys.max() + 1) * cell))))
    return out


@lru_cache(maxsize=None)
def cut(sheet, min_px=60, max_side=8 * T):
    """[(number, RGBA image trimmed to its opaque box, (x, y) of that box in the sheet)] in reading order."""
    img = Image.open(SRC / sheet).convert('RGBA')
    a = np.asarray(img)
    alpha = a[..., 3] > 0
    found = []
    for part, (x0, y0, x1, y1) in components(alpha):
        mask = np.repeat(np.repeat(part, CELL, 0), CELL, 1)[:a.shape[0], :a.shape[1]]
        piece = a.copy()
        piece[~mask] = 0
        sub = piece[y0:y1, x0:x1]
        ys, xs = np.nonzero(sub[..., 3] > 0)
        if len(ys) < min_px:
            continue
        bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        if bx1 - bx0 > max_side or by1 - by0 > max_side or (bx1 - bx0) < 8 or (by1 - by0) < 8:
            continue
        found.append((Image.fromarray(sub[by0:by1, bx0:bx1].copy(), 'RGBA'), (x0 + bx0, y0 + by0)))
    found.sort(key=lambda f: (f[1][1] // T, f[1][0]))            # reading order, by rows of tiles
    return [(i, im, xy) for i, (im, xy) in enumerate(found)]


# ------------------------------------------------------------------------------------------------ curation
# Per sheet: the collection, which numbered parts stay out (wall and floor fragments, parts stuck together, and every
# chair or sofa: an object meant to sit on needs a seat contract, owner rule of 13/10/2026, and these have none), the
# kind of each part and its name. Numbers are those of the contact sheets (sheets.py --sheets).
LPC_INTERIOR_CHAIRS = {0, 18, 19, 27, 28, 40, 41, 42, 43, 58, 59, 73, 74, 75, 77, 78, 91}
CUTS = {
    'bookshelves.png': dict(
        collection='Estantes e livros', drop={34},
        kind=lambda i, im: 'tall' if i < 20 else 'item',
        name=lambda i: f'Estante {i + 1}' if i < 20 else f'Fileira de livros {i - 19}'),
    'indoor-plants.png': dict(
        collection='Plantas em vaso', drop=set(),
        kind=lambda i, im: 'plant', name=lambda i: f'Planta em vaso {i + 1}'),
    'lpc-interior.png': dict(
        collection='LPC', drop=LPC_INTERIOR_CHAIRS | {3, 44, 62, 63, 76} |
        {15, 16, 17, 20, 22, 26, 29, 32, 36, 37, 38, 54, 64, 81, 82, 88, 93, 94, 95, 96, 97},
        kind=lambda i, im: 'floor' if i in {8, 10, 11} else 'tall' if i in {
            1, 2, 4, 5, 6, 7, 9, 12, 39, 53, 55, 61, 65, 67, 68, 69, 72, 79, 86, 90, 92} else 'item',
        name=lambda i: f'Interior clássico {i:02d}'),
    'lpc-objects-plants-fish.png': dict(
        collection='LPC', drop={1, 177},
        kind=lambda i, im: 'tall' if im.height >= 56 and _fill(im) >= 0.35 else 'item',
        name=lambda i: f'Natureza e feira {i:03d}'),
    'lpc-terrains.png': dict(
        collection='LPC', drop=set(),
        kind=lambda i, im: 'tall' if i in {17, 18, 20, 21, 23, 28, 30, 31, 32, 33, 34, 36, 37, 38, 39, 43, 49, 50, 52}
        else 'item' if i in {53, 54, 55} else 'floor',
        name=lambda i: f'Terreno {i:02d}'),
}
MIN_SIDE, MIN_PX = 12, 100                     # smaller parts are loose leaves and crumbs


def _fill(im):
    return float((np.asarray(im)[..., 3] > 0).mean())


def standing(im):
    """The part on a canvas of whole tiles, standing on its bottom edge and centred: as the catalogue's pieces, so the
    collision grid lies under the object."""
    w, h = -(-im.width // T) * T, -(-im.height // T) * T
    canvas = Image.new('RGBA', (w, h))
    canvas.alpha_composite(im, ((w - im.width) // 2, h - im.height))
    return canvas


@lru_cache(maxsize=None)
def pieces(keep_all=False):
    """Every piece of every sheet, as dicts for build.py (see the module's notes), without the exact duplicates
    taxonomy.json leaves out (all of them with keep_all)."""
    sys.path.insert(0, str(HERE.parent / 'office'))
    import entity_categories
    import modern_office as MO                 # the main office's cut, names and physics (read only)
    out = []
    entries = MO.catalog()
    for n in sorted(entries):
        name, kind, colour, direction, tags = entries[n]
        img = Image.open(MO.SRC / f'modern-office-{n:03d}.png').convert('RGBA')
        grid, depth = MO.physics(img, kind)
        seat = None
        if n in MO.SEATS:
            (ax, ay), facing, _ = MO.SEATS[n]
            seat = dict(anchorOffset=dict(x=ax, y=ay), direction=facing)
        out.append(dict(id=f'mo-{n:03d}', name=name, collection='Escritório moderno', source='escritorio-moderno',
                        key=f'{entity_categories.office(kind, tags)}/{name}',
                        colour=colour, direction=direction, image=img, collisionGrid=grid, depthOffset=depth,
                        seat=seat))
    for sheet, spec in CUTS.items():
        slug = Path(sheet).stem
        for i, im, _ in cut(sheet):
            if i in spec['drop'] or min(im.size) < MIN_SIDE or _fill(im) * im.width * im.height < MIN_PX:
                continue
            kind = spec['kind'](i, im)
            canvas = standing(im)
            grid, depth = MO.physics(canvas, 'tall' if kind == 'tall' else 'item')
            if kind == 'floor':
                depth = canvas.getchannel('A').getbbox()[1] - canvas.height
            out.append(dict(id=f'{slug}-{i:03d}', name=spec['name'](i), collection=spec['collection'], source='folhas',
                            key=f'{slug}/{i:03d}', colour='#ffffff', direction='Down', image=canvas,
                            collisionGrid=grid if kind == 'tall' else None, depthOffset=depth, seat=None))
    for p in out:                              # the editor category: taxonomy.json, from the piece's source and key
        p['category'] = TAX.tag(p['source'], p['key'])
    if keep_all:
        return out
    ident = lambda p: (p['collection'], p['id'])
    return [p for source in ('escritorio-moderno', 'folhas')
            for p in TAX.keep(source, [p for p in out if p['source'] == source], lambda p: p['name'], ident)]


def contact_sheet(sheet, out, scale=2):
    """A numbered sheet of every cut part, for curation."""
    from PIL import ImageDraw
    parts = cut(sheet)
    cols, cw, ch = 12, 120, 132
    rows = -(-len(parts) // cols)
    canvas = Image.new('RGBA', (cols * cw, rows * ch), (236, 239, 242, 255))
    d = ImageDraw.Draw(canvas)
    for k, (n, im, _) in enumerate(parts):
        x, y = (k % cols) * cw, (k // cols) * ch
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST) if max(im.size) * scale <= 112 else im.copy()
        big.thumbnail((cw - 8, ch - 20), Image.NEAREST)
        canvas.alpha_composite(big, (x + 4, y + 4))
        d.text((x + 4, y + ch - 14), f'{n}  {im.width}x{im.height}', fill=(20, 20, 40, 255))
    canvas.save(out)
    return len(parts)


if __name__ == '__main__' and '--sheets' in sys.argv:
    for name in ('bookshelves.png', 'indoor-plants.png', 'lpc-interior.png', 'lpc-objects-plants-fish.png',
                 'lpc-terrains.png'):
        n = contact_sheet(name, f'/tmp/sheets/{Path(name).stem}-contact.png')
        print(name, n, 'parts')
