"""The air hockey table as a volume recipe (plan section 7.4; today's picture is lounge.air_hockey()).

A 2.0 x 1.1 x 0.8 m table on a 2 x 1 tile footprint. The 0.1 m of depth beyond the footprint is on the far (north) side, so
the near apron stands exactly on the footprint's front edge and the piece sorts like any 2 x 1 piece. Everything is authored
in metres; tools/projection.json turns it into pixels, so the same recipe bakes in "oblique" and in "camera75".

What stands where (x right, y toward the viewer, z up; the playfield is z = 0.75, the rim top z = 0.80):
    playfield   a white slab recessed 0.05 m inside the rim, with the centre line, the centre circle and the two goal
                creases painted on it (decals, so they follow the surface exactly)
    rim         four boxes, 0.10 m thick: the middle teal on top with a lighter 1 px edge on every outer side, the far rim
                showing its darker inner face above the playfield (the recess reads there); the near rim is the front apron:
                a dark panel 0.30 m tall (0.33 m with the rim, by design: the legs make up the rest of the 0.8 m) with a
                turquoise stripe and two 1 px panel seams, a quarter and three quarters along, one tone darker than the panel
    goal slots  a dark 0.36 m notch in the top of each end rim, on the same screen rows as the centre circle
    legs        four 0.125 m posts one tone below the apron. The near pair ends on the footprint's front edge; the far pair is
                hidden behind the top in both projections (the tabletop covers every row they could occupy)
    game        a mint and a blue mallet and one near-black 5 px puck, all on the playfield. A mallet is a 7 px disc in a four
                step ramp: the rim in the second tone, the body in the third, a 3 px lighter cap that stands one height px up,
                and the darkest tone only as the lip under the disc. Mallet 7 px = 0.22 m against a real 0.10 m and puck 5 px =
                0.16 m against 0.08 m: a legibility trade-off (a 4 px disc cannot hold a rim, a body and a cap)

Pixel grid: the painted rings, the mallets and the puck are placed on the oblique pixel grid (1 px = 1/32 m on the ground, 1/21 m
of height). Two small hand patches finish what the model cannot give (each far below the 8% budget):
    air_hockey.oblique.txt    17 px: the baker's sampling breaks the mirror of the centre circle and the goal creases on a few 50%
                              coverage ties; the lower-left quarter is the master and the other three take its pixels. Plus the
                              8 px of the apron's bottom outline row that the legs' fill overwrites where they join
    air_hockey.camera75.txt   44 px: the same mirror fix for the circle; each goal crease drawn by hand as one connected 13-row arc
                              (resampling the circle at 24 px per metre leaves a one-pixel gap); both mallets stamped as a 6 row
                              disc (5-7-7-7-7-5: rim, a 3 x 2 cap, a body row, the lip), the puck as a 5 row octagon, and the same
                              8 leg-join outline pixels. camera75's rows are 3/4 of a pixel, so the model alone cannot hold these

Colours: every tone is a palette stop (tools/palettes/office.hex), the game pieces too. The palette has no red, so the two sides are
the palette's own mint and steel-blue ramps (4 tones each; the mint body is also the colour of the centre line and circle). An earlier
version drew them in a red and a blue that were not in the palette (E5484D and seven more) and failed office.palette.
"""
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[2] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

import numpy as np  # noqa: E402
import volume as V  # noqa: E402

NAME = 'air_hockey'

# ---------------------------------------------------------------------------------------------------- dimensions (m)
W, D, H = 2.0, 1.1, 0.80
Y_FAR, Y_NEAR = -0.10, 1.00            # the table spans y -0.1 .. 1.0; the footprint is y 0 .. 1
RIM = 0.10                             # rim thickness on the sides and the ends
Z_FIELD = 0.75                         # playfield surface
Z_APRON = 0.50                         # underside of the body
X = 1 / 32                             # one ground px in x (both projections)
ZP = 1 / 21                            # one height px

FIELD_X0, FIELD_X1 = RIM, W - RIM
FIELD_Y0, FIELD_Y1 = Y_FAR + RIM, Y_NEAR - RIM
CY = (FIELD_Y0 + FIELD_Y1) / 2         # the table's long axis, in y (0.45 m)
CY_PAINT = (20 - 5.25) * X             # where the rings are centred: on a pixel row boundary in oblique (row = 5.25 + 32 y at z = 0.75)
CX = W / 2
# game pieces sit on the pixel grid. Oblique: row = 21 + 32 y - 21 z, column = 1 + 32 x; camera75: row = 20 + 24 y - 21 z. A mallet's
# disc top (z = 0.75 + ZP) is centred on a pixel centre in oblique and within 0.06 row of one in camera75 (no stray pixel in either).
MALLET_X = 19.5 * X
MALLET_Y_MINT, MALLET_Y_STEEL = 16.25 * X, 12.25 * X
PUCK_X, PUCK_Y = 24.5 * X, (12.5 - 4.25 - 0.1) * X     # a 5 px puck is centred on a pixel column; 0.1 px up keeps both projections off a coverage tie
# the goal slots: 0.36 m wide notches in the end rims' tops, placed so that on screen they span the same rows as the centre circle
# (oblique rows 14..25 = 12 rows, camera75 rows 11..19 = 9 rows) and so sit level with the creases. y 0.32..0.68 is centred on 0.50, not
# on the table's axis (0.45 m): the rim top (z 0.80) draws 1 row higher than the playfield, and the pixel-grid centre of the rings is
# 0.46 m, so the slot is moved 0.05 m toward the viewer to land on the same rows.
SLOT_Y0, SLOT_Y1 = 0.32, 0.68

# ------------------------------------------------------------------------------------------------------- materials
# palette stops (tools/palettes/office.hex)
ICE = ('#C2CFD7', '#DDE9EE', '#E8F1F5', '#F5FAFC')
RIM_TOP = V.MATERIALS['ds-petrol']                      # dark blue-teal
BODY = V.MATERIALS['ds-ink']                            # the navy apron, the legs, the slots
# the two sides: one mint, one steel-blue, each a 4-tone ramp of the office palette. A mallet is drawn in three flat tones: the darkest as its rim (the outline),
# the second as its body, the lightest as the cap of its knob. The body is one step below the mint of the centre line and circle (MINT[2]),
# so a mallet that stands on the circle does not merge with it.
MINT = ('#04706F', '#0E7F66', '#00D7A1', '#B6FFE7')
STEEL = ('#0A0F33', '#162461', '#2B3A78', '#8A9FBA')
PUCK = ('#05061A', '#0F262C')                            # ink and top: near-black, and not a second blue beside the steel mallet
RIM_RAMP = ('#0F262C', '#1E454D', '#2C626C')            # the rim top is the middle teal, the inner face one step down
RIM_EDGE = '#3F7C86'                                     # the 1 px edge of the rim top, lighter on all four sides (no direction)
LEG = '#0B1441'                                          # one ramp step below the apron: the legs separate from it


def _mallet_materials(name, ramp):
    return {
        f'{name}-wall': V.flat_material(f'{name}-wall', ramp[0], ink=ramp[0], detail=True),
        f'{name}-side': V.flat_material(f'{name}-side', ramp[1], ink=ramp[0], detail=True),
        f'{name}-body': V.flat_material(f'{name}-body', ramp[2], ink=ramp[0], detail=True),
        f'{name}-cap': V.flat_material(f'{name}-cap', ramp[3], ink=ramp[0], detail=True),
    }


def materials():
    out = {
        'ice': V.Material('ice', ICE, ink='#46566E'),
        'rim': V.Material('rim', RIM_RAMP, ink=RIM_RAMP[0]),
        'rim-edge': V.flat_material('rim-edge', RIM_EDGE, ink=RIM_RAMP[0]),
        'body': V.Material('body', BODY.ramp, ink=BODY.ramp[0]),
        'leg': V.flat_material('leg', LEG, ink=BODY.ramp[0]),
        'slot': V.flat_material('slot', BODY.ramp[0], ink=BODY.ramp[0]),
        'stripe': V.flat_material('stripe', '#02D1CE', ink=BODY.ramp[0]),
        'crease': V.flat_material('crease', '#02A8A6', ink='#04706F'),
        'line': V.flat_material('line', MINT[2], ink=MINT[1]),
        'puck-side': V.flat_material('puck-side', PUCK[0], ink=PUCK[0], detail=True),
        'puck-top': V.flat_material('puck-top', PUCK[1], ink=PUCK[0], detail=True),
    }
    out.update(_mallet_materials('mint', MINT))
    out.update(_mallet_materials('steel', STEEL))
    return out


# ------------------------------------------------------------------------------------------------------------ decals
def _field_masks():
    """Decals for the playfield slab. a = x - FIELD_X0, b = y - FIELD_Y0 (metres, b grows toward the viewer)."""
    cx, cy = CX - FIELD_X0, CY_PAINT - FIELD_Y0
    half = 0.5 * X

    def centre_line(a, b):
        return (a >= cx - half) & (a < cx + half)

    def centre_circle(a, b):
        r = np.hypot(a - cx, b - cy)
        return (r >= 5 * X) & (r < 6 * X)

    def creases(a, b):
        out = np.zeros(a.shape, bool)
        for gx in (0.0, FIELD_X1 - FIELD_X0):
            r = np.hypot(a - gx, b - cy)
            out |= (r >= 8 * X) & (r < 9 * X)
        return out
    return [V.Decal('top', 'crease', creases), V.Decal('top', 'line', centre_line), V.Decal('top', 'line', centre_circle)]


def _slot(y_lo, y_hi, y0):
    """The goal notch: y in [y_lo, y_hi) in metres, on a box whose top decal measures b from y0."""
    def mask(a, b):
        return (b + y0 >= y_lo) & (b + y0 < y_hi)
    return mask


def _edge(width, depth, *, far=False, near=False, west=False, east=False):
    """The lighter edge along the outer sides of a rim box's top (a = x, b = y from the box's own corner). Where the baker's
    1 px outline takes the outermost row (far, west, east) the band is 2 px, so that one px of it stays; at the near edge, 1 px."""
    def mask(a, b):
        out = np.zeros(a.shape, bool)
        if far:
            out |= b < 2 * X
        if near:
            out |= b >= depth - X
        if west:
            out |= a < 2 * X
        if east:
            out |= a >= width - 2 * X
        return out
    return mask


def _apron_seams(a_px):
    """Two 1 px panel seams on the apron, a quarter and three quarters along, mirrored about the table's axis."""
    def mask(a, b):
        return ((a >= a_px * X) & (a < (a_px + 1) * X)) | ((a >= (64 - a_px - 1) * X) & (a < (64 - a_px) * X))
    return mask


def _apron_stripe(top_gap, thick):
    def mask(a, b):
        return (b >= top_gap) & (b < top_gap + thick)
    return mask


# ------------------------------------------------------------------------------------------------------------- parts
def _mallet(cx, cy, name):
    """A disc with a knob, seen from above, drawn as the drawn ones are: a 1 px rim in the darkest tone, 1 px of body, and a
    3 x 3 cap in the lightest tone that stands one height px above the disc. Flat tones, so it carries no left or right light."""
    z = Z_FIELD
    r, r_body, rk, hd, hk = 3.6 * X, 2.6 * X, 1.5 * X, ZP, 2 * ZP     # 3.6, not 3.5: a 7 px disc whose last row is 5 px, not 3
    prof = [(0.0, z), (r, z), (r, z + hd), (r_body, z + hd), (rk, z + hd), (rk, z + hk), (0.0, z + hk)]
    mats = [f'{name}-wall', f'{name}-wall', f'{name}-side', f'{name}-body', f'{name}-body', f'{name}-cap']
    return V.lathe(prof, cx, cy, mats[0], mats=mats, crease_deg=40)


def _puck(cx, cy):
    """A flat near-black disc 5 px across and one height px thick: a 1 px rim in the ink, a 3 px top in the second tone."""
    z, r, r_top, h = Z_FIELD, 2.65 * X, 1.65 * X, ZP
    prof = [(0.0, z), (r, z), (r, z + h), (r_top, z + h), (0.0, z + h)]
    return V.lathe(prof, cx, cy, 'puck-top', mats=['puck-side', 'puck-side', 'puck-side', 'puck-top'], crease_deg=40)


def recipe():
    field_decals = _field_masks()
    rim_d = RIM
    solids = [
        # the slab under everything: the playfield on top, the navy body below the rim
        V.box(FIELD_X0, FIELD_Y0, Z_APRON, FIELD_X1, FIELD_Y1, Z_FIELD, 'body', top='ice', decals=field_decals),
        # far rim: its inner face is the one that shows above the playfield
        V.box(0.0, Y_FAR, Z_APRON, W, FIELD_Y0, H, 'body', top='rim', south='rim', decals=[
            V.Decal('top', 'rim-edge', _edge(W, rim_d, far=True, west=True, east=True))]),
        # near rim = front apron: petrol top, navy panel with a turquoise stripe
        V.box(0.0, FIELD_Y1, Z_APRON, W, Y_NEAR, H, 'body', top='rim', decals=[
            V.Decal('top', 'rim-edge', _edge(W, rim_d, near=True, west=True, east=True)),
            V.Decal('south', 'leg', _apron_seams(16)),
            V.Decal('south', 'stripe', _apron_stripe(0.075, ZP))]),
        # end rims with the goal slots
        V.box(0.0, FIELD_Y0, Z_APRON, RIM, FIELD_Y1, H, 'body', top='rim', decals=[
            V.Decal('top', 'rim-edge', _edge(RIM, FIELD_Y1 - FIELD_Y0, west=True)),
            V.Decal('top', 'slot', _slot(SLOT_Y0, SLOT_Y1, FIELD_Y0))]),
        V.box(W - RIM, FIELD_Y0, Z_APRON, W, FIELD_Y1, H, 'body', top='rim', decals=[
            V.Decal('top', 'rim-edge', _edge(RIM, FIELD_Y1 - FIELD_Y0, east=True)),
            V.Decal('top', 'slot', _slot(SLOT_Y0, SLOT_Y1, FIELD_Y0))]),
    ]
    for x in (2 * X, W - 6 * X):                                           # legs, 4 px wide: near pair, far pair
        solids.append(V.box(x, 0.84, 0.0, x + 4 * X, 0.97, Z_APRON, 'leg'))
        solids.append(V.box(x, Y_FAR + 0.04, 0.0, x + 4 * X, Y_FAR + 0.17, Z_APRON, 'leg'))
    solids += [_mallet(MALLET_X, MALLET_Y_MINT, 'mint'), _mallet(W - MALLET_X, MALLET_Y_STEEL, 'steel'), _puck(PUCK_X, PUCK_Y)]
    return V.Recipe(NAME, solids, (2, 1), anchors={'top': (CX, CY, H)}, overhangs={'north': 0.10}, materials=materials(),
                    kind='stand', symmetric=False,
                    notes='Air hockey table 2.0 x 1.1 x 0.8 m, footprint 2 x 1 tiles, the extra 0.1 m of depth on the far side.')


RECIPE = recipe
