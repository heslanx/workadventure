"""Koncluí pieces drawn for the HQ office, in the catalogue's pixel language: 32 px tiles, 3/4 view, flat light from the
top left, two or three tones per material and an outline in the material's own dark tone (never black).

  pieces() -> {type: {colour: dict(image, collisionGrid, depthOffset, surface, seat)}}
    'Koncluí: LED wall'         7 x 2 tiles, hung on a face: ink bezel, navy-to-petrol screen, the white wordmark
    'Koncluí: reception desk'   5 x 2 tiles: an oak ledge with a desk set back behind it (a box: top and front face), a 22 px reeded face with a brass-framed navy panel and the white K
    'Koncluí: logo totem'       1 x 3 tiles: an ink totem with the turquoise K, at the entrance
    'Koncluí: planter'          2 x 2 tiles: a white planter box with grasses, for the glass fronts
    'Koncluí: sino da venda'    1 x 2 tiles: the sales bell, brass in a honey-oak frame on a plinth with the white K
    'Koncluí: quadro <id>'      framed pictures of the brand, of Koru and of restaurants (frames.py)
    the café lounge and games room's pieces (lounge.py): panel, neon, credenza, bar, stools, cushions, rugs, pendant...
"""
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import kmark
from palette import INK, MINT, NAVY, PETROL, TURQUOISE, floor_tile, rgb
from props import reception_counter as _reception_counter

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


RECEPTION_SURFACE = _reception_counter.SURFACE_ROW   # the working desk's top: the computer stands with its foot on this row of the counter's picture (24)


def reception_desk():
    """The reception counter, 5 x 2 tiles, baked from its recipe (props/reception_counter.py: true dimensions in metres, two
    levels, a 22 px face): the base front edge is the picture's last row, so its footprint is the lower tile row. The
    computer stands on the working desk (RECEPTION_SURFACE), the orchid on the ledge (plan.py's s)."""
    import bake
    from props import reception_counter
    baked = bake.bake(reception_counter.recipe(), overrides=False)
    art = Image.fromarray(baked.rgba, 'RGBA').crop((1, 0, 1 + 5 * T, baked.rgba.shape[0]))   # without the 1 px margins
    img = Image.new('RGBA', (5 * T, 2 * T))
    img.alpha_composite(art, (0, 2 * T - art.height))
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
        'Koncluí: telão da recepção': {'ink': dict(image=reception_screen(), collisionGrid=None, depthOffset=-1)},
        'Koncluí: reception desk': {'oak': dict(image=reception_desk(), collisionGrid=[[0] * 5, [1] * 5],
                                                depthOffset=0, surface=RECEPTION_SURFACE)},
        'Koncluí: logo totem': {'ink': dict(image=logo_totem(), collisionGrid=[[0], [0], [1]], depthOffset=-6)},
        'Koncluí: planter': {'white': dict(image=planter(), collisionGrid=None, depthOffset=-5)},
    }


NAMES = {'Koncluí: LED wall': 'Telão de LED Koncluí', 'Koncluí: telão da recepção': 'Telão de LED Koncluí, painel da recepção', 'Koncluí: reception desk': 'Balcão de recepção Koncluí',
         'Koncluí: logo totem': 'Totem com o K', 'Koncluí: planter': 'Floreira branca'}


# ------------------------------------------------------------------------------------------------ reception set

def _wordmark(width):
    """The white wordmark as crisp pixel art, a little bolder than the plain threshold: rendered at 4x, averaged down and
    cut at 38 % coverage, so the thin strokes keep a whole pixel. The K is not the threshold's: the vector's K has three
    parts (the stem fused with the arm, the leg, the foot) set off by thin gaps that a plain threshold turns into a wobble
    or fills, so the K's pixels are replaced by kmark.K_WALL, the logo's K drawn for this size (30 x 31), in the place the
    vector gives it. Returns (mask, k_mask)."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / 'r.png'
        subprocess.run(['rsvg-convert', '-w', str(width * 4), str(ASSETS / 'logo-konclui-white.svg'), '-o', str(out)],
                       check=True)
        big = Image.open(out).convert('RGBA')
    big = big.crop(big.getbbox())
    w, h = big.width // 4, big.height // 4
    cover = np.asarray(big)[..., 3].astype(float)[:h * 4, :w * 4].reshape(h, 4, w, 4).mean((1, 3)) / 255
    m = cover > 0.38
    p = np.pad(m, 1).astype(int)                                           # then no spur or pit one pixel wide
    n4 = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:])
    m = (m & (n4 > 1)) | (~m & (n4 >= 3))
    lab = np.zeros(m.shape, int)                                           # the K's parts: the pieces that start left of the 'o'
    n = 0
    for y0, x0 in zip(*np.nonzero(m)):
        if lab[y0, x0]:
            continue
        n += 1
        todo = [(y0, x0)]
        while todo:
            y, x = todo.pop()
            if 0 <= y < h and 0 <= x < w and m[y, x] and not lab[y, x]:
                lab[y, x] = n
                todo += [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    for i in range(1, n + 1):
        if np.nonzero((lab == i).any(0))[0][0] < KMARK_COLS:
            m[lab == i] = False
    k = np.zeros_like(m)
    kb = kmark.mask(kmark.K_WALL)
    k[:kb.shape[0], :kb.shape[1]] = kb
    kp = np.pad(k, 1)                                                      # the K and the o must not touch (8 neighbours)
    near = sum(kp[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) > 0
    assert not (near & m).any(), 'the K touches the o'
    return m | k, k


KMARK_COLS = 26                                                            # the o's first column is further right; the K's pieces start left of this


BRASS = dict(line='#6B430F', dark='#A36A17', base='#E8B53F')               # the sales bell's own brass tones
WALL_OAK = ('#8C6646', '#B88F66', '#CFAA80', '#DEBF98', '#E9D2B2')
BOARD = 8                                                                  # one oak board; the runs are whole pairs
SCREEN_W, SCREEN_Y0, SCREEN_Y1 = 178, 8, 57                                # the screen's canvas width and its rows
BAYS = (5, 283)                                                            # the picture bays' x on the face (356 wide)
GLASS = dict(top='#0F1E58', mid='#14296E', foot='#165586', sheen='#1F3A8C', seam='#0A1442')   # four flat tones, and the seam's


def _boards(d, x0, x1, oak, rng):
    """Oak boards 8 px wide from x0 to x1 (inclusive), rows 8 to 56: a lit edge, a body that alternates with its
    neighbour, a shade, a dark groove; one grain streak a board."""
    for n, bx in enumerate(range(x0, x1 + 1, BOARD)):
        body = oak[3] if n % 2 == 0 else oak[2]
        shade = oak[2] if n % 2 == 0 else oak[1]
        for k, col in enumerate((oak[4], body, body, body, body, shade, shade, oak[0])):
            if bx + k <= x1:
                d.line((bx + k, 8, bx + k, 56), fill=col)
        gy, gl = int(rng.integers(12, 44)), int(rng.integers(4, 8))
        if bx + 3 <= x1:
            d.line((bx + 3, gy, bx + 3, gy + gl), fill=shade)


def feature_wall(width):
    """The reception's feature wall, a two-row face `width` px wide: oak boards under the wall's ink cap, a brass-lined
    plinth, two bays for the pictures that hang at x 6 and width - 72 (plan.py) and, between them, the LED screen
    (reception_screen: a sprite hung on the wall, so that it can shine at night). The oak between a bay and the screen is
    two whole boards, 16 px."""
    img = Image.new('RGBA', (width, 2 * T))
    d = ImageDraw.Draw(img)
    oak = [rgb(c) for c in WALL_OAK]
    brass = {k: rgb(v) for k, v in BRASS.items()}
    d.rectangle((0, 4, width - 1, 5), fill=rgb(INK))                       # cap line, like the walls
    d.line((0, 6, width - 1, 6), fill=rgb('#2B3A78'))
    d.line((0, 7, width - 1, 7), fill=oak[0])                              # the shade under the cap's lip
    rng = np.random.default_rng(5)
    bay0, bay1 = BAYS[0] + 68, BAYS[1] - 1                                 # the oak between the bays: the screen's run
    _boards(d, 0, BAYS[0] - 1, oak, rng)
    _boards(d, bay0, bay0 + 2 * BOARD - 1, oak, rng)                       # west of the screen: 2 boards
    _boards(d, bay0 + 2 * BOARD, bay1 - 2 * BOARD, oak, rng)               # behind the screen
    _boards(d, bay1 - 2 * BOARD + 1, bay1, oak, rng)                       # east of the screen: 2 boards
    _boards(d, BAYS[1] + 68, width - 1, oak, rng)
    d.line((0, 57, width - 1, 57), fill=oak[2])                            # a plain ledge under the boards
    d.line((0, 58, width - 1, 58), fill=brass['base'])                     # a brass inlay along the plinth's top
    d.line((0, 59, width - 1, 59), fill=brass['dark'])
    d.line((0, 60, width - 1, 60), fill=oak[0])                            # the face's foot
    for bx in BAYS:                                                        # a bay round each picture
        d.rectangle((bx, 7, bx + 67, 58), fill=rgb('#6B4A31'))
        d.rectangle((bx + 1, 8, bx + 66, 57), fill=oak[1])
        d.rectangle((bx + 2, 9, bx + 65, 56), fill=rgb('#6B4A31'))
    return img


def reception_screen():
    """The LED screen on the feature wall, SCREEN_W x 64 px, hung with its x at the east edge of the oak's west run: an ink
    outline round the whole (the picture's own edge is ink, as every hung piece's is: the screen is flush with the wall's run,
    so its edge is the canvas edge), a thin brass edge inside it (the bell's brass: the line, then one dark tone), an ink
    bezel, and a navy glass of four flat tones: a top, a mid, a 3 px foot band and a sheen at the top-left corner. A cabinet
    header bar closes the glass's top. The white wordmark is the brand white in one flat tone, its K the logo's
    (kmark.K_WALL), with a mint LED line under it."""
    img = Image.new('RGBA', (SCREEN_W, 2 * T))
    d = ImageDraw.Draw(img)
    brass = {k: rgb(v) for k, v in BRASS.items()}
    x0, x1, y0, y1 = 0, SCREEN_W - 1, SCREEN_Y0, SCREEN_Y1
    d.rectangle((x0, y0, x1, y1), fill=rgb('#05061A'))                     # the outline: an ink, darker than the glass (tools/contract.py)
    d.rectangle((x0 + 1, y0 + 1, x1 - 1, y1 - 1), fill=brass['line'])      # the brass edge: line, then one dark tone
    bx0, bx1, by0, by1 = x0 + 2, x1 - 2, y0 + 2, y1 - 2
    d.rectangle((bx0, by0, bx1, by1), fill=brass['dark'])
    d.rectangle((bx0 + 1, by0 + 1, bx1 - 1, by1 - 1), fill=rgb(INK))
    d.line((bx0 + 1, by0 + 1, bx1 - 1, by0 + 1), fill=rgb('#2B3A78'))
    d.line((bx0 + 1, by0 + 1, bx0 + 1, by1 - 1), fill=rgb('#2B3A78'))
    sx0, sy0, sx1, sy1 = bx0 + 3, by0 + 3, bx1 - 3, by1 - 3                # the glass: rows 13 to 52
    g = {k: rgb(v) for k, v in GLASS.items()}
    hdr = 2                                                                # the header bar's rows
    d.rectangle((sx0, sy0 + hdr, sx1, sy1 - 3), fill=g['mid'])
    d.rectangle((sx0, sy0 + hdr, sx1, sy0 + hdr + 10), fill=g['top'])
    d.rectangle((sx0, sy1 - 2, sx1, sy1), fill=g['foot'])                  # the foot band, 3 px
    for y in range(sy0 + hdr, sy1 - 2):                                    # the sheen: two bars at the top-left corner
        for x in range(sx0, sx1 + 1):
            t = (x - sx0) + (y - sy0 - hdr)
            if 12 <= t <= 20 or 24 <= t <= 26:
                d.point((x, y), fill=g['sheen'])
    gw = (sx1 - sx0 + 1) / 6
    for k in range(1, 6):                                                  # the cabinets' seams: six modules, a dark line
        sx = sx0 + int(gw * k)
        d.line((sx, sy0 + hdr, sx, sy1 - 3), fill=rgb(GLASS['seam']))
    d.line((sx0 - 1, sy0 - 1, sx1 + 1, sy0 - 1), fill=rgb('#05061A'))      # the glass sits in the bezel: shade top/left
    d.line((sx0 - 1, sy0 - 1, sx0 - 1, sy1 + 1), fill=rgb('#05061A'))
    d.line((sx0 - 1, sy1 + 1, sx1 + 1, sy1 + 1), fill=rgb('#1B2A6B'))
    d.line((sx1 + 1, sy0 - 1, sx1 + 1, sy1 + 1), fill=rgb('#1B2A6B'))
    d.rectangle((sx0, sy0, sx1, sy0 + hdr - 1), fill=rgb('#1B2A6B'))       # the cabinet's header bar, with its status pips
    d.line((sx0, sy0 + hdr - 1, sx1, sy0 + hdr - 1), fill=rgb('#101A4C'))
    for px in (sx0 + 4, sx1 - 4):
        d.point((px, sy0 + 0), fill=rgb(MINT))
    mask, _ = _wordmark(136)
    mh, mw = mask.shape
    mx, my = (SCREEN_W - mw) // 2, sy0 + hdr + 2
    for yy, xx in zip(*np.nonzero(mask)):                                  # the brand white, the K as the logo draws it
        d.point((mx + xx, my + yy), fill=rgb(kmark.WHITE))
    d.line((mx, sy1 - 3, mx + mw - 1, sy1 - 3), fill=rgb(MINT))            # a mint LED line along the top of the foot band
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
    """The sales bell (runtime/bell.mjs), 1 x 2 tiles, the first thing a visitor rings: a brass bell with a shoulder, a
    waist and a flared lip, hung from a honey-oak frame (posts, a beam with brass finials and a brass hanger, brass
    corner plates) over a low oak plinth dressed as the reception desk (the counter's own oak ramp, an ink plate with
    the white K set in an oak border, a cyan reveal at the foot), a single cyan pull cord ending in a brass ball. Nothing
    is painted as shadow or glow: the runtime lights it; the K and the reveal are bright in their own pixels."""
    img = Image.new('RGBA', (T, 2 * T))
    px = img.load()

    def put(x, y, c):
        if 0 <= x < T and 0 <= y < 2 * T:
            px[x, y] = (*c, 255)

    def rect(x0, y0, x1, y1, c):
        for yy in range(y0, y1 + 1):
            for xx in range(x0, x1 + 1):
                put(xx, yy, c)

    # the plinth is on the office palette's warm oak ramp, a step from the counter's own oak (reception_desk): one
    # family; only its outline is darker
    oak = {k: rgb(c) for k, c in dict(line='#8C6646', dark='#C6AB8B', shade='#D9BA95', mid='#E0C29F', lit='#E8CCA8',
                                      hi='#F0D6B2').items()}
    # the frame's wood: honey oak, one step darker and warmer than the plinth's, well above the lounge's teak
    wd = {k: rgb(c) for k, c in dict(line='#6F4B2F', dark='#8F6844', shade='#A97F57', mid='#BC9168', light='#D9BA95',
                                     hi='#E8CCA8').items()}
    br = {k: rgb(c) for k, c in dict(line='#6B430F', dark='#C4851F', mid='#E8AC33', base='#F7CA4F', light='#FFE38C',
                                     spec='#FFF8DA').items()}
    ink, ink_line, ink_lit = rgb(INK), rgb('#05061A'), rgb('#142160')
    cyan, cyan_dark, cyan_lit = rgb(TURQUOISE), rgb('#04706F'), rgb('#7FF0EE')

    CX = 16                                                                         # symmetric about x = 16
    X0, X1 = 1, 31

    # ---- the plinth: outline row 43, deck (top face) 44-47, lip 48, front 49-59, foot line 60
    rect(X0, 43, X1, 60, oak['line'])
    rect(X0 + 1, 44, X1 - 1, 47, oak['lit'])
    rect(X0 + 1, 44, X1 - 1, 44, oak['hi'])
    rect(X0 + 1, 46, X1 - 1, 46, oak['mid'])
    rect(X0 + 1, 48, X1 - 1, 48, oak['hi'])
    rect(X0 + 1, 49, X1 - 1, 59, oak['shade'])
    rect(X0 + 1, 49, X0 + 2, 59, oak['mid'])
    rect(X1 - 2, 49, X1 - 1, 59, oak['dark'])
    rect(X0 + 1, 49, X1 - 1, 49, oak['lit'])
    rect(5, 50, 27, 58, oak['line'])                                                # the plate's oak border...
    rect(6, 51, 26, 57, ink_line)                                                   # ...an ink plate inset in it
    rect(7, 52, 25, 56, ink)
    rect(6, 51, 26, 51, ink)
    for j, row in enumerate(kmark.K_BELL):                                          # the logo's K, white, 7 x 7 (the plate's height)
        for i, ch in enumerate(row):
            if ch == '#':
                put(CX - 3 + i, 51 + j, rgb(kmark.WHITE))
    rect(X0 + 1, 59, X1 - 1, 59, cyan)                                              # the light reveal at the foot
    rect(X0 + 1, 48, X1 - 1, 48, br['base'])                                        # a brass edge round the deck
    rect(X0 + 1, 49, X1 - 1, 49, br['dark'])
    for x in (X0, X1):                                                              # the plinth's two ends: the frame's own wood line (X1 is
        rect(x, 43, x, 60, wd['line'])                                              # the picture's right edge: an ink there, not the mid oak)

    # ---- the frame: posts to the deck, a beam with a lit top, brass finials, brass corner plates
    for x0 in (2, 27):
        rect(x0, 14, x0 + 3, 46, wd['line'])
        rect(x0 + 1, 15, x0 + 1, 45, wd['light'])
        rect(x0 + 2, 15, x0 + 2, 45, wd['mid'])
    rect(X0, 11, X1, 16, wd['line'])
    rect(X0 + 1, 12, X1 - 1, 15, wd['mid'])
    rect(X0 + 1, 12, X1 - 1, 12, wd['hi'])
    rect(X0 + 1, 13, X1 - 1, 13, wd['light'])
    rect(X0 + 1, 15, X1 - 1, 15, wd['shade'])
    for x0 in (2, 27):                                                              # finials
        for (y, a, b) in ((7, 1, 2), (8, 0, 3), (9, 0, 3), (10, 1, 2)):
            rect(x0 + a, y, x0 + b, y, br['line'])
        rect(x0 + 1, 8, x0 + 2, 9, br['mid'])
        put(x0 + 1, 8, br['spec'])
        put(x0 + 2, 9, br['dark'])
    rect(CX - 4, 12, CX + 4, 15, br['line'])                                        # the hanger plate on the beam
    rect(CX - 3, 13, CX + 3, 14, br['mid'])
    rect(CX - 3, 13, CX - 2, 13, br['light'])
    put(CX - 3, 13, br['spec'])
    put(CX + 3, 14, br['dark'])
    for sgn, xa in ((1, 6), (-1, 26)):                                              # brass corner plates
        for r, w in enumerate((4, 3, 2, 1)):
            for i in range(w):
                put(xa + sgn * i, 17 + r, br['line'] if (i == w - 1 or r == 3) else br['mid'])

    for x0 in (2, 27):                                                              # brass straps round the posts' feet
        rect(x0, 39, x0 + 3, 41, br['line'])
        rect(x0 + 1, 40, x0 + 2, 40, br['mid'])
        put(x0 + 1, 40, br['light'])

    # ---- the bell: shoulder, waist, flared lip with one band; 17 px wide at the lip
    prof = [3, 5, 7, 9, 11, 11, 9, 9, 9, 11, 11, 13, 13, 15, 15, 17, 17, 17]
    top = 18
    rect(CX - 1, 16, CX + 1, 17, br['line'])
    put(CX, 16, br['mid']); put(CX, 17, br['mid'])
    n = len(prof)
    for r, w in enumerate(prof):
        y = top + r
        a = CX - w // 2
        b = CX + w // 2
        for x in range(a, b + 1):
            f = (x - a) / (b - a)
            if x in (a, b) or r == 0 or r == n - 1:
                t = 'line'
            else:
                t = 'light' if f < 0.22 else 'base' if f < 0.55 else 'mid' if f < 0.80 else 'dark'
                if x == b - 1 and 2 <= r <= n - 4:                                   # light bounced up from the floor
                    t = 'mid'
                if r == n - 2:                                                       # the lip band
                    t = 'light' if f < 0.5 else 'base' if f < 0.8 else 'mid'
                elif r == n - 3:
                    t = 'dark' if f > 0.25 else 'mid'
            put(x, y, br[t])
    for r in range(3, 14):                                                          # the highlight streak, unbroken
        put(CX - prof[r] // 2 + 2, top + r, br['spec'])
        if r in (5, 6, 7, 8, 9, 10, 11, 12):
            put(CX - prof[r] // 2 + 3, top + r, br['light'])
    # clapper ball, cord, brass ball
    rect(CX - 1, top + n, CX + 1, top + n + 2, br['line'])
    put(CX, top + n, br['mid']); put(CX - 1, top + n + 1, br['mid']); put(CX, top + n + 1, br['spec'])
    for yy in range(top + n + 3, top + n + 6):
        put(CX, yy, cyan)
    by = top + n + 6
    for (dy, a, b) in ((0, 1, 2), (1, 0, 3), (2, 0, 3), (3, 1, 2)):
        rect(CX - 2 + a, by + dy, CX - 2 + b, by + dy, br['line'])
    rect(CX - 1, by + 1, CX, by + 2, br['base'])
    put(CX - 1, by + 1, br['spec'])
    put(CX, by + 2, br['dark'])
    return _on_the_footprint(img)


BELL_DROP = 3                       # rows the drawing is moved down: the plinth's front edge (drawn on row 60) is the picture's last row


def _on_the_footprint(img):
    """The bell's drawing moved down BELL_DROP rows, the three empty rows of its foot taken from under it: a standing piece's front
    edge is the last row of its picture (the foot gap rule of tools/contract.py, and the shadow the runtime casts starts there)."""
    out = Image.new('RGBA', img.size)
    out.paste(img.crop((0, 0, img.width, img.height - BELL_DROP)), (0, BELL_DROP))
    return out


@lru_cache(maxsize=None)
def reception_pieces():
    return {
        'Koncluí: entrance mat': {'ink': dict(image=entrance_mat(), collisionGrid=None, depthOffset=-(64 + 96))},
        'Koncluí: rug 5x3': {'mist': dict(image=rug(5, 3), collisionGrid=None, depthOffset=-(96 + 96))},
        'Koncluí: rug 10x5': {'mist': dict(image=rug(10, 5), collisionGrid=None, depthOffset=-(160 + 96))},
        # the plinth's front edge (the last row, 63) sorts it: people in front of the bell pass over it, behind it under
        'Koncluí: sino da venda': {'ouro': dict(image=sales_bell(), collisionGrid=[[0], [1]], depthOffset=-1)},
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
