"""Pieces of the café's lounge and games room (owner, 20/10/2026: "muito triste", "pra deixar incrível"), drawn where
the furniture catalogue has nothing that fits: in its pixel language, 32 px tiles, 3/4 view, light from the top left,
two to four tones per material, an outline in the material's own dark tone and no dithering. Brand colours only as
accents (navy, turquoise, mint, lime); no letters anywhere.

  pieces() -> {type: {colour: dict(image, collisionGrid, depthOffset, surface)}} for signature.pieces()
    'Koncluí: painel'            6 x 2 tiles, a freestanding navy panel behind the credenza; blocks its bottom row
    'Koncluí: neon'              the double wave of turquoise and mint tubes hung on the panel (fx 'sign' light)
    'Koncluí: aparador'          6 tiles, a long low teak credenza with open cubbies; blocks its bottom row
    'Koncluí: balcão de bar'     3 tiles, a teak bar counter with a boarded front; blocks its bottom row
    'Koncluí: banqueta'          a bar stool with a turquoise cushion; a seat (people sit on it facing the bar)
    'Koncluí: almofada <cor>'    throw cushions (turquesa, menta, lima): 'frente' leaning on a couch facing down,
                                 'costas' peeking over the backrest of one facing up
    'Koncluí: manta'             a folded mint throw over a couch's seat
    'Koncluí: tapete 6x3'        cream wool with a navy diamond lattice, turquoise border and tassels
    'Koncluí: carpete de jogos'  the games corner's navy carpet: lime border line, turquoise line round the tables
    'Koncluí: pendente'          a black dome pendant with a warm rim, hung over the pool table (fx light)
    'Koncluí: tacos'             a floor rack with three pool cues; blocks its bottom tile
    'Koncluí: alvo de dardos'    a dartboard on a slim stand over a lamp scoreboard; blocks its bottom tile
  Game terminals (owner, 20/10/2026: "ter todos terminais lá pros usuários conseguirem interagir"), next to the
  catalogue's arcades, piano, ping-pong and pool tables:
    'Koncluí: air hockey'        2 x 2 tiles, an air-hockey table with goals at the ends, mallets and a puck
    'Koncluí: xadrez'            a chessboard mid-game, for a table top
    'Koncluí: lig 4'             a connect-four rack with red and yellow discs, for a table top
    'Koncluí: fliperama breakout' the catalogue's white arcade with a brick-wall screen and turquoise and mint trim
"""
from functools import lru_cache

import numpy as np
from PIL import Image

from palette import rgb

T = 32
SHADOW = (10, 10, 61)                    # the shadow tint of the signature pieces
WOOD = {k: rgb(v) for k, v in dict(line='#3B2417', dark='#5A3824', shade='#774A30', mid='#966140', light='#B37B52',
                                   hi='#CB956A').items()}
NAVY, TURQUOISE, MINT, LIME = '#0B1736', '#14B8B0', '#6EE6D1', '#96D664'


def blank(w, h):
    return np.zeros((h, w, 4), np.uint8)


def fill(a, x0, y0, x1, y1, colour, alpha=255):
    """Inclusive rectangle."""
    c = rgb(colour) if isinstance(colour, str) else colour
    a[y0:y1 + 1, x0:x1 + 1] = (*c, alpha)


def put(a, x, y, colour):
    if 0 <= y < a.shape[0] and 0 <= x < a.shape[1]:
        a[y, x] = (*(rgb(colour) if isinstance(colour, str) else colour), 255)


def shade_row(a, y, x0, x1, alpha=48, colour=SHADOW):
    """A shadow under a piece, only where nothing is drawn yet."""
    row = a[y, x0:x1 + 1]
    empty = row[:, 3] == 0
    row[empty] = (*colour, alpha)


WARM_SHADOW = (60, 40, 40)                 # a contact shadow on the oak floor, as the target's


def image(a):
    return Image.fromarray(a, 'RGBA')


def stamp(a, x0, y0, rows, tones):
    """Paint a string grid: each character a tone of the table, anything else left empty."""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in tones:
                put(a, x0 + i, y0 + j, tones[ch])


def wood_top(a, x0, y0, x1, y1, seed):
    """A board seen from above: planks along its length, joints a tone down, a few grain streaks (never next to a
    joint), the back edge lit."""
    fill(a, x0, y0, x1, y1, WOOD['light'])
    fill(a, x0, y0, x1, y0, WOOD['hi'])
    joints = list(range(y0 + 4, y1, 5))
    for y in joints:
        fill(a, x0, y, x1, y, WOOD['mid'])
    rng = np.random.default_rng(seed)
    for _ in range((x1 - x0) // 9):
        y = int(rng.integers(y0 + 1, y1 + 1))
        if y in joints or y - 1 in joints and rng.random() < 0.5:
            continue
        x = int(rng.integers(x0, x1 - 6))
        fill(a, x, y, min(x1, x + int(rng.integers(4, 13))), y, WOOD['mid'])


# ------------------------------------------------------------------------------------------------ back of the room

def panel():
    """A freestanding navy slab, its top edge seen from above, the face in two bands of light, feet behind the
    credenza. Five tiles of face in a six-tile footprint (its collision): the pictures standing on the credenza lean on
    its edges."""
    w, h = 6 * T, 2 * T
    a = blank(w, h)
    x0, x1 = 16, w - 18
    line, top, lit, face_hi, face, low = '#081633', '#24497A', '#2E5A90', '#143462', '#12305A', '#0E2848'
    fill(a, x0, 0, x1, 59, line)
    fill(a, x0 + 1, 1, x1 - 1, 2, top)
    fill(a, x0 + 1, 1, x1 - 1, 1, lit)
    fill(a, x0 + 1, 3, x1 - 1, 3, low)
    fill(a, x0 + 1, 4, x1 - 1, 21, face_hi)
    fill(a, x0 + 1, 22, x1 - 1, 57, face)
    fill(a, x0 + 1, 4, x0 + 1, 57, '#183A69')          # lit left edge
    fill(a, x1 - 1, 4, x1 - 1, 57, low)
    fill(a, x0 + 1, 58, x1 - 1, 58, low)
    for x in (x0 + 8, x1 - 13):                        # feet, mostly hidden by the credenza
        fill(a, x, 60, x + 5, 62, line)
        fill(a, x + 1, 60, x + 4, 60, '#1A2D4F')
    return image(a)


def _curve(f, x0, x1, step=0.02):
    """The graph of y = f(x) from x0 to x1 as a pixel path, made pixel perfect (no L-shaped corners, so the line stays
    one pixel thick and its steps stay even)."""
    out = []
    for x in np.arange(x0, x1 + step / 2, step):
        q = (int(round(x)), int(round(f(x))))
        if not out or out[-1] != q:
            out.append(q)
    filled = [out[0]]
    for q in out[1:]:                                  # steep flanks: join vertical jumps with whole pixels
        px_, py_ = filled[-1]
        while abs(q[1] - py_) > 1:
            py_ += 1 if q[1] > py_ else -1
            filled.append((px_ if abs(q[0] - px_) == 0 else q[0], py_))
        filled.append(q)
    clean = [filled[0]]
    for i in range(1, len(filled) - 1):
        (ax, ay), (bx, by), (cx, cy) = clean[-1], filled[i], filled[i + 1]
        if abs(ax - cx) == 1 and abs(ay - cy) == 1 and (ax == bx or ay == by):
            continue                                   # the corner of an L: its neighbours already touch
        clean.append(filled[i])
    clean.append(filled[-1])
    return clean


def _dilate(mask):
    out = mask.copy()
    out[1:] |= mask[:-1]
    out[:-1] |= mask[1:]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def neon():
    """Two tubes: a mint wave of two crests over a turquoise line that dips under the first crest and runs flat, each a
    bright core with its tube colour either side and a two-step halo for the glow on the navy panel. The top quarter
    of the canvas stays empty: fx.py measures a sign's glyph below it."""
    w, h = 80, 44
    bump = lambda x, c, wd: np.exp(-((x - c) / wd) ** 2)
    wave = lambda x: 31 - 13 * bump(x, 28, 10.5) - 7 * bump(x, 52, 7.5)
    upper = _curve(wave, 3, 75)
    lower = _curve(lambda x: wave(x) + 6, 8, 75)
    tubes = []
    for path, core, tube in ((lower, '#9AF7EC', '#1FC9C0'), (upper, '#E4FFFA', '#7FEEDB')):
        m = np.zeros((h, w), bool)
        for x, y in path:
            m[y, x] = True
        tubes.append((m, core, tube))
    every = np.zeros((h, w), bool)
    for m, _, _ in tubes:
        every |= m
    a = blank(w, h)
    every[1:, :] |= every[:-1, :]
    halo1 = _dilate(_dilate(every))
    halo2 = _dilate(halo1)
    halo3 = _dilate(_dilate(halo2))
    a[halo3 & ~halo2] = (*rgb('#13405F'), 255)         # the glow on the panel, in three steps
    a[halo2 & ~halo1] = (*rgb('#0F5A72'), 255)
    a[halo1] = (*rgb('#0F7682'), 255)
    for m, core, tube in tubes:                        # the upper tube last: it crosses in front
        thick = _dilate(m)
        thick[1:, :] |= thick[:-1, :]                      # four pixels thick: the tube seen a little from above
        a[thick] = (*rgb(tube), 255)
        a[m] = (*rgb(core), 255)
        a[1:, :][m[:-1, :]] = (*rgb(core), 255)
    return image(a)


HONEY = {k: rgb(v) for k, v in dict(line='#4A2C1B', dark='#6B4229', shade='#8A5A38', mid='#A8724A', light='#BC865F',
                                    hi='#D29C72').items()}   # the bar's lighter honey teak


def credenza(tiles=7, x0=21, x1=219):
    """A long low teak console drawn from x0 to x1 of a `tiles`-wide canvas (its collision is the tiles it covers): the
    top board from above with a seam every bay, its front lip, an apron, short stub legs with feet under it, the floor
    seen between them, and the shade under it."""
    w, h = tiles * T, 2 * T
    a = blank(w, h)
    for y in range(46, 53):                            # shade on the floor under the console
        shade_row(a, y, x0 + 2, x1 - 2, 44 if y < 51 else 26)
    fill(a, x0, 27, x1, 46, WOOD['line'])
    wood_top(a, x0 + 1, 28, x1 - 1, 39, seed=w)
    for x in range(x0 + 25, x1 - 4, 25):               # seams between the boards of the top
        fill(a, x, 28, x, 39, WOOD['mid'])
        put(a, x + 1, 28, WOOD['hi'])
    fill(a, x0 + 1, 40, x1 - 1, 40, WOOD['hi'])        # the board's front arris
    fill(a, x0 + 1, 41, x1 - 1, 42, WOOD['mid'])
    fill(a, x0 + 1, 43, x1 - 1, 45, WOOD['shade'])     # the apron
    fill(a, x0 + 1, 45, x1 - 1, 45, WOOD['dark'])
    for x in [x0 + 3, *range(x0 + 28, x1 - 8, 25), x1 - 6]:
        fill(a, x, 46, x + 3, 50, WOOD['line'])        # a stub leg and its foot
        fill(a, x + 1, 46, x + 2, 49, WOOD['dark'])
        put(a, x + 1, 46, WOOD['mid'])
    return image(a)


def bar_counter(tiles=4, x0=12, x1=107):
    """A bar counter drawn from x0 to x1 of a `tiles`-wide canvas (a gap from the wall beside it): a thick honey teak
    top of planks seen from above and in front, a thin slatted apron under the lip, a leg at each end and the floor
    seen between them, and its shade."""
    w, h = tiles * T, 2 * T
    a = blank(w, h)
    for y in range(54, 63):
        shade_row(a, y, x0 + 2, x1 - 2, 48 if y < 61 else 28)
    fill(a, x0, 28, x1, 54, HONEY['line'])
    fill(a, x0 + 1, 29, x1 - 1, 43, HONEY['light'])   # the top, planks running front to back
    fill(a, x0 + 1, 29, x1 - 1, 29, HONEY['hi'])
    for x in range(x0 + 12, x1 - 4, 12):
        fill(a, x, 29, x, 43, HONEY['mid'])
        put(a, x + 1, 30, HONEY['hi'])
    fill(a, x0 + 1, 44, x1 - 1, 44, HONEY['hi'])      # the front arris and the board's thickness
    fill(a, x0 + 1, 45, x1 - 1, 48, HONEY['mid'])
    fill(a, x0 + 1, 49, x1 - 1, 53, HONEY['shade'])   # the slatted apron
    for x in range(x0 + 3, x1 - 1, 4):
        fill(a, x, 49, x, 53, HONEY['dark'])
    for x in (x0 + 1, x1 - 4):                         # the legs, the floor between them
        fill(a, x, 54, x + 3, 62, HONEY['line'])
        fill(a, x + 1, 54, x + 2, 61, HONEY['dark'])
        put(a, x + 1, 54, HONEY['mid'])
    return image(a)


def stool():
    """A bar stool from the front and a little above: a domed turquoise cushion (a lit crown, its rim in shade), four
    dark-wood legs splaying from under it with a foot ring, a soft shadow. Drawn in the bottom tile of a two-tile
    canvas; the sitter lands at the seat's anchor (STOOL_SEAT), a little under the cushion, as on a high stool."""
    a = blank(T, 2 * T)
    dark, mid, line = '#5A3824', '#774A30', '#2E1C12'
    for y, (x0, x1, al) in zip(range(42, 45), ((8, 23, 50), (6, 25, 50), (8, 23, 30))):
        shade_row(a, y, x0, x1, al, WARM_SHADOW)
    for x0, x1, y1, tone in ((13, 12, 40, dark), (18, 19, 40, dark), (10, 7, 42, mid), (21, 24, 42, mid)):
        for y in range(27, y1 + 1):
            x = round(x0 + (x1 - x0) * (y - 27) / (y1 - 27))
            put(a, x, y, line)
            put(a, x + 1, y, tone)
    fill(a, 9, 36, 22, 36, mid)                        # foot ring
    fill(a, 9, 37, 22, 37, line)
    cx, rx = 15.5, 8.5
    for y in range(12, 28):
        for x in range(4, 28):
            u = ((x + 0.5 - cx) / rx) ** 2
            if u > 1.0:
                continue
            d_top = u + ((y + 0.5 - 17.5) / 4.5) ** 2      # the domed top
            d_side = u + ((y + 0.5 - 21.5) / 4.0) ** 2     # and the band round it
            if d_top <= 0.72:
                crown = ((x + 0.5 - cx + 2.5) / 4.0) ** 2 + ((y + 0.5 - 16.0) / 2.0) ** 2 <= 1
                put(a, x, y, '#6ED6D6' if crown else '#36B3B8' if x < cx + 3 else '#2898A0')
            elif d_top <= 1.0:
                put(a, x, y, '#1C7F88' if y < 18 else '#0B4A50')
            elif y > 17 and d_side <= 0.7:
                put(a, x, y, '#1A7680' if x < cx + 2 else '#125C64')
            elif y > 17 and d_side <= 1.0:
                put(a, x, y, '#0B4A50')
    return image(a)


STOOL_SEAT = dict(anchorOffset=dict(x=16, y=29), direction='up')   # the stool drawn a little above its sitter


# ------------------------------------------------------------------------------------------------ soft things

CUSHION_TONES = {
    'turquesa': ('#0B6E6C', '#12958F', TURQUOISE, '#3FD3C8'),
    'menta': ('#2F9E8A', '#4FC9B2', MINT, '#A8F5E6'),
    'lima': ('#4F8A2E', '#76B648', LIME, '#BFEA8F'),
}


def _pillow(size, angle, cut=None):
    """A cushion as a mask of tones: a square with its edges pinched in (so its corners stand out), turned by `angle`
    degrees, lit from the top left in bands; `cut` keeps only the rows above it (the part over a backrest)."""
    n = size + 2
    c = (n - 1) / 2
    th = np.radians(angle)
    out = np.full((n, n), '.', dtype='<U1')
    half = size / 2
    for y in range(n):
        for x in range(n):
            dx, dy = x - c, y - c
            u = dx * np.cos(th) + dy * np.sin(th)
            v = -dx * np.sin(th) + dy * np.cos(th)
            pin = 0.9 * (1 - (v / half) ** 2)
            pin2 = 0.9 * (1 - (u / half) ** 2)
            if abs(u) <= half - pin and abs(v) <= half - pin2:
                t = (u + v) / size
                out[y, x] = 'L' if t < -0.28 else 'S' if t > 0.22 else 'B'
    inside = out != '.'
    for y in range(n):                                 # corner tips one pixel thin would read as specks: drop them
        for x in range(n):
            if inside[y, x] and sum(0 <= y + j < n and 0 <= x + i < n and inside[y + j, x + i]
                                    for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1))) <= 1:
                out[y, x] = '.'
    inside = out != '.'
    for y in range(n):
        for x in range(n):
            if inside[y, x] and any(not (0 <= y + j < n and 0 <= x + i < n and inside[y + j, x + i])
                                    for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out[y, x] = '#'
    if cut is not None:
        out = out[:cut]
        out[-1][out[-1] != '.'] = '#'
    return [''.join(r) for r in out]


def cushion(colour, back=False):
    o, s, b, l = CUSHION_TONES[colour]
    rows = _pillow(14, {'turquesa': -14, 'menta': 10, 'lima': 16}[colour], cut=9 if back else None)
    a = blank(len(rows[0]), len(rows) + 1)
    stamp(a, 0, 0, rows, {'#': o, 'S': s, 'B': b, 'L': l})
    return image(a)


def throw():
    """A mint throw folded over a seat: the folded top in two bands, a fold crease, the part hanging over the front and
    its fringe."""
    o, s, b, l = CUSHION_TONES['menta']
    rows = ['.##################.',
            '#LLLLLLLLLLLLLLLLLL#',
            '#LLLLLLLLLLLLLLLLLB#',
            '#BBBBBBBBBBBBBBBBBB#',
            '#BBBBBBBBBBBBBBBBBS#',
            '#SSSSSSSSSSSSSSSSSS#',
            '#BBBBBBBBBBBBBBBBBB#',
            '#BBBBBBBBBBBBBBBBBS#',
            '#BBBBBBBBBBBBBBBBSS#',
            '#SBBBBBBBBBBBBBBSSS#',
            '#SSSSSSSSSSSSSSSSSS#',
            '.#################..',
            '.S.S.S.S.S.S.S.S.S..',
            '.S.S.S.S.S.S.S.S.S..']
    a = blank(20, len(rows))
    stamp(a, 0, 0, rows, {'#': o, 'S': s, 'B': b, 'L': l})
    return image(a)


def rug_lattice(w=189, h=100):
    """Cream wool with a navy diamond lattice and a small diamond in every cell, worn in places, a teal and mint border,
    round teal bead tassels on the short ends; `w` x `h` px (a little under 6 x 3 tiles wide, a little over tall)."""
    tassel = 10
    a = blank(w, h)
    x0, x1, y0, y1 = tassel, w - 1 - tassel, 1, h - 2
    border = ['#1F8185', '#8CCD94', '#8CCD94', '#1E829B', '#1E829B', '#1E829B', '#1E829B', '#165884']
    for i, c in enumerate(border):
        fill(a, x0 + i, y0 + i, x1 - i, y1 - i, c)
    fx0, fx1, fy0, fy1 = x0 + len(border), x1 - len(border), y0 + len(border), y1 - len(border)
    fill(a, fx0, fy0, fx1, fy1, '#F3E1C2')
    rng = np.random.default_rng(31)                    # wear: faded patches in blocks of 3 to 6 px, never lone pixels
    worn = np.zeros(a.shape[:2], bool)
    for _ in range(26):
        wx, wy = int(rng.integers(fx0, fx1 - 6)), int(rng.integers(fy0, fy1 - 4))
        worn[wy:wy + int(rng.integers(2, 5)), wx:wx + int(rng.integers(3, 7))] = True
    period = 40                                        # one diamond a tile and a quarter across
    cx0 = (fx0 + fx1) // 2
    cy0 = (fy0 + fy1) // 2
    for y in range(fy0, fy1 + 1):
        for x in range(fx0, fx1 + 1):
            u, v = (x - cx0) + (y - cy0), (x - cx0) - (y - cy0)
            if worn[y, x]:
                put(a, x, y, '#F8EBD4')
            elif u % period == 0 or v % period == 0:
                put(a, x, y, '#6F8FB2' if (u // 8 + v // 8) % 5 else '#9DB2C8')   # a line faded in places
            else:                                      # the small diamond and its dot, in the middle of each cell
                du = (u - period // 2) % period
                dv = (v - period // 2) % period
                du, dv = min(du, period - du), min(dv, period - dv)
                if (du == 4 and dv <= 4) or (dv == 4 and du <= 4) or (du == 0 and dv == 0):
                    put(a, x, y, '#5A7DA4')
                elif du + dv <= 18 and (du == 11 or dv == 11):
                    put(a, x, y, '#E2C9A2')            # a faint second ring round the motif
    for n, y in enumerate(range(y0 + 4, y1 - 2, 5)):    # tassels: a short cord and a bead, in two teals by turns
        bead, lit = (('#0E5E66', '#1F8F96'), ('#0B4A55', '#16747C'))[n % 2]
        for side in (-1, 1):
            edge = x0 - 1 if side < 0 else x1 + 1
            for i in range(4):
                put(a, edge + side * i, y, '#0B3A48')
            knot = edge + side * 6                     # a round bead four px across
            for dy in (-2, -1, 0, 1):
                for dx in (-2, -1, 0, 1):
                    if abs(dx + 0.5) + abs(dy + 0.5) < 3:
                        put(a, knot + dx, y + dy, lit if (dy < 0 and dx < 0) else bead)
    return image(a)


def _texture_navy(w, h, steps=('#123C60', '#16466C', '#0F3456'), seed=5):
    """A carpet's pile in navy: the base tone mottled with short dashes and two-by-two tufts a step lighter and a step
    darker, three to seven pixels long, never a lone pixel."""
    rng = np.random.default_rng(seed)
    base, light, dark = (np.array(rgb(c), float) for c in steps)
    out = np.empty((h, w, 3))
    out[:] = base
    for y in range(0, h, 2):
        x = int(rng.integers(0, 5))
        while x < w:
            n = int(rng.integers(3, 8))
            r = rng.random()
            if r < 0.45:
                out[y, x:x + n] = light if rng.random() < 0.5 else dark
            elif r < 0.6:
                out[y:y + 2, x:x + 2] = light if rng.random() < 0.5 else dark
            x += n + int(rng.integers(1, 5))
    return out


GAME_CARPET = (373, 209)                 # px: from column 68.69 to 80.34, rows 40.06 to 46.59 (the target's measure)
# The turquoise line inside the lime one, round the ping-pong and pool tables and leaving a band for the cue rack,
# dartboard and arcades (top right) and a corner for the foosball (bottom left): map tiles, clockwise.
GAME_LINE = [(79.4, 42.69), (76.22, 42.69), (76.22, 40.73), (69.4, 40.73), (69.4, 44.05), (72.9, 44.05), (72.9, 45.88),
             (79.4, 45.88), (79.4, 44.75)]    # an open path: under the arcades, round the tables, up by the beanbags
GAME_ORIGIN = (68.7125, 40.04)            # where the path's tiles start in the carpet's picture


def game_carpet():
    """Deep navy with the catalogue's fine weave: a darker border band, a lime line inside it, and a turquoise line with
    a lighter core that steps round the play zones; each line has a darker lip under it."""
    w, h = GAME_CARPET
    a = blank(w, h)
    a[..., :3] = _texture_navy(w, h).astype(np.uint8)
    a[..., 3] = 255
    band = _texture_navy(w, h, ('#0D3456', '#113B60', '#0A2D4C'), seed=9).astype(np.uint8)
    inner = np.zeros((h, w), bool)
    inner[9:h - 11, 9:w - 9] = True
    a[~inner, :3] = band[~inner]
    fill(a, 0, 0, w - 1, 0, '#08223D')
    fill(a, 0, h - 1, w - 1, h - 1, '#08223D')
    fill(a, 0, 0, 0, h - 1, '#08223D')
    fill(a, w - 1, 0, w - 1, h - 1, '#08223D')

    def frame(x0, y0, x1, y1, colours, under):
        for i, c in enumerate(colours):
            fill(a, x0 + i, y0 + i, x1 - i, y0 + i, c)
            fill(a, x0 + i, y1 - i, x1 - i, y1 - i, c)
            fill(a, x0 + i, y0 + i, x0 + i, y1 - i, c)
            fill(a, x1 - i, y0 + i, x1 - i, y1 - i, c)
        if under:
            k = len(colours)
            fill(a, x0 + k, y0 + k, x1 - k, y0 + k, under)  # the lip under the top line and inside the left one
            fill(a, x0 + k, y0 + k, x0 + k, y1 - k, under)
            fill(a, x0, y1 + 1, x1, y1 + 1, under)          # and under the bottom one
    fill(a, 6, 6, w - 6, 8, LIME)                      # the lime frame: three px, two along the bottom
    fill(a, 6, h - 10, w - 6, h - 9, LIME)
    fill(a, 6, 6, 8, h - 9, LIME)
    fill(a, w - 8, 6, w - 6, h - 9, LIME)
    for x0, y0, x1, y1 in ((1, 1, w - 2, h - 2), (9, 9, w - 9, h - 11)):   # light-teal rims: edge, inside the lime
        fill(a, x0, y0, x1, y0, '#2B8A8E')
        fill(a, x0, y1, x1, y1, '#2B8A8E')
        fill(a, x0, y0, x0, y1, '#2B8A8E')
        fill(a, x1, y0, x1, y1, '#2B8A8E')
    ox, oy = GAME_ORIGIN
    pts = [(round((c - ox) * T), round((r - oy) * T)) for c, r in GAME_LINE]
    core = np.zeros((h, w), bool)
    for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
        core[min(ya, yb):max(ya, yb) + 1, min(xa, xb):max(xa, xb) + 1] = True
    line = _dilate(core)                               # three px: a sea-green line, muted on the navy
    a[line, :3] = rgb('#1AA69E')
    rng = np.random.default_rng(17)                    # mottled: lighter flecks of two px here and there
    ys, xs = np.nonzero(core)
    for y, x in zip(ys, xs):
        r = rng.random()
        if r < 0.12:
            a[y, x:x + 2, :3] = rgb('#3CC3B6')
        elif r < 0.16:
            a[y - 1:y + 1, x, :3] = rgb('#5ED3C6')
    return image(a)


# ------------------------------------------------------------------------------------------------ games corner

def pendant():
    """A navy-slate dome on a cord, a collar where the cord enters, a soft gloss on its shoulder, and under its rim the
    lit inside seen from below: a crescent, warm white in the middle and orange round it; fx.py puts the light under
    the rim (its widest rows)."""
    a = blank(T, 84)
    fill(a, 15, 2, 15, 46, '#1C2130')
    fill(a, 14, 2, 16, 3, '#1C2130')                   # the cord's grip
    fill(a, 12, 44, 18, 47, '#1C2033')                 # the collar
    fill(a, 13, 44, 15, 45, '#545B80')
    widths = [10, 14, 17, 19, 21, 22, 23, 24, 25, 25, 26, 26, 26]
    for i, wd in enumerate(widths):
        y = 48 + i
        x0, x1 = 16 - wd // 2, 15 + (wd + 1) // 2
        fill(a, x0, y, x1, y, '#1C2033')
        if x1 - x0 > 2:
            fill(a, x0 + 1, y, x1 - 1, y, '#3C415F')
            fill(a, x0 + 1, y, x0 + max(1, wd // 4), y, '#4C5375')
            if i < 6:
                fill(a, x0 + 2, y, x0 + 1 + max(1, wd // 6), y, '#5E6790')
    top = 48 + len(widths)
    for j, half in enumerate((13, 12.5, 11.5, 10, 8, 5.5)):   # the lit inside: a crescent under the rim
        y = top + j
        x0, x1 = round(16 - half), round(16 + half) - 1
        fill(a, x0, y, x1, y, '#C9772A')
        if x1 - x0 > 2:
            fill(a, x0 + 1, y, x1 - 1, y, '#F0AA3C')
        if x1 - x0 > 8:
            fill(a, x0 + 4, y, x1 - 4, y, '#F9F6BA' if j < 4 else '#F6D27A')
    return image(a)


def cue_rack():
    """A dark floor rack with three cues: a backboard, a top bar with the tips, a tray for the butts."""
    a = blank(T, 2 * T)
    fill(a, 6, 19, 25, 55, '#0E1220')
    fill(a, 7, 20, 24, 54, '#1F2536')
    fill(a, 7, 20, 24, 21, '#2E3650')
    fill(a, 7, 22, 7, 54, '#2A3147')
    fill(a, 6, 49, 25, 55, '#0E1220')                  # the tray
    fill(a, 7, 50, 24, 51, '#3A4360')
    fill(a, 7, 52, 24, 54, '#262D42')
    for x in (10, 15, 20):
        fill(a, x, 15, x + 1, 50, '#D99A55')
        fill(a, x + 1, 15, x + 1, 50, '#B5763A')
        fill(a, x, 14, x + 1, 15, '#F2E6D0')           # ferrule
        fill(a, x, 13, x + 1, 13, '#3A6FB0')           # chalked tip
        fill(a, x, 40, x + 1, 47, '#5A3824')           # the wrap
        fill(a, x, 40, x, 47, '#774A30')
        fill(a, x, 48, x + 1, 50, '#2A1A12')           # butt cap
    fill(a, 6, 23, 25, 24, '#0E1220')                  # the bar holding them
    fill(a, 7, 23, 24, 23, '#3A4360')
    for y in (56, 57):
        shade_row(a, y, 6, 25, 50 if y == 56 else 30)
    return image(a)


def dartboard():
    """A dartboard in its dark surround (cream, black, red and green, sixteen sectors) on a slim stand that holds a
    scoreboard of six lamps."""
    a = blank(T, 2 * T)
    cx, cy = 15.5, 28.5
    red, green, cream, black = '#C8343A', '#2F8F4E', '#E9DFC4', '#1A1A1A'
    for y in range(14, 44):
        for x in range(0, T):
            dx, dy = x - cx, y - cy
            r = np.hypot(dx, dy)
            sector = int(((np.degrees(np.arctan2(dy, dx)) + 360 + 11.25) % 360) // 22.5) % 2
            if r > 13.4:
                continue
            if r > 12.2:
                c = '#0E1322'
            elif r > 10.6:
                c = '#232B40' if dy < -4 and dx < 2 else '#1C2337'
            elif r > 9.6:
                c = black
            elif r > 8.6:
                c = red if sector else green
            elif r > 5.6:
                c = black if sector else cream
            elif r > 4.6:
                c = red if sector else green
            elif r > 2.0:
                c = black if sector else cream
            elif r > 1.0:
                c = green
            else:
                c = red
            put(a, x, y, c)
    fill(a, 14, 42, 17, 46, '#0E1322')                 # the stand
    fill(a, 15, 42, 15, 46, '#2A3350')
    fill(a, 3, 46, 28, 58, '#070D1C')                  # scoreboard
    fill(a, 4, 47, 27, 48, '#22325A')
    fill(a, 4, 49, 27, 57, '#0E1A36')
    lamps = [['#F2C14E', MINT, '#E5484D'], ['#5CCB6A', '#F2C14E', '#E5484D']]
    for j, row in enumerate(lamps):
        for i, c in enumerate(row):
            x, y = 6 + i * 8, 50 + j * 4
            fill(a, x, y, x + 4, y + 2, c)
            put(a, x, y, '#FFFFFF' if c != MINT else '#DCFFF8')
            fill(a, x, y + 3, x + 4, y + 3, '#070D1C')
    for y in (59, 60):
        shade_row(a, y, 4, 27, 48 if y == 59 else 28)
    return image(a)


def light_pool(radii, alphas, colour, wobble=0.0, rise=0.0, jag=0):
    """A lamp's pool of light on the floor, for daytime when the engine's lamps are off: nested bands with hard edges,
    one alpha step each (radii outermost first, as (rx, ry) px); `wobble` makes the edges uneven, `jag` steps them in
    blocks of that many px, `rise` lifts the inner bands towards the lamp (a fraction of the outer ry)."""
    rx0, ry0 = radii[0]
    w, h = 2 * int(rx0 * (1 + wobble)) + 4, 2 * int(ry0 * (1 + wobble)) + 4
    a = blank(w, h)
    cx, cy = (w - 1) / 2, (h - 1) / 2
    ys, xs = np.mgrid[0:h, 0:w]
    if jag:
        ys, xs = ys // jag * jag + jag / 2, xs // jag * jag + jag / 2
    th = np.arctan2(ys - cy, xs - cx)
    for i, ((rx, ry), al) in enumerate(zip(radii, alphas)):
        k = 1 + wobble * (np.sin(3 * th + 1.0 + i) * 0.5 + np.sin(5 * th + 2.0 * i) * 0.3 + np.sin(9 * th + i) * 0.2)
        oy = cy - rise * ry0 * i / max(1, len(radii) - 1)
        inside = ((xs - cx) / (rx * k)) ** 2 + ((ys - oy) / (ry * k)) ** 2 <= 1.0
        a[inside] = (*rgb(colour), al)
    return image(a)


# ------------------------------------------------------------------------------------------------ tall plants

LEAF = dict(line='#0F4A26', shade='#1E7A38', base='#2B9A47', light='#4DBA5E', hi='#7DD67A', rib='#186A30',
            stem='#2C7A3A')
LEAF_LIGHT = dict(line='#2C6B2A', shade='#4FA04A', base='#6CC05A', light='#8ED870', hi='#B6EE92', rib='#3F8A3A',
                  stem='#4F9A44')            # the bushy little plants on the shelf and the bar
POT = dict(line='#7C8A99', shade='#C5CED8', base='#E9EEF2', light='#FFFFFF', soil='#4A3426', soil_dark='#33241A')
CREAM = dict(line='#9C8E72', shade='#DCCFB2', base='#F3EAD6', light='#FFFFFF', soil='#4A3426', soil_dark='#33241A')


def _pot(a, cx, top, w_top, w_bottom, height, POT=POT):
    """A glossy ceramic pot (white, or the tones given): a lip at the rim with dark soil in it, a body that bulges a
    little and narrows to its foot, lit from the left (a highlight stripe), its core shade on the right and a rim of
    reflected light at the right edge."""
    for y in range(top, top + height):
        t = (y - top) / max(1, height - 1)
        bulge = 1 + 0.08 * np.sin(np.pi * min(1.0, t * 1.4))
        half = (w_top + (w_bottom - w_top) * t) / 2 * bulge
        x0, x1 = round(cx - half), round(cx + half) - 1
        fill(a, x0, y, x1, y, POT['line'])
        n = x1 - x0
        if n > 3:
            fill(a, x0 + 1, y, x1 - 1, y, POT['base'])
            fill(a, x0 + 1 + n // 6, y, x0 + 1 + n // 6 + max(1, n // 8), y, POT['light'])   # the highlight stripe
            fill(a, x0 + 1 + (n * 5) // 8, y, x1 - 2, y, POT['shade'])                    # the core shade
    fill(a, round(cx - w_bottom / 2) + 1, top + height - 1, round(cx + w_bottom / 2) - 2, top + height - 1, POT['line'])
    rx, ry = w_top / 2 + 0.6, max(1.6, w_top / 8.5)    # the lip and the soil seen from above
    for y in range(top - 3, top + 3):
        for x in range(round(cx - rx) - 1, round(cx + rx) + 1):
            d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - top) / ry) ** 2
            if d <= 0.5:
                put(a, x, y, POT['soil_dark'] if y < top else POT['soil'])
            elif d <= 1.0:
                put(a, x, y, POT['light'] if (y < top or x < cx) else POT['base'])
            elif d <= 1.4:
                put(a, x, y, POT['line'])


def _axes(angle):
    th = np.radians(angle)
    ux, uy = np.sin(th), -np.cos(th)                   # along the leaf
    return ux, uy, -uy, ux                             # and across it


def _stem(a, base, angle, stem, LEAF=LEAF):
    """A leaf's stalk from the pot, two pixels wide: its lit edge and its shaded edge."""
    ux, uy, vx, vy = _axes(angle)
    for k in range(stem + 1):
        x, y = base[0] + ux * k, base[1] + uy * k
        for o, tone in ((0, LEAF['stem']), (1, LEAF['rib'])):
            put(a, int(round(x + vx * o)), int(round(y + vy * o)), tone)


def _leaf(owner, a, idx, base, angle, length, width, stem, slits=0, LEAF=LEAF):
    """One paddle blade of a bird of paradise along `angle` (degrees from straight up, clockwise), from the end of its
    stalk: a pointed oval, its lit half, its shaded half and the midrib. `owner` records which leaf owns each pixel, so
    the outlines also run between overlapping leaves."""
    ux, uy, vx, vy = _axes(angle)
    sx, sy = base[0] + ux * stem, base[1] + uy * stem
    h, w = a.shape[:2]
    for y in range(h):
        for x in range(w):
            dx, dy = x + 0.5 - sx, y + 0.5 - sy
            s_ = dx * ux + dy * uy
            t_ = dx * vx + dy * vy
            if s_ < 0 or s_ > length:
                continue
            q = abs(s_ / length * 2 - 1)               # 0 in the middle of the blade, 1 at its ends
            half = width / 2 * (1 - q ** 1.8) ** 0.6   # a pointed oval
            if abs(t_) > half:
                continue
            if slits and abs(t_) > half * 0.35 and 0.15 < s_ / length < 0.85 \
                    and abs((s_ + abs(t_) * 0.8) % (length / slits) - length / slits / 2) < 0.8:
                continue                               # a monstera's splits: slits in from the edge towards the rib
            side = t_ if ux >= 0 else -t_              # the half facing the top-left light
            near = s_ < length * 0.22                  # the leaf's base, in the shade of the leaves above it
            if abs(t_) < 0.7:
                tone = LEAF['line'] if slits else LEAF['rib']
            elif near:
                tone = LEAF['shade'] if side < 0 else LEAF['rib']
            elif side < 0:
                tone = LEAF['hi'] if (q < 0.45 and -side > half * 0.45) else LEAF['light']
            else:
                tone = LEAF['shade'] if abs(t_) > half * 0.6 else LEAF['base']
            a[y, x] = (*rgb(tone), 255)
            owner[y, x] = idx


def bird_of_paradise(leaves, size=(64, 96), pot=(32, 66, 23, 17, 27), slits=0, tones=POT, floor_shade=True,
                     leaf=LEAF):
    """A tall bird of paradise in a white ceramic pot, drawn at its size (no catalogue sprite is this tall): stalks,
    then paddle blades back to front, each outlined in the darkest green against the floor and the leaves it covers."""
    w, h = size
    a = blank(w, h)
    owner = np.full((h, w), -1)
    cx, top = pot[0], pot[1]
    for angle, length, width, stem, dx in leaves:
        _stem(a, (cx + dx, top - 1), angle, stem, leaf)
    for i, (angle, length, width, stem, dx) in enumerate(leaves):
        _leaf(owner, a, i, (cx + dx, top - 1), angle, length, width, stem, slits, leaf)
    line = np.zeros((h, w), bool)                      # outline: a blade pixel whose neighbour is not that blade and
    for y in range(h):                                 # not a blade drawn over it
        for x in range(w):
            if owner[y, x] < 0:
                continue
            for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + j, x + i
                if not (0 <= yy < h and 0 <= xx < w) or owner[yy, xx] < owner[y, x]:
                    line[y, x] = True
    a[line] = (*rgb(leaf['line']), 255)
    _pot(a, cx, top, pot[2], pot[3], pot[4], tones)
    if floor_shade:                                    # a soft warm contact shadow, narrowing away from the pot
        for i, (inset, al) in enumerate(((0, 56), (3, 40), (7, 22))):
            y = top + pot[4] - 1 + i
            if y < h:
                shade_row(a, y, cx - pot[3] // 2 - 3 + inset, cx + pot[3] // 2 + 2 - inset, al, WARM_SHADOW)
    return image(a)


# (angle, blade length, blade width, stem, base dx): the back leaves first
BIRD_TALL = [(-14, 30, 13, 18, -1), (16, 30, 13, 20, 1), (-40, 27, 12, 12, -2), (42, 28, 12, 12, 2),
             (-2, 30, 12, 24, 0), (-64, 23, 11, 7, -2), (66, 23, 11, 6, 2)]
# taller, for the right wall: longer stalks on the upright leaves
BIRD_TALLER = [(-12, 31, 13, 30, -1), (14, 31, 13, 32, 1), (-36, 28, 12, 18, -2), (38, 29, 12, 18, 2),
               (-1, 31, 12, 38, 0), (-62, 24, 11, 9, -2), (64, 24, 11, 8, 2)]
# a small rubber plant: short glossy ovals close round the stem
RUBBER = [(-30, 15, 11, 8, 0), (28, 15, 11, 10, 0), (-8, 15, 11, 16, 0), (12, 14, 10, 22, 0),
          (-56, 14, 10, 3, 0), (58, 14, 10, 4, 0), (-16, 13, 10, 27, 0)]


# by the piano: a dense rosette of broad pointed leaves (an aglaonema) over a tall pot
AGLAONEMA = [(-70, 19, 10, 3, 0), (68, 19, 10, 3, 0), (-42, 21, 11, 6, 0), (40, 21, 11, 6, 0), (-16, 22, 11, 9, 0),
             (14, 21, 11, 9, 0), (0, 19, 10, 12, 0), (-100, 15, 9, 1, 0), (100, 15, 9, 1, 0), (-118, 12, 8, 0, 0),
             (118, 12, 8, 0, 0)]     # the last ones droop over the pot's rim
# small plants for a shelf, in cream pots: a leafy one and a fern-like one
SHELF_LEAFY = [(-34, 9, 7, 4, 0), (32, 9, 7, 4, 0), (-8, 9, 7, 6, 0), (12, 9, 7, 6, 0), (-62, 8, 6, 1, 0),
               (64, 8, 6, 1, 0), (-80, 7, 5, 0, 0), (82, 7, 5, 0, 0)]
SHELF_FERN = [(-50, 11, 5, 2, 0), (48, 11, 5, 2, 0), (-24, 11, 5, 4, 0), (22, 11, 5, 4, 0), (0, 10, 5, 5, 0),
              (-76, 9, 5, 1, 0), (78, 9, 5, 1, 0)]
# a monstera: broad split leaves fanning low and wide
MONSTERA_BIG = [(-10, 21, 20, 34, -1), (24, 22, 20, 24, 1), (-40, 22, 20, 20, -2), (54, 21, 19, 12, 2),
                (6, 20, 19, 40, 0), (-70, 21, 19, 9, -3), (82, 18, 17, 5, 3), (-94, 15, 15, 3, -4),
                (-24, 19, 18, 28, -1), (-6, 17, 18, 16, 0), (14, 16, 17, 10, 1)]   # the last two fill its middle


# ------------------------------------------------------------------------------------------------ lounge furniture

BEANBAG_TONES = {'cinza': ('#4A566C', '#7A8DAA', '#A0ADC4', '#B9C4D6', '#6B7F9D'),
                 'menta': ('#1F6E62', '#45BFA8', '#6EE6D1', '#A8F5E6', '#2C8F7D')}   # soft mint: no glow at night


def beanbag(colour, dx=0, dy=0, tall=0):
    """A beanbag a tile and a quarter across: a puffy pear narrower at the top, lit from the top left in three bands,
    its rim in shade, a star crease where people sit, its shadow on the floor. A seat (BEANBAG_SEAT); `dx` moves the bag
    off its sitting point, so a pair can overlap."""
    o, sh, b, l, crease = BEANBAG_TONES[colour]
    w, h = 48 + max(0, dx), 48 + max(0, dy)
    a = blank(w, h)
    for y, (x0, x1, al) in zip(range(43 + dy, 47 + dy), ((10, 38, 36), (6, 42, 50), (6, 42, 48), (10, 38, 30))):
        if y < h:
            shade_row(a, y, x0 + dx, x1 + dx, al)
    cx, cy = 23.5 + dx, 26.0 + dy
    inside = np.zeros((h, w), bool)
    for y in range(h):
        for x in range(w):
            ry = (17.0 if y < cy else 18.0) + tall
            rx = 20.0 - max(0.0, (cy - y) * 0.22)          # a pear sat down: narrower towards the top
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                inside[y, x] = True
    hi = '#FFFFFF' if colour == 'cinza' else '#D8FFF6'
    for y in range(h):
        for x in range(w):
            if not inside[y, x]:
                continue
            u = (x - cx) / 20.0 + (y - cy) / 17.0          # 0 in the middle, - towards the light
            rim = y > cy + 9 and ((x + 0.5 - cx) / 20.0) ** 2 + ((y + 0.5 - cy - 3) / 15.0) ** 2 > 1.0
            tone = sh if rim or u > 0.55 else l if u < -0.5 else b
            put(a, x, y, tone)
            if any(not (0 <= y + j < h and 0 <= x + i < w and inside[y + j, x + i])
                   for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                put(a, x, y, o)
    for x, y in ((round(cx) - 10, 16 + dy), (round(cx) - 11, 17 + dy), (round(cx) - 9, 15 + dy)):   # a glint
        put(a, x, y, hi)
    sx, sy = round(cx - 0.5), round(cy - 4)
    for dx_, dy_ in ((0, -6), (-7, 3), (7, -2), (5, 6), (-4, 7)):   # the star crease: five dents from the middle,
        n = max(abs(dx_), abs(dy_))                                  # dark with a lit lip on their lower side
        for k in range(n + 1):
            x, y = round(sx + dx_ * k / n), round(sy + dy_ * k / n)
            put(a, x, y, crease)
            if k and a[y + 1, x, 3]:
                put(a, x, y + 1, l)
    fill(a, sx - 1, sy - 1, sx + 1, sy, crease)
    return image(a)


BEANBAG_SEAT = dict(anchorOffset=dict(x=24, y=26), direction='down')


def arc_lamp():
    """An arc floor lamp: a round puck base, a pole rising on the right and arching over into the cap of a big glossy
    black dome with a warm lit rim (fx.py measures it as a pendant: the light under the dome)."""
    w, h = 64, 80
    a = blank(w, h)
    for y, (x0, x1, al) in zip(range(72, 76), ((34, 50, 40), (32, 52, 50), (32, 52, 44), (35, 49, 26))):
        shade_row(a, y, x0, x1, al)
    p0, p1, p2, p3 = np.array([42, 62.0]), np.array([42, 5.0]), np.array([16, 3.0]), np.array([15, 11.0])
    pts = []
    for t in np.linspace(0, 1, 400):
        q = (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3
        pt = (int(round(q[0])), int(round(q[1])))
        if not pts or pts[-1] != pt:
            pts.append(pt)
    for x, y in pts:
        put(a, x, y, '#1C2130')
        put(a, x + 1, y, '#0D1018')
    for x, y in pts:
        if a[y, x - 1, 3] == 0:
            put(a, x - 1, y, '#3B4358')
    for y in range(58, 76):                            # the base: one oval disc, its top a lighter ellipse
        for x in range(30, 56):
            disc = ((x + 0.5 - 42.5) / 10.0) ** 2 + ((y + 0.5 - 66.0) / 5.0) ** 2
            top = ((x + 0.5 - 42.5) / 8.0) ** 2 + ((y + 0.5 - 65.0) / 3.0) ** 2
            if top <= 1.0:
                put(a, x, y, '#5A6580' if (x < 41 and y < 65) else '#3B4358')
            elif disc <= 1.0:
                put(a, x, y, '#1C2130' if y > 65 else '#0D1018')
    fill(a, 12, 9, 17, 12, '#0D1018')                  # the cap where the arc enters, at the dome's top
    fill(a, 13, 10, 15, 11, '#4A5470')
    r = 13.0                                           # the dome: a hemisphere, lit at the top left, a gloss
    for i in range(14):
        y = 13 + i
        half = np.sqrt(max(0.0, r * r - (13.5 - i) ** 2)) if i < 13 else r
        x0, x1 = round(14.5 - half), round(14.5 + half) - 1
        fill(a, x0, y, x1, y, '#0D1018')
        if x1 - x0 > 2:
            fill(a, x0 + 1, y, x1 - 1, y, '#232838')
            fill(a, x0 + 1, y, x0 + max(1, (x1 - x0) // 3), y, '#323A4E')
            if i < 7:
                fill(a, x0 + 1, y, x0 + max(1, (x1 - x0) // 5), y, '#4A5470')
    for x, y in ((8, 16), (7, 17), (7, 18), (6, 19)):
        put(a, x, y, '#8A96B0')
    top = 27
    for j, half in enumerate((13, 12.5, 11.5, 10, 7.5)):   # its lit rim, seen from below: an orange-yellow band
        y = top + j
        x0, x1 = round(14.5 - half), round(14.5 + half) - 1
        fill(a, x0, y, x1, y, '#C9772A')
        if x1 - x0 > 2:
            fill(a, x0 + 1, y, x1 - 1, y, '#FAC85A')
        if x1 - x0 > 10 and j < 3:
            fill(a, x0 + 5, y, x1 - 5, y, '#FCE79A')
    return image(a)


WALNUT = {k: rgb(v) for k, v in dict(line='#3A2219', dark='#5E3B30', shade='#7D5143', mid='#8A5D49', light='#986A52',
                                     hi='#B08064').items()}   # a medium walnut: dark enough by day, not black at night


SLATE = dict(line='#465670', shade='#7387A4', base='#94A6C1', light='#B3C2D8', hi='#CCD7E6', dimple='#6E819F',
             foot='#2E3446')


def sofa(dx=5):
    """A three-seat sofa in blue slate, seen from the front a little above: the back cushions in three bands of light
    with two rows of buttons, the seat cushions' tops, their front panel, rounded arms, small dark feet, a warm shadow
    on the floor; drawn `dx` px right of its seats. A seat with three sitting points, the catalogue couch's contract
    (SOFA_SEAT)."""
    w, h = 3 * T + dx, 2 * T + 2
    a = blank(w, h)
    X = lambda x: x + dx
    line, seam, back_hi, back, back_lo = '#283756', '#586C8A', '#8496B4', '#7486A5', '#687A99'
    seat_hi, seat, front_hi, front, dimple, glint = '#B4C1D8', '#9EACC6', '#6A7E9C', '#5F7391', '#4A5A7E', '#9AAAC4'
    for y, (x0, x1, al) in zip(range(62, 66), ((5, 90, 166), (3, 92, 130), (3, 92, 100), (6, 89, 70))):
        shade_row(a, y, X(x0), X(x1), al, WARM_SHADOW)
    fill(a, X(6), 26, X(89), 61, line)
    fill(a, X(7), 27, X(88), 30, back_hi)              # the back, lit from above in bands
    fill(a, X(7), 31, X(88), 35, back)
    fill(a, X(7), 36, X(88), 40, back_lo)
    for x in (34, 61):                                 # between the back cushions
        fill(a, X(x), 27, X(x), 40, seam)
    for row, y in enumerate((31, 36)):                 # two rows of buttons on each back cushion
        for x in range(13 + row * 4, 86, 8):
            if x in (33, 34, 35, 60, 61, 62):
                continue
            put(a, X(x), y, dimple)
            put(a, X(x), y - 1, glint)
    fill(a, X(7), 41, X(88), 41, seam)                 # the seam under the back
    for i in range(3):
        x0, x1 = X(8 + i * 27), X(7 + (i + 1) * 27)
        fill(a, x0, 42, x1, 44, seat_hi)               # the seat cushions' tops
        fill(a, x0, 45, x1, 52, seat)
        fill(a, x0, 53, x1, 55, front_hi)              # and their front panel
        fill(a, x0, 56, x1, 60, front)
    for x in (34, 61):
        fill(a, X(x), 42, X(x), 60, seam)
    for x0, lit in ((0, True), (88, False)):          # arms: a rounded top lit from the left, the front in shade
        x0 = X(x0)
        fill(a, x0, 31, x0 + 7, 61, line)
        fill(a, x0 + 1, 32, x0 + 6, 42, '#A9B8D0' if lit else back)
        fill(a, x0 + 1, 32, x0 + 6, 32, '#C4D0E2' if lit else back_hi)
        fill(a, x0 + 1, 43, x0 + 6, 60, front_hi if lit else front)
        outer, inner = (x0, x0 + 7) if lit else (x0 + 7, x0)
        a[31, outer] = 0
        put(a, inner, 31, line)
    for x in (3, 90):                                  # feet
        fill(a, X(x), 61, X(x) + 2, 62, '#1E2638')
    return image(a)


SOFA_SEAT = dict(anchorOffset=dict(x=48, y=40), direction='down', more=[dict(x=21, y=40), dict(x=75, y=40)])


def nightstand(lift=0):
    """A walnut nightstand in 3/4 view: a deep top face in light walnut (where the lamp stands), under it a faint low
    drawer with a tiny knob, square legs; `lift` px higher and as much taller. Without a lift it is a low side table:
    the top face runs down to its short legs."""
    a = blank(T, T)
    W_ = WALNUT
    for y, (x0, x1, al) in zip(range(29, 32), ((4, 27, 46), (3, 28, 50), (5, 26, 28))):
        shade_row(a, y, x0, x1, al)
    top_, hi_ = '#AD7C57', '#C29270'
    fill(a, 3, 8 - lift, 28, 28, W_['line'])
    if not lift:                                       # a side table: an 18 px top face, then its short legs
        fill(a, 4, 9, 27, 26, top_)
        fill(a, 4, 9, 27, 9, hi_)
        fill(a, 4, 9, 5, 26, hi_)
        fill(a, 4, 26, 27, 26, W_['mid'])
    else:
        bottom = 9 - lift + 15
        fill(a, 4, 9 - lift, 27, bottom, top_)                # the top face, 15 px deep
        fill(a, 4, 9 - lift, 27, 9 - lift, hi_)
        fill(a, 4, bottom, 27, bottom, hi_)                 # the front arris
        fill(a, 4, bottom + 1, 27, 26, W_['mid'])           # the front: a faint low drawer
        fill(a, 6, bottom + 2, 25, bottom + 2, W_['shade'])
        put(a, 15, bottom + 5, W_['line'])                  # its knob
    for x in (4, 26):
        fill(a, x, 27, x + 1, 30, W_['line'])
    return image(a)


def plant_bench():
    """A low slatted teak bench for a pot: three slats on short feet."""
    a = blank(26, 14)
    fill(a, 0, 2, 25, 9, WOOD['line'])
    for i, y in enumerate((3, 5, 7)):
        fill(a, 1, y, 24, y + 1, WOOD['light'] if i == 0 else WOOD['mid'])
        fill(a, 1, y + 1, 24, y + 1, WOOD['shade'])
    for x in (2, 21):
        fill(a, x, 10, x + 2, 12, WOOD['line'])
        fill(a, x + 1, 10, x + 1, 11, WOOD['dark'])
    shade_row(a, 13, 1, 24, 40)
    return image(a)


def table_lamp():
    """A table lamp: a bell shade with a rounded top glowing from inside in bands with an orange hem, a round warm glow
    round the shade above the hem (two alpha steps, never over what is under it), a short brass stem, a navy oval base.
    The picture is centred on the shade, so fx.py's light lands on it at night."""
    w, h = 40, 42
    a = blank(w, h)
    cx, top, hem = 20, 15, 30
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot(xx + 0.5 - cx, (yy + 0.5 - 23) * 1.1)
    above = yy < hem - 8                               # a cap of light: never down over the rug's edge
    a[(d <= 19) & above] = (255, 240, 160, 80)         # under 128: fx.py measures the light on the opaque shade
    a[(d <= 13) & above] = (255, 240, 160, 120)
    for y in range(top, hem + 1):
        i = y - top
        half = (3.0 if i == 0 else 4.0) + 3.0 * min(1.0, i / 15) ** 1.4   # a bell: a rounded top, flaring to the hem
        x0, x1 = round(cx - half), round(cx + half) - 1
        core = '#FFFEF3' if i < 6 else '#FFF6D6' if i < 11 else '#FCE7B0'
        fill(a, x0, y, x1, y, '#E39A46')
        if x1 - x0 > 1 and y < hem:
            fill(a, x0 + 1, y, x1 - 1, y, core)
    fill(a, cx - 1, hem + 1, cx, hem + 4, '#C9A04A')   # the stem
    put(a, cx - 1, hem + 1, '#F2D88A')
    for y, (x0, x1) in zip(range(hem + 5, h), ((-3, 2), (-4, 3), (-5, 4), (-5, 4), (-5, 4), (-4, 3), (-3, 2))):
        fill(a, cx + x0, y, cx + x1, y, '#0B2240')    # the oval base: brass in a thin navy ring
        if x1 - x0 > 3:
            fill(a, cx + x0 + 1, y, cx + x1 - 1, y, '#E39A46' if y > hem + 8 else '#FFCA4C')
    return image(a)


def books(colours):
    """A row of upright books for a shelf, each two or three pixels wide, saturated spines with a lit top edge."""
    w = sum(c[1] for c in colours) + len(colours) + 1
    a = blank(w, 16)
    x = 1
    for (colour, width, height) in colours:
        lo = tuple(max(0, v - 50) for v in rgb(colour))
        fill(a, x - 1, 15 - height, x + width, 15, lo)          # its outline in its own dark
        fill(a, x, 16 - height, x + width - 1, 14, colour)
        fill(a, x, 16 - height, x + width - 1, 16 - height, '#F6F1E4')   # the pages' top, seen from above
        put(a, x, 17 - height, tuple(min(255, v + 40) for v in rgb(colour)))
        x += width + 1
    return image(a)


BOOKS = {'quentes': [('#D2453F', 3, 13), ('#14B8B0', 3, 14), ('#16365E', 3, 13), ('#3D6FD6', 3, 12),
                     ('#D2453F', 2, 14)],
         'frios': [('#7A4FB8', 2, 13), ('#14B8B0', 3, 14), ('#F2C14E', 2, 12), ('#1F8C96', 3, 14), ('#3D6FD6', 2, 13),
                   ('#2F8F4E', 2, 12), ('#7A4FB8', 2, 14)]}


def drip_coffee():
    """A black drip coffee machine from the front: a tall back with the water tank, the brew head over a round glass
    carafe of coffee standing on the warming plate, the carafe's handle out to the right."""
    a = blank(26, 30)
    fill(a, 2, 0, 15, 28, '#0D1018')                   # the back and tank
    fill(a, 3, 1, 14, 9, '#2A3040')
    fill(a, 3, 1, 14, 1, '#4A5470')
    fill(a, 11, 3, 13, 8, '#5A88A8')                   # the water window
    fill(a, 2, 9, 21, 12, '#0D1018')                   # the brew head over the carafe
    fill(a, 3, 10, 20, 11, '#232838')
    fill(a, 3, 10, 20, 10, '#3B4358')
    for y in range(14, 26):                            # the carafe: a rounded glass with coffee inside
        half = 6 if 16 <= y <= 24 else 5
        fill(a, 12 - half, y, 12 + half, y, '#7F98A8')
        if y >= 18:
            fill(a, 13 - half, y, 11 + half, y, '#5A3418')
        else:
            fill(a, 13 - half, y, 11 + half, y, '#C9DCE6')
    fill(a, 8, 19, 9, 23, '#8A5A30')                   # light on the coffee
    fill(a, 19, 16, 21, 22, '#0D1018')                 # the handle
    fill(a, 19, 17, 19, 21, (0, 0, 0))
    fill(a, 2, 26, 22, 28, '#1C2130')                  # the warming plate
    fill(a, 2, 26, 22, 26, '#3B4358')
    put(a, 5, 13, '#E5484D')                           # the power light
    fill(a, 2, 29, 22, 29, (*SHADOW,), alpha=50)
    return image(a)


def fruit_bowl():
    """A deep round yellow bowl with a dark rim, heaped with green apples, oranges and a red apple."""
    a = blank(24, 22)
    fruit = [(6, 8, '#7CC04A', '#B6E68A', '#3F7A22'), (12, 6, '#F28C28', '#FFC07A', '#A1520E'),
             (17, 8, '#E5484D', '#FF8A8E', '#8E1E24'), (9, 10, '#F28C28', '#FFC07A', '#A1520E'),
             (15, 11, '#F28C28', '#FFC07A', '#A1520E'), (5, 11, '#7CC04A', '#B6E68A', '#3F7A22')]
    for cx, cy, base, lit, line in fruit:
        for y in range(cy - 4, cy + 4):
            for x in range(cx - 4, cx + 4):
                d = np.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if d <= 2.6:
                    put(a, x, y, lit if (x < cx - 0.5 and y < cy - 0.5) else base)
                elif d <= 3.4:
                    put(a, x, y, line)
    for y in range(12, 21):                            # the bowl: a dark rim, then its yellow body curving in
        half = 10.5 - max(0, y - 14) * 1.0
        x0, x1 = round(12 - half), round(12 + half) - 1
        fill(a, x0, y, x1, y, '#8A5E0C')
        if x1 - x0 > 2 and y > 12:
            fill(a, x0 + 1, y, x1 - 1, y, '#F2C14E')
            fill(a, x0 + 1, y, x0 + 3, y, '#FFE58A')
            fill(a, x1 - 3, y, x1 - 1, y, '#D19A2A')
    fill(a, 6, 21, 17, 21, (*SHADOW,), alpha=50)
    return image(a)


def trophy():
    """A gold cup with handles and a highlight, on a dark navy plinth."""
    a = blank(16, 20)
    gold, hi, sh, line = '#F2C14E', '#FFE58A', '#C98A2E', '#7A5418'
    fill(a, 3, 1, 12, 1, line)
    for y, (x0, x1) in enumerate(((3, 12), (3, 12), (4, 11), (4, 11), (5, 10), (6, 9)), start=2):
        fill(a, x0 - 1, y, x1 + 1, y, line)
        fill(a, x0, y, x1, y, gold)
        put(a, x1, y, sh)
    fill(a, 4, 2, 5, 5, hi)
    for x in (1, 14):                                  # handles
        fill(a, x, 3, x, 5, line)
    fill(a, 2, 3, 2, 3, line)
    fill(a, 13, 3, 13, 3, line)
    fill(a, 7, 8, 8, 10, sh)                           # the stem
    fill(a, 5, 11, 10, 12, gold)
    fill(a, 5, 11, 10, 11, hi)
    fill(a, 3, 13, 12, 18, '#0B1736')                  # the plinth
    fill(a, 4, 13, 11, 13, '#24497A')
    fill(a, 3, 19, 12, 19, (*SHADOW,), alpha=50)
    return image(a)


def trailing_pothos():
    """A pothos at the end of a shelf: a bushy crown hiding its pot, four vines spilling over the edge and hanging down,
    heart leaves six or seven pixels across along them."""
    a = blank(30, 46)
    line, sh, base, lit = LEAF['line'], LEAF['shade'], LEAF['base'], LEAF['light']
    heart = ['.##.##.', '#LLBBB#', '#LBBBS#', '.#BBS#.', '..#S#..', '...#...']
    tones = {'#': line, 'L': lit, 'B': base, 'S': sh}
    fill(a, 8, 9, 20, 15, '#9C8E72')                   # the pot, hidden under the crown
    fill(a, 9, 9, 19, 14, '#F3EAD6')
    for x, top, bottom in ((7, 12, 36), (13, 12, 44), (18, 11, 40), (24, 11, 30)):
        for y in range(top, bottom):
            put(a, x + int(round(np.sin(y / 4.0 + x) * 1.0)), y, LEAF['rib'])
        for k, y in enumerate(range(top + 2, bottom - 3, 6)):
            xx = x + int(round(np.sin(y / 4.0 + x) * 1.0)) + (0 if k % 2 else -6)
            stamp(a, xx, y - 1, heart, tones)
    for xx, y in ((2, 3), (8, 0), (14, 1), (20, 3), (5, 7), (12, 6), (19, 8), (24, 6), (9, 11)):   # the crown
        stamp(a, xx, y, heart, tones)
    return image(a)


def side_table():
    """A little round walnut table on three legs: its top seen from above, deep, its dark edge in front."""
    a = blank(T, 36)
    for y, (x0, x1, al) in zip(range(32, 35), ((10, 26, 44), (8, 28, 50), (10, 26, 28))):
        shade_row(a, y, x0, x1, al, WARM_SHADOW)
    for x0, x1 in ((11, 10), (24, 25), (18, 18)):      # three legs
        for y in range(15, 33):
            x = round(x0 + (x1 - x0) * (y - 15) / 17)
            fill(a, x, y, x + 1, y, '#5A3824')
            put(a, x + 2, y, '#7A4E33')
    for y in range(5, 18):
        for x in range(4, 32):
            d = ((x + 0.5 - 18.5) / 11.5) ** 2 + ((y + 0.5 - 11.5) / 6.0) ** 2
            if d <= 0.62:
                put(a, x, y, '#B88358' if (x < 17 and y < 11) else '#A0704A')
            elif d <= 1.0:
                put(a, x, y, '#5A3824' if y >= 12 else '#7A4E33')
    return image(a)


def coffee_table():
    """A white oval coffee table: its top in two bands of light, a thick lavender-grey rim, the shade under it and four
    short legs; drawn in the top tile of its canvas (its collision), offset right where the lounge's axis runs."""
    w, h = 3 * T, 2 * T
    a = blank(w, h)
    cx, cy, rx, ry = 55.0, 12.0, 31.0, 9.5
    for x in (34, 47, 63, 76):                         # stub legs under the rim
        fill(a, x, 28, x + 1, 31, '#3E465E')
    for y in range(0, 32):
        for x in range(18, 96):
            top = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
            rim = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy - 7) / ry) ** 2
            under = ((x + 0.5 - cx) / (rx - 2)) ** 2 + ((y + 0.5 - cy - 9) / ry) ** 2
            if top <= 0.88:
                put(a, x, y, '#FFFFFF' if (y < cy - 3 and x < cx + 4) else '#F2F4F9')
            elif top <= 1.0:
                put(a, x, y, '#A9AFC6')
            elif y > cy and rim <= 0.92:
                put(a, x, y, '#C4C6E0' if y < cy + ry + 3 else '#A9AED0')
            elif y > cy and rim <= 1.0:
                put(a, x, y, '#6E7596')
            elif y > cy and under <= 1.0:
                put(a, x, y, '#4E5670')
    return image(a)


# ------------------------------------------------------------------------------------------------ game terminals

def air_hockey():
    """An air-hockey table across the view (players at the left and right ends): navy rails lit turquoise on top, an
    ice surface with a red centre line and circle, turquoise goal creases and dark goal slots, a red and a blue mallet
    and the puck, a navy apron with a turquoise stripe, four legs."""
    a = blank(2 * T, 2 * T)
    line, rail, ice, ice_hi = '#0B2240', '#16365E', '#E3F2F8', '#F4FBFD'
    red, red_hi, red_lo = '#E5484D', '#FF8A8E', '#8E1E24'
    fill(a, 1, 6, 62, 50, line)
    fill(a, 2, 7, 61, 45, rail)
    fill(a, 2, 7, 61, 8, TURQUOISE)                    # the top rail, lit
    fill(a, 5, 10, 58, 41, ice)
    fill(a, 5, 10, 58, 12, ice_hi)
    fill(a, 31, 10, 32, 41, red)                       # centre line and circle
    for y in range(10, 42):
        for x in range(5, 59):
            d = np.hypot(x - 31.5, (y - 25.5) / 0.8)
            if 5.4 <= d < 7.0:
                put(a, x, y, red)
            for gx in (5, 58):                         # goal creases
                g = np.hypot(x - gx, (y - 25.5) / 0.8)
                if 7.0 <= g < 8.0:
                    put(a, x, y, TURQUOISE)
    fill(a, 2, 20, 4, 31, '#050C1C')                   # goal slots in the end rails
    fill(a, 59, 20, 61, 31, '#050C1C')
    for (cx, cy), (lo, base, hi) in (((14, 25), (red_lo, red, red_hi)), ((49, 26), ('#18397A', '#2F6FD6', '#7FB0FF'))):
        for y in range(cy - 4, cy + 4):
            for x in range(cx - 4, cx + 4):
                d = np.hypot(x - cx + 0.5, (y - cy + 0.5) / 0.85)
                if d <= 3.6:
                    put(a, x, y, hi if (x < cx - 1 and y < cy - 1) else base)
                elif d <= 4.4:
                    put(a, x, y, lo)
    fill(a, 37, 22, 39, 23, '#1A1A1A')                 # the puck
    put(a, 37, 22, '#4A4A4A')
    fill(a, 2, 46, 61, 49, rail)                       # the apron
    fill(a, 2, 47, 61, 47, TURQUOISE)
    for x in (4, 56):
        fill(a, x, 51, x + 3, 58, line)
        fill(a, x + 1, 51, x + 2, 57, '#2A3A5C')
    for y in (57, 58, 59):
        shade_row(a, y, 3, 60, 48 if y < 59 else 28)
    return image(a)


def chessboard():
    """A chessboard mid-game for a table top: a teak frame, eight by eight squares (3 x 2 px, foreshortened), a few
    pieces of each colour standing on them, the board's front edge."""
    w, h = 28, 22
    a = blank(w, h)
    fill(a, 1, 5, 26, 21, WOOD['line'])
    fill(a, 2, 6, 25, 19, WOOD['shade'])
    for j in range(8):
        for i in range(8):
            fill(a, 2 + i * 3, 6 + j * 2 - 0, 4 + i * 3, 7 + j * 2 - 0, '#E9DFC4' if (i + j) % 2 == 0 else '#6E4630')
    fill(a, 2, 22 - 2, 25, 20, WOOD['mid'])           # front edge of the board
    pieces = [(1, 6, 'b'), (3, 6, 'b'), (4, 7, 'b'), (6, 6, 'b'), (2, 8, 'b'), (5, 8, 'b'),
              (1, 12, 'w'), (3, 13, 'w'), (4, 12, 'w'), (6, 13, 'w'), (2, 11, 'w'), (7, 12, 'w')]
    for col, row, side in pieces:
        x, y = 2 + col * 3, row
        top, body, edge = ('#4A4A4A', '#1A1A1A', '#0A0A0A') if side == 'b' else ('#FFFFFF', '#E6E4DC', '#8C887C')
        fill(a, x, y - 3, x + 1, y, body)
        put(a, x, y - 3, top)
        fill(a, x + 2, y - 2, x + 2, y, edge)
    return image(a)


def connect_four():
    """A connect-four rack for a table top: a blue frame of seven columns and six rows, red and yellow discs in a game
    under way, two feet."""
    w, h = 25, 24
    a = blank(w, h)
    fill(a, 1, 1, 23, 20, '#0F2460')
    fill(a, 2, 2, 22, 19, '#2F5FD0')
    fill(a, 2, 2, 22, 2, '#5C86E8')
    fill(a, 2, 2, 2, 19, '#5C86E8')
    board = ['.......',
             '.......',
             '...y...',
             '..rr...',
             '.yyr.r.',
             'rryyyry']
    for j, row in enumerate(board):
        for i, ch in enumerate(row):
            x, y = 3 + i * 3, 3 + j * 3
            colour = {'r': '#E5484D', 'y': '#F2C14E'}.get(ch, '#0F2460')
            fill(a, x, y, x + 1, y + 1, colour)
            if ch != '.':
                put(a, x, y, '#FF9A9C' if ch == 'r' else '#FFE7A0')
    for x in (3, 19):                                  # feet
        fill(a, x, 21, x + 2, 22, '#0F2460')
    fill(a, 1, 23, 23, 23, (*SHADOW, ), alpha=40)
    return image(a)


def arcade_breakout():
    """The catalogue's white arcade with a breakout screen (rows of bricks, the paddle and the ball) and its orange
    trim in the brand's turquoise and mint, so it reads as its own game beside the others."""
    import catalogue as CAT
    f = next(f for f in CAT.catalog()['furniture']
             if (f['type'], f['color'], f['orientation'], f['published']) == ('Arcade Machine', 'white', 'Down', True))
    a = np.asarray(CAT.furniture_piece(f)[0]).copy()
    # the control panel goes lime, not mint: fx.py finds an arcade's screen as its block of blue-over-red pixels
    swap = {'#ffa340': TURQUOISE, '#fa6262': NAVY, '#fed462': MINT, '#ffce8d': '#C8EFA0', '#db3e48': '#0E7F80',
            '#832242': '#0B4A55'}
    for src, dst in swap.items():
        hit = (a[..., :3] == rgb(src)).all(-1) & (a[..., 3] > 0)
        hit[52:67, 6:26] = False                       # the screen is redrawn below
        a[hit, :3] = rgb(dst)
    fill(a, 7, 53, 24, 65, '#101C46')                  # the screen: bricks, paddle and ball
    for j, colour in enumerate(('#E5484D', '#FFA340', '#F2C14E', LIME, TURQUOISE)):
        for i in range(6):
            fill(a, 8 + i * 3, 54 + j * 1, 9 + i * 3, 54 + j * 1, colour)
    fill(a, 13, 64, 18, 64, '#DBDDEC')
    put(a, 17, 61, '#FFFFFF')
    return image(a)


def arcade_recoloured(body, swap, screen=None):
    """The catalogue's white arcade with its white body in another colour (`body`: light, side, dark), its trim
    swapped and, if given, its screen drawn anew (`screen(a)`)."""
    a = np.asarray(catalogue_image('Arcade Machine', 'white')).copy()
    full = {'#dbddec': body[0], '#efedf7': body[1], '#afbdd0': body[2], **swap}
    for src, dst in full.items():
        hit = (a[..., :3] == rgb(src)).all(-1) & (a[..., 3] > 0)
        if screen:
            hit[52:67, 6:26] = False
        a[hit, :3] = rgb(dst)
    if screen:
        screen(a)
    return image(a)


def arcade_tetris():
    """Tetris: a navy body, the orange marquee kept, a yellow control strip."""
    return arcade_recoloured(('#24497A', '#2E5A90', '#16365E'), {'#ffce8d': '#F2C14E'})


def arcade_2048():
    """2048: a steel-blue body, a mint marquee, a dark screen with a grid of green and purple tiles."""
    def screen(a):
        fill(a, 7, 53, 24, 65, '#101C46')
        tones = ['#6EE6D1', '#7A4FB8', '#96D664', '#2F8F4E', '#B48CE0', '#14B8B0']
        for j in range(3):
            for i in range(4):
                fill(a, 8 + i * 4, 54 + j * 4, 10 + i * 4, 56 + j * 4, tones[(i + j * 2) % len(tones)])
    return arcade_recoloured(('#5B86BC', '#7FA6D6', '#3D628F'), {'#ffa340': MINT, '#fa6262': '#0E7F80',
                                                                  '#fed462': '#DCFFF8', '#ffce8d': '#C8EFA0'}, screen)


# ------------------------------------------------------------------------------------------------ dressed pieces
# Furniture and the things on it as one picture. Each texture in the map costs draw calls in every frame (the engine
# draws all objects, wherever the camera is: hq-office/README.md, Desempenho), and the room's twenty-odd props on
# shelves, tables and couches pushed the budget past 30 calls (perf.py --check, 20/10/2026). The offsets are where the
# separate pieces stood in the engine.

def catalogue_image(type_, colour, direction='Down'):
    import catalogue as CAT
    f = next(f for f in CAT.catalog()['furniture']
             if (f['type'], f['color'], f['orientation'], f['published']) == (type_, colour, direction, True))
    return CAT.furniture_piece(f)[0]


def composite(size, layers):
    """Pictures pasted in order on a transparent canvas: [(image, x, y)]."""
    out = Image.new('RGBA', size)
    for img, x, y in layers:
        out.alpha_composite(img, (x, y)) if x >= 0 and y >= 0 else out.paste(img, (x, y), img)
    return out


# The panel's two pictures: colour fields in the brand's tones, each blob with a one-pixel rim in the tone between it
# and what it lies on, so the fields read soft without a gradient. (colour, kind, box as fractions); painted in order.
PANEL_ART = {
    'menta': [(NAVY, 'rect', (0, 0, 1, 1)), ('#14B8B0', 'blob', (-0.1, -0.15, 0.55, 0.5)),
              ('#C9E58A', 'blob', (0.55, -0.1, 1.15, 0.4)), ('#1E6E8A', 'blob', (0.35, 0.25, 0.75, 0.6)),
              ('#6EE6D1', 'swoosh', (0.05, 0.35, 0.8, 1.0)), ('#96D664', 'blob', (-0.15, 0.62, 0.35, 1.2))],
    'lima': [(NAVY, 'rect', (0, 0, 1, 1)), ('#D9B26A', 'blob', (-0.15, -0.2, 0.42, 0.5)),
             ('#14B8B0', 'blob', (-0.15, 0.4, 0.5, 1.2)), ('#1E6E8A', 'blob', (0.6, 0.15, 1.15, 0.7)),
             ('#6EE6D1', 'blob', (0.28, 0.25, 0.72, 0.72)), ('#96D664', 'blob', (0.5, 0.6, 1.15, 1.2))],
}


def panel_picture(kind, w=42, h=40):
    """A picture for the panel: a thick charcoal frame bevelled light at the top left, a white mat, and the colour
    fields of PANEL_ART."""
    a = blank(w, h)
    fill(a, 0, 0, w - 1, h - 1, '#14161F')
    fill(a, 1, 1, w - 2, h - 2, '#23263A')             # the bevel: dark bottom and right
    fill(a, 1, 1, w - 2, 1, '#5A5F73')                 # lit top and left
    fill(a, 1, 1, 1, h - 2, '#5A5F73')
    fill(a, 2, 2, w - 3, 3, '#3E4256')
    fill(a, 2, 2, 3, h - 3, '#3E4256')
    fill(a, 4, 4, w - 5, h - 5, '#F4F6F9')             # the mat, its shade under the frame's top
    fill(a, 4, 4, w - 5, 4, '#D5DAE2')
    fill(a, 4, 4, 4, h - 5, '#D5DAE2')
    x0, y0, iw, ih = 7, 7, w - 14, h - 14
    art = np.zeros((ih, iw, 3), np.uint8)
    owner = np.full((ih, iw), -1)
    ys, xs = np.mgrid[0:ih, 0:iw]
    u, v = (xs + 0.5) / iw, (ys + 0.5) / ih
    for i, (colour, shape, (bx0, by0, bx1, by1)) in enumerate(PANEL_ART[kind]):
        cx, cy, rx, ry = (bx0 + bx1) / 2, (by0 + by1) / 2, (bx1 - bx0) / 2, (by1 - by0) / 2
        if shape == 'rect':
            m = np.ones((ih, iw), bool)
        elif shape == 'blob':
            m = ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1
        else:                                          # a swoosh: a band rising from the bottom left
            t = (u - bx0) / (bx1 - bx0)
            centre = by1 - (by1 - by0) * np.sin(np.clip(t, 0, 1) * np.pi / 2)
            m = (t >= 0) & (t <= 1) & (np.abs(v - centre) < 0.12)
        art[m] = rgb(colour)
        owner[m] = i
    soft = art.copy()                                  # the rims: a blob pixel next to an earlier field
    for y in range(ih):
        for x in range(iw):
            for j, i in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                yy, xx = y + j, x + i
                if 0 <= yy < ih and 0 <= xx < iw and owner[yy, xx] < owner[y, x]:
                    soft[y, x] = (art[y, x].astype(int) + art[yy, xx].astype(int)) // 2
                    break
    a[y0:y0 + ih, x0:x0 + iw, :3] = soft
    a[y0:y0 + ih, x0:x0 + iw, 3] = 255
    return image(a)


def dressed_panel():
    """The navy panel with the two brand pictures standing in front of its ends (a tile wider each side for them)."""
    return composite((8 * T, 2 * T), [(panel(), T, 0), (panel_picture('menta'), T - 6, 11),
                                      (panel_picture('lima'), T + 151, 11)])


def dressed_credenza():
    """The console with its books, little plants, the trophy and the pothos spilling over its right end."""
    small = lambda kind: bird_of_paradise(SHELF_LEAFY if kind == 'folhas' else SHELF_FERN, size=(30, 28),
                                          pot=(15, 18, 13, 10, 8), tones=CREAM, floor_shade=False, leaf=LEAF_LIGHT)
    return composite((8 * T, 2 * T), [(credenza(), 0, 0), (books(BOOKS['quentes']), 25, 19), (small('folhas'), 44, 7),
                                      (small('samambaia'), 68, 7), (trophy(), 121, 11), (small('folhas'), 155, 7),
                                      (books(BOOKS['frios']), 184, 19), (trailing_pothos(), 201, 16)])


def dressed_bar():
    leaves = [(a_, l_ + 1, w_ + 1, st, dx) for a_, l_, w_, st, dx in SHELF_LEAFY]
    small = bird_of_paradise(leaves, size=(32, 34), pot=(16, 23, 10, 8, 10), tones=POT, floor_shade=False,
                             leaf=LEAF_LIGHT)
    return composite((4 * T, 2 * T), [(bar_counter(), 0, 0), (drip_coffee(), 18, 11), (fruit_bowl(), 60, 19),
                                      (small, 81, 10)])


def dressed_sofa(which):
    """The sofa with its cushions (and the mint throw over the upper one's left seat)."""
    layers = [(sofa(), 0, 0)]
    if which == 'manta':
        layers += [(throw(), 16, 42), (cushion('turquesa'), 31, 30), (cushion('lima'), 72, 30)]
    else:
        layers += [(cushion('lima'), 15, 30), (cushion('turquesa'), 28, 30), (cushion('menta'), 73, 30)]
    return composite((3 * T + 5, 2 * T + 2), layers)


def mug(body, shade, lit, handle):
    """A ceramic mug from the side and a little above: the rim, coffee inside, the body lit on its left, a handle on
    `handle` ('left' or 'right')."""
    a = blank(11, 11)
    x0 = 4 if handle == 'left' else 1
    line = '#1C2033'
    fill(a, x0, 1, x0 + 5, 9, line)
    fill(a, x0 + 1, 2, x0 + 4, 2, lit)                 # the rim's far edge and the coffee
    fill(a, x0 + 1, 3, x0 + 4, 3, '#4A2C1B')
    fill(a, x0 + 1, 4, x0 + 4, 8, body)
    fill(a, x0 + 1, 4, x0 + 1, 8, lit)
    fill(a, x0 + 4, 4, x0 + 4, 8, shade)
    hx = x0 - 3 if handle == 'left' else x0 + 6        # the handle: a ring
    fill(a, hx, 3, hx + 2, 7, line)
    a[4:7, hx + 1] = 0
    fill(a, x0, 10, x0 + 5, 10, (*SHADOW,), alpha=50)
    return image(a)


def glass():
    """A small glass of water: a pale clear body, its water line, a glint."""
    a = blank(6, 9)
    fill(a, 0, 0, 5, 7, '#8FB0BE')
    fill(a, 1, 0, 4, 6, (216, 236, 242), alpha=200)
    fill(a, 1, 3, 4, 6, (170, 214, 232), alpha=220)
    fill(a, 1, 1, 1, 5, '#FFFFFF')
    fill(a, 0, 8, 5, 8, (*SHADOW,), alpha=50)
    return image(a)


def dressed_coffee_table():
    """The oval coffee table, a tile taller above for what stands on it: a teal mug, a glass behind the chessboard,
    the chessboard, a navy mug."""
    return composite((3 * T, 3 * T), [(coffee_table(), 0, T), (mug('#14B8B0', '#0E7F80', '#6EE6D1', 'left'), 30, T + 8),
                                      (glass(), 45, T + 2), (chessboard(), 50, T - 5),
                                      (mug('#16365E', '#0B1736', '#3D6FD6', 'right'), 69, T + 10)])


def dressed_lig4_table():
    return composite((T, 2 * T), [(catalogue_image('Round Table', 'lightcoffee'), 0, T), (connect_four(), 4, T - 9)])


def dressed_plant_bench():
    return composite((T, 40), [(plant_bench(), 3, 26), (catalogue_image('Potted Fern', 'white'), 0, 0)])


def dressed_side_table():
    return composite((T, 52), [(side_table(), 0, 16), (catalogue_image('Mug (Wide)', 'white'), 3, 9)])


def lamp_nightstand(pool, lift=0, rug=None):
    """A nightstand with, by day, its lamp's pool of light on the floor round it, stopping short of the sofa on its
    right and off the rug (`rug`: x0, y0, x1, y1 in this picture). The lamp stands on it as its own piece: its light at
    night comes from its picture."""
    p = np.asarray(pool)
    out = np.zeros((3 * T, 4 * T, 4), np.uint8)
    x0, y0 = 2 * T + 16 - p.shape[1] // 2, 2 * T - p.shape[0] // 2 + 2
    for y in range(p.shape[0]):
        for x in range(p.shape[1]):
            X, Y = x0 + x, y0 + y
            if 0 <= X < 3 * T + 3 and 0 <= Y < 3 * T:
                if rug and rug[0] <= X <= rug[2] and rug[1] <= Y <= rug[3]:
                    continue
                out[Y, X] = p[y, x]
    return composite((4 * T, 3 * T), [(Image.fromarray(out, 'RGBA'), 0, 0), (nightstand(lift), 2 * T, T)])


def lit_arc_lamp():
    """The arc lamp with its pool of light on the floor under the dome, by day: brighter towards an orange heart by the
    base, and stopping at the rug's tassels on its left (35 px into this picture)."""
    # alphas stay under 128: fx.py measures the lamp's light on its opaque pixels, and the pool is not the lamp
    main = light_pool([(40, 22), (26, 14)], [90, 125], '#FFEC96')
    pa = np.asarray(composite((110, 96), [(main, 10, 28)])).copy()
    heart = np.asarray(composite((110, 96), [(light_pool([(13, 8)], [120], '#FFCF7A'), 47, 46)]))
    hit = (heart[..., 3] > 0) & (pa[..., 3] > 0)
    pa[hit, :3] = heart[hit, :3]
    pa[:, :35] = 0
    return composite((110, 96), [(Image.fromarray(pa, 'RGBA'), 0, 0), (arc_lamp(), 27, 0)])


def lit_carpet(pool):
    """The carpet with the pendant's pool of light on it, its bands in the stepped teal-to-olive of the target."""
    base = game_carpet()
    b = np.asarray(base).astype(int)
    o = b.copy()
    a = np.zeros_like(o)
    pa = np.asarray(pool)
    x0, y0 = 95, 30
    a[y0:y0 + pa.shape[0], x0:x0 + pa.shape[1]] = pa[:o.shape[0] - y0, :o.shape[1] - x0]
    navy = b[..., :3][(b[..., 2] < 120)].mean(0)       # the pile's mean: its dashes stay visible inside the light
    for al, colour in ((70, '#32646E'), (110, '#557D6C'), (150, '#7F9161')):
        hit = a[..., 3] == al
        o[hit, :3] = np.clip(np.array(rgb(colour)) + (b[hit, :3] - navy), 0, 255)
    line = (b[..., 1] > 120) & (b[..., 2] > 120) & (a[..., 3] > 0)   # the path reads through the light, warmed
    o[line, :3] = (b[line, :3] * 3 + o[line, :3]) // 4
    return Image.fromarray(o.astype(np.uint8), 'RGBA')


def foosball_raised():
    """The catalogue's foosball table drawn 15 px higher in a canvas a tile taller, so it sits where the room's layout
    wants it while its collision stays on its tile row."""
    return composite((2 * T, 4 * T), [(catalogue_image('Foosball Table', 'teal'), 0, T - 15)])


def cues_and_darts():
    return composite((2 * T, 2 * T), [(cue_rack(), 0, 0), (dartboard(), T, 0)])


def beanbag_pair():
    """The grey beanbag and the mint one over its lower right on a dark mat, one piece with two seats
    (BEANBAG_PAIR_SEAT)."""
    mat = blank(80, 80)                                # a darker rounded patch of carpet, mostly under the bags
    for y in range(25, 75):
        for x in range(7, 80):
            cx_, cy_ = min(max(x + 0.5, 15), 72), min(max(y + 0.5, 33), 67)
            if np.hypot(x + 0.5 - cx_, y + 0.5 - cy_) <= 8:
                mat[y, x] = (*rgb('#0F3456'), 255)
    return composite((80, 80), [(image(mat), 0, 0), (beanbag('cinza', dx=8, dy=8, tall=2), 0, 0),
                                (beanbag('menta', dx=4), T, T - 2)])


BEANBAG_PAIR_SEAT = dict(anchorOffset=dict(x=24, y=26), direction='down', more=[dict(x=24 + T, y=26 + T)])


# ------------------------------------------------------------------------------------------------ collection

@lru_cache(maxsize=None)
def pieces():
    flat = lambda img: -(img.height + 96)                     # rugs sort under everything, as the other rugs
    rug = rug_lattice()
    pendant_pool = light_pool([(75, 46), (52, 31), (33, 17)], [70, 110, 150], '#D6C054', wobble=0.1, rise=0.25, jag=3)
    lamp_pool = light_pool([(34, 20), (22, 13)], [80, 130], '#FFF0A0')
    carpet = lit_carpet(pendant_pool)
    plant = lambda leaves, **kw: dict(image=bird_of_paradise(leaves, **kw), collisionGrid=None, depthOffset=-4)
    return {
        'Koncluí: painel': {'navy': dict(image=dressed_panel(), collisionGrid=[[0] * 8, [0] + [1] * 6 + [0]],
                                         depthOffset=-8)},
        # its picture ends higher than the panel's: sorted just after the panel's line, so it hangs in front of it
        'Koncluí: neon': {'ondas': dict(image=neon(), collisionGrid=None, depthOffset=16)},
        'Koncluí: aparador': {'teca': dict(image=dressed_credenza(), collisionGrid=[[0] * 8, [0] + [1] * 6 + [0]],
                                           depthOffset=-8)},
        'Koncluí: balcão de bar': {'teca': dict(image=dressed_bar(), collisionGrid=[[0] * 4, [1, 1, 1, 0]],
                                                depthOffset=-8)},
        'Koncluí: banqueta': {'turquesa': dict(image=stool(), collisionGrid=None, seat=STOOL_SEAT)},
        'Koncluí: sofá': {k: dict(image=dressed_sofa(k), collisionGrid=None, seat=SOFA_SEAT)
                          for k in ('manta', 'almofadas')},
        # the rug's corner in each nightstand's picture (plan.py: rug at 71, 35 px 22, 2; nightstands at 70, 33/37)
        'Koncluí: criado-mudo': {k: dict(image=lamp_nightstand(lamp_pool, lift, rug), depthOffset=-36,
                                         collisionGrid=[[0] * 4, [0, 0, 1, 0], [0] * 4])
                                 for k, lift, rug in (('alto', 0, (54, 66, 999, 999)),
                                                      ('baixo', 7, (54, -99, 999, 38)))},
        'Koncluí: luminária de mesa': {'creme': dict(image=table_lamp(), collisionGrid=None, depthOffset=0)},
        'Koncluí: mesa de centro': {'branca': dict(image=dressed_coffee_table(),
                                                   collisionGrid=[[0, 0, 0], [0, 1, 1], [0, 0, 0]], depthOffset=-30)},
        'Koncluí: tapete 6x3': {'losangos': dict(image=rug, collisionGrid=None, depthOffset=flat(rug))},
        'Koncluí: luminária de arco': {'preto': dict(image=lit_arc_lamp(), collisionGrid=None,
                                                     depthOffset=-22)},
        'Koncluí: banco de plantas': {'teca': dict(image=dressed_plant_bench(), collisionGrid=None, depthOffset=0)},
        # the corner plants and the monstera stand in shorter pots than the tall ones by the right wall
        'Koncluí: planta ave-do-paraíso': {'branco': plant(BIRD_TALL, pot=(32, 71, 23, 17, 22)),
                                           'alta': plant(BIRD_TALLER)},
        'Koncluí: planta costela-de-adão': {'branco': plant(MONSTERA_BIG, slits=3, pot=(32, 71, 22, 16, 22))},
        'Koncluí: planta aglaonema': {'branco': plant(AGLAONEMA, size=(48, 64), pot=(24, 40, 20, 15, 20))},
        # the games corner
        'Koncluí: carpete de jogos': {'navy': dict(image=carpet, collisionGrid=None, depthOffset=flat(carpet))},
        'Koncluí: pendente': {'preto': dict(image=pendant(), collisionGrid=None, depthOffset=100)},
        'Koncluí: tacos': {'escuro': dict(image=cues_and_darts(), collisionGrid=[[0, 0], [1, 1]], depthOffset=-6)},
        'Koncluí: pebolim': {'verde': dict(image=foosball_raised(), collisionGrid=[[0, 0], [0, 0], [1, 1], [0, 0]],
                                           depthOffset=-57)},
        'Koncluí: pufe': {'par': dict(image=beanbag_pair(), collisionGrid=None, seat=BEANBAG_PAIR_SEAT)},
        'Koncluí: mesinha': {'nogueira': dict(image=dressed_side_table(), collisionGrid=None, depthOffset=-4)},
        # game terminals
        'Koncluí: air hockey': {'navy': dict(image=air_hockey(), collisionGrid=[[0, 0], [1, 1]], depthOffset=-6)},
        'Koncluí: mesa com lig 4': {'clara': dict(image=dressed_lig4_table(), collisionGrid=[[0], [1]],
                                                  depthOffset=-23)},
        'Koncluí: fliperama breakout': {'turquesa': dict(image=arcade_breakout(), collisionGrid=[[0], [0], [1]],
                                                          depthOffset=-16)},
        **{f'Koncluí: fliperama {k}': {'cor': dict(image=f(), collisionGrid=[[0], [0], [1]], depthOffset=-16)}
           for k, f in (('tetris', arcade_tetris), ('2048', arcade_2048))},
    }


NAMES = {'Koncluí: painel': 'Painel de destaque navy com quadros', 'Koncluí: neon': 'Letreiro neon de ondas',
         'Koncluí: aparador': 'Aparador baixo de teca com livros e plantas',
         'Koncluí: balcão de bar': 'Balcão de bar de teca com cafeteira',
         'Koncluí: banqueta': 'Banqueta de bar turquesa',
         'Koncluí: sofá': 'Sofá de três lugares ardósia com almofadas',
         'Koncluí: criado-mudo': 'Criado-mudo de nogueira',
         'Koncluí: luminária de mesa': 'Luminária de mesa com cúpula clara',
         'Koncluí: mesa de centro': 'Mesa de centro oval branca com xadrez',
         'Koncluí: tapete 6x3': 'Tapete de losangos 6×3',
         'Koncluí: luminária de arco': 'Luminária de arco com cúpula',
         'Koncluí: banco de plantas': 'Banquinho com samambaia',
         'Koncluí: planta ave-do-paraíso': 'Ave-do-paraíso grande',
         'Koncluí: planta costela-de-adão': 'Costela-de-adão grande', 'Koncluí: planta aglaonema': 'Aglaonema',
         'Koncluí: carpete de jogos': 'Carpete navy da sala de jogos', 'Koncluí: pendente': 'Luminária pendente',
         'Koncluí: tacos': 'Suporte de tacos e alvo de dardos', 'Koncluí: pebolim': 'Pebolim do salão de jogos',
         'Koncluí: pufe': 'Par de pufes', 'Koncluí: mesinha': 'Mesinha redonda de nogueira com caneca',
         'Koncluí: air hockey': 'Mesa de air hockey', 'Koncluí: mesa com lig 4': 'Mesa com Lig 4',
         'Koncluí: fliperama breakout': 'Fliperama de Breakout', 'Koncluí: fliperama tetris': 'Fliperama de Tetris',
         'Koncluí: fliperama 2048': 'Fliperama de 2048'}
