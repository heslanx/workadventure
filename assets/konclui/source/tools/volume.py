"""The volume kit: parametric solids authored in metres, sampled as surface points with an analytic normal and a material.

A piece lane writes a *recipe* with this kit; tools/bake.py turns the recipe into a drawn-looking sprite, its normal map and
its height map. Nothing here knows about pixels, projections or lighting.

FROZEN PUBLIC API (version 1; four piece lanes start from it, so a change is a new version, never an edit in place)
---------------------------------------------------------------------------------------------------------------------
World: metres, x right, y toward the viewer along the ground (south), z up, 1 tile = 1 m. (As a triple x, y, z this is
left-handed; the brief says "right-handed" but fixes the three axes explicitly, and every normal below is computed
analytically as the OUTWARD normal, so handedness never enters.) The footprint of a piece is the ground rectangle
x in [0, w], y in [0, d]; its front edge is y = d.

Materials
  Material(name, ramp, ink=None, flat=False, detail=False)    ramp: 3 to 5 '#RRGGBB' tones, DARK to LIGHT (a flat
        material has 1 to 5, and its tone never follows the light); ink: the outline colour, default ramp[0] (the darkest
        tone); detail=True protects the material's single pixels from the bake's clean-up (an eye, a knob, a rivet).
  flat_material(name, hex, ink)    a one-tone painted material (decals).
  MATERIALS                        dict name -> Material, built from hq-office/palette.py (see "Palette use" below).
  mix(a, b, t)                     '#RRGGBB' blend, t in [0, 1] from a to b.
  shade_ramp(base_ramp, ink_mix)   a palette ramp with one or two darker steps mixed toward the palette INK.

Solids (each has .sample(step) -> Samples, and .moved(dx, dy, dz), .rotated_z(deg, about=(cx, cy)), .mirrored_x(about_x))
  box(x0, y0, z0, x1, y1, z1, mat, *, bevel=0, top=None, south=None, sides=None, bottom=None, decals=())
        'sides' is the north, east and west faces; top/south/sides/bottom default to mat. bevel rounds every edge
        analytically (radius in metres, at most half the smallest side).
  Decal(face, mat, mask)           face 'top' or 'south'; mask(a, b) -> bool array. Top: a = x - x0, b = y - y0 (b grows
        toward the viewer). South: a = x - x0, b = z1 - z (down from the top edge). Metres.
  ascii_decals(face, rows, legend, cell, origin=(0, 0))   a bitmap painted on a face: rows of characters, legend
        {char: material name}, cell = metres per character, origin = (a, b) of the top-left character.
  lathe(profile, cx, cy, mat, *, mats=None, crease_deg=50, sharp=(), arc_deg=(0, 360))
        profile: points (r, z) or (r, z, nr, nz) running from the bottom to the top over the OUTSIDE (the normal is the
        right-hand side of travel in the (r, z) plane: a base runs outward, a side runs up, a top runs inward). mats: one
        name or one per segment. Vertices whose adjacent segment normals differ by more than crease_deg, or listed in
        `sharp`, stay hard edges; the others are smoothed.
  arc(r0, z0, radius, a0_deg, a1_deg, n=16)   profile points on a circle in the (r, z) plane, with exact normals.
  sphere(cx, cy, cz, radius, mat)  frustum(cx, cy, z0, z1, r0, r1, mat, *, top=True, bottom=True)
  tube(path, radius, mat, *, caps=True)       swept circle along a polyline; radius a number or (r_start, r_end).
  bezier(ctrl, n=48)                          points of a Bezier curve (any degree) for tube(); ctrl is a list of (x, y, z).
  ring(cx, cy, z, R, r, mat, *, arc_deg=(0, 360))   torus about a vertical axis (a foot ring, a rim).
  leaf(base, yaw_deg, pitch_deg, length, width, bend_deg, mat, *, under=None, shape='lance', fold=0.0, twist_deg=0)
        a bent, tapered, two-sided blade; yaw is the heading on the ground (0 = +x, 90 = +y), pitch the initial elevation,
        bend the total droop (the elevation falls by bend over the length); shape 'lance', 'paddle', 'strap' or a callable
        w(t) in [0, 1]; fold lifts the blade edges (a V section) by fold * half-width.
  soft_box(x0, y0, z0, x1, y1, z1, mat, *, radius, crown=0, top=None, south=None, sides=None, bottom=None)
        a rounded cushion; crown adds a gentle dome (metres at the centre) to the top.
  union(*solids)  -> Compound              visibility is the baker's z-buffer, so a union is a plain collection.

Recipe (what a props module exposes as RECIPE: a Recipe, a zero-argument callable returning one, or a list of those)
  Recipe(name, solids, footprint, anchors=None, colour_cap=None, overhangs=None, materials=None, kind='stand', coverage=None,
         margin=None, symmetric=False, enlarge=1.0, tall=False, notes='')
    name        str, unique across the registry
    solids      list of Solid
    footprint   (w, d) in tiles (whole or half tiles; w, d > 0)
    anchors     {name: (x, y, z) metres}; 'foot' defaults to the front centre (w / 2, d, 0); conventional names: 'seat',
                'light_head'
    colour_cap  most distinct colours the baked sprite may have; None (the default) takes projection.json bake.colour_cap
                (24), the one number the contract reads too: a recipe sets it only to be stricter
    overhangs   {'north'|'south'|'east'|'west': metres} geometry allowed beyond the footprint on that side
    materials   {name: Material} added to / overriding MATERIALS for this recipe
    kind        'stand' | 'top' | 'hang' | 'floor' (carried to the JSON; the bake does not use it)
    coverage    share of a pixel's sub-pixels that must be covered for it to be solid; None takes projection.json
                bake.coverage (0.5); foliage may lower it
    margin      transparent px kept on the left, right and top of the canvas; None takes bake.margin_px (1); 2 for foliage
    symmetric   declared left-right symmetric (a check, not a bake option)
    enlarge     readability enlargement, at most 1.25, declared (informational: the author scales the geometry)
    tall        declared taller than the 56 px cap (trees)
  Recipe.mirrored()                     the recipe with its x axis mirrored about the footprint centre (anchors too)
  Recipe.recoloured({material: ramp})   the recipe with some materials re-coloured
  Recipe.materials_table()              MATERIALS plus the recipe's own
  recipe_hash(recipe, resolved=None) -> 16 hex chars   a digest of the geometry (sampled at a fixed step), the metadata and
        the ramps used; resolved {'colour_cap', 'coverage', 'margin'} fills the recipe's None values (the baker passes the
        projection.json ones it used). It does NOT cover the projection scales, the light, supersample or crease_px: an override
        patch's staleness is judged by the sha256 of the baked pixels (bake.pixels_sha256), not by this hash alone
  off_palette(materials=None) -> {material name: [tones]}   the ramp tones and inks that are not in tools/palettes/office.hex
        (see "Palette use"); ON_PALETTE is that file's colour set, OFF_PALETTE_MATERIALS the table for MATERIALS
  Solid.sample(step, all_faces=False)   all_faces=True makes a plain box emit its bottom, north, east and west faces too;
        rotated_z() sets it on everything it wraps (a rotation turns those faces toward the viewer), the bake's cull then
        removes whatever still faces away

Samples: .P (n, 3) positions, .N (n, 3) unit outward normals, .mat (n,) int indexes into .names (a tuple of material
names); Samples.concat(list).

Palette use (read from hq-office/palette.py with ast, so importing the kit needs no catalogue): FLOOR_RAMPS 'oak',
'oak-warm', 'porcelain' and 'mist'; FURNITURE_RAMPS 'ds-petrol', 'ds-ink', 'ds-mint', 'ds-turquoise', 'ds-slate'; the
constants INK, NAVY, PETROL, TURQUOISE, MINT, MINT_STRONG, PAPER, SURFACE2, SURFACE3. The floor ramps are low contrast on
purpose, so a furniture material is the floor ramp with one or two darker steps mixed toward INK ('oak' -> 'wood'). Greens
are not in palette.py: 'leaf' is derived from the ds-mint ramp and is a stand-in a plant recipe should replace.
ON-PALETTE STATUS (MEASURED against tools/palettes/office.hex, pinned by test_volume): the derived tones of wood, wood-warm,
walnut, porcelain, mist, leaf and soil, and the ink of every material built on them, are NOT in office.hex; ds-petrol,
ds-ink, ds-mint, ds-turquoise and ds-slate are fully on it. office.hex is generated from palette.py constants, so a piece
built on an off-palette material fails the office palette gate until the integrator either adds the derived tones to
palette.py as constants (and regenerates office.hex) or restricts a piece to on-palette materials; this kit does neither.
off_palette() lists the tones; a recipe can pass materials={...} with palette stops only.
Run python3 -I; the module needs only the standard library and numpy.
"""
import ast
import hashlib
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

API_VERSION = 1
SOURCE = Path(__file__).resolve().parent.parent
PALETTE_FILE = SOURCE / 'hq-office' / 'palette.py'
HASH_STEP = 0.03          # metres: the fixed sampling step of recipe_hash
_HEX = set('0123456789ABCDEF')


# ---------------------------------------------------------------------------------------------------------- colours

def _check_hex(h):
    if not (isinstance(h, str) and len(h) == 7 and h[0] == '#' and set(h[1:].upper()) <= _HEX):
        raise ValueError(f'not a #RRGGBB colour: {h!r}')
    return '#' + h[1:].upper()


def hex_rgb(h):
    h = _check_hex(h)
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def rgb_hex(c):
    return '#%02X%02X%02X' % tuple(int(v) for v in c)


def mix(a, b, t):
    """'#RRGGBB' between a and b: t = 0 is a, t = 1 is b (rounded half up per channel, deterministic)."""
    ca, cb = hex_rgb(a), hex_rgb(b)
    return rgb_hex(int(math.floor(x + (y - x) * t + 0.5)) for x, y in zip(ca, cb))


def _palette_constants():
    """The literal top-level assignments of hq-office/palette.py (strings, lists, dicts), without importing it: the import
    would pull in the furniture catalogue."""
    out = {}
    tree = ast.parse(PALETTE_FILE.read_text(encoding='utf-8'))
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                out[node.targets[0].id] = ast.literal_eval(node.value)
            except (ValueError, SyntaxError):
                pass
    return out


PALETTE = _palette_constants()
INK = PALETTE['INK']


def shade_ramp(base_ramp, ink_mix=(0.5, 0.22)):
    """A palette ramp (dark to light) with darker steps in front: the ramp's darkest tone mixed toward INK by each amount
    in ink_mix (largest first). More than 5 tones drops the second lightest ones until 5 remain."""
    base = [_check_hex(c) for c in base_ramp]
    ramp = [mix(base[0], INK, m) for m in ink_mix] + base
    while len(ramp) > 5:
        del ramp[-2]
    return tuple(ramp)


# -------------------------------------------------------------------------------------------------------- materials

@dataclass(frozen=True)
class Material:
    name: str
    ramp: tuple
    ink: str = None
    flat: bool = False
    detail: bool = False

    def __post_init__(self):
        ramp = tuple(_check_hex(c) for c in self.ramp)
        lo = 1 if self.flat else 3
        if not lo <= len(ramp) <= 5:
            raise ValueError(f'material {self.name!r}: a ramp has {lo} to 5 tones, got {len(ramp)}')
        object.__setattr__(self, 'ramp', ramp)
        object.__setattr__(self, 'ink', _check_hex(self.ink) if self.ink else ramp[0])
        if self.flat and not self.ink:
            raise ValueError('a flat material needs an ink')

    def digest(self):
        return [self.name, list(self.ramp), self.ink, self.flat, self.detail]


def flat_material(name, colour, ink, detail=False):
    """A one-tone painted material (a decal): its tone never follows the light."""
    return Material(name, (colour,), ink=ink, flat=True, detail=detail)


def _build_materials():
    oak = PALETTE['FLOOR_RAMPS']['oak']
    warm = PALETTE['FLOOR_RAMPS']['oak-warm']
    porcelain = PALETTE['FLOOR_RAMPS']['porcelain']
    mist = PALETTE['FLOOR_RAMPS']['mist']
    ds = PALETTE['FURNITURE_RAMPS']
    mint = ds['ds-mint']
    table = {
        # light timber: the floor oak with two darker steps toward INK, then its two lighter tones
        'wood': (mix(oak[0], INK, 0.50), mix(oak[0], INK, 0.22), oak[0], oak[2]),
        'wood-warm': (mix(warm[0], INK, 0.48), mix(warm[0], INK, 0.2), warm[0], warm[2]),
        # dark timber (walnut): the warm oak pulled toward INK in four steps
        'walnut': (mix(warm[0], INK, 0.72), mix(warm[0], INK, 0.56), mix(warm[0], INK, 0.38), mix(warm[0], INK, 0.2)),
        'porcelain': (mix(porcelain[0], INK, 0.40), porcelain[0], porcelain[1], porcelain[3]),
        'mist': (mix(mist[0], INK, 0.40), mist[0], mist[1], mist[3]),
        'ds-petrol': tuple(ds['ds-petrol']),
        'ds-ink': tuple(ds['ds-ink']),
        'ds-mint': tuple(mint),
        'ds-turquoise': tuple(ds['ds-turquoise']),
        'ds-slate': tuple(ds['ds-slate']),
        # a stand-in green derived from ds-mint (palette.py has no leaf green); plant recipes bring their own
        'leaf': (mix(mint[0], INK, 0.45), mix(mint[0], INK, 0.15), mint[0], mix(mint[0], mint[1], 0.45)),
        'soil': (mix(warm[0], INK, 0.85), mix(warm[0], INK, 0.7), mix(warm[0], INK, 0.55)),
    }
    return {n: Material(n, r) for n, r in table.items()}


MATERIALS = _build_materials()

PALETTE_HEX_FILE = SOURCE / 'tools' / 'palettes' / 'office.hex'


def _office_hex():
    try:
        return {'#' + ln.strip().upper() for ln in PALETTE_HEX_FILE.read_text(encoding='utf-8').splitlines() if ln.strip()}
    except OSError:
        return set()


ON_PALETTE = _office_hex()


def off_palette(materials=None):
    """{material name: sorted tones} of the ramp tones and the ink that are not in tools/palettes/office.hex. materials is a
    {name: Material} table (default MATERIALS, e.g. Recipe.materials_table()). Empty when the file is missing."""
    if not ON_PALETTE:
        return {}
    out = {}
    for name, m in (materials if materials is not None else MATERIALS).items():
        bad = sorted({t for t in (*m.ramp, m.ink) if t not in ON_PALETTE})
        if bad:
            out[name] = bad
    return out


OFF_PALETTE_MATERIALS = off_palette()


# ---------------------------------------------------------------------------------------------------------- samples

class Samples:
    """Surface samples: positions P (n, 3), outward unit normals N (n, 3), mat (n,) indexes into names."""
    __slots__ = ('P', 'N', 'mat', 'names')

    def __init__(self, P, N, mat, names):
        self.P = np.asarray(P, float).reshape(-1, 3)
        N = np.asarray(N, float).reshape(-1, 3)
        self.N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
        self.mat = np.asarray(mat, np.int32).reshape(-1)
        self.names = tuple(names)

    def __len__(self):
        return len(self.P)

    @staticmethod
    def concat(parts):
        parts = [p for p in parts if len(p)]
        names = []
        for p in parts:
            for n in p.names:
                if n not in names:
                    names.append(n)
        if not parts:
            return Samples(np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0, np.int32), ())
        mats = []
        for p in parts:
            remap = np.array([names.index(n) for n in p.names], np.int32)
            mats.append(remap[p.mat])
        return Samples(np.concatenate([p.P for p in parts]), np.concatenate([p.N for p in parts]), np.concatenate(mats), names)


def _centres(length, step, even=False):
    """Cell centres along [0, length]: (i + 0.5) / n. Never the endpoints, so a face never samples the next pixel over."""
    n = max(1, int(math.ceil(length / step - 1e-9)))
    if even and n % 2:
        n += 1
    return n, (np.arange(n) + 0.5) / n * length


# ----------------------------------------------------------------------------------------------------------- solids

class Solid:
    def sample(self, step, all_faces=False):
        """Surface samples. all_faces=True asks a solid that skips faces which cannot face the camera in its authored
        orientation (a plain box skips bottom, north, east and west) to emit every face: a rotation turns them toward the
        viewer. _Xform sets it; the baker's cull removes what still faces away."""
        raise NotImplementedError

    def moved(self, dx=0.0, dy=0.0, dz=0.0):
        return _Xform(self, np.eye(3), np.array([dx, dy, dz], float))

    def rotated_z(self, deg, about=(0.0, 0.0)):
        a = math.radians(deg)
        m = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
        c = np.array([about[0], about[1], 0.0])
        return _Xform(self, m, c - m @ c)

    def mirrored_x(self, about_x):
        m = np.diag([-1.0, 1.0, 1.0])
        return _Xform(self, m, np.array([2 * about_x, 0.0, 0.0]))


class _Xform(Solid):
    def __init__(self, inner, m, t):
        self.inner, self.m, self.t = inner, m, t

    def sample(self, step, all_faces=False):
        # identity and the x mirror keep every skipped face skipped (east and west are edge-on either way); any other
        # matrix (rotated_z) can turn a skipped face toward the viewer
        fixed = np.allclose(self.m, np.eye(3)) or np.allclose(self.m, np.diag([-1.0, 1.0, 1.0]))
        s = self.inner.sample(step, all_faces or not fixed)
        return Samples(s.P @ self.m.T + self.t, s.N @ self.m.T, s.mat, s.names)

    def moved(self, dx=0.0, dy=0.0, dz=0.0):
        return _Xform(self.inner, self.m, self.t + np.array([dx, dy, dz], float))


class Compound(Solid):
    def __init__(self, solids):
        flat = []
        for s in solids:
            flat.extend(s.solids if isinstance(s, Compound) else [s])
        self.solids = flat

    def sample(self, step, all_faces=False):
        return Samples.concat([s.sample(step, all_faces) for s in self.solids])


def union(*solids):
    return Compound(solids)


@dataclass(frozen=True)
class Decal:
    face: str
    mat: str
    mask: object

    def __post_init__(self):
        if self.face not in ('top', 'south'):
            raise ValueError(f"a decal goes on the 'top' or 'south' face, not {self.face!r}")


def ascii_decals(face, rows, legend, cell, origin=(0.0, 0.0)):
    """A painted bitmap as one Decal per legend character. rows[j][i] is the cell at a = origin[0] + i * cell,
    b = origin[1] + j * cell; any character not in the legend (including '.' and ' ') leaves the face alone."""
    grid = np.array([list(r) for r in rows])
    out = []
    for ch, mat in legend.items():
        sel = grid == ch

        def mask(a, b, sel=sel):
            i = np.floor((a - origin[0]) / cell).astype(int)
            j = np.floor((b - origin[1]) / cell).astype(int)
            ok = (i >= 0) & (i < sel.shape[1]) & (j >= 0) & (j < sel.shape[0])
            res = np.zeros(a.shape, bool)
            res[ok] = sel[j[ok], i[ok]]
            return res
        out.append(Decal(face, mat, mask))
    return out


class _RoundedBox(Solid):
    """The one implementation behind box() and soft_box(): the six outer faces sampled on a grid, then each sample is
    projected onto the rounded surface (clamp to the inner box, push out by the radius), which gives an exact position and
    an exact normal everywhere, flat faces and bevels alike."""
    FACES = {'top': (2, 1), 'bottom': (2, -1), 'south': (1, 1), 'north': (1, -1), 'east': (0, 1), 'west': (0, -1)}

    def __init__(self, lo, hi, mats, radius=0.0, crown=0.0, decals=()):
        lo, hi = np.array(lo, float), np.array(hi, float)
        if np.any(hi <= lo):
            raise ValueError(f'empty box {lo} {hi}')
        if radius < 0 or radius > (hi - lo).min() / 2 + 1e-12:
            raise ValueError(f'bevel {radius} exceeds half the smallest side of the box')
        self.lo, self.hi, self.mats, self.r, self.crown, self.decals = lo, hi, mats, float(radius), float(crown), tuple(decals)

    def sample(self, step, all_faces=False):
        r = self.r
        st = step * 0.5 if (r > 0 or self.crown) else step
        parts = []
        names = sorted(set(self.mats.values()) | {d.mat for d in self.decals})
        index = {n: i for i, n in enumerate(names)}
        for face, (axis, sign) in self.FACES.items():
            if r == 0 and not all_faces and face in ('bottom', 'north', 'east', 'west'):
                continue          # never visible in the fixed view (edge-on or facing away)
            others = [k for k in range(3) if k != axis]
            na, A = _centres(self.hi[others[0]] - self.lo[others[0]], st)
            nb, B = _centres(self.hi[others[1]] - self.lo[others[1]], st)
            AA, BB = np.meshgrid(A + self.lo[others[0]], B + self.lo[others[1]], indexing='ij')
            P = np.zeros((AA.size, 3))
            P[:, others[0]], P[:, others[1]] = AA.ravel(), BB.ravel()
            P[:, axis] = self.hi[axis] if sign > 0 else self.lo[axis]
            if r > 0:
                c = np.clip(P, self.lo + r, self.hi - r)
                d = P - c
                n = d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-12)
                P = c + n * r
            else:
                n = np.zeros_like(P)
                n[:, axis] = sign
            if self.crown and face == 'top':
                P, n = self._crown(P, n)
            mat = np.full(len(P), index[self.mats[face]], np.int32)
            for dec in self.decals:
                if dec.face != face:
                    continue
                if face == 'top':
                    a_, b_ = P[:, 0] - self.lo[0], P[:, 1] - self.lo[1]
                else:
                    a_, b_ = P[:, 0] - self.lo[0], self.hi[2] - P[:, 2]
                mat[np.asarray(dec.mask(a_, b_), bool)] = index[dec.mat]
            parts.append(Samples(P, n, mat, names))
        return Samples.concat(parts)

    def _crown(self, P, n):
        cx, cy = (self.lo[0] + self.hi[0]) / 2, (self.lo[1] + self.hi[1]) / 2
        hx, hy = (self.hi[0] - self.lo[0]) / 2, (self.hi[1] - self.lo[1]) / 2
        u, v = (P[:, 0] - cx) / hx, (P[:, 1] - cy) / hy
        fu, fv = np.clip(1 - u * u, 0, None), np.clip(1 - v * v, 0, None)
        dz = self.crown * fu * fv
        ddx = self.crown * (-2 * u / hx) * fv * (fu > 0)
        ddy = self.crown * (-2 * v / hy) * fu * (fv > 0)
        P = P.copy()
        P[:, 2] += dz * np.clip(n[:, 2], 0, 1)
        n = n + np.stack([-ddx, -ddy, np.zeros_like(ddx)], 1) * np.clip(n[:, 2:3], 0, 1)
        return P, n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def _face_mats(mat, top, south, sides, bottom):
    return {'top': top or mat, 'south': south or mat, 'bottom': bottom or mat,
            'north': sides or mat, 'east': sides or mat, 'west': sides or mat}


def box(x0, y0, z0, x1, y1, z1, mat, *, bevel=0.0, top=None, south=None, sides=None, bottom=None, decals=()):
    return _RoundedBox((x0, y0, z0), (x1, y1, z1), _face_mats(mat, top, south, sides, bottom), bevel, 0.0, decals)


def soft_box(x0, y0, z0, x1, y1, z1, mat, *, radius, crown=0.0, top=None, south=None, sides=None, bottom=None):
    return _RoundedBox((x0, y0, z0), (x1, y1, z1), _face_mats(mat, top, south, sides, bottom), radius, crown)


def arc(r0, z0, radius, a0_deg, a1_deg, n=16):
    """Profile points on the circle of centre (r0, z0), angle from +r toward +z, with their exact normals (cos, sin)."""
    a = np.radians(np.linspace(a0_deg, a1_deg, n))
    return [(r0 + radius * math.cos(t), z0 + radius * math.sin(t), math.cos(t), math.sin(t)) for t in a]


class _Lathe(Solid):
    def __init__(self, profile, cx, cy, mats, crease_deg, sharp, arc_deg):
        pts = []
        for p in profile:
            if len(p) not in (2, 4):
                raise ValueError('a profile point is (r, z) or (r, z, nr, nz)')
            pts.append(tuple(float(v) for v in p))
        if len(pts) < 2:
            raise ValueError('a profile needs two points')
        if any(p[0] < 0 for p in pts):
            raise ValueError('a profile radius is not negative')
        nseg = len(pts) - 1
        if isinstance(mats, str):
            mats = [mats] * nseg
        if len(mats) != nseg:
            raise ValueError(f'{nseg} segments need {nseg} materials, got {len(mats)}')
        self.pts, self.cx, self.cy, self.mats, self.arc_deg = pts, cx, cy, list(mats), arc_deg
        self.seg_n = self._segment_normals(crease_deg, set(sharp))

    def _segment_normals(self, crease_deg, sharp):
        P = np.array([(p[0], p[1]) for p in self.pts])
        d = np.diff(P, axis=0)
        sn = np.stack([d[:, 1], -d[:, 0]], 1)
        ln = np.linalg.norm(sn, axis=1, keepdims=True)
        sn = np.where(ln > 1e-12, sn / np.maximum(ln, 1e-12), 0.0)
        out = []
        cos_lim = math.cos(math.radians(crease_deg))
        for k in range(len(d)):
            ends = []
            for v, other in ((k, k - 1), (k + 1, k + 1)):
                p = self.pts[v]
                n = sn[k]
                if len(p) == 4:
                    n = np.array(p[2:4]) / max(math.hypot(p[2], p[3]), 1e-12)
                elif 0 < v < len(self.pts) - 1 and v not in sharp and np.dot(sn[other], sn[k]) >= cos_lim:
                    n = sn[other] + sn[k]
                    n = n / max(np.linalg.norm(n), 1e-12)
                ends.append(n)
            out.append((ends[0], ends[1]))
        return out

    def _circle(self, k):
        """A segment whose two ends carry explicit normals that agree with its chord is a circular arc (arc() makes them):
        returns ((centre r, centre z), radius, start angle, signed sweep), else None for a straight segment."""
        p0, p1 = self.pts[k], self.pts[k + 1]
        if len(p0) != 4 or len(p1) != 4:
            return None
        n0, n1 = np.array(p0[2:]), np.array(p1[2:])
        n0, n1 = n0 / np.linalg.norm(n0), n1 / np.linalg.norm(n1)
        chord = np.array([p1[0] - p0[0], p1[1] - p0[1]])
        c = float(np.linalg.norm(chord))
        a0, a1 = math.atan2(n0[1], n0[0]), math.atan2(n1[1], n1[0])
        sweep = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        if c < 1e-12 or abs(sweep) < 1e-6 or abs(sweep) > math.pi / 2 + 1e-9:
            return None
        rad = c / (2 * math.sin(abs(sweep) / 2))
        centre = np.array(p0[:2]) - rad * n0
        if np.linalg.norm(centre + rad * n1 - np.array(p1[:2])) > 1e-6 * max(1.0, rad):
            return None                      # the normals do not belong to a circle through both points
        return (tuple(centre), rad, a0, sweep)

    def sample(self, step, all_faces=False):
        names = sorted(set(self.mats))
        index = {n: i for i, n in enumerate(names)}
        a0, a1 = (math.radians(v) for v in self.arc_deg)
        parts = []
        for k in range(len(self.pts) - 1):
            (r0, z0), (r1, z1) = self.pts[k][:2], self.pts[k + 1][:2]
            length = math.hypot(r1 - r0, z1 - z0)
            if length < 1e-9:
                continue
            nt, t = _centres(length, step)
            t = (t / length)[:, None]
            nth, _ = _centres(max(r0, r1) * (a1 - a0), step, even=True)
            nth = max(nth, 8)
            th = (a0 + (np.arange(nth) + 0.5) / nth * (a1 - a0))[None, :]
            r = r0 + (r1 - r0) * t
            z = z0 + (z1 - z0) * t
            n_a, n_b = self.seg_n[k]
            arc_ = self._circle(k)
            if arc_ is not None:
                (c_r, c_z), rad, th0, dth = arc_
                ang = th0 + dth * t
                r, z = c_r + rad * np.cos(ang), c_z + rad * np.sin(ang)
                nn = np.concatenate([np.cos(ang), np.sin(ang)], 1)
            else:
                nn = n_a + (n_b - n_a) * t
                nn = nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-12)
            P = np.stack([self.cx + r * np.cos(th), self.cy + r * np.sin(th), z + 0 * th], -1)
            N = np.stack([nn[:, :1] * np.cos(th), nn[:, :1] * np.sin(th), nn[:, 1:] + 0 * th], -1)
            parts.append(Samples(P.reshape(-1, 3), N.reshape(-1, 3), np.full(P.shape[0] * P.shape[1], index[self.mats[k]]), names))
        return Samples.concat(parts)


def lathe(profile, cx, cy, mat, *, mats=None, crease_deg=50.0, sharp=(), arc_deg=(0.0, 360.0)):
    return _Lathe(profile, cx, cy, mats if mats is not None else mat, crease_deg, sharp, arc_deg)


def sphere(cx, cy, cz, radius, mat):
    return _Lathe(arc(0.0, cz, radius, -90, 90, 65), cx, cy, mat, 50.0, (), (0.0, 360.0))


def frustum(cx, cy, z0, z1, r0, r1, mat, *, top=True, bottom=True):
    prof = []
    if bottom:
        prof.append((0.0, z0))
    prof += [(r0, z0), (r1, z1)]
    if top:
        prof.append((0.0, z1))
    return _Lathe(prof, cx, cy, mat, 50.0, (1, 2), (0.0, 360.0))


def bezier(ctrl, n=48):
    c = np.asarray(ctrl, float)
    deg = len(c) - 1
    t = np.linspace(0, 1, n)[:, None]
    out = np.zeros((n, c.shape[1]))
    for i in range(deg + 1):
        out += math.comb(deg, i) * (1 - t) ** (deg - i) * t ** i * c[i]
    return out


class _Tube(Solid):
    def __init__(self, path, radius, mat, caps):
        self.path = np.asarray(path, float)
        if self.path.ndim != 2 or self.path.shape[1] != 3 or len(self.path) < 2:
            raise ValueError('a tube path is a list of at least two (x, y, z) points')
        self.r = (float(radius), float(radius)) if np.isscalar(radius) else (float(radius[0]), float(radius[1]))
        self.mat, self.caps = mat, caps

    def sample(self, step, all_faces=False):
        seg = np.linalg.norm(np.diff(self.path, axis=0), axis=1)
        s = np.concatenate([[0.0], np.cumsum(seg)])
        total = s[-1]
        if total < 1e-9:
            raise ValueError('a tube path has no length')
        n, q = _centres(total, step)
        C = np.stack([np.interp(q, s, self.path[:, k]) for k in range(3)], 1)
        # tangents from the polyline itself (the segment each sample lies on), smoothed across corners by a short window
        idx = np.clip(np.searchsorted(s, q, side='right') - 1, 0, len(seg) - 1)
        T = (self.path[idx + 1] - self.path[idx]) / np.maximum(seg[idx], 1e-12)[:, None]
        if len(T) > 4:
            k = 2
            Tp = np.pad(T, ((k, k), (0, 0)), mode='edge')
            T = sum(Tp[i:i + len(T)] for i in range(2 * k + 1))
        T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-12)
        ref = np.where((np.abs(T[:, 2]) < 0.95)[:, None], np.array([0, 0, 1.0]), np.array([1.0, 0, 0]))
        A = np.cross(ref, T)
        A /= np.maximum(np.linalg.norm(A, axis=1, keepdims=True), 1e-12)
        B = np.cross(T, A)
        rad = self.r[0] + (self.r[1] - self.r[0]) * (q / total)
        slope = (self.r[1] - self.r[0]) / total
        nph, ph = _centres(2 * math.pi * max(self.r), step, even=True)
        nph = max(nph, 8)
        ph = (np.arange(nph) + 0.5) / nph * 2 * math.pi
        perp = np.cos(ph)[None, :, None] * A[:, None, :] + np.sin(ph)[None, :, None] * B[:, None, :]
        N = perp - slope * T[:, None, :]
        P = C[:, None, :] + rad[:, None, None] * perp
        parts = [Samples(P.reshape(-1, 3), N.reshape(-1, 3), np.zeros(P.shape[0] * P.shape[1], np.int32), (self.mat,))]
        if self.caps:
            for end, sign in ((0, -1), (len(self.path) - 1, 1)):
                t_end = T[0] if sign < 0 else T[-1]
                a_ = A[0] if sign < 0 else A[-1]
                b_ = B[0] if sign < 0 else B[-1]
                rr = self.r[0] if sign < 0 else self.r[1]
                m_, rs = _centres(rr, step)
                nth, _ = _centres(2 * math.pi * rr, step, even=True)
                th = (np.arange(max(nth, 8)) + 0.5) / max(nth, 8) * 2 * math.pi
                R, TH = np.meshgrid(rs, th, indexing='ij')
                Pc = self.path[end] + R[..., None] * (np.cos(TH)[..., None] * a_ + np.sin(TH)[..., None] * b_)
                Nc = np.broadcast_to(sign * t_end, Pc.shape)
                parts.append(Samples(Pc.reshape(-1, 3), Nc.reshape(-1, 3), np.zeros(Pc.shape[0] * Pc.shape[1], np.int32), (self.mat,)))
        return Samples.concat(parts)


def tube(path, radius, mat, *, caps=True):
    return _Tube(path, radius, mat, caps)


class _Torus(Solid):
    def __init__(self, cx, cy, z, R, r, mat, arc_deg):
        if r <= 0 or R <= r:
            raise ValueError('a ring needs 0 < r < R')
        self.c, self.R, self.r, self.mat, self.arc_deg = (cx, cy, z), R, r, mat, arc_deg

    def sample(self, step, all_faces=False):
        a0, a1 = (math.radians(v) for v in self.arc_deg)
        nu, _ = _centres((self.R + self.r) * (a1 - a0), step, even=True)
        nv, _ = _centres(2 * math.pi * self.r, step, even=True)
        u = (a0 + (np.arange(max(nu, 8)) + 0.5) / max(nu, 8) * (a1 - a0))[:, None]
        v = ((np.arange(max(nv, 8)) + 0.5) / max(nv, 8) * 2 * math.pi)[None, :]
        cu, su, cv, sv = np.cos(u), np.sin(u), np.cos(v), np.sin(v)
        rr = self.R + self.r * cv
        P = np.stack([self.c[0] + rr * cu, self.c[1] + rr * su, self.c[2] + self.r * sv + 0 * u], -1)
        N = np.stack([cv * cu, cv * su, sv + 0 * u], -1)
        return Samples(P.reshape(-1, 3), N.reshape(-1, 3), np.zeros(P.shape[0] * P.shape[1], np.int32), (self.mat,))


def ring(cx, cy, z, R, r, mat, *, arc_deg=(0.0, 360.0)):
    return _Torus(cx, cy, z, R, r, mat, arc_deg)


_LEAF_SHAPES = {
    'lance': lambda t: np.sin(np.pi * np.clip(t, 0, 1) ** 0.6) ** 0.8,
    'paddle': lambda t: np.sin(np.pi * np.clip(t, 0, 1)) ** 0.55,
    'strap': lambda t: np.clip(np.minimum(t / 0.08, (1 - t) / 0.2), 0, 1) ** 0.8,
}


class _Leaf(Solid):
    def __init__(self, base, yaw, pitch, length, width, bend, mat, under, shape, fold, twist):
        if length <= 0 or width <= 0:
            raise ValueError('a leaf needs a positive length and width')
        self.base = np.asarray(base, float)
        self.yaw, self.pitch, self.length, self.width = math.radians(yaw), math.radians(pitch), length, width
        self.bend, self.mat, self.under = math.radians(bend), mat, under or mat
        self.w = shape if callable(shape) else _LEAF_SHAPES[shape]
        self.fold, self.twist = fold, math.radians(twist)

    def _spine(self, t):
        """Centre line and unit tangent at parameter t (array): the elevation falls from pitch by bend over the length."""
        grid = np.linspace(0, 1, 257)
        al = self.pitch - self.bend * grid
        h = np.cos(al) * self.length / 256
        v = np.sin(al) * self.length / 256
        ch = np.concatenate([[0], np.cumsum((h[:-1] + h[1:]) / 2)])
        cv = np.concatenate([[0], np.cumsum((v[:-1] + v[1:]) / 2)])
        hh, vv = np.interp(t, grid, ch), np.interp(t, grid, cv)
        a = self.pitch - self.bend * t
        hx, hy = math.cos(self.yaw), math.sin(self.yaw)
        C = self.base + np.stack([hh * hx, hh * hy, vv], -1)
        T = np.stack([np.cos(a) * hx, np.cos(a) * hy, np.sin(a)], -1)
        return C, T

    def _surface(self, t, u):
        C, T = self._spine(t)
        lat = np.cross(np.array([0, 0, 1.0]), T)
        lat /= np.maximum(np.linalg.norm(lat, axis=-1, keepdims=True), 1e-12)
        up = np.cross(T, lat)
        if self.twist:
            a = self.twist * t
            lat, up = (np.cos(a)[..., None] * lat + np.sin(a)[..., None] * up,
                       -np.sin(a)[..., None] * lat + np.cos(a)[..., None] * up)
        half = (self.width * self.w(t) / 2)[..., None]
        return C + u[..., None] * half * lat + (self.fold * np.abs(u)[..., None] * half) * up

    def sample(self, step, all_faces=False):
        nt, t = _centres(self.length, step)
        nu, u = _centres(2.0, step / max(self.width / 2, 1e-6) * 1.0)
        t = t / self.length
        u = u - 1.0
        T_, U_ = np.meshgrid(t, u, indexing='ij')
        T_, U_ = T_.ravel(), U_.ravel()
        P = self._surface(T_, U_)
        e = 1e-4
        dt = (self._surface(np.clip(T_ + e, 0, 1), U_) - self._surface(np.clip(T_ - e, 0, 1), U_))
        du = (self._surface(T_, np.clip(U_ + e, -1, 1)) - self._surface(T_, np.clip(U_ - e, -1, 1)))
        N = np.cross(dt, du)
        ln = np.linalg.norm(N, axis=1)
        ok = ln > 1e-12
        P, N, ln = P[ok], N[ok] / ln[ok, None], ln[ok]
        N[N[:, 2] < 0] *= -1                         # N is the upper side; the lower side is -N
        # drop the degenerate samples at the tip/base where the blade has no width
        keep = (self.w(T_[ok]) * self.width) > 1e-3
        P, N = P[keep], N[keep]
        top = Samples(P, N, np.zeros(len(P), np.int32), (self.mat,))
        bottom = Samples(P, -N, np.zeros(len(P), np.int32), (self.under,))
        return Samples.concat([top, bottom])


def leaf(base, yaw_deg, pitch_deg, length, width, bend_deg, mat, *, under=None, shape='lance', fold=0.0, twist_deg=0.0):
    return _Leaf(base, yaw_deg, pitch_deg, length, width, bend_deg, mat, under, shape, fold, twist_deg)


# ----------------------------------------------------------------------------------------------------------- recipe

SIDES = ('north', 'south', 'east', 'west')


@dataclass
class Recipe:
    name: str
    solids: list
    footprint: tuple
    anchors: dict = None
    colour_cap: int = None
    overhangs: dict = None
    materials: dict = None
    kind: str = 'stand'
    coverage: float = None
    margin: int = None
    symmetric: bool = False
    enlarge: float = 1.0
    tall: bool = False
    notes: str = ''

    def __post_init__(self):
        self.solids = list(self.solids)
        self.footprint = (float(self.footprint[0]), float(self.footprint[1]))
        self.anchors = {k: tuple(float(c) for c in v) for k, v in (self.anchors or {}).items()}
        self.overhangs = dict(self.overhangs or {})
        self.materials = dict(self.materials or {})
        w, d = self.footprint
        self.anchors.setdefault('foot', (w / 2, d, 0.0))
        self.validate()

    def validate(self):
        if not self.name or not isinstance(self.name, str):
            raise ValueError('a recipe needs a name')
        w, d = self.footprint
        if w <= 0 or d <= 0 or (w * 2) % 1 or (d * 2) % 1:
            raise ValueError(f'{self.name}: the footprint is whole or half tiles, got {self.footprint}')
        if not self.solids:
            raise ValueError(f'{self.name}: no solids')
        # None means "the projection.json value" (bake.colour_cap, bake.coverage, bake.margin_px); bake() range-checks that too
        if self.colour_cap is not None and not 3 <= self.colour_cap <= 64:
            raise ValueError(f'{self.name}: colour_cap {self.colour_cap} is out of range')
        if self.coverage is not None and not 0.1 <= self.coverage <= 1.0:
            raise ValueError(f'{self.name}: coverage {self.coverage} is out of range')
        if self.margin is not None and self.margin < 1:
            raise ValueError(f'{self.name}: the canvas margin is at least 1 px')
        if not 1.0 <= self.enlarge <= 1.25:
            raise ValueError(f'{self.name}: enlarge is declared between 1 and 1.25, got {self.enlarge}')
        for side, m in self.overhangs.items():
            if side not in SIDES or m < 0:
                raise ValueError(f'{self.name}: bad overhang {side!r}: {m!r}')
        for k, v in self.anchors.items():
            if len(v) != 3:
                raise ValueError(f'{self.name}: anchor {k!r} is (x, y, z) metres')

    def materials_table(self):
        return {**MATERIALS, **self.materials}

    def sample(self, step):
        return Compound(self.solids).sample(step)

    def mirrored(self):
        w = self.footprint[0]
        anchors = {k: (w - v[0], v[1], v[2]) for k, v in self.anchors.items()}
        over = dict(self.overhangs)
        over['east'], over['west'] = self.overhangs.get('west', 0), self.overhangs.get('east', 0)
        over = {k: v for k, v in over.items() if v}
        return Recipe(self.name, [s.mirrored_x(w / 2) for s in self.solids], self.footprint, anchors, self.colour_cap, over,
                      self.materials, self.kind, self.coverage, self.margin, self.symmetric, self.enlarge, self.tall, self.notes)

    def recoloured(self, mapping, name=None):
        """mapping {material name: ramp (tuple of hex) | Material}: the same geometry in other colours."""
        table = self.materials_table()
        mats = dict(self.materials)
        for n, r in mapping.items():
            old = table[n]
            mats[n] = r if isinstance(r, Material) else Material(n, tuple(r), flat=old.flat, detail=old.detail)
        return Recipe(name or self.name, self.solids, self.footprint, self.anchors, self.colour_cap, self.overhangs, mats, self.kind,
                      self.coverage, self.margin, self.symmetric, self.enlarge, self.tall, self.notes)


def recipe_hash(recipe, resolved=None):
    """16 hex chars over the recipe's metadata, the ramps of the materials it uses and its geometry sampled at HASH_STEP.
    resolved {'colour_cap', 'coverage', 'margin'} replaces the recipe's own values where those are None (the baker passes
    the projection.json values it used, so a change to the file changes the hash and makes an override patch stale)."""
    res = resolved or {}
    s = recipe.sample(HASH_STEP)
    table = recipe.materials_table()
    used = sorted(s.names)
    order = np.lexsort((np.round(s.P[:, 2] * 1e4), np.round(s.P[:, 1] * 1e4), np.round(s.P[:, 0] * 1e4)))
    h = hashlib.sha256()
    meta = {'name': recipe.name, 'footprint': recipe.footprint, 'anchors': {k: list(v) for k, v in sorted(recipe.anchors.items())},
            'colour_cap': recipe.colour_cap if recipe.colour_cap is not None else res.get('colour_cap'),
            'overhangs': dict(sorted(recipe.overhangs.items())), 'kind': recipe.kind,
            'coverage': recipe.coverage if recipe.coverage is not None else res.get('coverage'),
            'margin': recipe.margin if recipe.margin is not None else res.get('margin'), 'materials': [table[n].digest() for n in used],
            'count': len(s)}
    h.update(json.dumps(meta, sort_keys=True).encode())
    h.update(np.round(s.P[order] * 1e4).astype(np.int64).tobytes())
    h.update(np.round(s.N[order] * 1e2).astype(np.int16).tobytes())
    remap = np.array([used.index(n) for n in s.names], np.int32)
    h.update(remap[s.mat][order].tobytes())
    return h.hexdigest()[:16]
