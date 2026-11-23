"""Proxy volumes for the arc floor lamps that are placed in the office, drawn in elevation and kept as drawn.

Three drawings, three recipes (tools/proxy.py bakes them over the sprite):
  konclui          konclui/sprites/konclui-konclui-lumin-ria-de-arco-preto.png, 110 x 96, lounge.py `lit_arc_lamp`: the lamp
                   `arc_lamp` (64 x 80) at (27, 0) over a baked light pool. The base is on the right, the dome on the left.
  mobilia_right    mobilia/.../mob-0092afb7-....png (3 placed), 64 x 64: the base at the left, the head at the right
  mobilia_left     mobilia/.../mob-86fcec6a-....png (1 placed): the pixel mirror of the one above (MEASURED: equal to it
                   flipped), so its recipe is the other one mirrored

How the geometry is read from a picture. The oblique projection draws height straight up, so a pole, an arc and a dome drawn in
elevation are right as drawn. Every part is placed in the vertical plane of the base (floor contact row GROUND) and
its height is the row difference, in px: a point drawn at canvas row R is GROUND - R px above the floor (/ 21 for metres). A base,
a rim or a head drawn with a flat footprint (a few rows deep where a round one would be as deep as wide) is `flattened`: its
positions are squashed to the picture, its NORMALS stay those of the round solid, so it is lit as a round thing.
Sizes are the picture's: the arc is about 3 m tall at 21 px per metre (the audit's "too big"); the proxy does not correct it.

Anchors (canvas px, via the recipe's origin): foot = the base's front centre on the floor; base = its centre; light_head = the
centre of the dome's opening (the light shines down from it).
"""
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[3] / 'tools'
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

import numpy as np  # noqa: E402

import proxy as P  # noqa: E402
import volume as V  # noqa: E402

KONCLUI_KEY = 'konclui/sprites/konclui-konclui-lumin-ria-de-arco-preto.png'
MOBILIA_RIGHT_KEY = 'mobilia/sprites/roomdecor/mob-0092afb7-c02a-4ab9-930b-217394bc1522.png'
MOBILIA_LEFT_KEY = 'mobilia/sprites/roomdecor/mob-86fcec6a-3b67-498d-be33-125a2c69a7ba.png'

MAT = V.Material('proxy', ('#202428', '#707880', '#E0E4E8'))
MATS = {'proxy': MAT}


def _hemisphere(F, cx_px, ground, rim_row, a_px, b_px, ky, n=28):
    """A dome whose opening faces down: x-radius a_px, rising b_px above its rim, the rim centre drawn at canvas row `rim_row`,
    flattened by ky (its rim is a flat ellipse). The profile is an ellipse; its normals are the SPHERE's, so it shades as a ball."""
    th = np.radians(np.linspace(0.0, 90.0, n))
    prof = [(F.r(a_px * np.cos(t)), F.z(b_px * np.sin(t)), float(np.cos(t)), float(np.sin(t))) for t in th]
    # the lathe runs from the bottom to the top over the outside: the rim first, the apex last
    h_rim = ground - rim_row
    cx, cy = F.x(cx_px), F.y(ground)
    solid = V.lathe([(r, z + F.z(h_rim), nr, nz) for r, z, nr, nz in prof], cx, cy, 'proxy', crease_deg=89.0)
    return P.flattened(solid, ky, cy)


def _puck(F, cx_px, ground, r0_px, r1_px, h_px, ky):
    cx, cy = F.x(cx_px), F.y(ground)
    return P.flattened(V.frustum(cx, cy, 0.0, F.z(h_px), F.r(r0_px), F.r(r1_px), 'proxy'), ky, cy)


def _bezier_px(p0, p1, p2, p3, n=60):
    c = np.array([p0, p1, p2, p3], float)
    return V.bezier(c, n)


# ---------------------------------------------------------------------------------------------------------- konclui

def konclui():
    """lounge.py `arc_lamp()` at (27, 0) in the 110 x 96 picture. Numbers below are lounge.py's: the Bezier (42, 62) (42, 5)
    (16, 3) (15, 11), the base ellipse 10 x 5 at (42.5, 66), the cap 6 x 4 at (12..17, 9..12), the dome 13 px across at (15, 27)."""
    OX, OY, DX = 6, 41, 27
    F = P.Frame((OX, OY))
    g = 66.0                                                     # the floor row of the base's centre, canvas rows
    solids = [_puck(F, DX + 42.5, g, 10.0, 8.8, 2.0, 0.5)]
    pts = _bezier_px((DX + 42, 62), (DX + 42, 5), (DX + 16, 3), (DX + 15, 11)) + 0.5     # pixel indices -> pixel centres
    solids.append(V.tube([F.m(x, g, g - r) for x, r in pts], F.r(1.5), 'proxy'))
    solids.append(V.frustum(F.x(DX + 15.0), F.y(g), F.z(g - 13.0 + 0.0), F.z(g - 9.0), F.r(3.0), F.r(2.6), 'proxy'))   # the cap on the dome's crown
    solids.append(_hemisphere(F, DX + 15.0, g, 27.0, 13.0, 13.0, 0.35))
    anchors = {'foot': F.m(DX + 42.5, g + 5.0, 0.0), 'base': F.m(DX + 42.5, g, 0.0), 'light_head': F.m(DX + 15.0, g, g - 27.0)}
    r = V.Recipe('proxy-arc-lamp-konclui', solids, (3.0, 1.0), anchors, materials=MATS, kind='stand', coverage=0.5, margin=1)
    return P.ProxyRecipe('arc_lamp.konclui', r, (OX, OY), (KONCLUI_KEY,),
                         ground=(F.x(DX + 32.5), F.y(g - 5.0), F.x(DX + 52.5), F.y(g + 5.0)),
                         notes="lounge.py lit_arc_lamp: the dome is on the left, the base on the right; the baked light pool is not modelled")


# ---------------------------------------------------------------------------------------------------------- mobilia

MOBILIA_PATH = [(16.5, 54.5), (13.0, 52.5), (10.5, 50.5), (9.5, 47.5), (7.5, 44.5), (6.5, 41.5), (5.5, 38.5), (5.5, 29.5), (5.5, 26.5),
                (6.5, 23.5), (7.5, 20.5), (9.5, 17.5), (11.5, 14.5), (14.0, 11.5), (18.5, 8.5), (22.0, 7.0), (26.0, 6.5), (30.0, 6.5),
                (32.5, 7.5), (35.0, 8.5), (37.0, 10.0), (39.0, 11.5), (41.0, 13.0)]


def mobilia_right():
    """The catalogue's arc lamp: base at the left (a round disc 14 px across), pole up the left side, the arc over the top and the
    head (a 15 x 12 px shade) hanging at the right end. The centre line of the pole is read off the picture (MOBILIA_PATH)."""
    F = P.Frame((0, 32))
    g = 56.5
    base_x = 16.5
    cy = F.y(g)
    cap = [(0.0, F.z(3.0)), (F.r(2.5), F.z(2.9)), (F.r(4.5), F.z(2.4)), (F.r(6.0), F.z(1.5)), (F.r(6.8), F.z(0.4)), (F.r(6.8), 0.0)]
    base = V.lathe([(0.0, 0.0), (F.r(6.8), 0.0)] + cap[::-1][1:], F.x(base_x), cy, 'proxy')
    tube = V.tube([F.m(x, g, g - r) for x, r in MOBILIA_PATH], F.r(1.5), 'proxy')
    head = P.flattened(V.sphere(F.x(41.5), cy, F.z(g - 19.0), F.r(7.5), 'proxy'), 0.46, cy)
    anchors = {'foot': F.m(base_x, g + 6.8, 0.0), 'base': F.m(base_x, g, 0.0), 'light_head': F.m(41.5, g, g - 24.0)}
    r = V.Recipe('proxy-arc-lamp-mobilia', [base, tube, head], (2.0, 1.0), anchors, materials=MATS, kind='stand', coverage=0.5, margin=1)
    return P.ProxyRecipe('arc_lamp.mobilia_right', r, (0, 32), (MOBILIA_RIGHT_KEY,),
                         ground=(F.x(base_x - 6.8), F.y(g - 6.8), F.x(base_x + 6.8), F.y(g + 6.8)),
                         notes='the mirror of mobilia_left; the head sits at the arc end, base and head share one plane')


def mobilia_left():
    right = mobilia_right()
    mirrored = right.recipe.mirrored()
    mirrored.name = 'proxy-arc-lamp-mobilia-mirrored'
    x0, y0, x1, y1 = right.ground
    w = right.recipe.footprint[0]
    return P.ProxyRecipe('arc_lamp.mobilia_left', mirrored, right.origin, (MOBILIA_LEFT_KEY,), ground=(w - x1, y0, w - x0, y1),
                         notes='mobilia_right mirrored about the footprint centre (the sprite is that picture flipped)')


PROXIES = [konclui, mobilia_right, mobilia_left]
