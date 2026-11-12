"""The pool of the main office (canal, bridge, lake with the official K deck, Koru fountain, koi), redrawn at native
resolution: one art pixel per map pixel, 32 per tile, like the furniture catalogue's art, so curves are smooth instead of the 2x
blocks of the main office (16 px art shown at 2x).

Everything is computed from signed distances at map-pixel resolution (numpy) and painted in small palettes, without
dither, so it stays crisp pixel art (the owner's references, 18/10/2026: a clear emerald lake over dark stones, a lily
pond with reflections, grass and moss sheets):
  water    still, painted once: emerald turquoise in eight tones, deep where it is far from the shore, broken into broad
           deep holes and lighter shallows by smooth noise; the bed's stones as darker shapes with a lit rim; the bank's
           shade and the plants' reflection below the north banks; shadows of the deck, the bridge, the pads and the
           leaves over the water; a broken waterline and sun speckles
  surface  its motion lives in the map's decor layer (water_decor): sun glints that twinkle and ripples that open now and
           then, on tiles that do not depend on where they lie, so the water costs a few dozen tiles instead of eight
           frames of every water tile; the fountain alone keeps its 8 x 220 ms frames
  bank     dense planting from flora.py: stone groups at the waterline (moss caps, the part under the surface tinted),
           ferns leaning over the water, leafy clumps, grass with buttercups or clover, reeds and cattails in the shallows
  deck     the official K (logo-konclui-icon.svg) in light oak planks, with its edge, 5 px thickness and shadow
  bridge   oak planks across the canal where the north corridor crosses it, low ink rails, shadow on the water
  pads     clusters of lily pads (notch, rim light, veins), white or pink water lilies on some
  fountain Koru (the official vector, celebration pose) in a niche of the facade on a corbel at the canal head, a stream
           from the beak and rings where it lands: all drawn by fountain.py

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
from palette import INK, rgb

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
GLINT = [rgb('#9cf0dc'), rgb('#e9fff7')]                                        # dim, bright
OAK = [rgb(c) for c in ('#8C6646', '#B88F66', '#CFAA80', '#DEBF98', '#E9D2B2')]


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


def noise(X, Y, seed):
    """Smooth value in -1..1 from a few incommensurate waves (organic edges and mottling, no texture files)."""
    a = seed * 1.7
    return (np.sin(X * 0.13 + a) * np.sin(Y * 0.11 - a) + 0.6 * np.sin(X * 0.31 - Y * 0.23 + 2 * a)
            + 0.4 * np.sin(X * 0.57 + Y * 0.49 - a)) / 2.0


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
    water = d < 0
    depth = -d
    in_slot = (X >= walls_l) & (X < walls_r) & (Y < slot_bottom)
    top_ok = Y >= canal_top - 1                  # nothing of the bank on the facade above the canal head
    bank_edge = RIM - 2 + 4 * noise(X * 0.45, Y * 0.45, 1) + 1.5 * noise(X, Y, 4)   # lumpy mounds
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
    for k in range(1, 6):
        side |= np.roll(deck, k, 0)
    side &= ~deck & water
    shadow = np.roll(np.roll(deck | side, 7, 0), 5, 1) & water & ~deck & ~side
    deck_zone = np.zeros_like(deck)               # deck and a margin: no stones, pads or reeds there
    for k in range(-6, 13, 3):
        deck_zone |= np.roll(np.roll(deck, k, 0), k // 2, 1) | np.roll(deck, k, 1)
    # The bridge.
    bx0, by0, bx1, by1 = P.POOL['bridge']
    bridge = (X >= bx0 * T - 2) & (X < (bx1 + 1) * T + 2) & (Y >= by0 * T) & (Y < (by1 + 1) * T)
    bridge_shadow = (X >= bx0 * T - 2) & (X < (bx1 + 1) * T + 2) & (Y >= (by1 + 1) * T) \
        & (Y < (by1 + 1) * T + 6) & water
    keep_clear = bridge | (Y < canal_top + 46) & (np.abs(X - canal_cx) < 26)   # the fountain's corbel and splash

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
    anchors += [(canal_cx - 40 - x0, canal_top + 10 - y0), (canal_cx + 40 - x0, canal_top + 10 - y0)]
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
    for i in rng.choice(len(ys), size=min(46, len(ys)), replace=False):
        stamps.append((ys[i], 'fern', xs[i], ys[i]))
    ys, xs = np.nonzero(bank & (d >= 11) & may)
    for i in rng.choice(len(ys), size=min(150, len(ys)), replace=False):
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
    ys, xs = np.nonzero(water & (depth > 14) & (depth < 70) & ~deck_zone & ~keep_clear & ~shadow)
    pads = np.zeros((h, w, 4), np.uint8)
    float_ok = water & ~deck & ~side & ~bridge
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
    pl[~top_ok | deck | side | bridge] = 0                # keep plants off the deck, the bridge and the facade
    pad_mask = (pl[..., 3] > 0) & water

    # ---------------------------------------------------------------- the K deck and the bridge
    plank = ((Y - y0 - dy0) // 8).astype(int)
    tone = rng.uniform(-0.06, 0.06, plank.max() + 2)[np.clip(plank, 0, None)]
    seam = ((Y - y0 - dy0) % 8) == 7
    grain = (np.sin((X + plank * 37) * 0.21) * 0.5 + np.sin((X - plank * 11) * 0.083) * 0.5) * 0.035
    t = np.clip(0.62 + tone + grain, 0, 1)
    deck_rgb = np.array(OAK, float)[np.clip((t * (len(OAK) - 1)).round().astype(int), 0, len(OAK) - 1)]
    deck_rgb[seam] = OAK[1]
    edge = deck & ~np.roll(deck, 1, 0) | deck & ~np.roll(deck, -1, 1) | deck & ~np.roll(deck, 1, 1)
    deck_rgb[edge] = OAK[4]
    deck_rgb[deck & ~np.roll(deck, -1, 0)] = OAK[1]
    base[deck, :3] = deck_rgb[deck]
    base[side, :3] = OAK[0]
    base[deck | side, 3] = 255
    bt = np.clip(0.6 + rng.uniform(-0.05, 0.05, 64)[((X - bx0 * T) // 6).astype(int) % 64], 0, 1)
    bridge_rgb = np.array(OAK, float)[np.clip((bt * (len(OAK) - 1)).round().astype(int), 0, len(OAK) - 1)]
    bridge_rgb[((X - bx0 * T) % 6) == 5] = OAK[1]
    rail = bridge & ((Y < by0 * T + 3) | (Y >= (by1 + 1) * T - 3))
    bridge_rgb[rail] = rgb(INK)
    bridge_rgb[rail & (((X - bx0 * T) % 24) < 3)] = rgb('#2B3A78')
    base[bridge, :3] = bridge_rgb[bridge]
    base[bridge, 3] = 255

    # ---------------------------------------------------------------- fountain: Koru in its niche, on a corbel
    corbel_y = canal_top + 2
    statue_layer, (beak_x, beak_y), fountain_shade = FOUNTAIN.statue(raster_svg(KORU, 96 * 8), x0, y0, w, h, canal_cx,
                                                                      (walls_l, P.BY0 * T + 7, walls_r, canal_top), corbel_y, water)
    shadow = shadow | fountain_shade                         # the plinth's and the corbel's shade darkens the water like the deck's
    impact_y = corbel_y + 24

    # ---------------------------------------------------------------- the water: still, painted once
    # Depth from the shore with broad deep patches and lighter shallows (no dither: noise-edged clusters); the bed's
    # stones as darker shapes with a lit rim; the bank's shade and the plants' reflection below the north banks; the
    # shadows of the deck, the bridge, the pads and the leaves over the water; a broken waterline and sun speckles.
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
    v[(np.roll(land, 7, 0) | np.roll(land, 5, 1)) & water] += 0.9                    # shade of the bank
    v[(np.roll(land, 3, 0) | np.roll(land, 2, 1)) & water] += 0.7
    v[np.roll(np.roll(on_pads, 2, 0), 1, 1) & water & ~on_pads] += 1.1                # under the pads
    v[shadow | bridge_shadow] += 1.6
    above = np.zeros((h, w), int)                                               # px down from the land above
    run = np.zeros(w, int)
    for r_ in range(h):
        run = np.where(land[r_], 0, run + 1)
        above[r_] = run
    reflect = water & (above >= 2) & (above < 10 + 5 * nmid) & ~(shadow | bridge_shadow)
    idx = np.clip(np.round(v), 0, len(WATER) - 1).astype(int)
    col = np.array(WATER, float)[idx]
    ridx = np.clip(np.round(v[reflect] / 2.4), 0, len(REFLECT) - 1).astype(int)
    col[reflect] = np.array(REFLECT, float)[ridx]
    speck = water & ~reflect & (nfine > 0.82) & (idx >= 2) & (idx <= 5) & ~shadow
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
        img.alpha_composite(Image.fromarray(FOUNTAIN.stream(k, x0, y0, w, h, beak_x, beak_y, impact_y, water), 'RGBA'))
        frames.append(img)


    # Collision: a tile is blocked when its centre is water or the bank's core (the bridge stays walkable).
    blocked = set()
    for ty in range(y0 // T, y1 // T):
        for tx in range(x0 // T, x1 // T):
            cy, cxp = ty * T + 16 - y0, tx * T + 16 - x0
            if 0 <= cy < h and 0 <= cxp < w and (water[cy, cxp] or core[cy, cxp]) and not bridge[cy, cxp]:
                blocked.add((tx, ty))
    # Koi: the lake and the canal run as two overlays (the canal one stays narrow so it never covers the rooms).
    swim = water & ~(stone_mask & water)
    open_water = swim & ~deck & ~side & ~bridge & ~pad_mask & ~(np.asarray(statue_layer)[..., 3] > 0)
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
    calm = open_water & ~reflect & ~(shadow | bridge_shadow)
    surface = {}
    for ty in range(y0 // T, y1 // T):
        for tx in range(x0 // T, x1 // T):
            m = calm[ty * T - y0:ty * T - y0 + T, tx * T - x0:tx * T - x0 + T]
            if m.shape == (T, T) and m.mean() > 0.3:
                surface[tx, ty] = m
    floor = ~(bank | water) & top_ok
    edge = bank & dilate(floor, 1) & ~keep_clear
    ey, ex = np.nonzero(edge)
    # The water shader repaints only the open water the floor tiles show the same in every frame: not under the
    # fountain's stream and rings (animated tiles) nor under the plants, pads, deck and bridge drawn over it.
    splash = FOUNTAIN.stirred(x0, y0, w, h, beak_x, impact_y)
    fx = dict(open=open_water & ~splash, rgb=water_rgb.round().astype(np.uint8), index=idx, depth=depth,
              reflect=reflect, shade=shadow | bridge_shadow, fountain=(beak_x, impact_y))
    return Pool(region=(x0, y0), frames=frames, blocked=blocked, statue=statue_layer, koi=koi, surface=surface,
                bank_edge=(ex + x0, ey + y0), fx=fx)


# ------------------------------------------------------------------------------------------------ the surface's motion

LOOP = 32                                         # frames of FRAME_MS: 7.04 s, like the lawn's breeze


def _glint(rng):
    """[RGBA tile per step] of one sun glint: a dim spark, a bright dash (a star on the longest), a dim fade."""
    x, y, n = int(rng.integers(4, T - 7)), int(rng.integers(4, T - 5)), int(rng.integers(1, 4))
    steps = []
    for k in range(4):
        a = np.zeros((T, T, 4), np.uint8)
        dim, bright = (*GLINT[0], 255), (*GLINT[1], 255)
        if k == 0:
            a[y, x + n // 2] = dim
        elif k in (1, 2):
            a[y, x:x + n] = bright
            if n == 3 and k == 2:
                a[y - 1, x + 1] = a[y + 1, x + 1] = dim
        else:
            a[y, x:x + n] = dim
        steps.append(Image.fromarray(a, 'RGBA'))
    return steps


def _ripple(rng):
    """[RGBA tile per step] of a ripple: a flattened ring opening and fading."""
    cx, cy = T / 2 + rng.uniform(-3, 3), T / 2 + rng.uniform(-2, 2)
    yy, xx = np.mgrid[0:T, 0:T] + 0.5
    steps = []
    for k, r in enumerate((2, 4, 6.5, 9, 11.5)):
        a = np.zeros((T, T, 4), np.uint8)
        ring = np.abs(np.hypot((xx - cx), (yy - cy) / 0.55) - r) < 0.75
        a[ring] = (*(GLINT[1] if k < 2 else GLINT[0] if k < 4 else WATERLINE), 255)
        steps.append(Image.fromarray(a, 'RGBA'))
    return steps


def water_decor(surface):
    """{(tx, ty): [RGBA 32 x 32 per frame of FRAME_MS]} for some of the water tiles: a glint twinkling once per loop,
    or now and then a ripple, only where every pixel it lights is open water (surface: tile -> mask). Starts are spread
    over the loop in steps of four frames, so a few dozen tiles serve the whole pool; the first frame is empty, which
    is what people see with map animations off."""
    rng = np.random.default_rng(23)
    glints = [_glint(rng) for _ in range(12)]
    ripples = [_ripple(rng) for _ in range(3)]
    reach = lambda steps: np.any([np.asarray(img)[..., 3] > 0 for img in steps], axis=0)
    glints, ripples = [(g, reach(g)) for g in glints], [(r, reach(r)) for r in ripples]
    blank = Image.new('RGBA', (T, T))
    out = {}
    for cell, mask in sorted(surface.items()):
        u = rng.uniform()
        pool_ = glints if u < 0.5 else ripples if u < 0.58 else []
        fits = [steps for steps, foot in pool_ if not (foot & ~mask).any()]
        if not fits:
            continue
        steps = fits[int(rng.integers(len(fits)))]
        start = 4 * int(rng.integers(1, (LOOP - len(steps)) // 4 + 1))       # ends before the loop wraps to frame 0
        frames = [blank] * LOOP
        for k, img in enumerate(steps):
            frames[(start + k) % LOOP] = img
        out[cell] = frames
    return out
