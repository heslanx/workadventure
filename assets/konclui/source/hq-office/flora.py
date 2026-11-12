"""Plants and stones of the pool's bank (and, later, the lawn) as small pixel sprites drawn by code, one art pixel per map
pixel. Each function returns (RGBA uint8 array, (ax, ay)): the sprite and its anchor, the point that stands on the
ground (or floats on the water), in sprite pixels.

Pixel-art rules kept everywhere: light from the top left; three or four tones per material plus a darker, coloured
outline (never black) on the shadow side; leaves and petals are small shapes, never single loose pixels; hue shifts
from cool shadows to warm lights.

One optical system for all of them (owner, 18/10/2026: "match optical size and stroke weight, not just pixel size, and
align them consistently"):
  stroke   every sprite outlines the same pixels, _shadow_edge(): the silhouette's bottom and right edge, never a
           hairline (a 1 px blade keeps its own colour, or it would double in width). Outline colours are not picked
           by eye: OUTLINE scales each material's hue to the luminance that gives the same contrast, CONTRAST, against
           what the sprite stands on (the bank's ground, or the water for pads and reeds)
  size     the bank's three interchangeable plants (fern, leafy, grass) are scaled by OPTICAL to the same optical size:
           the area the eye groups (the silhouette with the gaps between blades and fronds closed, 2 px), not the
           painted pixels, so a sparse clump is not blown up to match a dense one; their fills sit at a similar tone, so
           none looks heavier either. size=1 is that calibrated size, callers vary it a little around 1
  anchor   the anchor is where the sprite meets the ground or the water: the bottom of a stone's base, a plant's
           crown or the foot of its blades, a pad's middle, a flower's base on its pad. Plants on land sit on the
           same 1 px contact shadow, CONTACT

  rock(rng, r, mossy)        a natural stone, a moss cap on the top when mossy
  fern(rng)                  fronds with leaflets, spreading out from a crown
  leafy(rng)                 a dome of rounded leaves
  grass(rng, flowers)        a clump of blades, with buttercups or white clover heads
  reeds(rng)                 tall blades and cattails, rising from the shallows
  lily_pad(rng, r)           a pad with its notch, rim light and veins
  water_lily(rng, kind)      a white or pink flower, to sit on a pad
"""
import numpy as np

from palette import rgb

GREEN = dict(deep=rgb('#2c6e3f'), dark=rgb('#3f8a45'), base=rgb('#5aa64c'),
             light=rgb('#7fc457'), shine=rgb('#b0df78'))
FERN = dict(dark=rgb('#2b7046'), base=rgb('#46914d'), light=rgb('#6db357'),
            shine=rgb('#98d070'))
MOSS = dict(dark=rgb('#4d8a2f'), base=rgb('#72ad35'), light=rgb('#99cd45'), shine=rgb('#c6e66e'))
ROCK = dict(shadow=rgb('#4b5759'), base=rgb('#667272'), light=rgb('#87918d'),
            shine=rgb('#adb5ab'))
PAD = dict(dark=rgb('#33804a'), base=rgb('#4f9f52'), light=rgb('#76bf5c'),
           shine=rgb('#a5db7a'), old=rgb('#7fae4a'))
PETAL = dict(white=(rgb('#fbfaf2'), rgb('#d9ddd0'), rgb('#b9c2b4')), pink=(rgb('#ffd3e2'), rgb('#f39bbf'),
                                                                               rgb('#cf6f98')))
YELLOW = (rgb('#ffe066'), rgb('#f4b63a'), rgb('#c98a26'))
CATTAIL = (rgb('#a8714a'), rgb('#7a4c33'), rgb('#55331f'))

GROUND = rgb('#2c6e3f')                   # what land sprites stand on (the bank's ground, its main tone) ...
WATER = rgb('#1a9a96')                    # ... and floating ones (the mid water where pads float)
CONTRAST = 1.5                            # outline against the ground it stands on: one stroke weight for all


def luminance(colour):
    c = np.asarray(colour, float) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return float(c @ [0.2126, 0.7152, 0.0722])


def _with_luminance(colour, target):
    """The colour's hue at a given relative luminance (scaled in linear light, back to sRGB)."""
    c = np.asarray(colour, float) / 255
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    lin = np.clip(lin * target / max(1e-6, float(lin @ [0.2126, 0.7152, 0.0722])), 0, 1)
    out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    return tuple(int(round(v * 255)) for v in out)


def _outline_for(hue, ground, lighter=False):
    """The hue at the luminance that stands CONTRAST apart from the ground: darker, or lighter for a sprite brighter
    than its ground (a white flower on the water)."""
    g = luminance(ground) + 0.05
    return _with_luminance(hue, g * CONTRAST - 0.05 if lighter else g / CONTRAST - 0.05)


OUTLINE = dict(green=_outline_for(rgb('#1f5a3a'), GROUND), fern=_outline_for(rgb('#1d5040'), GROUND),
               rock=_outline_for(rgb('#333d40'), GROUND), moss=_outline_for(rgb('#3d6e24'), GROUND),
               pad=_outline_for(rgb('#1e5b3c'), WATER), reed=_outline_for(rgb('#1f5a3a'), WATER),
               white=_outline_for(rgb('#b9c2b4'), WATER, lighter=True),
               pink=_outline_for(rgb('#cf6f98'), WATER, lighter=True))
CONTACT = OUTLINE['green']                # the 1 px contact shadow under every plant on land
OPTICAL = dict(fern=1.02, leafy=0.98, grass=1.25)  # equal optical size at size=1 (measured, see the module's notes)


def _canvas(w, h):
    return np.zeros((h, w, 4), np.uint8)


def _px(a, x, y, colour):
    x, y = int(round(x)), int(round(y))
    if 0 <= y < a.shape[0] and 0 <= x < a.shape[1]:
        a[y, x] = (*colour, 255)


def _shadow_edge(a):
    """The pixels every sprite outlines: on the silhouette, with an empty neighbour below or to the right (the side away
    from the light), except hairlines (empty on both sides across), which keep their colour."""
    on = a[..., 3] > 0
    p = np.pad(on, 1)
    up, down, left, right = p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]
    hair = (~left & ~right) | (~up & ~down)
    return on & (~down | ~right) & ~hair


def _outline(a, colour):
    a[_shadow_edge(a), :3] = colour


def _contact(a, cx, cy, half):
    """The contact shadow on the ground: a 1 px row under the anchor, a little narrower than the base."""
    for dx in range(-int(half), int(half) + 1):
        if 0 <= cy + 1 < a.shape[0] and 0 <= int(cx) + dx < a.shape[1] and a[int(cy) + 1, int(cx) + dx, 3] == 0:
            a[int(cy) + 1, int(cx) + dx] = (*CONTACT, 255)


def _blob(a, cx, cy, rx, ry, tones, outline, light=(-0.7, -0.7), wobble=0.0):
    """A shaded ellipse: shine/light toward `light`, dark away from it, outline on the shadow half."""
    h, w = a.shape[:2]
    y0, y1 = max(0, int(cy - ry - 2)), min(h, int(cy + ry + 3))
    x0, x1 = max(0, int(cx - rx - 2)), min(w, int(cx + rx + 3))
    if y1 <= y0 or x1 <= x0:
        return np.zeros(a.shape[:2], bool)
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(float)
    dx, dy = (xx + 0.5 - cx) / rx, (yy + 0.5 - cy) / ry
    ang = np.arctan2(dy, dx)
    e = dx * dx + dy * dy
    if wobble:
        e = e * (1 + wobble * np.sin(ang * 3 + cx) + wobble * 0.6 * np.sin(ang * 5 + cy))
    inside = e <= 1
    lit = dx * light[0] + dy * light[1]
    sub = a[y0:y1, x0:x1]
    col = np.empty(e.shape + (3,))
    col[:] = tones['base']
    col[lit > 0.25] = tones['light']
    col[(lit > 0.62) & (e < 0.55)] = tones['shine']
    col[lit < -0.45] = tones['dark']
    rim = inside & (e > (1 - 1.6 / max(rx, ry)) ** 2)
    col[rim & (lit < 0.1)] = outline
    sub[inside, :3] = col[inside]
    sub[inside, 3] = 255
    full = np.zeros(a.shape[:2], bool)
    full[y0:y1, x0:x1] = inside
    return full


# ------------------------------------------------------------------------------------------------ stones

def rock(rng, r, mossy=False):
    """A stone r px in radius (flattened by the view), lumpy, lit from the top left; a moss cap spills over its top."""
    w, h = int(2 * r + 6), int(1.7 * r + 6)
    a = _canvas(w, h)
    cx, cy = w / 2, h / 2 + 0.5
    rx, ry = r, r * 0.78
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    dx, dy = (xx + 0.5 - cx) / rx, (yy + 0.5 - cy) / ry
    ang = np.arctan2(dy, dx)
    k = rng.uniform(0, 6.3, 3)
    e = (dx * dx + dy * dy) * (1 + 0.1 * np.sin(ang * 3 + k[0]) + 0.06 * np.sin(ang * 5 + k[1])
                               + 0.04 * np.sin(ang * 7 + k[2]))
    inside = e <= 1
    lit = -0.75 * dx - 0.65 * dy
    col = np.empty((h, w, 3))
    col[:] = ROCK['base']
    col[lit > 0.15] = ROCK['light']
    col[(lit > 0.55) & (e < 0.5)] = ROCK['shine']
    col[(lit < -0.35) | (dy > 0.55)] = ROCK['shadow']
    # a crack or two: short dark seams with a lit lip above them
    for _ in range(int(rng.integers(0, 3)) if r > 5 else 0):
        sx, sy = cx + rng.uniform(-0.5, 0.4) * rx, cy + rng.uniform(-0.3, 0.4) * ry
        for t in range(int(rng.integers(2, max(3, int(r * 0.6))))):
            px, py = int(sx + t), int(sy + (t % 3 == 2))
            if 0 <= py < h and 0 <= px < w and inside[py, px] and e[py, px] < 0.75:
                col[py, px] = ROCK['shadow']
                if py > 0 and inside[py - 1, px]:
                    col[py - 1, px] = ROCK['light']
    edge = inside & ~(np.roll(inside, 1, 0) & np.roll(inside, -1, 0) & np.roll(inside, 1, 1) & np.roll(inside, -1, 1))
    cap = np.zeros_like(inside)
    if mossy:
        # the cap: the top face where a wavy line allows, thicker toward the back
        line = -0.05 + 0.22 * np.sin(dx * 4.1 + k[0]) + 0.12 * np.sin(dx * 9.3 + k[1])
        cap = inside & (dy < line) & ~(edge & (dy > -0.6))
        mlit = -0.6 * dx - 0.8 * dy
        m = np.empty((h, w, 3))
        m[:] = MOSS['base']
        m[mlit > 0.35] = MOSS['light']
        m[(mlit > 0.75) & (e < 0.6)] = MOSS['shine']
        lip = cap & ~np.roll(cap, -1, 0)                                      # where moss ends, a dark lip
        m[lip] = MOSS['dark']
        col[cap] = m[cap]
        # a few drips over the side
        for _ in range(int(rng.integers(1, 4))):
            px = int(cx + rng.uniform(-0.7, 0.7) * rx)
            ys_ = np.nonzero(cap[:, px])[0] if 0 <= px < w else []
            if len(ys_):
                for t in range(1, int(rng.integers(2, 4))):
                    py = ys_.max() + t
                    if py < h and inside[py, px] and not edge[py, px]:
                        col[py, px] = MOSS['dark'] if t > 1 else MOSS['base']
    a[inside, :3] = col[inside]
    a[inside, 3] = 255
    stroke = _shadow_edge(a)
    a[stroke & cap, :3] = OUTLINE['moss']
    a[stroke & ~cap, :3] = OUTLINE['rock']
    return a, (int(cx), int(np.nonzero(inside)[0].max()))                      # the bottom of its base


# ------------------------------------------------------------------------------------------------ plants

def _frond(a, x0, y0, ang, length, width, tones, droop=0.35):
    """A fern frond as a tapered blade along a drooping curve: its edge combed into leaflets, the upper half lit,
    the lower half and the stem darker."""
    steps = int(length * 2)
    for i in range(steps):
        u = i / steps
        t = u * length
        x = x0 + np.cos(ang) * t
        y = y0 + np.sin(ang) * t + droop * t * u
        # tangent and normal of the curve
        tx, ty = np.cos(ang), np.sin(ang) + 2 * droop * u
        n = np.hypot(tx, ty)
        nx, ny = -ty / n, tx / n
        half = width * np.sin(np.pi * min(1, u * 1.15)) ** 0.7 / 2
        comb = (int(t) % 2 == 0)                                              # leaflets: every other step shorter
        reach = half if comb else half * 0.45
        for side in (-1, 1):
            up = (nx * side) * -0.6 + (ny * side) * -0.8 > 0                 # the side facing the light
            k = 0.0
            while k <= reach:
                colour = (tones['light'] if up else tones['base']) if k > 0.6 else tones['dark']
                if up and k > reach - 1 and u < 0.7 and comb:
                    colour = tones['shine']
                if not up and k > reach - 1:
                    colour = tones['dark'] if comb else tones['base']
                _px(a, x + nx * side * k, y + ny * side * k, colour)
                k += 0.5
        _px(a, x, y, tones['dark'])


def fern(rng, size=1.0):
    size *= OPTICAL['fern']
    w, h = int(44 * size), int(34 * size)
    a = _canvas(w, h)
    cx, cy = w / 2, h - 9
    n = int(rng.integers(6, 9))
    angs = np.linspace(-np.pi * 0.98, -np.pi * 0.02, n) + rng.uniform(-0.18, 0.18, n)
    angs = np.concatenate([angs, rng.uniform(np.pi * 0.15, np.pi * 0.85, int(rng.integers(1, 3)))])   # front fronds
    # back fronds (pointing up) first, the front ones (pointing down) last
    for ang in sorted(angs, key=lambda g: np.sin(g)):
        front = np.sin(ang) > 0
        length = rng.uniform(10, 16) * size * (0.6 if front else 1)
        _frond(a, cx, cy, ang, length, rng.uniform(4.5, 6.5) * size, FERN, droop=0.12 if front else 0.35)
    _outline(a, OUTLINE['fern'])
    for dx in (-1, 0, 1):                                                     # the crown
        _px(a, cx + dx, cy, OUTLINE['fern'])
    _contact(a, cx, cy, 3)
    return a, (int(cx), int(cy))


def leafy(rng, size=1.0):
    """Rounded leaves heaped into a dome: back leaves first and darker, the top lit, the front lip in shadow."""
    size *= OPTICAL['leafy']
    w, h = int(30 * size), int(22 * size)
    a = _canvas(w, h)
    cx, cy = w / 2, h - 4
    rx, ry = w / 2 - 4, h - 8
    leaves = []
    for _ in range(int(40 * size * size)):
        t = rng.uniform(0, np.pi)
        rr = np.sqrt(rng.uniform(0.1, 1))
        lx, ly = cx + np.cos(t) * rx * rr, cy - np.sin(t) * ry * rr * rng.uniform(0.6, 1)
        leaves.append((lx, ly, rng.uniform(2.0, 3.4) * size))
    for lx, ly, r in sorted(leaves, key=lambda l: l[1]):
        height = (cy - ly) / max(1, ry)                                       # higher on the dome: more light
        tones = dict(GREEN)
        if height < 0.25:
            tones = dict(base=GREEN['dark'], light=GREEN['base'], shine=GREEN['light'], dark=GREEN['deep'])
        elif height > 0.6:
            tones = dict(base=GREEN['base'], light=GREEN['light'], shine=GREEN['shine'], dark=GREEN['dark'])
        _blob(a, lx, ly, r, r * 0.8, tones, OUTLINE['green'], wobble=0.08)
    _outline(a, OUTLINE['green'])
    _contact(a, cx, cy, rx * 0.6)
    return a, (int(cx), int(cy))


def grass(rng, flowers=None, size=1.0):
    """Blades in a fan, back blades and the right side darker; buttercups ('buttercup') or white clover heads
    ('clover') above them."""
    size *= OPTICAL['grass']
    w, h = int(26 * size), int(24 * size)
    a = _canvas(w, h)
    cx, cy = w / 2, h - 3
    n = int(rng.integers(22, 32) * size)
    blades = []
    for i in range(n):
        x = cx + rng.normal(0, 3.2) * size
        ang = -np.pi / 2 + (x - cx) / (8 * size) * 0.7 + rng.uniform(-0.25, 0.25)
        blades.append((x, ang, rng.uniform(5, 14) * size * (1 - abs(x - cx) / (14 * size)), rng.uniform() < 0.45))
    for x, ang, length, back in sorted(blades, key=lambda b: not b[3]):
        for t in range(int(length)):
            u = t / max(1, length - 1)
            px, py = x + np.cos(ang) * t + 0.15 * t * u * np.sign(np.cos(ang)), cy + np.sin(ang) * t
            shade = x > cx + 1                                                # the clump's side away from the light
            if back:
                colour = GREEN['deep'] if u < 0.4 or shade else GREEN['dark']
            elif shade:
                colour = GREEN['deep'] if u < 0.25 else GREEN['dark']
            else:
                colour = GREEN['dark'] if u < 0.25 else GREEN['shine'] if u > 0.85 else GREEN['light'] if u > 0.5 \
                    else GREEN['base']
            _px(a, px, py, colour)
    _outline(a, OUTLINE['green'])
    _contact(a, cx, cy, 5 * size)
    if flowers:
        for _ in range(int(rng.integers(2, 5))):
            fx, fy = cx + rng.uniform(-8, 8) * size, cy - rng.uniform(7, 14) * size
            if flowers == 'buttercup':
                top, mid, low = YELLOW
                for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1), (-1, -1), (1, -1)):
                    _px(a, fx + dx, fy + dy, top if dy < 0 else mid)
                _px(a, fx, fy, low)
                _px(a, fx + 1, fy + 1, low)
                _px(a, fx, fy + 2, GREEN['dark'])
            else:
                hi, mid, low = PETAL['white']
                for dx, dy in ((0, 0), (1, 0), (0, -1), (1, -1)):
                    _px(a, fx + dx, fy + dy, hi if dy < 0 else mid)
                _px(a, fx + 1, fy + 1, low)
    return a, (int(cx), int(cy))


def reeds(rng, size=1.0):
    w, h = int(22 * size), int(34 * size)
    a = _canvas(w, h)
    cx, cy = w / 2, h - 3
    heads = []
    for i in range(int(rng.integers(5, 9))):
        x = cx + rng.uniform(-5, 5) * size
        lean = rng.uniform(-0.35, 0.35)
        length = rng.uniform(14, 28) * size
        tip = None
        for t in range(int(length)):
            u = t / length
            px, py = x + lean * t * (0.4 + u), cy - t
            _px(a, px, py, GREEN['dark'] if u < 0.35 else GREEN['base'])
            _px(a, px + 1, py, GREEN['deep'] if u < 0.35 else GREEN['dark'])
            if u > 0.55:
                _px(a, px, py, GREEN['light'])
            tip = (px, py)
        if rng.uniform() < 0.45 and tip:                                      # a cattail a little below the tip
            heads.append((tip[0] - lean * 4, tip[1] + 4))
    _outline(a, OUTLINE['reed'])
    for hx, hy in heads:
        for dy in range(5):
            _px(a, hx, hy + dy, CATTAIL[0] if dy < 2 else CATTAIL[1])
            _px(a, hx + 1, hy + dy, CATTAIL[1] if dy < 3 else CATTAIL[2])
    return a, (int(cx), int(cy))


def lily_pad(rng, r, old=False):
    """A floating pad: a flattened disc with a notch to its middle, rim light on the top left, veins, dark outline."""
    w, h = int(2 * r + 4), int(1.7 * r + 4)
    a = _canvas(w, h)
    cx, cy = w / 2, h / 2
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    dx, dy = (xx + 0.5 - cx) / r, (yy + 0.5 - cy) / (r * 0.78)
    e = dx * dx + dy * dy
    ang = np.arctan2(dy, dx)
    notch_at = rng.uniform(-np.pi, np.pi)
    gap = np.abs(np.angle(np.exp(1j * (ang - notch_at)))) < 0.28
    inside = (e <= 1) & ~(gap & (e > 0.02))
    lit = -0.7 * dx - 0.7 * dy
    base = PAD['old'] if old else PAD['base']
    col = np.empty((h, w, 3))
    col[:] = base
    col[lit > 0.35] = PAD['light']
    col[(lit > 0.5) & (e > 0.55)] = PAD['shine']                                # the lifted rim catches light
    col[lit < -0.4] = PAD['dark']
    if r >= 5:                                                                  # veins from the middle
        for k in range(5):
            va = notch_at + np.pi / 3 + k * np.pi * 1.33 / 4
            vein = np.abs(np.angle(np.exp(1j * (ang - va)))) < 0.09
            col[vein & (e > 0.08) & (e < 0.8)] = PAD['dark'] if not old else PAD['base']
    a[inside, :3] = col[inside]
    a[inside, 3] = 255
    _outline(a, OUTLINE['pad'])
    return a, (int(cx), int(cy))


def water_lily(rng, kind='white'):
    hi, mid, low = PETAL[kind]
    a = _canvas(9, 8)
    # outer petals (low), inner petals (mid, hi), golden heart
    for dx, dy in ((-3, 1), (3, 1), (-2, 2), (2, 2), (0, 3), (-3, 0), (3, 0)):
        _px(a, 4 + dx, 3 + dy, low)
    for dx, dy in ((-2, 0), (2, 0), (-1, -1), (1, -1), (-2, 1), (2, 1), (-1, 2), (1, 2), (0, 2)):
        _px(a, 4 + dx, 3 + dy, mid)
    for dx, dy in ((0, -2), (-1, -2), (1, -2), (-1, 0), (1, 0), (0, -1)):
        _px(a, 4 + dx, 3 + dy, hi)
    _px(a, 4, 1, hi)
    _px(a, 4, 0, mid)
    _outline(a, OUTLINE[kind])
    _px(a, 4, 3, YELLOW[0])
    _px(a, 4, 4, YELLOW[1])
    return a, (4, 6)                                                          # its base, sitting on the pad


def stamp(dst, sprite, x, y, mask=None):
    """Composite a sprite (RGBA uint8) onto dst (h, w, 4) with its anchor at (x, y); returns the painted mask.
    `mask` (bool, dst's shape) limits where it may paint."""
    img, (ax, ay) = sprite
    h, w = img.shape[:2]
    X0, Y0 = int(round(x)) - ax, int(round(y)) - ay
    sy0, sx0 = max(0, -Y0), max(0, -X0)
    sy1, sx1 = min(h, dst.shape[0] - Y0), min(w, dst.shape[1] - X0)
    painted = np.zeros(dst.shape[:2], bool)
    if sy1 <= sy0 or sx1 <= sx0:
        return painted
    src = img[sy0:sy1, sx0:sx1]
    on = src[..., 3] > 0
    if mask is not None:
        on &= mask[Y0 + sy0:Y0 + sy1, X0 + sx0:X0 + sx1]
    region = dst[Y0 + sy0:Y0 + sy1, X0 + sx0:X0 + sx1]
    region[on] = src[on]
    painted[Y0 + sy0:Y0 + sy1, X0 + sx0:X0 + sx1] = on
    return painted
