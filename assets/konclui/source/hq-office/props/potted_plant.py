"""The large potted plant: a tall round ceramic pot with soil, and a crown of long pointed leaves on stalks that fan out in every
direction, the front ones arching over the rim.

Built on the volume kit (tools/volume.py) and baked by tools/bake.py; nothing here knows about pixels or projections: every
number is in metres (x right, y toward the viewer, z up, 1 tile = 1 m), so the same recipe bakes in "oblique" and "camera75".

    build(...) -> volume.Recipe     the parametric recipe
    RECIPE                           the registered piece 'potted_plant', the large bird of paradise (1.6 m, 11 leaves, white pot)

Parameters of build()
    name         recipe name (unique across the registry)
    height       height of the whole plant above the floor in metres (the highest leaf tip lands within 0.08 m of it; the pot
                 keeps its size, the crown scales)
    leaves       number of leaves, 3 to 16 (9 to 12 for the large plant). They are spread evenly over 360 degrees; the ones
                 that look at the viewer lie low and arch over the rim (tier 'near'), the ones that look away stand tall
                 (tier 'far'), the ones in between lean out (tier 'side')
    leaf_shape   'paddle' (an oblong blade with a pointed tip: bird of paradise), 'oval' (a broad blade with a short point:
                 monstera, aglaonema, rubber plant) or 'lance' (the kit's narrow pointed blade)
    leaf_length, leaf_width    blade size in metres at the reference size (scaled with the crown, see scale_for)
    pot          'white', 'cream', 'slate' or a '#RRGGBB' base colour (the pot ramp and its ink are derived from it)
    pot_height, rim_radius, foot_radius    the pot in metres: height, rim circle radius and foot circle radius
    greens       4 '#RRGGBB' leaf tones, dark to light (the darkest is the outline ink); the far tier takes the ramp one step
                 darker, the near tier one step lighter, so the crown separates into layers
    fold         ridge of the blade: the edges fall away from the midrib by this fraction of the half width, which gives a
                 light stripe along the midrib and a darker flank on each side

Layout: the pot stands on the front edge of its 1 x 1 tile (the pot's foot circle touches y = 1, so the sprite's last row is
the pot's contact with the floor) and the leaves overhang the footprint on every side; build() derives the declared
overhangs from the geometry, rounded up to 5 cm.

Drawn as a drawing: the stalks are one pixel wide, flat, in the crown's shade green with no ink, and leave the soil from one small
point; the blades are two-sided and bent, a flat light midrib runs down each. The greens: 3 body tones (the far leaves take the
darker end, the side and near leaves the lighter), 1 shade (stalks), 2 stripe tones (one for the far and side leaves, a lighter one for
the near leaves) and the ink. The pot is a white ceramic bowl: a flat foot, a gently flared wall, a darker band under the rolled rim, a
light rim ring about three pixels wide, and the soil 0.10 m below it; the soil has no ink of its own (its ink is its body tone, so the
kit's crease ink leaves no dark specks beside the stalks). The greens are NOT in tools/palettes/office.hex (the office palette has no
leaf green; the catalogue's own greens are not in it either).

ROOM_HEIGHT (1.35 m) is the variant for a room: build('potted_plant_room', height=ROOM_HEIGHT) is about 35 px wide and 46 px tall in
'oblique' (the lounge's feature plant keeps 1.6 m). It is not registered; the recipe bakes the same.
"""
import math
import sys
from pathlib import Path

import numpy as np

_TOOLS = Path(__file__).resolve().parents[2] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

import volume as V  # noqa: E402

NAME = 'potted_plant'
ROOM_HEIGHT = 1.35                                 # the room variant: build(name, height=ROOM_HEIGHT)
FOOTPRINT = (1.0, 1.0)

# leaf greens, dark to light (the catalogue's own plants use #227255 / #39915A / #58B07D; these keep that blue-leaning family)
GREENS = ('#134A38', '#22705A', '#3A9461', '#5FB77C')
SOIL = ('#2E2018', '#45301F', '#5C4129')
# the pot: (ink, then a 4-tone ramp dark to light); ink is the darkest tone of the material
POTS = {
    'white': ('#4A5668', '#98A6B7', '#C9D3DE', '#E6ECF2', '#F8FAFC'),
    'cream': ('#6B5A3E', '#B3A27F', '#D5C6A3', '#EADFC4', '#FBF6E8'),
    'slate': ('#1B232E', '#34425A', '#55677F', '#7A8EA6', '#A3B5C9'),
}
SHAPES = ('paddle', 'oval', 'lance')
REF_HEIGHT, BASE_SOIL_Z = 1.6, 0.48                # the reference plant: 1.6 m tall over a crown level of 0.48 m
CROWN_DROP = 0.07                                  # the crown grows from this far below the rim (the soil lies deeper, hiding the stalks' feet)
SOIL_DEPTH = 0.10                                  # the soil's edge lies this far below the rim, metres (the front ring hides its lower arc)
RIM_WIDTH = 0.10                                   # the ring of the rim, metres (3 px; its flat top is 0.08)


def _paddle(t):
    """An oblong blade: it opens from the stalk, is widest at 42%, keeps its shoulders and runs to a point in a straight diagonal."""
    t = np.clip(t, 0.0, 1.0)
    rise = np.sin(0.5 * np.pi * np.clip(t / 0.42, 0, 1)) ** 1.1
    fall = np.sin(0.5 * np.pi * np.clip((1 - t) / 0.58, 0, 1)) ** 0.75
    return np.where(t < 0.42, rise, fall)


def _oval(t):
    """A broad blade: widest at 45%, a short point."""
    t = np.clip(t, 0.0, 1.0)
    rise = np.sin(0.5 * np.pi * np.clip(t / 0.45, 0, 1)) ** 0.6
    fall = np.sin(0.5 * np.pi * np.clip((1 - t) / 0.55, 0, 1)) ** 0.8
    return np.where(t < 0.45, rise, fall)


def _pot_material(pot):
    """The pot's Material: a 4-tone ramp with its own darker ink."""
    if pot in POTS:
        ink, *ramp = POTS[pot]
    else:
        base = V._check_hex(pot)
        dark = '#10161F'
        ink, ramp = V.mix(base, dark, 0.62), [V.mix(base, dark, 0.35), V.mix(base, dark, 0.12), base, V.mix(base, '#FFFFFF', 0.4)]
    return V.Material('pot', tuple(ramp), ink=ink)


def leaf_scale(greens):
    """Seven leaf tones, dark to light, from the four the recipe is given: the ink, then three steps the tiers pick from."""
    g0, g1, g2, g3 = (V._check_hex(c) for c in greens)
    return (g0, g1, V.mix(g1, g2, 0.5), g2, V.mix(g2, g3, 0.5), g3, V.mix(g3, '#FFFFFF', 0.28))


def tier_ramp(greens, tier):
    """The 4-tone ramp of a tier: far leaves take the darker end of the scale, near leaves the lighter."""
    s = leaf_scale(greens)
    return {'far': s[1:5], 'side': s[2:6], 'near': s[3:6]}[tier]


def spine(base, yaw_deg, pitch_deg, length, bend_deg, n=18):
    """Centre line of a kit leaf (the same integration as volume.leaf: the elevation falls from `pitch` by `bend` over the
    length): n + 1 points, shape (n + 1, 3). The midrib follows it."""
    yaw, pitch, bend = math.radians(yaw_deg), math.radians(pitch_deg), math.radians(bend_deg)
    t = np.linspace(0, 1, 257)
    al = pitch - bend * t
    h = np.cos(al) * length / 256
    v = np.sin(al) * length / 256
    ch = np.concatenate([[0], np.cumsum((h[:-1] + h[1:]) / 2)])
    cv = np.concatenate([[0], np.cumsum((v[:-1] + v[1:]) / 2)])
    s = np.linspace(0, 1, n + 1)
    hh, vv = np.interp(s, t, ch), np.interp(s, t, cv)
    return np.stack([base[0] + hh * math.cos(yaw), base[1] + hh * math.sin(yaw), base[2] + vv], -1)


def scale_for(height, crown_z=BASE_SOIL_Z):
    """The factor that scales the crown (stalks, blades) so the highest tip lands at `height`: the crown above its reference level
    is 1.12 m high at the reference size (1.6 m over a level of 0.48 m)."""
    return (height - crown_z) / (REF_HEIGHT - BASE_SOIL_Z)


# How a leaf stands as a function of s = sin(yaw), i.e. how much it looks at the viewer (-1 straight away ... +1 straight at the
# viewer): the tall leaves behind the pot, the leaning ones at the sides, the low ones that arch over the front rim.
S_KNOTS = (-1.0, -0.5, 0.0, 0.5, 1.0)
STANCE = {
    'pitch': (80.0, 62.0, 48.0, 34.0, 27.0),      # elevation the blade starts with, degrees
    'bend': (12.0, 24.0, 34.0, 46.0, 56.0),       # droop over the blade's length, degrees
    'rise': (0.56, 0.38, 0.18, 0.10, 0.07),       # height of the blade's base over the soil, metres (reference size)
    'run': (0.12, 0.13, 0.09, 0.07, 0.06),        # how far the stalk leans out, metres (reference size)
    'length': (1.0, 1.0, 0.98, 0.84, 0.64),     # blade length factor
    'ring': (0.05, 0.07, 0.09, 0.16, 0.2),       # distance from the pot's axis at which the stalk leaves the soil, metres
}
FRONT_GAP = 28.0                                  # degrees kept free on each side of the viewer's axis, so the pot's front reads


def tier_of(yaw_deg):
    s = math.sin(math.radians(yaw_deg))
    return 'near' if s > 0.55 else 'far' if s < -0.5 else 'side'


def yaws(leaves, gap=FRONT_GAP, squeeze=0.6, phase=0.03):
    """Leaf headings in degrees. The angle from the viewer's axis (90) runs evenly over 0..180 on each side and is then bent:
    `gap` degrees on each side of the axis stay free, so the leaves that look at the viewer arch over the rim on either side of the
    pot's front instead of hiding it, and `squeeze` (0 .. 0.9) thins the leaves at the front and the back and crowds them at the
    sides, so the tall leaves behind the pot are few and keep daylight between them."""
    out = []
    for j in range(leaves):
        d = (j + 0.5 + phase) * 360.0 / leaves               # 0 .. 360, away from the axis (phase turns the whole fan a little off symmetry)
        d = d - 360.0 if d > 180 else d                      # -180 .. 180
        x = abs(d) / 180.0
        g = x + squeeze * math.sin(2 * math.pi * x) / (2 * math.pi)
        out.append((90.0 + math.copysign(gap + (180.0 - gap) * g, d)) % 360)
    return out


HEART = 2                                         # leaves of the 'heart': low and short behind the stalks, over the back rim


def layout(leaves, k=1.0):
    """Deterministic leaf specs: a list of dicts (yaw, tier, ring, run, rise, pitch, bend, length factor); run and rise are scaled by k.
    HEART of the leaves stand low behind the stalks and hide the pot's back rim; the others fan out over 360 degrees (see yaws).
    Odd leaves stand a little lower and shorter than their neighbours so no two tips line up."""
    heart = HEART if leaves >= 7 else 0
    specs = []
    for j, yaw in enumerate(yaws(leaves - heart)):
        s = math.sin(math.radians(yaw))
        v = j % 2
        wob = ((j * 7) % 5 - 2) / 2.0                          # -1 .. 1, a fixed pseudo-random wobble per leaf
        pick = {key: float(np.interp(s, S_KNOTS, vals)) for key, vals in STANCE.items()}
        specs.append(dict(yaw=yaw, tier=tier_of(yaw), ring=pick['ring'], run=pick['run'] * k, rise=(pick['rise'] - 0.05 * v) * k,
                          pitch=pick['pitch'] - 5.0 * v + 3.0 * wob, bend=pick['bend'] + 3.0 * v, length=pick['length'] - 0.06 * v + 0.04 * wob))
    for j in range(heart):
        yaw = 270.0 + (-1 if j % 2 == 0 else 1) * (30.0 + 8.0 * (j // 2))
        specs.append(dict(yaw=yaw, tier='side', ring=0.06, run=0.08 * k, rise=0.12 * k, pitch=34.0, bend=34.0, length=0.62))
    return specs


def pot_solids(cx, cy, pot_height, rim_radius, foot_radius):
    """The pot and its soil, standing on the floor at (cx, cy): a rounded foot, a gently flared wall, a rolled lip whose underside
    is a darker band, a flat rim ring RIM_WIDTH wide, the lip's inside wall and the soil disc SOIL_DEPTH below the rim."""
    r_f, r_r, h = foot_radius, rim_radius, pot_height
    soil_z = h - SOIL_DEPTH
    r_wall = r_r - 0.035                                    # the wall's radius under the lip
    z_lip = h - 0.085                                       # the lip's underside starts here
    bulge = 0.02
    prof = [(0.0, 0.0), (r_f - 0.03, 0.0)]
    prof += V.arc(r_f - 0.03, 0.03, 0.03, -90, 0, 4)[1:]
    prof += [(r_f + (r_wall - r_f) * 0.5 + bulge, 0.03 + (z_lip - 0.03) * 0.5), (r_wall, z_lip)]
    prof += [(r_r, z_lip + 0.03)]                           # the lip's underside: faces out and down, the darker band
    prof += [(r_r, h - 0.02)]
    prof += V.arc(r_r - 0.02, h - 0.02, 0.02, 0, 90, 4)[1:]
    inner = r_r - RIM_WIDTH
    prof += [(inner, h), (inner - 0.012, h - 0.035), (inner - 0.015, soil_z)]
    return [V.lathe(prof, cx, cy, 'pot', crease_deg=62, sharp=(2,)), V.lathe([(inner - 0.015, soil_z), (0.0, soil_z)], cx, cy, 'soil')]


def build(name=NAME, *, height=1.6, leaves=11, leaf_shape='paddle', leaf_length=0.58, leaf_width=0.30, pot='white',
          pot_height=0.55, rim_radius=0.34, foot_radius=0.28, greens=GREENS, fold=0.14, enlarge=1.0):
    if leaf_shape not in SHAPES:
        raise ValueError(f'leaf_shape is one of {SHAPES}, got {leaf_shape!r}')
    if not 3 <= leaves <= 16:
        raise ValueError(f'leaves is 3 to 16, got {leaves}')
    if len(greens) != 4:
        raise ValueError('greens is 4 tones, dark to light')
    w, d = FOOTPRINT
    cx, cy = w / 2, d - foot_radius                         # the foot circle touches the front edge of the footprint
    soil_z = pot_height - SOIL_DEPTH
    crown_z = pot_height - CROWN_DROP                       # the level the stalks' rise is measured from (see CROWN_DROP)
    k = scale_for(height, crown_z)
    shape = {'paddle': _paddle, 'oval': _oval, 'lance': 'lance'}[leaf_shape]
    scale = leaf_scale(greens)
    ink = scale[0]

    materials = {
        'pot': _pot_material(pot),
        'soil': V.Material('soil', SOIL, ink=SOIL[2]),                   # no baked soil ink: no dark specks beside the stalks (see overrides)
        'stalk': V.flat_material('stalk', scale[1], ink=scale[1]),             # one pixel, mid green, no ink
        'leaf-under': V.Material('leaf-under', (V.mix(scale[0], scale[1], 0.5), V.mix(scale[0], scale[1], 0.75), scale[1]), ink=ink),
    }
    for tier in ('far', 'side', 'near'):
        ramp = tier_ramp(greens, tier)
        materials[f'leaf-{tier}'] = V.Material(f'leaf-{tier}', ramp, ink=ink)
        stripe = V.mix(scale[5] if tier != 'near' else scale[6], '#FFFFFF', 0.32)   # one stripe tone for the far and side leaves, one lighter for the near ones
        materials[f'rib-{tier}'] = V.flat_material(f'rib-{tier}', stripe, ink=stripe)
    solids = pot_solids(cx, cy, pot_height, rim_radius, foot_radius)

    # leaves on stalks: the stalk leaves the soil from one small point, rises at once and ends at the blade's pitch
    for i, s in enumerate(layout(leaves, k)):
        a = math.radians(s['yaw'])
        hx, hy = math.cos(a), math.sin(a)
        p0 = (cx + s['ring'] * hx, cy + s['ring'] * hy, soil_z - 0.02)
        p3 = (p0[0] + s['run'] * hx, p0[1] + s['run'] * hy, crown_z + s['rise'])
        chord = math.dist(p0, p3)
        pr = math.radians(s['pitch'])
        c1 = (p0[0], p0[1], p0[2] + 0.45 * chord)
        c2 = (p3[0] - 0.4 * chord * math.cos(pr) * hx, p3[1] - 0.4 * chord * math.cos(pr) * hy, p3[2] - 0.4 * chord * math.sin(pr))
        solids.append(V.tube(V.bezier([p0, c1, c2, p3], 16), (0.0125, 0.0115), 'stalk', caps=False))
        length = leaf_length * k * s['length'] * (1.0 + 0.05 * ((i * 5) % 3 - 1))
        solids.append(V.leaf(p3, s['yaw'], s['pitch'], length, leaf_width * k, s['bend'], f'leaf-{s["tier"]}', under='leaf-under',
                             shape=shape, fold=-fold))
        rib = spine(p3, s['yaw'], s['pitch'], length, s['bend'])[1:-6]
        rib[:, 2] += 0.012
        solids.append(V.tube([tuple(p) for p in rib], (0.03, 0.012), f'rib-{s["tier"]}', caps=False))

    # declared overhangs: what the geometry takes beyond the 1 x 1 footprint, rounded up to 5 cm
    comp = V.union(*solids).sample(0.015)
    ov = {'north': -comp.P[:, 1].min(), 'south': comp.P[:, 1].max() - d, 'west': -comp.P[:, 0].min(), 'east': comp.P[:, 0].max() - w}
    overhangs = {s: round(math.ceil(m / 0.05 - 1e-9) * 0.05, 2) for s, m in ov.items() if m > 0.0101}

    return V.Recipe(name, solids, FOOTPRINT,
                    anchors={'pot': (cx, cy, 0.0), 'rim': (cx, cy, pot_height), 'canopy': (cx, cy, height * 0.7)},
                    overhangs=overhangs, materials=materials, kind='stand', margin=2, enlarge=enlarge, tall=height > 1.7,
                    notes=f'large potted plant: {leaves} {leaf_shape} leaves, {height} m, {pot} pot')


RECIPE = build()


# ----------------------------------------------------------------------------------------------------- override patch
#
# The kit's outline pass inks the silhouette and the far side of depth creases, so it leaves five things a drawn plant does not
# have; they are fixed here by RULE, on the baked picture (never by hand-placed pixels), and the rules are the patch:
#   1. soil: it has no ink of its own (its ink is its body tone), so the kit's crease ink beside the stalks leaves no dark specks;
#      what is left is soil that is cut off from the soil mass by the stalks (a speck among them) and stalk bits of up to 4 px lying
#      against the soil without joining a stalk: both take the colour around them
#   2. pieces of the pot's far-rim outline between the leaves: grey bars in the foliage. Only the outline that is joined to the
#      pot wall survives
#   3. a leaf in front of the pot with no edge between them (both sides are opaque, so no crease is inked): the leaf side gets its ink
#   4. a stripe run shorter than 3 px (a lone dot at a blade tip) is not a stripe
#   5. a pixel with no 8-neighbour of its own colour is a speck: it takes the colour most of its neighbours have

N8 = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
N4 = ((-1, 0), (1, 0), (0, -1), (0, 1))


def _rgb(hexes):
    return {tuple(int(v) for v in V.hex_rgb(h)) for h in hexes}


def colour_classes(recipe=None):
    """The colour sets of a plant recipe, as RGB tuples: pot (tones without ink), pot_ink, soil ramp, leaf (body and stripes
    without ink), leaf_ink, stalk, stripe."""
    m = (recipe or RECIPE).materials
    leaf = set().union(*(_rgb(m[f'leaf-{t}'].ramp) for t in ('far', 'side', 'near')))
    stripe = set().union(*(_rgb(m[f'rib-{t}'].ramp) for t in ('far', 'side', 'near')))
    return dict(pot=_rgb(m['pot'].ramp), pot_ink=_rgb([m['pot'].ink]), soil=_rgb(m['soil'].ramp), leaf=leaf | stripe,
                leaf_ink=_rgb([m['leaf-far'].ink]), stalk=_rgb(m['stalk'].ramp), stripe=stripe)


def components(mask, conn=8):
    """Connected components of a boolean mask, as lists of (y, x), in scan order."""
    h, w = mask.shape
    steps = N8 if conn == 8 else N4
    seen = np.zeros_like(mask)
    out = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            seen[y0, x0] = True
            comp, todo = [], [(y0, x0)]
            while todo:
                y, x = todo.pop()
                comp.append((y, x))
                for dy, dx in steps:
                    j, i = y + dy, x + dx
                    if 0 <= j < h and 0 <= i < w and mask[j, i] and not seen[j, i]:
                        seen[j, i] = True
                        todo.append((j, i))
            out.append(sorted(comp))
    return out


def lone_pixels(rgba):
    """{(x, y): (r, g, b) | None}: opaque pixels with no 8-neighbour of their own colour (see rule 5), with the colour most of their
    neighbours have (ties go to the lighter colour) or None when they have no opaque neighbour. A few passes: a pixel made lone by
    its neighbour's fix is fixed too."""
    rgba = rgba.copy()
    h, w = rgba.shape[:2]
    patch = {}
    for _ in range(3):
        a = rgba[..., 3] > 0
        step = {}
        for y in range(h):
            for x in range(w):
                if not a[y, x]:
                    continue
                c = tuple(int(v) for v in rgba[y, x, :3])
                near = [tuple(int(v) for v in rgba[y + dy, x + dx, :3]) for dy, dx in N8
                        if 0 <= y + dy < h and 0 <= x + dx < w and a[y + dy, x + dx]]
                if c in near:
                    continue
                step[(x, y)] = max(set(near), key=lambda col: (near.count(col), sum(col))) if near else None
        if not step:
            break
        for (x, y), col in step.items():
            patch[(x, y)] = col
            rgba[y, x] = (0, 0, 0, 0) if col is None else (*col, 255)
    return patch


def _vote(px, a, y, x, skip):
    """The colour most of the opaque 8-neighbours of (y, x) have, leaving out the colours in `skip` (ties go to the lighter one);
    None when no neighbour is left."""
    h, w = a.shape
    near = [tuple(int(v) for v in px[y + dy, x + dx]) for dy, dx in N8
            if 0 <= y + dy < h and 0 <= x + dx < w and a[y + dy, x + dx] and tuple(int(v) for v in px[y + dy, x + dx]) not in skip]
    return max(set(near), key=lambda col: (near.count(col), sum(col))) if near else None


def soil_region(piece):
    """Boolean mask, in the canvas of `piece`, of where the soil shows when nothing but the pot stands on it: the pot and its soil
    baked alone, moved by the difference of their 'pot' anchors."""
    import dataclasses
    import bake as B
    r = RECIPE
    probe = B.bake(dataclasses.replace(r, solids=r.solids[:2], name=r.name + '-soil-probe'), piece.projection, overrides=False)
    soil = _rgb(r.materials['soil'].ramp)
    own = (probe.rgba[..., 3] > 0) & np.array([[tuple(int(v) for v in p[:3]) in soil for p in row] for row in probe.rgba])
    dx = int(round(piece.anchors['pot'][0] - probe.anchors['pot'][0]))
    dy = int(round(piece.anchors['pot'][1] - probe.anchors['pot'][1]))
    out = np.zeros(piece.rgba.shape[:2], bool)
    h, w = out.shape
    for y, x in zip(*np.nonzero(own)):
        if 0 <= y + dy < h and 0 <= x + dx < w:
            out[y + dy, x + dx] = True
    return out


def tidy(piece, cls):
    """The five rules above, in this order, on a baked piece; returns the tidied (h, w, 3) colours."""
    rgba = piece.rgba
    px = rgba[..., :3].copy()
    a = rgba[..., 3] > 0
    h, w = a.shape
    is_in = lambda colours: a & np.array([[tuple(int(v) for v in px[y, x]) in colours for x in range(w)] for y in range(h)])
    soil_ramp = sorted(cls['soil'], key=sum)                                    # ink, band tone, body tone
    ink, band, body = soil_ramp
    # 1. soil: a stalk bit of up to 4 px that lies against the soil without joining a stalk is soil; soil cut off from the soil mass is not
    soil_of = lambda: is_in({band, body})
    parts = components(soil_of())
    big = max(parts, key=len, default=[])
    for comp in parts:
        if comp is not big:
            for y, x in comp:
                col = _vote(px, a, y, x, {band, body, ink})
                px[y, x] = col if col is not None else px[y, x]
    for comp in components(is_in(cls['stalk'])):
        if len(comp) <= 4 and sum(1 for y, x in comp for dy, dx in N8 if 0 <= y + dy < h and 0 <= x + dx < w and soil_of()[y + dy, x + dx]) >= 2:
            for y, x in comp:
                px[y, x] = body
    # 2. the pot's outline that is not joined to the pot wall
    pot_ink = is_in(cls['pot_ink'])
    rows = np.nonzero(a.any(1))[0]
    for comp in components(pot_ink):
        if not any(y == rows.max() for y, _ in comp):
            for y, x in comp:
                col = _vote(px, a, y, x, cls['pot_ink'] | cls['leaf_ink'] | cls['stripe'] | {ink}) or _vote(px, a, y, x, cls['pot_ink'])
                px[y, x] = col if col is not None else px[y, x]
    # 3. a leaf pixel beside the pot (not its outline) is the leaf's edge: ink
    leaf_ink = sorted(cls['leaf_ink'])[0]
    leaf, pot = is_in(cls['leaf']), is_in(cls['pot'])
    for y, x in zip(*np.nonzero(leaf)):
        if any(0 <= y + dy < h and 0 <= x + dx < w and pot[y + dy, x + dx] for dy, dx in N4):
            px[y, x] = leaf_ink
    # 4. stripe runs under 3 px
    for comp in components(is_in(cls['stripe'])):
        if len(comp) < 3:
            for y, x in comp:
                col = _vote(px, a, y, x, cls['stripe'])
                px[y, x] = col if col is not None else px[y, x]
    return px


def overrides(piece, passes=3):
    """The patch of a baked piece (bake with overrides=False): {(x, y): (r, g, b) | None} for every pixel the rules above change
    (rule 5 last, on the tidied picture)."""
    cls = colour_classes()
    rgba = piece.rgba.copy()
    rgba[..., :3] = tidy(piece, cls)
    patch = {}
    for (x, y), col in lone_pixels(rgba).items():
        rgba[y, x] = (0, 0, 0, 0) if col is None else (*col, 255)
    h, w = rgba.shape[:2]
    for y in range(h):
        for x in range(w):
            now = (0, 0, 0, 0) if piece.rgba[y, x, 3] == 0 else tuple(int(v) for v in piece.rgba[y, x])
            new = tuple(int(v) for v in rgba[y, x])
            if rgba[y, x, 3] == 0 and piece.rgba[y, x, 3]:
                patch[(x, y)] = None
            elif piece.rgba[y, x, 3] and now != new:
                patch[(x, y)] = new[:3]
    return patch


def patch_text(piece, patch):
    h, w = piece.rgba.shape[:2]
    colours = sorted({c for c in patch.values() if c is not None})
    letters = {c: chr(ord('a') + i) for i, c in enumerate(colours)}
    rows = [''.join('.' if (x, y) not in patch else '_' if patch[(x, y)] is None else letters[patch[(x, y)]] for x in range(w))
            for y in range(h)]
    head = [f'# piece: {piece.name}', f'# projection: {piece.projection}', f'# recipe: {piece.provenance["recipe_hash"]}',
            f'# canvas: {w}x{h}', '# legend: ' + ' '.join(f'{letters[c]}={V.rgb_hex(c)}' for c in colours),
            '# why: soil specks, loose pot outline, leaf edge against the pot, short stripes, lone pixels (overrides() in potted_plant.py)']
    return '\n'.join(head + rows) + '\n'


def main(argv=None):
    """Rewrite hq-office/art/overrides/potted_plant.<projection>.txt for the registered piece (needed after any change to the
    recipe, which makes a patch stale; an empty patch deletes the file)."""
    import bake as B
    out_dir = Path(__file__).resolve().parents[1] / 'art' / 'overrides'
    out_dir.mkdir(parents=True, exist_ok=True)
    for proj in ('oblique', 'camera75'):
        piece = B.bake(RECIPE, proj, overrides=False)
        patch = overrides(piece)
        f = out_dir / f'{RECIPE.name}.{proj}.txt'
        if patch:
            f.write_text(patch_text(piece, patch), encoding='utf-8')
        elif f.exists():
            f.unlink()
        print(f'{f}: {len(patch)} px of {int((piece.rgba[..., 3] > 0).sum())}')


if __name__ == '__main__':
    main()
