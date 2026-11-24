"""The lawn around the building, drawn at native resolution (one art pixel per map pixel, like pool.py) instead of the
catalogue's flat pale green, which is the only grass the catalogue has.

Pixel-art grass in two layers, so the detail costs few tiles:
  ground   the floor layer, one picture of the whole map (W x H tiles) that never repeats. It is composed of a small
           library of 32 px tiles that fit edge to edge: each tile's four corners carry a tone (shadier, base, sunnier)
           taken from a smooth non-periodic field over the map, the tone between the corners is interpolated and broken
           into blade-shaped streaks inside the tile, and a tile's border pixels depend on the corner tones only, so a
           tile never meets a neighbour with a seam. Blade marks (lit tip over a dark root) stay inside a tile, one per
           jittered 6 px cell. A few variants of every kind of tile are picked by a hash of the cell, never the same as the
           one to its left or above, so the same picture comes back only at no fixed distance. Low contrast on purpose:
           avatars and furniture stand on it.
  decor    the tile layer "lawn" above the floor: tufts, clover, flower clumps and pebbles, each a transparent tile
           that does not depend on where it lies, so a few dozen tiles cover the whole lawn without repeating.
           Tufts sway together in one gust every LOOP frames of FRAME_MS (the pool's frame): every tuft picture changes on
           the same few frames (GUST_TICKS), the engine redraws only when a visible animated tile changes picture, so an
           idle room that sees the lawn through its glass redraws 5 times per 14 s instead of 2-3 times a second (owner,
           19/10/2026: "Rajadas juntas e espaçadas", for the idle budget in perf.py). Inside those ticks a tuft starts
           and ends its lean in its own way (GUST_SHAPES), so the lawn does not move as one block. The first frame is the
           rest pose, which is what people see with "Disable map animations".
Colours: greens hue-shifted (shadows cooler, lights warmer), between the catalogue's tree greens; the flowers are the
pool bank's.

  texture()             RGBA, W x H tiles of the plan (86 x 56, 2752 x 1792 px), seamless, no period
  ground_tiles()        the number of different 32 px tiles texture() holds (what the floor sheet gets from the lawn)
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
TONE = {-1: GRASS['shade'], 0: GRASS['base'], 1: GRASS['sun']}
CELL = 6                                 # a blade mark per 6 px cell at most
JITTER = 0.45                            # how far the streaks push a patch edge, in tone units (below 0.5, so a tile whose corners agree stays one tone)
EDGE_FADE = 6                            # px from a tile's border over which the streaks fade to nothing
# How many pictures of each kind of tile: plain base grass is most of the lawn, so it has most variants.
VARIANTS = dict(base=32, sun=12, shade=10, mixed=2)
SUN_SHARE, SHADE_SHARE = 0.07, 0.04      # of the corners, as sunnier / shadier than base
FIELD_BROAD, FIELD_FINE = (8, 5), (5, 3.5)  # the tone field's two scales, in tiles (wide patches, wider than tall)
MIN_PATCH = 10                           # corners: a smaller patch of one tone is dropped


def _smooth(w, h, sx, sy, rng):
    """Value noise on a w x h grid in [0, 1]: random values on a lattice sx x sy cells apart, smoothstepped between."""
    gx, gy = int(np.ceil(w / sx)) + 2, int(np.ceil(h / sy)) + 2
    lat = rng.uniform(size=(gy, gx))
    x, y = np.arange(w) / sx, np.arange(h) / sy
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = lat[y0][:, x0], lat[y0][:, x0 + 1]
    c, d = lat[y0 + 1][:, x0], lat[y0 + 1][:, x0 + 1]
    top, bottom = a + (b - a) * fx[None, :], c + (d - c) * fx[None, :]
    return top + (bottom - top) * fy[:, None]


def _levels(w, h):
    """The tone (-1 shadier, 0 base, 1 sunnier) of each of the (h + 1) x (w + 1) tile corners of the map. A smooth field
    of broad patches, wider than tall; two tones never meet at a corner of one tile (the step between them is one), and a
    patch of a single corner is dropped."""
    rng = _rng('tone')
    (bx, by), (sx, sy) = FIELD_BROAD, FIELD_FINE
    f = 0.65 * _smooth(w + 1, h + 1, bx, by, rng) + 0.35 * _smooth(w + 1, h + 1, sx, sy, rng)
    lv = np.zeros(f.shape, int)
    lv[f >= np.quantile(f, 1 - SUN_SHARE)] = 1
    lv[f <= np.quantile(f, SHADE_SHARE)] = -1
    pad = np.pad(lv, 1)
    near = np.stack([pad[1 + dy:pad.shape[0] - 1 + dy, 1 + dx:pad.shape[1] - 1 + dx]
                     for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
    clash = (near == -lv[None]) & (lv[None] != 0)                         # a neighbour of the opposite tone
    lv[clash.any(0)] = 0
    for k in (-1, 1):                                                     # patches of fewer than MIN_PATCH corners
        seen = np.zeros(lv.shape, bool)
        for y, x in zip(*np.where(lv == k)):
            if seen[y, x]:
                continue
            todo, patch = [(y, x)], []
            seen[y, x] = True
            while todo:
                cy, cx = todo.pop()
                patch.append((cy, cx))
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < lv.shape[0] and 0 <= nx < lv.shape[1] and lv[ny, nx] == k and not seen[ny, nx]:
                        seen[ny, nx] = True
                        todo.append((ny, nx))
            if len(patch) < MIN_PATCH:
                for cy, cx in patch:
                    lv[cy, cx] = 0
    return lv


@lru_cache(maxsize=None)
def _tile(corners, variant):
    """One 32 x 32 RGB tile. Its border pixels are a function of the corners alone (the tone is interpolated along each
    border and the streaks fade to nothing there; blade marks keep one pixel clear of it), so two tiles that share two
    corners share a border pixel for pixel."""
    tl, tr, bl, br = corners
    rng = _rng('tile', tl, tr, bl, br, variant)
    t = np.arange(T) / (T - 1)
    top, bottom = tl + (tr - tl) * t, bl + (br - bl) * t
    u = top[None, :] + (bottom - top)[None, :] * t[:, None]               # the tone between the corners
    if len(set(corners)) > 1:                                             # a patch's edge crosses this tile
        stagger = rng.integers(0, 3, T)
        rows = (np.arange(T)[:, None] + stagger[None, :]) // 3            # blade-shaped streaks, 3 px tall
        streak = rng.uniform(-1, 1, (T // 3 + 2, T))[rows, np.arange(T)[None, :]]
        d = np.minimum(np.minimum(np.arange(T), T - 1 - np.arange(T))[None, :],
                       np.minimum(np.arange(T), T - 1 - np.arange(T))[:, None])
        u = u + JITTER * np.clip(d / EDGE_FADE, 0, 1) * streak
    level = np.where(u > 0.5, 1, np.where(u < -0.5, -1, 0))
    out = np.empty((T, T, 3), np.uint8)
    for k, colour in TONE.items():
        out[level == k] = colour
    for cy in range(1, T - 1, CELL):
        for cx in range(1, T - 1, CELL):
            if rng.uniform() < 0.22:
                continue
            mark = MARKS[rng.integers(len(MARKS))]
            w, h = max(m[0] for m in mark) + 1, max(m[1] for m in mark) + 1
            xs, ys = min(cx + CELL - 2, T - 1 - w), min(cy + CELL - 2, T - 1 - h)    # the mark stays off the border
            if xs < cx or ys < cy:
                continue
            x0, y0 = int(rng.integers(cx, xs + 1)), int(rng.integers(cy, ys + 1))
            s = 0.6 * level[y0, x0]
            # sunny patches: tips catch the light; shady ones: tips in shadow, roots deeper
            if rng.uniform() < 0.5 + 0.45 * s:
                tip, root = (GRASS['tip'] if s > 0.45 and rng.uniform() < 0.6 else GRASS['light']), GRASS['dark']
            else:
                tip, root = GRASS['dark'], (GRASS['deep'] if s < -0.3 else GRASS['dark'])
            for dx, dy, part in mark:
                out[y0 + dy, x0 + dx] = tip if part == 't' else root
    return out


def _kind(corners):
    flat = len(set(corners)) == 1
    return 'mixed' if not flat else ('base', 'sun', 'shade')[corners[0]]    # -1 indexes 'shade', the last


def _plan(w, h):
    """[[(corners, variant)]] per tile of the w x h map: the corner tones, and a variant picked by a hash of the cell
    that differs from the left and upper neighbour's when it is the same kind of tile."""
    lv = _levels(w, h)
    plan = [[None] * w for _ in range(h)]
    for ty in range(h):
        for tx in range(w):
            corners = (int(lv[ty, tx]), int(lv[ty, tx + 1]), int(lv[ty + 1, tx]), int(lv[ty + 1, tx + 1]))
            count = VARIANTS[_kind(corners)]
            v = int(_rng('variant', tx, ty).integers(count))
            near = {plan[ty][tx - 1] if tx else None, plan[ty - 1][tx] if ty else None} if count > 2 else \
                {plan[ty][tx - 1] if tx else None}
            while (corners, v) in near:
                v = (v + 1) % count
            plan[ty][tx] = (corners, v)
    return plan


@lru_cache(maxsize=None)
def _ground():
    import plan as P
    w, h = P.W, P.H
    tiles = _plan(w, h)
    out = np.empty((h * T, w * T, 4), np.uint8)
    out[..., 3] = 255
    for ty in range(h):
        for tx in range(w):
            out[ty * T:(ty + 1) * T, tx * T:(tx + 1) * T, :3] = _tile(*tiles[ty][tx])
    return out, len({c for row in tiles for c in row})


@lru_cache(maxsize=None)
def texture():
    """The ground of the whole map, W x H tiles, painted at its origin (build.paint aligns a tile to its own grid)."""
    return Image.fromarray(_ground()[0], 'RGBA')


def ground_tiles():
    return _ground()[1]


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
    for dx in range(-1, width + 1):                                           # contact shadow under the tuft, one step
        _put(a, x0 + dx, y0 + 1, GRASS['dark'])                               # darker than the grass, not a dark line
    for dx, h, bend, back in blades:
        for k in range(h):
            u = k / max(1, h - 1)
            x = x0 + dx + int(round(bend * u * u + sway * u * u))
            if back:
                colour = GRASS['dark'] if k < h - 1 else GRASS['shade']
            else:
                colour = (GRASS['dark'] if u < 0.3 else GRASS['tip'] if k == h - 1 else GRASS['light'])
            _put(a, x, y0 - k, colour)
    return Image.fromarray(a, 'RGBA')


# The gust: how far a tuft's tips lean, frame by frame from GUST_AT (then at rest). Every tuft picture changes on the same
# frames, GUST_TICKS of the gust (the owner's idle redraw budget, see the header): the shapes below differ in how far each
# step leans, never in when it changes picture, so a tuft may start one step late or skip the recoil and the lawn still
# redraws 5 times per cycle. A shape is the lean on steps 0, 1-2, 3 and 4 (step 5 is the rest pose).
GUST_TICKS = (0, 1, 3, 4, 5)
GUST_SHAPES = {1: [(1, 1, 0, -1), (0, 1, 1, -1), (1, 1, 1, 0), (1, 1, -1, -1)],
               2: [(1, 2, 1, -1), (2, 2, 1, -1), (1, 2, 2, -1), (0, 2, 1, 0)]}


def gust(reach, i):
    """The lean of tuft variant i for steps 0-5 of the gust."""
    a, b, c, d = GUST_SHAPES[reach][i % len(GUST_SHAPES[reach])]
    return [a, b, b, c, d, 0]


def _flowers(rng):
    """A clump of 5-7 flowers: heads of 2-3 px on stems 3 px tall, each with a leaf, over a few blades. The heads have no
    hole (a plus whose middle is the flower's centre, or a 2 x 2 bud), so they read as flowers at 1:1, not as sparkles, and
    stand in elevation like the tufts, on the same stroke."""
    a = np.zeros((T, T, 4), np.uint8)
    petals, centre = FLOWERS[int(rng.integers(len(FLOWERS)))]
    cx, cy = int(rng.integers(12, T - 12)), int(rng.integers(14, T - 8))        # the clump's foot
    count = int(rng.integers(5, 8))
    heads = []
    for _ in range(400):
        if len(heads) == count:
            break
        x, y = cx + int(rng.integers(-9, 10)), cy - int(rng.integers(3, 13))      # the head's middle
        if all(abs(x - u) >= 4 or abs(y - v) >= 6 for u, v, _ in heads):
            heads.append((x, y, bool(rng.uniform() < 0.35)))                    # the last: a bud
    for dx in range(-10, 11):                                                   # blades at the foot, with gaps, behind the stems
        if rng.uniform() < 0.55:
            h = int(rng.integers(1, 3))
            for k in range(h):
                _put(a, cx + dx, cy + 1 - k, GRASS['light'] if k == h - 1 and rng.uniform() < 0.5 else GRASS['dark'])
    for x, y, bud in sorted(heads, key=lambda p: p[1]):                         # the ones further up the lawn first
        top = y + 2                                                             # right under the head's last row
        for k in range(3):                                                      # the stem
            _put(a, x, top + k, GRASS['deep'])
        _put(a, x - 1, top + 2, GRASS['dark'])                                  # a leaf each side, at different heights
        _put(a, x + 1, top + 1, GRASS['dark'])
        if bud:
            for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
                _put(a, x + dx, y + dy, petals)
            _put(a, x, y, centre)
        else:
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                _put(a, x + dx, y + dy, petals)
            _put(a, x, y, centre)
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
    """One or two pebbles in two flat tones: the lit top row and the body, the same on every side, and a row of grass
    one step darker right under it. The sun's side is the runtime's, so nothing is painted on one end."""
    a = np.zeros((T, T, 4), np.uint8)
    for _ in range(int(rng.integers(1, 3))):
        x, y = int(rng.integers(5, T - 8)), int(rng.integers(8, T - 6))
        w = int(rng.integers(3, 5))
        for dx in range(w):
            _put(a, x + dx, y, STONE['light'])
            _put(a, x + dx, y + 1, STONE['base'])
        for dx in range(w):
            _put(a, x + dx, y + 2, GRASS['dark'])                             # on the grass, under the stone
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


def _under_facade(tx, ty):
    """The two rows of the south facade's face, and the columns it spans: seen through its glass is the room, not the lawn,
    so no tuft or flower grows there (audit round 2, I01)."""
    import plan as P
    return P.BY1 <= ty < P.BY1 + 2 and P.vb(P.BX0) <= tx < P.vb(P.BX1)


def decor(cells):
    v = _variants()
    out = {}
    for tx, ty in sorted(cells):
        if _under_facade(tx, ty):
            continue
        rng = _rng('cell', tx, ty)
        u = rng.uniform()
        meadow = _noise(tx, ty, 7, 'meadow')                                  # flowers gather in a few meadows
        if u < 0.11:
            i = int(rng.integers(len(v['tuft'])))
            frames = v['tuft'][i]
            lean = [0] * LOOP
            for k, s in enumerate(gust(v['reach'][i], i)):
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
    tones = {tuple(c) for c in TONE.values()}
    depth = 0
    for y in range(y0, y1):
        depth = int(np.clip(depth + rng.integers(-1, 2), 0, 2))
        inside = tuple(a[y, x - 1 if side > 0 else x, :3])                     # the lawn's own tone here (patches vary)
        tone = inside if inside in tones else GRASS['base']
        for d in range(depth):
            a[y, x + side * d if side > 0 else x - 1 - d] = (*(tone if d < depth - 1 else GRASS['dark']), 255)
    for y in range(y0 + 2, y1, 3):
        if rng.uniform() < 0.5:
            continue
        length = int(rng.integers(2, 5))
        for k in range(length):
            px = x + side * (k + 1) if side > 0 else x - 2 - k
            colour = GRASS['tip'] if k == length - 1 else GRASS['light'] if k else GRASS['dark']
            a[y - k // 2 - 1, px] = (*colour, 255)
    canvas.paste(Image.fromarray(a, 'RGBA'))
