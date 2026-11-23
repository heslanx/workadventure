"""Proxy volumes: a few solids in metres that overlay a HAND-DRAWN sprite and give the lighting what the picture cannot: a height
per pixel, a normal per pixel and the facts of a caster (how tall it is, where its foot is, where its light comes from). The
picture itself is never touched. Deterministic, numpy and Pillow only. Run python3 -I.

Why: the lighting reads fx/normal.png and bakes a cast shadow from each sprite's silhouette. For a piece that reads well as
drawn (an arc lamp, a bird of paradise) the baker (tools/bake.py) would redraw it worse, so the drawing stays and a proxy
volume supplies the relief: the baker's own projection and z-buffer turn the proxy into a height image and a normal image, laid
over the sprite's canvas.

FROZEN PUBLIC API (version 1)
-----------------------------
    ProxyRecipe(name, recipe, origin, keys=(), ground=None, fill_radius=3, search=6, notes='')
        .moved(dx, dy)   the same recipe for a canvas whose art moved by (dx, dy) px (the shift props/touchup.py `unclip` reports)
        recipe   a volume.Recipe (solids in metres; its anchors are named points in metres)
        origin   (ox, oy) INTEGER canvas px of the recipe's world point (0, 0, 0) in the sprite's canvas (the footprint's
                 north-west corner on the floor); every placement below is derived from it
        keys     the placed sprite keys this recipe describes ('<collection folder>/<image path>')
        ground   (x0, y0, x1, y1) metres: where the piece touches the floor (the foot's rectangle); None = the recipe's footprint
        fill_radius  how far (px) an opaque sprite pixel the proxy does not cover looks for a covered neighbour
        search   radius (px) of the alignment search
    Frame(origin=(0, 0), projection=None)    the recipe author's ruler, scales read from projection.json (never typed here):
        x(px), y(ground_row), z(height_px), r(radius_px)  px -> metres; m(x_px, ground_row, height_px) -> (x, y, z) metres of
        a point of a drawing in elevation: it sits in the vertical plane whose floor contact is canvas row `ground_row`, so
        it is drawn at row ground_row - height_px (the oblique projection draws height straight up)
    flattened(solid, ky, about_y)    the solid with its POSITIONS squashed in y by ky about `about_y`, its NORMALS kept: a pot
        or a lamp base drawn with a flat rim (a few rows) keeps the shading of a round pot while its footprint matches the picture
    Sheet(frame, outline, mat, anchor_row, anchor_height, tilt_deg=0, relief=None)    a thin one-sided surface authored in the
        sprite's own pixels: outline(t, u) -> (X, R) canvas px for t in [0, 1] along it and u in [-1, 1] across it. The surface
        projects EXACTLY onto those pixels (a leaf drawn in elevation); `anchor_row` is a screen row of the surface that is
        `anchor_height` px above the floor, `tilt_deg` leans the surface back from the viewer (0 = upright), `relief(t, u)` is a
        height in px added along the view ray (it moves no pixel, it only gives the surface a ridge: the normals fan out)
    bake_proxy(proxy, projection=None) -> bake.Piece     the proxy baked with the baker's projection and z-buffer (no outline,
        no clean-up, no override patch: it is a relief, not a picture)
    place(piece, origin, shape) -> Placed     the baked proxy's height, normal bytes and coverage in a canvas of `shape` (h, w)
    alignment(opaque, piece, placement, search) -> dict     covered_share (of the sprite's opaque pixels the proxy covers),
        stray_share (of the proxy's pixels that fall on a pixel that is not opaque), iou, best_offset (the shift of the proxy, in px,
        that maximises the overlap: the smallest when several do), iou_best, ok (False when |dx| or |dy| of best_offset exceeds 1)
    fill(height, normal, covered, opaque, radius) -> (height, normal, filled, flat)     every opaque pixel the proxy does not
        cover takes the nearest covered pixel within `radius` (ties: nearer first, then the upper, then the left one), else
        flat (0, 0, 1) at height 0
    build(proxy, rgba, key=None, projection=None, solid_alpha=200, piece=None) -> ProxyResult
    ProxyResult.write(out_dir, scale=6) writes <key>.normal.png, <key>.height.png, <key>.proxy.json, <key>.overlay.png
    CLI   python3 -I proxy.py --list
          python3 -I proxy.py RECIPE --sprite PNG --out DIR [--key NAME] [--scale 6] [--projection oblique]
          python3 -I proxy.py RECIPE --dist DIR --out DIR      every key the recipe declares, read from DIR/entities/<key>
          exit 1 when an alignment fails; RECIPE is a name of hq-office/props/proxies

Conventions
    opaque pixel       alpha >= 200 (tools/kinds.py SOLID_ALPHA, the runtime's bound): a painted shadow (alpha 22 to 166) and
                       a baked pool of light (90 to 125) are layers on the picture, not the piece
    normal image       the baker's convention: RGB = (n + 1) / 2 * 255 with n = (x right, y UP the map, z out of the floor),
                       alpha 255 on the opaque pixels, flat = (128, 128, 255); transparent pixels (128, 128, 255, 0)
    height image       uint8 px above the floor, 0 off the piece
    caster             height_px (the highest opaque pixel), height_p95_px, foot_row (last canvas row of the ground contact),
                       foot_span [x0, x1] (its columns), sprite_foot_row (the lowest opaque row), anchors {name: [x, y]} canvas px
"""
import argparse
import dataclasses
import hashlib
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import PIL
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bake as B  # noqa: E402
import kinds as K  # noqa: E402
import volume as V  # noqa: E402

API_VERSION = 1
SOLID_ALPHA = K.SOLID_ALPHA
FLAT_NORMAL = (128, 128, 255)            # (0, 0, 1) in the baker's encoding
MAX_OFFSET_PX = 1                        # a recipe further than this from its best offset fails


# ------------------------------------------------------------------------------------------------------------ ruler

class Frame:
    """px <-> metres for a drawing in elevation. Scales come from projection.json through the baker's own loader."""

    def __init__(self, origin=(0, 0), projection=None):
        self.proj = projection if isinstance(projection, B.Projection) else B.load_projection(projection)
        self.ox, self.oy = origin
        self.sx, self.sy, self.sz = self.proj.sx, self.proj.sy, self.proj.sz

    def x(self, x_px):
        return (x_px - self.ox) / self.sx

    def y(self, ground_row):
        return (ground_row - self.oy) / self.sy

    def z(self, height_px):
        return height_px / self.sz

    def r(self, radius_px):
        return radius_px / self.sx

    def m(self, x_px, ground_row, height_px):
        """Metres of a point at canvas column x_px, drawn at row ground_row - height_px, in the vertical plane whose floor
        contact row is ground_row."""
        return (self.x(x_px), self.y(ground_row), self.z(height_px))

    def path(self, points, ground_row):
        """[(X, R)] canvas px of a line drawn in elevation, in the vertical plane of floor row `ground_row`, as (x, y, z) metres."""
        return [self.m(X, ground_row, ground_row - R) for X, R in points]


# ------------------------------------------------------------------------------------------------------------ solids

class _Flattened(V.Solid):
    def __init__(self, inner, ky, about_y):
        if not 0.0 < ky <= 4.0:
            raise ValueError(f'flattened: ky {ky} is out of range')
        self.inner, self.ky, self.about = inner, float(ky), float(about_y)

    def sample(self, step, all_faces=False):
        s = self.inner.sample(step, all_faces)
        P = s.P.copy()
        P[:, 1] = self.about + (P[:, 1] - self.about) * self.ky
        return V.Samples(P, s.N, s.mat, s.names)


def flattened(solid, ky, about_y):
    """The solid with its positions squashed in y by `ky` about the plane y = about_y and its normals kept (not the
    inverse-transpose ones): the picture of a pot or a base drawn with a rim a few rows deep is shaded as a round pot."""
    return _Flattened(solid, ky, about_y)


class Sheet(V.Solid):
    """A one-sided surface authored in canvas pixels, see the module text. World position of a sample: its screen point is
    exactly outline(t, u); the plane through (anchor_row, anchor_height) leans back by tilt_deg; relief moves it along the view
    ray (screen-neutral)."""

    def __init__(self, frame, outline, mat, anchor_row, anchor_height, tilt_deg=0.0, relief=None):
        self.f, self.outline, self.mat = frame, outline, mat
        self.row0, self.h0 = float(anchor_row), float(anchor_height)
        self.tilt = math.radians(tilt_deg)
        self.relief = relief

    def _world(self, t, u):
        f = self.f
        X, R = self.outline(t, u)
        k = f.sy * math.sin(self.tilt) + f.sz * math.cos(self.tilt)
        b = (self.row0 - R) / k
        z = self.h0 / f.sz + b * math.cos(self.tilt)
        y = (R - f.oy + f.sz * z) / f.sy
        x = (X - f.ox) / f.sx
        P = np.stack([x, y, z], -1)
        if self.relief is not None:
            rho = math.hypot(f.sz, f.sy)
            m = np.asarray(self.relief(t, u), float) * rho / (f.sz * f.sy)         # px of height -> metres along the ray
            P = P + m[..., None] * np.array([0.0, f.sz / rho, f.sy / rho])
        return P

    def sample(self, step, all_faces=False):
        tt, uu = np.meshgrid(np.linspace(0, 1, 17), np.linspace(-1, 1, 17), indexing='ij')
        W = self._world(tt, uu)
        lt = np.linalg.norm(np.diff(W, axis=0), axis=-1).sum(0).max()
        lu = np.linalg.norm(np.diff(W, axis=1), axis=-1).sum(1).max()
        nt, nu = max(2, int(math.ceil(lt / step))), max(2, int(math.ceil(lu / step)))
        t = (np.arange(nt) + 0.5) / nt
        u = (np.arange(nu) + 0.5) / nu * 2 - 1
        T, U = np.meshgrid(t, u, indexing='ij')
        T, U = T.ravel(), U.ravel()
        e = 1e-4
        P = self._world(T, U)
        dt = self._world(np.clip(T + e, 0, 1), U) - self._world(np.clip(T - e, 0, 1), U)
        du = self._world(T, np.clip(U + e, -1, 1)) - self._world(T, np.clip(U - e, -1, 1))
        N = np.cross(dt, du)
        ln = np.linalg.norm(N, axis=1)
        ok = ln > 1e-12
        P, N = P[ok], N[ok] / ln[ok, None]
        view = np.array([0.0, self.f.sz, self.f.sy])
        N = np.where((N @ view < 0)[:, None], -N, N)                      # the side the camera sees
        return V.Samples(P, N, np.zeros(len(P), np.int32), (self.mat,))


# ---------------------------------------------------------------------------------------------------------- recipe

@dataclass
class ProxyRecipe:
    name: str
    recipe: object
    origin: tuple
    keys: tuple = ()
    ground: tuple = None
    fill_radius: int = 3
    search: int = 6
    notes: str = ''

    def __post_init__(self):
        if not self.name:
            raise ValueError('a proxy recipe needs a name')
        if len(self.origin) != 2 or any(int(v) != v for v in self.origin):
            raise ValueError(f'{self.name}: origin is two whole canvas px, got {self.origin!r}')
        self.origin = (int(self.origin[0]), int(self.origin[1]))
        self.keys = tuple(self.keys)
        if self.ground is None:
            w, d = self.recipe.footprint
            self.ground = (0.0, 0.0, w, d)
        if len(self.ground) != 4 or self.ground[2] <= self.ground[0] or self.ground[3] <= self.ground[1]:
            raise ValueError(f'{self.name}: ground is (x0, y0, x1, y1) metres with x1 > x0 and y1 > y0, got {self.ground!r}')
        if self.fill_radius < 0 or self.search < 0:
            raise ValueError(f'{self.name}: fill_radius and search are not negative')

    def moved(self, dx, dy):
        """The same recipe for a canvas whose art moved by (dx, dy) px (a touch-up that grew the canvas: props/touchup.py `unclip`
        reports that shift): only the origin changes, the solids and the ground stay in metres."""
        return dataclasses.replace(self, origin=(self.origin[0] + int(dx), self.origin[1] + int(dy)))


def bake_proxy(proxy, projection=None):
    return B.bake(proxy.recipe, projection, overrides=False, outline=False, cleanup=False)


# ---------------------------------------------------------------------------------------------------------- placing

@dataclass
class Placed:
    height: np.ndarray        # (h, w) uint8
    normal: np.ndarray        # (h, w, 3) uint8, flat where nothing is covered
    covered: np.ndarray       # (h, w) bool
    dx: int                   # canvas = proxy piece + (dx, dy)
    dy: int


def placement(piece, origin):
    """(dx, dy): the baked proxy's pixel (i, j) lands on canvas (i + dy, j + dx). The recipe's world origin is the piece's
    footprint corner (baker: footprint px x, y)."""
    fp = piece.footprint['px']
    return int(origin[0]) - int(fp['x']), int(origin[1]) - int(fp['y'])


def _window(ph, pw, H, W, dx, dy):
    sy0, sx0 = max(0, -dy), max(0, -dx)
    sy1, sx1 = min(ph, H - dy), min(pw, W - dx)
    if sy1 <= sy0 or sx1 <= sx0:
        return None
    return (slice(sy0, sy1), slice(sx0, sx1)), (slice(sy0 + dy, sy1 + dy), slice(sx0 + dx, sx1 + dx))


def place(piece, origin, shape):
    H, W = shape
    dx, dy = placement(piece, origin)
    height = np.zeros((H, W), np.uint8)
    normal = np.zeros((H, W, 3), np.uint8)
    normal[:] = FLAT_NORMAL
    covered = np.zeros((H, W), bool)
    win = _window(piece.height.shape[0], piece.height.shape[1], H, W, dx, dy)
    if win:
        src, dst = win
        c = piece.rgba[..., 3][src] > 0
        covered[dst] = c
        height[dst] = np.where(c, piece.height[src], 0)
        normal[dst] = np.where(c[..., None], piece.normal[src][..., :3], np.array(FLAT_NORMAL, np.uint8))
    return Placed(height, normal, covered, dx, dy)


# ------------------------------------------------------------------------------------------------------- alignment

def _overlap(opaque, proxy_mask, dx, dy):
    H, W = opaque.shape
    win = _window(proxy_mask.shape[0], proxy_mask.shape[1], H, W, dx, dy)
    if not win:
        return 0
    src, dst = win
    return int((opaque[dst] & proxy_mask[src]).sum())


def alignment(opaque, piece, nominal, search=6):
    """Measured, not assumed. `opaque` the sprite's solid mask, `piece` the baked proxy, `nominal` its (dx, dy) placement."""
    proxy_mask = piece.rgba[..., 3] > 0
    n_sprite, n_proxy = int(opaque.sum()), int(proxy_mask.sum())
    dx, dy = nominal
    inter = _overlap(opaque, proxy_mask, dx, dy)
    best = None
    for sdy in range(-search, search + 1):
        for sdx in range(-search, search + 1):
            i = _overlap(opaque, proxy_mask, dx + sdx, dy + sdy)
            iou = i / max(1, n_sprite + n_proxy - i)
            key = (-iou, max(abs(sdx), abs(sdy)), abs(sdx) + abs(sdy), sdy, sdx)      # best overlap, then the smallest shift
            if best is None or key < best[0]:
                best = (key, sdx, sdy, iou)
    _, bx, by, biou = best
    iou0 = inter / max(1, n_sprite + n_proxy - inter)
    ok = max(abs(bx), abs(by)) <= MAX_OFFSET_PX
    return {'sprite_px': n_sprite, 'proxy_px': n_proxy, 'overlap_px': inter,
            'covered_share': round(inter / max(1, n_sprite), 4), 'stray_share': round(1 - inter / max(1, n_proxy), 4),
            'iou': round(iou0, 4), 'best_offset': [bx, by], 'iou_best': round(biou, 4), 'ok': bool(ok)}


# ---------------------------------------------------------------------------------------------------------- filling

def _shifted(a, dy, dx, fill=False):
    """result[i, j] = a[i + dy, j + dx], `fill` outside."""
    H, W = a.shape[:2]
    out = np.full_like(a, fill)
    out[max(0, -dy):H - max(0, dy), max(0, -dx):W - max(0, dx)] = a[max(0, dy):H - max(0, -dy), max(0, dx):W - max(0, -dx)]
    return out


def fill(height, normal, covered, opaque, radius):
    """Every opaque pixel the proxy does not cover takes the height and normal of the nearest covered pixel within `radius`
    (Euclidean; ties: nearer, then the one above, then the one to the left), else flat (0, 0, 1) at height 0.
    Returns (height, normal, filled mask, flat mask); `covered` pixels and transparent ones are untouched."""
    h, n = height.copy(), normal.copy()
    need = opaque & ~covered
    done = np.zeros_like(opaque)
    offs = sorted(((dy, dx) for dy in range(-radius, radius + 1) for dx in range(-radius, radius + 1)
                   if 0 < dy * dy + dx * dx <= radius * radius), key=lambda o: (o[0] ** 2 + o[1] ** 2, o[0], o[1]))
    for dy, dx in offs:
        take = need & ~done & _shifted(covered, dy, dx)
        if take.any():
            h[take] = _shifted(height, dy, dx, 0)[take]
            n[take] = _shifted(normal, dy, dx, 0)[take]
            done |= take
    flat = need & ~done
    h[flat] = 0
    n[flat] = FLAT_NORMAL
    return h, n, done, flat


# ----------------------------------------------------------------------------------------------------------- result

@dataclass
class ProxyResult:
    name: str
    key: str
    projection: str
    origin: tuple
    placement: tuple
    height: np.ndarray
    normal: np.ndarray                      # (h, w, 4) uint8
    rgba: np.ndarray
    covered: np.ndarray
    filled: np.ndarray
    flat: np.ndarray
    opaque: np.ndarray
    alignment: dict
    counts: dict
    caster: dict
    anchors: dict
    ground: tuple
    piece: object = field(repr=False, default=None)
    recipe_hash: str = ''

    @property
    def ok(self):
        return self.alignment['ok']

    def to_json(self):
        return {'api': API_VERSION, 'key': self.key, 'recipe': self.name, 'recipe_hash': self.recipe_hash,
                'projection': self.projection, 'origin': list(self.origin), 'placement': {'dx': self.placement[0], 'dy': self.placement[1]},
                'sprite_size': [int(self.rgba.shape[1]), int(self.rgba.shape[0])], 'alignment': self.alignment,
                'fill': self.counts, 'caster': self.caster, 'anchors': self.anchors, 'ground': list(self.ground),
                'sha256': {'height': hashlib.sha256(self.height.tobytes()).hexdigest(),
                           'normal': hashlib.sha256(self.normal.tobytes()).hexdigest(),
                           'sprite': hashlib.sha256(self.rgba.tobytes()).hexdigest()},
                'provenance': {'numpy': np.__version__, 'pillow': PIL.__version__, 'python': '%d.%d.%d' % sys.version_info[:3]}}

    def write(self, out_dir, scale=6):
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        paths = []
        for suffix, im in (('.normal', Image.fromarray(self.normal, 'RGBA')), ('.height', Image.fromarray(self.height, 'L'))):
            p = out / f'{self.key}{suffix}.png'
            im.save(p, format='PNG', optimize=False, compress_level=9)
            paths.append(p)
        p = out / f'{self.key}.proxy.json'
        p.write_text(json.dumps(self.to_json(), indent=2, sort_keys=True) + '\n', encoding='utf-8')
        paths.append(p)
        p = out / f'{self.key}.overlay.png'
        self.overlay(scale).save(p, format='PNG')
        paths.append(p)
        return paths

    def overlay(self, scale=6, backdrop=(150, 160, 168)):
        """Four panels at `scale`x: the sprite with the proxy's outline (magenta), the ground rectangle (cyan) and the anchors;
        the sprite tinted by height (blue low, red high); how each opaque pixel was served (green covered, yellow filled
        from a neighbour, red flat); the normal image."""
        H, W = self.opaque.shape
        pad = 4
        PW, PH = (W + 2 * pad) * scale, (H + 2 * pad) * scale

        def canvas(bg):
            return Image.new('RGBA', (PW, PH), bg + (255,))

        def up(a, mode='RGBA'):
            return Image.fromarray(a, mode).resize((W * scale, H * scale), Image.NEAREST)

        solid = np.where(self.opaque[..., None], self.rgba, np.zeros_like(self.rgba))       # the piece, without its painted layers
        p1 = canvas(backdrop)
        p1.alpha_composite(up(solid), (pad * scale, pad * scale))
        d = ImageDraw.Draw(p1, 'RGBA')
        m = self.covered
        for y in range(H):
            for x in range(W):
                if not m[y, x]:
                    continue
                X, Y = (x + pad) * scale, (y + pad) * scale
                for ny, nx, seg in ((y - 1, x, (X, Y, X + scale - 1, Y)), (y + 1, x, (X, Y + scale - 1, X + scale - 1, Y + scale - 1)),
                                    (y, x - 1, (X, Y, X, Y + scale - 1)), (y, x + 1, (X + scale - 1, Y, X + scale - 1, Y + scale - 1))):
                    if not (0 <= ny < H and 0 <= nx < W) or not m[ny, nx]:
                        d.line(seg, fill=(230, 40, 200, 255), width=1)
        sx, sy = self.piece.footprint['tile_px']
        gx0, gy0, gx1, gy1 = self.ground
        ox, oy = self.origin
        d.rectangle([(ox + sx * gx0 + pad) * scale, (oy + sy * gy0 + pad) * scale, (ox + sx * gx1 + pad) * scale, (oy + sy * gy1 + pad) * scale],
                    outline=(0, 220, 220, 255), width=1)
        for i, (name, (ax, ay)) in enumerate(sorted(self.anchors.items())):
            cx, cy = (ax + pad) * scale, (ay + pad) * scale
            col = (255, 40, 60, 255) if name == 'foot' else (255, 220, 0, 255)
            d.line([(cx - 6, cy), (cx + 6, cy)], fill=col, width=2)
            d.line([(cx, cy - 6), (cx, cy + 6)], fill=col, width=2)
        hmax = max(1, int(self.height.max()))
        t = self.height.astype(float) / hmax
        tint = np.zeros((H, W, 4), np.uint8)
        tint[..., 0] = np.clip(255 * (2 * t - 0.2), 0, 255)
        tint[..., 1] = np.clip(255 * (1 - abs(2 * t - 1) * 1.3), 0, 255)
        tint[..., 2] = np.clip(255 * (1.2 - 2 * t), 0, 255)
        tint[..., 3] = np.where(self.opaque, 235, 0)
        p2 = canvas(backdrop)
        p2.alpha_composite(up(tint), (pad * scale, pad * scale))
        serve = np.zeros((H, W, 4), np.uint8)
        serve[self.covered & self.opaque] = (40, 170, 70, 255)
        serve[self.filled] = (240, 210, 40, 255)
        serve[self.flat] = (220, 50, 50, 255)
        p3 = canvas(backdrop)
        p3.alpha_composite(up(serve), (pad * scale, pad * scale))
        p4 = canvas((24, 24, 32))
        p4.alpha_composite(up(self.normal), (pad * scale, pad * scale))
        sheet = Image.new('RGBA', (4 * PW + 3 * 8, PH), (40, 40, 48, 255))
        for i, p in enumerate((p1, p2, p3, p4)):
            sheet.paste(p, (i * (PW + 8), 0))
        return sheet


def _rgba(image):
    return np.asarray(image.convert('RGBA')).copy() if isinstance(image, Image.Image) else np.asarray(image, np.uint8)


def build(proxy, rgba, key=None, projection=None, solid_alpha=SOLID_ALPHA, piece=None):
    """The proxy's height and normal images aligned to the sprite `rgba` (an RGBA array or PIL image)."""
    rgba = _rgba(rgba)
    proj = projection if isinstance(projection, B.Projection) else B.load_projection(projection)
    piece = piece or bake_proxy(proxy, proj)
    H, W = rgba.shape[:2]
    opaque = rgba[..., 3] >= solid_alpha
    pl = place(piece, proxy.origin, (H, W))
    align = alignment(opaque, piece, (pl.dx, pl.dy), proxy.search)
    h, n3, filled, flat = fill(pl.height, pl.normal, pl.covered, opaque, proxy.fill_radius)
    h = np.where(opaque, h, 0).astype(np.uint8)
    normal = np.zeros((H, W, 4), np.uint8)
    normal[..., :3] = np.where(opaque[..., None], n3, np.array(FLAT_NORMAL, np.uint8))
    normal[..., 3] = np.where(opaque, 255, 0)
    served = pl.covered & opaque
    counts = {'opaque_px': int(opaque.sum()), 'covered_px': int(served.sum()), 'filled_px': int(filled.sum()), 'flat_px': int(flat.sum()),
              'fill_radius': proxy.fill_radius,
              'covered_share': round(float(served.sum()) / max(1, opaque.sum()), 4),
              'filled_share': round(float(filled.sum()) / max(1, opaque.sum()), 4),
              'flat_share': round(float(flat.sum()) / max(1, opaque.sum()), 4)}
    ox, oy = proxy.origin
    sx, sy = piece.footprint['tile_px']
    gx0, gy0, gx1, gy1 = proxy.ground
    opaque_rows = np.nonzero(opaque.any(1))[0]
    hs = h[opaque]
    caster = {'height_px': int(hs.max()) if hs.size else 0,
              'height_p95_px': int(np.percentile(hs, 95)) if hs.size else 0,
              'foot_row': int(math.ceil(oy + sy * gy1 - 1e-9)) - 1,
              'foot_span': [int(math.floor(ox + sx * gx0 + 1e-9)), int(math.ceil(ox + sx * gx1 - 1e-9)) - 1],
              'sprite_foot_row': int(opaque_rows.max()) if opaque_rows.size else None}
    anchors = {k: [round(v[0] + pl.dx, 2), round(v[1] + pl.dy, 2)] for k, v in sorted(piece.anchors.items())}
    return ProxyResult(proxy.name, key or proxy.name, proj.name, proxy.origin, (pl.dx, pl.dy), h, normal, rgba, pl.covered, filled, flat,
                       opaque, align, counts, caster, anchors, proxy.ground, piece, V.recipe_hash(proxy.recipe))


# -------------------------------------------------------------------------------------------------------- shadows

KEY_DIRECTIONS = {'lower-left': (-math.sqrt(0.5), math.sqrt(0.5)), 'lower-right': (math.sqrt(0.5), math.sqrt(0.5)),
                  'down': (0.0, 1.0)}          # play/.../keyLight.ts KEY_DIRECTIONS, unit vectors (x right, y down)
SHADOW_FLOOR_PX, SHADOW_CAP_PX = 3, 22         # play/.../shadeBake.ts: the shipped shadow is kept between these lengths


def sweep_shadow(height, opaque, direction, length, shape=None, origin=(0, 0), supersample=4):
    """The shadow a piece throws on the floor, from its HEIGHT image. A pixel `h` px above the floor at canvas (x, y) hangs over the
    floor point (x, y + h) (height is drawn straight up); light along `direction` (unit vector, x right, y down) lays its shadow
    `length * h` px further, at (x + dx * length * h, y + h + dy * length * h). Only the surface casts: the floor under a leaf stays
    lit. Each opaque pixel lands as a one-pixel square at its tip, and neighbouring opaque pixels are joined (a line, and a filled
    quad for every fully opaque 2 x 2 block), so a continuous surface casts a continuous shadow. Returns the coverage (float,
    0..1) on a floor of `shape` (default the canvas) with the canvas's top-left at `origin` on it."""
    H, W = opaque.shape
    gh, gw = shape or (H, W)
    S = int(supersample)
    h = height.astype(float)
    yy, xx = np.mgrid[0:H, 0:W]
    dx, dy = direction
    TX = (xx + 0.5 + length * h * dx + origin[0]) * S
    TY = (yy + 0.5 + h + length * h * dy + origin[1]) * S
    img = Image.new('L', (gw * S, gh * S), 0)
    d = ImageDraw.Draw(img)
    half = S / 2.0
    for y, x in zip(*np.nonzero(opaque)):
        px, py = TX[y, x], TY[y, x]
        d.rectangle([px - half, py - half, px + half, py + half], fill=255)
        if x + 1 < W and opaque[y, x + 1]:
            d.line([(px, py), (TX[y, x + 1], TY[y, x + 1])], fill=255, width=S)
        if y + 1 < H and opaque[y + 1, x]:
            d.line([(px, py), (TX[y + 1, x], TY[y + 1, x])], fill=255, width=S)
        if x + 1 < W and y + 1 < H and opaque[y, x + 1] and opaque[y + 1, x] and opaque[y + 1, x + 1]:
            d.polygon([(px, py), (TX[y, x + 1], TY[y, x + 1]), (TX[y + 1, x + 1], TY[y + 1, x + 1]), (TX[y + 1, x], TY[y + 1, x])], fill=255)
    a = np.asarray(img, float) / 255.0
    return a.reshape(gh, S, gw, S).mean((1, 3))


def rows_shadow(opaque, direction, length, shape=None, origin=(0, 0), cap=True, close_gaps=3):
    """TODAY's method (play/.../shadeBake.ts keyOnFloor + shadeShapes.ts shearRuns), for comparison: the silhouette's rows are the
    height. Row r of a piece whose foot is row F is Z = F - r px above the foot and lands round(dx * m * length * Z) right and
    round(dy * m * length * Z) down from the FOOT row. m keeps the shadow between SHADOW_FLOOR_PX and SHADOW_CAP_PX long
    (cap=True, as shipped); cap=False uses m = 1 (the same length rule as sweep_shadow). Gaps of `close_gaps` px or less inside a
    row are closed first (castShape's closeGaps); its thin-run filter is not reproduced. Returns a bool mask on a floor of `shape`."""
    H, W = opaque.shape
    gh, gw = shape or (H, W)
    out = np.zeros((gh, gw), bool)
    rows = np.nonzero(opaque.any(1))[0]
    if not rows.size:
        return out
    top, foot = int(rows[0]), int(rows[-1])
    height = foot - top + 1
    sx, sy = direction[0] * length, direction[1] * length
    natural = max(1, height) * length
    m = min(max(1.0, SHADOW_FLOOR_PX / natural), SHADOW_CAP_PX / natural) if cap else 1.0
    q = max(1, int(math.ceil(max(abs(sx * m), abs(sy * m), 1.0))))
    for r in range(top, foot + 1):
        cols = np.nonzero(opaque[r])[0]
        if not cols.size:
            continue
        row = np.zeros(W, bool)
        row[cols] = True
        if close_gaps:
            gaps = np.nonzero(np.diff(cols) > 1)[0]
            for g in gaps:
                if cols[g + 1] - cols[g] - 1 <= close_gaps:
                    row[cols[g]:cols[g + 1] + 1] = True
        z = foot - r
        for j in range(q):
            zj = z - j / q
            if zj < 0:
                break
            ox, oy = int(round(sx * m * zj)), int(round(sy * m * zj))
            y = foot + oy + origin[1]
            if not 0 <= y < gh:
                continue
            xs = np.nonzero(row)[0] + ox + origin[0]
            xs = xs[(xs >= 0) & (xs < gw)]
            out[y, xs] = True
    return out


# ------------------------------------------------------------------------------------------------------------- CLI

def _registry():
    if str(SOURCE / 'hq-office') not in sys.path:
        sys.path.insert(0, str(SOURCE / 'hq-office'))
    from props import proxies
    return proxies


def main(argv=None):
    ap = argparse.ArgumentParser(description='Bake a proxy volume over a hand-drawn sprite: height, normal, facts, overlay.')
    ap.add_argument('recipe', nargs='?', help='a proxy recipe name (--list)')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--sprite', help='the sprite PNG')
    ap.add_argument('--dist', help='a built dist: every key the recipe declares is read from DIST/entities/<key>')
    ap.add_argument('--out', help='the output directory (never a served one)')
    ap.add_argument('--key', help='the output name (default: the sprite file name)')
    ap.add_argument('--scale', type=int, default=6)
    ap.add_argument('--projection', default=None)
    a = ap.parse_args(argv)
    reg = _registry()
    if a.list:
        for n in reg.names():
            print(n, ' '.join(reg.get(n).keys))
        for m, e in reg.errors().items():
            print(f'ERROR {m}: {e}', file=sys.stderr)
        return 0
    if not a.recipe or not a.out or not (a.sprite or a.dist):
        ap.error('RECIPE, --out and one of --sprite or --dist are required')
    proxy = reg.get(a.recipe)
    jobs = []
    if a.sprite:
        jobs.append((a.key or Path(a.sprite).stem, Path(a.sprite)))
    else:
        for k in proxy.keys:
            jobs.append((a.key or Path(k).stem, Path(a.dist) / 'entities' / k))
    piece, bad = None, 0
    for key, path in jobs:
        piece = piece or bake_proxy(proxy, a.projection)
        res = build(proxy, Image.open(path), key, a.projection, piece=piece)
        res.write(a.out, a.scale)
        al = res.alignment
        print(f'{key}: covered {al["covered_share"]:.1%} stray {al["stray_share"]:.1%} iou {al["iou"]:.3f} best offset {al["best_offset"]} '
              f'{"OK" if res.ok else "FAIL"}  filled {res.counts["filled_px"]} flat {res.counts["flat_px"]} height {res.caster["height_px"]} px')
        bad += not res.ok
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
