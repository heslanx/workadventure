"""The baker: a volume recipe (tools/volume.py) -> one drawn-looking sprite, its normal map, its height map and the facts the
build needs. Deterministic, numpy and Pillow only. Run python3 -I.

FROZEN PUBLIC API (version 1; four piece lanes start from it, so a change is a new version, never an edit in place)
---------------------------------------------------------------------------------------------------------------------
    bake(recipe, projection=None, *, old_canvas=None, old_foot=None, overrides=True, overrides_dir=None,
         allow_stale=False, outline=True, cleanup=True, supersample=None) -> Piece
        recipe       a volume.Recipe
        projection   a name from projection.json ('oblique', 'camera75') or None for its "default"; nothing else is
                     hard-coded: ground and height scales come from that file
        old_canvas   (w, h) of the picture this piece replaces, old_foot (x, y) its foot point in that canvas (default
                     the bottom centre); with either given, Piece.shift is filled
        overrides    apply art/overrides/<name>.txt (see "Override patch"); overrides_dir defaults to
                     hq-office/art/overrides; allow_stale applies a stale patch with a warning instead of refusing it
        outline, cleanup, supersample   diagnostics: switch the outline pass or the clean-up pass off, change the 4x sampling
    load_projection(name=None) -> Projection(name, sx, sy, sz, ..., colour_cap, status, expect)   (px per metre in x, in y, in z)
        status 'default' (oblique) or 'comparison-only' (camera75: kept to compare, not what the build uses); expect is the
        projection's own block of plan expectations (rim_ratio, canvas_extra_rows_per_tile) that pieceboard.py checks against
        EVERY key of projection.json "bake" is read: supersample, coverage, margin_px, foot_gap_max, crease_px,
        override_budget, colour_cap, light. A Recipe's coverage, margin and colour_cap are None by default and then take the
        file's value (the contract reads colour_cap and foot_gap_max from the same file); a value on the recipe overrides it.
        test_bake.Projection pins that each key changes the output or the violations.
    Piece                    the result (below); Piece.write(dir) writes the files; Piece.sheet(scale=6) returns a PIL image
    StaleOverrideError, OversizedOverrideError, OverrideError         raised for a refused patch
    ascii_of(piece) -> (text, legend)    the piece as an override-patch skeleton
    CLI   python3 -I bake.py <piece> [--projection oblique|camera75] --out DIR [--sheet] [--no-overrides] [--strict]
          <piece> is a registry name (hq-office/props) or a path to a .py file exposing RECIPE; --list prints the names.
          Writes <piece>.png, <piece>.normal.png, <piece>.height.png, <piece>.json (and <piece>.sheet.png with --sheet);
          exits 1 when the piece has violations.

Piece fields
    name, projection (the name)
    rgba      (h, w, 4) uint8; alpha 0 or 255 only
    normal    (h, w, 4) uint8; WORLD-aligned, +x right, +y UP the map, +z out of the floor, RGB = (n + 1) / 2 * 255,
              alpha 255 exactly on the opaque pixels (see "The normal convention")
    height    (h, w) uint8, px above the floor (z * sz), 0 where transparent
    size (w, h); footprint {'tiles': (w, d), 'px': {'x', 'y', 'w', 'h'}, 'tile_px': (sx, sy)} the ground rectangle in canvas px
              (the JSON carries tiles and px)
    sort_line    canvas row of the footprint's front edge; depth_offset = sort_line - h (0 unless geometry hangs below it)
    foot         (x, y) canvas px of the recipe's 'foot' anchor; anchors {name: (x, y)} every anchor in canvas px
    shift        None, or {'dx', 'dy', 'old_canvas', 'old_foot'}: new top-left = old top-left + (dx, dy)
    bounds       (x0, y0, x1, y1) continuous canvas px of the projected visible surface (before the 50% coverage rule)
    metrics      opaque_px, colours, foot_gap, outline_fraction, ink_px, margin {left, right, top}, override {file, changed,
                 budget, header} ... (all measured on the final picture, after an override patch)
    provenance   recipe_hash, base_sha256 (of the pre-patch RGBA), projection (name and scales), numpy, pillow, python, api, supersample
    meta         the recipe's kind, colour_cap, overhangs, coverage, margin, symmetric, enlarge, tall
    warnings     strings; violations  strings 'code: message' (colour cap, foot gap, margin, footprint, height, outline, symmetry)
    ok           True when there are no violations

Canvas rule: the last row is the front edge of the footprint (foot gap at most 1) unless geometry hangs below it, at least
margin (1, foliage 2) transparent px on the left, right and top; bake() reports a 'margin' violation when the FINAL picture
(an override patch can paint there) has an opaque pixel inside it.

How a piece is drawn
    1. Surface samples at 4x4 per pixel, each with an analytic normal. Only samples facing the camera are kept: the top
       and the south (front) faces and the curved parts that turn toward the viewer; east, west and north faces are never
       drawn (edge-on or facing away).
    2. A z-buffer keeps the nearest sample per sub-pixel. Depth toward the camera is y * sz + z * sy (a ray moves along
       (0, sz, sy)), so the buffer is also the height map.
    3. Tone: n . L with L = projection.json bake.light (straight above, slightly toward the viewer, no x term), mapped onto
       the material's ramp so that a top face takes the lightest tone and a south face the next one down, an underside the
       darkest. No left or right highlight is ever baked: the runtime lighting pass adds direction from the normal map.
    4. Majority vote of (material, tone) per pixel; a pixel is opaque when at least `coverage` (50%) of its sub-pixels are
       covered. Colours stay on the ramp, alpha is 0 or 255.
    5. Clean-up: single stray pixels are removed, one-pixel holes filled, single off-tone pixels take their neighbours' tone
       (a `detail` material is spared).
    6. Outline: 1 px in the material's ink (default its darkest tone), drawn INSIDE the silhouette (so the 1 m box stays
       exactly 32 px wide) and on the farther side of depth creases of 3 px or more.
    7. Optional ASCII override patch.

The normal convention (READ play/src/front/Konclui/Ambience/domain/shaders.ts, the file as of 2026-11-23)
    line 421-422   `bool hasNormal = nm.a > 0.5;  vec3 nProp = hasNormal ? normalize(nm.rgb * 2.0 - 1.0) : vec3(0.0, 0.0, 1.0);`
                   so RGB is decoded as n = rgb * 2 - 1, alpha above 0.5 means "has a normal", flat is (0, 0, 1)
    line 443-446   `// The normal map is OpenGL (+Y up), the map +Y down; the lamp hangs 42 px up.`
                   `vec3 toLamp = normalize(vec3(l.x - w.x, w.y - l.y, 42.0));`   (a lamp south of a pixel has y < 0)
    line 553-554   `bool prop = nm.a > 0.5 && ...; vec3 nProp = prop ? normalize(nm.rgb * 2.0 - 1.0) : ...`
    So a top face encodes (0, 0, 1) and a south face (0, -1, 0): the baker flips the world y of this module (toward the
    viewer) to the map's y (up). tools/README.md "normal.png" documents the same encoding.

Override patch (art/overrides/<piece>.txt, or <piece>.<projection>.txt)
    '# key: value' header lines: piece, projection, recipe (the recipe_hash), canvas (WxH), base (the sha256 of the baked RGBA
    the patch was drawn on, see below), legend (char=#RRGGBB, any number of pairs, any number of lines). Then h rows of w
    characters: '.' keeps the baked pixel, '_' makes it transparent, a legend character sets that colour.
    STALE (refused): a patch with a `base` line is stale when the baked pixels are no longer the ones it was drawn on
    (bake.pixels_sha256(rgba) != base) or the canvas differs. That covers every input that changes a pixel: the recipe, the
    projection scales, light, supersample, coverage, margin, crease_px, the colour cap and the baker's own code (the recipe hash
    cannot see most of those). A recipe change that changes no pixel does not make it stale. A LEGACY header (no `base`, written
    before 2026-11-23) is judged by its recipe hash and canvas only and says so in metrics.override.header == 'legacy': stamp it
    with   python3 -I bake.py --restamp [PATCH ...] [--overrides-dir DIR] [--dry-run] [--force]   (header only; refuses a patch
    that is already stale; ascii_of() writes the base line for new patches).
    OVERSIZED (refused) when it changes more than the file's override_budget (8%) of the baked opaque pixels. A pixel the patch
    adds takes the normal and height of an opaque neighbour that survives the patch (4-neighbours first, then diagonals; flat
    when none), normal alpha always follows the final alpha; a patch for another projection is skipped with a warning. A stale
    patch can be forced with allow_stale=True (a warning). ascii_of(piece) prints the skeleton to start from.
    Every metric and violation below is measured on the FINAL picture, after the patch (foot gap, margin, ink, colours, outline).

Outline (ONE definition, tools/contract.py imports it): boundary_mask(solid) is the solid pixels with a non-solid 4-neighbour
    (the canvas border counts as empty); outline_share(rgba, inks=None, *, tolerance=0, solid_alpha=1, min_share=0.05) is the
    share of those within `tolerance` of an ink. The baker passes its materials' own inks (tolerance 0); the contract has only
    the picture, so it passes inks=None (picture_inks: the colours that hold 5% of the boundary and are darker than the piece)
    and its own tolerance. for a THIN piece (boundary 40% of the solid pixels or more) picture_inks compares a colour
    that is half of the piece or more (a thin pole's ink) with the pixels that are not that colour, because the median of the
    piece is then the ink itself; a wide piece never gets that case.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import PIL
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
for _p in (str(HERE), str(SOURCE / 'hq-office')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import volume as V  # noqa: E402

API_VERSION = 1
PROJECTION_FILE = HERE / 'projection.json'
OVERRIDES_DIR = SOURCE / 'hq-office' / 'art' / 'overrides'
CULL_EPS = 0.02
HEIGHT_CAP_PX = 56
SYMMETRY_TOLERANCE = 0.02


class OverrideError(Exception):
    pass


class StaleOverrideError(OverrideError):
    pass


class OversizedOverrideError(OverrideError):
    pass


# ------------------------------------------------------------------------------------------------------- projection

@dataclass(frozen=True)
class Projection:
    name: str
    sx: float
    sy: float
    sz: float
    supersample: int
    coverage: float
    margin_px: int
    foot_gap_max: int
    crease_px: float
    override_budget: float
    light: tuple
    colour_cap: int = 24
    status: str = ''                 # projection.json "status": 'default' or 'comparison-only' (camera75)
    expect: dict = field(default_factory=dict, compare=False, hash=False)   # projection.json "expect": what the plan checks expect here

    @property
    def view(self):
        """Unit vector from the scene toward the camera in the world frame."""
        v = np.array([0.0, self.sz, self.sy])
        return v / np.linalg.norm(v)

    def project(self, P):
        """World metres (n, 3) -> screen px (sx, sy), rows growing downward."""
        return self.sx * P[:, 0], self.sy * P[:, 1] - self.sz * P[:, 2]

    def depth(self, P):
        """Larger is nearer the camera (monotone along a view ray)."""
        return P[:, 1] * self.sz + P[:, 2] * self.sy

    def depth_px(self, P):
        """Depth as an equivalent height in px: a surface one height-px nearer along the ray differs by 1."""
        return self.sz * P[:, 2] + (self.sz * self.sz / self.sy) * P[:, 1]


def load_projection(name=None):
    data = json.loads(PROJECTION_FILE.read_text(encoding='utf-8'))
    name = name or data['default']
    if name not in data['projections']:
        raise ValueError(f'unknown projection {name!r}; projection.json has {sorted(data["projections"])}')
    p, b = data['projections'][name], data['bake']
    light = np.array(b['light'], float)
    light = tuple(light / np.linalg.norm(light))
    return Projection(name, float(p['sx_px_per_m']), float(p['sy_px_per_m']), float(p['sz_px_per_m']), int(b['supersample']),
                      float(b['coverage']), int(b['margin_px']), int(b['foot_gap_max']), float(b['crease_px']),
                      float(b['override_budget']), light, int(b['colour_cap']), str(p.get('status', '')), dict(p.get('expect') or {}))


# ---------------------------------------------------------------------------------------------------------- piece

@dataclass
class Piece:
    name: str
    projection: str
    rgba: np.ndarray
    normal: np.ndarray
    height: np.ndarray
    footprint: dict
    sort_line: int
    depth_offset: int
    foot: tuple
    anchors: dict
    shift: dict
    bounds: tuple
    metrics: dict
    provenance: dict
    meta: dict
    warnings: list = field(default_factory=list)
    violations: list = field(default_factory=list)

    @property
    def size(self):
        return (self.rgba.shape[1], self.rgba.shape[0])

    @property
    def ok(self):
        return not self.violations

    def to_json(self):
        return {'name': self.name, 'projection': self.projection, 'size': list(self.size),
                'footprint': {'tiles': list(self.footprint['tiles']), 'px': self.footprint['px']},
                'sort_line': self.sort_line, 'depth_offset': self.depth_offset, 'foot': list(self.foot),
                'anchors': {k: list(v) for k, v in sorted(self.anchors.items())}, 'shift': self.shift,
                'bounds': [round(v, 3) for v in self.bounds], 'metrics': self.metrics, 'provenance': self.provenance,
                'meta': self.meta, 'warnings': self.warnings, 'violations': self.violations}

    def images(self):
        return {'': Image.fromarray(self.rgba, 'RGBA'), '.normal': Image.fromarray(self.normal, 'RGBA'),
                '.height': Image.fromarray(self.height, 'L')}

    def write(self, out_dir):
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        paths = []
        for suffix, im in self.images().items():
            p = out / f'{self.name}{suffix}.png'
            im.save(p, format='PNG', optimize=False, compress_level=9)
            paths.append(p)
        p = out / f'{self.name}.json'
        p.write_text(json.dumps(self.to_json(), indent=2, sort_keys=True) + '\n', encoding='utf-8')
        paths.append(p)
        return paths

    def sheet(self, scale=6, backdrop=(150, 160, 168)):
        """The colour image at `scale`x nearest-neighbour on a floor-coloured ground, the footprint's tile grid over it
        (a tile is one footprint width by one footprint depth in px), and the normal map beside it."""
        w, h = self.size
        pad = 32
        sx, sy = self.footprint['tile_px']
        fp = self.footprint['px']
        W, H = (w + 2 * pad) * scale, (h + 2 * pad) * scale
        base = Image.new('RGBA', (W, H), backdrop + (255,))
        base.alpha_composite(Image.fromarray(self.rgba, 'RGBA').resize((w * scale, h * scale), Image.NEAREST), (pad * scale, pad * scale))
        d = ImageDraw.Draw(base, 'RGBA')
        x0, y0 = (fp['x'] + pad) * scale, (fp['y'] + pad) * scale
        x1, y1 = x0 + fp['w'] * scale, y0 + fp['h'] * scale
        for i in range(int(round(self.footprint['tiles'][0])) + 1):
            x = x0 + i * sx * scale
            d.line([(x, y0), (x, y1)], fill=(2, 168, 166, 150), width=1)
        for j in range(int(round(self.footprint['tiles'][1])) + 1):
            y = y1 - j * sy * scale
            d.line([(x0, y), (x1, y)], fill=(2, 168, 166, 150), width=1)
        d.rectangle([x0, y0, x1, y1], outline=(2, 168, 166, 255), width=2)
        fx, fy = self.foot
        cx, cy = (fx + pad) * scale, (fy + pad) * scale
        d.line([(cx - 8, cy), (cx + 8, cy)], fill=(214, 40, 70, 255), width=2)
        d.line([(cx, cy - 8), (cx, cy + 8)], fill=(214, 40, 70, 255), width=2)
        nrm = Image.new('RGBA', (W, H), (24, 24, 32, 255))
        nrm.alpha_composite(Image.fromarray(self.normal, 'RGBA').resize((w * scale, h * scale), Image.NEAREST), (pad * scale, pad * scale))
        sheet = Image.new('RGBA', (2 * W + 12, H), (40, 40, 48, 255))
        sheet.paste(base, (0, 0))
        sheet.paste(nrm, (W + 12, 0))
        return sheet


# -------------------------------------------------------------------------------------------------------- raster helpers

def _shift(a, dy, dx, fill=0):
    """result[i, j] = a[i + dy, j + dx], `fill` outside."""
    H, W = a.shape[:2]
    out = np.full_like(a, fill)
    out[max(0, -dy):H - max(0, dy), max(0, -dx):W - max(0, dx)] = a[max(0, dy):H - max(0, -dy), max(0, dx):W - max(0, -dx)]
    return out


N4 = ((-1, 0), (1, 0), (0, -1), (0, 1))
N8 = N4 + ((-1, -1), (-1, 1), (1, -1), (1, 1))


def _tone_index(n_dot_l, nt, l_top, l_south):
    """Ramp index: the top face (n . L = l_top) takes the lightest tone, the south face one step down, undersides the
    darkest; steps in between are linear in n . L."""
    step = (l_top - n_dot_l) / (l_top - l_south)
    return np.clip(nt - 1 - np.floor(step + 0.5).astype(np.int64), 0, nt - 1)


def _cleanup(solid, mat, tone, nrm, hgt, dep, protected):
    """Remove isolated pixels, fill one-pixel holes, give a lone off-tone pixel its neighbours' tone. Returns the arrays."""
    solid, mat, tone = solid.copy(), mat.copy(), tone.copy()
    nrm, hgt, dep = nrm.copy(), hgt.copy(), dep.copy()
    for _ in range(3):
        changed = False
        s8 = sum(_shift(solid.astype(np.int8), dy, dx) for dy, dx in N8)
        iso = solid & (s8 == 0) & ~protected[np.clip(mat, 0, None)]
        if iso.any():
            solid[iso] = False
            changed = True
        s4 = sum(_shift(solid.astype(np.int8), dy, dx) for dy, dx in N4)
        for i, j in zip(*np.nonzero(~solid & (s4 == 4))):
            codes = [(mat[i + dy, j + dx], tone[i + dy, j + dx]) for dy, dx in N4]
            best = max(set(codes), key=lambda c: (codes.count(c), c))
            solid[i, j] = True
            mat[i, j], tone[i, j] = best
            nb = [(i + dy, j + dx) for dy, dx in N4]
            n = sum(nrm[a, b] for a, b in nb)
            nrm[i, j] = n / max(np.linalg.norm(n), 1e-12)
            hgt[i, j] = np.mean([hgt[a, b] for a, b in nb])
            dep[i, j] = np.mean([dep[a, b] for a, b in nb])
            changed = True
        code = np.where(solid, mat * 8 + tone, -1)
        same = sum((_shift(code, dy, dx, -1) == code).astype(np.int8) for dy, dx in N8)
        speck = solid & (same == 0) & ~protected[np.clip(mat, 0, None)]
        for i, j in zip(*np.nonzero(speck)):
            codes = [(mat[i + dy, j + dx], tone[i + dy, j + dx]) for dy, dx in N8
                     if 0 <= i + dy < solid.shape[0] and 0 <= j + dx < solid.shape[1] and solid[i + dy, j + dx]]
            if not codes:
                continue
            best = max(set(codes), key=lambda c: (codes.count(c), c))
            if codes.count(best) >= 3 and best != (mat[i, j], tone[i, j]):
                mat[i, j], tone[i, j] = best
                changed = True
        if not changed:
            break
    return solid, mat, tone, nrm, hgt, dep


def _outline_mask(solid, dep, crease_px):
    """(edge, crease) masks: the silhouette pixels, and the pixels on the farther side of a depth step of crease_px or more."""
    nb_all = np.ones_like(solid)
    for dy, dx in N4:
        nb_all &= _shift(solid, dy, dx, False)
    edge = solid & ~nb_all
    crease = np.zeros_like(solid)
    for dy, dx in N4:
        ns, nd = _shift(solid, dy, dx, False), _shift(dep, dy, dx, 0.0)
        crease |= solid & ns & (nd - dep > crease_px)
    crease &= ~edge
    # a crease of one pixel is a speck, not a line: keep a crease pixel only beside other ink
    ink = (edge | crease).astype(np.int8)
    neighbours = sum(_shift(ink, dy, dx) for dy, dx in N8)
    return edge, crease & (neighbours > 0)


def boundary_mask(solid):
    """The solid pixels that touch a non-solid one (4-neighbourhood); the canvas border counts as empty."""
    s = np.asarray(solid, bool)
    inner = np.ones_like(s)
    for dy, dx in N4:
        inner &= _shift(s, dy, dx, False)
    return s & ~inner


def _boundary(alpha):
    """Kept for the piece lanes' tests: the boundary of an alpha channel (opaque is alpha > 0)."""
    return boundary_mask(np.asarray(alpha) > 0)


def _luminance(colours):
    c = np.asarray(colours, float)
    return c[..., 0] * 0.299 + c[..., 1] * 0.587 + c[..., 2] * 0.114


THIN_BOUNDARY_SHARE = 0.4      # a piece is "thin" when its boundary pixels are at least this share of its solid pixels (a 3 px pole: 2/3)
THIN_INK_BOUNDARY = 0.9        # and the ink compared in that way must line at least this share of the boundary


def picture_inks(rgba, *, solid_alpha=1, min_share=0.05, min_px=2):
    """The colours that are ink in a picture that does not say which they are, darkest first, [(r, g, b), ...].

    An ink is an exact colour that holds at least `min_share` (and `min_px` px) of the boundary pixels AND is darker than the
    piece: its luminance is below the median luminance of the solid pixels. The second clause keeps a light rim, a highlight
    or a fill that happens to line the edge from counting as an outline (a piece rimmed in one light colour has no ink).

    That median cannot judge a colour that IS the median. A thin piece (a 3 px pole, a leg) is mostly boundary, so its ink
    holds half of all its pixels or more, the median of the solid pixels is the ink itself and it is never "darker than the
    median": a perfectly outlined pole had no ink. For a THIN piece only (its boundary is THIN_BOUNDARY_SHARE = 40% of its
    solid pixels or more: a 3 px pole is 2/3, a 16 px body 23%), a colour that holds half of the solid pixels or more AND
    THIN_INK_BOUNDARY = 90% of the boundary is therefore compared with the solid pixels that are NOT that colour (median of
    the rest); a light rim round a dark centre still fails that (the rim is lighter than the rest). A wide body that is mostly
    one colour (a grey body with a lighter window or highlight stripe: its boundary is the fill) is NOT thin and keeps the plain
    median rule, so it has no ink. A piece made of one colour only has nothing to compare with: it has an ink only when
    it has no interior at all (a line one or two pixels wide: every pixel is boundary); a flat blob has none. A piece with no
    solid pixel has no ink. The test never rejects a colour the plain median test accepts."""
    rgba = np.asarray(rgba)
    solid = rgba[..., 3] >= solid_alpha
    bnd = boundary_mask(solid)
    colours = rgba[bnd][:, :3]
    if not len(colours):
        return []
    unique, counts = np.unique(colours, axis=0, return_counts=True)
    pixels = rgba[solid][:, :3]
    lum = _luminance(pixels)
    median = float(np.median(lum))
    has_interior = bool((solid & ~bnd).any())
    thin = len(colours) >= THIN_BOUNDARY_SHARE * len(pixels)          # the boundary is a big part of the piece: a pole, a leg
    keep = []
    for colour, n in zip(unique, counts):
        if n < max(min_px, math.ceil(min_share * len(colours))):
            continue
        mine = (pixels == colour).all(axis=1)
        own = float(_luminance(colour))
        if own < median:
            keep.append(colour)
        elif thin and mine.mean() >= 0.5 and n >= THIN_INK_BOUNDARY * len(colours):
            rest = lum[~mine]
            if (len(rest) and own < float(np.median(rest))) or (not len(rest) and not has_interior):
                keep.append(colour)
    cand = np.array(keep).reshape(-1, 3)
    order = np.argsort(_luminance(cand), kind='stable')
    return [tuple(int(c) for c in cand[i]) for i in order]


def outline_share(rgba, inks=None, *, tolerance=0, solid_alpha=1, min_share=0.05):
    """THE outline definition, shared by the baker (bake.py) and the contract (contract.py, one import, no second copy).

    Returns (share, inks): the share (0..1) of the boundary pixels (solid pixels with a non-solid 4-neighbour, the canvas
    border counting as empty) whose colour is within `tolerance` per channel of one of `inks`, and the inks used. `inks` is a
    list of (r, g, b): the baker passes its materials' own inks with tolerance 0; None takes picture_inks(rgba), the contract's
    case (it only has the picture), which then gets the contract's tolerance. (0.0, []) when no ink is found or nothing is
    solid."""
    rgba = np.asarray(rgba)
    inks = picture_inks(rgba, solid_alpha=solid_alpha, min_share=min_share) if inks is None else [tuple(int(v) for v in c) for c in inks]
    colours = rgba[boundary_mask(rgba[..., 3] >= solid_alpha)][:, :3]
    if not inks or not len(colours):
        return 0.0, inks
    return float(near_ink(colours, inks, tolerance).mean()), inks


def near_ink(colours, inks, tolerance=0):
    """Boolean per colour row: within `tolerance` per channel of at least one of `inks` (a list of (r, g, b))."""
    colours = np.asarray(colours).astype(int).reshape(-1, 3)
    near = np.zeros(len(colours), bool)
    for ink in inks:
        near |= np.abs(colours - np.array(ink)).max(axis=1) <= tolerance
    return near


# ------------------------------------------------------------------------------------------------------------ overrides

def _parse_patch(text):
    head, rows, legend = {}, [], {}
    for line in text.splitlines():
        if line.startswith('#'):
            key, _, val = line[1:].partition(':')
            key, val = key.strip(), val.strip()
            if key == 'legend':
                for pair in val.split():
                    ch, _, col = pair.partition('=')
                    if len(ch) != 1 or ch in '._#':
                        raise OverrideError(f'bad legend character {ch!r}')
                    legend[ch] = V.hex_rgb(col)
            else:
                head[key] = val
        elif line.strip():
            rows.append(line.rstrip('\n'))
    return head, rows, legend


def _find_patch(name, projection, overrides_dir):
    d = Path(overrides_dir) if overrides_dir else OVERRIDES_DIR
    for f in (d / f'{name}.{projection}.txt', d / f'{name}.txt'):
        if f.is_file():
            return f
    return None


def pixels_sha256(rgba):
    """The sha256 (hex) of a baked picture: its size and its RGBA bytes. The override patch header carries it as `base`."""
    a = np.ascontiguousarray(rgba)
    return hashlib.sha256(f'{a.shape[1]}x{a.shape[0]}:'.encode() + a.tobytes()).hexdigest()


def _stale_reasons(head, rhash, base, w, h):
    """Why a patch no longer fits the bake, [] when it does. A patch with a `base` line is judged by the pixels alone: its
    base must be the sha256 of the baked RGBA it was drawn on, which covers EVERY input that changes a pixel (the recipe, the
    projection scales, light, supersample, coverage, margin, crease_px, the colour cap, the baker's own code). A legacy header
    (no `base`) only has the recipe hash and the canvas to go by, and so cannot see most of those: restamp it."""
    reasons = []
    if 'base' in head:
        if head['base'] != base:
            why = ['the baked pixels differ from the ones this patch was drawn on (base sha256 '
                   f'{head["base"][:12]}... != {base[:12]}...)']
            if head.get('recipe') != rhash:
                why.append(f'the recipe hash differs too ({head.get("recipe")!r} != {rhash!r})')
            else:
                why.append('the recipe hash is the same, so a projection.json value, a projection scale or the baker changed')
            reasons.append('; '.join(why))
        if head.get('canvas') != f'{w}x{h}':
            reasons.append(f'canvas {head.get("canvas")!r} != {w}x{h}')
        return reasons
    if head.get('recipe') != rhash:
        reasons.append(f'recipe hash {head.get("recipe")!r} != {rhash!r}')
    if head.get('canvas') != f'{w}x{h}':
        reasons.append(f'canvas {head.get("canvas")!r} != {w}x{h}')
    return reasons


def _apply_patch(patch_file, name, projection, rhash, rgba, normal, height, budget_share, allow_stale, warnings):
    """Apply an override patch to the canvas arrays in place; returns {'file', 'changed', 'budget', 'header'} or None.
    `rgba` is the pre-patch bake on entry: its pixels_sha256 is what a `base:` header line must match."""
    head, rows, legend = _parse_patch(patch_file.read_text(encoding='utf-8'))
    if head.get('projection') not in (None, projection):
        warnings.append(f'override {patch_file.name} is for projection {head["projection"]!r}, not {projection!r}: skipped')
        return None
    h, w = rgba.shape[:2]
    stale = _stale_reasons(head, rhash, pixels_sha256(rgba), w, h)
    if stale:
        msg = f'override {patch_file.name} is stale: ' + '; '.join(stale)
        if not allow_stale:
            raise StaleOverrideError(msg)
        warnings.append(msg + ' (applied anyway)')
    if len(rows) != h or any(len(r) != w for r in rows):
        raise StaleOverrideError(f'override {patch_file.name}: the picture is not {w}x{h} characters')
    new = rgba.copy()
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == '.':
                continue
            if ch == '_':
                new[j, i] = (0, 0, 0, 0)
            elif ch in legend:
                new[j, i] = legend[ch] + (255,)
            else:
                raise OverrideError(f'override {patch_file.name}: {ch!r} at row {j} column {i} is not in the legend')
    changed = (new != rgba).any(-1)
    opaque = int((rgba[..., 3] > 0).sum())
    budget = int(math.floor(budget_share * opaque))
    n = int(changed.sum())
    if n > budget:
        raise OversizedOverrideError(f'override {patch_file.name} changes {n} px, the budget is {budget} ({budget_share:.0%} of {opaque})')
    # Donors come from a snapshot of the baked normals and heights, and only from pixels that are opaque both before and
    # after the patch (a pixel the patch erases or adds holds no real normal), in a fixed neighbour order: the result never
    # depends on the scan order of the patch.
    snap_n, snap_h = normal.copy(), height.copy()
    had = rgba[..., 3] > 0
    keep = had & (new[..., 3] > 0)
    for j, i in zip(*np.nonzero(changed)):
        if new[j, i, 3] == 0:
            normal[j, i] = (128, 128, 255, 0)
            height[j, i] = 0
        elif not had[j, i]:
            donors = [(j + dy, i + dx) for dy, dx in N4 + N8[4:]
                      if 0 <= j + dy < h and 0 <= i + dx < w and keep[j + dy, i + dx]]
            if donors:
                a, b = donors[0]
                normal[j, i] = snap_n[a, b]
                height[j, i] = snap_h[a, b]
            else:
                normal[j, i] = (128, 128, 255, 255)
                height[j, i] = 0
    normal[..., 3] = new[..., 3]
    rgba[...] = new
    return {'file': patch_file.name, 'changed': n, 'budget': budget, 'header': 'base' if 'base' in head else 'legacy'}


def restamp(path, recipe=None, *, force=False, write=True):
    """Give an override patch the `# base:` header line (the sha256 of the pre-patch bake) so staleness covers every input that
    changes a pixel. Returns ('stamped' | 'unchanged', base). Only the header changes: every other byte of the file is kept.

    The patch must still fit TODAY'S bake: a legacy header (no base) must carry the current recipe hash and canvas, otherwise
    the patch is already stale and stamping would hide that (StaleOverrideError). A header that already has a different base
    is refused too unless force=True (you checked, by eye, that the rows still fit the new pixels). recipe defaults to the
    registry piece named in the header."""
    path = Path(path)
    text = path.read_text(encoding='utf-8')
    head, _rows, _legend = _parse_patch(text)
    name = head.get('piece') or path.name.split('.')[0]
    projection = head.get('projection') or (path.name.split('.')[1] if len(path.name.split('.')) == 3 else None)
    piece = bake(recipe or resolve(name), projection, overrides=False)
    w, h = piece.size
    base = piece.provenance['base_sha256']
    if head.get('base') == base and head.get('canvas') == f'{w}x{h}':
        return 'unchanged', base
    if 'base' in head and not force:
        raise StaleOverrideError(f'{path.name}: its base {head["base"][:12]}... is not today\'s bake {base[:12]}...; restamp only after '
                                 'checking the rows still fit (force=True / --force)')
    if not force and (head.get('recipe') != piece.provenance['recipe_hash'] or head.get('canvas') != f'{w}x{h}'):
        raise StaleOverrideError(f'{path.name}: already stale (recipe {head.get("recipe")!r} / canvas {head.get("canvas")!r} against '
                                 f'{piece.provenance["recipe_hash"]!r} / {w}x{h}): not restamped')
    lines = text.splitlines(keepends=True)
    keep = [ln for ln in lines if not (ln.startswith('#') and ln[1:].partition(':')[0].strip() == 'base')]
    at = max((i for i, ln in enumerate(keep) if ln.startswith('#') and ln[1:].partition(':')[0].strip() in ('piece', 'projection', 'recipe', 'canvas')),
             default=-1) + 1
    nl = '\r\n' if text.count('\r\n') else '\n'
    keep.insert(at, f'# base: {base}{nl}')
    if write:
        path.write_text(''.join(keep), encoding='utf-8')
    return 'stamped', base


def ascii_of(piece):
    """The piece as an override-patch skeleton: header, legend and a picture with one letter per colour (frequent first)."""
    flat = piece.rgba.reshape(-1, 4)
    cols, counts = np.unique(flat[flat[:, 3] > 0][:, :3], axis=0, return_counts=True)
    order = sorted(range(len(cols)), key=lambda k: (-counts[k], tuple(cols[k])))
    letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    legend = {tuple(cols[k]): letters[n] for n, k in enumerate(order)}
    rows = []
    for row in piece.rgba:
        rows.append(''.join(legend[tuple(p[:3])] if p[3] else '_' for p in row))
    w, h = piece.size
    head = [f'# piece: {piece.name}', f'# projection: {piece.projection}', f'# recipe: {piece.provenance["recipe_hash"]}',
            f'# canvas: {w}x{h}', f'# base: {piece.provenance["base_sha256"]}',
            '# legend: ' + ' '.join(f'{ch}={V.rgb_hex(c)}' for c, ch in legend.items())]
    return '\n'.join(head + rows) + '\n', {ch: V.rgb_hex(c) for c, ch in legend.items()}


# ----------------------------------------------------------------------------------------------------------------- bake

def bake(recipe, projection=None, *, old_canvas=None, old_foot=None, overrides=True, overrides_dir=None, allow_stale=False,
         outline=True, cleanup=True, supersample=None):
    proj = projection if isinstance(projection, Projection) else load_projection(projection)
    SS = int(supersample or proj.supersample)
    table = recipe.materials_table()
    fw, fd = recipe.footprint
    # projection.json owns these three; a recipe value (never None) only overrides it
    coverage = proj.coverage if recipe.coverage is None else recipe.coverage
    margin = proj.margin_px if recipe.margin is None else recipe.margin
    cap = proj.colour_cap if recipe.colour_cap is None else recipe.colour_cap
    if not 0.1 <= coverage <= 1.0:
        raise ValueError(f'{recipe.name}: coverage {coverage} is out of range 0.1..1')
    if margin < 1:
        raise ValueError(f'{recipe.name}: the canvas margin is at least 1 px, got {margin}')
    if cap < 3:
        raise ValueError(f'{recipe.name}: colour_cap {cap} is below 3')

    step = 0.6 / (SS * math.hypot(max(proj.sx, proj.sy), proj.sz))
    S = recipe.sample(step)
    for n in S.names:
        if n not in table:
            raise KeyError(f'{recipe.name}: unknown material {n!r}')
    vis = (S.N @ proj.view) > CULL_EPS
    P, N, M = S.P[vis], S.N[vis], S.mat[vis]
    if not len(P):
        raise ValueError(f'{recipe.name}: nothing faces the camera')
    mats = [table[n] for n in S.names]
    nt = np.array([len(m.ramp) for m in mats], np.int64)
    protected = np.array([m.detail for m in mats], bool)

    # the geometry stays inside the footprint plus the declared overhangs
    violations, warnings = [], []
    tol = 0.02
    ov = recipe.overhangs
    lo = np.array([-ov.get('west', 0.0), -ov.get('north', 0.0)]) - tol
    hi = np.array([fw + ov.get('east', 0.0), fd + ov.get('south', 0.0)]) + tol
    full = S.P[:, :2]
    if (full.min(0) < lo).any() or (full.max(0) > hi).any():
        violations.append(f'footprint: geometry spans x {full[:, 0].min():.2f}..{full[:, 0].max():.2f}, '
                          f'y {full[:, 1].min():.2f}..{full[:, 1].max():.2f} m, outside the {fw}x{fd} footprint plus {ov or "no overhang"}')

    sx, sy = proj.project(P)
    ix, iy = np.floor(sx * SS).astype(np.int64), np.floor(sy * SS).astype(np.int64)
    front_row = int(math.ceil(proj.sy * fd - 1e-9))
    pad = margin + 2
    ox, oy = int(ix.min() // SS) - pad, int(iy.min() // SS) - pad
    Wb = int(ix.max() // SS) + 1 + pad - ox
    Hb = max(int(iy.max() // SS) + 1 - oy, front_row - oy) + 1
    key = (iy - oy * SS) * (Wb * SS) + (ix - ox * SS)
    depth = proj.depth(P)
    order = np.lexsort((np.arange(len(P)), depth, key))
    ks = key[order]
    win = order[np.r_[ks[1:] != ks[:-1], True]]
    wk = key[win]

    L = np.array(proj.light)
    l_top, l_south = L[2], L[1]
    tone_w = _tone_index(N[win] @ L, nt[M[win]], l_top, l_south)
    tone_w = np.where(np.array([m.flat for m in mats])[M[win]], 0, tone_w)
    Hs, Ws = Hb * SS, Wb * SS
    code = np.full(Hs * Ws, -1, np.int32)
    code[wk] = M[win] * 8 + tone_w
    sub_n = np.zeros((Hs * Ws, 3), np.float32)
    sub_n[wk] = N[win]
    sub_h = np.zeros(Hs * Ws, np.float32)
    sub_h[wk] = P[win, 2] * proj.sz
    sub_d = np.zeros(Hs * Ws, np.float32)
    sub_d[wk] = proj.depth_px(P[win])

    def blocks(a):
        a = a.reshape((Hb, SS, Wb, SS) + a.shape[1:])
        a = a.transpose((0, 2, 1, 3) + tuple(range(4, a.ndim)))
        return a.reshape((Hb, Wb, SS * SS) + a.shape[4:])

    cb = blocks(code)
    covered = (cb >= 0).sum(-1)
    solid = covered >= max(1, int(math.ceil(coverage * SS * SS - 1e-9)))
    best = np.full((Hb, Wb), -1, np.int64)
    best_n = np.zeros((Hb, Wb), np.int64)
    for c in np.unique(cb[cb >= 0]):
        cnt = (cb == c).sum(-1)
        upd = cnt >= best_n
        best = np.where(upd, c, best)
        best_n = np.where(upd, cnt, best_n)
    wm = (cb == best[..., None]) & (best[..., None] >= 0)
    cntw = np.maximum(wm.sum(-1), 1)
    nrm = (blocks(sub_n) * wm[..., None]).sum(2)
    nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=-1, keepdims=True), 1e-12)
    hgt = (blocks(sub_h) * wm).sum(-1) / cntw
    dep = (blocks(sub_d) * wm).sum(-1) / cntw
    mat = np.where(solid, best // 8, 0)
    tone = np.where(solid, best % 8, 0)

    if cleanup:
        solid, mat, tone, nrm, hgt, dep = _cleanup(solid, mat, tone, nrm, hgt, dep, protected)
    if not solid.any():
        raise ValueError(f'{recipe.name}: nothing is opaque after the coverage rule')
    inkmask = np.zeros_like(solid)
    if outline:
        edge, crease = _outline_mask(solid, dep, proj.crease_px)
        inkmask = edge | crease

    # canvas: the opaque box plus the margin, the last row being the footprint's front edge
    rows, cols = np.nonzero(solid)
    c0, c1, r0, r1 = int(cols.min()), int(cols.max()), int(rows.min()), int(rows.max())
    left, top = c0 - margin, r0 - margin
    right_ex = c1 + 1 + margin
    bottom_ex = int(max(r1 + 1, front_row - oy))
    sl = (slice(top, bottom_ex), slice(left, right_ex))
    ramps = np.zeros((len(mats), 8, 3), np.uint8)
    inks = np.zeros((len(mats), 3), np.uint8)
    for k, m in enumerate(mats):
        for t in range(8):
            ramps[k, t] = V.hex_rgb(m.ramp[min(t, len(m.ramp) - 1)])
        inks[k] = V.hex_rgb(m.ink)
    colour = ramps[mat, tone]
    colour = np.where(inkmask[..., None], inks[mat], colour)
    H, W = int(bottom_ex - top), int(right_ex - left)
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[..., :3] = np.where(solid[sl][..., None], colour[sl], 0)
    rgba[..., 3] = np.where(solid[sl], 255, 0)
    enc = np.stack([nrm[..., 0], -nrm[..., 1], nrm[..., 2]], -1)       # world y (toward the viewer) -> map y (up)
    normal = np.zeros((H, W, 4), np.uint8)
    normal[..., :3] = np.where(solid[sl][..., None], np.clip(np.floor((enc[sl] + 1) / 2 * 255 + 0.5), 0, 255), 128).astype(np.uint8)
    normal[..., 2] = np.where(solid[sl], normal[..., 2], 255)
    normal[..., 3] = rgba[..., 3]
    height = np.where(solid[sl], np.clip(np.floor(hgt[sl] + 0.5), 0, 255), 0).astype(np.uint8)

    # geometry in canvas px
    sx0, sy0 = int(ox + left), int(oy + top)
    foot_gap = int(bottom_ex - (r1 + 1))
    fp_px = {'x': -sx0, 'y': -sy0, 'w': int(round(proj.sx * fw)), 'h': int(round(proj.sy * fd))}
    fp_px['y'] = int(round(fp_px['y']))
    sort_line = int(front_row - sy0)
    anchors = {}
    for name, (ax, ay, az) in recipe.anchors.items():
        anchors[name] = (round(proj.sx * ax - sx0, 2), round(proj.sy * ay - proj.sz * az - sy0, 2))
    foot = anchors['foot']
    bounds = (float(sx.min() - sx0), float(sy.min() - sy0), float(sx.max() - sx0), float(sy.max() - sy0))

    rhash = V.recipe_hash(recipe, {'colour_cap': cap, 'coverage': coverage, 'margin': margin})
    base = pixels_sha256(rgba)                       # the picture a patch is drawn on: what makes a patch stale
    baked = rgba.copy()
    override_info = None
    if overrides:
        pf = _find_patch(recipe.name, proj.name, overrides_dir)
        if pf:
            override_info = _apply_patch(pf, recipe.name, proj.name, rhash, rgba, normal, height, proj.override_budget, allow_stale, warnings)

    shift = None
    if old_canvas is not None or old_foot is not None:
        if old_foot is None:
            old_foot = (old_canvas[0] / 2, old_canvas[1])
        shift = {'dx': int(round(old_foot[0] - foot[0])), 'dy': int(round(old_foot[1] - foot[1])),
                 'old_canvas': list(old_canvas) if old_canvas else None, 'old_foot': [float(old_foot[0]), float(old_foot[1])]}

    # EVERYTHING below is measured on the FINAL picture (a patch may have moved the foot, painted into the margin or recoloured
    # the outline); the geometry above only supplied the canvas.
    alpha = rgba[..., 3] > 0
    opaque_px = int(alpha.sum())
    if not opaque_px:
        raise ValueError(f'{recipe.name}: nothing is opaque after the override patch')
    flat = rgba.reshape(-1, 4)
    colours = len({tuple(p) for p in flat[flat[:, 3] > 0]})
    ink_list = sorted({tuple(int(v) for v in inks[k]) for k in range(len(mats))})
    outline_fraction, _ = outline_share(rgba, ink_list, tolerance=0, solid_alpha=1)
    rows_a, cols_a = np.nonzero(alpha.any(1))[0], np.nonzero(alpha.any(0))[0]
    height_px = int(rows_a.max() - rows_a.min() + 1)
    foot_gap = int(H - 1 - rows_a.max())
    edge_margin = {'left': int(cols_a.min()), 'right': int(W - 1 - cols_a.max()), 'top': int(rows_a.min())}
    on_ink = np.isin(rgba[..., :3].astype(np.int64) @ np.array([65536, 256, 1]), [(r << 16) | (g << 8) | b for r, g, b in ink_list]) & alpha
    patched = (rgba != baked).any(-1)                 # ink the baker drew, still ink; plus ink the patch put on the final boundary
    ink_px = int((on_ink & (inkmask[sl] | (boundary_mask(alpha) & patched))).sum())

    if colours > cap:
        violations.append(f'colours: {colours} colours, the cap is {cap}')
    if foot_gap > proj.foot_gap_max:
        violations.append(f'foot-gap: the lowest opaque row is {foot_gap} rows above the footprint front edge (at most {proj.foot_gap_max})')
    short = {side: v for side, v in edge_margin.items() if v < margin}
    if short:
        violations.append('margin: opaque pixels within the canvas margin of ' + ', '.join(f'{side} {v} px' for side, v in short.items())
                          + f' (at least {margin} px transparent on the left, right and top)')
    if outline_fraction < 0.9:
        violations.append(f'outline: {outline_fraction:.0%} of the silhouette boundary is in the ink tone (at least 90%)')
    if recipe.kind == 'stand' and height_px > HEIGHT_CAP_PX and not recipe.tall:
        violations.append(f'height: {height_px} px tall, the stand cap is {HEIGHT_CAP_PX} unless declared tall')
    if recipe.symmetric:
        diff = float((np.abs(rgba.astype(int) - rgba[:, ::-1].astype(int)).sum(-1) > 0).sum() / max(opaque_px, 1))
        if diff > SYMMETRY_TOLERANCE:
            violations.append(f'symmetry: declared symmetric but {diff:.1%} of the pixels differ from the mirror image (at most 2%)')
    if rows_a.max() + 1 > sort_line:
        warnings.append(f'geometry hangs {int(rows_a.max() + 1 - sort_line)} rows below the footprint front edge: depth_offset {sort_line - H}')

    metrics = {'opaque_px': opaque_px, 'colours': colours, 'foot_gap': foot_gap, 'height_px': height_px,
               'outline_fraction': round(outline_fraction, 4), 'ink_px': ink_px,
               'override': override_info, 'margin': edge_margin, 'samples': int(len(P))}
    provenance = {'recipe_hash': rhash, 'base_sha256': base, 'projection': {'name': proj.name, 'sx': proj.sx, 'sy': proj.sy, 'sz': proj.sz},
                  'numpy': np.__version__, 'pillow': PIL.__version__, 'python': '%d.%d.%d' % sys.version_info[:3],
                  'api': API_VERSION, 'supersample': SS}
    meta = {'kind': recipe.kind, 'colour_cap': cap, 'overhangs': dict(sorted(ov.items())), 'coverage': coverage,
            'margin': margin, 'symmetric': recipe.symmetric, 'enlarge': recipe.enlarge, 'tall': recipe.tall}
    return Piece(recipe.name, proj.name, rgba, normal, height, {'tiles': (fw, fd), 'px': fp_px, 'tile_px': (proj.sx, proj.sy)},
                 sort_line, sort_line - H, foot, anchors, shift, bounds, metrics, provenance, meta, warnings, violations)


# ------------------------------------------------------------------------------------------------------------------ CLI

def load_recipe_file(path):
    """The recipe(s) exposed as RECIPE by a .py file, outside the registry."""
    spec = importlib.util.spec_from_file_location('piece_' + re.sub(r'\W', '_', Path(path).stem), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    items = mod.RECIPE if isinstance(mod.RECIPE, (list, tuple)) else [mod.RECIPE]
    return [r() if callable(r) and not hasattr(r, 'solids') else r for r in items]


def resolve(piece):
    if piece.endswith('.py') or '/' in piece:
        recipes = load_recipe_file(piece)
        if len(recipes) != 1:
            raise SystemExit(f'{piece} exposes {len(recipes)} recipes; use the registry name of one of them')
        return recipes[0]
    import props
    try:
        return props.get(piece)
    except KeyError:
        errors = props.errors()
        raise SystemExit(f'no piece named {piece!r}; known: {props.names()}' + (f'; modules that failed to import: {errors}' if errors else ''))


def main(argv=None):
    ap = argparse.ArgumentParser(description='Bake a volume recipe into a sprite, a normal map and a height map.')
    ap.add_argument('piece', nargs='?', help='registry name or path to a .py file exposing RECIPE')
    ap.add_argument('--projection', default=None, help='oblique (the default of projection.json) or camera75 (kept for comparison only)')
    ap.add_argument('--out', help='output directory')
    ap.add_argument('--sheet', action='store_true', help='also write <piece>.sheet.png, 6x with the tile grid')
    ap.add_argument('--no-overrides', action='store_true')
    ap.add_argument('--overrides-dir', default=None)
    ap.add_argument('--allow-stale-override', action='store_true')
    ap.add_argument('--strict', action='store_true', help='print nothing but violations and exit 1 on any (the default also exits 1)')
    ap.add_argument('--list', action='store_true', help='print the registry names')
    ap.add_argument('--restamp', nargs='*', metavar='PATCH', default=None,
                    help='give override patches the `# base:` header line (files, or none for every patch of --overrides-dir / '
                         'hq-office/art/overrides); only the header changes; refuses a patch that is already stale')
    ap.add_argument('--force', action='store_true', help='with --restamp: stamp even a patch whose base or recipe no longer matches')
    ap.add_argument('--dry-run', action='store_true', help='with --restamp: report, write nothing')
    a = ap.parse_args(argv)
    if a.list:
        import props
        print('\n'.join(props.names()))
        for mod, err in props.errors().items():
            print(f'! {mod}: {err}', file=sys.stderr)
        return 0
    if a.restamp is not None:
        files = [Path(f) for f in a.restamp] or sorted((Path(a.overrides_dir) if a.overrides_dir else OVERRIDES_DIR).glob('*.txt'))
        failed = 0
        for f in files:
            try:
                status, base = restamp(f, force=a.force, write=not a.dry_run)
                print(f'{f.name}: {"would stamp" if a.dry_run and status == "stamped" else status} base {base}')
            except (OverrideError, SystemExit, KeyError, ValueError) as error:
                failed += 1
                print(f'{f.name}: NOT restamped: {error}', file=sys.stderr)
        return 1 if failed else 0
    if not a.piece or not a.out:
        ap.error('a piece and --out are required')
    recipe = resolve(a.piece)
    piece = bake(recipe, a.projection, overrides=not a.no_overrides, overrides_dir=a.overrides_dir, allow_stale=a.allow_stale_override)
    if load_projection(piece.projection).status == 'comparison-only':
        print(f'note: projection {piece.projection!r} is kept for comparison only (projection.json); the default is {load_projection().name!r}', file=sys.stderr)
    paths = piece.write(a.out)
    if a.sheet:
        p = Path(a.out) / f'{piece.name}.sheet.png'
        piece.sheet().save(p, format='PNG')
        paths.append(p)
    w, h = piece.size
    print(f'{piece.name} [{piece.projection}] {w}x{h}  opaque {piece.metrics["opaque_px"]}  colours {piece.metrics["colours"]}  '
          f'foot gap {piece.metrics["foot_gap"]}  outline {piece.metrics["outline_fraction"]:.0%}  hash {piece.provenance["recipe_hash"]}')
    for wmsg in piece.warnings:
        print('warning:', wmsg)
    for v in piece.violations:
        print('VIOLATION', v)
    for p in paths:
        print(' ', p)
    return 0 if piece.ok else 1


if __name__ == '__main__':
    sys.exit(main())
