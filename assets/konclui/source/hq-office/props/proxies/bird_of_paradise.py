"""Proxy volumes for the large potted plants drawn by lounge.py `bird_of_paradise` (the two bird-of-paradise sprites placed in
the office, 64 x 96 each), kept as drawn.

The drawing: a white ceramic pot (a lip with soil in it, a body that bulges and narrows to its foot) and, from the soil, seven
stalks that each end in a paddle blade, all in ELEVATION (the oblique projection draws height straight up). The proxy reads the
same numbers lounge.py draws with (`BIRD_TALL`, `BIRD_TALLER` and the pot tuple, copied below; test_proxy.py pins them against
lounge.py):
  pot     a lathe: the body from the foot (radius w_bottom / 2) up through the 8 % bulge to the lip, the lip ring, the inner wall and
          the soil. The picture draws the rim a few rows deep (about 0.22 of its width: a bucket seen nearly from the side), so the lathe
          is `flattened` by KY_POT: its positions match the picture, its normals are those of a round pot.
  stalks  a thin tube each, in the vertical plane of the pot's axis (a different depth per leaf, in the order lounge.py draws them,
          so a later leaf is in front of an earlier one as in the picture)
  blades  a `Sheet` each: the paddle outline lounge.py draws (a pointed oval), authored in the sprite's own pixels, leaning back
          LEAN_DEG from the viewer with a RIDGE_PX midrib (the normals fan out across the blade). The blades are plausible per leaf,
          not a copy of the shading: lounge.py lights them from the left, the proxy only supplies relief.
Sizes are the picture's (the audit's "too big"): the proxy does not correct them. A blade that leaves the canvas (the top leaf at
row -4 for BIRD_TALLER) is baked whole and cropped by the canvas.
"""
import math
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[3] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

import numpy as np  # noqa: E402

import proxy as P  # noqa: E402
import volume as V  # noqa: E402

KEY_ALTA = 'konclui/sprites/konclui-konclui-planta-ave-do-paraiso-alta.png'
KEY_BRANCO = 'konclui/sprites/konclui-konclui-planta-ave-do-paraiso-branco.png'

# lounge.py: (angle from straight up clockwise, blade length, blade width, stalk length, base dx), the back leaves first
BIRD_TALL = [(-14, 30, 13, 18, -1), (16, 30, 13, 20, 1), (-40, 27, 12, 12, -2), (42, 28, 12, 12, 2),
             (-2, 30, 12, 24, 0), (-64, 23, 11, 7, -2), (66, 23, 11, 6, 2)]
BIRD_TALLER = [(-12, 31, 13, 30, -1), (14, 31, 13, 32, 1), (-36, 28, 12, 18, -2), (38, 29, 12, 18, 2),
               (-1, 31, 12, 38, 0), (-62, 24, 11, 9, -2), (64, 24, 11, 8, 2)]
POT_DEFAULT = (32, 66, 23, 17, 27)            # lounge.py: (cx, top, w_top, w_bottom, height) of `bird_of_paradise`
POT_BRANCO = (32, 71, 23, 17, 22)             # the corner plants' shorter pot
SIZE = (64, 96)

KY_POT = 0.22            # the picture's rim is about 0.22 as deep as it is wide
LEAN_DEG = 20.0          # the blades lean back from the viewer
RIDGE_PX = 1.5           # height of a blade's midrib over its edges, px
STALK_R_PX = 1.0         # the stalks are 2 px wide
DEPTH_STEP_PX = 0.6      # each later leaf is this much nearer (height px) than the one before
MAT = V.Material('proxy', ('#203020', '#608060', '#E0F0E0'))
MATS = {'proxy': MAT}


def _axes(angle):
    th = math.radians(angle)
    ux, uy = math.sin(th), -math.cos(th)
    return ux, uy, -uy, ux


def _pot(F, pot, g, ky):
    """The pot's lathe, flattened. g is the floor row of the pot's axis; the lip is drawn at row `top`."""
    cx, top, w_top, w_bottom, height = pot
    h_rim = g - top                                             # px above the floor of the lip
    pts = []
    for k in range(9):                                          # the body, foot first: t = 1 at the foot, 0 at the lip
        t = 1.0 - k / 8.0
        half = (w_top + (w_bottom - w_top) * t) / 2.0 * (1 + 0.08 * math.sin(math.pi * min(1.0, t * 1.4)))
        pts.append((half, (1.0 - t) * h_rim))
    lip = w_top / 2.0 + 0.6
    soil = lip * math.sqrt(0.5)
    prof = [(0.0, 0.0)] + [(F.r(r), F.z(z)) for r, z in pts]
    prof += [(F.r(lip), F.z(h_rim - 0.4)), (F.r(lip), F.z(h_rim)), (F.r(soil), F.z(h_rim)), (F.r(soil), F.z(h_rim - 1.5)), (0.0, F.z(h_rim - 1.5))]
    solid = V.lathe(prof, F.x(cx), F.y(g), 'proxy', crease_deg=40.0, sharp=(1, 11, 12, 13))
    return P.flattened(solid, ky, F.y(g))


def plant(name, key, leaves, pot=POT_DEFAULT, size=SIZE):
    """The proxy of one `bird_of_paradise(leaves, size, pot)` picture."""
    cx, top, w_top, w_bottom, height = pot
    OX, OY = 0, size[1] - 32                                    # the sprite's last 32 rows are the footprint's depth
    F = P.Frame((OX, OY))
    g = top + height - KY_POT * w_bottom / 2.0                  # floor row of the pot's axis: its foot's front edge is the picture's last pot row
    solids = [_pot(F, pot, g, KY_POT)]
    for i, (angle, length, width, stem, dx) in enumerate(leaves):
        ux, uy, vx, vy = _axes(angle)
        gi = g + i * DEPTH_STEP_PX                              # the vertical plane of this leaf: floor contact row
        bx, by = cx + dx, top - 1                               # where lounge.py starts the stalk
        if stem > 0:
            path = [(bx + ux * k + vx * 0.5 + 0.5, by + uy * k + vy * 0.5 + 0.5) for k in np.linspace(0, stem, 5)]
            solids.append(V.tube(F.path(path, gi), F.r(STALK_R_PX), 'proxy'))
        sx_, sy_ = bx + ux * stem, by + uy * stem               # the blade's base

        def outline(t, u, sx_=sx_, sy_=sy_, ux=ux, uy=uy, vx=vx, vy=vy, length=length, width=width):
            s = t * length
            q = np.abs(2 * t - 1)
            half = width / 2.0 * np.clip(1 - q ** 1.8, 0, None) ** 0.6
            return sx_ + ux * s + vx * u * half, sy_ + uy * s + vy * u * half

        def relief(t, u):
            return RIDGE_PX * (1 - np.abs(u)) * np.sin(np.pi * np.clip(t, 0, 1)) ** 0.5

        solids.append(P.Sheet(F, outline, 'proxy', sy_, gi - sy_, LEAN_DEG, relief))
    anchors = {'foot': F.m(cx, g + KY_POT * w_bottom / 2.0, 0.0), 'base': F.m(cx, g, 0.0), 'rim': F.m(cx, g, g - top)}
    r = V.Recipe(f'proxy-{name}', solids, (size[0] / 32.0, 1.0), anchors, overhangs={'north': 2.5}, materials=MATS, kind='stand',
                 coverage=0.4, margin=2)
    rb = w_bottom / 2.0
    return P.ProxyRecipe(name, r, (OX, OY), (key,), ground=(F.x(cx - rb), F.y(g - KY_POT * rb), F.x(cx + rb), F.y(g + KY_POT * rb)),
                         notes='lounge.py bird_of_paradise: stalks and paddle blades over a flattened pot lathe')


def alta():
    return plant('bird_of_paradise.alta', KEY_ALTA, BIRD_TALLER)


def branco():
    return plant('bird_of_paradise.branco', KEY_BRANCO, BIRD_TALL, POT_BRANCO)


PROXIES = [alta, branco]
