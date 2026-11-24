"""The pool of the main office (canal, bridge, lake with the official K deck, Koru fountain, koi), redrawn at native
resolution: one art pixel per map pixel, 32 per tile, like the furniture catalogue's art, so curves are smooth instead of the 2x
blocks of the main office (16 px art shown at 2x).

Everything is computed from signed distances at map-pixel resolution (numpy) and painted in small palettes, without
dither, so it stays crisp pixel art (the owner's references, 18/10/2026: a clear emerald lake over dark stones, a lily
pond with reflections, grass and moss sheets):
  water    still, painted once: emerald turquoise in eight tones, deep where it is far from the shore, broken into broad
           deep holes and lighter shallows by smooth noise; the bed's stones as darker shapes with a lit rim; the
           plants' reflection below the north banks; a scalloped, broken waterline and sun speckles. Nothing is shaded
           on one side only: the runtime casts the shadows (this picture is a floor tile it does not shade), so what
           touches the water gets a contact line the same all round, at most two px (audit I05, rule R1)
  surface  its motion lives in the map's decor layer (water_decor): sun glints that twinkle and ripples that open now and
           then, on tiles that do not depend on where they lie, so the water costs a few dozen tiles instead of eight
           frames of every water tile; the fountain alone keeps its 8 x 220 ms frames
  bank     dense planting from flora.py: stone groups at the waterline (moss caps, the part under the surface tinted),
           ferns leaning over the water, leafy clumps, grass with buttercups or clover, reeds and cattails in the shallows
  deck     the official K (logo-konclui-icon.svg) in light oak planks of PLANK px, with its edge and 5 px front face
  bridge   the boardwalk's own planks (signature.tile_pattern) across the canal where the north corridor crosses it,
           raised 5 px over the water: a front face on the south edge only, a break at each abutment
  pads     clusters of lily pads (notch, rim light, veins), white or pink water lilies on some
  fountain Koru (the official vector, celebration pose) in a niche of the facade on a corbel at the canal head, a stream
           from the beak into a round stone basin with a rim of real height, rings where it lands: all drawn by
           fountain.py

  build(plan_module) -> Pool with .frames (8 RGBA images of the region), .region (x, y) in map px, .blocked (tiles),
  .statue (RGBA, map px of the region, the part that must sit above the walls layer), .koi (scenes and masks),
  .surface (map tile -> mask of open water, for water_decor), .fx (the still water as data for the water shader, fx.py)
  water_decor(surface) -> {(tx, ty): [RGBA tile per frame]} for the decor layer
"""
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

import flora as F
import fountain as FOUNTAIN
import signature as SIG
from palette import rgb

T = 32
FRAMES = 8
FRAME_MS = 220
RIM = 20                                 # px of bank between the water and the edge of the pool's tiles
LOGO = Path(__file__).resolve().parent.parent / 'brand/logo-konclui-icon.svg'
KORU = Path(__file__).resolve().parent.parent / 'brand/koru-celebration.svg'
# emerald turquoise, shallow -> deep (the owner's reference: a clear lake over dark stones)
WATER = [rgb(c) for c in ('#78dccb', '#49c8bb', '#28b2a9', '#1a9a96', '#13807f', '#0e676c', '#0a515c', '#073f4c')]
REFLECT = [rgb(c) for c in ('#1a7f68', '#11665a', '#0b4f49', '#083c3c')]     # the bank's plants mirrored, light -> dark
WATERLINE = rgb('#8fe6d2')
GLINT = [rgb('#9cf0dc'), rgb('#e9fff7')]                                        # dim, bright: the shader's own sparkles (fx.py)
# the water's ramp extended upwards with three lighter tones: a glint is drawn from the local step's neighbours in this
# list (RISE steps and one more above the water), so it reads on the pale shallows as on the deep holes
LIGHTER = [rgb(c) for c in ('#f4fffb', '#b9f5e6', '#8fe6d2')]
RAMP = LIGHTER + WATER
OAK = [rgb(c) for c in ('#8C6646', '#B88F66', '#CFAA80', '#DEBF98', '#E9D2B2')]
DIAG = 8                                  # px of x + y between the seams of planks laid at 45 degrees (6 px across, 8.5 rounded down)
PLANK = 6                                 # px across a plank: the K deck's and the bridge's, the boardwalk's (signature.py)
FACE = 5                                  # px of a raised deck's front face (0.24 m at 21 px/m), south edges only
CONTACT = (0.9, 0.5)                      # steps of the water ramp the first and the second px next to a thing are darker


class WaterMask(np.ndarray):
    """A 32 x 32 mask of open water that also says which step of WATER most of it is (.level): water_decor draws its
    glints and ripples from the neighbours of that step, so they read on the pale shallows as on the deep holes."""

    def __new__(cls, mask, level):
        obj = np.asarray(mask).view(cls)
        obj.level = level
        return obj

    def __array_finalize__(self, obj):
        self.level = getattr(obj, 'level', 3)


@dataclass
class Pool:
    region: tuple
    frames: list
    blocked: set
    statue: Image.Image
    koi: dict = field(default_factory=dict)
    surface: dict = field(default_factory=dict)        # map tile -> 32 x 32 mask of open, unshaded water
    bank_edge: tuple = ((), ())                         # (xs, ys) in map px of the bank's outer edge, next to the floor
    fx: dict = field(default_factory=dict)              # region arrays for the water shader (fx.py)


def rounded_rect_sdf(px, py, cx, cy, hx, hy, r):
    qx, qy = np.abs(px - cx) - (hx - r), np.abs(py - cy) - (hy - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def raster_svg(path, width):
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / 'r.png'
        subprocess.run(['rsvg-convert', '-w', str(width), str(path), '-o', str(out)], check=True)
        return Image.open(out).convert('RGBA')


def value_noise(X, Y, scale, rng):
    """Smooth noise in -1..1 with features about `scale` px: random values on a lattice, eased between them."""
    gx, gy = X / scale, Y / scale
    ix, iy = np.floor(gx).astype(int), np.floor(gy).astype(int)
    fx, fy = gx - ix, gy - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    ix, iy = ix - ix.min(), iy - iy.min()
    g = rng.uniform(-1, 1, (iy.max() + 2, ix.max() + 2))
    top = g[iy, ix] * (1 - fx) + g[iy, ix + 1] * fx
    bottom = g[iy + 1, ix] * (1 - fx) + g[iy + 1, ix + 1] * fx
    return top * (1 - fy) + bottom * fy


def dilate(mask, r=1):
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(mask, dy, 0), dx, 1)
    return out


def contact(touching, water):
    """The water px 1 and 2 px from whatever touches it, the same on every side: (ring1, ring2). The runtime casts the
    shadows; this is only the line where a thing meets the water."""
    ring1 = dilate(touching, 1) & water & ~touching
    ring2 = dilate(touching, 2) & water & ~touching & ~ring1
    return ring1, ring2


def noise(X, Y, seed):
    """Smooth value in -1..1 from a few incommensurate waves (organic edges and mottling, no texture files)."""
    a = seed * 1.7
    return (np.sin(X * 0.13 + a) * np.sin(Y * 0.11 - a) + 0.6 * np.sin(X * 0.31 - Y * 0.23 + 2 * a)
            + 0.4 * np.sin(X * 0.57 + Y * 0.49 - a)) / 2.0


def logo_limbs(logo):
    """Which limb of the K each pixel of the logo's mask belongs to: 1 the stem and its foot (planks run down them), 2 the upper
    arm (planks run along it, up to the right), 3 the lower leg (planks run down to the right). The logo is three separate
    paths: the foot, the leg, and the stem with the upper arm, which is cut at the stem's right edge (x = 42.6 of 163)."""
    h, w = logo.shape
    label = np.zeros((h, w), int)
    n = 0
    for sy, sx in zip(*np.nonzero(logo)):
        if label[sy, sx]:
            continue
        n += 1
        label[sy, sx] = n
        stack = [(sy, sx)]
        while stack:
            y, x = stack.pop()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and logo[ny, nx] and not label[ny, nx]:
                    label[ny, nx] = n
                    stack.append((ny, nx))
    sizes = {k: int((label == k).sum()) for k in range(1, n + 1)}
    main = max(sizes, key=sizes.get)                       # the stem with the upper arm
    limb = np.zeros((h, w), int)
    xs = np.arange(w)[None, :] * np.ones((h, 1))
    leg_ids = [k for k in sizes if k != main and np.nonzero(label == k)[1].mean() > w / 2]
    limb[(label == main) & (xs <= 42.6 * w / 163)] = 1
    limb[(label == main) & (xs > 42.6 * w / 163)] = 2
    limb[np.isin(label, leg_ids)] = 3
    limb[(limb == 0) & (label > 0)] = 1                    # the foot
    return limb


def deck_planks(lx, ly, limb, rng):
    """RGB of the K deck's planks, PLANK px across (the boardwalk's pitch), laid along each limb as a carpenter would: down the stem
    and its foot, along the upper arm and along the lower leg (at 45 degrees, so a seam is a one px diagonal and the pitch
    across them is the plank's width, PLANK * sqrt(2) = 8.5, taken as 8 px of x + y). 30 to 70 px long, the butt joints a
    different place in every row, one of the oak's two middle tones to a plank (the lightest is the edge's), a darker line
    on the last px of each row and at every joint. lx, ly: px from the logo's top left."""
    out = np.zeros(lx.shape + (3,))
    for k, (across, along, pitch) in {1: (lx, ly, PLANK), 2: (lx + ly, lx - ly, DIAG), 3: (lx - ly, lx + ly, DIAG)}.items():
        sel = limb == k
        if not sel.any():
            continue
        row = across // pitch
        for r in np.unique(row[sel]):
            m = sel & (row == r)
            t = along[m]
            bounds = np.cumsum(rng.integers(30, 71, 12)) - int(rng.integers(0, 70)) + int(t.min())
            plank = np.searchsorted(bounds, t, side='right')
            tones = np.array(OAK[2:4], float)[rng.integers(0, 2, plank.max() + 1)]
            colour = tones[plank]
            joint = np.zeros(len(t), bool)
            order = np.argsort(t, kind='stable')
            joint[order[1:]] = plank[order][1:] != plank[order][:-1]
            colour[joint] = OAK[1]
            out[m] = colour
        out[sel & (across % pitch == pitch - 1)] = OAK[1]
    return out


def build(P):
    x0, y0 = (P.POOL['lake'][0] - 1) * T, P.BY0 * T
    x1, y1 = (P.POOL['lake'][2] + 2) * T, (P.POOL['lake'][3] + 2) * T
    w, h = x1 - x0, y1 - y0
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    X, Y = xx + x0, yy + y0                     # map pixels
    lx0, ly0, lx1, ly1 = P.POOL['lake']
    cx0, cy0, cx1, cy1 = P.POOL['canal']
    rng = np.random.default_rng(7)
    lake = rounded_rect_sdf(X, Y, (lx0 + lx1 + 1) * T / 2, (ly0 + ly1 + 1) * T / 2,
                            (lx1 - lx0 + 1) * T / 2 - RIM, (ly1 - ly0 + 1) * T / 2 - RIM, 56)
    canal_cx = (cx0 + cx1 + 1) * T / 2
    canal_top = cy0 * T
    canal_bottom = (cy1 + 1.5) * T
    # One width from the fountain to the lake: the span between the team rooms' glass walls (boundaries of columns 41
    # and 46), less the bank.
    walls_l, walls_r = P.vb(cx0 - 1) * T + 2, P.vb(cx1 + 1) * T - 2
    slot_bottom = P.POOL['slot_end'] * T
    canal = rounded_rect_sdf(X, Y, canal_cx, (canal_top + canal_bottom) / 2, (walls_r - walls_l) / 2 - RIM + 2,
                             (canal_bottom - canal_top) / 2, 0)
    d = smin(lake, canal, 18)                    # < 0 in the water, fillets where the canal meets the lake
    srng = np.random.default_rng(31)             # a scalloped waterline: arcs about a dozen px wide (audit I33)
    d = d + 3.0 * value_noise(X, Y, 12, srng) + 1.1 * value_noise(X, Y, 5, srng)
    water = d < 0
    depth = -d
    # The bank also lies under the team rooms' glass walls (2 px either side of the slot): the glass is see-through, and
    # over the bare floor it showed a white sliver down both banks (audit I14).
    in_slot = (X >= walls_l - 2) & (X < walls_r + 2) & (Y < slot_bottom)
    top_ok = Y >= canal_top - 1                  # nothing of the bank on the facade above the canal head
    brng = np.random.default_rng(41)
    bank_edge = RIM - 2 + 4.6 * value_noise(X, Y, 28, brng) + 2.0 * value_noise(X, Y, 11, brng) \
        + 1.5 * noise(X, Y, 4)                    # lumpy mounds, a few to a tile (audit I33: no ruler-straight bank)
    bank = ~water & top_ok & ((d < bank_edge) | in_slot & (Y >= canal_top))
    core = ~water & (d < RIM) & top_ok            # what blocks walking
    # The K deck.
    lake_w = (lx1 - lx0 + 1) * T - 2 * RIM
    size = int(lake_w * P.POOL['deck_scale'])
    logo = np.asarray(raster_svg(LOGO, size))[..., 3] > 127
    deck = np.zeros((h, w), bool)
    lcx, lcy = (lx0 + lx1 + 1) * T / 2, (ly0 + ly1 + 1) * T / 2 - 4
    dx0, dy0 = int(lcx - logo.shape[1] / 2 - x0), int(lcy - logo.shape[0] / 2 - y0)
    deck[dy0:dy0 + logo.shape[0], dx0:dx0 + logo.shape[1]] = logo
    deck &= water
    side = np.zeros_like(deck)
    for k in range(1, FACE + 1):                  # the front face: the deck's thickness, below its south edges
        side |= np.roll(deck, k, 0)
    side &= ~deck & water
    deck_zone = np.zeros_like(deck)               # deck and a margin: no stones, pads or reeds there
    for k in range(-6, 13, 3):
        deck_zone |= np.roll(np.roll(deck, k, 0), k // 2, 1) | np.roll(deck, k, 1)
    # The bridge: a deck raised FACE px over the canal, its planks the boardwalk's (signature.py), its south edge a front
    # face, nothing on the north edge; the two abutments are a dark break across the planks.
    bx0, by0, bx1, by1 = P.POOL['bridge']
    span_x0, span_x1 = bx0 * T - 2, (bx1 + 1) * T + 2
    in_span = (X >= span_x0) & (X < span_x1)
    bridge = in_span & (Y >= by0 * T) & (Y < (by1 + 1) * T)
    bridge_face = in_span & (Y >= (by1 + 1) * T) & (Y < (by1 + 1) * T + FACE)
    keep_clear = bridge | bridge_face | in_span & (Y >= (by1 + 1) * T) & (Y < (by1 + 1) * T + 14) \
        | (Y < canal_top + 46) & (np.abs(X - canal_cx) < 26)   # the fountain's corbel and splash
    # The Koru's basin: a round stone basin on the ground against the facade, the stream landing in it (fountain.py).
    impact_y = canal_top + 2 + 24
    basin = FOUNTAIN.basin(x0, y0, w, h, canal_cx, canal_top, impact_y)
    keep_clear |= basin['footprint'] | FOUNTAIN.margin(basin['footprint'], 6)

    nrng = np.random.default_rng(11)
    nlow, nmid, nfine = value_noise(X, Y, 58, nrng), value_noise(X, Y, 17, nrng), value_noise(X, Y, 2.2, nrng)
    base = np.zeros((h, w, 4))
    # ---------------------------------------------------------------- the bank's ground, under its plants
    ground = np.empty((h, w, 3))
    ground[:] = F.GREEN['deep']
    ground[(nmid + 0.5 * nfine) > 0.25] = F.GREEN['dark']
    outline = bank & ~(np.roll(bank, 1, 0) & np.roll(bank, -1, 0) & np.roll(bank, 1, 1) & np.roll(bank, -1, 1))
    ground[outline] = F.OUTLINE['green']
    base[bank, :3] = ground[bank]
    base[bank, 3] = 255

    # ---------------------------------------------------------------- plants and stones of the bank, back to front
    # Stones in groups at the waterline (a big one with smaller ones, some half under water), ferns leaning over the
    # water between them, leafy clumps and grass with buttercups or clover behind, reeds and cattails in the shallows.
    may = (dilate(bank, 2) | water) & top_ok & ~keep_clear & ~deck_zone
    stamps = []
    ys, xs = np.nonzero((d > 1.5) & (d < 4.5) & top_ok & ~keep_clear & ~deck_zone)
    anchors = []
    for i in rng.permutation(len(ys)):
        cx, cy = xs[i], ys[i]
        if all((cx - ax) ** 2 + (cy - ay) ** 2 > 30 ** 2 for ax, ay in anchors):
            anchors.append((cx, cy))
    anchors += [(canal_cx - 54 - x0, canal_top + 8 - y0), (canal_cx + 54 - x0, canal_top + 8 - y0)]   # beside the basin
    placed = []
    for ax, ay in anchors:
        if rng.uniform() < 0.3:                   # a gap: ferns and grass meet the water here
            stamps.append((ay, 'fern', ax, ay - 2))
            continue
        big = rng.uniform(8, 13)
        group = [(ax + rng.uniform(-3, 3), ay + rng.uniform(-2, 2), big)]
        for _ in range(int(rng.integers(1, 4))):
            r = rng.uniform(3.5, 7)
            ang = rng.uniform(0, 2 * np.pi)
            dist = (big + r) * rng.uniform(0.6, 0.9)
            group.append((ax + np.cos(ang) * dist, ay + np.sin(ang) * dist * 0.75, r))
        for gx, gy, r in group:
            gi, gj = int(np.clip(gy, 0, h - 1)), int(np.clip(gx, 0, w - 1))
            if may[gi, gj] and -9 < d[gi, gj] < RIM and all(
                    (gx - px_) ** 2 + (gy - py_) ** 2 > ((r + pr) * 0.7) ** 2 for px_, py_, pr in placed):
                placed.append((gx, gy, r))
                stamps.append((gy, 'rock', gx, gy, r, rng.uniform() < 0.6))
    # ferns along the water between the stone groups, clumps and grass behind them
    ys, xs = np.nonzero(bank & (d > 5) & (d < 11) & may)
    for i in rng.choice(len(ys), size=min(64, len(ys)), replace=False):
        stamps.append((ys[i], 'fern', xs[i], ys[i]))
    ys, xs = np.nonzero(bank & (d >= 11) & may)
    for i in rng.choice(len(ys), size=min(210, len(ys)), replace=False):
        kind = rng.choice(['leafy', 'grass', 'grass'], p=[0.55, 0.3, 0.15])
        stamps.append((ys[i], kind, xs[i], ys[i]))
    ys, xs = np.nonzero(water & (depth > 3) & (depth < 9) & ~keep_clear & ~deck_zone)
    for i in rng.choice(len(ys), size=min(18, len(ys)), replace=False):
        stamps.append((ys[i], 'reeds', xs[i], ys[i]))
    flora = np.zeros((h, w, 4), np.uint8)
    rocks_wet = np.zeros((h, w), bool)
    for item in sorted(stamps, key=lambda t: t[0]):
        kind, sx, sy = item[1], item[2], item[3]
        if kind == 'rock':
            # (sx, sy) is the stone's middle, on the shoreline: its base (the anchor) is ry = 0.78 r below
            painted = F.stamp(flora, F.rock(rng, item[4], item[5]), sx, sy + item[4] * 0.78, may)
            wet = painted & water & (yy > sy + item[4] * 0.1)          # the part under the surface takes its tint
            flora[wet, :3] = (flora[wet, :3] * 0.55 + np.array(WATER[3]) * 0.45).astype(np.uint8)
            rocks_wet |= painted & water
        elif kind == 'fern':
            F.stamp(flora, F.fern(rng, rng.uniform(0.9, 1.1)), sx, sy, may)
        elif kind == 'leafy':
            F.stamp(flora, F.leafy(rng, rng.uniform(0.9, 1.1)), sx, sy, may & ~water)
        elif kind == 'grass':
            flowers = rng.choice([None, 'buttercup', 'clover'], p=[0.4, 0.35, 0.25])
            F.stamp(flora, F.grass(rng, flowers, rng.uniform(0.9, 1.1)), sx, sy, may & ~water)
        elif kind == 'reeds':
            F.stamp(flora, F.reeds(rng, rng.uniform(0.7, 1.0)), sx, sy, may)
    stone_mask = rocks_wet

    # ---------------------------------------------------------------- lily pads in clusters, a flower on some
    ys, xs = np.nonzero(water & (depth > 14) & (depth < 70) & ~deck_zone & ~keep_clear)
    pads = np.zeros((h, w, 4), np.uint8)
    float_ok = water & ~deck & ~side & ~bridge & ~bridge_face
    for i in rng.choice(len(ys), size=min(13, len(ys)), replace=False):
        ccx, ccy = int(xs[i]), int(ys[i])
        cluster = [(ccx + rng.uniform(-12, 12), ccy + rng.uniform(-9, 9), rng.uniform(3.5, 8))
                   for _ in range(int(rng.integers(3, 7)))]
        for px_, py_, r in sorted(cluster, key=lambda c: c[1]):
            F.stamp(pads, F.lily_pad(rng, r, old=rng.uniform() < 0.15), px_, py_, float_ok)
        if rng.uniform() < 0.6:
            px_, py_, r = max(cluster, key=lambda c: c[2])
            F.stamp(pads, F.water_lily(rng, 'pink' if rng.uniform() < 0.3 else 'white'), px_, py_, float_ok)
    on_pads = pads[..., 3] > 0
    flora[on_pads & (flora[..., 3] == 0)] = pads[on_pads & (flora[..., 3] == 0)]
    pl = flora.astype(float)
    pl[~top_ok | deck | side | bridge | bridge_face] = 0   # keep plants off the deck, the bridge and the facade
    pad_mask = (pl[..., 3] > 0) & water

    # ---------------------------------------------------------------- the K deck and the bridge
    ly_, lx_ = np.mgrid[0:h, 0:w]
    limb = np.zeros((h, w), int)
    limb[dy0:dy0 + logo.shape[0], dx0:dx0 + logo.shape[1]] = logo_limbs(logo)
    deck_rgb = deck_planks(lx_ - dx0, ly_ - dy0, limb, np.random.default_rng(17))
    edge = deck & ~np.roll(deck, 1, 0) | deck & ~np.roll(deck, -1, 1) | deck & ~np.roll(deck, 1, 1)
    deck_rgb[edge] = OAK[4]
    deck_rgb[deck & ~np.roll(deck, -1, 0)] = OAK[1]
    base[deck, :3] = deck_rgb[deck]
    base[side, :3] = OAK[0]
    base[deck | side, 3] = 255
    boards = np.asarray(SIG.tile_pattern('boardwalk'))[..., :3].astype(float)      # the approaches' own planks, in step
    bridge_rgb = boards[(Y % 64).astype(int), (X % 64).astype(int)]
    bridge_rgb[bridge & ~np.roll(bridge, 1, 0)] = OAK[4]                             # the north edge catches the light
    bridge_rgb[bridge & ~np.roll(bridge, -1, 0)] = OAK[1]                            # the south edge's last row
    bridge_rgb[bridge & ((X < span_x0 + 2) | (X >= span_x1 - 2))] = OAK[0]           # the abutments: a break in the planks
    base[bridge, :3] = bridge_rgb[bridge]
    base[bridge_face, :3] = OAK[0]
    base[bridge | bridge_face, 3] = 255

    # ---------------------------------------------------------------- fountain: Koru in its niche, on a corbel
    corbel_y = canal_top + 2
    statue_layer, (beak_x, beak_y) = FOUNTAIN.statue(
        raster_svg(KORU, 96 * 8), x0, y0, w, h, canal_cx, (walls_l, P.BY0 * T + 7, walls_r, canal_top), corbel_y, basin)
    basin_water = water & basin['interior']

    # ---------------------------------------------------------------- the water: still, painted once
    # Depth from the shore with broad deep patches and lighter shallows (no dither: noise-edged clusters); the bed's
    # stones as darker shapes with a lit rim; the plants' reflection below the north banks; a contact line round what
    # touches the water (the same on every side: the runtime casts the shadows); a broken waterline and sun speckles.
    # The surface's motion is the decor layer's (glints and ripples, water_decor) and the koi's.
    v = 0.2 + np.clip(depth / 64, 0, 1) ** 0.7 * 4.8 + 1.9 * nlow + 0.7 * nmid + 0.16 * nfine
    for _ in range(26):                                                         # the bed's stones
        cands = np.argwhere(water & (depth > 12) & (depth < 64) & ~deck_zone & ~keep_clear)
        sy_, sx_ = cands[rng.integers(len(cands))]
        r = rng.uniform(3, 8.5)
        e = ((xx - sx_) / r) ** 2 + ((yy - sy_) / (r * 0.75)) ** 2
        e = e * (1 + 0.12 * np.sin(np.arctan2(yy - sy_, xx - sx_) * 3 + sx_))
        body = e < 1
        v[body] += 1.5
        v[body & (e > 0.55) & ((yy - sy_) * 0.8 + (xx - sx_) * 0.6 < 0)] -= 1.1    # its lit rim
    land = ~water | (flora[..., 3] > 0) & ~on_pads
    solids = deck | side | bridge | bridge_face
    statue_solid = np.asarray(statue_layer)[..., 3] > 0
    yb, xb = np.mgrid[0:h, 0:w]
    inner = basin['interior'] & water                                            # the basin's own clean, shallow water
    v[inner] = 2.0 + 1.0 * np.clip(1 - np.hypot(xb - (canal_cx - x0), yb - (impact_y - y0)) / 36, 0, 1)[inner]
    touching = land | solids | on_pads | statue_solid
    ring1, ring2 = contact(touching, water)
    v[ring1] += CONTACT[0]                                                          # a contact line, the same all round
    v[ring2] += CONTACT[1]
    above = np.zeros((h, w), int)                                               # px down from the bank above
    run = np.zeros(w, int)
    reflecting = ~water & top_ok                                                 # the bank's ground and plants, not what leans over
    for r_ in range(h):
        run = np.where(reflecting[r_], 0, run + 1)
        above[r_] = run
    reflect = water & (above >= 2) & (above < 10 + 5 * nmid) & ~touching & ~basin['footprint']
    idx = np.clip(np.round(v), 0, len(WATER) - 1).astype(int)
    col = np.array(WATER, float)[idx]
    ridx = np.clip(np.round(v[reflect] / 2.4), 0, len(REFLECT) - 1).astype(int)
    col[reflect] = np.array(REFLECT, float)[ridx]
    speck = water & ~reflect & (nfine > 0.82) & (idx >= 2) & (idx <= 5) & ~ring1
    speck |= np.roll(speck, 1, 1) & water & (nmid > 0)
    col[speck] = np.array(WATER, float)[np.maximum(idx[speck] - 2, 0)]
    shore = water & dilate(land & ~on_pads, 1) & (nfine > 0.15) & (nmid > -0.3)
    col[shore] = WATERLINE
    water_rgb = col

    frames = []
    for k in range(FRAMES):
        frame = base.copy()
        sel = water & (base[..., 3] == 0)
        frame[sel, :3] = water_rgb[sel]
        frame[sel, 3] = 255
        img = Image.fromarray(frame.round().astype(np.uint8), 'RGBA')
        img.alpha_composite(Image.fromarray(np.clip(pl, 0, 255).astype(np.uint8), 'RGBA'))
        img.alpha_composite(statue_layer)
        img.alpha_composite(Image.fromarray(FOUNTAIN.stream(k, x0, y0, w, h, beak_x, beak_y, impact_y, basin_water), 'RGBA'))
        frames.append(img)


    # Collision: a tile is blocked when its centre is water or the bank's core (the bridge stays walkable).
    blocked = set()
    for ty in range(y0 // T, y1 // T):
        for tx in range(x0 // T, x1 // T):
            cy, cxp = ty * T + 16 - y0, tx * T + 16 - x0
            if 0 <= cy < h and 0 <= cxp < w and (water[cy, cxp] or core[cy, cxp]) and not bridge[cy, cxp]:
                blocked.add((tx, ty))
    # Koi: the lake and the canal run as two overlays (the canal one stays narrow so it never covers the rooms).
    swim = water & ~(stone_mask & water) & ~basin['footprint']
    open_water = swim & ~deck & ~side & ~bridge & ~bridge_face & ~pad_mask & ~statue_solid
    koi = {}
    for name, (kx0, ky0, kx1, ky1), count in (
            ('lake', (lx0 * T, ly0 * T, (lx1 + 1) * T, (ly1 + 1) * T), P.POOL['koi'] - 3),
            ('canal', (P.vb(cx0 - 1) * T, canal_top, P.vb(cx1 + 1) * T, (cy1 + 2) * T), 3)):
        sl = (slice(ky0 - y0, ky1 - y0), slice(kx0 - x0, kx1 - x0))
        swim_m = swim[sl]
        if name == 'canal':                      # the canal school turns back just inside the lake mouth
            swim_m = swim_m & (np.arange(ky1 - ky0)[:, None] < (P.POOL['canal'][3] + 1.6) * T - ky0)
        koi[name] = dict(origin=[kx0, ky0], size=[kx1 - kx0, ky1 - ky0], swim=swim_m, open=open_water[sl] & swim_m,
                         count=count)
    calm = open_water & ~reflect & ~ring1 & ~ring2
    surface = {}
    for ty in range(y0 // T, y1 // T):
        for tx in range(x0 // T, x1 // T):
            m = calm[ty * T - y0:ty * T - y0 + T, tx * T - x0:tx * T - x0 + T]
            if m.shape == (T, T) and m.mean() > 0.3:
                surface[tx, ty] = WaterMask(m, level=int(np.median(idx[ty * T - y0:ty * T - y0 + T, tx * T - x0:tx * T - x0 + T][m])))
    floor = ~(bank | water) & top_ok
    edge = bank & dilate(floor, 1) & ~keep_clear
    ey, ex = np.nonzero(edge)
    # The water shader repaints only the open water the floor tiles show the same in every frame: not under the
    # fountain's stream and rings (animated tiles) nor under the plants, pads, deck and bridge drawn over it.
    splash = FOUNTAIN.stirred(x0, y0, w, h, beak_x, impact_y) | basin['footprint']
    fx = dict(open=open_water & ~splash, rgb=water_rgb.round().astype(np.uint8), index=idx, depth=depth,
              reflect=reflect, shade=ring1 | ring2, fountain=(beak_x, impact_y))
    return Pool(region=(x0, y0), frames=frames, blocked=blocked, statue=statue_layer, koi=koi, surface=surface,
                bank_edge=(ex + x0, ey + y0), fx=fx)


# ------------------------------------------------------------------------------------------------ the surface's motion

LOOP = 32                                         # frames of FRAME_MS: 7.04 s (the lawn's breeze loops over 64)
# glint shapes, (dx, dy) from its top left pixel: a 2 x 2 spark, a 3 x 2 and a 4 x 2 dash, a plus with a 2 x 2 heart.
# None is smaller than 2 x 2 (the opening and the fading frames); the bright frames are never under 2 x 2.
GLINT_SHAPES = {
    'spark': [(0, 0), (1, 0), (0, 1), (1, 1)],
    'dash3': [(0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (2, 1)],
    'dash4': [(0, 0), (1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (2, 1), (3, 1)],
    'plus': [(0, 0), (1, 0), (0, 1), (1, 1), (-1, 0), (-1, 1), (2, 0), (2, 1), (0, -1), (1, -1), (0, 2), (1, 2)],
}
RIPPLE_RADII = (3, 5, 7, 10, 12)                  # px: circles of 7, 11, 15, 21 and 25 px across, one centre pixel
GLINTS, RIPPLES = 16, 4


def _tone(level, rise):
    """The colour `rise` steps lighter than WATER[level], from the water's ramp extended upwards (RAMP)."""
    return RAMP[int(np.clip(level + len(LIGHTER) - rise, 0, len(RAMP) - 1))]


def circle(r):
    """The pixels of a circle of radius r (px) round the pixel (0, 0): 1 px wide, a pixel circle on the 1:1 ground."""
    ys, xs = np.mgrid[-r:r + 1, -r:r + 1]
    d = np.hypot(xs, ys)
    return {(int(x), int(y)) for x, y in zip(xs[(d > r - 0.5) & (d <= r + 0.5)], ys[(d > r - 0.5) & (d <= r + 0.5)])}


def _glint(rng):
    """The geometry of one sun glint: its shape and where its top left pixel is in the tile. The steps are drawn by
    _glint_steps, in the colours of the water the tile lies on."""
    shape = list(GLINT_SHAPES)[int(rng.integers(len(GLINT_SHAPES)))]
    return dict(shape=shape, x=int(rng.integers(4, T - 8)), y=int(rng.integers(4, T - 8)))


def _paint(pixels, x, y, colour):
    a = np.zeros((T, T, 4), np.uint8)
    for dx, dy in pixels:
        a[y + dy, x + dx] = (*colour, 255)
    return Image.fromarray(a, 'RGBA')


def _glint_steps(g, level):
    """[RGBA tile per step] of a glint on water of step `level`: a dim 2 x 1 spark, the whole shape bright (the plus
    brightest at its heart: two frames), the whole shape dim. Bright is three steps lighter than the water, dim two."""
    dim, bright = _tone(level, 2), _tone(level, 3)
    px = GLINT_SHAPES[g['shape']]
    heart = [p for p in px if 0 <= p[0] <= 1 and 0 <= p[1] <= 1]
    return [_paint(heart[:2], g['x'], g['y'], dim), _paint(heart, g['x'], g['y'], bright),
            _paint(px, g['x'], g['y'], bright), _paint(px, g['x'], g['y'], dim)]


def _ripple(rng):
    """The geometry of a ripple: the pixel its rings are round (the same for every step), well inside the tile."""
    return dict(cx=int(rng.integers(RIPPLE_RADII[-1], T - RIPPLE_RADII[-1])),
                cy=int(rng.integers(RIPPLE_RADII[-1], T - RIPPLE_RADII[-1])))


def _ripple_steps(g, level):
    """[RGBA tile per step] of a ripple on water of step `level`: a circle opening from 7 to 25 px across, bright while
    small, then dim, then one step lighter than the water only."""
    out = []
    for k, r in enumerate(RIPPLE_RADII):
        colour = _tone(level, 3) if k < 2 else _tone(level, 2) if k < 4 else _tone(level, 1)
        out.append(_paint([(g['cx'] + dx, g['cy'] + dy) for dx, dy in circle(r)], 0, 0, colour))
    return out


def _foot(steps):
    return np.any([np.asarray(img)[..., 3] > 0 for img in steps], axis=0)


def water_decor(surface):
    """{(tx, ty): [RGBA 32 x 32 per frame of FRAME_MS]} for some of the water tiles: a glint twinkling once per loop, or
    now and then a ripple, only where every pixel it lights is open water (surface: tile -> mask, see WaterMask) and
    drawn in the tones that stand out from that water. Each tile has its own shape, place and start frame, so they do
    not flash together; the first frame is empty, which is what people see with map animations off."""
    rng = np.random.default_rng(23)
    glints, ripples = [_glint(rng) for _ in range(GLINTS)], [_ripple(rng) for _ in range(RIPPLES)]
    blank = Image.new('RGBA', (T, T))
    out, taken = {}, set()
    for cell, mask in sorted(surface.items()):
        level = getattr(mask, 'level', 3)
        u = rng.uniform()
        kind, pool_ = (_glint_steps, glints) if u < 0.5 else (_ripple_steps, ripples) if u < 0.58 else (None, [])
        fits = [(g, steps) for g, steps in ((g, kind(g, level)) for g in pool_) if not (_foot(steps) & ~np.asarray(mask)).any()]
        if not fits:
            continue
        steps = fits[int(rng.integers(len(fits)))][1]
        first = int(rng.integers(1, LOOP - len(steps) + 1))                      # ends before the loop wraps to frame 0
        # no two tiles flash the same picture on the same frame: from the drawn start, the next start that is free
        starts = [(first - 1 + k) % (LOOP - len(steps)) + 1 for k in range(LOOP - len(steps))]
        start = next((s for s in starts if (s, steps[1].tobytes()) not in taken), None)
        if start is None:
            continue
        taken.add((start, steps[1].tobytes()))
        frames = [blank] * LOOP
        for k, img in enumerate(steps):
            frames[start + k] = img
        out[cell] = frames
    return out
