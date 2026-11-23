"""The acceptance board of the volume prototype (plan section 11) as a reusable tool: today's sprite against the baked piece in
every projection, the lounge scene with a Woka for scale, the cast shadow each piece would throw, and the measurements of the
plan that can be taken without running the game. Reads a finished build and a floor picture, writes only into --out.
numpy and Pillow only. Run python3 -I.

    python3 -I pieceboard.py <piece> [<piece> ...] --dist DIST --floor PICTURE --out DIR
        [--view X,Y,W,H] [--projections oblique,camera75] [--map FILE.json] [--no-overrides] [--strict]
    python3 -I pieceboard.py --list

<piece> is a name of the CATALOGUE below (stool, arc-lamp, potted-plant, air-hockey; case, '-' and '_' do not matter), a
registry name of hq-office/props (for a piece with no catalogue entry: no "today" picture, no placements) or a path to a .py
file exposing RECIPE. --map FILE.json adds or replaces catalogue entries:
    {"name": {"recipe": "<registry name or .py path>", "prefabs": ["<prefab id in DIST/office.wam's collections>", ...],
              "plan": {<expectations of plan section 11, see PLAN_KEYS>}}}
the first prefab is "today's sprite" and the one whose foot the new picture is aligned to, all of them are looked up in
office.wam for the placements. Two plan numbers are per projection and come from projection.json, never from the plan:
"rim_ratio" in a plan is the TOLERANCE only (the expected ratio is that projection's expect.rim_ratio: 1.0 in oblique, where a
ground circle is a circle, 0.75 in camera75) and "canvas_max" is the plan's picture size for the reference projection, widened
here by the transparent margin and by expect.canvas_extra_rows_per_tile per tile of footprint depth.

Files written into --out
    board.png          one row per piece at 4x nearest neighbour on a mid-grey checker with the tile grid of the footprint:
                       today's sprite, the baked piece in each projection, its normal map and its height map (the first
                       projection), each labelled; every picture of a row is aligned on its foot point
    scene-<proj>.png   the lounge region of the --floor picture at 1:1 and again at 3x. Today's pieces are NOT painted out (a
                       floor under them would be guesswork). Where today's piece is still visible under or beside the new one
                       at its real placement, the new piece is drawn on a clean floor strip below the picture, directly beside
                       a copy of today's piece on the same foot line, and the real placement is only outlined in magenta.
                       Only when the new piece covers today's one completely is it drawn in place. A 26 x 32 Woka stand-in
                       stands at the end of every strip row for scale.
    shadows.png        the cast shadow of each piece, swept from its HEIGHT image, beside the same sweep made the old way
    measurements.json  every measurement of plan section 11 that can be taken now, each with pass or fail and its method

Conventions
    Picture to map: the view is (X, Y, W, H) in map px; the --floor picture is W * k wide (k a whole number, 2 for the
    lighting lab's zoom 2) and is reduced to 1:1 by nearest neighbour (checked: every k x k block is one colour, else a warning).
    Placement: wam entities carry the top-left of their sprite in map px, so the new top-left is today's top-left plus
    (today's foot - the baked foot), the same dx, dy as bake.Piece.shift. Today's foot: the bottom of the SOLID pixels
    (alpha 128 or more; painted shadows are translucent), x the middle of the solid pixels of the lowest 15% of the rows.
    Floor strip: the floor is a periodic wood pattern. The tool classifies the picture's pixels (not under an entity sprite,
    close to the most common such colour) and takes the repeat (a multiple of 16 px in x and y) that explains them best, then
    fills the strip from it, so the strip continues the real floor without copying any object.
    Cast shadow: a pixel of height h px lying on the ground row g throws its shadow along one fixed direction, lower right
    (1, 1) / sqrt 2, 0.6 px long per px of height, from its ground point (x, g) to (x + 0.42 h, g + 0.42 h); the sweep is the union
    of those segments, closed once with a 3 x 3 closing, flat 25% dark. For a baked piece the height is the HEIGHT image and
    g = row + h (a point of the surface projects h rows above its ground point, that is what the baker's projection is);
    the old way treats today's silhouette as height: h = rows above the foot, g = the foot row.
"""
import argparse
import hashlib
import json
import math
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bake as B  # noqa: E402

API_VERSION = 1
BOARD_SCALE = 4
SCENE_SCALE = 3
SHADOW_SCALE = 3
DEFAULT_VIEW = (2175, 1065, 480, 270)       # the lounge picture of the lighting lab (zoom 2, camera 2415, 1200)
SHADOW_DIR = (math.sqrt(0.5), math.sqrt(0.5))
SHADOW_K = 0.6
SHADOW_ALPHA = 64                            # 25% of 255
SOLID_ALPHA = 128
FOOT_BAND = 0.15
NORMAL_TOLERANCE = 0.0136                    # verify.py office.normals
MAGENTA = (255, 0, 200)
GRID = (2, 168, 166, 170)
WOKA_SIZE = (26, 32)

PLAN_KEYS = ('colour_cap', 'height_px', 'height_max_px', 'feet_rows_min', 'no_pool', 'rim_ratio', 'margin_min', 'canvas_max',
             'footprint_tiles')

# What plan section 11 says of each of the four pieces, and where today's picture is placed in the office.
CATALOGUE = {
    'stool': {'recipe': 'stool', 'prefabs': ['konclui-konclui-banqueta-turquesa'],
              'plan': {'colour_cap': 24, 'height_px': [16, 1], 'feet_rows_min': 9}},
    'arc-lamp': {'recipe': 'arc-lamp-left', 'prefabs': ['konclui-konclui-lumin-ria-de-arco-preto'],
                 'plan': {'colour_cap': 12, 'height_px': [44, 1], 'no_pool': True}},
    'potted-plant': {'recipe': 'potted_plant',
                     'prefabs': ['konclui-konclui-planta-ave-do-paraiso-alta', 'konclui-konclui-planta-ave-do-paraiso-branco'],
                     'plan': {'colour_cap': 24, 'height_max_px': 56, 'rim_ratio': 0.03, 'margin_min': 2}},
    'air-hockey': {'recipe': 'air_hockey', 'prefabs': ['konclui-konclui-air-hockey-navy'],
                   'plan': {'colour_cap': 20, 'canvas_max': [64, 48], 'footprint_tiles': [2, 1], 'height_px': [17, 1]}},
}
PLAN_BASELINE_CANVAS_PX = 22848               # plan section 11: today's four canvases (2048 + 10560 + 6144 + 4096)


def canon(name):
    return str(name).strip().lower().replace('_', '-')


# ------------------------------------------------------------------------------------------------------- small helpers

def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def text(draw, xy, s, fill=(255, 255, 255), size=12, outline=(0, 0, 0)):
    f = font(size)
    try:
        draw.text(xy, s, fill=fill, font=f, stroke_width=1 if outline else 0, stroke_fill=outline)
    except Exception:
        draw.text(xy, s, fill=fill, font=f)


def rnd(v):
    return int(math.floor(v + 0.5))


def sha256_of(*arrays):
    h = hashlib.sha256()
    for a in arrays:
        a = np.ascontiguousarray(a)
        h.update(str(a.shape).encode())
        h.update(a.tobytes())
    return h.hexdigest()


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def shifted(a, dy, dx, fill=False):
    """result[i, j] = a[i + dy, j + dx], `fill` outside."""
    H, W = a.shape[:2]
    out = np.full_like(a, fill)
    out[max(0, -dy):H - max(0, dy), max(0, -dx):W - max(0, dx)] = a[max(0, dy):H - max(0, -dy), max(0, dx):W - max(0, -dx)]
    return out


def boundary(mask):
    """Pixels of the mask with a 4-neighbour outside it (the image edge counts as outside)."""
    inner = mask.copy()
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        inner &= shifted(mask, dy, dx, False)
    return mask & ~inner


def closing(mask):
    d = mask.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            d |= shifted(mask, dy, dx, False)
    e = d.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            e &= shifted(d, dy, dx, False)
    return e


def components(mask):
    """Number of 8-connected components of a boolean mask."""
    todo = set(map(tuple, np.argwhere(mask)))
    n = 0
    while todo:
        n += 1
        q = deque([todo.pop()])
        while q:
            y, x = q.popleft()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    p = (y + dy, x + dx)
                    if p in todo:
                        todo.remove(p)
                        q.append(p)
    return n


def to_image(rgba):
    return Image.fromarray(np.ascontiguousarray(rgba), 'RGBA')


def upscale(rgba, k):
    h, w = rgba.shape[:2]
    return to_image(rgba).resize((w * k, h * k), Image.NEAREST)


# ------------------------------------------------------------------------------------------------------- today's sprite

class Old:
    """Today's picture of a piece: the file, its pixels, its foot point and the measurements the audit also took."""
    def __init__(self, prefab, path, rgba, foot=None):
        self.prefab, self.path, self.rgba = prefab, Path(path), rgba
        self.foot = tuple(foot) if foot else measure_foot(rgba)

    @property
    def size(self):
        return (self.rgba.shape[1], self.rgba.shape[0])

    @property
    def solid(self):
        return self.rgba[..., 3] >= SOLID_ALPHA


def measure_foot(rgba):
    """(x, y): y the first row below the solid pixels, x the middle of the solid pixels of the lowest 15% of their rows."""
    solid = rgba[..., 3] >= SOLID_ALPHA
    rows = np.nonzero(solid.any(1))[0]
    y0, y1 = int(rows.min()), int(rows.max()) + 1
    band = max(1, int(FOOT_BAND * (y1 - y0)))
    cols = np.nonzero(solid[y1 - band:y1].any(0))[0]
    return ((int(cols.min()) + int(cols.max()) + 1) // 2, y1)


def old_metrics(old):
    rgba = old.rgba
    a = rgba[..., 3]
    solid = old.solid
    rows = np.nonzero(solid.any(1))[0]
    cols = np.nonzero(solid.any(0))[0]
    bnd = boundary(solid)
    colours = [tuple(p) for p in rgba[solid][:, :3]]
    ink = max(set(map(tuple, rgba[bnd][:, :3])), key=lambda c: (list(map(tuple, rgba[bnd][:, :3])).count(c), c)) if bnd.any() else None
    share = float((rgba[bnd][:, :3] == np.array(ink)).all(1).sum() / bnd.sum()) if ink is not None else 0.0
    return {'size': list(old.size), 'canvas_px': int(old.size[0] * old.size[1]), 'solid_px': int(solid.sum()),
            'semi_px': int(((a > 0) & (a < 255)).sum()), 'alpha_levels': int(len(np.unique(a))),
            'colours_solid': len(set(colours)), 'height_px': int(rows.max() - rows.min() + 1),
            'width_px': int(cols.max() - cols.min() + 1), 'foot': list(old.foot),
            'foot_gap': int(old.size[1] - (int(rows.max()) + 1)),
            'outline_share': round(share, 4),
            'outline_method': 'share of the solid silhouette boundary in its most common boundary colour (the audit\'s outline_share)'}


# --------------------------------------------------------------------------------------------------------------- the build

class Dist:
    """What the tool reads of a finished build: office.wam (placements) and the entity collections (prefab id -> sprite)."""
    def __init__(self, root):
        self.root = Path(root)
        wam = self.root / 'office.wam'
        self.entities = []
        self.prefabs = {}
        if wam.is_file():
            data = json.loads(wam.read_text(encoding='utf-8'))
            self.entities = [(e['prefabRef']['id'], int(e['x']), int(e['y'])) for e in data.get('entities', {}).values()]
            for coll in data.get('entityCollections', []):
                url = Path(coll['url'])
                f = self.root / url
                if not f.is_file():
                    continue
                for item in json.loads(f.read_text(encoding='utf-8')).get('collection', []):
                    self.prefabs[item['id']] = self.root / url.parent / item['imagePath']

    def sprite(self, prefab):
        p = self.prefabs.get(prefab)
        if p is None or not p.is_file():
            return None
        return np.array(Image.open(p).convert('RGBA'))

    def placements(self, prefab):
        return [(x, y) for pid, x, y in self.entities if pid == prefab]


# --------------------------------------------------------------------------------------------------------- floor picture

def parse_view(s):
    v = tuple(int(float(t)) for t in str(s).split(','))
    if len(v) != 4 or v[2] <= 0 or v[3] <= 0:
        raise ValueError(f'--view is X,Y,W,H in map px, got {s!r}')
    return v


def load_view(path, view, warnings):
    """The picture reduced to 1:1 map px: (h, w, 3) uint8."""
    im = np.array(Image.open(path).convert('RGB'))
    H, W = im.shape[:2]
    k = W / view[2]
    if k != int(k) or k < 1 or H != view[3] * int(k):
        raise ValueError(f'{path}: {W}x{H} px is not a whole multiple of the view {view[2]}x{view[3]}')
    k = int(k)
    if k > 1:
        blocks = im.reshape(view[3], k, view[2], k, 3)
        if not (blocks == blocks[:, :1, :, :1]).all():
            warnings.append(f'{Path(path).name} is not a pure {k}x enlargement; sampling the first pixel of every block')
        im = im[::k, ::k]
    return im


def entity_mask(dist, view, sprites_cache=None):
    """Boolean (h, w): the view's pixels under any placed entity sprite (alpha above 0)."""
    x0, y0, w, h = view
    occ = np.zeros((h, w), bool)
    cache = {} if sprites_cache is None else sprites_cache
    for pid, ex, ey in dist.entities:
        if pid not in cache:
            cache[pid] = dist.sprite(pid)
        s = cache[pid]
        if s is None:
            continue
        sh, sw = s.shape[:2]
        cx, cy = ex - x0, ey - y0
        if cx >= w or cy >= h or cx + sw <= 0 or cy + sh <= 0:
            continue
        xs, ys = slice(max(0, cx), min(w, cx + sw)), slice(max(0, cy), min(h, cy + sh))
        occ[ys, xs] |= s[ys.start - cy:ys.stop - cy, xs.start - cx:xs.stop - cx, 3] > 0
    return occ


class Floor:
    """The floor of the picture as a periodic pattern. `fill(x, y, w, h)` returns the floor over any map-px region, world
    coordinates (view origin + offsets), so a strip below the picture continues the floor the picture shows."""
    PERIODS = (8, 16, 24, 32, 48, 64, 96, 128)
    TOLERANCE = 40
    MIN_SKILL = 0.5

    def __init__(self, picture, view, occupied):
        self.view = view
        free = ~occupied
        colours, counts = np.unique(picture[free].reshape(-1, 3), axis=0, return_counts=True) if free.any() else (None, None)
        self.mode = np.array([128, 128, 128], np.uint8) if colours is None else colours[np.argmax(counts)].astype(np.uint8)
        wood = free & (np.abs(picture.astype(int) - self.mode.astype(int)).max(-1) <= self.TOLERANCE)
        self.wood = wood
        self.period = None
        self.tile = None
        ys, xs = np.nonzero(wood)
        if len(xs) < 64:
            return
        code = (picture[ys, xs, 0].astype(np.int64) << 16) | (picture[ys, xs, 1].astype(np.int64) << 8) | picture[ys, xs, 2]
        uniq, inv = np.unique(code, return_inverse=True)
        if len(uniq) < 2:
            return
        base = np.bincount(inv).max() / len(inv)
        wx, wy = xs + view[0], ys + view[1]
        scored = []
        for py in self.PERIODS:
            for px in self.PERIODS:
                res = (wy % py) * px + (wx % px)
                key = res.astype(np.int64) * len(uniq) + inv
                k, cnt = np.unique(key, return_counts=True)
                best = {}
                for kk, c in zip(k, cnt):
                    r = kk // len(uniq)
                    if c > best.get(r, (0, 0))[0]:
                        best[r] = (int(c), int(kk % len(uniq)))
                skill = (sum(c for c, _ in best.values()) / len(inv) - base) / max(1 - base, 1e-9)
                scored.append((skill, px, py, best))
        top = max(s[0] for s in scored)
        if top < self.MIN_SKILL:
            return
        # a longer period explains more by overfitting (fewer samples per residue): take the smallest within 3% of the best
        skill, px, py, best = min((s for s in scored if s[0] >= top - 0.03), key=lambda s: (s[1] * s[2], max(s[1], s[2]), s[1]))
        tile = np.tile(self.mode, (py, px, 1))
        for r, (_, ci) in best.items():
            c = int(uniq[ci])
            tile[r // px, r % px] = ((c >> 16) & 255, (c >> 8) & 255, c & 255)
        self.period, self.tile, self.skill = (px, py), tile, float(skill)

    def fill(self, x, y, w, h):
        """(h, w, 3) uint8 floor over the region whose top-left is (x, y) relative to the view origin."""
        if self.tile is None:
            return np.tile(self.mode, (h, w, 1))
        px, py = self.period
        ii = (np.arange(h) + y + self.view[1]) % py
        jj = (np.arange(w) + x + self.view[0]) % px
        return self.tile[ii[:, None], jj[None, :]]

    def describe(self):
        return {'mode': [int(c) for c in self.mode], 'period': list(self.period) if self.period else None,
                'skill': round(self.skill, 3) if self.period else None, 'wood_px': int(self.wood.sum())}


# --------------------------------------------------------------------------------------------------------------- the Woka

def woka_standin(frame=WOKA_SIZE):
    """A chibi stand-in drawn in a 26 x 32 frame (the Woka frame), for scale only: it is NOT the game's sprite. Hair, skin,
    a shirt, trousers, a 1 px ink outline; the last row is the sole of the feet, so the frame's bottom is the foot line."""
    w, h = frame
    ink, skin, hair, shirt, pants = (26, 28, 46), (238, 198, 150), (92, 62, 44), (214, 84, 72), (52, 62, 110)
    fill = np.zeros((h, w, 3), np.uint8)
    on = np.zeros((h, w), bool)

    def rect(r0, r1, c0, c1, col):
        fill[r0:r1, c0:c1] = col
        on[r0:r1, c0:c1] = True

    rect(4, 17, 6, 20, skin)                        # head 14 x 13
    rect(4, 8, 6, 20, hair)
    rect(8, 12, 6, 8, hair)
    rect(8, 12, 18, 20, hair)
    for r, c in ((4, 6), (4, 19), (16, 6), (16, 19)):  # rounded corners
        on[r, c] = False
    rect(17, 26, 8, 18, shirt)                      # body 10 x 9
    rect(18, 25, 6, 8, shirt)
    rect(18, 25, 18, 20, shirt)
    rect(25, 26, 6, 8, skin)
    rect(25, 26, 18, 20, skin)
    rect(26, 31, 9, 12, pants)
    rect(26, 31, 14, 17, pants)
    rect(31, 32, 8, 12, ink)
    rect(31, 32, 14, 18, ink)
    on[31, 8:12] = on[31, 14:18] = True
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = fill
    out[..., 3] = np.where(on, 255, 0)
    edge = boundary(on)
    out[edge, :3] = ink
    out[11, 9:11, :3] = ink                         # eyes
    out[11, 15:17, :3] = ink
    out[11:13, 9, :3] = ink
    out[11:13, 16, :3] = ink
    return out


# ---------------------------------------------------------------------------------------------------------- piece entries

class Entry:
    """One requested piece: its catalogue entry, the baked pieces and today's sprites."""
    def __init__(self, name, spec, recipe, dist, projections, overrides, overrides_dir=None):
        self.name, self.spec, self.recipe = name, spec, recipe
        self.plan = dict(spec.get('plan') or {})
        self.prefabs = list(spec.get('prefabs') or [])
        self.olds = []
        self.notes = []
        for pid in self.prefabs:
            s = dist.sprite(pid) if dist else None
            if s is None:
                self.notes.append(f'prefab {pid} not found in the build: no picture of today for it')
                continue
            foot = spec.get('old_foot')
            self.olds.append(Old(pid, dist.prefabs[pid], s, foot if (foot and not self.olds) else None))
        self.placements = {o.prefab: dist.placements(o.prefab) for o in self.olds} if dist else {}
        self.old = self.olds[0] if self.olds else None
        self.overrides, self.overrides_dir = overrides, overrides_dir
        self.pieces = {}
        for p in projections:
            kw = {}
            if self.old is not None:
                kw = {'old_canvas': self.old.size, 'old_foot': self.old.foot}
            self.pieces[p] = B.bake(recipe, p, overrides=overrides, overrides_dir=overrides_dir, **kw)

    def shift_for(self, old, projection):
        """The top-left of the new picture minus today's top-left, for the placement of `old` (same as bake.Piece.shift)."""
        piece = self.pieces[projection]
        return (rnd(old.foot[0] - piece.foot[0]), rnd(old.foot[1] - piece.foot[1]))


def load_map(path):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    out = {}
    for k, v in data.items():
        bad = set(v.get('plan') or {}) - set(PLAN_KEYS)
        if bad:
            raise ValueError(f'{path}: {k}: unknown plan keys {sorted(bad)}; known: {list(PLAN_KEYS)}')
        if 'rim_ratio' in (v.get('plan') or {}):
            plan_tolerance(v['plan']['rim_ratio'])
        out[canon(k)] = v
    return out


def make_entries(pieces, dist, projections, catalogue, overrides=True, overrides_dir=None):
    entries = []
    for name in pieces:
        key = canon(name)
        spec = catalogue.get(key)
        if spec is None:
            if name.endswith('.py') or '/' in name:
                spec = {'recipe': name}
                key = Path(name).stem
            else:
                try:
                    B.resolve(name)
                except SystemExit:
                    raise SystemExit(f'no piece named {name!r}; catalogue: {sorted(catalogue)}; or a registry name, or a .py path')
                spec = {'recipe': name}
        recipe = B.resolve(spec['recipe'])
        entries.append(Entry(key, spec, recipe, dist, projections, overrides, overrides_dir))
    return entries


# ----------------------------------------------------------------------------------------------------------------- board

def checker(w, h, cell):
    yy, xx = np.mgrid[0:h, 0:w]
    on = ((yy // cell) + (xx // cell)) % 2 == 0
    out = np.empty((h, w, 4), np.uint8)
    out[...] = (134, 134, 134, 255)
    out[on] = (122, 122, 122, 255)
    return out


def height_picture(piece):
    """The height image as grey RGBA (white = the piece's highest point) and that highest point in px."""
    hm = piece.height.astype(float)
    top = max(float(hm.max()), 1.0)
    g = np.clip(np.floor(hm / top * 255 + 0.5), 0, 255).astype(np.uint8)
    out = np.stack([g, g, g, piece.rgba[..., 3]], -1)
    return out, int(top)


def board_cells(entry, projections):
    """The five pictures of a row as (label, rgba, foot, tile_px) in order: today, each projection, normal, height."""
    cells = []
    first = entry.pieces[projections[0]]
    fw, fd = first.footprint['tiles']
    if entry.old is not None:
        cells.append((f'today {entry.old.size[0]}x{entry.old.size[1]}', entry.old.rgba, entry.old.foot, (32.0, 32.0)))
    for p in projections:
        pc = entry.pieces[p]
        cells.append((f'new {p} {pc.size[0]}x{pc.size[1]}', pc.rgba, pc.foot, pc.footprint['tile_px']))
    hp, top = height_picture(first)
    cells.append((f'normal {projections[0]}', first.normal, first.foot, first.footprint['tile_px']))
    cells.append((f'height {projections[0]} (white = {top} px)', hp, first.foot, first.footprint['tile_px']))
    return cells, (fw, fd)


def row_geometry(cells, pad=3):
    """Cell size and foot position (logical px), the same for every picture of a row so the feet line up."""
    lefts = [rnd(c[2][0]) for c in cells]
    rights = [c[1].shape[1] - rnd(c[2][0]) for c in cells]
    ups = [rnd(c[2][1]) for c in cells]
    downs = [c[1].shape[0] - rnd(c[2][1]) for c in cells]
    cw = max(lefts) + max(rights) + 2 * pad
    ch = max(ups) + max(downs) + 2 * pad
    return cw, ch, (pad + max(lefts), pad + max(ups))


def draw_cell(rgba, foot, tile, tiles, cw, ch, fcell, scale=BOARD_SCALE):
    img = to_image(checker(cw * scale, ch * scale, 4 * scale))
    fx, fy = rnd(foot[0]), rnd(foot[1])
    img.alpha_composite(upscale(rgba, scale), ((fcell[0] - fx) * scale, (fcell[1] - fy) * scale))
    d = ImageDraw.Draw(img, 'RGBA')
    fw, fd = tiles
    tx, ty = tile
    x0 = fcell[0] - fw * tx / 2
    x1 = fcell[0] + fw * tx / 2
    y1 = fcell[1]
    y0 = fcell[1] - fd * ty
    for i in range(int(round(fw)) + 1):
        d.line([(x0 * scale + i * tx * scale, y0 * scale), (x0 * scale + i * tx * scale, y1 * scale)], fill=GRID, width=1)
    for j in range(int(round(fd)) + 1):
        d.line([(x0 * scale, y1 * scale - j * ty * scale), (x1 * scale, y1 * scale - j * ty * scale)], fill=GRID, width=1)
    d.line([(fcell[0] * scale - 6, fcell[1] * scale), (fcell[0] * scale + 6, fcell[1] * scale)], fill=(214, 40, 70, 255), width=2)
    d.line([(fcell[0] * scale, fcell[1] * scale - 6), (fcell[0] * scale, fcell[1] * scale + 6)], fill=(214, 40, 70, 255), width=2)
    return img


def board_layout(entries, projections, scale=BOARD_SCALE):
    """Rows of the board: [{entry, y, cells: [{label, x, y, w, h, foot_px}]}] and the board size. Used by make_board and the tests."""
    gap, head, lab = 10, 24, 18
    rows, y, width = [], 8, 0
    for e in entries:
        cells, tiles = board_cells(e, projections)
        cw, ch, fcell = row_geometry(cells)
        x = 8
        row = {'entry': e.name, 'title_y': y, 'cells': [], 'tiles': tiles, 'geometry': (cw, ch, fcell)}
        cy = y + head + lab
        for label, rgba, foot, tile in cells:
            row['cells'].append({'label': label, 'x': x, 'y': cy, 'w': cw * scale, 'h': ch * scale, 'rgba': rgba, 'foot': foot,
                                 'tile': tile})
            x += cw * scale + gap
        rows.append(row)
        width = max(width, x)
        y = cy + ch * scale + 14
    return rows, (width, y)


def make_board(entries, projections):
    rows, (W, H) = board_layout(entries, projections)
    img = Image.new('RGBA', (W, H), (36, 38, 46, 255))
    d = ImageDraw.Draw(img, 'RGBA')
    for row, e in zip(rows, entries):
        cw, ch, fcell = row['geometry']
        old = e.old
        head = e.name
        if old is not None:
            head += f'   today {old.size[0]}x{old.size[1]} = {old.size[0] * old.size[1]} px'
        head += '   ' + '   '.join(f'{p} {e.pieces[p].size[0]}x{e.pieces[p].size[1]} = {e.pieces[p].size[0] * e.pieces[p].size[1]} px'
                                   for p in projections)
        text(d, (8, row['title_y'] + 2), head, size=14)
        for c in row['cells']:
            cell = draw_cell(c['rgba'], c['foot'], c['tile'], row['tiles'], cw, ch, fcell)
            img.paste(cell, (c['x'], c['y']))
            text(d, (c['x'], c['y'] - 16), c['label'], size=12)
    return img.convert('RGB'), rows


# ------------------------------------------------------------------------------------------------------------ cast shadow

def sweep_shadow(solid, ground_row, height, pad=3, k=SHADOW_K, direction=SHADOW_DIR):
    """The union of the segments from every solid pixel's ground point to its shadow tip, closed once.
    Returns (mask, (ox, oy)): the mask is on a canvas the sprite's size plus a pad; (ox, oy) is where the sprite's (0, 0) is in it."""
    H, W = solid.shape
    ys, xs = np.nonzero(solid)
    hh = height[ys, xs].astype(float)
    gy = ground_row[ys, xs].astype(float)
    length = k * hh
    reach_x = int(math.ceil(length.max() * direction[0])) + 1 if len(hh) else 1
    reach_y = int(math.ceil(max(0.0, (gy + length * direction[1]).max() - H))) + 1 if len(hh) else 1
    ox = oy = pad
    mask = np.zeros((H + 2 * pad + reach_y, W + 2 * pad + reach_x), bool)
    steps = np.maximum(np.ceil(length / 0.5).astype(int), 1) + 1
    idx = np.repeat(np.arange(len(hh)), steps)
    start = np.cumsum(steps) - steps
    t = (np.arange(len(idx)) - start[idx]) / (steps[idx] - 1)
    px = xs[idx] + 0.5 + t * length[idx] * direction[0]
    py = gy[idx] + 0.5 + t * length[idx] * direction[1]
    ix = np.floor(px).astype(int) + ox
    iy = np.floor(py).astype(int) + oy
    keep = (ix >= 0) & (ix < mask.shape[1]) & (iy >= 0) & (iy < mask.shape[0])
    mask[iy[keep], ix[keep]] = True
    return closing(mask), (ox, oy)


def shadow_of_piece(piece):
    """The sweep of a baked piece, from its height image: g = row + height."""
    a = piece.rgba[..., 3] > 0
    rows = np.arange(a.shape[0])[:, None] + piece.height.astype(float)
    return sweep_shadow(a, rows, piece.height)


def shadow_of_old(old):
    """The old way: today's silhouette is the height, h = rows above the foot, g = the foot row."""
    solid = old.solid
    rows = np.arange(solid.shape[0])[:, None] + np.zeros(solid.shape)
    h = np.clip(old.foot[1] - rows, 0, None)
    ground = np.full(solid.shape, float(old.foot[1]))
    return sweep_shadow(solid & (h > 0), ground, h)


def shadow_stats(mask, origin, foot):
    ys, xs = np.nonzero(mask)
    fx, fy = foot[0] + origin[0], foot[1] + origin[1]
    d = np.hypot(xs + 0.5 - fx, ys + 0.5 - fy)
    return {'shadow_px': int(mask.sum()), 'contact_px': round(float(d.min()), 2), 'reach_px': round(float(d.max()), 2),
            'components': components(mask), 'bbox': [int(xs.min() - origin[0]), int(ys.min() - origin[1]),
                                                     int(xs.max() + 1 - origin[0]), int(ys.max() + 1 - origin[1])]}


def shadow_cell(rgba, mask, origin, foot, floor, cw, ch, fcell, scale=SHADOW_SCALE):
    """A floor patch with the shadow flat 25% dark, the sprite over it, the foot marked."""
    fx, fy = rnd(foot[0]), rnd(foot[1])
    left, top = fcell[0] - fx, fcell[1] - fy               # the sprite's (0, 0) in the cell
    bg = floor.fill(0, 0, cw, ch).astype(float)
    sh = np.zeros((ch, cw), bool)
    mh, mw = mask.shape
    y0, x0 = top - origin[1], left - origin[0]                # the mask's (0, 0) in the cell
    ys, xs = slice(max(0, y0), min(ch, y0 + mh)), slice(max(0, x0), min(cw, x0 + mw))
    sh[ys, xs] = mask[ys.start - y0:ys.stop - y0, xs.start - x0:xs.stop - x0]
    bg[sh] = bg[sh] * (1 - SHADOW_ALPHA / 255.0)
    img = Image.fromarray(np.clip(bg + 0.5, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    img.alpha_composite(to_image(rgba), (left, top))
    img = img.resize((cw * scale, ch * scale), Image.NEAREST)
    d = ImageDraw.Draw(img, 'RGBA')
    cx, cy = fcell[0] * scale, fcell[1] * scale
    d.line([(cx - 5, cy), (cx + 5, cy)], fill=(214, 40, 70, 255), width=2)
    d.line([(cx, cy - 5), (cx, cy + 5)], fill=(214, 40, 70, 255), width=2)
    return img


def make_shadows(entries, projections, floor):
    """shadows.png and the stats {piece: {'old_way': stats, projection: stats}}."""
    rows, stats, width, height = [], {}, 8, 8
    for e in entries:
        items = []
        if e.old is not None:
            m, o = shadow_of_old(e.old)
            items.append(('old way (silhouette as height)', e.old.rgba, e.old.foot, m, o, 'old_way'))
        for p in projections:
            pc = e.pieces[p]
            m, o = shadow_of_piece(pc)
            items.append((f'new {p} (height image)', pc.rgba, pc.foot, m, o, p))
        lefts = [rnd(i[2][0]) + i[4][0] for i in items]
        rights = [i[3].shape[1] - i[4][0] - rnd(i[2][0]) for i in items]
        ups = [rnd(i[2][1]) + i[4][1] for i in items]
        downs = [i[3].shape[0] - i[4][1] - rnd(i[2][1]) for i in items]
        cw, ch = max(lefts) + max(rights) + 2, max(ups) + max(downs) + 2
        fcell = (max(lefts) + 1, max(ups) + 1)
        rows.append((e, items, cw, ch, fcell))
        stats[e.name] = {key: shadow_stats(m, o, foot) for (_, _, foot, m, o, key) in items}
        width = max(width, 8 + len(items) * (cw * SHADOW_SCALE + 10))
        height += 24 + 32 + ch * SHADOW_SCALE + 14
    img = Image.new('RGBA', (width, height), (36, 38, 46, 255))
    d = ImageDraw.Draw(img, 'RGBA')
    y = 8
    for e, items, cw, ch, fcell in rows:
        text(d, (8, y + 2), f'{e.name}: cast shadow swept from the height, lower right, {SHADOW_K} px per px of height, '
                            f'flat {SHADOW_ALPHA * 100 // 255}% dark', size=14)
        y += 24 + 32
        x = 8
        for label, rgba, foot, m, o, key in items:
            st = stats[e.name][key]
            text(d, (x, y - 30), label, size=11)
            text(d, (x, y - 16), f'{st["shadow_px"]} px, foot at {st["contact_px"]} px', size=11)
            img.paste(shadow_cell(rgba, m, o, foot, floor, cw, ch, fcell), (x, y))
            x += cw * SHADOW_SCALE + 10
        y += ch * SHADOW_SCALE + 14
    return img.convert('RGB'), stats


# -------------------------------------------------------------------------------------------------------------------- scene

def silhouette_outline(rgba):
    """1 px outline of the opaque pixels, drawn on the outside so the sprite's own pixels stay intact."""
    a = rgba[..., 3] > 0
    p = np.pad(a, 1)
    out = np.zeros_like(p)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        out |= shifted(p, dy, dx, False)
    return out & ~p                                 # on the padded canvas


def paste_rgba(dest, rgba, x, y):
    """Alpha-composite an RGBA array onto an RGB array at (x, y), clipped."""
    h, w = rgba.shape[:2]
    X0, Y0 = max(0, x), max(0, y)
    X1, Y1 = min(dest.shape[1], x + w), min(dest.shape[0], y + h)
    if X0 >= X1 or Y0 >= Y1:
        return
    src = rgba[Y0 - y:Y1 - y, X0 - x:X1 - x]
    a = src[..., 3:4].astype(float) / 255.0
    dest[Y0:Y1, X0:X1] = np.clip(dest[Y0:Y1, X0:X1] * (1 - a) + src[..., :3] * a + 0.5, 0, 255).astype(np.uint8)


def new_covers_old(new_rgba, new_xy, old_solid, old_xy):
    """Number of today's solid pixels, at its placement, that the new piece at its placement does not cover."""
    ox, oy = old_xy
    nx, ny = new_xy
    h, w = old_solid.shape
    ys, xs = np.nonzero(old_solid)
    gx, gy = xs + ox - nx, ys + oy - ny
    inside = (gx >= 0) & (gx < new_rgba.shape[1]) & (gy >= 0) & (gy < new_rgba.shape[0])
    covered = np.zeros(len(xs), bool)
    covered[inside] = new_rgba[gy[inside], gx[inside], 3] > 0
    return int((~covered).sum())


def plan_strip(items, width, woka):
    """Lay the pairs (today's piece, the new piece) and the Woka in rows of a floor strip. items: [{name, old: (rgba, foot) or
    None, new: (rgba, foot)}]. Returns (labels, height, sprites): sprites = [{kind, name, rgba, x, y, foot}] in strip px."""
    margin, gap_in, gap_pair, label_h = 6, 10, 18, 14

    def pair_width(it):
        return (it['old'][0].shape[1] + gap_in if it['old'] else 0) + it['new'][0].shape[1]

    def drop(rgba, foot):
        return rgba.shape[0] - rnd(foot[1])

    rows, cur, curw = [], [], margin
    for it in items:
        w = pair_width(it)
        if cur and curw + w + gap_pair > width - margin:
            rows.append(cur)
            cur, curw = [], margin
        cur.append(it)
        curw += w + gap_pair
    if cur:
        rows.append(cur)
    sprites, y, labels = [], 0, []
    last_has_woka = False
    for row in rows:
        members = [(i['old'], i['new']) for i in row]
        ups = [rnd(f[1]) for o, n in members for (_, f) in ([o] if o else []) + [n]] + [woka.shape[0]]
        downs = [drop(r, f) for o, n in members for (r, f) in ([o] if o else []) + [n]] + [0]
        base = y + label_h + max(ups)
        x = margin
        for it in row:
            labels.append({'text': it['name'], 'x': x, 'y': y + 1})
            if it['old']:
                r, f = it['old']
                sprites.append({'kind': 'old', 'name': it['name'], 'rgba': r, 'x': x, 'y': base - rnd(f[1]), 'foot': (x + rnd(f[0]), base)})
                x += r.shape[1] + gap_in
            r, f = it['new']
            sprites.append({'kind': 'new', 'name': it['name'], 'rgba': r, 'x': x, 'y': base - rnd(f[1]), 'foot': (x + rnd(f[0]), base)})
            x += r.shape[1] + gap_pair
        if x + woka.shape[1] + margin <= width:
            sprites.append({'kind': 'woka', 'name': 'Woka', 'rgba': woka, 'x': x, 'y': base - woka.shape[0], 'foot': (x + 13, base)})
            labels.append({'text': 'Woka 26x32', 'x': x, 'y': y + 1})
            last_has_woka = True
        else:
            last_has_woka = False        # no room at the end of this row
        y = base + max(downs) + 4
    if not last_has_woka:                # the last row had no room: the Woka gets a row of its own
        base = y + label_h + woka.shape[0]
        sprites.append({'kind': 'woka', 'name': 'Woka', 'rgba': woka, 'x': margin, 'y': base - woka.shape[0], 'foot': (margin + 13, base)})
        labels.append({'text': 'Woka 26x32', 'x': margin, 'y': y + 1})
        y = base + 4
    return labels, y + 2, sprites


def make_scene(entries, projection, picture, view, floor, dist):
    """(image 1:1 as RGB array, composite RGB PIL image, report). The picture's own pixels are never repainted except for
    the magenta outlines of the real placements."""
    x0, y0, vw, vh = view
    base = picture.copy()
    report = {'projection': projection, 'view': list(view), 'pieces': {}}
    items = []
    for e in entries:
        piece = e.pieces[projection]
        info = {'placements': [], 'strip': e.old is not None}
        for old in e.olds:
            dx, dy = e.shift_for(old, projection)
            for (px_, py_) in e.placements.get(old.prefab, []):
                nx, ny = px_ + dx, py_ + dy
                inview = not (nx >= x0 + vw or ny >= y0 + vh or nx + piece.size[0] <= x0 or ny + piece.size[1] <= y0
                              or px_ >= x0 + vw or py_ >= y0 + vh or px_ + old.size[0] <= x0 or py_ + old.size[1] <= y0)
                visible = new_covers_old(piece.rgba, (nx, ny), old.solid, (px_, py_))
                info['placements'].append({'prefab': old.prefab, 'old_top_left': [px_, py_], 'new_top_left': [nx, ny],
                                           'in_view': bool(inview), 'old_still_visible_px': visible,
                                           'drawn': 'outline only' if (visible and inview) else ('in place' if inview else 'not in view')})
        report['pieces'][e.name] = info
        if e.old is not None:
            items.append({'name': e.name, 'old': (e.old.rgba, e.old.foot), 'new': (piece.rgba, piece.foot)})
        else:
            items.append({'name': e.name, 'old': None, 'new': (piece.rgba, piece.foot)})
    # in the picture: an outline where the new piece stands, or the piece itself when it hides today's one entirely
    for e in entries:
        piece = e.pieces[projection]
        for pl in report['pieces'][e.name]['placements']:
            if not pl['in_view']:
                continue
            nx, ny = pl['new_top_left'][0] - x0, pl['new_top_left'][1] - y0
            if pl['old_still_visible_px'] == 0:
                paste_rgba(base, piece.rgba, nx, ny)
            else:
                ol = silhouette_outline(piece.rgba)
                for yy, xx in np.argwhere(ol):
                    X, Y = nx + xx - 1, ny + yy - 1
                    if 0 <= X < vw and 0 <= Y < vh:
                        base[Y, X] = MAGENTA
    woka = woka_standin()
    labels, strip_h, sprites = plan_strip(items, vw, woka)
    strip = floor.fill(0, vh, vw, strip_h).copy()
    for s in sprites:
        paste_rgba(strip, s['rgba'], s['x'], s['y'])
    strip[0] = (60, 62, 70)
    scene = np.concatenate([base, strip], 0)
    report['strip'] = {'y': vh, 'height': int(strip_h),
                       'sprites': [{'kind': s['kind'], 'name': s['name'], 'x': s['x'], 'y': s['y'] + vh} for s in sprites]}
    # composite: 1:1, then 3x with labels
    big = Image.fromarray(scene, 'RGB').resize((scene.shape[1] * SCENE_SCALE, scene.shape[0] * SCENE_SCALE), Image.NEAREST)
    bd = ImageDraw.Draw(big, 'RGBA')
    for lb in labels:
        text(bd, (lb['x'] * SCENE_SCALE, (lb['y'] + vh) * SCENE_SCALE), lb['text'], size=11)
    for s in sprites:
        if s['kind'] in ('old', 'new'):
            text(bd, (s['x'] * SCENE_SCALE, (s['y'] + vh) * SCENE_SCALE - 12), 'today' if s['kind'] == 'old' else 'new', size=10,
                 fill=(255, 255, 255) if s['kind'] == 'new' else (255, 214, 120))
    head = 56
    W = max(scene.shape[1], big.width)
    H = head + scene.shape[0] + 12 + head + big.height
    comp = Image.new('RGB', (W, H), (36, 38, 46))
    cd = ImageDraw.Draw(comp, 'RGBA')
    text(cd, (6, 4), f'scene {projection}: 1:1 (map px)', size=14)
    text(cd, (6, 22), 'magenta outline = where the new piece stands at today\'s real placement (today\'s piece is not painted out)', size=11)
    text(cd, (6, 38), 'below the line: a clean floor strip, today\'s piece beside the new piece on one foot line, a 26x32 Woka stand-in at the end', size=11)
    comp.paste(Image.fromarray(scene, 'RGB'), (0, head))
    text(cd, (6, head + scene.shape[0] + 12 + 4), f'scene {projection}: 3x (nearest neighbour)', size=14)
    text(cd, (6, head + scene.shape[0] + 12 + 22), 'same picture, enlarged 3x', size=11)
    comp.paste(big, (0, head + scene.shape[0] + 12 + head))
    report['image'] = {'size': [W, H], 'one_to_one_at': [0, head], 'three_x_at': [0, head + scene.shape[0] + 12 + head]}
    return scene, comp, report


# ------------------------------------------------------------------------------------------------------ measurements

def decode_normals(piece):
    n = piece.normal[..., :3].astype(float) / 255.0 * 2 - 1
    return np.linalg.norm(n, axis=-1)


def ground_contact_span(recipe, projection, step=0.02, z_max=0.04):
    """Rows between the nearest and the farthest ground contact of the model: surface samples within z_max metres of the
    floor, their depth range times the projection's rows per metre of depth."""
    proj = projection if not isinstance(projection, str) else B.load_projection(projection)
    s = recipe.sample(step)
    low = s.P[s.P[:, 2] <= z_max]
    if not len(low):
        return None
    return float((low[:, 1].max() - low[:, 1].min()) * proj.sy)


def expected(proj, key):
    """What projection.json expects of a piece in this projection (its \"expect\" block): never a number written for another one."""
    if key not in proj.expect:
        raise KeyError(f'projection.json: projection {proj.name!r} has no expect.{key}')
    return float(proj.expect[key])


def plan_tolerance(value):
    """A plan's rim_ratio is the TOLERANCE only (a number); the expected ratio belongs to the projection (projection.json expect)."""
    if isinstance(value, (list, tuple)):
        raise ValueError('plan rim_ratio is a tolerance (a number): the expected ratio is read per projection from projection.json '
                         f'expect.rim_ratio, not written in the plan (got {list(value)})')
    return float(value)


class Checks:
    def __init__(self):
        self.items = []

    def add(self, piece, projection, cid, label, value, limit, ok, method, note=''):
        self.items.append({'piece': piece, 'projection': projection, 'id': cid, 'label': label, 'value': value, 'limit': limit,
                           'status': 'pass' if ok else 'fail', 'method': method, 'note': note})

    def counts(self):
        p = sum(1 for c in self.items if c['status'] == 'pass')
        return {'pass': p, 'fail': len(self.items) - p}


def measure_piece(entry, projection, checks, stats=None, shadow=None, rebake=True):
    piece = entry.pieces[projection]
    proj = B.load_projection(projection)
    plan = entry.plan
    name = entry.name
    rgba = piece.rgba
    a = rgba[..., 3]
    opaque = a > 0
    levels = sorted({int(v) for v in np.unique(a)})
    rows = np.nonzero(opaque.any(1))[0]
    cols = np.nonzero(opaque.any(0))[0]
    height_rows = int(rows.max() - rows.min() + 1)
    hmax = int(piece.height.max())
    out = {'size': list(piece.size), 'canvas_px': int(piece.size[0] * piece.size[1]), 'opaque_px': int(opaque.sum()),
           'colours': piece.metrics['colours'], 'foot_gap': piece.metrics['foot_gap'], 'height_rows': height_rows,
           'height_map_max_px': hmax, 'outline_fraction': piece.metrics['outline_fraction'], 'alpha_levels': levels,
           'depth_offset': piece.depth_offset, 'sort_line': piece.sort_line, 'margin': piece.metrics['margin'],
           'footprint_tiles': list(piece.footprint['tiles']), 'foot': list(piece.foot), 'recipe_hash': piece.provenance['recipe_hash']}
    c = checks.add
    c(name, projection, 'alpha_binary', 'alpha is 0 or 255 only', levels, [0, 255], set(levels) <= {0, 255}, 'MEASURED on the PNG')
    c(name, projection, 'outline_share', 'outline in the ink tone at least 90% of the boundary', piece.metrics['outline_fraction'], 0.9,
      piece.metrics['outline_fraction'] >= 0.9, 'MEASURED by bake.bake (boundary pixels in a material ink)')
    cap = int(plan.get('colour_cap', piece.meta['colour_cap']))
    c(name, projection, 'colour_cap', 'colours at most the cap', piece.metrics['colours'], cap, piece.metrics['colours'] <= cap,
      'MEASURED (distinct opaque RGB)')
    c(name, projection, 'foot_gap', 'foot gap at most projection.json foot_gap_max', piece.metrics['foot_gap'], proj.foot_gap_max,
      piece.metrics['foot_gap'] <= proj.foot_gap_max, 'MEASURED (canvas rows below the lowest opaque row, to the footprint front edge)')
    c(name, projection, 'depth_offset', 'sort line is the canvas bottom, depth offset 0', piece.depth_offset, 0, piece.depth_offset == 0,
      'MEASURED (bake.Piece.depth_offset = sort line - canvas height; a SEAT piece also gets build.py\'s anchor rule, not measured here)')
    mmin = int(plan.get('margin_min', piece.meta['margin']))
    mg = min(piece.metrics['margin']['left'], piece.metrics['margin']['right'], piece.metrics['margin']['top'])
    c(name, projection, 'margin', 'transparent margin on the left, right and top', mg, mmin, mg >= mmin, 'MEASURED')
    if not piece.meta['tall'] and piece.meta['kind'] == 'stand':
        c(name, projection, 'height_cap', 'stand piece at most 56 px tall', height_rows, B.HEIGHT_CAP_PX, height_rows <= B.HEIGHT_CAP_PX,
          'MEASURED (rows from the first to the last opaque row)')
    # no pool and no painted shadow: translucent pixels, and colours that are not on a ramp of the piece's own materials
    ramp = set()
    for m in entry.recipe.materials_table().values():
        ramp |= {tuple(B.V.hex_rgb(h)) for h in m.ramp} | {tuple(B.V.hex_rgb(m.ink))}
    px = rgba[opaque][:, :3]
    off = int(sum(1 for p in map(tuple, px) if p not in ramp))
    patched = int((piece.metrics['override'] or {}).get('changed', 0))
    semi = int(((a > 0) & (a < 255)).sum())
    c(name, projection, 'no_pool', 'zero translucent pixels (pool, painted shadow) and no colour off the material ramps beyond the override patch',
      {'semi_alpha_px': semi, 'off_ramp_px': off, 'override_px': patched}, 0, semi == 0 and off <= patched,
      'MEASURED (alpha of the PNG; colours against the recipe\'s own ramps and inks)')
    ln = decode_normals(piece)
    err = float(np.abs(ln[opaque] - 1).max()) if opaque.any() else 0.0
    exact = bool(((piece.normal[..., 3] > 0) == opaque).all())
    c(name, projection, 'normals', 'normal map: unit length within 0.0136 and alpha exactly on the opaque pixels',
      {'max_length_error': round(err, 4), 'alpha_matches': exact}, NORMAL_TOLERANCE, err <= NORMAL_TOLERANCE and exact,
      'MEASURED on the PNG with the same two tests as verify.py office.normals (verify.py itself was not run)')
    if piece.meta['symmetric']:
        diff = float((np.abs(rgba.astype(int) - rgba[:, ::-1].astype(int)).sum(-1) > 0).sum() / max(int(opaque.sum()), 1))
        c(name, projection, 'symmetric', 'declared symmetric: at most 2% of the pixels differ from the mirror image', round(diff, 4), 0.02,
          diff <= 0.02, 'MEASURED')
    if entry.old is not None:
        om = old_metrics(entry.old)
        c(name, projection, 'canvas_px', 'canvas pixels lower than today\'s', out['canvas_px'], om['canvas_px'], out['canvas_px'] < om['canvas_px'],
          'MEASURED (width x height of the PNGs)')
        out['old'] = om
    if rebake:
        again = rebake_piece(entry, projection)
        h1 = sha256_of(piece.rgba, piece.normal, piece.height)
        h2 = sha256_of(again.rgba, again.normal, again.height)
        c(name, projection, 'rebake_sha256', 're-baking from a freshly loaded recipe gives the same sha256 (colour, normal, height)',
          h1[:16], h2[:16], h1 == h2, 'MEASURED (two bakes, sha256 of the three arrays)')
        out['sha256'] = h1
    # the plan's own numbers
    if 'height_px' in plan:
        want, tol = plan['height_px']
        c(name, projection, 'height_px', f'highest point of the height image is {want} +-{tol} px', hmax, [want - tol, want + tol],
          abs(hmax - want) <= tol, 'MEASURED on the height PNG')
    if 'height_max_px' in plan:
        c(name, projection, 'height_max_px', f'silhouette at most {plan["height_max_px"]} px tall', height_rows, plan['height_max_px'],
          height_rows <= plan['height_max_px'], 'MEASURED (opaque rows)')
    if 'feet_rows_min' in plan:
        span = ground_contact_span(entry.recipe, proj)
        ok = span is not None and span >= plan['feet_rows_min'] - 1e-9
        c(name, projection, 'feet_rows', f'near and far feet at least {plan["feet_rows_min"]} rows apart', None if span is None else round(span, 2),
          plan['feet_rows_min'], ok, 'MEASURED on the recipe\'s surface samples within 0.04 m of the floor (the far feet are hidden behind the '
                                    'pad in the picture, so the picture alone cannot show them)')
    if 'rim_ratio' in plan:
        tol = plan_tolerance(plan['rim_ratio'])
        want = expected(proj, 'rim_ratio')
        ratio = proj.sy / proj.sx
        c(name, projection, 'rim_ratio', f'pot rim height over width {want} +-{tol}', round(ratio, 3), [want - tol, want + tol],
          abs(ratio - want) <= tol, f'DERIVED: the rim is a circle in metres, so its picture is sy / sx of the projection; {want} is projection.json '
                                    f'"{projection}" expect.rim_ratio (the plan\'s 0.75 is the camera75 figure, a ground circle is a circle in oblique)')
    if 'canvas_max' in plan:
        mw, mh = plan['canvas_max']
        margin = piece.meta['margin']
        extra = expected(proj, 'canvas_extra_rows_per_tile') * piece.footprint['tiles'][1]
        lim_w, lim_h = mw + 2 * margin, mh + extra + margin
        c(name, projection, 'canvas_max', f'canvas at most {lim_w}x{lim_h}', list(piece.size), [lim_w, lim_h],
          piece.size[0] <= lim_w and piece.size[1] <= lim_h, 'MEASURED against a limit DERIVED from the plan\'s figures',
          f'the plan allows a {mw}x{mh} picture for the camera75 projection; here: + {margin} px of transparent margin on each side and on '
          f'top, + {extra:g} rows (projection.json "{projection}" expect.canvas_extra_rows_per_tile x {piece.footprint["tiles"][1]:g} tile deep). '
          f'The opaque picture is {int(cols.max() - cols.min() + 1)}x{height_rows}; the canvas is {piece.size[0]}x{piece.size[1]} '
          f'({piece.metrics["margin"]["left"]} px left, {piece.metrics["margin"]["right"]} right, {piece.metrics["margin"]["top"]} top)')
    if 'footprint_tiles' in plan:
        fw, fd = plan['footprint_tiles']
        ov = piece.meta['overhangs']
        fp = piece.footprint['px']
        left = fp['x'] - int(cols.min())
        right = int(cols.max()) + 1 - (fp['x'] + fp['w'])
        allow_l = math.ceil(ov.get('west', 0) * proj.sx) + 1
        allow_r = math.ceil(ov.get('east', 0) * proj.sx) + 1
        below = int(rows.max()) + 1 - piece.sort_line
        ok = (tuple(piece.footprint['tiles']) == (fw, fd) and left <= allow_l and right <= allow_r and below <= 0)
        c(name, projection, 'footprint', f'footprint {fw}x{fd} tiles, the picture inside it (declared overhangs apart)',
          {'tiles': list(piece.footprint['tiles']), 'px_left_of_footprint': left, 'px_right_of_footprint': right,
           'rows_below_front_edge': below}, {'tiles': [fw, fd], 'allowed_left': allow_l, 'allowed_right': allow_r}, ok,
          'MEASURED (opaque columns against the footprint rectangle in canvas px, plus the recipe\'s declared east and west overhang)')
    if shadow is not None:
        st = shadow[projection]
        c(name, projection, 'shadow_contact', 'the swept shadow touches the foot within 2 px', st['contact_px'], 2, st['contact_px'] <= 2,
          'MEASURED on shadows.png\'s mask (distance from the foot point to the nearest shadow pixel)')
        c(name, projection, 'shadow_connected', 'the swept shadow is one piece (a lamp\'s dome shadow connects to its pole\'s)', st['components'], 1,
          st['components'] == 1, 'MEASURED (8-connected components of the mask)')
        out['shadow'] = st
    return out


def rebake_piece(entry, projection):
    spec = entry.spec['recipe']
    if not (spec.endswith('.py') or '/' in spec):
        import props
        props.refresh()
    recipe = B.resolve(spec)
    kw = {}
    if entry.old is not None:
        kw = {'old_canvas': entry.old.size, 'old_foot': entry.old.foot}
    return B.bake(recipe, projection, overrides=entry.overrides, overrides_dir=entry.overrides_dir, **kw)


NOT_TAKEN = [
    {'id': 'box_test', 'what': 'the box test is exact at +-0 rows', 'why': 'owned by tools/test_volume.py and test_bake.py, not by the board'},
    {'id': 'verify_py', 'what': 'verify.py passes office.alpha, office.normals and office.kinds',
     'why': 'verify.py and kinds.py are being edited by another job; the board measures the same alpha and normal tests itself'},
    {'id': 'draw_calls', 'what': 'draw calls in the Gate-1 benchmark are unchanged', 'why': 'needs the game running; no browser or server here'},
    {'id': 'lit_picture', 'what': 'in the lit picture each shadow touches the foot within 2 px, the lamp dome shadow connects to the pole\'s',
     'why': 'needs the real lighting pass; shadow_contact and shadow_connected measure the same two things on the swept preview'},
    {'id': 'seat_numbers', 'what': 'seat anchor, depthOffset and pose for the stool', 'why': 'build.py\'s seating rule decides them, not the baker'},
]


def make_measurements(entries, projections, checks, per_piece, dist_path, floor_path, view, floor_info, warnings):
    totals = {}
    olds = [e for e in entries if e.old is not None]
    for p in projections:
        old_sum = sum(e.old.size[0] * e.old.size[1] for e in olds)
        new_sum = sum(e.pieces[p].size[0] * e.pieces[p].size[1] for e in olds)
        totals[p] = {'pieces': [e.name for e in olds], 'old_canvas_px': old_sum, 'new_canvas_px': new_sum,
                     'baseline_in_plan': PLAN_BASELINE_CANVAS_PX}
        if olds:
            checks.add('(all)', p, 'canvas_px_sum', 'the sum of canvas pixels is lower than before', new_sum, old_sum, new_sum < old_sum,
                       'MEASURED (sum of width x height over the pieces that have a picture of today)')
    prov = next(iter(entries[0].pieces.values())).provenance if entries else {}
    return {'version': API_VERSION, 'dist': str(dist_path), 'floor_picture': {'path': str(floor_path), 'sha256': file_sha256(floor_path) if floor_path else None,
                                                                            'view': list(view), 'floor': floor_info},
            'projections': list(projections), 'baker': {k: prov.get(k) for k in ('numpy', 'pillow', 'python', 'api', 'supersample')},
            'pieces': per_piece, 'totals': totals, 'checks': checks.items, 'summary': checks.counts(), 'not_taken': NOT_TAKEN,
            'warnings': warnings}


# ----------------------------------------------------------------------------------------------------------------- driver

def run(pieces, dist_path, floor_path, out_dir, view=DEFAULT_VIEW, projections=('oblique', 'camera75'), catalogue=None,
        overrides=True, overrides_dir=None):
    """Write the four outputs into out_dir; returns the measurements dict."""
    catalogue = {**CATALOGUE, **(catalogue or {})}
    projections = list(projections)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    warnings = []
    dist = Dist(dist_path)
    entries = make_entries(pieces, dist, projections, catalogue, overrides, overrides_dir)
    for e in entries:
        warnings.extend(f'{e.name}: {n}' for n in e.notes)
    picture = load_view(floor_path, view, warnings)
    floor = Floor(picture, view, entity_mask(dist, view))
    if floor.period is None:
        warnings.append('the floor picture shows no periodic floor pattern; the strips use its most common colour')
    board, _ = make_board(entries, projections)
    board.save(out / 'board.png', format='PNG')
    shadows_img, shadow_stats_ = make_shadows(entries, projections, floor)
    shadows_img.save(out / 'shadows.png', format='PNG')
    scenes = {}
    for p in projections:
        _, comp, rep = make_scene(entries, p, picture, view, floor, dist)
        comp.save(out / f'scene-{p}.png', format='PNG')
        scenes[p] = rep
    checks = Checks()
    per_piece = {}
    for e in entries:
        per_piece[e.name] = {'recipe': e.spec['recipe'], 'plan': e.plan, 'prefabs': e.prefabs,
                             'old': old_metrics(e.old) if e.old else None, 'projections': {}, 'scene': {p: scenes[p]['pieces'][e.name] for p in projections},
                             'shadow': shadow_stats_[e.name]}
        for p in projections:
            per_piece[e.name]['projections'][p] = measure_piece(e, p, checks, stats=None, shadow=shadow_stats_[e.name])
            per_piece[e.name]['projections'][p].pop('old', None)
    meas = make_measurements(entries, projections, checks, per_piece, dist_path, floor_path, view, floor.describe(), warnings)
    meas['scene'] = {p: {k: v for k, v in scenes[p].items() if k != 'pieces'} for p in projections}
    (out / 'measurements.json').write_text(json.dumps(meas, indent=2, sort_keys=True, default=_jsonable) + '\n', encoding='utf-8')
    return meas


def _jsonable(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, tuple):
        return list(o)
    raise TypeError(f'not JSON serialisable: {type(o).__name__}')


def main(argv=None):
    ap = argparse.ArgumentParser(description='Acceptance board of the volume prototype: today against the baked pieces.')
    ap.add_argument('pieces', nargs='*', help='stool, arc-lamp, potted-plant, air-hockey, a registry name or a .py recipe path')
    ap.add_argument('--dist', help='a finished build (office.wam, entities/)')
    ap.add_argument('--floor', help='the lit-lab picture to take the floor and the lounge from (the unlit off.png)')
    ap.add_argument('--out', help='output directory')
    ap.add_argument('--view', default=','.join(map(str, DEFAULT_VIEW)), help='X,Y,W,H of the picture in map px')
    ap.add_argument('--projections', default='oblique,camera75')
    ap.add_argument('--map', default=None, help='JSON file with catalogue entries to add or replace')
    ap.add_argument('--no-overrides', action='store_true')
    ap.add_argument('--strict', action='store_true', help='exit 1 when any measurement fails')
    ap.add_argument('--list', action='store_true', help='print the catalogue names')
    a = ap.parse_args(argv)
    catalogue = {**CATALOGUE, **(load_map(a.map) if a.map else {})}
    if a.list:
        print('\n'.join(sorted(catalogue)))
        return 0
    if not a.pieces or not a.dist or not a.floor or not a.out:
        ap.error('pieces, --dist, --floor and --out are required')
    meas = run(a.pieces, a.dist, a.floor, a.out, parse_view(a.view), [p.strip() for p in a.projections.split(',') if p.strip()],
               catalogue=catalogue, overrides=not a.no_overrides)
    s = meas['summary']
    print(f'{len(a.pieces)} piece(s), {s["pass"]} checks pass, {s["fail"]} fail  ->  {a.out}')
    for c in meas['checks']:
        if c['status'] == 'fail':
            print(f'  FAIL {c["piece"]} [{c["projection"]}] {c["id"]}: {c["label"]} (value {c["value"]}, limit {c["limit"]})')
    for w in meas['warnings']:
        print('warning:', w)
    return 1 if (a.strict and s['fail']) else 0


if __name__ == '__main__':
    sys.exit(main())
