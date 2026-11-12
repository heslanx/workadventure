"""The lawn around the building, drawn at native resolution (one art pixel per map pixel, like pool.py) instead of the
catalogue's flat pale green, which is the only grass the catalogue has.

Pixel-art grass in two layers, so the detail costs few tiles:
  ground   the floor layer: a seamless texture of PERIOD x PERIOD tiles. A base green and small blade marks (lit tip
           over a dark root, placed on a jittered grid so they never clump), with broad sunnier and shadier patches
           from a smooth periodic field. Low contrast on purpose: avatars and furniture stand on it.
  decor    the tile layer "lawn" above the floor: tufts, clover, flower clusters and pebbles, each a transparent tile
           that does not depend on where it lies, so a few dozen tiles cover the whole lawn without repeating.
           Tufts sway together in one gust every LOOP frames of FRAME_MS (the pool's frame), both sway shapes changing
           picture on the same frames: the engine redraws only when a visible animated tile changes picture, so an idle
           room that sees the lawn through its glass redraws 5 times per 14 s instead of 2-3 times a second (owner,
           19/10/2026: "Rajadas juntas e espaçadas", for the idle budget in perf.py). The first frame is the rest pose,
           which is what people see with "Disable map animations".
Colours: greens hue-shifted (shadows cooler, lights warmer), between the catalogue's tree greens; the flowers are the
pool bank's.

  texture()             RGBA, PERIOD * 32 px square, seamless
  decor(cells)          {(tx, ty): [RGBA 32 x 32 per frame]} for the lawn cells given (one frame when static)
  fringe(canvas, ...)   grass spilling 1-3 px over the edge of a path, painted on the floor canvas
  ground_ring(img)      a catalogue tree with the grass mound at its foot (drawn for the flat lawn) in this lawn's colours
"""
import hashlib
from functools import lru_cache

import numpy as np
from PIL import Image

from palette import rgb

T = 32
PERIOD = 12                              # tiles: the ground repeats every 384 px
FRAME_MS = 220                           # the pool's frame
LOOP = 64                                # frames of the breeze loop (14.08 s)
GUST_AT = 8                              # the frame every tuft starts its gust on: frames 0-7 stay the rest pose
SEED = 'konclui-hq-lawn'

GRASS = dict(deep=rgb('#3e8a52'), dark=rgb('#58a660'), shade=rgb('#66b268'), base=rgb('#73bc6f'),
             sun=rgb('#81c676'), light=rgb('#96d27f'), tip=rgb('#bfe596'))
FLOWERS = [(rgb('#f4f4f0'), rgb('#f0c64a')), (rgb('#f0c64a'), rgb('#e8913a')), (rgb('#ee86b3'), rgb('#f4f4f0')),
           (rgb('#c6aee6'), rgb('#f4f4f0'))]          # (petals, centre)
STONE = dict(shadow=rgb('#73839a'), base=rgb('#8695ad'), light=rgb('#afbdd0'))
# the catalogue trees' grass mound, drawn for the flat lawn (#d9efda): fill, rim and outline
RING = {(217, 239, 218): 'sun', (159, 218, 178): 'shade', (137, 199, 157): 'dark'}


def _rng(*key):
    return np.random.default_rng(int.from_bytes(hashlib.sha256('/'.join(map(str, (SEED, *key))).encode()).digest()[:8],
                                                'little'))


# ------------------------------------------------------------------------------------------------ ground

# Blade marks: (dx, dy, part), 't' the lit tips, 'r' the root below them.
MARKS = [
    [(0, 0, 't'), (2, 0, 't'), (1, 1, 'r')],                                  # v
    [(0, 0, 't'), (2, 0, 't'), (4, 0, 't'), (1, 1, 'r'), (3, 1, 'r')],        # w
    [(0, 0, 't'), (0, 1, 'r')],                                               # i
    [(0, 0, 't'), (2, 0, 't'), (1, 1, 't'), (1, 2, 'r')],                     # y
    [(1, 0, 't'), (0, 1, 't'), (0, 2, 'r')],                                  # a blade leaning right
]


def _field(n, rng, freqs=((1, 0), (0, 1), (1, 1), (1, -1), (2, 1), (1, 2), (2, -1), (3, 0))):
    """A smooth field on the n x n torus in [-1, 1]: cosines of whole periods, so it tiles."""
    y, x = np.mgrid[0:n, 0:n] / n * 2 * np.pi
    f = sum(rng.uniform(0.4, 1) / np.hypot(a, b) * np.cos(a * x + b * y + rng.uniform(0, 2 * np.pi)) for a, b in freqs)
    return f / np.abs(f).max()


@lru_cache(maxsize=None)
def texture():
    n, cell = PERIOD * T, 6              # one mark per 6 px cell at most: 64 cells per period, so it tiles
    rng = _rng('ground')
    sun = _field(n, rng)
    # patch edges broken by blade-shaped streaks (3 px tall, staggered per column) instead of a smooth contour
    streak = rng.uniform(-1, 1, (n // 3, n))
    stagger = rng.integers(0, 3, n)
    ys = (np.arange(n)[:, None] + stagger[None, :]) // 3 % (n // 3)
    edge = sun + 0.22 * streak[ys, np.arange(n)[None, :]]
    out = np.empty((n, n, 3), np.uint8)
    out[:] = GRASS['base']
    out[edge > 0.42] = GRASS['sun']
    out[edge < -0.42] = GRASS['shade']
    for cy in range(0, n, cell):
        for cx in range(0, n, cell):
            if rng.uniform() < 0.22:
                continue
            mark = MARKS[rng.integers(len(MARKS))]
            x0, y0 = cx + rng.integers(0, cell - 1), cy + rng.integers(0, cell - 1)
            s = sun[y0 % n, x0 % n]
            # sunny patches: tips catch the light; shady ones: tips in shadow, roots deeper
            if rng.uniform() < 0.5 + 0.45 * s:
                tip, root = (GRASS['tip'] if s > 0.45 and rng.uniform() < 0.6 else GRASS['light']), GRASS['dark']
            else:
                tip, root = GRASS['dark'], (GRASS['deep'] if s < -0.3 else GRASS['dark'])
            for dx, dy, part in mark:
                out[(y0 + dy) % n, (x0 + dx) % n] = tip if part == 't' else root
    return Image.fromarray(np.dstack([out, np.full((n, n), 255, np.uint8)]), 'RGBA')


# ------------------------------------------------------------------------------------------------ decor

def _put(a, x, y, colour):
    if 0 <= x < T and 0 <= y < T:
        a[y, x] = (*colour, 255)


def _tuft(rng):
    """(blades, x, y, reach): blades are (dx from the foot, height, bend, back); reach is how far the tips sway (1 or 2).
    Back blades are drawn first and darker, so the tuft has volume."""
    count = int(rng.integers(6, 11))
    width = count + int(rng.integers(1, 4))
    xs = np.sort(rng.choice(np.arange(width), count, replace=False))
    tall = rng.uniform() < 0.5
    blades = []
    for i, dx in enumerate(xs):
        middle = 1 - abs(i - (count - 1) / 2) / max(1, count / 2)          # taller in the middle
        h = int(round((4 if tall else 3) + middle * (6 if tall else 3) + rng.uniform(-1, 1)))
        bend = (dx - width / 2) / width * 2.6                                 # the outer blades fan out
        blades.append((int(dx), max(2, h), bend, i % 2 == 1))
    blades.sort(key=lambda b: not b[3])                                       # back blades first
    x = int(rng.integers(2, T - width - 2))
    y = int(rng.integers(14, T - 3))
    return blades, x, y, 2 if tall else 1


def _draw_tuft(tuft, sway):
    blades, x0, y0, _ = tuft
    a = np.zeros((T, T, 4), np.uint8)
    width = max(b[0] for b in blades) + 1
    for dx in range(-1, width + 1):                                           # contact shadow under the tuft
        _put(a, x0 + dx, y0 + 1, GRASS['deep'] if 0 <= dx < width else GRASS['dark'])
    for dx, h, bend, back in blades:
        for k in range(h):
            u = k / max(1, h - 1)
            x = x0 + dx + int(round(bend * u * u + sway * u * u))
            if back:
                colour = GRASS['deep'] if k == 0 else GRASS['dark'] if k < h - 1 else GRASS['shade']
            else:
                colour = (GRASS['dark'] if u < 0.3 else GRASS['tip'] if k == h - 1 else GRASS['light'])
            _put(a, x, y0 - k, colour)
    return Image.fromarray(a, 'RGBA')


# the gust: how far a tuft's tips lean, frame by frame from GUST_AT (then at rest)
GUST = {1: [1, 1, 1, 0, -1, 0], 2: [1, 2, 2, 1, -1, 0]}   # both change picture on frames 0, 1, 3, 4, 5 of the gust


def _flowers(rng):
    a = np.zeros((T, T, 4), np.uint8)
    petals, centre = FLOWERS[int(rng.integers(len(FLOWERS)))]
    spots = []
    for _ in range(int(rng.integers(3, 6))):
        for _ in range(20):
            x, y = int(rng.integers(3, T - 4)), int(rng.integers(5, T - 4))
            if all(abs(x - u) > 3 or abs(y - v) > 3 for u, v in spots):
                spots.append((x, y))
                break
    for x, y in sorted(spots, key=lambda p: p[1]):
        _put(a, x, y + 2, GRASS['deep'])                                      # stem and a leaf
        _put(a, x + 1, y + 2, GRASS['dark'])
        _put(a, x - 1, y + 2, GRASS['dark'])
        for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
            _put(a, x + dx, y + dy, petals)
        _put(a, x, y, centre)
        _put(a, x + 1, y + 1, GRASS['deep'])                                  # shade under the petals
    return Image.fromarray(a, 'RGBA')


def _clover(rng):
    a = np.zeros((T, T, 4), np.uint8)
    for _ in range(int(rng.integers(3, 6))):
        x, y = int(rng.integers(4, T - 6)), int(rng.integers(4, T - 5))
        for lx, ly in ((0, 0), (2, 0), (1, 2)):                               # three leaflets, lit from the top left
            _put(a, x + lx, y + ly, GRASS['tip'])
            _put(a, x + lx + 1, y + ly, GRASS['light'])
            _put(a, x + lx, y + ly + 1, GRASS['light'])
            _put(a, x + lx + 1, y + ly + 1, GRASS['dark'])
        _put(a, x + 2, y + 4, GRASS['deep'])                                  # stem in the shadow
    return Image.fromarray(a, 'RGBA')


def _pebbles(rng):
    a = np.zeros((T, T, 4), np.uint8)
    for _ in range(int(rng.integers(1, 3))):
        x, y = int(rng.integers(5, T - 8)), int(rng.integers(8, T - 6))
        w = int(rng.integers(3, 5))
        for dx in range(w):
            _put(a, x + dx, y, STONE['light'] if dx < w - 1 else STONE['base'])
            _put(a, x + dx, y + 1, STONE['base'] if dx < w - 1 else STONE['shadow'])
        for dx in range(1, w + 1):
            _put(a, x + dx, y + 2, GRASS['deep'])                             # shadow on the grass
    return Image.fromarray(a, 'RGBA')


@lru_cache(maxsize=None)
def _variants():
    tufts = [_tuft(_rng('tuft', i)) for i in range(8)]
    return dict(
        tuft=[[_draw_tuft(t, s) for s in (-1, 0, 1, 2)] for t in tufts], reach=[t[3] for t in tufts],
        flowers=[_flowers(_rng('flowers', i)) for i in range(8)],
        clover=[_clover(_rng('clover', i)) for i in range(4)],
        pebbles=[_pebbles(_rng('pebbles', i)) for i in range(3)])


def _noise(tx, ty, scale, key):
    """Smooth value noise over the map in [0, 1] (bilinear between hashed lattice points `scale` tiles apart)."""
    gx, gy = tx / scale, ty / scale
    x0, y0 = int(np.floor(gx)), int(np.floor(gy))
    fx, fy = gx - x0, gy - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    v = [[_rng(key, x0 + i, y0 + j).uniform() for i in (0, 1)] for j in (0, 1)]
    return (v[0][0] * (1 - fx) + v[0][1] * fx) * (1 - fy) + (v[1][0] * (1 - fx) + v[1][1] * fx) * fy


def decor(cells):
    v = _variants()
    out = {}
    for tx, ty in sorted(cells):
        rng = _rng('cell', tx, ty)
        u = rng.uniform()
        meadow = _noise(tx, ty, 7, 'meadow')                                  # flowers gather in a few meadows
        if u < 0.11:
            i = int(rng.integers(len(v['tuft'])))
            frames, gust = v['tuft'][i], GUST[v['reach'][i]]
            lean = [0] * LOOP
            for k, s in enumerate(gust):
                lean[GUST_AT + k] = s
            out[tx, ty] = [frames[s + 1] for s in lean]
        elif u < 0.11 + 0.14 * max(0, meadow - 0.45) / 0.55:
            out[tx, ty] = [v['flowers'][int(rng.integers(len(v['flowers'])))]]
        elif u < 0.16 + 0.12 * max(0, meadow - 0.45) / 0.55:
            out[tx, ty] = [v['clover'][int(rng.integers(len(v['clover'])))]]
        elif u > 0.992:
            out[tx, ty] = [v['pebbles'][int(rng.integers(len(v['pebbles'])))]]
    return out


def ground_ring(img):
    """The grass mound the catalogue draws at a tree's foot, in this lawn's colours (drawn in the flat pale lawn's, it
    reads as a white halo on real grass). Only inside the mound's outline: a snowy tree keeps its pale highlights."""
    a = np.asarray(img.convert('RGBA')).copy()
    hit = {src: (a[..., :3] == src).all(-1) & (a[..., 3] == 255) for src in RING}
    edge = hit[(159, 218, 178)] | hit[(137, 199, 157)]
    if not edge.any():
        return img
    ys, xs = np.where(edge)
    box = np.zeros(edge.shape, bool)
    box[ys.min():ys.max() + 1, xs.min():xs.max() + 1] = True
    for src, part in RING.items():
        a[hit[src] & box, :3] = GRASS[part]
    return Image.fromarray(a, 'RGBA')


def fringe(canvas, x, y0, y1, side):
    """Grass over a vertical path edge: the lawn ends at pixel column x and the path lies to the `side` (+1 east,
    -1 west). An uneven border and single blades leaning onto the stone, lit at the tip, from row y0 to y1."""
    a = np.asarray(canvas).copy()
    rng = _rng('fringe', x, y0)
    depth = 0
    for y in range(y0, y1):
        depth = int(np.clip(depth + rng.integers(-1, 2), 0, 2))
        for d in range(depth):
            a[y, x + side * d if side > 0 else x - 1 - d] = (*GRASS['base' if d < depth - 1 else 'dark'], 255)
    for y in range(y0 + 2, y1, 3):
        if rng.uniform() < 0.5:
            continue
        length = int(rng.integers(2, 5))
        for k in range(length):
            px = x + side * (k + 1) if side > 0 else x - 2 - k
            colour = GRASS['tip'] if k == length - 1 else GRASS['light'] if k else GRASS['dark']
            a[y - k // 2 - 1, px] = (*colour, 255)
    canvas.paste(Image.fromarray(a, 'RGBA'))
