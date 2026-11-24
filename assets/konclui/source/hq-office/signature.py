"""Koncluí pieces drawn for the HQ office, in the catalogue's pixel language: 32 px tiles, 3/4 view, flat light from the
top left, two or three tones per material and an outline in the material's own dark tone (never black).

  pieces() -> {type: {colour: dict(image, collisionGrid, depthOffset, surface, seat)}}
    'Koncluí: LED wall'         7 x 2 tiles, hung on a face: ink bezel, navy-to-petrol screen, the white wordmark
    'Koncluí: reception desk'   5 x 2 tiles: oak top, ink front with the white K and a mint light line
    'Koncluí: logo totem'       1 x 3 tiles: an ink totem with the turquoise K, at the entrance
    'Koncluí: planter'          2 x 2 tiles: a white planter box with grasses, for the glass fronts
    'Koncluí: sino da venda'    1 x 2 tiles: the sales bell, brass on an oak yoke over a reception-style plinth
    'Koncluí: quadro <id>'      framed pictures of the brand, of Koru and of restaurants (frames.py)
    the café lounge and games room's pieces (lounge.py): panel, neon, credenza, bar, stools, cushions, rugs, pendant...
"""
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from palette import INK, MINT, NAVY, PETROL, TURQUOISE, floor_tile, rgb

T = 32
ASSETS = Path(__file__).resolve().parent.parent / 'brand'


def svg(name, width=None, height=None):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / 'r.png'
        size = ['-w', str(width)] if width else ['-h', str(height)]
        subprocess.run(['rsvg-convert', *size, str(ASSETS / name), '-o', str(out)], check=True)
        img = Image.open(out).convert('RGBA')
    return img.crop(img.getbbox())


def crisp(img, colour):
    """A rasterised logo as pixel art: alpha thresholded, filled with one colour."""
    a = np.asarray(img)[..., 3] > 110
    out = np.zeros((*a.shape, 4), np.uint8)
    out[a] = (*rgb(colour), 255)
    return Image.fromarray(out, 'RGBA')


def led_wall():
    w, h = 7 * T, 60
    img = Image.new('RGBA', (w, 64))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 2, w - 1, h - 1), fill=rgb(INK))
    top, bottom = np.array(rgb(NAVY), float), np.array(rgb(PETROL), float)
    for y in range(6, h - 5):
        t = (y - 6) / (h - 12)
        d.line((5, y, w - 6, y), fill=tuple((top * (1 - t) + bottom * t).astype(int)))
    d.line((5, 6, w - 6, 6), fill=rgb('#2B3A78'))
    mark = crisp(svg('logo-konclui-white.svg', width=120), '#FFFFFF')
    img.alpha_composite(mark, ((w - mark.width) // 2, (h - mark.height) // 2 - 2))
    d.line(((w - 60) // 2, h - 12, (w + 60) // 2, h - 12), fill=rgb(MINT))
    d.rectangle((0, h, w - 1, 63), fill=(10, 10, 61, 40))
    return img


def reception_desk():
    w = 5 * T
    img = Image.new('RGBA', (w, 64))
    d = ImageDraw.Draw(img)
    oak = [rgb(c) for c in ('#8C6646', '#C29B74', '#D4B28C', '#E0C29E', '#EAD4B6')]
    d.rectangle((0, 2, w - 1, 22), fill=oak[3])                       # top
    for y in range(6, 22, 5):
        d.line((2, y, w - 3, y), fill=oak[2])
    d.line((1, 2, w - 2, 2), fill=oak[4])
    d.rectangle((0, 2, w - 1, 22), outline=oak[0])
    d.rectangle((2, 23, w - 3, 58), fill=rgb(INK))                   # front
    d.line((2, 23, w - 3, 23), fill=rgb(MINT))                       # light line under the top
    d.line((2, 24, w - 3, 24), fill=rgb('#1C7F70'))
    k = crisp(svg('logo-konclui-icon.svg', height=22), '#FFFFFF')
    img.alpha_composite(k, ((w - k.width) // 2, 30))
    d.rectangle((2, 23, w - 3, 58), outline=rgb('#05061A'))
    d.rectangle((1, 59, w - 2, 62), fill=(10, 10, 61, 60))           # shadow
    return img


def logo_totem():
    img = Image.new('RGBA', (T, 3 * T))
    d = ImageDraw.Draw(img)
    d.rectangle((6, 4, 25, 88), fill=rgb(INK), outline=rgb('#05061A'))
    d.rectangle((6, 4, 25, 9), fill=rgb('#1B2A6B'))                  # top face
    d.line((7, 10, 7, 87), fill=rgb('#2B3A78'))
    k = crisp(svg('logo-konclui-icon.svg', width=13), TURQUOISE)
    img.alpha_composite(k, (10, 26))
    d.rectangle((4, 89, 27, 92), fill=(10, 10, 61, 60))
    return img


def planter():
    img = Image.new('RGBA', (2 * T, 2 * T))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(3)
    for i in range(60):                                              # grasses
        x = 6 + int(rng.uniform(0, 52))
        hgt = int(rng.uniform(10, 26))
        lean = int(rng.uniform(-3, 4))
        col = rgb(('#2F6B3A', '#4E9A52', '#6BB86A', '#8FD18A')[int(rng.uniform(0, 4))])
        d.line((x, 40, x + lean, 40 - hgt), fill=col)
    d.rectangle((3, 36, 60, 60), fill=rgb('#F5FAFC'), outline=rgb('#B8C7CF'))   # box
    d.rectangle((3, 36, 60, 40), fill=rgb('#FFFFFF'), outline=rgb('#B8C7CF'))
    d.rectangle((5, 38, 58, 39), fill=rgb('#5A4634'))                # soil
    d.line((4, 59, 59, 59), fill=rgb('#C9D6DC'))
    d.rectangle((2, 61, 61, 63), fill=(10, 10, 61, 45))
    return img


@lru_cache(maxsize=None)
def pieces():
    return {**reception_pieces(), **desk_pieces(), **FRAMES.pieces(), **LOUNGE.pieces(),
        'Koncluí: LED wall': {'ink': dict(image=led_wall(), collisionGrid=None, depthOffset=-1)},
        'Koncluí: reception desk': {'oak': dict(image=reception_desk(), collisionGrid=[[1] * 5, [0] * 5],
                                                depthOffset=-53, surface=20)},
        'Koncluí: logo totem': {'ink': dict(image=logo_totem(), collisionGrid=[[0], [0], [1]], depthOffset=-6)},
        'Koncluí: planter': {'white': dict(image=planter(), collisionGrid=None, depthOffset=-5)},
    }


NAMES = {'Koncluí: LED wall': 'Telão de LED Koncluí', 'Koncluí: reception desk': 'Balcão de recepção Koncluí',
         'Koncluí: logo totem': 'Totem com o K', 'Koncluí: planter': 'Floreira branca'}


# ------------------------------------------------------------------------------------------------ reception set

def feature_wall(width):
    """The reception's feature wall, as a two-row face `width` px wide: oak slats, a central ink panel with the white
    wordmark and a mint line, five spotlights washing the slats from the top."""
    img = Image.new('RGBA', (width, 2 * T))
    d = ImageDraw.Draw(img)
    oak = [rgb(c) for c in ('#8C6646', '#B88F66', '#CFAA80', '#DEBF98', '#E9D2B2')]
    d.rectangle((0, 4, width - 1, 5), fill=rgb(INK))                       # cap line, like the walls
    d.line((0, 6, width - 1, 6), fill=rgb('#2B3A78'))
    for x in range(0, width):                                              # slats 4 px, 1 px shadow gap
        col = oak[0] if x % 5 == 4 else oak[2 + (x // 5) % 2]
        d.line((x, 7, x, 59), fill=col)
    for i in range(5):                                                     # light wash from the spots
        cx = int(width * (i + 0.5) / 5)
        for y in range(7, 30):
            half = 3 + (y - 7) // 3
            for x in range(cx - half, cx + half + 1):
                if 0 <= x < width and x % 5 != 4:
                    d.point((x, y), fill=oak[4] if y < 20 else oak[3])
        d.rectangle((cx - 1, 7, cx + 1, 8), fill=(255, 255, 255))
    pw = int(width * 0.56)
    px0 = (width - pw) // 2
    d.rectangle((px0, 12, px0 + pw - 1, 54), fill=rgb(INK))
    d.rectangle((px0, 12, px0 + pw - 1, 54), outline=rgb('#05061A'))
    d.line((px0 + 1, 13, px0 + pw - 2, 13), fill=rgb('#1B2A6B'))
    mark = crisp(svg('logo-konclui-white.svg', width=int(pw * 0.72)), '#FFFFFF')
    img.alpha_composite(mark, ((width - mark.width) // 2, 33 - mark.height // 2 - 2))
    d.line(((width - 70) // 2, 47, (width + 70) // 2, 47), fill=rgb(MINT))
    d.line((0, 60, width - 1, 60), fill=rgb(INK))                          # floor channel, as the glass
    d.rectangle((0, 61, width - 1, 63), fill=(10, 10, 61, 40))
    return img


def entrance_mat():
    img = Image.new('RGBA', (3 * T, 2 * T))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((2, 4, 93, 59), radius=4, fill=rgb('#1A2340'), outline=rgb('#0C1224'))
    for y in range(8, 56, 3):                                              # ribbed coir texture
        d.line((6, y, 89, y), fill=rgb('#222D50'))
    k = crisp(svg('logo-konclui-icon.svg', height=26), MINT)
    img.alpha_composite(k, ((96 - k.width) // 2, 18))
    return img


def rug(w_tiles, h_tiles):
    w, h = w_tiles * T, h_tiles * T
    img = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((2, 2, w - 3, h - 3), radius=10, fill=rgb('#D9D1C5'), outline=rgb('#ADA393'))  # greige wool
    d.rounded_rectangle((7, 7, w - 8, h - 8), radius=7, outline=rgb('#C2B8A8'))
    d.rounded_rectangle((9, 9, w - 10, h - 10), radius=6, outline=rgb('#E6E0D6'))
    rng = np.random.default_rng(w * h)
    for _ in range(w * h // 30):                                           # wool flecks
        x, y = int(rng.uniform(12, w - 12)), int(rng.uniform(12, h - 12))
        d.point((x, y), fill=rgb(('#D1C8BB', '#E0D9CE')[int(rng.uniform(0, 2))]))
    return img


# ------------------------------------------------------------------------------------------------ floor patterns
# tile_pattern(kind) is the picture build.paint() repeats over a floor zone from the map's origin, so its size is a
# multiple of the 32 px tile: 64 x 64 for a set whose joints sit on a 64 px grid (the hall's porcelain, the pod carpet),
# a 32 x 32 tile for an edge or a threshold that one row or column of the plan repeats, a wider picture for a material
# that must not repeat on a short period (the terrazzo). Each kind is drawn from its own seed, so a rebuild is
# byte-identical. Brick (the rooms' oak slats) and herringbone are the catalogue's single tiles: they repeat on
# purpose and are not drawn here.

CARPET_MIST = rgb('#E5EDF1')          # the pod carpet: one step under the hall's porcelain (#F2F6F8), no stripe, no seam
AUD = dict(base=rgb('#295964'), mid=rgb('#23505A'), dark=rgb('#1E454D'), edge=rgb('#183B43'), line=rgb('#3B7480'))
OAK = dict(lit=rgb('#EBDDC8'), mid=rgb('#D5BE9F'), line=rgb('#C6AB8B'), edge=rgb('#A98A65'))
AUD_EDGES = ('audience-w', 'audience-e', 'audience-s', 'audience-sw', 'audience-se')
FLOOR_PATTERNS = ('porcelain', 'boardwalk', 'terrazzo', 'terrazzo-pool', 'pod', 'audience', *AUD_EDGES, 'riser', 'cafe-sill', 'path')


def _canvas(w, h, colour):
    a = np.empty((h, w, 3))
    a[:] = colour
    return a


def _image(a):
    h, w = a.shape[:2]
    return Image.fromarray(np.dstack([np.clip(a.round(), 0, 255), np.full((h, w), 255)]).astype(np.uint8), 'RGBA')


def _pod_carpet():
    """The pod carpet, 64 x 64: one flat mist tone with sparse flecks under 3 % contrast (a bouclé, not a stripe), and
    modular carpet-tile seams on the same 64 px grid as the hall's porcelain, so the two floors speak one grid. No
    joint on the 32 px tile boundary: every edge column and row of the four tiles is the body."""
    rng = np.random.default_rng(31)
    a = _canvas(64, 64, CARPET_MIST)
    for colour, share in ((rgb('#DCE6EB'), 0.07), (rgb('#EEF4F7'), 0.05)):        # -7 and +7 levels
        hit = rng.uniform(size=(64, 64)) < share
        a[hit] = colour
    a[0, :] = rgb('#DAE4E9')                                                       # the seams: one pixel, on the grid
    a[:, 0] = rgb('#DAE4E9')
    return _image(a)


def _audience_field(w, h):
    """The auditorium carpet, w x h: petrol with a 6 px dark stripe centred on every 32 px tile boundary (so on the gap
    between two seats, never under one: a seat sits at the middle of its tile), a mid tone on each side and a one pixel
    dither on that rim. No grain: the carpet is one 32 px tile (the stripes repeat by design, as the brick does)."""
    a = _canvas(w, h, AUD['base'])
    x = np.arange(w)[None, :] % 32
    y = np.arange(h)[:, None]
    core = (x <= 2) | (x >= 29)
    rim = np.where(y % 2 == 0, x == 3, x == 28) | np.where(y % 2 == 0, x == 28, x == 4)
    a[np.broadcast_to(core, (h, w))] = AUD['dark']
    a[np.broadcast_to(rim & ~core, (h, w))] = AUD['mid']
    return a


def _audience(kind):
    """'audience' is the carpet over the audience (one 32 x 32 tile); the edge tiles (32 x 32) are the same carpet
    with a binding: a 4 px dark edge on the wall side and a pale pin line 2 px inside it ('audience-w', '-e' down the sides,
    '-s' along the front, '-sw' and '-se' the corners). 'riser' is the front of the stage."""
    a = _audience_field(32, 32)
    if kind == 'audience':
        return _image(a)
    if kind == 'riser':
        a[0:8] = AUD['base']
        face = _canvas(32, 8, rgb('#A98563'))
        face[0] = rgb('#E6D2B5')                                                   # the lip catches the light
        face[7] = rgb('#7A5A3A')                                                   # the foot of the face
        face[:, [15, 16]] = rgb('#96744F')                                         # a panel joint
        a[0:8] = face
        return _image(a)
    sides = kind.split('-')[1]
    lo, hi = (6 if 'w' in sides else 0), (25 if 'e' in sides else 31)
    if 'w' in sides:
        a[:25 + 1 if 's' in sides else 32, 6] = AUD['line']                       # the pin lines first, the bindings over them
    if 'e' in sides:
        a[:25 + 1 if 's' in sides else 32, 25] = AUD['line']
    if 's' in sides:
        a[25, lo:hi + 1] = AUD['line']
    if 'w' in sides:
        a[:, 0:4] = AUD['edge']
    if 'e' in sides:
        a[:, 28:32] = AUD['edge']
    if 's' in sides:
        a[28:32, :] = AUD['edge']
    return _image(a)


POOL = 16                              # the terrazzo's distinct tiles


def _terrazzo_pool():
    """The reception's terrazzo without the 64 px repeat, 13 x 8 tiles (416 x 256 px): a pale ground with grey, teal and sand chips, as before,
    but laid from a pool of 16 distinct tiles so that no tile has a twin in the eight cells around it (nor, with 16 to
    choose from, two cells away along a row or column) and no chip repeats every 64 px. A chip never crosses a tile edge and the grain is per pixel, so the joints do not show. The picture
    repeats every 13 tiles, more than the 12 that a periodicity check looks for. It costs 12 more floor tiles than 'terrazzo',
    which the palette ratchet counts (tools/palettesnap.py), so plan.FLOORS['reception'] flips to it together with that baseline."""
    rng = np.random.default_rng(23)
    pool = []
    for _ in range(POOL):
        a = _canvas(32, 32, rgb('#EEF2F3'))
        a += rng.normal(0, 1.0, (32, 32, 1))
        for colour, n in (('#C9D3D8', 17 + int(rng.integers(-1, 2))), ('#A9B6BD', 7), ('#7FD9C9', 2),
                          ('#D8C2A3', 2 + int(rng.integers(0, 2)))):
            for _ in range(n):
                x, y = int(rng.integers(0, 31)), int(rng.integers(0, 32))
                a[y, x] = rgb(colour)
                if rng.uniform() < 0.35:
                    a[y, x + 1] = rgb(colour)
        pool.append(a)
    cols, rows = 13, 8
    laid = {}
    for ty in range(rows):
        for tx in range(cols):
            # no twin in the eight cells around (cost 10), then as few as possible in the ring of 16 beyond them (cost 1)
            cost = [sum(10 if max(abs(u - tx), abs(v - ty)) < 2 else 1
                        for u in range(tx - 2, tx + 3) for v in range(ty - 2, ty + 3)
                        if laid.get((u % cols, v % rows)) == k and (u, v) != (tx, ty)) for k in range(len(pool))]
            best = min(cost)
            laid[(tx, ty)] = int(rng.choice([k for k, c in enumerate(cost) if c == best]))
    out = np.empty((rows * 32, cols * 32, 3))
    for (tx, ty), k in laid.items():
        out[ty * 32:ty * 32 + 32, tx * 32:tx * 32 + 32] = pool[k]
    return _image(out)


def _path():
    """The entrance path, one 32 x 32 tile of porcelain slab: the hall's own joint (a dark pixel row and column, a pale one
    beside it) but on a 32 px grid, so that every joint of the hall's 64 px grid continues into the path at the same column
    and the doorway's last joint (y 1600) is the path's first. Replaces the catalogue's 16 px slabs, a grid the hall never
    speaks."""
    a = _canvas(32, 32, rgb('#F5F9FA'))
    a[0, :] = rgb('#DCE5EA')                                                       # the same four lines, in the same order
    a[:, 0] = rgb('#DCE5EA')
    a[1, :] = rgb('#FAFCFD')
    a[:, 1] = rgb('#FAFCFD')
    return _image(a)


def _cafe_sill():
    """The threshold between the café's herringbone and the lounge's planks, 32 x 32: the café's herringbone with a 4 px
    oak sill along its south edge (a lit top, two oak rows, a dark foot), so the change of floor is a made joint."""
    a = np.asarray(floor_tile('Wood_Herringbone_LightWood', 'oak')).astype(float)[..., :3].copy()
    for row, colour in zip(range(28, 32), (OAK['lit'], OAK['mid'], OAK['line'], OAK['edge'])):
        a[row] = colour
    return _image(a)


def tile_pattern(kind):
    """Floor patterns of this office: large-format porcelain for the hall, terrazzo for the reception, oak planks for the
    boardwalk, and the pod, auditorium and café floors listed in FLOOR_PATTERNS (see the notes above)."""
    if kind == 'terrazzo-pool':
        return _terrazzo_pool()
    if kind == 'pod':
        return _pod_carpet()
    if kind == 'audience' or kind in AUD_EDGES or kind == 'riser':
        return _audience(kind)
    if kind == 'cafe-sill':
        return _cafe_sill()
    if kind == 'path':
        return _path()
    rng = np.random.default_rng(11 if kind == 'porcelain' else 23)
    if kind == 'boardwalk':                    # the bridge's oak planks, across the walk, leading to it
        oak = np.array([rgb(c) for c in ('#B88F66', '#CFAA80', '#DEBF98', '#E9D2B2')], float)
        a = np.empty((64, 64, 3))
        for i in range(0, 64, 6):
            a[:, i:i + 6] = oak[1 + int(rng.integers(0, 3))]
            a[:, (i + 5) % 64] = oak[0]
        a[::2, :] += rng.normal(0, 1.2, (32, 64, 1))
        out = np.dstack([np.clip(a, 0, 255), np.full((64, 64), 255)]).astype(np.uint8)
        return Image.fromarray(out, 'RGBA')
    if kind == 'porcelain':
        a = np.empty((64, 64, 3))
        a[:] = rgb('#F2F6F8')
        a += rng.normal(0, 1.4, (64, 64, 1))
        a[0, :] = rgb('#DCE5EA')
        a[:, 0] = rgb('#DCE5EA')
        a[1, :] = rgb('#FAFCFD')
        a[:, 1] = rgb('#FAFCFD')
    elif kind == 'terrazzo':                   # unchanged: the 64 px terrazzo (see 'terrazzo-pool' for the one that does not repeat)
        a = np.empty((64, 64, 3))
        a[:] = rgb('#EEF2F3')
        a += rng.normal(0, 1.0, (64, 64, 1))
        for colour, n in (('#C9D3D8', 70), ('#A9B6BD', 26), ('#7FD9C9', 7), ('#D8C2A3', 10)):
            for _ in range(n):
                x, y = int(rng.uniform(0, 63)), int(rng.uniform(0, 63))
                a[y, x] = rgb(colour)
                if rng.uniform() < 0.35:
                    a[y, (x + 1) % 64] = rgb(colour)
    else:
        raise ValueError(f'no floor pattern {kind!r}; known: {", ".join(FLOOR_PATTERNS)}')
    out = np.dstack([np.clip(a, 0, 255), np.full((64, 64), 255)]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def sales_bell():
    """The sales bell (runtime/bell.mjs), 1 x 2 tiles: a brass bell with its clapper and a red rope, hung from an oak
    yoke on a plinth dressed as the reception desk (oak top, ink front, mint light line). The brass is lit from the top
    left: a pale rim on the left, a highlight streak, the body, then two shade tones to the right."""
    img = Image.new('RGBA', (T, 2 * T))
    d = ImageDraw.Draw(img)
    oak = [rgb(c) for c in ('#7A5636', '#B88F66', '#CFAA80', '#E0C29E')]          # line, shade, mid, lit
    brass = dict(line=rgb('#6B430F'), dark=rgb('#A36A17'), mid=rgb('#D69A2A'), base=rgb('#E8B53F'),
                 light=rgb('#F5D271'), spec=rgb('#FFF0BF'))
    d.rectangle((1, 61, 30, 62), fill=(10, 10, 61, 50))                             # contact shadow
    d.rectangle((1, 49, 30, 55), fill=oak[3], outline=oak[0])                       # plinth: oak top
    d.line((2, 52, 29, 52), fill=oak[2])
    d.line((2, 50, 29, 50), fill=rgb('#EAD4B6'))
    d.rectangle((1, 56, 30, 60), fill=rgb(INK), outline=rgb('#05061A'))             # ink front
    d.line((2, 56, 29, 56), fill=rgb(MINT))
    d.line((2, 57, 29, 57), fill=rgb('#1C7F70'))
    for x0 in (2, 26):                                                              # the yoke's uprights
        d.rectangle((x0, 17, x0 + 3, 51), fill=oak[2], outline=oak[0])
        d.line((x0 + 1, 18, x0 + 1, 50), fill=oak[3])
    d.rectangle((1, 13, 30, 17), fill=oak[2], outline=oak[0])                       # crossbar: lit top, front
    d.line((2, 14, 29, 14), fill=oak[3])
    d.line((2, 16, 29, 16), fill=oak[1])
    d.rectangle((15, 18, 16, 20), fill=rgb('#3A3A4E'))                             # iron hanger
    d.point((15, 18), fill=rgb('#6A6A80'))
    rows = {21: (13, 18), 22: (12, 19), 23: (11, 20), 24: (11, 20), 25: (11, 20), 26: (10, 21), 27: (10, 21),
            28: (10, 21), 29: (10, 21), 30: (9, 22), 31: (9, 22), 32: (9, 22), 33: (8, 23), 34: (7, 24), 35: (7, 24),
            36: (8, 23)}
    for y, (x0, x1) in rows.items():
        for x in range(x0, x1 + 1):
            f = (x - x0) / (x1 - x0)
            tone = ('line' if x in (x0, x1) or y == 21 and 0 < f < 1 and x in (x0 + 1, x1 - 1) else
                    'light' if f < 0.2 else 'spec' if f < 0.3 else 'base' if f < 0.6 else 'mid' if f < 0.8 else 'dark')
            if y == 21 and tone != 'line':
                tone = 'mid'
            if y == 34 and tone not in ('line', 'dark'):
                tone = 'light'                                                     # the lip's lit rim
            if y == 36 and tone != 'line':
                tone = 'dark'                                                      # under the lip
            d.point((x, y), fill=brass[tone])
    d.rectangle((14, 37, 17, 38), fill=brass['dark'], outline=brass['line'])       # clapper
    rope_light, rope_dark = rgb('#D9454B'), rgb('#8E222A')
    for x, y in ((18, 38), (18, 39), (19, 40)):                                     # rope from the clapper
        d.point((x, y), fill=rope_dark)
    d.line((19, 41, 19, 44), fill=rope_light)
    d.line((20, 41, 20, 44), fill=rope_dark)
    d.line((19, 45, 20, 45), fill=brass['base'])                                    # tassel: a brass ring, red fringe
    d.rectangle((18, 46, 21, 47), fill=rope_light)
    d.line((21, 46, 21, 47), fill=rope_dark)
    for x in (18, 20):
        d.point((x, 48), fill=rope_dark)
    return img


@lru_cache(maxsize=None)
def reception_pieces():
    return {
        'Koncluí: entrance mat': {'ink': dict(image=entrance_mat(), collisionGrid=None, depthOffset=-(64 + 96))},
        'Koncluí: rug 5x3': {'mist': dict(image=rug(5, 3), collisionGrid=None, depthOffset=-(96 + 96))},
        'Koncluí: rug 10x5': {'mist': dict(image=rug(10, 5), collisionGrid=None, depthOffset=-(160 + 96))},
        # the plinth's front edge (row 60) sorts it: people in front of the bell pass over it, behind it under
        'Koncluí: sino da venda': {'ouro': dict(image=sales_bell(), collisionGrid=[[0], [1]], depthOffset=-4)},
    }


NAMES.update({'Koncluí: entrance mat': 'Tapete de entrada com o K', 'Koncluí: rug 5x3': 'Tapete de lã 5×3',
              'Koncluí: rug 10x5': 'Tapete de lã 10×5', 'Koncluí: sino da venda': 'Sino da venda'})


# ------------------------------------------------------------------------------------------------ desk set

def photo_frame(kind):
    """A small standing photo frame for a desk: an oak frame around a 10 x 8 px picture."""
    img = Image.new('RGBA', (14, 14))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 1, 13, 11), fill=rgb('#B88F66'), outline=rgb('#7A5A3A'))
    pic = {'beach': [('#8FD3F0', 0, 4), ('#F2D9A0', 5, 7), ('#3D7BD6', 4, 4)],
           'mountain': [('#A6C9F2', 0, 3), ('#7C8E9E', 3, 6), ('#4F9D55', 6, 7), ('#FFFFFF', 3, 3)],
           'pet': [('#E8DCC8', 0, 7), ('#9D6B44', 3, 7), ('#5D3A22', 2, 3)],
           'family': [('#F6C08C', 0, 7), ('#3D7BD6', 5, 7), ('#D24A3F', 4, 7), ('#5D3A22', 2, 3)]}[kind]
    for colour, y0, y1 in pic:
        d.rectangle((2, 3 + y0, 11, 3 + y1), fill=rgb(colour))
    if kind == 'pet':
        d.ellipse((5, 5, 9, 9), fill=rgb('#9D6B44'))
        d.point((6, 6), fill=rgb('#1A1F1E'))
        d.point((8, 6), fill=rgb('#1A1F1E'))
    if kind == 'family':
        for x, c in ((4, '#5D3A22'), (7, '#2D2D38'), (10, '#9D6B44')):
            d.ellipse((x - 1, 4, x + 1, 6), fill=rgb('#F6C08C'), outline=rgb(c))
    d.line((5, 12, 8, 12), fill=rgb('#7A5A3A'))
    d.line((4, 13, 9, 13), fill=(10, 10, 61, 70))
    return img


@lru_cache(maxsize=None)
def desk_pieces():
    return {'Koncluí: photo frame': {k: dict(image=photo_frame(k), collisionGrid=None, depthOffset=0)
                                     for k in ('beach', 'mountain', 'pet', 'family')}}


NAMES.update({'Koncluí: photo frame': 'Porta-retratos'})


# ------------------------------------------------------------------------------------------------ framed pictures
import frames as FRAMES  # noqa: E402
import lounge as LOUNGE  # noqa: E402

NAMES.update(FRAMES.NAMES)
NAMES.update(LOUNGE.NAMES)
