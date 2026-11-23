"""The arc floor lamp, as a volume recipe (plan section 7.2). A heavy round base on the floor, a thin pole that rises and
sweeps over in an arc to a dome shade that hangs above the seating. One model with a `side` parameter: side='right' puts
the dome on the +x side of the base, side='left' on the -x side, both built from the same numbers (never a pixel flip).

World (tools/volume.py): metres, x right, y toward the viewer, z up, 1 tile = 1 m. The footprint is one tile; the base
stands in its front centre and the arc overhangs the neighbouring tile on the dome's side.

No light pool and no glow are modelled: the runtime lamp makes the light. The dome's opening faces down, so the viewer
sees the top of the shade and never its underside; `light_head` is the centre of that opening.
"""
import math
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[2] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

import volume as V  # noqa: E402

# ------------------------------------------------------------------------------------------------ dimensions (metres)
BASE_X = 0.5                    # the base's centre across the one-tile footprint
BASE_R = 0.255                  # 0.51 m across: 16 px wide
KY_BASE = 0.76                  # the base is an oval plate, 0.8 as deep as wide: a round disc is as tall as wide in the
                                # oblique view and reads as a ball, an oval plate reads as a weighted disc
BASE_Y = 1.0 - BASE_R * KY_BASE  # the base's front edge is the footprint's front edge (foot gap 0)
BASE_H = 0.12                   # a weighted plate: its front wall is a 2 px band under the outline
COLLAR_R = 0.11                 # the raised seat the pole stands on: 7 px across, the lightest tone of the base
COLLAR_H = 0.04
POLE_R = 0.04                   # one constant radius, 2.5 px across: a black line with a 1 to 2 px fill
REACH = 1.10                    # base centre to dome centre, sideways
DOME_R = 0.225                  # 0.45 m across
KY_DOME = 0.80                  # the shade is an oval too: wider than tall in both projections
DOME_RIM_Z = 1.55               # the opening: the dome centre is about 1.6 m up
LIP_H = 0.06                    # the shade's vertical wall: a front lip about 1 px tall
RING_W = 0.04                   # the flat ring round the crown, a constant 1.3 px wide all the way round
CROWN_H = 0.05                  # how far the crown rises above the ring
CROWN_R = 0.15                  # the lit crown disc: about 9 px across
NECK_R, NECK_H = 0.07, 0.09     # the small collar disc the pole ends in, on the crown's centre
BACK = (180.0, 360.0)           # the back (north) arc: a rim light from above, the same on both sides of the axis
SPEC_R = 0.02                   # the bright back edge: 1.3 px wide on the top rim of the base and of the shade
SPEC_IN = 0.05                  # its centre, inside the outline pixel
X_APEX = 0.60                   # where along the reach the arc is highest (fraction of REACH)
APEX_Z = 2.09                   # the top of the tube at the highest point of the arc, from the floor
SUPER = 2.2                     # superellipse exponent of the arc: 2 is an ellipse, less is a rounder, shorter top


class _Squash(V.Solid):
    """`inner` scaled by `ky` in y about the line y = cy (the kit has no non-uniform scale; normals use the inverse
    transpose, so they stay unit and outward)."""

    def __init__(self, inner, cy, ky):
        self.inner, self.cy, self.ky = inner, cy, ky

    def sample(self, step, all_faces=False):
        s = self.inner.sample(step, all_faces)
        P = s.P.copy()
        P[:, 1] = self.cy + (P[:, 1] - self.cy) * self.ky
        N = s.N.copy()
        N[:, 1] /= self.ky
        return V.Samples(P, N, s.mat, s.names)


def _dome(cx):
    """The shade seen from above, as four rings: a short vertical lip (the front band), a flat ring of constant width (the
    rim), a sloped shoulder and a flat crown. The opening faces down, so only the outside is modelled and the underside is
    never drawn."""
    z1 = DOME_RIM_Z + LIP_H
    z2 = z1 + CROWN_H
    r1 = DOME_R - RING_W
    prof = [(DOME_R, DOME_RIM_Z), (DOME_R, z1), (r1, z1), (CROWN_R, z2), (0.0, z2)]
    return _Squash(V.lathe(prof, cx, BASE_Y, 'dome', mats=['rim', 'rim', 'shoulder', 'dome'], sharp=(1, 2, 3)), BASE_Y, KY_DOME)


def _shade_edge(cx):
    """The bright back edge of the shade's ring (a rim light from above, the same on both sides of the vertical axis)."""
    return _Squash(V.ring(cx, BASE_Y, DOME_RIM_Z + LIP_H, DOME_R - SPEC_IN, SPEC_R, 'spec', arc_deg=BACK), BASE_Y, KY_DOME)


def _neck(cx):
    """The small collar disc the pole ends in, standing on the crown's centre."""
    z = DOME_RIM_Z + LIP_H + CROWN_H
    return _Squash(V.lathe([(NECK_R, z - 0.01), (NECK_R, z + NECK_H), (0.0, z + NECK_H)], cx, BASE_Y, 'neck', sharp=(1, 2)),
                   BASE_Y, KY_DOME)


def _arc_path(s, z0, z_end):
    """The pole's centre line: a rising superellipse quarter (vertical out of the base, level at the apex) and a falling one
    (level at the apex, vertical into the collar). Smooth, so the pixel runs of the picture grow in order."""
    apex = APEX_Z - POLE_R
    xa = X_APEX * REACH
    e = 2.0 / SUPER
    pts = []
    n = 64
    for i in range(n + 1):
        t = math.pi / 2 * i / n
        pts.append((BASE_X + s * xa * (1 - math.cos(t) ** e), BASE_Y, z0 + (apex - z0) * math.sin(t) ** e))
    for i in range(1, n + 1):
        t = math.pi / 2 * i / n
        pts.append((BASE_X + s * (xa + (REACH - xa) * math.sin(t) ** e), BASE_Y, apex - (apex - z_end) * (1 - math.cos(t) ** e)))
    return pts


def build(side='right'):
    """The recipe for the dome on `side` ('right' or 'left') of the base."""
    if side not in ('right', 'left'):
        raise ValueError(f"side is 'right' or 'left', got {side!r}")
    s = 1.0 if side == 'right' else -1.0
    xd = BASE_X + s * REACH
    seat = BASE_H + COLLAR_H
    pole = V.tube(_arc_path(s, seat, DOME_RIM_Z + LIP_H + CROWN_H + NECK_H - 0.01), POLE_R, 'pole', caps=True)
    # the base: a vertical wall (the front band) and a flat top; a raised collar disc the pole stands on; a thin bright ring
    # on the top rim
    base = _Squash(V.lathe([(0.0, 0.0), (BASE_R, 0.0), (BASE_R, BASE_H), (0.0, BASE_H)], BASE_X, BASE_Y, 'base', sharp=(1, 2)),
                   BASE_Y, KY_BASE)
    collar = _Squash(V.lathe([(COLLAR_R, BASE_H - 0.01), (COLLAR_R, seat), (0.0, seat)], BASE_X, BASE_Y, 'collar', sharp=(1, 2)),
                     BASE_Y, KY_BASE)
    edge = _Squash(V.ring(BASE_X, BASE_Y, BASE_H, BASE_R - SPEC_IN, SPEC_R - 0.005, 'spec', arc_deg=BACK), BASE_Y, KY_BASE)
    solids = [base, edge, collar, pole, _dome(xd), _shade_edge(xd), _neck(xd)]
    # foot: the base's front contact point (the footprint's front edge); light_head: the centre of the dome's opening;
    # base: the base's centre on the floor (the height of the arc is measured from it)
    anchors = {'foot': (BASE_X, 1.0, 0.0), 'light_head': (xd, BASE_Y, DOME_RIM_Z), 'base': (BASE_X, BASE_Y, 0.0)}
    reach_out = REACH + DOME_R - BASE_X            # past the footprint edge, on the dome's side only
    over = {'east' if side == 'right' else 'west': reach_out}
    mats = {'base': V.Material('base', ('#05061A', '#142160', '#2B3A78', '#46566E')),
            'collar': V.Material('collar', ('#05061A', '#142160', '#2B3A78', '#6F83A0')),
            'spec': V.flat_material('spec', '#6F83A0', '#05061A'),
            'pole': V.Material('pole', ('#05061A', '#0B1441', '#142160')),
            'neck': V.Material('neck', ('#142160', '#2B3A78', '#46566E', '#6F83A0')),
            'rim': V.Material('rim', ('#05061A', '#142160', '#2B3A78', '#46566E')),
            'shoulder': V.flat_material('shoulder', '#2B3A78', '#05061A'),
            'dome': V.Material('dome', ('#142160', '#2B3A78', '#46566E', '#6F83A0'))}
    return V.Recipe(f'arc-lamp-{side}', solids, (1, 1), anchors, overhangs=over, materials=mats, kind='stand',
                    notes='apex 2.1 m, dome 1.6 m up and 1.1 m sideways, no light pool')


RECIPE = [build('left'), build('right')]
