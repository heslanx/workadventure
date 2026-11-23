"""The bar stool (Koncluí: banqueta, turquoise; 3 placed at the bar), written as a volume recipe in metres. Round 4.

Today's picture (lounge.py stool(), 32 x 64 px) mixes views: a domed cushion seen from above on legs drawn in a flat front
elevation, the near and far feet 2 px apart, a straight foot bar, the art floating 21 rows above the canvas bottom, three baked
shadow rows. Wave 1's recipe fixed those and read as a flat cyan drum on a hoop. Round 2 (a lathe cushion on four splayed legs
with a small ring under them) read as a smiley face on the floor strip: two short far-leg stubs 4 px apart ended in mid-air above
a U-shaped ring arc, the 14 px cushion sat on a 22 px bell of legs, the 3 px legs ended in a boot, the cushion was outlined in
near-black like a lidded jar. This round (the art director's score was 5 of 10 for round 2) is a bar stool by silhouette: a padded
oval cushion on four slim timber legs, the two far legs seen beside the near ones, and a foot HOOP on the ground plane.

Round 4 answers the art director's review of round 3 (7 of 10, "ship with one small fix"; the pictures are round-22 to round-33.png and
final.png in /tmp/asset-proto/wave1b/stool): (1) each leg is ONE flat tone: the ribbon's normal baked a stipple of lone light pixels
(rivets, four pale feet), so TIMBER and TIMBER_NEAR are flat one-tone materials, the near legs the dark wood and the far legs and the
hoop a step lighter (the far leg now separates from the near leg for the 4 rows where it shows beside it); (2) the cushion is
a superellipse pad (_Pad, PAD_N 2.35, PAD_K 0.50) with a 3 row band and square lower corners: 14 x 10 px, down from 14 x 12 (the
squeezed lathe's bottom rim fell away over 4 rows: a bun); (3) the side ink is the dark teal all the way down, the near-black
is the underside's two rows only (BAND's ink is the rim ink); (4) the hoop is a row lower (RING_Z 0.155) and the cushion a row
higher, so a row of floor shows between the underside and the hoop's far arc; the lighter lens moved down a row so it keeps its
4 / 6 / 6 / 4 shape clear of the rim.

Everything is in metres. The footprint is 0.5 x 0.5 tile (16 x 16 px in "oblique"). Seat top 0.75 m (SEAT_TOP, the plan's
figure), so the cushion's top face is 16 px above the floor. The cushion is 0.45 m across (the 0.36 m seat of the brief with the
1.25 readability enlargement the kit allows, which is the cap: the kit refuses a higher declared one), 14 px.

How the picture is built (21 look-and-fix rounds by eye, 12 of them for this round; the pictures are
/tmp/asset-proto/wave1b/stool/round-N.png, N = 10 to 33, and zoom-N.png on the real floor strip at 6x or 8x):
  * the cushion is a superellipse prism (_Pad) squeezed along y by PAD_K (the kit has no scale transform; the lighter lens below is
    a lathe squeezed by _Oval). REASON: in "oblique" the
    ground is 32 px per metre in both screen axes, so a round seat is as tall as it is wide and reads as a ball or a coin; at
    PAD_K 0.50 its top face is 6 rows deep over 14 wide, with a 3 row side band below it (14 x 10 px in all). DECLARED DEPARTURE FROM THE ONE
    PROJECTION: every other part (the feet, the hoop) is a true circle or a true square of the oblique projection; the cushion is
    the one oval that is not, so its cast shadow footprint (the runtime bakes the cast texture from the silhouette) and the
    normal map's top face are the squeezed pad's, not a disc's. If the owner dislikes it the fallback is PAD_K = 1.0 with a
    rounded-square pad about 14 x 10 rows; the numbers below then move. The plan is a superellipse (PAD_N 2.35, an oval is 2):
    the lower corners are square enough that the underside row is 10 of the 14 px;
  * the top face has TWO tones and a soft form, not a stripe: the turquoise ramp's second stop at the rim and the fourth stop in
    a lens-shaped oval in the middle (6 x 4 px, rows 4 / 6 / 6 / 4 wide, a flat disc squeezed with the pad), no
    hand-made pixel. The ramp's THIRD stop (#02D1CE, the brand turquoise) is NOT used: the camera pass of the office
    (play/src/front/Konclui/Ambience/domain/shaders.ts, "brand": cmax above 0.8, saturation above 0.6, cyan) keeps any such pixel
    lit at night, and an earlier round's mid-light ring glowed like a neon sign on the dark cushion in the shader lab (MEASURED:
    final-lit.png of rounds 17 to 20). The rim ink of the top arc is a DARK TEAL (ds-petrol 2nd stop, #1E454D), the underside's
    ink (the welt, the last two rows) stays the near-black petrol; the band's ink is the same dark teal as the top arc, so the side
    is one colour: the top reads as a padded face and not as a lid;
  * four legs, each a ribbon whose width is 7 of 4 sub-pixels: exactly 2 columns in every row (see _Strut); the near pair is
    the dark flat wood (TIMBER_NEAR), the far pair and the hoop a step lighter (TIMBER): one tone each, no lit edge. They splay in x (the near
    pair from 0.15 m to 0.25 m either side of the axis: 3 px over their 17 rows) and lean in y, so a near and a far foot stand
    FOOT_DEPTH (0.41 m) apart: 13 rows in "oblique", 9.8 in "camera75" (the plan asks for 9 or more). The far feet stand 0.13 m
    either side of the axis, 8 px apart, where the near legs pass: the far leg shows as the second leg of each side, 4 rows long
    (rows 14 to 17), a pair of legs 3 px wide there against 2 px below; at the foot it ends in nothing under the pad. Spread wider
    (0.15 m) they hide completely behind the near legs, narrower (0.11 m) they read as a knot: 0.13 m is the one that reads as
    four legs (round 13 and 14 in the pictures);
  * the foot hoop is a full circle on the ground plane at 0.20 m high (a third of the legs' height is 0.19 m), 0.185 m in
    radius (chosen on a grid of radius and height, MEASURED over 20 pairs: most pairs leave a lone light pixel where the hoop
    meets a leg, or navy drips under the pad; 0.185 / 0.20 leaves neither in "oblique" and is its own mirror image), 2 px thick at its near arc: it touches both near legs and its far arc shows under the seat like the apron of the stool.
    It is a true circle in the world; the projection decides its look;
  * the wood is a dark timber (not on the office palette: the kit has no brown there, see test_prop_stool.Palette) whose ink
    is far darker than the floor oak, so the legs do not merge with the floor (the lightest wood tone against the floor strip is
    measured in the report). There is no hand-made pixel: the picture is the recipe's alone (round 2's patch drew a highlight
    stroke, a flat foot and a contact pixel; none is needed any more, and its files were removed).

Anchors (metres): 'seat' is the middle of the cushion's top, 'foot' the front centre of the footprint, 'foot_*' the four feet
(far and near, left and right: the near and far pair is the stance's depth apart on screen), 'sit' the seating anchor, the
pixel that lands on the sitter's reference point (see SEAT below).

SEAT (the seating rule, hq-office/build.py sit_between and place_pieces): the prefab's anchorOffset is the pixel of the picture
that lands on the middle of the sitting tile, SEAT_LIFT (8) px above it; its depthOffset is anchorOffset.y - 1 - image height, so
the stool sorts just above the anchor row and the sitter is drawn in front of the whole picture; the pose is the sitter's
hair row and the rows cropped from its legs (a sitter facing the bar is seen from behind); a stool has no front layer. The
picture is placed so that the feet stay where they are today (the stool's near feet at the same screen row as the old stool's):
the anchor is then 14 rows above the feet and 12 rows under the middle of the cushion's top, as today (anchor 29, feet 43, top
face centre row 17), so the sitter sits on the cushion as it does now. In the 20 x 30 picture of round 4: anchorOffset (10, 16), depthOffset
-15, pose dy 2 crop 10, no front layer. See seat_numbers().

Run: python3 -I tools/bake.py stool --out /tmp/asset-proto/stool/out --sheet
"""
import math
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[2] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

import numpy as np  # noqa: E402
import volume as V  # noqa: E402

NAME = 'stool'
FOOTPRINT = (0.5, 0.5)
ENLARGE = 1.25           # 0.45 m cushion against the plan's real 0.36 m seat (the cap is 1.25)

# the stool stands in the middle of its footprint; the near feet end a hair behind its front edge (foot gap at most 1 px)
CX = 0.25

# cushion: an oval pad with a straight side band and a flat top; its lighter ovals are two flat discs on the top
SEAT_TOP = 0.75
PAD_R = 0.225               # 0.45 m across: the plan's 0.36 m seat enlarged by 1.25, 14 px
PAD_N = 2.35                # the pad's plan is a superellipse of this exponent (2 is an oval): square lower corners (see _Pad)
PAD_K = 0.50                # the seat is an oval pad: its depth is PAD_K of its width (see the module notes)
LY = 0.26                   # the stance's centre line in y
CY = LY - 0.07              # the pad's centre: a little behind the stance's, so the far feet show under its front edge
PAD_T = 0.14                # the pad's thickness: 3 rows of band at 21 px per metre of height, the last one outline ink
WELT_H = 0.03               # the ink strip under the band: one row
HI_R = 0.105                # the lighter oval of the top face: 6 x 4 px (see the module notes)
HI_DY = 0.02 

# legs: four slim timber legs that splay outward from under the pad to a wider stance, the far pair narrower than the near pair
LEG_W_NEAR, LEG_W_FAR = 1.75 / 32, 1.75 / 32      # 7 of 4 sub-pixels: exactly 2 columns at every phase
FOOT_NEAR_X, FOOT_FAR_X, FOOT_DEPTH = 0.25, 0.13, 0.41
FOOT_NEAR_Y = 0.49          # the near feet end 0.01 m behind the footprint's front edge (foot gap 0)
TOP_NEAR_X, TOP_FAR_X, TOP_DY = 0.15, 0.10, 0.07
RING_Z = 0.155              # 0.35 of the legs' height (0.57 m), about a third (0.19 m)
RING_R = 0.185
RING_R_TUBE = 0.022

_TURQ = V.PALETTE['FURNITURE_RAMPS']['ds-turquoise']
_INK = V.PALETTE['FURNITURE_RAMPS']['ds-petrol'][0]
_RIM_INK = V.PALETTE['FURNITURE_RAMPS']['ds-petrol'][1]     # the top arc's dark teal ink (the underside keeps the near-black)
CUSHION = V.Material('stool-cushion', (_TURQ[0], _TURQ[1], _TURQ[1]), ink=_RIM_INK)     # the top face: the ramp's second stop
HILITE = V.flat_material('stool-hi', _TURQ[3], _RIM_INK, detail=True)               # its lighter centre
BAND = V.flat_material('stool-band', _TURQ[0], _RIM_INK, detail=True)                    # the side band: the darkest stop
WELT = V.flat_material('stool-welt', _INK, _INK, detail=True)
_OAK = V.PALETTE['FLOOR_RAMPS']['oak-warm'][0]
_DARK_TIMBER = '#3A1E10'
_WOOD_DARK, _WOOD_FAR = (V.mix(_OAK, _DARK_TIMBER, m) for m in (0.97, 0.80))
# each leg is ONE flat tone (a lit edge baked from a ribbon's normal came out as a stipple of lone light pixels); the far pair is a
# step lighter than the near pair and the hoop, so that the 4 rows where a far leg shows beside a near one read as a second leg
TIMBER = V.flat_material('stool-timber', _WOOD_FAR, _WOOD_FAR)
TIMBER_NEAR = V.flat_material('stool-timber-near', _WOOD_DARK, _WOOD_DARK)
RING = V.Material('stool-ring', (_WOOD_FAR,) * 3, ink=_WOOD_FAR)
SEAT_ANCHOR = (CX, CY, SEAT_TOP)

# the seating rule's numbers, as the picture needs them (see the module notes and seat_numbers())
OLD_ANCHOR = (16, 29)       # today's seat anchor in today's 32 x 64 picture (lounge.py STOOL_SEAT)
OLD_CANVAS = (32, 64)
OLD_FOOT = (16, 43)         # today's foot point (the footprint's front edge) in that picture
SIT_ABOVE_FOOT = OLD_FOOT[1] - OLD_ANCHOR[1]        # 14 rows: the sitter's anchor stays that far above the feet
SIT_ANCHOR = (CX, FOOTPRINT[1], SIT_ABOVE_FOOT / 21.0)   # the same height in both projections (21 px per metre of height)
SEAT = dict(direction='up', pose=dict(dy=2, crop=10), front=None)


class _Oval(V.Solid):
    """A solid squeezed along y about the line y = cy: the kit has no scale transform, so the seat's oval is built here
    (the normal of a squeezed surface is the old normal divided by the scale, renormalised)."""

    def __init__(self, inner, cy, k):
        self.inner, self.cy, self.k = inner, cy, k

    def sample(self, step, all_faces=False):
        s = self.inner.sample(step, all_faces)
        P, N = s.P.copy(), s.N.copy()
        P[:, 1] = self.cy + (P[:, 1] - self.cy) * self.k
        N[:, 1] /= self.k
        N /= np.linalg.norm(N, axis=1, keepdims=True)
        return V.Samples(P, N, s.mat, s.names)


class _Pad(V.Solid):
    """The cushion: a short prism on a superellipse (|x / rx|^n + |y / ry|^n = 1) with a flat top and a vertical side. REASON: a
    squeezed lathe (the oval, n = 2) has a bottom rim that is as round as its top one, so its lower corners fell away over 4 rows
    and the cushion read as a bun or an acorn; at n = PAD_N the rim keeps its round look from above and its lower corners come
    square, so the widest row is the first row of the side band. Its material runs from the foot of the side upward: the welt (one
    row of ink under the band), the band, the top face (named by 'mats' as the lathe's were)."""

    def __init__(self, cx, cy, rx, ry, n, zb, zt, welt_h, mats):
        self.cx, self.cy, self.rx, self.ry, self.n, self.zb, self.zt, self.welt_h, self.mats = cx, cy, rx, ry, n, zb, zt, welt_h, mats

    def _rim(self, step):
        th = np.linspace(0, 2 * np.pi, 4001)[:-1]
        c, s = np.cos(th), np.sin(th)
        e = 2.0 / self.n
        x, y = self.rx * np.sign(c) * np.abs(c) ** e, self.ry * np.sign(s) * np.abs(s) ** e
        seg = np.hypot(np.diff(np.append(x, x[0])), np.diff(np.append(y, y[0])))
        arc = np.concatenate([[0.0], np.cumsum(seg)])
        k = max(8, int(math.ceil(arc[-1] / step)))
        k += k % 2                      # an even count keeps the samples their own mirror image about x
        t = (np.arange(k) + 0.5) / k * arc[-1]
        x, y = np.interp(t, arc, np.append(x, x[0])), np.interp(t, arc, np.append(y, y[0]))
        gx = np.sign(x) * np.abs(x / self.rx) ** (self.n - 1) / self.rx
        gy = np.sign(y) * np.abs(y / self.ry) ** (self.n - 1) / self.ry
        return x, y, gx, gy

    def sample(self, step, all_faces=False):
        names = tuple(sorted(set(self.mats)))
        ix = {m: i for i, m in enumerate(names)}
        x, y, gx, gy = self._rim(step)
        parts = []
        zs = [(self.zb, self.zb + self.welt_h, self.mats[0]), (self.zb + self.welt_h, self.zt, self.mats[1])]
        for z0, z1, mat in zs:
            nz = max(1, int(math.ceil((z1 - z0) / step)))
            z = z0 + (np.arange(nz) + 0.5) / nz * (z1 - z0)
            P = np.stack([np.repeat(self.cx + x[:, None], nz, 1), np.repeat(self.cy + y[:, None], nz, 1), np.repeat(z[None, :], len(x), 0)], -1)
            N = np.stack([np.repeat(gx[:, None], nz, 1), np.repeat(gy[:, None], nz, 1), np.zeros((len(x), nz))], -1)
            parts.append(V.Samples(P.reshape(-1, 3), N.reshape(-1, 3), np.full(len(x) * nz, ix[mat]), names))
        nx, ny = 2 * int(math.ceil(self.rx / step)), 2 * int(math.ceil(self.ry / step))      # even counts: symmetric about both axes
        gxs = (np.arange(nx) + 0.5) / nx * 2 * self.rx - self.rx
        gys = (np.arange(ny) + 0.5) / ny * 2 * self.ry - self.ry
        X, Y = np.meshgrid(gxs, gys)
        inside = (np.abs(X / self.rx) ** self.n + np.abs(Y / self.ry) ** self.n) <= 1.0
        P = np.stack([self.cx + X[inside], self.cy + Y[inside], np.full(int(inside.sum()), self.zt)], -1)
        N = np.broadcast_to(np.array([0.0, 0.0, 1.0]), P.shape)
        parts.append(V.Samples(P, N, np.full(len(P), ix[self.mats[2]]), names))
        return V.Samples.concat(parts)


class _Strut(V.Solid):
    """A leg as a ribbon of a set width in x, with the normal of a round post across it (the centre faces the viewer, the
    sides turn away). REASON: a tube of 2 px diameter, slanted, bakes to a wobbling 2 to 4 px wide shape; a ribbon of 7
    sub-pixels covers exactly 2 columns of every row whatever its offset, under the 50% coverage rule of a 4x supersample (a
    width of a whole number of pixels, 8, wobbles by one column at the half-pixel phase). So the leg may splay in x and
    still bake to a staircase of constant width (MEASURED: a bake without the hoop and the far legs gives 2 px in every row)."""

    def __init__(self, a, b, width, mat, turn_deg=65.0):
        self.a, self.b, self.w, self.mat, self.turn = np.asarray(a, float), np.asarray(b, float), width, mat, turn_deg

    def sample(self, step, all_faces=False):
        d = self.b - self.a
        n_t = max(2, int(math.ceil(float(np.linalg.norm(d)) / step)))
        n_u = max(2, int(math.ceil(self.w / step)))
        t = ((np.arange(n_t) + 0.5) / n_t)[:, None]
        u = ((np.arange(n_u) + 0.5) / n_u)[None, :]
        P = self.a + d * t[..., None] + np.array([1.0, 0, 0]) * ((u - 0.5) * self.w)[..., None]
        m = np.cross([1.0, 0, 0], d / np.linalg.norm(d))
        m = m if m[1] > 0 else -m
        m /= np.linalg.norm(m)
        phi = np.radians((u - 0.5) * 2 * self.turn)[..., None]
        N = np.sin(phi) * np.array([1.0, 0, 0]) + np.cos(phi) * m
        P, N = np.broadcast_arrays(P, N)
        return V.Samples(P.reshape(-1, 3), np.broadcast_to(N, P.shape).reshape(-1, 3), np.zeros(P.shape[0] * P.shape[1], np.int32), (self.mat,))


Z_LEG_TOP = SEAT_TOP - PAD_T - 0.045
FEET = {'foot_far_left': (-1, -1), 'foot_far_right': (1, -1), 'foot_near_left': (-1, 1), 'foot_near_right': (1, 1)}


def foot_xy(ux, uy):
    """A foot on the ground: the near pair stands wider apart than the far pair, and the far pair FOOT_DEPTH further back."""
    return CX + ux * (FOOT_NEAR_X if uy > 0 else FOOT_FAR_X), FOOT_NEAR_Y - (0.0 if uy > 0 else FOOT_DEPTH)


def top_xy(ux, uy):
    """Where a leg meets the pad's underside."""
    return CX + ux * (TOP_NEAR_X if uy > 0 else TOP_FAR_X), LY + uy * TOP_DY


def build():
    zb, zt = SEAT_TOP - PAD_T, SEAT_TOP
    pad = _Pad(CX, CY, PAD_R, PAD_R * PAD_K, PAD_N, zb, zt, WELT_H, ('stool-welt', 'stool-band', 'stool-cushion'))
    hi = V.lathe([(HI_R, zt + 0.003), (0.0, zt + 0.003)], CX, CY + HI_DY / PAD_K, 'stool-hi')
    solids = [pad, _Oval(hi, CY, PAD_K)]
    for ux, uy in FEET.values():
        fx, fy = foot_xy(ux, uy)
        tx, ty = top_xy(ux, uy)
        solids.append(_Strut((fx, fy, 0.0), (tx, ty, Z_LEG_TOP), LEG_W_NEAR if uy > 0 else LEG_W_FAR,
                             'stool-timber-near' if uy > 0 else 'stool-timber'))
    solids.append(V.ring(CX, LY, RING_Z, RING_R, RING_R_TUBE, 'stool-ring'))
    anchors = {'seat': SEAT_ANCHOR, 'sit': SIT_ANCHOR}
    anchors.update({name: (*foot_xy(ux, uy), 0.0) for name, (ux, uy) in FEET.items()})
    return V.Recipe(NAME, solids, FOOTPRINT, anchors=anchors, overhangs={'east': 0.10, 'west': 0.10},
                    materials={'stool-cushion': CUSHION, 'stool-timber': TIMBER, 'stool-timber-near': TIMBER_NEAR, 'stool-ring': RING, 'stool-welt': WELT,
                               'stool-band': BAND, 'stool-hi': HILITE},
                    kind='stand', symmetric=True, enlarge=ENLARGE,
                    notes='bar stool: padded oval turquoise cushion on four splayed dark-wood legs with a foot ring; '
                          'seating rule: anchorOffset = anchor "sit" (the feet stay where today\'s stool\'s are), '
                          'depthOffset = anchorOffset.y - 1 - image height, pose dy 2 crop 10, no front layer')


def seat_numbers(piece):
    """The seating numbers of the baked picture (see the module notes): anchorOffset is the pixel of the picture that lands on
    the sitting tile's middle (SEAT_LIFT above it), depthOffset the sort line build.py derives from it, pose and front as
    build.py's seat_pose gives a seat facing the bar ('up': a sitter seen from behind, its legs cropped, no front layer).
    The 'sit' anchor is the feet's row minus SIT_ABOVE_FOOT, which is today's relation (anchor 29, feet 43)."""
    ax, ay = (int(math.floor(v)) for v in piece.anchors['sit'])
    return dict(anchorOffset=dict(x=ax, y=ay), depthOffset=ay - 1 - piece.size[1], direction=SEAT['direction'],
                pose=dict(SEAT['pose']), front=SEAT['front'])


RECIPE = build
